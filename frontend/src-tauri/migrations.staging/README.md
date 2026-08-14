# Migration Staging — Database & Rust Persistence Engineer

Per the binding contract (`docs/MEETILY_INTELLIGENCE_IMPLEMENTATION_CONTRACT.md` §11 and
§12), migration files are owned by the Integration Owner and feature agents "MUST NOT add
additional migration files in their branches." The Database & Rust Persistence Engineer
therefore stages the exact migration content here instead of editing the live
`src-tauri/migrations/` directory.

`sqlx::migrate!("./migrations")` only reads `frontend/src-tauri/migrations/`, so nothing in
this directory affects the app until the Integration Owner copies it over.

## Files

| File | Status | Content |
|---|---|---|
| `20260815000000_add_context_threads.sql` | REQUIRED | Contract §6 binding schema: `contexts` (+`memory_markdown`), `context_meetings`, `context_memory_items` (+indexes). Replaces the in-flight file of the same name (which still contains the retired opaque `context_memory` table). |
| `20260815000001_add_daily_summaries.sql` | REQUIRED | Contract §5.1 binding schema for `daily_summaries` (+`idx_daily_summaries_date`). Replaces the in-flight file of the same name (which mirrors `summary_processes` and is not the binding schema). |
| `20260815000002_add_meeting_date_index.sql` | OPTIONAL | `CREATE INDEX idx_meetings_created_at ON meetings(created_at)`. **Not applied by default**: the binding range queries (§3.2) normalize with `datetime(created_at)` in the WHERE clause, so SQLite cannot use a `created_at` index for them. Apply only if a future raw-column range query is introduced. |

## In-tree migration housekeeping the Owner should perform

1. `20260815000000_add_context_threads.sql`, `20260815000001_add_daily_summaries.sql`,
   `20260815000002_add_context_memory.sql` currently exist in-tree. The first two were
   renamed by the persistence engineer to fix a duplicate sqlx migration version
   (three files all started with `20260815000000`, which makes `sqlx::migrate!` fail with
   `DuplicateVersion` at compile time). Replace the contents of the first two with the
   staged versions above.
2. Delete the in-tree `20260815000002_add_context_memory.sql` (its
   `context_memory_items`/`context_memory_state` variant is superseded by the binding §6
   schema) — no DB has ever applied it because the duplicate version previously prevented
   the migrator from running.
3. If a dev database already recorded checksum(s) for a `20260815000000`/`20260815000001`
   migration, changing file contents changes checksums: dev machines must delete their
   `meeting_minutes.sqlite` (or the `_sqlx_migrations` rows) — acceptable for pre-release
   dev data per the contract's migration plan.

## Owner-owned Rust edits (content supplied, per contract §12)

### 1. `database/manager.rs` — FK pragma (contract §11)

```rust
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
// replace `let pool = SqlitePool::connect(tauri_db_path).await?;` with:
let options = SqliteConnectOptions::new()
    .filename(tauri_db_path)
    .create_if_missing(true)
    .pragma("foreign_keys", "ON");
let pool = SqlitePoolOptions::new().connect_with(options).await?;
```

### 2. `database/repositories/mod.rs` — register the persistence modules

```rust
pub mod context_memory_items;
pub mod daily_brief;
pub mod meeting_deletion;
pub mod meeting_range;
```

### 3. `database/repositories/meeting.rs` — splice the deletion matrix (contract §9)

Inside `delete_meeting_with_transaction`, replace the manual deletes with the complete
sequence implemented and tested in `meeting_deletion.rs`:

```rust
crate::database::repositories::meeting_deletion::delete_meeting_with_derived_data(
    &mut *transaction,
    meeting_id,
)
.await?;
```

`delete_meeting_with_derived_data` performs, in one transaction: existence check, then
deletes from `context_meetings`, `context_memory_items` (provenance rows),
`daily_summaries` (rows whose `meeting_ids` JSON contains the id, via `json_each`),
`transcript_chunks`, `summary_processes`, `meeting_notes`, `transcripts`, and finally
`meetings`. It never touches unrelated contexts or other meetings.

### 4. Context-thread deletion (contract §6)

The in-flight `contexts` delete path must also delete binding-schema
`context_memory_items` rows. `ContextMemoryItemsRepository::delete_all_for_context` is the
tested primitive; splice it into the context-thread delete transaction before deleting the
`contexts` row.
