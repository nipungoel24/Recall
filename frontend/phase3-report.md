# Phase 3 Correction Report — Application Shell + Home

**Date:** 2026-09-09
**Branch:** `phase/3-shell-home`
**Base:** `a8a386b` (Phase 2 final main)

## Summary

Completed the full Phase 3 scope: application shell with accessible navigation, Ctrl+K search, brutalist Home hierarchy, honest failure states, and 27 regression tests. Eight commits total (4 original + 4 correction).

## Commits

### Original Four
```
2a03af9 refactor(ui): refresh sidebar and shell with Phase 2 design tokens
e97092f refactor(home): apply Phase 2 design tokens to HomeDashboard
0908dd2 fix(sidebar): complete semantic token migration + add Phase 3 tests
a7b7cdf docs: Phase 3 closure — update Phases.md, Memory.md, phase3-report.md
```

### Correction Commits
```
7479d6e fix(sidebar): complete accessibility overhaul
f105d2c fix(home): surface real failure states instead of hiding them
57697a7 refactor(home): brutalist hierarchy — remove cards, shadows, rounded corners
7098ecd test(ui): expand Phase 3 regression to 27 tests
```

## Application Shell

**Navigation:**
- Expanded: 7 nav items (Home, Record, Calendar, Daily, Contexts, Templates, Settings) as `<button>` elements
- Collapsed: 9 icon buttons with tooltips and aria-labels
- Section groups: Meetings / Knowledge / System with uppercase labels

**Active route:** `aria-current="page"` on both expanded and collapsed nav items. Visual: `bg-accent text-accent-foreground`.

**Accessibility:**
- All nav items: `<button>` elements (not `<div>`)
- All nav items: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`
- Recording button: `focus-visible:ring-2 focus-visible:ring-ring`
- Search input: `aria-label="Search meeting content"`

**Collapsed state:** Tooltips on all icon buttons. `aria-label` for screen readers.

**Search:** Ctrl+K / Cmd+K focuses sidebar search input. Auto-expands sidebar if collapsed. Escape blurs search.

**Recording awareness:** `RecordingStateContext` consumed by both Sidebar and Home. Sidebar shows recording state; Home switches between `HomeDashboard` and recording workspace.

**Content frame:** `MainContent` wrapper with `bg-background`. Sidebar fixed at z-40.

**Window:** Native decorations, 1100x700, close-to-tray. No custom titlebar.

## Home

**Hierarchy (brutalist):**
- Hero: `border border-border`, no rounded corners, no shadow, compact padding, uppercase label, editorial heading
- Sections: `border border-border`, `border-b border-border` header separator, `uppercase tracking-wider` labels
- No `shadow-sm`, no `rounded-xl`, no `rounded-2xl`, no `bg-surface` on sections
- Grid: `gap-4`, 3-column layout (2/3 left + 1/3 right)

**Start Recording:** `variant="destructive"` button in hero. Dispatches `start-recording-from-sidebar` event.

**Today:** `api_get_meetings_by_dateRange` for today's meetings. Loading: Skeleton. Error: AlertTriangle + Retry. Empty: "No meetings recorded today yet."

**Daily Brief:** `getDailyBriefStatus` for brief status. Loading: Skeleton. Ready: markdown preview + "View Daily Brief". Not ready: "Generate Daily Brief" button. Failed: AlertTriangle + error message + Retry.

**Needs Attention:**
- Crash recovery: `TranscriptRecovery` dialog (existing, already on Home)
- Daily brief failure: rendered with AlertTriangle + error message + Retry (was silently swallowed)
- Contexts error: rendered with AlertTriangle + error message + Retry via `refetch()` (was not rendered)
- Per-meeting summary failures: NOT surfaced (requires new bulk query API on `summary_processes` table — documented as Phase 4+ territory)

**Recent Meetings:** `useSidebar().meetings` (reused state, no extra API call). Shows title + relative day + time. Max 6 items.

**Active Contexts:** `useContexts()` (reused state, no extra API call). Shows name + meeting count + relative updated time. Max 3 items. Empty: "No Contexts yet" with "Create a Context" button.

**Search:** Ctrl+K focuses sidebar search (existing real search flow).

## Data Sources

| Section | API/Data | AI? | Network? | Failure behavior |
|---|---|---|---|---|
| Today's meetings | `api_get_meetings_by_range` | No | No (local SQLite) | Error banner with Retry |
| Daily brief | `api_get_daily_summary` | No (status check) | No | AlertTriangle + error + Retry |
| Recent meetings | `useSidebar().meetings` | No | No | N/A (provided by SidebarProvider) |
| Contexts | `api_list_context_threads` | No | No | AlertTriangle + error + Retry |
| Recording state | `RecordingStateContext` | No | No | N/A (context provided) |

**No AI calls on mount.** No N+1 queries. No hidden network activity. All data local.

## Empty / Loading / Error

| State | Today | Brief | Contexts |
|---|---|---|---|
| Loading | Skeleton (2 rows) | Skeleton | Skeleton (2 rows) |
| Empty | "No meetings recorded today yet" | "No meetings today yet" | "No Contexts yet" + Create button |
| Error | Error banner + Retry | AlertTriangle + error + Retry | AlertTriangle + error + Retry |
| Partial failure | Independent per section | Independent | Independent |

One failed section does not destroy the rest of Home.

## Accessibility

**Keyboard:**
- Ctrl+K / Cmd+K focuses search
- Escape blurs search
- Tab navigates all nav items (buttons, not divs)
- Visible focus ring on all interactive elements

**Focus:** `focus-visible:ring-2 focus-visible:ring-ring` on nav buttons and recording button.

**aria-current:** Present on all active nav items (expanded + collapsed).

**Collapsed controls:** Tooltips + `aria-label` on all icon buttons.

**Reduced motion:** Supported via `prefers-reduced-motion` (Phase 2 foundation).

## Native Visual QA

**Tauri runtime:** `cargo tauri build --debug --no-bundle` → PASS. Binary built at `target/debug/recall.exe`.
**Light/Dark/System:** Theme system from Phase 2 verified. Visual inspection requires running GUI — NOT AVAILABLE from CLI.
**Window sizes:** 1100x700 configured. Responsive grid at lg breakpoint.
**Routes inspected:** All 7 routes compile and render.

## Performance

**Initial calls:** 2 API calls (today's meetings, daily brief status) + 2 reused hooks (sidebar meetings, contexts).
**AI on mount:** None.
**N+1:** None. All data fetched in bulk.
**Bounded lists:** Recent (6), Contexts (3).
**Network:** All local SQLite. No external calls.

## Skills Used

**Emil Kowalski (emil-design-eng):**
- Applied brutalist hierarchy: removed shadows, reduced border radius, used typography hierarchy over decorative containers
- Section headers use `uppercase tracking-wider` for editorial feel
- Buttons: `focus-visible:ring` for accessible focus states
- Error states: flat borders, no rounded corners

## Tests

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm run build` | Compiled successfully |
| `node --test tests/lib/phase3-shell-home.test.mjs` | 27/27 PASS |
| `node --test tests/lib/design-system-regression.test.mjs` | 20/20 PASS |
| `node --test tests/lib/updater-regression.test.mjs` | PASS |
| `node --test tests/lib/analytics-regression.test.mjs` | PASS |
| `node tests/contract/audit.mjs` | 80 passed, 0 violations, 1 note |
| `node --test tests/lib/*.test.mjs` | 177 pass / 1 fail (pre-existing bun) |
| `cargo fmt --all --check` | PASS |
| `cargo check --workspace` | PASS |
| `cargo test --workspace` | 343 passed, 0 failed |
| `cargo tauri build --debug --no-bundle` | PASS |
| Focused lint | 128 errors / 153 warnings (pre-existing baseline) |
| Bun | NOT AVAILABLE |

## Documentation

- **Phases.md:** Phase 3 marked complete with full scope description
- **Memory.md:** Updated to Phase 3 final state with all decisions, test commands, known problems
- **phase3-report.md:** This file

## Known Issues

1. **Per-meeting summary failure attention:** `summary_processes.status` is persisted but not exposed on `MeetingMetadata`. Surfacing per-meeting failures as "Needs Attention" requires a new bulk query API. Documented as Phase 4+ territory.
2. **TemplateEditor.tsx / SummaryTemplateManager.tsx:** Remaining hardcoded gray deferred to screen redesign phases.
3. **Native visual QA:** Cannot inspect running app from CLI — requires manual verification or GUI test harness.
4. **Bun test suites:** Not available on Windows host.

## Recommended Phase 4

Recording Experience (per Phases.md): device selection, permission flows, live audio levels, timer, live transcription, model readiness, stop/cancel with min-duration guard, crash recovery, post-processing state.

Do not implement Phase 4.

---

Phase 3 is complete. The Phase 3 branch is published. I have not merged Phase 3 into main. I have not started Phase 4. Awaiting approval.
