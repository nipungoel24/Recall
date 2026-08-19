'use client';

import React from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

/**
 * Consistent page header: title (largest), muted description, and right-side
 * actions. Used by Calendar, Daily, Contexts, Templates, and Settings-style
 * pages so every route shares the same hierarchy.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {description ? (
          <p className="text-sm text-gray-500 mt-1">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>
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
}

/**
 * Intentional empty state for a section: quiet icon, short title, one line of
 * guidance, and an optional action. Never a loud full-page takeover.
 */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50/60 px-6 py-8 text-center ${className ?? ''}`}
    >
      {icon ? <div className="mb-3 text-gray-300">{icon}</div> : null}
      <p className="text-sm font-medium text-gray-700">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-xs text-gray-500">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
