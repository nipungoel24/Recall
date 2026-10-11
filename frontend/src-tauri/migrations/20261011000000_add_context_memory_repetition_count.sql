-- Persist the number of evidence-backed refreshes for each context-memory item.
--
-- This makes the documented frequency ranking signal real. Existing memories
-- start at one observation; a refresh increments the count (capped in the
-- repository at five because the scoring multiplier is capped at 2x).
ALTER TABLE context_memory_items
    ADD COLUMN repetition_count INTEGER NOT NULL DEFAULT 1;
