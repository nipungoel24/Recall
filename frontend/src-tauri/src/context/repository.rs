//! SQLite persistence for continuous context memory (binding schema §6):
//! `context_memory_items` rows and the `contexts.memory_markdown` digest.
//!
//! Kept inside the context module so the memory engine stays self-contained
//! and does not fight other agents over `database/repositories/context.rs`.

use crate::context::model::{ContextMemoryItemView, MemoryItem};
use sqlx::SqlitePool;

pub struct ContextMemoryRepository;

impl ContextMemoryRepository {
    pub async fn context_exists(pool: &SqlitePool, context_id: &str) -> Result<bool, sqlx::Error> {
        let exists: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM contexts WHERE id = ?")
            .bind(context_id)
            .fetch_optional(pool)
            .await?;
        Ok(exists.is_some())
    }

    /// Context name and durable-core digest.
    pub async fn get_context_markdown_and_name(
        pool: &SqlitePool,
        context_id: &str,
    ) -> Result<Option<(String, String)>, sqlx::Error> {
        let row: Option<(String, String)> =
            sqlx::query_as("SELECT name, memory_markdown FROM contexts WHERE id = ?")
                .bind(context_id)
                .fetch_optional(pool)
                .await?;
        Ok(row)
    }

    /// All memory items of a context, oldest first.
    pub async fn list_items(
        pool: &SqlitePool,
        context_id: &str,
    ) -> Result<Vec<MemoryItem>, sqlx::Error> {
        sqlx::query_as::<_, MemoryItem>(
            "SELECT * FROM context_memory_items WHERE context_id = ? ORDER BY created_at ASC, id ASC",
        )
        .bind(context_id)
        .fetch_all(pool)
        .await
    }

    /// Newest memory items joined with source meeting titles (§7.1 view).
    pub async fn list_item_views(
        pool: &SqlitePool,
        context_id: &str,
        limit: i64,
    ) -> Result<Vec<ContextMemoryItemView>, sqlx::Error> {
        sqlx::query_as::<_, ContextMemoryItemView>(
            r#"
            SELECT cmi.id, cmi.context_id, cmi.source_meeting_id,
                   m.title AS source_meeting_title,
                   cmi.kind, cmi.content, cmi.status, cmi.created_at, cmi.updated_at
            FROM context_memory_items cmi
            LEFT JOIN meetings m ON m.id = cmi.source_meeting_id
            WHERE cmi.context_id = ?
            ORDER BY cmi.created_at DESC, cmi.id ASC
            LIMIT ?
            "#,
        )
        .bind(context_id)
        .bind(limit)
        .fetch_all(pool)
        .await
    }

    pub async fn insert_item(pool: &SqlitePool, item: &MemoryItem) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO context_memory_items
                (id, context_id, source_meeting_id, kind, content, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&item.id)
        .bind(&item.context_id)
        .bind(&item.source_meeting_id)
        .bind(&item.kind)
        .bind(&item.content)
        .bind(&item.status)
        .bind(&item.created_at)
        .bind(&item.updated_at)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Refreshes an existing item (dedup). Never touches `status`: re-mentioning
    /// an item can never close it.
    pub async fn refresh_item(
        pool: &SqlitePool,
        item_id: &str,
        content: &str,
        updated_at: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE context_memory_items SET content = ?, updated_at = ? WHERE id = ?")
            .bind(content)
            .bind(updated_at)
            .bind(item_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// Applies an evidence-based resolution to an open item.
    pub async fn apply_resolution(
        pool: &SqlitePool,
        item_id: &str,
        status: &str,
        updated_at: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE context_memory_items SET status = ?, updated_at = ? WHERE id = ?")
            .bind(status)
            .bind(updated_at)
            .bind(item_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// Compaction: folds overflow items into the durable-core digest and
    /// removes their rows (single transaction, update-after-success semantics).
    /// The digest keeps per-item provenance; nothing is silently dropped.
    pub async fn fold_and_save_markdown(
        pool: &SqlitePool,
        context_id: &str,
        item_ids_to_fold: &[String],
        new_markdown: &str,
        updated_at: &str,
    ) -> Result<(), sqlx::Error> {
        let mut tx = pool.begin().await?;

        for id in item_ids_to_fold {
            sqlx::query("DELETE FROM context_memory_items WHERE id = ?")
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }

        sqlx::query("UPDATE contexts SET memory_markdown = ?, updated_at = ? WHERE id = ?")
            .bind(new_markdown)
            .bind(updated_at)
            .bind(context_id)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;
        Ok(())
    }
}
