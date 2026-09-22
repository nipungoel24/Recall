'use client';

import { SummaryPanel } from '@/components/MeetingDetails/SummaryPanel';
import type { ComponentProps } from 'react';

export type SummaryTabProps = ComponentProps<typeof SummaryPanel>;

export function SummaryTab(props: SummaryTabProps) {
  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-background">
      <SummaryPanel {...props} />
    </div>
  );
}