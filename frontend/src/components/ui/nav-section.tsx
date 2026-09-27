import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * NavSection — the single canonical treatment for sidebar section labels.
 *
 * The sidebar previously carried two competing recipes (`px-3 pt-5 pb-1.5` for
 * navigation groups and `px-3 pt-3 pb-1` for history headings). This component
 * is the one place a section label is defined, so the vertical rhythm of the
 * sidebar is decided once.
 *
 * The label uses the existing `text-label` semantic token (12px, uppercase,
 * tracked) and the same horizontal inset as a navigation row, so labels align
 * with the text they head. It is deliberately quieter than the rows it
 * introduces — a label is structure, not content.
 */
export interface NavSectionProps {
  label: string;
  children: React.ReactNode;
  className?: string;
  /** Override the label's horizontal inset, e.g. inside a collapsed rail. */
  insetClassName?: string;
  /**
   * Drop the label's top padding. The first section in a scroll region sits
   * directly under the region edge, so it does not need to be pushed down —
   * and at short window heights that 12px is the difference between every
   * destination fitting and the last row being clipped.
   */
  flush?: boolean;
}

const SECTION_LABEL = 'px-3 pt-3 pb-1.5 text-label text-muted-foreground';

function NavSection({ label, children, className, insetClassName, flush }: NavSectionProps) {
  return (
    <div role="group" aria-label={label} data-slot="nav-section" className={className}>
      <div
        className={cn(SECTION_LABEL, flush && 'pt-0', insetClassName)}
        data-slot="nav-section-label"
      >
        {label}
      </div>
      <div className="space-y-0.5" data-slot="nav-section-items">
        {children}
      </div>
    </div>
  );
}

export { NavSection, SECTION_LABEL };
