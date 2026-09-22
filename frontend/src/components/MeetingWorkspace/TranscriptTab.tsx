'use client';

import { Transcript, TranscriptSegmentData } from '@/types';
import { TranscriptPanel } from '@/components/MeetingDetails/TranscriptPanel';

export interface TranscriptTabProps {
  meeting: {
    id: string;
    folder_path?: string;
  };
  transcripts: Transcript[];
  customPrompt: string;
  onPromptChange: (prompt: string) => void;
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
  isRecording?: boolean;
  usePagination?: boolean;
  segments?: TranscriptSegmentData[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;
  onRefetchTranscripts?: () => Promise<void>;
  highlightedSegmentId?: string | null;
  scrollToIndex?: number | null;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

export function TranscriptTab({
  meeting,
  transcripts,
  customPrompt,
  onPromptChange,
  onCopyTranscript,
  onOpenMeetingFolder,
  isRecording = false,
  usePagination = true,
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
  onRefetchTranscripts,
  highlightedSegmentId,
  scrollToIndex,
  isLoading = false,
  error = null,
  onRetry,
}: TranscriptTabProps) {
  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-background">
      <TranscriptPanel
        transcripts={transcripts}
        customPrompt={customPrompt}
        onPromptChange={onPromptChange}
        onCopyTranscript={onCopyTranscript}
        onOpenMeetingFolder={onOpenMeetingFolder}
        isRecording={isRecording}
        disableAutoScroll={true}
        usePagination={usePagination}
        segments={segments}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        totalCount={totalCount}
        loadedCount={loadedCount}
        onLoadMore={onLoadMore}
        meetingId={meeting.id}
        meetingFolderPath={meeting.folder_path}
        onRefetchTranscripts={onRefetchTranscripts}
        highlightedSegmentId={highlightedSegmentId}
        scrollToIndex={scrollToIndex}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
      />
    </div>
  );
}