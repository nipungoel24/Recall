//! Tauri command wrappers for Context Threads (contract §7.2).
//!
//! These are intentionally thin: all domain logic and validation lives in
//! [`super::service`], and all SQL lives in the repositories.
//! All functions are named with the canonical `api_` prefix per contract §7.2.

use serde_json::json;
use tauri::State;

use crate::{
    context::model::{CompactContextMemory, ContextMemoryItemView},
    contexts::service::ContextService,
    database::{
        models::{ContextMeetingModel, ContextModel, ContextSummaryModel},
        repositories::context_memory_items::{ContextMemoryItemRow, ContextMemoryItemsRepository},
    },
    state::AppState,
};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextThreadSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub meeting_count: i64,
    pub memory_item_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextThreadDetail {
    pub id: String,
    pub name: String,
    pub description: String,
    pub memory_markdown: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextMeetingInfo {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<f64>,
}

impl From<ContextSummaryModel> for ContextThreadSummary {
    fn from(m: ContextSummaryModel) -> Self {
        Self {
            id: m.id,
            name: m.name,
            description: m.description.unwrap_or_default(),
            meeting_count: m.meeting_count,
            memory_item_count: m.memory_item_count,
            created_at: m.created_at.0.to_rfc3339(),
            updated_at: m.updated_at.0.to_rfc3339(),
        }
    }
}

impl From<ContextModel> for ContextThreadDetail {
    fn from(m: ContextModel) -> Self {
        Self {
            id: m.id,
            name: m.name,
            description: m.description.unwrap_or_default(),
            memory_markdown: m.memory_markdown,
            created_at: m.created_at.0.to_rfc3339(),
            updated_at: m.updated_at.0.to_rfc3339(),
        }
    }
}

impl From<ContextMeetingModel> for ContextMeetingInfo {
    fn from(m: ContextMeetingModel) -> Self {
        let mut duration_seconds = m.last_end.filter(|&v| v > 0.0);
        if duration_seconds.is_none() {
            duration_seconds = m.seg_sum.filter(|&v| v > 0.0);
        }

        Self {
            id: m.id,
            title: m.title,
            created_at: m.created_at.0.to_rfc3339(),
            updated_at: m.updated_at.0.to_rfc3339(),
            folder_path: m.folder_path,
            duration_seconds,
        }
    }
}

// Convert from ContextMemoryItemRow to ContextMemoryItemView
impl From<ContextMemoryItemRow> for ContextMemoryItemView {
    fn from(row: ContextMemoryItemRow) -> Self {
        Self {
            id: row.id,
            context_id: row.context_id,
            source_meeting_id: row.source_meeting_id,
            source_meeting_title: None, // Only set via join query
            kind: row.kind,
            content: row.content,
            status: row.status,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

// ── §7.2: Context thread CRUD ─────────────────────────────────────────────────

#[tauri::command]
pub async fn api_list_context_threads(
    state: State<'_, AppState>,
) -> Result<Vec<ContextThreadSummary>, String> {
    let pool = state.db_manager.pool();
    ContextService::list_contexts(pool)
        .await
        .map(|list| list.into_iter().map(Into::into).collect())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_get_context_thread(
    state: State<'_, AppState>,
    context_id: String,
) -> Result<ContextThreadDetail, String> {
    let pool = state.db_manager.pool();
    ContextService::get_context(pool, &context_id)
        .await
        .map_err(|e| e.to_string())
        .and_then(|opt| {
            opt.map(Into::into)
                .ok_or_else(|| format!("Context {} not found", context_id))
        })
}

#[tauri::command]
pub async fn api_create_context_thread(
    state: State<'_, AppState>,
    name: String,
    description: Option<String>,
) -> Result<ContextThreadDetail, String> {
    let pool = state.db_manager.pool();
    ContextService::create_context(pool, &name, description.as_deref())
        .await
        .map(Into::into)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_update_context_thread(
    state: State<'_, AppState>,
    context_id: String,
    name: Option<String>,
    description: Option<String>,
    memory_markdown: Option<String>,
) -> Result<ContextThreadDetail, String> {
    let pool = state.db_manager.pool();
    // Since service takes name as non-optional, we need to fetch existing if name not provided
    let mut current = ContextService::get_context(pool, &context_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Context {} not found", context_id))?;

    let new_name = name.unwrap_or_else(|| current.name.clone());
    let new_desc = description.or(current.description.clone());

    if let Some(md) = memory_markdown {
        sqlx::query("UPDATE contexts SET memory_markdown = ?, updated_at = ? WHERE id = ?")
            .bind(md)
            .bind(chrono::Utc::now())
            .bind(&context_id)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
    }

    ContextService::update_context(pool, &context_id, &new_name, new_desc.as_deref())
        .await
        .map(Into::into)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_delete_context_thread(
    state: State<'_, AppState>,
    context_id: String,
) -> Result<serde_json::Value, String> {
    let pool = state.db_manager.pool();
    ContextService::delete_context(pool, &context_id)
        .await
        .map(|_| json!({"message": "Context thread deleted"}))
        .map_err(|e| e.to_string())
}

// ── §7.2: Context meeting membership ─────────────────────────────────────────

#[tauri::command]
pub async fn api_add_meeting_to_context(
    state: State<'_, AppState>,
    context_id: String,
    meeting_id: String,
) -> Result<serde_json::Value, String> {
    let pool = state.db_manager.pool();
    ContextService::add_meeting_to_context(pool, &context_id, &meeting_id)
        .await
        .map(|out| json!({"message": "Meeting added to context", "added": out.added}))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_remove_meeting_from_context(
    state: State<'_, AppState>,
    context_id: String,
    meeting_id: String,
) -> Result<serde_json::Value, String> {
    let pool = state.db_manager.pool();
    ContextService::remove_meeting_from_context(pool, &context_id, &meeting_id)
        .await
        .map(|out| json!({"message": "Meeting removed from context", "removed": out.removed}))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_get_context_meetings(
    state: State<'_, AppState>,
    context_id: String,
) -> Result<Vec<ContextMeetingInfo>, String> {
    let pool = state.db_manager.pool();
    ContextService::list_meetings_for_context(pool, &context_id)
        .await
        .map(|list| list.into_iter().map(Into::into).collect())
        .map_err(|e| e.to_string())
}

// ── §7.2: Context memory items ────────────────────────────────────────────────

#[tauri::command]
pub async fn api_get_context_memory(
    state: State<'_, AppState>,
    context_id: String,
) -> Result<Vec<ContextMemoryItemView>, String> {
    let pool = state.db_manager.pool();
    let rows = ContextMemoryItemsRepository::list_for_context_with_source(pool, &context_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|r| ContextMemoryItemView {
            id: r.item.id,
            context_id: r.item.context_id,
            source_meeting_id: r.item.source_meeting_id,
            source_meeting_title: r.source_meeting_title,
            kind: r.item.kind,
            content: r.item.content,
            status: r.item.status,
            created_at: r.item.created_at,
            updated_at: r.item.updated_at,
        })
        .collect())
}

#[tauri::command]
pub async fn api_add_context_memory_item(
    state: State<'_, AppState>,
    context_id: String,
    kind: String,
    content: String,
    source_meeting_id: Option<String>,
    status: Option<String>,
) -> Result<ContextMemoryItemView, String> {
    if context_id.trim().is_empty() {
        return Err("context_id must not be empty".to_string());
    }
    let valid_kinds = ["fact", "decision", "action", "question", "note"];
    if !valid_kinds.contains(&kind.trim()) {
        return Err(format!(
            "kind must be one of {:?}, got '{}'",
            valid_kinds, kind
        ));
    }
    if content.trim().is_empty() {
        return Err("content must not be empty".to_string());
    }

    let pool = state.db_manager.pool();
    ContextMemoryItemsRepository::add_item(
        pool,
        &context_id,
        kind.trim(),
        content.trim(),
        source_meeting_id.as_deref(),
        status.as_deref(),
    )
    .await
    .map(Into::into)
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_update_context_memory_item(
    state: State<'_, AppState>,
    item_id: String,
    kind: Option<String>,
    content: Option<String>,
    status: Option<String>,
) -> Result<ContextMemoryItemView, String> {
    if item_id.trim().is_empty() {
        return Err("item_id must not be empty".to_string());
    }

    let pool = state.db_manager.pool();
    let updated = ContextMemoryItemsRepository::update_item(
        pool,
        &item_id,
        kind.as_deref(),
        content.as_deref(),
        status.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())?;

    updated
        .map(Into::into)
        .ok_or_else(|| format!("Memory item '{}' not found", item_id))
}

#[tauri::command]
pub async fn api_delete_context_memory_item(
    state: State<'_, AppState>,
    item_id: String,
) -> Result<serde_json::Value, String> {
    if item_id.trim().is_empty() {
        return Err("item_id must not be empty".to_string());
    }

    let pool = state.db_manager.pool();
    ContextMemoryItemsRepository::delete_item(pool, &item_id)
        .await
        .map(|deleted| json!({"message": "Memory item deleted", "deleted": deleted}))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_get_compact_context_memory(
    state: State<'_, AppState>,
    context_id: String,
    max_items: Option<i64>,
) -> Result<CompactContextMemory, String> {
    if context_id.trim().is_empty() {
        return Err("context_id must not be empty".to_string());
    }

    let pool = state.db_manager.pool();
    crate::context::memory::get_compact_context_memory(pool, &context_id, max_items.unwrap_or(30))
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Context memory not found".to_string())
}
