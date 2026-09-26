'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Loader2, NotebookPen, Save } from 'lucide-react';
import { BlockNoteSummaryView, BlockNoteSummaryViewRef } from '@/components/AISummary/BlockNoteSummaryView';
import { Button } from '@/components/ui/button';
import type { BlockNoteBlock } from '@/types';

export interface NotesTabProps {
  meeting: {
    id: string;
    title: string;
    created_at: string;
  };
}

export function NotesTab({ meeting }: NotesTabProps) {
  const [notesMarkdown, setNotesMarkdown] = useState<string>('');
  const [notesJson, setNotesJson] = useState<string>('');
  const [parsedBlocks, setParsedBlocks] = useState<BlockNoteBlock[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<BlockNoteSummaryViewRef>(null);

  const loadNotes = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const notes = await invoke<{ notes_markdown?: string; notes_json?: string } | null>(
        'api_get_meeting_notes',
        { meetingId: meeting.id }
      );

      const markdown = notes?.notes_markdown || '';
      const rawJson = notes?.notes_json || '';

      // Parse persisted BlockNote JSON defensively: corrupt stored data must
      // surface the error state rather than throwing during render.
      let blocks: BlockNoteBlock[] | undefined;
      if (rawJson) {
        try {
          const parsed: unknown = JSON.parse(rawJson);
          blocks = Array.isArray(parsed) ? (parsed as BlockNoteBlock[]) : undefined;
        } catch (parseErr) {
          console.error('Failed to parse stored notes JSON:', parseErr);
          setError('Saved notes could not be read. The stored data may be corrupted.');
          setNotesMarkdown(markdown);
          setNotesJson('');
          setParsedBlocks(undefined);
          return;
        }
      }

      setNotesMarkdown(markdown);
      setNotesJson(rawJson);
      setParsedBlocks(blocks);
      setIsDirty(false);
    } catch (err) {
      console.error('Failed to load notes:', err);
      setError('Failed to load notes');
    } finally {
      setIsLoading(false);
    }
  }, [meeting.id]);

  const saveNotes = useCallback(async () => {
    if (isSaving) return;

    // Pull the authoritative document out of the editor before persisting so
    // the Save action can never report success while writing stale content.
    const editor = editorRef.current;
    if (editor?.isDirty) {
      await editor.saveSummary();
    }

    if (!notesMarkdown && !notesJson) {
      toast.info('Nothing to save');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await invoke('api_save_meeting_notes', {
        meetingId: meeting.id,
        notesMarkdown: notesMarkdown || undefined,
        notesJson: notesJson || undefined,
      });

      setIsDirty(false);
      toast.success('Notes saved');
    } catch (err) {
      console.error('Failed to save notes:', err);
      toast.error('Failed to save notes');
    } finally {
      setIsSaving(false);
    }
  }, [meeting.id, notesMarkdown, notesJson, isSaving]);

  // Load notes on mount
  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  const hasNotes = Boolean(notesMarkdown || notesJson || parsedBlocks?.length);

  const toolbar = (
    <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface shrink-0 gap-3">
      <span className="text-label text-muted-foreground">Meeting Notes</span>
      <div className="flex items-center gap-2">
        <span
          className="text-caption text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {isDirty ? 'Unsaved changes' : hasNotes ? 'Saved' : ''}
        </span>
        <Button
          type="button"
          onClick={saveNotes}
          disabled={isSaving || isLoading || !hasNotes}
          size="sm"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <Save className="h-4 w-4" aria-hidden="true" />
          )}
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="h-full flex flex-col overflow-hidden bg-background">
        {toolbar}
        <div
          className="flex-1 flex items-center justify-center bg-background"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-border border-t-primary rounded-full animate-spin motion-reduce:animate-none" />
            <span className="text-sm text-muted-foreground">Loading notes…</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col overflow-hidden bg-background">
        {toolbar}
        <div className="flex-1 flex items-center justify-center p-8 bg-background">
          <div className="text-center max-w-md">
            <div
              role="alert"
              className="mb-4 p-3 rounded-md bg-destructive/5 border border-destructive/30"
            >
              <p className="text-sm text-destructive">{error}</p>
            </div>
            <Button type="button" onClick={loadNotes}>
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      {toolbar}

      {/* Editor Area — editorial measure matches the Summary tab so long-form
          writing stays readable at wide desktop widths. */}
      <div className="flex-1 overflow-y-auto">
        {hasNotes ? (
          <div className="w-full max-w-4xl mx-auto px-6 py-6">
            <BlockNoteSummaryView
              ref={editorRef}
              summaryData={{ markdown: notesMarkdown, summary_json: parsedBlocks }}
              onSave={(data) => {
                if (data.markdown !== undefined) setNotesMarkdown(data.markdown);
                if (data.summary_json !== undefined) {
                  setNotesJson(JSON.stringify(data.summary_json));
                  setParsedBlocks(data.summary_json as BlockNoteBlock[]);
                }
              }}
              onDirtyChange={setIsDirty}
              status="idle"
              meeting={{ id: meeting.id, title: meeting.title, created_at: meeting.created_at }}
            />
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center">
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-muted mb-4">
              <NotebookPen className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-section-title text-foreground mb-2">No notes yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Start writing to capture your own notes for this meeting. Everything stays on
              this device.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
