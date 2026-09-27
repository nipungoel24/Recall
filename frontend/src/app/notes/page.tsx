'use client';

/**
 * /notes — the Meeting Notes index.
 *
 * A2 makes this a real destination instead of a dead end.
 *
 * Notes in Recall are per meeting and are edited in the meeting workspace's
 * Notes tab (persisted through `api_get_meeting_notes` /
 * `api_save_meeting_notes`). This screen therefore does NOT introduce a second
 * notes implementation or a parallel editor. It is the chronological index you
 * reach that destination from: every meeting, newest first, each row opening
 * straight into that meeting's Notes tab.
 *
 * The previous version of this route rendered a hardcoded `SAMPLE_NOTES` fixture
 * through `dangerouslySetInnerHTML` with no escaping. That demo surface is gone:
 * this screen is backed entirely by real meeting data from SidebarProvider.
 */

import React, { useMemo } from 'react';
import { NotebookPen } from 'lucide-react';

import { ListRow } from '@/components/ui/list-row';
import { PageHeader, EmptyState } from '@/components/shared/PageHeader';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { routes } from '@/lib/routes';

const DAY_MS = 24 * 60 * 60 * 1000;

type BucketId = 'today' | 'yesterday' | 'week' | 'earlier';

const BUCKET_LABEL: Record<BucketId, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This week',
  earlier: 'Earlier',
};

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function bucketFor(iso: string | undefined, now: Date): BucketId {
  if (!iso) return 'earlier';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'earlier';
  const today = startOfDay(now);
  const that = startOfDay(then);
  if (that >= today) return 'today';
  if (that === today - DAY_MS) return 'yesterday';
  if (that >= today - 7 * DAY_MS) return 'week';
  return 'earlier';
}

function formatDate(iso: string | undefined): string {
  if (!iso) return 'Unknown date';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown date';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const NotesIndexPage: React.FC = () => {
  const { meetings } = useSidebar();
  const now = useMemo(() => new Date(), []);

  const buckets = useMemo(() => {
    const order: BucketId[] = ['today', 'yesterday', 'week', 'earlier'];
    const grouped: Record<BucketId, typeof meetings> = {
      today: [],
      yesterday: [],
      week: [],
      earlier: [],
    };
    const sorted = [...meetings].sort((a, b) => {
      const at = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bt - at;
    });
    for (const meeting of sorted) grouped[bucketFor(meeting.created_at, now)].push(meeting);
    return order
      .filter((id) => grouped[id].length > 0)
      .map((id) => ({ id, label: BUCKET_LABEL[id], meetings: grouped[id] }));
  }, [meetings, now]);

  return (
    <div className="bg-background">
      <div className="mx-auto max-w-4xl px-8 py-8">
        <PageHeader
          title="Meeting Notes"
          description="Notes are written per meeting. Open a meeting to read or edit its notes."
        />

        {meetings.length === 0 ? (
          <EmptyState
            icon={<NotebookPen className="h-8 w-8" aria-hidden="true" />}
            title="No meetings yet"
            description="Once you record a meeting you can add notes to it from the meeting workspace."
          />
        ) : (
          <div className="flex flex-col gap-6">
            {buckets.map((bucket) => (
              <section key={bucket.id} aria-label={bucket.label}>
                <h2 className="px-3 pb-1.5 text-label text-muted-foreground">{bucket.label}</h2>
                <ul className="flex flex-col gap-0.5">
                  {bucket.meetings.map((meeting) => (
                    <li key={meeting.id}>
                      <ListRow
                        as="a"
                        href={routes.meetingSection(meeting.id, 'notes')}
                        label={meeting.title}
                        className="h-auto min-h-11 flex-wrap py-2"
                        trailing={
                          <span className="text-caption tabular-nums text-muted-foreground">
                            {formatDate(meeting.created_at)}
                          </span>
                        }
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default NotesIndexPage;
