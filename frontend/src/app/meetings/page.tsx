'use client';

/**
 * /meetings — the meeting library.
 *
 * A2 moved the meeting archive out of the sidebar so the sidebar could answer
 * "where am I going?". This screen answers "where are my meetings?", and it has
 * the width and height to do that properly: date grouping, a real search, and a
 * selected state.
 *
 * Data comes from the existing SidebarProvider, which already fetches
 * `api_get_meetings`. There is no second database access path and no local
 * fixture — if the provider has no meetings, this screen says so.
 */

import React, { useMemo } from 'react';
import { Loader2, Search as SearchIcon, SearchX } from 'lucide-react';

import { ListRow } from '@/components/ui/list-row';
import { Button } from '@/components/ui/button';
import { PageHeader, EmptyState } from '@/components/shared/PageHeader';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { routes } from '@/lib/routes';

type BucketId = 'today' | 'yesterday' | 'week' | 'earlier';

interface Bucket {
  id: BucketId;
  label: string;
  meetings: Array<{ id: string; title: string; created_at?: string; snippet?: string }>;
}

const BUCKET_LABEL: Record<BucketId, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This week',
  earlier: 'Earlier',
};

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Assign a meeting to Today / Yesterday / This week / Earlier. */
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

function formatTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const MeetingsPage: React.FC = () => {
  const { meetings, searchResults, isSearching, searchQuery } = useSidebar();

  const now = useMemo(() => new Date(), []);

  /**
   * Transcript search results are keyed by meeting id, so a match is a snippet
   * attached to that meeting rather than a separate result list.
   */
  const snippets = useMemo(() => {
    const map = new Map<string, string>();
    for (const hit of searchResults) {
      if (hit.id && hit.matchContext && !map.has(hit.id)) map.set(hit.id, hit.matchContext);
    }
    return map;
  }, [searchResults]);

  const buckets = useMemo<Bucket[]>(() => {
    const query = searchQuery.trim().toLowerCase();
    const order: BucketId[] = ['today', 'yesterday', 'week', 'earlier'];
    const grouped: Record<BucketId, Bucket['meetings']> = {
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

    for (const meeting of sorted) {
      const snippet = snippets.get(meeting.id);
      // A transcript match narrows the list; otherwise every meeting shows.
      if (query && !snippet && !meeting.title.toLowerCase().includes(query)) continue;      grouped[bucketFor(meeting.created_at, now)].push({
        id: meeting.id,
        title: meeting.title,
        created_at: meeting.created_at,
        ...(snippet ? { snippet } : {}),
      });
    }

    return order
      .filter((id) => grouped[id].length > 0)
      .map((id) => ({ id, label: BUCKET_LABEL[id], meetings: grouped[id] }));
  }, [meetings, now, searchQuery, snippets]);

  const total = buckets.reduce((sum, b) => sum + b.meetings.length, 0);
  const isEmpty = meetings.length === 0;

  return (
    <div className="bg-background">
      <div className="mx-auto max-w-4xl px-8 py-8">
        <PageHeader
          title="Meetings"
          description="Every meeting Recall has recorded, newest first."
          actions={
            <Button type="button" variant="outline" size="sm" asChild>
              <a href={routes.calendar()}>Open Calendar</a>
            </Button>
          }
        />

        {isEmpty ? (
          <EmptyState
            icon={<SearchX className="h-8 w-8" aria-hidden="true" />}
            title="No meetings yet"
            description="Recorded meetings appear here, newest first. Start a recording from the sidebar."
          />
        ) : null}

        {isEmpty ? null : (
          <div className="flex flex-col gap-6">
            {isSearching ? (
              <p role="status" aria-live="polite" className="text-caption text-muted-foreground">
                Searching meeting transcripts…
              </p>
            ) : null}

            {total === 0 && !isSearching ? (
              <EmptyState
                icon={<SearchIcon className="h-8 w-8" aria-hidden="true" />}
                title="No matching meetings"
                description="No meeting title or transcript matches that search."
              />
            ) : null}

            {buckets.map((bucket) => (
              <section key={bucket.id} aria-label={bucket.label}>
                <h2 className="px-3 pb-1.5 text-label text-muted-foreground">{bucket.label}</h2>
                <ul className="flex flex-col gap-0.5">
                  {bucket.meetings.map((meeting) => (
                    <li key={meeting.id}>
                      <ListRow
                        as="a"
                        href={routes.meeting(meeting.id)}
                        label={meeting.title}
                        className="h-auto min-h-11 flex-wrap py-2"
                        trailing={
                          <span className="text-caption tabular-nums text-muted-foreground">
                            {formatTime(meeting.created_at)}
                          </span>
                        }
                      >
                        <span className="w-full truncate text-xs text-muted-foreground">
                          {meeting.snippet ?? formatDate(meeting.created_at)}
                        </span>
                        {meeting.snippet ? (
                          <span className="w-full truncate text-xs text-muted-foreground">
                            {formatDate(meeting.created_at)}
                          </span>
                        ) : null}
                      </ListRow>
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

export default MeetingsPage;
