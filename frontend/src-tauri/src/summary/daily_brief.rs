//! Daily Brief pipeline.
//!
//! A Daily Brief is a DERIVED artifact that synthesizes every meeting on one
//! calendar day into a single report. It never mutates source meeting
//! records, transcripts, or their `summary_processes` rows; persistence is
//! handled exclusively through the `daily_summaries` table.
//!
//! Token strategy (mirrors the per-meeting pipeline):
//! 1. If all meeting blocks fit the model context -> single final report pass.
//! 2. Otherwise condense each meeting separately (reusing `chunk_text` and
//!    the LLM summarizer), then synthesize.
//! 3. If condensed blocks still overflow, groups are packed WITHOUT ever
//!    splitting a meeting boundary and synthesized iteratively.
//! 4. If the document still overflows after reduction, fail loudly instead of
//!    dumping unlimited transcripts into the provider.

use crate::summary::llm_client::{generate_summary, LLMProvider};
use crate::summary::processor::{
    apply_final_language_policy, chunk_text, clean_llm_markdown_output, rough_token_count,
    ENGLISH_BASE_SUMMARY_INSTRUCTION,
};
use crate::summary::templates::Template;
use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

/// Default template used for daily briefs unless the caller picks one.
pub(crate) const DEFAULT_DAILY_TEMPLATE_ID: &str = "daily_brief";

/// Token budget reserved for prompt overhead when chunking/condensing.
pub(crate) const DAILY_PROMPT_OVERHEAD_TOKENS: usize = 300;

/// Maximum number of boundary-safe reduction iterations before failing.
pub(crate) const MAX_REDUCE_ITERATIONS: usize = 4;

/// Overlap (in tokens) used when chunking a single oversized meeting.
const CHUNK_OVERLAP_TOKENS: usize = 100;

/// Provenance record for one source meeting of a daily brief.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyBriefSourceMeeting {
    pub id: String,
    pub title: String,
    pub started_at: String,
}

/// A single source meeting resolved for the daily brief.
#[derive(Debug, Clone)]
pub(crate) struct MeetingUnit {
    pub id: String,
    pub title: String,
    pub started_at: String,
    pub transcript: String,
}

/// Token strategy selected for a daily brief generation run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BriefStrategy {
    /// All meetings fit in one provider pass.
    SinglePass,
    /// Meetings must be condensed before daily synthesis.
    Condense,
}

/// Decides between single-pass and condensation based on token counts.
pub(crate) fn plan_strategy(total_tokens: usize, threshold_tokens: usize) -> BriefStrategy {
    if total_tokens < threshold_tokens {
        BriefStrategy::SinglePass
    } else {
        BriefStrategy::Condense
    }
}

/// Escapes an attribute value for inclusion inside an XML-style tag.
pub(crate) fn escape_xml_attribute(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Renders one meeting as an explicit, bounded block. Meeting boundaries are
/// never removed: transcripts are never concatenated without source markers.
pub(crate) fn build_meeting_block(unit: &MeetingUnit) -> String {
    format!(
        "<meeting\n id=\"{}\"\n title=\"{}\"\n started_at=\"{}\"\n>\n{}\n</meeting>",
        escape_xml_attribute(&unit.id),
        escape_xml_attribute(&unit.title),
        escape_xml_attribute(&unit.started_at),
        unit.transcript
    )
}

/// Renders all meetings in order as one bounded document.
pub(crate) fn build_meetings_document(units: &[MeetingUnit]) -> String {
    units
        .iter()
        .map(build_meeting_block)
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Sorts meeting units chronologically by start time (stable on id).
pub(crate) fn sort_meeting_units(units: &mut [MeetingUnit]) {
    units.sort_by(|a, b| {
        a.started_at
            .cmp(&b.started_at)
            .then_with(|| a.id.cmp(&b.id))
    });
}

/// Parses and validates a calendar-day key (`YYYY-MM-DD`).
pub(crate) fn parse_date_key(date: &str) -> Result<NaiveDate, String> {
    let trimmed = date.trim();
    let has_canonical_shape = trimmed.len() == 10
        && trimmed.as_bytes().get(4) == Some(&b'-')
        && trimmed.as_bytes().get(7) == Some(&b'-')
        && trimmed
            .bytes()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit());

    if !has_canonical_shape {
        return Err(format!("Invalid date '{}': expected YYYY-MM-DD", date));
    }

    NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
        .map_err(|e| format!("Invalid date '{}': expected YYYY-MM-DD ({})", date, e))
}

/// Parses a meeting timestamp into UTC. Handles RFC 3339 as well as the
/// space-separated formats produced by sqlx/chrono (`YYYY-MM-DD HH:MM:SS[.f] UTC`).
fn parse_timestamp(timestamp: &str) -> Result<DateTime<Utc>, String> {
    let trimmed = timestamp.trim();

    if let Ok(dt) = DateTime::parse_from_rfc3339(trimmed) {
        return Ok(dt.with_timezone(&Utc));
    }

    // sqlx/chrono stores DateTime<Utc> as "YYYY-MM-DD HH:MM:SS[.f] UTC"
    let normalized = trimmed.replace(" UTC", "+00:00");
    if let Ok(dt) = DateTime::parse_from_str(&normalized, "%Y-%m-%d %H:%M:%S%.f %z") {
        return Ok(dt.with_timezone(&Utc));
    }

    if let Ok(naive) = NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%d %H:%M:%S%.f") {
        return Ok(DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc));
    }

    Err(format!("Unparseable meeting timestamp: '{}'", timestamp))
}

/// The local calendar day (in the user's timezone) for a stored timestamp.
pub(crate) fn local_date_of(timestamp: &str) -> Result<NaiveDate, String> {
    let utc = parse_timestamp(timestamp)?;
    Ok(utc.with_timezone(&chrono::Local).date_naive())
}

/// Verifies that a meeting's stored timestamp falls on the requested calendar
/// day in the user's local timezone.
pub(crate) fn meeting_matches_date(timestamp: &str, date_key: &str) -> Result<bool, String> {
    let date = parse_date_key(date_key)?;
    Ok(local_date_of(timestamp)? == date)
}

/// Packs blocks into groups that each fit `budget_tokens`, NEVER splitting a
/// single meeting block across groups (meeting boundaries are preserved).
pub(crate) fn pack_blocks_boundary_safe(
    blocks: &[String],
    budget_tokens: usize,
) -> Vec<Vec<String>> {
    let mut groups: Vec<Vec<String>> = Vec::new();
    let mut current: Vec<String> = Vec::new();
    let mut current_tokens = 0usize;

    for block in blocks {
        let tokens = rough_token_count(block);
        if !current.is_empty() && current_tokens + tokens > budget_tokens {
            groups.push(std::mem::take(&mut current));
            current_tokens = 0;
        }
        current.push(block.clone());
        current_tokens += tokens;
    }

    if !current.is_empty() {
        groups.push(current);
    }
    groups
}

fn build_daily_condense_user_prompt(block: &str) -> String {
    format!(
        "{ENGLISH_BASE_SUMMARY_INSTRUCTION}\n\nCondense the following meeting into a structured digest. Retain every decision, action item (with owner when stated), open question, risk, blocker, and key topic. Keep the meeting's identity; do not invent information.\n\n{block}\n\nReturn ONLY the condensed digest."
    )
}

const DAILY_CONDENSE_SYSTEM_PROMPT: &str = "You are an expert meeting summarizer. Produce a compact, information-dense digest of one meeting so it can later be synthesized with other meetings from the same day.";

fn build_daily_group_synthesis_user_prompt(blocks_text: &str) -> String {
    format!(
        "{ENGLISH_BASE_SUMMARY_INSTRUCTION}\n\nThe following are digests of meetings from one day. Combine them into a single dense digest that retains every decision, action item, question, risk, blocker, and theme, attributing each item to its source meeting.\n\n<meetings>\n{blocks_text}\n</meetings>"
    )
}

const DAILY_GROUP_SYNTHESIS_SYSTEM_PROMPT: &str =
    "You are an expert at synthesizing meeting digests.";

fn build_daily_report_system_prompt(
    section_instructions: &str,
    clean_template_markdown: &str,
) -> String {
    format!(
        r#"You are an expert executive meeting analyst. Generate a Daily Brief for one calendar day by filling in the provided Markdown template based on the source meetings.

**CRITICAL INSTRUCTIONS:**
1. {ENGLISH_BASE_SUMMARY_INSTRUCTION}
2. Only use information present in the source meetings; do not add or infer anything.
3. Each `<meeting>` block is a distinct source meeting. Never merge meeting boundaries or attribute information to the wrong meeting.
4. Attribute decisions, action items, questions, risks, and follow-ups to their source meeting title(s) wherever possible.
5. If a section has no relevant info, write "None noted for this day."
6. Output **only** the completed Markdown report.
7. If unsure about something, omit it.

**SECTION-SPECIFIC INSTRUCTIONS:**
{section_instructions}

<template>
{clean_template_markdown}
</template>"#
    )
}

fn build_daily_report_user_prompt(date_key: &str, document: &str, custom_prompt: &str) -> String {
    let mut prompt = format!(
        "The following meetings occurred on {date_key}. Their boundaries and identities must be preserved; every claim should reference its source meeting.\n\n<meetings>\n{document}\n</meetings>"
    );

    if !custom_prompt.is_empty() {
        prompt.push_str("\n\nUser Provided Context:\n\n<user_context>\n");
        prompt.push_str(custom_prompt);
        prompt.push_str("\n</user_context>");
    }

    prompt
}

#[allow(clippy::too_many_arguments)]
async fn generate_summary_call(
    client: &Client,
    provider: &LLMProvider,
    model_name: &str,
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
    ollama_endpoint: Option<&str>,
    custom_openai_endpoint: Option<&str>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
    app_data_dir: Option<&PathBuf>,
    cancellation_token: Option<&CancellationToken>,
) -> Result<String, String> {
    if let Some(token) = cancellation_token {
        if token.is_cancelled() {
            return Err("Summary generation was cancelled".to_string());
        }
    }

    generate_summary(
        client,
        provider,
        model_name,
        api_key,
        system_prompt,
        user_prompt,
        ollama_endpoint,
        custom_openai_endpoint,
        max_tokens,
        temperature,
        top_p,
        app_data_dir,
        cancellation_token,
    )
    .await
}

/// Condenses one meeting into a compact, bounded block.
///
/// Reuses the existing chunking/summarization pipeline for oversized
/// transcripts; small meetings pass through unchanged. The resulting block
/// preserves the original `<meeting ...>` boundary and attributes.
#[allow(clippy::too_many_arguments)]
async fn condense_meeting_block(
    client: &Client,
    provider: &LLMProvider,
    model_name: &str,
    api_key: &str,
    unit: &MeetingUnit,
    token_threshold: usize,
    ollama_endpoint: Option<&str>,
    custom_openai_endpoint: Option<&str>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
    app_data_dir: Option<&PathBuf>,
    cancellation_token: Option<&CancellationToken>,
) -> Result<String, String> {
    let content = if rough_token_count(&unit.transcript)
        < token_threshold.saturating_sub(DAILY_PROMPT_OVERHEAD_TOKENS)
    {
        unit.transcript.clone()
    } else {
        info!(
            "Daily brief: condensing oversized meeting '{}' ({} tokens)",
            unit.id,
            rough_token_count(&unit.transcript)
        );
        let chunk_budget = token_threshold
            .saturating_sub(DAILY_PROMPT_OVERHEAD_TOKENS)
            .max(1);
        let chunks = chunk_text(&unit.transcript, chunk_budget, CHUNK_OVERLAP_TOKENS);
        let num_chunks = chunks.len();
        let mut chunk_summaries = Vec::new();

        for (i, chunk) in chunks.iter().enumerate() {
            if let Some(token) = cancellation_token {
                if token.is_cancelled() {
                    return Err("Summary generation was cancelled".to_string());
                }
            }
            let prompt = build_daily_condense_user_prompt(chunk);
            match generate_summary_call(
                client,
                provider,
                model_name,
                api_key,
                DAILY_CONDENSE_SYSTEM_PROMPT,
                &prompt,
                ollama_endpoint,
                custom_openai_endpoint,
                max_tokens,
                temperature,
                top_p,
                app_data_dir,
                cancellation_token,
            )
            .await
            {
                Ok(summary) => chunk_summaries.push(summary),
                Err(e) => {
                    if e.contains("cancelled") {
                        return Err(e);
                    }
                    warn!(
                        "Failed condensing chunk {}/{} of meeting {}: {}",
                        i + 1,
                        num_chunks,
                        unit.id,
                        e
                    );
                }
            }
        }

        if chunk_summaries.is_empty() {
            return Err(format!(
                "Failed to condense meeting '{}': no chunks were processed successfully.",
                unit.id
            ));
        }

        if chunk_summaries.len() == 1 {
            chunk_summaries.remove(0)
        } else {
            generate_summary_call(
                client,
                provider,
                model_name,
                api_key,
                DAILY_GROUP_SYNTHESIS_SYSTEM_PROMPT,
                &build_daily_group_synthesis_user_prompt(&chunk_summaries.join("\n---\n")),
                ollama_endpoint,
                custom_openai_endpoint,
                max_tokens,
                temperature,
                top_p,
                app_data_dir,
                cancellation_token,
            )
            .await?
        }
    };

    // Rebuild the block so the meeting boundary and attributes are preserved.
    Ok(format!(
        "<meeting\n id=\"{}\"\n title=\"{}\"\n started_at=\"{}\"\n>\n{}\n</meeting>",
        escape_xml_attribute(&unit.id),
        escape_xml_attribute(&unit.title),
        escape_xml_attribute(&unit.started_at),
        content
    ))
}

#[allow(clippy::too_many_arguments)]
async fn generate_final_report(
    client: &Client,
    provider: &LLMProvider,
    model_name: &str,
    api_key: &str,
    date_key: &str,
    document: &str,
    custom_prompt: &str,
    template_id: &str,
    template: &Template,
    ollama_endpoint: Option<&str>,
    custom_openai_endpoint: Option<&str>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
    app_data_dir: Option<&PathBuf>,
    cancellation_token: Option<&CancellationToken>,
) -> Result<String, String> {
    info!(
        "Daily brief: generating final report with template: {}",
        template_id
    );

    let clean_template_markdown = template.to_markdown_structure();
    let section_instructions = template.to_section_instructions();

    let system_prompt =
        build_daily_report_system_prompt(&section_instructions, &clean_template_markdown);
    let user_prompt = build_daily_report_user_prompt(date_key, document, custom_prompt);

    let raw = generate_summary_call(
        client,
        provider,
        model_name,
        api_key,
        &system_prompt,
        &user_prompt,
        ollama_endpoint,
        custom_openai_endpoint,
        max_tokens,
        temperature,
        top_p,
        app_data_dir,
        cancellation_token,
    )
    .await?;

    Ok(clean_llm_markdown_output(&raw))
}

/// Generates a Daily Brief from source meetings.
///
/// # Returns
/// Tuple of (final_markdown, unit_count) where unit_count is the number of
/// meeting units included in the final synthesis document.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn generate_daily_brief(
    client: &Client,
    provider: &LLMProvider,
    model_name: &str,
    api_key: &str,
    date_key: &str,
    units: &[MeetingUnit],
    template_id: &str,
    template: &Template,
    custom_prompt: &str,
    token_threshold: usize,
    ollama_endpoint: Option<&str>,
    custom_openai_endpoint: Option<&str>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
    app_data_dir: Option<&PathBuf>,
    cancellation_token: Option<&CancellationToken>,
    summary_language: Option<&str>,
    detected_transcript_language: Option<&str>,
) -> Result<(String, i64), String> {
    if let Some(token) = cancellation_token {
        if token.is_cancelled() {
            return Err("Summary generation was cancelled".to_string());
        }
    }

    if units.is_empty() {
        return Err(format!(
            "No meetings provided for the daily brief on {}.",
            date_key
        ));
    }

    let mut blocks: Vec<String> = units.iter().map(build_meeting_block).collect();
    let mut document = blocks.join("\n\n");

    let strategy = plan_strategy(rough_token_count(&document), token_threshold);
    if strategy == BriefStrategy::Condense {
        info!(
            "Daily brief: {} tokens exceed threshold {}; condensing {} meeting(s) before synthesis",
            rough_token_count(&document),
            token_threshold,
            units.len()
        );
        let mut condensed = Vec::new();
        for unit in units {
            condensed.push(
                condense_meeting_block(
                    client,
                    provider,
                    model_name,
                    api_key,
                    unit,
                    token_threshold,
                    ollama_endpoint,
                    custom_openai_endpoint,
                    max_tokens,
                    temperature,
                    top_p,
                    app_data_dir,
                    cancellation_token,
                )
                .await?,
            );
        }
        blocks = condensed;
        document = blocks.join("\n\n");
    }

    // Boundary-safe iterative reduction for days that still overflow after
    // meeting-level condensation (e.g., very many short meetings).
    let mut iterations = 0usize;
    while rough_token_count(&document) >= token_threshold
        && blocks.len() > 1
        && iterations < MAX_REDUCE_ITERATIONS
    {
        let groups = pack_blocks_boundary_safe(
            &blocks,
            token_threshold
                .saturating_sub(DAILY_PROMPT_OVERHEAD_TOKENS)
                .max(1),
        );
        if groups.len() >= blocks.len() {
            // A single group would still overflow; breaking meeting boundaries
            // is forbidden, so stop reducing and fail loudly below.
            break;
        }

        info!(
            "Daily brief: synthesizing {} block group(s) (pass {})",
            groups.len(),
            iterations + 1
        );
        let mut synthesized = Vec::new();
        for group in &groups {
            if let Some(token) = cancellation_token {
                if token.is_cancelled() {
                    return Err("Summary generation was cancelled".to_string());
                }
            }
            let group_text = group.join("\n\n");
            synthesized.push(
                generate_summary_call(
                    client,
                    provider,
                    model_name,
                    api_key,
                    DAILY_GROUP_SYNTHESIS_SYSTEM_PROMPT,
                    &build_daily_group_synthesis_user_prompt(&group_text),
                    ollama_endpoint,
                    custom_openai_endpoint,
                    max_tokens,
                    temperature,
                    top_p,
                    app_data_dir,
                    cancellation_token,
                )
                .await?,
            );
        }
        blocks = synthesized;
        document = blocks.join("\n\n");
        iterations += 1;
    }

    if rough_token_count(&document) >= token_threshold {
        return Err(format!(
            "Daily brief input is too large for the configured model even after condensation ({} tokens vs {} limit). Try a model with a larger context window.",
            rough_token_count(&document),
            token_threshold
        ));
    }

    let unit_count = blocks.len() as i64;
    let english_markdown = generate_final_report(
        client,
        provider,
        model_name,
        api_key,
        date_key,
        &document,
        custom_prompt,
        template_id,
        template,
        ollama_endpoint,
        custom_openai_endpoint,
        max_tokens,
        temperature,
        top_p,
        app_data_dir,
        cancellation_token,
    )
    .await?;

    let (final_markdown, _english) = apply_final_language_policy(
        client,
        provider,
        model_name,
        api_key,
        &english_markdown,
        summary_language,
        detected_transcript_language,
        ollama_endpoint,
        custom_openai_endpoint,
        max_tokens,
        temperature,
        top_p,
        app_data_dir,
        cancellation_token,
    )
    .await?;

    info!("Daily brief generation completed successfully");
    Ok((final_markdown, unit_count))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unit(id: &str, title: &str, started_at: &str, transcript: &str) -> MeetingUnit {
        MeetingUnit {
            id: id.to_string(),
            title: title.to_string(),
            started_at: started_at.to_string(),
            transcript: transcript.to_string(),
        }
    }

    // ------------------------------------------------------------------
    // Meeting block construction and boundary preservation
    // ------------------------------------------------------------------

    #[test]
    fn test_build_meeting_block_format() {
        let block = build_meeting_block(&unit(
            "meeting-1",
            "Standup",
            "2026-08-15T09:00:00Z",
            "Hello team",
        ));
        assert_eq!(
            block,
            "<meeting\n id=\"meeting-1\"\n title=\"Standup\"\n started_at=\"2026-08-15T09:00:00Z\"\n>\nHello team\n</meeting>"
        );
    }

    #[test]
    fn test_meeting_boundaries_preserved_across_multiple_meetings() {
        let units = vec![
            unit("meeting-a", "Alpha", "2026-08-15T09:00:00Z", "transcript A"),
            unit("meeting-b", "Beta", "2026-08-15T10:00:00Z", "transcript B"),
        ];
        let document = build_meetings_document(&units);

        assert_eq!(document.matches("<meeting").count(), 2);
        assert_eq!(document.matches("</meeting>").count(), 2);
        // No transcript text appears outside its own bounded block.
        let a_start = document.find("transcript A").unwrap();
        let b_start = document.find("transcript B").unwrap();
        assert!(a_start < document.find("</meeting>").unwrap());
        assert!(b_start > document.rfind("<meeting").unwrap());
        assert!(document.find("transcript Atranscript B").is_none());
        // Order preserved as given.
        assert!(a_start < b_start);
    }

    #[test]
    fn test_meeting_block_escapes_attributes() {
        let block = build_meeting_block(&unit(
            "meeting-1",
            "Q&A & \"Planning\"",
            "2026-08-15T09:00:00Z",
            "body",
        ));
        assert!(block.contains("title=\"Q&amp;A &amp; &quot;Planning&quot;\""));
    }

    #[test]
    fn test_sort_meeting_units_orders_chronologically() {
        let mut units = vec![
            unit("m3", "Third", "2026-08-15T15:00:00Z", "c"),
            unit("m1", "First", "2026-08-15T09:00:00Z", "a"),
            unit("m2", "Second", "2026-08-15T11:00:00Z", "b"),
        ];
        sort_meeting_units(&mut units);
        let ids: Vec<&str> = units.iter().map(|u| u.id.as_str()).collect();
        assert_eq!(ids, vec!["m1", "m2", "m3"]);
    }

    #[test]
    fn test_sort_meeting_units_stable_on_same_timestamp() {
        let mut units = vec![
            unit("m-b", "B", "2026-08-15T09:00:00Z", "b"),
            unit("m-a", "A", "2026-08-15T09:00:00Z", "a"),
        ];
        sort_meeting_units(&mut units);
        let ids: Vec<&str> = units.iter().map(|u| u.id.as_str()).collect();
        assert_eq!(ids, vec!["m-a", "m-b"]);
    }

    // ------------------------------------------------------------------
    // Date validation
    // ------------------------------------------------------------------

    #[test]
    fn test_parse_date_key_valid() {
        assert!(parse_date_key("2026-08-15").is_ok());
        assert!(parse_date_key(" 2026-08-15 ").is_ok());
    }

    #[test]
    fn test_parse_date_key_invalid() {
        assert!(parse_date_key("").is_err());
        assert!(parse_date_key("15-08-2026").is_err());
        assert!(parse_date_key("2026-8-15").is_err());
        assert!(parse_date_key("not-a-date").is_err());
    }

    #[test]
    fn test_meeting_matches_date_same_day() {
        // Expected value computed with the same local-timezone logic the
        // implementation uses; keeps the test correct on any host timezone.
        let timestamp = "2026-08-15T12:00:00+00:00";
        let expected = local_date_of(timestamp).unwrap() == parse_date_key("2026-08-15").unwrap();
        assert_eq!(
            meeting_matches_date(timestamp, "2026-08-15").unwrap(),
            expected
        );
    }

    #[test]
    fn test_meeting_matches_date_different_year_rejected() {
        // Years differ, so this is false in every timezone.
        assert!(!meeting_matches_date("2025-01-01T12:00:00+00:00", "2026-08-15").unwrap());
    }

    #[test]
    fn test_meeting_matches_date_handles_sqlx_chrono_format() {
        let timestamp = "2026-08-15 09:30:00 UTC";
        let expected = local_date_of(timestamp).unwrap() == parse_date_key("2026-08-15").unwrap();
        assert_eq!(
            meeting_matches_date(timestamp, "2026-08-15").unwrap(),
            expected
        );
    }

    #[test]
    fn test_meeting_matches_date_handles_fractional_seconds() {
        let timestamp = "2026-08-15 09:30:00.123456 UTC";
        let expected = local_date_of(timestamp).unwrap() == parse_date_key("2026-08-15").unwrap();
        assert_eq!(
            meeting_matches_date(timestamp, "2026-08-15").unwrap(),
            expected
        );
    }

    #[test]
    fn test_meeting_matches_date_unparseable_timestamp_errors() {
        assert!(meeting_matches_date("garbage", "2026-08-15").is_err());
    }

    #[test]
    fn test_meeting_matches_date_invalid_date_key_errors() {
        assert!(meeting_matches_date("2026-08-15T12:00:00Z", "garbage").is_err());
    }

    #[test]
    fn test_meeting_matches_date_empty_timestamp_errors() {
        assert!(meeting_matches_date("", "2026-08-15").is_err());
    }

    // ------------------------------------------------------------------
    // Token strategy and boundary-safe packing
    // ------------------------------------------------------------------

    #[test]
    fn test_plan_strategy_single_pass_below_threshold() {
        assert_eq!(plan_strategy(100, 200), BriefStrategy::SinglePass);
        // Exactly at threshold requires condensation (mirrors per-meeting < check).
        assert_eq!(plan_strategy(200, 200), BriefStrategy::Condense);
        assert_eq!(plan_strategy(500, 200), BriefStrategy::Condense);
    }

    #[test]
    fn test_pack_blocks_boundary_safe_never_splits_a_block() {
        // Budget far below each block's size: every block must end up whole.
        let big = "word ".repeat(500);
        let blocks = vec![big.clone(), big.clone(), big.clone()];
        let groups = pack_blocks_boundary_safe(&blocks, 50);
        assert_eq!(groups.len(), 3);
        for group in groups {
            assert_eq!(group.len(), 1);
        }
    }

    #[test]
    fn test_pack_blocks_boundary_safe_groups_fit_budget() {
        let block_a = "a ".repeat(100); // ~50 tokens
        let block_b = "b ".repeat(100);
        let groups = pack_blocks_boundary_safe(&[block_a.clone(), block_b.clone()], 60);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0], vec![block_a]);
        assert_eq!(groups[1], vec![block_b]);

        let small_a = "a".to_string();
        let small_b = "b".to_string();
        let groups = pack_blocks_boundary_safe(&[small_a.clone(), small_b.clone()], 100);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0], vec![small_a, small_b]);
    }

    #[test]
    fn test_pack_blocks_boundary_safe_empty() {
        assert!(pack_blocks_boundary_safe(&[], 100).is_empty());
    }

    // ------------------------------------------------------------------
    // Fake OpenAI-compatible LLM server for pipeline tests
    // ------------------------------------------------------------------

    struct FakeLlm {
        addr: std::net::SocketAddr,
        requests: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
        shutdown: std::sync::Arc<std::sync::atomic::AtomicBool>,
        handle: tokio::task::JoinHandle<()>,
    }

    impl FakeLlm {
        async fn spawn(responder: impl FnMut(String) -> (u16, String) + Send + 'static) -> Self {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let requests = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
            let responder = std::sync::Arc::new(std::sync::Mutex::new(
                Box::new(responder) as Box<dyn FnMut(String) -> (u16, String) + Send>
            ));
            let shutdown = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

            let reqs = requests.clone();
            let resps = responder.clone();
            let flag = shutdown.clone();
            let handle = tokio::spawn(async move {
                use tokio::io::{AsyncReadExt, AsyncWriteExt};
                loop {
                    if flag.load(std::sync::atomic::Ordering::SeqCst) {
                        break;
                    }
                    let Ok((mut stream, _)) = listener.accept().await else {
                        continue;
                    };
                    let mut buf = Vec::new();
                    let mut tmp = [0u8; 8192];
                    let mut content_length = None;
                    let mut header_end = None;
                    loop {
                        let n = stream.read(&mut tmp).await.unwrap_or(0);
                        if n == 0 {
                            break;
                        }
                        buf.extend_from_slice(&tmp[..n]);
                        if header_end.is_none() {
                            if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                                header_end = Some(pos + 4);
                                let headers = String::from_utf8_lossy(&buf[..pos]).to_string();
                                for line in headers.lines() {
                                    if let Some(rest) = line
                                        .strip_prefix("content-length:")
                                        .or_else(|| line.strip_prefix("Content-Length:"))
                                    {
                                        content_length = rest.trim().parse::<usize>().ok();
                                    }
                                }
                            }
                        }
                        if let (Some(he), Some(len)) = (header_end, content_length) {
                            if buf.len() >= he + len {
                                break;
                            }
                        }
                    }
                    let body = match (header_end, content_length) {
                        (Some(he), Some(len)) => {
                            let end = (he + len).min(buf.len());
                            String::from_utf8_lossy(&buf[he..end]).to_string()
                        }
                        _ => String::new(),
                    };
                    reqs.lock().unwrap().push(body.clone());

                    let (status, body) = (resps.lock().unwrap())(body);
                    let reason = if status == 200 {
                        "OK"
                    } else {
                        "Internal Server Error"
                    };
                    let response = format!(
                        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        status,
                        reason,
                        body.len(),
                        body
                    );
                    let _ = stream.write_all(response.as_bytes()).await;
                    let _ = stream.flush().await;
                }
            });

            Self {
                addr,
                requests,
                shutdown,
                handle,
            }
        }

        async fn spawn_responses(responses: Vec<(u16, String)>) -> Self {
            let mut queue = responses
                .into_iter()
                .collect::<std::collections::VecDeque<_>>();
            Self::spawn(move |_body| queue.pop_front().unwrap_or((200, default_llm_response())))
                .await
        }

        fn endpoint(&self) -> String {
            format!("http://{}/v1", self.addr)
        }

        fn request_bodies(&self) -> Vec<String> {
            self.requests.lock().unwrap().clone()
        }

        fn call_count(&self) -> usize {
            self.requests.lock().unwrap().len()
        }

        async fn stop(self) {
            self.shutdown
                .store(true, std::sync::atomic::Ordering::SeqCst);
            // `TcpListener::accept` does not observe the flag until a new
            // connection arrives. Abort the test-only server task so teardown
            // cannot hang after the final request.
            self.handle.abort();
            let _ = self.handle.await;
        }
    }

    fn default_llm_response() -> String {
        "{\"choices\":[{\"message\":{\"content\":\"# Daily Brief\\n\\n**Executive Overview**\\n\\nA synthesized day.\"}}]}".to_string()
    }

    fn test_template() -> Template {
        Template {
            name: "Daily Brief".to_string(),
            description: "Test".to_string(),
            sections: vec![crate::summary::templates::TemplateSection {
                title: "Executive Overview".to_string(),
                instruction: "Summarize the day".to_string(),
                format: "paragraph".to_string(),
                item_format: None,
                example_item_format: None,
            }],
        }
    }

    /// Decodes the user message from a captured OpenAI-compatible request
    /// body. Request bodies are JSON, so prompt text is escaped there; the
    /// tests must assert on the decoded message content.
    fn user_message(body: &str) -> String {
        let json: serde_json::Value = serde_json::from_str(body)
            .unwrap_or_else(|e| panic!("request body is not valid JSON: {e}"));
        json["messages"]
            .as_array()
            .and_then(|messages| messages.iter().rev().find(|m| m["role"] == "user"))
            .and_then(|m| m["content"].as_str())
            .map(|content| content.to_string())
            .unwrap_or_else(|| panic!("request body has no user message: {body}"))
    }

    fn generate_args(server: &FakeLlm) -> (Client, LLMProvider, String, Option<String>) {
        (
            Client::new(),
            LLMProvider::CustomOpenAI,
            "test-model".to_string(),
            Some(server.endpoint()),
        )
    }

    async fn run_brief(
        server: &FakeLlm,
        units: &[MeetingUnit],
        token_threshold: usize,
        token: Option<&CancellationToken>,
    ) -> Result<(String, i64), String> {
        let (client, provider, model_name, endpoint) = generate_args(server);
        generate_daily_brief(
            &client,
            &provider,
            &model_name,
            "",
            "2026-08-15",
            units,
            "daily_brief",
            &test_template(),
            "",
            token_threshold,
            None,
            endpoint.as_deref(),
            None,
            None,
            None,
            None,
            token,
            None,
            Some("en"),
        )
        .await
    }

    #[tokio::test]
    async fn test_zero_meetings_errors_without_provider_call() {
        let server = FakeLlm::spawn_responses(vec![]).await;
        let err = run_brief(&server, &[], 100000, None).await.unwrap_err();
        assert!(err.contains("No meetings provided"));
        assert_eq!(server.call_count(), 0);
        server.stop().await;
    }

    #[tokio::test]
    async fn test_single_meeting_single_pass() {
        let server = FakeLlm::spawn_responses(vec![]).await;
        let units = vec![unit(
            "meeting-1",
            "Standup",
            "2026-08-15T09:00:00Z",
            "We shipped the release.",
        )];
        let (markdown, count) = run_brief(&server, &units, 100000, None).await.unwrap();
        assert!(markdown.contains("Daily Brief"));
        assert_eq!(count, 1);
        assert_eq!(server.call_count(), 1);
        let user = user_message(&server.request_bodies()[0]);
        assert!(user.contains("id=\"meeting-1\""));
        assert!(user.contains("title=\"Standup\""));
        assert!(user.contains("We shipped the release."));
        server.stop().await;
    }

    #[tokio::test]
    async fn test_multiple_meetings_preserve_boundaries_in_final_prompt() {
        let server = FakeLlm::spawn_responses(vec![]).await;
        let units = vec![
            unit(
                "meeting-a",
                "Alpha",
                "2026-08-15T09:00:00Z",
                "alpha transcript",
            ),
            unit(
                "meeting-b",
                "Beta",
                "2026-08-15T10:00:00Z",
                "beta transcript",
            ),
        ];
        run_brief(&server, &units, 100000, None).await.unwrap();
        assert_eq!(server.call_count(), 1);
        // `<meeting\n` matches only real meeting blocks, not the
        // `<meetings>` document wrapper in the user prompt.
        let user = user_message(&server.request_bodies()[0]);
        assert_eq!(user.matches("<meeting\n").count(), 2);
        assert_eq!(user.matches("</meeting>").count(), 2);
        assert!(user.contains("id=\"meeting-a\""));
        assert!(user.contains("id=\"meeting-b\""));
        let a = user.find("alpha transcript").unwrap();
        let b = user.find("beta transcript").unwrap();
        assert!(a < b, "meeting order must be preserved in the prompt");
        server.stop().await;
    }

    #[tokio::test]
    async fn test_large_transcripts_use_meeting_level_condensation() {
        // Token threshold far below total content forces condensation.
        let big_transcript = "word ".repeat(2000);
        let units = vec![
            unit("meeting-1", "One", "2026-08-15T09:00:00Z", &big_transcript),
            unit("meeting-2", "Two", "2026-08-15T10:00:00Z", &big_transcript),
        ];
        let server = FakeLlm::spawn_responses(vec![]).await;
        let (markdown, count) = run_brief(&server, &units, 500, None).await.unwrap();
        assert!(markdown.contains("Daily Brief"));
        assert_eq!(count, 2);

        let bodies = server.request_bodies();
        // First calls condense individual meetings; the last call is the
        // final report using the template.
        assert!(
            bodies.len() >= 3,
            "expected condensation + final pass, got {}",
            bodies.len()
        );
        let raw_final_body = bodies.last().unwrap();
        assert!(raw_final_body.contains("Executive Overview"));
        let final_body = user_message(raw_final_body);
        assert!(final_body.contains("id=\"meeting-1\""));
        assert!(final_body.contains("id=\"meeting-2\""));
        // Meeting boundaries survive condensation: the final prompt still has
        // both meeting tags and no raw transcript bleed-over.
        assert_eq!(final_body.matches("<meeting\n").count(), 2);
        assert!(final_body.matches("</meeting>").count() == 2);
        server.stop().await;
    }

    #[tokio::test]
    async fn test_provider_error_propagates() {
        let server = FakeLlm::spawn_responses(vec![(500, r#"{"error":"boom"}"#.to_string())]).await;
        let units = vec![unit(
            "meeting-1",
            "Standup",
            "2026-08-15T09:00:00Z",
            "hello",
        )];
        let err = run_brief(&server, &units, 100000, None).await.unwrap_err();
        assert!(
            err.contains("LLM API request failed"),
            "unexpected error: {}",
            err
        );
        server.stop().await;
    }

    #[tokio::test]
    async fn test_cancellation_prevents_provider_calls() {
        let server = FakeLlm::spawn_responses(vec![]).await;
        let token = CancellationToken::new();
        token.cancel();
        let units = vec![unit(
            "meeting-1",
            "Standup",
            "2026-08-15T09:00:00Z",
            "hello",
        )];
        let err = run_brief(&server, &units, 100000, Some(&token))
            .await
            .unwrap_err();
        assert!(err.contains("cancelled"));
        assert_eq!(server.call_count(), 0);
        server.stop().await;
    }

    #[tokio::test]
    async fn test_cancellation_during_condensation_stops_early() {
        let token = CancellationToken::new();
        let responder_token = token.clone();

        // Cancel the token deterministically when the first condensation
        // chunk request arrives: the first chunk completes, the next check
        // must abort with a cancellation error.
        let server = FakeLlm::spawn(move |_body| {
            responder_token.cancel();
            (200, default_llm_response())
        })
        .await;

        let big = "word ".repeat(2000);
        let units = vec![unit("meeting-1", "One", "2026-08-15T09:00:00Z", &big)];

        let (client, provider, model_name, endpoint) = generate_args(&server);
        let result = generate_daily_brief(
            &client,
            &provider,
            &model_name,
            "",
            "2026-08-15",
            &units,
            "daily_brief",
            &test_template(),
            "",
            500,
            None,
            endpoint.as_deref(),
            None,
            None,
            None,
            None,
            Some(&token),
            None,
            None,
        )
        .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("cancelled"));
        server.stop().await;
    }

    #[tokio::test]
    async fn test_condensation_chunk_failure_is_not_silent() {
        // Every call fails: condensation must surface an error rather than
        // synthesizing from nothing. The always-failing responder avoids a
        // finite failure queue that would quietly fall back to success.
        let server = FakeLlm::spawn(|_body| (500, r#"{"error":"down"}"#.to_string())).await;
        let big = "word ".repeat(2000);
        let units = vec![unit("meeting-1", "One", "2026-08-15T09:00:00Z", &big)];
        let err = run_brief(&server, &units, 500, None).await.unwrap_err();
        assert!(
            err.contains("Failed to condense meeting") || err.contains("LLM API request failed"),
            "unexpected error: {}",
            err
        );
        server.stop().await;
    }

    #[tokio::test]
    async fn test_meeting_order_in_prompt_matches_input_order() {
        let server = FakeLlm::spawn_responses(vec![]).await;
        let mut units = vec![
            unit("m3", "Third", "2026-08-15T15:00:00Z", "third"),
            unit("m1", "First", "2026-08-15T09:00:00Z", "first"),
            unit("m2", "Second", "2026-08-15T11:00:00Z", "second"),
        ];
        sort_meeting_units(&mut units);
        run_brief(&server, &units, 100000, None).await.unwrap();
        let user = user_message(&server.request_bodies()[0]);
        let first = user.find("id=\"m1\"").unwrap();
        let second = user.find("id=\"m2\"").unwrap();
        let third = user.find("id=\"m3\"").unwrap();
        assert!(first < second && second < third);
        server.stop().await;
    }
}
