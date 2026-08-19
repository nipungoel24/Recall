import { describe, expect, test } from 'bun:test';

const { routes } = await import('../../src/lib/routes');

describe('canonical route helpers (static-export safe)', () => {
  test('context uses a query parameter, never a path segment', () => {
    expect(routes.context('context-abc-123')).toBe('/context?id=context-abc-123');
    expect(routes.context('context-abc-123')).not.toContain('/context/');
  });

  test('runtime IDs with reserved characters are URL-encoded', () => {
    expect(routes.context('my context & plans')).toBe('/context?id=my%20context%20%26%20plans');
    expect(routes.meeting('meeting a#b?c')).toBe('/meeting-details?id=meeting%20a%23b%3Fc');
  });

  test('meeting supports an optional source parameter', () => {
    expect(routes.meeting('m1')).toBe('/meeting-details?id=m1');
    expect(routes.meeting('m1', 'recording')).toBe('/meeting-details?id=m1&source=recording');
    expect(routes.meeting('m1', null)).toBe('/meeting-details?id=m1');
  });

  test('daily builds date and range variants', () => {
    expect(routes.daily()).toBe('/daily');
    expect(routes.daily('2026-08-11')).toBe('/daily?date=2026-08-11');
    expect(routes.dailyRange('2026-08-11', '2026-08-13')).toBe(
      '/daily?start=2026-08-11&end=2026-08-13',
    );
  });

  test('calendar supports optional date and month keys', () => {
    expect(routes.calendar()).toBe('/calendar');
    expect(routes.calendar('2026-08-11', null)).toBe('/calendar?date=2026-08-11');
    expect(routes.calendar(null, '2026-08')).toBe('/calendar?month=2026-08');
  });

  test('top-level routes are plain paths', () => {
    expect(routes.home()).toBe('/');
    expect(routes.contexts()).toBe('/context');
    expect(routes.templates()).toBe('/templates');
    expect(routes.settings()).toBe('/settings');
    expect(routes.notes('team-sync')).toBe('/notes?id=team-sync');
  });

  test('no route helper ever emits a dynamic path segment for an entity id', () => {
    for (const build of [routes.context, routes.meeting, routes.notes]) {
      expect(build('x')).not.toMatch(/\/[^?]*x$/);
      expect(build('x').includes('?')).toBe(true);
    }
  });
});
