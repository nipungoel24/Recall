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
