import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TEST_ROOT = 'C:/Kaam_Dhanda/Projects/Recall/frontend';

function readFile(relativePath) {
    return readFileSync(join(TEST_ROOT, relativePath), 'utf-8');
}

function stripComments(code) {
    return code
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
}

describe('Phase 5 Gate 6 — Notes Persistence', () => {
    describe('Rust Backend: MeetingNotesModel', () => {
        const modelsPath = 'src-tauri/src/database/models.rs';
        const code = readFile(modelsPath);

        it('defines MeetingNotesModel with correct fields matching migration', () => {
            assert.ok(code.includes('MeetingNotesModel'), 'MeetingNotesModel struct must exist');
            assert.ok(code.includes('meeting_id: String'), 'must have meeting_id');
            assert.ok(code.includes('notes_markdown: Option<String>'), 'must have notes_markdown');
            assert.ok(code.includes('notes_json: Option<String>'), 'must have notes_json');
            assert.ok(code.includes('created_at: DateTimeUtc'), 'must have created_at');
            assert.ok(code.includes('updated_at: DateTimeUtc'), 'must have updated_at');
            assert.ok(code.includes('FromRow'), 'must derive FromRow for SQL queries');
            assert.ok(code.includes('Serialize'), 'must derive Serialize for Tauri responses');
            assert.ok(code.includes('Deserialize'), 'must derive Deserialize for Tauri responses');
        });
    });

    describe('Rust Backend: NotesRepository', () => {
        const repoPath = 'src-tauri/src/database/repositories/notes.rs';
        const code = readFile(repoPath);

        it('exists and exports NotesRepository', () => {
            assert.ok(code.includes('pub struct NotesRepository'), 'NotesRepository must exist');
        });

        it('implements get_notes(pool, meeting_id) returning Option<MeetingNotesModel>', () => {
            assert.ok(code.includes('async fn get_notes'), 'get_notes must exist');
            assert.ok(code.includes('Option<MeetingNotesModel>'), 'must return Option<MeetingNotesModel>');
            assert.ok(code.includes('fetch_optional'), 'must use fetch_optional for single row');
        });

        it('implements save_notes(pool, meeting_id, notes_markdown, notes_json) with upsert', () => {
            assert.ok(code.includes('async fn save_notes'), 'save_notes must exist');
            assert.ok(code.includes('ON CONFLICT(meeting_id) DO UPDATE SET'), 'must upsert on conflict');
            assert.ok(code.includes('notes_markdown = excluded.notes_markdown'), 'must update markdown');
            assert.ok(code.includes('notes_json = excluded.notes_json'), 'must update json');
            assert.ok(code.includes('updated_at = excluded.updated_at'), 'must update timestamp');
            assert.ok(code.includes('UPDATE meetings SET updated_at'), 'must update meeting timestamp');
        });

        it('validates meeting exists before saving notes', () => {
            assert.ok(code.includes('SELECT 1 FROM meetings WHERE id = ?'), 'must verify meeting exists');
        });

        it('uses semantic tracing (info log on success)', () => {
            assert.ok(code.includes('info!'), 'must log success with info');
        });
    });

    describe('Rust Backend: Notes Repository Module Registration', () => {
        const modPath = 'src-tauri/src/database/repositories/mod.rs';
        const code = readFile(modPath);

        it('registers notes module', () => {
            assert.ok(code.includes('pub mod notes;'), 'notes module must be public');
        });
    });

    describe('Rust Backend: Tauri Commands', () => {
        const apiPath = 'src-tauri/src/api/api.rs';
        const code = readFile(apiPath);

        it('imports NotesRepository', () => {
            assert.ok(code.includes('notes::NotesRepository'), 'must import NotesRepository');
        });

        it('defines MeetingNotesResponse with meeting_id, notes_markdown?, notes_json?', () => {
            assert.ok(code.includes('MeetingNotesResponse'), 'MeetingNotesResponse must exist');
            assert.ok(code.includes('meeting_id: String'), 'must have meeting_id');
            assert.ok(code.includes('notes_markdown'), 'must have notes_markdown field');
            assert.ok(code.includes('notes_json'), 'must have notes_json field');
            assert.ok(code.includes('skip_serializing_if = "Option::is_none"'), 'optional fields must skip when none');
        });

        it('defines SaveMeetingNotesRequest with meeting_id, notes_markdown?, notes_json?', () => {
            assert.ok(code.includes('SaveMeetingNotesRequest'), 'SaveMeetingNotesRequest must exist');
            assert.ok(code.includes('meeting_id: String'), 'must have meeting_id');
            assert.ok(code.includes('notes_markdown'), 'must have notes_markdown field');
            assert.ok(code.includes('notes_json'), 'must have notes_json field');
        });

        it('implements api_get_meeting_notes command', () => {
            assert.ok(code.includes('pub async fn api_get_meeting_notes'), 'api_get_meeting_notes must exist');
            assert.ok(code.includes('NotesRepository::get_notes'), 'must call NotesRepository::get_notes');
            assert.ok(code.includes('Option<MeetingNotesResponse>'), 'must return Option<MeetingNotesResponse>');
        });

        it('implements api_save_meeting_notes command with separate markdown/json params', () => {
            assert.ok(code.includes('pub async fn api_save_meeting_notes'), 'api_save_meeting_notes must exist');
            assert.ok(code.includes('notes_markdown: Option<String>'), 'must accept notes_markdown');
            assert.ok(code.includes('notes_json: Option<String>'), 'must accept notes_json');
            assert.ok(code.includes('NotesRepository::save_notes'), 'must call NotesRepository::save_notes');
            assert.ok(code.includes('as_deref()'), 'must convert Option<String> to Option<&str>');
        });
    });

    describe('Rust Backend: Command Registration', () => {
        const libPath = 'src-tauri/src/lib.rs';
        const code = readFile(libPath);

        it('registers api_get_meeting_notes in invoke_handler', () => {
            assert.ok(code.includes('api::api_get_meeting_notes,'), 'must register api_get_meeting_notes');
        });

        it('registers api_save_meeting_notes in invoke_handler', () => {
            assert.ok(code.includes('api::api_save_meeting_notes,'), 'must register api_save_meeting_notes');
        });
    });

    describe('Frontend: NotesTab Integration', () => {
        const notesTabPath = 'src/components/MeetingWorkspace/NotesTab.tsx';
        const code = stripComments(readFile(notesTabPath));

        it('loads notes via invoke("api_get_meeting_notes", { meetingId })', () => {
            assert.ok(code.includes('api_get_meeting_notes'), 'must invoke api_get_meeting_notes');
            assert.ok(code.includes('meetingId: meeting.id'), 'must pass meetingId');
            assert.ok(code.includes('notes_markdown') || code.includes('notes.notes_markdown'), 'must read notes_markdown');
            assert.ok(code.includes('notes_json') || code.includes('notes.notes_json'), 'must read notes_json');
        });

        it('saves notes via invoke("api_save_meeting_notes", { meetingId, notesMarkdown, notesJson })', () => {
            assert.ok(code.includes('api_save_meeting_notes'), 'must invoke api_save_meeting_notes');
            assert.ok(code.includes('meetingId: meeting.id'), 'must pass meetingId');
            assert.ok(code.includes('notesMarkdown'), 'must pass notesMarkdown');
            assert.ok(code.includes('notesJson'), 'must pass notesJson');
        });

        it('handles loading state with spinner', () => {
            assert.ok(code.includes('isLoading'), 'must have isLoading state');
            assert.ok(code.includes('animate-spin'), 'must show spinner');
            assert.ok(code.includes('Loading notes'), 'must show loading text');
        });

        it('handles error state with retry', () => {
            assert.ok(code.includes('error'), 'must have error state');
            assert.ok(code.includes('Retry'), 'must show retry button');
            assert.ok(code.includes('onClick={loadNotes}') || code.includes('onClick={() => loadNotes()}'), 'retry must call loadNotes');
        });

        it('handles saving state with disabled button and spinner', () => {
            assert.ok(code.includes('isSaving'), 'must have isSaving state');
            assert.ok(code.includes('disabled={isSaving}'), 'must disable button while saving');
            assert.ok(code.includes('Saving...'), 'must show Saving... text');
            assert.ok(code.includes('Loader2'), 'must show spinner while saving');
        });

        it('shows toast on save success and error', () => {
            assert.ok(code.includes('toast.success'), 'must show success toast');
            assert.ok(code.includes('toast.error'), 'must show error toast');
        });

        it('uses BlockNoteSummaryView with onSave callback', () => {
            assert.ok(code.includes('BlockNoteSummaryView'), 'must use BlockNoteSummaryView');
            assert.ok(code.includes('onSave='), 'must pass onSave callback');
            assert.ok(code.includes('setNotesMarkdown'), 'onSave must update notesMarkdown');
            assert.ok(code.includes('setNotesJson'), 'onSave must update notesJson');
        });

        it('uses semantic design tokens (no hardcoded gray colors)', () => {
            assert.ok(!code.includes('bg-gray-'), 'must not use hardcoded gray backgrounds');
            assert.ok(!code.includes('text-gray-'), 'must not use hardcoded gray text');
            assert.ok(!code.includes('border-gray-'), 'must not use hardcoded gray borders');
            assert.ok(code.includes('bg-background'), 'must use semantic bg-background');
            assert.ok(code.includes('text-muted-foreground'), 'must use semantic text-muted-foreground');
            assert.ok(code.includes('border-border'), 'must use semantic border-border');
            assert.ok(code.includes('bg-primary'), 'must use semantic bg-primary');
            assert.ok(code.includes('text-primary-foreground'), 'must use semantic text-primary-foreground');
        });

        it('has no alert/confirm/window.prompt calls', () => {
            assert.ok(!code.includes('alert('), 'must not use alert()');
            assert.ok(!code.includes('confirm('), 'must not use confirm()');
            assert.ok(!code.includes('window.prompt'), 'must not use window.prompt()');
        });

        it('has no direct SQL or database calls', () => {
            assert.ok(!code.includes('sqlx'), 'must not import sqlx');
            assert.ok(!code.includes('SELECT * FROM'), 'must not have raw SQL');
        });

        it('has accessible toolbar button with focus-visible', () => {
            assert.ok(code.includes('focus-visible:ring-2') || code.includes('focus-visible:ring-ring'), 'must have focus-visible styles');
        });
    });

    describe('Frontend: BlockNoteSummaryView Reuse', () => {
        const viewPath = 'src/components/AISummary/BlockNoteSummaryView.tsx';
        const code = stripComments(readFile(viewPath));

        it('accepts summaryData prop with markdown and summary_json', () => {
            assert.ok(code.includes('summaryData'), 'must accept summaryData prop');
            assert.ok(code.includes('markdown'), 'must handle markdown');
            assert.ok(code.includes('summary_json'), 'must handle summary_json');
        });

        it('provides onSave callback with markdown and summary_json', () => {
            assert.ok(code.includes('onSave'), 'must provide onSave callback');
            assert.ok(code.includes('data.markdown'), 'onSave must include markdown');
            assert.ok(code.includes('data.summary_json'), 'onSave must include summary_json');
        });

        it('tracks dirty state internally', () => {
            assert.ok(code.includes('isDirty') || code.includes('dirty'), 'must track dirty state');
        });

        it('supports theme via resolvedTheme', () => {
            assert.ok(code.includes('resolvedTheme') || code.includes('theme'), 'must support theming');
        });
    });

    describe('Architecture: Notes Data Flow', () => {
        const meetingWorkspacePath = 'src/components/MeetingWorkspace/MeetingWorkspace.tsx';
        const code = stripComments(readFile(meetingWorkspacePath));

        it('renders NotesTab as one of the six workspace sections', () => {
            assert.ok(code.includes('NotesTab'), 'must render NotesTab');
        });

        it('passes meeting prop to NotesTab', () => {
            assert.ok(code.includes('<NotesTab'), 'must render NotesTab with props');
            assert.ok(code.includes('meeting='), 'must pass meeting prop');
        });
    });

    describe('Database: Migration Schema', () => {
        const migrationPath = 'src-tauri/migrations/20251223000000_add_meeting_notes.sql';
        const code = readFile(migrationPath);

        it('creates meeting_notes table with correct schema', () => {
            assert.ok(code.includes('meeting_id TEXT PRIMARY KEY NOT NULL'), 'meeting_id must be PK');
            assert.ok(code.includes('notes_markdown TEXT'), 'must have notes_markdown');
            assert.ok(code.includes('notes_json TEXT'), 'must have notes_json');
            assert.ok(code.includes('created_at TEXT NOT NULL'), 'must have created_at');
            assert.ok(code.includes('updated_at TEXT NOT NULL'), 'must have updated_at');
            assert.ok(code.includes('FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE'), 'must cascade delete');
            assert.ok(code.includes('idx_meeting_notes_meeting_id'), 'must have index on meeting_id');
        });
    });

    describe('Safety Invariants', () => {
        const notesTabPath = 'src/components/MeetingWorkspace/NotesTab.tsx';
        const code = stripComments(readFile(notesTabPath));

        it('zero alert/confirm/window.prompt in NotesTab', () => {
            assert.ok(!code.includes('alert('), 'no alert()');
            assert.ok(!code.includes('confirm('), 'no confirm()');
            assert.ok(!code.includes('window.prompt'), 'no window.prompt()');
        });

        it('zero raw transcript/content logging in NotesTab', () => {
            assert.ok(!code.includes('console.log(notes'), 'must not log note content');
            assert.ok(!code.includes('console.error(notes'), 'must not log note content in error');
        });

        it('zero direct database access in NotesTab', () => {
            assert.ok(!code.includes('sqlx'), 'no sqlx import');
            assert.ok(!code.includes('DATABASE'), 'no direct DB');
        });
    });
});