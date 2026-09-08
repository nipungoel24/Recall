# Recall — Phases

**Status:** Source of truth · **Version:** 1.0 · **Date:** 2026-09-08
Each phase requires user approval before starting. Never begin the next phase automatically. Phases adjust based on actual repository state.

## PHASE 0 — Reconciliation + Audit + Planning ✅ (complete)

- Goal: determine true repository state, reconcile safely, baseline, audit, produce source-of-truth docs.
- Done: forensics (local ahead by 6, clean), baseline verification, full code audit, branding/privacy/updater/upstream audits, PRD/Architecture/Rules/Phases/Design created.
- Deliverables: Phase 0 report + these five documents. Memory.md intentionally not created yet.

## PHASE 1 — Recall Identity, Legacy Cleanup, Privacy/Updater Foundation

- Goal: finish the rebrand safely; close privacy/integrity gaps; clean verified dead code.
- Current state: rebrand commits exist on `rebrand/recall` (6 ahead of origin/main); branding regression test green; updater still targets upstream Meetily releases; analytics uses upstream PostHog key; dead code and stale HTTP stubs present.
- Scope:
  - Merge/publish the `rebrand/recall` work (fast-forward `main` after approval — no history rewrite).
  - Updater: disable auto-update safely until Recall release infra + signing keys exist (remove/neutralize upstream endpoint; keep manual UI path inert and clearly labeled).
  - Analytics: keep opt-in default OFF; decide Recall-owned PostHog key vs removal; add consent behavior tests.
  - Clippy: fix the 2 deny-by-default errors.
  - Dead code removal (reviewed, separate commits): `lib_old_complex.rs`, `audio_v2/`, `*-old.rs` undeclared files, `src-tauri/scripts` empties.
  - Stale HTTP surface: remove/neutralize localhost:5167 profile/licensing stubs in `api.rs` and frontend `serverAddress` constants.
  - Repo hygiene: remove tracked `frontend/vs_buildtools.exe`, duplicate tailwind config, stale `electron` main field.
  - External asset dependencies (Parakeet v3 URL, ffmpeg binaries from upstream infra): inventory and decide mirror/replace strategy (documented compatibility debt until then).
- Non-scope: design system, features, migrations of identifier.
- Acceptance criteria: updater cannot pull upstream releases; telemetry off by default verified by test; clippy clean; build+tests green; dead code gone without behavior change; working tree clean; docs updated.
- Tests: branding-regression, contract audit, cargo test/clippy, frontend build/tests, consent tests.
- Definition of done: PRs reviewed; gates green; Memory.md created and maintained from this phase onward.

## PHASE 2 — Design System + Icon/Motion System

- Goal: restrained brutalist productivity UI foundation.
- Scope: semantic light/dark tokens (per Design.md), typography hierarchy, component tokenization (shadcn variants), icon registry (lucide base + Morphicons for state transitions), motion tokens, reduced-motion support, contrast validation.
- Non-scope: screen redesigns.
- Acceptance: token coverage; light/dark audit; components consistent; tests pass.

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
