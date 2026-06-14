'use client';

/**
 * AI Insights Layout
 * 使用全局可折叠 Sidebar
 *
 * ★ Hydration 问题已在 Providers 层面统一处理
 */

import AppShell from '@/components/layout/AppShell';

export default function InsightsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell>
      <main className="flex-1 overflow-hidden">{children}</main>
    </AppShell>
  );
}
