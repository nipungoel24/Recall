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

## PHASE 3 — Application Shell + Home

- Goal: app shell (sidebar/topbar/tray surfaces) and a Home that answers "what requires my attention?".
- Scope: Home layout (start recording, today, open actions, needs attention, recent meetings, active contexts, quick search); global search entry point.
- Non-scope: recording internals redesign.
- Acceptance: Home is useful and fast; no vanity metrics; keyboard/dark/light/responsive verified.

## PHASE 4 — Recording Experience

- Goal: mission-critical recording polish without breaking the native pipeline.
- Scope: device selection, permissions, levels, timer, live transcription status, model readiness, errors, stop/cancel, recovery UX.
- Non-scope: new capture backends unless justified.
- Acceptance: verified inside real Tauri (macOS + Windows), crash recovery retained.

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
