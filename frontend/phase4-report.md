# Phase 4 Final Closure Report — Recording Experience

**Date:** 2026-09-11
**Branch:** `phase/4-recording-experience`
**Base:** `c1197a8` (Phase 3 final main)

## Summary

Completed the full Phase 4 scope: honest recording workspace (no fake audio visualization), truthful timer, provider-aware model readiness (Local Whisper fully independent of Parakeet), hardened stop flow (no data loss on transcription timeout), sorted device/permission UX, and 32 regression tests. No capture backends were added.

## Commits

Pending — this report is written before the branch is committed/pushed. Suggested structure:

```
chore: start Phase 4 branch state
refactor(recording): unify readiness and recording state
feat(recording): redesign truthful recording workspace
fix(recording): harden stop errors and recovery
test(recording): add Phase 4 lifecycle regressions
docs: record Phase 4 verification
```

## Rust: VAD Panic Elimination

`audio/pipeline.rs` — `AudioPipeline::new` now returns `Result<Self>`.

- VAD-backed path: `ContinuousVadProcessor::new(...)` wrapped in a `match` — `Err(e)` returns `Err(anyhow!(...))` instead of `panic!`.
- Non-VAD path uses fallible time-based accumulation the same way.
- Call site updated: `AudioPipeline::new(...)?` (record_manager) propagates the error to the caller instead of crashing the app.
- `grep -r "panic!(" src/audio/pipeline.rs` → no matches.
- No warnings introduced by this change (clippy only reports the pre-existing identical-branches note at the redemption-time `cfg!` on line 788, untouched).

## Frontend: Recording Lifecycle

### End state - single source of truth

`RecordingStateContext` owns recording state (`isRecording`, `recordingDuration`, `status`, etc.) plus the new `isRecordingDisabled`/`setIsRecordingDisabled` pair. The deleted `hooks/useRecordingStateSync.ts` no longer exists as a competing writer. `page.tsx` derives everything from the context; `useRecordingStart`/`useRecordingStop` no longer accept/return state setters — they read from and write back through `useRecordingState()`.

### Start

`useRecordingStart(showModal?)` — one orchestration path for manual/auto/direct:

- Provider-aware readiness: source is `transcriptModelConfig.provider`; adapter looked up via `getReadinessAdapter(provider, readinessAdapters)` (a `provider in adapters` guard, no fallthrough); readiness text from `resolveTranscriptionReadiness(provider, adapter)`.
- **Provider independence:** the readiness check uses only the *configured provider's* adapter. With Local Whisper configured, Parakeet's readiness is never consulted. Covered by regression tests.
- Explicit status transitions: `STARTING` → `RECORDING` (or `ERROR`); transition to `ERROR` replaces the previous silent IDLE reset.
- Failure surfaces as a toast (sonner), not `alert()`.

### Stop

`useRecordingStop()` — hardened:

- Waits for the `recording-stopped` payload: `waitForStoppedPayloadValue(key, 2500)` polls sessionStorage (`last_recording_folder_path` / `last_recording_meeting_name`) every 150ms to absorb the IPC race where the backend committed the audio but the payload had not yet landed.
- **Data-loss fix:** SQLite save is gated by `shouldSaveMeetingAfterStop(isCallApi)`, which returns `stopSucceeded`. The old gate (`isCallApi && transcriptionComplete == true`) orphaned the meeting text when live transcription timed out or failed: it set IDLE without saving, even though the backend had already finalized the audio.
- `folderPath` is `let` and tolerates an initially-null payload via the wait above.

### Readiness module

`lib/recordingReadiness.ts` — pure, no Tauri imports; regression-testable. Exports `RecordingProvider`, `ReadinessAdapter`, `ReadinessAdapters`, `isSupportedProvider`, `getReadinessAdapter`, `statusIsDownloading`, `isModelDownloading`, `resolveTranscriptionReadiness`, `shouldSaveMeetingAfterStop`. The save decision is a pure function of stop success.

## Frontend: Recording Workspace Truthfulness

### Fake visualization removed

- `page.tsx`: `barHeights` and `Math.random()` gone; the fake bar rendering path deleted.
- `RecordingControls.tsx`: visualizer props removed; no `background-image`/`animate-pulse` bar facade remains.
- No simulated audio levels anywhere in the flow. Real level monitoring exists in Rust but is deliberately NOT wired (the available `simple_level_monitor` is a sine-wave stub and the real monitor overlaps capture — double-capture risk).

### Timer is the backend's number

Definition of truth: `recordingState.recordingDuration ?? 0` → `formatTime(...)` → tabular-nums. The pill never increments a frontend-only clock on a second source. `REC ${displayed}` while recording, `PAUSED ${displayed}` when paused.

### Controls

Start / Pause / Resume / Stop with duplicate-start protection:

- Start disabled while `isStarting || isRecordingDisabled || status === RecordingStatus.STARTING`.
- Buttons carry distinct `aria-label`; `role="status"` + `aria-live="polite"` status region; live indicator pings under `motion-safe`, static under `motion-reduce` (also `animate-pulse` removed from the recording indicator).
- No `alert()` in the normal flow (page, RecordingControls, useRecordingStart, useRecordingStop).

### Permission + device UX

- `usePermissionCheck`: renamed from permission-pretending to *device counting*. New `PermissionStatus.deviceStatus` (`checking` | `available` | `degraded`) and truthful `message` copy. It never claims to query the OS permission grant — the frontend cannot; it counts devices via `get_audio_devices` and, on Windows, reports the real WASAPI enumeration result. `requestPermissions` invokes the real `trigger_microphone_permission` command (handled by `trigger_audio_permission`, lib.rs) and re-checks after ~1s.
- `DeviceSelection`: removed the commented Test-Mic block, the `AudioLevelMeter` import, and all monitoring machinery (`audioLevels`/`isMonitoring`/`start_audio_level_monitoring` listener). Honest empty states ("No microphones detected. Connect a microphone or grant microphone access, then refresh." / "No system audio devices detected. You can still record with your microphone."). Refresh button carries `aria-label="Refresh audio devices"`. Keeps the audio-backend selector.
- `PermissionWarning`: no more BlackHole claim, no "Screen Recording Permission" claim, no amber. macOS default system capture is CoreAudio process taps (cidre `with_mono_global_tap`), verified in `audio/capture/core_audio.rs`; ScreenCaptureKit is a listed alternative descriptor but not the active default. Uses `border-destructive/40 bg-destructive/5 text-muted-foreground` semantic styling; keeps the macOS microphone settings deep link (invokes `open_system_settings`) and Recheck; Linux gating preserved via `useIsLinux`.

## Design + A11y

- Semantic tokens throughout the touched files (`bg-background`, `bg-surface`, `border-border`, `text-muted-foreground`, `bg-warning`, `bg-destructive`, `border-destructive/40`, `bg-destructive/5`). No hardcoded gray/white added.
- Focus-visible rings on interactive elements; verbal aria labels instead of generic "toggle".
- Reduced motion honored: motion only under `motion-safe:`.

## Tests

**New suite:** `tests/lib/phase4-recording-experience.test.mjs` — 32 tests PASS.

Required coverage implemented (per plan):

1. Readiness module: exports, `getReadinessAdapter` guard (falls back cleanly, never consults `adapters[unknown]`), `resolveTranscriptionReadiness` single-adapter path — asserts Local Whisper stays ready independent of Parakeet's `modelDownloaded`/not-found state.
2. `useRecordingStart` provider-aware strings (Local Whisper vs Parakeet readiness copy).
3. `shouldSaveMeetingAfterStop(stopSucceeded)` returns stop success directly.
4. Stop hook: save gated on `isCallApi ? stopSucceeded : true`; no old `transcriptionComplete === true` gate; saves `last_recording_folder_path` too; `waitForStoppedPayloadValue` present.
5. No `barHeights` / `Math.random` in page.tsx or RecordingControls.tsx.
6. Truthful timer: no fake seconds increment branch; `formatTime(recordingState.recordingDuration ?? 0)`; `REC ` prefix; `tabular-nums`.
7. No `alert(` in page.tsx, RecordingControls.tsx, useRecordingStart.ts, useRecordingStop.ts.
8. usePermissionCheck: exports `DeviceAvailability`, `deviceStatus` claims states, never claims "permission granted".
9. DeviceSelection + PermissionWarning: truthful empty-state copy (BlackHole absent, "Screen Recording" absent, no amber classes), semantic token presence.
10. Single source of truth: `useRecordingStateSync.ts` deleted + no imports; `RecordingStateContext` owns `isRecordingDisabled`; both hooks have no setter parameters.
11. RecordingControls: `role="status"`, `aria-live="polite"`, start/stop `aria-label`, `focus-visible:ring`, `bg-warning` pause state.
12. Rust no-panic: pipeline.rs contains an `impl AudioPipeline` whose `new` returns `Result<Self>` and a call site ending `)?;` within the 600-char window.

## Gates

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm run build` | Compiled successfully |
| Phase 4 tests (`phase4-recording-experience.test.mjs`) | 32/32 PASS |
| Phase 3 tests (`phase3-shell-home.test.mjs`) | PASS |
| Design system regression | PASS (20/20) |
| Updater regression | PASS |
| Analytics regression | PASS |
| `.mjs` suite total | 214 pass / 1 fail (pre-existing bun-only `qa-routes.test.mjs`) |
| `cargo fmt --all --check` | PASS |
| `cargo check --offline` | PASS (pre-existing warnings only) |
| `cargo clippy --offline --all-targets` | PASS, 0 errors (only pre-existing warnings; no warnings from the VAD change) |
| `cargo test --offline` | 340 lib passed, 0 failed, 2 ignored (+1 doc test passed) |
| `cargo build --offline` (debug) | PASS (recall.exe linked) |
| Native visual QA | NOT AVAILABLE (Windows CLI host) |
| macOS recording QA | NOT AVAILABLE (no macOS in this environment) |
| Bun | NOT AVAILABLE on Windows (`.test.ts` suites cannot run) |

## Known Issues (carried/verified pre-existing)

1. `simple_level_monitor.rs` is a fake sine-wave stub; the real `level_monitor.rs` is not wired. Deliberately not wired (double-capture risk). Real, truthful levels remain future work.
2. Frontend can't query OS permission grant states; honesty is maintained by phrasing device-counting as exactly that.
3. `chunk-drop-warning` event expected by the frontend listener does not exist in Rust (harmless; out of scope).
4. Native visual QA requires a GUI session (NOT AVAILABLE from CLI).
5. Bun-only `.test.ts` suites not runnable on Windows.
6. Per-meeting summary failure attention signals still deferred (Phase 3 carry-over).
7. TemplateEditor / SummaryTemplateManager hardcoded gray deferred (Phase 2 carry-over).
8. `cargo clippy` still logs pre-existing build-script warnings (`build/ffmpeg.rs` unused `std::io::Read`, `Iterator::last`) and the identical-branches `cfg!` note in pipeline.rs (untouched).

## Recommended Phase 5

Meeting Workspace + Provenance per Phases.md.

Do not implement Phase 5.

---

Phase 4 closure is complete. The Phase 4 branch is not yet pushed. I have not merged Phase 4 into main. I have not started Phase 5. Awaiting approval.