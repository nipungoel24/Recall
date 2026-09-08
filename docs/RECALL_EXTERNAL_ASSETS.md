# Recall — External Asset & Supply-Chain Inventory

**Status:** Engineering record · **Version:** 1.0 · **Date:** 2026-09-08
Audited during Phase 1 (Foundation Hardening). Every binary/model asset and
git dependency that Recall obtains from outside the `nipungoel24/Recall`
repository, whether at build time or runtime.

## Classification

| Class | Meaning |
|---|---|
| SAFE THIRD-PARTY | Canonical public source, licenseable, not controlled by a single vendor's private infra |
| UPSTREAM-CONTROLLED | Hosted on the historical Meetily/Zackriya infrastructure |
| MUST MIGRATE BEFORE RELEASE | Recall releases may not depend on upstream-controlled hosts |
| OPTIONAL | Only used when the user explicitly configures it |
| UNKNOWN | Provenance not established |

## Runtime Model Downloads

| Asset | Source | When | Integrity check | Class |
|---|---|---|---|---|
| Whisper GGML models (12, default `large-v3-turbo`) | `huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-*.bin` | User-initiated download from model manager | File size + GGML header validation; corruption detected and re-download offered | SAFE THIRD-PARTY |
| Parakeet v2 (`parakeet-tdt-0.6b-v2`) | `huggingface.co/istupakov/parakeet-tdt-0.6b-v2-onnx/resolve/main` | User/onboarding-initiated download | None (existence check) | SAFE THIRD-PARTY |
| Parakeet v3 (`parakeet-tdt-0.6b-v3-int8`, default) | `meetily.towardsgeneralintelligence.com/models/parakeet-tdt-0.6b-v3-onnx` | User/onboarding-initiated download | None | **UPSTREAM-CONTROLLED → MUST MIGRATE BEFORE RELEASE** |
| Built-in summary GGUFs (Qwen3.5-2B/4B, Gemma-3-1B/4B) | `huggingface.co/unsloth/...`, `huggingface.co/bartowski/...` | User/onboarding-initiated download | Download size validation, resume support | SAFE THIRD-PARTY |
| Ollama models | Ollama registry (`https://api.ollama.ai`) via the user's Ollama install | Only when user configures Ollama | Delegated to Ollama | OPTIONAL (explicit user action) |

**Decisions**

- Parakeet v3 is the default transcription model and is downloaded during
  onboarding — migrating it is required before Recall release infra is
  established. Preferred target: a Recall-owned bucket or a HuggingFace repo
  under Recall's control, with a file-size/checksum manifest.
- No recall-branded mirror is required for HuggingFace-hosted assets; HF is a
  canonical, licenseable host and the URLs carry no old branding.

## Build-Time Binaries & Dependencies

| Asset | Source | When | Integrity check | Class |
|---|---|---|---|---|
| ffmpeg 8.0.1 binaries (win/mac-arm/mac-intel/linux static) | `github.com/Zackriya-Solutions/ffmpeg-binaries/releases/download/0.0.1/...` | `build.rs` → `build/ffmpeg.rs`, cached in `src-tauri/binaries/` | `-version` execution check only; **no checksum** | **UPSTREAM-CONTROLLED → MUST MIGRATE BEFORE RELEASE** |
| llama-helper | Built from workspace member source (`llama-helper/`, llama-cpp-2 from crates.io) | Build | Cargo.lock pins (crates.io checksums) | SAFE THIRD-PARTY |
| `cpal` (audio) | git `RustAudio/cpal`, rev `51c3b43` (WASAPI patches) | Build (`[patch.crates-io]`) | Rev-pinned | SAFE THIRD-PARTY |
| `ffmpeg-sidecar` | git `nathanbabcock/ffmpeg-sidecar`, branch `main` | Build | **Unpinned branch — pin a rev** | SAFE THIRD-PARTY (hardening note) |
| `silero-rs` (VAD) | git `emotechlab/silero-rs`, rev `26a6460` | Build | Rev-pinned | SAFE THIRD-PARTY |
| `cidre` (macOS CoreAudio) | git dependency | Build | Pinned | SAFE THIRD-PARTY |
| Remaining crates | crates.io via Cargo.lock | Build | Cargo.lock checksums | SAFE THIRD-PARTY |

**Decisions**

- ffmpeg binaries are the only *build-time* upstream dependency. Options
  before release: (a) vendor the binaries into the Recall repo release
  assets, (b) build ffmpeg from official source in CI, or (c) mirror to a
  Recall-owned host with checksums. Current cached copies in
  `src-tauri/binaries/` keep local builds working; CI builds download from
  the upstream host today.
- Add SHA-256 checksums to every downloaded binary/model as part of the
  migration work (Phase 10) — none are verified by hash today.

## CI Downloads

Standard toolchains from official channels (rust, node/pnpm, LLVM, VS Build
Tools). No upstream Meetily infra is used in CI. CI signing references
`MEETILY_RSA_PUBLIC_KEY` — an existing secret *name* only; its rotation is
deliberate and out of Phase 1 scope.

## Removed in Phase 1

- Tauri updater plugin + upstream release feed (`Zackriya-Solutions/meeting-minutes`) — removed, regression-gated.
- PostHog analytics (upstream API key) — removed, regression-gated.

## License Notes

- Whisper models: ggml builds of OpenAI Whisper weights (MIT).
- Parakeet: NVIDIA NeMo model, ONNX conversions by third parties (NVIDIA license terms apply to the model).
- Qwen3.5/Gemma GGUFs: per-model licenses on HuggingFace (Qwen, Gemma terms).
- ffmpeg builds: GPL/LGPL builds from gyan.dev (Windows) and static builds (macOS/Linux) — licensing per build type.

## Change Rules

Any new external download URL or git dependency must be recorded here with
source, integrity check, license, and classification. Upstream-controlled
hosts are prohibited for new dependencies.
