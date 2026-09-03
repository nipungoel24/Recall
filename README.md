# Recall

**Recall is a privacy-focused desktop meeting intelligence application that records, transcribes, summarizes, organizes, and remembers context across meetings.**

All processing can stay on your own machine: native meeting recording, local transcription, local summarization, and a growing memory of your meetings, projects, and decisions. No cloud required.

> **Origin:** Recall is derived from the [Meetily open-source project](https://github.com/Zackriya-Solutions/meeting-minutes) by Zackriya Solutions. See [Attribution](#attribution).

## Capabilities

Only features that exist in this build are listed here.

- **Local recording & transcription** — microphone + system audio capture with professional mixing; Whisper and Parakeet transcription engines, GPU-accelerated where available
- **Meeting summaries** — AI summaries via local models (Ollama / built-in) or optionally configured cloud providers (Claude, Groq, OpenRouter, OpenAI-compatible endpoints)
- **Custom templates** — built-in and user-created summary templates (create, duplicate, protect built-ins)
- **Calendar** — meetings grouped by month/day
- **Daily Timeline** — one day as a chronological timeline
- **Daily Brief** — a derived report synthesizing a day's meetings (exportable to Markdown)
- **Contexts (Context Threads)** — threads of related meetings (project, client, initiative); meetings can belong to several Contexts
- **Continuous Context Memory** — durable, deduplicated per-Context knowledge (decisions, actions, questions, facts) with source-meeting provenance, folded into later summaries as background
- **Local summarization** — fully offline via the bundled sidecar; **optional configured cloud summarization** when you choose a cloud provider
- **Privacy-first storage** — SQLite database, recordings, transcripts, templates, and models stay on your machine

## Installation

### Windows

1. Download the latest `x64-setup.exe` from [Releases](https://github.com/nipungoel24/Recall/releases/latest)
2. Run the installer — the app, Start Menu entry, Taskbar, and tray all appear as **Recall**

### macOS

1. Download `recall_0.4.0_aarch64.dmg` from [Releases](https://github.com/nipungoel24/Recall/releases/latest)
2. Open the `.dmg` and drag **Recall** to Applications
3. Open **Recall** from Applications

### Linux

Build from source:

- [Building on Linux](docs/building_in_linux.md)
- [General build instructions](docs/BUILDING.md)

```bash
git clone https://github.com/nipungoel24/Recall
cd Recall/frontend
pnpm install
./build-gpu.sh
```

## Upgrading from Meetily

Recall opens your existing data automatically:

- Meetings, transcripts, summaries, custom templates, Contexts, Context Memory, and settings are preserved — the application identifier is intentionally kept compatible, and legacy data folders are reused when present.
- Fresh installs use `Recall`-branded folders (e.g. `recall-recordings`); pre-rename `meetily-recordings` folders keep working.
- Daily Brief exports are now named `recall-daily-brief-<date>.md`.
- If you previously set the `MEETILY_LLAMA_HELPER` environment variable, it still works; new setups should use `RECALL_LLAMA_HELPER`.

## For developers

```bash
cd frontend
corepack pnpm install --frozen-lockfile
corepack pnpm build          # static export
corepack pnpm tauri:dev:cpu  # run the desktop app (CPU)
```

- Windows runbook: [docs/DEVELOPMENT_WINDOWS.md](docs/DEVELOPMENT_WINDOWS.md)
- Architecture: [docs/architecture.md](docs/architecture.md), [CLAUDE.md](CLAUDE.md)
- GPU builds: [docs/GPU_ACCELERATION.md](docs/GPU_ACCELERATION.md)
- Rust gates: `cargo fmt --all -- --check`, `cargo check -p recall`, `cargo test -p recall`
- Frontend tests: `bun test tests/lib`, contract audit `node tests/contract/audit.mjs`
- Branding regression gate: `frontend/tests/lib/branding-regression.test.ts`

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## System architecture

Recall is a single, self-contained Tauri 2 desktop application: Next.js/React/TypeScript UI → Tauri IPC → Rust core → SQLite, with local audio/transcription/summary providers. Details in [docs/architecture.md](docs/architecture.md).

## License

MIT License — see [LICENSE](LICENSE). Feel free to use this project for your own purposes.

## Attribution

Recall is derived from the Meetily open-source project:

- Upstream repository: [Zackriya-Solutions/meeting-minutes](https://github.com/Zackriya-Solutions/meeting-minutes)
- Upstream author credit is preserved in package metadata and the in-app About dialog.
- Third-party acknowledgments from the original project are preserved below.

### Acknowledgments

- We borrowed some code from [Whisper.cpp](https://github.com/ggerganov/whisper.cpp).
- We borrowed some code from [Screenpipe](https://github.com/mediar-ai/screenpipe).
- We borrowed some code from [transcribe-rs](https://crates.io/crates/transcribe-rs).
- Thanks to **NVIDIA** for developing the **Parakeet** model.
- Thanks to [istupakov](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx) for providing the **ONNX conversion** of the Parakeet model.
