/**
 * TranscriptRecovery Component
 *
 * Modal dialog for recovering interrupted meetings from IndexedDB.
 * Displays recoverable meetings, allows preview, and enables recovery or deletion.
 */

import React, { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { AlertCircle, CheckCircle2, Clock, FileText, Trash2, XCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { MeetingMetadata, StoredTranscript } from '@/services/indexedDBService';
import { cn } from '@/lib/utils';

interface TranscriptRecoveryProps {
  isOpen: boolean;
  onClose: () => void;
  recoverableMeetings: MeetingMetadata[];
  onRecover: (meetingId: string) => Promise<any>;
  onDelete: (meetingId: string) => Promise<void>;
  onLoadPreview: (meetingId: string) => Promise<StoredTranscript[]>;
}

export function TranscriptRecovery({
  isOpen,
  onClose,
  recoverableMeetings,
  onRecover,
  onDelete,
  onLoadPreview,
}: TranscriptRecoveryProps) {
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [previewTranscripts, setPreviewTranscripts] = useState<StoredTranscript[]>([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Two-step destructive confirmation: the first Delete click arms the in-dialog
  // confirmation panel instead of deleting immediately.
  const [deleteConfirmFor, setDeleteConfirmFor] = useState<string | null>(null);

  // Reset selection when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSelectedMeetingId(null);
      setPreviewTranscripts([]);
      setRecoveryError(null);
      setDeleteError(null);
      setDeleteConfirmFor(null);
    }
  }, [isOpen]);

  // Auto-select first meeting if available
  useEffect(() => {
    if (isOpen && recoverableMeetings.length > 0 && !selectedMeetingId) {
      handleMeetingSelect(recoverableMeetings[0].meetingId);
    }
  }, [isOpen, recoverableMeetings]);

  const handleMeetingSelect = async (meetingId: string) => {
    setSelectedMeetingId(meetingId);
    setIsLoadingPreview(true);

    try {
      const transcripts = await onLoadPreview(meetingId);
      // Limit to first 10 for preview
      setPreviewTranscripts(transcripts.slice(0, 10));
    } catch (error) {
      console.error('Failed to load preview:', error);
      setPreviewTranscripts([]);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleRecover = async () => {
    if (!selectedMeetingId) return;

    setIsRecovering(true);
    setRecoveryError(null);
    try {
      const result = await onRecover(selectedMeetingId);
      console.log('Recovery successful:', result);
      onClose();
    } catch (error) {
      console.error('Recovery failed:', error);
      setRecoveryError(
        'Failed to recover this meeting. The recoverable meeting is still intact — you can try again or close this dialog.'
      );
    } finally {
      setIsRecovering(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedMeetingId) return;

    // First click arms the destructive confirmation panel; the second click
    // actually deletes. This prevents accidental deletion without a browser
    // confirm() dialog.
    if (deleteConfirmFor !== selectedMeetingId) {
      setDeleteConfirmFor(selectedMeetingId);
      setDeleteError(null);
      return;
    }

    setIsDeleting(true);
    try {
      await onDelete(selectedMeetingId);
      setSelectedMeetingId(null);
      setPreviewTranscripts([]);
      setDeleteConfirmFor(null);
      setDeleteError(null);
    } catch (error) {
      console.error('Delete failed:', error);
      setDeleteError('Failed to delete this recoverable meeting. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const selectedMeeting = recoverableMeetings.find(m => m.meetingId === selectedMeetingId);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="text-2xl">Recover Interrupted Meetings</DialogTitle>
          <DialogDescription>
            We found {recoverableMeetings.length} meeting{recoverableMeetings.length !== 1 ? 's' : ''} that {recoverableMeetings.length !== 1 ? 'were' : 'was'} interrupted. Select a meeting to preview and recover it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex gap-4 px-6 pb-6 overflow-hidden">
          {/* Meeting List */}
          <div className="w-1/3 flex flex-col">
            <h3 className="text-sm font-medium mb-2">Interrupted Meetings</h3>
            <ScrollArea className="flex-1 border rounded-lg">
              <div className="p-2 space-y-2">
                {recoverableMeetings.map((meeting) => (
                  <button
                    key={meeting.meetingId}
                    onClick={() => handleMeetingSelect(meeting.meetingId)}
                    className={cn(
                      'w-full text-left p-3 rounded-lg border transition-colors',
                      selectedMeetingId === meeting.meetingId
                        ? 'bg-primary/10 border-primary'
                        : 'hover:bg-muted border-transparent'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{meeting.title}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                          <Clock className="w-3 h-3" />
                          {formatDistanceToNow(new Date(meeting.lastUpdated), { addSuffix: true })}
                        </p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                          <FileText className="w-3 h-3" />
                          {meeting.transcriptCount} transcript{meeting.transcriptCount !== 1 ? 's' : ''}
                        </p>
                      </div>
                      {meeting.folderPath ? (
                        <span title="Audio available">
                          <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
                        </span>
                      ) : (
                        <span title="No audio">
                          <AlertCircle className="w-4 h-4 text-warning flex-shrink-0" />
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Preview Panel */}
          <div className="flex-1 flex flex-col">
            <h3 className="text-sm font-medium mb-2">Preview</h3>
            <div className="flex-1 border rounded-lg overflow-hidden flex flex-col">
              {selectedMeeting ? (
                <>
                  {/* Meeting Info */}
                  <div className="p-4 border-b bg-muted/50">
                    <h4 className="font-semibold">{selectedMeeting.title}</h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      Started {new Date(selectedMeeting.startTime).toLocaleString()}
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-sm">
                      <span className="flex items-center gap-1">
                        <FileText className="w-4 h-4" />
                        {selectedMeeting.transcriptCount} transcripts
                      </span>
                      {selectedMeeting.folderPath ? (
                        <span className="flex items-center gap-1 text-success">
                          <CheckCircle2 className="w-4 h-4" />
                          Audio available
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-warning">
                          <AlertCircle className="w-4 h-4" />
                          No audio
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Transcript Preview */}
                  <ScrollArea className="flex-1 p-4">
                    {isLoadingPreview ? (
                      <div className="flex items-center justify-center h-full text-muted-foreground">
                        Loading preview...
                      </div>
                    ) : previewTranscripts.length > 0 ? (
                      <div className="space-y-3">
                        <Alert>
                          <AlertDescription>
                            Showing first {previewTranscripts.length} transcript segments (of {selectedMeeting.transcriptCount} total)
                          </AlertDescription>
                        </Alert>
                        {previewTranscripts.map((transcript, index) => {
                          // Handle different timestamp formats
                          const getTimestamp = () => {
                            if (!transcript.timestamp) return '--:--';
                            try {
                              const date = new Date(transcript.timestamp);
                              if (isNaN(date.getTime())) {
                                // If timestamp is invalid, try audio_start_time
                                if (transcript.audio_start_time !== undefined) {
                                  const totalSecs = Math.floor(transcript.audio_start_time);
                                  const mins = Math.floor(totalSecs / 60);
                                  const secs = totalSecs % 60;
                                  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
                                }
                                return '--:--';
                              }
                              return date.toLocaleTimeString();
                            } catch {
                              return '--:--';
                            }
                          };

                          return (
                            <div key={index} className="text-sm">
                              <span className="text-muted-foreground">[{getTimestamp()}]</span>{' '}
                              <span>{transcript.text}</span>
                            </div>
                          );
                        })}
                        {selectedMeeting.transcriptCount > 10 && (
                          <p className="text-sm text-muted-foreground italic">
                            ... and {selectedMeeting.transcriptCount - 10} more transcript{selectedMeeting.transcriptCount - 10 !== 1 ? 's' : ''}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground">
                        No transcripts to preview
                      </div>
                    )}
                  </ScrollArea>
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  Select a meeting to preview
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-2 px-6">
          {(recoveryError || deleteError) && (
            <Alert variant="destructive">
              <AlertDescription className="text-sm">{recoveryError ?? deleteError}</AlertDescription>
            </Alert>
          )}
        </div>

        {deleteConfirmFor === selectedMeetingId && (
          <div className="mx-6 flex items-center justify-between gap-4 border border-destructive/40 bg-destructive/5 px-4 py-3">
            <p className="text-sm text-foreground">
              This removes the recoverable meeting data and cannot be undone.
            </p>
            <div className="flex flex-shrink-0 items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteConfirmFor(null)}
                disabled={isDeleting}
              >
                Keep
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void handleDelete()}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <>
                    <XCircle className="w-4 h-4 mr-2 animate-spin motion-reduce:animate-none" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete permanently
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter className="px-6 pb-6">
          {deleteConfirmFor === selectedMeetingId ? (
            <Button variant="outline" onClick={onClose} disabled={isRecovering || isDeleting}>
              Cancel
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={onClose}
                disabled={isRecovering || isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => void handleDelete()}
                disabled={!selectedMeetingId || isRecovering || isDeleting}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete…
              </Button>
              <Button
                onClick={() => void handleRecover()}
                disabled={!selectedMeetingId || isRecovering || isDeleting}
              >
                {isRecovering ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2 animate-spin motion-reduce:animate-none" />
                    Recovering...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Recover
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
