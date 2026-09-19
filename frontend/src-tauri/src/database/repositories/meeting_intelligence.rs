use crate::database::models::{
    MeetingIntelligenceItemModel, MeetingIntelligenceItemSourceModel, MeetingIntelligenceModel,
};
use chrono::Utc;
use sqlx::{Error as SqlxError, SqlitePool};
use uuid::Uuid;

pub struct MeetingIntelligenceRepository;

impl MeetingIntelligenceRepository {
    /// Get the intelligence record for a meeting
    pub async fn get_intelligence(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<MeetingIntelligenceModel>, SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        let intelligence = sqlx::query_as::<_, MeetingIntelligenceModel>(
            "SELECT * FROM meeting_intelligence WHERE meeting_id = ?",
        )
        .bind(meeting_id)
        .fetch_optional(pool)
        .await?;

        Ok(intelligence)
    }

    /// Create or replace the intelligence record for a meeting
    pub async fn upsert_intelligence(
        pool: &SqlitePool,
        meeting_id: &str,
        abstract_text: Option<&str>,
        provider: Option<&str>,
        model: Option<&str>,
    ) -> Result<(), SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        let now = Utc::now();
        let generated_at = now.to_rfc3339();

        sqlx::query(
            r#"
            INSERT INTO meeting_intelligence (meeting_id, abstract_text, schema_version, generated_at, provider, model, created_at, updated_at)
            VALUES (?, ?, 1, ?, ?, ?, ?, ?)
            ON CONFLICT(meeting_id) DO UPDATE SET
                abstract_text = excluded.abstract_text,
                generated_at = excluded.generated_at,
                provider = excluded.provider,
                model = excluded.model,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(meeting_id)
        .bind(abstract_text)
        .bind(generated_at)
        .bind(provider)
        .bind(model)
        .bind(now)
        .bind(now)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Delete intelligence record for a meeting
    pub async fn delete_intelligence(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<bool, SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        let result = sqlx::query("DELETE FROM meeting_intelligence WHERE meeting_id = ?")
            .bind(meeting_id)
            .execute(pool)
            .await?;

        Ok(result.rows_affected() > 0)
    }

    // ==================== Intelligence Items ====================

    /// Get all intelligence items for a meeting
    pub async fn get_items(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Vec<MeetingIntelligenceItemModel>, SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        let items = sqlx::query_as::<_, MeetingIntelligenceItemModel>(
            "SELECT * FROM meeting_intelligence_items WHERE meeting_id = ? ORDER BY ordering ASC",
        )
        .bind(meeting_id)
        .fetch_all(pool)
        .await?;

        Ok(items)
    }

    /// Get intelligence items by kind
    pub async fn get_items_by_kind(
        pool: &SqlitePool,
        meeting_id: &str,
        kind: &str,
    ) -> Result<Vec<MeetingIntelligenceItemModel>, SqlxError> {
        if meeting_id.trim().is_empty() || kind.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id and kind cannot be empty".to_string(),
            ));
        }

        let items = sqlx::query_as::<_, MeetingIntelligenceItemModel>(
            "SELECT * FROM meeting_intelligence_items WHERE meeting_id = ? AND kind = ? ORDER BY ordering ASC",
        )
        .bind(meeting_id)
        .bind(kind)
        .fetch_all(pool)
        .await?;

        Ok(items)
    }

    /// Insert multiple intelligence items (replaces all existing for the meeting)
    pub async fn replace_items(
        pool: &SqlitePool,
        meeting_id: &str,
        items: Vec<NewIntelligenceItem>,
    ) -> Result<(), SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        let mut tx = pool.begin().await?;

        // Delete existing items and their sources (cascades)
        sqlx::query("DELETE FROM meeting_intelligence_items WHERE meeting_id = ?")
            .bind(meeting_id)
            .execute(&mut *tx)
            .await?;

        let now = Utc::now();

        for (index, item) in items.into_iter().enumerate() {
            let item_id = format!("mii-{}", Uuid::new_v4());

            sqlx::query(
                r#"
                INSERT INTO meeting_intelligence_items (
                    id, meeting_id, kind, text, ordering, confidence, owner, due_date, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                "#,
            )
            .bind(&item_id)
            .bind(meeting_id)
            .bind(&item.kind)
            .bind(&item.text)
            .bind(index as i64)
            .bind(item.confidence)
            .bind(item.owner)
            .bind(item.due_date)
            .bind(item.status)
            .bind(now)
            .bind(now)
            .execute(&mut *tx)
            .await?;

            // Insert sources
            for source_id in item.sources {
                let source_row_id = format!("mis-{}", Uuid::new_v4());
                sqlx::query(
                    r#"
                    INSERT INTO meeting_intelligence_item_sources (
                        id, item_id, transcript_segment_id, meeting_id, created_at
                    ) VALUES (?, ?, ?, ?, ?)
                    "#,
                )
                .bind(source_row_id)
                .bind(&item_id)
                .bind(&source_id)
                .bind(meeting_id)
                .bind(now)
                .execute(&mut *tx)
                .await?;
            }
        }

        tx.commit().await?;
        Ok(())
    }

    /// Delete all intelligence items for a meeting
    pub async fn delete_items(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<bool, SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        let result = sqlx::query("DELETE FROM meeting_intelligence_items WHERE meeting_id = ?")
            .bind(meeting_id)
            .execute(pool)
            .await?;

        Ok(result.rows_affected() > 0)
    }

    // ==================== Provenance Sources ====================

    /// Get sources for an intelligence item
    pub async fn get_sources_for_item(
        pool: &SqlitePool,
        item_id: &str,
    ) -> Result<Vec<MeetingIntelligenceItemSourceModel>, SqlxError> {
        if item_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "item_id cannot be empty".to_string(),
            ));
        }

        let sources = sqlx::query_as::<_, MeetingIntelligenceItemSourceModel>(
            "SELECT * FROM meeting_intelligence_item_sources WHERE item_id = ?",
        )
        .bind(item_id)
        .fetch_all(pool)
        .await?;

        Ok(sources)
    }

    /// Get sources for all items in a meeting (for efficient loading)
    pub async fn get_sources_for_meeting(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Vec<MeetingIntelligenceItemSourceModel>, SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        let sources = sqlx::query_as::<_, MeetingIntelligenceItemSourceModel>(
            "SELECT * FROM meeting_intelligence_item_sources WHERE meeting_id = ?",
        )
        .bind(meeting_id)
        .fetch_all(pool)
        .await?;

        Ok(sources)
    }
}

#[derive(Debug, Clone)]
pub struct NewIntelligenceItem {
    pub kind: String,
    pub text: String,
    pub confidence: Option<f64>,
    pub owner: Option<String>,
    pub due_date: Option<String>,
    pub status: Option<String>,
    pub sources: Vec<String>, // transcript segment IDs
}