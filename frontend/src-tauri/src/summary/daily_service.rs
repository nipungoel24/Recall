//! Daily Brief service: orchestrates the derived daily summary flow.
//!
//! Source meetings are loaded from the database, verified to belong to the
//! requested local calendar day, ordered chronologically, and handed to the
//! daily brief pipeline. Results are persisted ONLY to the `daily_summaries`
//! table; source meeting records and their `summary_processes` rows are never
//! modified.

use crate::database::repositories::{
    daily_summary::DailySummariesRepository, meeting::MeetingsRepository,
};
use crate::summary::daily_brief::{
    generate_daily_brief, meeting_matches_date, sort_meeting_units, DailyBriefSourceMeeting,
    MeetingUnit,
};
use crate::summary::language_detection::detect_summary_language;
use crate::summary::service::{
    resolve_provider_runtime_config, stable_text_fingerprint, SummaryService,
};
use crate::summary::templates;
use sqlx::SqlitePool;
use std::time::Instant;
use tauri::{AppHandle, Manager, Runtime};
use tokio_util::sync::CancellationToken;
use tracing::{error, info};

/// Cancellation-registry key used for a daily brief run.
pub(crate) fn daily_cancel_key(date_key: &str) -> String {
    format!("daily-brief:{}", date_key)
}

/// Cap per-meeting text fed into language detection.
const LANGUAGE_DETECTION_CHAR_CAP: usize = 4000;

pub struct DailyBriefService;

impl DailyBriefService {
    /// Cancels an in-flight daily brief generation for the given day.
    pub fn cancel(date_key: &str) -> bool {
        SummaryService::cancel_summary(&daily_cancel_key(date_key))
    }

    /// Resolves the meeting ids that belong to the requested local calendar
    /// day from the database (used when the caller does not pass explicit
    /// meeting ids). Returned in chronological order.
    pub async fn resolve_meeting_ids_for_date(
        pool: &SqlitePool,
        date_key: &str,
    ) -> Result<Vec<String>, String> {
        let meetings = MeetingsRepository::get_meetings(pool)
            .await
            .map_err(|e| format!("Failed to load meetings: {}", e))?;

        let mut matches: Vec<(String, String)> = Vec::new();
        for meeting in meetings {
            let started_at = meeting.created_at.0.to_rfc3339();
            if meeting_matches_date(&started_at, date_key)? {
                matches.push((meeting.id, started_at));
            }
        }
        matches.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
        Ok(matches.into_iter().map(|(id, _)| id).collect())
    }

    /// Verifies that a meeting exists and belongs to the requested day.
    ///
    /// Arbitrary meeting ids are never trusted: a meeting whose stored
    /// timestamp falls outside the requested local calendar day is rejected.
    pub async fn verify_meeting_belongs_to_date(
        pool: &SqlitePool,
        meeting_id: &str,
        date_key: &str,
    ) -> Result<(), String> {
        let meeting = MeetingsRepository::get_meeting_metadata(pool, meeting_id)
            .await
            .map_err(|e| format!("Failed to load meeting metadata for {}: {}", meeting_id, e))?
            .ok_or_else(|| format!("Meeting not found: {}", meeting_id))?;

        let started_at = meeting.created_at.0.to_rfc3339();
        match meeting_matches_date(&started_at, date_key) {
            Ok(true) => Ok(()),
            Ok(false) => Err(format!(
                "Meeting '{}' ({}) did not occur on {}; refusing to include it in the daily brief.",
                meeting.title, meeting_id, date_key
            )),
            Err(e) => Err(format!(
                "Meeting '{}' has an unparseable timestamp: {}",
                meeting_id, e
            )),
        }
    }

    /// Computes a stable fingerprint over the source meeting set so callers
    /// can detect whether the day's meetings changed since the last brief.
    pub async fn compute_source_fingerprint(pool: &SqlitePool, meeting_ids: &[String]) -> String {
        let mut parts = Vec::new();
        for id in meeting_ids {
            if let Ok(Some(meeting)) = MeetingsRepository::get_meeting_metadata(pool, id).await {
                parts.push(format!(
                    "{}|{}|{}",
                    meeting.id,
                    meeting.created_at.0.to_rfc3339(),
                    meeting.updated_at.0.to_rfc3339()
                ));
            }
        }
        parts.sort();
        stable_text_fingerprint(&parts.join(";"))
    }

    /// Processes the daily brief in the background and persists the outcome.
    ///
    /// Designed to be spawned as an async task, mirroring
    /// `SummaryService::process_transcript_background`.
    #[allow(clippy::too_many_arguments)]
    pub async fn process_daily_background<R: Runtime>(
        app: AppHandle<R>,
        pool: SqlitePool,
        date_key: String,
        meeting_ids: Vec<String>,
        model_provider: String,
        model_name: String,
        custom_prompt: String,
        template_id: String,
        summary_language: Option<String>,
    ) {
        let start_time = Instant::now();
        let cancel_key = daily_cancel_key(&date_key);
        info!(
            "Starting daily brief background processing for {} ({} meeting(s))",
            date_key,
            meeting_ids.len()
        );
        let cancellation_token = SummaryService::register_cancellation_token(&cancel_key);

        let result = Self::run_pipeline(
            &app,
            &pool,
            &date_key,
            &meeting_ids,
            &model_provider,
            &model_name,
            &custom_prompt,
            &template_id,
            summary_language.as_deref(),
            Some(&cancellation_token),
        )
        .await;

        let duration = start_time.elapsed().as_secs_f64();
        SummaryService::cleanup_cancellation_token(&cancel_key);

        match result {
            Ok((final_markdown, provenance, num_units)) => {
                info!(
                    "Daily brief for {} completed from {} meeting(s) in {:.2}s",
                    date_key,
                    provenance.len(),
                    duration
                );
                let result_json = serde_json::json!({
                    "markdown": final_markdown,
                    "date": date_key,
                    "source_meetings": provenance,
                });
                if let Err(e) = DailySummariesRepository::update_daily_completed(
                    &pool,
                    &date_key,
                    result_json,
                    num_units,
                    duration,
                )
                .await
                {
                    error!(
                        "Failed to save completed daily brief for {}: {}",
                        date_key, e
                    );
                } else {
                    info!("Daily brief saved successfully for {}", date_key);
                }
            }
            Err(e) => {
                if e.contains("cancelled") {
                    info!("Daily brief generation was cancelled for {}", date_key);
                    if let Err(db_err) =
                        DailySummariesRepository::update_daily_cancelled(&pool, &date_key).await
                    {
                        error!(
                            "Failed to update daily brief status to cancelled for {}: {}",
                            date_key, db_err
                        );
                    }
                } else {
                    error!("Daily brief processing failed for {}: {}", date_key, e);
                    if let Err(db_err) =
                        DailySummariesRepository::update_daily_failed(&pool, &date_key, &e).await
                    {
                        error!(
                            "Failed to update daily brief status to failed for {}: {}",
                            date_key, db_err
                        );
                    }
                }
            }
        }
    }

    /// Core pipeline factored out of the background task for testability.
    ///
    /// # Returns
    /// Tuple of (final_markdown, source_meetings_provenance, unit_count).
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn run_pipeline<R: Runtime>(
        app: &AppHandle<R>,
        pool: &SqlitePool,
        date_key: &str,
        meeting_ids: &[String],
        model_provider: &str,
        model_name: &str,
        custom_prompt: &str,
        template_id: &str,
        summary_language: Option<&str>,
        cancellation_token: Option<&CancellationToken>,
    ) -> Result<(String, Vec<DailyBriefSourceMeeting>, i64), String> {
        if meeting_ids.is_empty() {
            return Err(format!(
                "No meetings provided for the daily brief on {}.",
                date_key
            ));
        }

        let provider_config =
            resolve_provider_runtime_config(pool, model_provider, model_name).await?;

        let template = templates::get_template(template_id)?;

        // Load and verify every source meeting; transcripts ordered by audio
        // start time within each meeting.
        let mut units: Vec<MeetingUnit> = Vec::new();
        for id in meeting_ids {
            let meeting = MeetingsRepository::get_meeting_metadata(pool, id)
                .await
                .map_err(|e| format!("Failed to load meeting metadata for {}: {}", id, e))?
                .ok_or_else(|| format!("Meeting not found: {}", id))?;

            let started_at = meeting.created_at.0.to_rfc3339();
            match meeting_matches_date(&started_at, date_key) {
                Ok(true) => {}
                Ok(false) => {
                    return Err(format!(
                        "Meeting '{}' ({}) did not occur on {}; refusing to include it in the daily brief.",
                        meeting.title, id, date_key
                    ));
                }
                Err(e) => {
                    return Err(format!(
                        "Meeting '{}' has an unparseable timestamp: {}",
                        id, e
                    ));
                }
            }

            let (transcripts, _) =
                MeetingsRepository::get_meeting_transcripts_paginated(pool, id, i64::MAX, 0)
                    .await
                    .map_err(|e| format!("Failed to load transcripts for {}: {}", id, e))?;

            let transcript = if transcripts.is_empty() {
                "(No transcript recorded for this meeting.)".to_string()
            } else {
                transcripts
                    .iter()
                    .map(|t| t.transcript.clone())
                    .collect::<Vec<_>>()
                    .join("\n")
            };

            units.push(MeetingUnit {
                id: id.clone(),
                title: meeting.title.clone(),
                started_at,
                transcript,
            });
        }

        // Chronological day order; provenance mirrors the final order so the
        // frontend can explain where each part of the brief came from.
        sort_meeting_units(&mut units);
        let provenance: Vec<DailyBriefSourceMeeting> = units
            .iter()
            .map(|u| DailyBriefSourceMeeting {
                id: u.id.clone(),
                title: u.title.clone(),
                started_at: u.started_at.clone(),
            })
            .collect();

        let detection_texts: Vec<String> = units
            .iter()
            .map(|u| {
                u.transcript
                    .chars()
                    .take(LANGUAGE_DETECTION_CHAR_CAP)
                    .collect()
            })
            .collect();
        let detected_language = detect_summary_language(&detection_texts).language;
        if let Some(code) = &detected_language {
            info!("Detected daily brief transcript language: {}", code);
        }

        let app_data_dir = app.path().app_data_dir().ok();
        let client = reqwest::Client::new();

        generate_daily_brief(
            &client,
            &provider_config.provider,
            model_name,
            &provider_config.api_key,
            date_key,
            &units,
            template_id,
            &template,
            custom_prompt,
            provider_config.token_threshold,
            provider_config.ollama_endpoint.as_deref(),
            provider_config.custom_openai_endpoint.as_deref(),
            provider_config.custom_openai_max_tokens,
            provider_config.custom_openai_temperature,
            provider_config.custom_openai_top_p,
            app_data_dir.as_ref(),
            cancellation_token,
            summary_language,
            detected_language.as_deref(),
        )
        .await
        .map(|(markdown, count)| (markdown, provenance, count))
    }
}
