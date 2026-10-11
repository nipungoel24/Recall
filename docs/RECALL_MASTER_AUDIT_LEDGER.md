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
| E-1 | **S1** | **FIXED** | `api_generate_meeting_intelligence` was **entirely dead**. Frontend sent nested `meetingId`/`templateId`; Tauri camelCases only the top-level key, so serde required `meeting_id`/`template_id` and every call failed. | container-level `#[serde(rename_all = "camelCase")]`; contract test |
| E-2 | **S1** | **FIXED** | Response shape mismatch: backend returned `{meeting_id, intelligence:{abstract,…}}`, TS expected top-level `abstract_text/topics/...`, so `result.topics.map` threw. Generate now returns the **persisted** rows, so generate and get share one shape. | `GenerateIntelligenceResponse`; contract test |
| E-3 | **S1** | **FIXED** | **Provenance was structurally impossible.** Segment IDs never reached the model, the transcript was embedded twice, and unresolvable IDs caused every decision/action/question/fact/follow_up to be **silently deleted** — leaving only topics and a permanently empty Tasks. Now: numbered `[S1]`-style **request-local references** the model can actually cite, resolved server-side to genuine segment ids. Unresolvable refs are dropped, never substituted; the item is **retained as unverified** rather than deleted. | `summary/intelligence_evidence.rs`; `resolve_and_validate_intelligence` |
| E-4 | **S2** | **FIXED** | Evidence navigation targeted the wrong row: non-optional `f64` decode of a nullable column hard-errored on NULL; NULL rows were excluded from the COUNT but rendered by the client; ties collapsed. Ordering is now total and shared: `COALESCE(audio_start_time, 0.0)` with an `id` tiebreaker, matching the client's `?? 0`. | `api_get_transcript_segment_position` |
| E-5 | **S2** | **FIXED** | Unvalidated model output: `confidence` unclamped but rendered as a percentage ("9500%"), fenced JSON unsupported, `due_date`/`owner`/`status`/`text` unbounded. All are now normalised or rejected; malformed output is a reported error, never a silent empty success. | `summary/intelligence_validation.rs` |
| E-6 | **S2** | **FIXED** | Context selection was **non-deterministic**: `HashSet` + `.take(2)` meant which 2 of 3+ selected contexts reached the prompt varied per process launch. Both sites now dedup order-preservingly, keeping the user's explicit selection order. | `service.rs`, `summary/commands.rs` |
| E-7 | **S3** | **FIXED** | Intelligence write was non-atomic: a failure between the abstract and items left a new abstract beside stale items. `replace_all` now writes both in one transaction; a forced mid-transaction failure is regression-tested to roll back cleanly. | `MeetingIntelligenceRepository::replace_all` |
| E-8 | **S3** | open | Frequency multiplier is inert dead code — every production call site passes `1`. | `context/render.rs:54-55,85-86` |
| E-9 | **S3** | **FIXED** | Swallowed cleanup errors can leave a visible `__rebuild-<uuid>` phantom context. Deferred to Workstream C/D (context rebuild teardown). | `contexts/service.rs:365,369` |
| E-10 | **S2** | **FIXED** | *(new)* Source rows were deleted only via `ON DELETE CASCADE`, which depends on the connection having `PRAGMA foreign_keys = ON`. Without it, sources orphan and `get_sources_for_meeting` returns evidence pointing at deleted items. Sources are now deleted explicitly inside the transaction. | `meeting_intelligence.rs` |
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

### Workstream B — Isolated recording E2E

Automated in `src-tauri/src/tests_recording_e2e.rs` (13 tests) against a
temporary app-data dir, temporary SQLite database, and temporary
recordings/checkpoint root. The real user profile is never opened.

| Step | Coverage | Result |
|---|---|---|
| Synthetic audio → checkpoints | real `IncrementalAudioSaver::add_chunk`; 30s (1.44M-sample) flush threshold crossed deliberately | PASS |
| Finalize → artifact | real `finalize()` + real `verify_audio_artifact()`; exercised the actual FFmpeg path | PASS |
| Missing / zero-byte artifact | must fail verification, never pass | PASS |
| Failed finalization | corrupted checkpoints; checkpoints preserved, or success implies a verified artifact | PASS |
| Deterministic transcription | fake `TranscriptionProvider`, no model loaded | PASS |
| Segment persistence order/timing | real sink → saver, ordering + timestamps + content asserted | PASS |
| Re-emitted segment | upserts in place, does not duplicate | PASS |
| Meeting + transcript round-trip | real `save_transcript` → `get_meeting` | PASS |
| Failed replacement preserves data | original transcript intact | PASS |
| Meeting isolation | transcripts never leak between meetings | PASS |
| Recovery safety | path guard allows in-root, refuses escape; unrelated files untouched | PASS |
| Terminal outcome (no speech / failed chunk) | real outcome module | PASS |

**Explicitly NOT covered by automation** (procedure in
`docs/RECALL_ISOLATED_RECORDING_SMOKE.md`): microphone capture, a real local
model, and the Tauri event bridge (`tauri` is built without its `test` feature,
so no `AppHandle` exists in-process). These require the manual isolated-profile
smoke test and are **NOT RUN** in this environment.

### Workstream C — Shutdown & sidecar lifecycle

| ID | Sev | Status | Finding | Evidence |
|---|---|---|---|---|
| C-1 | **S1** | **FIXED** | Shutdown could hang **forever**: `RunEvent::Exit` ran `block_on(async { db_manager.cleanup().await })`, and `cleanup()` awaits `pool.close()`, which waits for every checked-out connection. With the main thread parked in `block_on`, a single long-running background task holding a connection froze the app with no way to exit. | `lib.rs:811-838` (old); `manager.rs:209` |
| C-2 | **S1** | **FIXED** | The sidecar **orphaned processes**. On the `wait()` error path the `Child` was simply dropped without termination — and dropping a child handle does not kill the process. On the timeout path `kill()`'s result was discarded, so a failed kill lost the last handle to a still-running `llama-helper`. | `sidecar.rs:583-594` (old) |
| C-3 | **S2** | **FIXED** | The `child_process` tokio mutex guard was held **across** `child.wait()` (3s) and `child.kill()`, blocking every other task needing the handle for the full timeout and risking deadlock. The handle is now taken out of the registry before any await. | `sidecar.rs:581-596` (old) |
| C-4 | **S2** | **FIXED** | Shutdown was **not idempotent**: tray Quit (`app.exit(0)`) and the OS exit path could both run teardown and race on the same child handle. A single coordinator now guards on an atomic swap, and both paths route through it. | `tray.rs:49` (old) |
| C-5 | **S2** | **FIXED** | Quitting mid-recording said nothing about the session. Shutdown now attempts a bounded graceful finalization and, if that fails, explicitly reports the recording as **incomplete** with recoverable checkpoints preserved — never as saved. | `lifecycle.rs` |
| C-6 | **S3** | **FIXED** | A failed reap / unkillable sidecar was logged at the same level as routine notices. Termination failures are now surfaced explicitly, including the PID and the risk of an untracked surviving process. | `sidecar.rs` |

### Workstream D — Database, migrations, WAL

Audited via WS-E and WS-C; see the table below for items resolved as a side effect. Remaining WAL/migration verification is folded into WS-B/WS-G isolation runs.

| ID | Sev | Status | Finding | Evidence |
|---|---|---|---|---|
| D-1 | **S2** | **FIXED** | Intelligence source rows were deleted only via `ON DELETE CASCADE`, which depends on the connection having `PRAGMA foreign_keys = ON`. Without it, sources orphan and evidence navigation points at deleted items. Sources are now deleted explicitly inside the transaction. | `meeting_intelligence.rs` |
| D-2 | **S2** | **FIXED** | The abstract and intelligence items were written by two independent autocommit calls; a failure between them left a new summary beside stale items. Now one transaction, with a forced mid-transaction failure regression-tested to roll back. | `replace_all` |

### Tooling / hygiene

| ID | Sev | Status | Finding |
|---|---|---|---|
| T-1 | **S3** | open | The `7c4adf9` baseline is **not** `cargo fmt --all -- --check` clean: `incremental_saver.rs`, `phase_f1_integrity.rs`, `lib.rs`, `path_guard.rs`, `tests_f2_security.rs` are unformatted (drift introduced in F1/F2). |
| T-2 | **S3** | open | `templates/mod.rs` tests read the global custom-template-dir override without holding `override_guard()`, racing the loader tests. Intermittent failure observed. **Fixed in the A workstream.** |
| T-3 | — | info | `frontend/src-tauri/Cargo.toml` carries a line-ending artifact; must remain untouched and unstaged. |

## 2. Validation matrix

| Suite | Command | Baseline `7c4adf9` | After WS-A | After WS-E |
|---|---|---|---|---|
| Rust unit | `cargo test --workspace` | 383 pass / 0 fail / 2 ignored | 409 / 0 / 2 | **441 / 0 / 2** | **453 / 0 / 2** | **466 / 0 / 2** (+83) |
| Rust fmt | `cargo fmt --all -- --check` | **FAIL** (5 files, T-1) | **PASS** (830ba6e) | PASS | PASS | **PASS** |
| Rust lint | `cargo clippy --workspace --all-targets` | pass | pass | pass | pass | **pass** |
| Frontend | `node --test tests/lib/*.test.mjs` | 645 / 643 / 2 known | 658 / 656 / 2 | 669 / 667 / 2 | 674 / 672 / 2 | **674 / 672 / 2** |
| TypeScript | `tsc --noEmit` (`src/`) | clean | clean | clean | clean | **clean** |
| Frontend build | `npm run build` | pass | — | — | **pass** | **pass** |

Known baseline failures (unchanged, not weakened):
1. Phase 4 `checkPermissions` mount-effect test.
2. Bun-only `qa-routes` test.