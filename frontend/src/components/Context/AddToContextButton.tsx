'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowUpRight, Layers, Loader2, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Analytics from '@/lib/analytics';
import { contextService } from '@/services/contextService';
import { ContextThreadSummary, meetingIdsOf } from '@/types/context';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

interface AddToContextButtonProps {
  meetingId: string;
  meetingTitle: string;
  /** Contexts selected for AI summaries (contract §8.2). Optional: hidden when not wired. */
  summaryContextIds?: string[];
  onSummaryContextIdsChange?: (contextIds: string[]) => void;
}

/** Maximum number of Contexts whose memory may be attached to one summary. */
const MAX_SUMMARY_CONTEXTS = 2;

/**
 * Meeting-details action: link the current meeting to one or more Contexts,
 * create a Context inline, and (optionally) pick which Contexts' saved
 * knowledge should be used when generating this meeting's AI summary.
 */
export function AddToContextButton({
  meetingId,
  meetingTitle,
  summaryContextIds = [],
  onSummaryContextIdsChange,
}: AddToContextButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [contexts, setContexts] = useState<ContextThreadSummary[]>([]);
  const [linked, setLinked] = useState<Record<string, boolean>>({});
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [newContextName, setNewContextName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const loadVersionRef = useRef(0);

  const load = useCallback(async () => {
    const version = loadVersionRef.current + 1;
    loadVersionRef.current = version;
    setIsLoading(true);
    try {
      const list = await contextService.listContextThreads();
      if (loadVersionRef.current !== version) return;
      setContexts(list);

      const membership = await Promise.all(
        list.map(async (context) => {
          const meetings = await contextService.getContextMeetings(context.id);
          return [context.id, meetingIdsOf(meetings)] as const;
        }),
      );
      if (loadVersionRef.current !== version) return;
      const next: Record<string, boolean> = {};
      for (const [contextId, ids] of membership) {
        next[contextId] = ids.has(meetingId);
      }
      setLinked(next);
    } catch (err) {
      console.error('Failed to load contexts for meeting:', err);
      toast.error('Failed to load Contexts', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (loadVersionRef.current === version) setIsLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    if (open) {
      setNewContextName('');
      void load();
    }
  }, [open, load]);

  const toggleLink = async (contextId: string, currentlyLinked: boolean) => {
    setBusyIds((prev) => new Set(prev).add(contextId));
    setLinked((prev) => ({ ...prev, [contextId]: !currentlyLinked }));
    try {
      if (currentlyLinked) {
        await contextService.removeMeetingFromContext(contextId, meetingId);
        Analytics.trackButtonClick('remove_meeting_from_context', 'meeting_details');
        toast.success('Removed from Context');
      } else {
        await contextService.addMeetingToContext(contextId, meetingId);
        Analytics.trackButtonClick('add_meeting_to_context', 'meeting_details');
        toast.success('Added to Context');
      }
    } catch (err) {
      console.error('Failed to update context membership:', err);
      setLinked((prev) => ({ ...prev, [contextId]: currentlyLinked }));
      toast.error('Failed to update Context', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(contextId);
        return next;
      });
    }
  };

  const handleInlineCreate = async () => {
    const name = newContextName.trim();
    if (!name) {
      toast.error('Context name must not be empty');
      return;
    }
    setIsCreating(true);
    try {
      const created = await contextService.createContextThread(name);
      await contextService.addMeetingToContext(created.id, meetingId);
      Analytics.trackButtonClick('create_context_inline', 'meeting_details');
      toast.success(`Added to new Context "${created.name}"`);
      setNewContextName('');
      await load();
    } catch (err) {
      console.error('Failed to create context:', err);
      toast.error('Failed to create Context', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsCreating(false);
    }
  };

  const showSummaryPicker = typeof onSummaryContextIdsChange === 'function';

  const toggleSummaryContext = (contextId: string) => {
    if (!onSummaryContextIdsChange) return;
    const selected = summaryContextIds.includes(contextId);
    if (selected) {
      onSummaryContextIdsChange(summaryContextIds.filter((id) => id !== contextId));
      return;
    }
    if (summaryContextIds.length >= MAX_SUMMARY_CONTEXTS) {
      toast.error(`You can include up to ${MAX_SUMMARY_CONTEXTS} Contexts per summary`, {
        description: 'Deselect one before adding another.',
      });
      return;
    }
    onSummaryContextIdsChange([...summaryContextIds, contextId]);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        title="Add to Context"
        onClick={() => {
          Analytics.trackButtonClick('add_to_context', 'meeting_details');
          setOpen(true);
        }}
        className="cursor-pointer"
      >
        <Layers />
        <span className="hidden lg:inline">Add to Context</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[480px] bg-white text-gray-900">
          <DialogHeader>
            <DialogTitle>Contexts</DialogTitle>
            <DialogDescription className="text-gray-500 truncate">
              {meetingTitle} — a meeting can belong to multiple Contexts.
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="animate-spin text-gray-400" />
            </div>
          ) : (
            <>
              <div className="max-h-56 overflow-y-auto custom-scrollbar border border-gray-200 rounded-md divide-y divide-gray-100">
                {contexts.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-8 px-4">
                    No Contexts yet. Create one below to group related meetings.
                  </p>
                ) : (
                  contexts.map((context) => {
                    const isLinked = Boolean(linked[context.id]);
                    const isBusy = busyIds.has(context.id);
                    return (
                      <button
                        key={context.id}
                        type="button"
                        disabled={isBusy}
                        onClick={() => void toggleLink(context.id, isLinked)}
                        className={cn(
                          'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors',
                          isLinked ? 'bg-blue-50' : 'hover:bg-gray-50',
                          isBusy && 'opacity-60 cursor-wait',
                        )}
                      >
                        <span
                          className={cn(
                            'flex-shrink-0 flex items-center justify-center w-4 h-4 rounded border',
                            isLinked ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white',
                          )}
                        >
                          {isLinked && (
                            <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                              <path d="M2.5 6.5L4.8 8.8L9.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className={cn('block truncate text-sm', isLinked ? 'text-blue-700' : 'text-gray-700')}>
                            {context.name}
                          </span>
                        </span>
                        {isBusy && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
                      </button>
                    );
                  })
                )}
              </div>

              <div className="flex items-center gap-2">
                <Input
                  value={newContextName}
                  onChange={(e) => setNewContextName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleInlineCreate();
                    }
                  }}
                  placeholder="New Context name"
                  maxLength={120}
                />
                <Button
                  variant="blue"
                  size="sm"
                  onClick={() => void handleInlineCreate()}
                  disabled={isCreating || !newContextName.trim()}
                  className="shrink-0"
                >
                  {isCreating ? <Loader2 className="animate-spin" /> : <Plus />}
                  Create
                </Button>
              </div>

              {showSummaryPicker && contexts.length > 0 && (
                <div className="pt-1">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                    Use Context knowledge in AI summaries
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {contexts.map((context) => {
                      const isSelected = summaryContextIds.includes(context.id);
                      return (
                        <button
                          key={context.id}
                          type="button"
                          onClick={() => toggleSummaryContext(context.id)}
                          aria-pressed={isSelected}
                          className={cn(
                            'px-3 py-1.5 rounded-full text-sm border transition-colors',
                            isSelected
                              ? 'bg-blue-600 border-blue-600 text-white'
                              : 'border-gray-300 text-gray-600 hover:bg-gray-50',
                          )}
                        >
                          {context.name}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-400 mt-1.5">
                    Select up to {MAX_SUMMARY_CONTEXTS} Contexts to include their saved knowledge
                    when generating this meeting&apos;s summary. Each Context stays separate.
                  </p>
                </div>
              )}
            </>
          )}

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => router.push(routes.contexts())} className="text-gray-600">
              Open Contexts <ArrowUpRight className="h-4 w-4" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
