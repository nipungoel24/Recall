# Memory.md

Concise, factual working memory. Updated after every completed task, major decision, and before ending a session.

# Current State

- Current phase: Phase 5 — Meeting Workspace + Provenance (Gates 1, 2, 3, 4, & 5 complete, Gates 6-9 pending)
- Branch: `phase/5-meeting-workspace-provenance`
- Base: `80a1485` (Phase 4 merged to main)

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
- Phase 4: recording experience — implementation + closure corrections on `phase/4-recording-experience` (merged to main as `80a1485`)
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
  - Refresh bootstrap: `reconcileRecordingSnapshot` + single poller in `RecordingStateContext`
  - Stop failure: `resolveStopOutcome` backend-truth reconcile; restore RECORDING on genuine failure; never fake save
  - Recovery UX: no `alert()`/`confirm()`; persistent destructive Alert; two-step delete confirm
- Phase 5 Gate 1: Meeting Intelligence domain types + typed service + migration verified (on `phase/5-meeting-workspace-provenance`)
  - TypeScript domain types added to `src/types/index.ts`: `MeetingIntelligence`, `MeetingIntelligenceItem`, `MeetingIntelligenceItemSource`, `IntelligenceKind`, `MeetingIntelligenceResponse`, `IntelligenceItemResponse`, `IntelligenceSourceResponse`, `TranscriptSegmentPosition`, `GenerateIntelligenceRequest`, `IntelligenceItemRequest`, `IntelligenceItemSourceRequest`
  - Frontend service `src/services/meetingIntelligenceService.ts` with typed wrappers for: `api_get_meeting_intelligence`, `api_get_meeting_intelligence_items`, `api_generate_meeting_intelligence`, `api_get_transcript_segment`, `api_get_transcript_segment_position`
  - Migration `20260917000000_add_meeting_intelligence.sql` verified against Rust models, repository, and Tauri commands
- Phase 5 Gate 2: Meeting Workspace shell + Overview tab + evidence navigation reconstruction verified (on `phase/5-meeting-workspace-provenance`)
  - Thin workspace orchestrator reconstructed in `src/components/MeetingWorkspace/MeetingWorkspace.tsx` (no god component, no direct database calls).
  - Six conceptual sections: Overview, Summary, Transcript, Tasks, Notes, Context with shadcn/Radix Tabs, accessible keyboard navigation, visible focus, and semantic tokens.
  - Dedicated `OverviewTab.tsx`: communicates abstract, topics, decisions, actions, questions, facts/follow-ups; loading skeleton, deliberate empty state, and truthful provenance (evidence affordances rendered ONLY when valid sources exist).
  - Dedicated `TasksTab.tsx`: minimal Gate 2 action item presentation from meeting intelligence.
  - Clean tab wiring: `SummaryTab.tsx` forwards to `SummaryPanel`, `TranscriptTab.tsx` preserves virtualization and forwards pagination & evidence navigation, `NotesTab.tsx` fixes nested duplicate toolbars, and `ContextTab.tsx` connects to `contextService` with typed models.
  - Evidence navigation hook `useEvidenceNavigation.ts`: strictly enforces Cross-Meeting Invariant (`source.meeting_id === currentMeetingId`), calls Gate 1 `getTranscriptSegmentPosition`, switches active tab to transcript, scrolls, and applies temporary highlight with auto-expiration (3000ms).
  - Virtualized transcript coordination: `VirtualizedTranscriptView.tsx` and `TranscriptPanel.tsx` updated with `highlightedSegmentId` and `scrollToIndex` without disabling virtualization.
  - Safety invariants: zero `alert()` or `confirm()` calls; zero raw transcript content logging.
  - Tests: `tests/lib/phase5-meeting-workspace.test.mjs` (25/25 PASS) and `tests/lib/phase5-evidence-navigation-behavior.test.mjs` (6/6 PASS). Next.js production build (`pnpm run build`) compiled 12/12 static pages successfully. Rust validation passes (`cargo fmt --all --check`, `cargo check --offline`, `cargo clippy --offline --all-targets`, `cargo test --offline` 340 passed). Contract audit passes (80 passed, 0 violations). Full regression suites pass (145 pass / 1 known Phase 4 baseline fail). Gate 3 has NOT started.
- Phase 5 Gate 3: Summary Integration & Meeting Workspace Refinement verified (on `phase/5-meeting-workspace-provenance`)
  - Reused existing summary pipeline (`SummaryPanel`, `BlockNoteSummaryView`, templates, generation hooks, language selection, persistence); zero second summary system, zero duplicate hooks, zero direct SQL/DB in UI.
  - Safety invariant: removed raw `alert('Failed to save changes. Please try again.')` in `BlockNoteSummaryView.tsx`; replaced with accessible `toast.error()` from `sonner`. Zero `alert()` or `confirm()` across all summary components.
  - Semantic tokens applied: hardcoded `bg-white`, button gradients (`bg-gradient-to-r`), and raw colors (`text-green-600`, `bg-green-200`, `border-red-200`, `border-blue-200`, etc.) eliminated in favor of semantic tokens (`bg-background`, `bg-surface`, `border-border`, `text-foreground`, `text-muted-foreground`, `text-destructive`, `text-primary`).
  - Unified workspace toolbar: eliminated redundant internal title `h2` in Summary tab; consolidated `AddToContextButton`, `SummaryGeneratorButtonGroup` (Generate/Stop, Model Settings, Template Selector, Language Picker), and `SummaryUpdaterButtonGroup` (Save with dirty status, Copy) in top toolbar with semantic tokens.
  - Truthful empty state: `EmptyStateSummary` accepts `hasTranscripts` and disables generation with a tooltip explaining that a transcript is required.
  - Non-jumping loading state: animated `Loader2` spinner in `text-primary`, dynamic status message from `getSummaryStatusMessage`, and explicit Stop Generation action.
  - Safe, non-leaking error state: confirms transcript safety (*"Transcript Safe: Your audio recording and transcript remain intact and unaffected"*), provides Retry and Model Settings buttons, and non-destructively preserves existing summary on failed regeneration.
  - Saved summaries rendered without blocking `transcripts?.length > 0 &&` check; legacy fixed-bottom overlay removed; editorial document width container (`max-w-4xl`).
  - Tests: `tests/lib/phase5-summary-integration.test.mjs` (25/25 PASS). All regression suites pass (170 pass / 1 known Phase 4 baseline failure). Next.js production build (`pnpm run build`) compiled 12/12 static pages successfully. Rust checks pass (`cargo fmt`, `cargo check`, `cargo clippy`, `cargo test` 340 passed). Contract audit passes (80 passed, 0 violations). Gate 4 has NOT started.
- Phase 5 Gate 4: Transcript Deep Integration & Evidence Experience verified (on `phase/5-meeting-workspace-provenance`)
  - Deepened Transcript surface as a first-class workspace section with speaker hierarchy, timestamp formatting, readable typography, and semantic design tokens.
  - Zero hardcoded gray colors: replaced `text-gray-400`, `text-gray-800`, `bg-gray-100`, `border-gray-200` in `VirtualizedTranscriptView` with semantic tokens (`text-foreground`, `text-muted-foreground`, `text-primary`, `bg-muted/50`, `border-border`). Replaced hardcoded gradients on Enhance button with outline semantic tokens.
  - Speaker presentation: `resolveSpeaker` supports explicit speaker properties (`'mic'`, `'system'`, named speakers) and regex prefix parsing (`Speaker 1:`, `[Host]:`), rendering clear uppercase brutalist badges.
  - Timestamp formatting: `formatRecordingTime` handles sub-minute `[00:SS]`, multi-minute `[MM:SS]`, and multi-hour `[HH:MM:SS]` durations safely.
  - Zero-layout-shift evidence highlight: applied identical padding (`p-2.5`) and border dimensions across normal and highlighted states, eliminating layout jumps. Added `tabIndex={0}`, `role="region"`, `aria-current="true"`, and non-disruptive `focus({ preventScroll: true })`.
  - Precision virtualizer & pagination boundary handling: clamped `scrollToIndex` within bounds; if target segment index exceeds loaded segments and `hasMore` is true, triggers `onLoadMore()` to paginate up to evidence.
  - Truthful states: Loading (non-jumping, `role="status"`, `aria-live="polite"`), Error (safe, non-leaking, actionable Retry), Empty (truthful "No transcript recorded" archived meeting state instead of onboarding prompt).
  - Clean prop forwarding: `MeetingWorkspace` accepts `isLoadingTranscripts` and `transcriptError` and forwards down to `TranscriptTab`, `TranscriptPanel`, and `VirtualizedTranscriptView`.
  - Strict safety invariants: zero `alert()`, `confirm()`, or `window.prompt()` calls; zero raw transcript logging.
  - Tests: `tests/lib/phase5-transcript-integration.test.mjs` (26/26 PASS). All Phase 5 suites pass (82 pass). Next.js production build (`pnpm run build`) compiled 12/12 static pages successfully. Rust checks pass (`cargo fmt`, `cargo check`, `cargo clippy`, `cargo test` 340 passed). Contract audit passes (80 passed, 0 violations). Full regression suites pass. Gate 5 has NOT started.
- Phase 5 Gate 5: Meeting Action Items Intelligence verified (on `phase/5-meeting-workspace-provenance`)
  - Upgraded `TasksTab` from Gate 2 minimal presentation to full Gate 5 intelligence-state-aware presentation.
  - State separation: calls both `getMeetingIntelligence()` and `getMeetingIntelligenceItems()` in parallel via `Promise.all`; renders 4 distinct states: (1) loading skeleton, (2) error with `role="alert"`, (3) no-intelligence-yet with Generate trigger, (4) intelligence-ran (empty or populated).
  - Previously the "no intelligence" and "no action items" states were conflated; now truthfully separated: "No Intelligence Generated" when `intelligence === null`, "No Action Items Identified" when intelligence exists but actions is empty.
  - `handleGenerate`: triggers `generateMeetingIntelligence()` from no-intelligence state; `isGenerating` disables button, shows spinner; on success updates both `intelligence` and `tasks` state.
  - Confidence display: shows `X% confidence` with `tabular-nums` when available (aligns with OverviewTab `ItemCard` pattern).
  - AI sourcing disclosure: header copy states "Action items are AI-extracted from meeting intelligence and may require verification."
  - Action items count shown only when populated (not "Action Items (0)").
  - Evidence navigation: unchanged — `canNavigate`, `hasValidEvidence`, `onNavigateToEvidence` props preserved.
  - `role="alert"` added to error div for screen reader announcement.
  - Zero new Rust commands, zero new migrations, zero new services — reuses existing `meetingIntelligenceService`.
  - Strict safety invariants: zero `alert()`, `confirm()`, `window.prompt()`; zero raw task text logging; zero SQL in component; zero hardcoded gray classes.
  - Tests: `tests/lib/phase5-tasks-intelligence.test.mjs` (31/31 PASS). All Phase 5 suites pass (113/113 PASS). Next.js build compiled successfully. Rust checks pass. Contract audit 80 passed, 0 violations. Gate 6 has NOT started.

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
- node --test tests/lib/phase4-recording-experience.test.mjs → 52/52 PASS
- node --experimental-strip-types --test tests/lib/phase4-recording-behavior.mjs → 25/25 PASS
- node --test tests/lib/phase3-shell-home.test.mjs → PASS (32/32)
- node --test tests/lib/design-system-regression.test.mjs → PASS (20/20)
- node --test tests/lib/updater-regression.test.mjs → PASS
- node --test tests/lib/analytics-regression.test.mjs → PASS
- node --test tests/lib/*.test.mjs → 234 pass / 1 fail (pre-existing bun-only `qa-routes.test.mjs` on Windows)
- Contract audit: node tests/contract/audit.mjs → 80 pass / 0 violations
- cargo fmt --all --check → PASS
- cargo check --offline → PASS (pre-existing warnings only)
- cargo clippy --offline --all-targets → PASS (warnings only, 0 errors; no new warnings from Phase 4 edits)
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

1. Gate 1, Gate 2, Gate 3, Gate 4, & Gate 5 complete — proceed to Gate 6: Notes (replace /notes demo with real per-meeting notes).
2. After Gate 6: Gate 7 (Context), Gate 8 (polish), Gate 9 (tests + docs).
3. All gates verified → final verification → push `phase/5-meeting-workspace-provenance` → await review/approval → fast-forward main.

# Blockers

- Native GUI / Windows recording QA NOT PERFORMED (Windows CLI host only; `cargo build` is build verification, NOT GUI workflow QA).
- macOS recording QA NOT AVAILABLE.
- Bun-only test suites cannot run on this machine (NOT AVAILABLE).
- Phase 4 test `checkPermissions` mount effect fails (pre-existing; documented in Phase 4 report).