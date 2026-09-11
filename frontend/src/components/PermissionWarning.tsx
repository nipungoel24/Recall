import React from 'react';
import { AlertTriangle, Mic, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { invoke } from '@tauri-apps/api/core';
import { useIsLinux } from '@/hooks/usePlatform';

interface PermissionWarningProps {
  hasMicrophone: boolean;
  hasSystemAudio: boolean;
  onRecheck: () => void;
  isRechecking?: boolean;
}

export function PermissionWarning({
  hasMicrophone,
  hasSystemAudio,
  onRecheck,
  isRechecking = false
}: PermissionWarningProps) {
  const isLinux = useIsLinux();

  // Don't show on Linux - permission handling is not needed
  if (isLinux) {
    return null;
  }

  // Don't show if both are available
  if (hasMicrophone && hasSystemAudio) {
    return null;
  }

  const isMacOS = navigator.userAgent.includes('Mac');

  const openMicrophoneSettings = async () => {
    if (isMacOS) {
      try {
        await invoke('open_system_settings', { preferencePane: 'Privacy_Microphone' });
      } catch (error) {
        console.error('Failed to open microphone settings:', error);
      }
    }
  };

  return (
    <div className="max-w-md mb-4 space-y-3">
      {(!hasMicrophone || !hasSystemAudio) && (
        <Alert variant="destructive" className="border-destructive/40 bg-destructive/5">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <AlertTitle className="text-foreground font-semibold">
            <div className="flex items-center gap-2">
              {!hasMicrophone && <Mic className="h-4 w-4" />}
              {!hasMicrophone && !hasSystemAudio
                ? 'Audio Devices Not Available'
                : !hasMicrophone
                  ? 'Microphone Not Available'
                  : 'System Audio Not Available'}
            </div>
          </AlertTitle>
          <AlertDescription className="text-muted-foreground mt-2">
            {!hasMicrophone && (
              <p className="mb-3">
                No microphone was detected. This can mean your microphone is not connected,
                or the app has not been granted microphone access.
              </p>
            )}

            {!hasSystemAudio && (
              <p className="mb-3">
                {hasMicrophone
                  ? 'System audio capture is not available. You can still record with your microphone, but computer audio won\'t be captured.'
                  : 'No system audio output was detected for capture.'}
              </p>
            )}
          </AlertDescription>

          <div className="mt-4 flex flex-wrap gap-2">
            {isMacOS && !hasMicrophone && (
              <button
                onClick={openMicrophoneSettings}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-surface border border-border rounded-md transition-colors text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Mic className="h-4 w-4" />
                Open Microphone Settings
              </button>
            )}
            <button
              onClick={onRecheck}
              disabled={isRechecking}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-surface border border-border rounded-md transition-colors text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RefreshCw className={`h-4 w-4 ${isRechecking ? 'animate-spin' : ''}`} />
              Recheck
            </button>
          </div>
        </Alert>
      )}
    </div>
  );
}