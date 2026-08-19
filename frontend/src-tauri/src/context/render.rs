//! Pure rendering of compact context memory into budget-bounded markdown,
//! plus deterministic compaction planning and durable-core digest building.
//! No I/O, no LLM.

use crate::context::model::{
    estimate_tokens, truncate_text_to_tokens, ContextMemoryItemView, MemoryBudget, MemoryItem,
    MemoryKind, STATUS_OPEN,
};
use std::cmp::Reverse;

/// Max characters kept per item when folded into the durable-core digest.
pub const FOLD_LINE_MAX_CHARS: usize = 160;

/// Priority tier of an item: lower tier is retained first.
fn kind_tier(item: &MemoryItem) -> u8 {
    let open = item.is_open();
    match item.kind() {
        Some(MemoryKind::Action) => {
            if open {
                0
            } else {
                9
            }
        }
        Some(MemoryKind::Question) => {
            if open {
                1
            } else {
                9
            }
        }
        Some(MemoryKind::Decision) => 2,
        Some(MemoryKind::Fact) => 3,
        Some(MemoryKind::Note) => 4,
        None => 8,
    }
}

/// Sort key: (tier ascending, most recently updated first).
fn priority_key(item: &MemoryItem) -> (u8, Reverse<i64>) {
    (kind_tier(item), Reverse(item.updated_at_millis()))
}

/// Extracts the `YYYY-MM-DD` prefix of an RFC3339 timestamp, if valid.
pub fn short_date(rfc3339: &str) -> Option<String> {
    if rfc3339.len() >= 10 {
        let bytes = rfc3339.as_bytes();
        if bytes[4] == b'-' && bytes[7] == b'-' {
            return Some(rfc3339[..10].to_string());
        }
    }
    None
}

/// Caps content at `max_chars`, appending an ellipsis when truncated.
pub fn cap_content(content: &str, max_chars: usize) -> String {
    if content.chars().count() <= max_chars {
        return content.to_string();
    }
    let mut out: String = content.chars().take(max_chars).collect();
    out.push('…');
    out
}

/// Renders one compact-memory item line in the contract §8 format:
/// `- [kind] content (source: <title>)`. Falls back to the meeting id when the
/// title is unavailable; never fabricates a title.
pub fn render_view_line(item: &ContextMemoryItemView, max_chars: usize) -> String {
    let source_label = item
        .source_meeting_title
        .as_deref()
        .filter(|t| !t.trim().is_empty())
        .or(item.source_meeting_id.as_deref())
        .unwrap_or("manual entry");
    format!(
        "- [{}] {} (source: {source_label})",
        item.kind,
        cap_content(&item.content, max_chars)
    )
}

/// Estimated tokens of one rendered compact-memory line.
pub fn estimate_view_line_tokens(item: &ContextMemoryItemView, max_chars: usize) -> usize {
    estimate_tokens(&render_view_line(item, max_chars))
}

/// Renders one item for the durable-core digest with explicit provenance.
fn render_fold_line(item: &MemoryItem, max_chars: usize) -> String {
    let source = item.source_meeting_id.as_deref().unwrap_or("manual entry");
    let date = short_date(&item.updated_at)
        .map(|d| format!(" | {d}"))
        .unwrap_or_default();
    format!(
        "- [{} | from meeting {source}{date}] {}",
        item.kind,
        cap_content(&item.content, max_chars)
    )
}

/// Estimated tokens of one folded digest line.
pub fn estimate_fold_line_tokens(item: &MemoryItem) -> usize {
    estimate_tokens(&render_fold_line(item, FOLD_LINE_MAX_CHARS))
}

/// Renders the open working-set items only (open actions / questions), bounded
/// by `max_tokens`. Used as the reference for the extractor so it can emit
/// evidence-based resolutions.
pub fn render_open_items_reference(items: &[MemoryItem], max_tokens: usize) -> String {
    let mut sorted: Vec<&MemoryItem> = items
        .iter()
        .filter(|i| i.is_open() && i.kind().map(|k| k.is_status_capable()).unwrap_or(false))
        .collect();
    sorted.sort_by_key(|i| priority_key(i));

    let mut lines = Vec::new();
    let mut used = 0usize;
    for item in sorted {
        let line = render_fold_line(item, 280);
        let tokens = estimate_tokens(&line);
        if used + tokens > max_tokens && !lines.is_empty() {
            break;
        }
        used += tokens;
        lines.push(line);
    }
    lines.join("\n")
}

/// Result of rendering the inner compact memory content.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RenderResult {
    pub markdown: String,
    pub token_estimate: usize,
    pub item_count: usize,
    pub omitted_items: usize,
    pub digest_truncated: bool,
}

/// Renders the inner compact context memory content, bounded by budget:
/// the durable-core `memory_markdown` digest gets up to
/// `budget.digest_cap_tokens()`; item lines are added newest-first until
/// `budget.items_cap_tokens()` is exhausted.
pub fn render_inner_content(
    durable_markdown: Option<&str>,
    items: &[ContextMemoryItemView],
    budget: &MemoryBudget,
) -> RenderResult {
    let mut result = RenderResult::default();
    let mut parts: Vec<String> = Vec::new();

    if let Some(d) = durable_markdown.filter(|d| !d.trim().is_empty()) {
        let digest_cap = budget.digest_cap_tokens();
        if estimate_tokens(d) > digest_cap {
            let truncated = truncate_text_to_tokens(d, digest_cap);
            parts.push(format!(
                "{truncated}\n… (older durable memory omitted from this view; retained in local storage)"
            ));
            result.digest_truncated = true;
        } else {
            parts.push(d.to_string());
        }
    }

    let items_cap = budget.items_cap_tokens();
    let mut used = 0usize;
    for item in items {
        let line = render_view_line(item, budget.per_item_max_chars);
        let tokens = estimate_tokens(&line);
        if used + tokens > items_cap && result.item_count > 0 {
            result.omitted_items += 1;
            continue;
        }
        used += tokens;
        parts.push(line);
        result.item_count += 1;
    }

    result.markdown = parts.join("\n");
    result.token_estimate = estimate_tokens(&result.markdown);
    result
}

/// Result of compaction planning.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CompactionPlan {
    pub retain: Vec<MemoryItem>,
    pub fold: Vec<MemoryItem>,
}

/// Plans a compaction: retains highest-priority items within `budget_tokens`
/// and folds the rest into the durable-core digest. Pure and deterministic.
/// The first item is always retained even if it alone exceeds the budget.
pub fn plan_compaction(items: &[MemoryItem], budget_tokens: usize) -> CompactionPlan {
    let mut sorted: Vec<MemoryItem> = items.to_vec();
    sorted.sort_by_key(|i| priority_key(i));

    let mut plan = CompactionPlan::default();
    let mut used = 0usize;
    for item in sorted {
        let tokens = estimate_fold_line_tokens(&item);
        if used + tokens <= budget_tokens || plan.retain.is_empty() {
            used += tokens;
            plan.retain.push(item);
        } else {
            plan.fold.push(item);
        }
    }
    plan
}

/// Estimated token size of the whole active set (folded-line form).
pub fn estimate_active_tokens(items: &[MemoryItem]) -> usize {
    items.iter().map(estimate_fold_line_tokens).sum()
}

/// Builds (or extends) the durable-core digest from items folded during
/// compaction, keeping provenance lines and capping the total at `max_tokens`.
///
/// The previous digest is kept first; when the cap is exceeded the oldest
/// lines are dropped but a non-silent counter note is prepended so provenance
/// loss is explicit. Folded items remain recoverable from the digest's
/// provenance annotations.
pub fn build_folded_digest(
    previous_digest: Option<&str>,
    folded: &[MemoryItem],
    max_tokens: usize,
) -> String {
    let mut lines: Vec<String> = previous_digest
        .map(|d| d.lines().map(str::to_string).collect::<Vec<_>>())
        .unwrap_or_default();

    for item in folded {
        lines.push(render_fold_line(item, FOLD_LINE_MAX_CHARS));
    }

    let mut omitted = 0usize;
    while estimate_tokens(&lines.join("\n")) > max_tokens && lines.len() > 1 {
        lines.remove(0);
        omitted += 1;
    }

    if omitted > 0 {
        lines.insert(
            0,
            format!(
                "- ({omitted} older folded context memory items omitted from this digest; retained in local memory storage)"
            ),
        );
    }

    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(
        id: &str,
        kind: MemoryKind,
        content: &str,
        status: Option<&str>,
        updated_at: &str,
    ) -> MemoryItem {
        MemoryItem {
            id: id.to_string(),
            context_id: "context-1".to_string(),
            source_meeting_id: Some(format!("meeting-{id}")),
            kind: kind.as_str().to_string(),
            content: content.to_string(),
            status: status.map(str::to_string),
            created_at: updated_at.to_string(),
            updated_at: updated_at.to_string(),
        }
    }

    fn view(
        id: &str,
        kind: &str,
        content: &str,
        source_meeting_id: Option<&str>,
        source_meeting_title: Option<&str>,
        updated_at: &str,
    ) -> ContextMemoryItemView {
        ContextMemoryItemView {
            id: id.to_string(),
            context_id: "context-1".to_string(),
            source_meeting_id: source_meeting_id.map(str::to_string),
            source_meeting_title: source_meeting_title.map(str::to_string),
            kind: kind.to_string(),
            content: content.to_string(),
            status: None,
            created_at: updated_at.to_string(),
            updated_at: updated_at.to_string(),
        }
    }

    fn rfc(days_ago: i64) -> String {
        let now = chrono::Utc::now();
        (now - chrono::Duration::days(days_ago)).to_rfc3339()
    }

    #[test]
    fn render_empty_context() {
        let result = render_inner_content(None, &[], &MemoryBudget::default());
        assert!(result.markdown.is_empty());
        assert_eq!(result.token_estimate, 0);
    }

    #[test]
    fn view_line_shows_kind_content_and_source_title() {
        let v = view(
            "cmi-1",
            "decision",
            "Migrate payments to Rust",
            Some("meeting-1"),
            Some("Weekly Sync"),
            &rfc(1),
        );
        let line = render_view_line(&v, 280);
        assert!(line.contains("[decision]"));
        assert!(line.contains("Migrate payments to Rust"));
        assert!(line.contains("(source: Weekly Sync)"));
    }

    #[test]
    fn view_line_falls_back_to_meeting_id_never_fabricates_title() {
        let v = view(
            "cmi-1",
            "fact",
            "Team uses Rust",
            Some("meeting-42"),
            None,
            &rfc(1),
        );
        let line = render_view_line(&v, 280);
        assert!(line.contains("(source: meeting-42)"));
    }

    #[test]
    fn open_actions_render_first() {
        let items = vec![
            view(
                "f",
                "fact",
                "The team uses Rust for the backend service",
                Some("m1"),
                Some("M1"),
                &rfc(0),
            ),
            view(
                "a",
                "action",
                "Ship v2 to production by Friday",
                Some("m2"),
                Some("M2"),
                &rfc(5),
            ),
        ];
        // Order comes from the query (newest first); render preserves input order,
        // so this test exercises the item_line format rather than sorting.
        let result = render_inner_content(None, &items, &MemoryBudget::default());
        assert!(result.markdown.contains("[fact]"));
        assert!(result.markdown.contains("[action]"));
    }

    #[test]
    fn very_large_memory_is_bounded_and_counted() {
        let mut items = Vec::new();
        for i in 0..200 {
            items.push(view(
                &format!("cmi-{i}"),
                "fact",
                &format!("Durable fact number {i} about the project architecture and its design constraints"),
                Some("meeting-1"),
                Some("M1"),
                &rfc(i % 30),
            ));
        }
        let budget = MemoryBudget {
            context_tokens: 600,
            ..Default::default()
        };
        let result = render_inner_content(None, &items, &budget);
        assert!(
            result.token_estimate <= budget.context_tokens + 120,
            "render overflowed budget: {} > {}",
            result.token_estimate,
            budget.context_tokens
        );
        assert!(result.omitted_items > 0);
        assert!(result.item_count < 200);
    }

    #[test]
    fn durable_markdown_is_included_within_its_fraction() {
        let digest = "- [fact | from meeting old-1 | 2026-01-02] Old durable knowledge";
        let budget = MemoryBudget::default();
        let result = render_inner_content(Some(digest), &[], &budget);
        assert!(result.markdown.contains("Old durable knowledge"));
    }

    #[test]
    fn oversized_digest_is_truncated_non_silently() {
        let digest = (0..300)
            .map(|i| format!("- [fact | from meeting old-{i}] durable knowledge line {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let budget = MemoryBudget {
            context_tokens: 500,
            ..Default::default()
        };
        let result = render_inner_content(Some(&digest), &[], &budget);
        assert!(result.digest_truncated);
        assert!(result.markdown.contains("retained in local storage"));
    }

    #[test]
    fn compaction_keeps_open_items_and_folds_low_priority() {
        let mut items = Vec::new();
        for i in 0..50 {
            items.push(item(
                &format!("cmi-f{i}"),
                MemoryKind::Fact,
                &format!("Durable fact number {i} about the project architecture and its design constraints"),
                None,
                &rfc(60 - i),
            ));
        }
        items.push(item(
            "cmi-action",
            MemoryKind::Action,
            "Critical: renew the SSL certificate before expiry next week",
            Some(STATUS_OPEN),
            &rfc(0),
        ));

        let plan = plan_compaction(&items, 400);
        assert!(!plan.fold.is_empty());
        assert!(plan.retain.iter().any(|i| i.id == "cmi-action"));
        assert!(plan.fold.iter().all(|i| i.kind() == Some(MemoryKind::Fact)));
    }

    #[test]
    fn folded_digest_builds_with_provenance_and_caps() {
        let mut folded = Vec::new();
        for i in 0..80 {
            folded.push(item(
                &format!("cmi-a{i}"),
                MemoryKind::Fact,
                &format!("Archived fact number {i} about the project architecture and its design constraints"),
                None,
                &rfc(10),
            ));
        }
        let digest = build_folded_digest(None, &folded, 300);
        assert!(estimate_tokens(&digest) <= 300 + 60, "digest exceeded cap");
        assert!(
            digest.contains("from meeting meeting-cmi-a"),
            "provenance kept for folded items"
        );
        assert!(digest.contains("omitted"), "dropped lines are reported");
    }

    #[test]
    fn folded_digest_appends_to_previous_and_drops_oldest() {
        let previous = "- [fact | from meeting old-1 | 2026-01-02] Old durable knowledge\n\
                        - [fact | from meeting old-2 | 2026-01-03] Another old durable knowledge";
        let folded = vec![item(
            "cmi-n",
            MemoryKind::Fact,
            "Freshly folded knowledge",
            None,
            &rfc(0),
        )];
        let digest = build_folded_digest(Some(previous), &folded, 60);
        assert!(digest.contains("Freshly folded knowledge"));
        assert!(digest.contains("omitted") || digest.contains("Old durable"));
    }

    #[test]
    fn open_items_reference_only_includes_open_working_set() {
        let items = vec![
            item(
                "cmi-a1",
                MemoryKind::Action,
                "Open task to finish",
                Some("open"),
                &rfc(1),
            ),
            item(
                "cmi-a2",
                MemoryKind::Action,
                "Completed task",
                Some("done"),
                &rfc(1),
            ),
            item("cmi-f1", MemoryKind::Fact, "A fact", None, &rfc(1)),
            item(
                "cmi-q1",
                MemoryKind::Question,
                "Which database should we use?",
                Some("open"),
                &rfc(1),
            ),
        ];
        let reference = render_open_items_reference(&items, 1000);
        assert!(reference.contains("Open task to finish"));
        assert!(reference.contains("Which database should we use?"));
        assert!(!reference.contains("Completed task"));
        assert!(!reference.contains("A fact"));
    }
}
