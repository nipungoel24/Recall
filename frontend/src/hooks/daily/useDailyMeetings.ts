import { useCallback, useEffect, useRef, useState } from 'react';
import type { DailyMeeting, DailyTotals } from '@/types/daily';
import {
  dailyTotals,
  metadataToDailyMeeting,
  parseDateKey,
  sortDailyMeetings,
  toDailyMeeting,
} from '@/lib/daily/timeline';
import { endOfLocalDay, startOfLocalDay } from '@/lib/calendar';
import { meetingService } from '@/services/meetingService';
import {
  fetchMeetingList,
  fetchMeetingMetadata,
  fetchTranscriptBounds,
} from '@/services/dailyService';

export interface DailyMeetingsState {
  meetings: DailyMeeting[];
  isLoading: boolean;
  error: string | null;
  totals: DailyTotals;
  refresh: () => Promise<void>;
}

export interface DailyDateInput {
  /** Single day key (YYYY-MM-DD) when viewing one day. */
  dateKey?: string | null;
  /** Inclusive range keys when viewing a range of days. */
  range?: { startKey: string; endKey: string } | null;
}

/**
 * Loads the meetings for one day (or a range).
 *
 * Primary path: the lightweight `api_get_meetings_by_date_range` command
 * exposed through the Calendar's meetingService (metadata only, includes
 * duration; no transcript text). Falls back to list + per-meeting metadata
 * when that command is unavailable.
 */
export function useDailyMeetings(input: DailyDateInput): DailyMeetingsState {
  const [meetings, setMeetings] = useState<DailyMeeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const dateKey = input.dateKey ?? null;
  const range = input.range ?? null;

  const startKey = range ? range.startKey : dateKey;
  const endKey = range ? range.endKey : dateKey;

  const load = useCallback(async () => {
    if (startKey === null || endKey === null) {
      setMeetings([]);
      setIsLoading(false);
      return;
    }

    const startDate = parseDateKey(startKey);
    const endDate = parseDateKey(endKey);
    if (!startDate || !endDate) {
      setMeetings([]);
      setIsLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    try {
      let dailyMeetings: DailyMeeting[];

      try {
        // Primary: single lightweight range query (Calendar interface).
        const metadata = await meetingService.getMeetingsByDateRange(
          startOfLocalDay(startDate),
          endOfLocalDay(endDate),
        );
        if (requestId !== requestIdRef.current) return;
        dailyMeetings = metadata.map((meta) =>
          metadataToDailyMeeting({
            id: meta.id,
            title: meta.title,
            createdAt: meta.created_at,
            updatedAt: meta.updated_at,
            folderPath: meta.folder_path ?? null,
            durationSeconds: meta.duration_seconds ?? null,
          }),
        );
      } catch (rangeError) {
        // Fallback: list + metadata + transcript bounds (no dedicated command).
        if (!isRangeCommandUnavailable(rangeError)) throw rangeError;

        const list = await fetchMeetingList();
        const metadataResults = await Promise.allSettled(
          list.map((entry) => fetchMeetingMetadata(entry.id)),
        );

        const candidates = metadataResults
          .filter(
            (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchMeetingMetadata>>> =>
              r.status === 'fulfilled',
          )
          .map((r) => r.value);

        const inView = candidates.filter((meta) => {
          const created = new Date(meta.created_at);
          if (isNaN(created.getTime())) return false;
          const createdKey = localKeyOf(created);
          return createdKey >= startKey && createdKey <= endKey;
        });

        const boundsResults = await Promise.allSettled(
          inView.map((meta) => fetchTranscriptBounds(meta.id)),
        );

        dailyMeetings = inView.map((meta, index) => {
          const boundsResult = boundsResults[index];
          const bounds =
            boundsResult && boundsResult.status === 'fulfilled' ? boundsResult.value : null;
          return bounds
            ? toDailyMeeting(
                {
                  id: meta.id,
                  title: meta.title,
                  createdAt: meta.created_at,
                  updatedAt: meta.updated_at,
                  folderPath: meta.folder_path ?? null,
                },
                bounds,
              )
            : metadataToDailyMeeting({
                id: meta.id,
                title: meta.title,
                createdAt: meta.created_at,
                updatedAt: meta.updated_at,
                folderPath: meta.folder_path ?? null,
              });
        });
      }

      if (requestId !== requestIdRef.current) return;

      setMeetings(sortDailyMeetings(dailyMeetings));
      setError(null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      console.error('Failed to load daily meetings:', err);
      setMeetings([]);
      setError(err instanceof Error ? err.message : 'Failed to load meetings');
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [startKey, endKey]);

  useEffect(() => {
    load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [load]);

  const totals = dailyTotals(meetings);

  return { meetings, isLoading, error, totals, refresh: load };
}

function localKeyOf(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isRangeCommandUnavailable(error: unknown): boolean {
  const message =
    typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  const lower = message.toLowerCase();
  return (lower.includes('command') && lower.includes('not found')) || lower.includes('unknown command');
}
