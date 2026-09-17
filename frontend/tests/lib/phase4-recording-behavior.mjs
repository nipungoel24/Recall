/**
 * Phase 4 — Recording Behavior Suite (REAL logic execution)
 *
 * Executes the pure decision logic in `src/lib/recordingReadiness.ts` with fake
 * adapters and model inventories. Complement to the static source suite
 * (phase4-recording-experience.test.mjs).
 *
 * Run with (Node >= 22.6, type stripping):
 *   node --experimental-strip-types --test tests/lib/phase4-recording-behavior.mjs
 *
 * Kept OUT of the `tests/lib/*.test.mjs` glob on purpose: importing a .ts
 * helper needs the --experimental-strip-types flag, so this suite is run as its
 * own documented command instead of silently breaking the plain node --test run.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isSupportedProvider,
  getReadinessAdapter,
  modelStatusToReadiness,
  resolveTranscriptionReadiness,
  shouldSaveMeetingAfterStop,
  reconcileRecordingSnapshot,
  resolveStopOutcome,
  deriveDeviceStatusFromDevices,
  deriveDeviceStatusFromError,
} from '../../src/lib/recordingReadiness.ts'

/** Fake adapter backed by a static model inventory. */
function adapterFor(models, opts = {}) {
  const inventory = models ?? []
  const available =
    opts.available ?? inventory.some((m) => m.status === 'Available' || m.status === 'ready')
  return {
    init: async () => {
      if (opts.initError) throw new Error(opts.initError)
    },
    getModels: async () => {
      if (opts.listError) throw new Error(opts.listError)
      return inventory
    },
    hasAvailableModels: async () => available,
  }
}

const AVAILABLE = (name) => ({ name, status: 'Available' })
const MISSING = (name) => ({ name, status: 'Missing' })
const DOWNLOADING = (name) => ({ name, status: { Downloading: 42 } })
const CORRUPTED = (name) => ({
  name,
  status: { Corrupted: { file_size: 4, expected_min_size: 1_000_000 } },
})
const ERRORED = (name) => ({ name, status: { Error: 'integrity check failed' } })

describe('Phase 4 — resolveTranscriptionReadiness: selected-model matrix', () => {
  it('Local Whisper A available + a missing Parakeet B elsewhere → READY for A (providers independent)', async () => {
    const localAdapters = adapterFor([AVAILABLE('A')])
    const parakeetAdapters = adapterFor([MISSING('B')], { available: false })

    const report = await resolveTranscriptionReadiness('localWhisper', 'A', localAdapters)
    assert.equal(report.ready, true)
    assert.equal(report.state, 'ready')
    assert.equal(report.provider, 'localWhisper')

    // Cross-check the other provider independently.
    const parakeetReport = await resolveTranscriptionReadiness('parakeet', 'B', parakeetAdapters)
    assert.equal(parakeetReport.ready, false)
    assert.equal(parakeetReport.state, 'missing')
    assert.equal(parakeetReport.provider, 'parakeet')
  })

  it('Local Whisper A missing + Whisper B available → NOT READY for A (unrelated model must not mask)', async () => {
    const adapter = adapterFor([MISSING('A'), AVAILABLE('B')])
    const report = await resolveTranscriptionReadiness('localWhisper', 'A', adapter)
    assert.equal(report.ready, false)
    assert.equal(report.state, 'missing')
    assert.equal(report.model, 'A')
  })

  it('Local Whisper A available + Whisper B downloading → READY for A (unrelated download must not block)', async () => {
    const adapter = adapterFor([AVAILABLE('A'), DOWNLOADING('B')])
    const report = await resolveTranscriptionReadiness('localWhisper', 'A', adapter)
    assert.equal(report.ready, true)
    assert.equal(report.state, 'ready')
    assert.equal(report.model, 'A')
  })

  it('Parakeet A downloading + Parakeet B available → DOWNLOADING A (selected model wins)', async () => {
    const adapter = adapterFor([DOWNLOADING('A'), AVAILABLE('B')])
    const report = await resolveTranscriptionReadiness('parakeet', 'A', adapter)
    assert.equal(report.ready, false)
    assert.equal(report.state, 'downloading')
    assert.equal(report.model, 'A')
  })

  it('Selected model corrupted → CORRUPTED (setup required), never treated as missing', async () => {
    const adapter = adapterFor([CORRUPTED('A'), AVAILABLE('B')])
    const report = await resolveTranscriptionReadiness('parakeet', 'A', adapter)
    assert.equal(report.ready, false)
    assert.equal(report.state, 'corrupted')
    assert.equal(report.model, 'A')
    assert.ok(report.detail.includes('corrupted'))
  })

  it('Configured model not found in inventory → explicit MISSING with the configured name', async () => {
    const adapter = adapterFor([AVAILABLE('A')])
    const report = await resolveTranscriptionReadiness('localWhisper', 'Ghost-Model', adapter)
    assert.equal(report.ready, false)
    assert.equal(report.state, 'missing')
    assert.equal(report.model, 'Ghost-Model')
    assert.ok(report.detail.includes('was not found'))
  })

  it('No selected model configured → any available model is acceptable', async () => {
    const yesAdapter = adapterFor([AVAILABLE('A')])
    assert.equal((await resolveTranscriptionReadiness('localWhisper', null, yesAdapter)).ready, true)

    const noAdapter = adapterFor([MISSING('A')], { available: false })
    const report = await resolveTranscriptionReadiness('localWhisper', null, noAdapter)
    assert.equal(report.ready, false)
    assert.equal(report.state, 'missing')
  })

  it('Adapter init failure → ERROR with a truthful detail; list failure → ERROR', async () => {
    const initErr = await resolveTranscriptionReadiness(
      'parakeet',
      'A',
      adapterFor([AVAILABLE('A')], { initError: 'engine uninitialized' }),
    )
    assert.equal(initErr.ready, false)
    assert.equal(initErr.state, 'error')
    assert.ok(initErr.detail.includes('engine uninitialized'))

    const listErr = await resolveTranscriptionReadiness(
      'parakeet',
      null,
      adapterFor([], { listError: 'inventory unreadable' }),
    )
    assert.equal(listErr.ready, false)
    assert.equal(listErr.state, 'error')
  })

  it('Unsupported provider → ERROR before touching the adapter', async () => {
    const report = await resolveTranscriptionReadiness('ollama', 'A', adapterFor([]))
    assert.equal(report.ready, false)
    assert.equal(report.state, 'error')
    assert.ok(report.detail.includes('Unsupported transcription provider'))
  })
})

describe('Phase 4 — modelStatusToReadiness mapping', () => {
  it('maps every backend status shape to a readiness state', () => {
    assert.equal(modelStatusToReadiness('Available'), 'ready')
    assert.equal(modelStatusToReadiness('Missing'), 'missing')
    assert.equal(modelStatusToReadiness(undefined), 'missing')
    assert.equal(modelStatusToReadiness(null), 'missing')
    assert.equal(modelStatusToReadiness({ Downloading: 12 }), 'downloading')
    assert.equal(modelStatusToReadiness({ Corrupted: {} }), 'corrupted')
    assert.equal(modelStatusToReadiness({ Error: 'boom' }), 'error')
  })
})

describe('Phase 4 — reconcileRecordingSnapshot: refresh bootstrap keeps live state', () => {
  it('backend recording, frontend IDLE → RECORDING with backend durations, polling required', () => {
    const result = reconcileRecordingSnapshot(
      { status: 'idle', recordingDuration: null, activeDuration: null },
      {
        is_recording: true,
        is_paused: false,
        is_active: true,
        recording_duration: 124,
        active_duration: 120,
      },
    )
    assert.equal(result.isRecording, true)
    assert.equal(result.isPaused, false)
    assert.equal(result.isActive, true)
    assert.equal(result.status, 'recording')
    assert.equal(result.recordingDuration, 124)
    assert.equal(result.activeDuration, 120)
    assert.equal(result.needsPoll, true)
  })

  it('backend recording + paused → adopted pause state, still polling', () => {
    const result = reconcileRecordingSnapshot(
      { status: 'idle', recordingDuration: null, activeDuration: null },
      {
        is_recording: true,
        is_paused: true,
        is_active: false,
        recording_duration: 90,
        active_duration: 50,
      },
    )
    assert.equal(result.isRecording, true)
    assert.equal(result.isPaused, true)
    assert.equal(result.isActive, false)
    assert.equal(result.status, 'recording')
    assert.equal(result.needsPoll, true)
  })

  it('backend stopped + frontend post-stop (stopping) → lifecycle preserved, polling stopped', () => {
    const result = reconcileRecordingSnapshot(
      { status: 'stopping', recordingDuration: 124, activeDuration: 120 },
      {
        is_recording: false,
        is_paused: false,
        is_active: false,
        recording_duration: null,
        active_duration: null,
      },
    )
    assert.equal(result.isRecording, false)
    assert.equal(result.status, 'stopping')
    assert.equal(result.needsPoll, false)
    assert.equal(result.recordingDuration, 124)
  })

  it('backend stopped + frontend processing/saving → preserved too', () => {
    for (const status of ['processing', 'saving']) {
      const result = reconcileRecordingSnapshot(
        { status, recordingDuration: 40, activeDuration: 38 },
        {
          is_recording: false,
          is_paused: false,
          is_active: false,
          recording_duration: null,
          active_duration: null,
        },
      )
      assert.equal(result.status, status)
    }
  })

  it('backend stopped + frontend idle → idle (clean refresh)', () => {
    const result = reconcileRecordingSnapshot(
      { status: 'idle', recordingDuration: null, activeDuration: null },
      {
        is_recording: false,
        is_paused: false,
        is_active: false,
        recording_duration: null,
        active_duration: null,
      },
    )
    assert.equal(result.isRecording, false)
    assert.equal(result.status, 'idle')
    assert.equal(result.needsPoll, false)
  })
})

describe('Phase 4 — resolveStopOutcome: backend truth wins on invoke failure', () => {
  it('successful native stop always finalizes', () => {
    assert.equal(resolveStopOutcome(true, true), 'finalized')
    assert.equal(resolveStopOutcome(true, false), 'finalized')
    assert.equal(resolveStopOutcome(true, null), 'finalized')
  })

  it('failed native stop finalizes only if the backend actually stopped', () => {
    assert.equal(resolveStopOutcome(false, false), 'finalized')
    assert.equal(resolveStopOutcome(false, true), 'recording-still-active')
  })

  it('failed native stop with an unqueryable backend never finalizes (fail-safe)', () => {
    assert.equal(resolveStopOutcome(false, null), 'recording-still-active')
  })
})

describe('Phase 4 — stop-save gate (pure)', () => {
  it('save runs iff the stop genuinely succeeded', () => {
    assert.equal(shouldSaveMeetingAfterStop(true), true)
    assert.equal(shouldSaveMeetingAfterStop(false), false)
  })
})

describe('Phase 4 — device derivation (permission hook truth)', () => {
  it('both device types → available, no warning message', () => {
    const d = deriveDeviceStatusFromDevices([
      { name: 'Mic', device_type: 'Input' },
      { name: 'Loopback', device_type: 'Output' },
    ])
    assert.equal(d.hasMicrophone, true)
    assert.equal(d.hasSystemAudio, true)
    assert.equal(d.deviceStatus, 'available')
    assert.equal(d.message, null)
  })

  it('system audio present but no mic → degraded with honest mic message', () => {
    const d = deriveDeviceStatusFromDevices([{ name: 'Loopback', device_type: 'Output' }])
    assert.equal(d.hasMicrophone, false)
    assert.equal(d.hasSystemAudio, true)
    assert.equal(d.deviceStatus, 'degraded')
    assert.ok(d.message.includes('No microphone devices were detected'))
    assert.ok(d.message.includes('no mic is connected'))
    assert.ok(d.message.includes('not been granted microphone access'))
  })

  it('no devices → degraded', () => {
    const d = deriveDeviceStatusFromDevices([])
    assert.equal(d.hasMicrophone, false)
    assert.equal(d.hasSystemAudio, false)
    assert.equal(d.deviceStatus, 'degraded')
  })

  it('enumeration failure → degraded with truthful error message', () => {
    const d = deriveDeviceStatusFromError()
    assert.equal(d.hasMicrophone, false)
    assert.equal(d.deviceStatus, 'degraded')
    assert.ok(d.message.includes('Unable to enumerate audio devices'))
    assert.ok(d.message.includes('may be required'))
  })
})

describe('Phase 4 — provider/adapter helpers', () => {
  it('isSupportedProvider accepts only parakeet and localWhisper', () => {
    assert.equal(isSupportedProvider('parakeet'), true)
    assert.equal(isSupportedProvider('localWhisper'), true)
    assert.equal(isSupportedProvider('ollama'), false)
  })

  it('getReadinessAdapter returns the selected adapter or null', () => {
    const adapters = { parakeet: adapterFor([]), localWhisper: adapterFor([]) }
    assert.equal(getReadinessAdapter('parakeet', adapters), adapters.parakeet)
    assert.equal(getReadinessAdapter('localWhisper', adapters), adapters.localWhisper)
    assert.equal(getReadinessAdapter('ollama', adapters), null)
  })
})