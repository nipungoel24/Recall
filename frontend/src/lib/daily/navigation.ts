/**
 * Calendar → Daily view integration contract.
 *
 * The Calendar is owned by another team member; this module is the single
 * integration point it should use to open the daily experience.
 */

import { dateKeyOf, normalizeDateKey } from '@/lib/daily/timeline';

/** Route of the daily meetings page. */
export const DAILY_ROUTE = '/daily';

/** Build the /daily URL for a single day. */
export function buildDailyRoute(date: Date | string): string {
  const key = normalizeDateKey(date);
  return key ? `${DAILY_ROUTE}?date=${encodeURIComponent(key)}` : DAILY_ROUTE;
}

/** Build the /daily URL for an inclusive day range. */
export function buildDailyRangeRoute(start: Date | string, end: Date | string): string {
  const startKey = normalizeDateKey(start);
  const endKey = normalizeDateKey(end);
  if (!startKey || !endKey) {
    return buildDailyRoute(new Date());
  }
  return `${DAILY_ROUTE}?start=${encodeURIComponent(startKey)}&end=${encodeURIComponent(endKey)}`;
}

/** Today's date key (for calendar defaults). */
export function todayDateKey(): string {
  return dateKeyOf(new Date());
}
