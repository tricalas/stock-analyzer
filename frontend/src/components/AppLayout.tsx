'use client';

import { ReactNode } from 'react';
import Sidebar from './Sidebar';

interface AppLayoutProps {
  children: ReactNode;
  favoriteCount?: number;
  dislikeCount?: number;
}

export default function AppLayout({ children, favoriteCount, dislikeCount }: AppLayoutProps) {
  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar */}
      <Sidebar favoriteCount={favoriteCount} dislikeCount={dislikeCount} />

      {/* Main Content */}
      <div className="lg:pl-40 pl-12">
        {/* Page Content */}
        <main className="min-h-screen">
          {children}
        </main>
      </div>
    </div>
  );
}
