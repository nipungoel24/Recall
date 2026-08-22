import { invoke } from '@tauri-apps/api/core';
import {
  CompactContextMemory,
  ContextMeetingInfo,
  ContextMemoryItem,
  ContextThreadDetail,
  ContextThreadSummary,
  normalizeCompactContextMemory,
  normalizeContextMeetingInfo,
  normalizeContextMemoryItem,
  normalizeContextThreadDetail,
  normalizeContextThreadSummary,
} from '@/types/context';

export interface AddMeetingToContextOutcome {
  contextId: string;
  meetingId: string;
  added: boolean;
}

export interface RemoveMeetingFromContextOutcome {
  contextId: string;
  meetingId: string;
  removed: boolean;
}

export interface UpdateContextThreadArgs {
  name?: string;
  description?: string;
  memoryMarkdown?: string;
}

export interface AddContextMemoryItemArgs {
  kind: string;
  content: string;
  sourceMeetingId?: string;
  status?: string;
}

/**
 * Thin invoke() wrappers for the context backend commands
 * (contract §7.2 — MEETILY_INTELLIGENCE_IMPLEMENTATION_CONTRACT.md).
 */
export class ContextService {
  async listContextThreads(): Promise<ContextThreadSummary[]> {
    const raw = await invoke<unknown[]>('api_list_context_threads');
    return raw.map((item) => normalizeContextThreadSummary(item as Record<string, unknown>));
  }

  async getContextThread(contextId: string): Promise<ContextThreadDetail> {
    const raw = await invoke<unknown>('api_get_context_thread', { contextId });
    return normalizeContextThreadDetail(raw as Record<string, unknown>);
  }

  async createContextThread(name: string, description?: string): Promise<ContextThreadDetail> {
    const raw = await invoke<unknown>('api_create_context_thread', { name, description });
    return normalizeContextThreadDetail(raw as Record<string, unknown>);
  }

  async updateContextThread(
    contextId: string,
    args: UpdateContextThreadArgs,
  ): Promise<ContextThreadDetail> {
    const raw = await invoke<unknown>('api_update_context_thread', {
      contextId,
      name: args.name ?? null,
      description: args.description ?? null,
      memoryMarkdown: args.memoryMarkdown ?? null,
    });
    return normalizeContextThreadDetail(raw as Record<string, unknown>);
  }

  async deleteContextThread(contextId: string): Promise<unknown> {
    return invoke<unknown>('api_delete_context_thread', { contextId });
  }

  async addMeetingToContext(
    contextId: string,
    meetingId: string,
  ): Promise<AddMeetingToContextOutcome> {
    const raw = await invoke<Record<string, unknown>>('api_add_meeting_to_context', {
      contextId,
      meetingId,
    });
    return {
      contextId: String(raw.contextId ?? raw.context_id ?? contextId),
      meetingId: String(raw.meetingId ?? raw.meeting_id ?? meetingId),
      added: Boolean(raw.added),
    };
  }

  async removeMeetingFromContext(
    contextId: string,
    meetingId: string,
  ): Promise<RemoveMeetingFromContextOutcome> {
    const raw = await invoke<Record<string, unknown>>('api_remove_meeting_from_context', {
      contextId,
      meetingId,
    });
    return {
      contextId: String(raw.contextId ?? raw.context_id ?? contextId),
      meetingId: String(raw.meetingId ?? raw.meeting_id ?? meetingId),
      removed: Boolean(raw.removed),
    };
  }

  async getContextMeetings(contextId: string): Promise<ContextMeetingInfo[]> {
    const raw = await invoke<unknown[]>('api_get_context_meetings', { contextId });
    return raw.map((item) => normalizeContextMeetingInfo(item as Record<string, unknown>));
  }

  async getContextMemory(contextId: string): Promise<ContextMemoryItem[]> {
    const raw = await invoke<unknown[]>('api_get_context_memory', { contextId });
    return raw.map((item) => normalizeContextMemoryItem(item as Record<string, unknown>));
  }

  async getCompactContextMemory(
    contextId: string,
    maxItems?: number,
  ): Promise<CompactContextMemory> {
    const raw = await invoke<unknown>('api_get_compact_context_memory', {
      contextId,
      maxItems: maxItems ?? null,
    });
    return normalizeCompactContextMemory(raw as Record<string, unknown>);
  }

  /**
   * Rebuilds the Context's derived memory from its current meetings using the
   * configured summary provider. The previous memory is only replaced when the
   * rebuild fully succeeds; meetings and transcripts are never modified.
   */
  async rebuildContextMemory(contextId: string): Promise<{
    contextId: string;
    meetingsProcessed: number;
    itemsAdded: number;
  }> {
    const raw = await invoke<unknown>('api_rebuild_context_memory', { contextId });
    const value = raw as Record<string, unknown>;
    return {
      contextId: String(value.contextId ?? contextId),
      meetingsProcessed: Number(value.meetingsProcessed ?? 0),
      itemsAdded: Number(value.itemsAdded ?? 0),
    };
  }

  async addContextMemoryItem(
    contextId: string,
    args: AddContextMemoryItemArgs,
  ): Promise<ContextMemoryItem> {
    const raw = await invoke<unknown>('api_add_context_memory_item', {
      contextId,
      kind: args.kind,
      content: args.content,
      sourceMeetingId: args.sourceMeetingId ?? null,
      status: args.status ?? null,
    });
    return normalizeContextMemoryItem(raw as Record<string, unknown>);
  }

  async updateContextMemoryItem(
    itemId: string,
    args: { kind?: string; content?: string; status?: string },
  ): Promise<ContextMemoryItem> {
    const raw = await invoke<unknown>('api_update_context_memory_item', {
      itemId,
      kind: args.kind ?? null,
      content: args.content ?? null,
      status: args.status ?? null,
    });
    return normalizeContextMemoryItem(raw as Record<string, unknown>);
  }

  async deleteContextMemoryItem(itemId: string): Promise<unknown> {
    return invoke<unknown>('api_delete_context_memory_item', { itemId });
  }
}

export const contextService = new ContextService();
