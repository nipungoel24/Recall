//! Deterministic, conservative duplicate detection and resolution matching.
//!
//! No semantic similarity is used. Two strings count as duplicates when one
//! (normalised) string contains the other and both are long enough / similar
//! enough in length. This deliberately avoids claiming perfect semantic
//! deduplication.

/// Shorter-than-this content is never deduplicated or resolution-matched.
pub const MIN_DEDUP_CONTENT_CHARS: usize = 40;

/// Minimum containment ratio (min len / max len) for duplicate detection.
pub const MIN_DEDUP_CONTAINMENT_RATIO: f64 = 0.6;

/// Resolution references must be at least this long.
pub const MIN_RESOLUTION_MATCH_CHARS: usize = 20;

/// Resolution matching is stricter than dedup to avoid wrongly closing items.
pub const MIN_RESOLUTION_CONTAINMENT_RATIO: f64 = 0.8;

/// Normalises text for comparison: lowercase + collapse all whitespace.
pub fn normalize_text(text: &str) -> String {
    text.to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Containment ratio between two strings: 0.0 when neither contains the other.
pub fn containment_ratio(a: &str, b: &str) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    if !a.contains(b) && !b.contains(a) {
        return 0.0;
    }
    let min_len = a.chars().count().min(b.chars().count()) as f64;
    let max_len = a.chars().count().max(b.chars().count()) as f64;
    min_len / max_len
}

/// Whether `candidate` duplicates `existing` (same kind assumed by caller).
pub fn is_duplicate(candidate: &str, existing: &str) -> bool {
    let a = normalize_text(candidate);
    let b = normalize_text(existing);
    if a.chars().count().min(b.chars().count()) < MIN_DEDUP_CONTENT_CHARS {
        return false;
    }
    containment_ratio(&a, &b) >= MIN_DEDUP_CONTAINMENT_RATIO
}

/// Whether a resolution reference plausibly targets `existing` (same kind).
pub fn is_resolution_match(candidate: &str, existing: &str) -> bool {
    let a = normalize_text(candidate);
    let b = normalize_text(existing);
    if a.chars().count().min(b.chars().count()) < MIN_RESOLUTION_MATCH_CHARS {
        return false;
    }
    containment_ratio(&a, &b) >= MIN_RESOLUTION_CONTAINMENT_RATIO
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_collapses_whitespace_and_case() {
        assert_eq!(
            normalize_text("  Ship   V2  By Friday "),
            "ship v2 by friday"
        );
        assert_eq!(
            normalize_text("Rust\tBackend\nRefactor"),
            "rust backend refactor"
        );
    }

    #[test]
    fn exact_duplicate_detected() {
        let a = "We decided to migrate the payments service to Rust";
        assert!(is_duplicate(a, a));
    }

    #[test]
    fn containment_duplicate_detected() {
        let existing = "We decided to migrate the payments service to Rust by the end of Q3";
        let candidate = "decided to migrate the payments service to Rust";
        assert!(is_duplicate(candidate, existing));
    }

    #[test]
    fn unrelated_content_is_not_duplicate() {
        let a = "We decided to migrate the payments service to Rust by the end of Q3";
        let b = "The design review will happen next Tuesday afternoon";
        assert!(!is_duplicate(a, b));
    }

    #[test]
    fn short_content_never_deduplicates() {
        let a = "ship v2";
        assert!(!is_duplicate(a, a));
    }

    #[test]
    fn low_containment_ratio_is_not_duplicate() {
        let big = "We decided to migrate the payments service to Rust by the end of Q3";
        let small = "migrate the payments";
        assert!(!is_duplicate(small, big));
    }

    #[test]
    fn resolution_match_requires_high_ratio() {
        let existing = "Ship v2 to production by Friday";
        assert!(is_resolution_match(
            "ship v2 to production by friday",
            existing
        ));
        assert!(!is_resolution_match("ship v2", existing));
    }
}
