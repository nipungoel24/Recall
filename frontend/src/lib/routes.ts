/**
 * Canonical application routes.
 *
 * Meetily ships as a static export (Next.js `output: "export"`) inside the
 * Tauri shell. Dynamic SEGMENTS (`/context/[id]`) can only be pre-rendered
 * for IDs known at build time, so every runtime-created entity (contexts,
 * meetings, notes) is addressed with a QUERY parameter on a static route:
 *
 *   /context?id=context-abc        (NOT /context/context-abc)
 *   /meeting-details?id=meeting-x  (NOT /meeting-details/meeting-x)
 *   /notes?id=team-sync            (NOT /notes/team-sync)
 *
 * Use these helpers instead of hand-building route strings so every screen
 * stays export-safe when new runtime IDs are created after the build.
 */

function withQuery(base: string, params: Record<string, string | null | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') {
      parts.push(`${key}=${encodeURIComponent(value)}`);
    }
  }
  return parts.length > 0 ? `${base}?${parts.join('&')}` : base;
}

export const routes = {
  home: (): string => '/',

  calendar: (dateKey?: string | null, monthKey?: string | null): string =>
    withQuery('/calendar', { date: dateKey, month: monthKey }),

  daily: (dateKey?: string | null): string => withQuery('/daily', { date: dateKey }),

  dailyRange: (startKey: string, endKey: string): string =>
    withQuery('/daily', { start: startKey, end: endKey }),

  contexts: (): string => '/context',

  context: (contextId: string): string => withQuery('/context', { id: contextId }),

  meeting: (meetingId: string, source?: string | null): string =>
    withQuery('/meeting-details', { id: meetingId, source }),

  templates: (): string => '/templates',

  notes: (noteId: string): string => withQuery('/notes', { id: noteId }),

  settings: (): string => '/settings',
};

export type AppRoutes = typeof routes;
