-- Continuous meeting context memory: binding-schema additions
-- (MEETILY_INTELLIGENCE_IMPLEMENTATION_CONTRACT.md section 6).
--
-- contexts gains the durable-core `memory_markdown` digest column (compact,
-- human/LLM-readable knowledge; never full transcripts). `context_memory_items`
-- is the relational per-context working set with per-item provenance
-- (source_meeting_id) and timestamps.
--
-- Note: the in-flight opaque `context_memory` JSON table from the Context
-- Threads migration is intentionally left untouched here; the Integration
-- Owner retires it when normalizing to the binding schema.

ALTER TABLE contexts ADD COLUMN memory_markdown TEXT NOT NULL DEFAULT '';

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
