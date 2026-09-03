# Meetily Intelligence — QA Test Plan & Regression Baseline

**Status:** LIVE — this document tracks a parallel-integration effort and is updated as agents land work.
**Audience:** Integration Owner, feature agents, QA.
**Binding reference:** `docs/MEETILY_INTELLIGENCE_IMPLEMENTATION_CONTRACT.md` (v1.0).
**Environment recorded:** Windows x64, cargo 1.90.0, node v22.20.0, pnpm 10.28.2, bun 1.3.14 (installed via `node install.js` after pnpm ignored the postinstall), VS 2022 Build Tools, LLVM 22.

---

## 1. Baseline (recorded before/without QA modification)

| Command | Result | Classification |
|---|---|---|
| `cargo fmt --all -- --check` | FAIL (exit 1) — pre-existing formatting drift in `whisper_engine/*`, `llama-helper`, `main.rs`, `system_monitor.rs` and others | Pre-existing debt. NOT fixed by QA (would create huge diffs conflicting with feature branches). |
| `cargo check -p meetily` | FAIL — needs `LIBCLANG_PATH` (libclang 22 installed), `cmake` (VS-bundled cmake works via PATH), and `binaries/llama-helper-x86_64-pc-windows-msvc.exe` (built by `dev-gpu.bat`/`build-gpu.bat`). With all three provided, `whisper-rs 0.13.2` fails to compile against `whisper-rs-sys 0.11.1` (bindgen produced opaque `whisper_full_params` — libclang 22 is too new for bindgen 0.69.5; winget will not downgrade LLVM). | ENV-MISSING / toolchain incompatibility. NOT an app regression. |
| `cargo test -p meetily` | NOT RUNNABLE (same whisper-rs-sys blocker). Rust unit tests shipped by feature agents are compile-checked by review only on this machine; they run in CI/other machines. | ENV-MISSING |
| `pnpm lint` | FAIL — `next lint` prompts interactively (no ESLint config wired for Next 14 flat config); eslint is not a devDependency at baseline. | Tooling gap, pre-existing. |
| `pnpm build` | Initially FAIL (exit 1): `/context/[id]` missing `generateStaticParams()` under `output: 'export'`. After QA fix (server wrapper + client split) compilation, typechecking and page-data collection pass; the export step is flaky while feature agents run `next dev` against the same `.next` directory (ENOENT `.next/server/pages-manifest.json`). | First failure was a REAL regression (Context agent); the remainder is shared-checkout concurrency. |
| `bun test tests/lib` | PASS — 47/47 (baseline). Bun not installed initially; the `bun` npm package's postinstall is skipped by pnpm 10 → `node install.js` in the package dir fixes it. | OK after env fix |
| `node tests/lib/onboarding-summary-model.test.mjs` | PASS | OK |
| `node tests/lib/calendar.test.mjs` | PASS (calendar agent) | OK |
| `node tests/lib/daily-timeline.test.mjs` | PASS 26/26 (daily agent) | OK |

---

## 2. Automated test inventory

All frontend tests are runnable with **no backend, no network, no paid services**.

```bash
cd frontend
pnpm exec bun test tests/lib          # bun-style suites (template service/schema, daily services, blocknote, summary-language, ...)
node tests/lib/onboarding-summary-model.test.mjs
node tests/lib/calendar.test.mjs
node tests/lib/daily-timeline.test.mjs
node tests/lib/qa-calendar.test.mjs          # QA: TZ matrix, DST, month/year transitions
node tests/lib/qa-daily-timeline.test.mjs    # QA: zero/one/many meetings, boundaries, brief text, sources
node tests/lib/qa-daily-navigation.test.mjs  # QA: /daily route building
node tests/lib/qa-template-schema.test.mjs   # QA: template validation/ids/builtin protection
node tests/lib/context.test.mjs              # Context agent: normalizers, grouping, provenance
node tests/contract/audit.mjs                # QA: binding-contract conformance gate (see §5)
```

### Coverage matrix

| Area | Coverage | Where |
|---|---|---|
| Custom templates — create/edit/duplicate/delete | Backend CRUD logic incl. id sanitization, path traversal, reserved Windows names, builtin protection, atomic writes, duplicate id generation | Rust `summary/templates/store.rs` tests (run where Rust compiles); frontend contract locked by `tests/contract/audit.mjs` |
| Custom templates — validation | JSON/structure rules, field-level errors, round-trip serialization | `template-schema.test.ts`, `qa-template-schema.test.mjs`, Rust `types.rs`/`store.rs` tests |
| Custom templates — invalid ID / path traversal | `../escape`, `a/b`, `a\b`, `a..b`, `.hidden`, `-lead`, `con`, `com1`, `lpt9`, >64 chars | Rust `store.rs::sanitize_rejects_invalid_ids`; frontend `isValidTemplateId` pinned in `qa-template-schema.test.mjs` (includes CONTRACT DELTA test for dash IDs) |
| Builtin mutation protection | create/update/delete/duplicate onto `daily_standup`, `standard_meeting`, bundled ids | Rust `store.rs` + `loader.rs` tests; `deleteTemplate` backend-reject surfaced in `template-service.test.ts` |
| Calendar — local TZ boundaries, midnight, DST | NYC/Kathmandu/UTC/Berlin matrices, 23h/25h DST days, midnight bucket splits, Intl cross-check | `calendar.test.mjs`, `qa-calendar.test.mjs` |
| Calendar — month/year transitions, leap years | Grid invariants for every month 2020–2030, Dec→Jan, leap grids | `qa-calendar.test.mjs` |
| Calendar — zero/one/many meetings, chronological order | Grouping/ordering pure functions | `calendar.test.mjs`, `qa-calendar.test.mjs`; backend SQL rules enforced by `tests/contract/audit.mjs` (ORDER BY datetime, §3.3 duration derivation) |
| Daily view — zero/one/many, boundaries | Empty day totals, single meeting, many meetings, transcript-block isolation, prompt-injection text stays data, large transcripts | `qa-daily-timeline.test.mjs` |
| Daily view — meeting navigation | `/daily?date=`, range routes, invalid-input fallback, encode | `qa-daily-navigation.test.mjs` |
| Daily summary — provider failure / command absence | `DailyBriefCommandUnavailableError` + legacy fallback path (synthetic `daily-brief-<date>` meeting id) | `daily-service-qa.test.ts` |
| Daily summary — ordering, source IDs | Brief text meeting order, offsets, source normalization (camel/snake/id-only), fallback sources | `qa-daily-timeline.test.mjs` |
| Daily summary — regeneration | Deterministic synthetic meeting id per day key; repeated start replaces result via existing pipeline | `daily-service-qa.test.ts`, `qa-daily-timeline.test.mjs` |
| Context — CRUD, validation | Rust `contexts/service.rs` tests (empty/oversized name, trim, not-found, idempotent delete) | runs where Rust compiles |
| Context — many-to-many, duplicate links | Composite-PK dedup, meeting in multiple contexts, chronological listing | Rust `contexts/service.rs` tests |
| Context — deletion behavior / meeting survival | Context delete keeps meetings+transcripts; meeting delete removes links (FK-on) | Rust `contexts/service.rs` tests |
| Context — provenance | `provenanceLinkForItem` (no fabricated source), source title fallback | `context.test.mjs` |
| Continuous memory — empty/existing memory | `render_context_memory` → None when empty; digest + items render | Rust `context/memory.rs` tests |
| Continuous memory — dedup | Normalized containment dedup, resolution matching (never closes on re-mention) | Rust `context/dedup.rs` tests |
| Continuous memory — prompt injection | Delimiter neutralization, data-not-instructions guards, extraction prompt | Rust `context/prompts.rs` tests; frontend brief text `qa-daily-timeline.test.mjs` |
| Continuous memory — size limits | Content caps, token budgets, item caps (30 default / 100 hard), compaction digest | Rust `context/model.rs`, `render.rs`, `memory.rs` tests |
| Continuous memory — failure safety | Extraction-before-write; provider failure leaves memory untouched; meeting save unaffected | Rust `context/engine.rs` tests (reviewed; runnable where Rust compiles) |
| Regression-safe: recording/stop/persistence/history/meeting-details/summary/builtin templates/settings/onboarding | Additive-only verification: no edits to recording path; existing suites (`onboarding-summary-model`, `summary-language-preferences`, template tests) stay green; `api_process_transcript` signature change is additive per §8 | Full suite runs below |

---

## 3. QA regression test files added by this effort

| File | Purpose |
|---|---|
| `frontend/tests/contract/audit.mjs` | Adversarial binding-contract gate (§5). Source-level, no build needed. |
| `frontend/tests/lib/daily-service-qa.test.ts` | Daily-brief service behavior: fallback signaling, arg mapping, transcript bounds paging, caching, error propagation (bun). |

(Other QA files — `qa-calendar.test.mjs`, `qa-daily-timeline.test.mjs`, `qa-daily-navigation.test.mjs`, `qa-template-schema.test.mjs`, `context.test.mjs` — were landed by parallel QA/feature agents and are kept.)

---

## 4. Regressions found

| # | Finding | Owning agent | Repro | Status |
|---|---|---|---|---|
| 1 | `/context/[id]` route broke `pnpm build` under `output: 'export'` ("missing generateStaticParams") | Context | `pnpm build` | FIXED (QA + context agent): server wrapper page with `generateStaticParams()` returning `[]` + client component. Verified compile/typecheck pass; export step flaky only due to concurrent dev server. |
| 2 | Calendar range SQL orders by raw `m.created_at` TEXT — RFC3339 (`T`/`Z`) and space-separated timestamps sort wrongly when mixed (space sorts before `T`) | Calendar / owner (repo in `database/repositories/meeting.rs`) | Insert two meetings in the same day, one `2026-08-15T00:10:00Z`, one `2026-08-15 23:50:00` → range query returns them in the wrong order | OPEN — locked by `tests/contract/audit.mjs` (ORDER BY datetime) |
| 3 | Calendar duration derivation `MAX(audio_end_time) − MIN(audio_start_time)` ≠ contract §3.3 (`MAX(end)>0 else SUM(duration) else None`) — pre-roll speech offsets skew durations; `0`/NULL semantics differ | Calendar | Meeting whose first speech starts at 30s → duration under-reported by 30s | OPEN — locked by audit |
| 4 | `api_get_meetings_by_date_range` takes `auth_token` (contract §2.7 forbids new commands taking it) and lives in owner-owned `api/api.rs` (contract §12 puts it in `api/calendar.rs`) | Calendar | code review | OPEN — locked by audit |
| 5 | `api_get_dates_with_meetings` (calendar month dots) not implemented | Calendar | invoke fails | OPEN — locked by audit |
| 6 | Template frontend service invokes `api_save_template`/`api_get_template_json`/`api_delete_template`; backend registers neither `api_save_template` nor `api_get_template_json`, and the implemented CRUD commands (`api_create_template`, `api_update_template`, `api_duplicate_template`) are **not registered** in `lib.rs` either. Net effect: custom-template create/edit/duplicate is dead end-to-end until integration. | Templates + Owner | Settings → Template Manager → save template → "Template management is not available yet" | OPEN — §1.1 reconciliation; locked by audit |
| 7 | Daily service invokes `api_generate_daily_brief`/`api_get_daily_brief`/`api_cancel_daily_brief`; contract §5.2 canonical names are `api_generate_daily_summary`/`api_get_daily_summary`/`api_cancel_daily_summary`; no backend daily module exists yet (fallback path works) | Daily + Owner | code review | OPEN — locked by audit |
| 8 | `meetingService` invokes `api_get_meetings_by_date_range`; canonical `api_get_meetings_by_range` (§3.1) | Calendar + Owner | code review | OPEN — locked by audit |
| 9 | Meeting delete transaction does not clean `context_meetings`, `context_memory_items`, or `daily_summaries` (§9); FK pragma not enabled in `database/manager.rs` (§11), so `ON DELETE CASCADE` on `context_meetings` never fires in the app (agent tests enable the pragma themselves, masking this) | Owner (meeting.rs/manager.rs) | Delete a meeting that belongs to a context → orphaned link row remains; context list still counts it | OPEN — locked by audit |
| 10 | Opaque `context_memory` table still created by `20260815000000_add_context_threads.sql`; binding §6 retires it (note in `20260815000002_add_context_memory.sql` says owner retires it) | Context + Owner | code review | OPEN — locked by audit |
| 11 | Daily-summaries table deviates from §5.1 (PK `date_key` vs `id` + `date`; no `meeting_ids` column) | Daily + Owner | code review | OPEN — locked by audit |

Fixed-by-QA items were limited to build-enabler/integration-scope changes; everything in owner-owned files is reported, not edited.

---

## 5. Contract conformance gate (`tests/contract/audit.mjs`)

Runs in plain node, reads source only, exits with the violation count. Current status recorded in §4; the gate flips green as the Integration Owner reconciles §1.1. CI suggestion: run it on every PR and fail on any *increase* in violations.

---

## 6. Manual smoke-test checklist (QA + release)

Preconditions: production/dev build running (`pnpm run tauri:dev`), a whisper model loaded, and a working LLM provider configured in Settings.

### Regression-safe core
- [ ] Start recording → live transcript appears → stop recording → meeting saved
- [ ] Meeting appears in sidebar history with correct Today/Yesterday/Earlier grouping
- [ ] Open meeting-details → transcript renders → generate summary → markdown renders
- [ ] Built-in templates appear in the summary template dropdown; summary uses the selected one
- [ ] Settings open and persist (model, API keys, language, recording folder)
- [ ] Onboarding flow completes (summary model selection remembered)

### Custom templates
- [ ] Settings → Template Manager lists built-in + bundled + custom templates with correct source badges
- [ ] Create a template with a valid name/description/sections → appears in the dropdown
- [ ] Create with empty name → field error; with invalid JSON → surfaced backend error
- [ ] Edit a custom template → changes reflected after save
- [ ] Duplicate a built-in → new custom copy; edit it; built-in itself unchanged
- [ ] Delete a custom template → disappears; built-in delete → rejected with error toast
- [ ] Restart app → custom templates persist

### Calendar
- [ ] Open Calendar → today highlighted; days with meetings marked
- [ ] Select a day → day list shows meetings chronologically; click a meeting → opens meeting-details
- [ ] Navigate months across a year boundary (Dec→Jan); verify no blank/duplicated days
- [ ] Verify a meeting recorded near midnight appears on the correct *local* day (record one at 23:50 local and one at 00:10)

### Daily view
- [ ] `/daily?date=today` shows all today's meetings on one timeline, in order, with durations
- [ ] Day with zero meetings renders an empty state (no crash)
- [ ] Day with one meeting renders; day with many meetings keeps each meeting's transcript separate
- [ ] Prev/next day navigation works across month boundaries; invalid date query shows fallback, no crash

### Daily summary
- [ ] Generate Daily Brief on a multi-meeting day → polling indicator → markdown brief renders with source-meeting list
- [ ] Regenerate → replaces previous brief; cancel mid-run → status cancelled, no crash
- [ ] Disconnect network / point at an invalid provider endpoint → brief fails with error shown; day view stays functional

### Context
- [ ] Create a context; add two meetings (one already in another context — many-to-many)
- [ ] Context detail lists meetings chronologically; remove one → meeting itself still opens from history
- [ ] Delete context → toast confirms "meetings were not deleted"; verify meetings still open
- [ ] Memory items show source-meeting links; clicking a provenance link opens the right meeting
- [ ] Memory item with no source meeting shows no fabricated link

### Continuous memory
- [ ] Generate summaries for 2 meetings in the same context, then summarize a 3rd with that context selected → prompt contains prior context memory (visible in generated summary's grounding or via debug logs)
- [ ] Paste a transcript containing "ignore previous instructions" → summary still follows template; the injection text is treated as data
- [ ] Kill the provider mid-summary → meeting save/summary completion unaffected; no partial memory writes

### Tauri native smoke test
**NOT PERFORMED on this machine.** The native app cannot be built here: whisper-rs-sys bindgen fails against libclang 22 (winget cannot downgrade LLVM) and `llama-helper` needs cmake + a built sidecar. No claim of native success is made. This checklist must be executed on a machine with a working Rust build before release.

---

## 7. Blockers

1. **Rust build on this QA machine** — libclang 22 vs bindgen 0.69.5 (opaque `whisper_full_params`). Fix options: install LLVM 18 side-by-side and point `LIBCLANG_PATH` at it, or run Rust tests on another machine.
2. **`pnpm lint`** — needs ESLint wiring (`eslint.config.mjs` exists; `next lint` doesn't consume it without install/config).
3. **`cargo fmt`** — repo-wide formatting drift; reformatting is deliberately deferred to avoid merge conflicts.
4. **Concurrent agents share `.next`/`out`** — production builds and `next dev` in the same checkout clobber each other. Recommend one agent build at a time, or separate checkouts.
5. **No git repository** — the checkout has no `.git`; `git add`/`git commit` for QA additions is impossible until the Integration Owner initializes or restores it.
