//! MemoryEngine — orchestrates the continuous meeting context lifecycle.
//!
//! Two sides (both scoped to one context thread):
//! - Read: [`crate::context::memory`] renders the compact context memory for
//!   the summary pass of the next meeting (contract §8).
//! - Write: [`MemoryEngine::update_context_after_meeting`] extracts memory
//!   from a completed meeting summary and merges it into durable context
//!   memory.
//!
//! # Failure model
//!
//! Extraction runs before any database write. A provider failure therefore
//! leaves memory completely unchanged (update-after-success semantics).
//! Memory is secondary to meeting recording/transcription/summary save: the
//! caller spawns this in the background and only logs failures.
//!
//! # Compaction
//!
//! When the working set exceeds the token budget, low-priority items are
//! folded into `contexts.memory_markdown` (provenance lines included) and
//! their rows are removed in the same transaction. The digest is capped and
//! truncation is non-silent.

use crate::context::dedup::{is_duplicate, is_resolution_match};
use crate::context::extraction::{
    validate_items, ExtractedResolution, ExtractionOutput, ExtractionRequest, ValidatedItem,
};
use crate::context::model::{
    estimate_tokens, truncate_text_to_tokens, MemoryBudget, MemoryItem, MemoryKind,
    MemoryUpdateReport, EXTRACTION_INPUT_MAX_TOKENS, MIN_EXTRACTION_SOURCE_TOKENS,
    OPEN_ITEMS_REFERENCE_MAX_TOKENS,
};
use crate::context::render::{
    build_folded_digest, estimate_active_tokens, plan_compaction, render_open_items_reference,
};
use crate::context::repository::ContextMemoryRepository;
use async_trait::async_trait;
use log::{info, warn};
use sqlx::SqlitePool;

/// Abstraction over the LLM extraction call so the engine is testable with
/// mock extractors (no live paid APIs in tests).
#[async_trait]
pub trait MemoryExtractor: Send + Sync {
    async fn extract(&self, request: &ExtractionRequest) -> Result<ExtractionOutput, String>;
}

pub struct MemoryEngine;

impl MemoryEngine {
    /// Extracts durable memory from a completed meeting summary and merges it
    /// into the context thread's memory.
    ///
    /// Steps (all DB writes happen after extraction succeeds):
    /// 1. Load the context's existing items + durable digest.
    /// 2. Ask the extractor for new items and resolutions (referencing current
    ///    open items).
    /// 3. Apply evidence-based resolutions (never auto-close on re-mention).
    /// 4. Deterministic dedup: duplicates refresh instead of multiply.
    /// 5. Compact when the working set exceeds the token budget: fold
    ///    low-priority items into the durable-core digest.
    pub async fn update_context_after_meeting<X: MemoryExtractor + ?Sized>(
        pool: &SqlitePool,
        extractor: &X,
        context_id: &str,
        meeting_id: &str,
        source_markdown: &str,
        budget: MemoryBudget,
    ) -> Result<MemoryUpdateReport, String> {
        if context_id.trim().is_empty() || meeting_id.trim().is_empty() {
            return Err("context memory: empty context_id or meeting_id".to_string());
        }

        if !ContextMemoryRepository::context_exists(pool, context_id)
            .await
            .map_err(|e| format!("context memory: failed to check context: {e}"))?
        {
            return Err(format!("context memory: context not found: {context_id}"));
        }

        let source = source_markdown.trim();
        if source.is_empty() || estimate_tokens(source) < MIN_EXTRACTION_SOURCE_TOKENS {
            info!(
                "Context memory update skipped for meeting {} (context {}): source too short",
                meeting_id, context_id
            );
            return Ok(MemoryUpdateReport::default());
        }

        let mut items = ContextMemoryRepository::list_items(pool, context_id)
            .await
            .map_err(|e| format!("context memory: failed to list items: {e}"))?;
        let (_, previous_digest) =
            ContextMemoryRepository::get_context_markdown_and_name(pool, context_id)
                .await
                .map_err(|e| format!("context memory: failed to load digest: {e}"))?
                .unwrap_or_default();

        let open_items_markdown =
            render_open_items_reference(&items, OPEN_ITEMS_REFERENCE_MAX_TOKENS);

        let request = ExtractionRequest {
            meeting_id: meeting_id.to_string(),
            open_items_markdown,
            meeting_summary: truncate_text_to_tokens(source, EXTRACTION_INPUT_MAX_TOKENS),
        };

        // Failure here aborts the update before any write.
        let output = extractor.extract(&request).await.map_err(|e| {
            format!("context memory extraction failed for meeting {meeting_id} (context {context_id}): {e}")
        })?;

        let now = chrono::Utc::now().to_rfc3339();
        let mut report = MemoryUpdateReport::default();

        // 1. Resolutions (evidence-based, applied only to matching open items).
        for resolution in &output.resolutions {
            if let Some((item_id, status)) = match_resolution(&items, resolution) {
                ContextMemoryRepository::apply_resolution(pool, &item_id, &status, &now)
                    .await
                    .map_err(|e| format!("context memory: failed to apply resolution: {e}"))?;
                if let Some(item) = items.iter_mut().find(|i| i.id == item_id) {
                    item.status = Some(status);
                    item.updated_at = now.clone();
                }
                report.resolved += 1;
            }
        }

        // 2. Merge extracted items with deterministic dedup.
        let validated = validate_items(&output);
        for candidate in validated {
            merge_item(
                pool,
                context_id,
                &mut items,
                &candidate,
                meeting_id,
                &now,
                &mut report,
            )
            .await?;
        }

        // 3. Compaction when the working set exceeds the budget.
        if estimate_active_tokens(&items) > budget.items_cap_tokens() {
            let plan = plan_compaction(&items, budget.items_cap_tokens());
            if !plan.fold.is_empty() {
                let digest = build_folded_digest(
                    Some(previous_digest.as_str()).filter(|d| !d.trim().is_empty()),
                    &plan.fold,
                    budget.digest_cap_tokens(),
                );
                let ids: Vec<String> = plan.fold.iter().map(|i| i.id.clone()).collect();
                ContextMemoryRepository::fold_and_save_markdown(
                    pool, context_id, &ids, &digest, &now,
                )
                .await
                .map_err(|e| format!("context memory: compaction failed: {e}"))?;
                report.folded = ids.len();
                warn!(
                    "Context memory (context {}) meeting {}: folded {} low-priority items into the durable-core digest to stay within budget",
                    context_id, meeting_id, report.folded
                );
            }
        }

        let active_after = ContextMemoryRepository::list_items(pool, context_id)
            .await
            .map_err(|e| format!("context memory: failed to reload items: {e}"))?;
        report.active_items = active_after.len();
        report.active_tokens_estimate = estimate_active_tokens(&active_after);

        info!(
            "Context memory updated (context {}) for meeting {}: added={}, refreshed={}, resolved={}, folded={}, active={}",
            context_id, meeting_id, report.added, report.refreshed, report.resolved, report.folded, report.active_items
        );
        Ok(report)
    }
}

/// Merges one validated item: refreshes a deterministic duplicate, otherwise
/// inserts a new item. Status is never altered on refresh.
async fn merge_item(
    pool: &SqlitePool,
    context_id: &str,
    items: &mut Vec<MemoryItem>,
    candidate: &ValidatedItem,
    meeting_id: &str,
    now: &str,
    report: &mut MemoryUpdateReport,
) -> Result<(), String> {
    if let Some(existing) = find_duplicate(items, candidate) {
        let longer_content = if candidate.content.chars().count() > existing.content.chars().count()
        {
            candidate.content.clone()
        } else {
            existing.content.clone()
        };
        ContextMemoryRepository::refresh_item(pool, &existing.id, &longer_content, now)
            .await
            .map_err(|e| format!("context memory: failed to refresh item: {e}"))?;
        if let Some(item) = items.iter_mut().find(|i| i.id == existing.id) {
            item.content = longer_content;
            item.updated_at = now.to_string();
        }
        report.refreshed += 1;
        return Ok(());
    }

    let new_item = MemoryItem {
        id: format!("cmi-{}", uuid::Uuid::new_v4()),
        context_id: context_id.to_string(),
        source_meeting_id: Some(meeting_id.to_string()),
        kind: candidate.kind.as_str().to_string(),
        content: candidate.content.clone(),
        status: candidate.status.clone(),
        created_at: now.to_string(),
        updated_at: now.to_string(),
    };
    ContextMemoryRepository::insert_item(pool, &new_item)
        .await
        .map_err(|e| format!("context memory: failed to insert item: {e}"))?;
    items.push(new_item);
    report.added += 1;
    Ok(())
}

/// Finds a deterministic duplicate of the candidate among items of the same
/// kind.
fn find_duplicate(items: &[MemoryItem], candidate: &ValidatedItem) -> Option<MemoryItem> {
    items
        .iter()
        .filter(|i| i.kind == candidate.kind.as_str())
        .find(|i| is_duplicate(&candidate.content, &i.content))
        .cloned()
}

/// Matches a model-emitted resolution to an existing open item.
///
/// Prefers an explicit `context_id` (the memory item id); otherwise requires a
/// same-kind, open item whose content strongly matches the reference. Returns
/// `None` unless the target kind allows the requested terminal status — a
/// re-mention alone can never close an item.
fn match_resolution(
    items: &[MemoryItem],
    resolution: &ExtractedResolution,
) -> Option<(String, String)> {
    let status = resolution.status.trim().to_string();

    let target: Option<&MemoryItem> = if let Some(item_id) = resolution.context_id.as_deref() {
        items.iter().find(|i| i.id == item_id && i.is_open())
    } else {
        let kind = resolution.kind.as_deref().and_then(MemoryKind::from_str)?;
        let reference = resolution.content.as_deref()?.trim();
        items
            .iter()
            .filter(|i| i.kind == kind.as_str() && i.is_open())
            .max_by_key(|i| match_score(reference, &i.content))
            .filter(|i| is_resolution_match(reference, &i.content))
    };

    let target = target?;
    let target_kind = target.kind()?;
    if !target_kind.terminal_statuses().contains(&status.as_str()) {
        return None;
    }
    if target.status.as_deref() == Some(status.as_str()) {
        return None;
    }
    Some((target.id.clone(), status))
}

/// Deterministic match score between a resolution reference and item content.
fn match_score(reference: &str, content: &str) -> u32 {
    let a = crate::context::dedup::normalize_text(reference);
    let b = crate::context::dedup::normalize_text(content);
    if a == b {
        return u32::MAX;
    }
    if a.contains(&b) || b.contains(&a) {
        return 1000 + a.chars().count().min(b.chars().count()) as u32;
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context::extraction::ExtractedItem;
    use sqlx::sqlite::SqlitePoolOptions;

    const SCHEMA: &[&str] = &[
        r#"
        CREATE TABLE contexts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            memory_markdown TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        "#,
        r#"
        CREATE TABLE meetings (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        "#,
        r#"
        CREATE TABLE context_memory_items (
            id TEXT PRIMARY KEY,
            context_id TEXT NOT NULL,
            source_meeting_id TEXT,
            kind TEXT NOT NULL,
            content TEXT NOT NULL,
            status TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        "#,
    ];

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("in-memory db");
        for stmt in SCHEMA {
            sqlx::query(stmt)
                .execute(&pool)
                .await
                .expect("create table");
        }
        sqlx::query(
            "INSERT INTO contexts (id, name, description, memory_markdown, created_at, updated_at)
             VALUES ('context-1', 'Project Phoenix', NULL, '', '2026-08-01T00:00:00+00:00', '2026-08-01T00:00:00+00:00')",
        )
        .execute(&pool)
        .await
        .expect("seed context");
        pool
    }

    #[derive(Clone, Default)]
    struct MockExtractor {
        output: Option<ExtractionOutput>,
        error: Option<String>,
    }

    impl MockExtractor {
        fn ok(output: ExtractionOutput) -> Self {
            Self {
                output: Some(output),
                error: None,
            }
        }

        fn failing(message: &str) -> Self {
            Self {
                output: None,
                error: Some(message.to_string()),
            }
        }
    }

    #[async_trait]
    impl MemoryExtractor for MockExtractor {
        async fn extract(&self, _request: &ExtractionRequest) -> Result<ExtractionOutput, String> {
            if let Some(error) = &self.error {
                Err(error.clone())
            } else {
                Ok(self.output.clone().unwrap_or_default())
            }
        }
    }

    fn extract_item(kind: &str, content: &str) -> ExtractedItem {
        ExtractedItem {
            kind: kind.to_string(),
            content: content.to_string(),
            status: None,
        }
    }

    fn extract_resolution(kind: &str, content: &str, status: &str) -> ExtractedResolution {
        ExtractedResolution {
            context_id: None,
            kind: Some(kind.to_string()),
            content: Some(content.to_string()),
            status: status.to_string(),
        }
    }

    const LONG_SOURCE: &str = "# Weekly Standup\n\n## Summary\nThe team discussed the release plan and the architecture decision to migrate the payments service to Rust by the end of Q3. Bob is responsible for the migration work.\n\n## Action Items\n- Ship v2 to production by Friday\n\n## Decisions\n- Use PostgreSQL as the primary database";

    async fn update(
        pool: &SqlitePool,
        extractor: &MockExtractor,
        meeting_id: &str,
    ) -> Result<MemoryUpdateReport, String> {
        MemoryEngine::update_context_after_meeting(
            pool,
            extractor,
            "context-1",
            meeting_id,
            LONG_SOURCE,
            MemoryBudget::default(),
        )
        .await
    }

    #[tokio::test]
    async fn empty_prior_context_creates_items_with_provenance() {
        let pool = test_pool().await;
        let extractor = MockExtractor::ok(ExtractionOutput {
            items: vec![extract_item(
                "fact",
                "The team is migrating the payments service to Rust by Q3",
            )],
            resolutions: vec![],
        });

        let report = update(&pool, &extractor, "meeting-1").await.unwrap();
        assert_eq!(report.added, 1);

        let items = ContextMemoryRepository::list_items(&pool, "context-1")
            .await
            .unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].source_meeting_id.as_deref(), Some("meeting-1"));
        assert_eq!(items[0].kind, "fact");
        assert!(items[0].id.starts_with("cmi-"));
    }

    #[tokio::test]
    async fn single_prior_meeting_is_visible_to_next() {
        let pool = test_pool().await;
        let extractor = MockExtractor::ok(ExtractionOutput {
            items: vec![extract_item(
                "decision",
                "Use PostgreSQL as the primary database",
            )],
            resolutions: vec![],
        });
        update(&pool, &extractor, "meeting-1").await.unwrap();

        let views = ContextMemoryRepository::list_item_views(&pool, "context-1", 30)
            .await
            .unwrap();
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].kind, "decision");
        assert_eq!(views[0].source_meeting_id.as_deref(), Some("meeting-1"));
    }

    #[tokio::test]
    async fn all_binding_categories_are_stored() {
        let pool = test_pool().await;
        let extractor = MockExtractor::ok(ExtractionOutput {
            items: vec![
                extract_item("fact", "Team uses Rust for the backend service"),
                extract_item("decision", "Use PostgreSQL as the primary database"),
                extract_item("action", "Ship v2 to production by Friday"),
                extract_item("question", "Should we adopt Kubernetes this quarter?"),
                extract_item("note", "Payments migration is at risk of slipping past Q3"),
            ],
            resolutions: vec![],
        });

        let report = update(&pool, &extractor, "meeting-1").await.unwrap();
        assert_eq!(report.added, 5);

        let items = ContextMemoryRepository::list_items(&pool, "context-1")
            .await
            .unwrap();
        let kinds: Vec<&str> = items.iter().map(|i| i.kind.as_str()).collect();
        for expected in ["fact", "decision", "action", "question", "note"] {
            assert!(kinds.contains(&expected), "missing kind {expected}");
        }
        // Working-set kinds default to open; passive kinds have no status.
        let action = items.iter().find(|i| i.kind == "action").unwrap();
        assert_eq!(action.status.as_deref(), Some("open"));
        let fact = items.iter().find(|i| i.kind == "fact").unwrap();
        assert_eq!(fact.status, None);
    }

    #[tokio::test]
    async fn duplicate_facts_do_not_multiply() {
        let pool = test_pool().await;
        let fact = "The team is migrating the payments service to Rust by Q3";

        let first = MockExtractor::ok(ExtractionOutput {
            items: vec![extract_item("fact", fact)],
            resolutions: vec![],
        });
        let first_report = update(&pool, &first, "meeting-1").await.unwrap();
        assert_eq!(first_report.added, 1);

        let second = MockExtractor::ok(ExtractionOutput {
            items: vec![extract_item(
                "fact",
                "migrating the payments service to Rust by Q3",
            )],
            resolutions: vec![],
        });
        let second_report = update(&pool, &second, "meeting-2").await.unwrap();
        assert_eq!(second_report.added, 0);
        assert_eq!(second_report.refreshed, 1);

        let items = ContextMemoryRepository::list_items(&pool, "context-1")
            .await
            .unwrap();
        assert_eq!(items.len(), 1);
    }

    #[tokio::test]
    async fn provider_error_leaves_memory_untouched() {
        let pool = test_pool().await;
        let failing = MockExtractor::failing("LLM API request failed: 500");

        let result = update(&pool, &failing, "meeting-1").await;
        assert!(result.is_err());

        let items = ContextMemoryRepository::list_items(&pool, "context-1")
            .await
            .unwrap();
        assert!(items.is_empty());
        let (_, digest) =
            ContextMemoryRepository::get_context_markdown_and_name(&pool, "context-1")
                .await
                .unwrap()
                .unwrap();
        assert!(digest.is_empty());
    }

    #[tokio::test]
    async fn missing_context_is_rejected_before_extraction() {
        let pool = test_pool().await;
        let extractor = MockExtractor::ok(ExtractionOutput::default());
        let result = MemoryEngine::update_context_after_meeting(
            &pool,
            &extractor,
            "context-missing",
            "meeting-1",
            LONG_SOURCE,
            MemoryBudget::default(),
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn open_actions_are_not_auto_completed() {
        let pool = test_pool().await;
        let create = MockExtractor::ok(ExtractionOutput {
            items: vec![extract_item(
                "action",
                "Ship v2 to production by Friday with full QA sign-off",
            )],
            resolutions: vec![],
        });
        update(&pool, &create, "meeting-1").await.unwrap();

        // Re-mention (duplicate) must not close it.
        let remention = MockExtractor::ok(ExtractionOutput {
            items: vec![extract_item(
                "action",
                "Ship v2 to production by Friday with full QA sign-off",
            )],
            resolutions: vec![],
        });
        update(&pool, &remention, "meeting-2").await.unwrap();

        let items = ContextMemoryRepository::list_items(&pool, "context-1")
            .await
            .unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].status.as_deref(), Some("open"));
    }

    #[tokio::test]
    async fn resolutions_require_evidence_and_matching() {
        let pool = test_pool().await;
        let create = MockExtractor::ok(ExtractionOutput {
            items: vec![extract_item(
                "action",
                "Ship v2 to production by Friday with full QA sign-off",
            )],
            resolutions: vec![],
        });
        update(&pool, &create, "meeting-1").await.unwrap();

        // A resolution referencing a DIFFERENT item must not match.
        let wrong = MockExtractor::ok(ExtractionOutput {
            items: vec![],
            resolutions: vec![extract_resolution(
                "action",
                "Organize the team offsite event",
                "done",
            )],
        });
        let report = update(&pool, &wrong, "meeting-2").await.unwrap();
        assert_eq!(report.resolved, 0);

        let after_wrong = ContextMemoryRepository::list_items(&pool, "context-1")
            .await
            .unwrap();
        assert_eq!(after_wrong[0].status.as_deref(), Some("open"));

        // An evidence-based matching resolution closes it.
        let evidence = MockExtractor::ok(ExtractionOutput {
            items: vec![],
            resolutions: vec![extract_resolution(
                "action",
                "Ship v2 to production by Friday with full QA sign-off",
                "done",
            )],
        });
        let report = update(&pool, &evidence, "meeting-3").await.unwrap();
        assert_eq!(report.resolved, 1);

        let after_evidence = ContextMemoryRepository::list_items(&pool, "context-1")
            .await
            .unwrap();
        assert_eq!(after_evidence[0].status.as_deref(), Some("done"));
    }

    #[tokio::test]
    async fn question_resolves_only_with_question_statuses() {
        let pool = test_pool().await;
        let create = MockExtractor::ok(ExtractionOutput {
            items: vec![extract_item(
                "question",
                "Should we adopt Kubernetes this quarter?",
            )],
            resolutions: vec![],
        });
        update(&pool, &create, "meeting-1").await.unwrap();

        // "done" is not a valid terminal status for questions.
        let bad = MockExtractor::ok(ExtractionOutput {
            items: vec![],
            resolutions: vec![extract_resolution(
                "question",
                "Should we adopt Kubernetes this quarter?",
                "done",
            )],
        });
        let report = update(&pool, &bad, "meeting-2").await.unwrap();
        assert_eq!(report.resolved, 0);

        // "resolved" works with a matching reference.
        let good = MockExtractor::ok(ExtractionOutput {
            items: vec![],
            resolutions: vec![extract_resolution(
                "question",
                "Should we adopt Kubernetes this quarter?",
                "resolved",
            )],
        });
        let report = update(&pool, &good, "meeting-3").await.unwrap();
        assert_eq!(report.resolved, 1);

        let items = ContextMemoryRepository::list_items(&pool, "context-1")
            .await
            .unwrap();
        assert_eq!(items[0].status.as_deref(), Some("resolved"));
    }

    #[tokio::test]
    async fn very_large_memory_compacts_with_provenance_in_digest() {
        let pool = test_pool().await;
        let mut items = Vec::new();
        for i in 0..40 {
            items.push(extract_item(
                "fact",
                &format!("Durable fact number {i} about the project architecture and its design constraints"),
            ));
        }
        let extractor = MockExtractor::ok(ExtractionOutput {
            items,
            resolutions: vec![],
        });
        let budget = MemoryBudget {
            context_tokens: 600,
            ..Default::default()
        };

        let report = MemoryEngine::update_context_after_meeting(
            &pool,
            &extractor,
            "context-1",
            "meeting-1",
            LONG_SOURCE,
            budget,
        )
        .await
        .unwrap();
        assert!(report.folded > 0, "expected compaction to fold items");
        assert!(report.active_tokens_estimate <= budget.items_cap_tokens() + 120);

        let (_, digest) =
            ContextMemoryRepository::get_context_markdown_and_name(&pool, "context-1")
                .await
                .unwrap()
                .unwrap();
        assert!(
            digest.contains("from meeting meeting-1"),
            "digest must keep provenance"
        );

        // Folded rows were removed from the working set; the knowledge survives
        // only in the digest (with provenance), never silently dropped.
        let remaining = ContextMemoryRepository::list_items(&pool, "context-1")
            .await
            .unwrap();
        assert!(remaining.len() < 40);
        assert!(digest.contains("Durable fact number"));
    }

    #[tokio::test]
    async fn source_too_short_skips_update_without_error() {
        let pool = test_pool().await;
        let extractor = MockExtractor::ok(ExtractionOutput::default());
        let report = MemoryEngine::update_context_after_meeting(
            &pool,
            &extractor,
            "context-1",
            "meeting-1",
            "tiny",
            MemoryBudget::default(),
        )
        .await
        .unwrap();
        assert_eq!(report, MemoryUpdateReport::default());
        assert!(ContextMemoryRepository::list_items(&pool, "context-1")
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn empty_identifiers_are_rejected() {
        let pool = test_pool().await;
        let extractor = MockExtractor::ok(ExtractionOutput::default());
        assert!(MemoryEngine::update_context_after_meeting(
            &pool,
            &extractor,
            "  ",
            "meeting-1",
            LONG_SOURCE,
            MemoryBudget::default(),
        )
        .await
        .is_err());
        assert!(MemoryEngine::update_context_after_meeting(
            &pool,
            &extractor,
            "context-1",
            "",
            LONG_SOURCE,
            MemoryBudget::default(),
        )
        .await
        .is_err());
    }

    #[test]
    fn resolution_matcher_requires_same_kind_and_evidence() {
        let item = MemoryItem {
            id: "cmi-1".to_string(),
            context_id: "context-1".to_string(),
            source_meeting_id: Some("meeting-1".to_string()),
            kind: "action".to_string(),
            content: "Ship v2 to production by Friday".to_string(),
            status: Some("open".to_string()),
            created_at: "2026-08-01T00:00:00+00:00".to_string(),
            updated_at: "2026-08-01T00:00:00+00:00".to_string(),
        };
        let items = vec![item];

        assert!(match_resolution(
            &items,
            &extract_resolution("action", "Organize the offsite", "done")
        )
        .is_none());
        assert!(match_resolution(
            &items,
            &extract_resolution("fact", "Ship v2 to production by Friday", "done")
        )
        .is_none());
        let matched = match_resolution(
            &items,
            &extract_resolution("action", "Ship v2 to production by Friday", "done"),
        );
        assert_eq!(matched.unwrap().0, "cmi-1");
    }
}
