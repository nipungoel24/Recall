//! Server-derived evidence references for Meeting Intelligence.
//!
//! # The problem this solves
//!
//! The intelligence prompt used to ask the model for `sourceSegmentIds` — the
//! real database ids of transcript segments — while the transcript handed to
//! the model contained **only plain text**. The ids were discarded one line
//! earlier at the call site, and the transcript was then embedded twice, once
//! under a heading that claimed the ids were present.
//!
//! The model therefore had two impossible choices: invent ids, or return none.
//! Inventing ids were later stripped by provenance validation, which silently
//! deleted every decision, action, question, fact and follow-up, leaving only
//! topics. Returning none left every item unverifiable. Tasks was always empty.
//!
//! # The contract
//!
//! The server presents a bounded, stably-numbered view of the meeting's
//! transcript. Each line carries a **request-local reference** (`[S1]`) that is
//! only meaningful for this request, plus its timestamp. The model is asked to
//! cite those references. The server maps them back to genuine persisted
//! segment ids and verifies membership.
//!
//! Two properties follow, and both matter:
//!
//! * A reference can only ever resolve to a segment that is genuinely part of
//!   the meeting being analysed, because the catalog *is* that meeting's
//!   segments. There is no substitution step, so a citation cannot be forged
//!   onto unrelated audio.
//! * An unknown reference is **rejected**, never guessed. The item that carried
//!   it is retained as explicitly unverified rather than deleted, because
//!   silently dropping a real decision is worse than showing it without a
//!   source link.
//!
//! A citation proves the reference points at real source material. It does not
//! prove the claim is semantically true. Nothing here claims otherwise.

use std::collections::HashMap;

/// Upper bound on segments presented to the model.
///
/// Bounds prompt size deterministically. A meeting longer than this is analysed
/// from its opening portion, and the truncation is stated in the prompt rather
/// than being silent.
pub const MAX_EVIDENCE_SEGMENTS: usize = 150;

/// Upper bound on characters of transcript text shown per segment.
pub const MAX_SEGMENT_CHARS: usize = 600;

/// A transcript segment prepared for presentation to the model.
#[derive(Debug, Clone, PartialEq)]
pub struct EvidenceSegment {
    /// Request-local reference, e.g. `"S1"`. Meaningless outside this request.
    pub reference: String,
    /// The real persisted segment id.
    pub segment_id: String,
    /// Recording-relative start time, when the segment has one.
    pub audio_start_time: Option<f64>,
    /// Transcript text, capped to [`MAX_SEGMENT_CHARS`].
    pub text: String,
}

/// Why a model-supplied reference could not be resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReferenceError {
    /// Not shaped like a reference at all (empty, or free prose).
    Malformed(String),
    /// Well-formed but not present in this request's catalog.
    Unknown(String),
}

impl std::fmt::Display for ReferenceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReferenceError::Malformed(r) => write!(f, "malformed evidence reference '{}'", r),
            ReferenceError::Unknown(r) => write!(f, "unknown evidence reference '{}'", r),
        }
    }
}

/// The set of segments offered to the model for one request, plus the mapping
/// back to genuine persisted ids.
#[derive(Debug, Clone, Default)]
pub struct EvidenceCatalog {
    segments: Vec<EvidenceSegment>,
    by_reference: HashMap<String, String>,
    /// True when [`MAX_EVIDENCE_SEGMENTS`] forced part of the meeting to be
    /// dropped from the model-facing view.
    truncated: bool,
}

impl EvidenceCatalog {
    /// Build a catalog from a meeting's transcript rows.
    ///
    /// Ordering is deterministic and matches the transcript render order used by
    /// evidence navigation: by `audio_start_time` with NULLs first, then by
    /// segment id to break ties. Segments with no text are skipped.
    pub fn build(rows: &[(String, String, Option<f64>)]) -> Self {
        let mut ordered: Vec<&(String, String, Option<f64>)> = rows.iter().collect();
        ordered.sort_by(|a, b| {
            a.2.partial_cmp(&b.2)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.0.cmp(&b.0))
        });

        let mut catalog = Self::default();
        for (segment_id, text, audio_start_time) in ordered {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                continue;
            }
            if catalog.segments.len() >= MAX_EVIDENCE_SEGMENTS {
                catalog.truncated = true;
                break;
            }
            let reference = format!("S{}", catalog.segments.len() + 1);
            catalog
                .by_reference
                .insert(reference.clone(), segment_id.clone());
            catalog.segments.push(EvidenceSegment {
                reference,
                segment_id: segment_id.clone(),
                audio_start_time: *audio_start_time,
                text: cap_chars(trimmed, MAX_SEGMENT_CHARS),
            });
        }
        catalog
    }

    pub fn segments(&self) -> &[EvidenceSegment] {
        &self.segments
    }

    pub fn is_empty(&self) -> bool {
        self.segments.is_empty()
    }

    /// Whether the segment cap dropped part of the meeting.
    pub fn is_truncated(&self) -> bool {
        self.truncated
    }

    /// Resolve a model-supplied reference to a genuine persisted segment id.
    ///
    /// Accepts `[S3]`, `S3` and `s3` (models vary in punctuation and case).
    /// Anything else is rejected; no fallback mapping exists.
    pub fn resolve(&self, raw: &str) -> Result<String, ReferenceError> {
        let normalized = raw.trim().trim_start_matches('[').trim_end_matches(']');
        let normalized = normalized.trim();

        let digits = match normalized
            .strip_prefix('S')
            .or_else(|| normalized.strip_prefix('s'))
        {
            Some(rest) => rest,
            None => return Err(ReferenceError::Malformed(raw.to_string())),
        };
        if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
            return Err(ReferenceError::Malformed(raw.to_string()));
        }

        let canonical = format!("S{}", digits);
        match self.by_reference.get(&canonical) {
            Some(id) => Ok(id.clone()),
            None => Err(ReferenceError::Unknown(raw.to_string())),
        }
    }

    /// Resolve every reference on an item, preserving order and dropping
    /// duplicates.
    ///
    /// Unresolvable references are dropped from the result rather than
    /// substituted. The caller decides what an empty result means for the item.
    pub fn resolve_all(&self, refs: &[String]) -> (Vec<String>, Vec<ReferenceError>) {
        let mut resolved: Vec<String> = Vec::new();
        let mut errors: Vec<ReferenceError> = Vec::new();
        for raw in refs {
            match self.resolve(raw) {
                Ok(id) => {
                    if !resolved.contains(&id) {
                        resolved.push(id);
                    }
                }
                Err(e) => errors.push(e),
            }
        }
        (resolved, errors)
    }

    /// Render the transcript view handed to the model.
    pub fn render(&self) -> String {
        if self.segments.is_empty() {
            return "(no transcript segments)".to_string();
        }

        let mut out = String::with_capacity(self.segments.len() * 80);
        for seg in &self.segments {
            out.push('[');
            out.push_str(&seg.reference);
            out.push_str("] ");
            if let Some(start) = seg.audio_start_time {
                if start.is_finite() && start >= 0.0 {
                    out.push_str(&format!(
                        "({:02}:{:02}) ",
                        (start / 60.0) as u32,
                        (start % 60.0) as u32
                    ));
                }
            }
            out.push_str(&seg.text);
            out.push('\n');
        }
        if self.truncated {
            out.push_str(&format!(
                "\n[NOTE: only the first {} segments are shown; later transcript content is not available to cite.]\n",
                MAX_EVIDENCE_SEGMENTS
            ));
        }
        out
    }
}

/// Truncate on a character boundary, appending an ellipsis marker when cut.
fn cap_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max).collect();
    out.push_str(" …");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: &str, text: &str, start: Option<f64>) -> (String, String, Option<f64>) {
        (id.to_string(), text.to_string(), start)
    }

    #[test]
    fn references_are_request_local_and_stable() {
        let catalog = EvidenceCatalog::build(&[
            row("seg_b", "second", Some(10.0)),
            row("seg_a", "first", Some(0.0)),
        ]);

        // Ordered by start time, so references are assigned in render order.
        assert_eq!(catalog.segments()[0].reference, "S1");
        assert_eq!(catalog.segments()[0].segment_id, "seg_a");
        assert_eq!(catalog.segments()[1].reference, "S2");
        assert_eq!(catalog.segments()[1].segment_id, "seg_b");

        assert_eq!(catalog.resolve("S1").unwrap(), "seg_a");
        assert_eq!(catalog.resolve("[S2]").unwrap(), "seg_b");
        assert_eq!(catalog.resolve(" s2 ").unwrap(), "seg_b");
    }

    #[test]
    fn references_are_scoped_to_the_meeting() {
        // A segment id from a different meeting cannot be cited: the catalog only
        // ever contains this meeting's rows, so there is no lookup that could
        // reach it. A raw database id is not a reference at all, so it is
        // rejected as malformed rather than accidentally resolving.
        let catalog = EvidenceCatalog::build(&[row("seg_ours", "ours", Some(0.0))]);
        assert!(catalog.resolve("seg_ours").is_err());
        assert_eq!(catalog.resolve("S1").unwrap(), "seg_ours");
    }

    #[test]
    fn unknown_and_malformed_references_are_rejected_not_guessed() {
        let catalog = EvidenceCatalog::build(&[row("seg_a", "a", Some(0.0))]);

        assert_eq!(
            catalog.resolve("S9"),
            Err(ReferenceError::Unknown("S9".to_string()))
        );
        assert_eq!(
            catalog.resolve("not-a-ref"),
            Err(ReferenceError::Malformed("not-a-ref".to_string()))
        );
        assert_eq!(
            catalog.resolve(""),
            Err(ReferenceError::Malformed("".to_string()))
        );
        assert_eq!(
            catalog.resolve("S1x"),
            Err(ReferenceError::Malformed("S1x".to_string()))
        );
    }

    #[test]
    fn unresolvable_references_are_dropped_while_valid_ones_survive() {
        let catalog =
            EvidenceCatalog::build(&[row("seg_a", "a", Some(0.0)), row("seg_b", "b", Some(1.0))]);

        let (resolved, errors) =
            catalog.resolve_all(&["S1".into(), "S99".into(), "[S2]".into(), "S1".into()]);

        assert_eq!(resolved, vec!["seg_a".to_string(), "seg_b".to_string()]);
        assert_eq!(errors.len(), 1, "the unknown reference must be reported");
    }

    #[test]
    fn null_timestamps_sort_first_and_do_not_panic() {
        // `partial_cmp` on Option yields None-vs-Some; it must not panic.
        let catalog = EvidenceCatalog::build(&[
            row("seg_b", "has time", Some(5.0)),
            row("seg_a", "no time", None),
        ]);
        assert_eq!(catalog.segments()[0].segment_id, "seg_a");
        let rendered = catalog.render();
        assert!(rendered.contains("[S1] no time"));
        assert!(rendered.contains("[S2] (00:05) has time"));
    }

    #[test]
    fn tied_timestamps_break_deterministically_on_id() {
        let a =
            EvidenceCatalog::build(&[row("seg_z", "z", Some(3.0)), row("seg_a", "a", Some(3.0))]);
        let b =
            EvidenceCatalog::build(&[row("seg_a", "a", Some(3.0)), row("seg_z", "z", Some(3.0))]);
        assert_eq!(a.render(), b.render());
        assert_eq!(a.resolve("S1").unwrap(), "seg_a");
    }

    #[test]
    fn empty_segments_are_skipped() {
        let catalog = EvidenceCatalog::build(&[
            row("seg_a", "   ", Some(0.0)),
            row("seg_b", "ok", Some(1.0)),
        ]);
        assert_eq!(catalog.segments().len(), 1);
        assert_eq!(catalog.segments()[0].segment_id, "seg_b");
    }

    #[test]
    fn the_segment_cap_is_enforced_and_disclosed() {
        let rows: Vec<(String, String, Option<f64>)> = (0..MAX_EVIDENCE_SEGMENTS + 25)
            .map(|i| (format!("seg_{}", i), format!("text {}", i), Some(i as f64)))
            .collect();

        let catalog = EvidenceCatalog::build(&rows);
        assert_eq!(catalog.segments().len(), MAX_EVIDENCE_SEGMENTS);
        assert!(catalog.is_truncated());
        // Truncation must be visible to the model, not silent.
        assert!(catalog.render().contains("only the first"));
    }

    #[test]
    fn long_segment_text_is_capped() {
        let long = "x".repeat(MAX_SEGMENT_CHARS * 2);
        let catalog = EvidenceCatalog::build(&[row("seg_a", &long, Some(0.0))]);
        let rendered = catalog.render();
        assert!(rendered.chars().count() < MAX_SEGMENT_CHARS + 64);
        assert!(rendered.contains('…'));
    }

    #[test]
    fn an_empty_catalog_renders_safely() {
        let catalog = EvidenceCatalog::build(&[]);
        assert!(catalog.is_empty());
        assert_eq!(catalog.render(), "(no transcript segments)");
        assert_eq!(
            catalog.resolve("S1"),
            Err(ReferenceError::Unknown("S1".into()))
        );
    }
}
