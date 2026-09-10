# Recall

**A private, local-first meeting operating system that turns conversations into searchable memory, decisions, context, and actionable work.**

Recall captures your meetings, transcribes them on-device, generates summaries, extracts context, and makes everything searchable — all without sending your meeting data to external servers unless you explicitly choose a cloud provider.

> **Developer Preview** — Recall can be built and used from source today. Official signed installers are not yet published. Users who want a normal consumer installer should wait for the first supported GitHub Release.

## Project Status

| Area | Status |
| --- | --- |
| Version | 0.4.0 |
| Platforms | Windows, macOS, Linux |
| Public binary release | **Not published yet** |
| Installer signing | **Not configured** |
| Updater | **Intentionally disabled** |
| Stability | **Developer Preview / active development** |

There are currently **no official GitHub Release assets**. The supported way to use Recall today is to **build from source** using the instructions below. Preview builds produced locally are unsigned.

## What Recall Does

- **Meeting recording** — captures microphone and system audio simultaneously, with professional mixing and noise suppression.
- **On-device transcription** — uses Whisper or Parakeet models running entirely on your hardware. GPU-accelerated when available.
- **Meeting summaries** — generates structured summaries from transcripts using local LLMs or optional cloud providers.
- **Custom templates** — create and use your own summary templates with section-level instructions.
- **Calendar view** — browse meetings by date range.
- **Daily Brief** — a synthesized overview of your day's meetings.
- **Context Memory** — automatically extracts and deduplicates recurring topics, decisions, and entities across meetings.
- **Meeting search** — find content across your meeting history.
- **Import & retranscription** — import audio/video files and transcribe them as meetings.
- **Crash recovery** — automatic recovery of in-progress recordings after unexpected shutdowns.
- **Light / Dark / System theme** — with accessible contrast and reduced-motion support.

## Privacy & Local-First Model

Recall is **local-first, not network-free**.

### What stays on your device

All meeting data is stored locally in SQLite:

- Audio recordings
- Transcripts
- Summaries and templates
- Context Memory
- Application settings

Recordings are saved to `~/Music/recall-recordings` (or the legacy `meetily-recordings` path on upgraded installations).

### Telemetry

Recall ships with **no product analytics telemetry**. There is no analytics provider, no usage-data collection, and no telemetry consent screen. Application logs remain on your device.

Automatic updating is disabled until Recall-controlled release infrastructure exists.

### Cloud AI (optional)

If you configure an optional cloud summarization provider (Anthropic Claude, Groq, OpenRouter, or OpenAI), the transcript content required for that summary request will be sent to that provider. Cloud providers are entirely user-configured and can be left unused.

### Model downloads

Transcription and summarization models are downloaded on first use from public registries (HuggingFace). These downloads require an internet connection, but after download all processing happens locally. See [docs/RECALL_EXTERNAL_ASSETS.md](docs/RECALL_EXTERNAL_ASSETS.md) for a full supply-chain inventory.

## Installation

### Official installers

Official Recall installers are not yet published. Building from source is currently the supported Developer Preview path.

When official releases become available, they will be at:

```
https://github.com/nipungoel24/Recall/releases
```

Do not download Recall installers from unofficial mirrors.

### Build from source

#### Prerequisites

- **Git**
- **Node.js 22+** (with corepack for pnpm)
- **pnpm** (via corepack)
- **Rust stable** (MSVC toolchain on Windows)
- **CMake**
- **Tauri platform dependencies** — see platform-specific instructions below

#### Clone

```bash
git clone --recurse-submodules https://github.com/nipungoel24/Recall.git
cd Recall
```

If you already cloned without `--recurse-submodules`:

```bash
git submodule update --init --recursive
```

### Windows

Windows is the primary development and testing platform.

#### Prerequisites

- Windows 10/11 x64
- [Visual Studio 2022 Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++" workload
- Windows SDK
- [Rust](https://rustup.rs/) (MSVC toolchain)
- [CMake](https://cmake.org/download/)
- [LLVM/Clang](https://releases.llvm.org/) — the helper scripts assume installation at `C:\Program Files\LLVM\bin`
- [Node.js 22+](https://nodejs.org/)

#### Run (development)

```powershell
cd frontend
.\dev-gpu.bat
```

This helper script will:

1. Detect your GPU and select the appropriate acceleration feature
2. Build the `llama-helper` sidecar
3. Copy the sidecar binary to the correct location
4. Start the Tauri development server

If `dev-gpu.bat` reports that `pnpm` is not recognized, enable corepack shims:

```powershell
corepack enable pnpm
```

#### Build (local production package)

```powershell
cd frontend
.\build-gpu.bat
```

Locally produced packages are **unsigned**. Windows SmartScreen may warn about an unknown publisher.

#### Manual alternative

If you prefer not to use the helper scripts:

```powershell
cd frontend
corepack pnpm install --frozen-lockfile
corepack pnpm build
cargo tauri dev
```

Note: `cargo tauri dev` will fail if the llama-helper sidecar has not been built and copied to `src-tauri/binaries/`. Use the helper scripts for a complete development setup.

### macOS

#### Prerequisites

- macOS 13+ (ScreenCaptureKit requires macOS 13 for system audio capture)
- Xcode Command Line Tools: `xcode-select --install`
- [Homebrew](https://brew.sh/)
- [CMake](https://cmake.org/download/): `brew install cmake`
- Node.js 22+: `brew install node`
- [Rust](https://rustup.rs/)

#### Run (development)

```bash
cd frontend
./dev-gpu.sh
```

Metal GPU acceleration is enabled automatically on macOS. No additional GPU configuration is required.

#### Build (local production package)

```bash
cd frontend
./build-gpu.sh
```

Locally produced `.app` bundles are **unsigned and unnotarized**. A production macOS release will require Apple Developer ID signing and notarization.

### Linux

#### Prerequisites (Debian/Ubuntu)

```bash
sudo apt update
sudo apt install build-essential cmake git curl wget file \
  libwebkit2gtk-4.1-dev libxdo-dev libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev pkg-config
```

#### Run (development)

```bash
cd frontend
./dev-gpu.sh
```

The script auto-detects your GPU and selects the best acceleration backend. Falls back to CPU-only if no GPU SDK is found.

#### Build (local production package)

```bash
cd frontend
./build-gpu.sh
```

See [docs/BUILDING.md](docs/BUILDING.md) for detailed distribution-specific instructions and GPU setup guides.

## GPU Acceleration

Recall uses GPU acceleration for transcription when available. The build scripts auto-detect your hardware:

| Platform | Acceleration | SDK Required |
| --- | --- | --- |
| macOS | Metal / CoreML | None (enabled by default) |
| Windows | CUDA (NVIDIA) | CUDA Toolkit |
| Windows | Vulkan (AMD/Intel) | Vulkan SDK |
| Windows | CPU fallback | OpenBLAS (optional) |
| Linux | CUDA (NVIDIA) | CUDA Toolkit |
| Linux | ROCm/HIP (AMD) | ROCm |
| Linux | Vulkan | Vulkan SDK + OpenBLAS |

> A GPU driver alone is not enough. You need the development SDK (CUDA Toolkit, Vulkan SDK, or ROCm) installed and discoverable.

See [docs/GPU_ACCELERATION.md](docs/GPU_ACCELERATION.md) for details.

## First Run

1. Launch Recall.
2. Complete the onboarding flow.
3. Grant audio permissions when prompted (microphone required; screen recording required on macOS for system audio).
4. Select and download a transcription model (Parakeet v3 is the default; larger Whisper models produce better results but require more memory and disk space).
5. Optionally configure a summary provider (Anthropic, Groq, OpenRouter, OpenAI) or use the built-in local summarization.
6. Start a recording. Speak naturally.
7. Stop the recording. Recall processes the audio automatically.
8. Open the meeting to view the transcript, summary, and extracted context.

Larger models may require significant download time, disk space, and memory.

## Local vs Cloud AI

### Local (default)

- **Transcription**: Whisper or Parakeet running on your device via whisper-rs / ONNX Runtime.
- **Summarization**: Built-in local LLM via llama-helper sidecar (Qwen3.5, Gemma GGUFs) or Ollama if configured.

### Cloud (optional, user-configured)

If you choose to enable a cloud provider, Recall will send the transcript text required for that specific summary request. Cloud providers are never contacted without explicit user configuration. Supported providers:

- Anthropic Claude
- Groq
- OpenRouter
- OpenAI

Cloud summarization is always described as **optional / user-configured** in the UI.

## Meetily Upgrade Compatibility

Recall evolved from [Meetily](https://github.com/Zackriya-Solutions/meetily). The Tauri application identifier remains `com.meetily.ai` — this is intentional.

> This identifier is retained so existing Meetily data does not appear to disappear after the Recall rebrand. Do not manually rename or delete the app-data directory as an upgrade step.

Existing Meetily recordings, transcripts, and database files are compatible with Recall without migration.

## Data Locations

### Windows

| Data | Path |
| --- | --- |
| App data / DB / models | `%APPDATA%\com.meetily.ai\` |
| SQLite database | `%APPDATA%\com.meetily.ai\meeting_minutes.sqlite` |
| Transcription models | `%APPDATA%\com.meetily.ai\models\` |
| Default recordings | `%USERPROFILE%\Music\recall-recordings` |

Fresh installs use `recall-recordings`. Pre-rename installs continue using `meetily-recordings` when that folder exists.

### macOS

| Data | Path |
| --- | --- |
| App data / DB / models | `~/Library/Application Support/com.meetily.ai/` |
| Default recordings | `~/Music/recall-recordings` |

### Linux

| Data | Path |
| --- | --- |
| App data / DB / models | `~/.config/com.meetily.ai/` |
| Default recordings | `~/Music/recall-recordings` |

## Developer Commands

### Install and build

```bash
cd frontend
corepack pnpm install --frozen-lockfile
corepack pnpm build
```

### Tauri development

```bash
# Auto-detect GPU (recommended)
.\dev-gpu.bat          # Windows
./dev-gpu.sh           # macOS / Linux

# Or manually by GPU type
corepack pnpm tauri:dev:cpu
corepack pnpm tauri:dev:cuda
corepack pnpm tauri:dev:vulkan
corepack pnpm tauri:dev:metal
```

### Rust validation

```bash
cd frontend
cargo fmt --all --check
cargo check --workspace
cargo clippy --workspace --all-targets
cargo test --workspace
```

### Frontend tests

```bash
cd frontend
node --test tests/lib/*.test.mjs
node tests/contract/audit.mjs
```

## Architecture

```
Next.js 14 / React 18 / TypeScript
            ↓
        Tauri IPC
            ↓
          Rust
            ↓
SQLite / audio capture / transcription / summarization / context memory
```

Recall is a single self-contained Tauri 2 desktop application. No separate backend service is required at runtime.

See [Architecture.md](Architecture.md) for the full architecture reference, [PRD.md](PRD.md) for the product requirements, and [Design.md](Design.md) for the design system.

## Release Blockers

The following areas are being actively hardened before the first supported public release:

- Recall-owned update and release infrastructure
- Signed Windows installers (Authenticode)
- Signed and notarized macOS installers
- Release-grade native QA across platforms
- Migration of remaining upstream-controlled external assets (ffmpeg binaries, Parakeet v3 model host)
- Download integrity and checksum verification
- Installer upgrade and uninstall testing
- Release compatibility validation

See [docs/RECALL_EXTERNAL_ASSETS.md](docs/RECALL_EXTERNAL_ASSETS.md) for the full supply-chain inventory.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Changes involving audio capture, native recording, database migrations, Context Memory, privacy behavior, external downloads, or release infrastructure must preserve compatibility and safety constraints. All changes should maintain the existing regression test gates.

## License

[MIT](LICENSE.md)

## Attribution

Recall builds on work from the [Meetily](https://github.com/Zackriya-Solutions/meetily) project by Zackriya Solutions. See [LICENSE.md](LICENSE.md) for full details.
