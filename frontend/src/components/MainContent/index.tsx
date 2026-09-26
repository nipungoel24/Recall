'use client';

import React from 'react';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';

interface MainContentProps {
  children: React.ReactNode;
}

const MainContent: React.FC<MainContentProps> = ({ children }) => {
  const { isCollapsed } = useSidebar();

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className={`flex-1 min-w-0 bg-background transition-[margin] duration-300 motion-reduce:transition-none focus-visible:outline-none ${
        isCollapsed ? 'ml-16' : 'ml-64'
      }`}
    >
      <div className="px-8 py-6">{children}</div>
    </main>
  );
};

export default MainContent;
