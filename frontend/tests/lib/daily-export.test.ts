import { describe, expect, test } from 'bun:test';
import { buildDailyBriefMarkdownExport, dailyBriefExportFilename } from '../../src/lib/daily/export';

describe('Daily Brief export', () => {
  test('builds portable markdown with user-facing meeting names', () => {
    expect(buildDailyBriefMarkdownExport('2026-08-22', '**Done**', [{ meetingId: 'secret-id', title: 'Planning & Review' }]))
      .toBe('# Daily Brief — 2026-08-22\n\n**Done**\n\n## Meetings\n\n- Planning & Review\n');
  });

  test('handles missing sources and creates a stable filename', () => {
    expect(buildDailyBriefMarkdownExport('2026-08-22', 'Body', [])).toBe('# Daily Brief — 2026-08-22\n\nBody\n');
    expect(dailyBriefExportFilename('2026-08-22')).toBe('recall-daily-brief-2026-08-22.md');
  });
});
