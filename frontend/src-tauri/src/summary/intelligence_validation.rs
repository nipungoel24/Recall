//! Validation for Meeting Intelligence model output.
//!
//! The context-extraction path already validates hard
//! (`context::extraction`): it strips code fences, scans for the outermost JSON
//! object, normalises status into a closed set, and caps content length. The
//! intelligence path did none of that -- it called `serde_json::from_str`
//! directly on raw output and stored whatever came back.
//!
//! That left user-visible nonsense: `confidence` was rendered as a percentage
//! with no bounds check (a model returning `95` produced "9500%"), `due_date`
//! was stored verbatim ("next Friday"), and any markdown fence around the JSON
//! failed the whole generation.
//!
//! Everything here is defensive and non-fabricating: a value that cannot be
//! trusted is dropped (`None`) rather than guessed at or defaulted.

use chrono::NaiveDate;

/// Maximum characters retained for an intelligence item's text.
pub const MAX_ITEM_TEXT_CHARS: usize = 500;

/// Maximum characters retained for an owner field.
pub const MAX_OWNER_CHARS: usize = 80;

/// Normalise confidence to the closed interval `[0.0, 1.0]`.
///
/// Returns `None` for values that are not finite numbers (NaN, infinity) or
/// that are not present at all. A non-finite confidence is treated as unknown
/// rather than silently becoming 0, because "0%" would be a claim.
pub fn clamp_confidence(raw: Option<f64>) -> Option<f64> {
    let v = raw?;
    if !v.is_finite() {
        return None;
    }
    Some(v.clamp(0.0, 1.0))
}

/// Validate an ISO-8601 date or date-time.
///
/// Ambiguous human phrasing ("next Friday") is rejected rather than guessed at,
/// because turning a vague deadline into a concrete one is exactly the kind of
/// invented fact this codebase must not produce.
pub fn normalize_due_date(raw: Option<&str>) -> Option<String> {
    let s = raw.map(str::trim).filter(|s| !s.is_empty())?;
    if s.chars().count() > 40 {
        return None;
    }

    if let Ok(date) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return Some(date.format("%Y-%m-%d").to_string());
    }
    // Full RFC3339 / date-time with offset: keep only the calendar date, which
    // is what the UI renders.
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(dt.date_naive().format("%Y-%m-%d").to_string());
    }
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S") {
        return Some(dt.date().format("%Y-%m-%d").to_string());
    }
    None
}

/// Normalise a status string into a small closed set.
///
/// Free text like "waiting on legal" is not a status; keeping it would render
/// an arbitrary phrase in a status pill. Unknown values become `None`, which the
/// UI renders as "no status" rather than inventing one.
pub fn normalize_status(raw: Option<&str>) -> Option<String> {
    let s = raw.map(str::trim).filter(|s| !s.is_empty())?;
    let normalized = s.to_ascii_lowercase();
    let out = match normalized.as_str() {
        "open" | "pending" | "todo" | "to do" | "not started" => "open",
        "in progress" | "in_progress" | "doing" | "active" | "started" => "in_progress",
        "done" | "complete" | "completed" | "finished" | "closed" | "resolved" => "done",
        "blocked" | "cancelled" | "canceled" | "dropped" | "wontfix" => "blocked",
        _ => return None,
    };
    Some(out.to_string())
}

/// Trim and cap an owner field.
pub fn normalize_owner(raw: Option<&str>) -> Option<String> {
    let s = raw.map(str::trim).filter(|s| !s.is_empty())?;
    Some(cap_chars(s, MAX_OWNER_CHARS))
}

/// Trim and cap an item's text. Returns `None` when nothing is left.
pub fn normalize_text(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    Some(cap_chars(s, MAX_ITEM_TEXT_CHARS))
}

/// Strip markdown code fences from raw model output.
pub fn strip_code_fences(raw: &str) -> String {
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

/// Parse raw model output into `T`, tolerating code fences and surrounding
/// prose by scanning for the outermost JSON object.
///
/// Mirrors `context::extraction::parse_extraction_output`, which already does
/// this for the memory path. Using the same behaviour means a model that wraps
/// its JSON in ```json fences works for both features.
pub fn parse_json_output<T: serde::de::DeserializeOwned>(raw: &str) -> Result<T, String> {
    let cleaned = strip_code_fences(raw);
    let start = cleaned
        .find('{')
        .ok_or_else(|| "no JSON object found in model output".to_string())?;
    let end = cleaned
        .rfind('}')
        .ok_or_else(|| "no JSON object found in model output".to_string())?;
    if end <= start {
        return Err("malformed model output: unbalanced JSON braces".to_string());
    }
    serde_json::from_str::<T>(&cleaned[start..=end])
        .map_err(|e| format!("invalid JSON in model output: {}", e))
}

/// Truncate on a character boundary, appending an ellipsis marker when cut.
fn cap_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Deserialize)]
    struct Sample {
        #[serde(default)]
        value: Option<f64>,
    }

    #[test]
    fn confidence_is_clamped_not_rendered_raw() {
        assert_eq!(clamp_confidence(Some(0.95)), Some(0.95));
        // A model returning a percentage instead of a fraction must not render
        // as "9500%".
        assert_eq!(clamp_confidence(Some(95.0)), Some(1.0));
        assert_eq!(clamp_confidence(Some(1.5)), Some(1.0));
        assert_eq!(clamp_confidence(Some(-3.0)), Some(0.0));
        assert_eq!(clamp_confidence(Some(0.0)), Some(0.0));
    }

    #[test]
    fn non_finite_confidence_is_unknown_not_zero() {
        assert_eq!(clamp_confidence(Some(f64::NAN)), None);
        assert_eq!(clamp_confidence(Some(f64::INFINITY)), None);
        assert_eq!(clamp_confidence(None), None);
    }

    #[test]
    fn vague_due_dates_are_rejected_rather_than_guessed() {
        assert_eq!(
            normalize_due_date(Some("2026-01-05")),
            Some("2026-01-05".into())
        );
        assert_eq!(
            normalize_due_date(Some("2026-01-05T10:30:00Z")),
            Some("2026-01-05".into())
        );
        assert_eq!(
            normalize_due_date(Some("2026-01-05T10:30:00")),
            Some("2026-01-05".into())
        );
        // Ambiguous or non-date values must not become deadlines.
        assert_eq!(normalize_due_date(Some("next Friday")), None);
        assert_eq!(normalize_due_date(Some("soon")), None);
        assert_eq!(normalize_due_date(Some("")), None);
        assert_eq!(normalize_due_date(None), None);
        assert_eq!(normalize_due_date(Some("   ")), None);
    }

    #[test]
    fn status_is_a_closed_set() {
        assert_eq!(normalize_status(Some("Open")), Some("open".into()));
        assert_eq!(
            normalize_status(Some("in progress")),
            Some("in_progress".into())
        );
        assert_eq!(normalize_status(Some("COMPLETED")), Some("done".into()));
        assert_eq!(normalize_status(Some("blocked")), Some("blocked".into()));
        // Free text is not a status.
        assert_eq!(normalize_status(Some("waiting on legal")), None);
        assert_eq!(normalize_status(Some("")), None);
        assert_eq!(normalize_status(None), None);
    }

    #[test]
    fn owner_and_text_are_capped() {
        let long = "a".repeat(MAX_OWNER_CHARS * 2);
        let owner = normalize_owner(Some(&long)).unwrap();
        assert!(owner.chars().count() <= MAX_OWNER_CHARS + 1);

        let long_text = "b".repeat(MAX_ITEM_TEXT_CHARS * 2);
        let text = normalize_text(&long_text).unwrap();
        assert!(text.chars().count() <= MAX_ITEM_TEXT_CHARS + 1);

        assert_eq!(normalize_text("   "), None);
        assert_eq!(normalize_owner(Some("  ")), None);
    }

    #[test]
    fn fenced_json_is_parsed() {
        let raw = "```json\n{\"value\": 0.5}\n```";
        let parsed: Sample = parse_json_output(raw).expect("fenced JSON must parse");
        assert_eq!(parsed.value, Some(0.5));
    }

    #[test]
    fn json_wrapped_in_prose_is_parsed() {
        let raw = "Here you go:\n{\"value\": 0.25}\nHope that helps!";
        let parsed: Sample = parse_json_output(raw).expect("prose-wrapped JSON must parse");
        assert_eq!(parsed.value, Some(0.25));
    }

    #[test]
    fn malformed_output_is_an_error_not_an_empty_success() {
        assert!(parse_json_output::<Sample>("not json at all").is_err());
        assert!(parse_json_output::<Sample>("{\"value\": ").is_err());
        assert!(parse_json_output::<Sample>("").is_err());
    }

    #[test]
    fn missing_optional_fields_do_not_fail_the_whole_payload() {
        // A model that omits the optional keys entirely must still produce a
        // usable result instead of failing the whole generation.
        let parsed: Sample = parse_json_output("{}").expect("empty object must parse");
        assert_eq!(parsed.value, None);
    }
}
