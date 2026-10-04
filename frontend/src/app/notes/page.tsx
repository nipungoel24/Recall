'use client';

/**
 * /notes - the Meeting Notes index.
 *
 * Phase C6: this screen used to be visually identical to /meetings - same
 * heading, same date grouping, same row shape, same trailing date - so the two
 * destinations were indistinguishable. It is now differentiated on purpose:
 *
 * - Narrower measure. Notes are a per-meeting destination, not a scanning
 *   archive, so it gets a reading-adjacent width rather than the archive's.
 * - The row answers "where do I write notes?", not "when was this meeting?".
 *   The trailing affordance names the destination instead of repeating a date
 *   the list is already grouped by.
 * - The header explains the one genuinely non-obvious thing about notes in
 *   Recall: they live inside a meeting.
 *
 * Deliberately NOT done, because it would require a backend change that is out
 * of Phase C scope: a "has notes" indicator. Note presence lives in
 * `meeting_notes`, and there is no read-only query for it, so this screen cannot
 * know which meetings actually have notes and does not pretend to. The database
 * currently holds zero note rows.
 *
 * No second notes implementation, no parallel editor, no schema change. Editing
 * still happens in the meeting workspace's Notes tab.
 */

import React, { useMemo } from 'react';
import { ChevronRight, NotebookPen } from 'lucide-react';

import { ListRow } from '@/components/ui/list-row';
import { PageHeader, EmptyState, ListSkeleton } from '@/components/shared/PageHeader';
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

const NotesIndexPage: React.FC = () => {
  const { meetings, isMeetingsLoading, meetingsError } = useSidebar();
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

  const hasMeetings = meetings.length > 0;

  return (
    // Shell owns the gutter; this screen is a narrower, reading-adjacent
    // measure and stays left-aligned with every other page.
    <div className="max-w-3xl">
      <PageHeader
        title="Meeting Notes"
        description="Notes belong to a meeting. Open one to read or write its notes."
        meta={hasMeetings ? `${meetings.length} available` : undefined}
      />

      {meetingsError ? (
        <EmptyState
          tone="error"
          icon={<NotebookPen className="h-7 w-7" aria-hidden="true" />}
          title="Could not load meetings"
          description={meetingsError}
        />
      ) : null}

      {!meetingsError && isMeetingsLoading && !hasMeetings ? <ListSkeleton rows={6} /> : null}

      {!meetingsError && !isMeetingsLoading && !hasMeetings ? (
        <EmptyState
          icon={<NotebookPen className="h-7 w-7" aria-hidden="true" />}
          title="No meetings yet"
          description="Notes are written inside a meeting, so record one first and its notes will be available here."
        />
      ) : null}

      {!meetingsError && hasMeetings ? (
        <div className="flex flex-col gap-8">
          <p className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <NotebookPen className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              No meeting has notes written yet. Choose a meeting to open its notes editor.
            </span>
          </p>

          {buckets.map((bucket) => (
            <section key={bucket.id} aria-label={bucket.label}>
              <h2 className="mb-1.5 px-2 text-label text-muted-foreground">{bucket.label}</h2>
              <ul className="flex flex-col">
                {bucket.meetings.map((meeting) => (
                  <li key={meeting.id}>
                    <ListRow
                      as="a"
                      href={routes.meetingSection(meeting.id, 'notes')}
                      label={meeting.title}
                      className="h-auto min-h-9 py-1"
                      trailing={
                        <span className="flex items-center gap-1 text-caption text-muted-foreground">
                          Notes
                          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                      }
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default NotesIndexPage;
