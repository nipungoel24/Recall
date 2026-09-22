'use client';

import { useCallback, useRef, useEffect, useState } from 'react';
import { meetingIntelligenceService } from '@/services/meetingIntelligenceService';
import type { MeetingIntelligenceItem, MeetingIntelligenceItemSource } from '@/types';

/**
 * Options for configuring evidence navigation between intelligence items and transcript segments.
 */
export interface EvidenceNavigationOptions {
  /** Current meeting ID — used to strictly enforce cross-meeting boundary */
  meetingId: string;
  /** Current active tab in the workspace */
  activeTab: string;
  /** Callback to switch active tab (specifically to 'transcript') */
  setActiveTab: (tab: any) => void;
  /** Callback to scroll transcript to a target segment index */
  scrollToSegment: (index: number) => void;
  /** Callback to highlight the target segment */
  highlightSegment?: (segmentId: string) => void;
  /** Callback to clear any active highlight */
  clearHighlight?: () => void;
}

export interface EvidenceNavigationResult {
  /** Navigate to evidence for an intelligence item (returns true if navigated, false if blocked/failed) */
  navigateToEvidence: (item: { meeting_id?: string; sources?: MeetingIntelligenceItemSource[] }) => Promise<boolean>;
  /** Check if an item has valid evidence belonging to the current meeting */
  hasValidEvidence: (item: { meeting_id?: string; sources?: MeetingIntelligenceItemSource[] }) => boolean;
  /** Currently navigating state */
  isNavigating: boolean;
  /** Current error message if navigation failed or was blocked */
  error: string | null;
  /** Manually clear any error state */
  clearError: () => void;
}

/**
 * Hook for evidence navigation between intelligence items and transcript segments.
 *
 * Core Invariant (§13 Cross-Meeting Safety):
 * Before navigating, source.meeting_id === currentMeetingId must be strictly validated.
 * If IDs differ or source is absent, navigation is blocked, no foreign transcript is requested,
 * and no transcript contents are logged.
 */
export function useEvidenceNavigation(options: EvidenceNavigationOptions): EvidenceNavigationResult {
  const {
    meetingId,
    activeTab,
    setActiveTab,
    scrollToSegment,
    highlightSegment,
    clearHighlight,
  } = options;

  const [isNavigating, setIsNavigating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isNavigatingRef = useRef(false);

  // Clear active highlight timeout on unmount
  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * Check if an intelligence item has valid evidence in the current meeting.
   * Validates that source transcript segments belong to current meeting.
   */
  const hasValidEvidence = useCallback(
    (item: { meeting_id?: string; sources?: MeetingIntelligenceItemSource[] }): boolean => {
      if (!item || !item.sources || item.sources.length === 0) {
        return false;
      }

      // Find at least one source matching this meeting with a non-empty segment ID
      return item.sources.some((src) => {
        const sourceMeetingId = src.meeting_id || item.meeting_id;
        if (sourceMeetingId && sourceMeetingId !== meetingId) {
          return false;
        }
        return Boolean(src.transcript_segment_id && src.transcript_segment_id.trim() !== '');
      });
    },
    [meetingId]
  );

  /**
   * Navigate to evidence for a specific intelligence item.
   * Switches to Transcript tab, queries segment position, scrolls to segment, and highlights it.
   */
  const navigateToEvidence = useCallback(
    async (item: { meeting_id?: string; sources?: MeetingIntelligenceItemSource[] }): Promise<boolean> => {
      if (isNavigatingRef.current) return false;

      if (!item || !item.sources || item.sources.length === 0) {
        setError('No evidence sources available for this item');
        return false;
      }

      // Find the first valid source
      const validSource = item.sources.find(
        (src) => src.transcript_segment_id && src.transcript_segment_id.trim() !== ''
      );

      if (!validSource) {
        setError('No valid evidence sources found for this item');
        return false;
      }

      // Cross-Meeting Safety Invariant (§13):
      // Must validate that source.meeting_id matches currentMeetingId
      const sourceMeetingId = validSource.meeting_id || item.meeting_id;
      if (sourceMeetingId && sourceMeetingId !== meetingId) {
        setError('Cross-meeting navigation blocked: evidence source belongs to another meeting');
        return false;
      }

      const segmentId = validSource.transcript_segment_id;

      // Clear previous errors and start navigation
      setError(null);
      isNavigatingRef.current = true;
      setIsNavigating(true);

      try {
        // Clear any previous highlight
        if (clearHighlight) {
          clearHighlight();
        }

        // 1. Query position from backend via Gate 1 service
        const position = await meetingIntelligenceService.getTranscriptSegmentPosition(
          meetingId,
          segmentId
        );

        if (!position || position.position < 0) {
          setError('Could not locate evidence segment in transcript');
          return false;
        }

        // 2. Switch to Transcript tab if not already active
        if (activeTab !== 'transcript') {
          setActiveTab('transcript');
          // Brief tick to allow tab mounting
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        // 3. Scroll to segment position
        scrollToSegment(position.position);

        // 4. Temporarily highlight target segment
        if (highlightSegment) {
          highlightSegment(segmentId);

          if (highlightTimeoutRef.current) {
            clearTimeout(highlightTimeoutRef.current);
          }

          highlightTimeoutRef.current = setTimeout(() => {
            if (clearHighlight) {
              clearHighlight();
            }
          }, 3000);
        }

        return true;
      } catch (err) {
        console.error('Evidence navigation failed:', err);
        setError('Failed to navigate to transcript evidence');
        return false;
      } finally {
        isNavigatingRef.current = false;
        setIsNavigating(false);
      }
    },
    [meetingId, activeTab, setActiveTab, scrollToSegment, highlightSegment, clearHighlight]
  );

  return {
    navigateToEvidence,
    hasValidEvidence,
    isNavigating,
    error,
    clearError,
  };
}