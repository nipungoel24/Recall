import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const modulePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'src',
  'types',
  'context.ts'
);

function loadTsModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  const srcRoot = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
  );

  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: module.exports,
    module,
    require: (spec) => {
      if (spec.startsWith('@/')) {
        // Resolve path aliases to TypeScript sources under src/ and load
        // them through the same transpiler.
        const target = path.join(srcRoot, spec.slice(2));
        return loadTsModule(target.endsWith('.ts') ? target : `${target}.ts`);
      }
      if (spec.startsWith('.')) {
        const resolved = path.resolve(path.dirname(filePath), spec);
        return loadTsModule(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`);
      }
      // Bare packages (e.g. node built-ins) resolve in the host context.
      return import(spec);
    },
  });
  return module.exports;
}

// Values created inside the vm context carry different prototypes, so plain
// deepStrictEqual on objects/arrays fails spuriously. Round-trip through JSON
// to compare by content (same approach as the existing .mjs test files).
const plain = (value) => JSON.parse(JSON.stringify(value));

const {
  normalizeContextThreadSummary,
  normalizeContextThreadDetail,
  normalizeContextMeetingInfo,
  normalizeContextMemoryItem,
  normalizeCompactContextMemory,
  sortContextThreadSummaries,
  sortContextMeetings,
  localDateKeyOf,
  formatMeetingDayLabel,
  groupMeetingsByLocalDay,
  groupMemoryItemsByKind,
  kindsWithItems,
  toggleSelectedId,
  meetingCountLabel,
  buildMeetingDetailsHref,
  provenanceLinkForItem,
  meetingIdsOf,
  isContextMemoryItemKind,
  CONTEXT_MEMORY_KINDS,
  MEMORY_KIND_SECTION_LABELS,
} = loadTsModule(modulePath);

// --- Normalization: camelCase payloads ---

assert.deepEqual(
  plain(normalizeContextThreadSummary({
    id: 'context-1',
    name: 'Project Phoenix',
    description: 'Client project',
    meetingCount: 12,
    memoryItemCount: 7,
    createdAt: '2026-08-15T09:00:00Z',
    updatedAt: '2026-08-15T10:00:00Z',
  })),
  {
    id: 'context-1',
    name: 'Project Phoenix',
    description: 'Client project',
    meetingCount: 12,
    memoryItemCount: 7,
    createdAt: '2026-08-15T09:00:00Z',
    updatedAt: '2026-08-15T10:00:00Z',
  },
  'camelCase summary must normalize to the canonical shape'
);

// --- Normalization: snake_case payloads (backend serialization drift tolerance) ---

assert.deepEqual(
  plain(normalizeContextThreadDetail({
    id: 'context-1',
    name: 'Project Phoenix',
    description: '',
    memory_markdown: '## Memory',
    created_at: '2026-08-15T09:00:00Z',
    updated_at: '2026-08-15T10:00:00Z',
  })),
  {
    id: 'context-1',
    name: 'Project Phoenix',
    description: '',
    memoryMarkdown: '## Memory',
    createdAt: '2026-08-15T09:00:00Z',
    updatedAt: '2026-08-15T10:00:00Z',
  },
  'snake_case detail must normalize to the canonical shape'
);

assert.deepEqual(
  plain(normalizeContextMeetingInfo({
    id: 'meeting-1',
    title: 'Engineering Sync',
    created_at: '2026-08-14T09:00:00Z',
    updated_at: '2026-08-14T10:00:00Z',
    folder_path: null,
    duration_seconds: 1832.5,
  })),
  {
    id: 'meeting-1',
    title: 'Engineering Sync',
    createdAt: '2026-08-14T09:00:00Z',
    updatedAt: '2026-08-14T10:00:00Z',
    folderPath: null,
    durationSeconds: 1832.5,
  },
  'snake_case meeting info must normalize, keeping valid durations'
);

assert.equal(
  normalizeContextMeetingInfo({ id: 'm', title: 't', duration_seconds: 0 }).durationSeconds,
  null,
  'zero duration must normalize to null'
);

assert.equal(
  normalizeContextMeetingInfo({ id: 'm', title: 't', durationSeconds: -3 }).durationSeconds,
  null,
  'negative duration must normalize to null'
);

const normalizedItem = normalizeContextMemoryItem({
  id: 'cmi-1',
  context_id: 'context-1',
  source_meeting_id: 'meeting-9',
  source_meeting_title: 'Customer Interview',
  kind: 'decision',
  content: 'Use SQLite for local storage',
  status: 'open',
  created_at: '2026-08-12T09:00:00Z',
  updated_at: '2026-08-12T09:00:00Z',
});
assert.equal(normalizedItem.sourceMeetingId, 'meeting-9');
assert.equal(normalizedItem.sourceMeetingTitle, 'Customer Interview');
assert.equal(normalizedItem.kind, 'decision');
assert.equal(normalizedItem.status, 'open');

assert.equal(
  normalizeContextMemoryItem({ id: 'cmi-2', kind: 'not-a-kind', content: 'x' }).kind,
  'note',
  'unknown kinds must fall back to note'
);

assert.deepEqual(
  plain(normalizeCompactContextMemory({
    context_id: 'context-1',
    context_name: 'Project Phoenix',
    memory_markdown: '## Prior context',
    items: [
      { id: 'cmi-1', context_id: 'context-1', kind: 'fact', content: 'Team of 4' },
    ],
  })),
  {
    contextId: 'context-1',
    contextName: 'Project Phoenix',
    memoryMarkdown: '## Prior context',
    items: [
      {
        id: 'cmi-1',
        contextId: 'context-1',
        sourceMeetingId: null,
        sourceMeetingTitle: null,
        kind: 'fact',
        content: 'Team of 4',
        status: null,
        createdAt: '',
        updatedAt: '',
      },
    ],
  },
  'compact memory must normalize, including nested items'
);

assert.deepEqual(
  plain(normalizeCompactContextMemory({ context_id: 'context-1', items: 'nope' })),
  { contextId: 'context-1', contextName: '', memoryMarkdown: '', items: [] },
  'non-array items must normalize to an empty list'
);

// --- Sorting ---

const contexts = [
  { id: 'a', name: 'Alpha', description: '', meetingCount: 0, memoryItemCount: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'c', name: 'Charlie', description: '', meetingCount: 0, memoryItemCount: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-03-01T00:00:00Z' },
  { id: 'b', name: 'Bravo', description: '', meetingCount: 0, memoryItemCount: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' },
];
assert.deepEqual(
  plain(sortContextThreadSummaries(contexts).map((c) => c.id)),
  ['c', 'b', 'a'],
  'contexts must sort newest-updated first'
);

const tied = [
  { id: 'z', name: 'Zulu', description: '', meetingCount: 0, memoryItemCount: 0, createdAt: '', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'a', name: 'alpha', description: '', meetingCount: 0, memoryItemCount: 0, createdAt: '', updatedAt: '2026-01-01T00:00:00Z' },
];
assert.deepEqual(
  plain(sortContextThreadSummaries(tied).map((c) => c.id)),
  ['a', 'z'],
  'equal update timestamps must tie-break on name ascending'
);

assert.deepEqual(
  plain(sortContextThreadSummaries(contexts).map((c) => c.updatedAt)),
  ['2026-03-01T00:00:00Z', '2026-02-01T00:00:00Z', '2026-01-01T00:00:00Z'],
  'input array must not be mutated by sorting'
);

const meetings = [
  { id: 'new', title: 'Newest', createdAt: '2026-08-15T10:00:00Z', updatedAt: '' },
  { id: 'old', title: 'Oldest', createdAt: '2026-08-12T10:00:00Z', updatedAt: '' },
  { id: 'mid', title: 'Middle', createdAt: '2026-08-14T10:00:00Z', updatedAt: '' },
];
assert.deepEqual(
  plain(sortContextMeetings(meetings).map((m) => m.id)),
  ['old', 'mid', 'new'],
  'meetings must sort chronologically (oldest first)'
);

assert.deepEqual(
  plain(sortContextMeetings(meetings).map((m) => m.id)),
  ['old', 'mid', 'new'],
  'meeting input array must not be mutated'
);

// --- Local day grouping for the Meeting Timeline ---
// Local-day semantics (§10): tests construct timestamps from LOCAL noon so the
// expected calendar day is the same in every timezone.

const atLocalNoon = (year, month, day) =>
  new Date(year, month - 1, day, 12, 0, 0).toISOString();

assert.equal(localDateKeyOf(atLocalNoon(2026, 8, 15)), '2026-08-15');
assert.equal(localDateKeyOf('not-a-date'), null, 'unparseable timestamps have no day key');
assert.equal(formatMeetingDayLabel(atLocalNoon(2026, 8, 15)), 'Aug 15');
assert.equal(formatMeetingDayLabel('garbage'), '', 'unparseable timestamps get an empty label');

const timelineMeetings = sortContextMeetings([
  { id: 'a', title: 'Aug 15 morning', createdAt: atLocalNoon(2026, 8, 15), updatedAt: '' },
  { id: 'b', title: 'Aug 15 later', createdAt: new Date(2026, 7, 15, 13, 0, 0).toISOString(), updatedAt: '' },
  { id: 'c', title: 'Aug 12', createdAt: atLocalNoon(2026, 8, 12), updatedAt: '' },
  { id: 'd', title: 'No date', createdAt: '', updatedAt: '' },
]);
const groups = groupMeetingsByLocalDay(timelineMeetings);
assert.equal(groups.length, 3);
assert.deepEqual(plain(groups[0].meetings.map((m) => m.id)), ['c']);
assert.equal(groups[0].label, 'Aug 12');
assert.deepEqual(plain(groups[1].meetings.map((m) => m.id)), ['a', 'b'], 'same-day meetings share one group');
assert.equal(groups[1].label, 'Aug 15');
assert.equal(groups[2].label, 'Unknown date');
assert.deepEqual(plain(groups[2].meetings.map((m) => m.id)), ['d']);

assert.deepEqual(
  plain(groupMeetingsByLocalDay([])),
  [],
  'empty timelines produce no groups'
);

// --- Memory item grouping ---

const memoryItems = [
  { id: '1', contextId: 'c', kind: 'decision', content: 'd1', createdAt: '2026-08-10T00:00:00Z', updatedAt: '' },
  { id: '2', contextId: 'c', kind: 'action', content: 'a1', createdAt: '2026-08-12T00:00:00Z', updatedAt: '' },
  { id: '3', contextId: 'c', kind: 'decision', content: 'd2', createdAt: '2026-08-13T00:00:00Z', updatedAt: '' },
  { id: '4', contextId: 'c', kind: 'question', content: 'q1', createdAt: '2026-08-11T00:00:00Z', updatedAt: '' },
];
const grouped = groupMemoryItemsByKind(memoryItems);
assert.deepEqual(
  plain(grouped.decision.map((i) => i.id)),
  ['3', '1'],
  'items within a kind must be newest first'
);
assert.deepEqual(plain(grouped.action.map((i) => i.id)), ['2']);
assert.equal(grouped.note, undefined, 'empty kinds must be dropped');
assert.deepEqual(
  plain(kindsWithItems(grouped)),
  ['decision', 'action', 'question'],
  'kinds must appear in canonical section order'
);
assert.equal(MEMORY_KIND_SECTION_LABELS.decision, 'Major decisions');
assert.equal(MEMORY_KIND_SECTION_LABELS.action, 'Open action items');
assert.equal(MEMORY_KIND_SECTION_LABELS.question, 'Open questions');
assert.equal(MEMORY_KIND_SECTION_LABELS.fact, 'Important facts');
assert.equal(CONTEXT_MEMORY_KINDS.length, 5);

// --- Selection behavior ---

assert.deepEqual(plain(toggleSelectedId(['a', 'b'], 'c')), ['a', 'b', 'c'], 'toggle adds missing ids');
assert.deepEqual(plain(toggleSelectedId(['a', 'b'], 'a')), ['b'], 'toggle removes present ids');
const selected = ['a'];
toggleSelectedId(selected, 'b');
assert.deepEqual(plain(selected), ['a'], 'toggle must not mutate its input');

// --- Provenance link helpers ---

assert.equal(buildMeetingDetailsHref('meeting-9'), '/meeting-details?id=meeting-9');
assert.equal(buildMeetingDetailsHref('meeting with spaces'), '/meeting-details?id=meeting%20with%20spaces');

assert.deepEqual(
  plain(provenanceLinkForItem({ sourceMeetingId: 'meeting-9', sourceMeetingTitle: 'Customer Interview' })),
  { href: '/meeting-details?id=meeting-9', meetingId: 'meeting-9', title: 'Customer Interview' }
);
assert.deepEqual(
  plain(provenanceLinkForItem({ sourceMeetingId: 'meeting-9', sourceMeetingTitle: null })),
  { href: '/meeting-details?id=meeting-9', meetingId: 'meeting-9', title: 'View source meeting' },
  'missing source title must fall back to a generic label'
);
assert.equal(
  provenanceLinkForItem({ sourceMeetingId: null, sourceMeetingTitle: 'Whatever' }),
  null,
  'items without a source meeting must not fabricate provenance'
);
assert.equal(
  provenanceLinkForItem({ sourceMeetingId: '', sourceMeetingTitle: 'Whatever' }),
  null,
  'empty source ids must not fabricate provenance'
);

// --- Membership helpers ---

assert.deepEqual(
  plain([...meetingIdsOf([{ id: 'm1', title: '', createdAt: '', updatedAt: '' }, { id: 'm2', title: '', createdAt: '', updatedAt: '' }])]),
  ['m1', 'm2']
);
assert.equal(meetingIdsOf([]).size, 0);

// --- Labels and kind guard ---

assert.equal(meetingCountLabel(0), '0 Meetings');
assert.equal(meetingCountLabel(1), '1 Meeting');
assert.equal(meetingCountLabel(12), '12 Meetings');
assert.equal(isContextMemoryItemKind('fact'), true);
assert.equal(isContextMemoryItemKind('gossip'), false);
assert.equal(isContextMemoryItemKind(42), false);

console.log('context.test.mjs: all assertions passed');
