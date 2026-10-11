/**
 * Phase A regression tests: transcription completeness and truthfulness.
 *
 * Guards the end-to-end contract that a long meeting can never be silently
 * truncated while the app reports success. These are source-shape assertions
 * plus a behavioural check of the shared status contract; the exhaustive state
 * machine is covered by the Rust suite in
 * `src-tauri/src/audio/tests/phase_a_completeness.rs`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'src-tauri', 'src');
const code = (p) => readFileSync(p, 'utf8');

const outcomeRs = code(join(root, 'audio', 'transcription', 'outcome.rs'));
const workerRs = code(join(root, 'audio', 'transcription', 'worker.rs'));
const stopRs = code(join(root, 'audio', 'recording_commands.rs'));
const saverRs = code(join(root, 'audio', 'recording_saver.rs'));

const fe = join(process.cwd(), 'src');
const stopHook = readFileSync(join(fe, 'hooks', 'useRecordingStop.ts'), 'utf8');
const transcriptService = readFileSync(
  join(fe, 'services', 'transcriptService.ts'),
  'utf8',
);

/**
 * Structural guards must inspect code, not prose. Several of the fixes below
 * document the very identifiers they removed (e.g. a comment naming
 * `chunks_in_queue`), so matching raw source would fail on the explanation of
 * the fix rather than on the fix itself.
 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const outcomeCode = stripComments(outcomeRs);
const workerCode = stripComments(workerRs);
const stopCode = stripComments(stopRs);
const saverCode = stripComments(saverRs);
const stopHookCode = stripComments(stopHook);
const serviceCode = stripComments(transcriptService);

test('Phase A: terminal transcription states are explicit', () => {
  for (const state of [
    'Idle',
    'Running',
    'Completed',
    'Partial',
    'Failed',
    'Cancelled',
    'TimedOut',
  ]) {
    assert.match(
      outcomeCode,
      new RegExp(`\\b${state}\\b`),
      `the outcome model must carry an explicit ${state} state`,
    );
  }
});

test('Phase A: only Completed counts as a whole meeting', () => {
  assert.match(
    outcomeCode,
    /pub fn is_complete\(&self\) -> bool \{[\s\S]{0,120}TranscriptionOutcome::Completed/,
    'is_complete() must be true only for Completed',
  );
});

test('Phase A: a drain timeout is never reported as completion', () => {
  assert.match(
    outcomeCode,
    /TerminalKind::TimedOut/,
    'a distinct timed-out verdict must exist',
  );
  assert.match(outcomeCode, /force_terminal/, 'the stop path must be able to record an observed truncation');

  // The stop path must actually use it when the ceiling is reached.
  assert.match(
    stopCode,
    /TRANSCRIPTION_DRAIN_CEILING[\s\S]{0,2000}TerminalKind::TimedOut/,
    'hitting the drain ceiling must record a timed-out verdict',
  );
});

test('Phase A: the drain ceiling aborts the worker instead of detaching it', () => {
  assert.match(
    stopCode,
    /timeout\(TRANSCRIPTION_DRAIN_CEILING, &mut task_handle\)/,
    'the handle must be borrowed so it can still be aborted on timeout',
  );
  assert.match(
    stopCode,
    /task_handle\.abort\(\)/,
    'a worker left running after the ceiling would keep emitting into a torn-down session',
  );
});

test('Phase A: the transcript listener outlives the drain', () => {
  const ceiling = stopCode.indexOf('TRANSCRIPTION_DRAIN_CEILING');
  const teardown = stopCode.indexOf('app.unlisten(listener_id)');

  assert.ok(ceiling > -1, 'the drain ceiling must exist in the stop path');
  assert.ok(teardown > -1, 'the listener teardown must exist');
  assert.ok(
    teardown > ceiling,
    'tearing the transcript listener down before the drain discards every ' +
      'segment produced during it',
  );
});

test('Phase A: transcript persistence does not depend on the global registry', () => {
  assert.match(
    saverCode,
    /pub struct TranscriptSegmentSink/,
    'a cloneable segment sink must exist',
  );
  assert.match(saverCode, /fn transcript_sink\(&self\)/, 'the saver must hand out a sink');
  assert.match(
    stopCode,
    /manager\.transcript_sink\(\)/,
    'the listener must resolve a sink once at registration',
  );
  assert.doesNotMatch(
    stopCode,
    /manager\.add_transcript_segment\(segment\)/,
    'resolving the manager per event dies when the stop path empties the registry',
  );
});

test('Phase A: chunk accounting is idempotent', () => {
  assert.match(
    outcomeCode,
    /pub fn record_chunk_completed\(chunk_id: u64\) -> bool/,
    'completion accounting must be keyed on the chunk id',
  );
  assert.match(outcomeCode, /HashSet/, 'already-booked chunk ids must be tracked');
  assert.match(outcomeCode, /saturating_sub/, 'the pending count must never underflow');
});

test('Phase A: the run is closed only after accounting is verified', () => {
  const verifyAt = workerCode.indexOf('chunk loss detected');
  const finishedAt = workerCode.lastIndexOf('outcome::mark_finished();');

  assert.ok(verifyAt > -1, 'the verification step must remain');
  assert.ok(finishedAt > -1, 'the run must be closed explicitly');
  assert.ok(
    finishedAt > verifyAt,
    'mark_finished() must run after verification, not inside the worker',
  );

  assert.match(
    workerCode,
    /chunk loss detected[\s\S]{0,400}outcome::record_failure/,
    'an unverifiable chunk count must be recorded as a failure',
  );
});

test('Phase A: a queued chunk count is actually recorded', () => {
  assert.match(outcomeCode, /pub fn record_queued\(\)/, 'the queued counter must exist');
  assert.match(
    workerCode,
    /outcome::record_queued\(\)/,
    'production dispatch must record queued chunks, otherwise the status command ' +
      'always reports zero work in flight',
  );
});

test('Phase A: engine initialisation failure terminates the run', () => {
  assert.match(
    workerCode,
    /Failed to initialize transcription engine[\s\S]{0,400}record_failure/,
    'an engine that cannot start must not leave the run reported as running',
  );
  assert.match(
    workerCode,
    /Failed to initialize transcription engine[\s\S]{0,600}mark_finished/,
    'the run must be closed so the status command returns a terminal state',
  );
});

test('Phase A: the stop log does not claim success unconditionally', () => {
  assert.doesNotMatch(
    stopCode,
    /ZERO transcript chunks lost/,
    'an unconditional success line is a false record after a truncation',
  );
  assert.match(
    stopCode,
    /the transcript is incomplete/,
    'the stop path must log a distinct, truthful outcome instead',
  );
});

test('Phase A: the frontend status contract matches the backend payload', () => {
  // Fields the backend actually returns.
  for (const field of [
    'outcome',
    'chunks_queued',
    'chunks_completed',
    'chunks_pending',
    'is_processing',
  ]) {
    assert.match(
      serviceCode,
      new RegExp(`${field}:`),
      `the TypeScript status interface must declare ${field}`,
    );
  }

  // Fields the frontend used to read and the backend never returned.
  assert.doesNotMatch(
    serviceCode,
    /chunks_in_queue/,
    'the backend never returned chunks_in_queue, so `undefined === 0` made every ' +
      'post-stop exit condition unreachable',
  );
  assert.doesNotMatch(serviceCode, /last_activity_ms/, 'the backend never returned last_activity_ms');

  assert.doesNotMatch(
    stopHookCode,
    /chunks_in_queue/,
    'the stop hook must read the field the backend actually sends',
  );
  assert.match(
    stopHookCode,
    /chunks_pending/,
    'the stop hook must account for outstanding chunks',
  );
});

test('Phase A: every non-complete terminal state is treated as incomplete', () => {
  assert.match(
    stopHookCode,
    /transcriptionOutcome !== 'completed'/,
    'a partial/timed-out/cancelled transcript must never be saved as a success',
  );
  assert.match(
    stopHookCode,
    /transcriptionOutcome !== 'idle'/,
    'only a real run can be judged complete',
  );
});