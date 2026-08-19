// QA regression suite for the calendar->daily navigation module
// (src/lib/daily/navigation.ts), which imports from timeline.ts. The
// timeline module is loaded first and injected through the require shim.
//
// Runnable with:  node --test tests/lib/qa-daily-navigation.test.mjs
//                 pnpm exec bun test tests/lib/qa-daily-navigation.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function loadTsModule(filePath, requireShim) {
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
    require: requireShim ?? (() => {
      throw new Error('unexpected require');
    }),
  });
  return module.exports;
}

const timelinePath = path.join(here, '..', '..', 'src', 'lib', 'daily', 'timeline.ts');
const timeline = loadTsModule(timelinePath);

const navigation = loadTsModule(
  path.join(here, '..', '..', 'src', 'lib', 'daily', 'navigation.ts'),
  (spec) => {
    if (spec === '@/lib/daily/timeline') return timeline;
    throw new Error(`unexpected require: ${spec}`);
  }
);

const { DAILY_ROUTE, buildDailyRoute, buildDailyRangeRoute, todayDateKey } = navigation;

test('DAILY_ROUTE is /daily', () => {
  assert.equal(DAILY_ROUTE, '/daily');
});

test('buildDailyRoute from a Date uses the LOCAL day key', () => {
  assert.equal(buildDailyRoute(new Date(2026, 7, 15, 14, 0)), '/daily?date=2026-08-15');
});

test('buildDailyRoute from a Date at the edge of the local day', () => {
  assert.equal(buildDailyRoute(new Date(2026, 7, 15, 23, 59, 59, 999)), '/daily?date=2026-08-15');
  assert.equal(buildDailyRoute(new Date(2026, 7, 16, 0, 0, 0, 0)), '/daily?date=2026-08-16');
});

test('buildDailyRoute from a valid key string is passed through encoded', () => {
  assert.equal(buildDailyRoute('2026-08-15'), '/daily?date=2026-08-15');
});

test('buildDailyRoute from an invalid input degrades to the bare route', () => {
  assert.equal(buildDailyRoute('not-a-date'), '/daily');
  assert.equal(buildDailyRoute(''), '/daily');
  assert.equal(buildDailyRoute(null), '/daily');
  assert.equal(buildDailyRoute(new Date(NaN)), '/daily');
});

test('buildDailyRangeRoute builds start/end query params', () => {
  assert.equal(
    buildDailyRangeRoute('2026-08-10', '2026-08-15'),
    '/daily?start=2026-08-10&end=2026-08-15'
  );
});

test('buildDailyRangeRoute with Date inputs uses local keys', () => {
  assert.equal(
    buildDailyRangeRoute(new Date(2026, 7, 10, 1, 0), new Date(2026, 7, 15, 23, 0)),
    '/daily?start=2026-08-10&end=2026-08-15'
  );
});

test('buildDailyRangeRoute with an invalid edge falls back to today', () => {
  const route = buildDailyRangeRoute('garbage', '2026-08-15');
  assert.match(route, /^\/daily\?date=\d{4}-\d{2}-\d{2}$/);
  const route2 = buildDailyRangeRoute('2026-08-10', new Date(NaN));
  assert.match(route2, /^\/daily\?date=\d{4}-\d{2}-\d{2}$/);
});

test('todayDateKey matches timeline dateKeyOf(new Date())', () => {
  const expected = timeline.dateKeyOf(new Date());
  assert.equal(todayDateKey(), expected);
});

test('navigation route keys round-trip through the timeline parser', () => {
  const route = buildDailyRoute(new Date(2026, 11, 31));
  const key = decodeURIComponent(route.split('date=')[1]);
  assert.ok(timeline.parseDateKey(key), 'route key parses');
  assert.equal(timeline.normalizeDateKey(key), '2026-12-31');
});
