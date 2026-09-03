# Meetily Intelligence — Current State (verified baseline)

**Date:** 2026-08-18 · **Branch:** `master` (working tree, not pushed)

This file records the verified green state before the product-polish phase. If
anything below regresses, restore from here.

## Verification results

| Gate | Result |
|---|---|
| `cargo fmt --all -- --check` | PASS |
| `cargo check -p meetily` | PASS |
| `cargo test -p meetily` | **333 passed, 0 failed, 2 ignored** |
| `cargo check -p llama-helper` | PASS |
| `cargo test -p llama-helper` | **2 passed** |
| `corepack pnpm install --frozen-lockfile` | PASS |
| `corepack pnpm build` (static export) | PASS — no dynamic runtime-entity segments |
| `bun test tests/lib` | **197 passed, 0 failed** |
| Node feature suites (calendar/daily/qa-*/template/context) | ALL PASS |
| Contract audit (`node tests/contract/audit.mjs`) | **77 passed, 0 violations** |
| QA Rust harness (`qa/rust-regression`) | 104 passed |
| Real Tauri app (`corepack pnpm tauri:dev:cpu`) | Launches; all routes render; Home IPC is lightweight (no transcripts/Ollama/N+1) |
| Static-export runtime routing | Fresh Context created AFTER build opens via `/context?id=`, survives reload, deleted context shows friendly not-found |

## Feature state

- Recording + live transcription (Parakeet default; Whisper selectable) — verified end-to-end with real audio
- Whisper 0.16.0 (upgraded from 0.13.2); CPU verified at runtime; CUDA/Vulkan remain opt-in features
- Meeting history, meeting-details, summaries (local/cloud providers)
- Custom summary templates (CRUD + built-in protection + duplicate)
- Calendar (two-pane, month cache, keyboard nav)
- Daily timeline + Daily Brief (derived `daily_summaries`; never mutates meetings)
- Context Threads (many-to-many, meeting survival on delete)
- Continuous Context Memory (bounded, deduped, provenance, prompt-injection safe)
- Static-export-safe routing via `src/lib/routes.ts` (query-param ids)

## Known debt / observations

- Legacy ESLint debt on pre-existing lines (`no-explicit-any`, unused vars) in older files; new files are lint-clean
- One non-reproducible observation: app exited cleanly once during a Settings full reload in testing (see product polish phase)
- `docs/MEETILY_MIGRATION_UPGRADE_GUIDE.md` documents the checksum-drift repair procedure; `migrations/checksums.json` + audit guard prevent future drift
- Notes pages are legacy demo content (`/notes?id=`) with no list experience
