'use client';

import React from 'react';

interface PageHeaderProps {
  title: string;
  /**
   * One short line, only when it tells the user something the title cannot.
   * Phase C3: a sentence that merely restates the title or the obvious sort
   * order is noise, so descriptions are opt-in per screen rather than a habit.
   */
  description?: string;
  /**
   * Compact factual metadata rendered next to the title, e.g. a result count.
   * This is the right home for "51 meetings": useful, scannable, and not a
   * sentence the user has to read.
   */
  meta?: React.ReactNode;
  /** Right-aligned actions. Keep to one primary action plus at most one other. */
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, meta, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-page-title text-foreground">{title}</h1>
          {meta ? <span className="text-small tabular-nums text-muted-foreground">{meta}</span> : null}
        </div>
        {description ? (
          <p className="mt-1 text-small text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  /**
   * Phase C5: a failure is not an empty state. `tone="error"` swaps the dashed
   * neutral treatment for a destructive-tinted one so a broken load never
   * reads as "you have nothing here".
   */
  tone?: 'neutral' | 'error';
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  tone = 'neutral',
}: EmptyStateProps) {
  const error = tone === 'error';
  return (
    <div
      role={error ? 'alert' : undefined}
      className={[
        'flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-10 text-center',
        error
          ? 'border-destructive/40 bg-destructive/5'
          : 'border-border bg-muted/30',
        className ?? '',
      ].join(' ')}
    >
      {icon ? (
        <div className={error ? 'mb-3 text-destructive/70' : 'mb-3 text-muted-foreground/40'}>
          {icon}
        </div>
      ) : null}
      <p className={error ? 'text-sm font-medium text-destructive' : 'text-sm font-medium text-foreground'}>
        {title}
      </p>
      {description ? (
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * Phase C5: a quiet placeholder for a list that is still loading. Deliberately
 * plain bars rather than a spinner, so the page does not jump when data lands.
 */
export function ListSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={['flex flex-col gap-2', className ?? ''].join(' ')}
    >
      <span className="sr-only">Loading meetings</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="h-11 animate-pulse rounded-md bg-muted/60"
          style={{ opacity: 1 - index * 0.07 }}
        />
      ))}
    </div>
  );
}
