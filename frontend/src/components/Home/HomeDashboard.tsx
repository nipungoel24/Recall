'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  Clock,
  FileText,
  FolderPlus,
  Layers,
  Mic,
  RefreshCw,
  Sparkles,
  Sun,
} from 'lucide-react';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useContexts } from '@/components/Context/hooks';
import { meetingService } from '@/services/meetingService';
import { getDailyBriefStatus } from '@/services/dailyService';
import { MeetingMetadata } from '@/types';
import { meetingCountLabel } from '@/types/context';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/PageHeader';
import { endOfLocalDay, formatMeetingTime, localDateKey, startOfLocalDay } from '@/lib/calendar';
import { routes } from '@/lib/routes';

const MAX_RECENT = 6;
const MAX_CONTEXTS = 3;

function greetingForHour(hour: number): string {
  if (hour < 5) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function relativeDayLabel(dateKey: string, now: Date): string {
  const today = localDateKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateKey === today) return 'Today';
  if (dateKey === localDateKey(yesterday)) return 'Yesterday';
  return dateKey;
}

function relativeUpdatedLabel(iso: string | null | undefined, now: Date): string | null {
  if (!iso) return null;
  const updated = new Date(iso);
  if (isNaN(updated.getTime())) return null;
  const diffDays = Math.floor((now.getTime() - updated.getTime()) / 86400000);
  if (diffDays <= 0) return 'Updated today';
  if (diffDays === 1) return 'Updated yesterday';
  if (diffDays < 30) return `Updated ${diffDays} days ago`;
  return `Updated ${Math.floor(diffDays / 30)} months ago`;
}

/**
 * Home dashboard shown while the app is idle.
 *
 * Performance contract: this component makes exactly two lightweight backend
 * calls of its own (today's meeting metadata + daily brief status) and reuses
 * the sidebar's already-loaded meeting list and the Contexts hook. It never
 * loads transcripts, summaries bodies, or context memory — those stay lazy on
 * their own pages.
 */
export function HomeDashboard() {
  const router = useRouter();
  const { meetings } = useSidebar();
  const contextsState = useContexts();

  const now = new Date();
  const todayKey = localDateKey(now);

  const [todayMeetings, setTodayMeetings] = useState<MeetingMetadata[] | null>(null);
  const [todayError, setTodayError] = useState<string | null>(null);
  const [brief, setBrief] = useState<{ status: string; markdown?: string } | null>(null);

  const loadToday = useCallback(async () => {
    setTodayError(null);
    setTodayMeetings(null);
    try {
      const start = startOfLocalDay(new Date());
      const end = endOfLocalDay(new Date());
      const metadata = await meetingService.getMeetingsByDateRange(start, end);
      setTodayMeetings(metadata);
    } catch (err) {
      setTodayError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void loadToday();
  }, [loadToday]);

  // Refresh today's meetings and brief status whenever the meeting list
  // changes (e.g. right after a recording is saved and the sidebar refetches).
  const meetingsSignature = meetings.length;
  useEffect(() => {
    if (meetingsSignature > 0) {
      void loadToday();
    }
  }, [meetingsSignature, loadToday]);

  useEffect(() => {
    let cancelled = false;
    getDailyBriefStatus(todayKey)
      .then((status) => {
        if (cancelled) return;
        const markdown =
          status.data && typeof status.data.markdown === 'string'
            ? status.data.markdown
            : undefined;
        setBrief({ status: status.status, markdown });
      })
      .catch(() => {
        if (!cancelled) setBrief(null);
      });
    return () => {
      cancelled = true;
    };
  }, [todayKey]);

  const recentMeetings = useMemo(() => meetings.slice(0, MAX_RECENT), [meetings]);
  const recentContexts = useMemo(
    () => contextsState.contexts.slice(0, MAX_CONTEXTS),
    [contextsState.contexts],
  );
  const hasMeetings = meetings.length > 0;

  const startRecording = useCallback(() => {
    // Same mechanism as the sidebar record button: Home mounts the recording
    // hooks that listen for this event (permissions, modals, start).
    window.dispatchEvent(new CustomEvent('start-recording-from-sidebar'));
  }, []);

  const openMeeting = useCallback(
    (meetingId: string) => {
      router.push(routes.meeting(meetingId));
    },
    [router],
  );

  const briefReady = brief?.status === 'completed' && Boolean(brief.markdown);

  return (
    <div className="h-screen overflow-y-auto custom-scrollbar bg-background">
      <div className="max-w-[1080px] mx-auto px-8 py-8 pb-12">
        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-border bg-surface shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center gap-6 p-8">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-muted-foreground">
                {greetingForHour(now.getHours())}
              </p>
              <h1 className="mt-1 text-2xl font-bold text-foreground">
                {hasMeetings ? 'Ready for your next meeting?' : 'Start your first meeting'}
              </h1>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Capture a meeting and Recall will transcribe, summarize, and remember the
                important context.
              </p>
              {!hasMeetings && (
                <ol className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
                  {[
                    ['1', 'Record a meeting'],
                    ['2', 'Get transcript & summary'],
                    ['3', 'Build context over time'],
                  ].map(([num, label]) => (
                    <li key={num} className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
                        {num}
                      </span>
                      {label}
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <Button
                variant="destructive"
                size="lg"
                className="rounded-full px-6 shadow-sm"
                onClick={startRecording}
              >
                <Mic className="h-4 w-4" />
                Start Recording
              </Button>
              <Button variant="outline" size="lg" onClick={() => router.push(routes.calendar())}>
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                Calendar
              </Button>
            </div>
          </div>
        </section>

        {/* ── Main grid ────────────────────────────────────────── */}
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          {/* Left column: today + recent */}
          <div className="space-y-6 lg:col-span-2">
            {/* Today */}
            <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">Today&apos;s Meetings</h2>
                <button
                  type="button"
                  onClick={() => router.push(routes.daily())}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
                >
                  Open Daily View
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-4">
                {todayMeetings === null && !todayError ? (
                  <div className="space-y-2.5">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : todayError ? (
                  <div className="flex items-center justify-between rounded-lg border border-border bg-muted px-4 py-3">
                    <p className="text-sm text-muted-foreground">Couldn&apos;t load today&apos;s meetings.</p>
                    <Button variant="outline" size="sm" onClick={() => void loadToday()}>
                      <RefreshCw className="h-3.5 w-3.5" />
                      Retry
                    </Button>
                  </div>
                ) : todayMeetings && todayMeetings.length > 0 ? (
                  <ul className="divide-y divide-border">
                    {todayMeetings.map((meeting) => (
                      <li key={meeting.id}>
                        <button
                          type="button"
                          onClick={() => openMeeting(meeting.id)}
                          className="group flex w-full items-center gap-3 px-2 py-2.5 text-left rounded-md hover:bg-accent/50 transition-colors"
                        >
                          <span className="flex w-16 flex-shrink-0 items-center gap-1.5 text-sm font-medium text-muted-foreground tabular-nums">
                            <Clock className="h-3.5 w-3.5" />
                            {formatMeetingTime(meeting.created_at)}
                          </span>
                          <span className="flex-1 min-w-0 truncate text-sm font-medium text-foreground group-hover:text-primary">
                            {meeting.title}
                          </span>
                          {typeof meeting.duration_seconds === 'number' &&
                            meeting.duration_seconds > 0 && (
                              <Badge variant="outline" className="flex-shrink-0">
                                {Math.round(meeting.duration_seconds / 60)} min
                              </Badge>
                            )}
                          <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground/50 group-hover:text-primary" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No meetings recorded today yet. Your next recording will show up here.
                  </p>
                )}
              </div>
            </section>

            {/* Recent */}
            <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">Recent Meetings</h2>
                {recentMeetings.length > 0 && (
                  <button
                    type="button"
                    onClick={() => router.push(routes.calendar())}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
                  >
                    View all
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="mt-4">
                {recentMeetings.length === 0 ? (
                  <EmptyState
                    icon={<FileText className="h-8 w-8" />}
                    title="No meetings yet"
                    description="Recorded meetings will appear here for quick access."
                  />
                ) : (
                  <ul className="divide-y divide-border">
                    {recentMeetings.map((meeting) => {
                      const created = new Date(meeting.created_at ?? '');
                      const dayLabel = isNaN(created.getTime())
                        ? ''
                        : relativeDayLabel(localDateKey(created), now);
                      return (
                        <li key={meeting.id}>
                          <button
                            type="button"
                            onClick={() => openMeeting(meeting.id)}
                            className="group flex w-full items-center gap-3 px-2 py-2.5 text-left rounded-md hover:bg-accent/50 transition-colors"
                          >
                            <span className="flex-1 min-w-0 truncate text-sm font-medium text-foreground group-hover:text-primary">
                              {meeting.title}
                            </span>
                            <span className="flex-shrink-0 text-xs text-muted-foreground">
                              {dayLabel === 'Today' || dayLabel === 'Yesterday'
                                ? `${dayLabel}, ${formatMeetingTime(meeting.created_at ?? '')}`
                                : `${dayLabel}`}
                            </span>
                            <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground/50 group-hover:text-primary" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>
          </div>

          {/* Right column: brief + contexts */}
          <div className="space-y-6">
            {/* Daily Brief */}
            <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Daily Brief</h2>
              </div>

              <div className="mt-4">
                {todayMeetings === null ? (
                  <Skeleton className="h-20 w-full" />
                ) : todayMeetings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No meetings today yet — the Daily Brief becomes available once a day has
                    meetings.
                  </p>
                ) : briefReady ? (
                  <div>
                    <p className="line-clamp-3 text-sm text-muted-foreground whitespace-pre-wrap">
                      {brief?.markdown}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 w-full"
                      onClick={() => router.push(routes.daily())}
                    >
                      <Sun className="h-3.5 w-3.5" />
                      View Daily Brief
                    </Button>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {meetingCountLabel(todayMeetings.length)} recorded today. Combine them
                      into one polished brief.
                    </p>
                    <Button
                      variant="default"
                      size="sm"
                      className="mt-3 w-full"
                      onClick={() => router.push(routes.daily())}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Generate Daily Brief
                    </Button>
                  </div>
                )}
              </div>
            </section>

            {/* Contexts */}
            <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold text-foreground">Contexts</h2>
                </div>
                {contextsState.contexts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => router.push(routes.contexts())}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
                  >
                    View contexts
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="mt-4">
                {contextsState.isLoading ? (
                  <div className="space-y-2.5">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : recentContexts.length === 0 ? (
                  <EmptyState
                    icon={<FolderPlus className="h-8 w-8" />}
                    title="No Contexts yet"
                    description="Group related meetings into a Context — like a project or client — to keep their decisions and actions together."
                    action={
                      <Button variant="outline" size="sm" onClick={() => router.push(routes.contexts())}>
                        Create a Context
                      </Button>
                    }
                  />
                ) : (
                  <ul className="divide-y divide-border">
                    {recentContexts.map((context) => (
                      <li key={context.id}>
                        <button
                          type="button"
                          onClick={() => router.push(routes.context(context.id))}
                          className="group flex w-full items-center gap-3 px-2 py-2.5 text-left rounded-md hover:bg-accent/50 transition-colors"
                        >
                          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
                            <Layers className="h-4 w-4 text-primary" />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block truncate text-sm font-medium text-foreground group-hover:text-primary">
                              {context.name}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {meetingCountLabel(context.meetingCount)}
                              {relativeUpdatedLabel(context.updatedAt, now)
                                ? ` · ${relativeUpdatedLabel(context.updatedAt, now)}`
                                : ''}
                            </span>
                          </span>
                          <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground/50 group-hover:text-primary" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
