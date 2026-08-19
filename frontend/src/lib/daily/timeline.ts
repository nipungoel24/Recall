/**
 * Pure helpers for the combined daily meeting timeline.
 *
 * Everything in this module is a pure function with no React, Tauri, or
 * browser dependencies so it can be unit tested in isolation.
 */

import type { Transcript } from '@/types';
import type {
  DailyBriefSource,
  DailyMeeting,
  DailyTotals,
} from '@/types/daily';

/** Date keys use the local calendar date: YYYY-MM-DD. */
export function dateKeyOf(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parse a YYYY-MM-DD key into a local Date (start of day), or null. */
export function parseDateKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (
    date.getFullYear() !== Number(y) ||
    date.getMonth() !== Number(m) - 1 ||
    date.getDate() !== Number(d)
  ) {
    return null;
  }
  return date;
}

/** Normalize a Date or date-key string into a date key, or null. */
export function normalizeDateKey(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const parsed = parseDateKey(value);
    return parsed ? dateKeyOf(parsed) : null;
  }
  // Date (or Date-like) instance; duck-typed to stay realm-safe.
  const time = (value as Date).getTime?.();
  if (typeof time !== 'number' || isNaN(time)) return null;
  return dateKeyOf(new Date(time));
}

/** True when two instants fall on the same local calendar day. */
export function isSameLocalDay(dateKey: string, date: Date | string): boolean {
  const target = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(target.getTime())) return false;
  return dateKeyOf(target) === dateKey;
}

/** True when a Date falls within [startKey, endKey] inclusive (local days). */
export function isWithinDateRange(
  date: Date | string,
  startKey: string,
  endKey: string,
): boolean {
  const key = typeof date === 'string' ? dateKeyOf(new Date(date)) : dateKeyOf(date);
  return key >= startKey && key <= endKey;
}

/** "1 meeting" / "4 meetings" style label. */
export function meetingCountLabel(count: number): string {
  if (count <= 0) return '0 meetings';
  return `${count} meeting${count === 1 ? '' : 's'}`;
}

/** "2h 34m" style duration label from total seconds. */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0m';
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes <= 0) return '0m';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * Human day title: "August 15, 2026" -> "AUGUST 15, 2026".
 * Falls back to the raw key when parsing fails.
 */
export function formatDayTitle(dateKey: string): string {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return dateKey;
  return parsed
    .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    .toUpperCase();
}

/** HH:MM:SS (or HH:MM) wall-clock string parsed into seconds-of-day, or null. */
export function parseWallClock(timestamp: string | null | undefined): number | null {
  if (!timestamp) return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(timestamp.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  const s = Number(match[3] ?? 0);
  if (h > 23 || m > 59 || s > 59) return null;
  return h * 3600 + m * 60 + s;
}

/** Format seconds-of-day as HH:MM for timeline display. */
export function formatClock(secondsOfDay: number): string {
  const safe = Math.max(0, Math.floor(secondsOfDay)) % 86400;
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Format an elapsed duration in seconds as H:MM:SS or M:SS. */
export function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Start offset (seconds) of a transcript segment, or null. */
export function segmentStartSeconds(t: Pick<Transcript, 'audio_start_time' | 'timestamp'> | undefined | null): number | null {
  if (!t) return null;
  if (typeof t.audio_start_time === 'number' && Number.isFinite(t.audio_start_time)) {
    return t.audio_start_time;
  }
  return parseWallClock(t.timestamp);
}

/** End offset (seconds) of a transcript segment, or null. */
export function segmentEndSeconds(
  t: Pick<Transcript, 'audio_end_time' | 'audio_start_time' | 'duration' | 'timestamp'> | undefined | null,
): number | null {
  if (!t) return null;
  if (typeof t.audio_end_time === 'number' && Number.isFinite(t.audio_end_time)) {
    return t.audio_end_time;
  }
  if (
    typeof t.audio_start_time === 'number' &&
    Number.isFinite(t.audio_start_time) &&
    typeof t.duration === 'number' &&
    Number.isFinite(t.duration)
  ) {
    return t.audio_start_time + t.duration;
  }
  return parseWallClock(t.timestamp);
}

export interface DailyMeetingMetadataInput {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  folderPath: string | null;
}

export interface TranscriptBoundsInput {
  first?: Pick<Transcript, 'audio_start_time' | 'audio_end_time' | 'duration' | 'timestamp'> | null;
  last?: Pick<Transcript, 'audio_start_time' | 'audio_end_time' | 'duration' | 'timestamp'> | null;
  total: number;
}

/**
 * Build a timeline entry from calendar-range metadata (the primary data
 * path: `api_get_meetings_by_date_range`). No transcript rows are fetched;
 * `transcriptCount` stays unknown until the entry is expanded.
 */
export function metadataToDailyMeeting(meta: DailyMeetingMetadataInput & { durationSeconds?: number | null }): DailyMeeting {
  const createdAtDate = new Date(meta.createdAt);
  const validCreated = !isNaN(createdAtDate.getTime());

  return {
    id: meta.id,
    title: meta.title || 'Untitled Meeting',
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    folderPath: meta.folderPath ?? null,
    startTime: validCreated ? createdAtDate.toISOString() : null,
    endTime: null,
    durationSeconds:
      typeof meta.durationSeconds === 'number' && Number.isFinite(meta.durationSeconds)
        ? Math.max(0, Math.round(meta.durationSeconds))
        : 0,
    transcriptCount: null,
    hasTranscripts: true,
  };
}

/**
 * Combine meeting metadata with transcript boundary rows into a timeline
 * entry. Uses only the first/last transcript rows so the full transcript is
 * never loaded to render the list.
 */
export function toDailyMeeting(
  meta: DailyMeetingMetadataInput,
  bounds: TranscriptBoundsInput | null,
): DailyMeeting {
  const first = bounds?.first ?? null;
  const last = bounds?.last ?? null;

  const createdAtDate = new Date(meta.createdAt);
  const validCreated = !isNaN(createdAtDate.getTime());

  let startTime: string | null = null;
  let endTime: string | null = null;

  if (first) {
    const wallClock = parseWallClock(first.timestamp);
    if (wallClock !== null && validCreated) {
      const start = new Date(createdAtDate);
      start.setHours(0, 0, 0, 0);
      start.setSeconds(start.getSeconds() + wallClock);
      startTime = start.toISOString();
    }
  }
  if (last) {
    const endClock = parseWallClock(last.timestamp);
    if (endClock !== null && validCreated) {
      const end = new Date(createdAtDate);
      end.setHours(0, 0, 0, 0);
      end.setSeconds(end.getSeconds() + endClock);
      endTime = end.toISOString();
    }
  }
  if (!startTime && validCreated) startTime = createdAtDate.toISOString();

  const firstStart = segmentStartSeconds(first);
  const lastEnd = segmentEndSeconds(last);
  let durationSeconds = 0;
  if (firstStart !== null && lastEnd !== null) {
    durationSeconds = Math.max(0, Math.round(lastEnd - firstStart));
  } else if (first && typeof first.duration === 'number' && Number.isFinite(first.duration)) {
    durationSeconds = Math.max(0, Math.round(first.duration));
  }

  const total = bounds?.total ?? 0;

  return {
    id: meta.id,
    title: meta.title || 'Untitled Meeting',
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    folderPath: meta.folderPath ?? null,
    startTime,
    endTime,
    durationSeconds,
    transcriptCount: bounds ? total : null,
    hasTranscripts: bounds ? total > 0 : true,
  };
}

/** Sort meetings chronologically by start time (unknown times go last). */
export function sortDailyMeetings(meetings: DailyMeeting[]): DailyMeeting[] {
  return [...meetings].sort((a, b) => {
    const aTime = a.startTime ? new Date(a.startTime).getTime() : Infinity;
    const bTime = b.startTime ? new Date(b.startTime).getTime() : Infinity;
    if (aTime !== bTime) return aTime - bTime;
    return a.title.localeCompare(b.title);
  });
}

/** Group meetings into local-day buckets keyed by date key (sorted). */
export function groupMeetingsByDate(meetings: DailyMeeting[]): Map<string, DailyMeeting[]> {
  const buckets = new Map<string, DailyMeeting[]>();
  for (const meeting of meetings) {
    const created = new Date(meeting.createdAt);
    if (isNaN(created.getTime())) continue;
    const key = dateKeyOf(created);
    const list = buckets.get(key) ?? [];
    list.push(meeting);
    buckets.set(key, list);
  }
  for (const key of Array.from(buckets.keys())) {
    buckets.set(key, sortDailyMeetings(buckets.get(key)!));
  }
  return new Map([...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/** Sum meeting durations into header totals. */
export function dailyTotals(meetings: DailyMeeting[]): DailyTotals {
  return {
    meetingCount: meetings.length,
    durationSeconds: meetings.reduce((sum, m) => sum + (m.durationSeconds || 0), 0),
  };
}

/** Wall-clock label for a meeting on the timeline ("09:00"). */
export function meetingTimeLabel(meeting: DailyMeeting): string | null {
  if (!meeting.startTime) return null;
  const date = new Date(meeting.startTime);
  if (isNaN(date.getTime())) return null;
  return formatClock(date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds());
}

/**
 * Synthetic meeting id used by the fallback brief path, which reuses the
 * existing per-meeting summary pipeline without backend changes.
 */
export function dailyBriefMeetingId(dateKey: string): string {
  return `daily-brief-${dateKey}`;
}

/** System prompt passed to the LLM for the combined daily brief (fallback path). */
export const DAILY_BRIEF_PROMPT =
  'You are creating a combined "Daily Brief" for all meetings that took place on this day. ' +
  'Summarize the day as a whole: key themes across meetings, important decisions, action items with owners when identifiable, ' +
  'risks or blockers, and a short outlook for tomorrow. Group the brief by meeting when it adds clarity, ' +
  'and keep it concise but complete. Use markdown formatting with clear headings and bullet lists.';

/** Build the combined transcript text sent to the LLM (fallback path). */
export function buildDailyBriefTranscriptText(
  meetings: DailyMeeting[],
  transcriptsByMeeting: Map<string, Transcript[]>,
): string {
  const sections: string[] = [];
  for (const meeting of meetings) {
    const transcripts = transcriptsByMeeting.get(meeting.id) ?? [];
    const header = [
      `# Meeting: ${meeting.title}`,
      `Start: ${meeting.startTime ? new Date(meeting.startTime).toISOString() : meeting.createdAt}`,
      `Segments: ${transcripts.length}`,
    ].join('\n');

    const lines = transcripts.map((t) => {
      const wallClock = parseWallClock(t.timestamp);
      const offset =
        typeof t.audio_start_time === 'number' && Number.isFinite(t.audio_start_time)
          ? `[${formatElapsed(t.audio_start_time)}]`
          : wallClock !== null
            ? `[${formatClock(wallClock)}]`
            : '';
      return `${offset} ${t.text}`.trim();
    });

    sections.push(`${header}\n\n${lines.join('\n')}`.trim());
  }
  return sections.join('\n\n---\n\n');
}

/**
 * Convert a legacy sectioned summary payload into markdown for rendering.
 * Handles the same shapes produced by the existing summary pipeline.
 */
export function legacySummaryToMarkdown(data: Record<string, unknown>): string {
  if (!data) return '';

  const raw = data as Record<string, unknown>;
  const meetingName = typeof raw.MeetingName === 'string' ? (raw.MeetingName as string) : null;
  const sectionOrder = Array.isArray(raw._section_order)
    ? (raw._section_order as string[]).filter((k) => typeof k === 'string')
    : Object.keys(raw).filter((k) => k !== 'MeetingName' && k !== '_section_order');

  const lines: string[] = [];
  lines.push(`# ${meetingName ?? 'Meeting Summary'}`);

  for (const key of sectionOrder) {
    const section = raw[key];
    if (!section || typeof section !== 'object') continue;
    const typed = section as { title?: unknown; blocks?: unknown };
    const title = typeof typed.title === 'string' && typed.title ? typed.title : key;
    lines.push('', `## ${title}`);
    if (!Array.isArray(typed.blocks)) continue;
    for (const block of typed.blocks) {
      if (!block || typeof block !== 'object') continue;
      const b = block as { type?: unknown; content?: unknown };
      const content = typeof b.content === 'string' ? b.content.trim() : '';
      if (!content) continue;
      if (b.type === 'bullet') {
        lines.push(`- ${content}`);
      } else if (b.type === 'heading1') {
        lines.push(`### ${content}`);
      } else if (b.type === 'heading2') {
        lines.push(`#### ${content}`);
      } else {
        lines.push(content);
      }
    }
  }

  return lines.join('\n').trim();
}

/** Normalize source/provenance entries returned with a daily brief. */
export function parseDailyBriefSources(data: Record<string, unknown> | null | undefined): DailyBriefSource[] {
  if (!data) return [];
  const raw = Array.isArray(data.sources) ? data.sources : [];
  const sources: DailyBriefSource[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const meetingId =
      (typeof e.meetingId === 'string' && e.meetingId) ||
      (typeof e.meeting_id === 'string' && e.meeting_id) ||
      (typeof e.id === 'string' && e.id);
    if (!meetingId) continue;
    const title = (typeof e.title === 'string' && e.title) || meetingId;
    sources.push({ meetingId, title });
  }
  return sources;
}

/** True when a Tauri invoke failure means the command does not exist yet. */
export function isCommandNotFoundError(message: string | null | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    (lower.includes('command') && lower.includes('not found')) ||
    lower.includes('unknown command') ||
    lower.includes('command not recognized')
  );
}

/** Extract markdown + sources from a brief result payload (either format). */
export function normalizeBriefResult(
  payload: unknown,
  fallbackSources: DailyBriefSource[] = [],
): { markdown: string; sources: DailyBriefSource[] } | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as Record<string, unknown>;

  let markdown: string | null = null;
  if (typeof data.markdown === 'string' && data.markdown.trim()) {
    markdown = data.markdown.trim();
  } else if (data.data && typeof data.data === 'object') {
    const inner = data.data as Record<string, unknown>;
    if (typeof inner.markdown === 'string' && inner.markdown.trim()) {
      markdown = inner.markdown.trim();
    }
  }

  const sources = parseDailyBriefSources(
    data.data && typeof data.data === 'object' ? (data.data as Record<string, unknown>) : data,
  );

  if (!markdown) return null;

  return {
    markdown,
    sources: sources.length > 0 ? sources : fallbackSources,
  };
}
