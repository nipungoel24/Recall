/**
 * Meeting Service
 *
 * Tauri backend wrappers for meeting queries.
 * `getMeetingsByDateRange` is the lightweight contract used by the
 * Calendar: it returns meeting metadata (no transcript text) for a
 * half-open [start, end) instant range, ordered chronologically.
 */

import { invoke } from '@tauri-apps/api/core';
import { MeetingMetadata } from '@/types';

export class MeetingService {
  /**
   * Fetch meeting metadata created within a half-open date range.
   *
   * @param start - inclusive range start (converted to UTC instant)
   * @param end - exclusive range end (converted to UTC instant)
   *
   * Callers must compute local-timezone day boundaries *before* calling:
   * pass `startOfLocalDay(date)` / `endOfLocalDay(date)` so "August 15"
   * means August 15 in the user's local timezone.
   */
  async getMeetingsByDateRange(start: Date, end: Date): Promise<MeetingMetadata[]> {
    return invoke<MeetingMetadata[]>('api_get_meetings_by_range', {
      startUtc: start.toISOString(),
      endUtc: end.toISOString(),
    });
  }
}

export const meetingService = new MeetingService();
