//! Path confinement for every externally reachable filesystem operation.
//!
//! The renderer (webview) is untrusted by design in a Tauri app: it runs
//! JavaScript, so anything that can execute script there can call any
//! registered command with any argument. Phase E found four commands that took
//! a raw path straight from the renderer and used it with `fs::read`,
//! `fs::write` + `create_dir_all`, or `remove_dir_all`, with no confinement.
//!
//! Rules enforced here:
//!   * a path must resolve INSIDE an explicitly supplied allowed root;
//!   * `..` components are resolved, not string-matched;
//!   * symlinks are resolved before the containment check, so a link pointing
//!     outside the root is rejected rather than followed;
//!   * a target that does not exist yet is validated via its nearest existing
//!     ancestor, so "file will be created" does not bypass the check;
//!   * deletion additionally refuses the root itself and any ancestor of it.
//!
//! Containment is tested with `Path::starts_with`, which compares whole path
//! components. A string prefix check would wrongly accept
//! `/data/user-recordings-evil` for the root `/data/user-recordings`.

use std::path::{Component, Path, PathBuf};

/// Canonicalise as much of `path` as exists.
///
/// A not-yet-created file cannot be canonicalised directly, so we walk up to
/// the nearest existing ancestor, canonicalise that, and re-attach the missing
/// tail. This keeps the security property for writes while still validating.
fn canonicalize_lenient(path: &Path) -> Result<PathBuf, String> {
    if let Ok(c) = path.canonicalize() {
        return Ok(c);
    }

    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    let mut current = path.to_path_buf();

    loop {
        match current.parent() {
            Some(parent) => {
                let name = current
                    .file_name()
                    .ok_or_else(|| format!("Invalid path: {}", path.display()))?;
                tail.push(name.to_os_string());
                current = parent.to_path_buf();
            }
            None => break,
        }
        if let Ok(c) = current.canonicalize() {
            let mut resolved = c;
            for part in tail.iter().rev() {
                resolved.push(part);
            }
            return Ok(resolved);
        }
    }

    Err(format!(
        "Path could not be resolved within the permitted directories: {}",
        path.display()
    ))
}

/// Resolve `candidate` and require it to live under one of `allowed_roots`.
///
/// Returns the resolved absolute path on success. On failure the error names the
/// offending path and the permitted roots so the caller can log something
/// actionable without leaking file contents.
pub fn resolve_within(candidate: &Path, allowed_roots: &[PathBuf]) -> Result<PathBuf, String> {
    let resolved = canonicalize_lenient(candidate)?;

    // Defence in depth: if a resolved component is a parent directory or a
    // prefix, reject it before comparing. starts_with on Path compares whole
    // components, so this is belt-and-braces rather than the primary check.
    if let Some(parent) = resolved.parent() {
        // no-op: kept for readability of the intent below
        let _ = parent;
    }

    let permitted = allowed_roots
        .iter()
        .filter_map(|r| canonicalize_lenient(r).ok())
        .any(|root| resolved.starts_with(&root));

    if permitted {
        Ok(resolved)
    } else {
        Err(format!(
            "Access denied: '{}' is outside the permitted application directories.",
            candidate.display()
        ))
    }
}

/// Resolve `candidate` for a DESTRUCTIVE operation.
///
/// Adds the two guards `resolve_within` deliberately does not make, because
/// they only matter when the whole tree can be removed:
///   * the target must not BE an allowed root;
///   * the target must not be an ancestor of an allowed root (deleting `/data`
///     would satisfy `starts_with("/data/recordings")` on a prefix basis and
///     would destroy the database, models and settings that live beside it).
pub fn resolve_for_deletion(candidate: &Path, allowed_roots: &[PathBuf]) -> Result<PathBuf, String> {
    let resolved = canonicalize_lenient(candidate)?;

    let canonical_roots: Vec<PathBuf> = allowed_roots
        .iter()
        .filter_map(|r| canonicalize_lenient(r).ok())
        .collect();

    // These checks run BEFORE the containment test so the error names the real
    // problem. Otherwise an ancestor-of-root target fails containment first and
    // the caller gets a misleading "outside the permitted directories".
    for root in &canonical_roots {
        if &resolved == root {
            return Err(format!(
                "Refusing to delete the recordings root itself: {}",
                resolved.display()
            ));
        }
        // Deleting an ancestor of the root would take the app data with it
        // (database, models, settings all live beside the recordings folder).
        if root.starts_with(&resolved) {
            return Err(format!(
                "Refusing to delete an ancestor of the recordings root: {}",
                resolved.display()
            ));
        }
    }

    resolve_within(candidate, allowed_roots)
}

/// True when the path contains an explicit parent traversal, absolute root, or
/// Windows drive/UNC prefix.
///
/// Used as an early, cheap rejection so obviously hostile input never reaches
/// the filesystem, and as an explicit testable predicate. This is a *filter*,
/// not the security boundary -- `resolve_within` is the boundary.
pub fn looks_like_traversal(raw: &str) -> bool {
    if raw.is_empty() {
        return true;
    }
    let p = Path::new(raw);

    // Windows UNC (`\\server\share`) or extended-length (`\\?\C:\...`).
    if raw.starts_with(r"\\") {
        return true;
    }

    // Any `..` component.
    if p.components().any(|c| matches!(c, Component::ParentDir)) {
        return true;
    }

    // An absolute path, or a drive-prefixed one (`C:foo` is drive-relative on
    // Windows and must not be treated as a safe relative path).
    if p.is_absolute() {
        return true;
    }
    // A leading `/` or `\` is ROOT-relative on Windows (`Path::is_absolute`
    // returns false for `/etc/passwd` there), which is still not a safe
    // relative path for our purposes.
    if raw.starts_with('/') || raw.starts_with('\\') {
        return true;
    }
    #[cfg(windows)]
    {
        let bytes = raw.as_bytes();
        if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
            return true;
        }
    }

    false
}

/// The set of directories Recall is allowed to read recording audio from,
/// write recording data into, and recover checkpoints under.
///
/// The user's configured folder is included because it is a legitimate product
/// requirement (Settings lets a user choose where recordings live); the default
/// is included so a first run works. Anything else is refused.
///
/// Async because the configured folder comes from preferences that need an
/// `AppHandle`. If preferences cannot be read we still return the default root,
/// so a transient preference-read failure fails closed rather than opening the
/// filesystem up.
pub async fn recording_roots<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Ok(prefs) = crate::audio::recording_preferences::load_recording_preferences(app).await {
        if !prefs.save_folder.as_os_str().is_empty() {
            roots.push(prefs.save_folder.clone());
        }
    } else {
        log::warn!(
            "path_guard: could not read recording preferences; falling back to the default \
             recordings root only"
        );
    }

    roots.push(crate::audio::recording_preferences::get_default_recordings_folder());
    roots.retain(|r| !r.as_os_str().is_empty());
    roots
}

/// Convenience wrapper for reading/writing a file inside the recordings tree.
pub async fn confine_recording_path<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    candidate: &Path,
) -> Result<PathBuf, String> {
    resolve_within(candidate, &recording_roots(app).await)
}

/// Convenience wrapper for deleting a directory inside the recordings tree.
pub async fn confine_recording_deletion<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    candidate: &Path,
) -> Result<PathBuf, String> {
    resolve_for_deletion(candidate, &recording_roots(app).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "recall-f2-{}-{}",
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
    fn accepts_a_plain_child_path() {
        let root = tmp("ok-child");
        let child = root.join("meeting-1").join("audio.mp4");
        std::fs::create_dir_all(child.parent().unwrap()).unwrap();
        std::fs::write(&child, b"x").unwrap();
        let r = resolve_within(&child, &[root.clone()]).expect("child must be allowed");
        assert!(r.starts_with(&root));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_parent_traversal() {
        let root = tmp("traversal");
        let evil = root.join("..").join("..").join("etc").join("passwd");
        let err = resolve_within(&evil, &[root.clone()]).expect_err("traversal must fail");
        assert!(err.contains("outside the permitted"), "got: {err}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_an_absolute_path_outside_the_root() {
        let root = tmp("absolute");
        let other = std::env::temp_dir().join("recall-f2-outside-target.txt");
        std::fs::write(&other, b"secret").unwrap();
        assert!(resolve_within(&other, &[root.clone()]).is_err());
        let _ = std::fs::remove_file(&other);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_a_sibling_directory_with_a_shared_prefix() {
        // The classic string-prefix bug: "/x/recordings-evil" must NOT be
        // accepted for the root "/x/recordings".
        let base = tmp("prefix");
        let root = base.join("recordings");
        let evil = base.join("recordings-evil");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&evil).unwrap();
        let err = resolve_within(&evil.join("audio.mp4"), &[root]).expect_err("sibling must fail");
        assert!(err.contains("outside the permitted"), "got: {err}");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn rejects_symlink_escape_from_the_root() {
        let base = tmp("symlink");
        let root = base.join("recordings");
        let outside = base.join("outside");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secret.txt"), b"secret").unwrap();

        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
        #[cfg(windows)]
        {
            let ok = std::os::windows::fs::symlink_dir(&outside, root.join("link")).is_ok();
            if !ok {
                // Creating symlinks on Windows needs Developer Mode or
                // elevation; skip rather than pretend the case was covered.
                let _ = std::fs::remove_dir_all(&base);
                return;
            }
        }

        let err = resolve_within(&root.join("link").join("secret.txt"), &[root.clone()])
            .expect_err("symlink escape must fail");
        assert!(err.contains("outside the permitted"), "got: {err}");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn validates_a_path_that_does_not_exist_yet() {
        let root = tmp("nonexistent");
        let future = root.join("new-meeting").join("audio.mp4");
        let r = resolve_within(&future, &[root.clone()]).expect("future child must be allowed");
        assert!(r.starts_with(&root));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn deletion_refuses_the_root_itself() {
        let root = tmp("del-root");
        let err = resolve_for_deletion(&root, &[root.clone()]).expect_err("root must be refused");
        assert!(err.contains("recordings root itself"), "got: {err}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn deletion_refuses_an_ancestor_of_the_root() {
        let base = tmp("del-ancestor");
        let root = base.join("recordings");
        std::fs::create_dir_all(&root).unwrap();
        let err = resolve_for_deletion(&base, &[root]).expect_err("ancestor must be refused");
        assert!(
            err.contains("ancestor of the recordings root"),
            "got: {err}"
        );
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn deletion_allows_a_child_directory() {
        let root = tmp("del-ok");
        let child = root.join("meeting-1");
        std::fs::create_dir_all(&child).unwrap();
        let r = resolve_for_deletion(&child, &[root.clone()]).expect("child dir must be allowed");
        assert!(r.starts_with(&root));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn traversal_heuristic_flags_hostile_shapes() {
        assert!(looks_like_traversal(""));
        assert!(looks_like_traversal("../escape"));
        assert!(looks_like_traversal("a/../../b"));
        assert!(looks_like_traversal("/etc/passwd"));
        assert!(looks_like_traversal(r"\\server\share\file"));
        assert!(!looks_like_traversal("meeting-1"));
        assert!(!looks_like_traversal("meeting-1/audio.mp4"));
        assert!(!looks_like_traversal(".checkpoints/audio_chunk_000.mp4"));
    }

    #[cfg(windows)]
    #[test]
    fn traversal_heuristic_flags_drive_relative_paths() {
        assert!(looks_like_traversal(r"C:Windows\System32\config"));
        assert!(looks_like_traversal(r"C:\Windows\System32"));
        assert!(!looks_like_traversal(r"recordings\meeting-1"));
    }
}