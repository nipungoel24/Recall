# Recall — Physical Desktop QA Handoff & Release Verification Checklist

**Date:** 2026-10-11  
**Target Release:** Recall v0.4.0  
**Branch:** `phase/5-meeting-workspace-provenance`  
**Host Environment:** Physical desktop workstation (Windows 11 / macOS Sequoia / Ubuntu 24.04) with display server, physical microphone, and speaker/loopback output.

> [!IMPORTANT]
> The automated CI and terminal test suites cannot evaluate physical hardware interactions (microphone audio capture, real sound card drivers, display server compositor behavior, or OS tray integration). Human operators must execute this checklist on physical hardware before public release authorization. Do NOT mark any test as PASS without executing it on physical hardware.

---

## Summary Matrix

| Test ID | Area | Target OS | Status | Operator / Evidence |
|---|---|---|---|---|
| **QA-01** | Clean Installation & First Launch | Win / Mac / Linux | **NOT RUN** | Pending physical desktop installer execution |
| **QA-02** | Theme Rendering & Pre-Paint Bootstrap | Win / Mac / Linux | **NOT RUN** | Pending visual inspection for white flash / contrast |
| **QA-03** | Microphone Selection & Permission UX | Win / Mac / Linux | **NOT RUN** | Pending physical hardware device enumeration |
| **QA-04** | Start/Stop Recording & Live Metering | Win / Mac / Linux | **NOT RUN** | Pending physical microphone audio capture |
| **QA-05** | Audio Persistence & Transcription | Win / Mac / Linux | **NOT RUN** | Pending end-to-end transcription on disk |
| **QA-06** | Transcript Virtualization & Evidence Navigation | Win / Mac / Linux | **NOT RUN** | Pending scroll and evidence jump test |
| **QA-07** | Notes Save/Reload Persistence | Win / Mac / Linux | **NOT RUN** | Pending BlockNote editor save & reload check |
| **QA-08** | Context Memory Repetition Behavior | Win / Mac / Linux | **NOT RUN** | Pending repetition count increment test |
| **QA-09** | System Tray Shutdown & Sidecar Cleanup | Win / Mac / Linux | **NOT RUN** | Pending process tree inspection during Quit |
| **QA-10** | Filesystem Restrictions & IPC Confinement | Win / Mac / Linux | **NOT RUN** | Pending packaged runtime path-traversal audit |

---

## Detailed Test Specifications

### QA-01: Clean Installation and First Launch
- **Prerequisites:** Clean target machine with no prior `%APPDATA%\com.meetily.ai` (or equivalent) database, or database backed up. Packaged installer (`.msi`, `.dmg`, or `.deb`).
- **Steps:**
  1. Run the installer package and complete installation into default directory.
  2. Launch Recall from application menu / shortcut.
  3. Observe initial window appearance, splash, and window dimensions (default 1100x700).
- **Expected Outcome:** Application opens cleanly without crashes, runtime missing DLL/dylib warnings, or database initialization errors. Database and folders are created under the sandboxed application data directory.
- **Evidence to Record:** Screenshot of clean first launch home dashboard; installer log; confirmation of created folders.
- **Pass/Fail Criteria:** PASS if window opens, loads Home view, and creates database. FAIL if crash, missing shared library, or broken layout.
- **Status:** **NOT RUN**

### QA-02: Theme Rendering & Pre-Paint Bootstrap
- **Prerequisites:** System display set to Dark Mode, then Light Mode.
- **Steps:**
  1. Set OS theme to Dark. Launch application. Observe first frame rendering.
  2. Open Settings. Toggle theme from Dark to Light, then Light to Dark.
  3. Restart application.
- **Expected Outcome:** No white flash on startup in dark mode (inline pre-paint bootstrap executes before DOM paint). Theme persists across restarts. All text meets WCAG AA contrast (4.5:1 for body, 3:1 for headings/badges).
- **Evidence to Record:** Screen recording of startup in dark mode showing 0 frames of white flash; theme toggle screenshots.
- **Pass/Fail Criteria:** PASS if zero white flash and theme persists. FAIL if white flash occurs or theme resets on reload.
- **Status:** **NOT RUN**

### QA-03: Microphone Selection & Permission Behavior
- **Prerequisites:** Workstation with at least one active physical microphone and one loopback/system audio source.
- **Steps:**
  1. Open Settings > Audio / Devices.
  2. Inspect enumerated input devices.
  3. Disconnect/reconnect microphone or toggle OS microphone permissions in system settings.
- **Expected Outcome:** Physical devices enumerate with real friendly names. Revoking OS microphone permission shows honest, non-destructive status banner (no misleading screen-recording or third-party driver claims).
- **Evidence to Record:** Screenshot of device dropdown with actual hardware names; screenshot of permission revoked warning banner.
- **Pass/Fail Criteria:** PASS if real devices appear and permission changes reflect honestly without crashing. FAIL if device list is empty when hardware is present or generic alert popups appear.
- **Status:** **NOT RUN**

### QA-04: Start/Stop Recording & Live Metering
- **Prerequisites:** Microphone active and selected.
- **Steps:**
  1. Click "Start Recording" on Home or Sidebar.
  2. Speak clearly into the microphone for 30 seconds.
  3. Pause recording, wait 5 seconds, resume recording.
  4. Click "Stop Recording".
- **Expected Outcome:** Live waveform / audio meter reacts proportionally to voice amplitude. Elapsed recording timer increments monotonically from backend audio duration without skipping or drifting. Toast notifications appear via Sonner. No browser `alert()` or `confirm()` dialogs appear.
- **Evidence to Record:** Audio level meter visual confirmation; recording timer monotonic progression timestamp; toast message text.
- **Pass/Fail Criteria:** PASS if metering moves with voice, timer is truthful, and stop transitions cleanly to processing state. FAIL if meter remains flat while speaking or save fails silently.
- **Status:** **NOT RUN**

### QA-05: Audio Persistence & Transcription
- **Prerequisites:** Successful completion of QA-04 recording.
- **Steps:**
  1. After stopping recording, wait for transcription pipeline to process audio (using selected Local Whisper or Parakeet model).
  2. Check file system under `%APPDATA%\com.meetily.ai\recordings` (or equivalent).
  3. Verify WAV file exists and can be played via native audio player.
  4. Verify meeting details view populates with transcription segments.
- **Expected Outcome:** Master audio file is finalized cleanly on disk (16kHz mono WAV). Transcription generates accurate text segments with valid start and end timestamps. Audio player inside Recall plays back the audio using confined IPC `read_audio_file`.
- **Evidence to Record:** Audio file path and size; excerpt of generated transcript text; audio playback confirmation.
- **Pass/Fail Criteria:** PASS if audio file is non-empty, playable, and transcript segments accurately reflect speech. FAIL if audio is corrupted/truncated or transcript fails to generate.
- **Status:** **NOT RUN**

### QA-06: Transcript Virtualization & Evidence Navigation
- **Prerequisites:** Meeting with at least 50+ transcript segments and generated meeting intelligence.
- **Steps:**
  1. Open Meeting Workspace for the meeting.
  2. Navigate to Overview or Tasks tab.
  3. Click an evidence affordance badge on an action item or decision.
  4. Observe workspace tab transition and scroll behavior.
  5. In Transcript tab, scroll rapidly through all segments.
- **Expected Outcome:** Clicking evidence switches active tab to Transcript, scrolls smoothly to the referenced segment, and applies a temporary highlight without layout jump (auto-expires in 3000ms). Virtualized transcript maintains high frame rate (60fps) without blank frames.
- **Evidence to Record:** Video or sequence of screenshots showing click on evidence badge -> transcript tab switch -> highlighted segment.
- **Pass/Fail Criteria:** PASS if evidence navigates to the exact segment and highlights without layout shift. FAIL if wrong segment is focused, virtualization crashes, or layout jumps.
- **Status:** **NOT RUN**

### QA-07: Notes Save/Reload Persistence
- **Prerequisites:** Any existing meeting.
- **Steps:**
  1. Open Meeting Workspace > Notes tab.
  2. Enter structured notes (heading, bullet points, checklist).
  3. Click "Save Notes". Verify Sonner success toast appears.
  4. Navigate away to Home or Calendar, then return to Meeting Workspace > Notes.
- **Expected Outcome:** Notes reload with identical markdown and block structure. No data is lost. Save button disables while saving and shows "Saving...".
- **Evidence to Record:** Screenshot of notes before save; screenshot after reloading workspace.
- **Pass/Fail Criteria:** PASS if saved notes match reloaded notes exactly. FAIL if notes are lost, reset, or raw alert popups appear.
- **Status:** **NOT RUN**

### QA-08: Context Memory Repetition Behavior
- **Prerequisites:** Context thread created; two recorded meetings discussing overlapping topics.
- **Steps:**
  1. Add Meeting 1 to Context thread. Generate intelligence and memory items.
  2. Record or add Meeting 2 discussing the same action item / decision.
  3. Re-run context refresh / deduplication.
  4. Inspect memory item repetition counter and priority score.
- **Expected Outcome:** Duplicated memory item has its repetition counter incremented (`repetition_count = 2`, capped at 5). Priority score increases by `+25%` per repetition. Deterministic tie-breaking orders highest score first.
- **Evidence to Record:** SQLite query output or UI display showing `repetition_count` value and increased priority score.
- **Pass/Fail Criteria:** PASS if repetition increments up to 5 and boosts score. FAIL if counter remains 1, exceeds 5, or score calculation yields NaN.
- **Status:** **NOT RUN**

### QA-09: System Tray Shutdown & Sidecar Cleanup
- **Prerequisites:** Application running; recording active or llama-helper sidecar loaded.
- **Steps:**
  1. Start a live recording.
  2. Without clicking stop, immediately right-click system tray icon and select "Quit" (or close window).
  3. Open Task Manager (Windows) or Activity Monitor (macOS).
  4. Inspect running processes for `Recall.exe`, `llama-helper.exe`, `ffmpeg.exe`.
- **Expected Outcome:** The bounded shutdown coordinator executes:
  - Active recording finalized/stopped within 20s.
  - `llama-helper` child process reaped within 8s.
  - SQLite WAL checkpointed within 5s.
  - Zero orphan background processes survive in Task Manager.
- **Evidence to Record:** Task Manager process list showing clean exit; shutdown log timestamps.
- **Pass/Fail Criteria:** PASS if all child processes and main process exit within 20 seconds with zero zombie processes. FAIL if `llama-helper` or `ffmpeg` remains running as an orphan.
- **Status:** **NOT RUN**

### QA-10: Filesystem Restrictions & IPC Confinement
- **Prerequisites:** Packaged application installed.
- **Steps:**
  1. Open DevTools in packaged build (if enabled) or inspect webview process capabilities.
  2. Attempt to invoke arbitrary file read outside application data directory via IPC.
  3. Attempt to load arbitrary `file://` or `http://` resources.
- **Expected Outcome:** Webview has zero filesystem plugin permissions. Path guard in Rust strictly rejects paths outside `%APPDATA%\com.meetily.ai`. CSP blocks external connections and scripts.
- **Evidence to Record:** Terminal or log showing path guard rejection error message for out-of-sandbox path.
- **Pass/Fail Criteria:** PASS if path traversal is blocked and sandbox is strictly confined. FAIL if out-of-sandbox file is read or written.
- **Status:** **NOT RUN**
