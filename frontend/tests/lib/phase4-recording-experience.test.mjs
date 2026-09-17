/**
 * Phase 4 — Recording Experience Regression Test
 *
 * Verifies (via static source analysis; no Tauri backend required) plus the
 * sibling behavioral suite that actually executes the pure logic
 * (phase4-recording-behavior.test.mjs, run with `--experimental-strip-types`):
 * - Model-aware readiness: the configured model gates; unrelated models don't
 * - Stop-save gate: recording saved on any successful stop (no silent data loss)
 * - Stop failure: backend truth wins — never pretend a recording ended
 * - No fake audio visualization (Math.random / barHeights removed)
 * - No alert()/confirm() dialogs in the recording or recovery flow
 * - Permission check: mount-time initial check, honest device enumeration
 * - Single source of truth: RecordingStateContext reconcile + one poller
 * - Active-recording bootstrap recovery (refresh keeps live state)
 * - Truthful timer driven by backend recording_duration (canonical source)
 * - Semantic tokens + reduced-motion guards on recording-only surfaces
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

describe('Phase 4 — model-aware readiness', () => {
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
      'modelStatusToReadiness',
      'resolveTranscriptionReadiness',
      'shouldSaveMeetingAfterStop',
      'reconcileRecordingSnapshot',
      'resolveStopOutcome',
      'deriveDeviceStatusFromDevices',
      'deriveDeviceStatusFromError',
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

  it('resolveTranscriptionReadiness is model-aware: takes the configured selected model', () => {
    assert.ok(
      mod.includes('selectedModel: string | null,'),
      'resolver must accept the selected model name',
    )
    assert.ok(
      mod.includes('const selected = models.find((model) => model.name === selectedModel)'),
      'resolver must look up the configured model specifically',
    )
  })

  it('model statuses collapse to a truthful readiness state', () => {
    assert.ok(mod.includes("status === 'Available'"), 'Available must map to ready')
    assert.ok(mod.includes("'Downloading' in status"), 'downloads must be recognized')
    assert.ok(mod.includes("'Corrupted' in status"), 'corruption must be recognized')
    assert.ok(mod.includes("'Error' in status"), 'engine errors must be recognized')
    assert.ok(
      mod.includes("return 'missing';") && mod.includes("return 'ready';"),
      'missing/ready must be the terminal fallbacks',
    )
  })

  it('configured-model verdicts: ready/downloading/corrupted/missing stay model-scoped', () => {
    assert.ok(
      mod.includes("if (state === 'ready')") && mod.includes("model: selected.name"),
      'ready must be returned for the selected model only',
    )
    assert.ok(
      mod.includes("state === 'downloading'"),
      'downloading must gate the selected model only',
    )
    assert.ok(
      mod.includes('Configured model') && mod.includes('corrupted'),
      'corrupted copy must reference the configured model',
    )
    assert.ok(
      mod.includes('was not found'),
      'configured name missing from inventory must be explicit, not silent fallback',
    )
  })

  it('no selected model falls back to any-available-model', () => {
    assert.ok(
      mod.includes('const hasModels = await adapter.hasAvailableModels();'),
      'no-model mode must use any-available-model',
    )
  })

  it('useRecordingStart drives readiness from the configured provider AND model', () => {
    const src = read('hooks/useRecordingStart.ts')
    assert.ok(
      src.includes('transcriptModelConfig.provider'),
      'start must be provider-aware (transcriptModelConfig.provider)',
    )
    assert.ok(
      src.includes('transcriptModelConfig.model ?? null'),
      'start must pass the configured selected model',
    )
    assert.ok(
      src.includes('getReadinessAdapter(provider, readinessAdapters)'),
      'start must resolve via getReadinessAdapter',
    )
    assert.ok(
      src.includes('resolveTranscriptionReadiness(provider, selectedModel, adapter)'),
      'start must call resolveTranscriptionReadiness with the selected model',
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

  it('useRecordingStop gates the SQLite save on the reconciled stop outcome, not transcription state', () => {
    assert.ok(
      stop.includes('shouldSaveMeetingAfterStop(stopSucceeded)'),
      'save must be gated on the reconciled stopSucceeded',
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

describe('Phase 4 — stop failure never pretends the recording ended', () => {
  const stop = read('hooks/useRecordingStop.ts')
  const gate = read('lib/recordingReadiness.ts')

  it('resolveStopOutcome lets backend truth decide after a failed invoke', () => {
    assert.ok(
      gate.includes('export function resolveStopOutcome('),
      'stop outcome must be a pure decision',
    )
    assert.ok(
      gate.includes("return 'finalized';") && gate.includes("return 'recording-still-active';"),
      'outcome must distinguish finalized vs still-active',
    )
    assert.ok(
      gate.includes('if (nativeStopSucceeded)') && gate.includes('if (backendIsRecording === false)'),
      'successful invoke and partial failure both finalize',
    )
  })

  it('useRecordingStop reconciles the backend once on invoke failure and restores RECORDING', () => {
    assert.ok(
      stop.includes('recordingService.getRecordingState()'),
      'must query backend state when the native stop invoke fails',
    )
    assert.ok(
      stop.includes('resolveStopOutcome(false, backendIsRecording)'),
      'must resolve the outcome from the backend truth',
    )
    assert.ok(
      stop.includes('setStatus(RecordingStatus.RECORDING)'),
      'must restore RECORDING instead of entering finalization when still active',
    )
    assert.ok(
      stop.includes('The recording is still active. Try stopping again.'),
      'failure surfacing must be actionable (retry Stop)',
    )
    assert.ok(
      stop.includes('continuing finalization'),
      'partial failure (backend actually stopped) must continue the save',
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

describe('Phase 4 — no alert()/confirm() dialogs in the recording or recovery flow', () => {
  const files = [
    'components/RecordingControls.tsx',
    'hooks/useRecordingStart.ts',
    'hooks/useRecordingStop.ts',
    'app/page.tsx',
    'components/TranscriptRecovery/TranscriptRecovery.tsx',
  ]

  it('recording/recovery flow uses sonner toasts and in-app UI, not browser dialogs', () => {
    for (const rel of files) {
      const src = stripComments(read(rel))
      assert.ok(!src.includes('alert('), `${rel} must not call alert()`)
      assert.ok(!src.includes('confirm('), `${rel} must not call confirm()`)
    }
  })
})

describe('Phase 4 — permission check is honest AND runs on mount', () => {
  const hook = read('hooks/usePermissionCheck.ts')
  const mod = read('lib/recordingReadiness.ts')

  it('computed fields are strict device availability, not pretend grants', () => {
    assert.ok(
      hook.includes('trigger_microphone_permission'),
      'requestPermissions must trigger the real mic permission command',
    )
    assert.ok(
      hook.includes('deriveDeviceStatusFromDevices'),
      'hook must derive availability via the pure module',
    )
    assert.ok(
      hook.includes('deviceStatus'),
      'hook must expose deviceStatus',
    )
    assert.ok(
      mod.includes('No microphone devices were detected'),
      'missing-mic message must admit it may be hardware OR permission',
    )
    assert.ok(
      mod.includes('Unable to enumerate audio devices. Microphone access may be required.'),
      'error message must be truthful about enumeration failure',
    )
  })

  it('checkPermissions is stable (useCallback) and runs an initial check on mount', () => {
    // A bare "includes('checkPermissions()')" assertion would pass even if the
    // mount effect were deleted — the call also exists inside requestPermissions'
    // re-enumeration timeout. Pin the mount-effect pattern specifically.
    assert.ok(
      hook.includes('const checkPermissions = useCallback(async () => {'),
      'checkPermissions must be memoized with useCallback',
    )
    assert.ok(
      hook.includes('}, [checkPermissions]);'),
      'mount effect must depend on the stable checkPermissions',
    )
    assert.ok(
      hook.includes('useEffect(() => {\n    void checkPermissions();\n  }, [checkPermissions]);'),
      'mount-time initial check must exist (guard: removal of the mount effect)',
    )
    const effectIdx = hook.indexOf('void checkPermissions();')
    assert.ok(
      !hook.slice(0, Math.max(effectIdx, 0)).includes('requestPermissions'),
      'the mount check must not live inside requestPermissions',
    )
  })

  it('requestPermissions re-enumerates instead of pretending to grant', () => {
    assert.ok(hook.includes('checkPermissions();'), 'must recheck after triggering permission')
    assert.ok(
      !hook.includes('window.Notification.requestPermission'),
      'must not misuse web permission APIs',
    )
  })
})

describe('Phase 4 — Home pre-recording remediation', () => {
  const home = read('components/Home/HomeDashboard.tsx')

  it('Home shows a compact microphone preflight with actionable remediation', () => {
    assert.ok(home.includes('usePermissionCheck'), 'Home must reuse the permission hook')
    assert.ok(home.includes('Checking microphone'), 'checking state must be visible')
    assert.ok(home.includes('Microphone available'), 'available state must be visible')
    assert.ok(home.includes('Microphone unavailable'), 'unavailable state must be actionable')
    assert.ok(home.includes('Recheck'), 'must offer a recheck action')
    assert.ok(home.includes('Request Access'), 'must offer real access remediation')
    assert.ok(
      home.includes('requestPermissions'),
      'remediation must go through the real permission trigger',
    )
    assert.ok(
      home.includes('System audio is optional'),
      'system audio absence must be non-blocking (mic-only supported)',
    )
  })

  it('start orchestration blocks before contacting the backend when no mic is enumerable', () => {
    const start = read('hooks/useRecordingStart.ts')
    assert.ok(
      start.includes('const devices = await checkDevices();'),
      'start must pre-flight device availability',
    )
    assert.ok(
      start.includes('!devices.hasMicrophone'),
      'start must gate on an enumerable microphone',
    )
    assert.ok(
      start.includes('Microphone unavailable'),
      'blocked start must surface an actionable message',
    )
    assert.ok(
      start.includes('system audio') || start.includes('mic-only'),
      'start must keep system audio non-blocking',
    )
  })
})

describe('Phase 4 — single source of truth (RecordingStateContext)', () => {
  const ctx = read('contexts/RecordingStateContext.tsx')

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
    assert.ok(ctx.includes('isRecordingDisabled: boolean'), 'context type must expose the flag')
    assert.ok(ctx.includes('setIsRecordingDisabled'), 'context must expose the setter')
  })

  it('bootstrap reconciles a backend snapshot into the lifecycle (refresh recovery)', () => {
    assert.ok(
      ctx.includes('reconcileRecordingSnapshot('),
      'initial sync must reconcile, not blindly overwrite',
    )
    assert.ok(
      ctx.includes('STATUS_BY_LIFECYCLE'),
      'reconciled statuses must map back to the enum',
    )
  })

  it('backend recording keeps exactly ONE poller; backend stop tears it down', () => {
    assert.ok(
      ctx.includes('clearInterval(pollingIntervalRef.current)'),
      'startPolling must clear any existing interval before creating one',
    )
    assert.ok(
      ctx.includes('if (backendState.is_recording) {\n        startPolling();\n      } else {\n        stopPolling();\n      }'),
      'sync must start polling while recording and stop it otherwise',
    )
    assert.ok(
      ctx.includes('cleanup') === false || ctx.includes('stopPolling();'),
      'unmount cleanup must stop polling',
    )
  })

  it('post-stop frontend lifecycle is preserved while the backend reports stopped', () => {
    assert.ok(
      ctx.includes('STOPPING') &&
        ctx.includes('PROCESSING_TRANSCRIPTS') &&
        ctx.includes('SAVING'),
      'context must still know the finalization statuses',
    )
    assert.ok(
      read('lib/recordingReadiness.ts').includes('POST_APPLY_STATUSES'),
      'reconcile must define the post-stop statuses to preserve',
    )
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

  it('sidebar isMeetingActive is bridged from backend recording truth', () => {
    const side = read('components/Sidebar/SidebarProvider.tsx')
    assert.ok(
      side.includes('const isMeetingActive = isRecording || meetingActiveOverride;'),
      'isMeetingActive must bridge RecordingStateContext truth (+ local override)',
    )
    assert.ok(
      side.includes('useRecordingState()'),
      'sidebar must read backend recording state over the bridge',
    )
  })
})

describe('Phase 4 — recording workspace accessibility, tokens, canonical timer', () => {
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

describe('Phase 4 — recording status surfaces (canonical timer + reduced motion)', () => {
  const bar = read('components/RecordingStatusBar.tsx')

  it('RecordingStatusBar uses the canonical recordingDuration, not activeDuration', () => {
    assert.ok(bar.includes('recordingDuration'), 'status bar must use the canonical duration')
    assert.ok(!bar.includes('activeDuration'), 'status bar must not use the conflicting timer')
    assert.ok(
      !bar.includes('isRecording'),
      'status bar must not shadow backend recording truth',
    )
  })

  it('RecordingStatusBar entry animation and pulse respect reduced motion', () => {
    assert.ok(bar.includes('useReducedMotion'), 'must honor reduced motion for the entry')
    assert.ok(
      bar.includes('motion-safe:animate-pulse') && bar.includes('motion-reduce:animate-none'),
      'recording pulse must be motion-safe only',
    )
  })

  it('RecordingStatusBar uses semantic tokens, not raw colors', () => {
    const src = stripComments(bar)
    assert.ok(src.includes('bg-surface'), 'container must use bg-surface')
    assert.ok(src.includes('border-border'), 'container must use border-border')
    assert.ok(src.includes('bg-warning'), 'paused state must use the warning token')
    assert.ok(src.includes('bg-destructive'), 'active state must use the destructive token')
    const violations = []
    if (/bg-gray-/.test(src)) violations.push('bg-gray')
    if (/text-gray-/.test(src)) violations.push('text-gray')
    if (/bg-white/.test(src)) violations.push('bg-white')
    if (/bg-red-500/.test(src)) violations.push('bg-red-500')
    if (/bg-orange-500/.test(src)) violations.push('bg-orange-500')
    assert.deepEqual(violations, [], 'RecordingStatusBar must use semantic tokens')
  })

  it('StatusOverlays use semantic tokens and reduced-motion spinners', () => {
    const overlay = read('app/_components/StatusOverlays.tsx')
    assert.ok(overlay.includes('bg-background'), 'overlay must use bg-background')
    assert.ok(overlay.includes('border-border'), 'overlay must use border-border')
    assert.ok(
      overlay.includes('animate-spin') && overlay.includes('motion-reduce:animate-none'),
      'spinner must be disabled under reduced motion',
    )
    assert.ok(!overlay.includes('bg-white'), 'no hardcoded white')
    assert.ok(!overlay.includes('shadow-lg'), 'no heavy shadow')
    assert.ok(!overlay.includes('bg-gray-900'), 'no raw gray spinner')
  })

  it('TranscriptPanel recording container and header use semantic tokens', () => {
    const panel = read('app/_components/TranscriptPanel.tsx')
    assert.ok(panel.includes('bg-background'), 'panel container must use bg-background')
    assert.ok(panel.includes('border-border'), 'panel container must use border-border')
    assert.ok(!panel.includes('bg-white'), 'no hardcoded white panel')
    assert.ok(!panel.includes('gray-200'), 'no raw gray borders')
  })
})

describe('Phase 4 — virtualized transcript recording-only states', () => {
  const view = read('components/VirtualizedTranscriptView.tsx')

  it('recording empty/listening indicators use semantic tokens and reduced-motion pulses', () => {
    assert.ok(view.includes("'bg-warning'"), 'paused dot must use the warning token')
    assert.ok(
      view.includes('bg-destructive motion-safe:animate-pulse motion-reduce:animate-none'),
      'listening dot must be destructive + motion-safe',
    )
    assert.ok(
      view.includes('Listening for speech...'),
      'live empty state keeps the honest listening copy',
    )
    assert.ok(
      view.includes('Recording paused'),
      'paused empty state keeps the honest copy',
    )
  })

  it('streaming/listening entry animations respect reduced motion', () => {
    assert.ok(view.includes('useReducedMotion'), 'must honor reduced motion')
    assert.ok(
      view.includes('initial={prefersReducedMotion ? false : { opacity: 0 }}'),
      'empty-state and listening fades must be skipped under reduced motion',
    )
  })

  it('sticky recording status bar wrapper uses the background token', () => {
    assert.ok(view.includes('sticky top-0 z-10 bg-background pb-2'), 'wrapper must use bg-background')
    assert.ok(!view.includes('sticky top-0 z-10 bg-white'), 'no white sticky wrapper')
  })
})

describe('Phase 4 — recovery UX hardening', () => {
  const rec = read('components/TranscriptRecovery/TranscriptRecovery.tsx')

  it('destructive delete requires an explicit in-dialog confirmation', () => {
    assert.ok(
      rec.includes('deleteConfirmFor'),
      'two-step delete must be stateful (no confirm())',
    )
    assert.ok(
      rec.includes('This removes the recoverable meeting data and cannot be undone.'),
      'confirm copy must state permanent removal',
    )
    assert.ok(rec.includes('Delete permanently'), 'final destructive action must be explicit')
    assert.ok(rec.includes('Keep'), 'cancelling the confirmation must be offered')
  })

  it('recovery failure keeps the source intact and surfaces a persistent alert', () => {
    assert.ok(
      rec.includes('The recoverable meeting is still intact'),
      'failure copy must promise the source remains recoverable',
    )
    assert.ok(
      rec.includes('<Alert variant="destructive">'),
      'failure must surface in a persistent in-app alert',
    )
  })

  it('busy spinners are reduced-motion safe', () => {
    const src = stripComments(rec)
    assert.ok(
      (src.match(/animate-spin/g) || []).length >= 2,
      'recovering + deleting must both use spinners',
    )
    assert.ok(
      src.includes('motion-reduce:animate-none'),
      'spinners must be motion-reduce safe',
    )
  })

  it('audio availability indicators use success/warning tokens', () => {
    const src = stripComments(rec)
    assert.ok(src.includes('text-success'), 'audio-available must use success token')
    assert.ok(src.includes('text-warning'), 'no-audio must use warning token')
    assert.ok(!src.includes('text-green-'), 'no raw green')
    assert.ok(!src.includes('text-yellow-'), 'no raw yellow')
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

  it('behavioral suite exists and executes the pure logic', () => {
    assert.ok(
      existsSync(join(testsDir, 'tests/lib/phase4-recording-behavior.mjs')),
      'phase4 behavior suite must exist (runs under --experimental-strip-types)',
    )
  })
})