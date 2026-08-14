use super::defaults;
use super::store;
use super::types::{Template, TemplateSource};
use once_cell::sync::Lazy;
use std::path::PathBuf;
use std::sync::RwLock;
use tracing::{debug, info, warn};

// Global storage for the bundled templates directory path
static BUNDLED_TEMPLATES_DIR: Lazy<RwLock<Option<PathBuf>>> = Lazy::new(|| RwLock::new(None));

// Test-only override for the custom templates directory so unit tests
// never touch real user app-data.
static CUSTOM_TEMPLATES_DIR_OVERRIDE: Lazy<RwLock<Option<PathBuf>>> =
    Lazy::new(|| RwLock::new(None));

/// Set the bundled templates directory path (called once at app startup)
pub fn set_bundled_templates_dir(path: PathBuf) {
    info!("Bundled templates directory set to: {:?}", path);
    if let Ok(mut dir) = BUNDLED_TEMPLATES_DIR.write() {
        *dir = Some(path);
    }
}

/// Get the bundled templates directory path if it has been set.
pub(crate) fn bundled_templates_dir() -> Option<PathBuf> {
    BUNDLED_TEMPLATES_DIR.read().ok()?.clone()
}

/// Override the custom templates directory (tests only).
#[cfg(test)]
pub fn set_custom_templates_dir_override(path: Option<PathBuf>) {
    if let Ok(mut dir) = CUSTOM_TEMPLATES_DIR_OVERRIDE.write() {
        *dir = path;
    }
}

/// Get the user's custom templates directory path
///
/// Returns the platform-specific application data directory for custom templates:
/// - macOS: ~/Library/Application Support/Meetily/templates/
/// - Windows: %APPDATA%\Meetily\templates\
/// - Linux: ~/.config/Meetily/templates/
pub(crate) fn custom_templates_dir() -> Option<PathBuf> {
    if let Ok(override_dir) = CUSTOM_TEMPLATES_DIR_OVERRIDE.read() {
        if let Some(path) = override_dir.as_ref() {
            return Some(path.clone());
        }
    }

    let mut path = dirs::data_dir()?;
    path.push("Meetily");
    path.push("templates");
    Some(path)
}

/// Load a template from the bundled resources directory
///
/// # Arguments
/// * `template_id` - Template identifier (without .json extension)
///
/// # Returns
/// The template JSON content if found, None otherwise
fn load_bundled_template(template_id: &str) -> Option<String> {
    let bundled_dir = bundled_templates_dir()?;
    let template_path = bundled_dir.join(format!("{}.json", template_id));

    debug!("Checking for bundled template at: {:?}", template_path);

    match std::fs::read_to_string(&template_path) {
        Ok(content) => {
            info!(
                "Loaded bundled template '{}' from {:?}",
                template_id, template_path
            );
            Some(content)
        }
        Err(e) => {
            debug!("No bundled template '{}' found: {}", template_id, e);
            None
        }
    }
}

/// Load a template from the user's custom templates directory
///
/// # Arguments
/// * `template_id` - Template identifier (without .json extension)
///
/// # Returns
/// The template JSON content if found, None otherwise
fn load_custom_template(template_id: &str) -> Option<String> {
    let custom_dir = custom_templates_dir()?;
    let template_path = custom_dir.join(format!("{}.json", template_id));

    debug!("Checking for custom template at: {:?}", template_path);

    match std::fs::read_to_string(&template_path) {
        Ok(content) => {
            info!(
                "Loaded custom template '{}' from {:?}",
                template_id, template_path
            );
            Some(content)
        }
        Err(e) => {
            debug!("No custom template '{}' found: {}", template_id, e);
            None
        }
    }
}

/// Load and parse a template by identifier
///
/// This function implements a fallback strategy:
/// 1. Check user's custom templates directory
/// 2. Check bundled resources directory (app templates)
/// 3. Fall back to built-in embedded templates
/// 4. Return error if not found in any location
///
/// # Arguments
/// * `template_id` - Template identifier (e.g., "daily_standup", "standard_meeting")
///
/// # Returns
/// Parsed and validated Template struct
pub fn get_template(template_id: &str) -> Result<Template, String> {
    info!("Loading template: {}", template_id);

    // Try custom template first, then bundled, then built-in
    let json_content = if let Some(custom_content) = load_custom_template(template_id) {
        debug!("Using custom template for '{}'", template_id);
        custom_content
    } else if let Some(bundled_content) = load_bundled_template(template_id) {
        debug!("Using bundled template for '{}'", template_id);
        bundled_content
    } else if let Some(builtin_content) = defaults::get_builtin_template(template_id) {
        debug!("Using built-in template for '{}'", template_id);
        builtin_content.to_string()
    } else {
        return Err(format!(
            "Template '{}' not found. Available templates: {}",
            template_id,
            list_template_ids().join(", ")
        ));
    };

    // Parse and validate
    validate_and_parse_template(&json_content)
}

/// Validate and parse template JSON
///
/// # Arguments
/// * `json_content` - Raw JSON string
///
/// # Returns
/// Parsed and validated Template struct
pub fn validate_and_parse_template(json_content: &str) -> Result<Template, String> {
    let template: Template = serde_json::from_str(json_content)
        .map_err(|e| format!("Failed to parse template JSON: {}", e))?;

    template.validate()?;

    Ok(template)
}

/// Determine where a template with the given id comes from.
///
/// Checks custom, bundled, then built-in — mirroring the load order of
/// `get_template`.
pub fn template_source(id: &str) -> Option<TemplateSource> {
    if let Some(custom_dir) = custom_templates_dir() {
        if store::template_file_path(&custom_dir, id).is_file() {
            return Some(TemplateSource::Custom);
        }
    }

    if let Some(bundled_dir) = bundled_templates_dir() {
        if bundled_dir.join(format!("{}.json", id)).is_file() {
            return Some(TemplateSource::Bundled);
        }
    }

    if defaults::get_builtin_template(id).is_some() {
        return Some(TemplateSource::Builtin);
    }

    None
}

/// Whether an id refers to a read-only built-in template (embedded or
/// bundled). The custom template CRUD API refuses to create, update,
/// delete, or overwrite such ids.
pub fn is_builtin_template_id(id: &str) -> bool {
    if defaults::get_builtin_template(id).is_some() {
        return true;
    }

    if let Some(bundled_dir) = bundled_templates_dir() {
        if bundled_dir.join(format!("{}.json", id)).is_file() {
            return true;
        }
    }

    false
}

/// List all available template identifiers
///
/// Returns a combined list of:
/// - Built-in template IDs
/// - Bundled template IDs (from app resources)
/// - Custom template IDs (from user's data directory)
pub fn list_template_ids() -> Vec<String> {
    let mut ids: Vec<String> = defaults::list_builtin_template_ids()
        .into_iter()
        .map(|s| s.to_string())
        .collect();

    // Add bundled templates if directory is set
    if let Some(bundled_dir) = bundled_templates_dir() {
        if bundled_dir.exists() {
            match std::fs::read_dir(&bundled_dir) {
                Ok(entries) => {
                    for entry in entries.flatten() {
                        if let Some(filename) = entry.file_name().to_str() {
                            if filename.ends_with(".json") {
                                let id = filename.trim_end_matches(".json").to_string();
                                if !ids.contains(&id) {
                                    ids.push(id);
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    warn!("Failed to read bundled templates directory: {}", e);
                }
            }
        }
    }

    // Add custom templates if directory exists
    if let Some(custom_dir) = custom_templates_dir() {
        for id in store::list_custom_template_ids(&custom_dir) {
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
    }

    ids.sort();
    ids
}

/// List all available templates with their metadata and source.
///
/// Returns a list of (id, name, description, source) tuples. The source
/// distinguishes user-created templates (editable/deletable) from
/// bundled/built-in templates (read-only).
pub fn list_templates_with_source() -> Vec<(String, String, String, TemplateSource)> {
    let mut templates = Vec::new();

    for id in list_template_ids() {
        match get_template(&id) {
            Ok(template) => {
                let source = template_source(&id).unwrap_or(TemplateSource::Builtin);
                templates.push((id, template.name, template.description, source));
            }
            Err(e) => {
                warn!("Failed to load template '{}': {}", id, e);
            }
        }
    }

    templates
}

/// List all available templates with their metadata
///
/// Returns a list of (id, name, description) tuples
pub fn list_templates() -> Vec<(String, String, String)> {
    list_templates_with_source()
        .into_iter()
        .map(|(id, name, description, _)| (id, name, description))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Serialize access to the global template-directory overrides so
    /// parallel tests never observe each other's directories.
    fn override_guard() -> std::sync::MutexGuard<'static, ()> {
        static MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());
        MUTEX.lock().expect("test override mutex poisoned")
    }

    #[test]
    fn test_get_builtin_template() {
        let template = get_template("daily_standup");
        assert!(template.is_ok());

        let template = template.unwrap();
        assert_eq!(template.name, "Daily Standup");
        assert!(!template.sections.is_empty());
    }

    #[test]
    fn test_get_nonexistent_template() {
        let result = get_template("nonexistent_template");
        assert!(result.is_err());
    }

    #[test]
    fn test_list_template_ids() {
        let ids = list_template_ids();
        assert!(ids.contains(&"daily_standup".to_string()));
        assert!(ids.contains(&"standard_meeting".to_string()));
    }

    #[test]
    fn test_validate_invalid_json() {
        let result = validate_and_parse_template("invalid json");
        assert!(result.is_err());
    }

    #[test]
    fn test_builtin_source_and_protection() {
        // daily_standup is embedded, but may also exist in the bundled
        // dir if the bundled test has run first in this test binary.
        assert!(matches!(
            template_source("daily_standup"),
            Some(TemplateSource::Builtin) | Some(TemplateSource::Bundled)
        ));
        assert!(is_builtin_template_id("daily_standup"));
        assert!(is_builtin_template_id("standard_meeting"));
        assert!(!is_builtin_template_id("my_custom_template"));
        assert_eq!(template_source("does_not_exist"), None);
    }

    #[test]
    fn test_discovery_after_save() {
        let _guard = override_guard();
        let temp_dir = tempfile::tempdir().expect("failed to create temp dir");
        set_custom_templates_dir_override(Some(temp_dir.path().to_path_buf()));

        let json = r#"{
            "name": "Discovered",
            "description": "Discovered after save",
            "sections": [
                {
                    "title": "Summary",
                    "instruction": "Provide a summary",
                    "format": "paragraph"
                }
            ]
        }"#;

        // Not visible before creation.
        assert!(!list_template_ids().contains(&"discovered_tpl".to_string()));

        let (id, _) = store::create_template(temp_dir.path(), "discovered_tpl", json)
            .expect("create should succeed");
        assert_eq!(id, "discovered_tpl");

        // Visible after save, with the correct source.
        assert!(list_template_ids().contains(&"discovered_tpl".to_string()));
        assert_eq!(
            template_source("discovered_tpl"),
            Some(TemplateSource::Custom)
        );

        let with_source = list_templates_with_source();
        let (_, name, _, source) = with_source
            .iter()
            .find(|(id, _, _, _)| id == "discovered_tpl")
            .expect("discovered template should be listed");
        assert_eq!(name, "Discovered");
        assert_eq!(*source, TemplateSource::Custom);

        // get_template must load the saved content.
        let loaded = get_template("discovered_tpl").expect("saved template should load");
        assert_eq!(loaded.name, "Discovered");

        // Clean up.
        store::delete_template(temp_dir.path(), "discovered_tpl").expect("delete should succeed");
        assert!(!list_template_ids().contains(&"discovered_tpl".to_string()));

        set_custom_templates_dir_override(None);
    }

    #[test]
    fn test_bundled_templates_are_protected() {
        let _guard = override_guard();
        let temp_dir = tempfile::tempdir().expect("failed to create temp dir");
        set_custom_templates_dir_override(Some(temp_dir.path().to_path_buf()));

        let bundled_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("templates");
        assert!(
            bundled_dir.exists(),
            "bundled templates dir must exist for this test"
        );
        set_bundled_templates_dir(bundled_dir);

        // Bundled-only ids (not embedded) must be protected as built-ins.
        assert!(is_builtin_template_id("project_sync"));
        assert_eq!(
            template_source("project_sync"),
            Some(TemplateSource::Bundled)
        );

        let json = r#"{
            "name": "Sneaky",
            "description": "Tries to overwrite bundled template",
            "sections": [
                {
                    "title": "Summary",
                    "instruction": "Provide a summary",
                    "format": "paragraph"
                }
            ]
        }"#;

        let create_err = store::create_template(temp_dir.path(), "project_sync", json)
            .expect_err("bundled id must be protected");
        assert_eq!(
            create_err.kind,
            store::TemplateError::KIND_BUILTIN_PROTECTED
        );

        let delete_err = store::delete_template(temp_dir.path(), "project_sync")
            .expect_err("bundled id must not be deletable");
        assert_eq!(
            delete_err.kind,
            store::TemplateError::KIND_BUILTIN_PROTECTED
        );

        // Duplicating a bundled template into a custom one must work.
        let (dup_id, dup) = store::duplicate_template(temp_dir.path(), "project_sync", None)
            .expect("duplicating bundled template should succeed");
        assert_eq!(dup_id, "project_sync_copy");
        assert!(!dup.sections.is_empty());

        set_custom_templates_dir_override(None);
    }
}
