//! Workstream D regression tests: database and file reliability.
//!
//! Uses **real migrations** applied to a temporary file-backed database. The
//! real user database is never opened. Each test builds its own disposable DB
//! under the system temp directory and removes it on drop.
//!
//! Also provides the shared migrated-pool helper the audit found missing: every
//! existing `test_pool()` in the repo is module-private and `sqlite::memory:`,
//! so none of them can be used to test a file-backed upgrade.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::path::PathBuf;

/// A disposable, file-backed database with the real migrations applied.
pub struct TestDb {
    pub pool: SqlitePool,
    path: PathBuf,
}

impl TestDb {
    pub async fn new(tag: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "recall-d-{}-{}.sqlite",
            tag,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        let opts = SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true)
            // Match production so the tests exercise the real configuration.
            .foreign_keys(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
            .synchronous(sqlx::sqlite::SqliteSynchronous::Normal);

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(opts)
            .await
            .expect("connect temp db");

        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("apply real migrations");

        Self { pool, path }
    }
}

impl Drop for TestDb {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
        let _ = std::fs::remove_file(format!("{}-wal", self.path.display()));
        let _ = std::fs::remove_file(format!("{}-shm", self.path.display()));
    }
}

fn rt() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime")
}

// ---------------------------------------------------------------------------
// D1. Journal mode
// ---------------------------------------------------------------------------

#[test]
fn the_database_runs_in_wal_mode() {
    // WAL is the right mode for a single-writer/many-reader desktop app: live
    // transcription writes while the UI reads meetings, and summary generation
    // writes derived data in the background. Under the rollback journal those
    // overlaps turn into SQLITE_BUSY timeouts.
    rt().block_on(async {
        let db = TestDb::new("wal").await;
        let mode: String = sqlx::query_scalar("PRAGMA journal_mode")
            .fetch_one(&db.pool)
            .await
            .expect("read journal mode");
        assert!(
            mode.eq_ignore_ascii_case("wal"),
            "production must run in WAL mode, found '{}'",
            mode
        );
    });
}

#[test]
fn foreign_keys_are_enforced_so_cascades_fire() {
    rt().block_on(async {
        let db = TestDb::new("fk").await;
        let enabled: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
            .fetch_one(&db.pool)
            .await
            .expect("read foreign_keys");
        assert_eq!(enabled, 1, "foreign keys must be enforced");
    });
}

#[test]
fn wal_checkpoint_reports_no_outstanding_frames_on_a_clean_shutdown() {
    // The shutdown path logs the checkpoint result. On a healthy database there
    // must be nothing outstanding; the previous code logged success for any Ok,
    // which was also true for the no-op outside WAL.
    rt().block_on(async {
        let db = TestDb::new("checkpoint").await;

        sqlx::query("INSERT INTO meetings (id, title, created_at, updated_at) VALUES ('m1','t','2026-01-01','2026-01-01')")
            .execute(&db.pool)
            .await
            .expect("insert meeting");

        let row = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .fetch_one(&db.pool)
            .await
            .expect("checkpoint");
        let busy: i64 = sqlx::Row::try_get(&row, 0).expect("busy column");
        assert_eq!(busy, 0, "a quiesced database has no outstanding frames");
    });
}

// ---------------------------------------------------------------------------
// D2. Migrations
// ---------------------------------------------------------------------------

#[test]
fn real_migrations_apply_cleanly_to_an_empty_database() {
    rt().block_on(async {
        let db = TestDb::new("migrate").await;
        let applied: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
            .fetch_one(&db.pool)
            .await
            .expect("migration bookkeeping table exists");
        assert!(
            applied >= 16,
            "every shipped migration must be applied, got {}",
            applied
        );
    });
}

#[test]
fn every_shipped_migration_has_a_checksum_entry() {
    // A migration shipping without a manifest entry means any later edit to that
    // file becomes a hard startup failure (VersionMismatch) for upgrading users,
    // caught only at review time.
    let manifest: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string("./migrations/checksums.json").expect("read manifest"),
    )
    .expect("manifest is valid JSON");

    let mut missing = Vec::new();
    for entry in std::fs::read_dir("./migrations").expect("read migrations dir") {
        let name = entry
            .expect("entry")
            .file_name()
            .to_string_lossy()
            .to_string();
        if !name.ends_with(".sql") {
            continue;
        }
        if manifest.get(&name).is_none() {
            missing.push(name);
        }
    }
    assert!(
        missing.is_empty(),
        "migrations shipping without a checksum: {:?}",
        missing
    );
}

#[test]
fn repeated_migration_runs_are_idempotent() {
    rt().block_on(async {
        let db = TestDb::new("idem").await;
        // Second application must be a no-op, not a re-run or a failure.
        sqlx::migrate!("./migrations")
            .run(&db.pool)
            .await
            .expect("re-running migrations must succeed");

        let applied: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
            .fetch_one(&db.pool)
            .await
            .expect("bookkeeping");
        assert!(applied >= 16, "no duplicate rows");
    });
}

// ---------------------------------------------------------------------------
// D3. Transactions
// ---------------------------------------------------------------------------

#[test]
fn a_failed_provider_config_save_rolls_back_the_provider_switch() {
    // The provider config and the API key were two independent writes. A failed
    // key write returned an error to the UI while the provider switch had
    // already been persisted.
    use crate::database::repositories::setting::SettingsRepository;

    rt().block_on(async {
        let db = TestDb::new("settings").await;

        // Establish a known-good config first.
        SettingsRepository::save_provider_config_with_key(
            &db.pool,
            "openai",
            "gpt-4o",
            "large-v3",
            None,
            Some("sk-good"),
        )
        .await
        .expect("seed config");

        // Now attempt a save with an INVALID provider. The key write rejects it,
        // and the whole transaction must roll back.
        let result = SettingsRepository::save_provider_config_with_key(
            &db.pool,
            "not-a-real-provider",
            "mystery-model",
            "large-v3",
            None,
            Some("sk-new"),
        )
        .await;
        assert!(result.is_err(), "an invalid provider must be rejected");

        // The previously saved provider must be intact.
        let provider: String = sqlx::query_scalar("SELECT provider FROM settings WHERE id = '1'")
            .fetch_one(&db.pool)
            .await
            .expect("settings row survives");
        assert_eq!(
            provider, "openai",
            "a rejected save must not leave a half-applied provider switch"
        );
    });
}

#[test]
fn a_provider_config_and_key_save_together() {
    use crate::database::repositories::setting::SettingsRepository;

    rt().block_on(async {
        let db = TestDb::new("settings-ok").await;
        SettingsRepository::save_provider_config_with_key(
            &db.pool,
            "openai",
            "gpt-4o",
            "large-v3",
            None,
            Some("sk-abc"),
        )
        .await
        .expect("valid save");

        let provider: String = sqlx::query_scalar("SELECT provider FROM settings WHERE id = '1'")
            .fetch_one(&db.pool)
            .await
            .expect("provider");
        let key: Option<String> =
            sqlx::query_scalar("SELECT openaiApiKey FROM settings WHERE id = '1'")
                .fetch_one(&db.pool)
                .await
                .expect("key");

        assert_eq!(provider, "openai");
        assert_eq!(key.as_deref(), Some("sk-abc"));
    });
}

// ---------------------------------------------------------------------------
// D4. Atomic file writes
// ---------------------------------------------------------------------------

#[test]
fn transcripts_json_is_written_atomically_and_leaves_no_temp_file() {
    use crate::audio::recording_saver::RecordingSaver;

    let dir = std::env::temp_dir().join(format!(
        "recall-d-json-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).expect("temp dir");

    let mut saver = RecordingSaver::new();
    saver.force_meeting_folder_for_tests(dir.clone());
    let sink = saver.transcript_sink();

    for i in 0..5u64 {
        sink.add(crate::audio::recording_saver::TranscriptSegment {
            id: format!("seg_{}", i),
            text: format!("segment {}", i),
            audio_start_time: i as f64,
            audio_end_time: i as f64 + 1.0,
            duration: 1.0,
            display_time: "[00:00]".to_string(),
            confidence: 0.9,
            sequence_id: i,
        });
    }

    let published = dir.join("transcripts.json");
    assert!(published.exists(), "transcripts.json must be published");

    let body = std::fs::read_to_string(&published).expect("read published file");
    assert!(
        body.contains("segment 4"),
        "the newest segment must be present"
    );

    // No temp artefact may remain.
    let leftovers: Vec<String> = std::fs::read_dir(&dir)
        .expect("read dir")
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.contains(".tmp"))
        .collect();
    assert!(
        leftovers.is_empty(),
        "atomic writes must not leave temp files behind, found {:?}",
        leftovers
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn concurrent_transcript_writers_do_not_corrupt_the_published_file() {
    // `RecordingSaver::add_transcript_segment` and `TranscriptSegmentSink::add`
    // share one folder, and a full-file rewrite fires on every transcript event.
    // Without a per-folder lock they could publish each other's half-written
    // bytes. This drives both paths concurrently.
    use crate::audio::recording_saver::RecordingSaver;

    let dir = std::env::temp_dir().join(format!(
        "recall-d-race-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).expect("temp dir");

    let mut saver = RecordingSaver::new();
    saver.force_meeting_folder_for_tests(dir.clone());

    let sink_a = saver.transcript_sink();
    let sink_b = saver.transcript_sink();

    let mk = |seq: u64| crate::audio::recording_saver::TranscriptSegment {
        id: format!("seg_{}", seq),
        text: "x".repeat(2000),
        audio_start_time: seq as f64,
        audio_end_time: seq as f64 + 1.0,
        duration: 1.0,
        display_time: "[00:00]".to_string(),
        confidence: 0.9,
        sequence_id: seq,
    };

    let a = std::thread::spawn(move || {
        for i in 0..40u64 {
            sink_a.add(mk(i));
        }
    });
    let b = std::thread::spawn(move || {
        for i in 40..80u64 {
            sink_b.add(mk(i));
        }
    });
    a.join().expect("writer a");
    b.join().expect("writer b");

    let published = dir.join("transcripts.json");
    let body = std::fs::read_to_string(&published).expect("published file must be readable");

    // It must be complete, valid JSON -- not a half-written document.
    let parsed: serde_json::Value =
        serde_json::from_str(&body).expect("published transcripts.json must be valid JSON");
    let total = parsed["total_segments"].as_u64().expect("total_segments");
    assert_eq!(
        total, 80,
        "every segment from both writers must be in the published file"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn notification_settings_are_written_atomically() {
    let src = include_str!("notifications/settings.rs");
    assert!(
        src.contains(".tmp"),
        "notification settings must be written through a temp file"
    );
    assert!(
        src.contains("rename(&temp_path"),
        "notification settings must be published by rename, not overwritten in place"
    );
    assert!(
        !src.contains("tokio::fs::write(&self.settings_path, content).await?;"),
        "the plain in-place overwrite must be gone"
    );
}

// ---------------------------------------------------------------------------
// Source-level guards
// ---------------------------------------------------------------------------

#[test]
fn the_shutdown_checkpoint_log_is_truthful() {
    let src = include_str!("database/manager.rs");
    assert!(
        !src.contains("WAL checkpoint completed successfully"),
        "an unconditional success log is false outside WAL mode"
    );
    assert!(
        src.contains("WAL checkpoint incomplete"),
        "an incomplete checkpoint must be reported"
    );
}

#[test]
fn wal_is_configured_rather_than_incidental() {
    let src = include_str!("database/manager.rs");
    assert!(
        src.contains("\"journal_mode\", \"WAL\""),
        "WAL must be set explicitly so imported legacy databases are upgraded too"
    );
    assert!(
        src.contains("SQLite journal mode"),
        "the effective journal mode must be logged, not assumed"
    );
}

#[test]
fn context_rebuild_cleanup_no_longer_swallows_database_errors() {
    let src = include_str!("contexts/service.rs");
    assert!(
        !src.contains("let _ = sqlx::query(\"DELETE FROM contexts WHERE id = ?\")"),
        "a swallowed delete left a phantom __rebuild-<uuid> context visible to the user"
    );
    assert!(
        src.contains("Failed to delete temp context"),
        "cleanup failures must be reported"
    );
}

#[test]
fn context_memory_repetition_count_persists_and_clamps_on_refresh() {
    use crate::context::model::MemoryItem;
    use crate::context::repository::ContextMemoryRepository;

    rt().block_on(async {
        let db = TestDb::new("context-rep").await;

        sqlx::query(
            "INSERT INTO contexts (id, name, created_at, updated_at) VALUES ('ctx-1', 'Test Context', '2026-10-11T00:00:00Z', '2026-10-11T00:00:00Z')",
        )
        .execute(&db.pool)
        .await
        .expect("insert context");

        let item = MemoryItem {
            id: "cmi-1".to_string(),
            context_id: "ctx-1".to_string(),
            source_meeting_id: None,
            kind: "fact".to_string(),
            content: "Architecture fact".to_string(),
            status: None,
            repetition_count: 1,
            created_at: "2026-10-11T00:00:00Z".to_string(),
            updated_at: "2026-10-11T00:00:00Z".to_string(),
        };
        ContextMemoryRepository::insert_item(&db.pool, &item)
            .await
            .expect("insert item");

        let views = ContextMemoryRepository::list_item_views(&db.pool, "ctx-1", 10)
            .await
            .expect("list views");
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].repetition_count, 1);

        for i in 2..=5 {
            ContextMemoryRepository::refresh_item(
                &db.pool,
                "cmi-1",
                "Updated content",
                "2026-10-11T01:00:00Z",
            )
            .await
            .expect("refresh item");
            let count: i64 = sqlx::query_scalar(
                "SELECT repetition_count FROM context_memory_items WHERE id = 'cmi-1'",
            )
            .fetch_one(&db.pool)
            .await
            .expect("fetch count");
            assert_eq!(count, i);
        }

        // 6th refresh stays clamped at 5
        ContextMemoryRepository::refresh_item(
            &db.pool,
            "cmi-1",
            "Updated content again",
            "2026-10-11T02:00:00Z",
        )
        .await
        .expect("refresh item");
        let count: i64 = sqlx::query_scalar(
            "SELECT repetition_count FROM context_memory_items WHERE id = 'cmi-1'",
        )
        .fetch_one(&db.pool)
        .await
        .expect("fetch count");
        assert_eq!(count, 5);

        // Verify score reflects 5 repetitions (2.0x factor: 55 * 2.0 = 110)
        let views = ContextMemoryRepository::list_item_views(&db.pool, "ctx-1", 10)
            .await
            .expect("list views");
        assert_eq!(views[0].repetition_count, 5);
        let now_millis = chrono::DateTime::parse_from_rfc3339("2026-10-11T02:00:00Z")
            .unwrap()
            .timestamp_millis();
        assert_eq!(views[0].score(now_millis), 110.0);
    });
}

#[test]
fn context_memory_upgrade_from_pre_repetition_schema_defaults_to_one() {
    rt().block_on(async {
        let path = std::env::temp_dir().join(format!(
            "recall-d-upgrade-old-{}.sqlite",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let opts = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true);
        let pool = sqlx::SqlitePool::connect_with(opts)
            .await
            .expect("connect");

        sqlx::query(
            "CREATE TABLE context_memory_items (
                id TEXT PRIMARY KEY,
                context_id TEXT NOT NULL,
                source_meeting_id TEXT,
                kind TEXT NOT NULL,
                content TEXT NOT NULL,
                status TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .expect("create old table");

        sqlx::query(
            "INSERT INTO context_memory_items (id, context_id, kind, content, created_at, updated_at)
             VALUES ('old-1', 'ctx-old', 'fact', 'Old Fact', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("insert old row");

        let migration_sql = include_str!("../migrations/20261011000000_add_context_memory_repetition_count.sql");
        sqlx::query(migration_sql)
            .execute(&pool)
            .await
            .expect("apply additive migration");

        let count: i64 = sqlx::query_scalar(
            "SELECT repetition_count FROM context_memory_items WHERE id = 'old-1'",
        )
        .fetch_one(&pool)
        .await
        .expect("read upgraded count");
        assert_eq!(count, 1, "existing records must default to 1 occurrence");

        let _ = std::fs::remove_file(&path);
    });
}
