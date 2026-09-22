use crate::database::models::MeetingNotesModel;
use chrono::Utc;
use sqlx::SqlitePool;
use tracing::info;

pub struct NotesRepository;

impl NotesRepository {
    /// Retrieves notes for a given meeting ID
    pub async fn get_notes(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<MeetingNotesModel>, sqlx::Error> {
        sqlx::query_as::<_, MeetingNotesModel>(
            "SELECT meeting_id, notes_markdown, notes_json, created_at, updated_at FROM meeting_notes WHERE meeting_id = ?",
        )
        .bind(meeting_id)
        .fetch_optional(pool)
        .await
    }

    /// Saves or updates notes for a meeting
    pub async fn save_notes(
        pool: &SqlitePool,
        meeting_id: &str,
        notes_markdown: Option<&str>,
        notes_json: Option<&str>,
    ) -> Result<bool, sqlx::Error> {
        if meeting_id.trim().is_empty() {
            return Err(sqlx::Error::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        let mut transaction = pool.begin().await?;

        // Verify meeting exists
        let meeting_exists: bool = sqlx::query("SELECT 1 FROM meetings WHERE id = ?")
            .bind(meeting_id)
            .fetch_optional(&mut *transaction)
            .await?
            .is_some();

        if !meeting_exists {
            info!(
                "Attempted to save notes for a non-existent meeting_id: {}",
                meeting_id
            );
            transaction.rollback().await?;
            return Ok(false);
        }

        let now = Utc::now();

        // Upsert notes (INSERT OR REPLACE since meeting_id is PK)
        sqlx::query(
            r#"
            INSERT INTO meeting_notes (meeting_id, notes_markdown, notes_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(meeting_id) DO UPDATE SET
                notes_markdown = excluded.notes_markdown,
                notes_json = excluded.notes_json,
                updated_at = excluded.updated_at
            "#
        )
        .bind(meeting_id)
        .bind(notes_markdown)
        .bind(notes_json)
        .bind(now)
        .bind(now)
        .execute(&mut *transaction)
        .await?;

        // Update meeting's updated_at timestamp
        sqlx::query("UPDATE meetings SET updated_at = ? WHERE id = ?")
            .bind(now)
            .bind(meeting_id)
            .execute(&mut *transaction)
            .await?;

        transaction.commit().await?;

        info!("Successfully saved notes for meeting_id: {}", meeting_id);
        Ok(true)
    }
}
