//! Meeting summary template management
//!
//! This module provides a flexible template system for generating meeting summaries.
//! It supports both built-in templates (embedded in the binary) and custom user templates
//! (loaded from the application data directory).
//!
//! # Architecture
//!
//! - **Built-in templates**: JSON files in `frontend/src-tauri/templates/` embedded at compile time
//! - **Custom templates**: JSON files in platform-specific app data directory
//! - **Fallback strategy**: Custom templates override built-in templates with the same ID
//!
//! # Usage
//!
//! ```rust
//! use app_lib::summary::templates;
//!
//! // Load a specific template
//! let template = templates::get_template("daily_standup").expect("daily standup template exists");
//!
//! // Generate markdown structure
//! let markdown = template.to_markdown_structure();
//!
//! // Generate LLM instructions
//! let instructions = template.to_section_instructions();
//!
//! // List available templates
//! let available = templates::list_templates();
//! ```
//!
//! # Custom Templates
//!
//! Users can add custom templates to:
//! - macOS: `~/Library/Application Support/Recall/templates/`
//! - Windows: `%APPDATA%\Recall\templates\`
//! - Linux: `~/.config/Recall/templates/`
//!
//! (Upgrades with templates in the pre-rename `Meetily` locations keep using
//! those locations; see `crate::brand_paths`.)
//!
//! Custom templates must follow the JSON schema defined in `types::Template`.

mod defaults;
mod loader;
pub(crate) mod store;
mod types;

// Re-export public API
pub use loader::{
    get_template, get_template_json_raw, is_builtin_template_id, list_template_ids, list_templates,
    list_templates_with_source, set_bundled_templates_dir, template_source,
    validate_and_parse_template,
};
pub use store::TemplateError;
pub use types::{Template, TemplateSection, TemplateSource};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_module_integration() {
        // Test that we can load all built-in templates
        let ids = list_template_ids();
        assert!(!ids.is_empty());

        for id in ids {
            let result = get_template(&id);
            assert!(
                result.is_ok(),
                "Failed to load template '{}': {:?}",
                id,
                result.err()
            );
        }
    }

    #[test]
    fn test_template_metadata() {
        let templates = list_templates();
        assert!(!templates.is_empty());

        for (id, name, description) in templates {
            assert!(!id.is_empty());
            assert!(!name.is_empty());
            assert!(!description.is_empty());
        }
    }
}
