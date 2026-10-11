# Recall — Master Engineering Audit: Finding Ledger & Validation Matrix

**Mission:** Reliability + Security + Intelligence + Release Readiness
**Baseline HEAD at start:** `7c4adf9`
**Branch:** `phase/5-meeting-workspace-provenance`
**Status:** living document, updated after each validated workstream.

## 0. Baseline verification (evidence)

| Item | Value |
|---|---|
| Local HEAD at start | `7c4adf9` |
| Upstream branch | `origin/phase/5-meeting-workspace-provenance` |
| Upstream SHA at start | `80a1485` |
| Divergence | ahead 22 / behind 0 — no divergence, safe to push incrementally |
| Pre-existing dirty file | `frontend/src-tauri/Cargo.toml` (line-ending artifact, preserved unstaged) |
| `upstream` remote | `Zackriya-Solutions/meetily` — **reference only, never pushed to** |

Live data measured before any test (not assumed):

| Item | Value |
|---|---|
| DB path | `%APPDATA%\com.meetily.ai\meeting_minutes.sqlite` |
| SHA-256 | `4911B87F823B6751576C15D96DE19B194B91B22AA121E859787B7BD3EB19BA51` |
| Size | `4,632,576` |
| WAL | `20,632` |
| SHM | `32,768` |
| Audio files | `0` |

Matches the historical fingerprint exactly, so the baseline is trustworthy and
the live profile is intact. All tests use isolated temporary directories.

## 1. Finding ledger

Severity: **S1** = data loss / false success / security · **S2** = correctness ·
**S3** = robustness / quality.

### Workstream A — Transcription completeness

| ID | Sev | Status | Finding | Evidence |
|---|---|---|---|---|
| A-1 | **S1** | **FIXED** | The `transcript-update` listener resolved the recording from the global `RECORDING_MANAGER` registry **per event**, while `stop_recording` took that manager out of the registry *and* unregistered the listener **before** waiting for the drain. Every segment produced during the drain hit `None` and was discarded — the tail of essentially every transcript was silently lost while the app reported success. | `recording_commands.rs:540` (take), `:568-576` (unlisten), listener at `:461-489`; `recording_saver.rs` buffer reachable only via the manager |
| A-2 | **S1** | **FIXED** | The 600s drain ceiling was **silent**: on timeout the stop path logged a warning and continued, so a truncated transcript reached the UI as a normal finish. | `recording_commands.rs:620-638` |
| A-3 | **S2** | **FIXED** | `mark_finished()` ran inside each worker, *before* the parent joined the workers and verified chunk accounting — publishing a terminal state before the result was known. | `worker.rs:375` (old) |
| A-4 | **S2** | **FIXED** | Engine initialisation failure returned without recording a failure or closing the run, so `get_transcription_status` reported `running` forever. | `worker.rs:60-68` (old) |
| A-5 | **S2** | **FIXED** | `outcome::record_queued()` was **never called in production**, so `chunks_queued` was always `0` in the status command and the `recording-stopped` payload. | grep: only test call sites |
| A-6 | **S2** | **FIXED** | Chunk completion used a raw counter, so a duplicated completion could inflate progress past 100% and let the drain loop exit early. | `worker.rs:314-315` (old) |
| A-7 | **S2** | **FIXED** | `chunks_lost: final_queued - final_completed` was an unguarded subtraction (panic path in debug). | `worker.rs:452` (old) |
| A-8 | **S2** | **FIXED** | Unconditional log `"Recording stopped successfully with ZERO transcript chunks lost"` was printed even after a truncation — a false record in the log users paste into bug reports. | `recording_commands.rs:842` (old) |
| A-9 | **S2** | **FIXED** | The frontend typed `get_transcription_status` as `{chunks_in_queue, is_processing, last_activity_ms}`, but the backend returns `{outcome, chunks_queued, ...}`. `undefined === 0` is false, so **every** post-stop exit condition was unreachable and the UI always burned a 60s sleep. | `useRecordingStop.ts:240,247` vs `lib.rs:217-219` |
| A-10 | **S2** | **FIXED** | Only `outcome === 'failed'` was treated as incomplete; a truncated/cancelled run would have been saved as "Recording saved successfully!". | `useRecordingStop.ts:332` (old) |

### Workstream E — Intelligence & provenance (verified by audit, not yet fixed)

| ID | Sev | Status | Finding | Evidence |
|---|---|---|---|---|
| E-1 | **S1** | open | `api_generate_meeting_intelligence` is **entirely dead**. Frontend sends nested `meetingId`/`templateId`; Tauri camelCases only the top-level key, so serde requires `meeting_id`/`template_id` and every call fails with `missing field`. | `meetingIntelligenceService.ts:119-128` vs `intelligence_commands.rs:50-55`; `tauri ipc/command.rs:97-104` |
| E-2 | **S1** | open | Response shape mismatch: backend returns `{meeting_id, intelligence:{abstract,…}}`, TS expects top-level `abstract_text/topics/...`, so `result.topics.map` throws. | `intelligence_commands.rs:204-207` vs `meetingIntelligenceService.ts:110-119` |
| E-3 | **S1** | open | **Provenance is structurally impossible.** Segment IDs never reach the model (`service.rs:843` discards them); the transcript is embedded twice; unresolvable IDs cause every decision/action/question/fact/follow_up to be **silently deleted** (`service.rs:1158-1172`), leaving only topics. Tasks is therefore always empty. | `intelligence_commands.rs:169-174`, `service.rs:843,887-892,1158-1172` |
| E-4 | **S2** | open | Evidence navigation targets the wrong row: non-optional `f64` decode of a nullable column hard-errors on NULL; NULL rows are excluded from the position COUNT but rendered by the client; ties collapse. | `intelligence_commands.rs:241,257` vs `meeting.rs:246` + `usePaginatedTranscripts.ts:126-128` |
| E-5 | **S2** | open | Unvalidated model output: `confidence` unclamped but rendered as a percentage ("9500%"), fenced JSON unsupported, `due_date`/`owner`/`status`/`text` unbounded — all strictly weaker than `extraction.rs`. | `service.rs:751-754,919` vs `extraction.rs:104-127` |
| E-6 | **S2** | open | Context selection is **non-deterministic**: `HashSet` + `.take(2)` means which 2 of 3+ selected contexts reach the prompt varies per process launch. | `service.rs:778-785`, `commands.rs:374-382` |
| E-7 | **S3** | open | Intelligence write is non-atomic: `upsert_intelligence` + `replace_items` are separate autocommit calls, so a failure leaves a new abstract beside stale items. | `service.rs:928-936`, `:1015-1017` |
| E-8 | **S3** | open | Frequency multiplier is inert dead code — every production call site passes `1`. | `context/render.rs:54-55,85-86` |
| E-9 | **S3** | open | Swallowed cleanup errors can leave a visible `__rebuild-<uuid>` phantom context. | `contexts/service.rs:365,369` |
| — | — | VERIFIED OK | Ranking weights (Action 100/15, Question 85/15, Decision 70, Fact 55, Note 40, Unknown 10), recency `1/(1+age/30)` floor 0.1, budgets (4000 tok / 16000 chars / 2000 chars-per-item / 2 contexts), dedup with provenance, `api_get_meeting_intelligence[_items]` | `context/model.rs`, `extraction.rs` |

**Product decision (owner):** use **server-derived evidence references, then
validate** — numbered `[S1]`-style request-local references mapped to real
segment IDs server-side, never model-invented database IDs.

### Workstream F — False-empty states & error propagation

| ID | Sev | Status | Finding | Evidence |
|---|---|---|---|---|
| F-1 | **S2** | open | Meeting search failure sets `searchResults([])` with no error state, so a failed search renders "No matching meetings." | `SidebarProvider.tsx:229-232`, `meetings/page.tsx:129-131,203-213` |
| F-2 | **S2** | open | Summary fetch failure sets summary null and renders "No Summary Generated Yet." | `meeting-details/page.tsx:284-288` |
| F-3 | **S3** | open | `api_delete_api_key` is implemented but unregistered (dead command). | Phase E command inventory |

Audit sweep examined ~180 error-handling sites; most prior defects are already
fixed. Transcript search is the largest remaining false-empty surface.

### Tooling / hygiene

| ID | Sev | Status | Finding |
|---|---|---|---|
| T-1 | **S3** | open | The `7c4adf9` baseline is **not** `cargo fmt --all -- --check` clean: `incremental_saver.rs`, `phase_f1_integrity.rs`, `lib.rs`, `path_guard.rs`, `tests_f2_security.rs` are unformatted (drift introduced in F1/F2). |
| T-2 | **S3** | open | `templates/mod.rs` tests read the global custom-template-dir override without holding `override_guard()`, racing the loader tests. Intermittent failure observed. **Fixed in the A workstream.** |
| T-3 | — | info | `frontend/src-tauri/Cargo.toml` carries a line-ending artifact; must remain untouched and unstaged. |

## 2. Validation matrix

| Suite | Command | Baseline `7c4adf9` | After WS-A |
|---|---|---|---|
| Rust unit | `cargo test --workspace` | 383 pass / 0 fail / 2 ignored | **409 pass / 0 fail / 2 ignored** (+26) |
| Rust fmt | `cargo fmt --all -- --check` | **FAIL** (5 files, T-1) | unchanged (tracked for WS-H) |
| Rust lint | `cargo clippy --workspace --all-targets` | pass | **pass** |
| Frontend | `node --test tests/lib/*.test.mjs` | 645 total / 643 pass / 2 known | **658 total / 656 pass / 2 known** (+13) |
| TypeScript | `tsc --noEmit` (`src/`) | clean | **clean** |

Known baseline failures (unchanged, not weakened):
1. Phase 4 `checkPermissions` mount-effect test.
2. Bun-only `qa-routes` test.