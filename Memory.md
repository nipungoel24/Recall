# Memory.md

Concise, factual working memory. Updated after every completed task, major decision, and before ending a session.

# Current State

- Current phase: Phase 3 COMPLETE
- Branch: `phase/3-shell-home`
- Base: `a8a386b` (Phase 2 merged to main)
- Latest commit: `7098ecd`

# Completed

- Phase 0: forensics, baseline, audits, source-of-truth docs
- Phase 0 closure: `accd7ca` on main + origin/main + rebrand/recall + origin/rebrand/recall
- Phase 1: foundation hardening (updater disabled, analytics removed, clippy fixed, dead code cleaned, hygiene)
- Phase 1 closure: `c3be39b` on main + origin/main + phase/1-foundation + origin/phase/1-foundation
- Phase 2: design system foundation (tokens, theme, icons, motion, typography, regression tests)
  - Pre-paint theme bootstrap (inline script in <head>, no first-frame flash)
  - Morphicons real integration (ThemeToggle morphs Monitor/Sun/Moon)
  - WCAG AA contrast validated for both light and dark themes
- Phase 2 closure: `4931b92` + 2 closure corrections (`Phases.md` test-count fix, unused import removal)
- Phase 3: application shell + home (7 commits on phase/3-shell-home)
  - Commits: `2a03af9`, `e97092f`, `0908dd2`, `a7b7cdf`, `7479d6e`, `f105d2c`, `57697a7`, `7098ecd`
  - Sidebar: semantic tokens, button semantics (div→button), aria-current, focus-visible, Ctrl+K, search aria-label
  - Home: semantic tokens, brutalist hierarchy (no shadows, no rounded-xl, uppercase headers, border separators)
  - Home failure states: daily brief error + contexts error surfaced with AlertTriangle + retry
  - 27 regression tests covering accessibility, hierarchy, failure states, tokens, routes

# Decisions

- Updater fail-closed until Recall-owned release infra + signing keys (Phase 10)
- NO product telemetry; if reconsidered → opt-in, Recall-owned, sanitized, explicit approval
- Tauri identifier `com.meetily.ai` preserved (migration-sensitive)
- Archived backend/ and serverAddress vestigial gate DEFERRED (documented)
- External assets classified; upstream-controlled hosts (Parakeet v3 CDN, ffmpeg binaries) = MUST MIGRATE BEFORE RELEASE
- BlockNote theme follows app theme (was hardcoded "light")
- Reduced motion: intentional, not blanket `* { animation: none }`
- Theme bootstrap: inline script in <head> sets class before React hydrates; ThemeProvider syncs on mount
- Phase 3 sidebar: bg-red-500 → bg-destructive (semantic, theme-aware)
- Phase 3 sidebar: text-white → text-primary-foreground (semantic, theme-aware)
- Phase 3 home: bg-white → bg-surface, bg-gray-50 → bg-background
- Phase 3 home: brutalist hierarchy — no shadows, no rounded-xl, 1px borders, uppercase tracking headers
- Phase 3 keyboard: Ctrl+K focuses sidebar search; Escape blurs it
- Phase 3 failure states: daily brief failure + contexts error now surface honest error messages with retry
- Phase 3 attention: per-meeting summary failures NOT surfaced (requires new bulk query API on summary_processes table — deferred)

# Phase 3 Test Commands

- pnpm install --frozen-lockfile → PASS
- pnpm run build → PASS (Compiled successfully)
- node --test tests/lib/phase3-shell-home.test.mjs → 27/27 PASS
- node --test tests/lib/design-system-regression.test.mjs → 20/20 PASS
- node --test tests/lib/updater-regression.test.mjs → PASS
- node --test tests/lib/analytics-regression.test.mjs → PASS
- node tests/contract/audit.mjs → 80 passed, 0 violations, 1 note
- node --test tests/lib/*.test.mjs → 177 pass / 1 fail (pre-existing bun issue on Windows)
- cargo fmt --all --check → PASS
- cargo check --workspace → PASS
- cargo test --workspace → 343 passed, 0 failed (2 + 340 + 0 + 1)
- cargo tauri build --debug --no-bundle → PASS (recall.exe built)
- focused lint → 128 errors / 153 warnings (pre-existing baseline, no new)
- bun test → NOT AVAILABLE on Windows

# Known Problems

- Frontend source lint debt: 128 errors / 153 warnings (pre-existing; deferred to quality phase)
- Bun-only test suites cannot run on this machine (NOT AVAILABLE)
- Parakeet v3 models + ffmpeg binaries hosted on upstream infra (MUST MIGRATE BEFORE RELEASE)
- `com.meetily.ai` migration not yet designed/tested
- Main branch protection: recommended but not enabled (direct push succeeded)
- TemplateEditor.tsx: 15+ hardcoded gray references (deferred to screen redesign)
- SummaryTemplateManager.tsx: remaining hardcoded gray (deferred to screen redesign)
- Per-meeting summary failure attention signals require new bulk query API (Phase 4+ territory)

# Next Exact Step

1. Fast-forward main to phase/3-shell-home after review.
2. Begin Phase 4 — Recording Experience per Phases.md.

# Blockers

- None.
