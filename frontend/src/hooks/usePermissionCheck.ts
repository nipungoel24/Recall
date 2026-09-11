import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

/**
 * Device availability, not OS permission state.
 *
 * :NOTE: The frontend cannot query operating-system permission grants for the
 * microphone or system audio directly. What it CAN do is enumerate audio
 * devices the app can see. A missing/empty device list therefore means either
 * "no hardware" or "permission denied the app access" — we can't distinguish
 * them from here, and we must not pretend we can. The boolean fields below are
 * strictly derived from device enumeration; `message` states that honestly.
 *
 * On macOS, calling `trigger_microphone_permission` attempts an input stream,
 * which is what surfaces the OS permission prompt; on Windows/Linux the same
 * command tests that the input pipeline can start.
 */

export type DeviceAvailability = 'checking' | 'available' | 'degraded';

export interface PermissionStatus {
  hasMicrophone: boolean;
  hasSystemAudio: boolean;
  isChecking: boolean;
  error: string | null;
  deviceStatus: DeviceAvailability;
  message: string | null;
}

interface AudioDevice {
  name: string;
  device_type: 'Input' | 'Output';
}

export function usePermissionCheck() {
  const [status, setStatus] = useState<PermissionStatus>({
    hasMicrophone: false,
    hasSystemAudio: false,
    isChecking: true,
    error: null,
    deviceStatus: 'checking',
    message: null,
  });

  const checkPermissions = async () => {
    setStatus(prev => ({ ...prev, isChecking: true, error: null }));

    try {
      const devices = await invoke<AudioDevice[]>('get_audio_devices');

      const inputDevices = devices.filter(d => d.device_type === 'Input');
      const outputDevices = devices.filter(d => d.device_type === 'Output');
      const hasMicrophone = inputDevices.length > 0;
      const hasSystemAudio = outputDevices.length > 0;

      console.log('Device availability check:', {
        hasMicrophone,
        hasSystemAudio,
        inputDevices: inputDevices.length,
        outputDevices: outputDevices.length
      });

      setStatus({
        hasMicrophone,
        hasSystemAudio,
        isChecking: false,
        error: null,
        deviceStatus: hasMicrophone ? 'available' : 'degraded',
        message: hasMicrophone
          ? null
          : 'No microphone devices were detected. This can mean no mic is connected, or the app has not been granted microphone access.',
      });

      return { hasMicrophone, hasSystemAudio };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to check devices';
      console.error('Failed to check audio devices:', error);
      setStatus({
        hasMicrophone: false,
        hasSystemAudio: false,
        isChecking: false,
        error: message,
        deviceStatus: 'degraded',
        message: 'Unable to enumerate audio devices. Microphone access may be required.',
      });
      return { hasMicrophone: false, hasSystemAudio: false };
    }
  };

  const requestPermissions = async () => {
    try {
      // On macOS this attempts an input stream, surfacing the OS permission
      // prompt. On Windows/Linux it verifies the input pipeline can start.
      const granted = await invoke<boolean>('trigger_microphone_permission');
      console.log('Microphone permission trigger result:', granted);
    } catch (error) {
      console.error('Failed to trigger microphone permission:', error);
    }

    // Re-enumerate after triggering — permission prompts are async on macOS.
    setTimeout(() => {
      checkPermissions();
    }, 1000);
  };

  return {
    ...status,
    checkPermissions,
    requestPermissions,
  };
}