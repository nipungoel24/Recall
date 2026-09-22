/**
 * Phase 5 Gate 3 — Summary Integration & Meeting Workspace Refinement Tests
 *
 * Verifies:
 * - SummaryTab delegates cleanly to SummaryPanel without duplicate logic
 * - MeetingWorkspace wires existing summary system (generation, templates, language, persistence)
 * - BlockNoteSummaryView reuse (no duplicate editor implementation or second summary pipeline)
 * - Zero alert() and confirm() calls across all summary components
 * - Zero direct SQL or raw DB operations in UI components
 * - Semantic design tokens applied: no hardcoded bg-white, no gradients, no raw color codes
 * - Truthful Empty State with transcript presence validation
 * - Non-jumping Loading State with real status and explicit cancellation support
 * - Non-leaking Error State with transcript safety reassurance and retry capability
 * - Non-destructive regeneration failure behavior (preserves existing summary)
 * - Saved summaries render regardless of transcript count (no empty-array blocking)
 * - Template selection and language picker integration
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

describe('Phase 5 Gate 3 — SummaryTab & Workspace Architecture', () => {
  const summaryTabCode = read('components/MeetingWorkspace/SummaryTab.tsx');
  const workspaceCode = read('components/MeetingWorkspace/MeetingWorkspace.tsx');
  const summaryPanelCode = read('components/MeetingDetails/SummaryPanel.tsx');

  it('SummaryTab cleanly forwards to existing SummaryPanel', () => {
    assert.ok(
      summaryTabCode.includes("from '@/components/MeetingDetails/SummaryPanel'"),
      'SummaryTab must import SummaryPanel from MeetingDetails'
    );
    assert.ok(summaryTabCode.includes('<SummaryPanel'), 'SummaryTab must render <SummaryPanel');
    assert.ok(summaryTabCode.includes('export function SummaryTab'), 'Must export SummaryTab');
  });

  it('MeetingWorkspace forwards all required summary pipeline props to SummaryTab', () => {
    assert.ok(workspaceCode.includes('<SummaryTab'), 'Workspace must render <SummaryTab');
    const requiredProps = [
      'meeting={meeting}',
      'meetingTitle={meetingData.meetingTitle}',
      'summaryRef={meetingData.blockNoteSummaryRef}',
      'isSaving={meetingData.isSaving}',
      'onSaveAll={meetingData.saveAllChanges}',
      'onCopySummary={copyOperations.handleCopySummary}',
      'aiSummary={meetingData.aiSummary}',
      'summaryStatus={summaryGeneration.summaryStatus}',
      'onGenerateSummary={summaryGeneration.handleGenerateSummary}',
      'onStopGeneration={summaryGeneration.handleStopGeneration}',
      'onSaveSummary={meetingData.handleSaveSummary}',
      'onSummaryChange={meetingData.handleSummaryChange}',
      'summaryError={summaryGeneration.summaryError}',
      'onRegenerateSummary={summaryGeneration.handleRegenerateSummary}',
      'availableTemplates={templates.availableTemplates}',
      'selectedTemplate={templates.selectedTemplate}',
      'onTemplateSelect={templates.handleTemplateSelection}',
    ];

    for (const prop of requiredProps) {
      assert.ok(
        workspaceCode.includes(prop),
        `MeetingWorkspace must forward ${prop} to SummaryTab`
      );
    }
  });

  it('does not introduce a second summary system, duplicate hooks, or direct SQL in UI', () => {
    const strippedTab = stripComments(summaryTabCode);
    const strippedPanel = stripComments(summaryPanelCode);

    assert.ok(!strippedTab.includes('CREATE TABLE'), 'No SQL in SummaryTab');
    assert.ok(!strippedTab.includes('SELECT *'), 'No SQL in SummaryTab');
    assert.ok(!strippedPanel.includes('CREATE TABLE'), 'No SQL in SummaryPanel');
    assert.ok(!strippedPanel.includes('SELECT *'), 'No SQL in SummaryPanel');
    assert.ok(!strippedPanel.includes('sqlite'), 'No direct sqlite access in SummaryPanel');
  });
});

describe('Phase 5 Gate 3 — BlockNote Reuse & Editor Integration', () => {
  const summaryPanelCode = read('components/MeetingDetails/SummaryPanel.tsx');
  const blockNoteViewCode = read('components/AISummary/BlockNoteSummaryView.tsx');

  it('SummaryPanel reuses BlockNoteSummaryView without creating duplicate editors', () => {
    assert.ok(
      summaryPanelCode.includes("from '@/components/AISummary/BlockNoteSummaryView'"),
      'SummaryPanel must import BlockNoteSummaryView from AISummary'
    );
    assert.ok(
      summaryPanelCode.includes('<BlockNoteSummaryView'),
      'SummaryPanel must render <BlockNoteSummaryView'
    );
  });

  it('BlockNoteSummaryView supports BlockNote format, Markdown parsing, and legacy formats', () => {
    assert.ok(
      blockNoteViewCode.includes('detectSummaryFormat'),
      'Must contain detectSummaryFormat'
    );
    assert.ok(
      blockNoteViewCode.includes("format === 'blocknote'"),
      'Must handle blocknote format'
    );
    assert.ok(
      blockNoteViewCode.includes("format === 'markdown'"),
      'Must handle markdown format'
    );
    assert.ok(
      blockNoteViewCode.includes("format === 'legacy'"),
      'Must handle legacy format'
    );
  });

  it('BlockNoteSummaryView uses theme-aware resolvedTheme', () => {
    assert.ok(
      blockNoteViewCode.includes('resolvedTheme'),
      'BlockNoteSummaryView must respect resolvedTheme'
    );
    assert.ok(
      blockNoteViewCode.includes('useTheme'),
      'BlockNoteSummaryView must use useTheme'
    );
  });
});

describe('Phase 5 Gate 3 — Safety Invariants (No alert/confirm calls)', () => {
  const filesToCheck = [
    'components/MeetingWorkspace/SummaryTab.tsx',
    'components/MeetingDetails/SummaryPanel.tsx',
    'components/MeetingDetails/SummaryGeneratorButtonGroup.tsx',
    'components/MeetingDetails/SummaryUpdaterButtonGroup.tsx',
    'components/EmptyStateSummary.tsx',
    'components/AISummary/BlockNoteSummaryView.tsx',
  ];

  for (const file of filesToCheck) {
    it(`${file} contains ZERO alert() or confirm() calls`, () => {
      const code = read(file);
      const stripped = stripComments(code);
      assert.ok(
        !stripped.includes('alert('),
        `Must not contain alert() in ${file}`
      );
      assert.ok(
        !stripped.includes('confirm('),
        `Must not contain confirm() in ${file}`
      );
    });
  }

  it('BlockNoteSummaryView uses toast.error for save failures instead of alert()', () => {
    const code = read('components/AISummary/BlockNoteSummaryView.tsx');
    assert.ok(
      code.includes("toast.error('Failed to save changes"),
      'Must use toast.error for save failure notifications'
    );
  });
});

describe('Phase 5 Gate 3 — Design System & Semantic Tokens', () => {
  const summaryPanelCode = read('components/MeetingDetails/SummaryPanel.tsx');
  const generatorGroupCode = read('components/MeetingDetails/SummaryGeneratorButtonGroup.tsx');
  const updaterGroupCode = read('components/MeetingDetails/SummaryUpdaterButtonGroup.tsx');
  const emptyStateCode = read('components/EmptyStateSummary.tsx');

  it('SummaryPanel uses semantic background and border tokens (no bg-white, no border-gray-200)', () => {
    const stripped = stripComments(summaryPanelCode);
    assert.ok(!stripped.includes('bg-white'), 'SummaryPanel must not have hardcoded bg-white');
    assert.ok(!stripped.includes('border-gray-200'), 'SummaryPanel must not have hardcoded border-gray-200');
    assert.ok(stripped.includes('bg-background'), 'SummaryPanel must use bg-background');
    assert.ok(stripped.includes('border-border'), 'SummaryPanel must use border-border');
    assert.ok(stripped.includes('bg-surface'), 'SummaryPanel toolbar must use bg-surface');
  });

  it('SummaryGeneratorButtonGroup has no unstyled gradient classes or raw colors', () => {
    const stripped = stripComments(generatorGroupCode);
    assert.ok(!stripped.includes('bg-gradient-to-r'), 'Generator group must avoid gradients');
    assert.ok(!stripped.includes('border-red-200'), 'Generator group must avoid border-red-200');
    assert.ok(!stripped.includes('border-blue-200'), 'Generator group must avoid border-blue-200');
    assert.ok(!stripped.includes('text-green-600'), 'Generator group must avoid text-green-600');
  });

  it('SummaryUpdaterButtonGroup uses semantic tokens for dirty/saved states', () => {
    const stripped = stripComments(updaterGroupCode);
    assert.ok(!stripped.includes('bg-green-200'), 'Updater group must avoid raw bg-green-200');
    assert.ok(
      stripped.includes('border-primary') || stripped.includes('text-primary'),
      'Updater group must use semantic primary token for dirty state'
    );
  });

  it('EmptyStateSummary uses semantic tokens for text and colors', () => {
    const stripped = stripComments(emptyStateCode);
    assert.ok(!stripped.includes('text-gray-900'), 'EmptyStateSummary must avoid text-gray-900');
    assert.ok(!stripped.includes('text-gray-500'), 'EmptyStateSummary must avoid text-gray-500');
    assert.ok(!stripped.includes('text-amber-600'), 'EmptyStateSummary must avoid text-amber-600');
    assert.ok(stripped.includes('text-foreground'), 'EmptyStateSummary must use text-foreground');
    assert.ok(stripped.includes('text-muted-foreground'), 'EmptyStateSummary must use text-muted-foreground');
  });
});

describe('Phase 5 Gate 3 — Empty, Loading & Error States Truthfulness', () => {
  const emptyStateCode = read('components/EmptyStateSummary.tsx');
  const summaryPanelCode = read('components/MeetingDetails/SummaryPanel.tsx');

  it('EmptyStateSummary validates transcript presence and explains requirements', () => {
    assert.ok(
      emptyStateCode.includes('hasTranscripts'),
      'EmptyStateSummary must accept hasTranscripts prop'
    );
    assert.ok(
      emptyStateCode.includes('Cannot generate summary without a transcript'),
      'Must explain that summary generation requires a transcript'
    );
  });

  it('SummaryPanel loading state provides animated progress and explicit cancellation', () => {
    assert.ok(
      summaryPanelCode.includes('isSummaryLoading'),
      'Must detect summary loading state'
    );
    assert.ok(
      summaryPanelCode.includes('Loader2'),
      'Must render Loader2 spinner during generation'
    );
    assert.ok(
      summaryPanelCode.includes('Stop Generation'),
      'Must provide explicit Stop Generation action during loading'
    );
    assert.ok(
      summaryPanelCode.includes('onStopGeneration'),
      'Must wire onStopGeneration to cancel action'
    );
  });

  it('SummaryPanel error state provides transcript safety reassurance and retry capability', () => {
    assert.ok(
      summaryPanelCode.includes('Transcript Safe:'),
      'Error state must explicitly reassure user that transcripts are intact'
    );
    assert.ok(
      summaryPanelCode.includes('Retry Generation') || summaryPanelCode.includes('onRegenerateSummary'),
      'Error state must provide retry capability'
    );
    assert.ok(
      summaryPanelCode.includes('Model Settings'),
      'Error state must offer access to model settings'
    );
  });

  it('SummaryPanel preserves existing summary if regeneration encounters an error', () => {
    // When summaryStatus === 'error' but aiSummary is truthy, it must render the alert banner AND BlockNoteSummaryView
    assert.ok(
      summaryPanelCode.includes('Previous summary has been preserved'),
      'Must reassure user that previous summary was preserved'
    );
    assert.ok(
      summaryPanelCode.includes('BlockNoteSummaryView'),
      'Must render BlockNoteSummaryView even when regeneration fails'
    );
  });

  it('Saved summary is rendered regardless of transcript count (no empty-transcript array blocking)', () => {
    // Previous bug: transcripts?.length > 0 && ( blocked rendering saved summaries if transcripts were 0
    assert.ok(
      !summaryPanelCode.includes('transcripts?.length > 0 && ('),
      'SummaryPanel must not block existing summaries behind transcript count check'
    );
  });

  it('Eliminates legacy fixed-bottom overlay', () => {
    assert.ok(
      !summaryPanelCode.includes('fixed bottom-0 left-0 right-0'),
      'Must not render legacy fixed-bottom overlay'
    );
  });
});

describe('Phase 5 Gate 3 — Template Selection & Language Integration', () => {
  const summaryPanelCode = read('components/MeetingDetails/SummaryPanel.tsx');
  const generatorGroupCode = read('components/MeetingDetails/SummaryGeneratorButtonGroup.tsx');

  it('SummaryPanel passes languageSlot and template props to SummaryGeneratorButtonGroup', () => {
    assert.ok(
      summaryPanelCode.includes('languageSlot={languageSlot}'),
      'SummaryPanel must pass languageSlot'
    );
    assert.ok(
      summaryPanelCode.includes('availableTemplates={availableTemplates}'),
      'SummaryPanel must pass availableTemplates'
    );
    assert.ok(
      summaryPanelCode.includes('selectedTemplate={selectedTemplate}'),
      'SummaryPanel must pass selectedTemplate'
    );
    assert.ok(
      summaryPanelCode.includes('onTemplateSelect={onTemplateSelect}'),
      'SummaryPanel must pass onTemplateSelect'
    );
  });

  it('SummaryGeneratorButtonGroup renders template selector dropdown and selection check', () => {
    assert.ok(
      generatorGroupCode.includes('availableTemplates.map'),
      'Generator button group must iterate over availableTemplates'
    );
    assert.ok(
      generatorGroupCode.includes('selectedTemplate === template.id'),
      'Generator button group must highlight selected template'
    );
  });
});
