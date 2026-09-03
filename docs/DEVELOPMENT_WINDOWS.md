# Recall — Windows Development Runbook

All commands below were executed and verified on this machine (Windows 11,
Rust 1.90, Node 22, pnpm via corepack). Repository root:
`C:\Kaam_Dhanda\Projects\Recall`.

## Prerequisites

- Rust toolchain: `%USERPROFILE%\.cargo\bin` must be on PATH
  (`cargo 1.90.0`, `rustc 1.90.0`).
- Node.js 22 + corepack (pnpm 11 via `corepack pnpm`).
- `bun` for the frontend test suites: installed at
  `%USERPROFILE%\.bun\bin\bun.exe` (v1.3.14). The `bun` npm package inside
  node_modules is NOT usable on this machine; use the global one.
- Visual Studio 2022 Build Tools (MSVC) for the Rust build.
- Sidecar binaries must exist before launching:
  - `frontend/src-tauri/binaries/llama-helper-x86_64-pc-windows-msvc.exe`
  - `frontend/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe`
- `pnpm` is provided via corepack shims. If `tauri dev` reports
  `'pnpm' is not recognized`, create shims with:
  `corepack enable pnpm --install-directory <dir>` and put `<dir>` on PATH.

## Install / build

```powershell
cd frontend
corepack pnpm install --frozen-lockfile
corepack pnpm build          # static export (output: 'export')
```

## Rust gates (from repo root)

```powershell
cargo fmt --all -- --check
cargo check -p recall
cargo test -p recall        # 333+ passed
cargo check -p llama-helper
cargo test -p llama-helper   # 2 passed
```

The QA regression harness (path-includes live agent modules) runs separately:

```powershell
cd qa\rust-regression
cargo test                    # 104 passed
```

## Frontend tests (from frontend/)

```powershell
& "$env:USERPROFILE\.bun\bin\bun.exe" test tests/lib   # 197+ passed
node tests/contract/audit.mjs                          # 77+ passed, 0 violations
node tests/lib/calendar.test.mjs
node tests/lib/daily-timeline.test.mjs
node tests/lib/qa-calendar.test.mjs
node tests/lib/qa-daily-timeline.test.mjs
node tests/lib/qa-daily-navigation.test.mjs
node tests/lib/qa-template-schema.test.mjs
node tests/lib/qa-template-service.test.mjs
node tests/lib/context.test.mjs
```

## Run the desktop app (CPU)

```powershell
cd frontend
corepack pnpm tauri:dev:cpu    # == tauri dev (CPU-only whisper build)
```

GPU/other variants: `tauri:dev:cuda`, `tauri:dev:vulkan`, `tauri:dev:openblas`
(opt-in cargo features; not runtime-tested on this machine).

For browser-level debugging, launch with WebView2 remote debugging:

```powershell
set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
```

## Troubleshooting

- **`cargo` / `pnpm` not found from the launcher** — PATH of the spawned shell
  doesn't include `%USERPROFILE%\.cargo\bin` or corepack shims; prefix PATH in
  the launcher command.
- **`migration ... was previously applied but has been modified`** — sqlx
  checksum drift between an older DB and current migration files. Never blind-
  rewrite. Follow `docs/RECALL_MIGRATION_UPGRADE_GUIDE.md` (backup →
  structural verification → re-baseline verified rows only). New migrations
  must be added (never edited) and registered in
  `frontend/src-tauri/migrations/checksums.json`
  (`node tools/gen-migration-manifest.cjs` from repo root).
- **Onboarding welcome screen reappears** — the onboarding store file may have
  been clobbered; the race was fixed in `OnboardingContext` (auto-save only
  after status load). The file at
  `%APPDATA%\com.meetily.ai\onboarding-status.json` (Tauri identifier
  deliberately preserved across the Meetily → Recall rebrand) must be valid
  UTF-8 WITHOUT a BOM (`completed: true` for returning users).
- **whisper-rs**: pinned to 0.16.0. Windows defaults to CPU; CUDA/Vulkan are
  opt-in features. Do not casually change the version.
- **Next dev server dies / 404s while the Rust app lives** — rare during
  heavy probe-driven navigation; restart the whole `tauri:dev:cpu` stack.

## Data locations (Windows)

- App data / DB / models: `%APPDATA%\com.meetily.ai\` (SQLite:
  `meeting_minutes.sqlite`, models under `models\`). The Tauri identifier is
  intentionally preserved across the Meetily → Recall rebrand so existing
  user data keeps working with zero migration.
- Default recordings: `%USERPROFILE%\Music\recall-recordings` (fresh
  installs; pre-rename installs keep using `meetily-recordings` when that
  folder already exists)
