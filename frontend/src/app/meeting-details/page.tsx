'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { MeetingWorkspace } from '@/components/MeetingWorkspace/MeetingWorkspace';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useRouter, useSearchParams } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { ArrowLeft, LoaderIcon } from 'lucide-react';
import { useConfig } from '@/contexts/ConfigContext';
import { usePaginatedTranscripts } from '@/hooks/usePaginatedTranscripts';
import { Skeleton } from '@/components/ui/skeleton';
import { routes } from '@/lib/routes';

interface MeetingDetailsResponse {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  transcripts: any[];
  folder_path?: string;
}

function MeetingDetailsContent() {
  const searchParams = useSearchParams();
  const meetingId = searchParams.get('id');
  const source = searchParams.get('source');
  const { setCurrentMeeting, refetchMeetings, stopSummaryPolling } = useSidebar();
  const { isAutoSummary } = useConfig();
  const router = useRouter();
  const [meetingDetails, setMeetingDetails] = useState<MeetingDetailsResponse | null>(null);
  const [meetingSummary, setMeetingSummary] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Set when loading the summary FAILED. Distinct from a meeting that genuinely
   * has no summary, so the panel never claims "No Summary Generated Yet" when
   * the backend simply failed to answer.
   */
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [shouldAutoGenerate, setShouldAutoGenerate] = useState<boolean>(false);
  const [hasCheckedAutoGen, setHasCheckedAutoGen] = useState<boolean>(false);

  // Use pagination hook for efficient transcript loading
  const {
    metadata,
    segments,
    transcripts,
    isLoading: isLoadingTranscripts,
    isLoadingMore,
    hasMore,
    totalCount,
    loadedCount,
    loadMore,
    refetch,
    error: transcriptError,
  } = usePaginatedTranscripts({ meetingId: meetingId || '' });

  // Check if gemma3:1b model is available in Ollama
  const checkForGemmaModel = useCallback(async (): Promise<boolean> => {
    try {
      const models = await invoke('get_ollama_models', { endpoint: null }) as any[];
      const hasGemma = models.some((m: any) => m.name === 'gemma3:1b');
      console.log('🔍 Checked for gemma3:1b:', hasGemma);
      return hasGemma;
    } catch (error) {
      console.error('❌ Failed to check Ollama models:', error);
      return false;
    }
  }, []);

  // Set up auto-generation - respects DB as source of truth
  const setupAutoGeneration = useCallback(async () => {
    if (hasCheckedAutoGen) return;

    // Only auto-generate if navigated from recording
    if (source !== 'recording') {
      console.log('Not from recording navigation, skipping auto-generation');
      setHasCheckedAutoGen(true);
      return;
    }

    // Respect user's auto-summary toggle preference
    if (!isAutoSummary) {
      console.log('Auto-summary is disabled in settings');
      setHasCheckedAutoGen(true);
      return;
    }

    try {
      // Check what's currently in database
      const currentConfig = await invoke('api_get_model_config') as any;

      // If DB already has a model, use it (never override!)
      if (currentConfig && currentConfig.model) {
        console.log('Using existing model from DB:', currentConfig.model);
        setShouldAutoGenerate(true);
        setHasCheckedAutoGen(true);
        return;
      }

      // DB is empty - check if gemma3:1b exists as fallback
      const hasGemma = await checkForGemmaModel();

      if (hasGemma) {
        console.log('💾 DB empty, using gemma3:1b as initial default');

        await invoke('api_save_model_config', {
          provider: 'ollama',
          model: '',
          whisperModel: 'large-v3',
          apiKey: null,
          ollamaEndpoint: null,
        });

        setShouldAutoGenerate(true);
      } else {
        console.log('⚠️ No model configured and gemma3:1b not found');
      }
    } catch (error) {
      console.error('❌ Failed to setup auto-generation:', error);
    }

    setHasCheckedAutoGen(true);
  }, [hasCheckedAutoGen, checkForGemmaModel, source, isAutoSummary]);

  // Sync meeting metadata from pagination hook to meeting details state
  useEffect(() => {
    if (metadata && (!meetingId || meetingId === 'intro-call')) {
      return;
    }

    if (metadata) {
      console.log('Meeting metadata loaded:', metadata);

      setMeetingDetails({
        id: metadata.id,
        title: metadata.title,
        created_at: metadata.created_at,
        updated_at: metadata.updated_at,
        transcripts: transcripts,
        folder_path: metadata.folder_path,
      });

      setCurrentMeeting({ id: metadata.id, title: metadata.title });
    }
  }, [metadata, transcripts, meetingId, setCurrentMeeting]);

  // Handle transcript loading errors
  useEffect(() => {
    if (transcriptError) {
      console.error('Error loading transcripts:', transcriptError);
      setError(transcriptError);
    }
  }, [transcriptError]);

  // Extract fetchMeetingDetails for use in child components
  const fetchMeetingDetails = useCallback(async () => {
    if (!meetingId || meetingId === 'intro-call') {
      return;
    }
    console.log('fetchMeetingDetails called - pagination hook will handle refetch');
  }, [meetingId]);

  // Reset states when meetingId changes
  useEffect(() => {
    setMeetingDetails(null);
    setMeetingSummary(null);
    setError(null);
    setSummaryError(null);
    setIsLoading(true);
    setHasCheckedAutoGen(false);
    setShouldAutoGenerate(false);
  }, [meetingId]);

  // Cleanup: Stop polling when navigating away from a meeting
  useEffect(() => {
    return () => {
      if (meetingId) {
        console.log('Cleaning up: Stopping summary polling for meeting:', meetingId);
        stopSummaryPolling(meetingId);
      }
    };
  }, [meetingId, stopSummaryPolling]);

  useEffect(() => {
    console.log('MeetingDetails useEffect triggered - meetingId:', meetingId);

    if (!meetingId || meetingId === 'intro-call') {
      console.warn('No valid meeting ID in URL - meetingId:', meetingId);
      setError('No meeting selected');
      setIsLoading(false);
      return;
    }

    console.log('Valid meeting ID found, fetching details for:', meetingId);

    setMeetingDetails(null);
    setMeetingSummary(null);
    setError(null);
    setSummaryError(null);
    setIsLoading(true);

    let stale = false;

    const fetchMeetingSummary = async () => {
      try {
        const summary = await invoke('api_get_summary', {
          meetingId: meetingId,
        }) as any;

        if (stale) return;

        console.log('FETCH SUMMARY: Raw response:', summary);

        if (summary.status === 'idle' || (!summary.data && summary.status === 'error')) {
          console.warn('Meeting summary not found or no summary generated yet:', summary.error || 'idle');
          setMeetingSummary(null);
          return;
        }

        const summaryData = summary.data || {};

        let parsedData = summaryData;
        if (typeof summaryData === 'string') {
          try {
            parsedData = JSON.parse(summaryData);
          } catch (e) {
            parsedData = {};
          }
        }

        console.log('🔍 FETCH SUMMARY: Parsed data:', parsedData);

        // Priority 1: BlockNote JSON format
        if (parsedData.summary_json) {
          setMeetingSummary(parsedData as any);
          return;
        }

        // Priority 2: Markdown format
        if (parsedData.markdown) {
          setMeetingSummary(parsedData as any);
          return;
        }

        // Legacy format - apply formatting
        console.log('LEGACY FORMAT: Detected legacy format, applying section formatting');

        const { MeetingName, _section_order, ...restSummaryData } = parsedData;

        const formattedSummary: any = {};

        const sectionKeys = _section_order || Object.keys(restSummaryData);

        console.log('LEGACY FORMAT: Processing sections:', sectionKeys);

        for (const key of sectionKeys) {
          try {
            const section = restSummaryData[key];
            if (section &&
              typeof section === 'object' &&
              'title' in section &&
              'blocks' in section) {
              const typedSection = section as { title?: string; blocks?: any[] };

              if (Array.isArray(typedSection.blocks)) {
                formattedSummary[key] = {
                  title: typedSection.title || key,
                  blocks: typedSection.blocks.map((block: any) => ({
                    ...block,
                    color: 'default',
                    content: block?.content?.trim() || ''
                  }))
                };
              } else {
                console.warn(`LEGACY FORMAT: Section ${key} has invalid blocks:`, typedSection.blocks);
                formattedSummary[key] = {
                  title: typedSection.title || key,
                  blocks: []
                };
              }
            } else {
              console.warn(`LEGACY FORMAT: Skipping invalid section ${key}:`, section);
            }
          } catch (error) {
            console.warn(`LEGACY FORMAT: Error processing section ${key}:`, error);
          }
        }

        console.log('LEGACY FORMAT: Formatted summary:', formattedSummary);
        setMeetingSummary(formattedSummary);
      } catch (error) {
        if (stale) return;
        console.error('FETCH SUMMARY: Error fetching meeting summary:', error);
        // A failed fetch is not "this meeting has no summary". Recording the
        // failure lets the panel distinguish the two; setting null alone made a
        // backend error render "No Summary Generated Yet".
        setSummaryError(
          error instanceof Error ? error.message : String(error ?? 'Failed to load summary')
        );
        setMeetingSummary(null);
      }
    };

    const loadData = async () => {
      try {
        await fetchMeetingSummary();
      } finally {
        if (!stale) {
          setIsLoading(false);
        }
      }
    };

    loadData();

    return () => {
      stale = true;
    };
  }, [meetingId]);

  // Auto-generation check: runs when meeting is loaded with no summary
  useEffect(() => {
    const checkAutoGen = async () => {
      if (
        meetingDetails &&
        meetingSummary === null &&
        meetingDetails.transcripts &&
        meetingDetails.transcripts.length > 0 &&
        !hasCheckedAutoGen
      ) {
        console.log('No summary found, checking for auto-generation...');
        await setupAutoGeneration();
      }
    };

    checkAutoGen();
  }, [meetingDetails, meetingSummary, hasCheckedAutoGen, setupAutoGeneration]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
            <div className="text-center bg-surface rounded-xl border border-border shadow-sm p-10 max-w-md">
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <button
            onClick={() => router.push(routes.home())}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm font-medium"
          >
            <ArrowLeft className="h-4 w-4" />
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // Show skeleton layout while initial data loads
  if ((isLoading || isLoadingTranscripts) || !meetingDetails) {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="flex h-11 flex-shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
          <button
            type="button"
            onClick={() => router.push(routes.home())}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Home
          </button>
          <span className="h-4 w-px bg-border" />
          <span className="truncate text-sm font-medium text-foreground">
            Loading...
          </span>
        </div>
        <div className="flex flex-1 overflow-hidden">
          <div className="hidden md:flex md:w-1/4 lg:w-1/3 border-r border-border bg-surface flex-col p-4 space-y-3">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
          <div className="flex-1 bg-background p-4 space-y-3">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <MeetingWorkspace
        meeting={meetingDetails}
        summaryData={meetingSummary}
        summaryError={summaryError}
        onMeetingUpdated={async () => {
          await refetchMeetings();
        }}
        onRefetchTranscripts={refetch}
        segments={segments}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        totalCount={totalCount}
        loadedCount={loadedCount}
        onLoadMore={loadMore}
        isLoadingTranscripts={isLoadingTranscripts}
        transcriptError={transcriptError}
      />
    </div>
  );
}

export default function MeetingDetails() {
  return (
    <Suspense fallback={
      <div className="flex h-full items-center justify-center">
        <LoaderIcon className="animate-spin size-6" />
      </div>
    }>
      <MeetingDetailsContent />
    </Suspense>
  );
}