'use client';

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { Layers, Loader2, MessageSquare } from 'lucide-react';
import { contextService } from '@/services/contextService';
import type { ContextThreadSummary, ContextMeetingInfo } from '@/types/context';

export interface ContextTabProps {
  meeting: {
    id: string;
    title: string;
  };
}

export function ContextTab({ meeting }: ContextTabProps) {
  const [contexts, setContexts] = useState<ContextThreadSummary[]>([]);
  const [selectedContextId, setSelectedContextId] = useState<string | null>(null);
  const [contextMeetings, setContextMeetings] = useState<ContextMeetingInfo[]>([]);
  const [isLoadingContexts, setIsLoadingContexts] = useState(true);
  const [isLoadingMeetings, setIsLoadingMeetings] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isRemoving, setIsRemoving] = useState<string | null>(null);

  const loadContexts = useCallback(async () => {
    setIsLoadingContexts(true);
    try {
      const threads = await contextService.listContextThreads();
      setContexts(threads);
    } catch (err) {
      console.error('Failed to load contexts:', err);
      toast.error('Failed to load contexts');
    } finally {
      setIsLoadingContexts(false);
    }
  }, []);

  const loadContextMeetings = useCallback(async (contextId: string) => {
    setIsLoadingMeetings(true);
    try {
      const meetings = await contextService.getContextMeetings(contextId);
      setContextMeetings(meetings);
      setSelectedContextId(contextId);
    } catch (err) {
      console.error('Failed to load context meetings:', err);
      toast.error('Failed to load context meetings');
    } finally {
      setIsLoadingMeetings(false);
    }
  }, []);

  useEffect(() => {
    loadContexts();
  }, [loadContexts]);

  const handleAddToContext = useCallback(
    async (contextId: string) => {
      setIsAdding(true);
      try {
        const result = await contextService.addMeetingToContext(contextId, meeting.id);
        if (result.added) {
          toast.success('Meeting added to context');
          await loadContexts();
          if (selectedContextId === contextId) {
            await loadContextMeetings(contextId);
          }
        }
      } catch (err) {
        console.error('Failed to add meeting to context:', err);
        toast.error('Failed to add meeting to context');
      } finally {
        setIsAdding(false);
      }
    },
    [meeting.id, selectedContextId, loadContexts, loadContextMeetings]
  );

  const handleRemoveFromContext = useCallback(
    async (contextId: string) => {
      setIsRemoving(contextId);
      try {
        const result = await contextService.removeMeetingFromContext(contextId, meeting.id);
        if (result.removed) {
          toast.success('Meeting removed from context');
          await loadContexts();
          if (selectedContextId === contextId) {
            await loadContextMeetings(contextId);
          }
        }
      } catch (err) {
        console.error('Failed to remove meeting from context:', err);
        toast.error('Failed to remove meeting from context');
      } finally {
        setIsRemoving(null);
      }
    },
    [meeting.id, selectedContextId, loadContexts, loadContextMeetings]
  );

  if (isLoadingContexts) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-border border-t-foreground rounded-full animate-spin motion-reduce:animate-none" />
          <span className="text-sm text-muted-foreground">Loading contexts...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="p-4 border-b border-border bg-background">
        <h2 className="text-sm font-medium text-foreground">Context Membership</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {contexts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
              <Layers className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No Contexts Yet</h3>
            <p className="text-muted-foreground text-sm mb-6 max-w-xs">
              Create a context to group related meetings and build persistent memory across them.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {contexts.map((context: ContextThreadSummary) => {
              const isSelected = selectedContextId === context.id;
              const isInContext = contextMeetings.some((m) => m.id === meeting.id);
              const isActionPending = isAdding || isRemoving === context.id;

              return (
                <div
                  key={context.id}
                  className={`p-4 rounded-lg border transition-all ${
                    isSelected ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/50'
                  }`}
                  onClick={() => loadContextMeetings(context.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      loadContextMeetings(context.id);
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Layers className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        <div>
                          <h3 className="font-medium text-foreground truncate">{context.name}</h3>
                          {context.description && (
                            <p className="text-sm text-muted-foreground truncate">{context.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
                        <span className="px-2 py-0.5 rounded-full bg-muted">
                          {context.meetingCount} meeting{context.meetingCount !== 1 ? 's' : ''}
                        </span>
                        {context.memoryItemCount > 0 && (
                          <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                            {context.memoryItemCount} memor{context.memoryItemCount === 1 ? 'y' : 'ies'}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      {isInContext ? (
                        <button
                          type="button"
                          onClick={() => handleRemoveFromContext(context.id)}
                          disabled={isActionPending}
                          className="px-3 py-1.5 text-sm font-medium text-destructive bg-destructive/10 border border-destructive/20 rounded-md hover:bg-destructive/20 disabled:opacity-50 transition-colors"
                        >
                          {isRemoving === context.id ? (
                            <>
                              <Loader2 className="h-3 w-3 animate-spin mr-1 inline" />
                              Removing...
                            </>
                          ) : (
                            'Remove'
                          )}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleAddToContext(context.id)}
                          disabled={isActionPending}
                          className="px-3 py-1.5 text-sm font-medium text-primary bg-primary/10 border border-primary/20 rounded-md hover:bg-primary/20 disabled:opacity-50 transition-colors"
                        >
                          {isAdding ? (
                            <>
                              <Loader2 className="h-3 w-3 animate-spin mr-1 inline" />
                              Adding...
                            </>
                          ) : (
                            'Add Meeting'
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {selectedContextId && (
              <div className="mt-6 border-t border-border pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-foreground">Meetings in this Context</h3>
                  {isLoadingMeetings && <Loader2 className="h-4 w-4 animate-spin" />}
                </div>
                {contextMeetings.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No meetings in this context yet.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {contextMeetings.map((m: ContextMeetingInfo) => (
                      <div
                        key={m.id}
                        className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                          m.id === meeting.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/50'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex-shrink-0 w-9 h-9 rounded-full bg-muted flex items-center justify-center">
                            <MessageSquare className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-foreground truncate">{m.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(m.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        {m.id === meeting.id && (
                          <span className="px-2 py-0.5 text-xs font-medium text-primary bg-primary/10 rounded-full">
                            Current
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}