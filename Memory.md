# Memory.md

Concise, factual working memory. Updated after every completed task, major decision, and before ending a session.

# Current State

- Current phase: Phase 2 complete. Ready for Phase 3.
- Branch: `phase/2-design-system` (published to origin, corrected)
- Base: `c3be39b` (Phase 1 closure)

# Completed

- Phase 0: forensics, baseline, audits, source-of-truth docs
- Phase 0 closure: `accd7ca` on main + origin/main + rebrand/recall + origin/rebrand/recall
- Phase 1: foundation hardening (updater disabled, analytics removed, clippy fixed, dead code cleaned, hygiene)
- Phase 1 closure: `c3be39b` on main + origin/main + phase/1-foundation + origin/phase/1-foundation
- Phase 2: design system foundation (tokens, theme, icons, motion, typography, regression tests)
  - Pre-paint theme bootstrap (inline script in <head>, no first-frame flash)
  - Morphicons real integration (ThemeToggle morphs Monitor/Sun/Moon)
  - WCAG AA contrast validated for both light and dark themes

# Decisions

- Updater fail-closed until Recall-owned release infra + signing keys (Phase 10)
- NO product telemetry; if reconsidered → opt-in, Recall-owned, sanitized, explicit approval
- Tauri identifier `com.meetily.ai` preserved (migration-sensitive)
- Archived backend/ and serverAddress vestigial gate DEFERRED (documented)
- External assets classified; upstream-controlled hosts (Parakeet v3 CDN, ffmpeg binaries) = MUST MIGRATE BEFORE RELEASE
- BlockNote theme follows app theme (was hardcoded "light")
- Reduced motion: intentional, not blanket `* { animation: none }`
- Theme bootstrap: inline script in <head> sets class before React hydrates; ThemeProvider syncs on mount

# Phase 2 Test Commands

- cargo fmt --all --check → PASS
- cargo clippy --workspace --all-targets → PASS (warnings only)
- cargo check --workspace → PASS
- cargo test --workspace → PASS (343 passed, 2 ignored, 0 failed)
- pnpm run build → PASS (12 routes, 0 errors)
- node --test tests/lib/*.test.mjs → 145 pass / 1 fail (qa-routes needs bun; pre-existing)
- node tests/contract/audit.mjs → 80 passed, 0 violations, 1 note
- node --test tests/lib/updater-regression.test.mjs → 6/6 PASS
- node --test tests/lib/analytics-regression.test.mjs → 5/5 PASS
- node --test tests/lib/design-system-regression.test.mjs → 24/24 PASS
- bun test → NOT AVAILABLE on this Windows host

# Known Problems

- Frontend source lint debt: 128 errors / 153 warnings (pre-existing; deferred to quality phase)
- Bun-only test suites cannot run on this machine (NOT AVAILABLE)
- Parakeet v3 models + ffmpeg binaries hosted on upstream infra (MUST MIGRATE BEFORE RELEASE)
- `com.meetily.ai` migration not yet designed/tested
- Main branch protection: recommended but not enabled (direct push succeeded)
- TemplateEditor.tsx: 15+ hardcoded gray references (deferred to screen redesign)
- SummaryTemplateManager.tsx: remaining hardcoded gray (deferred to screen redesign)

# Next Exact Step

1. Fast-forward main to phase/2-design-system after review.
2. Begin Phase 3 — Application Shell + Home per Phases.md.

# Blockers

- None.
