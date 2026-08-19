'use client';

import React, { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Clock, Users, Calendar, Tag, LoaderIcon } from 'lucide-react';
import { routes } from '@/lib/routes';

interface Note {
  title: string;
  date: string;
  time?: string;
  attendees?: string[];
  tags: string[];
  content: string;
}

// Static demo notes kept for reference. Real meeting notes live inside
// meeting-details; this page is addressed as /notes?id=<slug> so it remains
// compatible with the static export for any id value.
const SAMPLE_NOTES: Record<string, Note> = {
  'team-sync-dec-26': {
    title: 'Team Sync - Dec 26',
    date: '2024-12-26',
    time: '10:00 AM - 11:00 AM',
    attendees: ['John Doe', 'Jane Smith', 'Mike Johnson'],
    tags: ['Team Sync', 'Weekly', 'Product'],
    content: `
# Meeting Summary
Team sync discussion about Q1 2024 goals and current project status.

## Agenda Items
1. Project Status Updates
2. Q1 2024 Planning
3. Team Concerns & Feedback

## Key Decisions
- Prioritized mobile app development for Q1
- Scheduled weekly design reviews
- Added two new features to the roadmap

## Action Items
- [ ] John: Create project timeline
- [ ] Jane: Schedule design review meetings
- [ ] Mike: Update documentation
    `,
  },
  'product-review': {
    title: 'Product Review',
    date: '2024-12-26',
    time: '2:00 PM - 3:00 PM',
    attendees: ['Sarah Wilson', 'Tom Brown', 'Alex Chen'],
    tags: ['Product', 'Review', 'Quarterly'],
    content: `
# Product Review Meeting

## Overview
Quarterly product review session with stakeholders.

## Discussion Points
1. Q4 Performance Review
2. Feature Prioritization
3. Customer Feedback Analysis

## Action Items
- [ ] Update product roadmap
- [ ] Schedule user research sessions
- [ ] Review competitor analysis
    `,
  },
  'project-ideas': {
    title: 'Project Ideas',
    date: '2024-12-26',
    tags: ['Ideas', 'Planning'],
    content: `
# Project Ideas

## New Features
1. AI-powered meeting summaries
2. Calendar integration
3. Team collaboration tools

## Improvements
- Enhanced search functionality
- Better note organization
- Real-time collaboration
    `,
  },
  'action-items': {
    title: 'Action Items',
    date: '2024-12-26',
    tags: ['Tasks', 'Todo', 'Planning'],
    content: `
# Action Items

## High Priority
- [ ] Deploy v2.0 to production
- [ ] Fix critical security issues
- [ ] Complete user documentation

## Medium Priority
- [ ] Update dependencies
- [ ] Implement error tracking
- [ ] Add unit tests

## Low Priority
- [ ] Refactor legacy code
- [ ] Improve code documentation
- [ ] Setup development guidelines
    `,
  },
};

function renderMarkdownLite(content: string): string {
  return content
    .split('\n')
    .map((line) => {
      if (line.startsWith('# ')) return `<h1>${line.slice(2)}</h1>`;
      if (line.startsWith('## ')) return `<h2>${line.slice(3)}</h2>`;
      if (line.startsWith('- ')) return `<li>${line.slice(2)}</li>`;
      return line;
    })
    .join('\n');
}

function NotesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const noteId = searchParams.get('id') ?? '';
  const note = noteId ? SAMPLE_NOTES[noteId] : undefined;

  return (
    <div className="h-screen bg-gray-50 overflow-y-auto custom-scrollbar">
      <div className="max-w-4xl mx-auto px-8 py-8">
        <button
          type="button"
          onClick={() => router.push(routes.home())}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Home
        </button>

        {!note ? (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-10 text-center">
            <h1 className="text-lg font-semibold text-gray-900">Note not found</h1>
            <p className="text-sm text-gray-500 mt-1 mb-6">
              The note you are looking for does not exist or may have been removed.
            </p>
            <button
              type="button"
              onClick={() => router.push(routes.home())}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Home
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">{note.title}</h1>

            <div className="flex flex-wrap gap-4 text-sm text-gray-500">
              {note.date && (
                <div className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  <span>{note.date}</span>
                </div>
              )}
              {note.time && (
                <div className="flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  <span>{note.time}</span>
                </div>
              )}
              {note.attendees && (
                <div className="flex items-center gap-1">
                  <Users className="w-4 h-4" />
                  <span>{note.attendees.join(', ')}</span>
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-4">
              {note.tags.map((tag) => (
                <span
                  key={tag}
                  className="flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-1 rounded-full text-xs font-medium"
                >
                  <Tag className="w-3 h-3" />
                  {tag}
                </span>
              ))}
            </div>

            <div className="prose prose-blue max-w-none mt-6">
              <div dangerouslySetInnerHTML={{ __html: renderMarkdownLite(note.content) }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function NotesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen bg-gray-50">
          <LoaderIcon className="animate-spin size-6 text-gray-400" />
        </div>
      }
    >
      <NotesPageContent />
    </Suspense>
  );
}
