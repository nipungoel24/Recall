-- Context Threads — binding schema, contract §6
-- (docs/MEETILY_INTELLIGENCE_IMPLEMENTATION_CONTRACT.md)
--
-- Replaces the in-flight 20260815000000_add_context_threads.sql. The opaque
-- `context_memory` JSON table is retired: compact memory lives on
-- `contexts.memory_markdown` and per-item memory with source-meeting
-- provenance lives in `context_memory_items`.
--
-- Timestamps are RFC3339 UTC strings (Utc::now().to_rfc3339()).

CREATE TABLE IF NOT EXISTS contexts (
    id TEXT PRIMARY KEY,                       -- "context-<uuid>"
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    memory_markdown TEXT NOT NULL DEFAULT '',  -- compact human/LLM-readable memory (NOT full transcripts)
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS context_meetings (
    context_id TEXT NOT NULL REFERENCES contexts(id) ON DELETE CASCADE,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL,
    PRIMARY KEY (context_id, meeting_id)       -- composite PK prevents duplicate links
);
CREATE INDEX IF NOT EXISTS idx_context_meetings_meeting_id ON context_meetings(meeting_id);

CREATE TABLE IF NOT EXISTS context_memory_items (
    id TEXT PRIMARY KEY,                       -- "cmi-<uuid>"
    context_id TEXT NOT NULL REFERENCES contexts(id) ON DELETE CASCADE,
    source_meeting_id TEXT,                    -- NULL = manually entered, no provenance
    kind TEXT NOT NULL,                        -- fact | decision | action | question | note
    content TEXT NOT NULL,
    status TEXT,                               -- free-form short string (e.g. open|done|blocked)
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_items_context ON context_memory_items(context_id);
CREATE INDEX IF NOT EXISTS idx_memory_items_source ON context_memory_items(source_meeting_id);
