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
      <Sidebar favoriteCount={favoriteCount} dislikeCount={dislikeCount} />

      {/* Main Content */}
      <div className="lg:pl-56 pt-14 lg:pt-0 pb-20 lg:pb-0">
        <main className="min-h-screen">
          {children}
        </main>
      </div>
    </div>
  );
}
