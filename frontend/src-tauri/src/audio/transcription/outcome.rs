//! Terminal outcome of a transcription run.
//!
//! Phase E found that an engine failure was logged, the chunk was then counted
//! as *complete* anyway, and nothing anywhere recorded that it had failed. The
//! stop path consequently created a meeting with zero transcript segments and
//! told the user "Recording saved successfully!". Silence and failure were
//! indistinguishable.
//!
//! This module is the single place that knows which of the four outcomes
//! occurred, so the stop path, the status command and the UI all read one truth
//! instead of re-deriving "did we get any text?" and getting it wrong.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

/// How a transcription run ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TranscriptionOutcome {
    /// No transcription has been started in this session.
    Idle,
    /// Transcription is still running.
    Running,
    /// The engine ran to completion. `segments > 0` means text was produced;
    /// `segments == 0` is a *valid* result meaning no speech was detected.
    Completed,
    /// The engine failed, or was interrupted before finishing. Any segments that
    /// did complete are partial and must not be presented as the whole meeting.
    Failed,
}

impl TranscriptionOutcome {
    pub fn as_str(&self) -> &'static str {
        match self {
            TranscriptionOutcome::Idle => "idle",
            TranscriptionOutcome::Running => "running",
            TranscriptionOutcome::Completed => "completed",
            TranscriptionOutcome::Failed => "failed",
        }
    }
}

static CHUNKS_QUEUED: AtomicU64 = AtomicU64::new(0);
static CHUNKS_SUCCEEDED: AtomicU64 = AtomicU64::new(0);
static CHUNKS_FAILED: AtomicU64 = AtomicU64::new(0);
static RUNNING: AtomicBool = AtomicBool::new(false);
/// Whether a transcription run was ever started in this session. Needed to tell
/// "nobody spoke" (started, finished, zero chunks -> Completed) apart from
/// "transcription was never attempted" (Idle). Collapsing those two would make a
/// status poll before any recording indistinguishable from a silent meeting.
static STARTED: AtomicBool = AtomicBool::new(false);
static LAST_ERROR: Mutex<Option<String>> = Mutex::new(None);

/// Serialises every test that mutates the counters above. These are process-wide
/// statics by design (one recording per app), so tests must not interleave.
/// Exposed for the crate's other test modules that assert on the same state.
#[cfg(test)]
pub(crate) static TEST_LOCK: Mutex<()> = Mutex::new(());

/// Clear all counters. Called at the start of every recording.
pub fn reset() {
    CHUNKS_QUEUED.store(0, Ordering::SeqCst);
    CHUNKS_SUCCEEDED.store(0, Ordering::SeqCst);
    CHUNKS_FAILED.store(0, Ordering::SeqCst);
    RUNNING.store(false, Ordering::SeqCst);
    STARTED.store(false, Ordering::SeqCst);
    if let Ok(mut e) = LAST_ERROR.lock() {
        *e = None;
    }
}

pub fn mark_started() {
    reset();
    STARTED.store(true, Ordering::SeqCst);
    RUNNING.store(true, Ordering::SeqCst);
}

pub fn record_queued() {
    CHUNKS_QUEUED.fetch_add(1, Ordering::SeqCst);
}

/// A chunk produced validated text.
pub fn record_success() {
    CHUNKS_SUCCEEDED.fetch_add(1, Ordering::SeqCst);
}

/// A chunk failed. This is the counter that was previously missing entirely:
/// failures used to be logged and then counted as successes.
pub fn record_failure(message: impl Into<String>) {
    CHUNKS_FAILED.fetch_add(1, Ordering::SeqCst);
    let message = message.into();
    if let Ok(mut e) = LAST_ERROR.lock() {
        // Keep the first failure: it is the most likely root cause, and a long
        // meeting can produce dozens of identical downstream errors.
        if e.is_none() {
            *e = Some(message);
        }
    }
}

pub fn mark_finished() {
    RUNNING.store(false, Ordering::SeqCst);
}

pub fn is_running() -> bool {
    RUNNING.load(Ordering::SeqCst)
}

/// The decisive question: did this session end in failure?
///
/// A run with zero succeeded chunks AND at least one failed chunk is a failure,
/// never "the meeting was silent". A run with zero of both is a legitimate empty
/// result. A run that is still running is neither.
pub fn outcome() -> TranscriptionOutcome {
    if is_running() {
        return TranscriptionOutcome::Running;
    }
    if CHUNKS_FAILED.load(Ordering::SeqCst) > 0 {
        return TranscriptionOutcome::Failed;
    }
    // A run that started and finished without producing a chunk is a legitimate
    // empty transcript (nobody spoke). Only a session that never started a run
    // at all is Idle.
    if !STARTED.load(Ordering::SeqCst) {
        return TranscriptionOutcome::Idle;
    }
    TranscriptionOutcome::Completed
}

/// Snapshot for the IPC status command and the `recording-stopped` payload.
#[derive(Debug, Clone, Serialize)]
pub struct TranscriptionOutcomeSnapshot {
    pub outcome: String,
    pub chunks_queued: u64,
    pub chunks_succeeded: u64,
    pub chunks_failed: u64,
    pub is_processing: bool,
    /// Engine error text. Contains no transcript content and no secrets.
    pub last_error: Option<String>,
}

pub fn snapshot() -> TranscriptionOutcomeSnapshot {
    let outcome = outcome();
    let last_error = LAST_ERROR.lock().ok().and_then(|e| e.clone());
    TranscriptionOutcomeSnapshot {
        outcome: outcome.as_str().to_string(),
        chunks_queued: CHUNKS_QUEUED.load(Ordering::SeqCst),
        chunks_succeeded: CHUNKS_SUCCEEDED.load(Ordering::SeqCst),
        chunks_failed: CHUNKS_FAILED.load(Ordering::SeqCst),
        is_processing: is_running(),
        last_error,
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    use super::TEST_LOCK;

    // These tests exercise the classification logic only. They touch process
    // statics, so they are serialised through one mutex to avoid interleaving.

    #[test]
    fn a_failed_chunk_means_failure_not_silence() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset();
        record_queued();
        record_failure("engine exploded");
        mark_finished();
        assert_eq!(outcome(), TranscriptionOutcome::Failed);
        let snap = snapshot();
        assert_eq!(snap.chunks_failed, 1);
        assert_eq!(snap.chunks_succeeded, 0);
        assert!(snap.last_error.as_deref().unwrap().contains("engine exploded"));
    }

    #[test]
    fn zero_segments_with_no_failure_is_a_valid_empty_result() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset();
        mark_started();
        mark_finished();
        assert_eq!(outcome(), TranscriptionOutcome::Completed);
        let snap = snapshot();
        assert_eq!(snap.chunks_succeeded, 0);
        assert_eq!(snap.chunks_failed, 0);
    }

    #[test]
    fn partial_success_plus_failure_is_still_failure() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset();
        record_queued();
        record_success();
        record_queued();
        record_failure("model died");
        mark_finished();
        assert_eq!(outcome(), TranscriptionOutcome::Failed);
    }

    #[test]
fn all_success_is_completed() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        // Production always marks the run started before any chunk is queued
        // (recording_commands calls `mark_started` at recording start).
        reset();
        mark_started();
        record_queued();
        record_success();
        record_queued();
        record_success();
        mark_finished();
        assert_eq!(outcome(), TranscriptionOutcome::Completed);
    }

    #[test]
    fn running_is_never_reported_as_a_terminal_state() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset();
        mark_started();
        assert_eq!(outcome(), TranscriptionOutcome::Running);
        assert!(snapshot().is_processing);
    }

    #[test]
    fn nothing_started_is_idle() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset();
        assert_eq!(outcome(), TranscriptionOutcome::Idle);
    }
}