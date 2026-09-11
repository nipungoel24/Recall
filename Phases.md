# Recall — Phases

**Status:** Source of truth · **Version:** 1.0 · **Date:** 2026-09-08
Each phase requires user approval before starting. Never begin the next phase automatically. Phases adjust based on actual repository state.

## PHASE 0 — Reconciliation + Audit + Planning ✅ (complete)

- Goal: determine true repository state, reconcile safely, baseline, audit, produce source-of-truth docs.
- Done: forensics (local ahead by 6, clean), baseline verification, full code audit, branding/privacy/updater/upstream audits, PRD/Architecture/Rules/Phases/Design created.
- Deliverables: Phase 0 report + these five documents. Memory.md intentionally not created yet.

## PHASE 1 — Recall Identity, Legacy Cleanup, Privacy/Updater Foundation ✅ (complete)

- Goal: finish the rebrand safely; close privacy/integrity gaps; clean verified dead code.
- Done:
  - Phase 0 closure: docs committed (`accd7ca`); `origin/rebrand/recall` safety copy; `main` fast-forwarded to `accd7ca`; all refs synchronized.
  - Updater disabled fail-closed: plugin, upstream release-feed config, frontend update UI, tray entry, and update scripts removed; user-facing links repointed at the Recall repo; `tests/lib/updater-regression.test.mjs` guards reintroduction.
  - Analytics removed: posthog-rs client + key, 26 telemetry commands, frontend facade/provider/consent UI, and all call sites removed; `tests/lib/analytics-regression.test.mjs` guards reintroduction; PRIVACY_POLICY.md updated.
  - Clippy: 2 deny errors fixed (`AudioCaptureBackend::as_str`, vacuous `len() >= 0`); `cargo clippy --workspace --all-targets` passes.
  - External assets inventoried + classified: `docs/RECALL_EXTERNAL_ASSETS.md` (Parakeet v3 CDN + ffmpeg binaries = MUST MIGRATE BEFORE RELEASE).
  - Dead code removed with evidence: `lib_old_complex.rs`, `audio_v2/`, `*-old.rs`/`.backup`, FastAPI-era HTTP stubs, tracked `vs_buildtools.exe`, stale tailwind config, duplicate metadata files, dead deps (@remirror, @tiptap/react+starter-kit, lodash, zod).
  - eslint: ignores for generated `.next/`/`out/`; source-only baseline 128 errors / 153 warnings (pre-existing; zero new errors from Phase 1 edits).
- Deferred (documented): frontend `serverAddress` vestigial gate (functional, low risk), archived `backend/` removal (separate review), `MEETILY_RSA_PUBLIC_KEY` secret rotation, identifier migration, global lint debt (later quality phase).
- Acceptance criteria: all met (see Phase 1 report).

## PHASE 2 — Design System + Icon/Motion System ✅ (complete)

- Goal: restrained brutalist productivity UI foundation.
- Done:
  - Semantic color tokens (20+ per theme) with WCAG AA contrast validated for both light and dark.
  - System/Light/Dark preference with localStorage persistence and pre-paint bootstrap (no first-frame flash).
  - Typography hierarchy: display → code (7 levels with tuned letter-spacing).
  - shadcn component tokenization: button variants standardized, badge rewritten, skeleton fixed, shared components migrated from hardcoded gray.
  - Icon registry (Lucide re-exports) + Morphicons integration (spring physics, reduced-motion) with real stateful use in ThemeToggle.
  - Motion tokens (duration/easing CSS variables + Framer Motion presets).
  - Intentional reduced-motion (targets specific animations, preserves focus-visible).
  - Contrast validation for both light and dark themes (programmatic WCAG AA test).
  - Design-system regression test suite (20 tests).
- Deferred (documented): TemplateEditor.tsx and SummaryTemplateManager.tsx remaining hardcoded gray (deferred to their screen redesign phases).
- Acceptance: all met (see Phase 2 correction report).

## PHASE 3 — Application Shell + Home ✅ (complete)

- Goal: app shell (sidebar/topbar/tray surfaces) and a Home that answers "what requires my attention?".
- Done:
  - Sidebar: semantic tokens (bg-destructive recording, bg-accent active, text-primary-foreground icons, bg-background MainContent).
  - Sidebar accessibility: expanded nav items converted from `<div>` to `<button>` elements; `aria-current="page"` on all active nav items (expanded + collapsed); `focus-visible:ring-2 focus-visible:ring-ring` on all interactive elements; `aria-label` on search input, Import Audio, collapse/expand.
  - Keyboard: global Ctrl+K / Cmd+K shortcut focuses sidebar search with deferred post-expansion focus (pendingSearchFocus pattern); Escape blurs search input.
  - HomeDashboard: semantic tokens throughout (bg-background page, text-foreground headings, text-muted-foreground descriptions, text-primary links, divide-border lists, border-border sections).
  - Home hierarchy: brutalist redesign — no shadows, no rounded-xl/2xl, 1px borders, uppercase tracking-wider section headers, border-b separators, information-dense layout.
  - Home failure states: Daily Brief distinguishes load error ("Couldn't load Daily Brief" with status-load retry) from generation failure ("Brief generation failed" with "Open Daily to Retry"); contexts error rendered with AlertTriangle + error message + Retry via refetch.
  - Phase 3 regression suite → PASS at closure (static-source suites: shell tokens, sidebar accessibility (aria-current, button semantics, focus-visible, Ctrl+K deferred focus, Import Audio aria-label, collapse button focus), home tokens, home hierarchy (brutalist), home failure states (brief load vs generation distinction), routes, design-system compliance, test/tooling existence).
- Deferred (documented): per-meeting summary failure attention signals require bulk query API (summary_processes.status not exposed on MeetingMetadata — deferred to appropriate later intelligence/action phase); TemplateEditor.tsx and SummaryTemplateManager.tsx remaining hardcoded gray deferred to their screen redesign phases.
- Acceptance: all met (build, cargo test, cargo fmt, cargo clippy, contract audit, Phase 3 regression suite → PASS). Native visual QA: NOT AVAILABLE (CLI environment). Merged to main at `c1197a8`.

## PHASE 4 — Recording Experience ✅ (complete — pending approval/merge)

- Goal: mission-critical recording polish without breaking the native pipeline.
- Scope: device selection, permissions, levels, timer, live transcription status, model readiness, errors, stop/cancel, recovery UX.
- Non-scope: new capture backends unless justified (no backends added).
- Done:
  - Fake audio visualization removed: page + RecordingControls no longer simulate bar levels (`Math.random`/`barHeights` deleted).
  - Truthful timer: pill shows backend `recording_duration` (real elapsed time, tabular-nums), REC + paused live indicator (motion-safe ping).
  - RecordingControls rewritten: explicit Start/Pause/Resume/Stop transitions and duplicate guards, sonner toasts instead of `alert()`, semantic tokens, focus-visible rings, `role="status"` `aria-live="polite"` status region, labelled start/stop buttons.
  - Stop-flow data loss fixed: SQLite save gated on `shouldSaveMeetingAfterStop(isCallApi)` — the save runs on any successful stop (backend always finalizes audio) even when live transcription timed out; brief wait for the `recording-stopped` payload race.
  - Provider-aware readiness: new pure `src/lib/recordingReadiness.ts`; `getReadinessAdapter`/`resolveTranscriptionReadiness` consult ONLY the configured provider's adapter — Local Whisper is fully independent of Parakeet (regression-gated).
  - Unified start orchestration in `useRecordingStart` (manual/auto/direct single path), provider-driven readiness (ignored cloud STT), explicit STARTING/ERROR transitions, toast on failure instead of `alert()`.
  - Permission check honesty: `usePermissionCheck` enumerates devices and never pretends to query OS permission grants; exposes `deviceStatus`; `requestPermissions` calls the real `trigger_microphone_permission` command then rechecks.
  - DeviceSelection + PermissionWarning: truthful copy (no BlackHole/screen-recording claims — macOS default is CoreAudio process taps), semantic tokens, honest empty states.
  - Competing state sources removed: `useRecordingStateSync` deleted; `RecordingStateContext` is the single source (owns `isRecordingDisabled`), page derives state from context, events drive transitions.
  - Rust: `AudioPipeline::new` returns `Result<Self>`; VAD processor init failure propagates as an error instead of panicking.
  - Phase 4 regression suite → PASS (32 tests: provider independence, stop-save gate, no-fake-viz, no-alert, permission honesty, device truthfulness, single-source-of-truth, workspace a11y/tokens, Rust VAD no-panic).
- Acceptance: verified inside real Tauri (macOS + Windows), crash recovery retained.
  - Windows: `pnpm build` PASS, full `.mjs` regression suite 214 pass / 1 pre-existing bun-only fail, `cargo fmt/check/clippy/test` PASS (0 new warnings from Phase 4 edits), `cargo build` (debug) links recall.exe, cargo unit tests 340 passed / 2 ignored.
  - macOS: NOT AVAILABLE (Windows-only environment). Backend assertions verified via code inspection (CoreAudio taps default, no BlackHole dependency in copy).

## PHASE 5 — Meeting Workspace + Provenance

- Goal: OVERVIEW / SUMMARY / TRANSCRIPT / TASKS / NOTES / CONTEXT information architecture.
- Scope: structured `MeetingIntelligence` model, source-aware items with segment/timestamp references, click-to-evidence navigation, real notes (replace `/notes` demo), no duplicated widgets.
- Acceptance: provenance never fabricated; items link to evidence; existing summary/transcript features preserved.

## PHASE 6 — Task/Action Intelligence

- Goal: durable tasks (text, owner, due date, status, source, confidence) with deterministic parsing/normalization; preserve/improve existing export paths (CSV/ICS as implemented).
- Acceptance: ambiguous dates never silently become deadlines; tasks survive restarts; exports verified.

## PHASE 7 — Search + Global Recall

- Goal: global lexical/structured search (SQLite FTS) over meetings, transcripts, summaries, notes, decisions, tasks, questions, contexts; filters (`type:`, `status:`, `context:`, `after:`).
- Non-scope: vector DB/embeddings until proven necessary.
- Acceptance: results link to meetings/evidence; performance verified on large DBs.

## PHASE 8 — Context Intelligence

- Goal: deepen Context memory: scoring, ranking, merge/prune to budget, recency/repetition signals, unbounded-prompt protection.
- Acceptance: bounded memory guaranteed; extraction quality measured; existing provenance preserved.

## PHASE 9 — Reliability, Security, Accessibility, Performance, CI

- Goal: hardening pass: error model, restart behavior, migration upgrade tests, a11y audit, perf measurements, CI gating (fmt/clippy/test/lint/contract/branding).
- Acceptance: CI green on PRs; known-baseline debt tracked and shrinking.

## PHASE 10 — Release/Migration/Update Infrastructure

- Goal: Recall-owned release repo, signing keys, update manifests, tested upgrade migration (including identifier migration decision), platform artifacts.
- Acceptance: upgrades verified from Meetily-era installs; updater endpoints Recall-owned; signatures verified.
