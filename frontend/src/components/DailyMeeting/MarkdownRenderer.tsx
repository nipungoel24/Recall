'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface MarkdownRendererProps {
  markdown: string;
  className?: string;
}

/**
 * Read-only polished markdown renderer used by the daily view (meeting
 * summary previews and the combined Daily Brief).
 *
 * The existing summary UI renders markdown through the BlockNote editor
 * (BlockNoteSummaryView), which is editable and instantiate-heavy. For the
 * read-only aggregated daily experience we render with react-markdown
 * (already a project dependency) instead of forking BlockNote's flow.
 */
export function MarkdownRenderer({ markdown, className }: MarkdownRendererProps) {
  return (
    <div
      className={cn(
        'prose prose-sm max-w-none dark:prose-invert',
        'prose-headings:font-semibold prose-headings:text-gray-900',
        'prose-h1:text-xl prose-h2:text-lg prose-h3:text-base',
        'prose-ul:my-1 prose-ol:my-1 prose-p:my-1.5',
        'prose-li:my-0.5',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </div>
  );
}
