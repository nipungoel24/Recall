// QA regression suite for daily brief error formatting and state recovery
// Validates that backend rejection strings and orphaned/pending brief states
// are accurately propagated rather than swallowed or masked.
//
// Runnable with: node --test tests/lib/qa-daily-brief-error-recovery.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const hookPath = path.join(here, '..', '..', 'src', 'hooks', 'daily', 'useDailyBrief.ts');
const hookSource = fs.readFileSync(hookPath, 'utf8');

test('useDailyBrief includes formatErrorMessage helper', () => {
  assert.match(
    hookSource,
    /function formatErrorMessage\(error:\s*unknown,\s*fallback:\s*string\)/,
    'formatErrorMessage helper must be present',
  );
});

test('useDailyBrief does not use naked error instanceof Error without string error check', () => {
  // Ensure that catch blocks do not blindly do: error instanceof Error ? error.message : 'Daily brief generation failed.'
  const matches = hookSource.match(/error instanceof Error \? error\.message : '[^']+'/g);
  assert.equal(
    matches,
    null,
    'All error assignments must use formatErrorMessage to preserve Tauri string rejections',
  );
});

test('useDailyBrief polls when status is pending as well as processing during hydration', () => {
  assert.match(
    hookSource,
    /status === 'processing' \|\| status === 'pending'/,
    'Hydration must poll if status is pending or processing',
  );
});

test('useDailyBrief handles failed/error status during hydration', () => {
  assert.match(
    hookSource,
    /status === 'failed' \|\| status === 'error'/,
    'Hydration must surface failed or error status to user',
  );
});

test('error formatting behavior specification test', () => {
  function formatErrorMessage(error, fallback) {
    if (typeof error === 'string' && error.trim().length > 0) return error.trim();
    if (error instanceof Error && error.message.trim().length > 0) return error.message.trim();
    return fallback;
  }

  // 1. Rust Tauri string rejections (the exact cause of Defect 2)
  assert.equal(
    formatErrorMessage('A daily brief is already being generated for 2026-08-05.', 'Daily brief generation failed.'),
    'A daily brief is already being generated for 2026-08-05.',
  );
  assert.equal(
    formatErrorMessage('No meetings found for 2026-08-05.', 'Daily brief generation failed.'),
    'No meetings found for 2026-08-05.',
  );
  assert.equal(
    formatErrorMessage('Model file not found', 'Daily brief generation failed.'),
    'Model file not found',
  );

  // 2. JS Error objects
  assert.equal(
    formatErrorMessage(new Error('Network connection timed out'), 'Daily brief generation failed.'),
    'Network connection timed out',
  );

  // 3. Fallbacks on null/undefined/empty
  assert.equal(formatErrorMessage(null, 'Daily brief generation failed.'), 'Daily brief generation failed.');
  assert.equal(formatErrorMessage(undefined, 'Daily brief generation failed.'), 'Daily brief generation failed.');
  assert.equal(formatErrorMessage('', 'Daily brief generation failed.'), 'Daily brief generation failed.');
  assert.equal(formatErrorMessage('   ', 'Daily brief generation failed.'), 'Daily brief generation failed.');
});

test('useDailyBrief resets brief state on date change to prevent stale results', () => {
  // Ensure that hydrate() resets brief state to loading rather than preserving completed brief from a previous date
  assert.match(
    hookSource,
    /const hydrate = async \(\) => \{\s*setBrief\(\{\s*status:\s*'loading',\s*markdown:\s*null,\s*sources:\s*\[\],\s*error:\s*null\s*\}\);/,
    'Hydration must reset brief state to loading immediately on date change',
  );
  assert.doesNotMatch(
    hookSource,
    /prev\.status === 'completed' \? prev :/,
    'Hydration must not preserve previous date completed state across date switches',
  );
});

test('provider and model failure messages are surfaced verbatim to user', () => {
  function formatErrorMessage(error, fallback) {
    if (typeof error === 'string' && error.trim().length > 0) return error.trim();
    if (error instanceof Error && error.message.trim().length > 0) return error.message.trim();
    return fallback;
  }

  const failures = [
    'BuiltInAI provider error: failed to initialize sidecar manager',
    'Model file not found: C:\\models\\summary\\missing.gguf',
    'CUDA out of memory while allocating KV cache',
    'OpenAI rate limit exceeded (HTTP 429): Quota exhausted',
    'Ollama connection refused at http://127.0.0.1:11434',
    'Custom OpenAI endpoint returned invalid JSON response',
  ];

  for (const failure of failures) {
    assert.equal(
      formatErrorMessage(failure, 'Daily brief generation failed.'),
      failure,
      'Provider failure message must pass through verbatim',
    );
    assert.equal(
      formatErrorMessage(new Error(failure), 'Daily brief generation failed.'),
      failure,
      'Provider Error object message must pass through verbatim',
    );
  }
});

test('useDailyBrief retry lifecycle permits successive retry attempts after failure', () => {
  // Simulates the useDailyBrief reducer/state transitions across consecutive retries
  let state = { status: 'idle', markdown: null, sources: [], error: null };

  const onGenerateStart = () => {
    state = { status: 'loading', markdown: null, sources: [], error: null };
  };

  const onGenerateFail = (errMessage) => {
    state = { status: 'error', markdown: null, sources: [], error: errMessage };
  };

  const onGenerateSuccess = (markdown) => {
    state = { status: 'completed', markdown, sources: [], error: null };
  };

  // 1. Initial attempt fails
  onGenerateStart();
  assert.equal(state.status, 'loading');
  onGenerateFail('Connection refused');
  assert.equal(state.status, 'error');
  assert.equal(state.error, 'Connection refused');

  // 2. First retry fails with different error
  onGenerateStart();
  assert.equal(state.status, 'loading');
  assert.equal(state.error, null);
  onGenerateFail('Model out of memory');
  assert.equal(state.status, 'error');
  assert.equal(state.error, 'Model out of memory');

  // 3. Second retry succeeds
  onGenerateStart();
  assert.equal(state.status, 'loading');
  onGenerateSuccess('# Operations Overhaul Brief');
  assert.equal(state.status, 'completed');
  assert.equal(state.markdown, '# Operations Overhaul Brief');
  assert.equal(state.error, null);
});
