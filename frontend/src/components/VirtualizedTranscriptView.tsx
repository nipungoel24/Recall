'use client';

import { useCallback, useRef, useReducer, startTransition, useEffect, useState, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { useTranscriptStreaming } from "@/hooks/useTranscriptStreaming";
import { ConfidenceIndicator } from "./ConfidenceIndicator";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { RecordingStatusBar } from "./RecordingStatusBar";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { MessageSquare, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { TranscriptSegmentData } from "@/types";

export interface VirtualizedTranscriptViewProps {
    /** Transcript segments to display */
    segments: TranscriptSegmentData[];
    /** Whether recording is in progress */
    isRecording?: boolean;
    /** Whether recording is paused */
    isPaused?: boolean;
    /** Whether processing/finalizing transcription */
    isProcessing?: boolean;
    /** Whether stopping */
    isStopping?: boolean;
    /** Enable streaming effect for latest segment */
    enableStreaming?: boolean;
    /** Show confidence indicators */
    showConfidence?: boolean;
    /** Completely disable auto-scroll behavior (for meeting details page) */
    disableAutoScroll?: boolean;

    // Truthful status props
    isLoading?: boolean;
    error?: string | null;
    onRetry?: () => void;

    // Pagination props (infinite scroll)
    hasMore?: boolean;
    isLoadingMore?: boolean;
    totalCount?: number;
    loadedCount?: number;
    onLoadMore?: () => void;

    // Evidence navigation props
    highlightedSegmentId?: string | null;
    scrollToIndex?: number | null;
}

// Threshold for enabling virtualization (below this, use simple rendering)
const VIRTUALIZATION_THRESHOLD = 10;

// Helper function to format seconds as recording-relative time [MM:SS] or [HH:MM:SS]
export function formatRecordingTime(seconds: number | undefined): string {
    if (seconds === undefined || isNaN(seconds) || seconds < 0) return '[--:--]';

    const totalSeconds = Math.floor(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    if (hours > 0) {
        return `[${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
    }
    return `[${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
}

// Helper function to remove filler words and repetitions
function cleanStopWords(text: string): string {
    const stopWords = ['uh', 'um', 'er', 'ah', 'hmm', 'hm', 'eh', 'oh'];

    let cleanedText = text;
    stopWords.forEach(word => {
        const pattern = new RegExp(`\\b${word}\\b[,\\s]*`, 'gi');
        cleanedText = cleanedText.replace(pattern, ' ');
    });

    return cleanedText.replace(/\s+/g, ' ').trim();
}

// Helper function to resolve speaker label and body text
export function resolveSpeaker(
    speaker?: string | null,
    text?: string
): { speakerLabel: string | null; bodyText: string } {
    const raw = text ?? '';
    if (speaker && speaker.trim() !== '') {
        const sLower = speaker.toLowerCase().trim();
        if (sLower === 'mic') return { speakerLabel: 'Microphone', bodyText: raw };
        if (sLower === 'system') return { speakerLabel: 'System Audio', bodyText: raw };
        return { speakerLabel: speaker.trim(), bodyText: raw };
    }

    // Detect speaker prefix: "Speaker 1:", "[Alice]:", "Bob:"
    const prefixMatch = raw.match(/^(\[?[A-Za-z0-9_\s]{2,24}\]?):\s*(.*)$/);
    if (prefixMatch) {
        const candidate = prefixMatch[1].replace(/^\[|\]$/g, '').trim();
        if (!candidate.startsWith('http') && !/^\d+$/.test(candidate)) {
            return { speakerLabel: candidate, bodyText: prefixMatch[2] };
        }
    }

    return { speakerLabel: null, bodyText: raw };
}

// Memoized transcript segment component
const TranscriptSegment = memo(function TranscriptSegment({
    id,
    timestamp,
    text,
    confidence,
    speaker,
    isStreaming,
    showConfidence,
    isHighlighted = false,
}: {
    id: string;
    timestamp: number;
    text: string;
    confidence?: number;
    speaker?: string | null;
    isStreaming: boolean;
    showConfidence: boolean;
    isHighlighted?: boolean;
}) {
    const { speakerLabel, bodyText } = resolveSpeaker(speaker, text);
    const displayText = cleanStopWords(bodyText) || (bodyText.trim() === '' ? '[Silence]' : bodyText);
    const segmentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isHighlighted && segmentRef.current) {
            segmentRef.current.focus({ preventScroll: true });
        }
    }, [isHighlighted]);

    return (
        <div
            ref={segmentRef}
            id={`segment-${id}`}
            tabIndex={isHighlighted ? 0 : -1}
            role="region"
            aria-label={speakerLabel ? `${speakerLabel} at ${formatRecordingTime(timestamp)}` : `Transcript segment at ${formatRecordingTime(timestamp)}`}
            aria-current={isHighlighted ? 'true' : undefined}
            className={`mb-2 rounded-lg border transition-all duration-200 p-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                isHighlighted
                    ? 'bg-accent/40 ring-2 ring-primary border-primary/40 shadow-sm'
                    : 'border-transparent hover:bg-muted/30'
            }`}
        >
            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                    {speakerLabel && (
                        <span className="text-xs font-semibold uppercase tracking-wider text-primary truncate max-w-[180px]">
                            {speakerLabel}
                        </span>
                    )}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span className="text-xs font-mono text-muted-foreground tabular-nums cursor-default">
                                {formatRecordingTime(timestamp)}
                            </span>
                        </TooltipTrigger>
                        <TooltipContent>
                            {confidence !== undefined && showConfidence && (
                                <ConfidenceIndicator confidence={confidence} showIndicator={showConfidence} />
                            )}
                        </TooltipContent>
                    </Tooltip>
                </div>
                <div className="w-full">
                    {isStreaming ? (
                        <div className="bg-muted/50 border border-border rounded-md px-3 py-2">
                            <p className="text-sm leading-relaxed text-foreground break-words select-text">{displayText}</p>
                        </div>
                    ) : (
                        <p className="text-sm leading-relaxed text-foreground break-words select-text">{displayText}</p>
                    )}
                </div>
            </div>
        </div>
    );
});

export const VirtualizedTranscriptView: React.FC<VirtualizedTranscriptViewProps> = ({
    segments,
    isRecording = false,
    isPaused = false,
    isProcessing = false,
    isStopping = false,
    enableStreaming = false,
    showConfidence = true,
    disableAutoScroll = false,
    isLoading = false,
    error = null,
    onRetry,
    hasMore = false,
    isLoadingMore = false,
    totalCount = 0,
    loadedCount = 0,
    onLoadMore,
    highlightedSegmentId = null,
    scrollToIndex = null,
}) => {
    // Create scroll ref first - shared between virtualizer and auto-scroll hook
    const scrollRef = useRef<HTMLDivElement>(null);
    // Ref for infinite scroll trigger element
    const loadMoreTriggerRef = useRef<HTMLDivElement>(null);

    const prefersReducedMotion = useReducedMotion();

    // Force re-render without flushSync (avoids React warning)
    const [, rerender] = useReducer((x: number) => x + 1, 0);

    // Setup virtualizer for efficient rendering of large lists
    const virtualizer = useVirtualizer({
        count: segments.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => 60, // Estimated height per segment
        overscan: 10, // Render extra items above/below viewport
        onChange: () => {
            startTransition(() => {
                rerender();
            });
        },
    });

    // Evidence navigation: scroll to target segment index when requested
    useEffect(() => {
        if (scrollToIndex !== undefined && scrollToIndex !== null) {
            // Boundary handling: if requested index exceeds currently loaded segments and more exist
            if (scrollToIndex >= segments.length && hasMore && !isLoadingMore && onLoadMore) {
                onLoadMore();
                return;
            }

            if (scrollToIndex >= 0 && scrollToIndex < segments.length) {
                if (segments.length >= VIRTUALIZATION_THRESHOLD) {
                    virtualizer.scrollToIndex(scrollToIndex, {
                        align: 'center',
                        behavior: prefersReducedMotion ? 'auto' : 'smooth',
                    });
                } else {
                    const targetEl = document.getElementById(`segment-${segments[scrollToIndex]?.id}`);
                    if (targetEl) {
                        targetEl.scrollIntoView({
                            behavior: prefersReducedMotion ? 'auto' : 'smooth',
                            block: 'center',
                        });
                    }
                }
            }
        }
    }, [scrollToIndex, segments, virtualizer, prefersReducedMotion, hasMore, isLoadingMore, onLoadMore]);

    // Custom hook for auto-scrolling (supports both virtualized and non-virtualized)
    useAutoScroll({
        scrollRef,
        segments,
        isRecording,
        isPaused,
        virtualizer,
        virtualizationThreshold: VIRTUALIZATION_THRESHOLD,
        disableAutoScroll,
    });

    // Streaming text effect hook (typewriter animation for new transcripts)
    const { streamingSegmentId, getDisplayText } = useTranscriptStreaming(
        segments,
        isRecording,
        enableStreaming
    );

    // Infinite scroll: IntersectionObserver to trigger loading more
    useEffect(() => {
        if (!onLoadMore || !hasMore || isLoadingMore || isRecording || segments.length === 0) {
            return;
        }

        const triggerElement = loadMoreTriggerRef.current;
        if (!triggerElement) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
                    onLoadMore();
                }
            },
            {
                root: null,
                rootMargin: '100px',
                threshold: 0,
            }
        );

        observer.observe(triggerElement);

        return () => observer.disconnect();
    }, [hasMore, isLoadingMore, onLoadMore, isRecording, segments.length]);

    // Scroll-based fallback for fast scrolling
    useEffect(() => {
        if (!onLoadMore || !hasMore || isLoadingMore || isRecording) return;

        const scrollElement = scrollRef.current;
        if (!scrollElement) return;

        let ticking = false;

        const handleScroll = () => {
            if (ticking || isLoadingMore || !hasMore) return;

            ticking = true;
            requestAnimationFrame(() => {
                const { scrollTop, scrollHeight, clientHeight } = scrollElement;
                const scrollBottom = scrollHeight - scrollTop - clientHeight;

                // Trigger load when within 200px of bottom
                if (scrollBottom < 200 && hasMore && !isLoadingMore) {
                    onLoadMore();
                }
                ticking = false;
            });
        };

        scrollElement.addEventListener('scroll', handleScroll, { passive: true });
        return () => scrollElement.removeEventListener('scroll', handleScroll);
    }, [onLoadMore, hasMore, isLoadingMore, isRecording]);

    // Use simple rendering for small lists, virtualization for large lists
    const useVirtualization = segments.length >= VIRTUALIZATION_THRESHOLD;

    return (
        <div ref={scrollRef} className="flex flex-col h-full overflow-y-auto px-4 py-2">
            {/* Recording Status Bar - Sticky at top, always visible when recording */}
            <AnimatePresence>
                {isRecording && (
                    <div className="sticky top-0 z-10 bg-background pb-2">
                        <RecordingStatusBar isPaused={isPaused} />
                    </div>
                )}
            </AnimatePresence>

            {/* Content - add padding when recording to prevent overlap */}
            <div className={isRecording ? 'pt-2' : ''}>
            {isLoading && segments.length === 0 ? (
                // Loading state
                <div
                    role="status"
                    aria-live="polite"
                    className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground space-y-3"
                >
                    <div className="w-5 h-5 border-2 border-border border-t-primary rounded-full animate-spin motion-reduce:animate-none" />
                    <p className="text-sm font-medium text-foreground">Loading transcript...</p>
                    <p className="text-xs text-muted-foreground">Retrieving meeting segments</p>
                </div>
            ) : error && segments.length === 0 ? (
                // Error state
                <div
                    role="alert"
                    className="flex flex-col items-center justify-center py-16 text-center space-y-3"
                >
                    <AlertCircle className="h-6 w-6 text-destructive" />
                    <p className="text-sm font-medium text-foreground">Failed to load transcript</p>
                    <p className="text-xs text-muted-foreground max-w-sm">{error}</p>
                    {onRetry && (
                        <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
                            Retry
                        </Button>
                    )}
                </div>
            ) : segments.length === 0 ? (
                // Empty state
                <motion.div
                    initial={prefersReducedMotion ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-center text-muted-foreground py-16"
                >
                    {isRecording ? (
                        <>
                            <div className="flex items-center justify-center mb-3">
                                <div className={`w-3 h-3 rounded-full ${isPaused ? 'bg-warning' : 'bg-destructive motion-safe:animate-pulse motion-reduce:animate-none'}`}></div>
                            </div>
                            <p className="text-sm text-foreground">
                                {isPaused ? 'Recording paused' : 'Listening for speech...'}
                            </p>
                            <p className="text-xs mt-1 text-muted-foreground">
                                {isPaused ? 'Click resume to continue recording' : 'Speak to see live transcription'}
                            </p>
                        </>
                    ) : isProcessing ? (
                        <>
                            <div className="w-5 h-5 border-2 border-border border-t-primary rounded-full animate-spin motion-reduce:animate-none mx-auto mb-3" />
                            <p className="text-sm font-medium text-foreground">Finalizing transcription...</p>
                            <p className="text-xs mt-1 text-muted-foreground">Audio recorded, generating transcript</p>
                        </>
                    ) : (
                        <div className="space-y-2">
                            <MessageSquare className="h-8 w-8 text-muted-foreground/50 mx-auto mb-1" />
                            <p className="text-sm font-medium text-foreground">No transcript recorded</p>
                            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                                This meeting does not contain any transcript segments.
                            </p>
                        </div>
                    )}
                </motion.div>
            ) : useVirtualization ? (
                // Virtualized rendering for large lists
                <>
                    <div
                        style={{
                            height: virtualizer.getTotalSize(),
                            width: "100%",
                            position: "relative",
                        }}
                    >
                        {virtualizer.getVirtualItems().map((virtualRow) => {
                            const segment = segments[virtualRow.index];
                            const isStreaming = streamingSegmentId === segment.id;

                            return (
                                <div
                                    key={segment.id}
                                    data-index={virtualRow.index}
                                    ref={virtualizer.measureElement}
                                    style={{
                                        position: "absolute",
                                        top: 0,
                                        left: 0,
                                        width: "100%",
                                        transform: `translateY(${virtualRow.start}px)`,
                                    }}
                                >
                                    <TranscriptSegment
                                        id={segment.id}
                                        timestamp={segment.timestamp}
                                        text={getDisplayText(segment)}
                                        confidence={segment.confidence}
                                        speaker={segment.speaker}
                                        isStreaming={isStreaming}
                                        showConfidence={showConfidence}
                                        isHighlighted={highlightedSegmentId === segment.id}
                                    />
                                </div>
                            );
                        })}
                    </div>

                    {/* Infinite scroll trigger and loading indicator */}
                    {(hasMore || isLoadingMore) && !isRecording && segments.length > 0 && (
                        <div ref={loadMoreTriggerRef} className="flex justify-center items-center py-4 mt-2">
                            {isLoadingMore ? (
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <div className="w-4 h-4 border-2 border-border border-t-foreground rounded-full animate-spin motion-reduce:animate-none" />
                                    <span className="text-sm">Loading more...</span>
                                </div>
                            ) : hasMore && totalCount > 0 ? (
                                <span className="text-sm text-muted-foreground">
                                    Showing {loadedCount} of {totalCount} segments
                                </span>
                            ) : null}
                        </div>
                    )}

                    {/* Listening indicator when recording */}
                    {!isStopping && isRecording && !isPaused && !isProcessing && segments.length > 0 && (
                        <motion.div
                            initial={prefersReducedMotion ? false : { opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex items-center gap-2 mt-4 text-muted-foreground"
                        >
                            <div className="w-2 h-2 bg-destructive rounded-full motion-safe:animate-pulse motion-reduce:animate-none"></div>
                            <span className="text-sm">Listening...</span>
                        </motion.div>
                    )}
                </>
            ) : (
                // Simple rendering for small lists (better animations)
                <>
                    <div className="space-y-1">
                        {segments.map((segment) => {
                            const isStreaming = streamingSegmentId === segment.id;

                            return (
                                <motion.div
                                    key={segment.id}
                                    initial={{ opacity: 0, y: 5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.15 }}
                                >
                                    <TranscriptSegment
                                        id={segment.id}
                                        timestamp={segment.timestamp}
                                        text={getDisplayText(segment)}
                                        confidence={segment.confidence}
                                        speaker={segment.speaker}
                                        isStreaming={isStreaming}
                                        showConfidence={showConfidence}
                                        isHighlighted={highlightedSegmentId === segment.id}
                                    />
                                </motion.div>
                            );
                        })}
                    </div>

                    {/* Infinite scroll trigger (for small lists that grow) */}
                    {(hasMore || isLoadingMore) && !isRecording && segments.length > 0 && (
                        <div ref={loadMoreTriggerRef} className="flex justify-center items-center py-4 mt-2">
                            {isLoadingMore ? (
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <div className="w-4 h-4 border-2 border-border border-t-foreground rounded-full animate-spin motion-reduce:animate-none" />
                                    <span className="text-sm">Loading more...</span>
                                </div>
                            ) : hasMore && totalCount > 0 ? (
                                <span className="text-sm text-muted-foreground">
                                    Showing {loadedCount} of {totalCount} segments
                                </span>
                            ) : null}
                        </div>
                    )}

                    {/* Listening indicator when recording */}
                    {!isStopping && isRecording && !isPaused && !isProcessing && segments.length > 0 && (
                        <motion.div
                            initial={prefersReducedMotion ? false : { opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex items-center gap-2 mt-4 text-muted-foreground"
                        >
                            <div className="w-2 h-2 bg-destructive rounded-full motion-safe:animate-pulse motion-reduce:animate-none"></div>
                            <span className="text-sm">Listening...</span>
                        </motion.div>
                    )}
                </>
            )}
            </div>
        </div>
    );
};
