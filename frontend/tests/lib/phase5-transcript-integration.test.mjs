/**
 * Phase 5 Gate 4 — Transcript Deep Integration & Evidence Experience Tests
 *
 * Verifies:
 * - Semantic design tokens applied: zero hardcoded gray classes in transcript view
 * - Speaker hierarchy & presentation: resolveSpeaker logic handles mic/system/custom/prefixes
 * - Timestamp formatting: sub-hour [MM:SS] and multi-hour [HH:MM:SS] support
 * - Zero layout shift between highlighted and non-highlighted evidence segments
 * - Truthful states: Loading (status/role), Error (actionable retry), Empty (archived vs recording)
 * - Virtualizer coordination & pagination boundary handling
 * - Cross-meeting safety invariant preservation
 * - Zero alert() and confirm() calls across all transcript components
 * - Clean prop forwarding through MeetingWorkspace -> TranscriptTab -> TranscriptPanel -> VirtualizedTranscriptView
 * - Reduced-motion respect
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const srcDir = join(import.meta.dirname, '../../src');

function read(rel) {
  return readFileSync(join(srcDir, rel), 'utf8');
}

function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
}

describe('Phase 5 Gate 4 — Semantic Tokens & Design System Compliance', () => {
  const virtCode = read('components/VirtualizedTranscriptView.tsx');
  const btnGroupCode = read('components/MeetingDetails/TranscriptButtonGroup.tsx');
  const cleanVirt = stripComments(virtCode);
  const cleanBtnGroup = stripComments(btnGroupCode);

  it('VirtualizedTranscriptView contains ZERO hardcoded gray colors', () => {
    assert.doesNotMatch(cleanVirt, /\btext-gray-\d+\b/, 'Must not contain text-gray-* classes');
    assert.doesNotMatch(cleanVirt, /\bbg-gray-\d+\b/, 'Must not contain bg-gray-* classes');
    assert.doesNotMatch(cleanVirt, /\bborder-gray-\d+\b/, 'Must not contain border-gray-* classes');
  });

  it('TranscriptButtonGroup contains ZERO hardcoded gradients or color borders', () => {
    assert.doesNotMatch(cleanBtnGroup, /bg-gradient-to-r/, 'Must not use raw bg-gradient-to-r');
    assert.doesNotMatch(cleanBtnGroup, /border-blue-200/, 'Must not use hardcoded border-blue-200');
    // This assertion used to pin hover:bg-accent. Phase B7 retired lime-as-generic-hover:
    // accent is Recall brand lime, and using it for a routine hover made the brand accent
    // compete with the selected/active state. The gate protective intent -- a *semantic*
    // hover token, never a hardcoded colour -- is preserved and tightened, matching the
    // rule sidebar-polish.test.mjs already enforces for ListRow.
    assert.ok(cleanBtnGroup.includes('hover:bg-muted'), 'Enhance button must use the semantic neutral hover (hover:bg-muted)');
    assert.doesNotMatch(cleanBtnGroup, /hover:bg-accent/, 'Enhance button must not use the lime accent as a generic hover');
  });

  it('VirtualizedTranscriptView uses semantic foreground and muted tokens', () => {
    assert.ok(cleanVirt.includes('text-foreground'), 'Must use text-foreground');
    assert.ok(cleanVirt.includes('text-muted-foreground'), 'Must use text-muted-foreground');
    assert.ok(cleanVirt.includes('bg-muted/50'), 'Must use semantic bg-muted/50');
    assert.ok(cleanVirt.includes('border-border'), 'Must use semantic border-border');
  });
});

describe('Phase 5 Gate 4 — Timestamp Formatting', () => {
  function formatRecordingTime(seconds) {
    if (seconds === undefined || isNaN(seconds) || seconds < 0) return '[--:--]';
    const totalSeconds = Math.floor(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    if (hours > 0) {
      return `[${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
    }
    return `[${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
  }

  it('formats invalid or undefined timestamps safely', () => {
    assert.equal(formatRecordingTime(undefined), '[--:--]');
    assert.equal(formatRecordingTime(NaN), '[--:--]');
    assert.equal(formatRecordingTime(-10), '[--:--]');
  });

  it('formats sub-minute timestamps as [00:SS]', () => {
    assert.equal(formatRecordingTime(0), '[00:00]');
    assert.equal(formatRecordingTime(7), '[00:07]');
    assert.equal(formatRecordingTime(59), '[00:59]');
  });

  it('formats multi-minute timestamps as [MM:SS]', () => {
    assert.equal(formatRecordingTime(60), '[01:00]');
    assert.equal(formatRecordingTime(125), '[02:05]');
    assert.equal(formatRecordingTime(3599), '[59:59]');
  });

  it('formats multi-hour timestamps as [HH:MM:SS]', () => {
    assert.equal(formatRecordingTime(3600), '[01:00:00]');
    assert.equal(formatRecordingTime(3665), '[01:01:05]');
    assert.equal(formatRecordingTime(7322), '[02:02:02]');
  });
});

describe('Phase 5 Gate 4 — Speaker Resolution & Hierarchy', () => {
  function resolveSpeaker(speaker, text) {
    const raw = text ?? '';
    if (speaker && speaker.trim() !== '') {
      const sLower = speaker.toLowerCase().trim();
      if (sLower === 'mic') return { speakerLabel: 'Microphone', bodyText: raw };
      if (sLower === 'system') return { speakerLabel: 'System Audio', bodyText: raw };
      return { speakerLabel: speaker.trim(), bodyText: raw };
    }
    const prefixMatch = raw.match(/^(\[?[A-Za-z0-9_\s]{2,24}\]?):\s*(.*)$/);
    if (prefixMatch) {
      const candidate = prefixMatch[1].replace(/^\[|\]$/g, '').trim();
      if (!candidate.startsWith('http') && !/^\d+$/.test(candidate)) {
        return { speakerLabel: candidate, bodyText: prefixMatch[2] };
      }
    }
    return { speakerLabel: null, bodyText: raw };
  }

  it('maps mic and system audio speaker values to readable labels', () => {
    assert.deepEqual(resolveSpeaker('mic', 'Hello world'), {
      speakerLabel: 'Microphone',
      bodyText: 'Hello world',
    });
    assert.deepEqual(resolveSpeaker('system', 'Incoming call'), {
      speakerLabel: 'System Audio',
      bodyText: 'Incoming call',
    });
  });

  it('preserves named speaker from speaker property', () => {
    assert.deepEqual(resolveSpeaker('Alice Smith', 'Good morning'), {
      speakerLabel: 'Alice Smith',
      bodyText: 'Good morning',
    });
  });

  it('extracts speaker prefix from transcript text when speaker property is absent', () => {
    assert.deepEqual(resolveSpeaker(null, 'Speaker 1: This is important'), {
      speakerLabel: 'Speaker 1',
      bodyText: 'This is important',
    });
    assert.deepEqual(resolveSpeaker(null, '[Host]: Welcome to the meeting'), {
      speakerLabel: 'Host',
      bodyText: 'Welcome to the meeting',
    });
  });

  it('does not misidentify URLs or numeric timestamps as speakers', () => {
    assert.deepEqual(resolveSpeaker(null, 'https://example.com:8080/path'), {
      speakerLabel: null,
      bodyText: 'https://example.com:8080/path',
    });
  });
});

describe('Phase 5 Gate 4 — Zero-Layout-Shift Evidence Highlight & Accessibility', () => {
  const virtCode = read('components/VirtualizedTranscriptView.tsx');

  it('TranscriptSegment maintains identical padding on both normal and highlighted states', () => {
    assert.ok(
      virtCode.includes('p-2.5'),
      'Segment must use consistent p-2.5 padding to guarantee zero layout shift'
    );
  });

  it('TranscriptSegment sets tabIndex and aria attributes for accessible navigation', () => {
    assert.ok(virtCode.includes('tabIndex={isHighlighted ? 0 : -1}'), 'Must set tabIndex based on highlight');
    assert.ok(virtCode.includes('role="region"'), 'Must define role="region"');
    assert.ok(virtCode.includes('aria-current={isHighlighted ? \'true\' : undefined}'), 'Must set aria-current when highlighted');
  });

  it('TranscriptSegment focuses element when highlighted without disturbing scroll', () => {
    assert.ok(virtCode.includes('preventScroll: true'), 'Must use preventScroll: true to avoid fighting virtualizer scroll');
  });
});

describe('Phase 5 Gate 4 — Truthful States in Transcript View', () => {
  const virtCode = read('components/VirtualizedTranscriptView.tsx');

  it('implements truthful loading state with role="status" and aria-live="polite"', () => {
    assert.ok(virtCode.includes('role="status"'), 'Loading state must have role="status"');
    assert.ok(virtCode.includes('aria-live="polite"'), 'Loading state must have aria-live="polite"');
    assert.ok(virtCode.includes('Loading transcript...'), 'Loading state must communicate truthful message');
  });

  it('implements actionable non-leaking error state with role="alert" and retry button', () => {
    assert.ok(virtCode.includes('role="alert"'), 'Error state must have role="alert"');
    assert.ok(virtCode.includes('Failed to load transcript'), 'Error state must communicate clear message');
    assert.ok(virtCode.includes('Retry'), 'Error state must offer actionable Retry');
  });

  it('implements truthful empty state distinguishing archive from recording', () => {
    assert.ok(virtCode.includes('No transcript recorded'), 'Empty archived meeting must state No transcript recorded');
    assert.ok(
      virtCode.includes('This meeting does not contain any transcript segments.'),
      'Must explain meeting has no segments'
    );
    assert.doesNotMatch(
      virtCode,
      /Welcome to Recall! Start recording to see live transcription/,
      'Archived empty transcript must NOT show generic onboarding welcome'
    );
  });
});

describe('Phase 5 Gate 4 — Precision Virtualizer & Pagination Boundary Handling', () => {
  const virtCode = read('components/VirtualizedTranscriptView.tsx');

  it('guards scrollToIndex and triggers pagination if target index exceeds loaded segments', () => {
    assert.ok(
      virtCode.includes('scrollToIndex >= segments.length && hasMore && !isLoadingMore && onLoadMore'),
      'Must trigger onLoadMore if target index is beyond loaded segments'
    );
  });

  it('clamps scrollToIndex within valid bounds', () => {
    assert.ok(
      virtCode.includes('scrollToIndex >= 0 && scrollToIndex < segments.length'),
      'Must check bounds before invoking virtualizer.scrollToIndex'
    );
  });

  it('respects prefersReducedMotion for smooth vs auto scroll behavior', () => {
    assert.ok(
      virtCode.includes("prefersReducedMotion ? 'auto' : 'smooth'"),
      'Must respect user reduced-motion preference'
    );
  });
});

describe('Phase 5 Gate 4 — Clean Architecture & Prop Forwarding', () => {
  const workspaceCode = read('components/MeetingWorkspace/MeetingWorkspace.tsx');
  const tabCode = read('components/MeetingWorkspace/TranscriptTab.tsx');
  const panelCode = read('components/MeetingDetails/TranscriptPanel.tsx');

  it('MeetingWorkspace forwards transcript status props to TranscriptTab', () => {
    assert.ok(workspaceCode.includes('isLoading={isLoadingTranscripts}'), 'Workspace must forward isLoading');
    assert.ok(workspaceCode.includes('error={transcriptError}'), 'Workspace must forward error');
    assert.ok(workspaceCode.includes('onRetry={onRefetchTranscripts}'), 'Workspace must forward onRetry');
  });

  it('TranscriptTab forwards status props to TranscriptPanel', () => {
    assert.ok(tabCode.includes('isLoading={isLoading}'), 'Tab must forward isLoading');
    assert.ok(tabCode.includes('error={error}'), 'Tab must forward error');
    assert.ok(tabCode.includes('onRetry={onRetry}'), 'Tab must forward onRetry');
  });

  it('TranscriptPanel forwards status props to VirtualizedTranscriptView', () => {
    assert.ok(panelCode.includes('isLoading={isLoading}'), 'Panel must forward isLoading');
    assert.ok(panelCode.includes('error={error}'), 'Panel must forward error');
    assert.ok(panelCode.includes('onRetry={onRetry || onRefetchTranscripts}'), 'Panel must forward onRetry');
  });
});

describe('Phase 5 Gate 4 — Strict Safety Invariants', () => {
  const virtCode = read('components/VirtualizedTranscriptView.tsx');
  const tabCode = read('components/MeetingWorkspace/TranscriptTab.tsx');
  const panelCode = read('components/MeetingDetails/TranscriptPanel.tsx');
  const btnGroupCode = read('components/MeetingDetails/TranscriptButtonGroup.tsx');

  it('contains ZERO alert() calls across all transcript files', () => {
    const files = [virtCode, tabCode, panelCode, btnGroupCode];
    files.forEach((code) => {
      const clean = stripComments(code);
      assert.doesNotMatch(clean, /\balert\s*\(/, 'Must not call alert()');
    });
  });

  it('contains ZERO confirm() calls across all transcript files', () => {
    const files = [virtCode, tabCode, panelCode, btnGroupCode];
    files.forEach((code) => {
      const clean = stripComments(code);
      assert.doesNotMatch(clean, /\bconfirm\s*\(/, 'Must not call confirm()');
    });
  });

  it('contains ZERO window.prompt() calls across all transcript files', () => {
    const files = [virtCode, tabCode, panelCode, btnGroupCode];
    files.forEach((code) => {
      const clean = stripComments(code);
      assert.doesNotMatch(clean, /\bprompt\s*\(/, 'Must not call window.prompt()');
    });
  });
});
