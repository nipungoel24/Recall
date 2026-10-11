'use client';

/**
 * /meetings - the meeting library.
 *
 * A2 moved the meeting archive out of the sidebar so the sidebar could answer
 * "where am I going?". This screen answers "where are my meetings?".
 *
 * Phase C composition rules applied here:
 *
 * - Gutter ownership: the shell (MainContent) owns `px-8 py-6`. This page adds
 *   no horizontal padding of its own, so its content starts on exactly the same
 *   left edge as Home, Notes and Settings.
 * - Content width: an archive is a scanning surface, so it is allowed to be
 *   wider than a reading surface, but it is left-aligned rather than centred so
 *   the left edge stays put as the width changes.
 * - Density: a professional archive is a list, not a stack of cards. One row is
 *   one line of title plus right-aligned time, with the full date shown only
 *   when the date group heading does not already say it.
 * - Honesty: a failed load says so and offers Retry. It never renders as an
 *   empty archive, and it never invents meetings.
 *
 * Data comes from the existing SidebarProvider (`api_get_meetings`). There is
 * no second database access path and no local fixture.
 */

import React, { useMemo } from 'react';
import { AlertTriangle, RotateCw, SearchX } from 'lucide-react';

import { ListRow } from '@/components/ui/list-row';
import { Button } from '@/components/ui/button';
import { PageHeader, EmptyState, ListSkeleton } from '@/components/shared/PageHeader';
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
  const {
    meetings,
    searchResults,
    isSearching,
    searchError,
    searchQuery,
    isMeetingsLoading,
    meetingsError,
    refetchMeetings,
    searchTranscripts,
  } = useSidebar();

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
      if (query && !snippet && !meeting.title.toLowerCase().includes(query)) {
        continue;
      }
      grouped[bucketFor(meeting.created_at, now)].push({
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
  const isSearchingNow = searchQuery.trim().length > 0;
  const hasArchive = meetings.length > 0;

  return (
    // No page padding and no mx-auto: the shell owns the gutter, so every
    // screen's content shares one left edge. Width is capped by content type --
    // an archive row is title + date + time, so a reading measure would be too
    // narrow and the full shell width would leave a dead gap.
    <div className="max-w-4xl">
      <PageHeader
        title="Meetings"
        meta={
          meetingsError || isMeetingsLoading || !hasArchive
            ? undefined
            : `${meetings.length} ${meetings.length === 1 ? 'meeting' : 'meetings'}`
        }
        actions={
          // C9/C10: one secondary action, text only. A calendar icon beside the
          // word "Calendar" is redundant, and this screen deliberately has no
          // Start Recording button -- A2 established exactly one recording
          // action application-wide, and it lives in the sidebar footer. The
          // accessible name stays more descriptive than the visible label.
          <Button type="button" variant="outline" size="sm" asChild>
            <a href={routes.calendar()} aria-label="Open Calendar">
              Calendar
            </a>
          </Button>
        }
      />

      {meetingsError ? (
        <EmptyState
          tone="error"
          icon={<AlertTriangle className="h-7 w-7" aria-hidden="true" />}
          title="Could not load your meetings"
          description={meetingsError}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => void refetchMeetings()}>
              <RotateCw aria-hidden="true" />
              Retry
            </Button>
          }
        />
      ) : null}

      {/* A failed SEARCH is not a search that matched nothing. Without this the
          archive below renders "No matching meetings", telling the user their
          meeting is missing when the backend merely failed to answer. */}
      {searchError && isSearchingNow && !meetingsError ? (
        <EmptyState
          tone="error"
          icon={<AlertTriangle className="h-7 w-7" aria-hidden="true" />}
          title="Could not search your meetings"
          description={searchError}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => void searchTranscripts(searchQuery)}>
              <RotateCw aria-hidden="true" />
              Retry search
            </Button>
          }
        />
      ) : null}

      {!meetingsError && isMeetingsLoading && !hasArchive ? <ListSkeleton rows={8} /> : null}

      {!meetingsError && !isMeetingsLoading && !hasArchive ? (
        <EmptyState
          icon={<SearchX className="h-7 w-7" aria-hidden="true" />}
          title="No meetings yet"
          description="Recorded meetings appear here, newest first. Start one from the sidebar."
        />
      ) : null}

      {!meetingsError && !searchError && hasArchive ? (
        <div className="flex flex-col gap-8">
          {total === 0 ? (
            <EmptyState
              icon={<SearchX className="h-7 w-7" aria-hidden="true" />}
              title="No matching meetings"
              description={
                isSearchingNow && isSearching
                  ? 'Still searching transcripts.'
                  : 'No meeting title or transcript matches that search.'
              }
            />
          ) : null}

          {buckets.map((bucket) => (
            <section key={bucket.id} aria-label={bucket.label}>
              <h2 className="mb-1.5 px-2 text-label text-muted-foreground">{bucket.label}</h2>
              <ul className="flex flex-col">
                {bucket.meetings.map((meeting) => (
                  <li key={meeting.id}>
                    {/* C4: one line per meeting. Title truncates on the left,
                        date and time sit together on the right, so the eye
                        never has to cross a dead gap to read metadata. A row
                        only grows a second line when a transcript snippet
                        actually matched. */}
                    <ListRow
                      as="a"
                      href={routes.meeting(meeting.id)}
                      label={meeting.title}
                      className="h-auto min-h-9 flex-wrap py-1"
                      trailing={
                        <span className="flex items-center gap-3 text-caption tabular-nums text-muted-foreground">
                          <span>{formatDate(meeting.created_at)}</span>
                          <span>{formatTime(meeting.created_at)}</span>
                        </span>
                      }
                    >
                      {meeting.snippet ? (
                        <span className="w-full truncate text-xs text-muted-foreground">
                          {meeting.snippet}
                        </span>
                      ) : null}
                    </ListRow>
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

export default MeetingsPage;
