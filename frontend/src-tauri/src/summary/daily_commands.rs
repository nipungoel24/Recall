//! Tauri commands for the Daily Brief / Daily Summary feature.

use crate::database::repositories::daily_summary::DailySummariesRepository;
use crate::state::AppState;
use crate::summary::daily_brief::{parse_date_key, DEFAULT_DAILY_TEMPLATE_ID};
use crate::summary::daily_service::DailyBriefService;
use crate::summary::templates;
use log::{error as log_error, info as log_info};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

#[derive(Debug, Serialize, Deserialize)]
pub struct DailyProcessResponse {
    pub message: String,
    #[serde(rename = "processId")]
    pub process_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DailySummaryResponse {
    pub status: String,
    pub date: String,
    #[serde(rename = "meetingIds")]
    pub meeting_ids: Vec<String>,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
}

/// Generates (or regenerates) the Daily Brief / Daily Summary for one calendar day.
#[tauri::command]
pub async fn api_generate_daily_summary<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    date: String,
    meeting_ids: Vec<String>,
    template_id: Option<String>,
    custom_prompt: Option<String>,
    summary_language: Option<String>,
    model: Option<String>,
    model_name: Option<String>,
) -> Result<DailyProcessResponse, String> {
    let date_key = date.trim().to_string();
    parse_date_key(&date_key)?;
    log_info!(
        "api_generate_daily_summary called for date: {}, meeting_ids: {:?}",
        date_key,
        meeting_ids
    );

    let pool = state.db_manager.pool().clone();

    // Reject concurrent generation for the same day.
    if let Some(existing) = DailySummariesRepository::get_daily_summary(&pool, &date_key)
        .await
        .map_err(|e| format!("Failed to check existing daily brief: {}", e))?
    {
        if existing.status.eq_ignore_ascii_case("pending")
            || existing.status.eq_ignore_ascii_case("processing")
        {
            return Err(format!(
                "A daily brief is already being generated for {}.",
                date_key
            ));
        }
    }

    let cleaned_ids: Vec<String> = meeting_ids
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    if cleaned_ids.is_empty() {
        return Err(format!("No meetings found for {}.", date_key));
    }

    // Verify each meeting belongs to the day.
    for id in &cleaned_ids {
        DailyBriefService::verify_meeting_belongs_to_date(&pool, id, &date_key).await?;
    }

    let final_template_id = template_id
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| DEFAULT_DAILY_TEMPLATE_ID.to_string());

    // Validate the template up-front so bad input fails fast.
    templates::get_template(&final_template_id)
        .map_err(|e| format!("Failed to load template '{}': {}", final_template_id, e))?;

    let (resolved_model, resolved_model_name) = match (model, model_name) {
        (Some(m), Some(mn)) => (m, mn),
        _ => {
            // Load settings
            let settings =
                crate::database::repositories::setting::SettingsRepository::get_model_config(&pool)
                    .await
                    .map_err(|e| format!("Failed to load settings: {}", e))?;
            match settings {
                Some(s) => (s.provider, s.model),
                None => return Err("No LLM settings configured".to_string()),
            }
        }
    };

    let source_fingerprint =
        DailyBriefService::compute_source_fingerprint(&pool, &cleaned_ids).await;
    let source_meeting_ids_json = serde_json::to_string(&cleaned_ids)
        .map_err(|e| format!("Failed to serialize meeting ids: {}", e))?;

    DailySummariesRepository::create_or_reset_daily(
        &pool,
        &date_key,
        &source_meeting_ids_json,
        &source_fingerprint,
    )
    .await
    .map_err(|e| format!("Failed to initialize daily brief process: {}", e))?;
    log_info!("Daily brief process initialized for date: {}", date_key);

    let final_prompt = custom_prompt.unwrap_or_default();
    let summary_language = summary_language.and_then(|s| {
        let t = s.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    });

    let date_key_clone = date_key.clone();
    let resolved_clone = cleaned_ids.clone();
    tauri::async_runtime::spawn(async move {
        DailyBriefService::process_daily_background(
            app,
            pool.clone(),
            date_key_clone,
            resolved_clone,
            resolved_model,
            resolved_model_name,
            final_prompt,
            final_template_id,
            summary_language,
        )
        .await;
    });

    log_info!("Daily brief background task spawned for date: {}", date_key);
    Ok(DailyProcessResponse {
        message: "Daily brief generation started".to_string(),
        process_id: date_key,
    })
}

/// Gets the Daily Summary status and data for one calendar day.
#[tauri::command]
pub async fn api_get_daily_summary<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    date: String,
) -> Result<DailySummaryResponse, String> {
    let date_key = date.trim().to_string();
    log_info!("api_get_daily_summary called for date: {}", date_key);
    let pool = state.db_manager.pool();

    match DailySummariesRepository::get_daily_summary(pool, &date_key).await {
        Ok(Some(process)) => {
            let data = process
                .result
                .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok());
            let meeting_ids =
                serde_json::from_str::<Vec<String>>(&process.meeting_ids).unwrap_or_default();
            Ok(DailySummaryResponse {
                status: process.status.to_lowercase(),
                date: date_key,
                meeting_ids,
                data,
                error: process.error,
                start: process.start_time.map(|t| t.to_rfc3339()),
                end: process.end_time.map(|t| t.to_rfc3339()),
            })
        }
        Ok(None) => Ok(DailySummaryResponse {
            status: "idle".to_string(),
            date: date_key,
            meeting_ids: Vec::new(),
            data: None,
            error: None,
            start: None,
            end: None,
        }),
        Err(e) => {
            log_error!("Error retrieving daily brief for {}: {}", date_key, e);
            Err(format!("Failed to retrieve daily brief: {}", e))
        }
    }
}

/// Cancels an ongoing daily summary generation for one calendar day.
#[tauri::command]
pub async fn api_cancel_daily_summary<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    date: String,
) -> Result<serde_json::Value, String> {
    let date_key = date.trim().to_string();
    log_info!("api_cancel_daily_summary called for date: {}", date_key);

    let cancelled = DailyBriefService::cancel(&date_key);
    if cancelled {
        let pool = state.db_manager.pool().clone();
        if let Err(e) = DailySummariesRepository::update_daily_cancelled(&pool, &date_key).await {
            log_error!(
                "Failed to update daily brief cancellation status for {}: {}",
                date_key,
                e
            );
            return Err(format!("Failed to update cancellation status: {}", e));
        }

        log_info!(
            "Successfully cancelled daily brief generation for date: {}",
            date_key
        );
        Ok(serde_json::json!({
            "message": "Daily brief generation cancelled successfully",
            "date": date_key,
        }))
    } else {
        log_info!(
            "No active daily brief generation found for date: {}",
            date_key
        );
        Ok(serde_json::json!({
            "message": "No active daily brief generation to cancel",
            "date": date_key,
        }))
    }
}
