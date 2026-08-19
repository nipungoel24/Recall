'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CalendarDays, Loader2, RefreshCw } from 'lucide-react';
import type { DailyMeeting } from '@/types/daily';
import {
  dateKeyOf,
  formatDayTitle,
  formatDuration,
  groupMeetingsByDate,
  meetingCountLabel,
  normalizeDateKey,
} from '@/lib/daily/timeline';
import { useDailyMeetings } from '@/hooks/daily/useDailyMeetings';
import { useDailyBrief } from '@/hooks/daily/useDailyBrief';
import Analytics from '@/lib/analytics';
import { routes } from '@/lib/routes';
import { Button } from '@/components/ui/button';
import { MeetingCard } from './MeetingCard';
import { DailyBriefSection } from './DailyBriefSection';

export interface DailyMeetingViewProps {
  /** A single day: Date instance or YYYY-MM-DD key. Defaults to today. */
  date?: Date | string;
  /** Optional inclusive day range instead of a single day. */
  dateRange?: { start: Date | string; end: Date | string };
  /** Override meeting navigation (defaults to the meeting details page). */
  onMeetingSelect?: (meetingId: string) => void;
  className?: string;
}

/**
 * Combined "all meetings in one day" experience.
 *
 * Meetings remain separate database records; this view groups them into a
 * visual day timeline. Designed to be driven by the Calendar: pass a `date`
 * (or `dateRange`) and optionally `onMeetingSelect`.
 */
export function DailyMeetingView({
  date,
  dateRange,
  onMeetingSelect,
  className,
}: DailyMeetingViewProps) {
  const router = useRouter();

  const normalized = useMemo(() => {
    if (dateRange) {
      const startKey = normalizeDateKey(dateRange.start);
      const endKey = normalizeDateKey(dateRange.end);
      if (startKey && endKey) {
        const sorted = [startKey, endKey].sort();
        return { dateKey: null, range: { startKey: sorted[0], endKey: sorted[1] } };
      }
    }
    const single = normalizeDateKey(date) ?? dateKeyOf(new Date());
    return { dateKey: single, range: null };
  }, [date, dateRange]);

  const isSingleDay = normalized.range === null;
  const dateKey = normalized.dateKey;

  const { meetings, isLoading, error, totals, refresh } = useDailyMeetings({
    dateKey: normalized.dateKey,
    range: normalized.range,
  });

  const { brief, generate, cancel } = useDailyBrief({
    dateKey: isSingleDay ? dateKey : null,
    meetings,
  });

  useEffect(() => {
    Analytics.trackPageView('daily_meetings');
  }, []);

  const openMeeting = useCallback(
    (meetingId: string) => {
      if (onMeetingSelect) {
        onMeetingSelect(meetingId);
        return;
      }
      router.push(routes.meeting(meetingId));
    },
    [onMeetingSelect, router],
  );

  const title = useMemo(() => {
    if (normalized.range) {
      const start = formatDayTitle(normalized.range.startKey);
      const end = formatDayTitle(normalized.range.endKey);
      return start === end ? start : `${start} — ${end}`;
    }
    return formatDayTitle(dateKey ?? dateKeyOf(new Date()));
  }, [normalized.range, dateKey]);

  const groups = useMemo(() => {
    if (!isSingleDay) {
      return groupMeetingsByDate(meetings);
    }
    return null;
  }, [isSingleDay, meetings]);

  const renderMeetingList = (dayMeetings: DailyMeeting[]) => (
    <div className="space-y-0">
      {dayMeetings.map((meeting, index) => (
        <div key={meeting.id} className="relative flex gap-3">
          {/* Timeline rail: dot + connector line between meetings */}
          <div className="flex w-4 flex-shrink-0 flex-col items-center pt-4" aria-hidden="true">
            <span
              className={`h-2.5 w-2.5 rounded-full border-2 ${
                index === 0 ? 'border-blue-200 bg-blue-500' : 'border-gray-300 bg-white'
              }`}
            />
            {index < dayMeetings.length - 1 && (
              <span className="my-1 w-px flex-1 bg-gray-200" />
            )}
          </div>
          <div className="flex-1 min-w-0 pb-2">
            <MeetingCard meeting={meeting} onOpen={openMeeting} />
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className={className}>
      {/* Header */}
      <div className="mb-5">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-gray-400" />
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        </div>
        {!isLoading && error === null && (
          <p className="text-sm text-gray-500 mt-1">
            {meetingCountLabel(totals.meetingCount)}
            {totals.meetingCount > 0 && ` · ${formatDuration(totals.durationSeconds)}`}
          </p>
        )}
      </div>

      {/* Daily brief (single day only) */}
      {isSingleDay && !isLoading && error === null && (
        <div className="mb-5">
          <DailyBriefSection
            brief={brief}
            meetingsCount={totals.meetingCount}
            onGenerate={generate}
            onCancel={cancel}
            onOpenMeeting={openMeeting}
          />
        </div>
      )}

      {/* States */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-2 text-gray-500">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">Loading meetings...</p>
          </div>
        </div>
      ) : error ? (
        <div className="border border-red-200 bg-red-50 rounded-lg p-4">
          <div className="flex items-start gap-2 text-red-700">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">Failed to load meetings</div>
              <p className="text-sm text-red-600 mt-0.5 break-words">{error}</p>
            </div>
          </div>
          <Button size="sm" variant="outline" className="mt-3" onClick={refresh}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Retry
          </Button>
        </div>
      ) : meetings.length === 0 ? (
        <div className="border border-dashed border-gray-300 rounded-lg p-10 text-center">
          <CalendarDays className="h-8 w-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm font-medium text-gray-700">No meetings on this day</p>
          <p className="text-xs text-gray-500 mt-1">
            Meetings you record on {isSingleDay ? 'this day' : 'these days'} will appear here.
          </p>
        </div>
      ) : groups ? (
        <div className="space-y-6">
          {Array.from(groups.entries()).map(([dayKey, dayMeetings]) => (
            <div key={dayKey}>
              <h2 className="text-sm font-semibold text-gray-700 mb-2">{formatDayTitle(dayKey)}</h2>
              {renderMeetingList(dayMeetings)}
            </div>
          ))}
        </div>
      ) : (
        renderMeetingList(meetings)
      )}
    </div>
  );
}
