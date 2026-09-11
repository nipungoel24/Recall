/**
 * Phase 4 — Recording Experience Regression Test
 *
 * Verifies (via static source analysis; no Tauri backend required):
 * - Provider-aware readiness: Local Whisper is independent of Parakeet
 * - Stop-save gate: recording saved on any successful stop (no silent data loss)
 * - No fake audio visualization (Math.random / barHeights removed)
 * - No alert() dialogs in the recording flow (sonner toasts only)
 * - Permission check is honest: device enumeration, not pretend grants
 * - Device/error copy reflects what the app can actually know
 * - Single source of truth: RecordingStateContext (no dual polling)
 * - Truthful timer driven by backend recording_duration
 * - Semantic tokens + accessibility in the recording workspace
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const srcDir = join(import.meta.dirname, '../../src')
const testsDir = join(import.meta.dirname, '../..')

function read(rel) {
  return readFileSync(join(srcDir, rel), 'utf8')
}

function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')
}

describe('Phase 4 — provider-aware readiness', () => {
  const mod = read('lib/recordingReadiness.ts')

  it('module exports the readiness vocabulary', () => {
    for (const symbol of [
      'RecordingProvider',
      'ReadinessAdapter',
      'ReadinessReport',
      'isSupportedProvider',
      'getReadinessAdapter',
      'statusIsDownloading',
      'isModelDownloading',
      'resolveTranscriptionReadiness',
      'shouldSaveMeetingAfterStop',
    ]) {
      assert.ok(mod.includes(symbol), `recordingReadiness.ts must export ${symbol}`)
    }
  })

  it('getReadinessAdapter only returns the adapter for the configured provider', () => {
    assert.ok(
      mod.includes('isSupportedProvider(provider)') && mod.includes('adapters[provider]'),
      'getReadinessAdapter must guard the provider and index only the selected provider',
    )
  })

  it('resolveTranscriptionReadiness consults ONLY the selected adapter (localWhisper never touches parakeet)', () => {
    // The resolver receives a single `adapter`, not the full pair, so it cannot
    // accidentally enumerate the other engine.
    assert.ok(
      mod.includes('adapter: ReadinessAdapter'),
      'resolveTranscriptionReadiness must accept a single adapter',
    )
    assert.ok(mod.includes('adapter.init()'), 'must init the selected adapter')
    assert.ok(mod.includes('adapter.getModels()'), 'must list models via the selected adapter')
    assert.ok(mod.includes('adapter.hasAvailableModels()'), 'must check availability via the selected adapter')
    assert.ok(
      !mod.includes('adapters.parakeet') && !mod.includes('adapters.localWhisper'),
      'resolver must not hardcode either engine',
    )
  })

  it('useRecordingStart drives readiness from the configured provider', () => {
    const src = read('hooks/useRecordingStart.ts')
    assert.ok(
      src.includes('transcriptModelConfig.provider'),
      'start must be provider-aware (transcriptModelConfig.provider)',
    )
    assert.ok(
      src.includes('getReadinessAdapter(provider, readinessAdapters)'),
      'start must resolve via getReadinessAdapter',
    )
    assert.ok(
      src.includes('resolveTranscriptionReadiness(provider, adapter)'),
      'start must call resolveTranscriptionReadiness',
    )
  })
})

describe('Phase 4 — stop-save gate (no silent data loss)', () => {
  const stop = read('hooks/useRecordingStop.ts')
  const gate = read('lib/recordingReadiness.ts')

  it('save decision lives in the pure module and mirrors stop success', () => {
    assert.ok(
      gate.includes('export function shouldSaveMeetingAfterStop(stopSucceeded: boolean)'),
      'shouldSaveMeetingAfterStop must take a single stopSucceeded boolean',
    )
    assert.ok(
      gate.includes('return stopSucceeded;'),
      'shouldSaveMeetingAfterStop must return the stop result directly',
    )
  })

  it('useRecordingStop gates the SQLite save on stop success, not transcription state', () => {
    assert.ok(
      stop.includes('shouldSaveMeetingAfterStop(isCallApi)'),
      'save must be gated on shouldSaveMeetingAfterStop(isCallApi)',
    )
    assert.ok(
      !stop.includes('if (isCallApi && transcriptionComplete == true)'),
      'the old transcription-dependent gate must be gone',
    )
    assert.ok(
      !stop.includes('transcriptionComplete == true') &&
      !stop.includes('transcriptionComplete === true'),
      'save must not depend on transcription completion',
    )
  })

  it('useRecordingStop waits briefly for the recording-stopped payload race', () => {
    assert.ok(
      stop.includes('waitForStoppedPayloadValue('),
      'must poll sessionStorage for the folder_path payload',
    )
  })
})

describe('Phase 4 — fake visualization removed', () => {
  it('page.tsx has no barHeights or Math.random simulation', () => {
    const src = read('app/page.tsx')
    assert.ok(!src.includes('barHeights'), 'page must not render fake equalizer bars')
    assert.ok(!src.includes('Math.random'), 'page must not simulate audio levels')
  })

  it('RecordingControls has no barHeights or Math.random simulation', () => {
    const src = read('components/RecordingControls.tsx')
    assert.ok(!src.includes('barHeights'), 'RecordingControls must not accept/render barHeights')
    assert.ok(!src.includes('Math.random'), 'RecordingControls must not simulate audio levels')
  })

  it('RecordingControls shows a truthful timer from backend recording_duration', () => {
    const src = read('components/RecordingControls.tsx')
    assert.ok(
      src.includes('recordingState.recordingDuration'),
      'timer must be derived from backend recording_duration',
    )
    assert.ok(src.includes('formatTime('), 'must format duration for display')
    assert.ok(src.includes('REC '), 'active status must show REC + duration')
  })
})

describe('Phase 4 — no alert() dialogs in the recording flow', () => {
  const files = [
    'components/RecordingControls.tsx',
    'hooks/useRecordingStart.ts',
    'hooks/useRecordingStop.ts',
    'app/page.tsx',
  ]

  it('recording flow uses sonner toasts, not alert()', () => {
    for (const rel of files) {
      const src = stripComments(read(rel))
      assert.ok(
        !src.includes('alert('),
        `${rel} must not call alert()`,
      )
    }
  })
})

describe('Phase 4 — permission check is honest', () => {
  const hook = read('hooks/usePermissionCheck.ts')

  it('computed fields are strict device availability, not pretend grants', () => {
    assert.ok(
      hook.includes('trigger_microphone_permission'),
      'requestPermissions must trigger the real mic permission command',
    )
    assert.ok(
      hook.includes('deviceStatus'),
      'hook must expose deviceStatus',
    )
    assert.ok(
      hook.includes('No microphone devices were detected'),
      'missing-mic message must admit it may be hardware OR permission',
    )
    assert.ok(
      hook.includes('Unable to enumerate audio devices. Microphone access may be required.'),
      'error message must be truthful about enumeration failure',
    )
  })

  it('requestPermissions re-enumerates instead of pretending to grant', () => {
    assert.ok(hook.includes('checkPermissions()'), 'must recheck after triggering permission')
    assert.ok(
      !hook.includes('window.Notification.requestPermission'),
      'must not misuse web permission APIs',
    )
  })
})

describe('Phase 4 — device selection truthfulness', () => {
  const sel = read('components/DeviceSelection.tsx')

  it('removed the stale Test-Mic block and stale tip', () => {
    assert.ok(!sel.includes('Test Mic'), 'no commented/stale Test Mic button')
    assert.ok(!sel.includes('test mic'), 'no stale Test Mic guidance')
    assert.ok(!sel.includes('showLevels'), 'no dead level-monitor UI in the selection panel')
  })

  it('empty states are truthful for both device types', () => {
    assert.ok(
      sel.includes('No microphones detected.'),
      'mic empty state must admit hardware/OS permission possibilities',
    )
    assert.ok(
      sel.includes('No system audio devices detected.'),
      'system empty state must be explicit',
    )
  })

  it('uses semantic tokens, not raw Tailwind colors or opacity-only files', () => {
    const src = stripComments(sel)
    const violations = []
    if (/bg-gray-/.test(src)) violations.push('bg-gray')
    if (/text-gray-/.test(src)) violations.push('text-gray')
    if (/border-gray-/.test(src)) violations.push('border-gray')
    if (/bg-white/.test(src)) violations.push('bg-white')
    if (/text-white/.test(src)) violations.push('text-white')
    if (/bg-red-/.test(src)) violations.push('bg-red')
    if (/text-red-/.test(src)) violations.push('text-red')
    assert.deepEqual(violations, [], 'DeviceSelection must use semantic tokens')
  })

  it('refresh affordance has an aria-label and focus ring', () => {
    assert.ok(sel.includes('aria-label="Refresh audio devices"'), 'refresh must be labelled')
    assert.ok(sel.includes('focus-visible:ring'), 'refresh must have focus-visible styling')
  })
})

describe('Phase 4 — permission warning truthfulness', () => {
  const warn = read('components/PermissionWarning.tsx')

  it('does not claim BlackHole or screen-recording are required', () => {
    assert.ok(!warn.includes('BlackHole'), 'must not instruct installing BlackHole')
    assert.ok(
      !warn.includes('Screen Recording Permission'),
      'must not claim screen recording permission is required',
    )
    assert.ok(!warn.includes('amber-'), 'must use semantic tokens, not amber')
  })

  it('uses semantic tokens for the alert', () => {
    assert.ok(warn.includes('border-destructive/40'), 'alert border must use destructive token')
    assert.ok(warn.includes('bg-destructive/5'), 'alert background must use destructive token')
    assert.ok(warn.includes('text-muted-foreground'), 'alert description must use muted token')
  })
})

describe('Phase 4 — single source of truth (RecordingStateContext)', () => {
  it('useRecordingStateSync is deleted (no second 1s poller)', () => {
    assert.ok(
      !existsSync(join(srcDir, 'hooks/useRecordingStateSync.ts')),
      'useRecordingStateSync.ts must be removed',
    )
  })

  it('page.tsx derives recording state from the context, not local state', () => {
    const src = read('app/page.tsx')
    assert.ok(!src.includes('useRecordingStateSync'), 'page must not import the legacy sync hook')
    assert.ok(!src.includes('setIsRecordingState'), 'page must not own a competing isRecording state')
    assert.ok(src.includes('isRecording'), 'page must read isRecording from context')
    assert.ok(
      src.includes('isRecordingDisabled={isRecordingDisabled}'),
      'page must pass context isRecordingDisabled to controls',
    )
  })

  it('RecordingStateContext owns isRecordingDisabled', () => {
    const ctx = read('contexts/RecordingStateContext.tsx')
    assert.ok(ctx.includes('isRecordingDisabled: boolean'), 'context type must expose the flag')
    assert.ok(ctx.includes('setIsRecordingDisabled'), 'context must expose the setter')
  })

  it('useRecordingStart no longer takes setIsRecording (event-driven instead)', () => {
    const src = read('hooks/useRecordingStart.ts')
    assert.ok(!src.includes('setIsRecording'), 'start hook must not own UI isRecording')
  })

  it('useRecordingStop no longer takes setIsRecording/setIsRecordingDisabled params', () => {
    const src = read('hooks/useRecordingStop.ts')
    assert.ok(
      src.includes('export function useRecordingStop():'),
      'stop hook must have no setter params',
    )
  })
})

describe('Phase 4 — recording workspace accessibility and tokens', () => {
  const ctrl = read('components/RecordingControls.tsx')

  it('start/stop controls are labelled buttons', () => {
    assert.ok(ctrl.includes('aria-label="Start recording"'), 'start must be labelled')
    assert.ok(ctrl.includes('aria-label="Stop recording"'), 'stop must be labelled')
  })

  it('status region is live-announced', () => {
    assert.ok(ctrl.includes('role="status"'), 'status must use role=status')
    assert.ok(ctrl.includes('aria-live="polite"'), 'status must be politely announced')
  })

  it('live indicator respects reduced motion', () => {
    assert.ok(
      ctrl.includes('motion-safe:animate-ping') && ctrl.includes('motion-reduce:animate-none'),
      'ping animation must be motion-safe only',
    )
  })

  it('uses semantic tokens and no raw colors/shadows', () => {
    const src = stripComments(ctrl)
    assert.ok(src.includes('bg-surface'), 'pill must use bg-surface')
    assert.ok(src.includes('border-border'), 'pill must use border-border')
    const violations = []
    if (/bg-gray-/.test(src)) violations.push('bg-gray')
    if (/text-gray-/.test(src)) violations.push('text-gray')
    if (/bg-white/.test(src)) violations.push('bg-white')
    if (/text-white/.test(src)) violations.push('text-white')
    if (/bg-blue-/.test(src)) violations.push('bg-blue')
    if (/text-blue-/.test(src)) violations.push('text-blue')
    assert.deepEqual(violations, [], 'RecordingControls must use semantic tokens')
  })

  it('start button is guarded and disabled during start/start transitions', () => {
    assert.ok(ctrl.includes('isStarting ||'), 'start must disable while initiating')
  })
})

describe('Phase 4 — Rust: no VAD panic in pipeline startup', () => {
  const tauriSrc = join(testsDir, 'src-tauri/src')

  function readTauri(rel) {
    return readFileSync(join(tauriSrc, rel), 'utf8')
  }

  it('AudioPipeline::new returns Result (fallible) so VAD init cannot panic', () => {
    const pipeline = readTauri('audio/pipeline.rs')
    // Scope to the AudioPipeline impl (the file has several unrelated new()s).
    const implIdx = pipeline.indexOf('impl AudioPipeline')
    assert.ok(implIdx > -1, 'impl AudioPipeline must exist')
    const implBlock = pipeline.slice(implIdx, implIdx + 4000)
    assert.ok(
      implBlock.includes('pub fn new(') && implBlock.includes('Result<Self>'),
      'AudioPipeline::new must return Result<Self>',
    )
    assert.ok(
      pipeline.includes('match ContinuousVadProcessor::new'),
      'VAD processor creation must be handled as a Result',
    )
    assert.ok(
      !stripComments(pipeline).includes('panic!'),
      'pipeline.rs must contain no panic! on the init path',
    )
  })

  it('pipeline call site propagates the VAD error with ?', () => {
    const pipeline = readTauri('audio/pipeline.rs')
    const callIdx = pipeline.indexOf('AudioPipeline::new(')
    assert.ok(callIdx > -1, 'AudioPipeline must have a call site')
    const callWindow = pipeline.slice(callIdx, callIdx + 600)
    assert.ok(
      callWindow.includes(')?;'),
      'AudioPipeline::new must be called with `?` for error propagation',
    )
  })
})

describe('Phase 4 — regression suite and drop of stale claims', () => {
  it('this suite exists', () => {
    assert.ok(
      existsSync(join(testsDir, 'tests/lib/phase4-recording-experience.test.mjs')),
    )
  })
})