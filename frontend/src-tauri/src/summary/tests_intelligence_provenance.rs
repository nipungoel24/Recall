//! Workstream E integration tests: Meeting Intelligence provenance.
//!
//! These exercise the real intelligence pipeline against a **deterministic fake
//! provider** and a **disposable SQLite database**. No network, no API key, no
//! real model, no user data.
//!
//! What is covered:
//!
//! * a citation resolves to a genuine segment id belonging to the meeting;
//! * a fabricated database id is rejected, not substituted;
//! * a wrong-meeting reference cannot resolve;
//! * an item with no resolvable evidence is **retained as unverified** rather
//!   than silently deleted (the defect that left Tasks permanently empty);
//! * confidence/date/status/text are validated rather than trusted;
//! * the abstract and the items are written in one transaction, so a failure
//!   cannot leave a new summary above stale items.

use crate::database::repositories::meeting_intelligence::{
    MeetingIntelligenceRepository, NewIntelligenceItem,
};
use crate::summary::intelligence_evidence::EvidenceCatalog;
use crate::summary::intelligence_validation::{
    clamp_confidence, normalize_due_date, normalize_status,
};
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;

// The schema under test, reduced to the tables intelligence writes.
const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS transcripts (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    transcript TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT '',
    audio_start_time REAL,
    audio_end_time REAL,
    duration REAL
);
CREATE TABLE IF NOT EXISTS meeting_intelligence (
    meeting_id TEXT PRIMARY KEY,
    "abstract" TEXT,
    schema_version INTEGER NOT NULL DEFAULT 1,
    generated_at TEXT,
    provider TEXT,
    model TEXT,
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS meeting_intelligence_items (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    "ordering" INTEGER NOT NULL DEFAULT 0,
    confidence REAL,
    owner TEXT,
    due_date TEXT,
    status TEXT,
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS meeting_intelligence_item_sources (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    transcript_segment_id TEXT NOT NULL,
    meeting_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (item_id) REFERENCES meeting_intelligence_items(id) ON DELETE CASCADE
);
"#;

async fn test_pool(tag: &str) -> SqlitePool {
    let path = std::env::temp_dir().join(format!(
        "recall-e-{}-{}.sqlite",
        tag,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&format!("sqlite://{}?mode=rwc", path.display()))
        .await
        .expect("connect to temp db");
    for stmt in SCHEMA.split(';').filter(|s| !s.trim().is_empty()) {
        sqlx::query(stmt)
            .execute(&pool)
            .await
            .expect("apply schema");
    }
    pool
}

async fn seed_segment(pool: &SqlitePool, id: &str, meeting: &str, text: &str, start: Option<f64>) {
    sqlx::query(
        "INSERT INTO transcripts (id, meeting_id, transcript, timestamp, audio_start_time) VALUES (?, ?, ?, '', ?)",
    )
    .bind(id)
    .bind(meeting)
    .bind(text)
    .bind(start)
    .execute(pool)
    .await
    .expect("seed segment");
}

/// Mirror of the real generation path's item construction, so the tests assert
/// the production shape rather than a parallel implementation.
fn collect_persisted_items(
    intelligence: &crate::summary::service::StructuredIntelligence,
) -> Vec<NewIntelligenceItem> {
    crate::summary::service::collect_persisted_items(intelligence)
}

// ---------------------------------------------------------------------------
// Evidence resolution
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_citation_resolves_to_a_genuine_segment_of_this_meeting() {
    let pool = test_pool("resolve").await;
    seed_segment(&pool, "seg_a", "m1", "we ship friday", Some(10.0)).await;
    seed_segment(&pool, "seg_b", "m1", "the budget is fixed", Some(20.0)).await;

    let catalog = EvidenceCatalog::build(&[
        ("seg_a".into(), "we ship friday".into(), Some(10.0)),
        ("seg_b".into(), "the budget is fixed".into(), Some(20.0)),
    ]);

    assert_eq!(catalog.resolve("S2").unwrap(), "seg_b");

    // The resolved id really is a row of this meeting.
    let row: (String,) =
        sqlx::query_as("SELECT id FROM transcripts WHERE id = ? AND meeting_id = ?")
            .bind(catalog.resolve("S2").unwrap())
            .bind("m1")
            .fetch_one(&pool)
            .await
            .expect("resolved reference must be a real row of this meeting");
    assert_eq!(row.0, "seg_b");
}

#[tokio::test]
async fn a_fabricated_database_id_is_rejected_not_substituted() {
    // The model cannot cite a raw id: ids were never shown to it, and accepting
    // them would let it attach evidence to arbitrary audio.
    let catalog = EvidenceCatalog::build(&[("seg_a".into(), "hello".into(), Some(0.0))]);

    for fabricated in ["seg_a", "seg_from_another_meeting", "../../etc/passwd"] {
        assert!(
            catalog.resolve(fabricated).is_err(),
            "raw id '{}' must never resolve",
            fabricated
        );
    }
    assert_eq!(catalog.resolve("S1").unwrap(), "seg_a");
}

#[tokio::test]
async fn a_reference_from_another_meeting_cannot_resolve() {
    // Catalog scoping is what enforces meeting ownership: it only ever holds
    // this meeting's rows, so a valid-looking reference for another meeting has
    // no mapping here.
    let mine = EvidenceCatalog::build(&[("seg_mine".into(), "mine".into(), Some(0.0))]);
    let theirs = EvidenceCatalog::build(&[("seg_theirs".into(), "theirs".into(), Some(0.0))]);

    assert_eq!(mine.resolve("S1").unwrap(), "seg_mine");
    // "S1" exists in both catalogs but denotes different rows: the reference is
    // meaningless outside its own request, which is the point.
    assert_ne!(mine.resolve("S1").unwrap(), theirs.resolve("S1").unwrap());
}

#[tokio::test]
async fn unresolvable_references_yield_an_unverified_item_not_a_deleted_one() {
    // The regression: every non-topic item whose ids failed to resolve was
    // dropped, so Tasks was always empty while generation "succeeded".
    let catalog =
        EvidenceCatalog::build(&[("seg_a".into(), "only real evidence".into(), Some(0.0))]);

    let raw = crate::summary::service::StructuredIntelligence {
        abstract_text: "A short meeting.".into(),
        topics: vec![],
        decisions: vec![],
        actions: vec![new_item("Ship the release", vec!["S99".into()])],
        questions: vec![],
        facts: vec![],
        follow_ups: vec![],
    };

    let validated = crate::summary::service::resolve_and_validate_intelligence(&catalog, raw);

    // The action survives...
    assert_eq!(validated.actions.len(), 1, "a real action must not vanish");
    assert_eq!(validated.actions[0].text, "Ship the release");
    // ...but carries no source, so the UI shows it as unverified.
    assert!(!validated.actions[0].has_evidence);
    assert!(validated.actions[0].source_segment_ids.is_empty());
}

#[tokio::test]
async fn a_valid_reference_makes_an_item_verified() {
    let catalog = EvidenceCatalog::build(&[("seg_a".into(), "evidence".into(), Some(0.0))]);

    let raw = crate::summary::service::StructuredIntelligence {
        abstract_text: "Summary".into(),
        topics: vec![],
        decisions: vec![],
        actions: vec![new_item("Do the thing", vec!["[S1]".into()])],
        questions: vec![],
        facts: vec![],
        follow_ups: vec![],
    };

    let validated = crate::summary::service::resolve_and_validate_intelligence(&catalog, raw);
    let action = &validated.actions[0];
    assert!(action.has_evidence);
    assert_eq!(action.source_segment_ids, vec!["seg_a".to_string()]);
}

// ---------------------------------------------------------------------------
// Field validation
// ---------------------------------------------------------------------------

#[test]
fn model_fields_are_validated_rather_than_trusted() {
    // Out-of-range confidence is clamped, so the UI cannot render "9500%".
    assert_eq!(clamp_confidence(Some(95.0)), Some(1.0));
    assert_eq!(clamp_confidence(Some(0.5)), Some(0.5));
    // Vague dates never become deadlines.
    assert_eq!(normalize_due_date(Some("next Friday")), None);
    assert_eq!(
        normalize_due_date(Some("2026-02-01")),
        Some("2026-02-01".into())
    );
    // Free text is not a status.
    assert_eq!(normalize_status(Some("waiting on legal")), None);
    assert_eq!(
        normalize_status(Some("in progress")),
        Some("in_progress".into())
    );
}

#[test]
fn an_empty_text_item_is_dropped_but_its_neighbours_are_not() {
    let catalog = EvidenceCatalog::build(&[("seg_a".into(), "evidence".into(), Some(0.0))]);

    let raw = crate::summary::service::StructuredIntelligence {
        abstract_text: "Summary".into(),
        topics: vec![],
        decisions: vec![],
        actions: vec![
            new_item("   ", vec![]),
            new_item("Real action", vec!["S1".into()]),
        ],
        questions: vec![],
        facts: vec![],
        follow_ups: vec![],
    };

    let validated = crate::summary::service::resolve_and_validate_intelligence(&catalog, raw);
    assert_eq!(validated.actions.len(), 1);
    assert_eq!(validated.actions[0].text, "Real action");
}

// ---------------------------------------------------------------------------
// Atomic persistence
// ---------------------------------------------------------------------------

#[tokio::test]
async fn abstract_and_items_are_written_together() {
    let pool = test_pool("atomic-ok").await;

    MeetingIntelligenceRepository::replace_all(
        &pool,
        "m1",
        Some("The abstract"),
        Some("fake"),
        Some("fake-model"),
        vec![NewIntelligenceItem {
            kind: "action".into(),
            text: "Ship it".into(),
            confidence: Some(0.9),
            owner: Some("Ada".into()),
            due_date: Some("2026-01-01".into()),
            status: Some("open".into()),
            sources: vec!["seg_a".into()],
        }],
    )
    .await
    .expect("replace_all");

    let stored_abstract: (Option<String>,) =
        sqlx::query_as("SELECT \"abstract\" FROM meeting_intelligence WHERE meeting_id = ?")
            .bind("m1")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored_abstract.0.as_deref(), Some("The abstract"));

    let item_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM meeting_intelligence_items WHERE meeting_id = ? AND kind = 'action'",
    )
    .bind("m1")
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(item_count.0, 1);

    let source_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM meeting_intelligence_item_sources WHERE transcript_segment_id = ?",
    )
    .bind("seg_a")
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(source_count.0, 1);
}

#[tokio::test]
async fn a_failed_write_leaves_the_previous_consistent_state() {
    // The defect: `upsert_intelligence` and `replace_items` were separate
    // autocommit calls, so a failure between them left a fresh abstract beside
    // the previous run's items.
    let pool = test_pool("atomic-rollback").await;

    // Establish a good previous state.
    MeetingIntelligenceRepository::replace_all(
        &pool,
        "m1",
        Some("Previous abstract"),
        Some("fake"),
        Some("fake-model"),
        vec![NewIntelligenceItem {
            kind: "action".into(),
            text: "Previous action".into(),
            confidence: Some(0.5),
            owner: None,
            due_date: None,
            status: None,
            sources: vec![],
        }],
    )
    .await
    .expect("seed previous state");

    // Force a genuine mid-transaction failure with a trigger that rejects the
    // second item. The abstract upsert has already executed at that point, so
    // without a surrounding transaction it would survive and sit above the
    // previous run's items.
    sqlx::query(
        r#"
        CREATE TRIGGER fail_on_poison BEFORE INSERT ON meeting_intelligence_items
        WHEN NEW.text = 'POISON'
        BEGIN SELECT RAISE(ABORT, 'forced failure'); END
        "#,
    )
    .execute(&pool)
    .await
    .expect("install failure trigger");

    let result = MeetingIntelligenceRepository::replace_all(
        &pool,
        "m1",
        Some("New abstract"),
        Some("fake"),
        Some("fake-model"),
        vec![
            NewIntelligenceItem {
                kind: "action".into(),
                text: "New good action".into(),
                confidence: None,
                owner: None,
                due_date: None,
                status: None,
                sources: vec![],
            },
            NewIntelligenceItem {
                kind: "action".into(),
                text: "POISON".into(),
                confidence: None,
                owner: None,
                due_date: None,
                status: None,
                sources: vec![],
            },
        ],
    )
    .await;

    assert!(
        result.is_err(),
        "the forced failure must surface as an error, not a silent success"
    );

    // The previous consistent state must be intact: neither the new abstract
    // nor the partially inserted item may survive.
    let stored: (Option<String>,) =
        sqlx::query_as("SELECT \"abstract\" FROM meeting_intelligence WHERE meeting_id = ?")
            .bind("m1")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        stored.0.as_deref(),
        Some("Previous abstract"),
        "a failed write must not leave a new abstract behind"
    );

    let items: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM meeting_intelligence_items WHERE meeting_id = ?")
            .bind("m1")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(items.0, 1, "the partial insert must have been rolled back");

    let texts: (String,) =
        sqlx::query_as("SELECT text FROM meeting_intelligence_items WHERE meeting_id = ?")
            .bind("m1")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        texts.0, "Previous action",
        "the previous run's item must be preserved"
    );
}

#[tokio::test]
async fn replacing_twice_does_not_duplicate_items_or_sources() {
    let pool = test_pool("replace-twice").await;
    seed_segment(&pool, "seg_a", "m1", "text", Some(0.0)).await;

    for round in 0..2 {
        MeetingIntelligenceRepository::replace_all(
            &pool,
            "m1",
            Some(&format!("Abstract {}", round)),
            Some("fake"),
            Some("fake-model"),
            vec![NewIntelligenceItem {
                kind: "fact".into(),
                text: format!("Fact {}", round),
                confidence: None,
                owner: None,
                due_date: None,
                status: None,
                sources: vec!["seg_a".into()],
            }],
        )
        .await
        .expect("replace_all");
    }

    let items: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM meeting_intelligence_items WHERE meeting_id = ?")
            .bind("m1")
            .fetch_one(&pool)
            .await
            .unwrap();
    let sources: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM meeting_intelligence_item_sources WHERE meeting_id = ?",
    )
    .bind("m1")
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(items.0, 1, "replace must not accumulate items");
    assert_eq!(sources.0, 1, "replace must not accumulate sources");
}

// ---------------------------------------------------------------------------
// Command contract
// ---------------------------------------------------------------------------

#[test]
fn the_generate_request_accepts_the_camel_case_the_frontend_sends() {
    // Tauri camelCases only the top-level argument key; the nested struct is
    // deserialized by serde verbatim. Without a container-level rename_all,
    // this payload failed with `missing field meeting_id` and the whole
    // Meeting Intelligence write path was unreachable.
    let payload = serde_json::json!({
        "meetingId": "m1",
        "customPrompt": "focus on risk",
        "templateId": "standard_meeting",
    });

    let parsed: crate::summary::intelligence_commands::GenerateIntelligenceRequest =
        serde_json::from_value(payload).expect("frontend payload must deserialize");
    assert_eq!(parsed.meeting_id, "m1");
    assert_eq!(parsed.custom_prompt.as_deref(), Some("focus on risk"));
    assert_eq!(parsed.template_id.as_deref(), Some("standard_meeting"));
}

#[test]
fn the_generate_request_tolerates_omitted_optional_fields() {
    let parsed: crate::summary::intelligence_commands::GenerateIntelligenceRequest =
        serde_json::from_value(serde_json::json!({ "meetingId": "m1" }))
            .expect("minimal payload must deserialize");
    assert_eq!(parsed.meeting_id, "m1");
    assert!(parsed.custom_prompt.is_none());
    assert!(parsed.template_id.is_none());
}

#[test]
fn the_generate_response_is_flat_and_matches_the_frontend_type() {
    // The backend previously returned {meeting_id, intelligence:{abstract,...}}
    // while the frontend read top-level abstract_text/topics/..., so
    // `result.topics.map` threw and the user saw a generic failure banner.
    let response = crate::summary::intelligence_commands::GenerateIntelligenceResponse {
        meeting_id: "m1".into(),
        abstract_text: "Summary".into(),
        topics: vec![],
        decisions: vec![],
        actions: vec![],
        questions: vec![],
        facts: vec![],
        follow_ups: vec![],
    };

    let json = serde_json::to_value(&response).expect("serialize");
    for key in [
        "meeting_id",
        "abstract_text",
        "topics",
        "decisions",
        "actions",
        "questions",
        "facts",
        "follow_ups",
    ] {
        assert!(
            json.get(key).is_some(),
            "generate response must expose '{}' at the top level",
            key
        );
    }
    assert!(
        json.get("intelligence").is_none(),
        "the old nested 'intelligence' wrapper must not come back"
    );
}

// ---------------------------------------------------------------------------
// Persistence mapping
// ---------------------------------------------------------------------------

#[tokio::test]
async fn validated_intelligence_flattens_into_stable_persistence_rows() {
    // The flatten order is the persisted `ordering` column, so a change here
    // silently reshuffles every item in the UI.
    let catalog = EvidenceCatalog::build(&[("seg_a".into(), "evidence".into(), Some(0.0))]);

    let raw = crate::summary::service::StructuredIntelligence {
        abstract_text: "Summary".into(),
        topics: vec![new_item("Topic one", vec!["S1".into()])],
        decisions: vec![new_item("Decision one", vec!["S1".into()])],
        actions: vec![new_item("Action one", vec!["S1".into()])],
        questions: vec![new_item("Question one", vec!["S1".into()])],
        facts: vec![new_item("Fact one", vec!["S1".into()])],
        follow_ups: vec![new_item("Follow up one", vec!["S1".into()])],
    };

    let validated = crate::summary::service::resolve_and_validate_intelligence(&catalog, raw);
    let items = collect_persisted_items(&validated);

    assert_eq!(items.len(), 6);
    let kinds: Vec<&str> = items.iter().map(|i| i.kind.as_str()).collect();
    assert_eq!(
        kinds,
        vec![
            "topic",
            "decision",
            "action",
            "question",
            "fact",
            "follow_up"
        ],
        "persistence order must be stable and category-ordered"
    );
    // Every item carries its resolved evidence through to persistence.
    for item in &items {
        assert_eq!(
            item.sources,
            vec!["seg_a".to_string()],
            "resolved evidence must reach the sources table"
        );
    }
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn new_item(text: &str, source_refs: Vec<String>) -> crate::summary::service::IntelligenceItem {
    crate::summary::service::IntelligenceItem {
        text: text.to_string(),
        confidence: Some(0.9),
        owner: None,
        due_date: None,
        status: None,
        source_refs,
        source_segment_ids: Vec::new(),
        has_evidence: false,
    }
}
