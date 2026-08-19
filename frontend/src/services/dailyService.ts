/**
 * Daily view data service.
 *
 * Reads meeting metadata / transcript boundaries from the existing Tauri
 * commands and coordinates Daily Brief generation.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * INTERFACE CONTRACT (frontend ↔ backend agent)
 * ─────────────────────────────────────────────────────────────────────────
 * The Daily view uses dedicated Daily Brief backend commands (contract §5.2):
 *
 *   api_generate_daily_summary({ date, meetingIds })
 *     date:       "YYYY-MM-DD" (local day key)
 *     meetingIds: string[]     (meeting ids in the day, chronological)
 *     -> { processId: string }
 *
 *   api_get_daily_summary({ date })
 *     -> {
 *       status: 'idle' | 'processing' | 'completed' | 'failed' | 'cancelled',
 *       data?: {
 *         markdown?: string,
 *         sources?: Array<{ meetingId: string, title: string }>,
 *       },
 *       error?: string | null,
 *     }
 *
 *   api_cancel_daily_summary({ date })
 *     -> { message: string }
 *
 * When the dedicated commands are unavailable, this service transparently falls back to the
 * existing per-meeting summary pipeline (api_process_transcript /
 * api_get_summary) using a synthetic `daily-brief-<date>` meeting id, so the
 * UI works with zero backend changes.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { invoke } from '@tauri-apps/api/core';
import type { Transcript } from '@/types';
import type { DailyBriefStatusResponse } from '@/types/daily';
import { dailyBriefMeetingId } from '@/lib/daily/timeline';

export interface MeetingListEntry {
  id: string;
  title: string;
}

export interface MeetingMetadata {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  folder_path?: string | null;
}

export interface PaginatedTranscripts {
  transcripts: Transcript[];
  total_count: number;
  has_more: boolean;
}

export interface MeetingSummaryLookup {
  status: string;
  data: Record<string, unknown> | null;
  error: string | null;
}

export class DailyBriefCommandUnavailableError extends Error {
  constructor(command: string, cause?: unknown) {
    super(
      `Dedicated daily brief backend not available yet (${command}). Falling back to per-meeting summary pipeline.`,
    );
    this.name = 'DailyBriefCommandUnavailableError';
    if (cause !== undefined) {
      (this as unknown as { cause: unknown }).cause = cause;
    }
  }
}

/** Small in-memory metadata cache; invalidated per navigation session. */
const metadataCache = new Map<string, MeetingMetadata>();

export function clearDailyMetadataCache(): void {
  metadataCache.clear();
}

export async function fetchMeetingList(): Promise<MeetingListEntry[]> {
  return invoke<MeetingListEntry[]>('api_get_meetings');
}

/** Fetch meeting metadata (no transcripts). Cached per session. */
export async function fetchMeetingMetadata(meetingId: string): Promise<MeetingMetadata> {
  const cached = metadataCache.get(meetingId);
  if (cached) return cached;
  const metadata = await invoke<MeetingMetadata>('api_get_meeting_metadata', { meetingId });
  metadataCache.set(meetingId, metadata);
  return metadata;
}

/**
 * Fetch only the first/last transcript rows for a meeting. Two tiny
 * paginated calls; the full transcript is never loaded to render the list.
 */
export async function fetchTranscriptBounds(
  meetingId: string,
): Promise<{ first: Transcript | null; last: Transcript | null; total: number }> {
  const firstPage = await invoke<PaginatedTranscripts>('api_get_meeting_transcripts', {
    meetingId,
    limit: 1,
    offset: 0,
  });
  const total = firstPage.total_count;
  const first = firstPage.transcripts[0] ?? null;

  let last: Transcript | null = null;
  if (total > 1) {
    const lastPage = await invoke<PaginatedTranscripts>('api_get_meeting_transcripts', {
      meetingId,
      limit: 1,
      offset: total - 1,
    });
    last = lastPage.transcripts[0] ?? null;
  } else {
    last = first;
  }

  return { first, last, total };
}

/** Fetch a transcript page (used for lazy previews and brief generation). */
export async function fetchTranscriptPage(
  meetingId: string,
  limit: number,
  offset: number,
): Promise<PaginatedTranscripts> {
  return invoke<PaginatedTranscripts>('api_get_meeting_transcripts', { meetingId, limit, offset });
}

/** Fetch all transcripts for a meeting (only used when generating a brief). */
export async function fetchAllTranscripts(meetingId: string): Promise<Transcript[]> {
  const firstPage = await invoke<PaginatedTranscripts>('api_get_meeting_transcripts', {
    meetingId,
    limit: 1,
    offset: 0,
  });
  if (firstPage.total_count === 0) return [];
  const all = await invoke<PaginatedTranscripts>('api_get_meeting_transcripts', {
    meetingId,
    limit: firstPage.total_count,
    offset: 0,
  });
  return all.transcripts;
}

/** Fetch a meeting's summary status/data (used for expand previews). */
export async function fetchMeetingSummary(meetingId: string): Promise<MeetingSummaryLookup> {
  const raw = await invoke<{
    status?: string;
    data?: unknown;
    error?: string | null;
  }>('api_get_summary', { meetingId });
  const data =
    raw.data && typeof raw.data === 'object'
      ? (raw.data as Record<string, unknown>)
      : typeof raw.data === 'string'
        ? safeParseJson(raw.data)
        : null;
  return {
    status: raw.status ?? 'idle',
    data,
    error: raw.error ?? null,
  };
}

function safeParseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Daily brief - dedicated backend commands (contract above)
 * ──────────────────────────────────────────────────────────────────────── */

export async function requestDailyBrief(
  dateKey: string,
  meetingIds: string[],
): Promise<{ processId: string }> {
  try {
    return await invoke<{ processId: string }>('api_generate_daily_summary', {
      date: dateKey,
      meetingIds,
    });
  } catch (error) {
    if (isMissingCommandError(error)) {
      throw new DailyBriefCommandUnavailableError('api_generate_daily_summary', error);
    }
    throw error;
  }
}

export async function getDailyBriefStatus(dateKey: string): Promise<DailyBriefStatusResponse> {
  try {
    return await invoke<DailyBriefStatusResponse>('api_get_daily_summary', { date: dateKey });
  } catch (error) {
    if (isMissingCommandError(error)) {
      throw new DailyBriefCommandUnavailableError('api_get_daily_summary', error);
    }
    throw error;
  }
}

export async function cancelDailyBrief(dateKey: string): Promise<void> {
  try {
    await invoke('api_cancel_daily_summary', { date: dateKey });
  } catch (error) {
    if (!isMissingCommandError(error)) {
      console.warn('Failed to cancel daily brief:', error);
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Daily brief - legacy fallback via the per-meeting summary pipeline
 * ──────────────────────────────────────────────────────────────────────── */

export async function startLegacyDailyBrief(
  dateKey: string,
  text: string,
  model: string,
  modelName: string,
  customPrompt: string,
): Promise<{ processId: string }> {
  return invoke<{ process_id: string; processId?: string }>('api_process_transcript', {
    text,
    model,
    modelName,
    meetingId: dailyBriefMeetingId(dateKey),
    chunkSize: 40000,
    overlap: 1000,
    customPrompt,
    templateId: 'daily_standup',
    summaryLanguage: null,
  }).then((r) => ({ processId: r.processId ?? r.process_id }));
}

export async function getLegacyDailyBriefStatus(
  dateKey: string,
): Promise<DailyBriefStatusResponse> {
  const raw = await invoke<{
    status?: string;
    data?: unknown;
    error?: string | null;
  }>('api_get_summary', { meetingId: dailyBriefMeetingId(dateKey) });

  let data: Record<string, unknown> | null = null;
  if (raw.data && typeof raw.data === 'object') {
    data = raw.data as Record<string, unknown>;
  } else if (typeof raw.data === 'string') {
    data = safeParseJson(raw.data);
  }

  const status = (raw.status ?? 'idle').toLowerCase();
  return {
    status,
    data: data ?? undefined,
    error: raw.error ?? null,
  };
}

export async function cancelLegacyDailyBrief(dateKey: string): Promise<void> {
  try {
    await invoke('api_cancel_summary', { meetingId: dailyBriefMeetingId(dateKey) });
  } catch (error) {
    console.warn('Failed to cancel legacy daily brief:', error);
  }
}

function isMissingCommandError(error: unknown): boolean {
  if (typeof error === 'string') {
    const lower = error.toLowerCase();
    return (lower.includes('command') && lower.includes('not found')) || lower.includes('unknown command');
  }
  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    return (lower.includes('command') && lower.includes('not found')) || lower.includes('unknown command');
  }
  return false;
}
