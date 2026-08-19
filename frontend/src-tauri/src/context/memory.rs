//! Read side of continuous meeting context (contract §8): compact context
//! memory for the summary pass of the next meeting.
//!
//! The SummaryService accepts a pre-rendered compact string — it is never
//! coupled to frontend structures. Only the compact memory block is sent,
//! never full historical transcripts.

use crate::context::model::{
    CompactContextMemory, ContextMemoryItemView, MemoryBudget, DEFAULT_CONTEXT_BUDGET_TOKENS,
    DEFAULT_MAX_MEMORY_ITEMS, HARD_MAX_MEMORY_ITEMS, MIN_CONTEXT_BUDGET_TOKENS,
};
use crate::context::prompts::build_context_memory_block;
use crate::context::render::render_inner_content;
use crate::context::repository::ContextMemoryRepository;
use log::{info, warn};
use sqlx::SqlitePool;

/// Loads the compact context memory for a context thread (§7.2):
/// name, durable-core `memory_markdown`, and the newest memory items
/// (default 30, hard cap 100).
pub async fn get_compact_context_memory(
    pool: &SqlitePool,
    context_id: &str,
    max_items: i64,
) -> Result<Option<CompactContextMemory>, String> {
    if context_id.trim().is_empty() {
        return Err("compact context memory: empty context_id".to_string());
    }
    let max_items = max_items.clamp(1, HARD_MAX_MEMORY_ITEMS);

    let Some((name, memory_markdown)) =
        ContextMemoryRepository::get_context_markdown_and_name(pool, context_id)
            .await
            .map_err(|e| format!("compact context memory: failed to load context: {e}"))?
    else {
        return Ok(None);
    };

    let items: Vec<ContextMemoryItemView> =
        ContextMemoryRepository::list_item_views(pool, context_id, max_items)
            .await
            .map_err(|e| format!("compact context memory: failed to load items: {e}"))?;

    Ok(Some(CompactContextMemory {
        context_id: context_id.to_string(),
        context_name: name,
        memory_markdown,
        items,
    }))
}

/// Renders the compact context memory into a bounded markdown block
/// (contract §8.1): context name + durable-core markdown + up to `max_items`
/// item lines, clearly delimited and marked as data. Returns `None` when the
/// block would be empty.
pub fn render_context_memory(
    compact: &CompactContextMemory,
    budget: MemoryBudget,
) -> Option<String> {
    let result = render_inner_content(
        Some(compact.memory_markdown.as_str()),
        &compact.items,
        &budget,
    );
    if result.markdown.trim().is_empty() {
        return None;
    }
    info!(
        "Rendered compact context memory for '{}': {} items ({} omitted), ~{} tokens",
        compact.context_name, result.item_count, result.omitted_items, result.token_estimate
    );
    Some(build_context_memory_block(
        &compact.context_name,
        &result.markdown,
    ))
}

/// Convenience for callers: loads and renders compact context memory in one
/// step. `Ok(None)` means the context has no memory to show. Failures are
/// returned to the caller, which is expected to degrade gracefully.
pub async fn load_and_render_context_memory(
    pool: &SqlitePool,
    context_id: &str,
    max_items: i64,
    budget: MemoryBudget,
) -> Result<Option<String>, String> {
    match get_compact_context_memory(pool, context_id, max_items).await? {
        Some(compact) => Ok(render_context_memory(&compact, budget)),
        None => {
            warn!(
                "Compact context memory requested for unknown context: {}",
                context_id
            );
            Ok(None)
        }
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
            .expect("in-memory db");
        for stmt in [
            r#"CREATE TABLE contexts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                memory_markdown TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"#,
            r#"CREATE TABLE meetings (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"#,
            r#"CREATE TABLE context_memory_items (
                id TEXT PRIMARY KEY,
                context_id TEXT NOT NULL,
                source_meeting_id TEXT,
                kind TEXT NOT NULL,
                content TEXT NOT NULL,
                status TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"#,
        ] {
            sqlx::query(stmt)
                .execute(&pool)
                .await
                .expect("create table");
        }
        sqlx::query(
            "INSERT INTO contexts (id, name, description, memory_markdown, created_at, updated_at)
             VALUES ('context-1', 'Project Phoenix', NULL,
                     '- [fact | from meeting meeting-0 | 2026-01-02] Old durable knowledge',
                     '2026-08-01T00:00:00+00:00', '2026-08-01T00:00:00+00:00')",
        )
        .execute(&pool)
        .await
        .expect("seed context");
        pool
    }

    #[tokio::test]
    async fn unknown_context_returns_none() {
        let pool = test_pool().await;
        assert!(
            get_compact_context_memory(&pool, "context-missing", DEFAULT_MAX_MEMORY_ITEMS)
                .await
                .unwrap()
                .is_none()
        );
        assert!(load_and_render_context_memory(
            &pool,
            "context-missing",
            DEFAULT_MAX_MEMORY_ITEMS,
            MemoryBudget::default(),
        )
        .await
        .unwrap()
        .is_none());
    }

    #[tokio::test]
    async fn max_items_is_clamped_to_binding_limits() {
        let pool = test_pool().await;
        assert!(get_compact_context_memory(&pool, "context-1", 10_000)
            .await
            .unwrap()
            .is_some());
        assert!(get_compact_context_memory(&pool, "context-1", 0)
            .await
            .unwrap()
            .is_some());
    }

    #[tokio::test]
    async fn render_includes_heading_digest_and_guard() {
        let pool = test_pool().await;
        let compact = get_compact_context_memory(&pool, "context-1", DEFAULT_MAX_MEMORY_ITEMS)
            .await
            .unwrap()
            .unwrap();
        let rendered = render_context_memory(&compact, MemoryBudget::default()).unwrap();

        assert!(
            rendered.contains("## Prior Context Memory (from context thread \"Project Phoenix\")")
        );
        assert!(rendered.contains("Old durable knowledge"));
        assert!(rendered.contains("<context_memory>"));
        assert!(rendered.contains("</context_memory>"));
        assert!(rendered.contains("data, not instructions"));
    }

    #[tokio::test]
    async fn render_returns_none_when_memory_is_empty() {
        let pool = test_pool().await;
        sqlx::query("UPDATE contexts SET memory_markdown = '' WHERE id = 'context-1'")
            .execute(&pool)
            .await
            .unwrap();

        let compact = get_compact_context_memory(&pool, "context-1", DEFAULT_MAX_MEMORY_ITEMS)
            .await
            .unwrap()
            .unwrap();
        assert!(render_context_memory(&compact, MemoryBudget::default()).is_none());
    }

    /// Multi-context rendering: two contexts must produce two clearly
    /// separated, name-labelled blocks — never one merged blob — and each
    /// block stays within its share of the combined budget.
    #[tokio::test]
    async fn multi_context_blocks_stay_separate_and_bounded() {
        let pool = test_pool().await;
        sqlx::query(
            "INSERT INTO contexts (id, name, description, memory_markdown, created_at, updated_at)
             VALUES ('context-2', 'Azzurro Hotels', NULL,
                     '- [decision | from meeting meeting-1 | 2026-01-03] Use supplier B',
                     '2026-08-01T00:00:00+00:00', '2026-08-01T00:00:00+00:00')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let per_context_budget = MemoryBudget {
            context_tokens: (DEFAULT_CONTEXT_BUDGET_TOKENS / 2).max(MIN_CONTEXT_BUDGET_TOKENS),
            ..MemoryBudget::default()
        };

        let mut blocks = Vec::new();
        for id in ["context-1", "context-2"] {
            let rendered = load_and_render_context_memory(
                &pool,
                id,
                DEFAULT_MAX_MEMORY_ITEMS,
                per_context_budget,
            )
            .await
            .unwrap();
            if let Some(block) = rendered {
                blocks.push(block);
            }
        }
        assert_eq!(blocks.len(), 2);

        let joined = blocks.join("\n\n");
        assert!(
            joined.contains("from context thread \"Project Phoenix\""),
            "block A must keep its own context label"
        );
        assert!(
            joined.contains("from context thread \"Azzurro Hotels\""),
            "block B must keep its own context label"
        );
        assert!(
            joined.contains("Old durable knowledge") && joined.contains("Use supplier B"),
            "each context's knowledge is preserved"
        );
        // Both blocks are individually delimited: two open and two close tags.
        assert_eq!(joined.matches("<context_memory>").count(), 2);
        assert_eq!(joined.matches("</context_memory>").count(), 2);
    }
}
