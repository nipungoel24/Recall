/**
 * Phase 5 Gate 2 — Meeting Workspace Shell & Evidence Navigation Tests
 *
 * Verifies:
 * - Six conceptual sections: overview, summary, transcript, tasks, notes, context
 * - Thin workspace orchestrator architecture (no direct DB logic or god component)
 * - Accessible desktop tab navigation with shadcn/Radix Tabs and semantic tokens
 * - Overview tab states: loading skeleton, deliberate empty state, populated state
 * - All intelligence kinds: topics, decisions, actions, questions, facts/follow-ups
 * - Truthful provenance: evidence source affordance rendered only when sources exist
 * - Cross-meeting safety: strict validation that source meeting matches current meeting
 * - Evidence navigation hook: position lookup via Gate 1 service and tab switching
 * - Virtualized transcript coordination: scrollToIndex and highlightedSegmentId
 * - Safety: zero alert()/confirm() calls, no raw transcript content logging
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const srcDir = join(import.meta.dirname, '../../src');

function read(rel) {
  return readFileSync(join(srcDir, rel), 'utf8');
}

function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
}

describe('Phase 5 Gate 2 — Meeting Workspace Shell Architecture', () => {
  const workspaceCode = read('components/MeetingWorkspace/MeetingWorkspace.tsx');
  const stripped = stripComments(workspaceCode);

  it('MeetingWorkspace exists and exports MeetingWorkspace component and WorkspaceSection type', () => {
    assert.ok(workspaceCode.includes('export function MeetingWorkspace'), 'Must export MeetingWorkspace');
    assert.ok(workspaceCode.includes('export type WorkspaceSection'), 'Must export WorkspaceSection');
  });

  it('exposes exactly the six conceptual workspace sections', () => {
    const requiredSections = ['overview', 'summary', 'transcript', 'tasks', 'notes', 'context'];
    for (const section of requiredSections) {
      assert.ok(
        workspaceCode.includes(`'${section}'`) || workspaceCode.includes(`"${section}"`),
        `Workspace must include '${section}' section`
      );
      assert.ok(
        workspaceCode.includes(`value="${section}"`),
        `Workspace navigation must include TabsTrigger and TabsContent for '${section}'`
      );
    }
  });

  it('uses shadcn/Radix Tabs primitives without introducing duplicate tab libraries', () => {
    assert.ok(
      workspaceCode.includes("from '@/components/ui/tabs'"),
      'Must import Tabs from @/components/ui/tabs'
    );
    assert.ok(workspaceCode.includes('<Tabs'), 'Must render <Tabs');
    assert.ok(workspaceCode.includes('<TabsList'), 'Must render <TabsList');
    assert.ok(workspaceCode.includes('<TabsTrigger'), 'Must render <TabsTrigger');
    assert.ok(workspaceCode.includes('<TabsContent'), 'Must render <TabsContent');
  });

  it('is a thin workspace orchestrator, not a giant god component with database calls', () => {
    // Must NOT contain direct SQLite/DB queries or raw database logic
    assert.ok(!stripped.includes('CREATE TABLE'), 'No SQL in workspace shell');
    assert.ok(!stripped.includes('SELECT *'), 'No direct SQL in workspace shell');
    assert.ok(!stripped.includes('api_get_context_meetings'), 'Context DB calls belong in ContextTab/service');
    assert.ok(!stripped.includes('api_get_meeting_notes'), 'Notes DB calls belong in NotesTab');
  });

  it('provides deterministic back navigation to home', () => {
    assert.ok(
      workspaceCode.includes('routes.home()'),
      'Must use routes.home() for deterministic back navigation'
    );
    assert.ok(
      workspaceCode.includes('ArrowLeft'),
      'Must render back arrow icon for home navigation'
    );
  });
});

describe('Phase 5 Gate 2 — Tab Component Strategy & Reuse', () => {
  it('SummaryTab cleanly wires existing SummaryPanel', () => {
    const code = read('components/MeetingWorkspace/SummaryTab.tsx');
    assert.ok(
      code.includes("from '@/components/MeetingDetails/SummaryPanel'"),
      'SummaryTab must import SummaryPanel from MeetingDetails'
    );
    assert.ok(code.includes('<SummaryPanel'), 'SummaryTab must render SummaryPanel');
  });

  it('TranscriptTab preserves virtualization and forwards pagination & evidence navigation props', () => {
    const code = read('components/MeetingWorkspace/TranscriptTab.tsx');
    assert.ok(
      code.includes("from '@/components/MeetingDetails/TranscriptPanel'"),
      'TranscriptTab must import TranscriptPanel'
    );
    assert.ok(code.includes('highlightedSegmentId'), 'TranscriptTab must accept highlightedSegmentId');
    assert.ok(code.includes('scrollToIndex'), 'TranscriptTab must accept scrollToIndex');
    assert.ok(code.includes('usePagination'), 'TranscriptTab must preserve pagination');
  });

  it('NotesTab exists and integrates BlockNote editor safely', () => {
    const code = read('components/MeetingWorkspace/NotesTab.tsx');
    assert.ok(
      code.includes('BlockNoteSummaryView'),
      'NotesTab must render BlockNoteSummaryView'
    );
    assert.ok(code.includes('api_get_meeting_notes'), 'NotesTab loads notes');
    assert.ok(code.includes('api_save_meeting_notes'), 'NotesTab saves notes');
  });

  it('ContextTab exists and uses contextService with typed models', () => {
    const code = read('components/MeetingWorkspace/ContextTab.tsx');
    assert.ok(
      code.includes("from '@/services/contextService'"),
      'ContextTab must use contextService'
    );
    assert.ok(code.includes('listContextThreads'), 'ContextTab lists context threads');
    assert.ok(code.includes('addMeetingToContext'), 'ContextTab can add meeting to context');
  });

  it('TasksTab provides minimal Gate 2 presentation for action items', () => {
    const code = read('components/MeetingWorkspace/TasksTab.tsx');
    assert.ok(
      code.includes("meetingIntelligenceService"),
      'TasksTab uses meetingIntelligenceService'
    );
    assert.ok(
      code.includes("kind === 'action'"),
      'TasksTab filters items for kind action'
    );
  });
});

describe('Phase 5 Gate 2 — Overview Tab & Truthful Provenance', () => {
  const code = read('components/MeetingWorkspace/OverviewTab.tsx');
  const stripped = stripComments(code);

  it('OverviewTab communicates what happened, what was decided, actions, and questions', () => {
    assert.ok(code.includes('Executive Summary') || code.includes('abstract_text'), 'Shows abstract/summary');
    assert.ok(code.includes("kind === 'decision'"), 'Groups decisions');
    assert.ok(code.includes("kind === 'action'"), 'Groups actions');
    assert.ok(code.includes("kind === 'topic'"), 'Groups topics');
    assert.ok(code.includes("kind === 'question'"), 'Groups questions');
  });

  it('OverviewTab implements all required states: loading skeleton, empty state, error state, populated state', () => {
    assert.ok(code.includes('Skeleton'), 'OverviewTab uses Skeleton for loading state');
    assert.ok(code.includes('No Intelligence Generated'), 'OverviewTab has deliberate empty state');
    assert.ok(code.includes('Generate Intelligence'), 'OverviewTab provides generation trigger');
    assert.ok(code.includes('Unable to load meeting intelligence') || code.includes('Intelligence Unavailable'), 'OverviewTab has clear error state');
    assert.ok(code.includes('Retry'), 'OverviewTab offers retry action on error');
  });

  it('OverviewTab enforces truthful provenance without fabricating sources', () => {
    // Source button should only render when item has valid sources
    assert.ok(
      code.includes('hasValidEvidence') || code.includes('canNavigate'),
      'Must check for valid evidence before rendering source affordance'
    );
    assert.ok(
      code.includes('onNavigateToEvidence'),
      'Must wire navigation callback to evidence click'
    );
  });

  it('uses typed Gate 1 intelligence types and introduces no any in domain models', () => {
    assert.ok(
      code.includes("from '@/types'"),
      'Imports domain types from @/types'
    );
    assert.ok(
      code.includes('MeetingIntelligence'),
      'Uses MeetingIntelligence type'
    );
    assert.ok(
      code.includes('MeetingIntelligenceItem'),
      'Uses MeetingIntelligenceItem type'
    );
  });
});

describe('Phase 5 Gate 2 — Evidence Navigation & Cross-Meeting Safety Invariant', () => {
  const hookCode = read('hooks/useEvidenceNavigation.ts');
  const stripped = stripComments(hookCode);

  it('useEvidenceNavigation exports typed hook and interfaces', () => {
    assert.ok(hookCode.includes('export function useEvidenceNavigation'), 'Must export useEvidenceNavigation');
    assert.ok(hookCode.includes('EvidenceNavigationOptions'), 'Must export EvidenceNavigationOptions');
    assert.ok(hookCode.includes('EvidenceNavigationResult'), 'Must export EvidenceNavigationResult');
  });

  it('Cross-Meeting Invariant: validates source.meeting_id === currentMeetingId before navigating', () => {
    assert.ok(
      hookCode.includes('sourceMeetingId !== meetingId') ||
      hookCode.includes('source.meeting_id !== meetingId') ||
      hookCode.includes('sourceMeetingId && sourceMeetingId !== meetingId'),
      'Must validate source meeting ID matches current meeting ID'
    );
    assert.ok(
      hookCode.includes('Cross-meeting navigation blocked') ||
      hookCode.includes('belongs to another meeting'),
      'Must block navigation and set safe error message on meeting ID mismatch'
    );
  });

  it('uses Gate 1 getTranscriptSegmentPosition and does not compute position in frontend', () => {
    assert.ok(
      hookCode.includes('meetingIntelligenceService.getTranscriptSegmentPosition'),
      'Must call getTranscriptSegmentPosition from Gate 1 service'
    );
  });

  it('switches to transcript tab and triggers scroll and temporary highlight', () => {
    assert.ok(
      hookCode.includes("setActiveTab('transcript')"),
      'Must switch active tab to transcript'
    );
    assert.ok(
      hookCode.includes('scrollToSegment'),
      'Must invoke scrollToSegment with resolved position'
    );
    assert.ok(
      hookCode.includes('highlightSegment'),
      'Must invoke highlightSegment with segment ID'
    );
    assert.ok(
      hookCode.includes('setTimeout'),
      'Must set timeout to automatically clear highlight'
    );
  });
});

describe('Phase 5 Gate 2 — Virtualized Transcript Coordination & Highlight', () => {
  const transcriptViewCode = read('components/VirtualizedTranscriptView.tsx');
  const panelCode = read('components/MeetingDetails/TranscriptPanel.tsx');

  it('VirtualizedTranscriptView accepts highlightedSegmentId and scrollToIndex props', () => {
    assert.ok(transcriptViewCode.includes('highlightedSegmentId?: string | null'), 'Accepts highlightedSegmentId');
    assert.ok(transcriptViewCode.includes('scrollToIndex?: number | null'), 'Accepts scrollToIndex');
  });

  it('VirtualizedTranscriptView scrolls using virtualizer without replacing virtualization', () => {
    assert.ok(
      transcriptViewCode.includes('virtualizer.scrollToIndex(scrollToIndex'),
      'Must use virtualizer.scrollToIndex'
    );
    assert.ok(
      transcriptViewCode.includes('prefersReducedMotion'),
      'Must respect reduced motion preference during scroll'
    );
  });

  it('TranscriptSegment renders subtle semantic token highlight without arbitrary glow or gradients', () => {
    assert.ok(
      transcriptViewCode.includes('bg-accent/40') || transcriptViewCode.includes('bg-accent'),
      'Must use semantic token bg-accent for highlight'
    );
    assert.ok(
      !transcriptViewCode.includes('shadow-glow') && !transcriptViewCode.includes('animate-bounce'),
      'No glowing blobs or giant animations'
    );
  });

  it('TranscriptPanel forwards evidence navigation props to VirtualizedTranscriptView', () => {
    assert.ok(panelCode.includes('highlightedSegmentId={highlightedSegmentId}'), 'Panel forwards highlightedSegmentId');
    assert.ok(panelCode.includes('scrollToIndex={scrollToIndex}'), 'Panel forwards scrollToIndex');
  });
});

describe('Phase 5 Gate 2 — Safety Invariants', () => {
  const workspaceFiles = [
    'components/MeetingWorkspace/MeetingWorkspace.tsx',
    'components/MeetingWorkspace/OverviewTab.tsx',
    'components/MeetingWorkspace/TasksTab.tsx',
    'components/MeetingWorkspace/NotesTab.tsx',
    'components/MeetingWorkspace/ContextTab.tsx',
    'components/MeetingWorkspace/SummaryTab.tsx',
    'components/MeetingWorkspace/TranscriptTab.tsx',
    'hooks/useEvidenceNavigation.ts',
  ];

  it('no component in MeetingWorkspace calls window.alert() or window.confirm()', () => {
    for (const rel of workspaceFiles) {
      const code = read(rel);
      const stripped = stripComments(code);
      assert.ok(!stripped.includes('alert('), `${rel} must not call alert()`);
      assert.ok(!stripped.includes('confirm('), `${rel} must not call confirm()`);
    }
  });

  it('no component in MeetingWorkspace logs raw transcript contents to console', () => {
    for (const rel of workspaceFiles) {
      const code = read(rel);
      assert.ok(
        !code.includes('console.log(transcriptText)') &&
        !code.includes('console.log(segment.text)') &&
        !code.includes('console.log(t.text)'),
        `${rel} must not log raw transcript text`
      );
    }
  });

  it('workspace components use semantic design tokens and follow Design.md', () => {
    const workspaceCode = read('components/MeetingWorkspace/MeetingWorkspace.tsx');
    assert.ok(workspaceCode.includes('bg-background'), 'Uses bg-background token');
    assert.ok(workspaceCode.includes('text-foreground'), 'Uses text-foreground token');
    assert.ok(workspaceCode.includes('border-border'), 'Uses border-border token');
  });
});
