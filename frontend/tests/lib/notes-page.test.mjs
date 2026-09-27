import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Phase C6 - the Meeting Notes index.
 *
 * The problem this file exists to prevent: /notes was visually identical to
 * /meetings (same title treatment, same date grouping, same row shape, same
 * trailing date), so the two sidebar destinations were indistinguishable.
 *
 * The constraint that shapes the solution: `meeting_notes` currently holds zero
 * rows, and there is no read-only query for note presence. Phase C may not add a
 * backend command, duplicate the notes persistence system, or invent note
 * content. So the screen is differentiated by INFORMATION ARCHITECTURE and by
 * saying something true, not by faking a "has notes" indicator.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const NOTES = 'src/app/notes/page.tsx';
const MEETINGS = 'src/app/meetings/page.tsx';

describe('notes page: differentiated from meetings', () => {
  it('uses a narrower measure than the meetings archive', () => {
    const notes = read(NOTES);
    const meetings = read(MEETINGS);
    const noteWidth = (notes.match(/className="(max-w-[^"]*)"/) || [])[1];
    const meetingWidth = (meetings.match(/className="(max-w-[^"]*)"/) || [])[1];
    assert.ok(noteWidth, 'the notes screen must declare a measure');
    assert.ok(meetingWidth, 'the meetings screen must declare a measure');
    assert.notEqual(
      noteWidth,
      meetingWidth,
      'notes and meetings must not share an identical measure',
    );
  });

  it('names the destination on the row instead of repeating a date', () => {
    const src = read(NOTES);
    assert.match(
      src,
      /Notes\s*(?:\}?\s*<ChevronRight|\{?Notes)/,
      'a notes row should say where it leads',
    );
    assert.match(src, /ChevronRight/, 'the row should carry a directional affordance');
  });

  it('explains the per-meeting notes model in the header', () => {
    const src = read(NOTES);
    assert.match(src, /title="Meeting Notes"/, 'the notes screen must be titled as notes');
    assert.match(
      src,
      /description=/,
      'the one genuinely non-obvious fact (notes live in a meeting) belongs in the header',
    );
  });

  it('does not duplicate the meetings header copy', () => {
    const notes = read(NOTES);
    const meetings = read(MEETINGS);
    const notesDesc = (notes.match(/description="([^"]*)"/) || [])[1];
    const meetingsDesc = (meetings.match(/description="([^"]*)"/) || [])[1];
    assert.notEqual(
      notesDesc,
      meetingsDesc,
      'the two screens must not share identical descriptive copy',
    );
  });
});

describe('notes page: honest about note state', () => {
  it('states plainly that no notes exist yet rather than implying otherwise', () => {
    const src = read(NOTES);
    assert.match(
      src,
      /No meeting has notes written yet/,
      'with zero note rows the screen should say so instead of implying notes exist',
    );
  });

  it('does not fake a note-presence indicator', () => {
    const src = read(NOTES);
    for (const marker of ['hasNotes', 'notesCount', 'noteCount', 'SAMPLE_NOTES', 'sampleNote']) {
      assert.doesNotMatch(
        src,
        new RegExp(marker),
        `notes must not invent a presence signal (${marker}); there is no query for it`,
      );
    }
  });

  it('invents no note content', () => {
    const src = read(NOTES);
    assert.doesNotMatch(src, /dangerouslySetInnerHTML/, 'notes must never inject unescaped content');
    for (const marker of ['SAMPLE', 'FIXTURE', 'lorem', 'dummy']) {
      assert.doesNotMatch(src, new RegExp(marker, 'i'), `no ${marker} note content`);
    }
  });
});

describe('notes page: stays a navigation surface', () => {
  it('each row deep-links into that meeting notes tab', () => {
    const src = read(NOTES);
    assert.match(
      src,
      /meetingSection\(meeting\.id, 'notes'\)/,
      'a notes row must open the real per-meeting notes destination',
    );
  });

  it('does not introduce a second editor or persistence path', () => {
    const src = read(NOTES);
    assert.doesNotMatch(src, /invoke\(/, 'the index must not read or write notes itself');
    assert.doesNotMatch(src, /api_save_meeting_notes|api_get_meeting_notes/, 'no direct notes persistence here');
    assert.doesNotMatch(src, /BlockNote|Editor/, 'the index must not embed a second editor');
  });

  it('handles load failure and loading like the rest of the app', () => {
    const src = read(NOTES);
    assert.match(src, /meetingsError/, 'notes must react to a load error');
    assert.match(src, /isMeetingsLoading/, 'notes must react to loading');
  });
});
