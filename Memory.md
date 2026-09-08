# Memory.md

Concise, factual working memory. Updated after every completed task, major decision, and before ending a session.

# Current State

- Current phase: Phase 1 — Foundation Hardening (complete, awaiting approval)
- Current task: final report
- Branch: `phase/1-foundation`
- HEAD: `868e298` (docs/gitignore commit pending)
- Working files: PRD.md, Architecture.md, Phases.md, Rules.md, CLAUDE.md, Memory.md (docs finalization)

# Completed

- Phase 0: forensics, baseline, audits, source-of-truth docs
- Phase 0 closure: `accd7ca` on main + origin/main + rebrand/recall + origin/rebrand/recall
- Phase 1:
  - Updater disabled fail-closed (`a753bb4`): plugin, config, UI, tray, scripts removed; updater-regression gate added
  - Telemetry removed (`3d8da7d`): PostHog Rust module + dep, frontend facade/provider/consent UI, all call sites; dead lib_old_complex.rs removed; analytics-regression gate added; PRIVACY_POLICY.md rewritten
  - Clippy fixed (`cf588de`): `as_str()` rename, vacuous assertion removed
  - Dead code + HTTP stubs removed (`c797552`): audio_v2/, *-old.rs, profile/licensing commands, CLEANUP_PLAN.md executed; RECALL_EXTERNAL_ASSETS.md created
  - Hygiene (`868e298` + follow-up): vs_buildtools.exe, metadata dupes, tailwind.config.ts, electron field, dead deps, eslint ignores

# Decisions

- Updater fail-closed until Recall-owned release infra + signing keys (Phase 10)
- NO product telemetry; if reconsidered → opt-in, Recall-owned, sanitized, explicit approval
- Tauri identifier `com.meetily.ai` preserved (migration-sensitive)
- Archived backend/ and serverAddress vestigial gate DEFERRED (documented)
- External assets classified; upstream-controlled hosts (Parakeet v3 CDN, ffmpeg binaries) = MUST MIGRATE BEFORE RELEASE

# Tests

- Command: cargo fmt --all --check → PASS
- Command: cargo clippy --workspace --all-targets → PASS (was FAIL: 2 deny errors)
- Command: cargo check --workspace → PASS
- Command: cargo test --workspace → PASS (343 passed, 2 ignored, 0 failed)
- Command: cargo tauri build --debug --no-bundle → PASS
- Command: pnpm run build → PASS (12 routes)
- Command: node --test tests/lib/*.test.mjs → 130 pass / 1 fail (qa-routes needs bun; pre-existing runner mismatch)
- Command: node tests/contract/audit.mjs → 80 passed, 0 violations, 1 note
- Command: node --test tests/lib/updater-regression.test.mjs → 6/6 PASS
- Command: node --test tests/lib/analytics-regression.test.mjs → 5/5 PASS
- Command: pnpm run lint (source-only) → 128 errors / 153 warnings (pre-existing; zero new from Phase 1)
- Command: bun test → NOT AVAILABLE on this Windows host (bun wrapper incompatible)

# Known Problems

- Frontend source lint debt: 128 errors / 153 warnings (pre-existing; deferred to a quality phase)
- Bun-only test suites cannot run on this machine (NOT AVAILABLE; semantics unchanged)
- Parakeet v3 models + ffmpeg binaries hosted on upstream infra (MUST MIGRATE BEFORE RELEASE)
- Updater/analytics regression gates are bun/node-only; CI should run node gates

# Next Exact Step

1. Commit the final documentation updates (PRD/Architecture/Phases/Rules/CLAUDE/Memory).
2. Produce the Phase 1 report and await approval before Phase 2.

# Blockers

- None.
