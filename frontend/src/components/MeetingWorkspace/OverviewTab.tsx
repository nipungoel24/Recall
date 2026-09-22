'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  CheckSquare2,
  HelpCircle,
  Hash,
  Sparkles,
  Loader2,
  AlertCircle,
  MessageSquare,
  Bookmark,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { meetingIntelligenceService } from '@/services/meetingIntelligenceService';
import type {
  MeetingIntelligence,
  MeetingIntelligenceItem,
} from '@/types';

export interface OverviewTabProps {
  meeting: {
    id: string;
    title: string;
    created_at: string;
    updated_at?: string;
    folder_path?: string;
  };
  transcriptsCount?: number;
  onNavigateToEvidence?: (item: MeetingIntelligenceItem) => void;
  hasValidEvidence?: (item: MeetingIntelligenceItem) => boolean;
}

export function OverviewTab({
  meeting,
  transcriptsCount = 0,
  onNavigateToEvidence,
  hasValidEvidence,
}: OverviewTabProps) {
  const [intelligence, setIntelligence] = useState<MeetingIntelligence | null>(null);
  const [items, setItems] = useState<MeetingIntelligenceItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [intel, intelItems] = await Promise.all([
        meetingIntelligenceService.getMeetingIntelligence(meeting.id),
        meetingIntelligenceService.getMeetingIntelligenceItems(meeting.id),
      ]);
      setIntelligence(intel);
      setItems(intelItems);
    } catch (err) {
      console.error('Failed to load meeting intelligence:', err);
      setError('Unable to load meeting intelligence. Your meeting data remains completely safe.');
    } finally {
      setIsLoading(false);
    }
  }, [meeting.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const generated = await meetingIntelligenceService.generateMeetingIntelligence(meeting.id);
      setIntelligence({
        meeting_id: generated.meeting_id,
        abstract_text: generated.abstract_text,
        schema_version: 1,
        generated_at: new Date().toISOString(),
        provider: null,
        model: null,
      });
      const allItems = [
        ...generated.topics,
        ...generated.decisions,
        ...generated.actions,
        ...generated.questions,
        ...generated.facts,
        ...generated.follow_ups,
      ];
      setItems(allItems);
    } catch (err) {
      console.error('Failed to generate intelligence:', err);
      setError(
        'Intelligence generation could not be completed. Your existing recordings and transcripts are safe. You can retry generation or inspect the transcript directly.'
      );
    } finally {
      setIsGenerating(false);
    }
  }, [meeting.id]);

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  // Group intelligence items by kind
  const topics = items.filter((i) => i.kind === 'topic');
  const decisions = items.filter((i) => i.kind === 'decision');
  const actions = items.filter((i) => i.kind === 'action');
  const questions = items.filter((i) => i.kind === 'question');
  const factsAndFollowUps = items.filter((i) => i.kind === 'fact' || i.kind === 'follow_up');

  const hasContent = Boolean(
    intelligence?.abstract_text ||
    items.length > 0
  );

  // 1. Loading State
  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-background">
        <div className="space-y-2">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-4 w-1/4" />
        </div>
        <div className="space-y-3 pt-4">
          <Skeleton className="h-24 w-full" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  // 2. Error State
  if (error && !hasContent) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 bg-background">
        <div className="text-center max-w-md space-y-4">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-destructive/10 text-destructive mx-auto">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h3 className="text-base font-semibold text-foreground">Intelligence Unavailable</h3>
          <p className="text-sm text-muted-foreground">{error}</p>
          <div className="pt-2">
            <button
              type="button"
              onClick={loadData}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 3. Deliberate Empty State (No intelligence generated yet)
  if (!hasContent) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-background">
        <div className="max-w-md space-y-4">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-muted text-muted-foreground mx-auto">
            <Sparkles className="h-7 w-7" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">No Intelligence Generated</h2>
            <p className="text-sm text-muted-foreground">
              Structured meeting intelligence (executive abstract, decisions, action items, and verified provenance)
              has not been generated for this meeting yet.
            </p>
          </div>
          <div className="pt-2">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                  <span>Generating Intelligence...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  <span>Generate Intelligence</span>
                </>
              )}
            </button>
          </div>
          {transcriptsCount === 0 && (
            <p className="text-xs text-muted-foreground">
              Note: Generation requires transcript segments to extract structured insights.
            </p>
          )}
        </div>
      </div>
    );
  }

  // 4. Populated Overview
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-background text-foreground">
      {/* Overview Header & Metadata */}
      <div className="border-b border-border pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">{meeting.title}</h1>
            <p className="text-xs text-muted-foreground mt-1">
              Held on {formatDate(meeting.created_at)}
            </p>
          </div>
          <div>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-background text-xs font-medium text-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                  <span>Regenerating...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Regenerate</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Abstract / What Happened */}
      {intelligence?.abstract_text && (
        <section aria-labelledby="overview-abstract-heading" className="space-y-2">
          <h2 id="overview-abstract-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            Executive Summary
          </h2>
          <div className="p-4 rounded-lg border border-border bg-surface text-sm leading-relaxed text-foreground">
            {intelligence.abstract_text}
          </div>
        </section>
      )}

      {/* Key Sections Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Decisions */}
        {decisions.length > 0 && (
          <section aria-labelledby="overview-decisions-heading" className="space-y-3">
            <h2 id="overview-decisions-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Bookmark className="h-3.5 w-3.5" />
              Decisions ({decisions.length})
            </h2>
            <div className="space-y-2">
              {decisions.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  hasValidEvidence={hasValidEvidence}
                  onNavigateToEvidence={onNavigateToEvidence}
                />
              ))}
            </div>
          </section>
        )}

        {/* Action Items */}
        {actions.length > 0 && (
          <section aria-labelledby="overview-actions-heading" className="space-y-3">
            <h2 id="overview-actions-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <CheckSquare2 className="h-3.5 w-3.5" />
              Actions Required ({actions.length})
            </h2>
            <div className="space-y-2">
              {actions.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  hasValidEvidence={hasValidEvidence}
                  onNavigateToEvidence={onNavigateToEvidence}
                />
              ))}
            </div>
          </section>
        )}

        {/* Key Topics */}
        {topics.length > 0 && (
          <section aria-labelledby="overview-topics-heading" className="space-y-3">
            <h2 id="overview-topics-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Hash className="h-3.5 w-3.5" />
              Topics Discussed ({topics.length})
            </h2>
            <div className="space-y-2">
              {topics.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  hasValidEvidence={hasValidEvidence}
                  onNavigateToEvidence={onNavigateToEvidence}
                />
              ))}
            </div>
          </section>
        )}

        {/* Questions */}
        {questions.length > 0 && (
          <section aria-labelledby="overview-questions-heading" className="space-y-3">
            <h2 id="overview-questions-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <HelpCircle className="h-3.5 w-3.5" />
              Open Questions ({questions.length})
            </h2>
            <div className="space-y-2">
              {questions.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  hasValidEvidence={hasValidEvidence}
                  onNavigateToEvidence={onNavigateToEvidence}
                />
              ))}
            </div>
          </section>
        )}

        {/* Facts & Follow-ups */}
        {factsAndFollowUps.length > 0 && (
          <section aria-labelledby="overview-facts-heading" className="space-y-3 md:col-span-2">
            <h2 id="overview-facts-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              Additional Observations ({factsAndFollowUps.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {factsAndFollowUps.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  hasValidEvidence={hasValidEvidence}
                  onNavigateToEvidence={onNavigateToEvidence}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

interface ItemCardProps {
  item: MeetingIntelligenceItem;
  hasValidEvidence?: (item: MeetingIntelligenceItem) => boolean;
  onNavigateToEvidence?: (item: MeetingIntelligenceItem) => void;
}

function ItemCard({ item, hasValidEvidence, onNavigateToEvidence }: ItemCardProps) {
  const canNavigate = hasValidEvidence ? hasValidEvidence(item) : Boolean(item.sources && item.sources.length > 0);

  return (
    <div className="p-3 rounded-lg border border-border bg-surface hover:border-border-strong transition-colors flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-sm text-foreground leading-snug">{item.text}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {item.owner && (
            <span className="font-medium text-foreground/80">Owner: {item.owner}</span>
          )}
          {item.due_date && (
            <span>Due: {item.due_date}</span>
          )}
          {item.confidence !== null && item.confidence !== undefined && (
            <span className="tabular-nums">
              Confidence: {Math.round(item.confidence * 100)}%
            </span>
          )}
        </div>
      </div>
      {canNavigate && onNavigateToEvidence && (
        <button
          type="button"
          onClick={() => onNavigateToEvidence(item)}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors shrink-0 px-2 py-1 rounded hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Jump to evidence in transcript"
          aria-label={`View transcript evidence for ${item.text}`}
        >
          <MessageSquare className="h-3 w-3" />
          <span>Source</span>
        </button>
      )}
    </div>
  );
}
