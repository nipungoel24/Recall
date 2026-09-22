'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Save, Loader2 } from 'lucide-react';
import { BlockNoteSummaryView, BlockNoteSummaryViewRef } from '@/components/AISummary/BlockNoteSummaryView';

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
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<BlockNoteSummaryViewRef>(null);

  const loadNotes = useCallback(async () => {
    try {
      setIsLoading(true);
      const notes = await invoke<{ notes_markdown?: string; notes_json?: string }>('api_get_meeting_notes', {
        meetingId: meeting.id,
      });

      if (notes) {
        setNotesMarkdown(notes.notes_markdown || '');
        setNotesJson(notes.notes_json || '');
      }
    } catch (err) {
      console.error('Failed to load notes:', err);
      setError('Failed to load notes');
    } finally {
      setIsLoading(false);
    }
  }, [meeting.id]);

  const saveNotes = useCallback(async () => {
    if (isSaving) return;

    setIsSaving(true);
    setError(null);

    try {
      const notesData = notesJson || JSON.stringify({
        type: 'doc',
        content: notesMarkdown ? [{ type: 'paragraph', content: [{ type: 'text', text: notesMarkdown }] }] : [],
      });

      await invoke('api_save_meeting_notes', {
        meetingId: meeting.id,
        notes: notesData,
      });

      toast.success('Notes saved successfully');
    } catch (err) {
      console.error('Failed to save notes:', err);
      setError('Failed to save notes');
      toast.error('Failed to save notes');
    } finally {
      setIsSaving(false);
    }
  }, [meeting.id, notesMarkdown, notesJson, isSaving]);

  // Load notes on mount
  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-border border-t-foreground rounded-full animate-spin motion-reduce:animate-none" />
          <span className="text-sm text-muted-foreground">Loading notes...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="text-center max-w-md">
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <p className="text-sm text-destructive">{error}</p>
          </div>
          <button
            type="button"
            onClick={loadNotes}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <span>Retry</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      {/* Action Toolbar */}
      <div className="flex h-11 flex-shrink-0 items-center justify-between border-b border-border bg-background px-4">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Meeting Notes</span>
        <button
          type="button"
          onClick={saveNotes}
          disabled={isSaving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Save className="h-4 w-4" />
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <span>Save</span>
          )}
        </button>
      </div>

      {/* Editor Area */}
      <div className="flex-1 overflow-hidden p-4">
        <BlockNoteSummaryView
          ref={editorRef}
          summaryData={{ markdown: notesMarkdown, summary_json: notesJson ? JSON.parse(notesJson) : undefined }}
          onSave={(data) => {
            if (data.markdown !== undefined) setNotesMarkdown(data.markdown);
            if (data.summary_json !== undefined) setNotesJson(JSON.stringify(data.summary_json));
          }}
          status="idle"
          meeting={{ id: meeting.id, title: meeting.title, created_at: meeting.created_at }}
        />
      </div>
    </div>
  );
}