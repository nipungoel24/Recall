/**
 * Recording readiness resolution + recording-state reconciliation.
 *
 * Pure, dependency-free decision helpers shared by the recording hooks and the
 * Phase 4 regression suite. No Tauri imports here (and no TypeScript `enum`,
 * so Node's `--experimental-strip-types` can execute these directly), so the
 * behavior is testable without a backend.
 *
 * The transcription model readiness check is model-aware: the configured
 * provider decides which engine (Parakeet or Local Whisper) is consulted, and
 * the configured model decides which model inside that engine gates readiness.
 * An unrelated model in any other state never changes the selected model's
 * verdict.
 *
 * Backend policy alignment: `whisper_validate_model_ready_with_config` and
 * `parakeet_validate_model_ready_with_config` fall back to the first available
 * model when the configured model is not found. That fallback exists so a
 * stale configuration still yields usable transcription. The frontend surfaces
 * the *selected* model's true state and blocks a recording start until the user
 * resolves it, so the backend fallback is never silently presented as the
 * configured model being ready.
 */

export type RecordingProvider = 'parakeet' | 'localWhisper';

export interface ReadinessAdapter {
  init: () => Promise<void>;
  hasAvailableModels: () => Promise<boolean>;
  getModels: () => Promise<Array<{ name: string; status: unknown }>>;
}

export interface ReadinessAdapters {
  parakeet: ReadinessAdapter;
  localWhisper: ReadinessAdapter;
}

export type ReadinessState = 'ready' | 'missing' | 'downloading' | 'corrupted' | 'error' | 'unknown';

export interface ReadinessReport {
  ready: boolean;
  state: ReadinessState;
  provider: string;
  model?: string;
  detail?: string;
}

export function isSupportedProvider(provider: string): provider is RecordingProvider {
  return provider === 'parakeet' || provider === 'localWhisper';
}

/** Returns the adapter for the configured provider, or null if unsupported. */
export function getReadinessAdapter(
  provider: string,
  adapters: ReadinessAdapters
): ReadinessAdapter | null {
  if (!isSupportedProvider(provider)) {
    return null;
  }
  return adapters[provider];
}

/** A model status object with a `Downloading` key means a download is in progress. */
export function statusIsDownloading(status: unknown): boolean {
  return typeof status === 'object' && status !== null && 'Downloading' in status;
}

/** True when ANY model in a collection is actively downloading. */
export function isModelDownloading(models: Array<{ status: unknown }>): boolean {
  return models.some((model) => statusIsDownloading(model.status));
}

/** A model status object with a `Corrupted` key means the model file failed integrity checks. */
export function isStatusCorrupted(status: unknown): boolean {
  return typeof status === 'object' && status !== null && 'Corrupted' in status;
}

/**
 * Map a raw adapter model status to a readiness state.
 *
 * `'Available'` → `ready`; a download in progress → `downloading`; a failed
 * integrity check → `corrupted`; an error payload → `error`; anything else
 * (including `'Missing'`) → `missing`. `unknown` is never returned here.
 */
export function modelStatusToReadiness(status: unknown): ReadinessState {
  if (status === 'Available') {
    return 'ready';
  }
  if (isStatusCorrupted(status)) {
    return 'corrupted';
  }
  if (statusIsDownloading(status)) {
    return 'downloading';
  }
  if (typeof status === 'object' && status !== null && 'Error' in status) {
    return 'error';
  }
  return 'missing';
}

/**
 * Resolve whether the configured transcription provider/model can start a
 * session.
 *
 * Only the adapter for the selected provider is consulted, and only the
 * selected model (from `transcriptModelConfig.model`) gates the verdict.
 * - selected model present with status `Available` → ready.
 * - selected model downloading → `downloading` (UI waits instead of re-downloading).
 * - selected model corrupted → `corrupted` (setup/re-download required).
 * - selected model present but not ready → `missing` for that model.
 * - configured model name not in the inventory at all → explicit `missing` for
 *   that configured model (a user-configured download never silently gates on a
 *   different model).
 * - no model configured → any available model is acceptable.
 */
export async function resolveTranscriptionReadiness(
  provider: string,
  selectedModel: string | null,
  adapter: ReadinessAdapter
): Promise<ReadinessReport> {
  if (!isSupportedProvider(provider)) {
    return {
      ready: false,
      state: 'error',
      provider,
      detail: `Unsupported transcription provider: ${provider}`,
    };
  }

  try {
    await adapter.init();
  } catch (error) {
    return {
      ready: false,
      state: 'error',
      provider,
      detail: error instanceof Error ? error.message : 'Failed to initialize transcription engine',
    };
  }

  try {
    const models = await adapter.getModels();

    if (selectedModel) {
      const selected = models.find((model) => model.name === selectedModel);

      if (!selected) {
        return {
          ready: false,
          state: 'missing',
          provider,
          model: selectedModel,
          detail: `Configured model "${selectedModel}" was not found. Download it or select another model.`,
        };
      }

      const state = modelStatusToReadiness(selected.status);
      if (state === 'ready') {
        return { ready: true, state, provider, model: selected.name };
      }
      if (state === 'downloading') {
        return { ready: false, state, provider, model: selected.name };
      }
      if (state === 'corrupted') {
        return {
          ready: false,
          state,
          provider,
          model: selected.name,
          detail: `Configured model "${selected.name}" is corrupted. Re-download it or select another model.`,
        };
      }
      if (state === 'error') {
        return {
          ready: false,
          state,
          provider,
          model: selected.name,
          detail: `Configured model "${selected.name}" failed its integrity check.`,
        };
      }
      return {
        ready: false,
        state: 'missing',
        provider,
        model: selected.name,
        detail: `Configured model "${selected.name}" is not available. Download it or select another model.`,
      };
    }

    const hasModels = await adapter.hasAvailableModels();
    return hasModels
      ? { ready: true, state: 'ready', provider }
      : { ready: false, state: 'missing', provider };
  } catch (error) {
    return {
      ready: false,
      state: 'error',
      provider,
      detail: error instanceof Error ? error.message : 'Failed to inspect transcription models',
    };
  }
}

/**
 * Stop-save decision.
 *
 * The backend always finalizes the audio file during `stop_recording`, so the
 * SQLite save must run whenever the stop succeeded — regardless of whether
 * live transcription finished first. Gating the save on transcription
 * completion caused silent data loss when transcription hung or timed out.
 */
export function shouldSaveMeetingAfterStop(stopSucceeded: boolean): boolean {
  return stopSucceeded;
}

/**
 * Backend recording snapshot, mirroring `get_recording_state`.
 */
export interface RecordingSnapshot {
  is_recording: boolean;
  is_paused: boolean;
  is_active: boolean;
  recording_duration: number | null;
  active_duration: number | null;
}

/**
 * Frontend lifecycle statuses expressed as plain strings so this module stays
 * free of the React `RecordingStatus` enum (and fully Node-importable). Map to
 * the enum at the context boundary.
 */
export type ReconcileStatus =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'stopping'
  | 'processing'
  | 'saving'
  | 'completed'
  | 'error';

export interface ReconcileResult {
  isRecording: boolean;
  isPaused: boolean;
  isActive: boolean;
  recordingDuration: number | null;
  activeDuration: number | null;
  status: ReconcileStatus;
  needsPoll: boolean;
}

const POST_APPLY_STATUSES: ReconcileStatus[] = ['stopping', 'processing', 'saving'];

/**
 * Reconcile a backend snapshot into frontend recording state.
 *
 * Used at mount/bootstrap (e.g. after a WebView refresh) so live recording
 * state survives a UI reload:
 * - Backend says recording → adopt `isRecording`/`isPaused`/durations, drive the
 *   status to `recording`, and require polling.
 * - Backend says not recording → only reset an IDLE frontend. While the
 *   frontend is in `stopping`/`processing`/`saving` (post-stop finalization) the
 *   lifecycle is preserved: the backend stops reporting recording as soon as
 *   the user requests a stop, before transcription/save has finished, so
 *   blindly resetting would abort legitimate finalization.
 * Durations fall back to the current frontend value when the backend reports
 * none.
 */
export function reconcileRecordingSnapshot(
  current: { status: ReconcileStatus; recordingDuration: number | null; activeDuration: number | null },
  backend: RecordingSnapshot
): ReconcileResult {
  if (backend.is_recording) {
    return {
      isRecording: true,
      isPaused: backend.is_paused,
      isActive: backend.is_active,
      recordingDuration: backend.recording_duration ?? current.recordingDuration,
      activeDuration: backend.active_duration ?? current.activeDuration,
      status: 'recording',
      needsPoll: true,
    };
  }

  const preserveLifecycle = POST_APPLY_STATUSES.includes(current.status);
  return {
    isRecording: false,
    isPaused: false,
    isActive: false,
    recordingDuration: backend.recording_duration ?? current.recordingDuration,
    activeDuration: backend.active_duration ?? current.activeDuration,
    status: preserveLifecycle ? current.status : 'idle',
    needsPoll: false,
  };
}

/**
 * Stop-outcome decision for the frontend recovery path.
 *
 * A successful `stop_recording` invoke is authoritative: the backend only
 * resolves after it stopped AND emitted `recording-stopped`, so finalization
 * (transcription wait, save) proceeds.
 *
 * When the invoke fails, the frontend would otherwise pretend the recording
 * ended (entering PROCESSING_TRANSCRIPTS/SAVING) even though the backend may
 * still be recording — silently discarding live audio. So on failure the
 * backend truth wins:
 * - backend reports not recording (partial failure) → treat as finalized and
 *   save (recovery data is preserved).
 * - backend reports still recording → recording-still-active; surface the
 *   failure and let the user retry Stop. Never pretend it ended.
 * - backend state could not be queried (null) → recording-still-active (fail
 *   safe: never finalize on an unknown backend).
 */
export type StopOutcome = 'finalized' | 'recording-still-active';

export function resolveStopOutcome(
  nativeStopSucceeded: boolean,
  backendIsRecording: boolean | null
): StopOutcome {
  if (nativeStopSucceeded) {
    return 'finalized';
  }
  if (backendIsRecording === false) {
    return 'finalized';
  }
  return 'recording-still-active';
}

/**
 * Device derivation for the permission hook and the Home preflight.
 *
 * These are derived from device enumeration, which is device *availability*,
 * not OS *permission*: a missing/empty list means either "no hardware" or
 * "permission denied the app access", and the messages say so honestly.
 */
export interface AudioDeviceEntry {
  name: string;
  device_type: 'Input' | 'Output';
}

export interface DeviceDerivation {
  hasMicrophone: boolean;
  hasSystemAudio: boolean;
  deviceStatus: 'checking' | 'available' | 'degraded';
  message: string | null;
}

export function deriveDeviceStatusFromDevices(devices: AudioDeviceEntry[]): DeviceDerivation {
  const hasMicrophone = devices.some((device) => device.device_type === 'Input');
  const hasSystemAudio = devices.some((device) => device.device_type === 'Output');
  return {
    hasMicrophone,
    hasSystemAudio,
    deviceStatus: hasMicrophone ? 'available' : 'degraded',
    message: hasMicrophone
      ? null
      : 'No microphone devices were detected. This can mean no mic is connected, or the app has not been granted microphone access.',
  };
}

export function deriveDeviceStatusFromError(): DeviceDerivation {
  return {
    hasMicrophone: false,
    hasSystemAudio: false,
    deviceStatus: 'degraded',
    message: 'Unable to enumerate audio devices. Microphone access may be required.',
  };
}