# Memory.md

Concise, factual working memory. Updated after every completed task, major decision, and before ending a session.

# Current State

- Current phase: Phase 2 — Design System + Icon/Motion System (implementation complete, pending report)
- Branch: `phase/2-design-system`
- Base: `c3be39b` (synchronized main after Phase 1 closure)
- Current task: commits + push + report

# Completed

- Phase 0: forensics, baseline, audits, source-of-truth docs
- Phase 0 closure: `accd7ca` on main + origin/main + rebrand/recall + origin/rebrand/recall
- Phase 1: foundation hardening (updater disabled, analytics removed, clippy fixed, dead code cleaned, hygiene)
- Phase 1 closure: `c3be39b` on main + origin/main + phase/1-foundation + origin/phase/1-foundation
- Phase 2:
  - Semantic color tokens: 20+ tokens per theme (light + dark), WCAG AA contrast validated
  - Theme system: System/Light/Dark with localStorage persistence, OS detection, no flash
  - Button variants migrated: blue→default, red→destructive, gray→outline, added success variant
  - Badge rewritten with CSS variable tokens (was all hardcoded gray)
  - Skeleton fixed (was bg-gray-200/70, now bg-muted)
  - Scrollbar tokens (was hardcoded #d1d5db, now muted-foreground)
  - Typography hierarchy: display/page-title/section-title/body/small/caption/label/code
  - Motion tokens: duration-fast/standard/slow, ease-out/in-out/spring
  - Reduced motion: intentional (not blanket nuke), preserves focus-visible
  - Icon registry: src/lib/icons.ts (Lucide re-exports, standard sizes)
  - Morphicons integrated: morphicons@1.7.1, lucide data package, RecallMorphIcon wrapper
  - ThemeToggle component + PreferenceSettings appearance section
  - BlockNote editors use resolved theme (was hardcoded "light")
  - Shared components fixed: PageHeader, DownloadProgressToast (were all hardcoded gray)
  - SummaryTemplateManager partially fixed (remaining gray deferred to screen redesign)
  - Design-system regression test: 15/15 pass

# Skills Used

- ibelick/ui-skills: baseline-ui, fixing-accessibility, fixing-motion-performance
- emilkowalski/skills: emil-design-eng (animation philosophy, easing, duration, spring, component principles)

# Decisions

- Updater fail-closed until Recall-owned release infra + signing keys (Phase 10)
- NO product telemetry; if reconsidered → opt-in, Recall-owned, sanitized, explicit approval
- Tauri identifier `com.meetily.ai` preserved (migration-sensitive)
- Archived backend/ and serverAddress vestigial gate DEFERRED (documented)
- External assets classified; upstream-controlled hosts (Parakeet v3 CDN, ffmpeg binaries) = MUST MIGRATE BEFORE RELEASE
- BlockNote theme follows app theme (was hardcoded "light")
- Reduced motion: intentional, not blanket `* { animation: none }`

# Test Commands

- cargo fmt --all --check → PASS
- cargo clippy --workspace --all-targets → PASS (warnings only)
- cargo check --workspace → PASS
- cargo test --workspace → PASS (343 passed, 2 ignored, 0 failed)
- pnpm run build → PASS (12 routes, 0 errors)
- node --test tests/lib/*.test.mjs → 145 pass / 1 fail (qa-routes needs bun; pre-existing)
- node tests/contract/audit.mjs → 80 passed, 0 violations, 1 note
- node --test tests/lib/updater-regression.test.mjs → 6/6 PASS
- node --test tests/lib/analytics-regression.test.mjs → 5/5 PASS
- node --test tests/lib/design-system-regression.test.mjs → 15/15 PASS
- bun test → NOT AVAILABLE on this Windows host

# Known Problems

- Frontend source lint debt: 128 errors / 153 warnings (pre-existing; deferred to quality phase)
- Bun-only test suites cannot run on this machine (NOT AVAILABLE)
- Parakeet v3 models + ffmpeg binaries hosted on upstream infra (MUST MIGRATE BEFORE RELEASE)
- `com.meetily.ai` migration not yet designed/tested
- Main branch protection: recommended but not enabled (direct push succeeded)
- TemplateEditor.tsx has 15+ hardcoded gray references (deferred to screen redesign)

# Next Exact Step

1. Commit Phase 2 work (semantic commits).
2. Push phase/2-design-system to origin.
3. Produce Phase 2 report.

# Blockers

- None.
