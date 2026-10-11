//! Phase A regression tests: transcription completeness and truthfulness.
//!
//! The master audit traced the whole capture-to-transcript lifecycle and found
//! that a long meeting could be silently truncated while the app reported
//! success. Three independent defects combined to produce that:
//!
//! 1. **The drain listener died before the drain.** `stop_recording` took the
//!    `RecordingManager` out of the global `RECORDING_MANAGER` registry *and*
//!    unregistered the `transcript-update` listener *before* waiting for the
//!    transcription worker. Every segment produced during the drain hit a
//!    `None` manager and was dropped. The tail of the meeting's transcript was
//!    lost on essentially every recording, and the UI still said "saved".
//! 2. **The 600s drain ceiling was silent.** On timeout the stop path logged a
//!    warning and carried on, so a truncated transcript reached the UI as a
//!    normal finish. A timeout must never masquerade as completion.
//! 3. **Terminal state was published before it was known.** `mark_finished()`
//!    ran inside each worker, before the parent had joined the workers and
//!    verified chunk accounting.
//!
//! These tests exercise the real production helpers. Every one is isolated:
//! temporary directories only, no Tauri app handle, no user database, no audio
//! hardware, no model.

use crate::audio::recording_saver::{RecordingSaver, TranscriptSegment, TranscriptSegmentSink};
use crate::audio::transcription::outcome::{
    self as use_outcome, TerminalKind, TranscriptionOutcome,
};

fn tmp_dir(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "recall-a-{}-{}",
        tag,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

fn segment(seq: u64, text: &str) -> TranscriptSegment {
    TranscriptSegment {
        id: format!("seg_{}", seq),
        text: text.to_string(),
        audio_start_time: seq as f64,
        audio_end_time: seq as f64 + 1.0,
        duration: 1.0,
        display_time: "[00:00]".to_string(),
        confidence: 0.9,
        sequence_id: seq,
    }
}

// ---------------------------------------------------------------------------
// 1. The drain-window data loss
// ---------------------------------------------------------------------------

#[test]
fn segments_arriving_after_the_registry_is_cleared_are_still_persisted() {
    // The defect, reproduced: the listener resolved the manager from the global
    // registry on every event, and the stop path emptied that registry before
    // the drain. The sink is handed out once and keeps working regardless.
    let saver = RecordingSaver::new();
    let sink: TranscriptSegmentSink = saver.transcript_sink();

    // Everything the stop path does to the global registry is modelled here by
    // simply dropping the only other handle to the saver's owner.
    drop(saver);

    for seq in 0..5 {
        sink.add(segment(seq, &format!("drain segment {}", seq)));
    }

    // A fresh observer must see all of them.
    assert_eq!(
        sink.segment_count(),
        5,
        "every segment emitted during the drain window must survive"
    );
}

#[test]
fn the_sink_and_the_saver_agree_on_the_same_buffer() {
    // Regression guard: if the sink ever got its own storage instead of sharing
    // the saver's `Arc`, segments written through one path would be invisible to
    // the other and the meeting would save an empty transcript.
    let mut saver = RecordingSaver::new();
    let sink = saver.transcript_sink();

    sink.add(segment(1, "from the sink"));
    assert_eq!(
        saver.get_transcript_segments().len(),
        1,
        "a segment written through the sink must be visible to the saver"
    );

    saver.add_transcript_segment(segment(2, "from the saver"));
    assert_eq!(
        sink.segment_count(),
        2,
        "a segment written through the saver must be visible to the sink"
    );
}

#[test]
fn sink_upsert_is_idempotent_by_sequence_id() {
    // A partial result re-emitted for the same sequence id must update in place
    // rather than duplicate, so a retry cannot inflate the transcript.
    let saver = RecordingSaver::new();
    let sink = saver.transcript_sink();

    sink.add(segment(7, "partial"));
    sink.add(segment(7, "final"));

    assert_eq!(sink.segment_count(), 1);
    assert_eq!(
        sink.segments().first().map(|s| s.text.as_str()),
        Some("final")
    );
}

#[test]
fn sink_writes_transcripts_json_into_an_isolated_folder() {
    // The incremental write is what makes a crash mid-drain recoverable.
    let dir = tmp_dir("sink-write");
    let mut saver = RecordingSaver::new();

    // Point the saver at a meeting folder without starting a real recording.
    saver.force_meeting_folder_for_tests(dir.clone());
    let sink = saver.transcript_sink();

    sink.add(segment(0, "hello"));
    sink.add(segment(1, "world"));

    let written = dir.join("transcripts.json");
    assert!(written.exists(), "sink must flush transcripts.json");

    let body = std::fs::read_to_string(&written).expect("read transcripts.json");
    assert!(body.contains("hello"), "segment text must be persisted");
    assert!(body.contains("world"), "every segment must be persisted");

    // No temp file may be left behind.
    assert!(!dir.join(".transcripts.json.tmp").exists());

    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// 2. Terminal truthfulness (timeout must never read as success)
// ---------------------------------------------------------------------------

#[test]
fn a_drain_ceiling_is_reported_as_incomplete() {
    let _g = use_outcome::TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    use_outcome::reset();
    use_outcome::mark_started();

    use_outcome::record_queued();
    use_outcome::record_success();
    use_outcome::record_chunk_completed(0);
    // Two chunks were still outstanding when the ceiling was reached.
    use_outcome::record_queued();
    use_outcome::record_queued();

    use_outcome::force_terminal(TerminalKind::TimedOut, "drain ceiling reached");
    use_outcome::mark_finished();

    let snap = use_outcome::snapshot();
    assert_eq!(snap.outcome, "timed_out");
    assert!(
        !snap.is_complete,
        "a truncated transcript must never report itself complete"
    );
    assert_eq!(snap.chunks_pending, 2, "the shortfall must be quantified");
}

#[test]
fn a_timeout_after_some_failures_still_reports_the_shortfall() {
    let _g = use_outcome::TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    use_outcome::reset();
    use_outcome::mark_started();
    use_outcome::record_queued();
    use_outcome::record_failure("engine died");
    use_outcome::force_terminal(TerminalKind::TimedOut, "ceiling reached");
    use_outcome::mark_finished();

    let snap = use_outcome::snapshot();
    assert_eq!(snap.outcome, "timed_out");
    assert_eq!(snap.chunks_failed, 1, "the engine failure stays visible");
    assert!(!snap.is_complete);
}

#[test]
fn only_completed_is_treated_as_a_whole_meeting() {
    // This is the predicate the stop path and the UI branch on. Every other
    // terminal state must read as "not the whole meeting".
    for state in [
        TranscriptionOutcome::Idle,
        TranscriptionOutcome::Running,
        TranscriptionOutcome::Partial,
        TranscriptionOutcome::Failed,
        TranscriptionOutcome::Cancelled,
        TranscriptionOutcome::TimedOut,
    ] {
        assert!(
            !state.is_complete(),
            "{} must not count as a complete transcript",
            state.as_str()
        );
    }
    assert!(TranscriptionOutcome::Completed.is_complete());
}

#[test]
fn a_valid_empty_transcript_is_still_completed() {
    // A meeting where nobody spoke must NOT be reported as a failure.
    let _g = use_outcome::TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    use_outcome::reset();
    use_outcome::mark_started();
    use_outcome::mark_finished();

    let snap = use_outcome::snapshot();
    assert_eq!(snap.outcome, "completed");
    assert_eq!(snap.chunks_succeeded, 0);
    assert!(snap.is_complete);
}

#[test]
fn a_late_completion_cannot_upgrade_a_finished_run() {
    // The drain ceiling verdict must survive work that lands afterwards.
    let _g = use_outcome::TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    use_outcome::reset();
    use_outcome::mark_started();
    use_outcome::force_terminal(TerminalKind::TimedOut, "ceiling reached");
    use_outcome::mark_finished();

    // A chunk that was already in flight finishes late.
    use_outcome::record_success();
    use_outcome::record_chunk_completed(42);

    assert_eq!(
        use_outcome::outcome(),
        TranscriptionOutcome::TimedOut,
        "a late chunk must not rewrite the terminal verdict"
    );
}

#[test]
fn cancellation_is_distinguishable_from_failure_and_from_completion() {
    let _g = use_outcome::TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    use_outcome::reset();
    use_outcome::mark_started();
    use_outcome::force_terminal(TerminalKind::Cancelled, "user cancelled");
    use_outcome::mark_finished();

    let snap = use_outcome::snapshot();
    assert_eq!(snap.outcome, "cancelled");
    assert_ne!(snap.outcome, "failed");
    assert_ne!(snap.outcome, "completed");
    assert_eq!(snap.chunks_failed, 0);
}

// ---------------------------------------------------------------------------
// 3. Idempotent chunk accounting
// ---------------------------------------------------------------------------

#[test]
fn a_duplicated_completion_is_booked_exactly_once() {
    let _g = use_outcome::TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    use_outcome::reset();
    use_outcome::mark_started();

    use_outcome::record_queued();
    assert!(use_outcome::record_chunk_completed(3));
    assert!(!use_outcome::record_chunk_completed(3));
    assert!(!use_outcome::record_chunk_completed(3));

    let snap = use_outcome::snapshot();
    assert_eq!(
        snap.chunks_completed, 1,
        "a duplicate must not inflate the counter"
    );
    assert_eq!(
        snap.chunks_pending, 0,
        "a duplicate must not make the queue look empty early"
    );
}

#[test]
fn every_distinct_chunk_is_booked_once() {
    let _g = use_outcome::TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    use_outcome::reset();
    use_outcome::mark_started();

    for id in 0..8 {
        use_outcome::record_queued();
        assert!(use_outcome::record_chunk_completed(id));
    }

    let snap = use_outcome::snapshot();
    assert_eq!(snap.chunks_completed, 8);
    assert_eq!(snap.chunks_pending, 0);
}

#[test]
fn a_retry_starts_from_clean_counters() {
    // Without this, one failed meeting's counters would be reported against the
    // next one.
    let _g = use_outcome::TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());

    use_outcome::reset();
    use_outcome::mark_started();
    use_outcome::record_queued();
    use_outcome::record_failure("first attempt failed");
    use_outcome::mark_finished();
    assert_eq!(use_outcome::outcome(), TranscriptionOutcome::Failed);

    // Retry.
    use_outcome::mark_started();
    use_outcome::record_queued();
    use_outcome::record_success();
    use_outcome::record_chunk_completed(0);
    use_outcome::mark_finished();

    let snap = use_outcome::snapshot();
    assert_eq!(
        snap.outcome, "completed",
        "a successful retry must not inherit the previous failure"
    );
    assert_eq!(snap.chunks_failed, 0);
}

#[test]
fn pending_count_never_underflows() {
    let _g = use_outcome::TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    use_outcome::reset();
    use_outcome::mark_started();
    use_outcome::record_queued();
    use_outcome::record_chunk_completed(1);
    // An id that was never queued still books, but must not underflow.
    use_outcome::record_chunk_completed(9999);
    assert_eq!(use_outcome::chunks_pending(), 0);
}

// ---------------------------------------------------------------------------
// 4. Source-level guards
// ---------------------------------------------------------------------------

#[test]
fn the_stop_path_does_not_unlisten_before_the_drain() {
    // Guards the original ordering bug at the source level. The behavioural
    // tests above cover the sink; this one stops the listener teardown from
    // being moved back in front of the drain.
    let src = include_str!("../recording_commands.rs");

    let drain = src
        .find("TRANSCRIPTION_DRAIN_CEILING")
        .expect("the drain ceiling must exist in the stop path");
    let unlisten = src
        .find("Transcript-update listener removed after transcription drain")
        .expect("the listener teardown must exist");

    assert!(
        unlisten > drain,
        "the transcript listener must be torn down AFTER the transcription drain, \
         not before it, or the tail of every transcript is discarded"
    );
}

#[test]
fn the_transcript_listener_uses_the_sink_not_the_global_registry() {
    let src = include_str!("../recording_commands.rs");

    assert!(
        src.contains("manager.transcript_sink()"),
        "the transcript-update listener must resolve a segment sink at \
         registration time rather than looking the manager up per event"
    );

    assert!(
        !src.contains("manager.add_transcript_segment(segment)"),
        "resolving the manager per event is the defect: the registry is emptied \
         by the stop path before the drain, so those events are dropped"
    );
}

#[test]
fn the_run_is_closed_only_after_chunk_accounting_is_verified() {
    let worker = include_str!("../transcription/worker.rs");

    let verify = worker
        .find("chunk loss detected")
        .expect("the verification step must remain");
    let finished = worker
        .rfind("outcome::mark_finished();")
        .expect("the run must be closed explicitly");

    assert!(
        finished > verify,
        "mark_finished() must run after chunk accounting is verified, otherwise \
         the terminal state is published before the result is known"
    );
}
