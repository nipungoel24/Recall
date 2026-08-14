-- OPTIONAL: index on meetings.created_at.
--
-- Contract §3.2 binding range queries normalize timestamps inside SQLite:
--
--   WHERE datetime(m.created_at) >= datetime(?1) AND datetime(m.created_at) < datetime(?2)
--
-- Because the comparison runs inside datetime(), SQLite cannot use a plain
-- created_at index for those queries (function on column). The binding query
-- already normalizes the mixed TEXT formats that exist in created_at
-- (RFC3339 "...T...+00:00"/"...Z" and naive "YYYY-MM-DD HH:MM:SS.ffffff"), so the
-- index would be dead weight for the contract-bound access paths.
--
-- Apply this index ONLY if a future query compares the raw column
-- (created_at >= ? AND created_at < ?) against values written exclusively in one
-- format (e.g. all RFC3339). Raw comparisons are incorrect against mixed-format
-- columns (naive rows sort before RFC3339 rows for the same day), which is why
-- the contract mandates datetime() normalization instead.

CREATE INDEX IF NOT EXISTS idx_meetings_created_at ON meetings(created_at);
