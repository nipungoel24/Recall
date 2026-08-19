-- Index for transcript pagination in meeting-details.
--
-- api_get_meeting_transcripts filters by meeting_id and orders by
-- audio_start_time on every page fetch. Without an index SQLite scans and
-- sorts the entire transcripts table per request; with long meetings (1000s
-- of segments) this shows up as measurable latency in the transcript panel.
CREATE INDEX IF NOT EXISTS idx_transcripts_meeting_time
    ON transcripts(meeting_id, audio_start_time);
