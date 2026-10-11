//! Phase F2 security regression tests: template identifier confinement.
//!
//! Phase E found that `sanitize_template_id` ran on every WRITE but that every
//! READ built its path with `dir.join(format!("{}.json", template_id))` from
//! raw input. A traversal id could therefore read -- and via
//! `get_template_json_raw`, return the contents of -- any `.json` file
//! reachable from the templates directory. A value read back out of
//! `settings.defaultTemplateId` is no safer than one typed in, so the
//! validation has to be on the read path too.
//!
//! Every case here uses a temp directory. Nothing touches the real templates
//! directory or the user database.

use crate::summary::templates::loader;
use crate::summary::templates::store::{sanitize_template_id, template_file_path};

/// Every test in this module mutates the process-global template-directory
/// override, so each one takes the SAME guard the pre-existing loader tests use.
/// Without this, `test_discovery_after_save` observes our directory (or vice
/// versa) and fails.
fn guard() -> std::sync::MutexGuard<'static, ()> {
    loader::override_guard()
}

fn tmp(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!(
        "recall-f2-tpl-{}-{}",
        tag,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&d).unwrap();
    d.canonicalize().unwrap()
}

#[test]
fn a_valid_identifier_is_accepted_and_normalised() {
    assert_eq!(sanitize_template_id("my-template_1").unwrap(), "my-template_1");
    // Normalised to lowercase so ids are unambiguous on Windows/macOS.
    assert_eq!(sanitize_template_id("MyTemplate").unwrap(), "mytemplate");
}

#[test]
fn invalid_identifiers_are_rejected() {
    for bad in [
        "",
        "   ",
        "../escape",
        "..",
        "a/b",
        r"a\b",
        "has space",
        "trailing.",
        "-leading-dash",
        "CON",
    ] {
        assert!(
            sanitize_template_id(bad).is_err(),
            "must reject invalid id: {bad:?}"
        );
    }
}

#[test]
fn template_file_path_refuses_to_build_a_traversal_path() {
    let dir = tmp("file-path");
    let built = template_file_path(&dir, "../../etc/passwd");
    let s = built.to_string_lossy();
    assert!(
        !s.contains(".."),
        "a rejected id must not produce a traversing path, got: {s}"
    );
    assert!(
        built.starts_with(&dir),
        "the result must stay inside the templates dir, got: {s}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn template_file_path_builds_the_expected_name_for_a_valid_id() {
    let dir = tmp("file-path-ok");
    let built = template_file_path(&dir, "standup");
    assert!(built.ends_with("standup.json"), "got: {built:?}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_traversal_identifier_cannot_read_a_file_out_of_the_templates_dir() {
    let _g = guard();
    // The core Phase F2 finding: reads were unguarded. Drive the real loader
    // with a traversal id and prove it cannot return another directory's JSON.
    let secret_dir = tmp("secret");
    let secret = secret_dir.join("secret.json");
    std::fs::write(&secret, br#"{"leaked":"yes"}"#).unwrap();

    let templates_dir = tmp("templates");
    // Give the loader a controlled templates directory.
    loader::set_custom_templates_dir_override(Some(templates_dir.clone()));

    let traversal = format!(
        "{}/secret",
        secret_dir.to_string_lossy().replace('\\', "/")
    );

    let loaded = loader::get_template_json_raw(&traversal);
    assert!(
        loaded.is_none(),
        "a traversal id must not load JSON from outside the templates dir, got: {:?}",
        loaded
    );
    assert!(
        !loaded.unwrap_or_default().contains("leaked"),
        "template contents leaked across the boundary"
    );

    loader::set_custom_templates_dir_override(None);
    let _ = std::fs::remove_dir_all(&secret_dir);
    let _ = std::fs::remove_dir_all(&templates_dir);
}

#[test]
fn an_absolute_identifier_cannot_read_an_arbitrary_file() {
    let _g = guard();
    let secret_dir = tmp("secret-abs");
    let secret = secret_dir.join("secret.json");
    std::fs::write(&secret, br#"{"leaked":"absolute"}"#).unwrap();

    let templates_dir = tmp("templates-abs");
    loader::set_custom_templates_dir_override(Some(templates_dir.clone()));

    let loaded = loader::get_template_json_raw(&secret.to_string_lossy());
    assert!(
        loaded.is_none(),
        "an absolute path must not be readable as a template, got: {:?}",
        loaded
    );

    loader::set_custom_templates_dir_override(None);
    let _ = std::fs::remove_dir_all(&secret_dir);
    let _ = std::fs::remove_dir_all(&templates_dir);
}

#[test]
fn a_legacy_persisted_invalid_id_fails_safely() {
    let _g = guard();
    // Simulates settings.defaultTemplateId holding a value written before the
    // read path validated anything. It must not be honoured, and must not
    // panic or fall back to reading a file.
    let templates_dir = tmp("templates-legacy");
    loader::set_custom_templates_dir_override(Some(templates_dir.clone()));
    assert!(loader::get_template_json_raw("../../../etc/passwd").is_none());
    assert!(loader::template_source("../../../etc/passwd").is_none());
    loader::set_custom_templates_dir_override(None);
    let _ = std::fs::remove_dir_all(&templates_dir);
}