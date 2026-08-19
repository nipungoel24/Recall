/**
 * Daily meeting timeline types.
 *
 * The daily view visually combines multiple independent meetings into a
 * single day timeline. Individual meetings remain separate records in the
 * database; these types only describe the aggregated view state.
 */

/** A single meeting entry rendered on the daily timeline. */
export interface DailyMeeting {
  id: string;
  title: string;
  /** RFC3339 timestamp from the backend (UTC). */
  createdAt: string;
  updatedAt: string;
  folderPath: string | null;
  /**
   * Wall-clock start time for the timeline. Derived from the first
   * transcript's timestamp (kept on the meeting's local day), falling back
   * to `createdAt`. ISO string or null when unknown.
   */
  startTime: string | null;
  /** ISO string end time (last transcript end), or null when unknown. */
  endTime: string | null;
  /** Meeting duration in seconds (last end - first start). */
  durationSeconds: number;
  /**
   * Total number of transcript segments in the database, or null when the
   * count was not fetched eagerly (loaded lazily on expansion instead).
   */
  transcriptCount: number | null;
  hasTranscripts: boolean;
}

/** Status of the combined daily brief. */
export type DailyBriefStatus =
  | 'idle'
  | 'loading'
  | 'generating'
  | 'completed'
  | 'error';

/** Provenance entry for a daily brief (a source meeting). */
export interface DailyBriefSource {
  meetingId: string;
  title: string;
}

/** Result payload of a generated daily brief. */
export interface DailyBriefResult {
  markdown: string;
  sources: DailyBriefSource[];
}

/** Full state of the daily brief section. */
export interface DailyBriefState {
  status: DailyBriefStatus;
  markdown: string | null;
  sources: DailyBriefSource[];
  error: string | null;
}

/** Backend response shape for the dedicated daily brief status command. */
export interface DailyBriefStatusResponse {
  status: 'idle' | 'processing' | 'completed' | 'failed' | 'cancelled' | string;
  data?: {
    markdown?: string;
    sources?: Array<{ meetingId?: string; meeting_id?: string; title?: string }>;
  };
  error?: string | null;
}

/** Aggregated header statistics for one day (or range). */
export interface DailyTotals {
  meetingCount: number;
  durationSeconds: number;
}
