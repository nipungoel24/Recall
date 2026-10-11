import { describe, it } from 'node:test';
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
  'routes.ts'
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
      throw new Error(`routes.ts must not import modules (got: ${spec})`);
    },
  });
  return moduleObj.exports;
}

const { routes } = loadTsModule(modulePath);

describe('canonical route helpers (static-export safe)', () => {
  it('context uses a query parameter, never a path segment', () => {
    assert.equal(routes.context('context-abc-123'), '/context?id=context-abc-123');
    assert.ok(!routes.context('context-abc-123').includes('/context/'));
  });

  it('runtime IDs with reserved characters are URL-encoded', () => {
    assert.equal(routes.context('my context & plans'), '/context?id=my%20context%20%26%20plans');
    assert.equal(routes.meeting('meeting a#b?c'), '/meeting-details?id=meeting%20a%23b%3Fc');
  });

  it('meeting supports an optional source parameter', () => {
    assert.equal(routes.meeting('m1'), '/meeting-details?id=m1');
    assert.equal(routes.meeting('m1', 'recording'), '/meeting-details?id=m1&source=recording');
    assert.equal(routes.meeting('m1', null), '/meeting-details?id=m1');
  });

  it('daily builds date and range variants', () => {
    assert.equal(routes.daily(), '/daily');
    assert.equal(routes.daily('2026-08-11'), '/daily?date=2026-08-11');
    assert.equal(routes.dailyRange('2026-08-11', '2026-08-13'), '/daily?start=2026-08-11&end=2026-08-13');
  });

  it('calendar supports optional date and month keys', () => {
    assert.equal(routes.calendar(), '/calendar');
    assert.equal(routes.calendar('2026-08-11', null), '/calendar?date=2026-08-11');
    assert.equal(routes.calendar(null, '2026-08'), '/calendar?month=2026-08');
  });

  it('top-level routes are plain paths', () => {
    assert.equal(routes.home(), '/');
    assert.equal(routes.contexts(), '/context');
    assert.equal(routes.templates(), '/templates');
    assert.equal(routes.settings(), '/settings');
    assert.equal(routes.notes('team-sync'), '/notes?id=team-sync');
  });

  it('no route helper ever emits a dynamic path segment for an entity id', () => {
    for (const build of [routes.context, routes.meeting, routes.notes]) {
      assert.ok(!/\/[^?]*x$/.test(build('x')));
      assert.ok(build('x').includes('?'));
    }
  });
});

