'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useEffect, useState } from 'react';

interface RecordingStatusBarProps {
  isPaused?: boolean;
}

export const RecordingStatusBar: React.FC<RecordingStatusBarProps> = ({ isPaused = false }) => {
  // Canonical duration: the same total duration (including pauses) that
  // RecordingControls shows. Backend polls every 500ms, providing smooth updates.
  const { recordingDuration } = useRecordingState();

  // Display state synced from backend
  const [displaySeconds, setDisplaySeconds] = useState(0);

  const prefersReducedMotion = useReducedMotion();

  // Sync with backend duration when it changes (handles refresh/navigation)
  useEffect(() => {
    if (recordingDuration !== null) {
      // Round to nearest second to avoid decimal issues
      setDisplaySeconds(Math.floor(recordingDuration));
    }
  }, [recordingDuration]);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <motion.div
      initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -10 }}
      animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -10 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
      className="flex items-center gap-2 px-3 py-2 bg-surface border border-border rounded-lg mb-2"
    >
      {/* Announce only state transitions. The elapsed clock below updates every
          second, so putting it in this live region would flood a screen reader. */}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {isPaused ? 'Recording paused' : 'Recording in progress'}
      </span>

      <span
        aria-hidden="true"
        className={`w-2 h-2 rounded-full ${
          isPaused
            ? 'bg-warning'
            : 'bg-destructive motion-safe:animate-pulse motion-reduce:animate-none'
        }`}
      />

      <span
        className={`text-sm ${isPaused ? 'text-muted-foreground' : 'text-foreground'}`}
        aria-hidden="true"
      >
        {isPaused ? 'Paused' : 'REC'} • {formatDuration(displaySeconds)}
      </span>

      {/* Exposed to assistive tech as a queryable timer, announced on demand
          rather than once per tick. */}
      <span
        role="timer"
        aria-label={`Elapsed recording time ${Math.floor(displaySeconds / 60)} minutes ${
          displaySeconds % 60
        } seconds`}
        className="sr-only"
      />
    </motion.div>
  );
};