'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { FolderPlus, Layers, LoaderIcon, Plus } from 'lucide-react';
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="h-screen bg-background overflow-y-auto custom-scrollbar"
    >
      <div className="max-w-5xl mx-auto px-8 py-8">
        <PageHeader
          title="Contexts"
          description="Group related meetings — like a project, client, or initiative — and see what carries over across them."
          actions={
            <Button variant="default" onClick={() => setCreateOpen(true)} className="cursor-pointer">
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
          <div className="bg-surface rounded-lg border border-border shadow-sm p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Could not load Contexts.
              {error ? ` ${error}` : ''}
            </p>
          </div>
        ) : contexts.length === 0 ? (
          <div className="bg-surface rounded-lg border border-border shadow-sm p-10 flex flex-col items-center text-center">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary/5 mb-4">
              <FolderPlus className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">No Contexts yet</h2>
            <p className="text-sm text-muted-foreground mt-1 mb-6 max-w-md">
              Create a Context to group related meetings — like a project, client, or ongoing
              initiative — and keep their decisions, action items, and questions together.
            </p>
            <Button variant="default" onClick={() => setCreateOpen(true)} className="cursor-pointer">
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
                className="group text-left bg-surface rounded-xl border border-border shadow-sm p-5 hover:shadow-md hover:border-primary/30 transition-colors cursor-pointer"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-full bg-primary/10">
                      <Layers className="w-4 h-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                        {context.name}
                      </h2>
                      {context.description ? (
                        <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{context.description}</p>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                      {meetingCountLabel(context.meetingCount)}
                    </span>
                    {context.memoryItemCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-primary/5 text-primary font-medium">
                        {context.memoryItemCount} saved note{context.memoryItemCount === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  {lastActivityLabel(context.updatedAt) && (
                    <span className="text-muted-foreground">{lastActivityLabel(context.updatedAt)}</span>
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
        <div className="flex items-center justify-center h-screen bg-background">
          <LoaderIcon className="animate-spin motion-reduce:animate-none size-6 text-muted-foreground" />
        </div>
      }
    >
      <ContextPageContent />
    </Suspense>
  );
}
