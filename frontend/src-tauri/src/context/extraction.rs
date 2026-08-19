//! Extraction of memory items from meeting summaries via the configured LLM
//! provider, plus defensive parsing of the model's JSON output.

use crate::context::engine::MemoryExtractor;
use crate::context::model::{
    MemoryKind, EXTRACTED_ITEM_CONTENT_MAX_CHARS, STATUS_BLOCKED, STATUS_DONE, STATUS_OPEN,
    STATUS_RESOLVED,
};
use crate::context::prompts::{
    build_memory_extraction_system_prompt, build_memory_extraction_user_prompt,
};
use crate::summary::llm_client::{generate_summary, LLMProvider};
use async_trait::async_trait;
use serde::Deserialize;
use std::path::PathBuf;

/// Structured input to a memory extraction call.
#[derive(Debug, Clone)]
pub struct ExtractionRequest {
    pub meeting_id: String,
    /// Rendered reference of currently open items (may be empty).
    pub open_items_markdown: String,
    /// The (already size-capped) meeting summary.
    pub meeting_summary: String,
}

/// Parsed model output.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ExtractionOutput {
    #[serde(default)]
    pub items: Vec<ExtractedItem>,
    #[serde(default)]
    pub resolutions: Vec<ExtractedResolution>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExtractedItem {
    pub kind: String,
    pub content: String,
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExtractedResolution {
    #[serde(default)]
    pub context_id: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
    pub status: String,
}

/// An item after validation: kind parsed, content trimmed/capped, status
/// normalised per kind.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedItem {
    pub kind: MemoryKind,
    pub content: String,
    pub status: Option<String>,
}

/// Normalises model status wording into the engine's closed set.
/// Conservative: only well-known synonyms map; unknown statuses fall back to
/// the kind default (open for working-set kinds).
pub fn normalize_status(kind: MemoryKind, raw: Option<&str>) -> Option<String> {
    let Some(raw) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return kind.default_status().map(str::to_string);
    };
    let normalized = match kind {
        MemoryKind::Action => match raw {
            STATUS_OPEN | STATUS_DONE | STATUS_BLOCKED => raw.to_string(),
            "completed" | "finished" | "closed" => STATUS_DONE.to_string(),
            "cancelled" | "canceled" => STATUS_BLOCKED.to_string(),
            _ => return kind.default_status().map(str::to_string),
        },
        MemoryKind::Question => match raw {
            STATUS_OPEN | STATUS_RESOLVED => raw.to_string(),
            "answered" | "closed" | "done" => STATUS_RESOLVED.to_string(),
            _ => return kind.default_status().map(str::to_string),
        },
        _ => return None,
    };
    Some(normalized)
}

/// Strips markdown code fences around the raw model output.
fn strip_code_fences(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    if s.starts_with("```") {
        if let Some(nl) = s.find('\n') {
            s = s[nl + 1..].trim().to_string();
        }
    }
    if s.ends_with("```") {
        s = s.trim_end_matches('`').trim().to_string();
    }
    s
}

/// Parses raw model output into an `ExtractionOutput`. Tolerates code fences
/// and surrounding prose by scanning for the outermost JSON object.
pub fn parse_extraction_output(raw: &str) -> Result<ExtractionOutput, String> {
    let cleaned = strip_code_fences(raw);
    let start = cleaned
        .find('{')
        .ok_or_else(|| "no JSON object found in extraction output".to_string())?;
    let end = cleaned
        .rfind('}')
        .ok_or_else(|| "no JSON object found in extraction output".to_string())?;
    if end <= start {
        return Err("malformed extraction output".to_string());
    }
    serde_json::from_str::<ExtractionOutput>(&cleaned[start..=end])
        .map_err(|e| format!("invalid extraction JSON: {e}"))
}

/// Validates a single extracted item; returns `None` when the item must be
/// skipped (unknown kind, empty content).
pub fn validate_item(item: &ExtractedItem) -> Option<ValidatedItem> {
    let kind = MemoryKind::from_str(item.kind.trim())?;
    let content = item.content.trim().to_string();
    if content.is_empty() {
        return None;
    }
    let content = crate::context::render::cap_content(&content, EXTRACTED_ITEM_CONTENT_MAX_CHARS);
    let status = normalize_status(kind, item.status.as_deref());
    Some(ValidatedItem {
        kind,
        content,
        status,
    })
}

/// Validates all items, skipping invalid entries.
pub fn validate_items(output: &ExtractionOutput) -> Vec<ValidatedItem> {
    output.items.iter().filter_map(validate_item).collect()
}

/// Provider-backed memory extractor using the same LLM provider/model/endpoint
/// as summary generation. No new external requests are introduced.
pub struct LlmMemoryExtractor {
    client: reqwest::Client,
    provider: LLMProvider,
    model_name: String,
    api_key: String,
    ollama_endpoint: Option<String>,
    custom_openai_endpoint: Option<String>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
    app_data_dir: Option<PathBuf>,
}

#[allow(clippy::too_many_arguments)]
impl LlmMemoryExtractor {
    pub fn new(
        client: reqwest::Client,
        provider: LLMProvider,
        model_name: String,
        api_key: String,
        ollama_endpoint: Option<String>,
        custom_openai_endpoint: Option<String>,
        max_tokens: Option<u32>,
        temperature: Option<f32>,
        top_p: Option<f32>,
        app_data_dir: Option<PathBuf>,
    ) -> Self {
        Self {
            client,
            provider,
            model_name,
            api_key,
            ollama_endpoint,
            custom_openai_endpoint,
            max_tokens,
            temperature,
            top_p,
            app_data_dir,
        }
    }
}

#[async_trait]
impl MemoryExtractor for LlmMemoryExtractor {
    async fn extract(&self, request: &ExtractionRequest) -> Result<ExtractionOutput, String> {
        let system_prompt = build_memory_extraction_system_prompt();
        let user_prompt = build_memory_extraction_user_prompt(
            Some(&request.open_items_markdown),
            &request.meeting_summary,
            &request.meeting_id,
        );

        let raw = generate_summary(
            &self.client,
            &self.provider,
            &self.model_name,
            &self.api_key,
            system_prompt,
            &user_prompt,
            self.ollama_endpoint.as_deref(),
            self.custom_openai_endpoint.as_deref(),
            self.max_tokens,
            self.temperature,
            self.top_p,
            self.app_data_dir.as_ref(),
            None,
        )
        .await?;

        parse_extraction_output(&raw)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_json() {
        let raw = r#"{"items": [{"kind": "fact", "content": "The team uses Rust", "status": null}], "resolutions": []}"#;
        let output = parse_extraction_output(raw).unwrap();
        assert_eq!(output.items.len(), 1);
        assert_eq!(output.items[0].kind, "fact");
    }

    #[test]
    fn parses_fenced_json() {
        let raw = "Here is the result:\n```json\n{\"items\": [{\"kind\": \"decision\", \"content\": \"Use Postgres\"}]}\n```\nDone.";
        let output = parse_extraction_output(raw).unwrap();
        assert_eq!(output.items.len(), 1);
        assert_eq!(output.items[0].content, "Use Postgres");
    }

    #[test]
    fn parses_json_with_prose_around() {
        let raw = "Sure: {\"items\": [{\"kind\": \"note\", \"content\": \"Deadline risk\", \"status\": null}], \"resolutions\": []} hope this helps";
        let output = parse_extraction_output(raw).unwrap();
        assert_eq!(output.items.len(), 1);
    }

    #[test]
    fn rejects_garbage() {
        assert!(parse_extraction_output("no json here").is_err());
        assert!(parse_extraction_output("").is_err());
        assert!(parse_extraction_output("{items: [}").is_err());
    }

    #[test]
    fn missing_optional_fields_default() {
        let raw = r#"{"items": [{"kind": "fact", "content": "x"}], "resolutions": [{"kind": "action", "content": "y", "status": "done"}]}"#;
        let output = parse_extraction_output(raw).unwrap();
        assert!(output.items[0].status.is_none());
        assert!(output.resolutions[0].context_id.is_none());
    }

    #[test]
    fn validation_skips_unknown_kind_and_empty_content() {
        assert_eq!(
            validate_item(&ExtractedItem {
                kind: "action_item".to_string(),
                content: "whatever".to_string(),
                status: None,
            }),
            None
        );
        assert_eq!(
            validate_item(&ExtractedItem {
                kind: "fact".to_string(),
                content: "   ".to_string(),
                status: None,
            }),
            None
        );
    }

    #[test]
    fn validation_defaults_status_for_working_set_kinds() {
        let validated = validate_item(&ExtractedItem {
            kind: "action".to_string(),
            content: "Ship v2".to_string(),
            status: None,
        })
        .unwrap();
        assert_eq!(validated.kind, MemoryKind::Action);
        assert_eq!(validated.status.as_deref(), Some("open"));

        let validated = validate_item(&ExtractedItem {
            kind: "question".to_string(),
            content: "Which db?".to_string(),
            status: Some("resolved".to_string()),
        })
        .unwrap();
        assert_eq!(validated.status.as_deref(), Some("resolved"));
    }

    #[test]
    fn validation_drops_status_for_passive_kinds() {
        let validated = validate_item(&ExtractedItem {
            kind: "decision".to_string(),
            content: "Use Postgres".to_string(),
            status: Some("open".to_string()),
        })
        .unwrap();
        assert_eq!(validated.status, None);
    }

    #[test]
    fn status_synonyms_map_conservatively() {
        assert_eq!(
            normalize_status(MemoryKind::Action, Some("completed")),
            Some("done".into())
        );
        assert_eq!(
            normalize_status(MemoryKind::Action, Some("cancelled")),
            Some("blocked".into())
        );
        assert_eq!(
            normalize_status(MemoryKind::Question, Some("answered")),
            Some("resolved".into())
        );
        // Unknown statuses fall back to the kind default, never a made-up one.
        assert_eq!(
            normalize_status(MemoryKind::Action, Some("banana")),
            Some("open".into())
        );
        assert_eq!(normalize_status(MemoryKind::Fact, Some("open")), None);
    }

    #[test]
    fn validation_caps_content_length() {
        let validated = validate_item(&ExtractedItem {
            kind: "fact".to_string(),
            content: "x".repeat(5000),
            status: None,
        })
        .unwrap();
        assert!(validated.content.chars().count() <= EXTRACTED_ITEM_CONTENT_MAX_CHARS + 1);
    }
}
