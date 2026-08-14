//! Persistence for derived Daily Brief records (binding schema, contract §5.1).
//!
//! A Daily Brief is synthesized from the source meetings of one user-local calendar
//! day. It is DERIVED data: no meeting rows are duplicated or merged here, and
//! writing a brief never touches `meetings`, `transcripts`, or `summary_processes`
//! (contract §5). `date` is the user-local "YYYY-MM-DD" aggregation key only — it is
//! never used for time math (contract §10.5). `meeting_ids` is a JSON array of the
//! source meeting ids.
//!
//! Regeneration semantics (contract §5.2.2): an upsert re-opens the row but keeps
//! the previous `result` untouched until generation succeeds; on failure or cancel
//! the previous result remains intact.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{Error as SqlxError, FromRow, SqliteConnection, SqlitePool};
use tracing::info;
use uuid::Uuid;

/// Row shape for the binding `daily_summaries` table (contract §5.1).
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct DailyBriefRow {
    pub id: String,
    pub date: String,
    pub meeting_ids: String,
    pub template_id: Option<String>,
    pub result: Option<String>,
    pub status: String,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub struct DailyBriefsRepository;

impl DailyBriefsRepository {
    pub async fn get_by_date(
        pool: &SqlitePool,
        date: &str,
    ) -> Result<Option<DailyBriefRow>, SqlxError> {
        sqlx::query_as::<_, DailyBriefRow>("SELECT * FROM daily_summaries WHERE date = ?")
            .bind(date)
            .fetch_optional(pool)
            .await
    }

    /// Opens (or re-opens on regeneration) the daily brief row for `date`.
    ///
    /// Inserts a fresh `pending` row on first use; on conflict the row is set back
    /// to `pending` with the new `meeting_ids`/`template_id`, while the previous
    /// `result` is deliberately left untouched so a failure can never lose the last
    /// good brief (contract §5.2.2).
    pub async fn open(
        pool: &SqlitePool,
        date: &str,
        meeting_ids: &str,
        template_id: Option<&str>,
    ) -> Result<DailyBriefRow, SqlxError> {
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            r#"
            INSERT INTO daily_summaries (id, date, meeting_ids, template_id, result, status, error, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, NULL, 'pending', NULL, ?5, ?5)
            ON CONFLICT(date) DO UPDATE SET
                meeting_ids = excluded.meeting_ids,
                template_id = excluded.template_id,
                status = 'pending',
                error = NULL,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(format!("daily-summary-{}", Uuid::new_v4()))
        .bind(date)
        .bind(meeting_ids)
        .bind(template_id)
        .bind(&now)
        .execute(pool)
        .await?;

        info!("Opened daily brief for date {}", date);
        let row = Self::get_by_date(pool, date).await?;
        row.ok_or_else(|| SqlxError::Protocol("daily brief was not found after open".to_string()))
    }

    /// Marks the brief completed, storing the generated `result` JSON. The previous
    /// result is overwritten only now (generation succeeded).
    pub async fn complete(pool: &SqlitePool, date: &str, result: &str) -> Result<bool, SqlxError> {
        let now = Utc::now().to_rfc3339();
        let updated = sqlx::query(
            "UPDATE daily_summaries
             SET status = 'completed', result = ?, error = NULL, updated_at = ?
             WHERE date = ?",
        )
        .bind(result)
        .bind(&now)
        .bind(date)
        .execute(pool)
        .await?;
        Ok(updated.rows_affected() > 0)
    }

    /// Marks the brief failed. The previous `result` is preserved (contract §5.2.2).
    pub async fn fail(pool: &SqlitePool, date: &str, error: &str) -> Result<bool, SqlxError> {
        let now = Utc::now().to_rfc3339();
        let updated = sqlx::query(
            "UPDATE daily_summaries
             SET status = 'failed', error = ?, updated_at = ?
             WHERE date = ?",
        )
        .bind(error)
        .bind(&now)
        .bind(date)
        .execute(pool)
        .await?;
        Ok(updated.rows_affected() > 0)
    }

    /// Marks the brief cancelled. The previous `result` is preserved (contract §5.2.2).
    pub async fn cancel(pool: &SqlitePool, date: &str) -> Result<bool, SqlxError> {
        let now = Utc::now().to_rfc3339();
        let updated = sqlx::query(
            "UPDATE daily_summaries
             SET status = 'cancelled', error = 'Generation was cancelled by user', updated_at = ?
             WHERE date = ?",
        )
        .bind(&now)
        .bind(date)
        .execute(pool)
        .await?;
        Ok(updated.rows_affected() > 0)
    }

    /// Deletes briefs whose `meeting_ids` JSON array contains `meeting_id`
    /// (contract §9 deletion matrix, via `json_each`). Runs on the caller's
    /// transaction so meeting deletion stays atomic.
    pub async fn delete_containing_meeting(
        transaction: &mut SqliteConnection,
        meeting_id: &str,
    ) -> Result<u64, SqlxError> {
        let result = sqlx::query(
            "DELETE FROM daily_summaries
             WHERE EXISTS (
                 SELECT 1 FROM json_each(daily_summaries.meeting_ids) je
                 WHERE je.value = ?1
             )",
        )
        .bind(meeting_id)
        .execute(&mut *transaction)
        .await?;
        Ok(result.rows_affected())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;
    use sqlx::{Connection, SqlitePool};

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("failed to open in-memory sqlite");
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("failed to run migrations");
        pool
    }

    async fn insert_meeting(pool: &SqlitePool, id: &str, title: &str) {
        sqlx::query("INSERT INTO meetings (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
            .bind(id)
            .bind(title)
            .bind(Utc::now().to_rfc3339())
            .bind(Utc::now().to_rfc3339())
            .execute(pool)
            .await
            .expect("failed to insert test meeting");
    }

    #[tokio::test]
    async fn test_daily_brief_lifecycle_preserves_previous_result_on_failure() {
        let pool = test_pool().await;

        assert!(DailyBriefsRepository::get_by_date(&pool, "2026-08-15")
            .await
            .unwrap()
            .is_none());

        let opened = DailyBriefsRepository::open(
            &pool,
            "2026-08-15",
            r#"["meeting-a","meeting-b"]"#,
            Some("standard_meeting"),
        )
        .await
        .unwrap();
        assert!(opened.id.starts_with("daily-summary-"));
        assert_eq!(opened.status, "pending");
        assert_eq!(opened.result, None);

        assert!(DailyBriefsRepository::complete(
            &pool,
            "2026-08-15",
            r##"{"markdown":"# First brief"}"##,
        )
        .await
        .unwrap());
        let completed = DailyBriefsRepository::get_by_date(&pool, "2026-08-15")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(completed.status, "completed");
        assert_eq!(
            completed.result.as_deref(),
            Some(r##"{"markdown":"# First brief"}"##)
        );

        // Regeneration: reopen resets to pending but MUST NOT wipe the result.
        let reopened = DailyBriefsRepository::open(&pool, "2026-08-15", r#"["meeting-a"]"#, None)
            .await
            .unwrap();
        assert_eq!(reopened.status, "pending");
        assert_eq!(
            reopened.result.as_deref(),
            Some(r##"{"markdown":"# First brief"}"##)
        );
        assert_eq!(reopened.id, completed.id, "upsert keeps the same row id");

        // Failure keeps the previous good result.
        assert!(
            DailyBriefsRepository::fail(&pool, "2026-08-15", "provider exploded")
                .await
                .unwrap()
        );
        let failed = DailyBriefsRepository::get_by_date(&pool, "2026-08-15")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(failed.status, "failed");
        assert_eq!(failed.error.as_deref(), Some("provider exploded"));
        assert_eq!(
            failed.result.as_deref(),
            Some(r##"{"markdown":"# First brief"}"##)
        );

        // Cancel also preserves the result.
        DailyBriefsRepository::open(&pool, "2026-08-15", r#"["meeting-a"]"#, None)
            .await
            .unwrap();
        assert!(DailyBriefsRepository::cancel(&pool, "2026-08-15")
            .await
            .unwrap());
        let cancelled = DailyBriefsRepository::get_by_date(&pool, "2026-08-15")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(cancelled.status, "cancelled");
        assert_eq!(
            cancelled.result.as_deref(),
            Some(r##"{"markdown":"# First brief"}"##)
        );
    }

    #[tokio::test]
    async fn test_delete_containing_meeting_via_json_each() {
        let pool = test_pool().await;

        DailyBriefsRepository::open(&pool, "2026-08-15", r#"["meeting-a","meeting-b"]"#, None)
            .await
            .unwrap();
        DailyBriefsRepository::open(&pool, "2026-08-16", r#"["meeting-b"]"#, None)
            .await
            .unwrap();
        DailyBriefsRepository::open(&pool, "2026-08-17", r#"["meeting-c"]"#, None)
            .await
            .unwrap();

        let mut conn = pool.acquire().await.unwrap();
        let mut tx = conn.begin().await.unwrap();
        let deleted = DailyBriefsRepository::delete_containing_meeting(&mut tx, "meeting-a")
            .await
            .unwrap();
        tx.commit().await.unwrap();
        drop(conn);

        assert_eq!(deleted, 1, "only the brief containing meeting-a is deleted");
        assert!(DailyBriefsRepository::get_by_date(&pool, "2026-08-15")
            .await
            .unwrap()
            .is_none());
        assert!(DailyBriefsRepository::get_by_date(&pool, "2026-08-16")
            .await
            .unwrap()
            .is_some());
        assert!(DailyBriefsRepository::get_by_date(&pool, "2026-08-17")
            .await
            .unwrap()
            .is_some());
    }

    #[tokio::test]
    async fn test_daily_brief_never_touches_source_meeting_data() {
        let pool = test_pool().await;
        insert_meeting(&pool, "meeting-a", "Standup").await;

        DailyBriefsRepository::open(&pool, "2026-08-15", r#"["meeting-a"]"#, None)
            .await
            .unwrap();
        DailyBriefsRepository::complete(&pool, "2026-08-15", r##"{"markdown":"# Brief"}"##)
            .await
            .unwrap();
        DailyBriefsRepository::open(&pool, "2026-08-15", r#"["meeting-a"]"#, None)
            .await
            .unwrap();
        DailyBriefsRepository::fail(&pool, "2026-08-15", "boom")
            .await
            .unwrap();

        let meetings: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM meetings")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(meetings.0, 1);
        let transcripts: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM transcripts")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(transcripts.0, 0);
    }
}
