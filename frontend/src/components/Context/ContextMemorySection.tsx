'use client';

import { useRouter } from 'next/navigation';
import { ArrowUpRight } from 'lucide-react';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import {
  buildMeetingDetailsHref,
  CompactContextMemory,
  groupMemoryItemsByKind,
  kindsWithItems,
  MEMORY_KIND_SECTION_LABELS,
  provenanceLinkForItem,
} from '@/types/context';

interface ContextMemorySectionProps {
  memory: CompactContextMemory | null;
}

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700',
  done: 'bg-green-100 text-green-700',
  blocked: 'bg-red-100 text-red-700',
};

/**
 * "Current State" panel: the durable knowledge gathered across the Context's
 * meetings, grouped into understandable sections (decisions, open actions,
 * open questions, facts). Items extracted from a meeting link back to it
 * (provenance); items without a source are shown as-is, never with a
 * fabricated source.
 */
export function ContextMemorySection({ memory }: ContextMemorySectionProps) {
  const router = useRouter();
  const { setCurrentMeeting } = useSidebar();

  const hasMarkdown = Boolean(memory?.memoryMarkdown?.trim());
  const grouped = groupMemoryItemsByKind(memory?.items ?? []);
  const kinds = kindsWithItems(grouped);
  const isEmpty = !hasMarkdown && kinds.length === 0;

  const openSourceMeeting = (provenance: { meetingId: string; title: string }) => {
    setCurrentMeeting({ id: provenance.meetingId, title: provenance.title });
    router.push(buildMeetingDetailsHref(provenance.meetingId));
  };

  return (
    <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-gray-900">Current State</h2>
        {!isEmpty && (
          <span className="text-xs text-gray-400">
            {memory?.items.length ?? 0} saved item{memory?.items.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <p className="text-xs text-gray-400 mb-3">
        Important decisions, actions and open questions from this Context&apos;s meetings.
        They are included as background when you summarize a future meeting in this Context.
      </p>
      {isEmpty ? (
        <p className="text-sm text-gray-500">
          Contextual knowledge appears here as this Context&apos;s meetings are summarized.
        </p>
      ) : (
        <div className="space-y-5">
          {hasMarkdown && (
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
              {memory!.memoryMarkdown}
            </p>
          )}
          {kinds.map((kind) => (
            <div key={kind}>
              <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                {MEMORY_KIND_SECTION_LABELS[kind]}
              </h3>
              <ul className="space-y-1.5">
                {grouped[kind]!.map((item) => {
                  const provenance = provenanceLinkForItem(item);
                  const capturedDate = item.createdAt
                    ? new Date(item.createdAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })
                    : null;
                  return (
                    <li
                      key={item.id}
                      className="flex items-start gap-2 text-sm text-gray-700 group"
                    >
                      <span className="flex-1 leading-relaxed">{item.content}</span>
                      {item.status && (
                        <span
                          className={`flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${
                            STATUS_STYLES[item.status] ?? 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {item.status}
                        </span>
                      )}
                      {provenance && (
                        <button
                          type="button"
                          title={`From: ${provenance.title}`}
                          onClick={() => openSourceMeeting(provenance)}
                          className="flex-shrink-0 inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 hover:underline opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          {provenance.title === 'View source meeting' ? 'Source' : provenance.title}
                          {capturedDate && <span className="text-gray-400">· {capturedDate}</span>}
                          <ArrowUpRight className="h-3 w-3" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
