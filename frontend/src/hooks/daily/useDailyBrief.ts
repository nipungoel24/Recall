import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Transcript } from '@/types';
import type { DailyBriefState, DailyBriefStatusResponse, DailyMeeting } from '@/types/daily';
import {
  buildDailyBriefTranscriptText,
  DAILY_BRIEF_PROMPT,
  legacySummaryToMarkdown,
  normalizeBriefResult,
} from '@/lib/daily/timeline';
import {
  cancelDailyBrief,
  cancelLegacyDailyBrief,
  DailyBriefCommandUnavailableError,
  fetchAllTranscripts,
  getDailyBriefStatus,
  getLegacyDailyBriefStatus,
  requestDailyBrief,
  startLegacyDailyBrief,
} from '@/services/dailyService';

const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 200; // ~16.5 minutes, mirrors the existing summary polling budget

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface UseDailyBriefOptions {
  dateKey: string | null;
  meetings: DailyMeeting[];
}

interface UseDailyBriefResult {
  brief: DailyBriefState;
  generate: () => Promise<void>;
  cancel: () => Promise<void>;
  hasBrief: boolean;
}

/**
 * Orchestrates combined daily brief generation.
 *
 * Prefers the dedicated daily brief backend (see dailyService.ts contract)
 * and transparently falls back to the existing per-meeting summary pipeline
 * when those commands are not available yet.
 */
export function useDailyBrief({ dateKey, meetings }: UseDailyBriefOptions): UseDailyBriefResult {
  const [brief, setBrief] = useState<DailyBriefState>({
    status: 'idle',
    markdown: null,
    sources: [],
    error: null,
  });

  const cancelledRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const meetingsRef = useRef<DailyMeeting[]>(meetings);
  const dateKeyRef = useRef<string | null>(dateKey);
  meetingsRef.current = meetings;
  dateKeyRef.current = dateKey;

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const stopPolling = useCallback(() => {
    cancelledRef.current = true;
    clearPollTimer();
  }, [clearPollTimer]);

  const fallbackSources = useCallback(
    () => meetingsRef.current.map((m) => ({ meetingId: m.id, title: m.title })),
    [],
  );

  const pollStatus = useCallback(
    async (
      tick: () => Promise<DailyBriefStatusResponse>,
    ): Promise<DailyBriefStatusResponse> => {
      let result: DailyBriefStatusResponse = { status: 'processing' };
      for (let poll = 0; poll < MAX_POLLS; poll++) {
        if (cancelledRef.current) {
          result = { status: 'cancelled' };
          break;
        }
        await sleep(POLL_INTERVAL_MS);
        if (cancelledRef.current) {
          result = { status: 'cancelled' };
          break;
        }
        try {
          result = await tick();
        } catch (error) {
          console.error('Daily brief poll failed:', error);
          result = {
            status: 'failed',
            error: error instanceof Error ? error.message : 'Daily brief poll failed',
          };
          break;
        }
        const status = String(result.status ?? '').toLowerCase();
        if (status === 'completed' || status === 'failed' || status === 'error' || status === 'cancelled') {
          break;
        }
        if (status === 'idle' && poll > 0) {
          // Process disappeared without completing.
          break;
        }
      }
      return result;
    },
    [],
  );

  const finishFromStatus = useCallback(
    (result: DailyBriefStatusResponse) => {
      const status = String(result.status ?? '').toLowerCase();

      if (status === 'cancelled') {
        setBrief({ status: 'idle', markdown: null, sources: [], error: null });
        return;
      }

      if (status !== 'completed') {
        const message = result.error || 'Daily brief generation failed.';
        setBrief({ status: 'error', markdown: null, sources: [], error: message });
        return;
      }

      const normalized = normalizeBriefResult(result.data ?? result, fallbackSources());
      let markdown = normalized?.markdown ?? null;
      const sources = normalized?.sources ?? fallbackSources();

      if (!markdown && result.data) {
        const legacy = legacySummaryToMarkdown(result.data as Record<string, unknown>);
        if (legacy) markdown = legacy;
      }

      if (!markdown) {
        setBrief({
          status: 'error',
          markdown: null,
          sources: [],
          error: 'Daily brief completed but returned empty content.',
        });
        return;
      }

      setBrief({ status: 'completed', markdown, sources, error: null });
    },
    [fallbackSources],
  );

  const generateViaLegacyPipeline = useCallback(async () => {
    const currentDateKey = dateKeyRef.current;
    const currentMeetings = meetingsRef.current;
    if (!currentDateKey) return;

    let config: { provider?: string | null; model?: string | null };
    try {
      config = (await invoke('api_get_model_config')) as typeof config;
    } catch (error) {
      console.error('Failed to load model config for daily brief:', error);
      setBrief({
        status: 'error',
        markdown: null,
        sources: [],
        error: 'Failed to load summary model configuration.',
      });
      return;
    }

    const provider = config?.provider ?? null;
    const model = config?.model ?? null;
    if (!provider || !model) {
      setBrief({
        status: 'error',
        markdown: null,
        sources: [],
        error: 'No summary model configured. Set one in Settings before generating a daily brief.',
      });
      return;
    }

    const transcriptResults = await Promise.allSettled(
      currentMeetings.map((meeting) => fetchAllTranscripts(meeting.id)),
    );

    const transcriptsByMeeting = new Map<string, Transcript[]>();
    currentMeetings.forEach((meeting, index) => {
      const result = transcriptResults[index];
      transcriptsByMeeting.set(
        meeting.id,
        result && result.status === 'fulfilled' ? result.value : [],
      );
    });

    const text = buildDailyBriefTranscriptText(currentMeetings, transcriptsByMeeting);
    if (!text.trim()) {
      setBrief({
        status: 'error',
        markdown: null,
        sources: [],
        error: 'None of the meetings on this day have transcripts yet.',
      });
      return;
    }

    try {
      const { processId } = await startLegacyDailyBrief(
        currentDateKey,
        text,
        provider,
        model,
        DAILY_BRIEF_PROMPT,
      );
      console.log('Legacy daily brief started:', processId);
    } catch (error) {
      console.error('Failed to start legacy daily brief:', error);
      setBrief({
        status: 'error',
        markdown: null,
        sources: [],
        error: error instanceof Error ? error.message : 'Failed to start daily brief generation.',
      });
      return;
    }

    const result = await pollStatus(() => getLegacyDailyBriefStatus(currentDateKey));
    finishFromStatus(result);
  }, [pollStatus, finishFromStatus]);

  const generate = useCallback(async () => {
    const currentDateKey = dateKeyRef.current;
    const currentMeetings = meetingsRef.current;
    if (!currentDateKey) return;

    if (currentMeetings.length === 0) {
      setBrief({
        status: 'error',
        markdown: null,
        sources: [],
        error: 'No meetings on this day to summarize.',
      });
      return;
    }

    stopPolling();
    cancelledRef.current = false;
    setBrief({ status: 'generating', markdown: null, sources: [], error: null });

    try {
      const { processId } = await requestDailyBrief(
        currentDateKey,
        currentMeetings.map((m) => m.id),
      );
      console.log('Daily brief started:', processId);
      const result = await pollStatus(() => getDailyBriefStatus(currentDateKey));
      finishFromStatus(result);
    } catch (error) {
      if (error instanceof DailyBriefCommandUnavailableError) {
        console.info(error.message);
        await generateViaLegacyPipeline();
        return;
      }
      console.error('Daily brief generation failed:', error);
      setBrief({
        status: 'error',
        markdown: null,
        sources: [],
        error: error instanceof Error ? error.message : 'Daily brief generation failed.',
      });
    }
  }, [stopPolling, pollStatus, finishFromStatus, generateViaLegacyPipeline]);

  const cancel = useCallback(async () => {
    stopPolling();
    const currentDateKey = dateKeyRef.current;
    if (currentDateKey) {
      await cancelDailyBrief(currentDateKey);
      await cancelLegacyDailyBrief(currentDateKey);
    }
    setBrief({ status: 'idle', markdown: null, sources: [], error: null });
  }, [stopPolling]);

  // Hydrate: restore an existing brief (or a running generation) on mount.
  useEffect(() => {
    let cancelled = false;
    const currentDateKey = dateKey;

    if (!currentDateKey) {
      setBrief({ status: 'idle', markdown: null, sources: [], error: null });
      return;
    }

    const hydrate = async () => {
      setBrief((prev) =>
        prev.status === 'completed' ? prev : { status: 'loading', markdown: null, sources: [], error: null },
      );

      try {
        const result = await getDailyBriefStatus(currentDateKey);
        if (cancelled) return;
        const status = String(result.status ?? '').toLowerCase();
        if (status === 'completed') {
          finishFromStatus(result);
          return;
        }
        if (status === 'processing') {
          cancelledRef.current = false;
          const finalResult = await pollStatus(() => getDailyBriefStatus(currentDateKey));
          if (!cancelled) finishFromStatus(finalResult);
          return;
        }
        setBrief({ status: 'idle', markdown: null, sources: [], error: null });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof DailyBriefCommandUnavailableError) {
          // Fall back: check the legacy summary pipeline for a previous brief.
          try {
            const result = await getLegacyDailyBriefStatus(currentDateKey);
            if (cancelled) return;
            const status = String(result.status ?? '').toLowerCase();
            if (status === 'completed') {
              finishFromStatus(result);
            } else {
              setBrief({ status: 'idle', markdown: null, sources: [], error: null });
            }
          } catch (legacyError) {
            console.warn('Failed to hydrate legacy daily brief:', legacyError);
            setBrief({ status: 'idle', markdown: null, sources: [], error: null });
          }
          return;
        }
        console.warn('Failed to hydrate daily brief:', error);
        setBrief({ status: 'idle', markdown: null, sources: [], error: null });
      }
    };

    hydrate();

    return () => {
      cancelled = true;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey]);

  return {
    brief,
    generate,
    cancel,
    hasBrief: brief.status === 'completed' && brief.markdown !== null,
  };
}
