# Memory.md

Concise, factual working memory. Updated after every completed task, major decision, and before ending a session.

# Current State

- Current phase: Phase 1 — Foundation Hardening
- Current task: Priority 1 — disable the legacy updater channel (trace full updater flow)
- Branch: `phase/1-foundation`
- HEAD: `accd7ca9826f2278af2ccbedf1f6c85efc1c8628`
- Working files: none in progress

# Completed

- Phase 0: forensics (local ahead 6, clean), baseline, code audit, branding/privacy/updater/upstream audits, source-of-truth docs
- Phase 0 closure: docs committed `accd7ca`; `origin/rebrand/recall` safety copy created; `main` fast-forwarded to `accd7ca`; all four refs (main, origin/main, rebrand/recall, origin/rebrand/recall) at `accd7ca9826f2278af2ccbedf1f6c85efc1c8628`
- Phase 1 branch `phase/1-foundation` created from synchronized main

# Decisions

- Updater must be fail-closed until Recall-owned release infra + signing keys exist
- Analytics: NO external product telemetry at this stage; remove PostHog client/key; keep opt-in-free default
- Tauri identifier `com.meetily.ai` NOT changed this phase (migration-sensitive)
- Archived `backend/` removed only in a separately reviewed cleanup (not this phase)
- Global lint debt deferred to a later quality phase; only touched files must not gain debt

# Tests

- Command: cargo test --workspace (Phase 0 baseline)
- Result: 345 passed, 2 ignored, 0 failed
- Command: cargo clippy --workspace --all-targets (Phase 0 baseline)
- Result: FAIL — 2 deny errors (backend_config.rs:55 to_string/Display shadow; system_audio_commands.rs:123 len()>=0)
- Command: node --test tests/lib/*.test.mjs (Phase 0 baseline)
- Result: 119 pass / 1 fail (qa-routes requires bun)
- Command: bun test (Phase 0 baseline)
- Result: NOT AVAILABLE on this Windows host (npm-wrapper bun binary incompatible)

# Known Problems

- Frontend global ESLint baseline: 410 errors / 11,461 warnings (pre-existing; deferred)
- Bun-only test suites cannot run on this machine (NOT AVAILABLE; semantics unchanged)
- Parakeet v3 models and ffmpeg binaries download from upstream-hosted infra (inventory in Priority 4)

# Next Exact Step

1. Trace the complete updater flow (tauri.conf.json → Rust plugin init → frontend updateService/UpdateCheckProvider/UpdateDialog/UpdateNotification/tray → release scripts → CI) and produce the inventory of every path capable of initiating an update request.

# Blockers

- None.
