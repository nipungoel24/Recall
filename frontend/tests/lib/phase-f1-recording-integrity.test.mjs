/**
 * Phase F1 regression gate: recording and transcription integrity.
 *
 * Phase E found two P0 defects that every existing test passed over:
 *
 *   P0-A  An FFmpeg/finalization failure was logged while the app still emitted
 *         `recording-stopped` and the UI reported success. The user was told
 *         their meeting was saved when no audio existed.
 *   P0-B  A transcription engine failure was counted as a completed chunk, so a
 *         wholly failed transcription produced an empty transcript plus a
 *         "Recording saved successfully" toast.
 *
 * These assertions are structural: they pin the contract between the Rust stop
 * path and the frontend, which is where both defects lived. They are not a
 * substitute for the Rust-side runtime tests in
 * `src-tauri/src/audio/tests/phase_f1_integrity.rs`, which exercise the real
 * artifact-verification and outcome-classification code.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8')

const stopHook = read('src/hooks/useRecordingStop.ts')
const commands = read('src-tauri/src/audio/recording_commands.rs')
const manager = read('src-tauri/src/audio/recording_manager.rs')
const saver = read('src-tauri/src/audio/recording_saver.rs')
const worker = read('src-tauri/src/audio/transcription/worker.rs')
const ffmpeg = read('src-tauri/src/audio/ffmpeg.rs')
const libRs = read('src-tauri/src/lib.rs')

/** Strip comments so prose describing a rule is not read as implementing it. */
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('phase F1: a recording failure cannot be reported as success', () => {
  it('the audio artifact is verified before success is claimed', () => {
    const c = code(manager)
    // The manager must call the SAME helper the regression tests execute, so a
    // future edit cannot make the production path and the test disagree.
    assert.match(
      c,
      /incremental_saver::verify_audio_artifact\(&path\)/,
      'save_recording_only must verify the artifact via the shared helper, '
        + 'not trust its callee and not re-implement the check inline',
    )
    const helper = code(read('src-tauri/src/audio/incremental_saver.rs'))
    assert.match(
      helper,
      /meta\.len\(\) > 0/,
      'the helper must reject a zero-byte audio file',
    )
  })

  it('a save error is propagated instead of being logged and discarded', () => {
    const c = code(manager)
    // The original bug was `Err(e) => { error!("..."); }` followed by an
    // unconditional `Ok(())`. Assert the arm actually yields the error.
    assert.match(
      c,
      /Err\(e\) => \{[\s\S]{0,300}?Err\(anyhow::anyhow!\(e\)\)/,
      'the Err arm must return the error to the caller',
    )
    assert.doesNotMatch(
      c,
      /Err\(e\) => \{ error!\("Failed to save recording: \{\}", e\); \}/,
      'a log-only Err arm is the original defect and must not return',
    )
  })

  it('the stop event carries the real audio outcome', () => {
    const c = code(commands)
    assert.match(c, /"audio_saved"/, 'recording-stopped must state whether audio was saved')
    assert.match(c, /"audio_error"/, 'a failure reason must be available to the UI')
    assert.match(
      c,
      /"transcription"/,
      'the stop payload must carry the terminal transcription verdict',
    )
  })

  it('checkpoint encode failures are recorded, not only logged', () => {
    const c = code(saver)
    // The accumulation task previously did `if let Err(e) = ... { error!() }`
    // and moved on, so a dead encoder produced zero checkpoints and the
    // finalize step then "succeeded" with no audio.
    assert.doesNotMatch(
      c,
      /if let Err\(e\) = saver_guard\.add_chunk\(chunk\) \{\s*error!\(/,
      'a failed checkpoint must be recorded so the stop path can fail truthfully',
    )
    assert.match(
      c,
      /checkpoint_failure/,
      'checkpoint failures must be tracked, not discarded',
    )
    assert.match(
      manager,
      /take_checkpoint_failure\(\)/,
      'the stop path must consume the recorded failure',
    )
  })

  it('a missing ffmpeg is not cached for the whole process lifetime', () => {
    const c = code(ffmpeg)
    assert.doesNotMatch(
      c,
      /Lazy<Option<PathBuf>>/,
      'a Lazy<Option<..>> pins "not found" for the process lifetime, so an '
        + 'environment that becomes healthy later can never be recovered from',
    )
    assert.match(c, /FFMPEG_CACHE_TTL_SECS/, 'resolution must be time-limited and retried')
  })

  it('ffmpeg discovery no longer panics inside the resolver', () => {
    const c = code(ffmpeg)
    assert.doesNotMatch(
      c,
      /sidecar_dir\(\)\.map_err\([^)]*\)\.unwrap\(\)/,
      'a panic here poisons the cache and makes every later lookup panic too',
    )
  })
})

describe('phase F1: a transcription failure is not an empty transcript', () => {
  it('failed chunks are recorded as failures', () => {
    const c = code(worker)
    assert.match(
      c,
      /record_failure\(/,
      'the worker must record a failure when the engine fails',
    )
    assert.match(
      c,
      /record_success\(/,
      'the worker must record a success when a chunk produced validated text',
    )
  })

  it('a model that is not loaded counts as failure, not as a completed chunk', () => {
    const c = code(worker)
    assert.match(
      c,
      /is_model_loaded\(\)[\s\S]{0,400}?record_failure\(/,
      'an unloaded model means every chunk fails; it must be recorded as failure',
    )
  })

  it('the engine-failure arm records the failure before the completed counter', () => {
    const c = code(worker)
    // The failure arm, then the unconditional `chunks_completed.fetch_add` that
    // follows the match. The record must come first, otherwise the chunk is
    // booked complete before the failure is ever noted.
    const failureAt = c.search(/_ => \{[\s\S]{0,400}?record_failure\(/);
    assert.ok(failureAt >= 0, 'could not locate the engine-failure arm with record_failure')
    const completedAt = c.indexOf('chunks_completed_clone.fetch_add', failureAt);
    assert.ok(completedAt > failureAt, 'no completed-counter found after the failure arm')
    const between = c.slice(failureAt, completedAt);
    assert.ok(
      between.includes('record_failure('),
      'the failure must be recorded before the chunk is counted complete',
    )
    assert.doesNotMatch(
      between.slice(between.indexOf('record_failure(')),
      /chunks_completed_clone\.fetch_add[\s\S]*record_failure\(/,
      'the completed counter must not run before the failure is recorded',
    )
  })

  it('transcription status is real, not a constant stub', () => {
    const c = code(libRs)
    assert.doesNotMatch(
      c,
      /TranscriptionStatus\s*\{\s*chunks_in_queue:\s*0,\s*is_processing:\s*false/,
      'a constant stub makes the post-stop wait loop break on its first iteration',
    )
    assert.match(c, /outcome::snapshot\(\)/, 'status must report the real counters')
  })

  it('the frontend reads the outcome instead of inferring success', () => {
    assert.match(stopHook, /last_recording_outcome/, 'the stop payload must be persisted')
    assert.match(
      stopHook,
      /audio_saved !== false/,
      'the frontend must check whether audio was actually saved',
    )
    assert.match(
      stopHook,
      /transcription\?\.outcome === 'failed'/,
      'a failed transcription must be recognised explicitly',
    )
    assert.match(
      stopHook,
      /toast\.error\(/,
      'a failed recording must surface an error to the user',
    )
    assert.doesNotMatch(
      stopHook,
      /toast\.success\('Recording saved successfully!'\s*,\s*\{\s*description: `\$\{freshTranscripts\.length\} transcript segments saved\.`/,
      'the unconditional success toast is exactly the P0-B symptom and must be gone',
    )
  })
})

describe('phase F1: recoverable data is preserved', () => {
  it('a failed finalization does not delete checkpoints', () => {
    const c = code(commands)
    const failureArm = c.match(/Ok\(Err\(e\)\) => \{[\s\S]{0,600}?\}/);
    assert.ok(failureArm, 'could not locate the save-failure arm in the stop path')
    assert.doesNotMatch(
      failureArm[0],
      /remove_dir_all|cleanup_checkpoints/,
      'recoverable audio checkpoints must survive a failed finalization',
    )
  })

  it('retranscription still refuses to commit an empty replacement', () => {
    const retrans = read('src-tauri/src/audio/retranscription.rs')
    const c = code(retrans)
    assert.match(
      c,
      /segments\.is_empty\(\)/,
      'an empty re-transcription must not delete the existing transcript',
    )
  })
})

describe('phase F1: focused Rust regression tests exist', () => {
  it('the audio integrity test module is wired in', () => {
    const testsDir = 'src-tauri/src/audio/tests'
    const files = readdirSync(testsDir)
    assert.ok(
      files.includes('phase_f1_integrity.rs'),
      'phase F1 regression tests must be present',
    )
    const modRs = read('src-tauri/src/audio/mod.rs')
    assert.match(modRs, /#\[cfg\(test\)\]\s*mod tests;/, 'the test module must be compiled')
  })

  it('the required scenarios are covered', () => {
    const t = read('src-tauri/src/audio/tests/phase_f1_integrity.rs')
    for (const scenario of [
      'ffmpeg_missing_does_not_verify_as_success',
      'empty_output_file_is_rejected_not_treated_as_success',
      'failed_finalization_preserves_recoverable_checkpoints',
      'transcription_failure_is_not_silence',
      'zero_segments_without_failure_is_a_valid_empty_transcript',
      'failed_chunks_are_counted_separately_from_successes',
      'retry_after_failure_is_possible_because_reset_clears_the_failure',
    ]) {
      assert.ok(t.includes(scenario), `missing regression scenario: ${scenario}`)
    }
  })
})