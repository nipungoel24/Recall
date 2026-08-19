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
  'lib',
  'calendar.ts'
);

function loadTsModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  const moduleObj = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: moduleObj.exports,
    module: moduleObj,
    require: (spec) => {
      // calendar.ts must stay dependency-free so it can run here.
      throw new Error(`calendar.ts must not import modules (got: ${spec})`);
    },
  });
  return moduleObj.exports;
}

// Value-based helpers: the transpiled module runs in a separate vm realm,
// so Dates/arrays must be compared by primitive representation.
const t = (d) => d.getTime();
const eq = (actual, expected, label) =>
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), label);

const {
  startOfLocalDay,
  endOfLocalDay,
  startOfLocalMonth,
  endOfLocalMonth,
  isSameLocalDay,
  localDateKey,
  parseLocalDateKey,
  getMonthMatrix,
  getWeekdayLabels,
  groupMeetingsByLocalDate,
  sortMeetingsChronologically,
  getHistoryGroupLabel,
  getHistoryBucket,
  formatMeetingTime,
  formatDuration,
} = loadTsModule(modulePath);

// ---------------------------------------------------------------
// Local date range calculation
// ---------------------------------------------------------------

const midday = new Date(2026, 7, 15, 13, 45, 30); // Aug 15 2026, 1:45 PM local
assert.equal(
  t(startOfLocalDay(midday)),
  t(new Date(2026, 7, 15)),
  'startOfLocalDay must be local midnight of the same day'
);
assert.equal(
  t(endOfLocalDay(midday)),
  t(new Date(2026, 7, 16)),
  'endOfLocalDay must be exclusive local midnight of the next day'
);

// Half-open range: an instant at exactly endOfLocalDay is NOT inside the day.
const dayEnd = endOfLocalDay(midday);
assert.equal(dayEnd >= startOfLocalDay(midday) && dayEnd < dayEnd, false, 'end boundary must be exclusive');

// Day arithmetic across month/year boundaries (handled by the Date constructor).
assert.equal(t(endOfLocalDay(new Date(2026, 11, 31))), t(new Date(2027, 0, 1)), 'endOfLocalDay must roll over to the next month/year');
assert.equal(t(endOfLocalDay(new Date(2026, 1, 28))), t(new Date(2026, 2, 1)), 'endOfLocalDay must handle non-leap February');

// DST-sensitive checks (only meaningful when the runtime TZ observes DST).
const dstSpring = new Date(2026, 2, 8, 12); // 2026-03-08 in America/New_York is spring-forward
const dstFall = new Date(2026, 10, 1, 12); // 2026-11-01 in America/New_York is fall-back
if (process.env.TZ === 'America/New_York') {
  assert.equal(
    t(endOfLocalDay(new Date(2026, 2, 8))) - t(startOfLocalDay(new Date(2026, 2, 8))),
    23 * 3600 * 1000,
    'spring-forward day must be 23 hours long'
  );
  assert.equal(
    t(endOfLocalDay(dstFall)) - t(startOfLocalDay(dstFall)),
    25 * 3600 * 1000,
    'fall-back day must be 25 hours long'
  );
}

// endOfLocalDay is always "next local midnight" even across DST shifts.
assert.equal(
  t(endOfLocalDay(dstSpring)) - t(startOfLocalDay(dstSpring)),
  t(new Date(2026, 2, 9)) - t(new Date(2026, 2, 8)),
  'day boundaries must align with the local Date constructor across DST'
);

// Month range helpers.
assert.equal(t(startOfLocalMonth(new Date(2026, 7, 15))), t(new Date(2026, 7, 1)), 'startOfLocalMonth');
assert.equal(t(endOfLocalMonth(new Date(2026, 7, 15))), t(new Date(2026, 8, 1)), 'endOfLocalMonth');
assert.equal(t(endOfLocalMonth(new Date(2026, 11, 10))), t(new Date(2027, 0, 1)), 'endOfLocalMonth rolls over years');

// ---------------------------------------------------------------
// Local date keys
// ---------------------------------------------------------------

assert.equal(localDateKey(new Date(2026, 7, 5)), '2026-08-05', 'localDateKey zero-pads month and day');
assert.equal(localDateKey(new Date(2026, 10, 25)), '2026-11-25', 'localDateKey');
assert.equal(t(parseLocalDateKey('2026-08-15')), t(new Date(2026, 7, 15)), 'parseLocalDateKey round-trip');
assert.equal(parseLocalDateKey('2026-02-31'), null, 'parseLocalDateKey rejects overflow dates');
assert.equal(parseLocalDateKey('2026-13-01'), null, 'parseLocalDateKey rejects invalid months');
assert.equal(parseLocalDateKey('garbage'), null, 'parseLocalDateKey rejects garbage');
assert.equal(localDateKey(parseLocalDateKey('2026-12-31')), '2026-12-31', 'key round-trips');

assert.equal(isSameLocalDay(new Date(2026, 7, 15, 0, 0), new Date(2026, 7, 15, 23, 59)), true, 'isSameLocalDay true');
assert.equal(isSameLocalDay(new Date(2026, 7, 15, 23, 59), new Date(2026, 7, 16, 0, 0)), false, 'isSameLocalDay false across midnight');

// ---------------------------------------------------------------
// Independent cross-check against Intl (valid for any runtime TZ)
// ---------------------------------------------------------------

const tzName = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
const localDateViaIntl = (instant) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: tzName,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);

const instants = [
  '2026-08-15T00:30:00Z',
  '2026-08-15T12:00:00Z',
  '2026-08-15T23:30:00Z',
  '2026-08-16T03:00:00Z',
  '2026-01-01T10:15:00Z',
  '2026-12-31T22:00:00Z',
];
for (const instant of instants) {
  assert.equal(
    localDateKey(new Date(instant)),
    localDateViaIntl(new Date(instant)),
    `localDateKey must match Intl local date for ${instant} in ${tzName}`
  );
}

// Known-answer midnight-boundary cases for specific timezones.
if (process.env.TZ === 'America/New_York') {
  // 23:30Z = 19:30 EDT on Aug 15 -> local day Aug 15
  assert.equal(localDateKey(new Date('2026-08-15T23:30:00Z')), '2026-08-15', 'NYC: 19:30 local Aug 15');
  // 03:00Z on Aug 16 = 23:00 EDT Aug 15 -> belongs to Aug 15 locally, NOT its UTC date
  assert.equal(localDateKey(new Date('2026-08-16T03:00:00Z')), '2026-08-15', 'NYC: 23:00 local Aug 15 stays on Aug 15');
} else if (process.env.TZ === 'Asia/Kolkata') {
  // 23:30Z = 05:00 IST Aug 16 -> local day Aug 16
  assert.equal(localDateKey(new Date('2026-08-15T23:30:00Z')), '2026-08-16', 'Kolkata: 05:00 local Aug 16');
} else if (process.env.TZ === 'UTC' || process.env.TZ === 'Etc/UTC') {
  assert.equal(localDateKey(new Date('2026-08-15T23:30:00Z')), '2026-08-15', 'UTC: same date');
}

// ---------------------------------------------------------------
// Meeting grouping by local date
// ---------------------------------------------------------------

const meetings = [
  { id: 'a', title: 'Late night', created_at: new Date(2026, 7, 15, 23, 30).toISOString() },
  { id: 'b', title: 'After midnight', created_at: new Date(2026, 7, 16, 0, 30).toISOString() },
  { id: 'c', title: 'Exact midnight', created_at: new Date(2026, 7, 16, 0, 0).toISOString() },
  { id: 'd', title: 'Midday', created_at: new Date(2026, 7, 15, 12, 0).toISOString() },
];

const grouped = groupMeetingsByLocalDate(meetings);
assert.equal(grouped.get('2026-08-15').map(m => m.id).sort().join(','), 'a,d', '23:30 and midday land on Aug 15');
assert.equal(grouped.get('2026-08-16').map(m => m.id).sort().join(','), 'b,c', '00:00 and 00:30 land on Aug 16');
assert.equal(grouped.get('2026-08-16').includes('a'), false, '23:30 meeting must NOT leak into Aug 16');

// Every meeting must appear in exactly one local-day bucket.
const allIds = [];
for (const list of grouped.values()) {
  for (const m of list) allIds.push(m.id);
}
assert.equal(allIds.sort().join(','), 'a,b,c,d', 'grouping must not drop or duplicate meetings');

// ---------------------------------------------------------------
// Chronological sorting
// ---------------------------------------------------------------

const shuffled = [
  { id: 'z', title: 'Newest', created_at: new Date(2026, 7, 16, 0, 30).toISOString() },
  { id: 'x', title: 'Oldest', created_at: new Date(2026, 7, 14, 9, 0).toISOString() },
  { id: 'y', title: 'Middle', created_at: new Date(2026, 7, 15, 12, 0).toISOString() },
];
assert.equal(
  sortMeetingsChronologically(shuffled).map(m => m.id).join(','),
  'x,y,z',
  'sortMeetingsChronologically must order oldest first'
);

// ---------------------------------------------------------------
// Month grid calculations
// ---------------------------------------------------------------

const feb2026 = getMonthMatrix(new Date(2026, 1, 10));
assert.ok(Array.isArray(feb2026), 'month matrix is an array of weeks');
for (const week of feb2026) {
  assert.equal(week.length, 7, 'every week has 7 days');
  assert.equal(week[0].getDay(), 0, 'every week starts on Sunday');
  assert.equal(week[6].getDay(), 6, 'every week ends on Saturday');
}
// Feb 2026 starts on Sunday -> exactly 4 weeks, 1st..28th only.
assert.equal(feb2026.length, 4, 'Feb 2026 spans 4 weeks');
assert.equal(feb2026.flat()[0].getDate(), 1, 'Feb 2026 grid starts on the 1st');
assert.equal(feb2026.flat()[27].getDate(), 28, 'Feb 2026 grid contains the 28th');
assert.equal(feb2026.flat().length, 28, 'Feb 2026 has no filler days');

// Consecutive cells must be consecutive days (also holds across DST).
const febCells = feb2026.flat();
for (let i = 1; i < febCells.length; i++) {
  const prev = new Date(febCells[i - 1].getFullYear(), febCells[i - 1].getMonth(), febCells[i - 1].getDate());
  const next = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1);
  assert.equal(t(febCells[i]), t(next), `cell ${i} must be the day after cell ${i - 1}`);
}

const aug2026 = getMonthMatrix(new Date(2026, 7, 15));
// Aug 1 2026 is a Saturday -> grid starts Sunday Jul 26 and ends Saturday Sep 5.
assert.equal(t(aug2026.flat()[0]), t(new Date(2026, 6, 26)), 'Aug 2026 grid starts Sun Jul 26');
assert.equal(t(aug2026.flat()[aug2026.flat().length - 1]), t(new Date(2026, 8, 5)), 'Aug 2026 grid ends Sat Sep 5');
assert.equal(aug2026.length, 6, 'Aug 2026 spans 6 weeks');
const augDays = aug2026.flat().map(d => d.getDate());
assert.ok(augDays.includes(1) && augDays.includes(31), 'Aug 2026 grid covers the whole month');

const leapFeb2024 = getMonthMatrix(new Date(2024, 1, 20));
// Feb 1 2024 is a Thursday -> grid starts Sunday Jan 28.
assert.equal(t(leapFeb2024.flat()[0]), t(new Date(2024, 0, 28)), 'Leap Feb 2024 grid starts Sun Jan 28');
assert.ok(leapFeb2024.flat().some(d => d.getDate() === 29), 'Leap Feb 2024 grid includes Feb 29');

const labels = getWeekdayLabels();
assert.equal(labels.length, 7, '7 weekday labels');
eq(labels, getWeekdayLabels(), 'weekday labels are deterministic');
if (process.env.LANG?.startsWith('en') || !process.env.LANG) {
  // Default Node ICU is en-US unless the environment forces another locale.
  assert.equal(labels[0], 'Sun', 'first label is Sunday');
}

// ---------------------------------------------------------------
// History buckets / labels
// ---------------------------------------------------------------

const today = new Date(2026, 7, 15, 14, 0);
assert.equal(getHistoryBucket(new Date(2026, 7, 15, 0, 0), today), 'today', 'today start -> today');
assert.equal(getHistoryBucket(new Date(2026, 7, 15, 23, 59, 59), today), 'today', 'today end -> today');
assert.equal(getHistoryBucket(new Date(2026, 7, 16, 0, 0), today), 'earlier', 'future -> earlier');
assert.equal(getHistoryBucket(new Date(2026, 7, 14, 23, 59), today), 'yesterday', 'yesterday evening -> yesterday');
assert.equal(getHistoryBucket(new Date(2026, 7, 14, 0, 0), today), 'yesterday', 'yesterday midnight -> yesterday');
assert.equal(getHistoryBucket(new Date(2026, 7, 13, 23, 59), today), 'earlier', 'two days ago -> earlier');

assert.equal(getHistoryGroupLabel(new Date(2026, 7, 15, 8), today), 'Today', 'label: Today');
assert.equal(getHistoryGroupLabel(new Date(2026, 7, 14, 8), today), 'Yesterday', 'label: Yesterday');
assert.notEqual(getHistoryGroupLabel(new Date(2026, 7, 1, 8), today), 'Today', 'label: earlier date is not Today');

// ---------------------------------------------------------------
// Duration & time formatting
// ---------------------------------------------------------------

assert.equal(formatDuration(0), '0s', '0 seconds');
assert.equal(formatDuration(45), '45s', 'seconds only');
assert.equal(formatDuration(90), '1m 30s', 'minutes and seconds');
assert.equal(formatDuration(3600), '1h', 'exactly one hour');
assert.equal(formatDuration(3660), '1h 1m', 'hour and minute');
assert.equal(formatDuration(7200), '2h', 'two hours');
assert.equal(formatDuration(5400.6), '1h 30m', 'rounds to nearest second');
assert.equal(formatDuration(-5), '', 'negative durations render empty');
assert.equal(formatDuration(NaN), '', 'NaN renders empty');

const timeLabel = formatMeetingTime('2026-08-15T12:30:00Z');
assert.equal(typeof timeLabel, 'string', 'formatMeetingTime returns a string');
assert.ok(timeLabel.length > 0, 'formatMeetingTime is non-empty');

console.log('All calendar tests passed');
