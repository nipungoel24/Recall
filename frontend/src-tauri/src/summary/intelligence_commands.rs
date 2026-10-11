//! Meeting Intelligence Tauri commands (Phase 5)
//!
//! These commands expose the structured Meeting Intelligence API to the frontend.

use crate::database::repositories::meeting_intelligence::MeetingIntelligenceRepository;
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
#[serde(rename_all = "camelCase")]
pub struct GenerateIntelligenceRequest {
    // Tauri v2 camelCases the TOP-LEVEL argument key (`request`), but the value
    // is deserialized by serde verbatim -- nested keys are NOT transformed.
    // Without the container-level `rename_all` above, the frontend's
    // `{meetingId, customPrompt, templateId}` failed with `missing field
    // meeting_id` and the entire command was unreachable.
    pub meeting_id: String,
    #[serde(default)]
    pub custom_prompt: Option<String>,
    #[serde(default)]
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
) -> Result<GenerateIntelligenceResponse, String> {
    let pool = state.db_manager.pool().clone();
    let meeting_id = request.meeting_id.clone();

    // Fetch meeting transcripts
    let transcripts =
        crate::database::repositories::meeting::MeetingsRepository::get_meeting(&pool, &meeting_id)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Meeting not found: {}", meeting_id))?;

    if transcripts.transcripts.is_empty() {
        return Err("Meeting has no transcripts".to_string());
    }

    // Build the evidence catalog from this meeting's own transcript rows.
    //
    // The id used to be discarded here and replaced with plain joined text, so
    // the model was asked for segment ids it had never seen.
    let rows: Vec<(String, String, Option<f64>)> = transcripts
        .transcripts
        .iter()
        .map(|t| (t.id.clone(), t.text.clone(), t.audio_start_time))
        .collect();
    let evidence = crate::summary::intelligence_evidence::EvidenceCatalog::build(&rows);

    if evidence.is_empty() {
        return Err("Meeting has no usable transcript segments to analyse".to_string());
    }

    // Get model config
    let model_config = crate::api::api_get_model_config(app.clone(), state, None)
        .await?
        .ok_or_else(|| {
            "No model configuration found. Please configure a model in settings.".to_string()
        })?;

    // Load template
    let template = crate::summary::templates::get_template(
        request.template_id.as_deref().unwrap_or("standard_meeting"),
    )
    .map_err(|e| format!("Template not found: {}", e))?;

    // Generate structured intelligence using the existing summary infrastructure
    crate::summary::service::generate_structured_intelligence(
        app,
        pool.clone(),
        meeting_id.clone(),
        evidence,
        model_config.provider,
        model_config.model,
        template,
        request.custom_prompt,
        vec![], // context_ids - can be added later
    )
    .await
    .map_err(|e| format!("Intelligence generation failed: {}", e))?;

    // Return the PERSISTED rows rather than the raw model output.
    //
    // The response previously wrapped the raw generation under an
    // `intelligence` key while the frontend read top-level `abstract_text` and
    // item arrays, so `result.topics.map` threw a TypeError and the user saw a
    // generic failure banner. Reading back what was stored guarantees generate
    // and get return the same shape, with real ids and resolved sources.
    let record = MeetingIntelligenceRepository::get_intelligence(&pool, &meeting_id)
        .await
        .map_err(|e| e.to_string())?;

    let items = load_intelligence_items(&pool, &meeting_id).await?;

    // Partition once into owned groups rather than filtering the same vector
    // repeatedly (each `into_iter()` would consume it).
    let mut topics = Vec::new();
    let mut decisions = Vec::new();
    let mut actions = Vec::new();
    let mut questions = Vec::new();
    let mut facts = Vec::new();
    let mut follow_ups = Vec::new();
    for item in items {
        match item.kind.as_str() {
            "topic" => topics.push(item),
            "decision" => decisions.push(item),
            "action" => actions.push(item),
            "question" => questions.push(item),
            "fact" => facts.push(item),
            "follow_up" => follow_ups.push(item),
            _ => {}
        }
    }

    Ok(GenerateIntelligenceResponse {
        meeting_id: meeting_id.clone(),
        abstract_text: record.and_then(|r| r.abstract_text).unwrap_or_default(),
        topics,
        decisions,
        actions,
        questions,
        facts,
        follow_ups,
    })
}

/// Response shape for `api_generate_meeting_intelligence`.
///
/// Flat, and identical in shape to what `api_get_meeting_intelligence` +
/// `api_get_meeting_intelligence_items` return together, so the frontend maps
/// one type.
#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateIntelligenceResponse {
    pub meeting_id: String,
    pub abstract_text: String,
    pub topics: Vec<IntelligenceItemResponse>,
    pub decisions: Vec<IntelligenceItemResponse>,
    pub actions: Vec<IntelligenceItemResponse>,
    pub questions: Vec<IntelligenceItemResponse>,
    pub facts: Vec<IntelligenceItemResponse>,
    pub follow_ups: Vec<IntelligenceItemResponse>,
}

/// Load a meeting's intelligence items with their sources attached.
async fn load_intelligence_items(
    pool: &sqlx::SqlitePool,
    meeting_id: &str,
) -> Result<Vec<IntelligenceItemResponse>, String> {
    let items = MeetingIntelligenceRepository::get_items(pool, meeting_id)
        .await
        .map_err(|e| e.to_string())?;
    let sources = MeetingIntelligenceRepository::get_sources_for_meeting(pool, meeting_id)
        .await
        .map_err(|e| e.to_string())?;

    let mut sources_by_item: std::collections::HashMap<String, Vec<IntelligenceSourceResponse>> =
        std::collections::HashMap::new();
    for src in sources {
        sources_by_item
            .entry(src.item_id.clone())
            .or_default()
            .push(IntelligenceSourceResponse {
                id: src.id,
                item_id: src.item_id,
                transcript_segment_id: src.transcript_segment_id,
                meeting_id: src.meeting_id,
            });
    }

    Ok(items
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
        .collect())
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
///
/// # Ordering contract
///
/// The rendered transcript list and this query MUST agree, or the viewport
/// lands on one row while a different row is highlighted. The previous version
/// decoded `audio_start_time` as a non-nullable `f64`, so any segment recorded
/// before audio-sync timestamps existed raised a decode error and evidence
/// navigation reported "failed to navigate" for a perfectly valid segment.
///
/// Segments without a timestamp sort first (as 0), matching the frontend's
/// `(a.audio_start_time ?? 0)`, and ties break on segment id so the ordering is
/// total and deterministic.
#[tauri::command]
pub async fn api_get_transcript_segment_position<R: Runtime>(
    _app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    meeting_id: String,
    segment_id: String,
) -> Result<Option<TranscriptSegmentPosition>, String> {
    let pool = state.db_manager.pool();

    // Confirm the segment exists in this meeting before computing a position.
    let exists: Option<(String,)> =
        sqlx::query_as("SELECT id FROM transcripts WHERE id = ? AND meeting_id = ?")
            .bind(&segment_id)
            .bind(&meeting_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;

    if exists.is_none() {
        return Ok(None);
    }

    // Position = how many segments sort strictly before the target, using the
    // same total ordering as the rendered list.
    let position: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*) FROM transcripts
        WHERE meeting_id = ?
          AND (
                COALESCE(audio_start_time, 0.0) < COALESCE(
                        (SELECT audio_start_time FROM transcripts
                         WHERE id = ? AND meeting_id = ?), 0.0)
                OR (
                    COALESCE(audio_start_time, 0.0) = COALESCE(
                        (SELECT audio_start_time FROM transcripts
                         WHERE id = ? AND meeting_id = ?), 0.0)
                    AND id < ?
                )
          )
        "#,
    )
    .bind(&meeting_id)
    .bind(&segment_id)
    .bind(&meeting_id)
    .bind(&segment_id)
    .bind(&meeting_id)
    .bind(&segment_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Total count for the meeting
    let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM transcripts WHERE meeting_id = ?")
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
    pub position: i64,    // 0-based index
    pub total_count: i64, // total segments in meeting
}
