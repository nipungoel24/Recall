# Memory.md

Concise, factual working memory. Updated after every completed task, major decision, and before ending a session.

# Current State

- Current phase: Phase 5 — Meeting Workspace + Provenance (Gates 1-8 complete; design-system remediation `4e6d081`; Phase 0 intelligence fix `a3c196b`; Phase A1 navigation foundation landed; Gate 9 still pending)
- Branch: `phase/5-meeting-workspace-provenance` (14 commits ahead of origin, NOT PUSHED)
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
- Phase 5 Gate 6: Notes Persistence verified (on `phase/5-meeting-workspace-provenance`)
  - Implemented `MeetingNotesModel` in `src-tauri/src/database/models.rs` matching existing migration `20251223000000_add_meeting_notes.sql`.
  - Created `NotesRepository` in `src-tauri/src/database/repositories/notes.rs` with `get_notes()` and `save_notes()` (upsert with meeting validation and timestamp update).
  - Registered `notes` module in `src-tauri/src/database/repositories/mod.rs`.
  - Added Tauri commands `api_get_meeting_notes` and `api_save_meeting_notes` in `src-tauri/src/api/api.rs` with typed request/response structs (`MeetingNotesResponse`, `SaveMeetingNotesRequest`).
  - Registered commands in `src-tauri/src/lib.rs` invoke_handler.
  - Updated `NotesTab.tsx` to use correct API signatures (`notesMarkdown`, `notesJson` params) and added `focus-visible` accessibility styles to Save button.
  - Reused existing `BlockNoteSummaryView` editor infrastructure — zero duplicate editor, zero second notes system.
  - NotesTab handles all states: loading (spinner), error (inline banner + Retry), saving (disabled button + spinner + "Saving..."), success (sonner toast), failure (sonner toast + inline error).
  - Uses semantic design tokens exclusively; zero hardcoded gray colors; zero `alert()`/`confirm()`/`window.prompt()`; zero raw content logging; zero direct SQL.
  - Migration verified: `meeting_notes` table with PK on `meeting_id`, FK cascade to `meetings`, `notes_markdown`, `notes_json`, `created_at`, `updated_at`, index on `meeting_id`.
  - Tests: `tests/lib/phase5-notes-persistence.test.mjs` (35/35 PASS). All Phase 5 suites pass (148/148 PASS). Next.js build compiles 12/12 pages. Rust: fmt/check/clippy/test all PASS (340 tests). Contract audit 80 passed, 0 violations. Full regression suites pass (1 known Phase 4 baseline `checkPermissions` failure unchanged).
- Phase 5 Gate 7: Context (deepen Context memory) verified (on `phase/5-meeting-workspace-provenance`)
  - Implemented unified, deterministic scoring model (`calculate_memory_score` in Rust `context/model.rs` and `calculateMemoryItemScore` in TypeScript `types/context.ts`) incorporating:
    - Base weights: Open Action (100) > Open Question (85) > Decision (70) > Fact (55) > Note (40) > Closed/Resolved/Terminal (15) > Unknown (10).
    - Monotonic recency decay: smooth exponential decay factor `1.0 / (1.0 + (age_days / 30.0))` with 30-day half-life; missing/invalid timestamps floor safely at 0.1; future timestamps (clock skew) clamp to 0 age.
    - Repetition/frequency signal: multiplier `1.0 + (min(occurrences - 1, 4) * 0.25)` bounded in `[1.0, 2.0]`.
    - Deterministic 4-stage tie-breaking: score desc -> updated_at desc -> source_meeting_id -> item ID asc.
  - Upgraded prompt assembly & compaction:
    - `render_inner_content` ranks candidate items by score before packing into budget so highest-priority items are rendered first and trivial recent notes do not starve open actions.
    - `plan_compaction` sorts by score so lowest-scoring items fold into markdown first; first item always retained even if exceeding budget.
    - Candidate working-set query in `repository.rs` (`list_item_views`) updated to `ORDER BY cmi.updated_at DESC, cmi.id ASC` so items refreshed during dedup are not starved.
  - Enforced unbounded-prompt hard caps:
    - `HARD_MAX_CONTEXT_BUDGET_TOKENS` (4000) ceiling on runtime budget.
    - `MAX_RENDERED_CONTEXT_CHARS` (16,000 chars) hard ceiling on total rendered markdown.
    - `MemoryBudget` sanitized with parameter clamping.
    - `MAX_CONTEXTS_PER_SUMMARY` (2) enforced in both summary generation and structured intelligence (`summary/service.rs`).
  - Upgraded Workspace `ContextTab.tsx`:
    - Fixed membership isolation bug: loads and maintains `memberContextIds` Set across all contexts on mount; never misidentifies context membership based on selected context.
    - Continuous memory inspection: loads `getCompactContextMemory(contextId)` and displays durable digest markdown and ranked memory items with kind icons, status pills, and truthful source meeting provenance links (`provenanceLinkForItem`).
    - Accessibility: eliminated nested `<button>` inside `role="button"` container; added accessible keyboard navigation, visible focus rings, loading spinner with `role="status"`, error banner with `role="alert"` and actionable Retry, and empty state with link to manage contexts.
    - Semantic design tokens exclusively; zero hardcoded gray/blue palette classes; zero `alert()`/`confirm()`/`window.prompt()`; zero raw content logging; zero direct SQL in component.
  - Tests: `tests/lib/phase5-context-deepening.test.mjs` (19/19 PASS), `tests/lib/context.test.mjs` (PASS). All Phase 5 suites pass (167/167 PASS). Next.js build compiles 12/12 pages. Rust: fmt/check/clippy/test all PASS (348 tests, 8 new unit tests in `model.rs` and `render.rs`). Contract audit 80 passed, 0 violations. Full regression suites pass.
- Phase 5 Gate 8: Polish verified (on `phase/5-meeting-workspace-provenance`)
  - Scope: visual/UI polish only. No new features, backend, database, context intelligence, or task lifecycle. Gate 7 scoring/ranking/merge/pruning logic untouched (regression-asserted).
  - Semantic design tokens: migrated every hardcoded Tailwind palette class across the audited UI surface to semantic tokens (`background`/`surface`/`surface-raised`/`muted`/`foreground`/`primary`/`success`/`warning`/`destructive` + `-foreground` pairs). This closes the previously-deferred `TemplateEditor.tsx` and `SummaryTemplateManager.tsx` hardcoded-gray debt. Dark mode now follows the theme for all of these surfaces.
  - Fixed mechanical-migration defects found in diff audit: invalid double-opacity classes (`primary/5/60`), a toggle knob whose `after:transition-colors` had killed its slide animation (now `after:transition-transform`), `bg-primary` paired with a leftover `hover:bg-blue-700`, and six no-op hovers collapsed to the same token in both states.
  - Dialogs rebuilt on Radix primitives (focus trap, Escape, scrim dismiss, focus restore, `aria-modal`, accessible name):
    - `SettingsModal.tsx`: all six hand-rolled modals (Preferences, Device, Language, Model Selector, error alert, chunk-drop warning) converted from `bg-black bg-opacity-50` divs to the shared `Dialog`. The Ollama model picker changed from `<div onClick>` to real `<button aria-pressed>` so it is keyboard reachable. The two alert modals carry an `sr-only` `DialogTitle` so each dialog has an accessible name without changing what is rendered.
    - `ConfirmationModel/confirmation-modal.tsx`: `role="alertdialog"`, titled, destructive icon, semantic buttons.
  - `MeetingWorkspace.tsx`: collapsed two competing `Tabs` roots into one, with the tab list in the header and shared `TAB_TRIGGER_CLASS` / `TAB_PANEL_CLASS` so density and active state stay consistent across all six sections.
  - `NotesTab.tsx`: the Save button previously persisted stale state because it never consulted the editor. It now flushes the live document via the editor ref's `saveSummary()` before invoking the save API, surfaces a truthful dirty indicator ("Unsaved changes" / "Saved"), disables Save when there is nothing to save, parses persisted BlockNote JSON inside a guarded `try/catch` with an `Array.isArray` shape check instead of `JSON.parse` during render, and renders a real "No notes yet" empty state rather than a blank editor.
  - `TasksTab.tsx`: a failed refresh no longer replaces already-loaded action items; the error degrades to a non-destructive inline `role="alert"` banner with Retry.
  - `RecordingStatusBar.tsx`: state transitions are announced through a polite `role="status"` live region, while the per-second clock is exposed as `role="timer"` with a spoken label and the visible ticking text is `aria-hidden` — so a screen reader hears "Recording in progress" once instead of once per second.
  - Shell: skip-to-content link targeting `#main-content`; sidebar rows are real buttons with `aria-expanded`/`aria-current` and focus-within action reveal; invalid `h-22` corrected to `h-20`; icon-only controls across Logo/Info/ModelSettings/TranscriptSettings/ComplianceNotification now carry accessible names; `focus:` normalized to `focus-visible:` on the shared input/textarea/select/accordion/badge primitives and the dialog/sheet close buttons.
  - Reduced motion: every spinner/pulse in the touched surface (16 sites across 11 files) now pairs its animation with `motion-reduce:animate-none` or `motion-safe:animate-*`. This included a malformed `motion-reduce animate-none` whose variant syntax never applied. Per project decision, this stays opt-out per element rather than a blanket `* { animation: none }`.
  - Typography: introduced the `text-page-title` / `text-section-title` / `text-label` / `text-caption` scale to Overview, Tasks, Notes, and Context so section hierarchy is consistent instead of ad-hoc `text-lg`/`text-xs`.
  - Tests: new `tests/lib/gate8-polish.test.mjs` (52 assertions) locks the Gate 8 polish contract — zero hardcoded palette, zero malformed opacity, zero no-op hovers, Radix dialogs, skip link, single Tabs root, truthful empty/error states, reduced-motion pairing, and an explicit guard that Gate 7 ranking/provenance helpers are still delegated. Two existing suites were updated where they pinned old implementation details rather than intent: the retry-control assertion in `phase5-context-deepening.test.mjs` is now element-agnostic (`<button>` or `<Button>`), and `phase5-notes-persistence.test.mjs` gained 5 stronger assertions (editor flush before save, guarded JSON parse, empty state, live regions, editorial measure) while dropping assertions on literal class strings that the shared `Button` primitive now owns.
  - Tests: all Phase 5 suites pass (172/172 PASS), Gate 8 suite 52/52 PASS. Next.js build compiles successfully. Rust unchanged: fmt/check/clippy (0 errors)/test all PASS (348 + 1 doc passed, 0 failed, 2 ignored). Contract audit 80 passed, 0 violations. Full JS suite 457/459 with the 2 known pre-existing failures unchanged (`checkPermissions` Phase 4 baseline; `qa-routes.test.mjs` is a Bun-only suite). Lint: 131 errors / 163 warnings — all Gate 8 hand-authored files lint clean; the movement versus the recorded 128/153 sits in pre-existing large files, not Gate 8 code.
  - NOT performed: native GUI / recording workflow QA (Windows CLI host only). All visual and interaction changes are unverified by eye and need a human pass.

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
- Phase 5 Gate 8: bulk class-string migration must be diff-audited, not trusted. Mechanical replacement produced invalid utilities (`primary/5/60`), killed a `transition-transform` animation, and created no-op hovers. Every bulk edit is now verified by scanning the diff for malformed opacity, palette leakage, and identical-state hovers.
- Phase 5 Gate 8: prefer the shared `Button`/`Dialog` primitives over hand-rolled equivalents. Six SettingsModal modals had no `role="dialog"`, `aria-modal`, focus trap, or Escape handling purely because they were hand-rolled.
- Phase 5 Gate 8: an `sr-only` `DialogTitle` is the way to name a dialog whose visible heading lives inside other markup (the alert modals) without changing the visual design.
- Phase 5 Gate 8: a Save action must read live state from its editor, not mirror props into a local copy. `NotesTab` could report success while persisting stale notes; it now flushes the editor before invoking the API.
- Phase 5 Gate 8: the per-second recording clock must not sit in a live region. Announce state transitions via `role="status"`; expose the clock as `role="timer"` with a label and hide the visible ticking text.
- Phase 5 Gate 8: PowerShell single-element arrays silently flatten, so `$pair[0]` became a `[char]` and `String.Replace` stripped every `:` in a file. Use the edit tool or a Node script for file rewrites on this host, and re-scan for `U+FFFD` plus colon-density afterwards.

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

- Frontend source lint debt: 131 errors / 163 warnings (pre-existing; deferred to quality phase). All Phase 5 Gate 8 hand-authored files lint clean.
- Bun-only test suites cannot run on this machine (NOT AVAILABLE)
- Parakeet v3 models + ffmpeg binaries hosted on upstream infra (MUST MIGRATE BEFORE RELEASE)
- `com.meetily.ai` migration not yet designed/tested
- Main branch protection: recommended but not enabled (direct push succeeded)
- Per-meeting summary failure attention signals require bulk query API (deferred to appropriate later intelligence/action phase)
- Native GUI/macOS recording QA NOT performed (Windows-only environment; macOS backend assertion cached)
- Gate 8 visual/interaction changes are unverified by eye — all six rewritten SettingsModal dialogs, the NotesTab save/empty states, the collapsed MeetingWorkspace Tabs, and the recording live regions need a human GUI pass.
- `simple_level_monitor.rs` is a fake sine-wave stub; real `level_monitor.rs` exists but is not wired (double-capture risk)

# Design System Remediation (4e6d081)

An Agent Forge `production-website` read-only audit of the UI layer found four
defects that were reproducible without rendering the app. All four are
correctness bugs rather than taste calls, so they were fixed and
regression-guarded. The broader UI redesign was deliberately NOT started.

## Confirmed defects found and fixed

1. **Focus rings had no offset colour** — `button`, `input`, `textarea`,
   `accordion` and `badge` declared `focus-visible:ring-offset-2` but never named
   an offset colour. Tailwind v3 defaults `--tw-ring-offset-color` to `#fff`, so
   every focused control rendered a hard white halo on dark surfaces. Each now
   sets `ring-offset-background`.
2. **Tailwind `content` globs were incomplete** — only `pages`, `components` and
   `app` were scanned, so classNames in `src/lib`, `src/hooks`, `src/contexts`
   and `src/services` were never emitted. `recordingNotification.tsx` shipped
   with no CSS at all. All four directories are now scanned.
3. **Neutral palette was hardcoded across 34 files** — `bg-white`, `bg-gray-*`,
   `border-gray-*`, `divide-gray-*` and `text-gray-*` ignored the theme, making
   the app effectively light-only outside `components/ui`. Migrated to existing
   tokens (`bg-surface`, `bg-muted`, `bg-popover`, `bg-background`,
   `border-border`, `divide-border`, `text-foreground`, `text-muted-foreground`,
   `bg-primary`, `ring-ring`). Four Context dialogs had overridden
   `DialogContent` with `bg-white text-gray-900`; two hand-rolled `AISummary`
   menus bypassed `dropdown-menu` and were pinned to light mode.
4. **A token migration collapsed an interaction state** — mapping
   `text-gray-400 hover:text-gray-600` onto one token silently deleted the
   hover affordance (found in `AISummary/Section.tsx`,
   `SummaryLanguageSettings.tsx` pin toggle, and the onboarding info button).
   Caught by diff review during the change itself, not by a test.

Scope was deliberately limited to the NEUTRAL palette families. Colored
utilities (`bg-blue-*`, `border-red-*`, `text-red-*`, …) still require
per-call-site intent and were left untouched.

Guard: `frontend/tests/lib/design-token-integrity.test.mjs` (12 tests) covers the
ring offset, the content globs, the neutral palette, dialog token inheritance,
and asserts that no hover/focus/active group is a complete no-op against its rest
state (scanning template-literal branches, where the damage actually occurred).

## Radius redesign — INTENTIONALLY DEFERRED

The `borderRadius` ladder in `tailwind.config.js` is genuinely **inverted**:
`md` resolves to `--radius + 2px` while `lg` resolves to `var(--radius)`, so
buttons and inputs render rounder than dialogs and alerts. This was confirmed
against the compiled CSS.

It was **not fixed** in `4e6d081`. Correcting it retints roughly 200 call sites
and could not be visually verified, because WebView2 content is not capturable
on this host (see Blockers). Baking an unverified retint into a commit was
rejected. `4e6d081` therefore changes no radius value and no radius call site;
the test asserts only that the scale stays derived from `--radius`, so the
ladder can be corrected later without fighting the guard.

## Remaining UI-system audit findings — ALL STILL OPEN

Nothing below has been implemented:

- `card.tsx` does not exist; 111 hand-rolled box `className`s across 62 files
  (the "card soup" visible in Settings). Missing primitives also include
  `alert-dialog`, `checkbox`, `radio-group`, `toggle`, `toggle-group`, `table`,
  `sidebar`.
- `--accent` (lime) is used as a neutral hover/selection fill in ~35 places, so
  many hovers flash saturated lime.
- Three mutually incompatible Tabs treatments; settings tabs also lack
  `focus-visible`, giving two competing focus systems.
- `settings/page.tsx` spring underline animation has no `prefers-reduced-motion`
  guard.
- 4+ hand-rolled confirm flows with no `alert-dialog` primitive.
- `OnboardingContainer.tsx` is a hand-rolled fullscreen modal with a `z-50`
  collision risk; `ImportDropOverlay.tsx` hardcodes 5 colours.
- 18 `transition-all` uses; 7 motion tokens defined with 0 consumers;
  `lib/motion.ts` has 0 importers.
- Primitive adoption is uneven: Button ~44 importers, Dialog ~18, but
  Separator / Sheet / Progress have 0 consumers.

## Validation for 4e6d081

- `tsc --noEmit`: clean for `src/` (8 pre-existing `bun:test` module errors only)
- `node --test tests/lib/*.test.mjs`: 508 tests / 506 pass / 2 known failures
  (Phase 4 `checkPermissions`; Bun-only `qa-routes`)
- `design-token-integrity`: 12/12 · Gate 8: 52/52 · Phase 5: 172/172
- design-system-regression: 20/20 · sidebar: 32/32 · phase3-shell-home: 32/32
- branding: 5/5 + `branding-scan.mjs` exit 0 · calendar/daily/context: 28/28
- updater/analytics: 11/11 · `cargo fmt --check`: clean · `cargo test`: 349
  passed, 0 failed
- Production build: SUCCESS (`Recall_0.4.0` MSI + NSIS). The `SignTool Error: No
  signature found` line is the expected no-certificate skip.
- User data untouched: `meeting_minutes.sqlite` byte-identical at 4,632,576 bytes.

## Visual QA — capture works, but do NOT trust it for layout (corrected in `a3c196b`, superseded in A2)

> **Superseded.** This section's `BitBlt` recipe obtains real pixels but
> **cannot be trusted to decide whether an element exists**: after a
> programmatic resize the WebView2 keeps a stale paint buffer and a `SW_RESTORE`
> desyncs the reported viewport, producing screenshots with blank regions that
> look exactly like a missing-element bug. In A2 this produced a false
> "the footer and Settings are missing" conclusion that cost real time.
> **Use the CDP path documented in the A2 section** (`Page.captureScreenshot` +
> `Runtime.evaluate` geometry against the app's own WebView2), and confirm any
> "element is absent" claim with `getBoundingClientRect()` before acting on it.

The earlier "not capturable" conclusion was **wrong** and is retracted. WebView2
pixels *are* obtainable on this host. Two mistakes caused the earlier failures:

1. **Wrong HWND.** `Get-Process recall` exposes six top-level windows. The one
   being grabbed was `tray_icon_app` (`IsWindowVisible = false`, 1920x1063). The
   real window is class **`Tauri Window`**, `visible = true`, client 1100x700.
2. **Foreground lock + occlusion.** `SetForegroundWindow` returns TRUE but the
   foreground HWND does not change. The window was also restored by the app onto
   the secondary monitor at `(-1432,107)`, directly beneath the agent TUI.

Working recipe (verified repeatedly, dark theme, 1100x700):

1. Select the window by **class `Tauri Window` AND `IsWindowVisible`**. Never
   `tray_icon_app`.
2. `AttachThreadInput(myTid, foregroundTid, true)` → `ShowWindow(SW_RESTORE)` →
   `BringWindowToTop` → `SetForegroundWindow`; **then verify
   `GetForegroundWindow() == hwnd`**.
3. `SetWindowPos(hwnd, HWND_TOPMOST, …)` to rise above the agent TUI.
4. Wait ~1.5s for WebView repaint.
5. `BitBlt` the window rect from the screen DC into a managed `Bitmap` HDC.
6. Clear `HWND_TOPMOST`.

**Never use `PrintWindow`** for this app: WebView2 renders through
DirectComposition into a GPU surface, so `WM_PRINT` returns a flat blank
(meanLuma 0.0, 1/16 buckets) on the window *and* on
`Chrome_RenderWidgetHostHWND` / `Intermediate D3D Window`. PrintWindow "succeeds"
and still yields nothing.

Two further environment facts worth keeping:

- Cross-process `GetWindowText` **hangs indefinitely** on some windows in this
  session (reproduced on a Chrome window). Resolve the PID first and use
  `Get-Process .MainWindowTitle`; do not call `GetWindowText` across processes
  inside an `EnumWindows` callback.
- Navigation limits without coordinate clicks: `{TAB}` and `{ENTER}` work, but
  **printable text does not reach WebView2** via `SendKeys` (neither typed chars
  nor clipboard paste), and **arrow keys do not drive the Radix roving tabindex**
  in this build. So workspace tabs, theme switching, and reaching a non-first
  meeting require either a human or a different input path. Never substitute
  approximate coordinate clicks — that previously started recordings.

# Phase 0 — Meeting Intelligence Recovery (a3c196b)

## Root cause

Every meeting opened with **"Intelligence Unavailable / Unable to load meeting
intelligence"**, including meetings that simply had no generated intelligence.

The five Meeting Intelligence Tauri commands have existed since Phase 4
(`80a1485`) in `src/summary/intelligence_commands.rs`, and the re-exports in
`src/summary/mod.rs` were already correct — but they were **never added to the
`tauri::generate_handler![]` list in `src/lib.rs`**. `git log` confirms the word
"intelligence" never appears in `lib.rs`. An unregistered command fails at
**runtime** with "unknown command"; it is not a compile error, not a TypeScript
error, and not covered by any Rust test.

Phase 5's frontend (`1021291`) was written against those commands, so:

| Consumer | Command | Effect |
|---|---|---|
| `OverviewTab` | `api_get_meeting_intelligence`, `..._items` | error state on every meeting |
| `TasksTab` | same two | "Tasks Unavailable" on every meeting |
| `useEvidenceNavigation` | `api_get_transcript_segment_position` | Phase 5 provenance/evidence navigation could not resolve positions |

Unaffected (already-registered commands): Summary, Transcript, Notes, Context.

This was **never a regression** — the wiring was simply never finished, which is
why 172/172 Phase 5 tests passed while the feature was 100% broken.

## Fix

1. Registered all five commands in `src/lib.rs`.
2. `api_generate_meeting_intelligence` takes a single nested
   `request: GenerateIntelligenceRequest`, but the service sent flat arguments.
   Tauri would have rejected it with a missing-argument error even once
   registered. Payload is now nested. This was masked by defect 1.
3. Two stale calls to **deleted** commands, surfaced by the new gate:
   - `ModelSettingsModal` called `api_get_auto_generate_setting` on mount. That
     command was commented out of `lib.rs` and its Rust impl deleted, so the
     fetch always rejected and only logged. The modal is reachable from the
     Summary tab, so it fired in normal use. Removed.
   - `builtin-ai.ts` exposed `getModelsDirectory()` wrapping
     `builtin_ai_get_models_directory`, which never existed in Rust and had no
     callers. Removed. (`parakeet_`/`whisper_get_models_directory` are real and
     registered — untouched.)

## Current data reality

`meeting_intelligence` = **0 rows** across all 51 meetings, and
`meeting_notes` = 0 rows. So "no intelligence yet" is the *only* correct state
today for every meeting. The UI now says exactly that, with a
"Generate Intelligence" path, instead of claiming a load failure.

The auto-generate checkbox in `ModelSettingsModal` is still local-only state
with no persistence. Pre-existing; needs a real backend setting, deliberately
not faked.

## Gate added

`frontend/tests/lib/tauri-command-registration.test.mjs` parses every literal
`invoke('…')` in `src/` and asserts the command is in the Rust handler. It fails
loudly on future drift — the exact class of bug that let this ship. It names the
five intelligence commands explicitly.

## Validation

`tsc` clean · `cargo fmt --check` clean · `cargo test` 349 passed / 0 failed ·
JS 513 tests, 511 pass, 2 known failures · Phase 5 172/172 · Gate 8 52/52 ·
design-system 20/20 · design-token-integrity 12/12 · registration gate 5/5 ·
production build succeeded, installed, verified visually. User data untouched:
`meeting_minutes.sqlite` byte-identical at 4,632,576 bytes, WAL 0, 0 audio files.

## Two further defects found by visual inspection (NOT yet fixed)

1. **Expanded sidebar overflows a 737px-tall window.** The nav block
   (Home → Meeting Notes) fills the full height, so the meeting archive *and the
   entire footer* — Start Recording, Import Audio, Settings, About — are pushed
   below the fold with no way to reach them. Directly motivates Phase A.
2. **Workspace tab strip is clipped at 1100px.** Only "Overview" and part of
   "Summary" are visible; Transcript/Tasks/Notes/Context run off-screen
   alongside the title and date in the same `justify-between` row.

Also visually confirmed: the active nav row and the RECALL wordmark both render
**lime** (`--accent` misuse), and focus rings now show the correct
`ring-offset-background` behaviour in dark mode (blue ring, no white halo) from
`4e6d081`.

# Phase A1 — Navigation Foundation (feat(ui): establish canonical navigation foundation)

A1 is **foundation only**. Its purpose is to make A2 safe: A2 rewrites a
1174-line sidebar, and doing that while the same knowledge is duplicated four
ways would mean guessing. A1 makes it explicit and singular.

**No visual redesign.** The archive, the floating collapse control, the
duplicate "Record / New Meeting" row and the current footer are all still
present on purpose. No radius, spacing, card, dialog, settings or workspace
change. Zero Rust, zero migrations, zero persistence changes.

## Canonical navigation model — `src/lib/nav.ts`

One data-driven model of every **destination**, grouped per `PRD.md`:

| Group | Items |
|---|---|
| PRIMARY | Home, Meetings, Calendar, Daily |
| KNOWLEDGE | Contexts, Templates, Meeting Notes |
| SYSTEM | Settings |

Deliberately **not** destinations, because you cannot *be* at them:
`Record / New Meeting` and `Start Recording` (actions), `Import Audio`
(action), `About` (identity surface).

The model is data only — no JSX, no rendering, no styling. It is the only file
permitted to declare the navigation list, enforced by test. Every `href`
resolves through `lib/routes.ts`. `isNavItemActive()` matches
exact-or-descendant, so `/` does not swallow `/settings`.

Note: the current sidebar labels its first group **"MEETINGS"** while it
contains Home/Record/Calendar/Daily. A1's model labels it PRIMARY; the sidebar
still renders the old label until A2 adopts the model.

## Route integrity

- `routes.meetings()` added so the destination is canonical before the screen
  exists. **A1 deliberately adds no placeholder page** — a test enforces that
  `/meetings` has no `page.tsx` yet.
- `routes.notes()` now takes an **optional** id so navigation can link to the
  bare `/notes` screen.

## `ui/list-row.tsx`

Shared row for navigation and list UI. Built but **not yet adopted** —
migrating existing screens is deferred so no behaviour changes alongside the
primitive.

- rest `transparent` · hover `bg-muted` · active `bg-muted` + 2px `bg-primary`
  indicator · focus `ring-ring` with `ring-offset-background` (correct in dark)
- The indicator is absolutely positioned, so selecting a row cannot shift layout.
- **Hover deliberately does not use the lime `accent`.**
- Renders `<a>` or `<button>` per usage; `aria-current` when active,
  `aria-disabled` when disabled, `href` dropped on a disabled link, and in
  collapsed/icon-only mode the label becomes the accessible name plus a tooltip.

## `ui/nav-section.tsx`

One canonical section label, replacing the two competing recipes the sidebar
carried (`px-3 pt-5 pb-1.5` and `px-3 pt-3 pb-1`). Uses `text-label` +
muted-ink, aligns to the row inset, `role="group"` named by its visible label.
Deliberately quieter than the rows it introduces.

## Sidebar width — one source of truth

The same two numbers were restated **four times**: `w-16`/`w-64` on the panel,
`ml-16`/`ml-64` on the main offset, and `4rem`/`16rem` inline in two overlays.

Now declared once in `globals.css` as `--recall-sidebar-width-expanded`
(16rem) / `--recall-sidebar-width-collapsed` (4rem), read through
`src/lib/sidebar-layout.ts`, and consumed by `sidebarWidth()` from the sidebar
panel, `MainContent`, `StatusOverlays` and the Home recording controls.

**Gotcha learned:** a CSS comment containing `w-*/ml-*` terminates the comment
early and the remainder is parsed as CSS, failing the webpack build with a
confusing postcss-loader trace. Never write `*/` inside a CSS comment.

## Default state

`isCollapsed` default flipped `true` → `false`. Recall now launches **expanded**;
the rail stays one control away and the toggle still flips rather than forces.

## Tests

New `tests/lib/nav-ia.test.mjs` — 28 assertions. Covers: single model, no JSX,
the three groups and exact membership, actions/utility absent as destinations,
routes helpers resolve to real pages, `/meetings` has no placeholder yet,
both primitives exist with no raw palette, no lime hover, one width source with
no consumer restating it, and expanded default.

**Intentional contract change** in `sidebar-polish.test.mjs`: two assertions
required the panel and offset to restate widths inline and then agree — which
is the bug, not the guard. They now require both to resolve from the shared
source and forbid the literals returning. Documented in place. Nothing was
weakened or deleted.

## Validation

`tsc` src/ clean · `cargo fmt --check` clean · JS 541 tests / 539 pass / 2 known
· nav-ia 28/28 · sidebar-polish 32/32 · design-token 12/12 · tauri-reg 5/5 ·
Gate 8 52/52 · design-system 20/20 · branding 5/5 · production build succeeded,
installed. Visual smoke at 1100×700 (dark): app launches, sidebar starts
expanded, navigation renders, main-content offset correct, meeting data intact.
User data **byte-identical**: sha256 `4911B87F…` unchanged, 51 meetings, 7627
transcripts, 0 audio files, no recording started.

# Phase A2 — Navigation Rebuild (sidebar, `/meetings`, `/notes`)

Rebuilt the sidebar as a small composition driven by the A1 primitives, moved the
meeting archive to a real destination, and made Meeting Notes a first-class page.
`frontend/src/components/Sidebar/index.tsx` went 1174 → ~365 lines.

## What shipped

- **Sidebar = `nav > header + nav + footer`.** The `nav` region is the *only*
  scrollable area; the footer is a non-shrinking sibling. Expanded and collapsed
  render the *same* `NAV_GROUPS` model two ways — there is no second list.
- **Archive removed** from the sidebar → real `/meetings`
  (`src/app/meetings/page.tsx`), chronological with TODAY / YESTERDAY / THIS WEEK /
  EARLIER buckets, driven by the provider's real meeting list.
- **`/notes` is real** (`src/app/notes/page.tsx`). The fake `SAMPLE_NOTES` payload
  is gone. It is a per-meeting index that deep-links into a meeting's Notes tab via
  `routes.meetingSection(id, 'notes')`; `MeetingWorkspace` reads `?tab=` on mount.
  No fake data, no placeholder rows.
- **Collapse control lives inside the panel** and carries `aria-expanded` +
  `aria-controls="recall-sidebar-navigation"`.
- **One recording action.** The duplicate "Record / New Meeting" row and the old
  opposite-polarity control are gone. Footer is Start Recording (primary) →
  Import Audio (secondary) → About (utility).
- **Identity:** expanded Recall wordmark is a bordered label, not a lime pill.
  Collapsed mark uses the same bordered container.
- Search is provider-owned (`searchQuery` / `setSearchQuery`, 250 ms debounce) and
  is shared by the sidebar field and the meetings list.

## Three real defects found by visual QA and fixed

1. **Nav overflowed its region** — `navScrollHeight 456` vs `navClientHeight 428`
   at 700 css px, clipping the Settings row. `SECTION_LABEL` carried `pt-5` (20px)
   on all three groups including the first. Fixed: `pt-3`, plus a new `flush` prop
   that drops the top padding on the first section in the scroll region.
2. **Horizontal scrollbar in the nav.** Rows are `w-full` *and* carried `mx-1`, so
   they overflowed the content box by 4px; `overflow-y-auto` forces the other axis
   to compute to `auto`, so a horizontal scrollbar appeared and cut the rounded
   right corners of active/hover rows. Fixed: horizontal inset moved to the nav
   (`px-1`) and `mx-1` dropped from the row — padding, not margin, is
   scrollbar-safe.
3. **The collapsed rail rendered no destinations at all.** The `isCollapsed`
   branch emitted one divider per group and *no rows*, so the rail looked tidy and
   navigated nowhere. The existing tests passed 31/31 because they only asserted
   that the rail *had* a collapsed presentation. Fixed to render each group's
   items as icon rows with tooltips, and `sidebar-polish.test.mjs` gained a
   regression guard (`the rail actually renders every destination, not only
   dividers`).

## Visual QA — the BitBlt recipe lies about layout

The screen-capture path (foreground → topmost → `BitBlt`) reported the footer and
Settings as *missing* at several window sizes. They were present the whole time.

**Cause:** after a programmatic resize the WebView2 surface keeps a stale paint
buffer, and a `SW_RESTORE` in the capture helper desynchronised the reported
viewport from the visible client area. Screenshots taken in that state show blank
sidebar below the last painted row — indistinguishable from a real layout bug.

**Reliable path (use this):** launch with
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`, then talk CDP
to the app's own WebView2 — still the real Tauri app, real backend, real data:

- `http://localhost:9222/json/list` — **`localhost`, not `127.0.0.1`**; the latter
  returns 404 for every path.
- `Page.captureScreenshot` returns the composited WebView surface, immune to the
  stale-buffer problem.
- `Runtime.evaluate` with `getBoundingClientRect()` / `scrollHeight` /
  `clientWidth` gives exact geometry. Prefer measuring over squinting at pixels.

Corollary: never conclude "the element is missing" from a BitBlt screenshot alone.
Confirm with `getBoundingClientRect()` first.

Helpers live outside the repo in
`%TEMP%/opencode/recall-visual-qa/` (`capture-cdp.ps1`, `overflow.ps1`,
`window placement`, pixel samplers). CDP also makes navigation deterministic —
`document.querySelector('a[href="/meetings"]').click()` on a real element instead
of synthetic typing or coordinate clicks. Note the collapse control has **no**
`aria-label`; its accessible name comes from `sr-only` text, so select it with
`button[aria-controls="recall-sidebar-navigation"]`.

## Validation

- `tsc` src/ clean.
- JS suite **543 tests / 541 pass / 2 known failures** — Phase 4 `checkPermissions`
  (pre-existing) and Bun-only `qa-routes`.
- Gates: nav-ia 30/30 · sidebar-polish 32/32 · Gate 8 52/52 · phase3 32/32 ·
  design-system 20/20 · design-token 12/12 · branding 5/5 · tauri-reg 5/5.
- Production build succeeded (MSI + NSIS), installed, verified in the real app.
- Visual: expanded (all 8 destinations, 3 labels, full footer, no scrollbars),
  collapsed (all 8 icon rows + dividers, active state), `/meetings`, `/notes`.
- Geometry at 1100×700: `navClientWidth == navScrollWidth == 255`,
  `navClientHeight == navScrollHeight == 475` — no overflow on either axis.
- User data **byte-identical**: sha256 `4911B87F823B6751576C15D96DE19B194B91B22AA121E859787B7BD3EB19BA51`,
  4,632,576 bytes, 51 meetings, 7627 transcripts, empty WAL. No recording started.

## Still open (not A2 scope)

- **The main content overflows the viewport by 48px** (`docScrollHeight 748` vs
  `docClientHeight 700`), so the whole page scrolls. It is `MAIN` / the home
  shell, not the sidebar. Pre-existing from A1; belongs to the Phase B
  workspace/page-shell pass.
- **`/notes` is visually indistinguishable from `/meetings`** — both list meetings
  by date. The DB has 0 note rows, so there is nothing to differentiate yet. A
  future phase should surface note presence/preview (e.g. "notes" affordance per
  meeting) so the two destinations earn their separate existence.
- **Collapsed logo mark is still a lime raster asset** (`/logo-collapsed.png`).
  The container now matches the expanded bordered treatment, but the asset itself
  is brand-owned and was deliberately left alone.
- Meeting search in the sidebar writes to the shared query but the meetings page
  has no explicit loading/error state yet.


# Phase B - Desktop layout foundation

Phase B fixed the application's **global layout foundation** (viewport ownership,
main-content geometry, scroll ownership, content width) without redesigning any
individual feature. It changes zero Rust source and zero database code.

## Root cause of the 748px document

Measured on the real Tauri app at 1100x700 via CDP, before the fix:

```
documentElement.scrollHeight 748   clientHeight 700
window.scrollTo(0, 400) -> window.scrollY === 48      (the document really scrolled)
```

Three compounding defects, none of which was "a page that is too tall":

1. **`html` had no height.** `globals.css` set `body { height: 100% }`, but with
   an auto-height root, `100%` resolved against *body's own content* (748), not
   the viewport. So `body`'s `overflow: hidden` clipped nothing, and the
   `documentElement` (whose `overflow` is `visible`) stayed scrollable.
2. **The shell row had no height.** `layout.tsx` rendered
   `<div className="flex">` around Sidebar + MainContent, so the row was
   content-driven rather than viewport-bounded.
3. **Every page claimed the viewport itself.** Nine page roots declared
   `h-screen` and the shell then added `py-6` *around* that already-full-height
   child: `700 (h-screen) + 24 + 24 = 748`. The gutter padding was being added to
   a child that had already consumed the whole viewport.

`MAIN` at 748 was not the culprit -- it was faithfully filling a container that
was 48px too tall to begin with.

## The fix

```
html            height: 100%                     <- definite root
body            overflow: hidden; height: 100%   <- intentional desktop clip
div.flex        flex h-dvh overflow-hidden       <- shell owns the viewport
  nav           position: fixed, h-dvh           <- no flow slot, as before
  main          min-h-0 min-w-0 flex-1 flex-col overflow-hidden
    gutter      flex min-h-0 flex-1 flex-col px-8 py-6     <- the ONLY gutter
      scroller  data-slot="page-scroll" min-h-0 flex-1 overflow-y-auto overflow-x-hidden
```

- **One viewport owner.** The shell is `h-dvh`; `overflow-hidden` there is an
  intentional clipping boundary, not a cover-up -- nothing inside it overflows now.
- **One scroll owner.** `MainContent` owns the single `page-scroll` region, and it
  is the only `overflow-y-auto` in the shell. Pages no longer install their own.
- **Page contract.** A page that fills the shell uses `h-full` (Home, Settings,
  Meeting Workspace, meeting-details). A page that flows simply grows and lets the
  shell scroller scroll (Meetings, Notes, Daily, Contexts, Calendar, context
  detail). Nine `h-screen` roots and six centred `h-screen` states were converted.
- **Gutters stay in one place.** `px-8 py-6` is still declared only in
  `MainContent`; no page invented its own.
- `overflow-x-hidden` on the page scroller is deliberate: the shell does not scroll
  sideways. A feature that genuinely needs horizontal scrolling must own its own
  container.
- The sidebar was switched from `h-screen` to `h-dvh` so the viewport vocabulary is
  single. `OnboardingContainer` keeps `max-h-screen` -- that is a ceiling on a
  centred dialog, not a viewport claim.

After: `scrollHeight === clientHeight` and `window.scrollTo(0,400)` leaves
`scrollY === 0` at **every** tested size.

## B3 horizontal geometry - measured, all clean

| client | hOverflow | vOverflow | document scrolls | sidebar | main |
|--------|-----------|-----------|------------------|---------|------|
| 1100x700 | 0 | 0 | no | 256 | 845 |
| 1280x720 | 0 | 0 | no | 256 | 1025 |
| 1366x768 | 0 | 0 | no | 256 | 1111 |
| 1600x900 | 0 | 0 | no | 256 | 1345 |
| 1920x1080 | 0 | 0 | no | 256 | 1665 |
| 2545x1400 | 0 | 0 | no | 256 | 2290 |

2560x1440 was requested; the host's physical display is 2560x1440, so a window of
that outer size cannot exist. The largest honest client is **2545x1400**, which is
what was measured. Sidebar width is a stable 256 at every size and comes from
`lib/sidebar-layout.ts` alone.

## B11 workspace tab strip

At 1100x700 all six tabs (Overview, Summary, Transcript, Tasks, Notes, Context)
sit at natural width, 12px type, none truncated. Below ~880px viewport the last tab
was **permanently unreachable**: the strip had `flex-shrink-0`, the header overflowed,
and the shell clipped it. Fixed with three cooperating changes:

- `TAB_TRIGGER_CLASS` gains `shrink-0 whitespace-nowrap` -- a tab label is the
  affordance and must never compress or wrap (verified: `truncated: false` on all
  six at every size tested).
- The identity block becomes `flex-1 min-w-0` so it yields before the strip does.
- `TabsList` becomes `max-w-full shrink-0 overflow-x-auto`, so it keeps its natural
  width when there is room and scrolls to its own content when there is not.

Measured: `fits` at 1000/1100/1366/1920; at 820x600 (below the new minimum) it
`scrolls` with 0 truncated labels. A `minWidth: 1000` / `minHeight: 640` was added
to `tauri.conf.json` so the shell is not asked to work below its design minimum.
Enforcement of that minimum by a user-driven resize drag was **not** independently
verified (a programmatic `MoveWindow` bypasses it); the layout does not depend on it.

## B7 lime accent retired as a generic hover

`accent` is Recall's brand lime. It was being used as the hover surface on 11
ordinary controls (rows, ghost/outline buttons, the workspace Home button, toolbar
buttons), which made the brand accent compete with the selected/active state --
exactly what `sidebar-polish.test.mjs` already forbade for `ListRow`. All 11 now use
the neutral `hover:bg-muted` / `hover:text-foreground` treatment.

This required **realigning one existing test deliberately**:
`phase5-transcript-integration.test.mjs` asserted
`cleanBtnGroup.includes('hover:bg-accent')`. Its protective intent was "use a
semantic hover token, never a hardcoded colour", so the assertion was tightened
rather than deleted: it now requires `hover:bg-muted` **and** forbids
`hover:bg-accent`. Recorded here because the instruction is to change such tests
deliberately and visibly, never silently.

## Encoding incident (self-inflicted, caught and fully reverted)

While applying the page-root edits, PowerShell `Get-Content -Raw` /
`[System.IO.File]::WriteAllText` round-tripped UTF-8 through the console code page
and corrupted every non-ASCII character in the files it rewrote -- em dashes became
`Aˢ�?`, and a repair script that treated legitimate `�` and `.` as mojibake then
damaged six files that were never meant to change.

Resolution, in order:
1. Preserved the work (`git diff` patch + safety tag `phase-b-wip-backup`).
2. Restored all 32 affected files to `HEAD` with explicit paths (not `checkout -- .`).
3. Re-applied every change through a **byte-safe** patcher that reads and writes via
   ISO-8859-1 (a byte<->codepoint bijection for 0..255) and auto-detects CRLF.
4. Added `audit-bytes.ps1`, which compares every maximal non-ASCII byte run in the
   working tree against `HEAD`. It now reports: *"all modified files preserve their
   non-ASCII bytes exactly"*.

**Standing rule for this repo: never edit a source file from PowerShell text
cmdlets.** Use the editor tools, or the Latin-1 byte-safe patcher, and re-run
`audit-bytes.ps1` afterwards. Comment text added by these scripts is deliberately
ASCII-only.

## Tests

- `frontend/tests/lib/layout-foundation.test.mjs` (new, 16 assertions) guards the
  contract rather than exact syntax: definite root height, body clipping, shell
  `h-dvh`, `main` bounded with `min-h-0`/`overflow-hidden`, exactly one page
  scroller, single gutter declaration, no page claiming `h-screen` (only the fixed
  sidebar and the standalone onboarding flow may), fill pages use `h-full`, flowing
  pages install no scroller, sidebar independence, tab strip shrinks/scrolls with all
  six sections declared, window minimum size, and no `hover:bg-accent` anywhere.
- Full JS suite **559 tests / 557 pass / 2 known failures** (Phase 4
  `checkPermissions`, Bun-only `qa-routes`). Layout foundation 16/16.
- Regression gates unchanged: Phase 5 172/172, Gate 8 52/52, design-system 20/20,
  design-token 12/12, nav-ia 30/30, sidebar-polish 32/32, phase3 32/32, branding
  5/5, tauri-reg 5/5.
- `tsc` src clean. `cargo test --workspace`: 348 + 2 + 1 passed, 0 failed.
- User data **byte-identical**: sha256 `4911B87F...`, 4,632,576 bytes, empty WAL,
  0 audio files, no recording started, no meeting created or modified.

## Visual QA (CDP, the authoritative method)

36 captures in `%TEMP%/opencode/phaseB/`: Home, Settings and Meeting Workspace at
1100x700, 1280x720, 1366x768, 1600x900, 1920x1080 and 2545x1400, in **both** light
and dark. Theme was switched by writing `localStorage['recall-theme']` and
reloading -- toggling the `dark` class alone does **not** work, because
`ThemeProvider` owns the state and re-applies it on re-render. (An earlier light
capture set was dark for exactly this reason and was discarded and retaken.)

Measured on the real app, not inferred: zero horizontal overflow, zero vertical
document overflow, `documentScrolls: false`, and a clean `navigator`-free a11y
probe (one `h1`, skip link present, `main` + `nav[Primary]` landmarks, no
icon-only control without an accessible name, no raw palette classes on Home).

## Found, documented, NOT fixed (out of Phase B scope)

- **CSP blocks every Tauri IPC call.** The console shows
  `IPC custom protocol failed, Tauri will now use the postMessage interface` and
  then ~15 `http://ipc.localhost/... violates Content Security Policy` errors.
  `connect-src` in `tauri.conf.json` lists `'self'` and three `localhost` provider
  ports but not `ipc.localhost`. The app still works because Tauri falls back to
  postMessage, so this is noisy rather than fatal -- but it is a real
  configuration defect and Agent Forge's "fix console errors before release" rule
  applies to it. Pre-existing: Phase B's only `tauri.conf.json` change is
  `minWidth`/`minHeight`. Belongs to a Tauri-config pass, not a layout pass.
- **16 pre-existing `transition-all`** usages (`Block.tsx`, `tabs.tsx`,
  `progress.tsx`, `PermissionRow`, the download progress components,
  `RetranscribeDialog`). Phase B added none; rewriting the motion system is
  explicitly out of scope.
- **133 raw-palette classes** remain across `app/` + `components/`
  (`ChunkProgressDisplay` 21, `Calendar/index` 14, `ModelDownloadProgress` 9, ...).
  A global palette migration is explicitly out of scope. Home and Settings measure
  clean.
- **Double gutters on some pages.** The shell provides `px-8 py-6`, and Home adds
  `max-w-[1080px] px-8 py-8` and Settings adds `max-w-6xl px-8 py-6` on top, so
  those two screens carry 56-64px side gutters instead of 32px. Harmless for
  overflow, but it is the "each screen invents its own geometry" problem Phase B4
  was meant to address; resolving it means per-screen padding decisions, which is
  a content-width pass rather than a layout-foundation pass.
- **`/notes` still looks like `/meetings`** (carried over from A2) and the meetings
  page still has no explicit loading/error state.
- **Collapsed logo is still a lime raster asset** (`/logo-collapsed.png`).
- At 1920x1080 and above, Home's `max-w-[1080px]` column leaves a large empty band
  on wide monitors. That is a content-density decision, not a layout defect.


# Phase C - Page composition, visual hierarchy, desktop polish

Phase C improved the *composition* of the screens Phase B established geometry
for. It changes zero Rust source, zero backend behaviour, zero database code, and
performs no global design-system, card, colour or radius migration.

## C1 - Gutter ownership: one model

Phase B found the duplication: the shell supplies `px-8 py-6` in `MainContent`,
and Home (`max-w-[1080px] mx-auto px-8 py-8 pb-12`) and Settings
(`max-w-6xl mx-auto px-8 py-6` / `max-w-6xl mx-auto p-8 pt-6`) each added their
own on top. Home and Settings were therefore inset 56-64px while Meetings was
inset 32px, and both were `mx-auto` centred, so their content edges did not line
up with anything.

**The model chosen:**

```
shell owns the gutter   ->  MainContent: px-8 py-6   (the only declaration)
page owns its measure   ->  max-w-* only: no px-*, no py-*, no mx-auto
```

Pages are left-aligned, not centred, on purpose: a centred page drifts away from
the shared left edge as its measure changes, which was the inconsistency Phase C
set out to remove. Measured after the change, the content left gutter is **288px on
every screen** (256px sidebar + 32px shell gutter) at all four tested widths.

## C2 - Content width matched to content type

Not one universal max-width:

| Screen | Measure | Why |
|---|---|---|
| Home | `max-w-6xl` (1152) | three-column dashboard grid needs the room |
| Meetings | `max-w-4xl` (896) | an archive row is title + date + time |
| Notes | `max-w-3xl` (768) | a per-meeting destination, not a scanning surface |
| Settings | `max-w-6xl` | forms and tab strips |
| Workspace | full available width | it is the work surface |

A first attempt used `max-w-5xl` on Meetings and a full-width-feeling `max-w-4xl`
with the time far to the right; the CDP screenshot showed a large dead gap between
a short title and its time, so the measure and the row shape were fixed together.

## C3/C14 - Page header system and typography

`PageHeader` gained a `meta` slot for compact factual metadata, which is the right
home for "51 meetings" -- useful and scannable, unlike a sentence. Descriptions
became genuinely opt-in: Meetings' "Every meeting Recall has recorded, newest first."
was removed because it restated the title and the obvious sort order (this was the
"unnecessary text" complaint). Notes keeps a description because notes living
*inside a meeting* is the one non-obvious fact about that screen.

`EmptyState` gained `tone="error"` so a failure cannot be mistaken for an empty
list, and a new `ListSkeleton` provides a quiet, announced loading placeholder.

Measured typography on the real DOM after the change:

- Meetings: 4 sizes (24 page title, 14 body, 12 caption, one 13px) and 4 weights,
  154 of 161 text nodes at weight 400. Not an all-bold interface.
- Home: 3 sizes (20 hero, 14, 12), 4 weights.
- Zero raw palette classes on all three.

## C4/C5 - Meetings became a real archive, and an honest one

Before: rows were ~96px tall (title, then a redundant full-date line under each
one), a description restating the title, and no count.

After, verified in the installed app at 1920x1080: one line per meeting, title
truncating on the left with date and time together on the right, a second line
only when a transcript snippet actually matched. 20+ meetings are visible on one
screen instead of ~8.

**The honesty fix is the important one.** `SidebarProvider.fetchMeetings` caught a
failed `api_get_meetings` and called `setMeetings([])`, which made a broken load
indistinguishable from "you have no meetings". The provider now records
`isMeetingsLoading` and `meetingsError` (and no longer wipes the list on failure);
the page renders a skeleton while loading, and on failure an inline error with a
**Retry** action wired to the pre-existing `refetchMeetings`. The empty state is
gated on `!meetingsError && !isMeetingsLoading && !hasArchive` so it can never
appear as a lie.

## C6 - Notes is no longer a clone of Meetings

The two screens had the same title treatment, the same date grouping, the same row
shape and the same trailing date. Notes is now differentiated by information
architecture: a narrower measure, rows that name their destination
("Notes >") instead of repeating a date the list is already grouped by, and a
header that explains the per-meeting model.

**Deliberately not done:** a "has notes" indicator. Note presence lives in
`meeting_notes` and there is no read-only query for it, so the screen cannot know
which meetings have notes. Adding one is a backend change, which Phase C forbids.
Rather than fake it, the screen states the truth -- "No meeting has notes written
yet" -- which is accurate: the database holds zero note rows. The existing
`refetchMeetings` was reused rather than adding a parallel `retryMeetings` to the
context API.

## C9/C10 - Button and icon discipline

- Meetings has **no** recording button. A2 established exactly one recording
  action application-wide, in the sidebar footer, and the archive does not
  reintroduce a second one.
- Its single header action is a secondary `outline` button, text only. A calendar
  icon beside the word "Calendar" is redundant, so it was removed; the visible
  label stays short while `aria-label="Open Calendar"` keeps the accessible name
  descriptive. This is the visible-text / accessible-text distinction C3 calls for.
- Measured on the real DOM: Meetings and Notes render **0 filled (competing
  primary) controls** and **0 icon-only controls without an accessible name**.

## C11/C12/C13 - Borders, hover, spacing

- Bordered elements containing text, measured on the real DOM: Meetings 1, Notes 1,
  Home 12. The archive is no longer a stack of bordered boxes.
- Phase B already retired `hover:bg-accent`; Phase C added none, and added no
  `transition-all` (asserted by the new tests).
- Section rhythm inside the archive is `gap-8` between date groups, `mb-1.5` under
  a group heading, and `min-h-9` rows -- existing Tailwind steps only.

## C16 - Light and dark

Both themes captured for all five screens at four widths. Light mode shows the warm
off-white `--background` with neutral borders, no raw white, no raw gray, and the
active nav row uses the muted surface plus the primary indicator. No
theme-specific fix was required; both modes pass on measurement and on inspection.

## C19 - Visual QA (CDP only)

40 screenshots in `%TEMP%/opencode/phaseC/` plus before/after pairs. Measured per
screen, per viewport, per theme -- not inferred from source:

| viewport | hOverflow | vOverflow | document scrolls | overflowers |
|---|---|---|---|---|
| 1100x700 | 0 | 0 | no | none |
| 1366x768 | 0 | 0 | no | none |
| 1920x1080 | 0 | 0 | no | none |
| 2545x1400 | 0 | 0 | no | none |

Identical for Home, Meetings, Notes, Settings and the Meeting Workspace, in both
themes. 2545x1400 remains the largest honest client because the host's physical
display is 2560x1440.

## C21 - Tests

Three new suites, 34 assertions, all structural rather than syntax-matching:

- `page-composition.test.mjs` (11) -- the shell still owns the gutter; no page
  re-declares padding or centres itself; every page declares a measure and the
  measures are differentiated; the header exposes `meta`, exactly one `h1`, an
  error tone and an announced skeleton; no raw palette and no `transition-all`.
- `meetings-page.test.mjs` (13) -- real provider path, no second data path, no mock
  dataset, chronological buckets, loading/error/Retry, the empty state gated on
  success, the provider not collapsing failure to an empty list, one-line rows with
  metadata on the row, rows not becoming cards, no second recording control, the
  header action stays secondary, accessible name fuller than the visible label.
- `notes-page.test.mjs` (10) -- a measure different from Meetings, rows that name
  their destination, no duplicated header copy, honest "no notes yet" semantics, no
  faked presence indicator, no invented content, deep-link into the real notes tab,
  no second editor or persistence path, loading/error handled.

All three strip comments before scanning, because these files *document* the rules
they follow ("there is no local fixture", "deliberately has no Start Recording
button") and a naive text search flagged that prose as a violation.

Regression gates unchanged: **593 tests / 591 pass / 2 known failures** (Phase 4
`checkPermissions`, Bun-only `qa-routes`). Phase 5 aggregate 172/172, Gate 8 52/52,
design-system 20/20, design-token 12/12, nav-ia 30/30, sidebar-polish 32/32,
phase3 32/32, layout-foundation 16/16, branding 5/5, tauri-reg 5/5.
`cargo test --workspace`: 348 + 2 + 1 passed, 0 failed. `tsc` src clean.

## C22 - Data integrity

Byte-identical before and after: sha256 `4911B87F...`, 4,632,576 bytes, WAL 0,
audio 0. No recording, no meeting created or modified, no note edited, no
transcript altered. Opening meetings for screenshots is read-only and was the only
database interaction.

## C23 - Encoding safety

Every file edit in Phase C went through the ISO-8859-1 byte-safe patcher or the
editor tool, never a PowerShell text cmdlet. `audit-bytes.ps1` reports drift on
exactly two files -- `meetings/page.tsx` and `notes/page.tsx` -- and both are the
intentional full rewrites, which replaced em dashes and an ellipsis with ASCII.
Every other file preserves its non-ASCII bytes exactly, and a mojibake sweep
(`�?`, `â`, U+FFFD) across `frontend/src` returns nothing. The em dash in
"System audio is optional - mic-only recording" and the bullet in "0 Meetings -
Updated" were confirmed intact on the rendered page.

## Found, documented, NOT fixed (out of Phase C scope)

- **CSP blocks every Tauri IPC call** (carried from Phase B). ~15
  `http://ipc.localhost/...` violations; `connect-src` omits `ipc.localhost`.
  Functional via the postMessage fallback, but Agent Forge's "fix console errors
  before release" rule applies. Phase C did not touch `tauri.conf.json`.
- **Home renders two filled primaries**: "Start Recording" in the hero and
  "Generate Daily Brief" in its card. They sit in separate regions and each is
  primary within its own context, which is defensible, but a strict reading of C9
  ("one obvious primary action") would demote one. Changing it is a product
  decision about Home's hero, not a composition fix, so it is flagged rather than
  made. The hero CTA is also a second recording control outside the sidebar footer
  that A2 standardised on -- worth a product decision.
- **Home has 12 bordered elements** containing text. As a dashboard of distinct
  panels the borders are structural rather than decorative, but it is the densest
  border usage in the app and a candidate for the card pass.
- **Home does not use `PageHeader`**: its hero is its header, and its `h1` is
  `text-xl` (20px) rather than the 24px `text-page-title` the other screens use.
  Intentional-looking, but it means Home is outside the page-header system.
- **Workspace panel padding** (`p-6`) still stacks on the shell's `py-6`, giving
  48px of vertical inset inside the workspace. The workspace's information
  architecture is explicitly out of Phase C scope, and the visible result reads
  correctly, so this was left alone.
- **133 raw-palette classes** and **16 `transition-all`** usages remain elsewhere in
  the app. The screens Phase C owns measure clean; a global migration is Phase D+.
- **No note-presence query exists**, so Notes cannot show which meetings have
  notes. This needs a read-only Tauri command, which is a backend change.

# Next Exact Step

1. Gates 1 through 8 complete. Phase 0 `a3c196b`, A1 `5df672a`, A2 `4a89d1f`,
   Phase B `a5104fc`, and **Phase C (page composition) is complete**. The gutter
   model is now: the shell owns `px-8 py-6`; a page owns only its measure, never
   its own padding and never `mx-auto`, so every screen starts on the same 288px
   left edge. Meetings is a dense one-line archive with real loading/error/Retry,
   and Notes is differentiated from it by information architecture rather than by
   inventing note content.
2. **Phase D is next** and owns exactly what Phase C deliberately left: the 133
   raw-palette classes, the 16 `transition-all` usages, the border/card audit
   (Home carries 12 bordered text elements), and the two-filled-primary question on
   Home. Do not change the radius scale.
3. Two product decisions are waiting on the user, not on engineering: whether
   Home's hero keeps its own Start Recording CTA given A2 standardised on a single
   recording action, and whether Generate Daily Brief should be demoted so Home
   has one primary action.
4. A read-only Tauri command for note presence would let /notes show which meetings
   actually have notes. That is a backend addition, deliberately out of Phase C.
5. The Tauri CSP defect persists: `connect-src` omits `ipc.localhost`, so every
   IPC call logs a violation before falling back to postMessage. Unchanged in
   Phase C. Fix it in a config pass; the app is functional meanwhile.
6. Visual QA must use the CDP path. Two traps: the BitBlt screen-capture recipe
   reports false "element is missing" results after a programmatic resize, and
   toggling the `dark` class does not change theme because `ThemeProvider` owns
   the state. Write `localStorage["recall-theme"]` and reload instead.
7. **Never edit a source file from PowerShell text cmdlets.** They corrupt UTF-8
   through the console code page. Use the editor tools or the Latin-1 byte-safe
   patcher, then run `audit-bytes.ps1`. Comment text added by those scripts is
   deliberately ASCII-only.
8. After Gate 9: final verification → push `phase/5-meeting-workspace-provenance` → await review/approval → fast-forward main.
9. Before release: human GUI QA of the Gate 8 dialog/state changes, Bun suites on a Bun-capable host, Parakeet/ffmpeg host migration, and the `com.meetily.ai` data migration.

# Blockers

- **Automated visual QA WORKS** — see "Visual QA — WORKING" above for the verified
  recipe. This is no longer a blocker. Residual limitation: printable text and
  arrow keys do not reach WebView2 synthetically, so navigating to a *specific*
  meeting, switching workspace tabs, or toggling the theme still needs a human
  or a non-coordinate input path. Do not fall back to coordinate clicks.
- **`meeting_intelligence` is empty (0/51 meetings) and `meeting_notes` is empty
  (0 rows).** Correct UI now reports "No Intelligence Generated" with a
  generation path. Populating them requires a configured summary provider and
  would write to the user database — do not do that unprompted.
- Native GUI / Windows recording QA NOT PERFORMED (Windows CLI host only; `cargo build` is build verification, NOT GUI workflow QA).
- macOS recording QA NOT AVAILABLE.
- Bun-only test suites cannot run on this machine (NOT AVAILABLE).
- Phase 4 test `checkPermissions` mount effect fails (pre-existing; documented in Phase 4 report).
- `cargo clippy -D warnings` fails on 2 PRE-EXISTING lints in the unmodified `src-tauri/build/ffmpeg.rs` (unused `std::io::Read` import; `Iterator::last` on a `DoubleEndedIterator`). This blocks clippy before it reaches the lib target, so `--all-targets` and `--lib` both abort. Unrelated to the UI tranche, which changes zero Rust files.
- `frontend/build-gpu.bat` hardcodes Windows SDK `10.0.22621.0` while this host has `10.0.26100.0`, producing `LNK1181: cannot open input file 'kernel32.lib'`. Use the manual CUDA path (cargo + LLVM + CUDA on PATH, `TAURI_GPU_FEATURE=cuda`). The script was intentionally NOT modified.