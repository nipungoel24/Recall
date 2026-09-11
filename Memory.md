# Memory.md

Concise, factual working memory. Updated after every completed task, major decision, and before ending a session.

# Current State

- Current phase: Phase 4 — Recording Experience (implementation complete, awaiting review)
- Branch: `phase/4-recording-experience`
- Base: `c1197a8` (Phase 3 merged to main)

# Completed

- Phase 0: forensics, baseline, audits, source-of-truth docs
- Phase 0 closure: `accd7ca` on main + origin/main + rebrand/recall + origin/rebrand/recall
- Phase 1: foundation hardening (updater disabled, analytics removed, clippy fixed, dead code cleaned, hygiene)
- Phase 1 closure: `c3be39b` on main + origin/main + phase/1-foundation + origin/phase/1-foundation
- Phase 2: design system foundation (tokens, theme, icons, motion, typography, regression tests)
  - Pre-paint theme bootstrap (inline script in <head>, no first-frame flash)
  - Morphicons real integration (ThemeToggle morphs Monitor/Sun/Moon)
  - WCAG AA contrast validated for both light and dark themes
- Phase 2 closure: `4931b92` + 2 closure corrections
- Phase 3: application shell + home — merged to main as `c1197a8` (fast-forward from `a8a386b`)
- Phase 4: recording experience — implementation on `phase/4-recording-experience` (pending review)
  - Fake bar-chart visualization removed (page + RecordingControls)
  - Truthful timer from backend `recording_duration`; REC/paused live indicator
  - RecordingControls rewritten: sonner toasts (no `alert()`), semantic tokens, `role=status` a11y
  - Stop-flow data loss fixed: save gated on `shouldSaveMeetingAfterStop` (stop success, not transcription completion)
  - Provider-aware readiness (`recordingReadiness.ts`); Local Whisper fully independent of Parakeet
  - Unified start orchestration (`useRecordingStart`), explicit STARTING/ERROR transitions
  - Permission check reworked: honest device enumeration (`usePermissionCheck`), `deviceStatus`
  - DeviceSelection/PermissionWarning: truthful copy (no BlackHole/screen-recording claims), semantic tokens
  - Rust: `AudioPipeline::new` returns `Result` — VAD init error propagates instead of panicking
  - Competing state sources removed: `useRecordingStateSync` deleted; page derives from `RecordingStateContext`

# Decisions

- Updater fail-closed until Recall-owned release infra + signing keys (Phase 10)
- NO product telemetry; if reconsidered → opt-in, Recall-owned, sanitized, explicit approval
- Tauri identifier `com.meetily.ai` preserved (migration-sensitive)
- Archived backend/ and serverAddress vestigial gate DEFERRED (documented)
- External assets classified; upstream-controlled hosts (Parakeet v3 CDN, ffmpeg binaries) = MUST MIGRATE BEFORE RELEASE
- BlockNote theme follows app theme (was hardcoded "light")
- Reduced motion: intentional, not blanket `* { animation: none }`
- Theme bootstrap: inline script in <head> sets class before React hydrates; ThemeProvider syncs on mount
- Phase 3 sidebar: bg-red-500 → bg-destructive (semantic, theme-aware); text-white → text-primary-foreground
- Phase 3 home: bg-white → bg-surface, bg-gray-50 → bg-background; brutalist hierarchy
- Phase 3 keyboard: Ctrl+K focuses sidebar search; Escape blurs it
- Phase 3 failure states: daily brief failure + contexts error surface honest error messages with retry
- Phase 3 attention: per-meeting summary failures NOT surfaced (requires new bulk query API — deferred)
- Phase 4 timeline: timer shows only real backend `recording_duration`; never simulated audio levels
- Phase 4 stop: SQLite save runs on any successful stop even if transcription timed out; no cancel/discard primitive
- Phase 4 single source of truth: `RecordingStateContext` owns recording state + `isRecordingDisabled`; events drive it
- Phase 4 honesty: frontend cannot query OS permission grants; device availability ≠ permission, copy says so

# Phase 4 Test Commands (final closure)

- pnpm install --frozen-lockfile → PASS
- pnpm run build → PASS (Compiled successfully)
- node --test tests/lib/phase4-recording-experience.test.mjs → 32/32 PASS
- node --test tests/lib/phase3-shell-home.test.mjs → PASS (32/32)
- node --test tests/lib/design-system-regression.test.mjs → PASS (20/20)
- node --test tests/lib/updater-regression.test.mjs → PASS
- node --test tests/lib/analytics-regression.test.mjs → PASS
- node --test tests/lib/*.test.mjs → 214 pass / 1 fail (pre-existing bun-only `qa-routes.test.mjs` on Windows)
- cargo fmt --all --check → PASS
- cargo check --offline → PASS (pre-existing warnings only)
- cargo clippy --offline --all-targets → PASS (warnings only, 0 errors; no warnings from pipeline change)
- cargo test --offline → 340 lib passed, 0 failed (2 ignored) + 1 doc passed
- cargo build --offline (debug) → PASS (recall.exe linked)
- bun test → NOT AVAILABLE on Windows (`.test.ts` suites cannot run here)

# Known Problems

- Frontend source lint debt: 128 errors / 153 warnings (pre-existing; deferred to quality phase)
- Bun-only test suites cannot run on this machine (NOT AVAILABLE)
- Parakeet v3 models + ffmpeg binaries hosted on upstream infra (MUST MIGRATE BEFORE RELEASE)
- `com.meetily.ai` migration not yet designed/tested
- Main branch protection: recommended but not enabled (direct push succeeded)
- TemplateEditor.tsx: 15+ hardcoded gray references (deferred to screen redesign)
- SummaryTemplateManager.tsx: remaining hardcoded gray (deferred to screen redesign)
- Per-meeting summary failure attention signals require bulk query API (deferred to appropriate later intelligence/action phase)
- Native GUI/macOS recording QA NOT performed (Windows-only environment; macOS backend assertion cached)
- `simple_level_monitor.rs` is a fake sine-wave stub; real `level_monitor.rs` exists but is not wired (double-capture risk)

# Next Exact Step

1. Push `phase/4-recording-experience`, verify `main` still at `c1197a8`, await review.
2. After approval, fast-forward main to `phase/4-recording-experience`.
3. Begin Phase 5 per Phases.md.

# Blockers

- None.