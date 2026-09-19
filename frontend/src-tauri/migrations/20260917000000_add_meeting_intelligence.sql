-- Meeting Intelligence: structured per-meeting understanding with provenance
-- Part of Phase 5: Meeting Workspace + Structured Intelligence + Provenance

-- Parent intelligence record: one per meeting
CREATE TABLE IF NOT EXISTS meeting_intelligence (
    meeting_id TEXT PRIMARY KEY NOT NULL,
    abstract TEXT,
    schema_version INTEGER NOT NULL DEFAULT 1,
    generated_at TEXT,
    provider TEXT,
    model TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meeting_intelligence_meeting_id ON meeting_intelligence(meeting_id);

-- Intelligence items: topic, decision, action, question, fact, follow_up
CREATE TABLE IF NOT EXISTS meeting_intelligence_items (
    id TEXT PRIMARY KEY NOT NULL,                    -- "mii-<uuid>"
    meeting_id TEXT NOT NULL,
    kind TEXT NOT NULL,                              -- topic | decision | action | question | fact | follow_up
    text TEXT NOT NULL,
    ordering INTEGER NOT NULL DEFAULT 0,
    confidence REAL,                                 -- 0.0 to 1.0
    owner TEXT,                                      -- optional, NULL = unknown
    due_date TEXT,                                   -- optional ISO 8601, NULL = unknown
    status TEXT,                                     -- optional short string (e.g. open|done|blocked)
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_intelligence_items_meeting ON meeting_intelligence_items(meeting_id);
CREATE INDEX IF NOT EXISTS idx_intelligence_items_kind ON meeting_intelligence_items(kind);
CREATE INDEX IF NOT EXISTS idx_intelligence_items_ordering ON meeting_intelligence_items(meeting_id, ordering);

-- Provenance: links intelligence items to source transcript segments
CREATE TABLE IF NOT EXISTS meeting_intelligence_item_sources (
    id TEXT PRIMARY KEY NOT NULL,                    -- "mis-<uuid>"
    item_id TEXT NOT NULL,
    transcript_segment_id TEXT NOT NULL,             -- references transcripts.id
    meeting_id TEXT NOT NULL,                        -- denormalized for efficient validation
    created_at TEXT NOT NULL,
    FOREIGN KEY (item_id) REFERENCES meeting_intelligence_items(id) ON DELETE CASCADE,
    FOREIGN KEY (transcript_segment_id) REFERENCES transcripts(id) ON DELETE CASCADE,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_intelligence_sources_item ON meeting_intelligence_item_sources(item_id);
CREATE INDEX IF NOT EXISTS idx_intelligence_sources_segment ON meeting_intelligence_item_sources(transcript_segment_id);
CREATE INDEX IF NOT EXISTS idx_intelligence_sources_meeting ON meeting_intelligence_item_sources(meeting_id);

-- Note: meeting deletion already cascades via FK on meeting_id in all three tables.
-- The meeting_deletion.rs handles additional derived-data cleanup.