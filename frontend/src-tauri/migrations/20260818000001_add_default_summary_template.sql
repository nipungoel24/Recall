-- Persistent default summary template (nullable).
--
-- Stores the template ID the summary picker should preselect. NULL means the
-- built-in fallback (standard_meeting). The id is re-validated on every read,
-- so deleting a custom template that was the default can never leave a broken
-- configuration: the read falls back and clears the stored id.
ALTER TABLE settings ADD COLUMN defaultTemplateId TEXT;
