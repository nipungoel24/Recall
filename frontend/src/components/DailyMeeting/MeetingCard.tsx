'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Clock, ExternalLink, FileText, Loader2 } from 'lucide-react';
import type { Transcript } from '@/types';
import type { DailyMeeting } from '@/types/daily';
import { formatDuration, legacySummaryToMarkdown, meetingTimeLabel } from '@/lib/daily/timeline';
import { fetchMeetingSummary, fetchTranscriptPage } from '@/services/dailyService';
import { MarkdownRenderer } from './MarkdownRenderer';
import { Button } from '@/components/ui/button';

const TRANSCRIPT_PREVIEW_PAGE_SIZE = 50;

interface MeetingCardProps {
  meeting: DailyMeeting;
  onOpen: (meetingId: string) => void;
  defaultExpanded?: boolean;
}

type SummaryPreview =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'markdown'; markdown: string }
  | { state: 'blocknote' }
  | { state: 'none' };

/**
 * A single expandable entry on the daily timeline.
 *
 * Only meeting metadata renders by default. The summary and a transcript
 * preview are fetched lazily on first expansion; full transcripts are never
 * loaded here.
 */
export function MeetingCard({ meeting, onOpen, defaultExpanded = false }: MeetingCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [summary, setSummary] = useState<SummaryPreview>({ state: 'idle' });
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [transcriptTotal, setTranscriptTotal] = useState(0);
  const [transcriptHasMore, setTranscriptHasMore] = useState(false);
  const [transcriptsLoading, setTranscriptsLoading] = useState(false);
  const loadedContentRef = useRef(false);

  const timeLabel = meetingTimeLabel(meeting);

  const loadExpandedContent = useCallback(async () => {
    if (loadedContentRef.current) return;
    loadedContentRef.current = true;

    setSummary({ state: 'loading' });
    try {
      const result = await fetchMeetingSummary(meeting.id);
      const data = result.data;

      if (!data) {
        setSummary({ state: 'none' });
      } else if (typeof data.markdown === 'string' && data.markdown.trim()) {
        setSummary({ state: 'markdown', markdown: data.markdown.trim() });
      } else if (Array.isArray(data.summary_json)) {
        setSummary({ state: 'blocknote' });
      } else {
        const legacy = legacySummaryToMarkdown(data);
        if (legacy && !legacy.startsWith('# Untitled')) {
          setSummary({ state: 'markdown', markdown: legacy });
        } else {
          setSummary({ state: 'none' });
        }
      }
    } catch (error) {
      console.error('Failed to load meeting summary preview:', error);
      setSummary({ state: 'error', message: 'Failed to load summary preview.' });
    }

    if (meeting.transcriptCount !== 0) {
      setTranscriptsLoading(true);
      try {
        const page = await fetchTranscriptPage(meeting.id, TRANSCRIPT_PREVIEW_PAGE_SIZE, 0);
        setTranscripts(page.transcripts);
        setTranscriptTotal(page.total_count);
        setTranscriptHasMore(page.has_more);
      } catch (error) {
        console.error('Failed to load transcript preview:', error);
      } finally {
        setTranscriptsLoading(false);
      }
    }
  }, [meeting.id, meeting.transcriptCount]);

  useEffect(() => {
    if (expanded) {
      loadExpandedContent();
    }
  }, [expanded, loadExpandedContent]);

  const loadMoreTranscripts = useCallback(async () => {
    setTranscriptsLoading(true);
    try {
      const page = await fetchTranscriptPage(meeting.id, TRANSCRIPT_PREVIEW_PAGE_SIZE, transcripts.length);
      setTranscripts((prev) => {
        const existing = new Set(prev.map((t) => t.id));
        return [...prev, ...page.transcripts.filter((t) => !existing.has(t.id))];
      });
      setTranscriptTotal(page.total_count);
      setTranscriptHasMore(page.has_more);
    } catch (error) {
      console.error('Failed to load more transcripts:', error);
    } finally {
      setTranscriptsLoading(false);
    }
  }, [meeting.id, transcripts.length]);

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
        )}
        <div className="w-16 flex-shrink-0 flex items-center gap-1.5 text-sm font-medium text-gray-700 tabular-nums">
          {timeLabel ? (
            <>
              <Clock className="h-3.5 w-3.5 text-gray-400" />
              {timeLabel}
            </>
          ) : (
            <span className="text-gray-400">--:--</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="truncate font-medium text-gray-900">{meeting.title}</div>
          <div className="text-xs text-gray-500">
            {meeting.durationSeconds > 0
              ? formatDuration(meeting.durationSeconds)
              : meeting.transcriptCount === 0
                ? 'No transcript yet'
                : meeting.transcriptCount !== null
                  ? `${meeting.transcriptCount} transcript segments`
                  : ''}
          </div>
        </div>
        {meeting.transcriptCount !== null && meeting.transcriptCount > 0 && (
          <span className="hidden sm:inline-flex items-center gap-1 text-xs text-gray-400 flex-shrink-0">
            <FileText className="h-3.5 w-3.5" />
            {meeting.transcriptCount}
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-4">
          {/* Summary preview */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
              Summary
            </div>
            {summary.state === 'loading' && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading summary...
              </div>
            )}
            {summary.state === 'error' && (
              <p className="text-sm text-red-600">{summary.message}</p>
            )}
            {summary.state === 'none' && (
              <p className="text-sm text-gray-500">
                No summary yet. Open the meeting to generate one.
              </p>
            )}
            {summary.state === 'blocknote' && (
              <p className="text-sm text-gray-500">
                Summary available. Open the meeting to view it.
              </p>
            )}
            {summary.state === 'markdown' && (
              <div className="max-h-64 overflow-y-auto pr-1">
                <MarkdownRenderer markdown={summary.markdown} />
              </div>
            )}
          </div>

          {/* Transcript preview */}
          {meeting.transcriptCount !== 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                Transcript preview
                <span className="ml-1 font-normal text-gray-400">
                  {transcripts.length > 0
                    ? `(${transcripts.length} of ${transcriptTotal})`
                    : meeting.transcriptCount !== null
                      ? `(${meeting.transcriptCount} segments)`
                      : ''}
                </span>
              </div>
              {transcriptsLoading && transcripts.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading transcript preview...
                </div>
              ) : !transcriptsLoading && transcripts.length === 0 ? (
                <p className="text-sm text-gray-500">No transcripts yet.</p>
              ) : (
                <>
                  <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                    {transcripts.map((segment) => (
                      <div key={segment.id} className="flex gap-2 text-sm">
                        <span className="text-gray-400 tabular-nums flex-shrink-0 w-16 text-right">
                          {segment.timestamp}
                        </span>
                        <span className="text-gray-700">{segment.text}</span>
                      </div>
                    ))}
                  </div>
                  {transcriptHasMore && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2"
                      onClick={loadMoreTranscripts}
                      disabled={transcriptsLoading}
                    >
                      {transcriptsLoading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                      Load more
                    </Button>
                  )}
                </>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpen(meeting.id)}
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              Open full meeting details
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
