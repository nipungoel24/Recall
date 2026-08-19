import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const modulePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'src',
  'lib',
  'daily',
  'timeline.ts',
);
const require = createRequire(import.meta.url);

function loadTsModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: module.exports,
    module,
    require,
  });
  return module.exports;
}

const {
  dateKeyOf,
  parseDateKey,
  normalizeDateKey,
  isSameLocalDay,
  isWithinDateRange,
  meetingCountLabel,
  formatDuration,
  formatDayTitle,
  parseWallClock,
  formatClock,
  formatElapsed,
  segmentStartSeconds,
  segmentEndSeconds,
  toDailyMeeting,
  metadataToDailyMeeting,
  sortDailyMeetings,
  groupMeetingsByDate,
  dailyTotals,
  meetingTimeLabel,
  dailyBriefMeetingId,
  buildDailyBriefTranscriptText,
  legacySummaryToMarkdown,
  parseDailyBriefSources,
  isCommandNotFoundError,
  normalizeBriefResult,
} = loadTsModule(modulePath);

test('dateKeyOf renders local YYYY-MM-DD keys', () => {
  assert.equal(dateKeyOf(new Date(2026, 7, 15, 23, 59)), '2026-08-15');
  assert.equal(dateKeyOf(new Date(2026, 0, 5)), '2026-01-05');
});

test('parseDateKey round-trips and rejects invalid keys', () => {
  assert.equal(dateKeyOf(parseDateKey('2026-08-15')), '2026-08-15');
  assert.equal(parseDateKey('2026-02-30'), null);
  assert.equal(parseDateKey('15/08/2026'), null);
  assert.equal(parseDateKey(''), null);
});

test('normalizeDateKey accepts Date and key strings', () => {
  assert.equal(normalizeDateKey(new Date(2026, 7, 15)), '2026-08-15');
  assert.equal(normalizeDateKey('2026-08-15'), '2026-08-15');
  assert.equal(normalizeDateKey('nope'), null);
  assert.equal(normalizeDateKey(null), null);
});

test('isSameLocalDay compares local calendar days', () => {
  assert.equal(isSameLocalDay('2026-08-15', new Date(2026, 7, 15, 8)), true);
  assert.equal(isSameLocalDay('2026-08-15', new Date(2026, 7, 16, 0)), false);
  assert.equal(isSameLocalDay('2026-08-15', new Date(2026, 7, 14, 23, 59)), false);
});

test('isWithinDateRange is inclusive on keys', () => {
  assert.equal(isWithinDateRange(new Date(2026, 7, 15), '2026-08-14', '2026-08-16'), true);
  assert.equal(isWithinDateRange(new Date(2026, 7, 14), '2026-08-14', '2026-08-16'), true);
  assert.equal(isWithinDateRange(new Date(2026, 7, 16), '2026-08-14', '2026-08-16'), true);
  assert.equal(isWithinDateRange(new Date(2026, 7, 17), '2026-08-14', '2026-08-16'), false);
});

test('meetingCountLabel handles zero, one, many', () => {
  assert.equal(meetingCountLabel(0), '0 meetings');
  assert.equal(meetingCountLabel(1), '1 meeting');
  assert.equal(meetingCountLabel(4), '4 meetings');
});

test('formatDuration renders h/m combinations', () => {
  assert.equal(formatDuration(0), '0m');
  assert.equal(formatDuration(59), '1m');
  assert.equal(formatDuration(45 * 60), '45m');
  assert.equal(formatDuration(3600), '1h');
  assert.equal(formatDuration(90 * 60), '1h 30m');
  assert.equal(formatDuration(2 * 3600 + 34 * 60), '2h 34m');
});

test('formatDayTitle uppercases the long date', () => {
  assert.equal(formatDayTitle('2026-08-15'), 'AUGUST 15, 2026');
  assert.equal(formatDayTitle('bogus'), 'bogus');
});

test('parseWallClock handles HH:MM:SS and HH:MM', () => {
  assert.equal(parseWallClock('09:00:05'), 9 * 3600 + 5);
  assert.equal(parseWallClock('09:00'), 9 * 3600);
  assert.equal(parseWallClock('14:30:05'), 14 * 3600 + 30 * 60 + 5);
  assert.equal(parseWallClock(null), null);
  assert.equal(parseWallClock('not-a-time'), null);
  assert.equal(parseWallClock('25:00'), null);
});

test('formatClock and formatElapsed format offsets', () => {
  assert.equal(formatClock(9 * 3600), '09:00');
  assert.equal(formatClock(14 * 3600 + 30 * 60), '14:30');
  assert.equal(formatElapsed(65), '1:05');
  assert.equal(formatElapsed(2 * 3600 + 34 * 60 + 12), '2:34:12');
});

test('segmentStartSeconds prefers audio_start_time then wall clock', () => {
  assert.equal(segmentStartSeconds({ audio_start_time: 125.3, timestamp: '09:00:00' }), 125.3);
  assert.equal(segmentStartSeconds({ timestamp: '09:00:00' }), 9 * 3600);
  assert.equal(segmentStartSeconds(null), null);
});

test('segmentEndSeconds prefers audio_end_time, falls back to start+duration', () => {
  assert.equal(
    segmentEndSeconds({ audio_end_time: 130, audio_start_time: 125, duration: 5, timestamp: '09:00:00' }),
    130,
  );
  assert.equal(
    segmentEndSeconds({ audio_start_time: 125, duration: 5, timestamp: '09:00:00' }),
    130,
  );
  assert.equal(segmentEndSeconds({ timestamp: '09:00:00' }), 9 * 3600);
});

test('toDailyMeeting derives timeline fields from metadata + bounds', () => {
  const meta = {
    id: 'm1',
    title: 'Standup',
    createdAt: new Date(2026, 7, 15, 4, 0).toISOString(), // UTC morning
    updatedAt: new Date(2026, 7, 15, 5, 0).toISOString(),
    folderPath: null,
  };
  const bounds = {
    first: { audio_start_time: 0, audio_end_time: 600, duration: 600, timestamp: '09:00:00' },
    last: { audio_start_time: 1500, audio_end_time: 1600, duration: 100, timestamp: '09:26:40' },
    total: 42,
  };
  const meeting = toDailyMeeting(meta, bounds);

  assert.equal(meeting.id, 'm1');
  assert.equal(meeting.title, 'Standup');
  assert.equal(meeting.durationSeconds, 1600);
  assert.equal(meeting.transcriptCount, 42);
  assert.equal(meeting.hasTranscripts, true);
  assert.ok(meeting.startTime);
  assert.equal(new Date(meeting.startTime).getDate(), 15);
});

test('toDailyMeeting falls back to createdAt when no transcripts exist', () => {
  const meta = {
    id: 'm2',
    title: 'Empty',
    createdAt: new Date(2026, 7, 15, 4, 0).toISOString(),
    updatedAt: new Date(2026, 7, 15, 4, 0).toISOString(),
    folderPath: null,
  };
  const meeting = toDailyMeeting(meta, null);
  assert.equal(meeting.startTime, meta.createdAt);
  assert.equal(meeting.durationSeconds, 0);
  assert.equal(meeting.transcriptCount, null);
  assert.equal(meeting.hasTranscripts, true);
});

test('toDailyMeeting keeps exact count when bounds are known', () => {
  const meta = {
    id: 'm3',
    title: 'Known empty',
    createdAt: new Date(2026, 7, 15, 4, 0).toISOString(),
    updatedAt: new Date(2026, 7, 15, 4, 0).toISOString(),
    folderPath: null,
  };
  const meeting = toDailyMeeting(meta, { first: null, last: null, total: 0 });
  assert.equal(meeting.transcriptCount, 0);
  assert.equal(meeting.hasTranscripts, false);
});

test('metadataToDailyMeeting maps calendar-range metadata without transcript rows', () => {
  const meta = {
    id: 'm4',
    title: 'Range Meeting',
    createdAt: new Date(2026, 7, 15, 9, 30).toISOString(),
    updatedAt: new Date(2026, 7, 15, 9, 30).toISOString(),
    folderPath: null,
    durationSeconds: 1540,
  };
  const meeting = metadataToDailyMeeting(meta);
  assert.equal(meeting.startTime, meta.createdAt);
  assert.equal(meeting.durationSeconds, 1540);
  assert.equal(meeting.transcriptCount, null);
  assert.equal(meeting.hasTranscripts, true);

  const noDuration = metadataToDailyMeeting({ ...meta, durationSeconds: null });
  assert.equal(noDuration.durationSeconds, 0);
});

test('sortDailyMeetings orders chronologically with unknown times last', () => {
  const base = new Date(2026, 7, 15, 9, 0).toISOString();
  const late = new Date(2026, 7, 15, 17, 0).toISOString();
  const meetings = [
    { id: 'a', startTime: late },
    { id: 'b', startTime: null },
    { id: 'c', startTime: base },
  ];
  const sorted = sortDailyMeetings(meetings);
  assert.equal(JSON.stringify(sorted.map((m) => m.id)), JSON.stringify(['c', 'a', 'b']));
});

test('groupMeetingsByDate buckets and sorts by local day', () => {
  const day1 = new Date(2026, 7, 15, 9, 0).toISOString();
  const day1Late = new Date(2026, 7, 15, 17, 0).toISOString();
  const day2 = new Date(2026, 7, 16, 8, 0).toISOString();
  const meetings = [
    { id: 'late', createdAt: day1Late, startTime: day1Late },
    { id: 'early', createdAt: day1, startTime: day1 },
    { id: 'other-day', createdAt: day2, startTime: day2 },
  ];
  const groups = groupMeetingsByDate(meetings);
  const keys = Array.from(groups.keys());
  assert.equal(keys.length, 2);
  assert.equal(JSON.stringify(groups.get(keys[0]).map((m) => m.id)), JSON.stringify(['early', 'late']));
  assert.equal(JSON.stringify(groups.get(keys[1]).map((m) => m.id)), JSON.stringify(['other-day']));
});

test('dailyTotals sums durations', () => {
  const totals = dailyTotals([
    { durationSeconds: 3600 },
    { durationSeconds: 1800 },
    { durationSeconds: 0 },
  ]);
  assert.equal(JSON.stringify(totals), JSON.stringify({ meetingCount: 3, durationSeconds: 5400 }));
});

test('meetingTimeLabel renders wall clock', () => {
  const start = new Date(2026, 7, 15, 9, 0).toISOString();
  assert.equal(meetingTimeLabel({ startTime: start }), '09:00');
  assert.equal(meetingTimeLabel({ startTime: null }), null);
});

test('dailyBriefMeetingId is deterministic per day', () => {
  assert.equal(dailyBriefMeetingId('2026-08-15'), 'daily-brief-2026-08-15');
});

test('buildDailyBriefTranscriptText combines meetings with headers', () => {
  const meetings = [
    {
      id: 'm1',
      title: 'Standup',
      createdAt: new Date(2026, 7, 15, 4).toISOString(),
      startTime: new Date(2026, 7, 15, 9).toISOString(),
    },
  ];
  const transcripts = new Map([
    ['m1', [{ id: 't1', text: 'hello', timestamp: '09:00:01', audio_start_time: 1 }]],
  ]);
  const text = buildDailyBriefTranscriptText(meetings, transcripts);
  assert.ok(text.includes('# Meeting: Standup'));
  assert.ok(text.includes('Segments: 1'));
  assert.ok(text.includes('[0:01] hello'));
});

test('legacySummaryToMarkdown renders sections and bullets', () => {
  const legacy = {
    MeetingName: 'Daily Sync',
    _section_order: ['Agenda', 'ActionItems'],
    Agenda: {
      title: 'Agenda',
      blocks: [
        { id: 'b1', type: 'bullet', content: 'Review roadmap' },
        { id: 'b2', type: 'text', content: 'Plain line' },
      ],
    },
    ActionItems: {
      title: 'Action Items',
      blocks: [{ id: 'b3', type: 'bullet', content: 'Ship it' }],
    },
  };
  const markdown = legacySummaryToMarkdown(legacy);
  assert.ok(markdown.startsWith('# Daily Sync'));
  assert.ok(markdown.includes('## Agenda'));
  assert.ok(markdown.includes('- Review roadmap'));
  assert.ok(markdown.includes('Plain line'));
  assert.ok(markdown.includes('- Ship it'));
});

test('parseDailyBriefSources normalizes snake_case and camelCase', () => {
  assert.equal(
    JSON.stringify(
      parseDailyBriefSources({
        sources: [
          { meeting_id: 'm1', title: 'Standup' },
          { meetingId: 'm2', title: 'Planning' },
          { id: 'm3', title: 'Client' },
          { nope: true },
        ],
      }),
    ),
    JSON.stringify([
      { meetingId: 'm1', title: 'Standup' },
      { meetingId: 'm2', title: 'Planning' },
      { meetingId: 'm3', title: 'Client' },
    ]),
  );
  assert.equal(JSON.stringify(parseDailyBriefSources(null)), '[]');
});

test('isCommandNotFoundError detects missing Tauri commands', () => {
  assert.equal(isCommandNotFoundError('Command api_generate_daily_brief not found'), true);
  assert.equal(isCommandNotFoundError('unknown command'), true);
  assert.equal(isCommandNotFoundError('Connection refused'), false);
  assert.equal(isCommandNotFoundError(null), false);
});

test('normalizeBriefResult extracts markdown and falls back sources', () => {
  const fallback = [{ meetingId: 'm1', title: 'Standup' }];
  assert.equal(
    JSON.stringify(normalizeBriefResult({ markdown: '# Day' }, fallback)),
    JSON.stringify({ markdown: '# Day', sources: fallback }),
  );
  assert.equal(
    JSON.stringify(
      normalizeBriefResult(
        { data: { markdown: '# Day', sources: [{ meeting_id: 'm2', title: 'Sync' }] } },
        fallback,
      ),
    ),
    JSON.stringify({ markdown: '# Day', sources: [{ meetingId: 'm2', title: 'Sync' }] }),
  );
  assert.equal(normalizeBriefResult({}, fallback), null);
  assert.equal(normalizeBriefResult(null, fallback), null);
});
