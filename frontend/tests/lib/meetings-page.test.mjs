import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Phase C4/C5/C9 - the Meetings library.
 *
 * Two things are being protected here:
 *
 * 1. Honesty. A2's version of this screen rendered whatever `meetings` held,
 *    and the provider collapsed a failed `api_get_meetings` into an empty
 *    array. The user could not tell "you have no meetings" from "we could not
 *    read your meetings". C5 requires a real loading state, a real error state
 *    with Retry, and never a mock dataset.
 *
 * 2. Density. A meeting archive should read like a professional file list, not
 *    a stack of large cards. One line per meeting, metadata on the right.
 *
 * These assert intent and structure, not class-name spellings.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const PAGE = 'src/app/meetings/page.tsx';
const PROVIDER = 'src/components/Sidebar/SidebarProvider.tsx';

/**
 * Comments are stripped before scanning. This file documents the rules it
 * follows -- "there is no local fixture", "this screen deliberately has no
 * Start Recording button" -- and a naive text search would flag that prose as a
 * violation of the very rule it documents.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('meetings page: real data, no fixtures', () => {
  it('reads meetings from the existing provider, with no second data path', () => {
    const src = read(PAGE);
    assert.match(src, /useSidebar\(\)/, 'the page must consume the existing provider');
    assert.doesNotMatch(src, /invoke\(/, 'the page must not add its own database access path');
  });

  it('contains no mock or sample dataset', () => {
    const src = stripComments(read(PAGE));
    for (const marker of ['SAMPLE', 'FIXTURE', 'MOCK_', 'dummy', 'placeholderMeeting', 'lorem']) {
      assert.doesNotMatch(
        src,
        new RegExp(marker, 'i'),
        `meetings must never fall back to a ${marker} dataset`,
      );
    }
  });

  it('groups meetings chronologically with real date buckets', () => {
    const src = read(PAGE);
    assert.match(src, /today.*yesterday.*week.*earlier/is, 'expected chronological buckets');
    assert.match(src, /toLocaleDateString|toLocaleTimeString/, 'dates must be formatted for the user');
  });
});

describe('meetings page: loading, error and empty are distinct', () => {
  it('renders a loading placeholder while the archive is in flight', () => {
    const src = read(PAGE);
    assert.match(src, /isMeetingsLoading/, 'the page must react to a loading flag');
    assert.match(src, /ListSkeleton/, 'a quiet skeleton must be shown while loading');
  });

  it('renders an error with Retry, and never swallows the failure as an empty list', () => {
    const src = read(PAGE);
    assert.match(src, /meetingsError/, 'the page must react to a load error');
    assert.match(src, /tone="error"/, 'the failure must use the error treatment');
    assert.match(src, /Retry/, 'a failed load must offer Retry');
    assert.match(src, /refetchMeetings/, 'Retry must re-run the real fetch');
  });

  it('does not render the empty state while loading or after an error', () => {
    const src = read(PAGE);
    assert.match(
      src,
      /!meetingsError && !isMeetingsLoading && !hasArchive/,
      'the "no meetings yet" state must be gated on both loaded-and-successful',
    );
  });

  it('the provider records the failure instead of clearing the archive', () => {
    const provider = read(PROVIDER);
    assert.match(provider, /setMeetingsError/, 'the provider must capture a load failure');
    assert.doesNotMatch(
      provider,
      /catch \(error\) \{\s*console\.error\('Error fetching meetings:', error\);\s*setMeetings\(\[\]\);/,
      'a failed fetch must not be collapsed into an empty list',
    );
  });
});

describe('meetings page: density and row hierarchy', () => {
  it('uses the shared row primitive rather than bespoke markup', () => {
    assert.match(read(PAGE), /<ListRow/, 'rows must come from the shared primitive');
  });

  it('renders one line per meeting, with metadata on the row', () => {
    const src = read(PAGE);
    // Title + date + time all on the single row; only a transcript match adds a
    // second line. A per-row date paragraph under every title was the old,
    // twice-as-tall behaviour.
    assert.match(src, /trailing=/, 'date and time must ride on the row');
    assert.match(src, /formatTime\(meeting\.created_at\)/, 'the row must show a time');
    assert.match(src, /formatDate\(meeting\.created_at\)/, 'the row must show a date');
  });

  it('does not wrap every meeting in its own large container', () => {
    const src = read(PAGE);
    assert.doesNotMatch(
      src,
      /<li className="[^"]*\b(border|rounded|shadow)/,
      'archive rows must not become individual cards',
    );
  });
});

describe('meetings page: action hierarchy', () => {
  it('does not add a second recording control', () => {
    // A2 established exactly one recording action application-wide, in the
    // sidebar footer. Meetings must not reintroduce one.
    const src = stripComments(read(PAGE));
    assert.doesNotMatch(
      src,
      /Start Recording|start-recording|handleRecordingToggle/,
      'the archive must not add its own recording action',
    );
  });

  it('keeps its single header action secondary, not primary', () => {
    const src = read(PAGE);
    const actions = src.match(/actions=\{[\s\S]*?\n        \}/);
    assert.ok(actions, 'the header action slot must be identifiable');
    assert.match(actions[0], /variant="outline"/, 'a secondary destination link must not be a filled primary button');
  });

  it('gives the visible label a fuller accessible name', () => {
    const src = read(PAGE);
    assert.match(
      src,
      /aria-label="Open Calendar"/,
      'a short visible label should keep a descriptive accessible name',
    );
  });
});
