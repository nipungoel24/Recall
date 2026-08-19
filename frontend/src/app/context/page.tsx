'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { FolderPlus, Layers, LoaderIcon, Plus } from 'lucide-react';
import Analytics from '@/lib/analytics';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/PageHeader';
import { CreateContextDialog } from '@/components/Context/CreateContextDialog';
import { useContexts } from '@/components/Context/hooks';
import { meetingCountLabel } from '@/types/context';
import { routes } from '@/lib/routes';
import ContextDetailPageClient from './context-detail-client';

function lastActivityLabel(iso: string): string | null {
  const updated = new Date(iso);
  if (isNaN(updated.getTime())) return null;
  const diffDays = Math.floor((Date.now() - updated.getTime()) / 86400000);
  if (diffDays <= 0) return 'Active today';
  if (diffDays === 1) return 'Active yesterday';
  if (diffDays < 30) return `Active ${diffDays} days ago`;
  return null;
}

function ContextsListPage() {
  const router = useRouter();
  const { contexts, isLoading, error } = useContexts();
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    Analytics.trackPageView('contexts');
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="h-screen bg-gray-50 overflow-y-auto custom-scrollbar"
    >
      <div className="max-w-5xl mx-auto px-8 py-8">
        <PageHeader
          title="Contexts"
          description="Group related meetings — like a project, client, or initiative — and see what carries over across them."
          actions={
            <Button variant="blue" onClick={() => setCreateOpen(true)} className="cursor-pointer">
              <Plus />
              New Context
            </Button>
          }
        />

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-32 w-full rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-8 text-center">
            <p className="text-sm text-gray-500">
              Could not load Contexts.
              {error ? ` ${error}` : ''}
            </p>
          </div>
        ) : contexts.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-10 flex flex-col items-center text-center">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-blue-50 mb-4">
              <FolderPlus className="w-8 h-8 text-blue-600" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">No Contexts yet</h2>
            <p className="text-sm text-gray-500 mt-1 mb-6 max-w-md">
              Create a Context to group related meetings — like a project, client, or ongoing
              initiative — and keep their decisions, action items, and questions together.
            </p>
            <Button variant="blue" onClick={() => setCreateOpen(true)} className="cursor-pointer">
              <Plus />
              Create your first Context
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {contexts.map((context) => (
              <button
                key={context.id}
                type="button"
                onClick={() => router.push(routes.context(context.id))}
                className="group text-left bg-white rounded-xl border border-gray-200 shadow-sm p-5 hover:shadow-md hover:border-blue-200 transition-all cursor-pointer"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-full bg-blue-100">
                      <Layers className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="font-semibold text-gray-900 truncate group-hover:text-blue-700 transition-colors">
                        {context.name}
                      </h2>
                      {context.description ? (
                        <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{context.description}</p>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between gap-2 text-xs text-gray-500">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                      {meetingCountLabel(context.meetingCount)}
                    </span>
                    {context.memoryItemCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">
                        {context.memoryItemCount} saved note{context.memoryItemCount === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  {lastActivityLabel(context.updatedAt) && (
                    <span className="text-gray-400">{lastActivityLabel(context.updatedAt)}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <CreateContextDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(created) => router.push(routes.context(created.id))}
      />
    </motion.div>
  );
}

/**
 * /context is a static, export-safe route. It renders the Contexts list, or —
 * when an `id` query parameter is present — the detail view for that runtime
 * entity. Runtime IDs never appear as path segments, so contexts created
 * after the production build always open correctly.
 */
function ContextPageContent() {
  const searchParams = useSearchParams();
  const contextId = searchParams.get('id');

  if (contextId) {
    return <ContextDetailPageClient id={contextId} />;
  }
  return <ContextsListPage />;
}

export default function ContextPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen bg-gray-50">
          <LoaderIcon className="animate-spin size-6 text-gray-400" />
        </div>
      }
    >
      <ContextPageContent />
    </Suspense>
  );
}
