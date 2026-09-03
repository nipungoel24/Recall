-- Daily Brief storage — binding schema, contract §5.1
-- (docs/RECALL_INTELLIGENCE_IMPLEMENTATION_CONTRACT.md)
--
-- Derived data only: a Daily Brief is synthesized from source meetings but never
-- duplicates or modifies them. `date` is the USER-LOCAL "YYYY-MM-DD" aggregation
-- key only — it is never used for time math or DB time comparisons.
-- `meeting_ids` is a JSON array of the source meeting ids.
--
-- Timestamps are RFC3339 UTC strings (Utc::now().to_rfc3339()).

CREATE TABLE IF NOT EXISTS daily_summaries (
    id TEXT PRIMARY KEY,                -- "daily-summary-<uuid>"
    date TEXT NOT NULL UNIQUE,          -- USER-LOCAL date "YYYY-MM-DD" (aggregation key only)
    meeting_ids TEXT NOT NULL,          -- JSON array of meeting ids included
    template_id TEXT,                   -- template id used
    result TEXT,                        -- JSON, same shape as summary_processes.result
    status TEXT NOT NULL,               -- pending|processing|completed|failed|cancelled
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_daily_summaries_date ON daily_summaries(date);
