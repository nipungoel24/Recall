/**
 * Local-timezone calendar/date utilities.
 *
 * Every function here deliberately works in the USER'S LOCAL timezone:
 * "August 15" means August 15 on the user's wall clock, not the UTC date.
 * Meetings around midnight are grouped by their local calendar day, never
 * by blind parsing of a UTC date string.
 *
 * All functions are pure and depend only on well-tested browser `Date`
 * APIs (local getters and the `new Date(y, m, d)` constructor), which
 * handle month overflow, leap years, and DST transitions for us.
 */

export interface CalendarMeetingLike {
  id: string;
  title: string;
  created_at: string;
  duration_seconds?: number;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** First instant (local midnight) of the day containing `date`. */
export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Exclusive end instant (local midnight of the NEXT day) for `date`. */
export function endOfLocalDay(date: Date): Date {
  // `new Date(y, m, d + 1)` is always local midnight of the next calendar
  // day, even across DST transitions.
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

/** First instant (local midnight) of the month containing `date`. */
export function startOfLocalMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Exclusive end instant (local midnight of the 1st of the next month). */
export function endOfLocalMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

/** True if both dates fall on the same local calendar day. */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "YYYY-MM-DD" key for the local calendar day containing `date`. */
export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Parse a "YYYY-MM-DD" key back into a Date at local midnight. */
export function parseLocalDateKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  // Reject overflow dates like "2026-02-31" which Date would normalize.
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null;
  }
  return date;
}

/**
 * Build a month grid for the month containing `monthAnchor`.
 * Returns weeks (rows) of 7 `Date`s each, Sunday through Saturday.
 * Days outside the month are included so the grid stays rectangular.
 */
export function getMonthMatrix(monthAnchor: Date): Date[][] {
  const firstOfMonth = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1);
  const lastOfMonth = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 0);

  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());

  const gridEnd = new Date(lastOfMonth);
  gridEnd.setDate(lastOfMonth.getDate() + (6 - lastOfMonth.getDay()));

  const weeks: Date[][] = [];
  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** Short weekday labels (Sun..Sat) for the calendar header, in the user's locale. */
export function getWeekdayLabels(): string[] {
  const labels: string[] = [];
  // 2021-01-03 is a Sunday; adding i gives Sunday..Saturday deterministically.
  for (let i = 0; i < 7; i++) {
    const day = new Date(2021, 0, 3 + i);
    labels.push(day.toLocaleDateString(undefined, { weekday: 'short' }));
  }
  return labels;
}

/**
 * Group meetings by their LOCAL calendar day.
 * `created_at` (UTC instant) is converted to a local `Date` first, so a
 * meeting at 23:30 local time and one at 00:30 the next day land on
 * different keys even when their UTC dates are identical.
 */
export function groupMeetingsByLocalDate(
  meetings: ReadonlyArray<CalendarMeetingLike>
): Map<string, CalendarMeetingLike[]> {
  const groups = new Map<string, CalendarMeetingLike[]>();
  for (const meeting of meetings) {
    const key = localDateKey(new Date(meeting.created_at));
    const existing = groups.get(key);
    if (existing) {
      existing.push(meeting);
    } else {
      groups.set(key, [meeting]);
    }
  }
  return groups;
}

/** Sort meetings chronologically (oldest first) by their created_at instant. */
export function sortMeetingsChronologically<T extends { created_at: string }>(
  meetings: ReadonlyArray<T>
): T[] {
  return [...meetings].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

/** "Today" | "Yesterday" | localized full date, for history group headers. */
export function getHistoryGroupLabel(
  date: Date,
  today: Date = new Date()
): string {
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (isSameLocalDay(date, today)) return 'Today';
  if (isSameLocalDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Which history bucket a local date falls into, relative to today. */
export function getHistoryBucket(
  date: Date,
  today: Date = new Date()
): 'today' | 'yesterday' | 'earlier' {
  const startOfToday = startOfLocalDay(today);
  const startOfTomorrow = new Date(
    startOfToday.getFullYear(),
    startOfToday.getMonth(),
    startOfToday.getDate() + 1
  );
  if (date >= startOfToday && date < startOfTomorrow) return 'today';

  const startOfYesterday = new Date(
    startOfToday.getFullYear(),
    startOfToday.getMonth(),
    startOfToday.getDate() - 1
  );
  if (date >= startOfYesterday && date < startOfToday) return 'yesterday';

  return 'earlier';
}

/** Local time of day, e.g. "2:30 PM", derived from an instant string. */
export function formatMeetingTime(createdAt: string): string {
  return new Date(createdAt).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Human-friendly duration label, e.g. "1h 23m", "45m", "12s". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
  return `${secs}s`;
}
