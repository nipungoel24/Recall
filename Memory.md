# Memory.md

Concise, factual working memory. Updated after every completed task, major decision, and before ending a session.

# Current State

- Current phase: Phase 3 COMPLETE
- Branch: `phase/3-shell-home`
- Base: `a8a386b` (Phase 2 merged to main)
- Latest commit: `0908dd2`

# Phase 3 Audit Findings

- Routes: `/` Home, `/calendar`, `/daily`, `/context`, `/meeting-details`, `/settings` = REAL+FUNCTIONAL. `/notes` = STALE/DEMO. `/templates` = duplicate of Settings tab.
- Sidebar: Dual-mode (collapsed/expanded), search via `api_search_transcripts`, recording state via RecordingStateContext. Active state uses `bg-accent text-accent-foreground`.
- HomeDashboard: Today's meetings (api_get_meetings_by_range), Daily Brief (api_get_daily_summary), Recent (sidebar meetings), Contexts (useContexts). 2 own API calls + 2 pre-loaded.
- Recording: RecordingStateContext provides isRecording/isPaused/status. Sidebar button dispatches events to Home.
- Window: Native decorations, 1100x700, close-to-tray. No custom titlebar.
- No new Rust commands needed for Phase 3.

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
- Native Tauri smoke: app compiles and runs on Windows; visual theme verification requires manual inspection
- Phase 3: application shell + home (sidebar tokens, HomeDashboard tokens, 17 regression tests)
  - Sidebar: bg-destructive recording, bg-accent active, text-primary-foreground icons, bg-background MainContent
  - HomeDashboard: bg-background page, bg-surface cards, text-foreground headings, text-muted-foreground descriptions, divide-border lists
  - 3 commits: `2a03af9`, `e97092f`, `0908dd2`

# Decisions

- Updater fail-closed until Recall-owned release infra + signing keys (Phase 10)
- NO product telemetry; if reconsidered → opt-in, Recall-owned, sanitized, explicit approval
- Tauri identifier `com.meetily.ai` preserved (migration-sensitive)
- Archived backend/ and serverAddress vestigial gate DEFERRED (documented)
- External assets classified; upstream-controlled hosts (Parakeet v3 CDN, ffmpeg binaries) = MUST MIGRATE BEFORE RELEASE
- BlockNote theme follows app theme (was hardcoded "light")
- Reduced motion: intentional, not blanket `* { animation: none }`
- Theme bootstrap: inline script in <head> sets class before React hydrates; ThemeProvider syncs on mount
- Phase 3 sidebar: bg-red-500 → bg-destructive (not bg-red-500 which would bypass token system)
- Phase 3 sidebar: text-white → text-primary-foreground (semantic, theme-aware)
- Phase 3 home: bg-white → bg-surface (raised surface), bg-gray-50 → bg-background (page)

# Phase 3 Test Commands

- cargo fmt --all --check → PASS
- cargo test --workspace → 343 passed, 0 failed
- pnpm run build → PASS (Compiled successfully)
- node tests/contract/audit.mjs → 80 passed, 0 violations, 1 note
- node --test tests/lib/phase3-shell-home.test.mjs → 17/17 PASS
- node --test tests/lib/design-system-regression.test.mjs → 20/20 PASS
- node --test tests/lib/updater-regression.test.mjs → PASS
- node --test tests/lib/analytics-regression.test.mjs → PASS
- node --test tests/lib/*.test.mjs → 167 pass / 1 fail (pre-existing bun issue on Windows)

# Known Problems

- Frontend source lint debt: 128 errors / 153 warnings (pre-existing; deferred to quality phase)
- Bun-only test suites cannot run on this machine (NOT AVAILABLE)
- Parakeet v3 models + ffmpeg binaries hosted on upstream infra (MUST MIGRATE BEFORE RELEASE)
- `com.meetily.ai` migration not yet designed/tested
- Main branch protection: recommended but not enabled (direct push succeeded)
- TemplateEditor.tsx: 15+ hardcoded gray references (deferred to screen redesign)
- SummaryTemplateManager.tsx: remaining hardcoded gray (deferred to screen redesign)

# Next Exact Step

1. Publish `phase/3-shell-home` branch to origin.
2. Fast-forward main to phase/3-shell-home after review.
3. Begin Phase 4 — Recording Experience per Phases.md.

# Blockers

- None.
