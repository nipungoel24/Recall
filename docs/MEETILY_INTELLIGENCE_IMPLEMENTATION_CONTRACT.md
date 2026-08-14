# Meetily Intelligence — Parallel Implementation Contract

**Status:** BINDING
**Version:** 1.0
**Applies to:** Meetily v0.4.x Tauri desktop application
**Audience:** feature agents working in parallel branches; the Integration Owner cherry-picks their commits.

This document is the interface contract between parallel feature agents. Every agent MUST
implement **exactly** the interfaces defined here. Deviations require the Integration Owner's
approval. When this document and code disagree, this document wins until the owner amends it.

---

## 1. Verified Architecture Facts (read these, do not guess)

These were verified by reading the code on 2026-08-15. Do not re-derive them.

| Fact | Where | Detail |
|---|---|---|
| Cargo workspace | root `Cargo.toml` | members: `frontend/src-tauri` (package `meetily`, lib `app_lib`), `llama-helper` |
| Tauri command registration | `frontend/src-tauri/src/lib.rs` | ONE central `tauri::generate_handler![...]` list. New commands are **not** live until registered there. |
| Tauri command convention | whole repo | `#[tauri::command] pub async fn api_xxx<R: Runtime>(_app: AppHandle<R>, state: tauri::State<'_, AppState>, ...) -> Result<T, String>`. JS calls `invoke('api_xxx', { camelCaseArgs })`; Tauri v2 auto-maps camelCase→snake_case args. |
| DB access | `src-tauri/src/database/manager.rs` | `DatabaseManager` wraps `SqlitePool`; `AppState { db_manager }` managed in `lib.rs`; commands take `tauri::State<'_, AppState>`. |
| Migrations | `src-tauri/migrations/*.sql` | `sqlx::migrate!("./migrations")` auto-discovers files **sorted by filename** at compile time. No manual registration. Existing newest: `20251229000000_add_gemini_api_key.sql`. |
| Repository pattern | `src-tauri/src/database/repositories/*.rs` | Plain structs (`MeetingsRepository`, `TranscriptsRepository`, `SummaryProcessesRepository`, `TranscriptChunksRepository`, `SettingsRepository`) with `pub async fn(&SqlitePool, ...) -> Result<_, sqlx::Error>`. |
| ID conventions | `database/repositories/transcript.rs` | `meeting-<uuid4>`, `transcript-<uuid4>` via `uuid::Uuid::new_v4()`; text PKs. |
| Timestamps | `database/models.rs`, repos | `meetings.created_at/updated_at` are TEXT. **Mixed formats exist**: `Utc::now()` (RFC3339, e.g. `2026-08-15T12:34:56.789Z`) in `save_transcript`/`update_meeting_name`, and `Utc::now().naive_utc()` (`2026-08-15 12:34:56.789`) in `update_meeting_title`. Range queries MUST normalize (see §10), never compare raw strings. |
| Meeting model | `database/models.rs` | `MeetingModel { id, title, created_at: DateTimeUtc, updated_at: DateTimeUtc, folder_path: Option<String> }`; `DateTimeUtc` serializes to RFC3339. |
| Meeting duration | `transcripts` table | Not on `meetings`. Segments have `audio_end_time` (secs from recording start) and `duration` (secs). Meeting duration must be derived (§3.3). |
| Meeting delete | `database/repositories/meeting.rs::delete_meeting_with_transaction` | Manually deletes `transcript_chunks`, `summary_processes`, `transcripts`, `meetings` in one transaction. Foreign keys are **not** pragma-enabled today, so cascades do not run. New tables must be cleaned manually here (owner-owned file, §12). |
| Meeting list command | `api/api.rs::api_get_meetings` | Returns `Vec<Meeting>` = only `{ id, title }` — **insufficient** for calendar. Do not change it; add range APIs (§3). |
| Meeting details | `api/api.rs::api_get_meeting`, `api_get_meeting_metadata`, `api_get_meeting_transcripts` | `MeetingDetails { id, title, created_at, updated_at, transcripts }`; transcripts paginated by `limit/offset` ordered by `audio_start_time`. |
| Summary pipeline | `summary/commands.rs::api_process_transcript` | Args: `text, model(provider), modelName, meetingId, chunkSize, overlap, customPrompt, templateId, summaryLanguage`. Creates/resets `summary_processes` row, saves `transcript_chunks`, spawns background task, returns `{ message, process_id }`. Frontend polls `api_get_summary` every 5 s (`SidebarProvider::startSummaryPolling`). Cancel: `api_cancel_summary`. |
| Summary result storage | `summary/service.rs` | `summary_processes.result` = JSON `{ "markdown": "...", "english_cache": { markdown, source, output_language } }`. `SummaryCacheSource` fingerprints transcript, custom prompt, template id, template fingerprint, model, endpoint, etc. |
| SummaryService entry | `summary/service.rs::process_transcript_background(app, pool, meeting_id, text, model_provider, model_name, custom_prompt, template_id, summary_language)` | Loads template via `templates::get_template`, resolves provider via `LLMProvider::from_str`, resolves API keys via `SettingsRepository`, calls `processor::generate_meeting_summary`. |
| Provider config | `database/repositories/setting.rs` | `get_model_config`, `get_api_key`, `get_custom_openai_config`; providers: ollama, openai, anthropic, groq, openrouter, builtin-ai, custom-openai. |
| Templates | `summary/templates/*` | File-based JSON, NOT DB. Sources (priority in `loader::get_template`): user custom dir → bundled resource dir → embedded (`defaults.rs`: only `daily_standup`, `standard_meeting`). Custom dir = `dirs::data_dir()/Meetily/templates` (`%APPDATA%\Meetily\templates` on Windows). Schema: `Template { name, description, sections: [{ title, instruction, format: "paragraph"|"list"|"string", item_format?, example_item_format? }] }`. `Template::validate()` enforces rules. |
| Existing template commands | `summary/template_commands.rs` | `api_list_templates → Vec<TemplateInfo { id, name, description }>`, `api_get_template_details → TemplateDetails { id, name, description, sections: Vec<String> }`, `api_validate_template(json) → Result<String,String>`. NO create/update/delete/duplicate. |
| Bundled templates | `src-tauri/templates/*.json` | `daily_standup, project_sync, psychatric_session, retrospective, sales_marketing_client_call, standard_meeting` (copied to app resources at build; embedded only for the 2). |
| Frontend services | `frontend/src/services/*.ts` | Thin wrappers over `invoke()` (configService, recordingService, transcriptService, ...). |
| Frontend types | `frontend/src/types/index.ts` | Shared. Meeting/Transcript/Summary types live here (SHARED file, §12). |
| Navigation | Next.js App Router | Routes `/` (recording), `/meeting-details?id=`, `/notes/[id]`, `/settings`. Sidebar (`components/Sidebar/index.tsx`) is the central nav surface; meeting nav = `router.push(\`/meeting-details?id=${id}\`)` + `setCurrentMeeting`. |
| Meeting list refresh | `components/Sidebar/SidebarProvider.tsx::fetchMeetings` | Uses `api_get_meetings`; `refetchMeetings` exposed via context. |
| Local LLM sidecar | `summary/summary_engine/*`, `llama-helper/` | BuiltInAI provider. Untouched by this contract. |

---

## 2. Naming and Serialization Conventions

1. **Command names**: lowercase snake_case, prefixed `api_`. Context commands are NOT `get_context_...`; they are `api_*` exactly as written in §6.
2. **Serde**: Rust structs `#[derive(Debug, Clone, Serialize, Deserialize)]`. camelCase JSON field renames via `#[serde(rename = "...")]` only where the repo already does (e.g. `whisperModel`). New fields are snake_case unless stated.
3. **Timestamps over IPC**: always RFC3339 strings (`.to_rfc3339()`), UTC. Frontend parses with `new Date(iso)`.
4. **IDs**: `meeting-<uuid>`, `context-<uuid>`, `mcl-<uuid>` (meeting-context link), `cmi-<uuid>` (context memory item), `daily-summary-<uuid>`. Generated Rust-side with `uuid::Uuid::new_v4()`.
5. **Errors**: commands return `Result<T, String>`; repository layer returns `Result<T, sqlx::Error>` (existing pattern).
6. **Logging**: `tracing::info/warn/error` in new modules (matches repo).
7. **Do NOT** send `auth_token: Option<String>` params in new commands — that is legacy HTTP-backend cruft.

---

## 3. A — Meetings by Date Range

### 3.1 Commands (new module `src-tauri/src/api/calendar.rs`, self-contained)

```rust
// api/calendar.rs — agent-owned file

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarMeetingItem {
    pub id: String,
    pub title: String,
    pub created_at: String,   // RFC3339 UTC
    pub updated_at: String,   // RFC3339 UTC
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_path: Option<String>,
    /// Total meeting duration in seconds, derived (rule in §3.3). None when unknown.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<f64>,
}

#[tauri::command]
pub async fn api_get_meetings_by_range<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    start_utc: String,   // RFC3339, inclusive
    end_utc: String,     // RFC3339, exclusive
) -> Result<Vec<CalendarMeetingItem>, String>

#[tauri::command]
pub async fn api_get_dates_with_meetings<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    start_utc: String,
    end_utc: String,
) -> Result<Vec<String>, String>   // distinct "YYYY-MM-DD" UTC dates, ascending
```

### 3.2 Query rule (both commands)

Parse `start_utc`/`end_utc` with `chrono::DateTime::parse_from_rfc3339` → `DateTime<Utc>`.
Reject when `start >= end` or parse fails. Because `created_at` TEXT mixes naive and RFC3339
formats, normalize inside SQLite (SQLite accepts both formats and a trailing `Z`):

```sql
SELECT m.id, m.title, m.created_at, m.updated_at, m.folder_path,
       SUM(t.duration) AS seg_sum,
       MAX(t.audio_end_time) AS last_end
FROM meetings m
LEFT JOIN transcripts t ON t.meeting_id = m.id
WHERE datetime(m.created_at) >= datetime(?1) AND datetime(m.created_at) < datetime(?2)
GROUP BY m.id
ORDER BY datetime(m.created_at) ASC
```

Bind the RFC3339 UTC strings. `api_get_dates_with_meetings` uses the same WHERE clause with
`SELECT DISTINCT date(m.created_at)`.

**Never** use `LIKE 'YYYY-MM-DD%'` substring matching on timestamps anywhere in this project.

### 3.3 Duration derivation rule

`duration_seconds =`
1. `last_end` (MAX audio_end_time) if present and `> 0.0`;
2. else `seg_sum` (SUM duration) if present and `> 0.0`;
3. else `None`.

### 3.4 Daily list reuse

`api_get_day_meetings` is **not** a new command. The day timeline uses
`api_get_meetings_by_range(localDayStartUtc, localDayEndUtc)` (§10). Calendar month view uses
one wide range (with local padding, §10) and groups client-side.

### 3.5 Frontend

- New type file `frontend/src/types/calendar.ts`: `CalendarMeetingItem`, `CalendarDay` (local date + meetings), `DayGrouping` helpers (pure functions — unit-testable).
- New service `frontend/src/services/calendarService.ts` wrapping the two commands.
- Routes: `/calendar` (month grid, owned by calendar agent) — see §12 route table.

---

## 4. B — Custom Templates

Templates remain file-based. Custom templates live ONLY in `dirs::data_dir()/Meetily/templates/<id>.json`. Built-in (embedded) and bundled (resource-dir) templates are read-only.

### 4.1 TemplateInfo extension (owner edits `summary/template_commands.rs`)

`TemplateInfo` gains two fields (additive; existing consumers unaffected):

```rust
pub struct TemplateInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    /// "builtin" | "bundled" | "custom"
    pub source: String,
    /// true when source != "custom"
    pub is_readonly: bool,
}
```

`api_list_templates` must report `source` per id using the new loader helpers (§4.3).

### 4.2 New commands (new file `src-tauri/src/summary/templates/custom_commands.rs`)

```rust
#[tauri::command]
pub async fn api_create_custom_template<R: Runtime>(
    _app: AppHandle<R>,
    template_id: String,
    template_json: String,
) -> Result<TemplateInfo, String>

#[tauri::command]
pub async fn api_update_custom_template<R: Runtime>(
    _app: AppHandle<R>,
    template_id: String,
    template_json: String,
) -> Result<TemplateInfo, String>

#[tauri::command]
pub async fn api_delete_custom_template<R: Runtime>(
    _app: AppHandle<R>,
    template_id: String,
) -> Result<(), String>

#[tauri::command]
pub async fn api_duplicate_template<R: Runtime>(
    _app: AppHandle<R>,
    template_id: String,        // source id (any source)
    new_template_id: String,
) -> Result<TemplateInfo, String>

#[tauri::command]
pub async fn api_get_template_json<R: Runtime>(
    _app: AppHandle<R>,
    template_id: String,
) -> Result<String, String>     // raw JSON content (for the editor), from any source
```

Rules (all enforced backend-side):

1. **ID format**: `^[a-z0-9][a-z0-9_-]{0,63}$` (matches existing ids like `sales_marketing_client_call`).
2. **Builtin protection**: reject any create/update/delete/duplicate targeting an id for which
   `templates::is_builtin_template_id(id)` is true (embedded OR bundled). Custom ids may never
   shadow built-ins via the API.
3. `api_create_custom_template`: validate `template_json` with
   `templates::validate_and_parse_template`; error if id already exists in the custom dir;
   write pretty JSON (`serde_json::to_string_pretty` of the parsed `Template`) to the custom dir
   (create dirs first). Return `TemplateInfo { source: "custom", is_readonly: false }` with
   parsed name/description.
4. `api_update_custom_template`: error unless a file exists in the custom dir; same validation;
   overwrite.
5. `api_delete_custom_template`: error if builtin id or no custom file; delete the file.
6. `api_duplicate_template`: read source template via `templates::get_template_json_raw(template_id)`
   (source id), re-serialize pretty, write as `new_template_id` in the custom dir. Reject if
   `new_template_id` is builtin or already exists in custom dir. If the source does not exist,
   error with the existing `get_template` error message.
7. Duplicating to create a custom copy of a builtin is the ONLY supported way to get an editable
   version of a builtin.

### 4.3 Loader additions (owner edits `summary/templates/loader.rs`)

Two small pub fns the agent code calls (agents must NOT edit loader.rs):

```rust
pub fn is_builtin_template_id(template_id: &str) -> bool;   // embedded or bundled file present
pub fn get_template_json_raw(template_id: &str) -> Option<String>; // raw JSON, priority: custom → bundled → builtin
```

### 4.4 Frontend

- New type file `frontend/src/types/templateManagement.ts`: `TemplateInfo` (with `source`/`isReadonly`), `TemplateEditorState`.
- New service `frontend/src/services/templateService.ts`.
- New route `/templates` (list + editor + duplicate/delete UI). Selecting a template for a meeting
  stays exactly as today: `useTemplates()` + `SummaryGeneratorButtonGroup` dropdown — just consume
  the extended `TemplateInfo` type.
- Custom template validation reuses existing `api_validate_template` before save (optional client-side pre-check).

---

## 5. C — Daily Aggregation + Daily Brief

Daily views are **virtual**; no meetings are merged or duplicated.

### 5.1 Storage (derived data)

Table `daily_summaries` (created by the single owner migration, §11):

```sql
CREATE TABLE IF NOT EXISTS daily_summaries (
    id TEXT PRIMARY KEY,                -- "daily-summary-<uuid>"
    date TEXT NOT NULL UNIQUE,          -- USER-LOCAL date "YYYY-MM-DD" (aggregation key only)
    meeting_ids TEXT NOT NULL,          -- JSON array of meeting ids included
    template_id TEXT,                   -- template id used
    result TEXT,                        -- JSON, same shape as summary_processes.result
    status TEXT NOT NULL,               -- pending|processing|completed|failed|cancelled
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_daily_summaries_date ON daily_summaries(date);
```

### 5.2 Commands (new module `src-tauri/src/summary/daily/` — commands.rs + service.rs)

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct DailyProcessResponse {
    pub message: String,
    pub process_id: String,   // == the row id; poll with api_get_daily_summary
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DailySummaryResponse {
    pub status: String,               // pending|processing|completed|failed|cancelled|idle
    pub date: String,                 // echo of requested local date
    pub meeting_ids: Vec<String>,     // ids actually included
    pub data: Option<serde_json::Value>,  // parsed `result`
    pub error: Option<String>,
    pub start: Option<String>,        // RFC3339
    pub end: Option<String>,          // RFC3339
}

#[tauri::command]
pub async fn api_generate_daily_summary<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    date: String,                       // user-local "YYYY-MM-DD"
    meeting_ids: Vec<String>,           // frontend passes the ids shown on the day timeline
    template_id: Option<String>,        // None => "standard_meeting"
    custom_prompt: Option<String>,
    summary_language: Option<String>,
    model: String,                      // provider (same semantics as api_process_transcript)
    model_name: String,
) -> Result<DailyProcessResponse, String>

#[tauri::command]
pub async fn api_get_daily_summary<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    date: String,
) -> Result<DailySummaryResponse, String>

#[tauri::command]
pub async fn api_cancel_daily_summary<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    date: String,
) -> Result<serde_json::Value, String>
```

Behavior:

1. `api_generate_daily_summary` validates `meeting_ids` is non-empty and every id exists
   (`MeetingsRepository::get_meeting_metadata`). Reject invalid ids (no silent skipping).
2. Upsert a `daily_summaries` row (status `pending`, keep old `result` for restore-on-failure like
   `summary_processes.result_backup` semantics — store prior result in a Rust-side local or reuse
   `result` + `status`; simplest: keep previous `result` untouched until success, then overwrite).
3. Spawn background task (pattern of `api_process_transcript`): assemble combined text:
   `## <meeting title>\n<transcript text>` per meeting in `meeting_ids` order, transcripts fetched
   with `SELECT transcript FROM transcripts WHERE meeting_id = ? ORDER BY audio_start_time ASC`,
   joined with "\n".
4. Resolve provider exactly like `SummaryService::process_transcript_background`
   (`LLMProvider::from_str`, `SettingsRepository::get_api_key`, ollama endpoint / CustomOpenAI
   config, token threshold logic). Call `processor::generate_meeting_summary(...)` with the
   loaded template (`templates::get_template`). **Reuse the existing processor; do not fork it.**
5. On success: `status='completed'`, `result = {"markdown": "...", ...}` (same envelope as meeting
   summaries; use `build_summary_result_json`-equivalent or plain `{"markdown": ...}`), bump
   `updated_at`. On failure: `status='failed'`, `error`, previous `result` preserved. On cancel:
   `status='cancelled'`.
6. Daily module keeps its OWN `CancellationToken` registry keyed by `date` (copy the small
   `CANCELLATION_REGISTRY` pattern from `summary/service.rs`; do not extend the meeting-keyed
   registry).
7. The daily brief template: add ONE new bundled read-only template file
   `src-tauri/templates/daily_brief.json` (agent supplies JSON in the standard schema; owner
   reviews). It must validate via `Template::validate()`.

### 5.3 Frontend

- New type file `frontend/src/types/dailySummary.ts`.
- New service `frontend/src/services/dailySummaryService.ts`.
- Route `/daily?date=YYYY-MM-DD` owned by the daily agent: single-day timeline (using
  `api_get_meetings_by_range` for that local day) + "Generate Daily Brief" + brief viewer +
  polling via `api_get_daily_summary` (reuse the 5 s polling pattern; do NOT reuse
  `activeSummaryPolls` map keyed by meeting id — use a local poll keyed by date).

---

## 6. D — Context Threads (Schema)

Single owner migration (§11) creates exactly these tables. Follow the repo's text-PK,
snake_case, TEXT-timestamp conventions. Timestamps written as RFC3339 UTC strings
(`Utc::now().to_rfc3339()`).

```sql
CREATE TABLE IF NOT EXISTS context_threads (
    id TEXT PRIMARY KEY,                       -- "context-<uuid>"
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    memory_markdown TEXT NOT NULL DEFAULT '',  -- compact human/LLM-readable memory (NOT full transcripts)
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meeting_context_links (
    id TEXT PRIMARY KEY,                       -- "mcl-<uuid>"
    context_id TEXT NOT NULL REFERENCES context_threads(id) ON DELETE CASCADE,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    UNIQUE(context_id, meeting_id)
);

CREATE TABLE IF NOT EXISTS context_memory_items (
    id TEXT PRIMARY KEY,                       -- "cmi-<uuid>"
    context_id TEXT NOT NULL REFERENCES context_threads(id) ON DELETE CASCADE,
    source_meeting_id TEXT,                    -- NULL = manually entered, no provenance
    kind TEXT NOT NULL,                        -- fact | decision | action | question | note
    content TEXT NOT NULL,
    status TEXT,                               -- free-form short string (e.g. open|done|blocked)
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_links_context ON meeting_context_links(context_id);
CREATE INDEX IF NOT EXISTS idx_links_meeting ON meeting_context_links(meeting_id);
CREATE INDEX IF NOT EXISTS idx_memory_context ON context_memory_items(context_id);
CREATE INDEX IF NOT EXISTS idx_memory_source ON context_memory_items(source_meeting_id);
```

Deletion semantics (documented behavior, enforced in Rust repositories because FK pragmas are
not guaranteed — §11 enables `PRAGMA foreign_keys=ON` AND repositories still clean manually):

- Meeting deleted → its `meeting_context_links` rows AND its `context_memory_items` rows
  (`source_meeting_id = meeting`) are deleted (derived data dies with source; provenance never dangles). Extend
  `delete_meeting_with_transaction` (owner-owned).
- Context thread deleted → its links and memory items deleted (manual delete in one transaction).
- Meeting removed from context → link row deleted; memory items with that `source_meeting_id`
  are KEPT (they remain accepted knowledge; provenance still points at the meeting).

---

## 7. E — Context APIs

New module `src-tauri/src/context/` (mod.rs, commands.rs, repository.rs, memory.rs). Agent-owned files.

### 7.1 Structs (serde structs exactly as shown)

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextThreadSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub meeting_count: i64,
    pub memory_item_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextThreadDetail {
    pub id: String,
    pub name: String,
    pub description: String,
    pub memory_markdown: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextMeetingInfo {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<f64>,   // same derivation rule as §3.3
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextMemoryItemView {
    pub id: String,
    pub context_id: String,
    pub source_meeting_id: Option<String>,   // provenance
    pub source_meeting_title: Option<String>, // resolved via LEFT JOIN for display
    pub kind: String,                        // fact|decision|action|question|note
    pub content: String,
    pub status: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompactContextMemory {
    pub context_id: String,
    pub context_name: String,
    pub memory_markdown: String,              // context_threads.memory_markdown
    pub items: Vec<ContextMemoryItemView>,    // newest-first, capped by caller max_items
}
```

### 7.2 Commands (exact names — these are final)

```rust
#[tauri::command] pub async fn api_list_context_threads<R: Runtime>(_app, state) -> Result<Vec<ContextThreadSummary>, String>;
#[tauri::command] pub async fn api_get_context_thread<R: Runtime>(_app, state, context_id: String) -> Result<ContextThreadDetail, String>;
#[tauri::command] pub async fn api_create_context_thread<R: Runtime>(_app, state, name: String, description: Option<String>) -> Result<ContextThreadDetail, String>;
#[tauri::command] pub async fn api_update_context_thread<R: Runtime>(_app, state, context_id: String, name: Option<String>, description: Option<String>, memory_markdown: Option<String>) -> Result<ContextThreadDetail, String>;
#[tauri::command] pub async fn api_delete_context_thread<R: Runtime>(_app, state, context_id: String) -> Result<serde_json::Value, String>; // {"message": "..."}
#[tauri::command] pub async fn api_add_meeting_to_context<R: Runtime>(_app, state, context_id: String, meeting_id: String) -> Result<serde_json::Value, String>;
#[tauri::command] pub async fn api_remove_meeting_from_context<R: Runtime>(_app, state, context_id: String, meeting_id: String) -> Result<serde_json::Value, String>;
#[tauri::command] pub async fn api_get_context_meetings<R: Runtime>(_app, state, context_id: String) -> Result<Vec<ContextMeetingInfo>, String>;  // ASC by created_at
#[tauri::command] pub async fn api_get_context_memory<R: Runtime>(_app, state, context_id: String) -> Result<Vec<ContextMemoryItemView>, String>;

// Memory item CRUD (needed for "persistent context memory" acceptance):
#[tauri::command] pub async fn api_add_context_memory_item<R: Runtime>(_app, state, context_id: String, kind: String, content: String, source_meeting_id: Option<String>, status: Option<String>) -> Result<ContextMemoryItemView, String>;
#[tauri::command] pub async fn api_update_context_memory_item<R: Runtime>(_app, state, item_id: String, kind: Option<String>, content: Option<String>, status: Option<String>) -> Result<ContextMemoryItemView, String>;
#[tauri::command] pub async fn api_delete_context_memory_item<R: Runtime>(_app, state, item_id: String) -> Result<serde_json::Value, String>;

// Compact memory for continuous context (§8):
#[tauri::command] pub async fn api_get_compact_context_memory<R: Runtime>(_app, state, context_id: String, max_items: Option<i64>) -> Result<CompactContextMemory, String>;
```

Validation rules:
- `name` non-empty after trim (create/update).
- `kind` ∈ {fact, decision, action, question, note} on add; on update only if provided.
- `content` non-empty after trim on add.
- `api_add_meeting_to_context` errors if meeting or context does not exist; duplicate link is a
  no-op success (`UNIQUE` + upsert). `api_remove_meeting_from_context` is a no-op success if the
  link is absent.
- All list queries return `created_at` RFC3339; memory list ordered by `created_at DESC`
  (newest first) in `api_get_context_memory`; `api_get_compact_context_memory` takes at most
  `max_items` (default 30, hard cap 100) newest items + `memory_markdown`.

### 7.3 Frontend

- New type file `frontend/src/types/context.ts` mirroring §7.1 (camelCase over IPC: `sourceMeetingId`, `sourceMeetingTitle`, `memoryMarkdown`, `maxItems` — Tauri handles the mapping).
- New service `frontend/src/services/contextService.ts`.
- Routes: `/context` (list/create), `/context/[id]` (thread detail: meetings, memory items with
  provenance links to `/meeting-details?id=<sourceMeetingId>`, compact memory editing).

---

## 8. F — Continuous Context in SummaryService

Do **not** couple SummaryService to frontend structures. The service accepts a pre-rendered compact
string.

### 8.1 API surface change (owner edits `summary/commands.rs` + `summary/service.rs`)

`api_process_transcript` gains ONE optional trailing param, `context_id: Option<String>`.
Existing callers are unaffected (Tauri fills `None`).

Flow in the command:
1. If `context_id` present: call `context::memory::get_compact_context_memory(&pool, &context_id, 30)`
   and render it via `context::memory::render_context_memory(&compact) -> String` producing a
   compact markdown block (context name + memory_markdown + up to 30 items, one line each:
   `- [kind] content (source: <title>)`).
2. Pass it into the background task.

`SummaryService::process_transcript_background` gains param
`prior_context_memory: Option<String>` (owner edit). Inside:
- `effective_prompt = prior_context_memory` prepended to `custom_prompt` as a bounded block:

```
## Prior Context Memory (from context thread "<name>")
<compact memory>
---
<user custom prompt>
```

- The cache `SummaryCacheSource` already fingerprints `custom_prompt`; compute it over
  `effective_prompt` so context changes invalidate the English-cache automatically. **No changes
  to `processor.rs` or its signature.**
- Only the compact memory block is sent — never full historical transcripts. No vector DB. No new
  outbound data beyond the selected LLM provider path that already exists today.

### 8.2 Frontend

- `useSummaryGeneration` gains optional `contextId`; the meeting-details template/context picker
  (new component under `components/Context/`, agent-owned) passes `contextId` into
  `api_process_transcript`.

---

## 9. G — Derived-Data Invalidation Matrix

| Event | Action (binding) |
|---|---|
| Meeting deleted | Existing cascade (chunks/processes/transcripts) + delete `meeting_context_links` + `context_memory_items WHERE source_meeting_id = ?` + delete `daily_summaries` rows whose `meeting_ids` JSON contains the id (use `json_each(meeting_ids)` or Rust-side parse-delete). All inside the existing delete transaction (owner edit to `meeting.rs`). |
| Context thread deleted | Delete thread + its links + its memory items in one transaction. |
| Meeting removed from context | Delete link only. Memory items retained (provenance intact). |
| Daily summary regenerated | Upsert same `date` row; `result` replaced on success; previous result kept on failure/cancel; `updated_at` bumped. |
| Meeting summary regenerated | Unchanged existing behavior (backup/restore in `summary_processes`). Does NOT touch context memory or daily summaries. |
| Context memory edited | Bump `context_threads.updated_at`. Meeting summaries are NOT auto-invalidated (summaries don't embed context memory; next regeneration picks it up). |
| Meeting added to a context AFTER its summary exists | No retroactive action; the meeting summary stays as generated. Regenerate to include context. |

---

## 10. H — Date/Time Semantics (binding)

1. **Calendar day = user local calendar day.** The backend is timezone-agnostic (pure UTC).
2. Frontend computes the local-day boundaries: `dayStart = new Date(y, m, d, 0,0,0,0)` and
   `dayEnd = new Date(y, m, d+1, 0,0,0,0)`, then sends
   `start_utc = dayStart.toISOString()` and `end_utc = dayEnd.toISOString()` (RFC3339 UTC, `Z`).
3. Month view: one `api_get_meetings_by_range` call covering the grid's first day start (UTC) to
   last day +1 end (UTC); group results client-side into local days by
   `new Date(item.created_at)` local fields.
4. `api_get_dates_with_meetings` returns UTC dates; the calendar converts to local for highlighting.
5. `date` in daily-summary APIs is the user-local `"YYYY-MM-DD"` aggregation key only; it is never
   used for time math or DB time comparisons.
6. Backend range queries normalize via SQLite `datetime()` (§3.2). No substring timestamp matching
   anywhere.

---

## 11. Migration Plan

- **Exactly ONE** new migration for all four features, created by the Integration Owner:
  `src-tauri/migrations/20260815000000_add_intelligence_features.sql` containing §5.1 and §6
  tables + indexes. `sqlx::migrate!` picks it up by filename automatically (newest date).
- Agents MUST NOT commit migration files in their branches (they may use a throwaway local file
  for testing and must delete it before pushing).
- Owner also enables FK enforcement as belt-and-braces:
  `SqliteConnectOptions::new().filename(path).create_if_missing(true).pragma("foreign_keys","ON")`
  in `database/manager.rs::new` (manual cleanup in repositories remains the source of truth).

---

## 12. File Ownership (binding)

### Integration Owner (ONLY these hands edit these files)

| File | Why shared |
|---|---|
| `frontend/src-tauri/src/lib.rs` | central `invoke_handler` registration |
| `frontend/src-tauri/src/api/mod.rs` | add `pub mod calendar;` |
| `frontend/src-tauri/src/summary/mod.rs` | re-exports of new commands/`__cmd__` variants |
| `frontend/src-tauri/src/summary/commands.rs` | `api_process_transcript` +`context_id`; daily command registration |
| `frontend/src-tauri/src/summary/service.rs` | `prior_context_memory` param + cache fingerprint |
| `frontend/src-tauri/src/summary/template_commands.rs` | `TemplateInfo.source`/`is_readonly` |
| `frontend/src-tauri/src/summary/templates/loader.rs` | `is_builtin_template_id`, `get_template_json_raw`, source-aware `list_templates` |
| `frontend/src-tauri/src/summary/templates/mod.rs` | re-exports |
| `frontend/src-tauri/src/database/manager.rs` | `foreign_keys` pragma |
| `frontend/src-tauri/src/database/repositories/meeting.rs` | extend delete transaction (context links, memory items, daily summaries) |
| `frontend/src-tauri/migrations/20260815000000_add_intelligence_features.sql` | single canonical migration |
| `frontend/src/types/index.ts` | re-exports from feature type files only |
| `frontend/src/components/Sidebar/index.tsx` | nav entries (Calendar, Context, Templates) |
| `frontend/src/components/Sidebar/SidebarProvider.tsx` | refetch triggers |
| `frontend/src/hooks/useNavigation.ts` | only if nav changes needed |
| `frontend/src/app/settings/page.tsx` | template-management entry point wiring |

### Feature agent owned (NEW files only — agents must not edit any file above)

| Agent | Rust (new) | Frontend (new) |
|---|---|---|
| Calendar | `src-tauri/src/api/calendar.rs` | `types/calendar.ts`, `services/calendarService.ts`, `hooks/useCalendar.ts`, `app/calendar/page.tsx`, `components/Calendar/*` |
| Templates | `src-tauri/src/summary/templates/custom_commands.rs` (+ draft of `daily_brief.json`) | `types/templateManagement.ts`, `services/templateService.ts`, `app/templates/page.tsx`, `components/TemplateEditor/*` |
| Daily | `src-tauri/src/summary/daily/{mod.rs,commands.rs,service.rs}`, `src-tauri/src/database/repositories/daily_summary.rs` | `types/dailySummary.ts`, `services/dailySummaryService.ts`, `app/daily/page.tsx`, `components/DailyBrief/*` |
| Context | `src-tauri/src/context/{mod.rs,commands.rs,repository.rs,memory.rs}` | `types/context.ts`, `services/contextService.ts`, `hooks/useContextThreads.ts`, `app/context/page.tsx`, `app/context/[id]/page.tsx`, `components/Context/*` |

### Route ownership (no collisions)

| Route | Owner |
|---|---|
| `/calendar` (+ any `/calendar/...`) | Calendar agent |
| `/daily?date=YYYY-MM-DD` | Daily agent |
| `/templates` | Templates agent |
| `/context`, `/context/[id]` | Context agent |
| `/`, `/meeting-details`, `/notes/[id]`, `/settings` | Existing (do not touch except owner) |

---

## 13. Testing Baseline (verified on this machine, 2026-08-15)

| Command | Status | Classification |
|---|---|---|
| `pnpm --version` → 10.28.2 | OK | — |
| `node --version` → v22.20.0 | OK | — |
| `bun --version` | **Command not found** | missing environment dependency (Bun not installed; use Node-based tests) |
| `node tests/lib/onboarding-summary-model.test.mjs` | **FAILS** `ERR_MODULE_NOT_FOUND 'typescript'` | missing environment dependency: `node_modules/` not installed. Run `pnpm install` first. NOT a regression. |
| `pnpm lint` / `pnpm build` | NOT RUN | blocked by missing `node_modules` |
| `cargo --version` → 1.90.0 | OK | — |
| `cargo check -p meetily` | **FAILS**: whisper-rs build script `bindgen` → `Unable to find libclang: clang.dll` | missing environment dependency: LLVM/libclang not installed on this machine. Install LLVM and set `LIBCLANG_PATH`, or check on a machine with LLVM. NOT a code regression (dependency build script failure). Workspace `target/` at repo root is gitignored; deps partially cached. |

Agents: run `cargo fmt --all -- --check`, `cargo check -p meetily`, `cargo test -p meetily`,
`pnpm lint`, `pnpm build`, and `node tests/lib/*.test.mjs` in their environment, and report each
as PASS / FAIL / ENV-MISSING with the exact error. Never claim a test passes without running it.

---

## 14. Anticipated Conflicts (why the ownership table exists)

1. **`lib.rs` handler list** — every agent registers commands → owner-only edit; agents list their
   commands in the branch PR description.
2. **`types/index.ts`** — every agent adds shared types → per-feature type files, owner re-exports.
3. **Sidebar nav** — Calendar, Context, Templates all want nav entries → owner wires after merge.
4. **`summary/service.rs` + `summary/commands.rs`** — daily agent and context agent both want
   SummaryService changes → owner applies the §8 signature once; agents only add their own modules.
5. **Migration numbering** — parallel agents naming `20260815...` collide → single owner migration.
6. **Template loader** — templates agent needs builtin-detection; owner adds the two loader fns once.
7. **Meeting delete transaction** — context/daily invalidation lives here → owner extends it once
   both branches land.
8. **`api/mod.rs`** — calendar module registration → owner-only.

---

## 15. Instructions for Feature Agents

1. Branch from this commit. Implement ONLY your feature, ONLY in your owned files (§12).
2. Read the existing patterns before coding: `api/api.rs` command style, a repository file,
   `summary/template_commands.rs`, `SidebarProvider` invoke pattern, `useTemplates`.
3. Follow the interface in the relevant contract section EXACTLY — command names, arg names,
   struct fields, error strings are contractual. Rename nothing.
4. Do NOT edit owner files. If you need an owner change, state it in the PR description
   ("REQUIRES OWNER: loader fn `is_builtin_template_id`").
5. Do NOT commit migrations. Do NOT modify `backend/`. Do NOT add dependencies without
   Integration Owner approval. Do NOT add a vector DB.
6. Register nothing in `lib.rs` — the owner does it at integration time.
7. Rust: `cargo fmt`, compile-check your module (`cargo check -p meetily` where the environment
   permits), unit-test pure logic (`#[cfg(test)]`).
8. Frontend: typecheck/build when `node_modules` is available; keep new tests alongside existing
   `frontend/tests/lib/` style if you add logic worth testing.
9. Privacy: no new outbound network calls. Daily brief and context memory use the existing
   provider pipeline only.
10. PR must state: files added, files touched, commands added (names), and the testing-baseline
    matrix for your branch.

## 16. Acceptance Criteria → Contract Mapping

| User can... | Implemented by |
|---|---|
| record / view meetings as before | no changes to recording path; only additive command registration |
| create/edit/duplicate/delete custom template | §4 `custom_commands.rs` + `/templates` |
| select custom template for summaries | existing `useTemplates` + `api_process_transcript(templateId)` |
| open Calendar, see dates with meetings | §3 `/calendar` + `api_get_dates_with_meetings` |
| select a date, see meetings chronologically | §3 `api_get_meetings_by_range` |
| open each original meeting | `router.push('/meeting-details?id=')` from calendar/day views |
| view all meetings for the day together | `/daily?date=` timeline |
| generate a daily brief | §5 `api_generate_daily_summary` + polling |
| create a Context/Project | §7 `api_create_context_thread` |
| associate meetings with a Context | §7 `api_add_meeting_to_context` |
| inspect meetings belonging to a Context | §7 `api_get_context_meetings` |
| use prior context when summarizing | §8 `context_id` on `api_process_transcript` |
| see source-meeting provenance | §7 `source_meeting_id`/`source_meeting_title` + links to meeting-details |
