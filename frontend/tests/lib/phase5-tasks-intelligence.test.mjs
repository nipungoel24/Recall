/**
 * Phase 5 Gate 5 — Meeting Action Items Intelligence Tests
 *
 * Verifies:
 * - TasksTab fetches BOTH getMeetingIntelligence AND getMeetingIntelligenceItems
 * - State separation: intelligence-not-generated vs. intelligence-ran-but-no-actions
 * - Action item filtering: only kind === 'action' surfaces as tasks
 * - Non-action intelligence kinds do NOT appear as tasks
 * - Truthful provenance: evidence button only rendered when sources exist
 * - AI sourcing disclosure: copy clearly states AI-extracted nature
 * - Safety invariants: zero alert()/confirm(), no raw transcript logging
 * - Architecture: uses meetingIntelligenceService, no SQL in component
 * - Accessibility: role="alert" on error state
 * - Design tokens: semantic tokens only
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
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/.*/g, '');
}

describe('Phase 5 Gate 5 — TasksTab Intelligence State Separation', () => {
  const code = read('components/MeetingWorkspace/TasksTab.tsx');

  it('TasksTab calls getMeetingIntelligence to detect whether intelligence has been generated', () => {
    assert.ok(
      code.includes('getMeetingIntelligence(meeting.id)'),
      'TasksTab must call getMeetingIntelligence to determine if intelligence exists'
    );
  });

  it('TasksTab calls getMeetingIntelligenceItems to fetch action items', () => {
    assert.ok(
      code.includes('getMeetingIntelligenceItems(meeting.id)'),
      'TasksTab must call getMeetingIntelligenceItems'
    );
  });

  it('TasksTab runs both calls in parallel via Promise.all', () => {
    assert.ok(
      code.includes('Promise.all'),
      'TasksTab must fetch intelligence and items in parallel using Promise.all'
    );
  });

  it('TasksTab maintains intelligence state to distinguish no-intelligence from no-actions', () => {
    assert.ok(
      code.includes('setIntelligence('),
      'TasksTab must maintain intelligence state'
    );
    assert.ok(
      code.includes('intelligence === null'),
      'TasksTab must render no-intelligence state when intelligence is null'
    );
  });

  it('no-intelligence state shows Generate Intelligence trigger, not "No Action Items Found"', () => {
    assert.ok(
      code.includes('No Intelligence Generated'),
      'No-intelligence state must say "No Intelligence Generated"'
    );
    assert.ok(
      code.includes('Generate Intelligence'),
      'No-intelligence state must provide Generate Intelligence button'
    );
    assert.ok(
      !code.includes('No Action Items Found'),
      'Old conflated empty state copy must be removed'
    );
  });

  it('no-actions state (intelligence ran, no actions found) shows truthful copy distinct from no-intelligence', () => {
    assert.ok(
      code.includes('No Action Items Identified'),
      'When intelligence ran but found no actions, must say "No Action Items Identified"'
    );
    assert.ok(
      code.includes('Recall did not identify action items'),
      'Must use truthful copy that Recall did not find actions (not that actions do not exist)'
    );
  });
});

describe('Phase 5 Gate 5 — Action Item Filtering & Semantics', () => {
  const code = read('components/MeetingWorkspace/TasksTab.tsx');

  it('filters intelligence items to only kind === action', () => {
    assert.ok(
      code.includes("kind === 'action'"),
      'TasksTab must filter items to kind === action only'
    );
  });

  it('does not reference topic, decision, question, fact, or follow_up as task kinds', () => {
    const stripped = stripComments(code);
    // These should not appear as kind filters in the task component
    assert.ok(
      !stripped.includes("kind === 'topic'"),
      'TasksTab must not filter for topic kind'
    );
    assert.ok(
      !stripped.includes("kind === 'decision'"),
      'TasksTab must not filter for decision kind'
    );
    assert.ok(
      !stripped.includes("kind === 'question'"),
      'TasksTab must not filter for question kind'
    );
  });

  it('shows AI sourcing disclosure so users understand items are AI-extracted', () => {
    assert.ok(
      code.includes('AI-extracted') || code.includes('AI-derived') || code.includes('AI extracted'),
      'TasksTab must disclose that action items are AI-extracted'
    );
  });

  it('displays confidence when available using tabular-nums formatting', () => {
    assert.ok(
      code.includes('task.confidence'),
      'TasksTab must display confidence when available'
    );
    assert.ok(
      code.includes('tabular-nums'),
      'Confidence must use tabular-nums for alignment'
    );
  });
});

describe('Phase 5 Gate 5 — Provenance & Evidence Navigation', () => {
  const code = read('components/MeetingWorkspace/TasksTab.tsx');

  it('evidence button only renders when hasValidEvidence or sources.length > 0', () => {
    assert.ok(
      code.includes('canNavigate'),
      'Must compute canNavigate before rendering evidence button'
    );
    assert.ok(
      code.includes('hasValidEvidence'),
      'Must use hasValidEvidence prop when provided'
    );
    assert.ok(
      code.includes('task.sources && task.sources.length > 0'),
      'Must fall back to checking sources array directly'
    );
  });

  it('evidence button invokes onNavigateToEvidence callback with the task item', () => {
    assert.ok(
      code.includes('onNavigateToEvidence(task)'),
      'Evidence button must call onNavigateToEvidence with the task'
    );
  });

  it('evidence button has accessible aria-label describing the target item', () => {
    assert.ok(
      code.includes('aria-label='),
      'Evidence button must have aria-label attribute'
    );
    assert.ok(
      code.includes('transcript evidence for'),
      'aria-label must describe transcript evidence'
    );
  });
});

describe('Phase 5 Gate 5 — Truthful All States Coverage', () => {
  const code = read('components/MeetingWorkspace/TasksTab.tsx');

  it('loading state uses Skeleton components', () => {
    assert.ok(code.includes('Skeleton'), 'Loading state must use Skeleton');
  });

  it('error state has role="alert" for screen reader announcement', () => {
    assert.ok(
      code.includes('role="alert"'),
      'Error div must have role="alert"'
    );
  });

  it('error state shows retry button wired to loadTasks', () => {
    assert.ok(code.includes('onClick={loadTasks}'), 'Retry must call loadTasks');
    assert.ok(code.includes('Retry'), 'Retry button text must be present');
  });

  it('generate button shows loading indicator when isGenerating is true', () => {
    assert.ok(
      code.includes('isGenerating'),
      'TasksTab must track isGenerating state'
    );
    assert.ok(
      code.includes('Generating Intelligence...'),
      'Generate button must show loading copy when generating'
    );
  });

  it('generate button is disabled while generating to prevent double-submission', () => {
    assert.ok(
      code.includes('disabled={isGenerating}'),
      'Generate button must be disabled while isGenerating'
    );
  });
});

describe('Phase 5 Gate 5 — Architecture & Strict Safety Invariants', () => {
  const code = read('components/MeetingWorkspace/TasksTab.tsx');
  const stripped = stripComments(code);

  it('uses meetingIntelligenceService, not a second intelligence pipeline', () => {
    assert.ok(
      code.includes("from '@/services/meetingIntelligenceService'"),
      'Must import from meetingIntelligenceService'
    );
  });

  it('contains ZERO alert() calls', () => {
    assert.ok(!stripped.includes('alert('), 'No alert() calls');
  });

  it('contains ZERO confirm() calls', () => {
    assert.ok(!stripped.includes('confirm('), 'No confirm() calls');
  });

  it('contains ZERO window.prompt() calls', () => {
    assert.ok(!stripped.includes('window.prompt('), 'No window.prompt() calls');
  });

  it('does not log raw transcript content', () => {
    assert.ok(!code.includes('console.log(task.text)'), 'Must not log raw task text');
    assert.ok(!code.includes('console.log(transcript'), 'Must not log transcript');
  });

  it('contains ZERO SQL queries', () => {
    assert.ok(!stripped.includes('SELECT'), 'No SQL in TasksTab');
    assert.ok(!stripped.includes('INSERT'), 'No SQL in TasksTab');
    assert.ok(!stripped.includes('CREATE TABLE'), 'No SQL in TasksTab');
  });
});

describe('Phase 5 Gate 5 — Design System Compliance', () => {
  const code = read('components/MeetingWorkspace/TasksTab.tsx');

  it('uses semantic background token bg-background', () => {
    assert.ok(code.includes('bg-background'), 'Must use bg-background');
  });

  it('uses semantic text tokens text-foreground and text-muted-foreground', () => {
    assert.ok(code.includes('text-foreground'), 'Must use text-foreground');
    assert.ok(code.includes('text-muted-foreground'), 'Must use text-muted-foreground');
  });

  it('uses semantic border token border-border', () => {
    assert.ok(code.includes('border-border'), 'Must use border-border');
  });

  it('contains ZERO hardcoded gray classes', () => {
    const grayPattern = /\bgray-\d+\b/g;
    assert.ok(!grayPattern.test(code), 'Must not use hardcoded gray- color classes');
  });

  it('contains ZERO hardcoded gradient classes', () => {
    assert.ok(!code.includes('bg-gradient-to-'), 'No hardcoded gradients');
  });
});

describe('Phase 5 Gate 5 — Gate 2 Regression: Existing Workspace Tests Still Pass', () => {
  const workspaceCode = read('components/MeetingWorkspace/MeetingWorkspace.tsx');

  it('MeetingWorkspace still renders TasksTab with correct props', () => {
    assert.ok(
      workspaceCode.includes('<TasksTab'),
      'MeetingWorkspace must render TasksTab'
    );
    assert.ok(
      workspaceCode.includes('onNavigateToEvidence={handleNavigateToEvidence}'),
      'MeetingWorkspace must pass onNavigateToEvidence to TasksTab'
    );
    assert.ok(
      workspaceCode.includes('hasValidEvidence={hasValidEvidence}'),
      'MeetingWorkspace must pass hasValidEvidence to TasksTab'
    );
  });

  it('TasksTab interface still accepts onNavigateToEvidence and hasValidEvidence props', () => {
    const code = read('components/MeetingWorkspace/TasksTab.tsx');
    assert.ok(code.includes('onNavigateToEvidence?:'), 'Must accept onNavigateToEvidence prop');
    assert.ok(code.includes('hasValidEvidence?:'), 'Must accept hasValidEvidence prop');
  });
});
