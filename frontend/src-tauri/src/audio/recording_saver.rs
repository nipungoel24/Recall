use anyhow::Result;
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::mpsc;
use tokio::sync::Mutex as AsyncMutex;

use super::audio_processing::create_meeting_folder;
use super::incremental_saver::IncrementalAudioSaver;
use super::recording_state::AudioChunk;

/// Structured transcript segment for JSON export
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub id: String,
    pub text: String,
    pub audio_start_time: f64, // Seconds from recording start
    pub audio_end_time: f64,   // Seconds from recording start
    pub duration: f64,         // Segment duration in seconds
    pub display_time: String,  // Formatted time for display like "[02:15]"
    pub confidence: f32,
    pub sequence_id: u64,
}

/// Meeting metadata structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingMetadata {
    pub version: String,
    pub meeting_id: Option<String>,
    pub meeting_name: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub duration_seconds: Option<f64>,
    pub devices: DeviceInfo,
    pub audio_file: String,
    pub transcript_file: String,
    pub sample_rate: u32,
    pub status: String, // "recording", "completed", "error"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub microphone: Option<String>,
    pub system_audio: Option<String>,
}

/// New recording saver using incremental saving strategy
pub struct RecordingSaver {
    incremental_saver: Option<Arc<AsyncMutex<IncrementalAudioSaver>>>,
    meeting_folder: Option<PathBuf>,
    meeting_name: Option<String>,
    metadata: Option<MeetingMetadata>,
    transcript_segments: Arc<Mutex<Vec<TranscriptSegment>>>,
    /// Shared mirror of `meeting_folder`.
    ///
    /// A [`TranscriptSegmentSink`] handed to the `transcript-update` listener
    /// needs the folder so it can keep writing `transcripts.json` incrementally.
    /// `meeting_folder` itself is assigned later (during accumulation start),
    /// so the listener's handle has to observe it through shared state.
    shared_meeting_folder: Arc<Mutex<Option<PathBuf>>>,
    chunk_receiver: Option<mpsc::UnboundedReceiver<AudioChunk>>,
    is_saving: Arc<Mutex<bool>>,
    /// First checkpoint/encoder failure seen during accumulation. `Arc` so the
    /// background task can set it. Read by the stop path so a recording whose
    /// audio was never encoded cannot be reported as saved.
    checkpoint_failure: Arc<Mutex<Option<String>>>,
}

impl RecordingSaver {
    pub fn new() -> Self {
        Self {
            incremental_saver: None,
            meeting_folder: None,
            meeting_name: None,
            metadata: None,
            transcript_segments: Arc::new(Mutex::new(Vec::new())),
            shared_meeting_folder: Arc::new(Mutex::new(None)),
            chunk_receiver: None,
            is_saving: Arc::new(Mutex::new(false)),
            checkpoint_failure: Arc::new(Mutex::new(None)),
        }
    }

    /// Take the first checkpoint/encoder failure recorded during accumulation,
    /// if any. The stop path uses this to fail a recording honestly instead of
    /// claiming success after a dead encoder.
    pub fn take_checkpoint_failure(&self) -> Option<String> {
        self.checkpoint_failure
            .lock()
            .ok()
            .and_then(|mut v| v.take())
    }

    /// Set the meeting name for this recording session
    pub fn set_meeting_name(&mut self, name: Option<String>) {
        self.meeting_name = name;
    }

    /// Set device information in metadata
    pub fn set_device_info(&mut self, mic_name: Option<String>, sys_name: Option<String>) {
        if let Some(ref mut metadata) = self.metadata {
            metadata.devices.microphone = mic_name;
            metadata.devices.system_audio = sys_name;

            // Write updated metadata to disk if folder exists
            if let Some(folder) = &self.meeting_folder {
                let metadata_clone = metadata.clone();
                if let Err(e) = self.write_metadata(folder, &metadata_clone) {
                    warn!("Failed to update metadata with device info: {}", e);
                }
            }
        }
    }

    /// A cloneable handle used to persist transcript segments from the
    /// `transcript-update` event listener.
    pub fn transcript_sink(&self) -> TranscriptSegmentSink {
        TranscriptSegmentSink {
            segments: self.transcript_segments.clone(),
            meeting_folder: self.shared_meeting_folder.clone(),
        }
    }

    /// Test-only: point the saver at a folder without starting a real recording, so
    /// the incremental `transcripts.json` write can be exercised in isolation.
    #[cfg(test)]
    pub(crate) fn force_meeting_folder_for_tests(&mut self, folder: PathBuf) {
        self.meeting_folder = Some(folder.clone());
        if let Ok(mut shared) = self.shared_meeting_folder.lock() {
            *shared = Some(folder);
        }
    }

    /// Add or update a structured transcript segment (upserts based on sequence_id)
    /// Also saves incrementally to disk
    pub fn add_transcript_segment(&self, segment: TranscriptSegment) {
        upsert_segment(&self.transcript_segments, &segment);

        // NEW: Save incrementally to disk
        if let Some(folder) = &self.meeting_folder {
            if let Err(e) = write_transcripts_json_to(&self.transcript_segments, folder) {
                warn!("Failed to write incremental transcript update: {}", e);
            }
        }
    }

    /// Legacy method for backward compatibility - converts text to basic segment
    pub fn add_transcript_chunk(&self, text: String) {
        let segment = TranscriptSegment {
            id: format!("seg_{}", chrono::Utc::now().timestamp_millis()),
            text,
            audio_start_time: 0.0,
            audio_end_time: 0.0,
            duration: 0.0,
            display_time: "[00:00]".to_string(),
            confidence: 1.0,
            sequence_id: 0,
        };
        self.add_transcript_segment(segment);
    }

    /// Start accumulation with optional incremental saving
    ///
    /// # Arguments
    /// * `auto_save` - If true, creates checkpoints and enables saving. If false, audio chunks are discarded.
    pub fn start_accumulation(&mut self, auto_save: bool) -> mpsc::UnboundedSender<AudioChunk> {
        if auto_save {
            info!("Initializing incremental audio saver for recording (auto-save ENABLED)");
        } else {
            info!(
                "Starting recording without audio saving (auto-save DISABLED - transcripts only)"
            );
        }

        // Create channel for receiving audio chunks
        let (sender, receiver) = mpsc::unbounded_channel::<AudioChunk>();
        self.chunk_receiver = Some(receiver);

        // Initialize meeting folder and incremental saver ONLY if auto_save is enabled
        if auto_save {
            if let Some(name) = self.meeting_name.clone() {
                match self.initialize_meeting_folder(&name, true) {
                    Ok(()) => info!("Successfully initialized meeting folder with checkpoints"),
                    Err(e) => {
                        error!("Failed to initialize meeting folder: {}", e);
                        // Continue anyway - will use fallback flat structure
                    }
                }
            }
        } else {
            // When auto_save is false, still create meeting folder for transcripts/metadata
            // but skip .checkpoints directory
            if let Some(name) = self.meeting_name.clone() {
                match self.initialize_meeting_folder(&name, false) {
                    Ok(()) => info!("Successfully initialized meeting folder (transcripts only)"),
                    Err(e) => {
                        error!("Failed to initialize meeting folder: {}", e);
                    }
                }
            }
        }

        // Start accumulation task
        let is_saving_clone = self.is_saving.clone();
        let incremental_saver_arc = self.incremental_saver.clone();
        let save_audio = auto_save;

        // Shared with the accumulation task so a checkpoint failure survives
        // until the stop path reads it.
        let checkpoint_failure_ref = self.checkpoint_failure.clone();

        if let Some(mut receiver) = self.chunk_receiver.take() {
            tokio::spawn(async move {
                info!(
                    "Recording saver accumulation task started (save_audio: {})",
                    save_audio
                );

                while let Some(chunk) = receiver.recv().await {
                    // Check if we should continue
                    let should_continue = if let Ok(is_saving) = is_saving_clone.lock() {
                        *is_saving
                    } else {
                        false
                    };

                    if !should_continue {
                        break;
                    }

                    // Only process audio chunks if auto_save is enabled
                    if save_audio {
                        // Add chunk to incremental saver
                        if let Some(saver_arc) = &incremental_saver_arc {
                            let mut saver_guard = saver_arc.lock().await;
                            match saver_guard.add_chunk(chunk) {
                                Ok(()) => {}
                                Err(e) => {
                                    // A failed checkpoint (typically: ffmpeg
                                    // missing or unspawnable) used to be logged and
                                    // dropped. `checkpoint_count` then never
                                    // advanced, finalize() reported "no
                                    // checkpoints", and the stop path swallowed
                                    // that too -- so the user was told the meeting
                                    // was saved when no audio existed. Record it so
                                    // the stop path can fail truthfully.
                                    error!("Failed to add chunk to incremental saver: {}", e);
                                    if let Ok(mut slot) = checkpoint_failure_ref.lock() {
                                        // Keep the first failure: it is the root
                                        // cause, and every later chunk will fail
                                        // the same way.
                                        if slot.is_none() {
                                            *slot = Some(e.to_string());
                                        }
                                    }
                                }
                            }
                        } else {
                            error!("Incremental saver not available while accumulating");
                        }
                    } else {
                        // auto_save is false: discard audio chunk (no-op)
                        // Transcription already happened in the pipeline before this point
                    }
                }

                info!("Recording saver accumulation task ended");
            });
        }

        // Set saving flag
        if let Ok(mut is_saving) = self.is_saving.lock() {
            *is_saving = true;
        }

        sender
    }

    /// Initialize meeting folder structure and metadata
    ///
    /// # Arguments
    /// * `meeting_name` - Name of the meeting
    /// * `create_checkpoints` - Whether to create .checkpoints/ directory and IncrementalAudioSaver
    fn initialize_meeting_folder(
        &mut self,
        meeting_name: &str,
        create_checkpoints: bool,
    ) -> Result<()> {
        // Load preferences to get base recordings folder
        let base_folder = super::recording_preferences::get_default_recordings_folder();

        // Create meeting folder structure (with or without .checkpoints/ subdirectory)
        let meeting_folder = create_meeting_folder(&base_folder, meeting_name, create_checkpoints)?;

        // Only initialize incremental saver if checkpoints are needed (auto_save is true)
        if create_checkpoints {
            let incremental_saver = IncrementalAudioSaver::new(meeting_folder.clone(), 48000)?;
            self.incremental_saver = Some(Arc::new(AsyncMutex::new(incremental_saver)));
            info!(
                "✅ Incremental audio saver initialized for meeting: {}",
                meeting_name
            );
        } else {
            info!("⚠️  Skipped incremental audio saver (auto-save disabled)");
        }

        // Create initial metadata
        let metadata = MeetingMetadata {
            version: "1.0".to_string(),
            meeting_id: None, // Will be set by backend
            meeting_name: Some(meeting_name.to_string()),
            created_at: chrono::Utc::now().to_rfc3339(),
            completed_at: None,
            duration_seconds: None,
            devices: DeviceInfo {
                microphone: None, // Could be enhanced to store actual device names
                system_audio: None,
            },
            audio_file: if create_checkpoints {
                "audio.mp4".to_string()
            } else {
                "".to_string()
            },
            transcript_file: "transcripts.json".to_string(),
            sample_rate: 48000,
            status: "recording".to_string(),
        };

        // Write initial metadata.json
        self.write_metadata(&meeting_folder, &metadata)?;

        self.meeting_folder = Some(meeting_folder);
        // Keep the listener's sink in step with the saver.
        if let Ok(mut shared) = self.shared_meeting_folder.lock() {
            *shared = self.meeting_folder.clone();
        }
        self.metadata = Some(metadata);

        Ok(())
    }

    /// Write metadata.json to disk (atomic write with temp file)
    fn write_metadata(&self, folder: &PathBuf, metadata: &MeetingMetadata) -> Result<()> {
        let metadata_path = folder.join("metadata.json");
        let temp_path = folder.join(".metadata.json.tmp");

        let json_string = serde_json::to_string_pretty(metadata)?;
        std::fs::write(&temp_path, json_string)?;
        std::fs::rename(&temp_path, &metadata_path)?; // Atomic

        Ok(())
    }

    /// Write transcripts.json to disk (atomic write with temp file and validation)
    fn write_transcripts_json(&self, folder: &PathBuf) -> Result<()> {
        write_transcripts_json_to(&self.transcript_segments, folder)
    }
}

/// Per-folder write lock for `transcripts.json`.
///
/// Returns a guard that must be held for the duration of a write. Keyed by the
/// canonical folder path so two meetings never contend with each other.
fn transcript_write_lock_for(folder: &std::path::Path) -> std::sync::MutexGuard<'static, ()> {
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};

    static LOCKS: OnceLock<Mutex<HashMap<std::path::PathBuf, &'static Mutex<()>>>> =
        OnceLock::new();

    let locks = LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut map = locks.lock().unwrap_or_else(|e| e.into_inner());

    let entry = map
        .entry(folder.to_path_buf())
        .or_insert_with(|| Box::leak(Box::new(Mutex::new(()))));

    entry.lock().unwrap_or_else(|e| e.into_inner())
}

/// Write `transcripts.json` for a segment buffer (atomic write with temp file
/// and validation).
///
/// Shared by [`RecordingSaver`] and [`TranscriptSegmentSink`] so both paths
/// produce byte-identical output.
fn write_transcripts_json_to(
    segments_ref: &Arc<Mutex<Vec<TranscriptSegment>>>,
    folder: &std::path::Path,
) -> Result<()> {
    // Clone segments to avoid holding lock during I/O
    let segments_clone = if let Ok(segments) = segments_ref.lock() {
        segments.clone()
    } else {
        error!("Failed to lock transcript segments for writing");
        return Err(anyhow::anyhow!("Failed to lock transcript segments"));
    };

    info!(
        "Writing {} transcript segments to JSON",
        segments_clone.len()
    );

    // Serialise writers for this folder.
    //
    // `RecordingSaver::add_transcript_segment` and `TranscriptSegmentSink::add`
    // both call this on the SAME folder, and a full-file rewrite fires on every
    // single transcript-update event. Without a lock, two interleaved writers
    // sharing one temp file could publish each other's half-written bytes and
    // then fail the second rename -- corrupting the transcript while reporting
    // success. The lock is per-folder, so different meetings never contend.
    let _writer_guard = transcript_write_lock_for(folder);

    // Temp name includes the pid, so a crashed or concurrent writer cannot
    // collide with ours.
    let transcript_path = folder.join("transcripts.json");
    let temp_path = folder.join(format!(".transcripts.json.{}.tmp", std::process::id()));

    // Create JSON structure
    let json = serde_json::json!({
        "version": "1.0",
        "segments": segments_clone,
        "last_updated": chrono::Utc::now().to_rfc3339(),
        "total_segments": segments_clone.len()
    });

    // Serialize to pretty JSON string
    let json_string = serde_json::to_string_pretty(&json).map_err(|e| {
        error!("Failed to serialize transcripts to JSON: {}", e);
        anyhow::anyhow!("JSON serialization failed: {}", e)
    })?;

    // Write to temp file with error handling.
    //
    // Both failure paths remove the temp file. A leftover `.transcripts.json.*.tmp`
    // in a meeting folder is junk the user never asked for, and repeated failures
    // (disk full, an AV holding a handle) would otherwise accumulate them.
    if let Err(e) = std::fs::write(&temp_path, &json_string) {
        error!(
            "Failed to write transcript temp file to {}: {}",
            temp_path.display(),
            e
        );
        let _ = std::fs::remove_file(&temp_path);
        return Err(anyhow::anyhow!("Failed to write temp file: {}", e));
    }

    // Verify temp file was written correctly
    if !temp_path.exists() {
        error!(
            "Temp transcript file does not exist after write: {}",
            temp_path.display()
        );
        return Err(anyhow::anyhow!("Temp file verification failed"));
    }

    // Atomic rename
    if let Err(e) = std::fs::rename(&temp_path, &transcript_path) {
        error!(
            "Failed to rename transcript file from {} to {}: {}",
            temp_path.display(),
            transcript_path.display(),
            e
        );
        let _ = std::fs::remove_file(&temp_path);
        return Err(anyhow::anyhow!("Failed to rename transcript file: {}", e));
    }

    info!(
        "✅ Successfully wrote transcripts.json with {} segments",
        segments_clone.len()
    );
    Ok(())
}

/// Upsert a segment by `sequence_id` into a shared buffer.
///
/// Shared by [`RecordingSaver`] and [`TranscriptSegmentSink`] so both paths
/// keep identical update semantics.
fn upsert_segment(segments_ref: &Arc<Mutex<Vec<TranscriptSegment>>>, segment: &TranscriptSegment) {
    if let Ok(mut segments) = segments_ref.lock() {
        // Check if segment with same sequence_id exists (update it)
        if let Some(existing) = segments
            .iter_mut()
            .find(|s| s.sequence_id == segment.sequence_id)
        {
            *existing = segment.clone();
            info!(
                "Updated transcript segment {} (seq: {}) - total segments: {}",
                segment.id,
                segment.sequence_id,
                segments.len()
            );
        } else {
            // New segment, add it
            segments.push(segment.clone());
            info!(
                "Added new transcript segment {} (seq: {}) - total segments: {}",
                segment.id,
                segment.sequence_id,
                segments.len()
            );
        }
    } else {
        error!(
            "Failed to lock transcript segments for adding segment {}",
            segment.id
        );
    }
}

/// A cloneable handle for persisting transcript segments.
///
/// # Why this exists
///
/// Transcript segments reach storage through the `transcript-update` event
/// listener. That listener used to look the recording up in the global
/// `RECORDING_MANAGER` registry. The stop path **takes** the manager out of
/// that registry before it waits for transcription to drain, so the listener
/// went dead at precisely the moment the remaining chunks were being
/// transcribed — and the tail of the meeting's transcript was silently
/// discarded, while the UI still reported success.
///
/// Holding the sink directly keeps persistence alive for the whole drain,
/// independently of whatever the stop path does with the registry.
#[derive(Clone)]
pub struct TranscriptSegmentSink {
    segments: Arc<Mutex<Vec<TranscriptSegment>>>,
    meeting_folder: Arc<Mutex<Option<PathBuf>>>,
}

impl TranscriptSegmentSink {
    /// Number of segments currently buffered.
    pub fn segment_count(&self) -> usize {
        self.segments.lock().map(|s| s.len()).unwrap_or(0)
    }

    /// Snapshot of the buffered segments, for inspection and tests.
    pub fn segments(&self) -> Vec<TranscriptSegment> {
        self.segments.lock().map(|s| s.clone()).unwrap_or_default()
    }

    /// Add or update a segment and flush `transcripts.json` when a meeting
    /// folder is already known.
    pub fn add(&self, segment: TranscriptSegment) {
        upsert_segment(&self.segments, &segment);

        let folder = self.meeting_folder.lock().ok().and_then(|f| f.clone());
        if let Some(folder) = folder {
            if let Err(e) = write_transcripts_json_to(&self.segments, &folder) {
                warn!("Failed to write incremental transcript update: {}", e);
            }
        }
    }
}

impl RecordingSaver {
    pub fn get_stats(&self) -> (usize, u32) {
        if let Some(ref saver) = self.incremental_saver {
            if let Ok(guard) = saver.try_lock() {
                (guard.get_checkpoint_count() as usize, 48000)
            } else {
                (0, 48000)
            }
        } else {
            (0, 48000)
        }
    }

    /// Stop and save using incremental saving approach
    ///
    /// # Arguments
    /// * `app` - Tauri app handle for emitting events
    /// * `recording_duration` - Actual recording duration in seconds (from RecordingState)
    pub async fn stop_and_save<R: Runtime>(
        &mut self,
        app: &AppHandle<R>,
        recording_duration: Option<f64>,
    ) -> Result<Option<String>, String> {
        info!("Stopping recording saver");

        // Stop accumulation
        if let Ok(mut is_saving) = self.is_saving.lock() {
            *is_saving = false;
        }

        // Give time for final chunks
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

        // Check if incremental saver exists (indicates auto_save was enabled)
        let should_save_audio = self.incremental_saver.is_some();

        if !should_save_audio {
            info!("⚠️  No audio saver initialized (auto-save was disabled) - skipping audio finalization");
            info!("✅ Transcripts and metadata already saved incrementally");
            return Ok(None);
        }

        // Finalize incremental saver (merge checkpoints into final audio.mp4)
        let final_audio_path = if let Some(saver_arc) = &self.incremental_saver {
            let mut saver = saver_arc.lock().await;
            match saver.finalize().await {
                Ok(path) => {
                    info!("✅ Successfully finalized audio: {}", path.display());
                    path
                }
                Err(e) => {
                    error!("❌ Failed to finalize incremental saver: {}", e);
                    return Err(format!("Failed to finalize audio: {}", e));
                }
            }
        } else {
            error!("No incremental saver initialized - cannot save recording");
            return Err("No incremental saver initialized".to_string());
        };

        // Save final transcripts.json with validation
        if let Some(folder) = &self.meeting_folder {
            if let Err(e) = self.write_transcripts_json(folder) {
                error!("❌ Failed to write final transcripts: {}", e);
                return Err(format!("Failed to save transcripts: {}", e));
            }

            // Verify transcripts were written correctly
            let transcript_path = folder.join("transcripts.json");
            if !transcript_path.exists() {
                error!(
                    "❌ Transcript file was not created at: {}",
                    transcript_path.display()
                );
                return Err("Transcript file verification failed".to_string());
            }
            info!(
                "✅ Transcripts saved and verified at: {}",
                transcript_path.display()
            );
        }

        // Update metadata to completed status with actual recording duration
        if let (Some(folder), Some(mut metadata)) = (&self.meeting_folder, self.metadata.clone()) {
            metadata.status = "completed".to_string();
            metadata.completed_at = Some(chrono::Utc::now().to_rfc3339());

            // Use actual recording duration from RecordingState (more accurate than transcript segments)
            // Falls back to last transcript segment if duration not provided
            metadata.duration_seconds = recording_duration.or_else(|| {
                if let Ok(segments) = self.transcript_segments.lock() {
                    segments.last().map(|seg| seg.audio_end_time)
                } else {
                    None
                }
            });

            if let Err(e) = self.write_metadata(folder, &metadata) {
                error!("❌ Failed to update metadata to completed: {}", e);
                return Err(format!("Failed to update metadata: {}", e));
            }

            info!(
                "✅ Metadata updated with duration: {:?}s",
                metadata.duration_seconds
            );
        }

        // Emit save event with audio and transcript paths
        let save_event = serde_json::json!({
            "audio_file": final_audio_path.to_string_lossy(),
            "transcript_file": self.meeting_folder.as_ref()
                .map(|f| f.join("transcripts.json").to_string_lossy().to_string()),
            "meeting_name": self.meeting_name,
            "meeting_folder": self.meeting_folder.as_ref()
                .map(|f| f.to_string_lossy().to_string())
        });

        if let Err(e) = app.emit("recording-saved", &save_event) {
            warn!("Failed to emit recording-saved event: {}", e);
        }

        // Clean up transcript segments
        if let Ok(mut segments) = self.transcript_segments.lock() {
            segments.clear();
        }

        Ok(Some(final_audio_path.to_string_lossy().to_string()))
    }

    /// Get the meeting folder path (for passing to backend)
    pub fn get_meeting_folder(&self) -> Option<&PathBuf> {
        self.meeting_folder.as_ref()
    }

    /// Get accumulated transcript segments (for reload sync)
    pub fn get_transcript_segments(&self) -> Vec<TranscriptSegment> {
        if let Ok(segments) = self.transcript_segments.lock() {
            segments.clone()
        } else {
            Vec::new()
        }
    }

    /// Get meeting name (for reload sync)
    pub fn get_meeting_name(&self) -> Option<String> {
        self.meeting_name.clone()
    }
}

impl Default for RecordingSaver {
    fn default() -> Self {
        Self::new()
    }
}
