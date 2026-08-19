use crate::database::{
    models::{ContextMeetingModel, ContextModel, ContextSummaryModel, MeetingModel},
    repositories::context_memory_items::ContextMemoryItemsRepository,
};
use chrono::Utc;
use sqlx::{Connection, Error as SqlxError, SqlitePool};
use tracing::info;
use uuid::Uuid;

/// Raw persistence for Context Threads.
/// All SQL for context tables lives here; validation belongs to the domain layer.
pub struct ContextsRepository;

impl ContextsRepository {
    pub async fn create_context(
        pool: &SqlitePool,
        name: &str,
        description: Option<&str>,
    ) -> Result<ContextModel, SqlxError> {
        let id = format!("context-{}", Uuid::new_v4());
        let now = Utc::now();

        sqlx::query(
            "INSERT INTO contexts (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(name)
        .bind(description)
        .bind(now)
        .bind(now)
        .execute(pool)
        .await?;

        info!("Created context '{}' with id: {}", name, id);

        Ok(ContextModel {
            id,
            name: name.to_string(),
            description: description.map(str::to_string),
            memory_markdown: String::new(),
            created_at: crate::database::models::DateTimeUtc(now),
            updated_at: crate::database::models::DateTimeUtc(now),
        })
    }

    /// Returns the updated context, or `None` when the context does not exist.
    pub async fn update_context(
        pool: &SqlitePool,
        context_id: &str,
        name: &str,
        description: Option<&str>,
    ) -> Result<Option<ContextModel>, SqlxError> {
        let now = Utc::now();

        let result = sqlx::query(
            "UPDATE contexts SET name = ?, description = ?, updated_at = ? WHERE id = ?",
        )
        .bind(name)
        .bind(description)
        .bind(now)
        .bind(context_id)
        .execute(pool)
        .await?;

        if result.rows_affected() == 0 {
            return Ok(None);
        }

        let updated = sqlx::query_as::<_, ContextModel>("SELECT * FROM contexts WHERE id = ?")
            .bind(context_id)
            .fetch_one(pool)
            .await?;

        info!("Updated context {}", context_id);
        Ok(Some(updated))
    }

    /// Deletes the context, its meeting links, and its stored memory items
    /// (contract §6). Meetings and transcripts are never touched.
    /// Returns `false` when the context does not exist.
    pub async fn delete_context(pool: &SqlitePool, context_id: &str) -> Result<bool, SqlxError> {
        let mut conn = pool.acquire().await?;
        let mut transaction = conn.begin().await?;

        let exists: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM contexts WHERE id = ?")
            .bind(context_id)
            .fetch_optional(&mut *transaction)
            .await?;

        if exists.is_none() {
            transaction.rollback().await?;
            return Ok(false);
        }

        ContextMemoryItemsRepository::delete_all_for_context(&mut transaction, context_id).await?;

        sqlx::query("DELETE FROM context_meetings WHERE context_id = ?")
            .bind(context_id)
            .execute(&mut *transaction)
            .await?;

        sqlx::query("DELETE FROM contexts WHERE id = ?")
            .bind(context_id)
            .execute(&mut *transaction)
            .await?;

        transaction.commit().await?;

        info!("Deleted context {}", context_id);
        Ok(true)
    }

    pub async fn get_context(
        pool: &SqlitePool,
        context_id: &str,
    ) -> Result<Option<ContextModel>, SqlxError> {
        sqlx::query_as::<_, ContextModel>("SELECT * FROM contexts WHERE id = ?")
            .bind(context_id)
            .fetch_optional(pool)
            .await
    }

    /// Lists all contexts with their meeting counts, ordered by creation time.
    pub async fn list_contexts(pool: &SqlitePool) -> Result<Vec<ContextSummaryModel>, SqlxError> {
        sqlx::query_as::<_, ContextSummaryModel>(
            r#"
            SELECT c.id, c.name, c.description, c.created_at, c.updated_at,
                   (SELECT COUNT(*) FROM context_meetings cm
                    JOIN meetings m ON m.id = cm.meeting_id
                    WHERE cm.context_id = c.id) AS meeting_count,
                   (SELECT COUNT(*) FROM context_memory_items cmi
                    WHERE cmi.context_id = c.id) AS memory_item_count
            FROM contexts c
            ORDER BY c.created_at ASC, c.id ASC
            "#,
        )
        .fetch_all(pool)
        .await
    }

    pub async fn context_exists(pool: &SqlitePool, context_id: &str) -> Result<bool, SqlxError> {
        let exists: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM contexts WHERE id = ?")
            .bind(context_id)
            .fetch_optional(pool)
            .await?;
        Ok(exists.is_some())
    }

    pub async fn meeting_exists(pool: &SqlitePool, meeting_id: &str) -> Result<bool, SqlxError> {
        let exists: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM meetings WHERE id = ?")
            .bind(meeting_id)
            .fetch_optional(pool)
            .await?;
        Ok(exists.is_some())
    }

    /// Links a meeting to a context.
    /// The composite primary key prevents duplicate links; a duplicate insert is a safe no-op.
    /// Returns `true` when the link was newly created, `false` when it already existed.
    pub async fn add_meeting_to_context(
        pool: &SqlitePool,
        context_id: &str,
        meeting_id: &str,
    ) -> Result<bool, SqlxError> {
        let result = sqlx::query(
            "INSERT OR IGNORE INTO context_meetings (context_id, meeting_id, added_at) VALUES (?, ?, ?)",
        )
        .bind(context_id)
        .bind(meeting_id)
        .bind(Utc::now())
        .execute(pool)
        .await?;

        let added = result.rows_affected() > 0;
        if added {
            info!("Linked meeting {} to context {}", meeting_id, context_id);
        } else {
            info!(
                "Meeting {} already linked to context {} (duplicate ignored)",
                meeting_id, context_id
            );
        }
        Ok(added)
    }

    /// Unlinks a meeting from a context. Never touches the meeting or its transcript.
    /// Returns `true` when the link was removed, `false` when no such link existed.
    pub async fn remove_meeting_from_context(
        pool: &SqlitePool,
        context_id: &str,
        meeting_id: &str,
    ) -> Result<bool, SqlxError> {
        let result =
            sqlx::query("DELETE FROM context_meetings WHERE context_id = ? AND meeting_id = ?")
                .bind(context_id)
                .bind(meeting_id)
                .execute(pool)
                .await?;

        let removed = result.rows_affected() > 0;
        if removed {
            info!(
                "Unlinked meeting {} from context {}",
                meeting_id, context_id
            );
        }
        Ok(removed)
    }

    /// Lists the meetings in a context in chronological order (oldest first).
    pub async fn list_meetings_for_context(
        pool: &SqlitePool,
        context_id: &str,
    ) -> Result<Vec<ContextMeetingModel>, SqlxError> {
        sqlx::query_as::<_, ContextMeetingModel>(
            r#"
            SELECT m.id, m.title, m.created_at, m.updated_at, m.folder_path,
                   SUM(t.duration) AS seg_sum,
                   MAX(t.audio_end_time) AS last_end
            FROM context_meetings cm
            JOIN meetings m ON m.id = cm.meeting_id
            LEFT JOIN transcripts t ON t.meeting_id = m.id
            WHERE cm.context_id = ?
            GROUP BY m.id
            ORDER BY datetime(m.created_at) ASC, m.id ASC
            "#,
        )
        .bind(context_id)
        .fetch_all(pool)
        .await
    }
}
