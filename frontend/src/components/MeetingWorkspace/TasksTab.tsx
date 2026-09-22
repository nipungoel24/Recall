'use client';

import { useState, useEffect, useCallback } from 'react';
import { CheckSquare2, Loader2, MessageSquare, AlertCircle, Sparkles } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { meetingIntelligenceService } from '@/services/meetingIntelligenceService';
import type { MeetingIntelligence, MeetingIntelligenceItem } from '@/types';

export interface TasksTabProps {
  meeting: {
    id: string;
    title: string;
  };
  onNavigateToEvidence?: (item: MeetingIntelligenceItem) => void;
  hasValidEvidence?: (item: MeetingIntelligenceItem) => boolean;
}

export function TasksTab({
  meeting,
  onNavigateToEvidence,
  hasValidEvidence,
}: TasksTabProps) {
  const [intelligence, setIntelligence] = useState<MeetingIntelligence | null>(null);
  const [tasks, setTasks] = useState<MeetingIntelligenceItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [intel, items] = await Promise.all([
        meetingIntelligenceService.getMeetingIntelligence(meeting.id),
        meetingIntelligenceService.getMeetingIntelligenceItems(meeting.id),
      ]);
      setIntelligence(intel);
      setTasks(items.filter((item) => item.kind === 'action'));
    } catch (err) {
      console.error('Failed to load meeting tasks:', err);
      setError('Failed to load tasks for this meeting.');
    } finally {
      setIsLoading(false);
    }
  }, [meeting.id]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

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
      setTasks(generated.actions);
    } catch (err) {
      console.error('Failed to generate intelligence:', err);
      setError(
        'Intelligence generation could not be completed. Your existing recordings and transcripts are safe. You can retry generation or inspect the transcript directly.'
      );
    } finally {
      setIsGenerating(false);
    }
  }, [meeting.id]);

  // 1. Loading State
  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-background">
        <Skeleton className="h-6 w-1/4" />
        <div className="space-y-3 pt-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    );
  }

  // 2. Error State
  if (error) {
    return (
      <div role="alert" className="flex-1 flex items-center justify-center p-6 bg-background">
        <div className="text-center max-w-md space-y-4">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-destructive/10 text-destructive mx-auto">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h3 className="text-base font-semibold text-foreground">Tasks Unavailable</h3>
          <p className="text-sm text-muted-foreground">{error}</p>
          <div className="pt-2">
            <button
              type="button"
              onClick={loadTasks}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 3. No Intelligence Generated Yet
  if (intelligence === null) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-background">
        <div className="max-w-md space-y-4">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-muted text-muted-foreground mx-auto">
            <Sparkles className="h-7 w-7" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">No Intelligence Generated</h2>
            <p className="text-sm text-muted-foreground">
              Action items are extracted from meeting intelligence. Generate intelligence for this
              meeting to identify action items, decisions, and key discussion points.
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
        </div>
      </div>
    );
  }

  // 4. Populated or Empty (intelligence exists)
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-background">
      <div className="border-b border-border pb-4">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <CheckSquare2 className="h-5 w-5 text-muted-foreground" />
          Action Items
          {tasks.length > 0 && (
            <span className="text-sm font-normal text-muted-foreground">({tasks.length})</span>
          )}
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Action items are AI-extracted from meeting intelligence and may require verification.
        </p>
      </div>

      {tasks.length === 0 ? (
        // 4a. Intelligence ran but found no action items
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
            <CheckSquare2 className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-medium text-foreground">No Action Items Identified</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
            Recall did not identify action items in this meeting. If you believe action items were
            discussed, try regenerating intelligence from the Overview tab.
          </p>
        </div>
      ) : (
        // 4b. Populated action items list
        <div className="space-y-3">
          {tasks.map((task) => {
            const canNavigate = hasValidEvidence
              ? hasValidEvidence(task)
              : Boolean(task.sources && task.sources.length > 0);
            return (
              <div
                key={task.id}
                className="p-4 rounded-lg border border-border bg-surface hover:border-border-strong transition-colors flex items-start justify-between gap-4"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="mt-0.5 text-muted-foreground shrink-0">
                    <CheckSquare2 className="h-4 w-4" />
                  </div>
                  <div className="space-y-1.5 min-w-0">
                    <p className="text-sm text-foreground leading-snug">{task.text}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {task.owner && (
                        <span className="font-medium text-foreground/80">
                          Owner: {task.owner}
                        </span>
                      )}
                      {task.due_date && (
                        <span>Due: {task.due_date}</span>
                      )}
                      {task.status && (
                        <span className="capitalize px-2 py-0.5 rounded bg-muted text-muted-foreground">
                          {task.status}
                        </span>
                      )}
                      {task.confidence !== null && task.confidence !== undefined && (
                        <span className="tabular-nums">
                          {Math.round(task.confidence * 100)}% confidence
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {canNavigate && onNavigateToEvidence && (
                  <button
                    type="button"
                    onClick={() => onNavigateToEvidence(task)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors shrink-0 px-2 py-1 rounded hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title="Jump to evidence in transcript"
                    aria-label={`View transcript evidence for: ${task.text}`}
                  >
                    <MessageSquare className="h-3 w-3" />
                    <span>Source</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
