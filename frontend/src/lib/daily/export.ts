import type { DailyBriefSource } from '@/types/daily';

export function dailyBriefExportFilename(dateKey: string): string {
  return `recall-daily-brief-${dateKey}.md`;
}

/** Builds a portable, user-facing representation of an already generated brief. */
export function buildDailyBriefMarkdownExport(
  dateKey: string,
  markdown: string,
  sources: DailyBriefSource[],
): string {
  const title = `# Daily Brief — ${dateKey}`;
  const meetings = sources.length
    ? `\n\n## Meetings\n\n${sources.map((source) => `- ${source.title || 'Untitled meeting'}`).join('\n')}`
    : '';
  return `${title}\n\n${markdown.trim()}${meetings}\n`;
}
