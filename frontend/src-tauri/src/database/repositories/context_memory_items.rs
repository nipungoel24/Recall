//! Persistence for context memory items (binding schema, contract §6).
//!
//! One `context_memory_items` row holds a single derived fact/decision/action/
//! question/note for a context thread. Provenance is explicit: `source_meeting_id`
//! is `Some(<meeting>)` when the item was derived from a meeting, `None` when it
//! was entered manually. Transcript text is never duplicated here — `content` is
//! derived memory only (contract §6).
//!
//! Deletion semantics (contract §6/§9):
//! - Meeting deleted → items with `source_meeting_id = <meeting>` are deleted
//!   (derived data dies with its source; provenance never dangles). See
//!   [`delete_for_source_meeting`].
//! - Context thread deleted → all items for the context are deleted. See
//!   [`delete_all_for_context`].
//! - Meeting merely unlinked from a context → items are kept (provenance intact).

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{Connection, Error as SqlxError, FromRow, SqliteConnection, SqlitePool};
use tracing::info;
use uuid::Uuid;

/// Row shape for the binding `context_memory_items` table (contract §6).
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct ContextMemoryItemRow {
    pub id: String,
    pub context_id: String,
    pub source_meeting_id: Option<String>,
    pub kind: String,
    pub content: String,
    pub status: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Item plus its resolved source meeting title (`None` when provenance is absent
/// or the meeting row is missing). Mirrors `ContextMemoryItemView` (contract §7.1).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextMemoryItemWithSource {
    #[serde(flatten)]
    pub item: ContextMemoryItemRow,
    pub source_meeting_title: Option<String>,
}

pub struct ContextMemoryItemsRepository;

impl ContextMemoryItemsRepository {
    /// Inserts a new memory item. `kind`/`content` are persisted verbatim;
    /// validation is the command layer's job (contract §7.2).
    ///
    /// Errors when the context does not exist, or when a non-empty
    /// `source_meeting_id` does not reference an existing meeting (deliberate
    /// provenance integrity — no dangling provenance references).
    pub async fn add_item(
        pool: &SqlitePool,
        context_id: &str,
        kind: &str,
        content: &str,
        source_meeting_id: Option<&str>,
        status: Option<&str>,
    ) -> Result<ContextMemoryItemRow, SqlxError> {
        let mut conn = pool.acquire().await?;
        let mut transaction = conn.begin().await?;

        let context_exists: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM contexts WHERE id = ?")
            .bind(context_id)
            .fetch_optional(&mut *transaction)
            .await?;
        if context_exists.is_none() {
            transaction.rollback().await?;
            return Err(SqlxError::Protocol(format!(
                "context {} does not exist",
                context_id
            )));
        }

        if let Some(meeting_id) = source_meeting_id {
            let meeting_exists: Option<(i64,)> =
                sqlx::query_as("SELECT 1 FROM meetings WHERE id = ?")
                    .bind(meeting_id)
                    .fetch_optional(&mut *transaction)
                    .await?;
            if meeting_exists.is_none() {
                transaction.rollback().await?;
                return Err(SqlxError::Protocol(format!(
                    "source meeting {} does not exist",
                    meeting_id
                )));
            }
        }

        let id = format!("cmi-{}", Uuid::new_v4());
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO context_memory_items
             (id, context_id, source_meeting_id, kind, content, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(context_id)
        .bind(source_meeting_id)
        .bind(kind)
        .bind(content)
        .bind(status)
        .bind(&now)
        .bind(&now)
        .execute(&mut *transaction)
        .await?;

        transaction.commit().await?;

        info!(
            "Created context memory item {} for context {}",
            id, context_id
        );
        Ok(ContextMemoryItemRow {
            id,
            context_id: context_id.to_string(),
            source_meeting_id: source_meeting_id.map(str::to_string),
            kind: kind.to_string(),
            content: content.to_string(),
            status: status.map(str::to_string),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub async fn get_item(
        pool: &SqlitePool,
        item_id: &str,
    ) -> Result<Option<ContextMemoryItemRow>, SqlxError> {
        sqlx::query_as::<_, ContextMemoryItemRow>("SELECT * FROM context_memory_items WHERE id = ?")
            .bind(item_id)
            .fetch_optional(pool)
            .await
    }

    /// Lists a context's memory items, newest first (contract §7.2 ordering).
    pub async fn list_for_context(
        pool: &SqlitePool,
        context_id: &str,
    ) -> Result<Vec<ContextMemoryItemRow>, SqlxError> {
        sqlx::query_as::<_, ContextMemoryItemRow>(
            "SELECT * FROM context_memory_items WHERE context_id = ?
             ORDER BY created_at DESC, id DESC",
        )
        .bind(context_id)
        .fetch_all(pool)
        .await
    }

    /// Like [`list_for_context`] but resolves each item's source meeting title
    /// via a LEFT JOIN (provenance display, contract §7.1 `ContextMemoryItemView`).
    pub async fn list_for_context_with_source(
        pool: &SqlitePool,
        context_id: &str,
    ) -> Result<Vec<ContextMemoryItemWithSource>, SqlxError> {
        type RowTuple = (
            String,
            String,
            Option<String>,
            String,
            String,
            Option<String>,
            String,
            String,
            Option<String>,
        );
        let rows: Vec<RowTuple> = sqlx::query_as(
            "SELECT i.id, i.context_id, i.source_meeting_id, i.kind, i.content, i.status,
                    i.created_at, i.updated_at, m.title
             FROM context_memory_items i
             LEFT JOIN meetings m ON m.id = i.source_meeting_id
             WHERE i.context_id = ?
             ORDER BY i.created_at DESC, i.id DESC",
        )
        .bind(context_id)
        .fetch_all(pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(
                |(
                    id,
                    context_id,
                    source_meeting_id,
                    kind,
                    content,
                    status,
                    created_at,
                    updated_at,
                    source_meeting_title,
                )| {
                    ContextMemoryItemWithSource {
                        item: ContextMemoryItemRow {
                            id,
                            context_id,
                            source_meeting_id,
                            kind,
                            content,
                            status,
                            created_at,
                            updated_at,
                        },
                        source_meeting_title,
                    }
                },
            )
            .collect())
    }

    /// Applies the `Some` fields; `None` fields are left untouched (contract §7.2:
    /// "on update only if provided"). Bumps `updated_at`. Returns the updated row,
    /// or `None` when the item does not exist.
    pub async fn update_item(
        pool: &SqlitePool,
        item_id: &str,
        kind: Option<&str>,
        content: Option<&str>,
        status: Option<&str>,
    ) -> Result<Option<ContextMemoryItemRow>, SqlxError> {
        let mut conn = pool.acquire().await?;
        let mut transaction = conn.begin().await?;

        let existing: Option<ContextMemoryItemRow> = sqlx::query_as::<_, ContextMemoryItemRow>(
            "SELECT * FROM context_memory_items WHERE id = ?",
        )
        .bind(item_id)
        .fetch_optional(&mut *transaction)
        .await?;

        let Some(existing) = existing else {
            transaction.rollback().await?;
            return Ok(None);
        };

        let kind = kind.unwrap_or(&existing.kind);
        let content = content.unwrap_or(&existing.content);
        let status = status.or(existing.status.as_deref());
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            "UPDATE context_memory_items
             SET kind = ?, content = ?, status = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(kind)
        .bind(content)
        .bind(status)
        .bind(&now)
        .bind(item_id)
        .execute(&mut *transaction)
        .await?;

        transaction.commit().await?;
        drop(conn);

        let updated = sqlx::query_as::<_, ContextMemoryItemRow>(
            "SELECT * FROM context_memory_items WHERE id = ?",
        )
        .bind(item_id)
        .fetch_one(pool)
        .await?;
        Ok(Some(updated))
    }

    pub async fn delete_item(pool: &SqlitePool, item_id: &str) -> Result<bool, SqlxError> {
        let result = sqlx::query("DELETE FROM context_memory_items WHERE id = ?")
            .bind(item_id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    /// Deletes every memory item of a context. Used by the context-thread delete
    /// transaction (contract §6: thread deleted → links and memory items deleted;
    /// source meetings never touched). Runs on the caller's transaction.
    pub async fn delete_all_for_context(
        transaction: &mut SqliteConnection,
        context_id: &str,
    ) -> Result<u64, SqlxError> {
        let result = sqlx::query("DELETE FROM context_memory_items WHERE context_id = ?")
            .bind(context_id)
            .execute(&mut *transaction)
            .await?;
        Ok(result.rows_affected())
    }

    /// Deletes every memory item derived from a meeting. Used by the meeting-delete
    /// transaction (contract §9: derived data dies with its source; provenance never
    /// dangles). Manually-authored items (NULL provenance) are kept.
    pub async fn delete_for_source_meeting(
        transaction: &mut SqliteConnection,
        meeting_id: &str,
    ) -> Result<u64, SqlxError> {
        let result = sqlx::query("DELETE FROM context_memory_items WHERE source_meeting_id = ?")
            .bind(meeting_id)
            .execute(&mut *transaction)
            .await?;
        Ok(result.rows_affected())
    }

    pub async fn count_for_context(pool: &SqlitePool, context_id: &str) -> Result<i64, SqlxError> {
        let (count,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM context_memory_items WHERE context_id = ?")
                .bind(context_id)
                .fetch_one(pool)
                .await?;
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::repositories::context::ContextsRepository;
    use sqlx::sqlite::SqlitePoolOptions;
    use sqlx::SqlitePool;

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

    async fn insert_meeting(pool: &SqlitePool, id: &str, title: &str, created_at: &str) {
        sqlx::query("INSERT INTO meetings (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
            .bind(id)
            .bind(title)
            .bind(created_at)
            .bind(created_at)
            .execute(pool)
            .await
            .expect("failed to insert test meeting");
    }

    #[tokio::test]
    async fn test_context_crud_persistence() {
        let pool = test_pool().await;

        let created =
            ContextsRepository::create_context(&pool, "Project Alpha", Some("alpha work"))
                .await
                .expect("create_context failed");
        assert!(created.id.starts_with("context-"));
        assert_eq!(created.name, "Project Alpha");

        let fetched = ContextsRepository::get_context(&pool, &created.id)
            .await
            .expect("get_context failed")
            .expect("context should exist");
        assert_eq!(fetched.name, "Project Alpha");
        assert_eq!(fetched.description.as_deref(), Some("alpha work"));

        let updated = ContextsRepository::update_context(
            &pool,
            &created.id,
            "Project Alpha 2",
            Some("renamed"),
        )
        .await
        .expect("update_context failed")
        .expect("context should exist after update");
        assert_eq!(updated.name, "Project Alpha 2");
        assert_eq!(updated.description.as_deref(), Some("renamed"));

        let listed = ContextsRepository::list_contexts(&pool)
            .await
            .expect("list_contexts failed");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].meeting_count, 0);

        assert!(ContextsRepository::context_exists(&pool, &created.id)
            .await
            .expect("context_exists failed"));
    }

    #[tokio::test]
    async fn test_meeting_context_linking_bidirectional() {
        let pool = test_pool().await;
        insert_meeting(&pool, "meeting-a", "A", "2026-08-15T09:00:00Z").await;
        insert_meeting(&pool, "meeting-b", "B", "2026-08-15T10:00:00Z").await;

        let ctx1 = ContextsRepository::create_context(&pool, "C1", Some("c1"))
            .await
            .unwrap();
        let ctx2 = ContextsRepository::create_context(&pool, "C2", Some("c2"))
            .await
            .unwrap();

        // Meeting A belongs to two contexts; C1 contains both meetings.
        assert!(
            ContextsRepository::add_meeting_to_context(&pool, &ctx1.id, "meeting-a")
                .await
                .unwrap()
        );
        assert!(
            ContextsRepository::add_meeting_to_context(&pool, &ctx1.id, "meeting-b")
                .await
                .unwrap()
        );
        assert!(
            ContextsRepository::add_meeting_to_context(&pool, &ctx2.id, "meeting-a")
                .await
                .unwrap()
        );

        let meetings_c1 = ContextsRepository::list_meetings_for_context(&pool, &ctx1.id)
            .await
            .unwrap();
        let ids_c1: Vec<&str> = meetings_c1.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids_c1, vec!["meeting-a", "meeting-b"]);

        // Reverse direction (contexts for a meeting) via the link table.
        let mut ctx_ids: Vec<String> =
            sqlx::query_scalar("SELECT context_id FROM context_meetings WHERE meeting_id = ?")
                .bind("meeting-a")
                .fetch_all(&pool)
                .await
                .unwrap();
        ctx_ids.sort();
        let mut expected = vec![ctx1.id.clone(), ctx2.id.clone()];
        expected.sort();
        assert_eq!(ctx_ids, expected);
    }

    #[tokio::test]
    async fn test_duplicate_link_prevention() {
        let pool = test_pool().await;
        insert_meeting(&pool, "meeting-a", "A", "2026-08-15T09:00:00Z").await;
        let ctx = ContextsRepository::create_context(&pool, "C", Some("c"))
            .await
            .unwrap();

        assert!(
            ContextsRepository::add_meeting_to_context(&pool, &ctx.id, "meeting-a")
                .await
                .unwrap()
        );
        // Second link is a no-op returning false (composite PK + INSERT OR IGNORE).
        assert!(
            !ContextsRepository::add_meeting_to_context(&pool, &ctx.id, "meeting-a")
                .await
                .unwrap()
        );

        let count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM context_meetings WHERE context_id = ?")
                .bind(&ctx.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count.0, 1);

        // Unlink removes the single row.
        assert!(
            ContextsRepository::remove_meeting_from_context(&pool, &ctx.id, "meeting-a")
                .await
                .unwrap()
        );
        assert!(
            !ContextsRepository::remove_meeting_from_context(&pool, &ctx.id, "meeting-a")
                .await
                .unwrap()
        );
        let count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM context_meetings WHERE context_id = ?")
                .bind(&ctx.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count.0, 0);
    }

    #[tokio::test]
    async fn test_memory_item_crud_and_provenance() {
        let pool = test_pool().await;
        insert_meeting(&pool, "meeting-a", "Standup", "2026-08-15T09:00:00Z").await;
        insert_meeting(&pool, "meeting-b", "Retro", "2026-08-15T10:00:00Z").await;
        let ctx = ContextsRepository::create_context(&pool, "C", Some("c"))
            .await
            .unwrap();

        let derived = ContextMemoryItemsRepository::add_item(
            &pool,
            &ctx.id,
            "decision",
            "Use Rust for the persistence layer",
            Some("meeting-a"),
            Some("done"),
        )
        .await
        .unwrap();
        assert!(derived.id.starts_with("cmi-"));
        assert_eq!(derived.source_meeting_id.as_deref(), Some("meeting-a"));
        assert_eq!(derived.kind, "decision");

        let manual = ContextMemoryItemsRepository::add_item(
            &pool,
            &ctx.id,
            "note",
            "Manual note without provenance",
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(manual.source_meeting_id, None);

        // Provenance preserved on read; source title resolved via LEFT JOIN.
        let detailed = ContextMemoryItemsRepository::list_for_context_with_source(&pool, &ctx.id)
            .await
            .unwrap();
        assert_eq!(detailed.len(), 2);
        // Newest first: manual was added last.
        assert_eq!(detailed[0].item.id, manual.id);
        assert_eq!(detailed[0].source_meeting_title, None);
        assert_eq!(detailed[1].item.id, derived.id);
        assert_eq!(detailed[1].source_meeting_title.as_deref(), Some("Standup"));

        // Update: change kind/content, keep status.
        let updated = ContextMemoryItemsRepository::update_item(
            &pool,
            &derived.id,
            Some("action"),
            Some("Implement repositories"),
            None,
        )
        .await
        .unwrap()
        .expect("item should exist");
        assert_eq!(updated.kind, "action");
        assert_eq!(updated.content, "Implement repositories");
        assert_eq!(updated.status.as_deref(), Some("done"));

        // Update with a non-existent id returns None.
        assert!(ContextMemoryItemsRepository::update_item(
            &pool,
            "cmi-nope",
            Some("fact"),
            Some("x"),
            None,
        )
        .await
        .unwrap()
        .is_none());

        // Delete.
        assert!(
            ContextMemoryItemsRepository::delete_item(&pool, &derived.id)
                .await
                .unwrap()
        );
        assert!(ContextMemoryItemsRepository::get_item(&pool, &derived.id)
            .await
            .unwrap()
            .is_none());
        assert_eq!(
            ContextMemoryItemsRepository::count_for_context(&pool, &ctx.id)
                .await
                .unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn test_add_item_rejects_unknown_context_and_unknown_source_meeting() {
        let pool = test_pool().await;
        insert_meeting(&pool, "meeting-a", "A", "2026-08-15T09:00:00Z").await;
        let ctx = ContextsRepository::create_context(&pool, "C", Some("c"))
            .await
            .unwrap();

        let err = ContextMemoryItemsRepository::add_item(
            &pool,
            "context-nope",
            "note",
            "content",
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.to_string().contains("does not exist"), "{err}");

        let err = ContextMemoryItemsRepository::add_item(
            &pool,
            &ctx.id,
            "note",
            "content",
            Some("meeting-nope"),
            None,
        )
        .await
        .unwrap_err();
        assert!(err.to_string().contains("does not exist"), "{err}");
    }

    #[tokio::test]
    async fn test_delete_all_for_context_and_meeting_survival() {
        let pool = test_pool().await;
        insert_meeting(&pool, "meeting-a", "A", "2026-08-15T09:00:00Z").await;
        let ctx = ContextsRepository::create_context(&pool, "C", Some("c"))
            .await
            .unwrap();

        ContextMemoryItemsRepository::add_item(
            &pool,
            &ctx.id,
            "fact",
            "derived",
            Some("meeting-a"),
            None,
        )
        .await
        .unwrap();

        // Context-thread deletion semantics (contract §6): delete memory items and
        // links in one transaction, then the thread row. Meetings must survive.
        let mut conn = pool.acquire().await.unwrap();
        let mut tx = conn.begin().await.unwrap();
        let deleted = ContextMemoryItemsRepository::delete_all_for_context(&mut tx, &ctx.id)
            .await
            .unwrap();
        assert_eq!(deleted, 1);
        sqlx::query("DELETE FROM context_meetings WHERE context_id = ?")
            .bind(&ctx.id)
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query("DELETE FROM contexts WHERE id = ?")
            .bind(&ctx.id)
            .execute(&mut *tx)
            .await
            .unwrap();
        tx.commit().await.unwrap();
        drop(conn);

        assert_eq!(
            ContextMemoryItemsRepository::count_for_context(&pool, &ctx.id)
                .await
                .unwrap(),
            0
        );
        assert!(ContextsRepository::get_context(&pool, &ctx.id)
            .await
            .unwrap()
            .is_none());
        let meetings: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM meetings")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(meetings.0, 1);
    }
}
