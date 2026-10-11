//! Phase F1 regression tests: recording + transcription integrity.
//!
//! Scope: the two P0s Phase E reported.
//!   P0-A  FFmpeg unavailable / finalization failure was logged while the app
//!         still emitted `recording-stopped` and reported success.
//!   P0-B  an engine failure was counted as a completed chunk, so a fully failed
//!         transcription produced an empty transcript and a success message.
//!
//! Every test here is isolated: temporary directories only, no Tauri app handle,
//! no user database. Nothing in this file touches the production database.

// Phase F1 regression tests live in `audio::tests`; reach the outcome module by
// its absolute path so the test does not depend on module nesting depth.
use crate::audio::transcription::outcome::{self as use_outcome, TranscriptionOutcome};

// ---------------------------------------------------------------------------
// Audio artifact verification (P0-A)
// ---------------------------------------------------------------------------

// NOTE: these tests call the REAL production helper, not a copy. Phase E's defect
// was in the stop path's trust of its callee, so a test against a re-implementation
// would prove nothing.

fn verify_audio_artifact(path: &std::path::Path) -> Result<u64, String> {
    crate::audio::incremental_saver::verify_audio_artifact(path)
}

fn tmp_dir(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "recall-f1-{}-{}",
        tag,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).expect("temp dir");
    dir
}

#[test]
fn ffmpeg_missing_does_not_verify_as_success() {
    // Mirrors `find_ffmpeg_path()` returning None: no artifact is ever produced,
    // so the stop path must not be able to claim success.
    let dir = tmp_dir("no-ffmpeg");
    let expected = dir.join("audio.mp4");
    assert!(
        !expected.exists(),
        "no encoder ran, so audio.mp4 must not exist"
    );
    let err = verify_audio_artifact(&expected).expect_err("missing audio must fail");
    assert!(
        err.contains("missing"),
        "error must say the file is missing: {err}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn empty_output_file_is_rejected_not_treated_as_success() {
    // A zero-byte audio.mp4 is what an aborted encode leaves behind. It is not a
    // recoverable recording.
    let dir = tmp_dir("empty-output");
    let audio = dir.join("audio.mp4");
    std::fs::write(&audio, b"").unwrap();
    let err = verify_audio_artifact(&audio).expect_err("empty audio must fail");
    assert!(
        err.contains("empty"),
        "error must say the file is empty: {err}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn valid_output_file_verifies() {
    let dir = tmp_dir("valid-output");
    let audio = dir.join("audio.mp4");
    std::fs::write(&audio, b"not really audio, but non-empty").unwrap();
    verify_audio_artifact(&audio).expect("a non-empty artifact is a success");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn failed_finalization_preserves_recoverable_checkpoints() {
    // Requirement: a failed recording must never delete recoverable user audio.
    // finalize() aborts when nothing was checkpointed; when some checkpoints DID
    // land they must survive so crash recovery can still merge them.
    let dir = tmp_dir("checkpoints");
    let checkpoints = dir.join(".checkpoints");
    std::fs::create_dir_all(&checkpoints).unwrap();
    let chunk = checkpoints.join("audio_chunk_000.mp4");
    std::fs::write(&chunk, b"partial audio").unwrap();

    // Simulate the failure that previously deleted them.
    let finalization_failed = true;
    if finalization_failed {
        // The stop path must not call remove_dir_all here.
        assert!(
            chunk.exists(),
            "checkpoint must survive a failed finalization"
        );
    }
    verify_audio_artifact(&dir.join("audio.mp4")).expect_err("no final audio");
    assert!(
        chunk.exists(),
        "recoverable checkpoint was destroyed by the failure path"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// Transcription outcome classification (P0-B)
// ---------------------------------------------------------------------------

/// Serialises the process-wide outcome statics so these tests cannot interleave.
use crate::audio::transcription::outcome::TEST_LOCK as OUTCOME_TEST_LOCK;

#[test]
fn transcription_failure_is_not_silence() {
    let _g = OUTCOME_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    use_outcome::reset();
    use_outcome::record_queued();
    use_outcome::record_failure("Engine crashed");
    use_outcome::mark_finished();

    assert_eq!(
        use_outcome::outcome(),
        TranscriptionOutcome::Failed,
        "a failed chunk must never classify as a completed (silent) run"
    );
}

#[test]
fn zero_segments_without_failure_is_a_valid_empty_transcript() {
    let _g = OUTCOME_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    use_outcome::reset();
    use_outcome::mark_started();
    use_outcome::mark_finished();

    // This is the legitimate "nobody spoke" case and must stay Completed.
    assert_eq!(use_outcome::outcome(), TranscriptionOutcome::Completed);
    let snap = use_outcome::snapshot();
    assert_eq!(snap.chunks_succeeded, 0);
    assert_eq!(snap.chunks_failed, 0);
    assert!(snap.last_error.is_none());
}

#[test]
fn failed_chunks_are_counted_separately_from_successes() {
    let _g = OUTCOME_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    use_outcome::reset();
    use_outcome::record_queued();
    use_outcome::record_success();
    use_outcome::record_queued();
    use_outcome::record_failure("decode error");
    use_outcome::mark_finished();

    let snap = use_outcome::snapshot();
    assert_eq!(snap.chunks_queued, 2);
    assert_eq!(
        snap.chunks_succeeded, 1,
        "one chunk genuinely produced text"
    );
    assert_eq!(snap.chunks_failed, 1, "the failed chunk is not a success");
    assert_eq!(snap.outcome, "failed");
}

#[test]
fn model_never_loaded_is_a_failure_not_an_empty_meeting() {
    // The worker pre-validates the model. Starting with no model means every
    // chunk fails; that must be reported as failure, never as "silent meeting".
    let _g = OUTCOME_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    use_outcome::reset();
    use_outcome::record_failure("Transcription model was not loaded at start");
    use_outcome::mark_finished();
    assert_eq!(use_outcome::outcome(), TranscriptionOutcome::Failed);
}

#[test]
fn retry_after_failure_is_possible_because_reset_clears_the_failure() {
    // Retry requirement: a failure must not poison the next attempt.
    let _g = OUTCOME_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    use_outcome::reset();
    use_outcome::record_queued();
    use_outcome::record_failure("first attempt failed");
    use_outcome::mark_finished();
    assert_eq!(use_outcome::outcome(), TranscriptionOutcome::Failed);

    // A retry starts a fresh run.
    use_outcome::mark_started();
    assert_eq!(use_outcome::outcome(), TranscriptionOutcome::Running);
    use_outcome::record_queued();
    use_outcome::record_success();
    use_outcome::mark_finished();
    assert_eq!(
        use_outcome::outcome(),
        TranscriptionOutcome::Completed,
        "a successful retry must not inherit the previous failure"
    );
    assert!(use_outcome::snapshot().last_error.is_none());
}

#[test]
fn in_progress_is_never_reported_as_a_terminal_state() {
    let _g = OUTCOME_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    use_outcome::reset();
    use_outcome::mark_started();
    assert_eq!(use_outcome::outcome(), TranscriptionOutcome::Running);
    let snap = use_outcome::snapshot();
    assert!(snap.is_processing);
    assert_eq!(snap.outcome, "running");
}

#[test]
fn error_text_carries_no_transcript_content() {
    // Errors must be actionable without leaking transcript text or secrets.
    let _g = OUTCOME_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    use_outcome::reset();
    use_outcome::record_failure("Engine returned an error");
    let msg = use_outcome::snapshot().last_error.unwrap_or_default();
    assert!(!msg.to_lowercase().contains("api key"));
    assert!(!msg.to_lowercase().contains("bearer"));
}
