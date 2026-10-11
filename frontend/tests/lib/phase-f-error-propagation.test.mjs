/**
 * Workstream F regression tests: false-empty states and error propagation.
 *
 * Guards the specific defects where a FAILED operation was rendered as a
 * successful empty result, telling the user their data does not exist when the
 * backend merely failed to answer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = join(process.cwd(), 'src');
const read = (...p) => readFileSync(join(src, ...p), 'utf8');

const sidebar = read('components', 'Sidebar', 'SidebarProvider.tsx');
const meetings = read('app', 'meetings', 'page.tsx');
const details = read('app', 'meeting-details', 'page.tsx');
const panel = read('components', 'MeetingDetails', 'SummaryPanel.tsx');

test('WS-F: a failed search is recorded, not converted to "no results"', () => {
  assert.match(
    sidebar,
    /searchError/,
    'the sidebar must expose a distinct search error state',
  );
  assert.match(
    sidebar,
    /catch \(error\)[\s\S]{0,400}setSearchError\(/,
    'the catch branch must record the failure',
  );

  // The defining defect: clearing results is fine, but clearing results AND
  // leaving no error is what made a failure look like an empty result.
  const catchBlock = sidebar.slice(sidebar.indexOf('const searchTranscripts'));
  const firstCatch = catchBlock.slice(0, catchBlock.indexOf('finally'));
  assert.match(
    firstCatch,
    /setSearchError\(/,
    'clearing results without recording the error is the defect',
  );
});

test('WS-F: the meetings page shows a search failure instead of "No matching meetings"', () => {
  assert.match(
    meetings,
    /searchError/,
    'the meetings page must read the search error state',
  );
  assert.match(
    meetings,
    /Could not search your meetings/,
    'a failed search must be reported, not shown as an empty archive',
  );

  // The empty archive must be suppressed while a search error is showing,
  // otherwise both messages render at once.
  assert.match(
    meetings,
    /!meetingsError && !searchError && hasArchive/,
    'the empty archive state must be suppressed when the search failed',
  );
});

test('WS-F: a failed summary load is not reported as "no summary generated"', () => {
  assert.match(
    details,
    /summaryError/,
    'meeting details must track a summary LOAD error',
  );
  assert.match(
    details,
    /catch \(error\)[\s\S]{0,900}setSummaryError\(/,
    'a failed summary fetch must record the error',
  );

  assert.match(
    panel,
    /summaryLoadError/,
    'the panel must receive the load error separately from the generation error',
  );
  assert.match(
    panel,
    /Could not load the summary/,
    'a failed load must be shown as a failure, distinct from an empty summary',
  );

  // Ordering matters: the load-error branch must be evaluated BEFORE the
  // "no summary" empty state, otherwise the empty state wins.
  const loadErrIdx = panel.indexOf('summaryLoadError ?');
  const emptyIdx = panel.indexOf('<EmptyStateSummary');
  assert.ok(loadErrIdx > -1, 'the load-error branch must exist');
  assert.ok(
    loadErrIdx < emptyIdx,
    'the load-error branch must be checked before the "no summary" empty state',
  );
});

test('WS-F: the generation error and the load error stay distinct', () => {
  // They mean different things: "generating failed" is recoverable by retrying,
  // "loading failed" means the summary may already exist.
  assert.match(panel, /summaryError: string \| null;/);
  assert.match(panel, /summaryLoadError\?: string \| null;/);
  assert.doesNotMatch(
    panel,
    /const summaryError = summaryLoadError/,
    'the two error channels must not be aliased together',
  );
});

test('WS-F: state resets when the meeting or query changes', () => {
  // A stale error surviving into a different meeting would claim the wrong
  // meeting failed.
  const resets = details.match(/setSummaryError\(null\)/g) || [];
  assert.ok(
    resets.length >= 2,
    'summaryLoadError must be reset both on meetingId change and when loading starts',
  );
  assert.match(
    sidebar,
    /if \(!query\.trim\(\)\)[\s\S]{0,200}setSearchError\(null\)/,
    'clearing the query must clear the previous search error',
  );
});