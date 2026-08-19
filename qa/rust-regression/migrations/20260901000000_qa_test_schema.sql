-- QA-owned MIRROR of the app migration schema, kept intentionally minimal:
-- only the tables exercised by the modules included in this harness.
-- This is NOT a copy of the app migrations (the real files stay canonical in
-- frontend/src-tauri/migrations). Keep in sync on schema changes; divergence
-- surfaces as failing tests here (canary).

-- Mirrors 20250916100000_initial_schema.sql (subset)
CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Mirrors 20251006000000_add_audio_sync_fields.sql
ALTER TABLE meetings ADD COLUMN folder_path TEXT;

CREATE TABLE IF NOT EXISTS transcripts (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    transcript TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    summary TEXT,
    action_items TEXT,
    key_points TEXT,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

ALTER TABLE transcripts ADD COLUMN audio_start_time REAL;
ALTER TABLE transcripts ADD COLUMN audio_end_time REAL;
ALTER TABLE transcripts ADD COLUMN duration REAL;

-- Mirrors 20260815000000_add_context_threads.sql + 20260815000002_add_context_memory.sql
CREATE TABLE IF NOT EXISTS contexts (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    memory_markdown TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS context_meetings (
    context_id TEXT NOT NULL,
    meeting_id TEXT NOT NULL,
    added_at TEXT NOT NULL,
    PRIMARY KEY (context_id, meeting_id),
    FOREIGN KEY (context_id) REFERENCES contexts(id) ON DELETE CASCADE,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS context_memory_items (
    id TEXT PRIMARY KEY,
    context_id TEXT NOT NULL REFERENCES contexts(id) ON DELETE CASCADE,
    source_meeting_id TEXT,
    kind TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
