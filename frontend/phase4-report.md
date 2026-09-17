# Phase 4 Final Closure Report — Recording Experience

**Date:** 2026-09-17
**Branch:** `phase/4-recording-experience`
**Base:** `c1197a8` (Phase 3 final main)

## Summary

Completed the full Phase 4 scope: honest recording workspace (no fake audio visualization), truthful timer, **selected-model-aware readiness** (Local Whisper fully independent of Parakeet; unrelated downloads do not block the configured model; missing selected model is explicit; corrupted selected model is surfaced), hardened stop flow with backend-truth reconciliation (no data loss on transcription timeout, no fake finalization on genuine stop failure), sorted device/permission UX with mount-time enumeration, recovery UX hardened (no browser dialogs), and **52 static + 25 behavioral regression tests**. No capture backends were added.

## Commits

```
11da2d7 refactor(recording): unify readiness and recording state
0e1260f feat(recording): redesign truthful recording workspace
7eae467 fix(recording): honest permission and device detection UX
9321666 fix(audio): propagate VAD init errors instead of panicking
584f9b0 test(recording): add Phase 4 lifecycle regressions
ba8793e docs: record Phase 4 verification
```

**Phase 4 closure corrections (already pushed to `phase/4-recording-experience`):**

```
c34a590 fix(recording): close Phase 4 readiness and refresh-state gaps
3e01a60 fix(recording): finish recovery and recording-status UX
df60339 test(recording): harden Phase 4 closure regressions
678251d docs: finalize Phase 4 closure accuracy
```

*A final documentation-only accuracy follow-up was made after `678251d`; see the current Phase 4 branch HEAD (`678251d..<new-doc-sha>`).*

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

### Refresh / bootstrap reconciliation (closure)

On WebView refresh, `RecordingStateContext.syncWithBackend` calls `reconcileRecordingSnapshot(frontendSnapshot, backendState)`:

- Active backend recording (`is_recording: true`) is restored: status becomes `recording`, backend `recording_duration`/`active_duration` and pause state are adopted, and the single backend poller resumes (`needsPoll: true`).
- Backend stopped (`is_recording: false`): frontend lifecycle statuses `stopping` / `processing` / `saving` are **preserved** (so a page refresh during finalization does not drop the recording into `idle`); other statuses fall back to `idle`. Durations fall back to the frontend's current values when backend reports null.
- `SidebarProvider` bridges active state via `isMeetingActive = isRecording || meetingActiveOverride` (the override is set only by the explicit setter; the context value shape is unchanged).

### Start

`useRecordingStart(showModal?)` — one orchestration path for manual/auto/direct:

- **Selected-model-aware readiness**: source is `transcriptModelConfig.provider` + `transcriptModelConfig.model`; adapter looked up via `getReadinessAdapter(provider, readinessAdapters)` (a `provider in adapters` guard, no fallthrough); readiness computed by `resolveTranscriptionReadiness(provider, selectedModel: string | null, adapter)`.
- **Provider independence**: the readiness check uses only the *configured provider's* adapter. With Local Whisper configured, Parakeet's readiness is never consulted. Covered by regression tests.
- **Model independence within provider**: unrelated model downloads do not block the selected available model; another available model cannot hide a missing selected model; corrupted selected model is surfaced explicitly as `corrupted` (setup required), never treated as `missing`.
- Explicit status transitions: `STARTING` → `RECORDING` (or `ERROR`); transition to `ERROR` replaces the previous silent IDLE reset.
- Failure surfaces as a toast (sonner), not `alert()`.

### Stop

`useRecordingStop()` — hardened with backend-truth reconciliation:

- Waits for the `recording-stopped` payload: `waitForStoppedPayloadValue(key, 2500)` polls sessionStorage (`last_recording_folder_path` / `last_recording_meeting_name`) every 150ms to absorb the IPC race where the backend committed the audio but the payload had not yet landed.
- **Stop outcome reconciliation** (`resolveStopOutcome(nativeStopSucceeded, backendIsRecording)`):
  - Native stop succeeded → `finalized` (save runs).
  - Native invoke failed + backend reports stopped → `finalized` (partial failure; continue finalization/save).
  - Native invoke failed + backend still recording → `recording-still-active` (genuine failure: restore `RECORDING`, surface toast "The recording is still active. Try stopping again.", allow retry; **do not fake finalization**).
  - Native invoke failed + backend unqueryable → `recording-still-active` (fail-safe; do not finalize).
- **Save gate**: `shouldSaveMeetingAfterStop(stopSucceeded)` — returns `stopSucceeded` (true = save, false = do not save). The old gate (`isCallApi && transcriptionComplete == true`) orphaned the meeting text when live transcription timed out; now any successful stop finalizes and saves even if live transcription timed out.
- `folderPath` is `let` and tolerates an initially-null payload via the wait above.

### Readiness module (closure)

`lib/recordingReadiness.ts` — pure, no Tauri imports; regression-testable under `node --experimental-strip-types`. Exports:

- `RecordingProvider`, `ReadinessAdapter`, `ReadinessAdapters`
- `isSupportedProvider`, `getReadinessAdapter`, `statusIsDownloading`, `isModelDownloading`
- `resolveTranscriptionReadiness(provider, selectedModel: string | null, adapter)` — **single adapter, selected model gates**
- `modelStatusToReadiness`, `isStatusCorrupted`
- `reconcileRecordingSnapshot` — pure bootstrap reconciliation (see above)
- `resolveStopOutcome` — pure stop outcome logic (see above)
- `deriveDeviceStatusFromDevices`, `deriveDeviceStatusFromError`
- `shouldSaveMeetingAfterStop(stopSucceeded)` — pure save decision
- `ReadinessState` includes `'corrupted'`; `ReadinessReport` includes `model?: string`

All decision logic is provider-scoped and model-scoped; no cross-provider leakage.

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

- `usePermissionCheck`: rewritten for honesty. `checkPermissions` is a stable `useCallback(async () => {...}, [])` and runs an **initial mount check** via:
  ```tsx
  useEffect(() => {
    void checkPermissions();
  }, [checkPermissions]);
  ```
  It never claims to query the OS permission grant — the frontend cannot; it counts devices via `get_audio_devices` and, on Windows, reports the real WASAPI enumeration result. Returns `{ hasMicrophone, hasSystemAudio }`. `requestPermissions` invokes the real `trigger_microphone_permission` command (handled by `trigger_audio_permission`, lib.rs) and re-checks after ~1s.
- `DeviceSelection`: removed the commented Test-Mic block, the `AudioLevelMeter` import, and all monitoring machinery. Honest empty states ("No microphones detected. Connect a microphone or grant microphone access, then refresh." / "No system audio devices detected. You can still record with your microphone."). Refresh button carries `aria-label="Refresh audio devices"`. Keeps the audio-backend selector.
- `PermissionWarning`: no more BlackHole claim, no "Screen Recording Permission" claim, no amber. macOS default system capture is CoreAudio process taps (cidre `with_mono_global_tap`), verified in `audio/capture/core_audio.rs`; ScreenCaptureKit is a listed alternative descriptor but not the active default. Uses `border-destructive/40 bg-destructive/5 text-muted-foreground` semantic styling; keeps the macOS microphone settings deep link (invokes `open_system_settings`) and Recheck; Linux gating preserved via `useIsLinux`.
- **Home pre-recording remediation**: `HomeDashboard` shows a compact microphone preflight strip above the hero buttons — "Checking microphone…" / "Microphone available" (+ "System audio is optional — mic-only recording is supported.") / "Microphone unavailable" or "Could not check devices — microphone access may be required" with Recheck + Request Access buttons.
- **Device derivation** is pure: `deriveDeviceStatusFromDevices(devices[])` and `deriveDeviceStatusFromError()` — used by `usePermissionCheck` for truthful `deviceStatus` (`checking` | `available` | `degraded`) and `message` copy.
- System audio absence remains non-blocking.

## Design + A11y

- Semantic tokens throughout the touched files (`bg-background`, `bg-surface`, `border-border`, `text-muted-foreground`, `bg-warning`, `bg-destructive`, `border-destructive/40`, `bg-destructive/5`). No hardcoded gray/white added.
- Focus-visible rings on interactive elements; verbal aria labels instead of generic "toggle".
- Reduced motion honored: motion only under `motion-safe:`.
- **Recording-only surfaces cleanup**: `RecordingStatusBar`, `StatusOverlays`, `TranscriptPanel`, `VirtualizedTranscriptView` (recording-empty/listening/loading states) use semantic tokens + `motion-reduce:animate-none` guards. `TranscriptSegment` history styling intentionally left unchanged.

## Recovery UX hardening (closure)

`TranscriptRecovery` — final closure state:

- No `alert()` / `confirm()` browser dialogs anywhere in the recovery flow.
- Recovery failure: persistent application-native **destructive `Alert`** ("The recoverable meeting is still intact…"), dialog stays open, source data preserved.
- Delete: **two-step in-dialog confirmation** — first click arms `deleteConfirmFor` (shows "This removes the recoverable meeting data and cannot be undone." with Keep / Delete permanently), second click executes; footer adapts (Cancel in confirm mode, Cancel/Delete…/Recover otherwise).
- Busy spinners guarded with `motion-reduce:animate-none`.
- Audio availability indicators use `text-success`/`text-warning` tokens.

## Timer / status surfaces (closure)

- **RecordingStatusBar** uses the canonical `recordingDuration` (never `activeDuration` or local `isRecording`). Entry animation and recording pulse respect reduced motion (opacity-only + duration 0 when reduced). Tokens: `bg-surface`, `border-border`, `bg-warning` (paused) / `bg-destructive` (recording) with `motion-safe:animate-pulse motion-reduce:animate-none`. Label `REC`/`Paused` + `formatDuration`.
- **StatusOverlays**: `bg-background border-border text-foreground`, spinner `border-2 border-border border-t-foreground animate-spin motion-reduce:animate-none`.
- **TranscriptPanel**: container `border-r border-border bg-background`, sticky header `bg-background p-4 border-border`.
- **VirtualizedTranscriptView**: recording-only states (empty, listening, loading) use semantic tokens + `motion-reduce:animate-none`; `TranscriptSegment` gray-* history styling intentionally left (lines 89/101/102/105).

## Tests

**Static/source-regression suite:** `tests/lib/phase4-recording-experience.test.mjs` — **52/52 PASS**.

**Behavioral pure-logic suite:** `tests/lib/phase4-recording-behavior.mjs` — **25/25 PASS** (run with `node --experimental-strip-types --test tests/lib/phase4-recording-behavior.mjs`; kept out of the default `tests/lib/*.test.mjs` glob so plain `node --test` totals stay green).

The behavioral suite **actually executes** the pure decision logic in `recordingReadiness.ts` with fake adapters and model inventories:

1. **Selected-model readiness matrix**: Local Whisper A available + Parakeet B missing → READY for A (providers independent); Local Whisper A missing + Whisper B available → NOT READY for A (unrelated model must not mask); Local Whisper A available + Whisper B downloading → READY for A; Parakeet A downloading + Parakeet B available → DOWNLOADING A (selected model wins); selected model corrupted → CORRUPTED (never treated as missing); configured model not found → explicit MISSING with the configured name; no selected model → any-available-model fallback; adapter init/list errors → ERROR.
2. **Model status mapping**: `modelStatusToReadiness` maps every backend status shape (`Available`, `Missing`, `{Downloading}`, `{Corrupted}`, `{Error}`, `undefined`) to the correct readiness state.
3. **Refresh/reconcile logic**: `reconcileRecordingSnapshot` — backend recording adopts durations + polling; backend stopped preserves `stopping`/`processing`/`saving`; durations fall back to frontend values on null.
4. **Stop outcome logic**: `resolveStopOutcome` — 4 cases covering success, partial failure, genuine failure, and unqueryable backend (fail-safe).
5. **Save gate**: `shouldSaveMeetingAfterStop(stopSucceeded)` — pure boolean mirror of stop success.
6. **Device derivation**: `deriveDeviceStatusFromDevices` (both/only-system/none) and `deriveDeviceStatusFromError` — honest messages, no permission pretense.
7. **Provider/adapter helpers**: `isSupportedProvider` (parakeet/localWhisper only), `getReadinessAdapter` (selected adapter or null).

The static suite asserts **source patterns** (e.g., mount effect `useEffect(() => { void checkPermissions(); }, [checkPermissions])` pinned by exact string, no `alert`/`confirm` in 5 files, single poller pattern `clearInterval(pollingIntervalRef.current)`, `RecordingStatusBar` uses `recordingDuration` not `activeDuration`, etc.) and **does not render React** — it complements the behavioral suite.

Required coverage implemented (per plan) across both suites:

1. Readiness module: exports, `getReadinessAdapter` guard, `resolveTranscriptionReadiness` single-adapter + selected-model path — asserts Local Whisper stays ready independent of Parakeet.
2. `useRecordingStart` selected-model-aware strings (Local Whisper vs Parakeet readiness copy).
3. `shouldSaveMeetingAfterStop(stopSucceeded)` returns stop success directly.
4. Stop hook: save gated on `stopSucceeded` via `shouldSaveMeetingAfterStop`; `waitForStoppedPayloadValue` present; `resolveStopOutcome` reconciliation; genuine failure restores `RECORDING` with retry toast.
5. No `barHeights` / `Math.random` in page.tsx or RecordingControls.tsx.
6. Truthful timer: no fake seconds increment branch; `formatTime(recordingState.recordingDuration ?? 0)`; `REC ` prefix; `tabular-nums`.
7. No `alert(` in page.tsx, RecordingControls.tsx, useRecordingStart.ts, useRecordingStop.ts, TranscriptRecovery.tsx.
8. usePermissionCheck: `checkPermissions` is `useCallback` + mount effect; returns `{hasMicrophone, hasSystemAudio}`; never claims "permission granted".
9. DeviceSelection + PermissionWarning: truthful empty-state copy, semantic tokens.
10. Single source of truth: `useRecordingStateSync.ts` deleted; `RecordingStateContext` owns `isRecordingDisabled`; hooks have no setter params; bootstrap reconciliation; single poller; sidebar bridge.
11. RecordingControls: `role="status"`, `aria-live="polite"`, start/stop `aria-label`, `focus-visible:ring`, `bg-warning` pause state.
12. Rust no-panic: pipeline.rs `AudioPipeline::new` returns `Result<Self>`; call site propagates with `?`.

## Gates

All results below are **local/agent verification** — no GitHub Actions workflow runs are attached to the current Phase 4 HEAD.

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm run build` | PASS (Compiled successfully) |
| Phase 4 static tests (`phase4-recording-experience.test.mjs`) | 52/52 PASS |
| Phase 4 behavioral tests (`phase4-recording-behavior.mjs` under `--experimental-strip-types`) | 25/25 PASS |
| Phase 3 tests (`phase3-shell-home.test.mjs`) | 32/32 PASS |
| Design system regression | PASS (20/20) |
| Updater regression | PASS (5/5) |
| Analytics regression | PASS (5/5) |
| `.mjs` suite total | 234 pass / 1 fail (pre-existing bun-only `qa-routes.test.mjs`) |
| Contract audit | 80 pass / 0 violations |
| `cargo fmt --all --check` | PASS |
| `cargo check --offline` | PASS (pre-existing warnings only) |
| `cargo clippy --offline --all-targets` | PASS (warnings only, 0 errors; no new warnings from Phase 4 edits) |
| `cargo test --offline` | 340 lib passed, 0 failed, 2 ignored (+1 doc test passed) |
| `cargo build --offline` (debug) | PASS (recall.exe linked) |
| Native GUI / Windows recording workflow QA | NOT PERFORMED (Windows CLI host only; `cargo build` is native build verification, NOT GUI workflow QA) |
| macOS recording workflow QA | NOT AVAILABLE (no macOS in this environment) |
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

Phase 4 closure corrections are complete and published. Main remains unchanged at `c1197a8`. I have not merged Phase 4 into main. I have not started Phase 5. Awaiting approval.