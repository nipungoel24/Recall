'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ChevronRight, Trash2 } from 'lucide-react';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import {
  buildMeetingDetailsHref,
  ContextMeetingInfo,
  groupMeetingsByLocalDay,
} from '@/types/context';

interface ContextTimelineProps {
  meetings: ContextMeetingInfo[];
  onRemoveMeeting?: (meetingId: string) => Promise<boolean>;
}

/**
 * Meeting Timeline: the Context's meetings in chronological order, grouped by
 * local calendar day. Removing a meeting only unlinks it — the meeting itself
 * is untouched.
 */
export function ContextTimeline({ meetings, onRemoveMeeting }: ContextTimelineProps) {
  const router = useRouter();
  const { setCurrentMeeting } = useSidebar();

  const openMeeting = (meeting: ContextMeetingInfo) => {
    setCurrentMeeting({ id: meeting.id, title: meeting.title });
    router.push(buildMeetingDetailsHref(meeting.id));
  };

  const handleRemove = async (meeting: ContextMeetingInfo) => {
    if (!onRemoveMeeting) return;
    const removed = await onRemoveMeeting(meeting.id);
    if (removed) {
      toast.success('Meeting removed from Context', {
        description: `"${meeting.title}" is no longer part of this Context.`,
      });
    }
  };

  const groups = groupMeetingsByLocalDay(meetings);

  return (
    <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900">Meeting Timeline</h2>
      </div>
      {groups.length === 0 ? (
        <p className="text-sm text-gray-500">
          No meetings yet. Add meetings to follow this Context over time.
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.dateKey}>
              <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                {group.label}
              </h3>
              <ul className="space-y-0.5">
                {group.meetings.map((meeting) => (
                  <li key={meeting.id} className="group">
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 transition-colors">
                      <button
                        type="button"
                        onClick={() => openMeeting(meeting)}
                        className="flex items-center flex-1 min-w-0 text-left"
                        title="Open meeting"
                      >
                        <span className="flex-1 min-w-0 text-sm text-gray-700 truncate group-hover:text-blue-700">
                          {meeting.title}
                        </span>
                        <ChevronRight className="flex-shrink-0 h-4 w-4 text-gray-300 group-hover:text-blue-600" />
                      </button>
                      {onRemoveMeeting && (
                        <button
                          type="button"
                          title="Remove from Context"
                          onClick={() => void handleRemove(meeting)}
                          className="flex-shrink-0 p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
