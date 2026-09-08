# Recall — Architecture

**Status:** Source of truth · **Version:** 1.0 · **Date:** 2026-09-08
Current architecture is verified against code. Target architecture is aspirational; migration is incremental and feature-by-feature — never mass-move files.

## Current Architecture

### Shape

Recall is a single self-contained **Tauri 2 desktop application** (v0.4.0). No separate backend service is required at runtime.

```
┌──────────────────────────────────────────────────────────────┐
│ Frontend: Next.js 14 (static export) + React 18 + TypeScript │
│   src/app (routes) · src/components · src/contexts ·         │
│   src/hooks · src/services · src/lib                         │
└───────────────────────────┬──────────────────────────────────┘
                     invoke()/events (typed Tauri IPC)
┌───────────────────────────┴──────────────────────────────────┐
│ Rust core (`frontend/src-tauri`, lib name `app_lib`)         │
│   ~200 Tauri commands across:                                │
│   audio/ · whisper_engine/ · parakeet_engine/ · summary/     │
│   context/ · contexts/ · database/ · analytics/ ·            │
│   notifications/ · api/ · ollama|openai|anthropic|groq|      │
│   openrouter/ · console_utils/ · tray · onboarding           │
└──────────┬──────────────────────────────┬────────────────────┘
           │ sqlx (SQLite, WAL, 15        │ filesystem + sidecars
           │  migrations, checksums)      │
     ┌─────┴─────┐                  ┌──────┴──────┐
     │ SQLite    │                  │ recordings  │ ffmpeg (bundled)
     │ meeting_  │                  │ models      │ llama-helper sidecar
     │ minutes.  │                  │ templates   │ (local LLM)
     │ sqlite    │                  │ stores      │
     └───────────┘                  └─────────────┘
```

### Frontend (Next.js 14, static export)

- Routes (query-param based, static-export safe via `src/lib/routes.ts`): `/` (home + live recording), `/meeting-details`, `/daily`, `/calendar`, `/context`(+`?id=`), `/templates`, `/settings`, `/notes` (legacy demo stub).
- Global state: `ConfigContext`, `RecordingStateContext`, `TranscriptContext`, `OnboardingContext`, `SidebarProvider`, plus `AnalyticsProvider`, `RecordingPostProcessingProvider`, `OllamaDownloadContext`, `ImportDialogContext`, `UpdateCheckProvider`.
- Persistence: SQLite via Tauri commands is the source of truth; IndexedDB `RecallRecoveryDB` for crash scratch; localStorage for UI prefs; `@tauri-apps/plugin-store` for `analytics.json`, `preferences.json`.
- UI stack: shadcn/Radix (`src/components/ui/`, 24 components), Tailwind 3 CSS-var tokens, lucide-react icons, framer-motion, sonner toasts, BlockNote editor for summaries, react-hook-form, @tanstack/react-virtual.

### Rust / Tauri core (`frontend/src-tauri/src/`)

| Area | Modules | Notes |
|---|---|---|
| Audio | `audio/` (40+ files) | capture (cpal WASAPI/CoreAudio/ScreenCaptureKit), device discovery/permissions, ring-buffer mixing (RMS ducking, 600ms window), RNNoise, EBU R128, Silero VAD, incremental saver (30s checkpoints), level monitoring, bluetooth handling, retranscription, import |
| Transcription | `whisper_engine/`, `parakeet_engine/`, `audio/transcription/` | whisper-rs (GPU features) + Parakeet ONNX TDT via provider trait; parallel batch processor |
| Summary | `summary/` | provider resolution (7 providers), chunking, markdown normalization, language detection, daily brief, `summary_engine/` built-in local LLM via llama-helper sidecar |
| Templates | `summary/templates/` | file-based JSON (bundled resources + user dir), embedded fallbacks, validated schema, secure id sanitization |
| Context memory | `context/`, `contexts/` | extraction, deterministic dedup, bounded budget, provenance, render guards |
| Database | `database/`, `database/repositories/` | sqlx SQLite, migrations with checksums, legacy DB copy/import, 12 repositories |
| Analytics | `analytics/` | posthog-rs client, sanitization, session tracking (opt-in from frontend) |
| Notifications | `notifications/` | consent lifecycle, DND detection, settings |
| Providers | `ollama/`, `openai/`, `anthropic/`, `groq/`, `openrouter/` | per-provider model listing HTTP clients |
| Glue | `lib.rs`, `brand_paths.rs`, `tray.rs`, `onboarding.rs`, `config.rs`, `state.rs` | command registration, brand-compatible paths, tray |

### External binaries

- **ffmpeg** — downloaded at build time (cached in `src-tauri/binaries/`), bundled via `externalBin`, used for audio muxing.
- **llama-helper** — workspace member binary (llama-cpp-2) speaking JSON over stdin/stdout; spawned/health-checked/kept-alive by the summary sidecar manager.
- Full external asset/supply-chain inventory (models, binaries, git deps, integrity checks, classifications): [docs/RECALL_EXTERNAL_ASSETS.md](docs/RECALL_EXTERNAL_ASSETS.md). Upstream-controlled hosts (Parakeet v3 CDN, ffmpeg binary releases) are classified MUST MIGRATE BEFORE RELEASE.

### Data Flow

```
Mic + System Audio
  → capture streams (48kHz resample at capture)
  → ring-buffer mixing (ducking, clip-safe)
  → VAD (Silero, speech-only windows)
      ├─→ recording saver (mp4 + transcripts.json + metadata.json, checkpoints)
      └─→ transcription worker (Whisper/Parakeet) → TranscriptUpdate events → frontend → SQLite
  → post-meeting: summary generation (provider + template + context memory)
  → context memory extraction (background) → dedup → budget fold
  → Daily Brief (derived artifact, daily_summaries)
  → Calendar/Daily/Search/Meeting UI read from SQLite
```

## Target Architecture

### Frontend boundaries (incremental, migrate as code is touched)

```
src/
  app/            — routes only
  components/
    ui/           — shadcn primitives (tokenized)
    shared/       — shared app components
    layout/       — app shell (sidebar, topbar, tray glue)
    icons/        — icon registry
  features/
    home/ recording/ meetings/ daily/ calendar/ tasks/ contexts/ search/ templates/ settings/
  hooks/ contexts/ lib/ types/
```

### Rust boundaries

Keep a clean separation between: Tauri command boundary (thin, typed) → domain/services → persistence (repositories) → infrastructure (audio, engines, providers). No complex business logic directly inside commands. Dead code (`lib_old_complex.rs`, `audio_v2/`, `*-old.rs`, undeclared files) removed in reviewed cleanups.

### Database

SQLite stays the primary store. Migrations only additive; shipped migrations never rewritten; checksums enforced by contract audit. Search evolves from `LIKE` to **SQLite FTS** when the search feature is implemented; local embeddings only later if lexical+structured search proves insufficient.

### Structured intelligence & provenance

Evolve toward validated structures (`MeetingIntelligence` with topics/decisions/actions/questions/facts/followUps), each item retaining source segment references and timestamps where evidence is reliable. Never fabricate provenance.

### Error model

Typed/contextual errors from Rust (`Result` with context, no panic/unwrap in normal paths); recoverable errors surfaced in UI with useful language; technical context in logs only.

### Updater / analytics / identity (Phase 1 foundations)

- Updater: disabled or migrated to Recall-owned release infra + signing keys before any Recall auto-update ships.
- Analytics: opt-in default OFF, Recall-owned PostHog key (or removal), sanitized payloads, consent tests.
- Identity: Tauri identifier stays `com.meetily.ai` until a tested data migration exists; visible branding is Recall.
