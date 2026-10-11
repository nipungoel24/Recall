"use client";

import { Summary, SummaryResponse, Transcript } from '@/types';
import { BlockNoteSummaryView, BlockNoteSummaryViewRef } from '@/components/AISummary/BlockNoteSummaryView';
import { EmptyStateSummary } from '@/components/EmptyStateSummary';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { SummaryGeneratorButtonGroup } from './SummaryGeneratorButtonGroup';
import { SummaryUpdaterButtonGroup } from './SummaryUpdaterButtonGroup';
import { useEffect, useRef, useState, RefObject } from 'react';
import { toast } from 'sonner';
import { Languages, ChevronDown, Loader2, Square, AlertTriangle, AlertCircle, RefreshCw, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { LanguagePickerPopover } from '@/components/LanguagePickerPopover';
import { AddToContextButton } from '@/components/Context/AddToContextButton';
import { useRecentLanguages } from '@/hooks/useRecentLanguages';
import { labelForCode } from '@/lib/summary-languages';
import {
  readMeetingSummaryLanguage,
  saveMeetingSummaryLanguage,
  SummaryLanguageStorage,
} from '@/lib/summary-language-preferences';

interface SummaryPanelProps {
  meeting: {
    id: string;
    title: string;
    created_at: string;
  };
  meetingTitle: string;
  onTitleChange: (title: string) => void;
  isEditingTitle: boolean;
  onStartEditTitle: () => void;
  onFinishEditTitle: () => void;
  isTitleDirty: boolean;
  summaryRef: RefObject<BlockNoteSummaryViewRef>;
  isSaving: boolean;
  onSaveAll: () => Promise<void>;
  onCopySummary: () => Promise<void>;
  onOpenFolder: () => Promise<void>;
  aiSummary: Summary | null;
  summaryStatus: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error';
  transcripts: Transcript[];
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;
  onSaveModelConfig: (config?: ModelConfig) => Promise<void>;
  onGenerateSummary: (customPrompt: string) => Promise<void>;
  onStopGeneration: () => void;
  customPrompt: string;
  summaryResponse: SummaryResponse | null;
  onSaveSummary: (summary: Summary | { markdown?: string; summary_json?: any[] }) => Promise<void>;
  onSummaryChange: (summary: Summary) => void;
  onDirtyChange: (isDirty: boolean) => void;
  summaryError: string | null;
  /**
   * Set when LOADING an existing summary failed, as distinct from the meeting
   * having no summary yet. Without this, a backend error renders "No Summary
   * Generated Yet", which tells the user to generate something that may already
   * exist.
   */
  summaryLoadError?: string | null;
  onRegenerateSummary: () => Promise<void>;
  getSummaryStatusMessage: (status: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error') => string;
  availableTemplates: Array<{ id: string, name: string, description: string }>;
  selectedTemplate: string;
  onTemplateSelect: (templateId: string, templateName: string) => void;
  isModelConfigLoading?: boolean;
  onOpenModelSettings?: (openFn: () => void) => void;
  /** Contexts whose saved knowledge is included in AI summaries (contract §8.2). */
  summaryContextIds?: string[];
  onSummaryContextIdsChange?: (contextIds: string[]) => void;
}

export function SummaryPanel({
  meeting,
  meetingTitle,
  isTitleDirty,
  summaryRef,
  isSaving,
  onSaveAll,
  onCopySummary,
  onOpenFolder,
  aiSummary,
  summaryStatus,
  transcripts,
  modelConfig,
  setModelConfig,
  onSaveModelConfig,
  onGenerateSummary,
  onStopGeneration,
  customPrompt,
  summaryResponse,
  onSaveSummary,
  onSummaryChange,
  onDirtyChange,
  summaryError,
  summaryLoadError,
  onRegenerateSummary,
  getSummaryStatusMessage,
  availableTemplates,
  selectedTemplate,
  onTemplateSelect,
  isModelConfigLoading = false,
  onOpenModelSettings,
  summaryContextIds = [],
  onSummaryContextIdsChange
}: SummaryPanelProps) {
  const [summaryLang, setSummaryLang] = useState<string | null>(null);
  const [summaryLangStorage, setSummaryLangStorage] = useState<SummaryLanguageStorage>('metadata');
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const languageLoadVersionRef = useRef(0);
  const activeMeetingIdRef = useRef(meeting.id);
  const languageSaveVersionRef = useRef(0);
  const languageSaveLoopRunningRef = useRef(false);
  const latestLanguageSaveRequestRef = useRef<{
    version: number;
    meetingId: string;
    language: string | null;
    rollback: {
      language: string | null;
      storage: SummaryLanguageStorage;
    };
  } | null>(null);
  activeMeetingIdRef.current = meeting.id;
  const { addRecent } = useRecentLanguages();

  const effectiveLangLabel = summaryLang ? labelForCode(summaryLang) : 'Auto';
  const isLocalFallbackLanguage = summaryLangStorage === 'local_fallback';
  const autoSubtitle = isLocalFallbackLanguage
    ? 'Saved on this device for folderless meetings'
    : 'Uses dominant transcript language';

  useEffect(() => {
    let cancelled = false;
    const loadVersion = languageLoadVersionRef.current + 1;
    languageLoadVersionRef.current = loadVersion;

    const loadSummaryLanguage = async () => {
      try {
        const stored = await readMeetingSummaryLanguage(meeting.id);
        if (!cancelled && languageLoadVersionRef.current === loadVersion) {
          setSummaryLang(stored.language);
          setSummaryLangStorage(stored.storage);
        }
      } catch (err) {
        console.error('Failed to load summary language:', err);
        toast.warning('Could not load saved summary language', {
          description: 'Using Auto until meeting metadata can be read.',
        });
        if (!cancelled && languageLoadVersionRef.current === loadVersion) setSummaryLang(null);
      }
    };

    loadSummaryLanguage();

    return () => {
      cancelled = true;
    };
  }, [meeting.id]);

  const persistLatestLanguageSelection = async () => {
    if (languageSaveLoopRunningRef.current) return;
    languageSaveLoopRunningRef.current = true;

    try {
      while (true) {
        const request = latestLanguageSaveRequestRef.current;
        if (!request) return;

        try {
          const saved = await saveMeetingSummaryLanguage(request.meetingId, request.language);
          const latest = latestLanguageSaveRequestRef.current;
          if (
            latest?.version === request.version &&
            activeMeetingIdRef.current === request.meetingId
          ) {
            setSummaryLang(saved.language);
            setSummaryLangStorage(saved.storage);
            if (saved.storage === 'local_fallback') {
              toast.info('Summary language saved on this device', {
                description: 'This meeting has no recording folder, so the preference cannot be written to meeting metadata.',
              });
            }
            if (request.language) {
              addRecent(request.language);
            }
            return;
          }

          if (latest?.version === request.version) return;
        } catch (err) {
          const latest = latestLanguageSaveRequestRef.current;
          if (
            latest?.version === request.version &&
            activeMeetingIdRef.current === request.meetingId
          ) {
            console.error('Failed to persist summary language:', err);
            toast.error('Failed to save summary language');
            setSummaryLang(request.rollback.language);
            setSummaryLangStorage(request.rollback.storage);
            return;
          }

          console.warn('Ignoring failed stale summary language save:', err);
          if (latest?.version === request.version) return;
        }
      }
    } finally {
      languageSaveLoopRunningRef.current = false;
    }
  };

  const handleLangChange = (code: string | null) => {
    const previous = summaryLang;
    const previousStorage = summaryLangStorage;
    const nextStored = code;
    languageLoadVersionRef.current += 1;
    latestLanguageSaveRequestRef.current = {
      version: languageSaveVersionRef.current + 1,
      meetingId: meeting.id,
      language: nextStored,
      rollback: {
        language: previous,
        storage: previousStorage,
      },
    };
    languageSaveVersionRef.current += 1;
    setSummaryLang(nextStored);
    setLangPickerOpen(false);
    void persistLatestLanguageSelection();
  };

  const isSummaryLoading = summaryStatus === 'processing' || summaryStatus === 'summarizing' || summaryStatus === 'regenerating';

  const languageSlot = (
    <Popover open={langPickerOpen} onOpenChange={setLangPickerOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          title={`Summary language: ${effectiveLangLabel}${isLocalFallbackLanguage ? ' (saved on this device)' : ''}`}
          aria-label="Set summary language"
        >
          <Languages size={18} />
          <span className="hidden lg:inline">{effectiveLangLabel}</span>
          <ChevronDown size={14} className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-auto p-0 border-0 shadow-none bg-transparent"
      >
        <LanguagePickerPopover
          value={summaryLang}
          onChange={handleLangChange}
          onClose={() => setLangPickerOpen(false)}
          autoSubtitle={autoSubtitle}
        />
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-background text-foreground overflow-hidden">
      {/* 1. Workspace Section Action Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface shrink-0 gap-3">
        {/* Left: Context integration affordance */}
        <div className="flex items-center gap-2 min-w-0">
          <AddToContextButton
            meetingId={meeting.id}
            meetingTitle={meetingTitle}
            summaryContextIds={summaryContextIds}
            onSummaryContextIdsChange={onSummaryContextIdsChange}
          />
        </div>

        {/* Right: Summary Generator & Updater Button Groups */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <SummaryGeneratorButtonGroup
            modelConfig={modelConfig}
            setModelConfig={setModelConfig}
            onSaveModelConfig={onSaveModelConfig}
            onGenerateSummary={onGenerateSummary}
            onStopGeneration={onStopGeneration}
            customPrompt={customPrompt}
            summaryStatus={summaryStatus}
            availableTemplates={availableTemplates}
            selectedTemplate={selectedTemplate}
            onTemplateSelect={onTemplateSelect}
            hasTranscripts={transcripts.length > 0}
            hasSummary={!!aiSummary}
            isModelConfigLoading={isModelConfigLoading}
            onOpenModelSettings={onOpenModelSettings}
            languageSlot={languageSlot}
          />

          {aiSummary && !isSummaryLoading && (
            <SummaryUpdaterButtonGroup
              isSaving={isSaving}
              isDirty={isTitleDirty || (summaryRef.current?.isDirty || false)}
              onSave={onSaveAll}
              onCopy={onCopySummary}
              onFind={() => {
                console.log('Find in summary clicked');
              }}
              onOpenFolder={onOpenFolder}
              hasSummary={!!aiSummary}
            />
          )}
        </div>
      </div>

      {/* 2. Workspace Body: Loading, Error, Empty, or Document */}
      {isSummaryLoading ? (
        <div className="flex flex-col items-center justify-center flex-1 p-8 text-center bg-background">
          <div className="flex flex-col items-center max-w-sm">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <h3 className="text-base font-semibold text-foreground mb-1">
              {getSummaryStatusMessage(summaryStatus) || 'Generating AI Summary...'}
            </h3>
            <p className="text-xs text-muted-foreground mb-6">
              Analyzing transcript segments and extracting key takeaways, decisions, and action items.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={onStopGeneration}
              className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              <span>Stop Generation</span>
            </Button>
          </div>
        </div>
      ) : summaryStatus === 'error' && !aiSummary ? (
        <div className="flex flex-col items-center justify-center flex-1 p-8 text-center bg-background">
          <div className="flex flex-col items-center max-w-md p-6 rounded-lg border border-destructive/30 bg-destructive/5">
            <AlertTriangle className="h-8 w-8 text-destructive mb-3" />
            <h3 className="text-base font-semibold text-foreground mb-1.5">
              Summary Generation Failed
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              {summaryError || 'The AI model was unable to generate a summary for this meeting.'}
            </p>
            <div className="rounded border border-border bg-muted/30 px-3 py-2 mb-5 w-full text-left">
              <p className="text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground">Transcript Safe:</span> Your audio recording and transcript remain intact and unaffected.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onGenerateSummary(customPrompt)}
                className="gap-1.5"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry Generation
              </Button>
              {onOpenModelSettings && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenModelSettings(() => {})}
                  className="gap-1.5"
                >
                  <Settings className="h-3.5 w-3.5" />
                  Model Settings
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : !aiSummary && summaryLoadError ? (
        // A failed load must not masquerade as "nothing generated yet".
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <AlertCircle className="h-7 w-7 text-destructive" aria-hidden="true" />
          <div>
            <h2 className="text-title text-foreground">Could not load the summary</h2>
            <p className="mt-1 max-w-sm text-caption text-muted-foreground">{summaryLoadError}</p>
          </div>
          <p className="max-w-sm text-caption text-muted-foreground">
            This meeting may already have a summary. Reload before generating a new one.
          </p>
        </div>
      ) : !aiSummary ? (
        <div className="flex flex-col flex-1 h-full">
          <EmptyStateSummary
            onGenerate={() => onGenerateSummary(customPrompt)}
            hasModel={modelConfig.provider !== null && modelConfig.model !== null}
            isGenerating={isSummaryLoading}
            hasTranscripts={transcripts.length > 0}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0 bg-background">
          <div className="w-full max-w-4xl mx-auto px-6 py-6">
            {summaryStatus === 'error' && summaryError && (
              <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3.5 text-left">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-destructive">
                      Regeneration failed: {summaryError}. Previous summary has been preserved.
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Meeting transcripts and notes are safe.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onRegenerateSummary}
                    className="h-7 px-2 text-xs shrink-0"
                  >
                    Retry
                  </Button>
                </div>
              </div>
            )}
            <BlockNoteSummaryView
              ref={summaryRef}
              summaryData={aiSummary}
              onSave={onSaveSummary}
              onSummaryChange={onSummaryChange}
              onDirtyChange={onDirtyChange}
              status={summaryStatus}
              error={summaryError}
              onRegenerateSummary={() => {
                onRegenerateSummary();
              }}
              meeting={{
                id: meeting.id,
                title: meetingTitle,
                created_at: meeting.created_at,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
