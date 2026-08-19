'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { LoaderIcon } from 'lucide-react';
import { normalizeDateKey } from '@/lib/daily/timeline';
import { DailyMeetingView } from '@/components/DailyMeeting';

/**
 * Daily meetings page.
 *
 * Driven by the Calendar (owned by another team member). Calendar navigates
 * here with:
 *   - /daily?date=YYYY-MM-DD            (single day)
 *   - /daily?start=YYYY-MM-DD&end=YYYY-MM-DD (range, optional)
 *
 * No date defaults to today.
 */
function DailyPageContent() {
  const searchParams = useSearchParams();

  const { date, range } = useMemo(() => {
    const rawDate = searchParams.get('date');
    const rawStart = searchParams.get('start');
    const rawEnd = searchParams.get('end');

    if (rawDate) {
      const key = normalizeDateKey(rawDate);
      return key ? { date: key, range: null } : { date: null, range: null };
    }

    if (rawStart && rawEnd) {
      const startKey = normalizeDateKey(rawStart);
      const endKey = normalizeDateKey(rawEnd);
      if (startKey && endKey) {
        return { date: null, range: { start: startKey, end: endKey } };
      }
    }

    return { date: null, range: null };
  }, [searchParams]);

  return (
    <div className="h-screen overflow-y-auto custom-scrollbar bg-gray-50">
      <div className="max-w-4xl mx-auto px-6 py-6">
        <DailyMeetingView date={date ?? undefined} dateRange={range ?? undefined} />
      </div>
    </div>
  );
}

export default function DailyPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen">
          <LoaderIcon className="animate-spin size-6" />
        </div>
      }
    >
      <DailyPageContent />
    </Suspense>
  );
}
