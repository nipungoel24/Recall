//! Product brand paths with legacy compatibility.
//!
//! The application was renamed from **Meetily** to **Recall**.
//!
//! Compatibility policy (OPTION A — preserve user data):
//!
//! * The Tauri application identifier (`com.meetily.ai`) is intentionally
//!   preserved, so every path resolved through Tauri's `app_data_dir()` —
//!   SQLite database, recordings saved there, models, stores — is unchanged
//!   and existing user data keeps working with zero migration.
//! * A small number of paths are built directly from the OS data/config
//!   directories with a hardcoded brand folder name (custom templates,
//!   notification settings, model-engine fallbacks, default recordings
//!   folder). Those helpers live here: fresh installs use the `Recall`
//!   locations, while installs that already have `Meetily` data keep using
//!   the legacy locations so nothing disappears after the rebrand.
//!
//! Do NOT "clean up" the legacy constants below: removing them would orphan
//! real user data on upgrade.

use std::path::PathBuf;

/// Current product folder name under OS data directories.
pub const CURRENT_DATA_DIR_NAME: &str = "Recall";
/// Legacy product folder name, kept for upgrade compatibility.
pub const LEGACY_DATA_DIR_NAME: &str = "Meetily";

/// Current product folder name under OS config directories.
pub const CURRENT_CONFIG_DIR_NAME: &str = "recall";
/// Legacy product folder name, kept for upgrade compatibility.
pub const LEGACY_CONFIG_DIR_NAME: &str = "meetily";

/// Resolve `<data_dir>/<brand>/<subdir>`, preferring the current brand.
///
/// Returns the `Recall` path when it exists (or when neither location exists
/// yet, so fresh installs adopt the new brand). Returns the legacy `Meetily`
/// path when it exists and the new one does not, so pre-rename user data
/// (custom templates, downloaded models) remains visible after upgrading.
pub fn branded_data_subdir(subdir: &str) -> Option<PathBuf> {
    let base = dirs::data_dir()?;
    let current = base.join(CURRENT_DATA_DIR_NAME).join(subdir);
    if current.exists() {
        return Some(current);
    }
    let legacy = base.join(LEGACY_DATA_DIR_NAME).join(subdir);
    if legacy.exists() {
        log::info!(
            "Using legacy data directory for compatibility: {}",
            legacy.display()
        );
        return Some(legacy);
    }
    Some(current)
}

/// Resolve `<config_dir>/<brand>/<file>`, preferring the current brand.
///
/// Same compatibility rule as [`branded_data_subdir`]: fresh installs use
/// `recall/...`, upgrades with existing `meetily/...` files keep using them.
pub fn branded_config_file(file: &str) -> Option<PathBuf> {
    let base = dirs::config_dir()?;
    let current = base.join(CURRENT_CONFIG_DIR_NAME).join(file);
    if current.exists() {
        return Some(current);
    }
    let legacy = base.join(LEGACY_CONFIG_DIR_NAME).join(file);
    if legacy.exists() {
        log::info!(
            "Using legacy config file for compatibility: {}",
            legacy.display()
        );
        return Some(legacy);
    }
    Some(current)
}

/// Read an environment override supporting the renamed brand.
///
/// Checks `primary` (e.g. `RECALL_LLAMA_HELPER`) first, then falls back to
/// `legacy` (e.g. `MEETILY_LLAMA_HELPER`) so existing user/machine setups
/// keep working after the rebrand.
pub fn resolve_env(primary: &str, legacy: &str) -> Option<String> {
    if let Ok(value) = std::env::var(primary) {
        return Some(value);
    }
    if let Ok(value) = std::env::var(legacy) {
        log::info!(
            "Using legacy environment variable {} (consider renaming to {})",
            legacy,
            primary
        );
        return Some(value);
    }
    None
}

/// Default recordings folder name for fresh installs.
pub const CURRENT_RECORDINGS_DIR_NAME: &str = "recall-recordings";
/// Legacy default recordings folder name (pre-rename installs).
pub const LEGACY_RECORDINGS_DIR_NAME: &str = "meetily-recordings";

/// Resolve the default recordings folder under `base`.
///
/// Fresh installs get `recall-recordings`. When only the legacy
/// `meetily-recordings` folder exists (pre-rename install), keep using it so
/// the user's existing recordings stay where the app looks for them.
pub fn default_recordings_folder_under(base: PathBuf) -> PathBuf {
    let current = base.join(CURRENT_RECORDINGS_DIR_NAME);
    if current.exists() {
        return current;
    }
    let legacy = base.join(LEGACY_RECORDINGS_DIR_NAME);
    if legacy.exists() {
        log::info!(
            "Using legacy recordings folder for compatibility: {}",
            legacy.display()
        );
        return legacy;
    }
    current
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_env_prefers_primary_over_legacy() {
        std::env::set_var("RECALL_TEST_PRIMARY_XYZ", "primary-value");
        std::env::set_var("MEETILY_TEST_PRIMARY_XYZ", "legacy-value");
        assert_eq!(
            resolve_env("RECALL_TEST_PRIMARY_XYZ", "MEETILY_TEST_PRIMARY_XYZ"),
            Some("primary-value".to_string())
        );
        std::env::remove_var("RECALL_TEST_PRIMARY_XYZ");
        std::env::remove_var("MEETILY_TEST_PRIMARY_XYZ");
    }

    #[test]
    fn test_env_falls_back_to_legacy() {
        std::env::remove_var("RECALL_TEST_FALLBACK_XYZ");
        std::env::set_var("MEETILY_TEST_FALLBACK_XYZ", "legacy-value");
        assert_eq!(
            resolve_env("RECALL_TEST_FALLBACK_XYZ", "MEETILY_TEST_FALLBACK_XYZ"),
            Some("legacy-value".to_string())
        );
        std::env::remove_var("MEETILY_TEST_FALLBACK_XYZ");
    }

    #[test]
    fn test_env_returns_none_when_unset() {
        std::env::remove_var("RECALL_TEST_MISSING_XYZ");
        std::env::remove_var("MEETILY_TEST_MISSING_XYZ");
        assert_eq!(
            resolve_env("RECALL_TEST_MISSING_XYZ", "MEETILY_TEST_MISSING_XYZ"),
            None
        );
    }
}
