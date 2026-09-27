'use client';

import React from 'react';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { sidebarWidth } from '@/lib/sidebar-layout';

interface MainContentProps {
  children: React.ReactNode;
}

/**
 * MainContent - the application content region.
 *
 * Phase B makes this the single owner of page geometry:
 *
 *   main      flex column, height-bounded by the shell (the h-dvh row)
 *    + gutter   the ONE place page gutters are defined
 *       + scroller  the ONE place pages scroll vertically
 *
 * Before this, the shell row had no height, every page declared its own
 * h-screen, and the gutter padding was added *around* that already-full-height
 * child. The result was a document 48px taller than the window at every size
 * (700 + 24 + 24 = 748), so the entire application scrolled instead of the page.
 *
 * Pages must therefore NOT claim the viewport: a page that fills this region
 * uses h-full, and a page that flows simply grows and lets this scroller scroll.
 * Horizontal overflow is clipped here deliberately; a feature that genuinely
 * needs to scroll sideways owns its own scroll container.
 */
const MainContent: React.FC<MainContentProps> = ({ children }) => {
  const { isCollapsed } = useSidebar();

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background transition-[margin] duration-300 motion-reduce:transition-none focus-visible:outline-none"
      // Width comes from lib/sidebar-layout.ts so this offset can never drift
      // from the sidebar panel it is clearing.
      style={{ marginLeft: sidebarWidth(isCollapsed) }}
    >
      <div className="flex min-h-0 flex-1 flex-col px-8 py-6">
        <div
          data-slot="page-scroll"
          className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        >
          {children}
        </div>
      </div>
    </main>
  );
};

export default MainContent;
