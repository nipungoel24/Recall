# Recall Product Polish Audit

**Date:** 2026-08-18 · Method: live Tauri app inspection (DOM text/structure per
page, real data), plus source review of user-facing copy.

## CRITICAL

- None remaining. The static-export routing crash (`/context/[id]`) was fixed
  in the previous phase and is re-verified (runtime-created Context opens,
  reloads, and degrades gracefully).

## HIGH VALUE

1. **Context continuity is not explained.** The Context detail shows "Current
   State" without telling users WHY memory exists or what it affects. →
   Add one-line explanatory copy: future meetings in this Context get this
   knowledge as background for their summaries.
2. **Meeting-details top bar lacks WHEN.** It shows the title but not the
   meeting date/time, so "which meeting is this" is only partially answered.
   → Add date · time metadata to the top bar.
3. **Calendar agenda repeats the empty message.** The day panel subtitle says
   "No meetings on this day." directly above the empty state that says the
   same thing. → Show the subtitle only when meetings exist.
4. **Context memory provenance lacks a date.** Items show a source title but
   not when the knowledge was captured. → Append a short date to the source
   affordance.
5. **Template editor does not explain what a section controls.** →
   Add helper copy: each section becomes a heading in the generated summary.

## MEDIUM

6. Notes pages remain unlisted legacy demo content (`/notes?id=`) — no list
   experience exists; documented, not changed.
7. A meeting summary accepts ONE Context at a time (`contextId`), even when a
   meeting belongs to several Contexts. Simplest safe policy; needs a
   documented note (done in CURRENT STATE + backlog).
8. Legacy ESLint debt on pre-existing lines (not user-visible).

## NICE TO HAVE

9. Template structure preview pane (section editor already shows the
   structure; a visual "summary skeleton" preview could come later).
10. "Use as default" template setting (currently the per-meeting picker always
    defaults to `standard_meeting`).
11. Context memory rebuild action (requires backend support; deferred).
12. Calendar meeting-count tooltip listing meeting titles for a day.

## Verified-good (no action)

- Home dashboard: purpose, primary action, and all five sections are obvious;
  lightweight IPC (no transcripts/N+1/Ollama).
- Calendar: two-pane, today/selected states, keyboard nav, meeting metadata,
  Daily transition — excellent.
- Daily: date heading, count · duration, timeline, brief CTA — strong.
- Contexts list: purpose copy, counts, last-activity — clear.
- Templates: Built-in vs My Templates separation with badges and actions —
  clear, no JSON required for the default flow.
- Settings: standard sections, storage locations, no dev-facing labels.
- Terminology: "Context", "Daily Brief", "Templates" used consistently in
  user-facing copy; "Project Phoenix" appears only as an input placeholder
  example (appropriate).
- Daily Brief template (`templates/daily_brief.json`) already matches the
  desired structure: Overview, Decisions, Action Items, Open Questions,
  Risks/Blockers, Cross-Meeting Themes, Follow-ups, Meeting Digest.
