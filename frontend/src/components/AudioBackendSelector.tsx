import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface BackendInfo {
  id: string;
  name: string;
  description: string;
}

interface AudioBackendSelectorProps {
  currentBackend?: string;
  onBackendChange?: (backend: string) => void;
  disabled?: boolean;
}

export function AudioBackendSelector({
  currentBackend: propBackend,
  onBackendChange,
  disabled = false,
}: AudioBackendSelectorProps) {
  const [backends, setBackends] = useState<BackendInfo[]>([]);
  const [currentBackend, setCurrentBackend] = useState<string>('coreaudio');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load available backends and current selection
  useEffect(() => {
    const loadBackends = async () => {
      try {
        setLoading(true);
        setError(null);

        // Get backend info (includes name and description)
        const backendInfo = await invoke<BackendInfo[]>('get_audio_backend_info');
        setBackends(backendInfo);

        // Get current backend if not provided via props
        if (!propBackend) {
          const current = await invoke<string>('get_current_audio_backend');
          setCurrentBackend(current);
        } else {
          setCurrentBackend(propBackend);
        }
      } catch (err) {
        console.error('Failed to load audio backends:', err);
        setError('Failed to load backend options');
      } finally {
        setLoading(false);
      }
    };

    loadBackends();
  }, [propBackend]);

  // Handle backend selection
  const handleBackendChange = async (backendId: string) => {
    try {
      setError(null);
      await invoke('set_audio_backend', { backend: backendId });
      setCurrentBackend(backendId);

      // Notify parent component
      if (onBackendChange) {
        onBackendChange(backendId);
      }

      console.log(`Audio backend changed to: ${backendId}`);
    } catch (err) {
      console.error('Failed to set audio backend:', err);
      setError('Failed to change backend. Please try again.');
    }
  };

  // Only show selector if there are multiple backends
  if (loading) {
    return (
      <div
        className="animate-pulse motion-reduce:animate-none"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <span className="sr-only">Loading audio backends…</span>
        <div className="h-4 bg-muted rounded w-32 mb-2" />
        <div className="h-10 bg-muted rounded" />
      </div>
    );
  }

  // Hide if only one backend available
  if (backends.length <= 1) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">System Audio Backend</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="About audio capture methods"
              className="text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              <Info className="h-4 w-4" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-64 p-3 text-xs">
            <p className="font-semibold mb-1">Audio Capture Methods</p>
            <ul className="space-y-1">
              {backends.map((backend) => (
                <li key={backend.id}>
                  <span className="font-medium">{backend.name}:</span> {backend.description}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-muted-foreground">
              Try different backends to find which works best for your system.
            </p>
          </TooltipContent>
        </Tooltip>
      </div>

      {error && (
        <div
          role="alert"
          className="p-2 text-xs text-destructive bg-destructive/5 border border-destructive/30 rounded-md"
        >
          {error}
        </div>
      )}

      <div className="space-y-2" role="radiogroup" aria-label="System audio backend">
        {backends.map((backend) => {
          // Disable Core Audio option
          const isCoreAudio = backend.id === 'screencapturekit';
          const isDisabled = disabled || isCoreAudio;
          const isSelected = currentBackend === backend.id;

          return (
            <label
              key={backend.id}
              className={`flex items-start p-3 border rounded-md transition-colors ${
                isSelected
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-foreground/20 bg-background'
              } ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <input
                type="radio"
                name="audioBackend"
                value={backend.id}
                checked={isSelected}
                onChange={() => handleBackendChange(backend.id)}
                disabled={isDisabled}
                className="mt-1 h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
              <div className="ml-3 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">
                    {backend.name}
                  </span>
                  {isSelected && (
                    <span className="text-xs font-medium text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-md">
                      Active
                    </span>
                  )}
                  {isCoreAudio && (
                    <span className="text-xs font-medium text-muted-foreground bg-muted border border-border px-2 py-0.5 rounded-md">
                      Disabled
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{backend.description}</p>
              </div>
            </label>
          );
        })}
      </div>

      <div className="text-xs text-muted-foreground space-y-1">
        <p>• Backend selection only affects system audio capture</p>
        <p>• Microphone always uses the default method</p>
        <p>• Changes apply to new recording sessions</p>
      </div>
    </div>
  );
}
