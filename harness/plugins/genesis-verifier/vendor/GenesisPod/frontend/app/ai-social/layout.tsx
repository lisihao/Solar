'use client';

import AppShell from '@/components/layout/AppShell';

export default function AiSocialLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell>
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </AppShell>
  );
}
