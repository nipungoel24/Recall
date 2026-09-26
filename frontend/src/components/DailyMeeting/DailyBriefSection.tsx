'use client';

import { AlertCircle, Clipboard, Download, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { DailyBriefState } from '@/types/daily';
import { Button } from '@/components/ui/button';
import { MarkdownRenderer } from './MarkdownRenderer';
import { buildDailyBriefMarkdownExport, dailyBriefExportFilename } from '@/lib/daily/export';

interface DailyBriefSectionProps {
  brief: DailyBriefState;
  meetingsCount: number;
  onGenerate: () => void;
  onCancel: () => void;
  onOpenMeeting: (meetingId: string) => void;
  dateKey: string;
}

/**
 * Combined "Daily Brief" section: generate button, generation states, and
 * the polished markdown result with clickable source meetings.
 */
export function DailyBriefSection({
  brief,
  meetingsCount,
  onGenerate,
  onCancel,
  onOpenMeeting,
  dateKey,
}: DailyBriefSectionProps) {
  const isBusy = brief.status === 'generating' || brief.status === 'loading';
  const exportMarkdown = brief.markdown
    ? buildDailyBriefMarkdownExport(dateKey, brief.markdown, brief.sources)
    : null;

  const copyBrief = async () => {
    if (!exportMarkdown) return;
    try {
      await navigator.clipboard.writeText(exportMarkdown);
      toast.success('Daily Brief copied to clipboard');
    } catch {
      toast.error('Could not copy Daily Brief');
    }
  };

  const downloadBrief = () => {
    if (!exportMarkdown) return;
    const url = URL.createObjectURL(new Blob([exportMarkdown], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = dailyBriefExportFilename(dateKey);
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="border border-border rounded-lg bg-surface">
      {brief.status === 'completed' && brief.markdown ? (
        <div className="p-4">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
              Daily Brief
            </h2>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => void copyBrief()} title="Copy Daily Brief to clipboard">
                <Clipboard className="h-3.5 w-3.5" /><span className="hidden sm:inline">Copy</span>
              </Button>
              <Button variant="ghost" size="sm" onClick={downloadBrief} title="Export Daily Brief as Markdown">
                <Download className="h-3.5 w-3.5" /><span className="hidden sm:inline">Export</span>
              </Button>
              <Button variant="ghost" size="sm" onClick={onGenerate}>Regenerate</Button>
            </div>
          </div>
          <MarkdownRenderer markdown={brief.markdown} />
          {brief.sources.length > 0 && (
            <div className="mt-4 pt-3 border-t border-border">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Source meetings
              </div>
              <div className="flex flex-wrap gap-1.5">
                {brief.sources.map((source) => (
                  <button
                    key={source.meetingId}
                    type="button"
                    onClick={() => onOpenMeeting(source.meetingId)}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-foreground hover:bg-primary/5 hover:border-primary/30 hover:text-primary transition-colors"
                  >
                    {source.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : brief.status === 'error' ? (
        <div className="p-4">
          <div className="flex items-start gap-2 text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">Daily brief failed</div>
              <p className="text-sm text-destructive mt-0.5 break-words">{brief.error}</p>
            </div>
          </div>
          <div className="mt-3">
            <Button size="sm" variant="outline" onClick={onGenerate}>
              Retry
            </Button>
          </div>
        </div>
      ) : brief.status === 'generating' ? (
        <div className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none text-primary" aria-hidden="true" />
              <div>
                <div className="text-sm font-medium text-foreground">Generating daily brief...</div>
                <div className="text-xs text-muted-foreground">
                  Combining {meetingsCount} meeting{meetingsCount === 1 ? '' : 's'} for this day
                </div>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              {brief.status === 'loading' ? (
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none text-muted-foreground" aria-hidden="true" />
              ) : (
                <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
              )}
              <div>
                <div className="text-sm font-medium text-foreground">Daily Brief</div>
                <div className="text-xs text-muted-foreground">
                  Combine this day&apos;s meetings into one polished brief.
                </div>
              </div>
            </div>
            <Button
              size="sm"
              onClick={onGenerate}
              disabled={meetingsCount === 0 || isBusy}
            >
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Generate Daily Brief
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
