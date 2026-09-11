/**
 * Recording readiness resolution.
 *
 * Pure, dependency-free decision helpers shared by the recording hooks and the
 * Phase 4 regression suite. No Tauri imports here so the behavior is
 * testable without a backend.
 *
 * The transcription model readiness check is provider-aware: the configured
 * provider decides which engine (Parakeet or Local Whisper) is consulted.
 * This keeps Local Whisper users fully independent of Parakeet.
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

export type ReadinessState = 'ready' | 'missing' | 'downloading' | 'error' | 'unknown';

export interface ReadinessReport {
  ready: boolean;
  state: ReadinessState;
  provider: string;
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

export function isModelDownloading(models: Array<{ status: unknown }>): boolean {
  return models.some((model) => statusIsDownloading(model.status));
}

/**
 * Resolve whether the configured transcription provider can start a session.
 *
 * Only the adapter for the selected provider is consulted. A download in
 * progress is reported as `downloading` so the UI can wait instead of telling
 * the user to download again.
 */
export async function resolveTranscriptionReadiness(
  provider: string,
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
    if (isModelDownloading(models)) {
      return { ready: false, state: 'downloading', provider };
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