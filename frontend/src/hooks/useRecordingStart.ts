import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { usePermissionCheck } from '@/hooks/usePermissionCheck';
import { recordingService } from '@/services/recordingService';
import { showRecordingNotification } from '@/lib/recordingNotification';
import { toast } from 'sonner';
import { ParakeetAPI } from '@/lib/parakeet';
import { WhisperAPI } from '@/lib/whisper';
import {
  getReadinessAdapter,
  resolveTranscriptionReadiness,
  type ReadinessAdapters,
  type ReadinessReport,
} from '@/lib/recordingReadiness';

interface UseRecordingStartReturn {
  handleRecordingStart: () => Promise<void>;
  isAutoStarting: boolean;
}

type StartSource = 'manual' | 'auto' | 'direct';

/**
 * Custom hook for managing recording start lifecycle.
 * Handles both manual start (button click) and auto-start (from sidebar navigation).
 *
 * Features:
 * - Provider-aware model readiness (Parakeet OR Local Whisper)
 * - One orchestration path for manual, auto-start, and direct-start sources
 * - Meeting title generation (format: Meeting DD_MM_YY_HH_MM_SS)
 * - Transcript clearing on start
 * - Recording notification display
 */
export function useRecordingStart(
  showModal?: (name: 'modelSelector', message?: string) => void
): UseRecordingStartReturn {
  const [isAutoStarting, setIsAutoStarting] = useState(false);

  const { clearTranscripts, setMeetingTitle } = useTranscripts();
  const { setIsMeetingActive } = useSidebar();
  const { selectedDevices, transcriptModelConfig } = useConfig();
  const { setStatus, isRecording } = useRecordingState();
  const { checkPermissions: checkDevices } = usePermissionCheck();

  // Generate meeting title with timestamp
  const generateMeetingTitle = useCallback(() => {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear()).slice(-2);
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `Meeting ${day}_${month}_${year}_${hours}_${minutes}_${seconds}`;
  }, []);

  // Provider adapters: the resolver only touches the engine for the configured provider.
  const readinessAdapters = useMemo<ReadinessAdapters>(
    () => ({
      parakeet: {
        init: () => ParakeetAPI.init(),
        hasAvailableModels: () => ParakeetAPI.hasAvailableModels(),
        getModels: () =>
          ParakeetAPI.getAvailableModels().then((models) =>
            models.map((m) => ({ name: m.name, status: m.status }))
          ),
      },
      localWhisper: {
        init: () => WhisperAPI.init(),
        hasAvailableModels: () => WhisperAPI.hasAvailableModels(),
        getModels: () =>
          WhisperAPI.getAvailableModels().then((models) =>
            models.map((m) => ({ name: m.name, status: m.status }))
          ),
      },
    }),
    []
  );

  // Selected-model-aware readiness. The configured model (not the whole
  // collection) gates the verdict, so an unrelated download or a corrupt
  // sibling model never blocks or masks the selected model's true state.
  const checkModelReady = useCallback(
    async (provider: string): Promise<ReadinessReport> => {
      const adapter = getReadinessAdapter(provider, readinessAdapters);
      if (!adapter) {
        return {
          ready: false,
          state: 'error',
          provider,
          detail: `Unsupported transcription provider: ${provider}`,
        };
      }
      const selectedModel = transcriptModelConfig.model ?? null;
      return resolveTranscriptionReadiness(provider, selectedModel, adapter);
    },
    [readinessAdapters, transcriptModelConfig]
  );

  const notifyModelIssue = useCallback(
    (report: ReadinessReport) => {
      const modelClause = report.model
        ? `Configured transcription model "${report.model}"`
        : 'The configured transcription model';

      if (report.state === 'downloading') {
        toast.info('Model download in progress', {
          description: `${modelClause} is still downloading. Start recording once the download finishes.`,
          duration: 5000,
        });
      } else if (report.state === 'corrupted') {
        toast.error('Transcription model corrupted', {
          description: `${modelClause} failed its integrity check. Re-download it or select another model.`,
          duration: 5000,
        });
        showModal?.('modelSelector', 'Transcription model setup required');
      } else {
        toast.error('Transcription model not ready', {
          description: `${modelClause} is not available. Download it or select another model.`,
          duration: 5000,
        });
        showModal?.('modelSelector', 'Transcription model setup required');
      }
      setStatus(RecordingStatus.IDLE);
    },
    [setStatus, showModal]
  );

  // Single orchestration path for every start source.
  const startRecordingOrchestration = useCallback(
    async (source: StartSource): Promise<void> => {
      // Pre-flight: microphone availability. Device enumeration is NOT an OS
      // permission verdict; a missing microphone is actionable either way
      // ("connect a mic" or "grant microphone access"), and we never claim a
      // permission grant we cannot prove. Absence of a system-audio device is
      // non-blocking — mic-only recording is supported.
      const devices = await checkDevices();
      if (!devices.hasMicrophone) {
        console.warn(`Recording start blocked: no microphone devices available (${source})`);
        setStatus(RecordingStatus.IDLE);
        toast.error('Microphone unavailable', {
          description: 'Connect a microphone or grant microphone access, then recheck and try again.',
          duration: 5000,
        });
        return;
      }

      const provider = transcriptModelConfig.provider || 'parakeet';

      const readiness = await checkModelReady(provider);
      if (!readiness.ready) {
        console.warn(`Recording start blocked: ${provider} not ready (${readiness.state})`);
        notifyModelIssue(readiness);
        return;
      }

      const meetingTitle = generateMeetingTitle();
      setMeetingTitle(meetingTitle);

      // Explicit STARTING transition before contacting the backend.
      setStatus(RecordingStatus.STARTING, 'Initializing recording...');

      try {
        await recordingService.startRecordingWithDevices(
          selectedDevices?.micDevice || null,
          selectedDevices?.systemDevice || null,
          meetingTitle
        );

        // UI state follows via the backend's `recording-started` event, which
        // RecordingStateContext listens for (single source of truth).
        clearTranscripts();
        setIsMeetingActive(true);

        await showRecordingNotification();
      } catch (error) {
        console.error(`Failed to start recording (${source}):`, error);
        setStatus(
          RecordingStatus.ERROR,
          error instanceof Error ? error.message : 'Failed to start recording'
        );

        if (source === 'manual') {
          // Re-throw so RecordingControls can surface device-specific guidance.
          throw error;
        }
        toast.error('Failed to start recording', {
          description: 'Check your audio devices and try again.',
          duration: 5000,
        });
      }
    },
    [
      transcriptModelConfig,
      checkModelReady,
      notifyModelIssue,
      generateMeetingTitle,
      setMeetingTitle,
      setStatus,
      selectedDevices,
      clearTranscripts,
      setIsMeetingActive,
      checkDevices,
    ]
  );

  const handleRecordingStart = useCallback(
    async (): Promise<void> => {
      return startRecordingOrchestration('manual');
    },
    [startRecordingOrchestration]
  );

  // Check for autoStartRecording flag (tray) and start recording automatically
  useEffect(() => {
    const checkAutoStartRecording = async () => {
      if (typeof window === 'undefined') {
        return;
      }
      const shouldAutoStart = sessionStorage.getItem('autoStartRecording');
      if (shouldAutoStart === 'true' && !isRecording && !isAutoStarting) {
        console.log('Auto-starting recording from navigation...');
        setIsAutoStarting(true);
        sessionStorage.removeItem('autoStartRecording');

        try {
          await startRecordingOrchestration('auto');
        } catch (error) {
          console.error('Failed to auto-start recording:', error);
        } finally {
          setIsAutoStarting(false);
        }
      }
    };

    checkAutoStartRecording();
  }, [isRecording, isAutoStarting, startRecordingOrchestration]);

  // Listen for direct recording trigger from sidebar when already on home page
  useEffect(() => {
    const handleDirectStart = async () => {
      if (isRecording || isAutoStarting) {
        console.log('Recording already in progress, ignoring direct start event');
        return;
      }

      console.log('Direct start from sidebar');
      setIsAutoStarting(true);

      try {
        await startRecordingOrchestration('direct');
      } catch (error) {
        console.error('Failed to start recording from sidebar:', error);
      } finally {
        setIsAutoStarting(false);
      }
    };

    window.addEventListener('start-recording-from-sidebar', handleDirectStart);

    return () => {
      window.removeEventListener('start-recording-from-sidebar', handleDirectStart);
    };
  }, [isRecording, isAutoStarting, startRecordingOrchestration]);

  return {
    handleRecordingStart,
    isAutoStarting,
  };
}