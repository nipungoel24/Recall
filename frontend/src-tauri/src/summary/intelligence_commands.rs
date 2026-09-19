//! Meeting Intelligence Tauri commands (Phase 5)
//!
//! These commands expose the structured Meeting Intelligence API to the frontend.

use crate::database::repositories::meeting_intelligence::{
    MeetingIntelligenceRepository, NewIntelligenceItem,
};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use tauri::{Runtime, State};

#[derive(Debug, Serialize, Deserialize)]
pub struct MeetingIntelligenceResponse {
    pub meeting_id: String,
    pub abstract_text: Option<String>,
    pub schema_version: i64,
    pub generated_at: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IntelligenceItemResponse {
    pub id: String,
    pub meeting_id: String,
    pub kind: String,
    pub text: String,
    pub ordering: i64,
    pub confidence: Option<f64>,
    pub owner: Option<String>,
    pub due_date: Option<String>,
    pub status: Option<String>,
    pub sources: Vec<IntelligenceSourceResponse>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IntelligenceSourceResponse {
    pub id: String,
    pub item_id: String,
    pub transcript_segment_id: String,
    pub meeting_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IntelligenceItemSourceRequest {
    pub item_id: String,
    pub transcript_segment_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateIntelligenceRequest {
    pub meeting_id: String,
    pub custom_prompt: Option<String>,
    pub template_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IntelligenceItemRequest {
    pub kind: String,
    pub text: String,
    pub confidence: Option<f64>,
    pub owner: Option<String>,
    pub due_date: Option<String>,
    pub status: Option<String>,
    pub sources: Vec<String>,
}

/// Get the intelligence record for a meeting
#[tauri::command]
pub async fn api_get_meeting_intelligence<R: Runtime>(
    _app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    meeting_id: String,
) -> Result<Option<MeetingIntelligenceResponse>, String> {
    let pool = state.db_manager.pool();
    let intelligence = MeetingIntelligenceRepository::get_intelligence(pool, &meeting_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(intelligence.map(|i| MeetingIntelligenceResponse {
        meeting_id: i.meeting_id,
        abstract_text: i.abstract_text,
        schema_version: i.schema_version,
        generated_at: i.generated_at,
        provider: i.provider,
        model: i.model,
    }))
}

/// Get all intelligence items for a meeting with their sources
#[tauri::command]
pub async fn api_get_meeting_intelligence_items<R: Runtime>(
    _app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    meeting_id: String,
) -> Result<Vec<IntelligenceItemResponse>, String> {
    let pool = state.db_manager.pool();

    let items = MeetingIntelligenceRepository::get_items(pool, &meeting_id)
        .await
        .map_err(|e| e.to_string())?;

    let sources = MeetingIntelligenceRepository::get_sources_for_meeting(pool, &meeting_id)
        .await
        .map_err(|e| e.to_string())?;

    // Group sources by item_id
    let mut sources_by_item: std::collections::HashMap<String, Vec<IntelligenceSourceResponse>> =
        std::collections::HashMap::new();
    for src in sources {
        let response = IntelligenceSourceResponse {
            id: src.id,
            item_id: src.item_id.clone(),
            transcript_segment_id: src.transcript_segment_id,
            meeting_id: src.meeting_id,
        };
        sources_by_item
            .entry(src.item_id)
            .or_default()
            .push(response);
    }

    let response: Vec<IntelligenceItemResponse> = items
        .into_iter()
        .map(|item| {
            let item_id = item.id.clone();
            IntelligenceItemResponse {
                id: item.id,
                meeting_id: item.meeting_id,
                kind: item.kind,
                text: item.text,
                ordering: item.ordering,
                confidence: item.confidence,
                owner: item.owner,
                due_date: item.due_date,
                status: item.status,
                sources: sources_by_item.remove(&item_id).unwrap_or_default(),
            }
        })
        .collect();

    Ok(response)
}

/// Generate structured intelligence for a meeting (AI-powered)
#[tauri::command]
pub async fn api_generate_meeting_intelligence<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    request: GenerateIntelligenceRequest,
) -> Result<serde_json::Value, String> {
    use crate::summary::service::SummaryService;

    let pool = state.db_manager.pool().clone();
    let meeting_id = request.meeting_id.clone();

    // Fetch meeting transcripts
    let transcripts = crate::database::repositories::meeting::MeetingsRepository::get_meeting(
        &pool,
        &meeting_id,
    )
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("Meeting not found: {}", meeting_id))?;

    if transcripts.transcripts.is_empty() {
        return Err("Meeting has no transcripts".to_string());
    }

    // Build transcript text
    let transcript_text = transcripts
        .transcripts
        .iter()
        .map(|t| t.text.clone())
        .collect::<Vec<_>>()
        .join("\n");

    // Get model config
    let model_config = crate::api::api_get_model_config(app.clone(), state, None).await?
        .ok_or_else(|| "No model configuration found. Please configure a model in settings.".to_string())?;

    // Load template
    let template = crate::summary::templates::get_template(
        request.template_id.as_deref().unwrap_or("standard_meeting")
    )
        .map_err(|e| format!("Template not found: {}", e))?;

    // Generate structured intelligence using the existing summary infrastructure
    let intelligence = crate::summary::service::generate_structured_intelligence(
        app,
        pool.clone(),
        meeting_id.clone(),
        transcript_text,
        model_config.provider,
        model_config.model,
        template,
        request.custom_prompt,
        vec![], // context_ids - can be added later
    )
    .await
    .map_err(|e| format!("Intelligence generation failed: {}", e))?;

    Ok(serde_json::json!({
        "meeting_id": meeting_id,
        "intelligence": intelligence
    }))
}

/// Get transcript segment by ID (for evidence navigation)
#[tauri::command]
pub async fn api_get_transcript_segment<R: Runtime>(
    _app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    segment_id: String,
) -> Result<Option<crate::database::models::Transcript>, String> {
    let pool = state.db_manager.pool();

    let segment = sqlx::query_as::<_, crate::database::models::Transcript>(
        "SELECT * FROM transcripts WHERE id = ?",
    )
    .bind(&segment_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(segment)
}

/// Get transcript position/index for a segment within a meeting (for evidence navigation)
#[tauri::command]
pub async fn api_get_transcript_segment_position<R: Runtime>(
    _app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    meeting_id: String,
    segment_id: String,
) -> Result<Option<TranscriptSegmentPosition>, String> {
    let pool = state.db_manager.pool();

    // Get the segment's audio_start_time first
    let segment: Option<(f64,)> = sqlx::query_as(
        "SELECT audio_start_time FROM transcripts WHERE id = ? AND meeting_id = ?",
    )
    .bind(&segment_id)
    .bind(&meeting_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    if segment.is_none() {
        return Ok(None);
    }

    let target_start = segment.unwrap().0;

    // Count how many segments come before this one in the same meeting
    let position: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM transcripts WHERE meeting_id = ? AND audio_start_time < ?",
    )
    .bind(&meeting_id)
    .bind(target_start)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Total count for the meeting
    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM transcripts WHERE meeting_id = ?",
    )
    .bind(&meeting_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(Some(TranscriptSegmentPosition {
        segment_id,
        meeting_id,
        position: position.0,
        total_count: total.0,
    }))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptSegmentPosition {
    pub segment_id: String,
    pub meeting_id: String,
    pub position: i64,      // 0-based index
    pub total_count: i64,   // total segments in meeting
}