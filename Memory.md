# Memory.md

Concise, factual working memory. Updated after every completed task, major decision, and before ending a session.

# Current State

- Current phase: Phase 5 — Meeting Workspace + Provenance (Gates 1-8 complete; design-system remediation landed `4e6d081`; Gate 9 still pending)
- Branch: `phase/5-meeting-workspace-provenance` (9 commits ahead of origin, NOT PUSHED)
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

## Visual QA — WORKING (recipe corrected in `a3c196b` session)

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

# Next Exact Step

1. Gates 1 through 8 complete. Phase 0 (meeting intelligence) landed `a3c196b`.
2. **Phase A — navigation refoundation** (approved, not started):
   `isCollapsed` default `false`; remove the sidebar archive into a new
   `/meetings` destination; make `/notes` reachable; move the collapse control
   *inside* the sidebar surface; one recording action (drop "Record / New
   Meeting"); keep About as a footer utility; canonical `lib/nav.ts`;
   `ui/list-row.tsx`; `ui/nav-section.tsx`; footer Primary/Secondary/Utility;
   single sidebar-width source of truth; fix sidebar overflow at 737px height.
   Guard: `tests/lib/nav-ia.test.mjs`. `sidebar-polish.test.mjs` currently
   asserts "meeting history is the only independently scrollable region" — that
   encodes the OLD IA and must be changed **deliberately and documented**, not
   silently deleted.
3. Then Phase B (workspace header/tabs/states), Phase C (design system),
   Phase D (interaction), Phase E (secondary screens), Phase F (visual QA).
4. After Gate 9: final verification → push `phase/5-meeting-workspace-provenance` → await review/approval → fast-forward main.
5. Before release: human GUI QA of the Gate 8 dialog/state changes, Bun suites on a Bun-capable host, Parakeet/ffmpeg host migration, and the `com.meetily.ai` data migration.

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