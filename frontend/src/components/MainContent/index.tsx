'use client';

import React from 'react';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { sidebarWidth } from '@/lib/sidebar-layout';

interface MainContentProps {
  children: React.ReactNode;
}

const MainContent: React.FC<MainContentProps> = ({ children }) => {
  const { isCollapsed } = useSidebar();

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex-1 min-w-0 bg-background transition-[margin] duration-300 motion-reduce:transition-none focus-visible:outline-none"
      // Width comes from lib/sidebar-layout.ts so this offset can never drift
      // from the sidebar panel it is clearing.
      style={{ marginLeft: sidebarWidth(isCollapsed) }}
    >
      <div className="px-8 py-6">{children}</div>
    </main>
  );
};

export default MainContent;
