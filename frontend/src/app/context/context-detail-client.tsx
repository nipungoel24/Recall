'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import Analytics from '@/lib/analytics';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EditableTitle } from '@/components/EditableTitle';
import { ContextMemorySection } from '@/components/Context/ContextMemorySection';
import { ContextTimeline } from '@/components/Context/ContextTimeline';
import { AddMeetingsToContextDialog } from '@/components/Context/AddMeetingsToContextDialog';
import { RenameContextDialog } from '@/components/Context/RenameContextDialog';
import { DeleteContextDialog } from '@/components/Context/DeleteContextDialog';
import { useContextDetail } from '@/components/Context/hooks';
import { meetingCountLabel, meetingIdsOf } from '@/types/context';
import { routes } from '@/lib/routes';

export default function ContextDetailPageClient({ id }: { id: string }) {
  const router = useRouter();
  const contextId = id;
  const context = useContextDetail(contextId);

  const [title, setTitle] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [addMeetingsOpen, setAddMeetingsOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    Analytics.trackPageView('context_detail');
  }, [contextId]);

  const detail = context.detail;

  useEffect(() => {
    if (detail) {
      setTitle(detail.name);
    }
  }, [detail]);

  const existingMeetingIds = useMemo(() => meetingIdsOf(context.meetings), [context.meetings]);

  const handleFinishEditTitle = async () => {
    setIsEditingTitle(false);
    const trimmed = title.trim();
    if (!trimmed) {
      setTitle(context.detail?.name ?? '');
      return;
    }
    if (trimmed === context.detail?.name) return;
    const ok = await context.rename(trimmed, context.detail?.description);
    if (ok) {
      toast.success('Context renamed');
    }
  };

  const handleDelete = async (): Promise<boolean> => {
    const ok = await context.remove();
    if (ok) {
      toast.success('Context deleted', {
        description: 'Your meetings were not deleted.',
      });
      router.push(routes.contexts());
    }
    return ok;
  };

  if (context.isLoading) {
    return (
      <div className="h-screen bg-gray-50 overflow-y-auto custom-scrollbar">
        <div className="max-w-4xl mx-auto px-8 py-8">
          <Skeleton className="h-4 w-40 mb-4" />
          <Skeleton className="h-8 w-64 mb-2" />
          <Skeleton className="h-4 w-80 mb-6" />
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl mt-6" />
        </div>
      </div>
    );
  }

  if (!context.detail) {
    return (
      <div className="h-screen bg-gray-50 overflow-y-auto custom-scrollbar">
        <div className="max-w-3xl mx-auto px-8 py-8">
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-10 text-center">
            <h1 className="text-lg font-semibold text-gray-900">Context not found</h1>
            <p className="text-sm text-gray-500 mt-1 mb-6">
              It may have been deleted.
              {context.error ? ` ${context.error}` : ''}
            </p>
            <Button variant="outline" onClick={() => router.push(routes.contexts())}>
              <ArrowLeft /> Back to Contexts
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="h-screen bg-gray-50 overflow-y-auto custom-scrollbar"
    >
      <div className="max-w-4xl mx-auto px-8 py-8">
        <button
          type="button"
          onClick={() => router.push(routes.contexts())}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Contexts
        </button>

        <div className="flex items-start justify-between gap-4 mb-2">
          <div className="flex-1 min-w-0">
            <EditableTitle
              title={title}
              isEditing={isEditingTitle}
              onStartEditing={() => setIsEditingTitle(true)}
              onFinishEditing={() => void handleFinishEditTitle()}
              onChange={setTitle}
            />
            {context.detail.description ? (
              <p className="text-sm text-gray-500 mt-1 whitespace-pre-wrap">
                {context.detail.description}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 pt-1">
            <Button variant="blue" size="sm" onClick={() => setAddMeetingsOpen(true)}>
              <Plus />
              <span className="hidden sm:inline">Add Meetings</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setRenameOpen(true)} title="Rename Context">
              <Pencil />
              <span className="hidden sm:inline">Rename</span>
            </Button>
            <Button variant="red" size="sm" onClick={() => setDeleteOpen(true)} title="Delete Context">
              <Trash2 />
            </Button>
          </div>
        </div>

        <div className="mb-6 flex items-center gap-2">
          <span className="inline-flex px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">
            {meetingCountLabel(context.meetings.length)}
          </span>
          {context.detail.updatedAt && (
            <span className="text-xs text-gray-400">
              Updated{' '}
              {new Date(context.detail.updatedAt).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          )}
        </div>

        <div className="space-y-4 pb-8">
          <ContextMemorySection memory={context.memory} />
          <ContextTimeline meetings={context.meetings} onRemoveMeeting={context.removeMeeting} />
        </div>
      </div>

      <AddMeetingsToContextDialog
        open={addMeetingsOpen}
        onOpenChange={setAddMeetingsOpen}
        contextName={context.detail.name}
        existingMeetingIds={existingMeetingIds}
        onAddMeetings={context.addMeetings}
      />
      <RenameContextDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        contextId={context.detail.id}
        initialName={context.detail.name}
        initialDescription={context.detail.description}
        onSubmit={context.rename}
      />
      <DeleteContextDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        contextName={context.detail.name}
        meetingCount={context.meetings.length}
        onConfirm={handleDelete}
      />
    </motion.div>
  );
}
