# Recall — Isolated Recording Smoke Test (manual, hardware)

Automated coverage lives in `frontend/src-tauri/src/tests_recording_e2e.rs`. It
uses **synthetic** audio and a **deterministic fake transcription provider**, so
it deliberately does **not** claim microphone-level end-to-end coverage.

This document covers the part automation cannot reach: real microphone capture,
a real local model, and real user-visible behaviour.

## Safety rules — read before running

1. **Never run this against your normal profile.** Use a throwaway OS account or
   a separate Windows user. The app stores everything under the per-user app-data
   directory, so a separate account gives you a genuinely empty install.
2. **Never point this at existing recordings.** The recovery flow deletes
   checkpoint folders for the session it finalizes. In a fresh profile there is
   nothing to lose.
3. If you must reuse a machine, record under a distinct Windows user so
   `%APPDATA%\com.meetily.ai` resolves elsewhere.
4. This test **records audio**. Do not run it in a meeting, a client call, or
   anywhere consent to recording is unclear.

## Prerequisites

- A built app (`cargo tauri build`) or a dev run (`pnpm tauri:dev:cpu` — CPU is
  fine for a smoke test and avoids a multi-GB model download).
- A transcription model already downloaded **in the fresh profile** (Settings →
  Speech-to-Text). The smallest Whisper model is sufficient.
- Ten minutes.

## Procedure

### 1. Verify the profile is empty

Open Settings and confirm the meetings list is empty and no recordings exist.
If anything is present, you are in the wrong profile — stop.

### 2. Grant microphone permission

macOS: System Settings → Privacy & Security → Microphone → enable Recall, then
restart the app. Windows: allow when prompted.

If your setup captures system audio too, grant that as well; otherwise leave
"system audio" off and record microphone only.

### 3. Record ~90 seconds of speech

Press **Start Recording**, then speak continuously for roughly 90 seconds. Use
varied content — a few sentences, a name, a date, a decision — so you have
something concrete to check. Confirm the level meter moves; if it does not, the
microphone was not granted and everything below will be meaningless.

### 4. Stop and watch the shutdown progress

Press **Stop Recording** and observe:

- the progress reaches **100%** before the meeting is created;
- the transcript streams in **while** it processes;
- the toast reports **success** only if the audio actually finalized.

### 5. Verify the transcript is COMPLETE

This is the check that matters most. Speak a recognisable phrase **at the very
end** of the recording — for example "the final marker is blue lantern".

Open the meeting and confirm that phrase is present.

**This specifically guards the defect fixed in `a68f502`:** the drain listener
used to be torn down before the transcription drain completed, so the tail of
every recording was silently discarded while the UI reported success. A
recording where the last thing you said is missing is exactly that bug.

### 6. Verify the saved audio

In the meeting folder under the app-data recordings directory, confirm:

- a non-zero audio file exists (the artifact must verify, not merely exist);
- `transcripts.json` exists and lists the segments;
- `metadata.json` exists.

A present-but-empty audio file means finalization failed and must be reported
as a failure, not a success.

### 7. Verify the terminal status

Before saving, the status must be truthful:

- a normal run → **completed**;
- stop during live transcription → **partial**, **cancelled**, or **timed out**,
  and the wording must not say "saved successfully".

### 8. Restart and reopen

Quit the app entirely and relaunch. Open the meeting and confirm the transcript,
timestamps, and audio playback sync still work.

### 9. Exercise failure and recovery

- Stop a recording and, while it is finalizing, quit the app via the tray Quit.
- Relaunch. A recovery prompt should offer the incomplete session.
- Confirm the recoverable audio can be recovered, and that **no other recording
  was deleted**.

### 10. Confirm no orphan sidecar remains

After quitting, check that no `llama-helper` process is left running. This
verifies the sidecar ownership fix in `b2fc732`.

## Recording the result

Capture, for each step:

- what you observed, and
- what you expected.

Mark any step that cannot be completed as **NOT RUN** rather than passing it.
A platform that was not exercised must never be reported as verified.