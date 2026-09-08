# Recall — Product Requirements Document (PRD)

**Status:** Source of truth · **Version:** 1.0 · **Date:** 2026-09-08
This document describes the ACTUAL reconciled repository at Phase 0 completion. Target features are marked as targets; everything else is verified in code.

## Product

- **Name:** Recall
- **Statement:** A private, local-first meeting operating system that turns conversations into searchable memory and actionable work.
- **Vision:** Every conversation you have becomes durable, searchable, and useful — decisions traceable to evidence, actions tracked to completion, and project context that persists between meetings — all on your own machine.
- **Problem:** Meeting knowledge is lost. People re-derive decisions, forget follow-ups, and cannot reconstruct why something was decided. Existing meeting bots upload content to clouds and require joining calls; Recall captures natively, processes locally, and remembers.

## Target Users

- Privacy-conscious professionals
- Founders and small teams that do not want a meeting bot joining calls
- Consultants (client context across engagements)
- Researchers and interviewers
- Developers (standups, design reviews, retrospectives)
- Individual knowledge workers
- Anyone on macOS/Windows/Linux desktop who wants local-first meeting memory

## Jobs To Be Done

- "When I finish a meeting, help me understand what matters."
- "When I return to a project weeks later, tell me what was decided."
- "When somebody asks why a decision was made, show me the source."
- "When I have several meetings in one day, tell me what needs my attention."
- "When I walk into a recurring meeting, remind me what is still open."
- "When I need a fact from last quarter, let me find it by searching."

## Product Loop

```
CAPTURE → UNDERSTAND → REMEMBER → ACT → REVISIT
```

## Current Features (verified in code, v0.4.0)

| Feature | State | Notes |
|---|---|---|
| Recording (mic + system audio, pause/resume) | Implemented | WASAPI (Windows), ScreenCaptureKit/CoreAudio (macOS), ALSA/Pulse (Linux); RMS-ducked mixing; RNNoise; EBU R128 loudness; Silero VAD; mp4/AAC via ffmpeg |
| Live + post transcription | Implemented | Whisper (whisper-rs, GPU features cuda/vulkan/metal) and Parakeet (ONNX TDT) engines |
| Crash recovery | Implemented | 30s audio checkpoints + IndexedDB transcript scratch + recovery dialog |
| Meeting summaries | Implemented | Providers: Ollama, built-in local LLM (llama-helper sidecar), Claude, Groq, OpenAI, OpenRouter, custom OpenAI-compatible endpoint; chunked multi-pass generation; language detection/normalization |
| Custom summary templates | Implemented | CRUD, duplicate, built-in protection, persistent default template |
| Calendar | Implemented | Month grid of meetings, local-day grouping |
| Daily timeline | Implemented | Chronological day view |
| Daily Brief | Implemented | Derived report of a day's meetings; markdown export |
| Context threads | Implemented | Many-to-many contexts↔meetings; create/rename/delete; add/remove meetings |
| Context memory | Implemented | Durable deduped decisions/actions/questions/facts with source-meeting provenance; bounded budget; rebuild |
| Meeting details workspace | Implemented | Two-panel: virtualized transcript + BlockNote summary editor |
| Sidebar meeting search | Implemented | Debounced transcript/metadata search |
| Settings | Implemented | General, Recordings, Transcription, Summary, Templates, Beta tabs |
| Onboarding | Implemented | Welcome → Setup → model download → permissions |
| Legacy DB import | Implemented | FastAPI-era + Homebrew install detection and import |
| Audio import + retranscription | Implemented (beta) | Gated by beta flag |
| Notifications | Implemented | Consent lifecycle, DND detection, tray |
| Analytics | Implemented (opt-in) | Off by default; consent switch; payload sanitization |
| Updater | Partial | UI + plugin wired, but endpoint targets upstream Meetily release channel (see Risks) |

## Target Features (approved future state, phased)

See `Phases.md` for sequencing.

| Feature | Target state |
|---|---|
| Meeting workspace | Overview / Summary / Transcript / Tasks / Notes / Context organization |
| Structured meeting intelligence | Validated structure: abstract, topics, decisions, actions, questions, facts, follow-ups with source-segment provenance |
| Tasks | Durable actions: text, owner, due date, status, source meeting/segment, confidence |
| Search | Global lexical search (SQLite FTS) across meetings, transcripts, summaries, notes, decisions, tasks, questions, contexts with filters (`type:decision`, `status:open`, `context:<name>`, `after:<date>`) |
| Provenance | AI-derived items clickable to supporting transcript/audio evidence |
| Daily Brief | Answer: what happened, decided, requires action, unresolved, changed today |
| Home | Answer "what requires my attention?": start recording, today, open actions, needs attention, recent meetings, active contexts |
| Contexts | Project/client/initiative memory with scoring/pruning |
| Export | Preserve and improve existing task/calendar/CSV export paths |

## Core Product Areas

Home · Record · Meetings · Daily · Calendar · Tasks · Contexts · Search · Templates · Settings

## Functional Requirements (summary)

- **Home:** quick start recording; today's meetings; open actions; Daily Brief status; recent meetings; active contexts; quick search. No vanity metrics.
- **Record:** device selection (mic/system), permission flows, live audio levels, timer, live transcription, model readiness, stop/cancel with min-duration guard, crash recovery, post-processing state.
- **Meetings:** list via sidebar; details workspace with transcript, summary, tasks, notes, context; copy/export; retranscribe; delete with folder cleanup.
- **Daily:** day timeline; generate/cancel/regenerate brief; markdown export.
- **Calendar:** month navigation; per-day meeting lists; jump to daily/details.
- **Tasks:** durable items with owner/due/status/source; exports preserved.
- **Contexts:** CRUD; membership; memory; rebuild.
- **Search:** lexical across all content types; filters; results link to meetings.
- **Templates:** built-in + custom CRUD; default selection; structure preview.
- **Settings:** all existing tabs; analytics consent; storage locations; model management; beta flags.

## Nonfunctional Requirements

- **Privacy:** local-first default; no cloud upload unless user explicitly configures a cloud provider; telemetry off by default, opt-in only; sanitized payloads; no meeting content in telemetry.
- **Offline:** recording, transcription, local summary, memory all function without network.
- **Reliability:** crash recovery, checkpointing, atomic file writes, graceful shutdown, single-instance.
- **Performance:** VAD reduces transcription load; virtualized transcripts; bounded memory prompts; no blocking async; measurable before optimizing native code.
- **Accessibility:** keyboard navigable, visible focus, labeled controls, tooltips for icon buttons, reduced motion, WCAG contrast.
- **Data durability:** SQLite with migrations (never rewrite shipped migrations); WAL; backup of summary results; legacy import.
- **Migration safety:** pre-rename Meetily installs keep working (identifier `com.meetily.ai`, legacy folders, env fallbacks); fresh installs get Recall branding.
- **Security:** minimal Tauri permissions; secrets never logged; AI output validated; path traversal blocked in template ids.
- **Desktop behavior:** tray with recording controls, update check, quit; notifications with consent; window restore on second launch.

## Product Principles

1. **LOCAL FIRST** — local is the preferred/default path for capture, transcription, and intelligence.
2. **NO BOT REQUIRED** — works without joining Zoom/Meet/Teams.
3. **USER OWNS DATA** — no hidden upload of recordings, transcripts, or notes.
4. **AI MUST BE INSPECTABLE** — important intelligence links to supporting source where possible; never fake provenance.
5. **AFTER-MEETING VALUE > AI NOVELTY** — prefer features that save real work.
6. **PROGRESSIVE POWER** — simple default experience; sophisticated controls available.
7. **NO LOGIN BY DEFAULT** — no accounts unless a future cloud/collaboration requirement demands them.

## Non-Goals (initial)

- Mandatory cloud account or hosted transcription
- Enterprise admin suite
- Server-based collaboration
- Autonomous external actions without permission
- Plugin ecosystem
- Vector database (until lexical + structured search proves insufficient)

## Risks & Open Items (see Phase 0 report)

- Updater endpoint targets upstream Meetily releases — must be disabled or migrated before Recall releases updates.
- Analytics PostHog key is inherited from upstream — data goes to upstream's project when a user opts in.
- Parakeet v3 model and ffmpeg binaries download from upstream-hosted infrastructure.
- Tauri identifier intentionally remains `com.meetily.ai` until a tested migration exists.
