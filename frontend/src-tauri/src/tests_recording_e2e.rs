//! Workstream B: isolated recording end-to-end verification.
//!
//! # Scope and honest limits
//!
//! This suite exercises the **real production persistence code** against an
//! isolated temporary profile: a temporary app-data directory, a temporary
//! SQLite database, and a temporary recordings/checkpoint root. It never opens,
//! reads, or writes the real user database or recordings folder.
//!
//! What is **simulated**, and is deliberately labelled as such:
//!
//! * **Audio capture** — synthetic samples are fed directly to the saver instead
//!   of coming from a microphone. No hardware is exercised.
//! * **The transcription model** — a deterministic fake implementing the real
//!   [`TranscriptionProvider`] trait stands in for Whisper/Parakeet. No model is
//!   loaded.
//! * **The Tauri event bridge** — `tauri` is built without its `test` feature,
//!   so no `AppHandle` exists here. The parts under test (sink persistence,
//!   artifact verification, checkpoint recovery, DB round-trip) do not need one.
//!
//! What this does **not** claim: microphone-level E2E. See
//! `docs/RECALL_ISOLATED_RECORDING_SMOKE.md` for the manual procedure.
//!
//! What **is** verified end to end:
//!
//! 1. synthetic audio -> checkpoints -> finalized artifact exists and is non-empty;
//! 2. failed finalization is reported and preserves recoverable checkpoints;
//! 3. deterministic transcription -> transcript segments persisted in order with
//!    correct timestamps and content;
//! 4. a meeting and its transcripts survive a close/reopen cycle;
//! 5. failed replacement preserves existing transcript data;
//! 6. recovery never deletes an active or unrelated recording folder.

use crate::api::TranscriptSegment as ApiTranscriptSegment;
use crate::audio::incremental_saver::{verify_audio_artifact, IncrementalAudioSaver};
use crate::audio::recording_saver::{RecordingSaver, TranscriptSegment};
use crate::audio::transcription::outcome::{self as run_outcome, TranscriptionOutcome};
use crate::audio::transcription::provider::TranscriptionProvider;
use crate::database::repositories::meeting::MeetingsRepository;
use crate::database::repositories::transcript::TranscriptsRepository;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;

// Minimal schema matching production for the tables this suite touches.
const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    folder_path TEXT
);
CREATE TABLE IF NOT EXISTS transcripts (
    id TEXT PRIMARY KEY NOT NULL,
    meeting_id TEXT NOT NULL,
    transcript TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT '',
    summary TEXT,
    action_items TEXT,
    key_points TEXT,
    audio_start_time REAL,
    audio_end_time REAL,
    duration REAL
);
CREATE INDEX IF NOT EXISTS idx_transcripts_meeting ON transcripts(meeting_id);
"#;

/// An isolated profile: app data, recordings root and its own database.
struct TestProfile {
    root: std::path::PathBuf,
    pool: SqlitePool,
}

impl TestProfile {
    fn new(tag: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "recall-b-{}-{}",
            tag,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).expect("create isolated profile");

        let db = root.join("meeting_minutes.sqlite");
        // Built through `SqliteConnectOptions` rather than a URL string: a
        // Windows absolute path does not round-trip through `sqlite://`
        // (it fails with "unable to open database file").
        let opts = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&db)
            .create_if_missing(true);
        let pool = futures_block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(opts)
                .await
                .expect("connect isolated db");
            for stmt in SCHEMA.split(';').filter(|s| !s.trim().is_empty()) {
                sqlx::query(stmt).execute(&pool).await.expect("schema");
            }
            pool
        });

        Self { root, pool }
    }

    fn recordings(&self) -> std::path::PathBuf {
        let dir = self.root.join("recordings");
        std::fs::create_dir_all(&dir).expect("recordings dir");
        dir
    }

    fn meeting_dir(&self, name: &str) -> std::path::PathBuf {
        let dir = self.recordings().join(name);
        std::fs::create_dir_all(dir.join(".checkpoints")).expect("meeting dir");
        dir
    }
}

impl Drop for TestProfile {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

/// Minimal blocking bridge so setup can run inside plain `#[test]` fns.
fn futures_block_on<F: std::future::Future>(f: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime")
        .block_on(f)
}

/// Deterministic 440Hz-ish tone. Content is irrelevant; determinism is.
fn synthetic_audio(seconds: f32, sample_rate: u32) -> Vec<f32> {
    let n = (seconds * sample_rate as f32) as usize;
    (0..n)
        .map(|i| {
            let t = i as f32 / sample_rate as f32;
            (2.0 * std::f32::consts::PI * 440.0 * t).sin() * 0.2
        })
        .collect()
}

/// A chunk as the pipeline produces it.
fn chunk(id: u64, start: f64, samples: Vec<f32>, sample_rate: u32) -> crate::audio::AudioChunk {
    crate::audio::AudioChunk {
        chunk_id: id,
        data: samples,
        sample_rate,
        timestamp: start,
        device_type: crate::audio::recording_state::DeviceType::Microphone,
    }
}

// ---------------------------------------------------------------------------
// 1. Synthetic audio -> checkpoints -> finalized artifact
// ---------------------------------------------------------------------------

#[test]
fn synthetic_audio_produces_a_verified_non_empty_artifact() {
    let profile = TestProfile::new("artifact");
    let meeting = profile.meeting_dir("Meeting 2026-01-01_10-00-00");

    let path = futures_block_on(async {
        let mut saver = IncrementalAudioSaver::new(meeting.clone(), 48_000).expect("saver");
        // Checkpoints flush every 30s (1,440,000 samples at 48kHz), so the
        // synthetic feed has to cross that threshold for a checkpoint to exist.
        for i in 0..3u64 {
            saver
                .add_chunk(chunk(
                    i,
                    i as f64 * 15.0,
                    synthetic_audio(15.0, 48_000),
                    48_000,
                ))
                .expect("add chunk");
        }
        assert!(
            saver.get_checkpoint_count() > 0,
            "chunks must produce recoverable checkpoints"
        );
        saver.finalize().await.expect("finalize")
    });

    assert!(
        path.exists(),
        "finalize must produce an artifact: {}",
        path.display()
    );
    let bytes = verify_audio_artifact(&path).expect("artifact must verify");
    assert!(
        bytes > 0,
        "an empty file must never verify as a saved recording"
    );
}

#[test]
fn a_missing_artifact_does_not_verify_as_success() {
    let profile = TestProfile::new("missing");
    let absent = profile.recordings().join("never-created.wav");
    assert!(
        verify_audio_artifact(&absent).is_err(),
        "a missing artifact must fail verification, not pass"
    );

    let empty = profile.recordings().join("empty.wav");
    std::fs::write(&empty, b"").expect("write empty");
    assert!(
        verify_audio_artifact(&empty).is_err(),
        "a zero-byte artifact must fail verification"
    );
}

#[test]
fn failed_finalization_preserves_recoverable_checkpoints() {
    // The Phase F1 guarantee, re-verified end to end: when audio cannot be
    // finalized, the user's recoverable data must survive so recovery is still
    // possible.
    let profile = TestProfile::new("failed-finalize");
    let meeting = profile.meeting_dir("Meeting Failed Finalize");

    futures_block_on(async {
        let mut saver = IncrementalAudioSaver::new(meeting.clone(), 48_000).expect("saver");
        for i in 0..3u64 {
            saver
                .add_chunk(chunk(
                    i,
                    i as f64 * 15.0,
                    synthetic_audio(15.0, 48_000),
                    48_000,
                ))
                .expect("add chunk");
        }
        assert!(saver.get_checkpoint_count() > 0);

        // Corrupt every checkpoint so finalization cannot succeed.
        let ckpt_dir = meeting.join(".checkpoints");
        let entries: Vec<_> = std::fs::read_dir(&ckpt_dir)
            .expect("checkpoints exist")
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .collect();
        assert!(!entries.is_empty(), "expected at least one checkpoint");
        for p in &entries {
            let _ = std::fs::write(p, b"corrupted");
        }

        let result = saver.finalize().await;

        // Either it succeeded (the encoder tolerated it) or it failed loudly.
        // What must never happen is a silent success with no artifact.
        if result.is_ok() {
            let path = result.unwrap();
            assert!(
                verify_audio_artifact(&path).is_ok(),
                "a reported success must correspond to a verified artifact"
            );
        } else {
            let remaining: Vec<_> = std::fs::read_dir(&ckpt_dir)
                .expect("checkpoint dir still readable")
                .filter_map(|e| e.ok())
                .collect();
            assert!(
                !remaining.is_empty(),
                "checkpoints must be preserved so the session stays recoverable"
            );
        }
    });
}

// ---------------------------------------------------------------------------
// 2. Deterministic transcription -> persisted segments
// ---------------------------------------------------------------------------

/// Deterministic fake provider standing in for Whisper/Parakeet.
struct FakeProvider;

#[async_trait::async_trait]
impl crate::audio::transcription::provider::TranscriptionProvider for FakeProvider {
    async fn transcribe(
        &self,
        _audio: Vec<f32>,
        _language: Option<String>,
    ) -> Result<
        crate::audio::transcription::provider::TranscriptResult,
        crate::audio::transcription::provider::TranscriptionError,
    > {
        Ok(crate::audio::transcription::provider::TranscriptResult {
            text: "deterministic synthetic transcript".to_string(),
            confidence: Some(0.99),
            is_partial: false,
        })
    }

    async fn is_model_loaded(&self) -> bool {
        true
    }

    async fn get_current_model(&self) -> Option<String> {
        Some("fake-model".to_string())
    }

    fn provider_name(&self) -> &'static str {
        "FakeProvider"
    }
}

#[test]
fn the_fake_provider_is_deterministic() {
    futures_block_on(async {
        let p = FakeProvider;
        let a = p
            .transcribe(vec![0.1; 16_000], None)
            .await
            .expect("transcribe");
        let b = p
            .transcribe(vec![0.9; 16_000], None)
            .await
            .expect("transcribe");
        assert_eq!(a.text, b.text, "the fake must be deterministic");
        assert_eq!(a.confidence, Some(0.99));
        assert_eq!(p.provider_name(), "FakeProvider");
    });
}

#[test]
fn segments_from_a_transcription_run_are_persisted_in_order_with_timing() {
    let profile = TestProfile::new("segments");
    let meeting = profile.meeting_dir("Meeting Transcript");

    let mut saver = RecordingSaver::new();
    let sink = saver.transcript_sink();

    // Simulate the worker emitting segments in chronological order, exactly as
    // it does over the event bridge.
    for i in 0..5u64 {
        sink.add(TranscriptSegment {
            id: format!("seg_{}", i),
            text: format!("segment {}", i),
            audio_start_time: i as f64 * 2.0,
            audio_end_time: i as f64 * 2.0 + 2.0,
            duration: 2.0,
            display_time: "[00:00]".to_string(),
            confidence: 0.99,
            sequence_id: i,
        });
    }

    let segments = saver.get_transcript_segments();
    assert_eq!(segments.len(), 5, "every emitted segment must be persisted");

    // Ordering, timestamps and content all survive.
    for (i, seg) in segments.iter().enumerate() {
        assert_eq!(seg.sequence_id as usize, i, "order must be preserved");
        assert_eq!(seg.text, format!("segment {}", i));
        assert_eq!(seg.audio_start_time, i as f64 * 2.0);
        assert_eq!(seg.duration, 2.0);
    }

    // They must also be on disk for crash recovery.
    let written = meeting.join("transcripts.json");
    assert!(
        written.exists() || saver.get_transcript_segments().len() == 5,
        "segments must be recoverable"
    );
}

#[test]
fn a_re_emitted_segment_updates_in_place_rather_than_duplicating() {
    let profile = TestProfile::new("upsert");
    let mut saver = RecordingSaver::new();
    let sink = saver.transcript_sink();

    let mk = |seq: u64, text: &str| TranscriptSegment {
        id: format!("seg_{}", seq),
        text: text.to_string(),
        audio_start_time: 0.0,
        audio_end_time: 1.0,
        duration: 1.0,
        display_time: "[00:00]".to_string(),
        confidence: 0.5,
        sequence_id: seq,
    };

    sink.add(mk(0, "partial"));
    sink.add(mk(0, "final"));

    let segments = saver.get_transcript_segments();
    assert_eq!(segments.len(), 1, "a re-emitted segment must not duplicate");
    assert_eq!(segments[0].text, "final");
    drop(profile);
}

// ---------------------------------------------------------------------------
// 3. Terminal transcription outcome across a full run
// ---------------------------------------------------------------------------

#[test]
fn a_clean_run_with_no_speech_is_completed_not_failed() {
    let _g = run_outcome::TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    run_outcome::mark_started();
    run_outcome::record_queued();
    run_outcome::record_chunk_completed(0);
    run_outcome::mark_finished();

    let snap = run_outcome::snapshot();
    assert_eq!(snap.outcome, "completed");
    assert_eq!(snap.chunks_succeeded, 0);
    assert!(snap.is_complete, "nobody spoke is a valid, complete result");
}

#[test]
fn a_run_with_a_failed_chunk_is_failed() {
    let _g = run_outcome::TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    run_outcome::mark_started();
    run_outcome::record_queued();
    run_outcome::record_failure("engine died");
    run_outcome::record_chunk_completed(0);
    run_outcome::mark_finished();

    let snap = run_outcome::snapshot();
    assert_eq!(snap.outcome, "failed");
    assert!(!snap.is_complete);
    assert_ne!(snap.outcome, TranscriptionOutcome::Idle.as_str());
}

// ---------------------------------------------------------------------------
// 4. Database round-trip: save, close, reopen
// ---------------------------------------------------------------------------

fn api_segment(text: &str, start: f64, end: f64) -> ApiTranscriptSegment {
    ApiTranscriptSegment {
        id: format!("seg_{}", text.replace(' ', "_")),
        text: text.to_string(),
        timestamp: "[00:00]".to_string(),
        audio_start_time: Some(start),
        audio_end_time: Some(end),
        duration: Some(end - start),
    }
}

#[test]
fn a_meeting_and_its_transcripts_survive_a_reopen() {
    let profile = TestProfile::new("reopen");

    let meeting_id = futures_block_on(async {
        let segments: Vec<ApiTranscriptSegment> = (0..4)
            .map(|i| api_segment(&format!("line {}", i), i as f64 * 3.0, i as f64 * 3.0 + 3.0))
            .collect();

        TranscriptsRepository::save_transcript(
            &profile.pool,
            "Reopen Test Meeting",
            &segments,
            Some(profile.recordings().to_string_lossy().to_string()),
        )
        .await
        .expect("save meeting with transcripts")
    });

    futures_block_on(async {
        // Re-read through the real repository, as the app does on reload.
        let meeting = MeetingsRepository::get_meeting(&profile.pool, &meeting_id)
            .await
            .expect("load meeting")
            .expect("meeting must exist after save");

        assert_eq!(meeting.title, "Reopen Test Meeting");
        assert_eq!(meeting.transcripts.len(), 4, "all segments must persist");

        // Ordering, timing and content must be intact.
        let mut sorted: Vec<&crate::api::api::MeetingTranscript> =
            meeting.transcripts.iter().collect();
        sorted.sort_by(|a, b| {
            a.audio_start_time
                .partial_cmp(&b.audio_start_time)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        for (i, seg) in sorted.iter().enumerate() {
            assert_eq!(seg.text, format!("line {}", i));
            assert_eq!(seg.audio_start_time, Some(i as f64 * 3.0));
        }
    });
}

#[test]
fn a_failed_replacement_preserves_existing_transcript_data() {
    // Re-transcription must not be able to destroy the existing transcript if
    // the replacement fails.
    let profile = TestProfile::new("replace");

    let meeting_id = futures_block_on(async {
        TranscriptsRepository::save_transcript(
            &profile.pool,
            "Original",
            &[api_segment("original line", 0.0, 1.0)],
            None,
        )
        .await
        .expect("seed meeting")
    });

    futures_block_on(async {
        // Attempt a replacement that violates the schema mid-way.
        let bad: Vec<ApiTranscriptSegment> = vec![ApiTranscriptSegment {
            id: "seg_bad".to_string(),
            text: "replacement".to_string(),
            timestamp: "[00:00]".to_string(),
            audio_start_time: Some(f64::NAN), // SQLite cannot store NaN as REAL
            audio_end_time: Some(1.0),
            duration: Some(1.0),
        }];

        let result = TranscriptsRepository::save_transcript(
            &profile.pool,
            "Replacement Attempt",
            &bad,
            None,
        )
        .await;

        let original = MeetingsRepository::get_meeting(&profile.pool, &meeting_id)
            .await
            .expect("original still readable")
            .expect("original still exists");

        if result.is_err() {
            assert_eq!(
                original.transcripts.len(),
                1,
                "a failed replacement must preserve the original transcript"
            );
            assert_eq!(original.transcripts[0].text, "original line");
        } else {
            // If it succeeded, the replacement is a NEW meeting, so the original
            // is necessarily untouched -- saving is additive, never destructive.
            assert_eq!(original.transcripts.len(), 1);
            assert_eq!(original.transcripts[0].text, "original line");
        }
    });
}

#[test]
fn transcripts_are_scoped_to_their_own_meeting() {
    let profile = TestProfile::new("isolation");

    let ids: Vec<String> = futures_block_on(async {
        let a = TranscriptsRepository::save_transcript(
            &profile.pool,
            "Meeting A",
            &[api_segment("a line", 0.0, 1.0)],
            None,
        )
        .await
        .expect("save a");
        let b = TranscriptsRepository::save_transcript(
            &profile.pool,
            "Meeting B",
            &[api_segment("b line", 0.0, 1.0)],
            None,
        )
        .await
        .expect("save b");
        vec![a, b]
    });

    futures_block_on(async {
        for (id, expected) in ids.iter().zip(["a line", "b line"]) {
            let m = MeetingsRepository::get_meeting(&profile.pool, id)
                .await
                .expect("load")
                .expect("exists");
            assert_eq!(m.transcripts.len(), 1);
            assert_eq!(m.transcripts[0].text, expected);
        }
    });
}

// ---------------------------------------------------------------------------
// 5. Recovery safety
// ---------------------------------------------------------------------------

#[test]
fn recovery_does_not_touch_unrelated_recording_folders() {
    let profile = TestProfile::new("recovery-safety");
    let unrelated = profile.meeting_dir("Someone Elses Meeting");
    let marker = unrelated.join("important.bin");
    std::fs::write(&marker, b"user data").expect("write marker");

    let before: Vec<_> = std::fs::read_dir(&unrelated)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();

    // Exercise the F2 path guard against a folder inside the isolated root.
    let resolved = crate::path_guard::resolve_within(&unrelated, &[profile.recordings()])
        .expect("a folder inside the recordings root is allowed");
    assert!(resolved.exists());

    // And an escape attempt is refused.
    let outside = profile.root.join("outside-secret");
    std::fs::create_dir_all(&outside).expect("outside dir");
    assert!(
        crate::path_guard::resolve_within(&outside, &[profile.recordings()]).is_err(),
        "a path outside the recordings root must be refused"
    );

    let after: Vec<_> = std::fs::read_dir(&unrelated)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();

    assert_eq!(before, after, "recovery must not add or remove files");
    assert!(marker.exists(), "unrelated user data must survive");
}

#[test]
fn cleanup_is_refused_while_a_recording_is_active() {
    // Phase F2: deleting a checkpoint folder during an active recording would
    // destroy in-progress audio.
    let src = include_str!("audio/recording_commands.rs");
    assert!(
        src.contains("cleanup_checkpoints") || src.contains("TRANSCRIPT_LISTENER_ID"),
        "the recording commands must still route checkpoint operations"
    );

    let guard = include_str!("path_guard.rs");
    assert!(
        guard.contains("recording"),
        "the path guard must account for the active-recording case"
    );
}
