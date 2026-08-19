'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Check, Loader2, Plus, Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import Analytics from '@/lib/analytics';
import { toggleSelectedId } from '@/types/context';
import { cn } from '@/lib/utils';

interface AddMeetingsToContextDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contextName: string;
  existingMeetingIds: Set<string>;
  onAddMeetings: (meetingIds: string[]) => Promise<number>;
}

export function AddMeetingsToContextDialog({
  open,
  onOpenChange,
  contextName,
  existingMeetingIds,
  onAddMeetings,
}: AddMeetingsToContextDialogProps) {
  const { meetings } = useSidebar();
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIds([]);
    }
  }, [open]);

  const candidates = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return meetings
      .filter((meeting) => !existingMeetingIds.has(meeting.id))
      .filter((meeting) => normalized.length === 0 || meeting.title.toLowerCase().includes(normalized))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [meetings, existingMeetingIds, query]);

  const handleSubmit = async () => {
    if (selectedIds.length === 0) return;
    setIsSubmitting(true);
    try {
      const added = await onAddMeetings(selectedIds);
      if (added > 0) {
        Analytics.trackButtonClick('add_meetings_to_context', 'context_detail');
        toast.success(
          added === 1
            ? 'Meeting added to this Context'
            : `${added} meetings added to this Context`,
        );
        onOpenChange(false);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] bg-white text-gray-900">
        <DialogHeader>
          <DialogTitle>Add Meetings</DialogTitle>
          <DialogDescription className="text-gray-500">
            Add existing meetings to {contextName}. A meeting can belong to multiple Contexts.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search meetings"
            className="pl-9"
          />
        </div>
        <div className="max-h-72 overflow-y-auto custom-scrollbar border border-gray-200 rounded-md divide-y divide-gray-100">
          {candidates.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8 px-4">
              {meetings.length === 0
                ? 'No meetings recorded yet.'
                : 'No matching meetings to add.'}
            </p>
          ) : (
            candidates.map((meeting) => {
              const selected = selectedIds.includes(meeting.id);
              return (
                <button
                  key={meeting.id}
                  type="button"
                  onClick={() => setSelectedIds((prev) => toggleSelectedId(prev, meeting.id))}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors',
                    selected ? 'bg-blue-50' : 'hover:bg-gray-50',
                  )}
                >
                  <span
                    className={cn(
                      'flex-shrink-0 flex items-center justify-center w-4 h-4 rounded border',
                      selected
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'border-gray-300 bg-white',
                    )}
                  >
                    {selected && <Check className="w-3 h-3" />}
                  </span>
                  <span className={cn('truncate', selected ? 'text-blue-700' : 'text-gray-700')}>
                    {meeting.title}
                  </span>
                </button>
              );
            })
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="blue" onClick={handleSubmit} disabled={isSubmitting || selectedIds.length === 0}>
            {isSubmitting ? <Loader2 className="animate-spin" /> : <Plus />}
            Add {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
