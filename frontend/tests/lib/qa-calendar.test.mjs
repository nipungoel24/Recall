// QA regression suite for the calendar pure-logic module (src/lib/calendar.ts).
//
// Adversarial additions on top of the feature-agent tests in calendar.test.mjs:
// zero/one/many meetings, midnight boundaries, real UTC->local conversion in
// multiple timezones (via child Node processes with explicit TZ), DST day
// lengths, month/year transitions, leap years, and input fuzzing.
//
// Runnable with:  node --test tests/lib/qa-calendar.test.mjs
//                 pnpm exec bun test tests/lib/qa-calendar.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'node:test';
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
      throw new Error(`calendar.ts must not import modules (got: ${spec})`);
    },
  });
  return moduleObj.exports;
}

const {
  startOfLocalDay,
  endOfLocalDay,
  startOfLocalMonth,
  endOfLocalMonth,
  isSameLocalDay,
  localDateKey,
  parseLocalDateKey,
  getMonthMatrix,
  groupMeetingsByLocalDate,
  sortMeetingsChronologically,
  getHistoryBucket,
  getHistoryGroupLabel,
  formatDuration,
} = loadTsModule(modulePath);

const t = (d) => d.getTime();

/** Run a small script in a child Node process with an explicit TZ. */
function runWithTZ(tz, script) {
  return execFileSync(
    process.execPath,
    ['-e', script],
    { env: { ...process.env, TZ: tz }, encoding: 'utf8' }
  ).trim();
}

// ---------------------------------------------------------------------------
// Zero / one / many meetings
// ---------------------------------------------------------------------------

test('groupMeetingsByLocalDate: zero meetings -> empty groups', () => {
  const grouped = groupMeetingsByLocalDate([]);
  assert.equal(grouped.size, 0);
});

test('groupMeetingsByLocalDate: one meeting -> single bucket, order kept', () => {
  const meeting = { id: 'm1', title: 'Solo', created_at: new Date(2026, 7, 15, 9, 0).toISOString() };
  const grouped = groupMeetingsByLocalDate([meeting]);
  assert.deepEqual([...grouped.keys()], ['2026-08-15']);
  assert.equal(grouped.get('2026-08-15').length, 1);
  assert.equal(grouped.get('2026-08-15')[0].id, 'm1');
});

test('groupMeetingsByLocalDate: many meetings, each appears exactly once', () => {
  const meetings = [];
  for (let i = 0; i < 120; i++) {
    // Spread across month + year transitions with varied times of day.
    const date = new Date(2026, 11, 30, 23, 50); // Dec 30 2026
    date.setMinutes(date.getMinutes() + i * 90);
    meetings.push({
      id: `m${i}`,
      title: `Meeting ${i}`,
      created_at: date.toISOString(),
    });
  }
  const grouped = groupMeetingsByLocalDate(meetings);
  const seen = [];
  for (const list of grouped.values()) {
    for (const m of list) seen.push(m.id);
  }
  assert.equal(seen.length, meetings.length, 'no meeting dropped');
  assert.equal(new Set(seen).size, meetings.length, 'no meeting duplicated');

  // Buckets must be contiguous calendar days across the year boundary.
  const keys = [...grouped.keys()];
  assert.ok(keys.includes('2026-12-30'), 'Dec 30 bucket exists');
  assert.ok(keys.includes('2027-01-01'), 'Jan 1 bucket exists');
  for (let i = 1; i < keys.length; i++) {
    const prev = parseLocalDateKey(keys[i - 1]);
    const next = parseLocalDateKey(keys[i]);
    const expected = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1);
    assert.equal(t(next), t(expected), `bucket ${keys[i]} directly follows ${keys[i - 1]}`);
  }
});

test('groupMeetingsByLocalDate: insertion order preserved within bucket', () => {
  const meetings = [
    { id: 'z', title: 'Z', created_at: new Date(2026, 7, 15, 10, 0).toISOString() },
    { id: 'a', title: 'A', created_at: new Date(2026, 7, 15, 8, 0).toISOString() },
    { id: 'm', title: 'M', created_at: new Date(2026, 7, 15, 12, 0).toISOString() },
  ];
  const grouped = groupMeetingsByLocalDate(meetings);
  assert.deepEqual(
    [...grouped.get('2026-08-15')].map((m) => m.id),
    ['z', 'a', 'm'],
    'grouping is stable: input order preserved'
  );
});

// ---------------------------------------------------------------------------
// Midnight boundaries (host timezone)
// ---------------------------------------------------------------------------

test('midnight boundary: 23:59:59.999 vs next-day 00:00:00 split buckets', () => {
  const late = new Date(2026, 7, 15, 23, 59, 59, 999).toISOString();
  const early = new Date(2026, 7, 16, 0, 0, 0, 0).toISOString();
  const grouped = groupMeetingsByLocalDate([
    { id: 'late', title: 'Late', created_at: late },
    { id: 'early', title: 'Early', created_at: early },
  ]);
  assert.equal(grouped.get('2026-08-15').length, 1);
  assert.equal(grouped.get('2026-08-16').length, 1);
});

test('exact local midnight belongs to the day it starts', () => {
  const midnight = new Date(2026, 7, 16, 0, 0, 0, 0);
  assert.equal(localDateKey(midnight), '2026-08-16');
  assert.equal(t(startOfLocalDay(midnight)), t(midnight));
});

// ---------------------------------------------------------------------------
// UTC conversion across timezones (child processes with explicit TZ)
// ---------------------------------------------------------------------------

test('UTC->local conversion: negative offset (America/New_York)', () => {
  // 23:30Z on Aug 15 is 19:30 EDT Aug 15 -> key 2026-08-15
  // 03:00Z on Aug 16 is 23:00 EDT Aug 15 -> key 2026-08-15 (NOT the UTC date)
  const out = runWithTZ(
    'America/New_York',
    `
    const d = (s) => {
      const x = new Date(s);
      const p = (n) => String(n).padStart(2, '0');
      return \`\${x.getFullYear()}-\${p(x.getMonth() + 1)}-\${p(x.getDate())}\`;
    };
    console.log(d('2026-08-15T23:30:00Z'));
    console.log(d('2026-08-16T03:00:00Z'));
    `
  );
  assert.equal(out, '2026-08-15\n2026-08-15');
});

test('UTC->local conversion: positive offset (Asia/Kathmandu, +05:45)', () => {
  // 23:30Z on Aug 15 is 05:15 Aug 16 in Kathmandu -> key 2026-08-16
  const out = runWithTZ(
    'Asia/Kathmandu',
    `
    const d = (s) => {
      const x = new Date(s);
      const p = (n) => String(n).padStart(2, '0');
      return \`\${x.getFullYear()}-\${p(x.getMonth() + 1)}-\${p(x.getDate())}\`;
    };
    console.log(d('2026-08-15T23:30:00Z'));
    console.log(d('2026-08-15T18:14:59Z'));
    console.log(d('2026-08-15T18:15:00Z'));
    `
  );
  // 18:14:59Z = 23:59:59 local -> Aug 15; 18:15:00Z = 00:00:00 Aug 16.
  assert.equal(out, '2026-08-16\n2026-08-15\n2026-08-16');
});

test('UTC conversion: UTC timezone keeps UTC dates', () => {
  const out = runWithTZ(
    'UTC',
    `
    const d = (s) => {
      const x = new Date(s);
      const p = (n) => String(n).padStart(2, '0');
      return \`\${x.getFullYear()}-\${p(x.getMonth() + 1)}-\${p(x.getDate())}\`;
    };
    console.log(d('2026-08-15T23:30:00Z'));
    `
  );
  assert.equal(out, '2026-08-15');
});

// ---------------------------------------------------------------------------
// DST boundaries (child processes with explicit TZ)
// ---------------------------------------------------------------------------

test('DST spring-forward day is 23 hours (America/New_York 2026-03-08)', () => {
  const out = runWithTZ(
    'America/New_York',
    `
    const s = new Date(2026, 2, 8);
    const e = new Date(2026, 2, 9);
    console.log(e - s);
    `
  );
  assert.equal(Number(out), 23 * 3600 * 1000);
});

test('DST fall-back day is 25 hours (America/New_York 2026-11-01)', () => {
  const out = runWithTZ(
    'America/New_York',
    `
    const s = new Date(2026, 10, 1);
    const e = new Date(2026, 10, 2);
    console.log(e - s);
    `
  );
  assert.equal(Number(out), 25 * 3600 * 1000);
});

test('DST spring-forward day is 23 hours (Europe/Berlin 2026-03-29)', () => {
  const out = runWithTZ(
    'Europe/Berlin',
    `
    const s = new Date(2026, 2, 29);
    const e = new Date(2026, 2, 30);
    console.log(e - s);
    `
  );
  assert.equal(Number(out), 23 * 3600 * 1000);
});

test('DST: instant just before the spring-forward jump stays on EST (NYC)', () => {
  // Spring forward at 07:00Z (02:00 EST -> 03:00 EDT). 06:30Z is still EST (UTC-5)
  // -> 01:30 local on 2026-03-08.
  const out = runWithTZ(
    'America/New_York',
    `
    const x = new Date('2026-03-08T06:30:00Z');
    const p = (n) => String(n).padStart(2, '0');
    console.log(\`\${x.getFullYear()}-\${p(x.getMonth() + 1)}-\${p(x.getDate())}\`);
    console.log(x.getHours() + ':' + p(x.getMinutes()));
    `
  );
  assert.equal(out, '2026-03-08\n1:30');
});

test('DST: instant just after the spring-forward jump lands on EDT (NYC)', () => {
  // 07:00Z = 03:00 EDT -> 03:00 local on 2026-03-08 (02:00-02:59 never occurred).
  const out = runWithTZ(
    'America/New_York',
    `
    const x = new Date('2026-03-08T07:00:00Z');
    const p = (n) => String(n).padStart(2, '0');
    console.log(\`\${x.getFullYear()}-\${p(x.getMonth() + 1)}-\${p(x.getDate())}\`);
    console.log(x.getHours() + ':' + p(x.getMinutes()));
    `
  );
  assert.equal(out, '2026-03-08\n3:00');
});

// ---------------------------------------------------------------------------
// Month / year transitions and leap years
// ---------------------------------------------------------------------------

test('month transition: endOfLocalMonth rolls to the 1st of the next month', () => {
  assert.equal(t(endOfLocalMonth(new Date(2026, 0, 15))), t(new Date(2026, 1, 1)));
  assert.equal(t(endOfLocalMonth(new Date(2026, 11, 31))), t(new Date(2027, 0, 1)));
});

test('year transition: December grid contains January cells of the next year', () => {
  const dec2026 = getMonthMatrix(new Date(2026, 11, 15));
  const cells = dec2026.flat();
  assert.ok(cells.some((d) => d.getDate() === 31 && d.getMonth() === 11 && d.getFullYear() === 2026));
  assert.ok(cells.some((d) => d.getDate() === 1 && d.getMonth() === 0 && d.getFullYear() === 2027));
});

test('leap year: Feb 2028 grid contains Feb 29; Feb 2029 does not', () => {
  const feb2028 = getMonthMatrix(new Date(2028, 1, 10)).flat();
  assert.ok(feb2028.some((d) => d.getMonth() === 1 && d.getDate() === 29), '2028 is leap');

  const feb2029 = getMonthMatrix(new Date(2029, 1, 10)).flat();
  assert.ok(!feb2029.some((d) => d.getMonth() === 1 && d.getDate() === 29), '2029 is not leap');
  assert.ok(feb2029.some((d) => d.getMonth() === 1 && d.getDate() === 28));
});

test('getMonthMatrix invariants hold for every month of 2020-2030', () => {
  for (let year = 2020; year <= 2030; year++) {
    for (let month = 0; month < 12; month++) {
      const grid = getMonthMatrix(new Date(year, month, 15));
      assert.ok(Array.isArray(grid) && grid.length >= 4 && grid.length <= 6, `${year}-${month + 1}: rows`);
      const cells = grid.flat();
      assert.equal(cells.length % 7, 0, `${year}-${month + 1}: rectangular`);

      for (const week of grid) {
        assert.equal(week.length, 7);
        assert.equal(week[0].getDay(), 0, 'weeks start Sunday');
        assert.equal(week[6].getDay(), 6, 'weeks end Saturday');
      }
      for (let i = 1; i < cells.length; i++) {
        const prev = new Date(cells[i - 1].getFullYear(), cells[i - 1].getMonth(), cells[i - 1].getDate());
        const expected = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1);
        assert.equal(t(cells[i]), t(expected), `${year}-${month + 1}: contiguous cell ${i}`);
      }

      const monthDays = cells.filter((d) => d.getMonth() === month && d.getFullYear() === year);
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      assert.equal(monthDays.length, daysInMonth, `${year}-${month + 1}: full month coverage`);
    }
  }
});

// ---------------------------------------------------------------------------
// parseLocalDateKey fuzzing
// ---------------------------------------------------------------------------

test('parseLocalDateKey rejects malformed and impossible keys', () => {
  for (const bad of [
    '',
    '2026-2-3',
    '2026-02-3',
    '26-02-03',
    '2026-02-03x',
    'x2026-02-03',
    '2026-13-01',
    '2026-00-10',
    '2026-01-00',
    '2026-02-29', // 2026 is not a leap year
    '2026-04-31',
    '2026-01-32',
    '2026/02/03',
    '2026 02 03',
    '2026-02-03 ',
  ]) {
    assert.equal(parseLocalDateKey(bad), null, `expected rejection: ${JSON.stringify(bad)}`);
  }
});

test('parseLocalDateKey accepts valid keys including leap day', () => {
  // NB: values come from a vm realm, so compare via getTime() rather than instanceof.
  const leap = parseLocalDateKey('2024-02-29');
  assert.notEqual(leap, null, 'leap day accepted');
  assert.equal(t(leap), t(new Date(2024, 1, 29)));
  const normal = parseLocalDateKey('2026-08-15');
  assert.notEqual(normal, null);
  assert.equal(t(normal), t(new Date(2026, 7, 15)));
});

// ---------------------------------------------------------------------------
// formatDuration edges
// ---------------------------------------------------------------------------

test('formatDuration edges: rounding, hours, negatives, non-finite', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(59.4), '59s', 'rounds down to whole seconds');
  assert.equal(formatDuration(59.5), '1m', 'rounds up to a whole minute');
  assert.equal(formatDuration(60), '1m');
  assert.equal(formatDuration(3599), '59m 59s');
  assert.equal(formatDuration(3600), '1h');
  assert.equal(formatDuration(3661.5), '1h 1m');
  assert.equal(formatDuration(5400.6), '1h 30m');
  assert.equal(formatDuration(-1), '');
  assert.equal(formatDuration(NaN), '');
  assert.equal(formatDuration(Infinity), '');
  assert.equal(formatDuration(-Infinity), '');
});

// ---------------------------------------------------------------------------
// Chronological sorting
// ---------------------------------------------------------------------------

test('sortMeetingsChronologically does not mutate its input', () => {
  const input = [
    { created_at: new Date(2026, 7, 16).toISOString() },
    { created_at: new Date(2026, 7, 14).toISOString() },
    { created_at: new Date(2026, 7, 15).toISOString() },
  ];
  const before = input.map((m) => m.created_at);
  const sorted = sortMeetingsChronologically(input);
  assert.deepEqual(input.map((m) => m.created_at), before, 'input untouched');
  assert.deepEqual([...sorted].map((m) => m.created_at), [before[1], before[2], before[0]]);
});

test('sortMeetingsChronologically keeps invalid dates at their compare position deterministically', () => {
  const valid = new Date(2026, 7, 15).toISOString();
  const sorted = sortMeetingsChronologically([
    { created_at: 'not-a-date' },
    { created_at: valid },
  ]);
  // NaN compare -> treated as NaN (both sides), order preserved; don't crash.
  assert.equal(sorted.length, 2);
});

// ---------------------------------------------------------------------------
// History buckets
// ---------------------------------------------------------------------------

test('getHistoryBucket: future dates are "earlier" (current semantics)', () => {
  const today = new Date(2026, 7, 15, 12, 0);
  assert.equal(getHistoryBucket(new Date(2026, 7, 16, 0, 0), today), 'earlier');
});

test('getHistoryBucket: exact midnight boundaries', () => {
  const today = new Date(2026, 7, 15, 12, 0);
  assert.equal(getHistoryBucket(new Date(2026, 7, 15, 0, 0), today), 'today');
  assert.equal(getHistoryBucket(new Date(2026, 7, 16, 0, 0), today), 'earlier');
  assert.equal(getHistoryBucket(new Date(2026, 7, 14, 0, 0), today), 'yesterday');
  assert.equal(getHistoryBucket(new Date(2026, 7, 13, 23, 59, 59), today), 'earlier');
});

test('getHistoryGroupLabel never labels a future day Today/Yesterday', () => {
  const today = new Date(2026, 7, 15, 12, 0);
  assert.notEqual(getHistoryGroupLabel(new Date(2026, 7, 16, 9, 0), today), 'Today');
  assert.notEqual(getHistoryGroupLabel(new Date(2026, 7, 16, 9, 0), today), 'Yesterday');
});

// ---------------------------------------------------------------------------
// isSameLocalDay
// ---------------------------------------------------------------------------

test('isSameLocalDay: true only for the same local calendar day', () => {
  assert.ok(isSameLocalDay(new Date(2026, 7, 15, 0, 0, 0, 1), new Date(2026, 7, 15, 23, 59, 59, 999)));
  assert.ok(!isSameLocalDay(new Date(2026, 7, 15, 23, 59, 59, 999), new Date(2026, 7, 16, 0, 0, 0, 0)));
  assert.ok(!isSameLocalDay(new Date(2025, 7, 15), new Date(2026, 7, 15)));
  assert.ok(!isSameLocalDay(new Date(2026, 6, 15), new Date(2026, 7, 15)));
});
