'use client';

import React from 'react';
import { SummaryTemplateManager } from '@/components/templates/SummaryTemplateManager';
import { PageHeader } from '@/components/shared/PageHeader';

export default function TemplatesPage() {
  return (
    <div className="h-full bg-gray-50 flex flex-col p-8 overflow-y-auto custom-scrollbar">
      <div className="max-w-5xl mx-auto w-full">
        <PageHeader
          title="Templates"
          description="Summary templates control the structure of generated summaries. Custom templates appear in the template picker on every meeting."
        />
        <SummaryTemplateManager />
      </div>
    </div>
  );
}
