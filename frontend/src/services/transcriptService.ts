/**
 * Transcript Service
 *
 * Handles all transcription-related Tauri backend calls and events.
 * Pure 1-to-1 wrapper - no error handling changes, exact same behavior as direct invoke/listen calls.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { TranscriptUpdate, Transcript } from '@/types';

/**
 * Terminal state of a transcription run, as reported by the Rust
 * `transcription::outcome` module.
 *
 * Only `completed` means the transcript covers the whole meeting. `partial`,
 * `failed`, `cancelled` and `timed_out` all mean the transcript is short of
 * the meeting and must not be presented as a complete result.
 */
export type TranscriptionOutcome =
  | 'idle'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

/**
 * Real payload of the `get_transcription_status` command.
 *
 * This interface previously declared `chunks_in_queue` and `last_activity_ms`.
 * The backend has never returned those fields, so `status.chunks_in_queue === 0`
 * compared `undefined` to `0` and was therefore always false — which made the
 * post-stop completion checks unreachable and left the UI relying on a fixed
 * 60 second sleep.
 */
export interface TranscriptionStatus {
  outcome: TranscriptionOutcome;
  /** True only when the transcript is known to cover the whole meeting. */
  is_complete: boolean;
  chunks_queued: number;
  chunks_completed: number;
  chunks_succeeded: number;
  chunks_failed: number;
  /** Chunks that left the queue without being accounted for. */
  chunks_pending: number;
  is_processing: boolean;
  last_error: string | null;
}

export interface TranscriptionErrorPayload {
  error: string;
  userMessage: string;
  actionable: boolean;
}

export interface ModelDownloadCompletePayload {
  modelName: string;
}

/**
 * Transcript Service
 * Singleton service for managing transcription operations and transcript history
 */
export class TranscriptService {
  /**
   * Get transcript history from backend (for reload sync)
   * @returns Promise<Transcript[]>
   */
  async getTranscriptHistory(): Promise<Transcript[]> {
    return invoke<Transcript[]>('get_transcript_history');
  }

  /**
   * Get current transcription queue status
   * @returns Promise with transcription status
   */
  async getTranscriptionStatus(): Promise<TranscriptionStatus> {
    return invoke<TranscriptionStatus>('get_transcription_status');
  }

  // Event Listeners

  /**
   * Listen for real-time transcript updates
   * @param callback - Function to call when new transcript segment arrives
   * @returns Promise that resolves to unlisten function
   */
  async onTranscriptUpdate(callback: (update: TranscriptUpdate) => void): Promise<UnlistenFn> {
    return listen<TranscriptUpdate>('transcript-update', (event) => {
      callback(event.payload);
    });
  }

  /**
   * Listen for transcription-complete event
   * @param callback - Function to call when transcription processing is complete
   * @returns Promise that resolves to unlisten function
   */
  async onTranscriptionComplete(callback: () => void): Promise<UnlistenFn> {
    return listen('transcription-complete', callback);
  }

  /**
   * Listen for transcription-error event (structured errors)
   * @param callback - Function to call when transcription error occurs
   * @returns Promise that resolves to unlisten function
   */
  async onTranscriptionError(callback: (error: TranscriptionErrorPayload) => void): Promise<UnlistenFn> {
    return listen<TranscriptionErrorPayload>('transcription-error', (event) => {
      callback(event.payload);
    });
  }

  /**
   * Listen for transcript-error event (legacy error format)
   * @param callback - Function to call when transcript error occurs
   * @returns Promise that resolves to unlisten function
   */
  async onTranscriptError(callback: (error: string) => void): Promise<UnlistenFn> {
    return listen<string>('transcript-error', (event) => {
      callback(event.payload);
    });
  }

  /**
   * Listen for Whisper model download complete event
   * @param callback - Function to call when Whisper model download completes
   * @returns Promise that resolves to unlisten function
   */
  async onModelDownloadComplete(callback: (modelName: string) => void): Promise<UnlistenFn> {
    return listen<ModelDownloadCompletePayload>('model-download-complete', (event) => {
      callback(event.payload.modelName);
    });
  }

  /**
   * Listen for Parakeet model download complete event
   * @param callback - Function to call when Parakeet model download completes
   * @returns Promise that resolves to unlisten function
   */
  async onParakeetModelDownloadComplete(callback: (modelName: string) => void): Promise<UnlistenFn> {
    return listen<ModelDownloadCompletePayload>('parakeet-model-download-complete', (event) => {
      callback(event.payload.modelName);
    });
  }
}

// Export singleton instance
export const transcriptService = new TranscriptService();
