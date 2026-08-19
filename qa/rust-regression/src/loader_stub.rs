//! QA loader stub for the templates storage layer.
//!
//! Implements the exact functions `summary/templates/store.rs` imports from
//! the real (owner-owned) `loader.rs`, against REAL inputs:
//!
//! - `is_builtin_template_id`: true for the two embedded ids AND any bundled
//!   template file present in `frontend/src-tauri/templates/`.
//! - `template_source`: "custom" | "bundled" | "builtin" by checking the same
//!   resolution order the real loader uses (custom dir -> bundled dir -> embedded).
//! - `get_template`: parses + validates JSON from the same chain.
//!
//! The custom templates dir is overridable via `MEETILY_QA_TEMPLATES_DIR` so
//! tests never touch the real user data directory.

use super::types::Template;
use std::path::PathBuf;

/// Embedded ids from the contract (summary/templates/defaults.rs).
const EMBEDDED_TEMPLATE_IDS: &[&str] = &["daily_standup", "standard_meeting"];

fn bundled_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../frontend/src-tauri/templates")
}

pub fn custom_templates_dir() -> Option<PathBuf> {
    if let Ok(override_dir) = std::env::var("MEETILY_QA_TEMPLATES_DIR") {
        return Some(PathBuf::from(override_dir));
    }
    dirs::data_dir().map(|d| d.join("Meetily").join("templates"))
}

fn bundled_template_ids() -> Vec<String> {
    let mut ids = Vec::new();
    if let Ok(entries) = std::fs::read_dir(bundled_dir()) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if let Some(stem) = name.strip_suffix(".json") {
                    ids.push(stem.to_string());
                }
            }
        }
    }
    ids
}

pub fn is_builtin_template_id(template_id: &str) -> bool {
    EMBEDDED_TEMPLATE_IDS.contains(&template_id) || bundled_template_ids().contains(&template_id.to_string())
}

pub fn template_source(template_id: &str) -> Option<&'static str> {
    if let Some(dir) = custom_templates_dir() {
        if dir.join(format!("{template_id}.json")).is_file() {
            return Some("custom");
        }
    }
    if bundled_template_ids().contains(&template_id.to_string()) {
        return Some("bundled");
    }
    if EMBEDDED_TEMPLATE_IDS.contains(&template_id) {
        return Some("builtin");
    }
    None
}

pub fn validate_and_parse_template(json: &str) -> Result<Template, String> {
    let template: Template =
        serde_json::from_str(json).map_err(|e| format!("Failed to parse template JSON: {e}"))?;
    template.validate()?;
    Ok(template)
}

pub fn get_template(template_id: &str) -> Result<Template, String> {
    if let Some(dir) = custom_templates_dir() {
        let path = dir.join(format!("{template_id}.json"));
        if path.is_file() {
            let json = std::fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read custom template: {e}"))?;
            return validate_and_parse_template(&json);
        }
    }
    let bundled = bundled_dir().join(format!("{template_id}.json"));
    if bundled.is_file() {
        let json = std::fs::read_to_string(&bundled)
            .map_err(|e| format!("Failed to read bundled template: {e}"))?;
        return validate_and_parse_template(&json);
    }
    Err(format!("Template '{template_id}' not found"))
}
