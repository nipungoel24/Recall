'use client';

import React from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div className="min-w-0">
        <h1 className="text-page-title text-foreground">{title}</h1>
        {description ? (
          <p className="text-small text-muted-foreground mt-1">{description}</p>
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

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 px-6 py-8 text-center ${className ?? ''}`}
    >
      {icon ? <div className="mb-3 text-muted-foreground/40">{icon}</div> : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
