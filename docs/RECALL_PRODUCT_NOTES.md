# Recall — Product & Privacy Notes

## What each screen is for

- **Home** — "where do I go next?": Start Recording, today's meetings, Daily
  Brief opportunity, recent meetings, recent Contexts.
- **Record / New Meeting** — captures microphone (and optionally system)
  audio, transcribes live, saves a meeting when you stop.
- **Calendar** — answers "when did I meet?": months, meeting days, day agenda.
- **Daily** — answers "what happened that day?": chronological timeline of one
  day's meetings + the Daily Brief.
- **Contexts** — project memory: group related meetings; durable decisions,
  actions and open questions carry over into future summaries in that Context.
- **Templates** — how summaries are structured: built-in (read-only,
  duplicatable) and your custom templates.
- **Settings** — models/providers, transcription, recordings, notifications,
  storage locations.

## Custom Templates

Templates control the section structure of generated meeting summaries. Built-in
templates cannot be edited or deleted (you can duplicate one and edit the copy).
Create a template from Settings → Templates → New Template: give it an id
(lowercase, e.g. `weekly_review`), a name, and sections — each section becomes
a heading in the generated summary, and its instruction tells the AI what to
extract there.

## Calendar vs Daily

- **Calendar** = meetings grouped by month/day (metadata only: title, time,
  duration). Pick a day to see its meetings, or use "Open Daily View".
- **Daily** = one day as a chronological timeline, plus the Daily Brief that
  synthesizes that day's meetings into one report. The Brief is a DERIVED
  artifact: regenerating it never changes the source meetings.

## Contexts & Continuous Context

A Context is a thread of related meetings (a project, client, initiative).
After each meeting in a Context is summarized, Recall extracts durable
knowledge — decisions, actions, open questions, facts — into the Context's
memory. When you summarize a LATER meeting in the same Context, that compact
memory is included as background (the current meeting is always primary).
Memory is bounded (small item budget), deduplicated, and every item keeps a
link back to its source meeting.

Policy notes:

- A meeting may belong to several Contexts; each Context's memory stays fully
  isolated — summarizing a meeting with Context A never receives Context B's
  memory.
- A single meeting summary accepts ONE Context at a time (chosen in the
  summary panel); a meeting in multiple Contexts is summarized per-Context.
- Deleting a Context never deletes its meetings.

## Privacy

- Recording and local transcription (Parakeet / Whisper CPU) happen on device;
  audio and transcripts are stored locally (your app-data folder —
  `%APPDATA%\com.meetily.ai` on Windows, identifier intentionally preserved
  across the Meetily → Recall rebrand — and your recordings folder).
- Local summary models (builtin-ai via the llama-helper sidecar) run fully
  offline. If you configure a CLOUD provider (OpenAI/Claude/Groq/OpenRouter or
  a custom endpoint), the meeting text you ask to summarize is sent to that
  provider — exactly as in the original Meetily behavior.
- Daily Brief and Continuous Context use the SAME provider you configured for
  summaries; they never introduce hidden network calls.
- Recall sends no telemetry. No analytics data leaves the machine unless a
  cloud provider is configured and used.
