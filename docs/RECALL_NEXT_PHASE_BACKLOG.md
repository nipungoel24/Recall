# Recall — Next Phase Backlog

Prioritized candidate investments. NOT implemented in this phase. Evaluate
each on real user need before starting.

## P0 (only if evidence appears)

- Any regression in recording/transcription or the verified green gates.

## P1 (high product value, moderate effort)

- **"Use as default" summary template** — persist a preferred template so the
  per-meeting picker defaults to it (currently always `standard_meeting`).
- **Multi-Context summary support** — today one summary generation accepts one
  Context at a time; consider composing the compact memory of all linked
  Contexts (carefully bounded) or making the choice explicit per generation.
- **Context memory rebuild** — a "Rebuild Context Memory" action that
  re-extracts memory from the Context's meeting summaries; requires a safe
  backend flow and explicit confirmation (memory is derived data).
- **Template structure preview** — show a skeleton of the resulting summary
  (section headings + placeholder bullets) in the template manager/editor; no
  LLM calls.
- **Daily Brief export** — copy/save the Brief as Markdown/PDF.
- **Notes integration** — replace legacy demo `/notes` with real per-meeting
  notes from `meeting_notes` (list + detail + link from meeting-details).

## P2 (targeted enhancements)

- **Calendar day tooltip** — hovering a day lists that day's meeting titles.
- **Meeting search improvements** — lighter metadata search for
  "today/yesterday/this week" scopes; keep current debounced backend search.
- **Recurring meeting recognition** — detect weekly/daily patterns and offer
  to group them into a Context.
- **Long-meeting processing** — chunking progress indicators and partial
  summaries for very long recordings.
- **Speaker diarization** — leverage existing `speaker` field + system/mic
  separation for better attribution.

## LATER (deliberately deferred)

- **Local semantic search** — could use a small local embedding model later;
  explicitly NOT now (no vector DB in the current architecture).
- Calendar integrations (external calendars) — significant scope.
- Notification/reminder features beyond current recording notifications.
- Advanced analytics dashboards — Recall is a meeting tool, not a BI tool.
- Context export/import (share a Context between machines).
