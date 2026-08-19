'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  CompactContextMemory,
  ContextMeetingInfo,
  ContextThreadDetail,
  ContextThreadSummary,
  sortContextMeetings,
  sortContextThreadSummaries,
} from '@/types/context';
import { contextService } from '@/services/contextService';

/**
 * List-level state for the Contexts page. Loads context summaries only — never
 * transcripts — and exposes mutations that keep local state in sync with the backend.
 */
export function useContexts() {
  const [contexts, setContexts] = useState<ContextThreadSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const list = await contextService.listContextThreads();
      setContexts(sortContextThreadSummaries(list));
      setError(null);
    } catch (err) {
      console.error('Failed to load contexts:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const createContext = useCallback(
    async (name: string, description?: string): Promise<ContextThreadDetail | null> => {
      try {
        const created = await contextService.createContextThread(name, description);
        await refetch();
        return created;
      } catch (err) {
        console.error('Failed to create context:', err);
        toast.error('Failed to create context', {
          description: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    },
    [refetch],
  );

  const renameContext = useCallback(
    async (contextId: string, name: string, description?: string): Promise<boolean> => {
      try {
        await contextService.updateContextThread(contextId, { name, description });
        await refetch();
        return true;
      } catch (err) {
        console.error('Failed to rename context:', err);
        toast.error('Failed to rename context', {
          description: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    },
    [refetch],
  );

  const deleteContext = useCallback(
    async (contextId: string): Promise<boolean> => {
      try {
        await contextService.deleteContextThread(contextId);
        await refetch();
        return true;
      } catch (err) {
        console.error('Failed to delete context:', err);
        toast.error('Failed to delete context', {
          description: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    },
    [refetch],
  );

  return { contexts, isLoading, error, refetch, createContext, renameContext, deleteContext };
}

export interface ContextDetailState {
  detail: ContextThreadDetail | null;
  meetings: ContextMeetingInfo[];
  memory: CompactContextMemory | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  rename: (name: string, description?: string) => Promise<boolean>;
  remove: () => Promise<boolean>;
  addMeetings: (meetingIds: string[]) => Promise<number>;
  removeMeeting: (meetingId: string) => Promise<boolean>;
}

/**
 * Detail-page state. Loads meeting METADATA (id/title/timestamps) plus compact
 * context memory; transcripts are only fetched when the user opens a meeting.
 */
export function useContextDetail(contextId: string | null): ContextDetailState {
  const [detail, setDetail] = useState<ContextThreadDetail | null>(null);
  const [meetings, setMeetings] = useState<ContextMeetingInfo[]>([]);
  const [memory, setMemory] = useState<CompactContextMemory | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!contextId) return;
    setIsLoading(true);
    try {
      const [thread, threadMeetings, compactMemory] = await Promise.all([
        contextService.getContextThread(contextId),
        contextService.getContextMeetings(contextId),
        contextService.getCompactContextMemory(contextId),
      ]);
      setDetail(thread);
      setMeetings(sortContextMeetings(threadMeetings));
      setMemory(compactMemory);
      setError(null);
    } catch (err) {
      console.error('Failed to load context:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [contextId]);

  useEffect(() => {
    setDetail(null);
    setMeetings([]);
    setMemory(null);
    void refresh();
  }, [refresh]);

  const rename = useCallback(
    async (name: string, description?: string): Promise<boolean> => {
      if (!contextId) return false;
      try {
        const updated = await contextService.updateContextThread(contextId, {
          name,
          description,
        });
        setDetail(updated);
        return true;
      } catch (err) {
        console.error('Failed to rename context:', err);
        toast.error('Failed to rename context', {
          description: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    },
    [contextId],
  );

  const remove = useCallback(async (): Promise<boolean> => {
    if (!contextId) return false;
    try {
      await contextService.deleteContextThread(contextId);
      return true;
    } catch (err) {
      console.error('Failed to delete context:', err);
      toast.error('Failed to delete context', {
        description: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }, [contextId]);

  const addMeetings = useCallback(
    async (meetingIds: string[]): Promise<number> => {
      if (!contextId) return 0;
      let added = 0;
      for (const meetingId of meetingIds) {
        try {
          await contextService.addMeetingToContext(contextId, meetingId);
          added += 1;
        } catch (err) {
          console.error(`Failed to add meeting ${meetingId} to context:`, err);
          toast.error('Failed to add a meeting to this context', {
            description: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (added > 0) {
        await refresh();
      }
      return added;
    },
    [contextId, refresh],
  );

  const removeMeeting = useCallback(
    async (meetingId: string): Promise<boolean> => {
      if (!contextId) return false;
      try {
        await contextService.removeMeetingFromContext(contextId, meetingId);
        await refresh();
        return true;
      } catch (err) {
        console.error('Failed to remove meeting from context:', err);
        toast.error('Failed to remove meeting from context', {
          description: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    },
    [contextId, refresh],
  );

  return {
    detail,
    meetings,
    memory,
    isLoading,
    error,
    refresh,
    rename,
    remove,
    addMeetings,
    removeMeeting,
  };
}
