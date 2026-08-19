-- Add daily_summaries table for derived Daily Brief artifacts.
--
-- A Daily Brief is synthesized from multiple source meetings that occurred on
-- one calendar day. It is a DERIVED artifact: generating or regenerating a
-- daily brief must never modify source meeting records, transcripts, or their
-- summary_processes rows. This table is intentionally independent of the
-- meetings table (no foreign key) so a brief can outlive individual meetings
-- and so regeneration cannot cascade into meeting data.
CREATE TABLE IF NOT EXISTS daily_summaries (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL UNIQUE,
    meeting_ids TEXT NOT NULL,
    template_id TEXT,
    result TEXT,
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    chunk_count INTEGER DEFAULT 0,
    processing_time REAL DEFAULT 0.0,
    source_fingerprint TEXT,
    result_backup TEXT,
    result_backup_timestamp TEXT
);

CREATE INDEX IF NOT EXISTS idx_daily_summaries_status ON daily_summaries(status);
CREATE INDEX IF NOT EXISTS idx_daily_summaries_date ON daily_summaries(date);
