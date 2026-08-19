use crate::database::models::DailySummaryProcess;
use chrono::Utc;
use serde_json::Value;
use sqlx::SqlitePool;
use tracing::info as log_info;
use uuid::Uuid;

/// Repository for Daily Brief records.
///
/// Daily briefs are DERIVED artifacts stored in their own table
/// (`daily_summaries`). None of these methods touch the `meetings`,
/// `transcripts`, or `summary_processes` tables, so regenerating a daily
/// brief can never modify source meeting data.
pub struct DailySummariesRepository;

impl DailySummariesRepository {
    /// Retrieves the daily summary process state for a given calendar day.
    pub async fn get_daily_summary(
        pool: &SqlitePool,
        date: &str,
    ) -> Result<Option<DailySummaryProcess>, sqlx::Error> {
        sqlx::query_as::<_, DailySummaryProcess>("SELECT * FROM daily_summaries WHERE date = ?")
            .bind(date)
            .fetch_optional(pool)
            .await
    }

    /// Creates (or resets on regeneration) the daily summary process row.
    ///
    /// On regeneration the previous result is moved to `result_backup` so a
    /// failure can restore it — mirroring `summary_processes` semantics.
    pub async fn create_or_reset_daily(
        pool: &SqlitePool,
        date: &str,
        meeting_ids: &str,
        source_fingerprint: &str,
    ) -> Result<(), sqlx::Error> {
        log_info!(
            "Creating or resetting daily summary process for date: {}",
            date
        );
        let id = format!("daily-summary-{}", Uuid::new_v4());
        let now = Utc::now();
        sqlx::query(
            r#"
            INSERT INTO daily_summaries (id, date, status, created_at, updated_at, start_time, result, error, meeting_ids, source_fingerprint)
            VALUES (?, ?, 'PENDING', ?, ?, ?, NULL, NULL, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
                status = 'PENDING',
                updated_at = excluded.updated_at,
                start_time = excluded.start_time,
                result_backup = daily_summaries.result,
                result_backup_timestamp = excluded.updated_at,
                error = NULL,
                meeting_ids = excluded.meeting_ids,
                source_fingerprint = excluded.source_fingerprint
            "#
        )
        .bind(&id)
        .bind(date)
        .bind(now)
        .bind(now)
        .bind(now)
        .bind(meeting_ids)
        .bind(source_fingerprint)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn update_daily_completed(
        pool: &SqlitePool,
        date: &str,
        result: Value,
        chunk_count: i64,
        processing_time: f64,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now();
        let result_str = serde_json::to_string(&result)
            .map_err(|e| sqlx::Error::Protocol(format!("Failed to serialize result: {}", e)))?;

        sqlx::query(
            r#"
            UPDATE daily_summaries
            SET status = 'completed', result = ?, updated_at = ?, end_time = ?, chunk_count = ?, processing_time = ?, error = NULL, result_backup = NULL, result_backup_timestamp = NULL
            WHERE date = ?
            "#
        )
        .bind(result_str)
        .bind(now)
        .bind(now)
        .bind(chunk_count)
        .bind(processing_time)
        .bind(date)
        .execute(pool)
        .await?;
        log_info!("Daily summary completed for date: {}", date);
        Ok(())
    }

    pub async fn update_daily_failed(
        pool: &SqlitePool,
        date: &str,
        error_msg: &str,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now();

        // Restore from backup if it exists, otherwise keep current result
        sqlx::query(
            r#"
            UPDATE daily_summaries
            SET
                status = 'failed',
                error = ?,
                updated_at = ?,
                end_time = ?,
                result = COALESCE(result_backup, result),
                result_backup = NULL,
                result_backup_timestamp = NULL
            WHERE date = ?
            "#,
        )
        .bind(error_msg)
        .bind(now)
        .bind(now)
        .bind(date)
        .execute(pool)
        .await?;
        log_info!(
            "Daily summary generation failed and backup restored for date: {}",
            date
        );
        Ok(())
    }

    pub async fn update_daily_cancelled(pool: &SqlitePool, date: &str) -> Result<(), sqlx::Error> {
        let now = Utc::now();

        // Restore from backup if it exists, otherwise keep current result
        sqlx::query(
            r#"
            UPDATE daily_summaries
            SET
                status = 'cancelled',
                updated_at = ?,
                end_time = ?,
                error = 'Generation was cancelled by user',
                result = COALESCE(result_backup, result),
                result_backup = NULL,
                result_backup_timestamp = NULL
            WHERE date = ?
            "#,
        )
        .bind(now)
        .bind(now)
        .bind(date)
        .execute(pool)
        .await?;
        log_info!("Daily summary marked cancelled for date: {}", date);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

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

    #[tokio::test]
    async fn test_daily_summary_lifecycle() {
        let pool = test_pool().await;

        assert!(
            DailySummariesRepository::get_daily_summary(&pool, "2026-08-15")
                .await
                .unwrap()
                .is_none()
        );

        DailySummariesRepository::create_or_reset_daily(
            &pool,
            "2026-08-15",
            r#"["meeting-a","meeting-b"]"#,
            "fingerprint-1",
        )
        .await
        .unwrap();

        let pending = DailySummariesRepository::get_daily_summary(&pool, "2026-08-15")
            .await
            .unwrap()
            .expect("row should exist");
        assert_eq!(pending.status, "PENDING");
        assert_eq!(pending.result, None);
        assert_eq!(pending.meeting_ids.as_str(), r#"["meeting-a","meeting-b"]"#);
        assert_eq!(pending.source_fingerprint.as_deref(), Some("fingerprint-1"));

        let result_json = serde_json::json!({
            "markdown": "# Daily Brief\n\n**Executive Overview**\n\nA busy day.",
            "date": "2026-08-15",
            "source_meetings": [
                { "id": "meeting-a", "title": "Standup", "started_at": "2026-08-15T09:00:00Z" }
            ]
        });

        DailySummariesRepository::update_daily_completed(
            &pool,
            "2026-08-15",
            result_json.clone(),
            2,
            12.5,
        )
        .await
        .unwrap();

        let completed = DailySummariesRepository::get_daily_summary(&pool, "2026-08-15")
            .await
            .unwrap()
            .expect("row should exist");
        assert_eq!(completed.status, "completed");
        assert_eq!(completed.chunk_count, 2);
        assert_eq!(completed.processing_time, 12.5);
        assert_eq!(completed.error, None);
        let parsed: Value = serde_json::from_str(completed.result.as_deref().unwrap()).unwrap();
        assert_eq!(parsed, result_json);
    }

    #[tokio::test]
    async fn test_regeneration_backs_up_and_restores_previous_result() {
        let pool = test_pool().await;

        DailySummariesRepository::create_or_reset_daily(&pool, "2026-08-15", "[]", "fp-1")
            .await
            .unwrap();
        let first = serde_json::json!({ "markdown": "# Original brief" });
        DailySummariesRepository::update_daily_completed(
            &pool,
            "2026-08-15",
            first.clone(),
            1,
            1.0,
        )
        .await
        .unwrap();

        // Regeneration backs up the previous result.
        DailySummariesRepository::create_or_reset_daily(&pool, "2026-08-15", "[]", "fp-2")
            .await
            .unwrap();
        let pending = DailySummariesRepository::get_daily_summary(&pool, "2026-08-15")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(pending.status, "PENDING");
        assert!(pending.result_backup.is_some());

        // Failure restores the backup.
        DailySummariesRepository::update_daily_failed(&pool, "2026-08-15", "provider exploded")
            .await
            .unwrap();
        let failed = DailySummariesRepository::get_daily_summary(&pool, "2026-08-15")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(failed.status, "failed");
        assert_eq!(failed.error.as_deref(), Some("provider exploded"));
        let restored: Value = serde_json::from_str(failed.result.as_deref().unwrap()).unwrap();
        assert_eq!(restored, first);
        assert_eq!(failed.result_backup, None);
    }

    #[tokio::test]
    async fn test_daily_regeneration_does_not_touch_source_meeting_data() {
        let pool = test_pool().await;

        // Seed a source meeting and its summary_processes row.
        sqlx::query(
            "INSERT INTO meetings (id, title, created_at, updated_at) VALUES ('meeting-src', 'Source Meeting', '2026-08-15T09:00:00Z', '2026-08-15T09:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO summary_processes (meeting_id, status, created_at, updated_at, start_time, result, error, chunk_count, processing_time) VALUES ('meeting-src', 'completed', '2026-08-15T09:05:00Z', '2026-08-15T09:05:00Z', '2026-08-15T09:05:00Z', '{\"markdown\":\"# Source summary\"}', NULL, 1, 2.0)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let snapshot_before: (String, String) = sqlx::query_as(
            "SELECT status, result FROM summary_processes WHERE meeting_id = 'meeting-src'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        // Regenerate a daily brief repeatedly; source rows must be untouched.
        DailySummariesRepository::create_or_reset_daily(
            &pool,
            "2026-08-15",
            "[\"meeting-src\"]",
            "fp",
        )
        .await
        .unwrap();
        DailySummariesRepository::update_daily_completed(
            &pool,
            "2026-08-15",
            serde_json::json!({ "markdown": "# Daily brief" }),
            1,
            1.0,
        )
        .await
        .unwrap();
        DailySummariesRepository::create_or_reset_daily(
            &pool,
            "2026-08-15",
            "[\"meeting-src\"]",
            "fp2",
        )
        .await
        .unwrap();
        DailySummariesRepository::update_daily_failed(&pool, "2026-08-15", "boom")
            .await
            .unwrap();

        let snapshot_after: (String, String) = sqlx::query_as(
            "SELECT status, result FROM summary_processes WHERE meeting_id = 'meeting-src'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(snapshot_before, snapshot_after);

        let meetings_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM meetings")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(meetings_count.0, 1);
    }

    #[tokio::test]
    async fn test_daily_cancelled_restores_backup() {
        let pool = test_pool().await;

        DailySummariesRepository::create_or_reset_daily(&pool, "2026-08-15", "[]", "fp")
            .await
            .unwrap();
        DailySummariesRepository::update_daily_completed(
            &pool,
            "2026-08-15",
            serde_json::json!({ "markdown": "# Before cancel" }),
            1,
            1.0,
        )
        .await
        .unwrap();
        DailySummariesRepository::create_or_reset_daily(&pool, "2026-08-15", "[]", "fp2")
            .await
            .unwrap();
        DailySummariesRepository::update_daily_cancelled(&pool, "2026-08-15")
            .await
            .unwrap();

        let row = DailySummariesRepository::get_daily_summary(&pool, "2026-08-15")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.status, "cancelled");
        let restored: Value = serde_json::from_str(row.result.as_deref().unwrap()).unwrap();
        assert_eq!(restored["markdown"], "# Before cancel");
    }
}
