'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  LayoutDashboard,
  FileText,
  MessageSquare,
  CheckSquare2,
  NotebookPen,
  Layers,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

/** Shared tab-trigger treatment so density/active state stay consistent across all six sections. */
const TAB_TRIGGER_CLASS =
  'px-3 py-1 text-xs font-medium transition-colors data-[state=active]:bg-background ' +
  'data-[state=active]:text-foreground data-[state=active]:font-semibold ' +
  'data-[state=active]:shadow-sm focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-ring';

/** Shared panel treatment: full-height flex column, no tab-stop focus ring on the container. */
const TAB_PANEL_CLASS =
  'flex-1 overflow-hidden m-0 flex-col data-[state=active]:flex ' +
  'data-[state=inactive]:hidden focus-visible:outline-none focus-visible:ring-0';
import { routes } from '@/lib/routes';
import { Summary, SummaryResponse, TranscriptSegmentData } from '@/types';
import { toast } from 'sonner';
import { invoke } from '@tauri-apps/api/core';

// Hooks
import { useMeetingData } from '@/hooks/meeting-details/useMeetingData';
import { useSummaryGeneration } from '@/hooks/meeting-details/useSummaryGeneration';
import { useTemplates } from '@/hooks/useTemplates';
import { useCopyOperations } from '@/hooks/meeting-details/useCopyOperations';
import { useMeetingOperations } from '@/hooks/meeting-details/useMeetingOperations';
import { useConfig } from '@/contexts/ConfigContext';
import { useEvidenceNavigation } from '@/hooks/useEvidenceNavigation';
import { ModelConfig } from '@/components/ModelSettingsModal';

// Workspace Tabs
import { OverviewTab } from './OverviewTab';
import { SummaryTab } from './SummaryTab';
import { TranscriptTab } from './TranscriptTab';
import { TasksTab } from './TasksTab';
import { NotesTab } from './NotesTab';
import { ContextTab } from './ContextTab';

export type WorkspaceSection = 'overview' | 'summary' | 'transcript' | 'tasks' | 'notes' | 'context';

export interface MeetingWorkspaceProps {
  meeting: {
    id: string;
    title: string;
    created_at: string;
    updated_at?: string;
    transcripts: any[];
    folder_path?: string;
  };
  summaryData: Summary | null;
  onMeetingUpdated?: () => Promise<void>;
  onRefetchTranscripts?: () => Promise<void>;
  segments?: TranscriptSegmentData[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;
  isLoadingTranscripts?: boolean;
  transcriptError?: string | null;
}

/**
 * MeetingWorkspace — Thin orchestrator for the six-section meeting workspace.
 *
 * Responsibilities:
 * 1. Resolve current meeting identity and desktop orientation bar
 * 2. Manage active workspace section ('overview' | 'summary' | 'transcript' | 'tasks' | 'notes' | 'context')
 * 3. Render accessible desktop navigation using shadcn/Radix Tabs with semantic tokens
 * 4. Coordinate evidence navigation between intelligence items and the virtualized transcript
 * 5. Provide minimal shared state to child tabs without creating a bloated god component
 */
export function MeetingWorkspace({
  meeting,
  summaryData,
  onMeetingUpdated,
  onRefetchTranscripts,
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
  isLoadingTranscripts = false,
  transcriptError = null,
}: MeetingWorkspaceProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<WorkspaceSection>('overview');

  // Shared meeting data and operations
  const meetingData = useMeetingData({ meeting, summaryData, onMeetingUpdated });
  const templates = useTemplates();
  const { modelConfig, setModelConfig } = useConfig();
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [summaryResponse] = useState<SummaryResponse | null>(null);
  const [summaryContextIds, setSummaryContextIds] = useState<string[]>([]);
  const openModelSettingsRef = useRef<(() => void) | null>(null);

  // Evidence Navigation coordination
  const [highlightedSegmentId, setHighlightedSegmentId] = useState<string | null>(null);
  const [scrollToSegmentIndex, setScrollToSegmentIndex] = useState<number | null>(null);

  const {
    navigateToEvidence,
    hasValidEvidence,
    error: evidenceError,
    clearError: clearEvidenceError,
  } = useEvidenceNavigation({
    meetingId: meeting.id,
    activeTab,
    setActiveTab: (tab: WorkspaceSection) => setActiveTab(tab),
    scrollToSegment: (index: number) => setScrollToSegmentIndex(index),
    highlightSegment: (segId: string) => setHighlightedSegmentId(segId),
    clearHighlight: () => setHighlightedSegmentId(null),
  });

  // Surface evidence navigation errors safely via toast
  const handleNavigateToEvidence = useCallback(
    async (item: any) => {
      const ok = await navigateToEvidence(item);
      if (!ok && evidenceError) {
        toast.error(evidenceError);
        clearEvidenceError();
      }
    },
    [navigateToEvidence, evidenceError, clearEvidenceError]
  );

  const handleRegisterModalOpen = useCallback((openFn: () => void) => {
    openModelSettingsRef.current = openFn;
  }, []);

  const handleOpenModelSettings = useCallback(() => {
    if (openModelSettingsRef.current) {
      openModelSettingsRef.current();
    }
  }, []);

  const handleSaveModelConfig = useCallback(async (config?: ModelConfig) => {
    if (!config) return;
    try {
      await invoke('api_save_model_config', {
        provider: config.provider,
        model: config.model,
        whisperModel: config.whisperModel,
        apiKey: config.apiKey ?? null,
        ollamaEndpoint: config.ollamaEndpoint ?? null,
      });
      const { emit } = await import('@tauri-apps/api/event');
      await emit('model-config-updated', config);
      toast.success('Model settings saved successfully');
    } catch (err) {
      console.error('Failed to save model config:', err);
      toast.error('Failed to save model settings');
    }
  }, []);

  const summaryGeneration = useSummaryGeneration({
    meeting,
    transcripts: meetingData.transcripts,
    modelConfig,
    isModelConfigLoading: false,
    selectedTemplate: templates.selectedTemplate,
    contextIds: summaryContextIds,
    onMeetingUpdated,
    updateMeetingTitle: meetingData.updateMeetingTitle,
    setAiSummary: meetingData.setAiSummary,
    onOpenModelSettings: handleOpenModelSettings,
  });

  const copyOperations = useCopyOperations({
    meeting,
    transcripts: meetingData.transcripts,
    meetingTitle: meetingData.meetingTitle,
    aiSummary: meetingData.aiSummary,
    blockNoteSummaryRef: meetingData.blockNoteSummaryRef,
  });

  const meetingOperations = useMeetingOperations({
    meeting,
  });

  const happenedLabel = meeting.created_at
    ? new Date(meeting.created_at).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';

  return (
    <Tabs
      value={activeTab}
      onValueChange={(val) => setActiveTab(val as WorkspaceSection)}
      className="flex flex-col h-screen bg-background text-foreground overflow-hidden"
    >
      <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      {/* 1. Desktop Orientation & Navigation Header */}
      <header className="flex h-12 flex-shrink-0 items-center justify-between border-b border-border bg-surface px-4 gap-4">
        <h1 className="sr-only">{meeting.title}</h1>
        {/* Left: Home navigation and meeting identity */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => router.push(routes.home())}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Back to Home"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Home</span>
          </button>
          <span className="h-4 w-px bg-border" aria-hidden="true" />
          <span
            className="truncate text-sm font-semibold text-foreground max-w-[200px] sm:max-w-[320px] lg:max-w-[480px]"
            title={meeting.title}
          >
            {meeting.title}
          </span>
          {happenedLabel && (
            <>
              <span className="hidden md:inline h-4 w-px bg-border" aria-hidden="true" />
              <span className="hidden md:inline flex-shrink-0 text-xs text-muted-foreground tabular-nums">
                {happenedLabel}
              </span>
            </>
          )}
        </div>

        {/* Right: Six Workspace Tabs Navigation */}
        <TabsList
          aria-label="Meeting workspace sections"
          className="h-9 bg-muted p-1 rounded-md flex-shrink-0"
        >
          <TabsTrigger value="overview" className={TAB_TRIGGER_CLASS}>
            <LayoutDashboard className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="summary" className={TAB_TRIGGER_CLASS}>
            <FileText className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            Summary
          </TabsTrigger>
          <TabsTrigger value="transcript" className={TAB_TRIGGER_CLASS}>
            <MessageSquare className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            Transcript
          </TabsTrigger>
          <TabsTrigger value="tasks" className={TAB_TRIGGER_CLASS}>
            <CheckSquare2 className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            Tasks
          </TabsTrigger>
          <TabsTrigger value="notes" className={TAB_TRIGGER_CLASS}>
            <NotebookPen className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            Notes
          </TabsTrigger>
          <TabsTrigger value="context" className={TAB_TRIGGER_CLASS}>
            <Layers className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            Context
          </TabsTrigger>
        </TabsList>
      </header>

      {/* 2. Workspace Body & Active Tab Panels */}
      <main className="flex-1 overflow-hidden relative flex flex-col">
          {/* Overview */}
          <TabsContent
            value="overview"
            className={TAB_PANEL_CLASS}
          >
            <OverviewTab
              meeting={meeting}
              transcriptsCount={totalCount ?? meetingData.transcripts.length}
              onNavigateToEvidence={handleNavigateToEvidence}
              hasValidEvidence={hasValidEvidence}
            />
          </TabsContent>

          {/* Summary */}
          <TabsContent
            value="summary"
            className={TAB_PANEL_CLASS}
          >
            <SummaryTab
              meeting={meeting}
              meetingTitle={meetingData.meetingTitle}
              onTitleChange={meetingData.handleTitleChange}
              isEditingTitle={meetingData.isEditingTitle}
              onStartEditTitle={() => meetingData.setIsEditingTitle(true)}
              onFinishEditTitle={() => meetingData.setIsEditingTitle(false)}
              isTitleDirty={meetingData.isTitleDirty}
              summaryRef={meetingData.blockNoteSummaryRef}
              isSaving={meetingData.isSaving}
              onSaveAll={meetingData.saveAllChanges}
              onCopySummary={copyOperations.handleCopySummary}
              onOpenFolder={meetingOperations.handleOpenMeetingFolder}
              aiSummary={meetingData.aiSummary}
              summaryStatus={summaryGeneration.summaryStatus}
              transcripts={meetingData.transcripts}
              modelConfig={modelConfig}
              setModelConfig={setModelConfig}
              onSaveModelConfig={handleSaveModelConfig}
              onGenerateSummary={summaryGeneration.handleGenerateSummary}
              onStopGeneration={summaryGeneration.handleStopGeneration}
              customPrompt={customPrompt}
              summaryResponse={summaryResponse}
              onSaveSummary={meetingData.handleSaveSummary}
              onSummaryChange={meetingData.handleSummaryChange}
              onDirtyChange={meetingData.setIsSummaryDirty}
              summaryError={summaryGeneration.summaryError}
              onRegenerateSummary={summaryGeneration.handleRegenerateSummary}
              getSummaryStatusMessage={summaryGeneration.getSummaryStatusMessage}
              availableTemplates={templates.availableTemplates}
              selectedTemplate={templates.selectedTemplate}
              onTemplateSelect={templates.handleTemplateSelection}
              isModelConfigLoading={false}
              onOpenModelSettings={handleRegisterModalOpen}
              summaryContextIds={summaryContextIds}
              onSummaryContextIdsChange={setSummaryContextIds}
            />
          </TabsContent>

          {/* Transcript */}
          <TabsContent
            value="transcript"
            className={TAB_PANEL_CLASS}
          >
            <TranscriptTab
              meeting={meeting}
              transcripts={meetingData.transcripts}
              customPrompt={customPrompt}
              onPromptChange={setCustomPrompt}
              onCopyTranscript={copyOperations.handleCopyTranscript}
              onOpenMeetingFolder={meetingOperations.handleOpenMeetingFolder}
              isRecording={false}
              usePagination={true}
              segments={segments}
              hasMore={hasMore}
              isLoadingMore={isLoadingMore}
              totalCount={totalCount}
              loadedCount={loadedCount}
              onLoadMore={onLoadMore}
              onRefetchTranscripts={onRefetchTranscripts}
              highlightedSegmentId={highlightedSegmentId}
              scrollToIndex={scrollToSegmentIndex}
              isLoading={isLoadingTranscripts}
              error={transcriptError}
              onRetry={onRefetchTranscripts}
            />
          </TabsContent>

          {/* Tasks */}
          <TabsContent
            value="tasks"
            className={TAB_PANEL_CLASS}
          >
            <TasksTab
              meeting={meeting}
              onNavigateToEvidence={handleNavigateToEvidence}
              hasValidEvidence={hasValidEvidence}
            />
          </TabsContent>

          {/* Notes */}
          <TabsContent
            value="notes"
            className={TAB_PANEL_CLASS}
          >
            <NotesTab meeting={meeting} />
          </TabsContent>

          {/* Context */}
          <TabsContent value="context" className={TAB_PANEL_CLASS}>
            <ContextTab meeting={meeting} />
          </TabsContent>
      </main>
      </div>
    </Tabs>
  );
}
