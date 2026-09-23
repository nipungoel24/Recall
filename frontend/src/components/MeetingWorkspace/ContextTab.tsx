'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Layers,
  Loader2,
  MessageSquare,
  AlertTriangle,
  ExternalLink,
  BookOpen,
  CheckCircle2,
  HelpCircle,
  FileText,
  Bookmark,
} from 'lucide-react';
import { contextService } from '@/services/contextService';
import { routes } from '@/lib/routes';
import {
  provenanceLinkForItem,
  rankContextMemoryItems,
  type ContextThreadSummary,
  type ContextMeetingInfo,
  type CompactContextMemory,
  type ContextMemoryItem,
} from '@/types/context';

export interface ContextTabProps {
  meeting: {
    id: string;
    title: string;
  };
}

export function ContextTab({ meeting }: ContextTabProps) {
  const [contexts, setContexts] = useState<ContextThreadSummary[]>([]);
  const [memberContextIds, setMemberContextIds] = useState<Set<string>>(new Set());
  const [selectedContextId, setSelectedContextId] = useState<string | null>(null);
  const [contextMeetings, setContextMeetings] = useState<ContextMeetingInfo[]>([]);
  const [selectedMemory, setSelectedMemory] = useState<CompactContextMemory | null>(null);
  const [isLoadingContexts, setIsLoadingContexts] = useState(true);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState<string | null>(null);
  const [isRemoving, setIsRemoving] = useState<string | null>(null);

  const loadContexts = useCallback(async () => {
    setIsLoadingContexts(true);
    setContextError(null);
    try {
      const threads = await contextService.listContextThreads();
      setContexts(threads);

      // Check membership of current meeting across all contexts
      const membershipChecks = await Promise.all(
        threads.map(async (t) => {
          try {
            const m = await contextService.getContextMeetings(t.id);
            return { id: t.id, isMember: m.some((item) => item.id === meeting.id) };
          } catch {
            return { id: t.id, isMember: false };
          }
        })
      );
      const memberIds = new Set(
        membershipChecks.filter((c) => c.isMember).map((c) => c.id)
      );
      setMemberContextIds(memberIds);
    } catch (err) {
      console.error('Failed to load contexts:', err);
      setContextError('Failed to load context threads. Please try again.');
      toast.error('Failed to load contexts');
    } finally {
      setIsLoadingContexts(false);
    }
  }, [meeting.id]);

  const loadContextDetails = useCallback(async (contextId: string) => {
    setSelectedContextId(contextId);
    setIsLoadingDetails(true);
    try {
      const [meetings, memory] = await Promise.all([
        contextService.getContextMeetings(contextId),
        contextService.getCompactContextMemory(contextId),
      ]);
      setContextMeetings(meetings);
      setSelectedMemory(memory);
    } catch (err) {
      console.error('Failed to load context details:', err);
      toast.error('Failed to load context details');
    } finally {
      setIsLoadingDetails(false);
    }
  }, []);

  useEffect(() => {
    loadContexts();
  }, [loadContexts]);

  const handleAddToContext = useCallback(
    async (contextId: string) => {
      setIsAdding(contextId);
      try {
        const result = await contextService.addMeetingToContext(contextId, meeting.id);
        if (result.added) {
          toast.success('Meeting added to context');
          setMemberContextIds((prev) => new Set([...prev, contextId]));
          await loadContexts();
          if (selectedContextId === contextId) {
            await loadContextDetails(contextId);
          }
        }
      } catch (err) {
        console.error('Failed to add meeting to context:', err);
        toast.error('Failed to add meeting to context');
      } finally {
        setIsAdding(null);
      }
    },
    [meeting.id, selectedContextId, loadContexts, loadContextDetails]
  );

  const handleRemoveFromContext = useCallback(
    async (contextId: string) => {
      setIsRemoving(contextId);
      try {
        const result = await contextService.removeMeetingFromContext(contextId, meeting.id);
        if (result.removed) {
          toast.success('Meeting removed from context');
          setMemberContextIds((prev) => {
            const next = new Set(prev);
            next.delete(contextId);
            return next;
          });
          await loadContexts();
          if (selectedContextId === contextId) {
            await loadContextDetails(contextId);
          }
        }
      } catch (err) {
        console.error('Failed to remove meeting from context:', err);
        toast.error('Failed to remove meeting from context');
      } finally {
        setIsRemoving(null);
      }
    },
    [meeting.id, selectedContextId, loadContexts, loadContextDetails]
  );

  const renderKindIcon = (kind: string) => {
    switch (kind) {
      case 'decision':
        return <Bookmark className="h-3.5 w-3.5 text-primary" />;
      case 'action':
        return <CheckCircle2 className="h-3.5 w-3.5 text-amber-500" />;
      case 'question':
        return <HelpCircle className="h-3.5 w-3.5 text-sky-500" />;
      case 'fact':
        return <BookOpen className="h-3.5 w-3.5 text-emerald-500" />;
      case 'note':
      default:
        return <FileText className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  const renderStatusBadge = (status?: string | null) => {
    if (!status) return null;
    const lower = status.toLowerCase();
    let badgeClass = 'bg-muted text-muted-foreground border-border';
    if (lower === 'open') {
      badgeClass = 'bg-amber-500/10 text-amber-500 border-amber-500/20';
    } else if (lower === 'done' || lower === 'resolved') {
      badgeClass = 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
    } else if (lower === 'blocked') {
      badgeClass = 'bg-destructive/10 text-destructive border-destructive/20';
    }
    return (
      <span className={`px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded border ${badgeClass}`}>
        {status}
      </span>
    );
  };

  if (isLoadingContexts) {
    return (
      <div className="h-full flex items-center justify-center bg-background" role="status" aria-live="polite">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-primary animate-spin motion-reduce:animate-none" />
          <span className="text-sm text-muted-foreground">Loading contexts...</span>
        </div>
      </div>
    );
  }

  if (contextError) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-background">
        <div role="alert" className="max-w-md w-full p-4 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive flex flex-col items-center gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 flex-shrink-0" />
            <span className="text-sm font-medium">{contextError}</span>
          </div>
          <button
            type="button"
            onClick={loadContexts}
            className="px-4 py-1.5 text-xs font-medium border border-destructive/40 bg-background rounded-md hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="p-4 border-b border-border bg-background flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-foreground">Context Membership & Continuous Memory</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Link this meeting to context threads to build cumulative cross-meeting knowledge.
          </p>
        </div>
        <Link
          href={routes.contexts()}
          className="text-xs text-primary hover:underline flex items-center gap-1 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1 py-0.5"
        >
          Manage Contexts
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {contexts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
              <Layers className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No Contexts Yet</h3>
            <p className="text-muted-foreground text-sm mb-6 max-w-xs">
              Create a context thread to group related meetings and build persistent memory across them.
            </p>
            <Link
              href={routes.contexts()}
              className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
            >
              Create First Context
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {contexts.map((context: ContextThreadSummary) => {
              const isSelected = selectedContextId === context.id;
              const isInContext = memberContextIds.has(context.id);
              const isActionPending = isAdding === context.id || isRemoving === context.id;

              return (
                <div
                  key={context.id}
                  className={`rounded-lg border transition-all ${
                    isSelected ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/40'
                  }`}
                >
                  <div className="p-4 flex items-start justify-between gap-4">
                    <button
                      type="button"
                      onClick={() => loadContextDetails(context.id)}
                      className="flex-1 min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md p-1 -m-1"
                      aria-label={`Select context ${context.name}`}
                    >
                      <div className="flex items-center gap-2">
                        <Layers className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        <div className="min-w-0">
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
                        {isInContext && (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-medium">
                            Member
                          </span>
                        )}
                      </div>
                    </button>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {isInContext ? (
                        <button
                          type="button"
                          onClick={() => handleRemoveFromContext(context.id)}
                          disabled={isActionPending}
                          className="px-3 py-1.5 text-sm font-medium text-destructive bg-destructive/10 border border-destructive/20 rounded-md hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 transition-colors"
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
                          className="px-3 py-1.5 text-sm font-medium text-primary bg-primary/10 border border-primary/20 rounded-md hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 transition-colors"
                        >
                          {isAdding === context.id ? (
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

                  {isSelected && (
                    <div className="border-t border-border px-4 py-4 space-y-5 bg-background/50">
                      {isLoadingDetails ? (
                        <div className="py-6 flex items-center justify-center gap-2 text-muted-foreground text-sm" role="status">
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                          <span>Loading context memory and meetings...</span>
                        </div>
                      ) : (
                        <>
                          {/* Continuous Context Memory Display */}
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                                <BookOpen className="h-3.5 w-3.5 text-primary" />
                                Continuous Memory (Durable Knowledge)
                              </h4>
                              {selectedMemory?.items && selectedMemory.items.length > 0 && (
                                <span className="text-xs text-muted-foreground">
                                  {selectedMemory.items.length} active item{selectedMemory.items.length !== 1 ? 's' : ''}
                                </span>
                              )}
                            </div>

                            {/* Durable Digest Markdown */}
                            {selectedMemory?.memoryMarkdown && selectedMemory.memoryMarkdown.trim().length > 0 && (
                              <div className="mb-3 rounded-md border border-border bg-muted/30 p-3 text-xs text-foreground whitespace-pre-wrap font-mono leading-relaxed">
                                <div className="text-[10px] uppercase font-sans font-semibold text-muted-foreground tracking-wider mb-1">
                                  Durable Digest
                                </div>
                                {selectedMemory.memoryMarkdown}
                              </div>
                            )}

                            {/* Active Memory Items */}
                            {selectedMemory?.items && selectedMemory.items.length > 0 ? (
                              <div className="space-y-2">
                                {rankContextMemoryItems(selectedMemory.items).map((item: ContextMemoryItem) => {
                                  const prov = provenanceLinkForItem(item);
                                  return (
                                    <div
                                      key={item.id}
                                      className="p-2.5 rounded-md border border-border bg-card flex flex-col gap-1 text-xs"
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-1.5">
                                          {renderKindIcon(item.kind)}
                                          <span className="font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">
                                            {item.kind}
                                          </span>
                                          {renderStatusBadge(item.status)}
                                        </div>
                                        {prov ? (
                                          <Link
                                            href={prov.href}
                                            className="text-xs text-primary hover:underline flex items-center gap-1 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                                          >
                                            <span className="truncate max-w-[140px]">{prov.title}</span>
                                            <ExternalLink className="h-3 w-3 flex-shrink-0" />
                                          </Link>
                                        ) : (
                                          <span className="text-[11px] text-muted-foreground">manual entry</span>
                                        )}
                                      </div>
                                      <p className="text-foreground text-xs leading-normal mt-0.5">{item.content}</p>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              (!selectedMemory?.memoryMarkdown || selectedMemory.memoryMarkdown.trim().length === 0) && (
                                <p className="text-xs text-muted-foreground text-center py-3 border border-dashed border-border rounded-md">
                                  No continuous memory items recorded yet for this context. Memory is automatically extracted after meetings are summarized.
                                </p>
                              )
                            )}
                          </div>

                          {/* Associated Meetings */}
                          <div className="pt-2 border-t border-border">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                              <MessageSquare className="h-3.5 w-3.5 text-primary" />
                              Meetings in this Context
                            </h4>
                            {contextMeetings.length === 0 ? (
                              <p className="text-xs text-muted-foreground text-center py-3 border border-dashed border-border rounded-md">
                                No meetings attached to this context yet.
                              </p>
                            ) : (
                              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                {contextMeetings.map((m: ContextMeetingInfo) => (
                                  <div
                                    key={m.id}
                                    className={`flex items-center justify-between p-2.5 rounded-md border text-xs transition-colors ${
                                      m.id === meeting.id
                                        ? 'border-primary bg-primary/10'
                                        : 'border-border bg-card'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <MessageSquare className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                      <span className="font-medium text-foreground truncate">{m.title}</span>
                                      <span className="text-[11px] text-muted-foreground flex-shrink-0">
                                        {m.createdAt ? new Date(m.createdAt).toLocaleDateString() : ''}
                                      </span>
                                    </div>
                                    {m.id === meeting.id && (
                                      <span className="px-2 py-0.5 text-[10px] font-semibold text-primary bg-primary/15 rounded-full flex-shrink-0">
                                        Current
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}