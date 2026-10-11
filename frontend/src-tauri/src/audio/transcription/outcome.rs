//! Terminal outcome of a transcription run.
//!
//! This module is the single place that knows how a transcription run ended, so
//! the stop path, the status command and the UI all read one truth instead of
//! re-deriving "did we get any text?" and getting it wrong.
//!
//! History of this file, because each state exists for a reason:
//!
//! * Phase E found that an engine failure was logged, the chunk was then counted
//!   as *complete* anyway, and nothing recorded that it had failed. The stop path
//!   consequently created a meeting with zero segments and told the user
//!   "Recording saved successfully!". Silence and failure were indistinguishable.
//!   -> `Failed` and a separate failure counter.
//! * The master audit then found the drain ceiling was reached silently: after
//!   600 seconds the stop path logged a warning and carried on, so a truncated
//!   transcript was reported as a normal finish. -> `TimedOut`.
//! * It also found that "finished" and "finished with work still outstanding"
//!   were the same value. -> `Partial` and `Cancelled`.
//!
//! The governing rule is that **a timeout or a cancellation must never
//! masquerade as successful completion.** If the transcript is short of the
//! whole meeting, the UI has to be able to say so.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

/// How a transcription run ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptionOutcome {
    /// No transcription has been started in this session.
    Idle,
    /// Transcription is still running.
    Running,
    /// The engine drained every queued chunk with no failures and no
    /// truncation. `chunks_succeeded == 0` is a *valid* result meaning no speech
    /// was detected -- it is not a failure.
    Completed,
    /// The run ended with work still outstanding: the drain ceiling was hit, or
    /// the worker stopped early. Any segments that did complete are partial and
    /// must not be presented as the whole meeting.
    Partial,
    /// At least one chunk hard-failed (engine error, model unloaded).
    Failed,
    /// The run was deliberately cancelled by the user or by shutdown.
    Cancelled,
    /// The drain ceiling was reached with chunks still queued.
    TimedOut,
}

impl TranscriptionOutcome {
    pub fn as_str(&self) -> &'static str {
        match self {
            TranscriptionOutcome::Idle => "idle",
            TranscriptionOutcome::Running => "running",
            TranscriptionOutcome::Completed => "completed",
            TranscriptionOutcome::Partial => "partial",
            TranscriptionOutcome::Failed => "failed",
            TranscriptionOutcome::Cancelled => "cancelled",
            TranscriptionOutcome::TimedOut => "timed_out",
        }
    }

    /// True when the transcript is known to be short of the whole meeting and
    /// must not be presented as a complete result.
    ///
    /// `Completed` is the only state that means "this is everything".
    pub fn is_complete(&self) -> bool {
        matches!(self, TranscriptionOutcome::Completed)
    }
}

/// A terminal verdict that the stop path observed directly, overriding what the
/// counters alone would imply.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalKind {
    Partial,
    Cancelled,
    TimedOut,
}

impl TerminalKind {
    fn outcome(self) -> TranscriptionOutcome {
        match self {
            TerminalKind::Partial => TranscriptionOutcome::Partial,
            TerminalKind::Cancelled => TranscriptionOutcome::Cancelled,
            TerminalKind::TimedOut => TranscriptionOutcome::TimedOut,
        }
    }
}

static CHUNKS_QUEUED: AtomicU64 = AtomicU64::new(0);
static CHUNKS_SUCCEEDED: AtomicU64 = AtomicU64::new(0);
static CHUNKS_FAILED: AtomicU64 = AtomicU64::new(0);
static CHUNKS_COMPLETED: AtomicU64 = AtomicU64::new(0);
static RUNNING: AtomicBool = AtomicBool::new(false);
/// Whether a transcription run was ever started in this session. Needed to tell
/// "nobody spoke" (started, finished, zero chunks -> Completed) apart from
/// "transcription was never attempted" (Idle). Collapsing those two would make a
/// status poll before any recording indistinguishable from a silent meeting.
static STARTED: AtomicBool = AtomicBool::new(false);
static LAST_ERROR: Mutex<Option<String>> = Mutex::new(None);
/// Explicit terminal verdict set by the stop path when it directly observes
/// truncation or cancellation.
static TERMINAL_OVERRIDE: Mutex<Option<TerminalKind>> = Mutex::new(None);
/// Chunk ids already accounted for, so a duplicated completion cannot inflate
/// the counters or fake progress.
static SEEN_CHUNKS: Mutex<Option<HashSet<u64>>> = Mutex::new(None);

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
    CHUNKS_COMPLETED.store(0, Ordering::SeqCst);
    RUNNING.store(false, Ordering::SeqCst);
    STARTED.store(false, Ordering::SeqCst);
    if let Ok(mut e) = LAST_ERROR.lock() {
        *e = None;
    }
    if let Ok(mut o) = TERMINAL_OVERRIDE.lock() {
        *o = None;
    }
    if let Ok(mut s) = SEEN_CHUNKS.lock() {
        *s = Some(HashSet::new());
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

/// Account for a finished chunk, exactly once per chunk id.
///
/// Returns `true` when this call is what booked the completion, `false` when the
/// chunk had already been accounted for. A duplicated completion previously
/// incremented a raw counter, which could drive the progress percentage past
/// 100% and let the drain loop exit before real work was done.
pub fn record_chunk_completed(chunk_id: u64) -> bool {
    let newly_completed = match SEEN_CHUNKS.lock() {
        Ok(mut seen) => {
            let set = seen.get_or_insert_with(HashSet::new);
            set.insert(chunk_id)
        }
        // A poisoned lock must not be read as "already completed"; fall back to
        // the plain counter rather than dropping the accounting.
        Err(_) => true,
    };
    if newly_completed {
        CHUNKS_COMPLETED.fetch_add(1, Ordering::SeqCst);
    }
    newly_completed
}

/// Chunks that were queued but never booked as completed.
pub fn chunks_pending() -> u64 {
    let queued = CHUNKS_QUEUED.load(Ordering::SeqCst);
    let completed = CHUNKS_COMPLETED.load(Ordering::SeqCst);
    queued.saturating_sub(completed)
}

/// Record a terminal verdict the counters cannot express on their own.
pub fn force_terminal(kind: TerminalKind, message: impl Into<String>) {
    if let Ok(mut o) = TERMINAL_OVERRIDE.lock() {
        // First observation wins: the stop path records the drain ceiling, and
        // a later worker failure must not overwrite the more specific verdict.
        if o.is_none() {
            *o = Some(kind);
        }
    }
    let message = message.into();
    if let Ok(mut e) = LAST_ERROR.lock() {
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

/// The decisive question: how did this session end?
///
/// Precedence, in order:
/// 1. Still running -> `Running` (never a terminal state).
/// 2. An explicit verdict recorded by the stop path (`Partial`/`Cancelled`/
///    `TimedOut`). This outranks the failure counter because the stop path
///    observed truncation *directly*; the number of failed chunks remains visible
///    in [`TranscriptionOutcomeSnapshot::chunks_failed`].
/// 3. At least one failed chunk -> `Failed`, never "the meeting was silent".
/// 4. Never started -> `Idle`.
/// 5. Otherwise -> `Completed`, including the legitimate zero-segment case.
pub fn outcome() -> TranscriptionOutcome {
    if is_running() {
        return TranscriptionOutcome::Running;
    }
    if let Ok(o) = TERMINAL_OVERRIDE.lock() {
        if let Some(kind) = *o {
            return kind.outcome();
        }
    }
    if CHUNKS_FAILED.load(Ordering::SeqCst) > 0 {
        return TranscriptionOutcome::Failed;
    }
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
    pub chunks_completed: u64,
    pub chunks_succeeded: u64,
    pub chunks_failed: u64,
    /// Chunks that left the queue without being accounted for.
    pub chunks_pending: u64,
    pub is_processing: bool,
    /// Whether the transcript covers the whole meeting.
    pub is_complete: bool,
    /// Engine error text. Contains no transcript content and no secrets.
    pub last_error: Option<String>,
}

pub fn snapshot() -> TranscriptionOutcomeSnapshot {
    let outcome = outcome();
    let last_error = LAST_ERROR.lock().ok().and_then(|e| e.clone());
    TranscriptionOutcomeSnapshot {
        is_complete: outcome.is_complete(),
        outcome: outcome.as_str().to_string(),
        chunks_queued: CHUNKS_QUEUED.load(Ordering::SeqCst),
        chunks_completed: CHUNKS_COMPLETED.load(Ordering::SeqCst),
        chunks_succeeded: CHUNKS_SUCCEEDED.load(Ordering::SeqCst),
        chunks_failed: CHUNKS_FAILED.load(Ordering::SeqCst),
        chunks_pending: chunks_pending(),
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
        assert!(snap
            .last_error
            .as_deref()
            .unwrap()
            .contains("engine exploded"));
        assert!(!snap.is_complete);
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
        assert!(snap.is_complete);
    }

    #[test]
    fn partial_success_plus_failure_is_still_failure() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset();
        mark_started();
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

    // --- drain-ceiling / truncation coverage -------------------------------

    #[test]
    fn drain_timeout_is_not_reported_as_completed() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset();
        mark_started();
        record_queued();
        record_success();
        record_chunk_completed(0);
        // Two more chunks were still queued when the ceiling was hit.
        record_queued();
        record_queued();
        force_terminal(TerminalKind::TimedOut, "drain ceiling reached");
        mark_finished();

        let snap = snapshot();
        assert_eq!(snap.outcome, "timed_out");
        assert_eq!(snap.outcome, TranscriptionOutcome::TimedOut.as_str());
        assert!(!snap.is_complete);
        assert_eq!(snap.chunks_pending, 2);
        assert!(snap.last_error.as_deref().unwrap().contains("ceiling"));
    }

    #[test]
    fn cancellation_is_not_reported_as_completed() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset();
        mark_started();
        record_queued();
        force_terminal(TerminalKind::Cancelled, "user stopped the session");
        mark_finished();
        assert_eq!(outcome(), TranscriptionOutcome::Cancelled);
        assert!(!snapshot().is_complete);
    }

    #[test]
    fn an_explicit_verdict_outranks_the_failure_counter() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset();
        mark_started();
        record_queued();
        record_failure("engine died");
        force_terminal(TerminalKind::TimedOut, "ceiling reached");
        mark_finished();
        // The stop path saw truncation directly; the failed-chunk count is still
        // reported so nothing is hidden from the user.
        let snap = snapshot();
        assert_eq!(snap.outcome, "timed_out");
        assert_eq!(snap.chunks_failed, 1);
    }

    #[test]
    fn the_first_explicit_verdict_wins() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset();
        mark_started();
        force_terminal(TerminalKind::TimedOut, "first");
        force_terminal(TerminalKind::Cancelled, "second");
        mark_finished();
        assert_eq!(outcome(), TranscriptionOutcome::TimedOut);
    }

    #[test]
    fn a_late_completion_cannot_resurrect_a_finished_run() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset();
        mark_started();
        force_terminal(TerminalKind::TimedOut, "ceiling reached");
        mark_finished();
        // A chunk that was already in flight finishes after the verdict.
        record_success();
        assert_eq!(outcome(), TranscriptionOutcome::TimedOut);
        assert!(!snapshot().is_complete);
    }

    // --- idempotent chunk accounting --------------------------------------

    #[test]
    fn duplicate_completion_is_counted_once() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset();
        mark_started();
        record_queued();
        assert!(record_chunk_completed(7));
        assert!(!record_chunk_completed(7));
        assert!(!record_chunk_completed(7));
        assert_eq!(snapshot().chunks_pending, 0);
    }

    #[test]
    fn distinct_chunks_are_each_counted() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset();
        mark_started();
        for id in 0..3 {
            record_queued();
            assert!(record_chunk_completed(id));
        }
        assert_eq!(snapshot().chunks_pending, 0);
        assert_eq!(
            snapshot().chunks_completed,
            3,
            "three distinct chunks must be booked once each"
        );
    }

    #[test]
    fn pending_never_goes_negative() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset();
        mark_started();
        record_queued();
        record_chunk_completed(1);
        // An unqueued id still books, but must not make `pending` underflow.
        record_chunk_completed(99);
        assert_eq!(chunks_pending(), 0);
    }

    #[test]
    fn outcome_strings_are_stable_for_the_frontend() {
        assert_eq!(TranscriptionOutcome::Idle.as_str(), "idle");
        assert_eq!(TranscriptionOutcome::Running.as_str(), "running");
        assert_eq!(TranscriptionOutcome::Completed.as_str(), "completed");
        assert_eq!(TranscriptionOutcome::Partial.as_str(), "partial");
        assert_eq!(TranscriptionOutcome::Failed.as_str(), "failed");
        assert_eq!(TranscriptionOutcome::Cancelled.as_str(), "cancelled");
        assert_eq!(TranscriptionOutcome::TimedOut.as_str(), "timed_out");
    }
}
