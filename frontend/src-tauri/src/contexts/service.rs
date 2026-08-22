//! Domain layer for Context Threads.
//!
//! Keeps context-domain logic (validation, orchestration, structured errors)
//! separate from raw Tauri command functions in [`commands`].
//!
//! A Context ("Project Phoenix", "Client Azzurro", ...) groups related
//! meetings. One context contains many meetings; one meeting may belong to
//! multiple contexts. Deleting a context never deletes meetings, and removing
//! a meeting from a context never modifies the meeting or its transcript.
//!
//! AI memory extraction is owned by Agent 8; this layer only exposes access
//! to context metadata (including the stored `memory_markdown` digest) and
//! context meetings.

use serde::Serialize;
use sqlx::SqlitePool;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use thiserror::Error;

use crate::context::engine::MemoryEngine;
use crate::context::extraction::LlmMemoryExtractor;
use crate::context::model::MemoryBudget;
use crate::database::{
    models::{ContextMeetingModel, ContextModel, ContextSummaryModel},
    repositories::context::ContextsRepository,
    repositories::meeting::MeetingsRepository,
    repositories::setting::SettingsRepository,
    repositories::summary::SummaryProcessesRepository,
};
use crate::summary::service::resolve_provider_runtime_config;

/// Guards against concurrent rebuilds of the same context.
static REBUILDING: std::sync::LazyLock<Mutex<HashSet<String>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashSet::new()));

pub const MAX_CONTEXT_NAME_LENGTH: usize = 120;
pub const MAX_CONTEXT_DESCRIPTION_LENGTH: usize = 2000;

/// Structured domain errors surfaced to callers (and, via commands, the frontend).
#[derive(Debug, Error)]
pub enum ContextError {
    #[error("Context name must not be empty")]
    EmptyName,
    #[error("Context name must be at most {max} characters long (was {actual})")]
    NameTooLong { max: usize, actual: usize },
    #[error("Context description must be at most {max} characters long (was {actual})")]
    DescriptionTooLong { max: usize, actual: usize },
    #[error("Context id must not be empty")]
    InvalidContextId,
    #[error("Meeting id must not be empty")]
    InvalidMeetingId,
    #[error("Context not found: {0}")]
    ContextNotFound(String),
    #[error("Meeting not found: {0}")]
    MeetingNotFound(String),
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
}

/// Result of adding a meeting to a context. Duplicate links are prevented
/// safely (idempotent), so a repeated add is not an error.
#[derive(Debug, Clone, Serialize)]
pub struct AddMeetingToContextOutcome {
    pub context_id: String,
    pub meeting_id: String,
    /// `false` when the link already existed (duplicate prevented).
    pub added: bool,
}

/// Result of removing a meeting from a context.
#[derive(Debug, Clone, Serialize)]
pub struct RemoveMeetingFromContextOutcome {
    pub context_id: String,
    pub meeting_id: String,
    /// `false` when no link existed to remove.
    pub removed: bool,
}

/// Report for a successful Context Memory rebuild.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RebuildMemoryReport {
    pub context_id: String,
    /// Meetings whose summary/transcript contributed to the rebuilt memory.
    pub meetings_processed: u32,
    /// Total durable memory items written.
    pub items_added: u32,
}

pub struct ContextService;

impl ContextService {
    pub async fn create_context(
        pool: &SqlitePool,
        raw_name: &str,
        raw_description: Option<&str>,
    ) -> Result<ContextModel, ContextError> {
        let name = validate_context_name(raw_name)?;
        let description = validate_context_description(raw_description)?;

        Ok(ContextsRepository::create_context(pool, &name, description.as_deref()).await?)
    }

    pub async fn update_context(
        pool: &SqlitePool,
        context_id: &str,
        raw_name: &str,
        raw_description: Option<&str>,
    ) -> Result<ContextModel, ContextError> {
        validate_context_id(context_id)?;
        let name = validate_context_name(raw_name)?;
        let description = validate_context_description(raw_description)?;

        ContextsRepository::update_context(pool, context_id, &name, description.as_deref())
            .await?
            .ok_or_else(|| ContextError::ContextNotFound(context_id.to_string()))
    }

    /// Deletes a context and its links/memory. Meetings are never deleted.
    pub async fn delete_context(pool: &SqlitePool, context_id: &str) -> Result<(), ContextError> {
        validate_context_id(context_id)?;

        let deleted = ContextsRepository::delete_context(pool, context_id).await?;
        if !deleted {
            return Err(ContextError::ContextNotFound(context_id.to_string()));
        }
        Ok(())
    }

    pub async fn get_context(
        pool: &SqlitePool,
        context_id: &str,
    ) -> Result<Option<ContextModel>, ContextError> {
        validate_context_id(context_id)?;
        Ok(ContextsRepository::get_context(pool, context_id).await?)
    }

    pub async fn list_contexts(
        pool: &SqlitePool,
    ) -> Result<Vec<ContextSummaryModel>, ContextError> {
        Ok(ContextsRepository::list_contexts(pool).await?)
    }

    pub async fn add_meeting_to_context(
        pool: &SqlitePool,
        context_id: &str,
        meeting_id: &str,
    ) -> Result<AddMeetingToContextOutcome, ContextError> {
        validate_context_id(context_id)?;
        validate_meeting_id(meeting_id)?;

        if !ContextsRepository::context_exists(pool, context_id).await? {
            return Err(ContextError::ContextNotFound(context_id.to_string()));
        }
        if !ContextsRepository::meeting_exists(pool, meeting_id).await? {
            return Err(ContextError::MeetingNotFound(meeting_id.to_string()));
        }

        let added =
            ContextsRepository::add_meeting_to_context(pool, context_id, meeting_id).await?;

        Ok(AddMeetingToContextOutcome {
            context_id: context_id.to_string(),
            meeting_id: meeting_id.to_string(),
            added,
        })
    }

    /// Unlinks a meeting from a context. Never touches the meeting or transcript.
    pub async fn remove_meeting_from_context(
        pool: &SqlitePool,
        context_id: &str,
        meeting_id: &str,
    ) -> Result<RemoveMeetingFromContextOutcome, ContextError> {
        validate_context_id(context_id)?;
        validate_meeting_id(meeting_id)?;

        let removed =
            ContextsRepository::remove_meeting_from_context(pool, context_id, meeting_id).await?;

        Ok(RemoveMeetingFromContextOutcome {
            context_id: context_id.to_string(),
            meeting_id: meeting_id.to_string(),
            removed,
        })
    }

    /// Meetings in a context, chronological (oldest first).
    pub async fn list_meetings_for_context(
        pool: &SqlitePool,
        context_id: &str,
    ) -> Result<Vec<ContextMeetingModel>, ContextError> {
        validate_context_id(context_id)?;

        if !ContextsRepository::context_exists(pool, context_id).await? {
            return Err(ContextError::ContextNotFound(context_id.to_string()));
        }

        Ok(ContextsRepository::list_meetings_for_context(pool, context_id).await?)
    }
}

/// Trims the name and rejects empty or oversized values.
fn validate_context_name(raw: &str) -> Result<String, ContextError> {
    let name = raw.trim().to_string();
    if name.is_empty() {
        return Err(ContextError::EmptyName);
    }
    let length = name.chars().count();
    if length > MAX_CONTEXT_NAME_LENGTH {
        return Err(ContextError::NameTooLong {
            max: MAX_CONTEXT_NAME_LENGTH,
            actual: length,
        });
    }
    Ok(name)
}

/// Trims the description; empty descriptions become `None`.
fn validate_context_description(raw: Option<&str>) -> Result<Option<String>, ContextError> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let description = raw.trim().to_string();
    if description.is_empty() {
        return Ok(None);
    }
    let length = description.chars().count();
    if length > MAX_CONTEXT_DESCRIPTION_LENGTH {
        return Err(ContextError::DescriptionTooLong {
            max: MAX_CONTEXT_DESCRIPTION_LENGTH,
            actual: length,
        });
    }
    Ok(Some(description))
}

fn validate_context_id(context_id: &str) -> Result<(), ContextError> {
    if context_id.trim().is_empty() {
        return Err(ContextError::InvalidContextId);
    }
    Ok(())
}

fn validate_meeting_id(meeting_id: &str) -> Result<(), ContextError> {
    if meeting_id.trim().is_empty() {
        return Err(ContextError::InvalidMeetingId);
    }
    Ok(())
}

impl ContextService {
    /// Rebuilds a Context's derived memory from the meetings CURRENTLY in the
    /// context, using the configured summary provider.
    ///
    /// SAFETY: the existing memory is never deleted before the rebuild
    /// succeeds. Extraction runs against a temporary context; only on full
    /// success are the old items atomically replaced (single transaction).
    /// Any provider/database failure leaves the previous memory untouched.
    /// Meetings and transcripts are never modified.
    pub async fn rebuild_context_memory(
        pool: &SqlitePool,
        app_data_dir: Option<PathBuf>,
        context_id: &str,
    ) -> Result<RebuildMemoryReport, String> {
        // Prevent concurrent rebuilds of the same context.
        {
            let mut guard = REBUILDING
                .lock()
                .map_err(|_| "Context memory rebuild: internal lock poisoned".to_string())?;
            if !guard.insert(context_id.to_string()) {
                return Err(
                    "A Context memory rebuild is already running for this Context.".to_string(),
                );
            }
        }
        let _release_guard = RebuildGuard {
            context_id: context_id.to_string(),
        };

        let context = ContextsRepository::get_context(pool, context_id)
            .await
            .map_err(|e| format!("Context memory rebuild failed: {e}"))?
            .ok_or_else(|| "Context not found".to_string())?;
        let _ = &context;

        let meetings = ContextsRepository::list_meetings_for_context(pool, context_id)
            .await
            .map_err(|e| format!("Context memory rebuild failed: {e}"))?;

        // Resolve the configured summary provider (same architecture as
        // normal summary generation — local stays local, cloud stays the
        // configured cloud provider).
        let (provider, model_name) = match SettingsRepository::get_model_config(pool)
            .await
            .map_err(|e| format!("Context memory rebuild failed: {e}"))?
        {
            Some(s) if !s.provider.trim().is_empty() && !s.model.trim().is_empty() => {
                (s.provider, s.model)
            }
            _ => {
                return Err(
                    "No summary model configured. Set one in Settings before rebuilding Context memory."
                        .to_string(),
                )
            }
        };
        let config = resolve_provider_runtime_config(pool, &provider, &model_name)
            .await
            .map_err(|e| format!("Context memory rebuild failed: {e}"))?;

        let extractor = LlmMemoryExtractor::new(
            reqwest::Client::new(),
            config.provider,
            model_name,
            config.api_key,
            config.ollama_endpoint,
            config.custom_openai_endpoint,
            config.custom_openai_max_tokens,
            config.custom_openai_temperature,
            config.custom_openai_top_p,
            app_data_dir,
        );

        // Temporary context for the rebuild pass.
        let tmp = ContextsRepository::create_context(
            pool,
            &format!("__rebuild-{}", uuid::Uuid::new_v4()),
            None,
        )
        .await
        .map_err(|e| format!("Context memory rebuild failed: {e}"))?;

        let mut meetings_processed: u32 = 0;
        let mut items_added: u32 = 0;

        // Run the extraction pipeline chronologically into the temp context.
        let run_result: Result<(), String> = async {
            for meeting in &meetings {
                let source = load_meeting_source_markdown(pool, &meeting.id).await?;
                if source.trim().is_empty() {
                    continue;
                }
                let report = MemoryEngine::update_context_after_meeting(
                    pool,
                    &extractor,
                    &tmp.id,
                    &meeting.id,
                    &source,
                    MemoryBudget::default(),
                )
                .await
                .map_err(|e| format!("Context memory rebuild failed: {e}"))?;
                meetings_processed += 1;
                items_added += report.added as u32;
            }
            Ok(())
        }
        .await;

        // Never leave the temporary context behind, whatever happened.
        let cleanup = async {
            let _ = sqlx::query("DELETE FROM context_memory_items WHERE context_id = ?")
                .bind(&tmp.id)
                .execute(pool)
                .await;
            let _ = sqlx::query("DELETE FROM contexts WHERE id = ?")
                .bind(&tmp.id)
                .execute(pool)
                .await;
        };
        if let Err(e) = run_result {
            cleanup.await;
            return Err(e);
        }

        // Atomic swap: replace the old derived memory in one transaction.
        // A failure here also leaves the old memory untouched.
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| format!("Context memory rebuild failed: {e}"))?;
        let swap_result: Result<(), sqlx::Error> = async {
            sqlx::query("DELETE FROM context_memory_items WHERE context_id = ?")
                .bind(context_id)
                .execute(&mut *tx)
                .await?;
            sqlx::query("UPDATE context_memory_items SET context_id = ? WHERE context_id = ?")
                .bind(context_id)
                .bind(&tmp.id)
                .execute(&mut *tx)
                .await?;
            let digest: Option<String> =
                sqlx::query_scalar("SELECT memory_markdown FROM contexts WHERE id = ?")
                    .bind(&tmp.id)
                    .fetch_one(&mut *tx)
                    .await?;
            sqlx::query("UPDATE contexts SET memory_markdown = ?, updated_at = ? WHERE id = ?")
                .bind(digest.unwrap_or_default())
                .bind(chrono::Utc::now())
                .bind(context_id)
                .execute(&mut *tx)
                .await?;
            sqlx::query("DELETE FROM contexts WHERE id = ?")
                .bind(&tmp.id)
                .execute(&mut *tx)
                .await?;
            Ok(())
        }
        .await;

        match swap_result {
            Ok(()) => {
                tx.commit()
                    .await
                    .map_err(|e| format!("Context memory rebuild failed: {e}"))?;
                tracing::info!(
                    "Context memory rebuilt for {}: processed {} meeting(s), {} items",
                    context_id,
                    meetings_processed,
                    items_added
                );
                Ok(RebuildMemoryReport {
                    context_id: context_id.to_string(),
                    meetings_processed,
                    items_added,
                })
            }
            Err(e) => {
                let _ = tx.rollback().await;
                cleanup.await;
                Err(format!("Context memory rebuild failed: {e}"))
            }
        }
    }
}

/// RAII guard removing the context from the rebuild set on drop.
struct RebuildGuard {
    context_id: String,
}

impl Drop for RebuildGuard {
    fn drop(&mut self) {
        if let Ok(mut guard) = REBUILDING.lock() {
            guard.remove(&self.context_id);
        }
    }
}

/// Loads the best available source text for memory extraction: the meeting's
/// completed summary markdown when present, otherwise its transcript text.
/// Returns an empty string when the meeting has neither.
async fn load_meeting_source_markdown(
    pool: &SqlitePool,
    meeting_id: &str,
) -> Result<String, String> {
    if let Some(process) = SummaryProcessesRepository::get_summary_data(pool, meeting_id)
        .await
        .map_err(|e| format!("Failed to load summary for {}: {}", meeting_id, e))?
    {
        if let Some(raw) = process.result {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(markdown) = value.get("markdown").and_then(|m| m.as_str()) {
                    if !markdown.trim().is_empty() {
                        return Ok(markdown.to_string());
                    }
                }
            }
        }
    }

    let (transcripts, _total) =
        MeetingsRepository::get_meeting_transcripts_paginated(pool, meeting_id, 500, 0)
            .await
            .map_err(|e| format!("Failed to load transcript for {}: {}", meeting_id, e))?;
    Ok(transcripts
        .into_iter()
        .map(|t| t.transcript)
        .collect::<Vec<_>>()
        .join("\n"))
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::repositories::context_memory_items::ContextMemoryItemsRepository;
    use chrono::{Duration, Utc};
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("failed to create in-memory pool");
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&pool)
            .await
            .expect("failed to enable foreign keys");
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("failed to run migrations");
        pool
    }

    async fn insert_meeting(
        pool: &SqlitePool,
        id: &str,
        title: &str,
        created_at: chrono::DateTime<Utc>,
    ) {
        sqlx::query("INSERT INTO meetings (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
            .bind(id)
            .bind(title)
            .bind(created_at)
            .bind(created_at)
            .execute(pool)
            .await
            .expect("failed to insert meeting");
    }

    async fn insert_transcript(pool: &SqlitePool, id: &str, meeting_id: &str, text: &str) {
        sqlx::query(
            "INSERT INTO transcripts (id, meeting_id, transcript, timestamp) VALUES (?, ?, ?, ?)",
        )
        .bind(id)
        .bind(meeting_id)
        .bind(text)
        .bind(Utc::now())
        .execute(pool)
        .await
        .expect("failed to insert transcript");
    }

    async fn meeting_count(pool: &SqlitePool) -> i64 {
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM meetings")
            .fetch_one(pool)
            .await
            .unwrap();
        count
    }

    async fn transcript_count(pool: &SqlitePool, meeting_id: &str) -> i64 {
        let (count,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM transcripts WHERE meeting_id = ?")
                .bind(meeting_id)
                .fetch_one(pool)
                .await
                .unwrap();
        count
    }

    async fn link_count(pool: &SqlitePool, context_id: &str) -> i64 {
        let (count,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM context_meetings WHERE context_id = ?")
                .bind(context_id)
                .fetch_one(pool)
                .await
                .unwrap();
        count
    }

    #[tokio::test]
    async fn create_context_trims_name_and_returns_model() {
        let pool = test_pool().await;
        let context = ContextService::create_context(&pool, "  Project Phoenix  ", None)
            .await
            .unwrap();
        assert_eq!(context.name, "Project Phoenix");
        assert!(context.id.starts_with("context-"));
        assert!(context.description.is_none());

        let fetched = ContextService::get_context(&pool, &context.id)
            .await
            .unwrap()
            .expect("context should exist");
        assert_eq!(fetched.name, "Project Phoenix");
    }

    #[tokio::test]
    async fn create_context_rejects_empty_and_whitespace_names() {
        let pool = test_pool().await;
        for name in ["", "   ", "\t", "\n"] {
            let err = ContextService::create_context(&pool, name, None)
                .await
                .unwrap_err();
            assert!(
                matches!(err, ContextError::EmptyName),
                "unexpected error for {name:?}: {err}"
            );
        }
    }

    #[tokio::test]
    async fn create_context_rejects_overlong_name() {
        let pool = test_pool().await;
        let long_name = "x".repeat(MAX_CONTEXT_NAME_LENGTH + 1);
        let err = ContextService::create_context(&pool, &long_name, None)
            .await
            .unwrap_err();
        match err {
            ContextError::NameTooLong { max, actual } => {
                assert_eq!(max, MAX_CONTEXT_NAME_LENGTH);
                assert_eq!(actual, MAX_CONTEXT_NAME_LENGTH + 1);
            }
            other => panic!("expected NameTooLong, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn create_context_rejects_overlong_description() {
        let pool = test_pool().await;
        let long_description = "y".repeat(MAX_CONTEXT_DESCRIPTION_LENGTH + 1);
        let err = ContextService::create_context(&pool, "Valid", Some(&long_description))
            .await
            .unwrap_err();
        assert!(matches!(err, ContextError::DescriptionTooLong { .. }));
    }

    #[tokio::test]
    async fn duplicate_context_names_are_allowed() {
        let pool = test_pool().await;
        let first = ContextService::create_context(&pool, "Weekly Engineering", None)
            .await
            .unwrap();
        let second = ContextService::create_context(&pool, "Weekly Engineering", None)
            .await
            .unwrap();
        assert_ne!(first.id, second.id);
        assert_eq!(first.name, second.name);

        let contexts = ContextService::list_contexts(&pool).await.unwrap();
        assert_eq!(contexts.len(), 2);
    }

    #[tokio::test]
    async fn update_context_renames_and_clears_description() {
        let pool = test_pool().await;
        let context = ContextService::create_context(&pool, "Old Name", Some("desc"))
            .await
            .unwrap();

        let updated = ContextService::update_context(&pool, &context.id, "  New Name  ", None)
            .await
            .unwrap();
        assert_eq!(updated.id, context.id);
        assert_eq!(updated.name, "New Name");
        assert!(updated.description.is_none());
    }

    #[tokio::test]
    async fn update_context_not_found() {
        let pool = test_pool().await;
        let err = ContextService::update_context(&pool, "context-missing", "Name", None)
            .await
            .unwrap_err();
        assert!(matches!(err, ContextError::ContextNotFound(_)));
    }

    #[tokio::test]
    async fn delete_context_keeps_meetings_and_transcripts() {
        let pool = test_pool().await;
        insert_meeting(&pool, "meeting-1", "Standup", Utc::now()).await;
        insert_transcript(&pool, "transcript-1", "meeting-1", "hello").await;

        let context = ContextService::create_context(&pool, "Product Team", None)
            .await
            .unwrap();
        ContextService::add_meeting_to_context(&pool, &context.id, "meeting-1")
            .await
            .unwrap();

        ContextService::delete_context(&pool, &context.id)
            .await
            .unwrap();

        assert!(ContextService::get_context(&pool, &context.id)
            .await
            .unwrap()
            .is_none());
        assert_eq!(link_count(&pool, &context.id).await, 0);
        assert_eq!(meeting_count(&pool).await, 1);
        assert_eq!(transcript_count(&pool, "meeting-1").await, 1);
    }

    #[tokio::test]
    async fn delete_context_not_found() {
        let pool = test_pool().await;
        let err = ContextService::delete_context(&pool, "context-missing")
            .await
            .unwrap_err();
        assert!(matches!(err, ContextError::ContextNotFound(_)));
    }

    #[tokio::test]
    async fn get_context_returns_none_for_missing() {
        let pool = test_pool().await;
        assert!(ContextService::get_context(&pool, "context-missing")
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn list_contexts_includes_meeting_counts() {
        let pool = test_pool().await;
        let a = ContextService::create_context(&pool, "A", None)
            .await
            .unwrap();
        let b = ContextService::create_context(&pool, "B", None)
            .await
            .unwrap();

        insert_meeting(&pool, "meeting-1", "M1", Utc::now()).await;
        insert_meeting(&pool, "meeting-2", "M2", Utc::now()).await;
        insert_meeting(&pool, "meeting-3", "M3", Utc::now()).await;

        ContextService::add_meeting_to_context(&pool, &a.id, "meeting-1")
            .await
            .unwrap();
        ContextService::add_meeting_to_context(&pool, &a.id, "meeting-2")
            .await
            .unwrap();
        ContextService::add_meeting_to_context(&pool, &b.id, "meeting-3")
            .await
            .unwrap();

        let contexts = ContextService::list_contexts(&pool).await.unwrap();
        assert_eq!(contexts.len(), 2);
        let summary_a = contexts.iter().find(|c| c.id == a.id).unwrap();
        let summary_b = contexts.iter().find(|c| c.id == b.id).unwrap();
        assert_eq!(summary_a.meeting_count, 2);
        assert_eq!(summary_b.meeting_count, 1);
    }

    #[tokio::test]
    async fn add_meeting_to_context_links_meeting() {
        let pool = test_pool().await;
        insert_meeting(&pool, "meeting-1", "M1", Utc::now()).await;
        let context = ContextService::create_context(&pool, "Client Azzurro", None)
            .await
            .unwrap();

        let outcome = ContextService::add_meeting_to_context(&pool, &context.id, "meeting-1")
            .await
            .unwrap();
        assert!(outcome.added);

        let meetings = ContextService::list_meetings_for_context(&pool, &context.id)
            .await
            .unwrap();
        assert_eq!(meetings.len(), 1);
        assert_eq!(meetings[0].id, "meeting-1");
    }

    #[tokio::test]
    async fn duplicate_meeting_link_is_prevented_safely() {
        let pool = test_pool().await;
        insert_meeting(&pool, "meeting-1", "M1", Utc::now()).await;
        let context = ContextService::create_context(&pool, "Fundraising", None)
            .await
            .unwrap();

        let first = ContextService::add_meeting_to_context(&pool, &context.id, "meeting-1")
            .await
            .unwrap();
        assert!(first.added);

        let second = ContextService::add_meeting_to_context(&pool, &context.id, "meeting-1")
            .await
            .unwrap();
        assert!(
            !second.added,
            "duplicate link should be reported as already existing"
        );

        assert_eq!(link_count(&pool, &context.id).await, 1);
        let meetings = ContextService::list_meetings_for_context(&pool, &context.id)
            .await
            .unwrap();
        assert_eq!(meetings.len(), 1);
    }

    #[tokio::test]
    async fn add_meeting_to_missing_context_errors() {
        let pool = test_pool().await;
        insert_meeting(&pool, "meeting-1", "M1", Utc::now()).await;
        let err = ContextService::add_meeting_to_context(&pool, "context-missing", "meeting-1")
            .await
            .unwrap_err();
        assert!(matches!(err, ContextError::ContextNotFound(_)));
    }

    #[tokio::test]
    async fn add_missing_meeting_to_context_errors() {
        let pool = test_pool().await;
        let context = ContextService::create_context(&pool, "C", None)
            .await
            .unwrap();
        let err = ContextService::add_meeting_to_context(&pool, &context.id, "meeting-missing")
            .await
            .unwrap_err();
        assert!(matches!(err, ContextError::MeetingNotFound(_)));
    }

    #[tokio::test]
    async fn remove_meeting_from_context_keeps_meeting_and_transcript() {
        let pool = test_pool().await;
        insert_meeting(&pool, "meeting-1", "M1", Utc::now()).await;
        insert_transcript(&pool, "transcript-1", "meeting-1", "hello").await;
        let context = ContextService::create_context(&pool, "C", None)
            .await
            .unwrap();
        ContextService::add_meeting_to_context(&pool, &context.id, "meeting-1")
            .await
            .unwrap();

        let outcome = ContextService::remove_meeting_from_context(&pool, &context.id, "meeting-1")
            .await
            .unwrap();
        assert!(outcome.removed);

        assert_eq!(link_count(&pool, &context.id).await, 0);
        assert!(
            ContextService::list_meetings_for_context(&pool, &context.id)
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(meeting_count(&pool).await, 1);
        assert_eq!(transcript_count(&pool, "meeting-1").await, 1);
    }

    #[tokio::test]
    async fn remove_meeting_not_linked_reports_removed_false() {
        let pool = test_pool().await;
        insert_meeting(&pool, "meeting-1", "M1", Utc::now()).await;
        let context = ContextService::create_context(&pool, "C", None)
            .await
            .unwrap();

        let outcome = ContextService::remove_meeting_from_context(&pool, &context.id, "meeting-1")
            .await
            .unwrap();
        assert!(!outcome.removed);
    }

    #[tokio::test]
    async fn many_to_many_meeting_in_multiple_contexts() {
        let pool = test_pool().await;
        insert_meeting(&pool, "meeting-1", "M1", Utc::now()).await;
        insert_meeting(&pool, "meeting-2", "M2", Utc::now()).await;

        let alpha = ContextService::create_context(&pool, "Alpha", None)
            .await
            .unwrap();
        let beta = ContextService::create_context(&pool, "Beta", None)
            .await
            .unwrap();

        ContextService::add_meeting_to_context(&pool, &alpha.id, "meeting-1")
            .await
            .unwrap();
        ContextService::add_meeting_to_context(&pool, &beta.id, "meeting-1")
            .await
            .unwrap();
        ContextService::add_meeting_to_context(&pool, &alpha.id, "meeting-2")
            .await
            .unwrap();

        let alpha_meetings = ContextService::list_meetings_for_context(&pool, &alpha.id)
            .await
            .unwrap();
        let beta_meetings = ContextService::list_meetings_for_context(&pool, &beta.id)
            .await
            .unwrap();

        assert_eq!(alpha_meetings.len(), 2);
        assert_eq!(beta_meetings.len(), 1);
        assert_eq!(beta_meetings[0].id, "meeting-1");
    }

    #[tokio::test]
    async fn list_meetings_for_context_is_chronological() {
        let pool = test_pool().await;
        let base = Utc::now();
        insert_meeting(&pool, "meeting-old", "Oldest", base - Duration::days(2)).await;
        insert_meeting(&pool, "meeting-new", "Newest", base + Duration::days(2)).await;
        insert_meeting(&pool, "meeting-mid", "Middle", base - Duration::days(1)).await;

        let context = ContextService::create_context(&pool, "Timeline", None)
            .await
            .unwrap();
        // Insert links out of chronological order
        ContextService::add_meeting_to_context(&pool, &context.id, "meeting-new")
            .await
            .unwrap();
        ContextService::add_meeting_to_context(&pool, &context.id, "meeting-old")
            .await
            .unwrap();
        ContextService::add_meeting_to_context(&pool, &context.id, "meeting-mid")
            .await
            .unwrap();

        let meetings = ContextService::list_meetings_for_context(&pool, &context.id)
            .await
            .unwrap();
        let ids: Vec<&str> = meetings.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, vec!["meeting-old", "meeting-mid", "meeting-new"]);
    }

    #[tokio::test]
    async fn invalid_identifiers_are_rejected() {
        let pool = test_pool().await;
        let context = ContextService::create_context(&pool, "C", None)
            .await
            .unwrap();

        assert!(matches!(
            ContextService::get_context(&pool, "").await,
            Err(ContextError::InvalidContextId)
        ));
        assert!(matches!(
            ContextService::get_context(&pool, "   ").await,
            Err(ContextError::InvalidContextId)
        ));
        assert!(matches!(
            ContextService::delete_context(&pool, "").await,
            Err(ContextError::InvalidContextId)
        ));
        assert!(matches!(
            ContextService::add_meeting_to_context(&pool, &context.id, "").await,
            Err(ContextError::InvalidMeetingId)
        ));
        assert!(matches!(
            ContextService::add_meeting_to_context(&pool, "", "meeting-1").await,
            Err(ContextError::InvalidContextId)
        ));
        assert!(matches!(
            ContextService::remove_meeting_from_context(&pool, &context.id, " ").await,
            Err(ContextError::InvalidMeetingId)
        ));
        assert!(matches!(
            ContextService::list_meetings_for_context(&pool, "").await,
            Err(ContextError::InvalidContextId)
        ));
    }

    #[tokio::test]
    async fn deleting_context_removes_its_memory_items_and_digest() {
        let pool = test_pool().await;
        let context = ContextService::create_context(&pool, "Memory", None)
            .await
            .unwrap();

        sqlx::query(
            "INSERT INTO context_memory_items
             (id, context_id, source_meeting_id, kind, content, status, created_at, updated_at)
             VALUES ('cmi-1', ?, NULL, 'fact', 'derived', NULL, ?, ?)",
        )
        .bind(&context.id)
        .bind(Utc::now().to_rfc3339())
        .bind(Utc::now().to_rfc3339())
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE contexts SET memory_markdown = '# digest' WHERE id = ?")
            .bind(&context.id)
            .execute(&pool)
            .await
            .unwrap();

        ContextService::delete_context(&pool, &context.id)
            .await
            .unwrap();

        // Contract §6: thread deleted -> memory items and links deleted; meetings survive.
        let (items,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM context_memory_items WHERE context_id = ?")
                .bind(&context.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(items, 0);
        assert_eq!(link_count(&pool, &context.id).await, 0);
        assert!(ContextService::get_context(&pool, &context.id)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn context_metadata_exposes_stored_memory_digest() {
        let pool = test_pool().await;
        let context = ContextService::create_context(&pool, "Memory", None)
            .await
            .unwrap();
        assert_eq!(context.memory_markdown, "");

        sqlx::query("UPDATE contexts SET memory_markdown = '# digest' WHERE id = ?")
            .bind(&context.id)
            .execute(&pool)
            .await
            .unwrap();

        let fetched = ContextService::get_context(&pool, &context.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(fetched.memory_markdown, "# digest");
    }

    #[tokio::test]
    async fn deleting_meeting_cascades_to_context_links_only() {
        let pool = test_pool().await;
        insert_meeting(&pool, "meeting-1", "M1", Utc::now()).await;
        insert_meeting(&pool, "meeting-2", "M2", Utc::now()).await;
        let context = ContextService::create_context(&pool, "C", None)
            .await
            .unwrap();
        ContextService::add_meeting_to_context(&pool, &context.id, "meeting-1")
            .await
            .unwrap();
        ContextService::add_meeting_to_context(&pool, &context.id, "meeting-2")
            .await
            .unwrap();

        sqlx::query("DELETE FROM meetings WHERE id = ?")
            .bind("meeting-1")
            .execute(&pool)
            .await
            .unwrap();

        // Link to the deleted meeting is gone (cascade); context and other link survive
        let meetings = ContextService::list_meetings_for_context(&pool, &context.id)
            .await
            .unwrap();
        assert_eq!(meetings.len(), 1);
        assert_eq!(meetings[0].id, "meeting-2");

        let contexts = ContextService::list_contexts(&pool).await.unwrap();
        assert_eq!(contexts.len(), 1);
        assert_eq!(contexts[0].meeting_count, 1);
    }

    #[tokio::test]
    async fn validation_limits_accept_boundary_values() {
        let pool = test_pool().await;
        let max_name = "x".repeat(MAX_CONTEXT_NAME_LENGTH);
        let context = ContextService::create_context(&pool, &max_name, None)
            .await
            .unwrap();
        assert_eq!(context.name.chars().count(), MAX_CONTEXT_NAME_LENGTH);
    }

    #[tokio::test]
    async fn rebuild_without_configured_model_preserves_existing_memory() {
        let pool = test_pool().await;
        let context = ContextService::create_context(&pool, "Rebuild Test", None)
            .await
            .unwrap();
        ContextMemoryItemsRepository::add_item(
            &pool,
            &context.id,
            "decision",
            "Use Rust for the persistence layer",
            None,
            None,
        )
        .await
        .unwrap();

        // No summary model configured -> rebuild must fail...
        let result = ContextService::rebuild_context_memory(&pool, None, &context.id).await;
        assert!(result.is_err(), "rebuild without a model must fail");

        // ...and the previous memory must remain completely intact.
        let items = ContextMemoryItemsRepository::list_for_context(&pool, &context.id)
            .await
            .unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].content, "Use Rust for the persistence layer");
    }

    #[tokio::test]
    async fn rebuild_unknown_context_fails_cleanly() {
        let pool = test_pool().await;
        let result = ContextService::rebuild_context_memory(&pool, None, "context-missing").await;
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("not found"),
            "unknown context must report a not-found error"
        );
    }
}
