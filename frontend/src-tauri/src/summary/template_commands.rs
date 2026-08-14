use crate::summary::templates;
use crate::summary::templates::store::TemplateError;
use crate::summary::templates::TemplateSource;
use serde::{Deserialize, Serialize};
use tauri::Runtime;
use tracing::{info, warn};

/// Template metadata for UI display
#[derive(Debug, Serialize, Deserialize)]
pub struct TemplateInfo {
    /// Template identifier (e.g., "daily_standup", "standard_meeting")
    pub id: String,

    /// Display name for the template
    pub name: String,

    /// Brief description of the template's purpose
    pub description: String,

    /// Where the template comes from: "builtin", "bundled", or "custom"
    #[serde(default)]
    pub source: String,

    /// Whether the template is user-created (editable/deletable)
    #[serde(default)]
    pub is_custom: bool,
}

/// Detailed template structure for preview/debugging
#[derive(Debug, Serialize, Deserialize)]
pub struct TemplateDetails {
    /// Template identifier
    pub id: String,

    /// Display name
    pub name: String,

    /// Description
    pub description: String,

    /// List of section titles in order
    pub sections: Vec<String>,

    /// Where the template comes from: "builtin", "bundled", or "custom"
    #[serde(default)]
    pub source: String,

    /// Whether the template is user-created (editable/deletable)
    #[serde(default)]
    pub is_custom: bool,
}

fn template_info(
    id: String,
    name: String,
    description: String,
    source: TemplateSource,
) -> TemplateInfo {
    TemplateInfo {
        id,
        name,
        description,
        source: source.as_str().to_string(),
        is_custom: source.is_custom(),
    }
}

/// Lists all available templates
///
/// Returns templates from both built-in (embedded), bundled (app resources)
/// and custom (user data directory) sources. Each entry carries a `source`
/// and `is_custom` flag so the UI can distinguish user templates.
///
/// # Returns
/// Vector of TemplateInfo with id, name, description, source, and is_custom
#[tauri::command]
pub async fn api_list_templates<R: Runtime>(
    _app: tauri::AppHandle<R>,
) -> Result<Vec<TemplateInfo>, String> {
    info!("api_list_templates called");

    let template_infos: Vec<TemplateInfo> = templates::list_templates_with_source()
        .into_iter()
        .map(|(id, name, description, source)| template_info(id, name, description, source))
        .collect();

    info!("Found {} available templates", template_infos.len());

    Ok(template_infos)
}

/// Gets detailed information about a specific template
///
/// # Arguments
/// * `template_id` - Template identifier (e.g., "daily_standup")
///
/// # Returns
/// TemplateDetails with full template structure
#[tauri::command]
pub async fn api_get_template_details<R: Runtime>(
    _app: tauri::AppHandle<R>,
    template_id: String,
) -> Result<TemplateDetails, String> {
    info!(
        "api_get_template_details called for template_id: {}",
        template_id
    );

    let template = templates::get_template(&template_id)?;
    let source = templates::template_source(&template_id)
        .ok_or_else(|| format!("Template '{}' not found", template_id))?;

    let section_titles: Vec<String> = template
        .sections
        .iter()
        .map(|section| section.title.clone())
        .collect();

    let details = TemplateDetails {
        id: template_id,
        name: template.name,
        description: template.description,
        sections: section_titles,
        source: source.as_str().to_string(),
        is_custom: source.is_custom(),
    };

    info!("Retrieved template details for '{}'", details.name);

    Ok(details)
}

/// Validates a custom template JSON string
///
/// Useful for template editor UI or validation before saving custom templates
///
/// # Arguments
/// * `template_json` - Raw JSON string of the template
///
/// # Returns
/// Ok(template_name) if valid, Err(error_message) if invalid
#[tauri::command]
pub async fn api_validate_template<R: Runtime>(
    _app: tauri::AppHandle<R>,
    template_json: String,
) -> Result<String, String> {
    info!("api_validate_template called");

    match templates::validate_and_parse_template(&template_json) {
        Ok(template) => {
            info!("Template '{}' validated successfully", template.name);
            Ok(template.name)
        }
        Err(e) => {
            warn!("Template validation failed: {}", e);
            Err(e)
        }
    }
}

/// Creates a new custom template and persists it to the application data
/// templates directory.
///
/// The template id is sanitized (lowercase alphanumeric plus `_`/`-`) and
/// the JSON is validated before anything is written. Built-in ids and
/// existing custom ids are rejected.
///
/// # Arguments
/// * `template_id` - Desired identifier for the new template
/// * `template_json` - Raw JSON string of the template
///
/// # Returns
/// TemplateInfo for the created template on success
#[tauri::command]
pub async fn api_create_template<R: Runtime>(
    _app: tauri::AppHandle<R>,
    template_id: String,
    template_json: String,
) -> Result<TemplateInfo, TemplateError> {
    info!(
        "api_create_template called for template_id: {}",
        template_id
    );

    let dir = templates::store::resolve_custom_templates_dir()?;
    let (id, template) = templates::store::create_template(&dir, &template_id, &template_json)?;

    let created = template_info(
        id,
        template.name,
        template.description,
        TemplateSource::Custom,
    );
    info!(
        "Created custom template '{}' ({})",
        created.name, created.id
    );

    Ok(created)
}

/// Updates an existing custom template.
///
/// The template's identity is preserved unless `new_id` is provided, in
/// which case the template is renamed (validated and written before the
/// old file is removed). Built-in templates can never be updated.
///
/// # Arguments
/// * `template_id` - Identifier of the existing custom template
/// * `template_json` - New raw JSON content (validated before save)
/// * `new_id` - Optional new identifier for the template
///
/// # Returns
/// TemplateInfo for the updated template on success
#[tauri::command]
pub async fn api_update_template<R: Runtime>(
    _app: tauri::AppHandle<R>,
    template_id: String,
    template_json: String,
    new_id: Option<String>,
) -> Result<TemplateInfo, TemplateError> {
    info!(
        "api_update_template called for template_id: {}",
        template_id
    );

    let dir = templates::store::resolve_custom_templates_dir()?;
    let (id, template) =
        templates::store::update_template(&dir, &template_id, new_id.as_deref(), &template_json)?;

    let updated = template_info(
        id,
        template.name,
        template.description,
        TemplateSource::Custom,
    );
    info!(
        "Updated custom template '{}' ({})",
        updated.name, updated.id
    );

    Ok(updated)
}

/// Deletes an existing custom template.
///
/// Only user-created custom templates can be deleted; built-in and bundled
/// templates are always rejected.
///
/// # Arguments
/// * `template_id` - Identifier of the custom template to delete
#[tauri::command]
pub async fn api_delete_template<R: Runtime>(
    _app: tauri::AppHandle<R>,
    template_id: String,
) -> Result<(), TemplateError> {
    info!(
        "api_delete_template called for template_id: {}",
        template_id
    );

    let dir = templates::store::resolve_custom_templates_dir()?;
    templates::store::delete_template(&dir, &template_id)?;

    info!("Deleted custom template '{}'", template_id);

    Ok(())
}

/// Duplicates an existing template (built-in, bundled, or custom) into a
/// new custom template.
///
/// The source is loaded through the regular fallback chain, re-serialized
/// and validated, then persisted as a custom template. If `new_id` is
/// omitted, an id is auto-generated (`<source>_copy`, `<source>_copy_2`,
/// ...). Built-in ids cannot be used as the duplication target.
///
/// # Arguments
/// * `source_template_id` - Identifier of the template to duplicate
/// * `new_template_id` - Optional identifier for the duplicate
///
/// # Returns
/// TemplateInfo for the duplicated template on success
#[tauri::command]
pub async fn api_duplicate_template<R: Runtime>(
    _app: tauri::AppHandle<R>,
    source_template_id: String,
    new_template_id: Option<String>,
) -> Result<TemplateInfo, TemplateError> {
    info!(
        "api_duplicate_template called for source_template_id: {}",
        source_template_id
    );

    let dir = templates::store::resolve_custom_templates_dir()?;
    let (id, template) = templates::store::duplicate_template(
        &dir,
        &source_template_id,
        new_template_id.as_deref(),
    )?;

    let duplicated = template_info(
        id,
        template.name,
        template.description,
        TemplateSource::Custom,
    );
    info!(
        "Duplicated template '{}' into custom template '{}' ({})",
        source_template_id, duplicated.name, duplicated.id
    );

    Ok(duplicated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_list_templates() {
        // This test requires the templates to be embedded/available
        // In a real test environment, you might want to mock the templates module

        // For now, just verify the function compiles and runs
        // You can expand this with more specific assertions
    }

    #[tokio::test]
    async fn test_validate_template_valid() {
        let valid_json = r#"
        {
            "name": "Test Template",
            "description": "A test template",
            "sections": [
                {
                    "title": "Summary",
                    "instruction": "Provide a summary",
                    "format": "paragraph"
                }
            ]
        }"#;

        // Mock app handle would be needed for actual testing
        // For now, test the validation logic directly
        let result = templates::validate_and_parse_template(valid_json);
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_validate_template_invalid() {
        let invalid_json = "invalid json";

        let result = templates::validate_and_parse_template(invalid_json);
        assert!(result.is_err());
    }

    #[test]
    fn test_template_info_source_flags() {
        let custom = template_info(
            "my_tpl".to_string(),
            "My".to_string(),
            "Desc".to_string(),
            TemplateSource::Custom,
        );
        assert!(custom.is_custom);
        assert_eq!(custom.source, "custom");

        let builtin = template_info(
            "daily_standup".to_string(),
            "Daily Standup".to_string(),
            "Desc".to_string(),
            TemplateSource::Builtin,
        );
        assert!(!builtin.is_custom);
        assert_eq!(builtin.source, "builtin");

        let bundled = template_info(
            "project_sync".to_string(),
            "Project Sync".to_string(),
            "Desc".to_string(),
            TemplateSource::Bundled,
        );
        assert!(!bundled.is_custom);
        assert_eq!(bundled.source, "bundled");
    }

    #[test]
    fn test_template_error_serialization() {
        let err = TemplateError::builtin_protected("daily_standup");
        let json = serde_json::to_string(&err).expect("error should serialize");
        assert!(json.contains("\"kind\":\"builtin_protected\""));
        assert!(json.contains("\"message\""));
    }
}
