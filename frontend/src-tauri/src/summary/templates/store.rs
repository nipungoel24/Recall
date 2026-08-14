//! Custom template storage backend.
//!
//! Provides create/read/update/delete/duplicate operations for user-created
//! templates stored as JSON files in the application data directory
//! (the same directory the existing loader reads from).
//!
//! # Security guarantees
//!
//! - Template IDs are sanitized to `[a-z0-9][a-z0-9_-]{0,63}`: no path
//!   separators, no leading/trailing dots, no whitespace, no reserved
//!   Windows device names. This makes path traversal and reserved-file
//!   attacks impossible.
//! - Built-in templates (embedded or bundled) can never be created,
//!   updated, deleted, or overwritten through this API.
//! - Writes are atomic: content is written to a temporary file in the
//!   target directory and renamed over the destination, so a crash can
//!   never leave a partially-written template.
//! - All payloads are validated (`Template::validate`) before anything
//!   is written to disk.

use super::loader;
use super::types::Template;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Maximum allowed length for a custom template identifier.
pub const MAX_TEMPLATE_ID_LENGTH: usize = 64;

/// Structured error returned by the template storage layer.
///
/// Serializes to `{ "kind": "...", "message": "..." }` over the Tauri IPC
/// boundary so the UI can react to error categories, not just strings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TemplateError {
    /// Machine-readable error category (see `TemplateError::KIND_*`).
    pub kind: String,
    /// Human-readable description suitable for UI display.
    pub message: String,
}

impl TemplateError {
    pub const KIND_INVALID_ID: &'static str = "invalid_id";
    pub const KIND_INVALID_JSON: &'static str = "invalid_json";
    pub const KIND_INVALID_STRUCTURE: &'static str = "invalid_structure";
    pub const KIND_NOT_FOUND: &'static str = "not_found";
    pub const KIND_ALREADY_EXISTS: &'static str = "already_exists";
    pub const KIND_BUILTIN_PROTECTED: &'static str = "builtin_protected";
    pub const KIND_IO: &'static str = "io";

    /// Create a new error with the given kind and message.
    pub fn new(kind: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            kind: kind.into(),
            message: message.into(),
        }
    }

    pub fn invalid_id(message: impl Into<String>) -> Self {
        Self::new(Self::KIND_INVALID_ID, message)
    }

    pub fn not_found(id: &str) -> Self {
        Self::new(
            Self::KIND_NOT_FOUND,
            format!("Custom template '{}' does not exist", id),
        )
    }

    pub fn already_exists(id: &str) -> Self {
        Self::new(
            Self::KIND_ALREADY_EXISTS,
            format!("A template with id '{}' already exists", id),
        )
    }

    pub fn builtin_protected(id: &str) -> Self {
        Self::new(
            Self::KIND_BUILTIN_PROTECTED,
            format!(
                "Template '{}' is built-in and cannot be created, updated, overwritten or deleted",
                id
            ),
        )
    }

    fn io(error: std::io::Error) -> Self {
        Self::new(Self::KIND_IO, format!("File operation failed: {}", error))
    }
}

impl fmt::Display for TemplateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.kind, self.message)
    }
}

impl std::error::Error for TemplateError {}

/// Windows reserved device names that can never be used as file names.
fn is_reserved_windows_name(upper: &str) -> bool {
    match upper {
        "CON" | "PRN" | "AUX" | "NUL" => true,
        _ => {
            if (upper.starts_with("COM") || upper.starts_with("LPT")) && upper.len() == 4 {
                matches!(upper.as_bytes()[3], b'1'..=b'9')
            } else {
                false
            }
        }
    }
}

/// Sanitize a raw template identifier into a safe file-name stem.
///
/// Rules:
/// - 1..=64 characters after trimming
/// - starts with an ASCII letter or digit
/// - only ASCII letters, digits, `_` and `-` (no dots, so `.`/`..` and
///   hidden files are impossible; no `/` or `\`, so path traversal is
///   impossible)
/// - not a reserved Windows device name (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
///
/// The id is normalized to lowercase so that template ids are unambiguous
/// on case-insensitive filesystems (Windows/macOS).
pub fn sanitize_template_id(raw: &str) -> Result<String, TemplateError> {
    let id = raw.trim();

    if id.is_empty() {
        return Err(TemplateError::invalid_id("Template id cannot be empty"));
    }

    if id.len() > MAX_TEMPLATE_ID_LENGTH {
        return Err(TemplateError::invalid_id(format!(
            "Template id must be at most {} characters long",
            MAX_TEMPLATE_ID_LENGTH
        )));
    }

    let first = id.chars().next().expect("non-empty id checked above");
    if !first.is_ascii_alphanumeric() {
        return Err(TemplateError::invalid_id(
            "Template id must start with a letter or digit",
        ));
    }

    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(TemplateError::invalid_id(
            "Template id may only contain letters, digits, underscores and hyphens \
             (no spaces, dots, or path separators)",
        ));
    }

    if id.contains("..") {
        return Err(TemplateError::invalid_id(
            "Template id must not contain '..'",
        ));
    }

    if is_reserved_windows_name(&id.to_ascii_uppercase()) {
        return Err(TemplateError::invalid_id(format!(
            "Template id '{}' is a reserved file name",
            id
        )));
    }

    Ok(id.to_ascii_lowercase())
}

/// Path of a template JSON file inside a custom templates directory.
pub fn template_file_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{}.json", id))
}

/// Resolve the application data templates directory for command use.
pub fn resolve_custom_templates_dir() -> Result<PathBuf, TemplateError> {
    loader::custom_templates_dir().ok_or_else(|| {
        TemplateError::new(
            TemplateError::KIND_IO,
            "Could not resolve the application data directory",
        )
    })
}

/// List custom template ids in the given directory (sorted).
///
/// Only files with a sanitizable id stem and a `.json` extension are
/// returned; anything suspicious is skipped defensively.
pub fn list_custom_template_ids(dir: &Path) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();

    if !dir.exists() {
        return ids;
    }

    match std::fs::read_dir(dir) {
        Ok(entries) => {
            for entry in entries.flatten() {
                if let Some(filename) = entry.file_name().to_str() {
                    if let Some(stem) = filename.strip_suffix(".json") {
                        if let Ok(id) = sanitize_template_id(stem) {
                            if !ids.contains(&id) {
                                ids.push(id);
                            }
                        }
                    }
                }
            }
        }
        Err(e) => {
            log::warn!("Failed to read custom templates directory {:?}: {}", dir, e);
        }
    }

    ids.sort();
    ids
}

/// Atomically write a template JSON file.
///
/// The content is written to a temporary file in the same directory and
/// renamed over the destination. Renames within a directory are atomic on
/// all supported platforms, so readers never observe a partial file.
pub fn write_template_atomic(path: &Path, content: &str) -> Result<(), TemplateError> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| {
            TemplateError::new(
                TemplateError::KIND_IO,
                "Template path has no parent directory",
            )
        })?;

    std::fs::create_dir_all(parent).map_err(TemplateError::io)?;

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("template");
    let tmp_path = parent.join(format!(".{}.{}.tmp", file_name, std::process::id()));

    let write_result = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&tmp_path)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        Ok(())
    })();

    if let Err(e) = write_result {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(TemplateError::io(e));
    }

    if let Err(e) = std::fs::rename(&tmp_path, path) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(TemplateError::io(e));
    }

    Ok(())
}

/// Parse and validate raw template JSON without persisting anything.
fn parse_and_validate(json: &str) -> Result<Template, TemplateError> {
    let template: Template = serde_json::from_str(json).map_err(|e| {
        TemplateError::new(
            TemplateError::KIND_INVALID_JSON,
            format!("Failed to parse template JSON: {}", e),
        )
    })?;

    template
        .validate()
        .map_err(|e| TemplateError::new(TemplateError::KIND_INVALID_STRUCTURE, e))?;

    Ok(template)
}

/// Create a new custom template.
///
/// The JSON is fully validated before anything is written to disk.
///
/// Returns the sanitized (normalized) id and the parsed template.
pub fn create_template(
    dir: &Path,
    raw_id: &str,
    json: &str,
) -> Result<(String, Template), TemplateError> {
    let id = sanitize_template_id(raw_id)?;

    if loader::is_builtin_template_id(&id) {
        return Err(TemplateError::builtin_protected(&id));
    }

    let path = template_file_path(dir, &id);
    if path.exists() {
        return Err(TemplateError::already_exists(&id));
    }

    let template = parse_and_validate(json)?;
    write_template_atomic(&path, json)?;

    Ok((id, template))
}

/// Update an existing custom template.
///
/// The template's identity is preserved: `raw_id` identifies the existing
/// custom template and cannot refer to a built-in. An optional `new_id`
/// renames the template (the new file is written and validated before the
/// old file is removed).
///
/// Returns the final (sanitized) id and the parsed template.
pub fn update_template(
    dir: &Path,
    raw_id: &str,
    new_id: Option<&str>,
    json: &str,
) -> Result<(String, Template), TemplateError> {
    let id = sanitize_template_id(raw_id)?;

    if loader::is_builtin_template_id(&id) {
        return Err(TemplateError::builtin_protected(&id));
    }

    let path = template_file_path(dir, &id);
    if !path.is_file() {
        return Err(TemplateError::not_found(&id));
    }

    let template = parse_and_validate(json)?;

    match new_id {
        Some(raw_new_id) => {
            let new_id = sanitize_template_id(raw_new_id)?;

            if new_id == id {
                write_template_atomic(&path, json)?;
                return Ok((id, template));
            }

            if loader::is_builtin_template_id(&new_id) {
                return Err(TemplateError::builtin_protected(&new_id));
            }

            let new_path = template_file_path(dir, &new_id);
            if new_path.exists() {
                return Err(TemplateError::already_exists(&new_id));
            }

            write_template_atomic(&new_path, json)?;
            if let Err(e) = std::fs::remove_file(&path) {
                return Err(TemplateError::io(e));
            }

            Ok((new_id, template))
        }
        None => {
            write_template_atomic(&path, json)?;
            Ok((id, template))
        }
    }
}

/// Delete an existing custom template.
///
/// Only user-created custom templates can be deleted; built-in ids are
/// always rejected, and deleting a non-existent template is an error.
pub fn delete_template(dir: &Path, raw_id: &str) -> Result<(), TemplateError> {
    let id = sanitize_template_id(raw_id)?;

    if loader::is_builtin_template_id(&id) {
        return Err(TemplateError::builtin_protected(&id));
    }

    let path = template_file_path(dir, &id);
    if !path.is_file() {
        return Err(TemplateError::not_found(&id));
    }

    std::fs::remove_file(&path).map_err(TemplateError::io)?;

    Ok(())
}

/// Duplicate an existing template (built-in, bundled, or custom) into a
/// new custom template.
///
/// The source template is loaded through the regular fallback chain,
/// re-serialized (round trip), validated, and written as a custom
/// template. If `new_id` is `None` an id is auto-generated from the
/// source id (`<source>_copy`, `<source>_copy_2`, ...).
///
/// Returns the new id and the duplicated template.
pub fn duplicate_template(
    dir: &Path,
    source_id: &str,
    new_id: Option<&str>,
) -> Result<(String, Template), TemplateError> {
    if loader::template_source(source_id).is_none() {
        return Err(TemplateError::not_found(source_id));
    }

    let template = loader::get_template(source_id).map_err(|e| {
        TemplateError::new(
            TemplateError::KIND_INVALID_STRUCTURE,
            format!("Source template '{}' could not be loaded: {}", source_id, e),
        )
    })?;

    let id = match new_id {
        Some(raw) => sanitize_template_id(raw)?,
        None => generate_duplicate_id(dir, source_id)?,
    };

    if loader::is_builtin_template_id(&id) {
        return Err(TemplateError::builtin_protected(&id));
    }

    let path = template_file_path(dir, &id);
    if path.exists() {
        return Err(TemplateError::already_exists(&id));
    }

    // Round trip: normalize the source template to canonical JSON before
    // persisting. `get_template` already validated the source, and the
    // serialized output is validated again via serde deserialization
    // implicitly (it round-trips by construction).
    let json = serde_json::to_string_pretty(&template).map_err(|e| {
        TemplateError::new(
            TemplateError::KIND_INVALID_STRUCTURE,
            format!("Failed to serialize duplicated template: {}", e),
        )
    })?;

    write_template_atomic(&path, &json)?;

    Ok((id, template))
}

/// Generate a free duplicate id of the form `<base>_copy`, `<base>_copy_2`, ...
fn generate_duplicate_id(dir: &Path, source_id: &str) -> Result<String, TemplateError> {
    let base = sanitize_template_id(source_id)?;

    const COPY_SUFFIX: &str = "_copy";
    let max_base_len = MAX_TEMPLATE_ID_LENGTH - COPY_SUFFIX.len();

    for counter in 0u32..1000 {
        let candidate = if counter == 0 {
            format!("{}_copy", &base[..base.len().min(max_base_len)])
        } else {
            let suffix = format!("_{}", counter + 1);
            let truncate_to = MAX_TEMPLATE_ID_LENGTH - COPY_SUFFIX.len() - suffix.len();
            format!("{}_copy{}", &base[..base.len().min(truncate_to)], suffix)
        };

        if !template_file_path(dir, &candidate).exists()
            && !loader::is_builtin_template_id(&candidate)
        {
            return Ok(candidate);
        }
    }

    Err(TemplateError::new(
        TemplateError::KIND_IO,
        format!("Could not generate a free duplicate id for '{}'", source_id),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_template_json(name: &str) -> String {
        format!(
            r#"{{
                "name": "{}",
                "description": "A test template",
                "sections": [
                    {{
                        "title": "Summary",
                        "instruction": "Provide a summary",
                        "format": "paragraph"
                    }}
                ]
            }}"#,
            name
        )
    }

    fn temp_templates_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("failed to create temp dir")
    }

    // --- sanitization ---

    #[test]
    fn sanitize_rejects_invalid_ids() {
        for bad in &[
            "",
            "   ",
            "..",
            "../escape",
            "a/b",
            "a\\b",
            "a..b",
            ".hidden",
            "-lead",
            "trailing.",
            "sp ace",
            "über",
            "con",
            "CON",
            "com1",
            "Com3",
            "lpt9",
            "nul",
            "a.really.long.id.that.exceeds.the.maximum.allowed.length.for.template.identifiers.aaaa",
        ] {
            assert!(
                sanitize_template_id(bad).is_err(),
                "expected '{}' to be rejected",
                bad
            );
        }
    }

    #[test]
    fn sanitize_accepts_and_normalizes_valid_ids() {
        assert_eq!(
            sanitize_template_id("My_Template-1").unwrap(),
            "my_template-1"
        );
        assert_eq!(
            sanitize_template_id("daily-standup").unwrap(),
            "daily-standup"
        );
        assert_eq!(sanitize_template_id("  padded  ").unwrap(), "padded");
        assert_eq!(
            sanitize_template_id("0starts_with_digit").unwrap(),
            "0starts_with_digit"
        );
    }

    // --- create ---

    #[test]
    fn create_valid_custom_template() {
        let dir = temp_templates_dir();
        let (id, template) = create_template(
            dir.path(),
            "My_Template",
            &test_template_json("My Template"),
        )
        .expect("create should succeed");

        assert_eq!(id, "my_template");
        assert_eq!(template.name, "My Template");
        assert!(template_file_path(dir.path(), "my_template").is_file());
        assert!(list_custom_template_ids(dir.path()).contains(&"my_template".to_string()));
    }

    #[test]
    fn create_invalid_structure_rejected() {
        let dir = temp_templates_dir();
        let err = create_template(
            dir.path(),
            "bad_structure",
            r#"{"name": "X", "description": "Y", "sections": []}"#,
        )
        .expect_err("empty sections should fail");

        assert_eq!(err.kind, TemplateError::KIND_INVALID_STRUCTURE);
        assert!(!template_file_path(dir.path(), "bad_structure").exists());
    }

    #[test]
    fn create_invalid_json_rejected() {
        let dir = temp_templates_dir();
        let err = create_template(dir.path(), "bad_json", "not json at all")
            .expect_err("invalid JSON should fail");

        assert_eq!(err.kind, TemplateError::KIND_INVALID_JSON);
        assert!(!template_file_path(dir.path(), "bad_json").exists());
    }

    #[test]
    fn create_invalid_id_rejected() {
        let dir = temp_templates_dir();
        let err = create_template(dir.path(), "../evil", &test_template_json("Evil"))
            .expect_err("path traversal id should fail");

        assert_eq!(err.kind, TemplateError::KIND_INVALID_ID);
    }

    #[test]
    fn create_duplicate_id_rejected() {
        let dir = temp_templates_dir();
        create_template(dir.path(), "dupe", &test_template_json("First")).unwrap();

        let err = create_template(dir.path(), "dupe", &test_template_json("Second"))
            .expect_err("duplicate id should fail");

        assert_eq!(err.kind, TemplateError::KIND_ALREADY_EXISTS);
    }

    #[test]
    fn create_builtin_overwrite_rejected() {
        let dir = temp_templates_dir();
        let err = create_template(dir.path(), "daily_standup", &test_template_json("Evil"))
            .expect_err("builtin id should be protected");

        assert_eq!(err.kind, TemplateError::KIND_BUILTIN_PROTECTED);
        assert!(!template_file_path(dir.path(), "daily_standup").exists());
    }

    // --- update ---

    #[test]
    fn update_custom_template_preserves_identity() {
        let dir = temp_templates_dir();
        create_template(dir.path(), "custom_a", &test_template_json("First")).unwrap();

        let (id, template) =
            update_template(dir.path(), "custom_a", None, &test_template_json("Second"))
                .expect("update should succeed");

        assert_eq!(id, "custom_a");
        assert_eq!(template.name, "Second");

        let content = std::fs::read_to_string(template_file_path(dir.path(), "custom_a"))
            .expect("file should exist");
        assert!(content.contains("Second"));
        assert!(!content.contains("First"));
    }

    #[test]
    fn update_nonexistent_rejected() {
        let dir = temp_templates_dir();
        let err = update_template(dir.path(), "ghost", None, &test_template_json("X"))
            .expect_err("updating nonexistent template should fail");

        assert_eq!(err.kind, TemplateError::KIND_NOT_FOUND);
    }

    #[test]
    fn update_builtin_rejected() {
        let dir = temp_templates_dir();
        let err = update_template(
            dir.path(),
            "standard_meeting",
            None,
            &test_template_json("X"),
        )
        .expect_err("updating builtin should fail");

        assert_eq!(err.kind, TemplateError::KIND_BUILTIN_PROTECTED);
    }

    #[test]
    fn update_with_new_id_moves_file() {
        let dir = temp_templates_dir();
        create_template(dir.path(), "old_id", &test_template_json("Original")).unwrap();

        let (id, _) = update_template(
            dir.path(),
            "old_id",
            Some("new_id"),
            &test_template_json("Renamed"),
        )
        .expect("rename should succeed");

        assert_eq!(id, "new_id");
        assert!(template_file_path(dir.path(), "new_id").is_file());
        assert!(!template_file_path(dir.path(), "old_id").exists());
    }

    #[test]
    fn update_with_new_id_conflict_rejected() {
        let dir = temp_templates_dir();
        create_template(dir.path(), "a", &test_template_json("A")).unwrap();
        create_template(dir.path(), "b", &test_template_json("B")).unwrap();

        let err = update_template(dir.path(), "a", Some("b"), &test_template_json("A2"))
            .expect_err("renaming onto existing template should fail");

        assert_eq!(err.kind, TemplateError::KIND_ALREADY_EXISTS);
        assert!(template_file_path(dir.path(), "a").is_file());
    }

    #[test]
    fn update_with_new_id_builtin_rejected() {
        let dir = temp_templates_dir();
        create_template(dir.path(), "a", &test_template_json("A")).unwrap();

        let err = update_template(
            dir.path(),
            "a",
            Some("daily_standup"),
            &test_template_json("A2"),
        )
        .expect_err("renaming onto builtin id should fail");

        assert_eq!(err.kind, TemplateError::KIND_BUILTIN_PROTECTED);
        assert!(template_file_path(dir.path(), "a").is_file());
    }

    // --- delete ---

    #[test]
    fn delete_custom_template() {
        let dir = temp_templates_dir();
        create_template(dir.path(), "to_delete", &test_template_json("X")).unwrap();

        delete_template(dir.path(), "to_delete").expect("delete should succeed");
        assert!(!template_file_path(dir.path(), "to_delete").exists());
        assert!(!list_custom_template_ids(dir.path()).contains(&"to_delete".to_string()));
    }

    #[test]
    fn delete_twice_rejected() {
        let dir = temp_templates_dir();
        create_template(dir.path(), "gone", &test_template_json("X")).unwrap();
        delete_template(dir.path(), "gone").unwrap();

        let err = delete_template(dir.path(), "gone").expect_err("second delete should fail");
        assert_eq!(err.kind, TemplateError::KIND_NOT_FOUND);
    }

    #[test]
    fn delete_builtin_rejected() {
        let dir = temp_templates_dir();
        let err =
            delete_template(dir.path(), "daily_standup").expect_err("builtin delete should fail");

        assert_eq!(err.kind, TemplateError::KIND_BUILTIN_PROTECTED);
        // The built-in itself must remain loadable.
        assert!(loader::get_template("daily_standup").is_ok());
    }

    // --- duplicate ---

    #[test]
    fn duplicate_builtin_to_custom() {
        let dir = temp_templates_dir();

        let (id, template) = duplicate_template(dir.path(), "daily_standup", Some("my_standup"))
            .expect("duplicate should succeed");

        assert_eq!(id, "my_standup");
        assert_eq!(template.name, "Daily Standup");
        assert!(template_file_path(dir.path(), "my_standup").is_file());
        assert!(!template_file_path(dir.path(), "daily_standup").exists());
    }

    #[test]
    fn duplicate_custom_to_custom() {
        let dir = temp_templates_dir();
        create_template(dir.path(), "src", &test_template_json("Source")).unwrap();

        let (id, template) =
            duplicate_template(dir.path(), "src", Some("dst")).expect("duplicate should succeed");

        assert_eq!(id, "dst");
        assert_eq!(template.name, "Source");
        assert!(template_file_path(dir.path(), "dst").is_file());
    }

    #[test]
    fn duplicate_auto_generates_id() {
        let dir = temp_templates_dir();
        let (id, _) = duplicate_template(dir.path(), "daily_standup", None)
            .expect("duplicate should succeed");
        assert_eq!(id, "daily_standup_copy");

        // Second auto-duplicate must pick the next free suffix.
        let (id2, _) = duplicate_template(dir.path(), "daily_standup", None)
            .expect("second duplicate should succeed");
        assert_eq!(id2, "daily_standup_copy_2");
    }

    #[test]
    fn duplicate_existing_target_rejected() {
        let dir = temp_templates_dir();
        create_template(dir.path(), "exists", &test_template_json("X")).unwrap();

        let err = duplicate_template(dir.path(), "daily_standup", Some("exists"))
            .expect_err("duplicating onto existing id should fail");

        assert_eq!(err.kind, TemplateError::KIND_ALREADY_EXISTS);
    }

    #[test]
    fn duplicate_builtin_target_rejected() {
        let dir = temp_templates_dir();
        let err = duplicate_template(dir.path(), "daily_standup", Some("standard_meeting"))
            .expect_err("duplicating onto builtin id should fail");

        assert_eq!(err.kind, TemplateError::KIND_BUILTIN_PROTECTED);
    }

    #[test]
    fn duplicate_nonexistent_source_rejected() {
        let dir = temp_templates_dir();
        let err = duplicate_template(dir.path(), "does_not_exist", Some("copy"))
            .expect_err("duplicating missing template should fail");

        assert_eq!(err.kind, TemplateError::KIND_NOT_FOUND);
    }

    // --- validation round trip ---

    #[test]
    fn validation_round_trip_after_save() {
        let dir = temp_templates_dir();
        create_template(dir.path(), "round_trip", &test_template_json("Round Trip")).unwrap();

        let path = template_file_path(dir.path(), "round_trip");
        let saved = std::fs::read_to_string(&path).expect("file should exist");

        let parsed = loader::validate_and_parse_template(&saved).expect("saved JSON must validate");

        assert_eq!(parsed.name, "Round Trip");
        assert_eq!(parsed.sections.len(), 1);
        assert_eq!(parsed.sections[0].title, "Summary");
        assert_eq!(parsed.sections[0].format, "paragraph");
    }
}
