//! Meeting deletion with deliberate derived-data invalidation (contract §9).
//!
//! The binding deletion matrix for "Meeting deleted":
//!
//! 1. Existing cascade: `transcript_chunks`, `summary_processes`, `meeting_notes`,
//!    `transcripts` for the meeting.
//! 2. `context_meetings` links for the meeting (links die; contexts survive —
//!    unrelated contexts are never deleted).
//! 3. `context_memory_items` rows whose `source_meeting_id` is the meeting
//!    (derived data dies with its source; provenance never dangles).
//! 4. `daily_summaries` rows whose `meeting_ids` JSON array contains the meeting
//!    id (matched via `json_each`).
//! 5. The `meetings` row itself.
//!
//! All of this runs in ONE transaction on the caller's connection, mirroring
//! `delete_meeting_with_transaction` (contract §12: the owner splices this into
//! `database/repositories/meeting.rs`). Manual deletes remain the source of truth
//! because FK pragmas are not guaranteed (contract §11).

use sqlx::{Error as SqlxError, SqliteConnection};
use tracing::{error, info};

/// Deletes a meeting plus every derived row, in one transaction.
/// Returns `true` when the meeting existed and was deleted, `false` when it did not.
pub async fn delete_meeting_with_derived_data(
    transaction: &mut SqliteConnection,
    meeting_id: &str,
) -> Result<bool, SqlxError> {
    // Check if meeting exists
    let meeting_exists: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM meetings WHERE id = ?")
        .bind(meeting_id)
        .fetch_optional(&mut *transaction)
        .await?;

    if meeting_exists.is_none() {
        error!("Meeting {} not found for deletion", meeting_id);
        return Ok(false);
    }

    // 1. Context links: meeting deleted → links deleted (contexts untouched).
    sqlx::query("DELETE FROM context_meetings WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut *transaction)
        .await?;

    // 2. Context memory provenance: items derived from this meeting are deleted.
    sqlx::query("DELETE FROM context_memory_items WHERE source_meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut *transaction)
        .await?;

    // 3. Daily summaries whose source set contains this meeting (JSON containment).
    sqlx::query(
        "DELETE FROM daily_summaries
         WHERE EXISTS (
             SELECT 1 FROM json_each(daily_summaries.meeting_ids) je
             WHERE je.value = ?1
         )",
    )
    .bind(meeting_id)
    .execute(&mut *transaction)
    .await?;

    // 4. Existing cascade (mirrors delete_meeting_with_transaction, plus
    //    meeting_notes which today relies solely on the FK pragma).
    sqlx::query("DELETE FROM transcript_chunks WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut *transaction)
        .await?;

    sqlx::query("DELETE FROM summary_processes WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut *transaction)
        .await?;

    sqlx::query("DELETE FROM meeting_notes WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut *transaction)
        .await?;

    sqlx::query("DELETE FROM transcripts WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut *transaction)
        .await?;

    // 5. Finally, the meeting itself.
    let result = sqlx::query("DELETE FROM meetings WHERE id = ?")
        .bind(meeting_id)
        .execute(&mut *transaction)
        .await?;

    info!(
        "Deleted meeting {} and all derived data (context links, memory items, daily summaries)",
        meeting_id
    );
    Ok(result.rows_affected() > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
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
    async fn test_meeting_deletion_removes_links_memory_provenance_and_daily_summaries() {
        let pool = test_pool().await;

        insert_meeting(&pool, "meeting-a", "To delete").await;
        insert_meeting(&pool, "meeting-b", "Unrelated").await;

        // Contexts: C1 links both meetings; C2 links only A.
        for (ctx, desc) in [("context-1", "c1"), ("context-2", "c2")] {
            sqlx::query(
                "INSERT INTO contexts (id, name, description, memory_markdown, created_at, updated_at)
                 VALUES (?, ?, ?, '', ?, ?)",
            )
            .bind(ctx)
            .bind(desc)
            .bind(Utc::now().to_rfc3339())
            .bind(Utc::now().to_rfc3339())
            .bind(Utc::now().to_rfc3339())
            .execute(&pool)
            .await
            .unwrap();
        }
        for (ctx, meeting) in [
            ("context-1", "meeting-a"),
            ("context-1", "meeting-b"),
            ("context-2", "meeting-a"),
        ] {
            sqlx::query(
                "INSERT INTO context_meetings (context_id, meeting_id, added_at) VALUES (?, ?, ?)",
            )
            .bind(ctx)
            .bind(meeting)
            .bind(Utc::now().to_rfc3339())
            .execute(&pool)
            .await
            .unwrap();
        }

        // Memory items: derived from A, derived from B, and one manual (no provenance).
        for (id, src) in [
            ("cmi-a", Some("meeting-a")),
            ("cmi-b", Some("meeting-b")),
            ("cmi-manual", None),
        ] {
            sqlx::query(
                "INSERT INTO context_memory_items
                 (id, context_id, source_meeting_id, kind, content, status, created_at, updated_at)
                 VALUES (?, 'context-1', ?, 'fact', 'content', NULL, ?, ?)",
            )
            .bind(id)
            .bind(src)
            .bind(Utc::now().to_rfc3339())
            .bind(Utc::now().to_rfc3339())
            .execute(&pool)
            .await
            .unwrap();
        }

        // Meeting-scoped rows for A that must cascade.
        sqlx::query(
            "INSERT INTO transcripts (id, meeting_id, transcript, timestamp) VALUES ('t-a', 'meeting-a', 'x', '2026-08-15T09:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO summary_processes (meeting_id, status, created_at, updated_at, chunk_count, processing_time)
             VALUES ('meeting-a', 'completed', '2026-08-15T09:00:00Z', '2026-08-15T09:00:00Z', 1, 1.0)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO meeting_notes (meeting_id, notes_markdown, created_at, updated_at)
             VALUES ('meeting-a', '# n', '2026-08-15T09:00:00Z', '2026-08-15T09:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO transcript_chunks (meeting_id, transcript_text, model, model_name, created_at)
             VALUES ('meeting-a', 'x', 'm', 'm', '2026-08-15T09:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        // Daily summaries: one containing A+B, one containing only B.
        for (id, date, meeting_ids) in [
            ("daily-1", "2026-08-15", r#"["meeting-a","meeting-b"]"#),
            ("daily-2", "2026-08-16", r#"["meeting-b"]"#),
        ] {
            sqlx::query(
                "INSERT INTO daily_summaries (id, date, meeting_ids, template_id, result, status, error, created_at, updated_at)
                 VALUES (?, ?, ?, NULL, NULL, 'pending', NULL, ?, ?)",
            )
            .bind(id)
            .bind(date)
            .bind(meeting_ids)
            .bind(Utc::now().to_rfc3339())
            .bind(Utc::now().to_rfc3339())
            .execute(&pool)
            .await
            .unwrap();
        }

        // Delete meeting A.
        let mut conn = pool.acquire().await.unwrap();
        let mut tx = conn.begin().await.unwrap();
        let deleted = delete_meeting_with_derived_data(&mut tx, "meeting-a")
            .await
            .unwrap();
        tx.commit().await.unwrap();
        drop(conn);
        assert!(deleted);

        // Meeting A gone; meeting B intact.
        let a: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM meetings WHERE id = 'meeting-a'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(a.0, 0);
        let b: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM meetings WHERE id = 'meeting-b'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(b.0, 1);

        // Context links for A gone (including context-2's); B's link kept. Contexts survive.
        let links: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM context_meetings WHERE meeting_id = 'meeting-a'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(links.0, 0);
        let b_links: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM context_meetings WHERE meeting_id = 'meeting-b'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(b_links.0, 1);
        let contexts: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM contexts")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(contexts.0, 2);

        // Provenance: A-derived item deleted; B-derived and manual items kept.
        let items: Vec<(String,)> =
            sqlx::query_as("SELECT id FROM context_memory_items ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        let ids: Vec<&str> = items.iter().map(|(id,)| id.as_str()).collect();
        assert_eq!(ids, vec!["cmi-b", "cmi-manual"]);

        // Daily summary containing A deleted; the B-only one kept.
        let daily: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM daily_summaries")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(daily.0, 1);
        let remaining: (String,) = sqlx::query_as("SELECT id FROM daily_summaries")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(remaining.0, "daily-2");

        // Meeting-scoped rows cascade.
        for table in [
            "transcripts",
            "summary_processes",
            "meeting_notes",
            "transcript_chunks",
        ] {
            let count: (i64,) = sqlx::query_as(&format!(
                "SELECT COUNT(*) FROM {table} WHERE meeting_id = 'meeting-a'"
            ))
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(count.0, 0, "{table} rows for meeting-a should be gone");
        }
    }

    #[tokio::test]
    async fn test_meeting_deletion_nonexistent_meeting_returns_false() {
        let pool = test_pool().await;
        let mut conn = pool.acquire().await.unwrap();
        let mut tx = conn.begin().await.unwrap();
        let deleted = delete_meeting_with_derived_data(&mut tx, "meeting-nope")
            .await
            .unwrap();
        tx.commit().await.unwrap();
        assert!(!deleted);
    }
}
