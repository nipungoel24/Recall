// Context (Project) feature types — contract §7.1 (RECALL_INTELLIGENCE_IMPLEMENTATION_CONTRACT.md).
// Over IPC all payloads are camelCase; the normalizers below additionally tolerate
// snake_case keys so the UI keeps working regardless of backend serialization drift.

import { routes } from '@/lib/routes';

export interface ContextThreadSummary {
  id: string;
  name: string;
  description: string;
  meetingCount: number;
  memoryItemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContextThreadDetail {
  id: string;
  name: string;
  description: string;
  memoryMarkdown: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContextMeetingInfo {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  folderPath?: string | null;
  durationSeconds?: number | null;
}

export type ContextMemoryItemKind = 'fact' | 'decision' | 'action' | 'question' | 'note';

export interface ContextMemoryItem {
  id: string;
  contextId: string;
  sourceMeetingId?: string | null;
  sourceMeetingTitle?: string | null;
  kind: ContextMemoryItemKind;
  content: string;
  status?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompactContextMemory {
  contextId: string;
  contextName: string;
  memoryMarkdown: string;
  items: ContextMemoryItem[];
}

export const CONTEXT_MEMORY_KINDS: ContextMemoryItemKind[] = [
  'decision',
  'action',
  'question',
  'fact',
  'note',
];

export function isContextMemoryItemKind(value: unknown): value is ContextMemoryItemKind {
  return typeof value === 'string' && (CONTEXT_MEMORY_KINDS as string[]).includes(value);
}

// User-facing section labels for "Current Context" knowledge display.
export const MEMORY_KIND_SECTION_LABELS: Record<ContextMemoryItemKind, string> = {
  decision: 'Major decisions',
  action: 'Open action items',
  question: 'Open questions',
  fact: 'Important facts',
  note: 'Notes',
};

type UnknownRecord = Record<string, unknown>;

function firstDefined(raw: UnknownRecord, camel: string, snake: string): unknown {
  if (raw[camel] !== undefined && raw[camel] !== null) return raw[camel];
  return raw[snake];
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asOptionalString(value: unknown): string | null | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeContextThreadSummary(raw: UnknownRecord): ContextThreadSummary {
  return {
    id: asString(firstDefined(raw, 'id', 'id'), ''),
    name: asString(firstDefined(raw, 'name', 'name'), ''),
    description: asString(firstDefined(raw, 'description', 'description'), ''),
    meetingCount: asNumber(firstDefined(raw, 'meetingCount', 'meeting_count'), 0),
    memoryItemCount: asNumber(firstDefined(raw, 'memoryItemCount', 'memory_item_count'), 0),
    createdAt: asString(firstDefined(raw, 'createdAt', 'created_at'), ''),
    updatedAt: asString(firstDefined(raw, 'updatedAt', 'updated_at'), ''),
  };
}

export function normalizeContextThreadDetail(raw: UnknownRecord): ContextThreadDetail {
  return {
    id: asString(firstDefined(raw, 'id', 'id'), ''),
    name: asString(firstDefined(raw, 'name', 'name'), ''),
    description: asString(firstDefined(raw, 'description', 'description'), ''),
    memoryMarkdown: asString(firstDefined(raw, 'memoryMarkdown', 'memory_markdown'), ''),
    createdAt: asString(firstDefined(raw, 'createdAt', 'created_at'), ''),
    updatedAt: asString(firstDefined(raw, 'updatedAt', 'updated_at'), ''),
  };
}

export function normalizeContextMeetingInfo(raw: UnknownRecord): ContextMeetingInfo {
  const folderPath = asOptionalString(firstDefined(raw, 'folderPath', 'folder_path'));
  const durationSeconds = asNumber(firstDefined(raw, 'durationSeconds', 'duration_seconds'), 0);
  return {
    id: asString(firstDefined(raw, 'id', 'id'), ''),
    title: asString(firstDefined(raw, 'title', 'title'), ''),
    createdAt: asString(firstDefined(raw, 'createdAt', 'created_at'), ''),
    updatedAt: asString(firstDefined(raw, 'updatedAt', 'updated_at'), ''),
    folderPath: folderPath || null,
    durationSeconds: durationSeconds > 0 ? durationSeconds : null,
  };
}

export function normalizeContextMemoryItem(raw: UnknownRecord): ContextMemoryItem {
  const kindValue = firstDefined(raw, 'kind', 'kind');
  const sourceMeetingId = asOptionalString(firstDefined(raw, 'sourceMeetingId', 'source_meeting_id'));
  const sourceMeetingTitle = asOptionalString(firstDefined(raw, 'sourceMeetingTitle', 'source_meeting_title'));
  return {
    id: asString(firstDefined(raw, 'id', 'id'), ''),
    contextId: asString(firstDefined(raw, 'contextId', 'context_id'), ''),
    sourceMeetingId: sourceMeetingId || null,
    sourceMeetingTitle: sourceMeetingTitle || null,
    kind: isContextMemoryItemKind(kindValue) ? kindValue : 'note',
    content: asString(firstDefined(raw, 'content', 'content'), ''),
    status: asOptionalString(firstDefined(raw, 'status', 'status')) || null,
    createdAt: asString(firstDefined(raw, 'createdAt', 'created_at'), ''),
    updatedAt: asString(firstDefined(raw, 'updatedAt', 'updated_at'), ''),
  };
}

export function normalizeCompactContextMemory(raw: UnknownRecord): CompactContextMemory {
  const rawItems = raw.items ?? raw.Items;
  const items = Array.isArray(rawItems)
    ? rawItems.map((item) => normalizeContextMemoryItem(item as UnknownRecord))
    : [];
  return {
    contextId: asString(firstDefined(raw, 'contextId', 'context_id'), ''),
    contextName: asString(firstDefined(raw, 'contextName', 'context_name'), ''),
    memoryMarkdown: asString(firstDefined(raw, 'memoryMarkdown', 'memory_markdown'), ''),
    items,
  };
}

// --- Pure state transformations (unit-tested in tests/lib/context.test.mjs) ---

function timestampForSort(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/**
 * Sorts contexts for the list page: most recently updated first.
 * Ties break on name (ascending) for a stable, predictable order.
 */
export function sortContextThreadSummaries(
  contexts: ContextThreadSummary[],
): ContextThreadSummary[] {
  return [...contexts].sort((a, b) => {
    const byUpdated = timestampForSort(b.updatedAt) - timestampForSort(a.updatedAt);
    if (byUpdated !== 0) return byUpdated;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Chronological meeting order (oldest first) for the Meeting Timeline.
 */
export function sortContextMeetings(meetings: ContextMeetingInfo[]): ContextMeetingInfo[] {
  return [...meetings].sort((a, b) => {
    const byCreated = timestampForSort(a.createdAt) - timestampForSort(b.createdAt);
    if (byCreated !== 0) return byCreated;
    return a.title.localeCompare(b.title);
  });
}

/** Local-day key "YYYY-MM-DD" for grouping a timeline by calendar day, or null when unparseable. */
export function localDateKeyOf(isoTimestamp: string): string | null {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** "Aug 15" style meeting day label; falls back to the empty string for unparseable timestamps. */
export function formatMeetingDayLabel(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${MONTH_LABELS[parsed.getMonth()]} ${parsed.getDate()}`;
}

export interface MeetingDayGroup {
  dateKey: string;
  label: string;
  meetings: ContextMeetingInfo[];
}

/**
 * Groups chronologically sorted meetings into local calendar days. Meetings whose
 * timestamps cannot be parsed are grouped under a final "Unknown date" bucket.
 */
export function groupMeetingsByLocalDay(meetings: ContextMeetingInfo[]): MeetingDayGroup[] {
  const groups: MeetingDayGroup[] = [];
  let unknown: MeetingDayGroup | null = null;
  for (const meeting of meetings) {
    const dateKey = localDateKeyOf(meeting.createdAt);
    if (dateKey === null) {
      if (!unknown) unknown = { dateKey: 'unknown', label: 'Unknown date', meetings: [] };
      unknown.meetings.push(meeting);
      continue;
    }
    const existing = groups.find((group) => group.dateKey === dateKey);
    if (existing) {
      existing.meetings.push(meeting);
    } else {
      groups.push({ dateKey, label: formatMeetingDayLabel(meeting.createdAt), meetings: [meeting] });
    }
  }
  if (unknown) groups.push(unknown);
  return groups;
}

export type MemoryItemsByKind = Partial<Record<ContextMemoryItemKind, ContextMemoryItem[]>>;

/**
 * Groups memory items by kind, dropping empty groups. Items inside a group stay
 * newest-first (matching api_get_context_memory ordering).
 */
export function groupMemoryItemsByKind(items: ContextMemoryItem[]): MemoryItemsByKind {
  const sorted = [...items].sort(
    (a, b) => timestampForSort(b.createdAt) - timestampForSort(a.createdAt),
  );
  const grouped: MemoryItemsByKind = {};
  for (const item of sorted) {
    const bucket = grouped[item.kind] ?? [];
    bucket.push(item);
    grouped[item.kind] = bucket;
  }
  return grouped;
}

/** Kinds that have items, in canonical section order. */
export function kindsWithItems(grouped: MemoryItemsByKind): ContextMemoryItemKind[] {
  return CONTEXT_MEMORY_KINDS.filter((kind) => (grouped[kind]?.length ?? 0) > 0);
}

/**
 * Multi-select checkbox behavior: toggles membership of `id` in `selectedIds`.
 * Returns a new array; never mutates its input.
 */
export function toggleSelectedId(selectedIds: string[], id: string): string[] {
  return selectedIds.includes(id)
    ? selectedIds.filter((existing) => existing !== id)
    : [...selectedIds, id];
}

/** "12 Meetings" style label for context cards and headers. */
export function meetingCountLabel(count: number): string {
  return `${count} Meeting${count === 1 ? '' : 's'}`;
}

/** Route target for a meeting, shared by timeline rows and provenance links. */
export function buildMeetingDetailsHref(meetingId: string): string {
  return routes.meeting(meetingId);
}

export interface ProvenanceLink {
  href: string;
  title: string;
  meetingId: string;
}

/**
 * Returns a navigation target for a memory item's source meeting, or null when the
 * item has no verifiable source. Unverifiable knowledge is never presented with a
 * fabricated source.
 */
export function provenanceLinkForItem(
  item: Pick<ContextMemoryItem, 'sourceMeetingId' | 'sourceMeetingTitle'>,
): ProvenanceLink | null {
  const meetingId = item.sourceMeetingId;
  if (!meetingId) return null;
  return {
    href: buildMeetingDetailsHref(meetingId),
    meetingId,
    title: item.sourceMeetingTitle && item.sourceMeetingTitle.trim().length > 0
      ? item.sourceMeetingTitle
      : 'View source meeting',
  };
}

/** Membership helper: ids of all meetings in a context-meetings payload. */
export function meetingIdsOf(meetings: ContextMeetingInfo[]): Set<string> {
  return new Set(meetings.map((meeting) => meeting.id));
}
