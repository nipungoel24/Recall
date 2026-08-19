'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { LoaderIcon } from 'lucide-react';
import CalendarView from '@/components/Calendar';

function CalendarPageContent() {
  const searchParams = useSearchParams();
  const dateKey = searchParams.get('date');
  const monthKey = searchParams.get('month');

  return <CalendarView initialDateKey={dateKey} initialMonthKey={monthKey} />;
}

export default function CalendarPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen">
          <LoaderIcon className="animate-spin size-6" />
        </div>
      }
    >
      <CalendarPageContent />
    </Suspense>
  );
}
