'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import AppShell from '@/components/layout/AppShell';
import { LoadingState } from '@/components/ui/states';

// Lazy-load heavy component (4200+ lines)
const ExploreContent = dynamic(
  () => import('@/components/explore/core/ExploreContentEntryTrend'),
  {
    loading: () => (
      <main className="min-w-0 flex-1 overflow-y-auto bg-gray-50">
        <LoadingState />
      </main>
    ),
    ssr: false,
  }
);

export default function ExplorePage() {
  return (
    <AppShell className="relative w-screen overflow-hidden">
      <Suspense
        fallback={
          <main className="min-w-0 flex-1 overflow-y-auto bg-gray-50">
            <LoadingState />
          </main>
        }
      >
        <ExploreContent />
      </Suspense>
    </AppShell>
  );
}
