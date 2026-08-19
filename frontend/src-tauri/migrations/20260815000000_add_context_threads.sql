-- Context Threads: organize related meetings into persistent, named contexts.
-- Binding schema (MEETILY_INTELLIGENCE_IMPLEMENTATION_CONTRACT.md):
-- one context contains many meetings; one meeting may belong to many contexts.
--
-- NOTE: the durable-core `memory_markdown` digest column and the
-- `context_memory_items` working-set table are added by the context-memory
-- migration (20260815000002_add_context_memory.sql), which owns memory storage.
CREATE TABLE IF NOT EXISTS contexts (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Many-to-many link between contexts and meetings.
-- The composite primary key safely prevents duplicate links at the database level.
CREATE TABLE IF NOT EXISTS context_meetings (
    context_id TEXT NOT NULL,
    meeting_id TEXT NOT NULL,
    added_at TEXT NOT NULL,
    PRIMARY KEY (context_id, meeting_id),
    FOREIGN KEY (context_id) REFERENCES contexts(id) ON DELETE CASCADE,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_context_meetings_meeting_id ON context_meetings(meeting_id);
