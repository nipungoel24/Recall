'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, Sun } from 'lucide-react';
import { MeetingMetadata } from '@/types';
import { meetingService } from '@/services/meetingService';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { routes } from '@/lib/routes';
import {
  endOfLocalMonth,
  startOfLocalMonth,
  getMonthMatrix,
  getWeekdayLabels,
  isSameLocalDay,
  localDateKey,
  parseLocalDateKey,
  sortMeetingsChronologically,
  formatMeetingTime,
  formatDuration,
} from '@/lib/calendar';
import { Button } from '@/components/ui/button';

interface CalendarViewProps {
  /** "YYYY-MM-DD" initial selected day, or null to default to today. */
  initialDateKey?: string | null;
  /** "YYYY-MM" initial visible month, or null to default to the selected/today month. */
  initialMonthKey?: string | null;
}

function resolveInitialState(
  initialDateKey: string | null | undefined,
  initialMonthKey: string | null | undefined,
  now: Date
): { monthAnchor: Date; selectedDate: Date | null } {
  if (initialDateKey) {
    const parsed = parseLocalDateKey(initialDateKey);
    if (parsed) {
      return {
        monthAnchor: new Date(parsed.getFullYear(), parsed.getMonth(), 1),
        selectedDate: parsed,
      };
    }
  }

  if (initialMonthKey) {
    const match = /^(\d{4})-(\d{2})$/.exec(initialMonthKey);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]) - 1;
      if (month >= 0 && month <= 11) {
        const anchor = new Date(year, month, 1);
        return {
          monthAnchor: anchor,
          selectedDate: isSameLocalDay(now, anchor) ? now : null,
        };
      }
    }
  }

  return {
    monthAnchor: new Date(now.getFullYear(), now.getMonth(), 1),
    selectedDate: now,
  };
}

const CalendarView: React.FC<CalendarViewProps> = ({ initialDateKey, initialMonthKey }) => {
  const router = useRouter();

  // Recomputed every render so the "today" highlight stays correct across midnight.
  const today = new Date();

  const [initial] = useState(() => resolveInitialState(initialDateKey, initialMonthKey, new Date()));
  const [monthAnchor, setMonthAnchor] = useState<Date>(initial.monthAnchor);
  const [selectedDate, setSelectedDate] = useState<Date | null>(initial.selectedDate);

  const [monthMeetings, setMonthMeetings] = useState<MeetingMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-month metadata cache so switching days within a month never refetches.
  const meetingsCache = useRef<Map<string, MeetingMetadata[]>>(new Map());
  const activeMonthKey = useRef<string>('');

  const monthKeyOf = useCallback((anchor: Date) => localDateKey(startOfLocalMonth(anchor)), []);

  const loadMonth = useCallback(async (anchor: Date) => {
    const key = monthKeyOf(anchor);
    const cached = meetingsCache.current.get(key);
    if (cached) {
      setMonthMeetings(cached);
      setLoading(false);
      setError(null);
      return;
    }

    activeMonthKey.current = key;
    setLoading(true);
    setError(null);
    try {
      const meetings = await meetingService.getMeetingsByDateRange(
        startOfLocalMonth(anchor),
        endOfLocalMonth(anchor)
      );
      if (activeMonthKey.current !== key) return; // stale response from a month we left
      meetingsCache.current.set(key, meetings);
      setMonthMeetings(meetings);
      setError(null);
    } catch (err) {
      if (activeMonthKey.current !== key) return;
      console.error('Failed to load meetings for month:', err);
      setMonthMeetings([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (activeMonthKey.current === key) {
        setLoading(false);
      }
    }
  }, [monthKeyOf]);

  useEffect(() => {
    loadMonth(monthAnchor);
  }, [monthAnchor, loadMonth]);

  const navigateMonth = useCallback((delta: number) => {
    setMonthAnchor(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
    setSelectedDate(null);
  }, []);

  const goToToday = useCallback(() => {
    const now = new Date();
    setMonthAnchor(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(now);
  }, []);

  const handleDayClick = useCallback((day: Date) => {
    if (day.getMonth() === monthAnchor.getMonth()) {
      setSelectedDate(day);
    } else {
      // Clicked a filler day from an adjacent month: jump there and select it.
      setMonthAnchor(new Date(day.getFullYear(), day.getMonth(), 1));
      setSelectedDate(day);
    }
  }, [monthAnchor]);

  const meetingCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const meeting of monthMeetings) {
      const key = localDateKey(new Date(meeting.created_at));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [monthMeetings]);

  const selectedDayMeetings = useMemo(() => {
    if (!selectedDate) return [];
    const key = localDateKey(selectedDate);
    return sortMeetingsChronologically(
      monthMeetings.filter(m => localDateKey(new Date(m.created_at)) === key)
    );
  }, [monthMeetings, selectedDate]);

  const monthGrid = useMemo(() => getMonthMatrix(monthAnchor), [monthAnchor]);
  const weekdayLabels = useMemo(() => getWeekdayLabels(), []);
  const monthDays = useMemo(() => monthGrid.flat(), [monthGrid]);

  const selectedDateLabel = selectedDate
    ? selectedDate.toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '';

  // Arrow-key navigation: move the selected day without touching the mouse.
  const handleGridKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const base = selectedDate ?? new Date();
      let next: Date | null = null;
      switch (event.key) {
        case 'ArrowLeft':
          next = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1);
          break;
        case 'ArrowRight':
          next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1);
          break;
        case 'ArrowUp':
          next = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 7);
          break;
        case 'ArrowDown':
          next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 7);
          break;
        case 'Home':
          next = new Date();
          setMonthAnchor(new Date(next.getFullYear(), next.getMonth(), 1));
          setSelectedDate(next);
          return;
        default:
          return;
      }
      event.preventDefault();
      setMonthAnchor(new Date(next.getFullYear(), next.getMonth(), 1));
      setSelectedDate(next);
    },
    [selectedDate],
  );

  const selectedDateKey = selectedDate ? localDateKey(selectedDate) : null;

  return (
    <div className="h-screen overflow-y-auto custom-scrollbar bg-gray-50">
      <div className="w-full max-w-[1280px] mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Calendar</h1>
            <p className="text-sm text-gray-500 mt-1">
              {monthAnchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={goToToday}>
              Today
            </Button>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={() => navigateMonth(-1)} aria-label="Previous month">
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => navigateMonth(1)} aria-label="Next month">
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Workspace: month grid + day agenda */}
        <div className="grid gap-6 lg:grid-cols-5">
          {/* Month grid */}
          <section className="lg:col-span-3">
            <div
              className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              role="grid"
              aria-label={`Calendar grid for ${monthAnchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}. Use arrow keys to move the selected day.`}
              tabIndex={0}
              onKeyDown={handleGridKeyDown}
            >
              <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50">
                {weekdayLabels.map(label => (
                  <div key={label} className="py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {label}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {monthDays.map((day, index) => {
                  const inMonth = day.getMonth() === monthAnchor.getMonth();
                  const isSelected = !!selectedDate && isSameLocalDay(day, selectedDate);
                  const isToday = isSameLocalDay(day, today);
                  const count = meetingCounts.get(localDateKey(day)) ?? 0;
                  const isLastRow = index >= monthDays.length - 7;
                  const isLastColumn = index % 7 === 6;

                  return (
                    <button
                      key={`${day.getTime()}-${index}`}
                      onClick={() => handleDayClick(day)}
                      aria-label={`${day.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}${count > 0 ? `, ${count} meeting${count === 1 ? '' : 's'}` : ''}${isToday ? ', today' : ''}`}
                      aria-pressed={isSelected}
                      className={cn(
                        'relative flex flex-col items-center justify-start pt-2 pb-2 min-h-14 lg:min-h-24 border-b border-r border-gray-100 transition-colors',
                        isLastRow && 'border-b-0',
                        isLastColumn && 'border-r-0',
                        inMonth ? 'hover:bg-blue-50/60' : 'bg-gray-50/60 hover:bg-gray-100',
                        isSelected ? 'bg-blue-600 hover:bg-blue-600' : '',
                      )}
                    >
                      <span
                        className={cn(
                          'inline-flex items-center justify-center w-7 h-7 rounded-full text-sm lg:w-8 lg:h-8 lg:text-base',
                          inMonth ? 'text-gray-800' : 'text-gray-400',
                          isToday && !isSelected && 'ring-1 ring-blue-400 text-blue-600 font-semibold bg-blue-50',
                          isSelected && 'text-white font-semibold',
                        )}
                      >
                        {day.getDate()}
                      </span>
                      {/* Meeting count indicator */}
                      <span className="absolute bottom-1.5 flex items-center gap-0.5 h-4">
                        {count > 0 && (
                          <span
                            className={cn(
                              'flex items-center justify-center rounded-full px-1.5 text-[10px] font-semibold leading-4',
                              isSelected ? 'bg-white text-blue-700' : 'bg-blue-500 text-white',
                              count === 1 && 'w-2 h-2 px-0',
                            )}
                          >
                            {count > 1 ? (count > 9 ? '9+' : count) : ''}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-400">
              Tip: select a day to see its meetings, or use arrow keys to move around the grid.
            </p>
          </section>

          {/* Day agenda */}
          <aside className="lg:col-span-2">
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm flex flex-col min-h-[320px]">
              <div className="border-b border-gray-100 px-5 py-4">
                <h2 className="text-sm font-semibold text-gray-900">
                  {selectedDate ? selectedDateLabel : 'Select a day'}
                </h2>
                {selectedDate && selectedDayMeetings.length > 0 && (
                  <p className="mt-0.5 text-xs text-gray-500">
                    {selectedDayMeetings.length} meeting{selectedDayMeetings.length === 1 ? '' : 's'}
                  </p>
                )}
              </div>

              <div className="flex-1 px-3 py-3">
                {error ? (
                  <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
                    <p className="text-sm text-gray-500">Failed to load meetings: {error}</p>
                    <Button variant="outline" size="sm" onClick={() => loadMonth(monthAnchor)}>
                      <RefreshCw className="w-3.5 h-3.5 mr-1" />
                      Retry
                    </Button>
                  </div>
                ) : loading ? (
                  <div className="space-y-2.5 px-2 py-1">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : !selectedDate ? (
                  <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
                    <CalendarDays className="h-8 w-8 text-gray-300 mb-2" />
                    <p className="text-sm text-gray-500">
                      Pick a day on the calendar to see its meetings here.
                    </p>
                  </div>
                ) : selectedDayMeetings.length === 0 ? (
                  <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
                    <CalendarDays className="h-8 w-8 text-gray-300 mb-2" />
                    <p className="text-sm font-medium text-gray-700">No meetings on this day</p>
                    <p className="mt-1 text-xs text-gray-500">
                      Meetings recorded on this day will appear here.
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {selectedDayMeetings.map(meeting => (
                      <li key={meeting.id}>
                        <button
                          onClick={() => router.push(routes.meeting(meeting.id))}
                          className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-blue-50/60"
                        >
                          <span className="w-16 flex-shrink-0 text-sm font-medium text-gray-600 tabular-nums">
                            {formatMeetingTime(meeting.created_at)}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block truncate text-sm font-medium text-gray-900">
                              {meeting.title}
                            </span>
                            <span className="block text-xs text-gray-400">
                              {typeof meeting.duration_seconds === 'number' && meeting.duration_seconds > 0
                                ? formatDuration(meeting.duration_seconds)
                                : 'No duration yet'}
                            </span>
                          </span>
                          <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-300" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {selectedDateKey && selectedDayMeetings.length > 0 && (
                <div className="border-t border-gray-100 px-5 py-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => router.push(routes.daily(selectedDateKey))}
                  >
                    <Sun className="h-3.5 w-3.5 text-gray-500" />
                    Open Daily View
                  </Button>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default CalendarView;
