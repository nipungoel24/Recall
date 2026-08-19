//! Data structures for continuous meeting context memory.
//!
//! Mirrors the binding schema from
//! `docs/MEETILY_INTELLIGENCE_IMPLEMENTATION_CONTRACT.md` §6/§7:
//! - `context_memory_items`: relational per-context working set with kinds
//!   `fact | decision | action | question | note`, per-item provenance
//!   (`source_meeting_id`), free-form `status`, and timestamps.
//! - `contexts.memory_markdown`: the durable-core digest where compacted
//!   knowledge is folded (never full transcripts).

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Default token budget of the rendered compact context memory block.
pub const DEFAULT_CONTEXT_BUDGET_TOKENS: usize = 2400;

/// Floor for runtime budgets (small-context providers still get a compact view).
pub const MIN_CONTEXT_BUDGET_TOKENS: usize = 400;

/// Upper bound (in tokens) of the meeting summary fed to extraction.
pub const EXTRACTION_INPUT_MAX_TOKENS: usize = 8000;

/// Upper bound (in tokens) of the open-items reference shown to the extractor.
pub const OPEN_ITEMS_REFERENCE_MAX_TOKENS: usize = 1500;

/// Minimum source size (in tokens) required to run a memory update.
pub const MIN_EXTRACTION_SOURCE_TOKENS: usize = 40;

/// Maximum characters kept from a single extracted item content.
pub const EXTRACTED_ITEM_CONTENT_MAX_CHARS: usize = 2000;

/// Default number of newest memory items included in compact memory.
pub const DEFAULT_MAX_MEMORY_ITEMS: i64 = 30;

/// Hard cap for the number of memory items in compact memory.
pub const HARD_MAX_MEMORY_ITEMS: i64 = 100;

/// Memory kinds from the binding schema (§6). These are the only categories
/// appropriate to the final schema; the richer conceptual taxonomy (risks,
/// commitments, preferences, project state, ...) is folded into `note` at
/// extraction time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryKind {
    Fact,
    Decision,
    Action,
    Question,
    Note,
}

impl MemoryKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            MemoryKind::Fact => "fact",
            MemoryKind::Decision => "decision",
            MemoryKind::Action => "action",
            MemoryKind::Question => "question",
            MemoryKind::Note => "note",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "fact" => Some(MemoryKind::Fact),
            "decision" => Some(MemoryKind::Decision),
            "action" => Some(MemoryKind::Action),
            "question" => Some(MemoryKind::Question),
            "note" => Some(MemoryKind::Note),
            _ => None,
        }
    }

    /// Kinds that carry a lifecycle status (working-set kinds).
    pub fn is_status_capable(&self) -> bool {
        matches!(self, MemoryKind::Action | MemoryKind::Question)
    }

    /// Default status for newly created items of status-capable kinds.
    pub fn default_status(&self) -> Option<&'static str> {
        if self.is_status_capable() {
            Some(STATUS_OPEN)
        } else {
            None
        }
    }

    /// Terminal statuses a resolution may set for an open item of this kind.
    pub fn terminal_statuses(&self) -> &'static [&'static str] {
        match self {
            MemoryKind::Action => &[STATUS_DONE, STATUS_BLOCKED],
            MemoryKind::Question => &[STATUS_RESOLVED],
            _ => &[],
        }
    }
}

/// Free-form status strings used by the engine (schema allows free-form, but
/// the engine only ever writes/transitions between these).
pub const STATUS_OPEN: &str = "open";
pub const STATUS_DONE: &str = "done";
pub const STATUS_BLOCKED: &str = "blocked";
pub const STATUS_RESOLVED: &str = "resolved";

/// A row of `context_memory_items` (binding schema §6).
#[derive(Debug, Clone, PartialEq, Eq, FromRow, Serialize, Deserialize)]
pub struct MemoryItem {
    pub id: String,
    pub context_id: String,
    pub source_meeting_id: Option<String>,
    pub kind: String,
    pub content: String,
    pub status: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl MemoryItem {
    pub fn kind(&self) -> Option<MemoryKind> {
        MemoryKind::from_str(&self.kind)
    }

    pub fn is_open(&self) -> bool {
        self.status.as_deref() == Some(STATUS_OPEN)
    }

    /// Milliseconds since epoch parsed from `updated_at` (RFC3339); 0 on failure.
    pub fn updated_at_millis(&self) -> i64 {
        chrono::DateTime::parse_from_rfc3339(&self.updated_at)
            .map(|dt| dt.timestamp_millis())
            .unwrap_or(0)
    }
}

/// A memory item joined with its source meeting title for display (§7.1).
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct ContextMemoryItemView {
    pub id: String,
    pub context_id: String,
    pub source_meeting_id: Option<String>,
    pub source_meeting_title: Option<String>,
    pub kind: String,
    pub content: String,
    pub status: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Compact context memory payload for the summary flow (§7.1).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompactContextMemory {
    pub context_id: String,
    pub context_name: String,
    pub memory_markdown: String,
    pub items: Vec<ContextMemoryItemView>,
}

/// Explicit memory budget for the rendered context block. The block never
/// exceeds `context_tokens`; the durable-core `memory_markdown` gets a fixed
/// fraction and the remainder is reserved for working-set items.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MemoryBudget {
    pub context_tokens: usize,
    pub digest_fraction: f64,
    pub per_item_max_chars: usize,
}

impl Default for MemoryBudget {
    fn default() -> Self {
        Self {
            context_tokens: DEFAULT_CONTEXT_BUDGET_TOKENS,
            digest_fraction: 0.30,
            per_item_max_chars: 280,
        }
    }
}

impl MemoryBudget {
    pub fn digest_cap_tokens(&self) -> usize {
        ((self.context_tokens as f64) * self.digest_fraction).max(1.0) as usize
    }

    pub fn items_cap_tokens(&self) -> usize {
        self.context_tokens.saturating_sub(self.digest_cap_tokens())
    }
}

/// Outcome summary of a memory update (for logging and tests).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct MemoryUpdateReport {
    pub added: usize,
    pub refreshed: usize,
    pub resolved: usize,
    /// Items folded into the durable-core `memory_markdown` (compaction).
    pub folded: usize,
    pub active_items: usize,
    pub active_tokens_estimate: usize,
}

/// Rough token estimation (char-based; mirrors the summary processor heuristic).
pub fn estimate_tokens(text: &str) -> usize {
    (text.chars().count() as f64 * 0.35).ceil() as usize
}

/// Truncates text so that its estimated token count stays within `max_tokens`.
pub fn truncate_text_to_tokens(text: &str, max_tokens: usize) -> String {
    let max_chars = ((max_tokens as f64) / 0.35).ceil() as usize;
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max_chars).collect();
    out.push_str("\n… (truncated)");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_round_trips_binding_categories() {
        let all = [
            MemoryKind::Fact,
            MemoryKind::Decision,
            MemoryKind::Action,
            MemoryKind::Question,
            MemoryKind::Note,
        ];
        for kind in all {
            assert_eq!(MemoryKind::from_str(kind.as_str()), Some(kind));
        }
        // The richer conceptual categories are not part of the binding schema.
        assert_eq!(MemoryKind::from_str("action_item"), None);
        assert_eq!(MemoryKind::from_str("open_question"), None);
        assert_eq!(MemoryKind::from_str("risk"), None);
        assert_eq!(MemoryKind::from_str("bogus"), None);
    }

    #[test]
    fn status_capability_and_terminals() {
        assert_eq!(MemoryKind::Action.default_status(), Some("open"));
        assert_eq!(MemoryKind::Question.default_status(), Some("open"));
        assert_eq!(MemoryKind::Fact.default_status(), None);
        assert_eq!(MemoryKind::Decision.default_status(), None);
        assert_eq!(MemoryKind::Note.default_status(), None);

        assert_eq!(MemoryKind::Action.terminal_statuses(), &["done", "blocked"]);
        assert_eq!(MemoryKind::Question.terminal_statuses(), &["resolved"]);
        assert!(MemoryKind::Fact.terminal_statuses().is_empty());
    }

    #[test]
    fn budget_splits_digest_and_items() {
        let budget = MemoryBudget {
            context_tokens: 1000,
            ..Default::default()
        };
        assert_eq!(budget.digest_cap_tokens(), 300);
        assert_eq!(budget.items_cap_tokens(), 700);
    }

    #[test]
    fn truncate_text_to_tokens_bounds_size() {
        let long = "word ".repeat(500);
        let truncated = truncate_text_to_tokens(&long, 100);
        assert!(estimate_tokens(&truncated) <= 100 + estimate_tokens("\n… (truncated)"));
        assert!(truncated.ends_with("(truncated)"));
        assert_eq!(truncate_text_to_tokens("hello", 100), "hello");
    }
}
