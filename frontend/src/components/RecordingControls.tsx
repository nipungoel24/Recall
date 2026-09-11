'use client';

import { invoke } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';
import { useCallback, useEffect, useState, useRef } from 'react';
import { Play, Pause, Square, Mic, AlertCircle, X } from 'lucide-react';
import { SummaryResponse } from '@/types/summary';
import { listen } from '@tauri-apps/api/event';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { toast } from 'sonner';

interface RecordingControlsProps {
  isRecording: boolean;
  onRecordingStop: (callApi?: boolean) => void;
  onRecordingStart: () => void;
  onTranscriptReceived: (summary: SummaryResponse) => void;
  onTranscriptionError?: (message: string) => void;
  onStopInitiated?: () => void; // Called immediately when stop button is clicked
  isRecordingDisabled: boolean;
  isParentProcessing: boolean;
  selectedDevices?: {
    micDevice: string | null;
    systemDevice: string | null;
  };
  meetingName?: string;
}

/**
 * Recording controls pill.
 *
 * Truthful by construction: the timer comes from the backend
 * (RecordingStateContext.recordingDuration), and the live indicator reflects
 * backend activity state — there is no simulated/fake waveform. Lifecycle
 * transitions (STARTING / RECORDING / PAUSED / STOPPING) come from the global
 * recording state machine.
 */
export const RecordingControls: React.FC<RecordingControlsProps> = ({
  isRecording,
  onRecordingStop,
  onRecordingStart,
  onTranscriptReceived,
  onTranscriptionError,
  onStopInitiated,
  isRecordingDisabled,
  isParentProcessing,
  selectedDevices,
  meetingName,
}) => {
  // Use global recording state context for pause state (syncs with tray operations)
  const recordingState = useRecordingState();
  const isPaused = recordingState.isPaused;

  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [deviceError, setDeviceError] = useState<{ title: string, message: string } | null>(null);

  // Live that reflects backend state without depending on prop identity.
  const status = recordingState.status;
  const isActive = recordingState.isActive;

  const formatTime = (time: number) => {
    const totalSeconds = Math.max(0, Math.floor(time));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Truthful timer from the backend recording state.
  const displayedDuration = formatTime(recordingState.recordingDuration ?? 0);

  useEffect(() => {
    const checkTauri = async () => {
      try {
        const result = await invoke('is_recording');
        console.log('Tauri is initialized and ready, is_recording result:', result);
      } catch (error) {
        console.error('Tauri initialization error:', error);
        toast.error('Failed to initialize recording', {
          description: 'Please check the console for details.',
        });
      }
    };
    checkTauri();
  }, []);

  const handleStartRecording = useCallback(async () => {
    if (isStarting || isRecording || status === RecordingStatus.STARTING || isRecordingDisabled) {
      return;
    }
    console.log('Starting recording...');
    console.log('Selected devices:', selectedDevices);
    console.log('Meeting name:', meetingName);

    setIsStarting(true);
    setDeviceError(null);

    try {
      // onRecordingStart performs provider-aware readiness validation,
      // then starts the backend recording. Errors are re-thrown so we can
      // surface device-specific guidance below.
      await onRecordingStart();
    } catch (error) {
      console.error('Failed to start recording:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined
      });

      const errorMsg = error instanceof Error ? error.message : String(error);

      // Pass-through: if readiness reported a missing model, the start hook
      // already showed the model selector — nothing fatal to surface here.
      if (errorMsg.includes('not ready') && !errorMsg.toLowerCase().includes('microphone')) {
        return;
      }

      if (errorMsg.includes('microphone') || errorMsg.includes('mic') || errorMsg.includes('input')) {
        setDeviceError({
          title: 'Microphone Not Available',
          message: 'Unable to access your microphone. Please check that:\n• Your microphone is connected\n• The app has microphone permissions\n• No other app is using the microphone'
        });
      } else if (errorMsg.includes('system audio') || errorMsg.includes('speaker') || errorMsg.includes('output')) {
        setDeviceError({
          title: 'System Audio Not Available',
          message: 'Unable to capture system audio. Please check that:\n• System audio capture is configured\n• The app has the required permissions (macOS)\n• System audio is properly configured'
        });
      } else if (errorMsg.includes('permission')) {
        setDeviceError({
          title: 'Permission Required',
          message: 'Recording permissions are required. Please grant microphone access and, for system audio, screen recording access (macOS), then try again.'
        });
      } else {
        setDeviceError({
          title: 'Recording Failed',
          message: 'Unable to start recording. Please check your audio device settings and try again.'
        });
      }
    } finally {
      setIsStarting(false);
    }
  }, [onRecordingStart, isStarting, isRecording, status, isRecordingDisabled, selectedDevices, meetingName]);

  const stopRecordingAction = useCallback(async () => {
    console.log('Executing stop recording...');
    try {
      setIsProcessing(true);
      const dataDir = await appDataDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const savePath = `${dataDir}/recording-${timestamp}.wav`;
      console.log('Saving recording to:', savePath);
      const result = await invoke('stop_recording', {
        args: {
          save_path: savePath
        }
      });
      console.log('stop_recording command completed successfully:', result);
      // The backend finalizes the audio on stop_recording; post-processing
      // (transcription wait → SQLite save) is owned by the stop hook.
      onRecordingStop(true);
    } catch (error) {
      console.error('Failed to stop recording:', error);
      let isNoRecording = false;
      if (error instanceof Error && error.message.includes('No recording in progress')) {
        isNoRecording = true;
      } else if (typeof error === 'string' && error.includes('No recording in progress')) {
        isNoRecording = true;
      } else if (error && typeof error === 'object' && 'toString' in error && error.toString().includes('No recording in progress')) {
        isNoRecording = true;
      }

      if (isNoRecording) {
        toast.info('Recording already stopped');
        return;
      }

      toast.error('Failed to stop recording', {
        description: 'The recording could not be finalized. Your audio may still be available in the recordings folder.',
      });
      // Stop did not succeed → nothing new to save; stay honest about it.
      onRecordingStop(false);
    } finally {
      setIsProcessing(false);
      setIsStopping(false);
    }
  }, [onRecordingStop]);

  const handleStopRecording = useCallback(async () => {
    console.log('handleStopRecording called - isRecording:', isRecording, 'status:', status);
    if (!isRecording || isStarting || isStopping || status === RecordingStatus.STOPPING) {
      console.log('Early return from handleStopRecording due to state check');
      return;
    }

    // Notify parent immediately (for UI state updates)
    onStopInitiated?.();

    setIsStopping(true);

    await stopRecordingAction();
  }, [isRecording, isStarting, isStopping, status, stopRecordingAction, onStopInitiated]);

  const handlePauseRecording = useCallback(async () => {
    if (!isRecording || isPaused || isPausing) return;

    console.log('Pausing recording...');
    setIsPausing(true);

    try {
      await invoke('pause_recording');
      // isPaused state now managed by RecordingStateContext via events
      console.log('Recording paused successfully');
    } catch (error) {
      console.error('Failed to pause recording:', error);
      toast.error('Failed to pause recording', {
        description: 'Please try again.',
      });
    } finally {
      setIsPausing(false);
    }
  }, [isRecording, isPaused, isPausing]);

  const handleResumeRecording = useCallback(async () => {
    if (!isRecording || !isPaused || isResuming) return;

    console.log('Resuming recording...');
    setIsResuming(true);

    try {
      await invoke('resume_recording');
      // isPaused state now managed by RecordingStateContext via events
      console.log('Recording resumed successfully');
    } catch (error) {
      console.error('Failed to resume recording:', error);
      toast.error('Failed to resume recording', {
        description: 'Please try again.',
      });
    } finally {
      setIsResuming(false);
    }
  }, [isRecording, isPaused, isResuming]);

  useEffect(() => {
    console.log('Setting up recording event listeners');
    let unsubscribes: (() => void)[] = [];

    const setupListeners = async () => {
      try {
        // Transcript error listener - handles both regular and actionable errors.
        // Deliberately does NOT trigger post-stop processing: the stop flow is
        // owned by stopRecordingAction / the recording-stop-complete path, and
        // stopping on a mid-session error caused silent data loss.
        const transcriptErrorUnsubscribe = await listen('transcript-error', (event) => {
          console.log('transcript-error event received:', event);
          console.error('Transcription error received:', event.payload);
          const errorMessage = event.payload as string;

          setIsProcessing(false);
          if (onTranscriptionError) {
            onTranscriptionError(errorMessage);
          }
        });

        // Transcription error listener - handles structured error objects
        const transcriptionErrorUnsubscribe = await listen('transcription-error', (event) => {
          console.log('transcription-error event received:', event);
          console.error('Transcription error received:', event.payload);

          let errorMessage: string;

          if (typeof event.payload === 'object' && event.payload !== null) {
            const payload = event.payload as { error: string, userMessage: string, actionable: boolean };
            errorMessage = payload.userMessage || payload.error;
          } else {
            errorMessage = String(event.payload);
          }

          setIsProcessing(false);

          // For actionable errors (like model loading failures), the main page
          // will handle showing the model selector. Regular errors are handled
          // by the useModalState global listener which shows a toast.
        });

        unsubscribes = [
          transcriptErrorUnsubscribe,
          transcriptionErrorUnsubscribe
        ];
        console.log('Recording event listeners set up successfully');
      } catch (error) {
        console.error('Failed to set up recording event listeners:', error);
      }
    };

    setupListeners();

    return () => {
      console.log('Cleaning up recording event listeners');
      unsubscribes.forEach(unsubscribe => {
        if (unsubscribe && typeof unsubscribe === 'function') {
          unsubscribe();
        }
      });
    };
  }, [onTranscriptReceived, onTranscriptionError]);

  const isWorking = isProcessing && !isParentProcessing;

  return (
    <TooltipProvider>
      <div className="flex flex-col space-y-2">
        <div
          role="group"
          aria-label="Recording controls"
          className="flex items-center gap-3 bg-surface border border-border rounded-lg px-4 py-2"
        >
          {isWorking || status === RecordingStatus.PROCESSING_TRANSCRIPTS || status === RecordingStatus.SAVING ? (
            <div className="flex items-center gap-2" role="status" aria-live="polite">
              <div className="h-4 w-4 rounded-full border-2 border-border border-t-primary animate-spin motion-reduce:animate-none" />
              <span className="text-sm text-muted-foreground">
                {status === RecordingStatus.SAVING ? 'Saving meeting…' : 'Processing recording…'}
              </span>
            </div>
          ) : (
            <>
              {!isRecording ? (
                // Start recording button
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleStartRecording}
                      disabled={isStarting || isRecordingDisabled || status === RecordingStatus.STARTING}
                      aria-label="Start recording"
                      aria-disabled={isStarting || isRecordingDisabled}
                      className="w-12 h-12 flex items-center justify-center bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-lg transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {isStarting || status === RecordingStatus.STARTING ? (
                        <div className="h-5 w-5 rounded-full border-2 border-destructive-foreground border-t-transparent animate-spin motion-reduce:animate-none" role="status" aria-label="Initializing recording" />
                      ) : (
                        <Mic size={20} />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Start recording</p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                // Recording controls (pause/resume + stop)
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => {
                          if (isPaused) {
                            handleResumeRecording();
                          } else {
                            handlePauseRecording();
                          }
                        }}
                        disabled={isPausing || isResuming || isStopping}
                        aria-label={isPaused ? 'Resume recording' : 'Pause recording'}
                        aria-pressed={!isPaused}
                        className="w-10 h-10 flex items-center justify-center border border-border bg-background text-foreground hover:bg-accent rounded-lg transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        {isPaused ? <Play size={16} /> : <Pause size={16} />}
                        {(isPausing || isResuming) && (
                          <div className="absolute -top-8 text-muted-foreground font-medium text-xs">
                            {isPausing ? 'Pausing…' : 'Resuming…'}
                          </div>
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{isPaused ? 'Resume recording' : 'Pause recording'}</p>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleStopRecording}
                        disabled={isStopping || isPausing || isResuming}
                        aria-label="Stop recording"
                        className="w-10 h-10 flex items-center justify-center bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-lg transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        <Square size={16} />
                        {isStopping && (
                          <div className="absolute -top-8 text-muted-foreground font-medium text-xs">
                            Stopping…
                          </div>
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Stop recording</p>
                    </TooltipContent>
                  </Tooltip>
                </>
              )}

              {/* Truthful live status: backend state + timer. No simulated audio. */}
              <div className="flex items-center gap-2 border-l border-border pl-3 min-w-[150px]">
                {isRecording && (
                  <span
                    aria-hidden="true"
                    className={`relative flex h-2.5 w-2.5 ${isPaused ? 'bg-warning' : 'bg-destructive'}`}
                  >
                    {isActive && (
                      <span className={`absolute inline-flex h-full w-full ${isPaused ? 'bg-warning' : 'bg-destructive'}/60 motion-safe:animate-ping motion-reduce:animate-none`} />
                    )}
                  </span>
                )}
                <span
                  className="text-xs font-medium uppercase tracking-wider text-muted-foreground tabular-nums"
                  role="status"
                  aria-live="polite"
                >
                  {isStopping
                    ? 'Stopping…'
                    : isRecording
                      ? isPaused
                        ? 'Paused'
                        : `REC ${displayedDuration}`
                      : isStarting
                        ? 'Initializing…'
                        : 'Ready'}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Device error alert */}
        {deviceError && (
          <Alert variant="destructive" className="border-destructive/40 bg-destructive/5">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <button
              onClick={() => setDeviceError(null)}
              className="absolute right-3 top-3 text-destructive hover:text-destructive/80 transition-colors"
              aria-label="Close alert"
            >
              <X className="h-4 w-4" />
            </button>
            <AlertTitle className="text-foreground font-semibold mb-2">
              {deviceError.title}
            </AlertTitle>
            <AlertDescription className="text-muted-foreground">
              {deviceError.message.split('\n').map((line, i) => (
                <div key={i} className={i > 0 ? 'ml-2' : ''}>
                  {line}
                </div>
              ))}
            </AlertDescription>
          </Alert>
        )}
      </div>
    </TooltipProvider>
  );
};