'use client';

/**
 * AI Radar Layout —— 全局 Sidebar wrapper
 *
 * 严格对齐 ai-insights / ai-research / agent-playground / custom-agents / admin
 * 范式：每个 ai-app 模块顶层用 AppShell wrap，让左侧 Sidebar + MobileNav 保留
 * 在所有子页（列表 + 详情）。
 */

import AppShell from '@/components/layout/AppShell';

export default function RadarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell>
      {/* flex flex-col + min-h-0：让子页面的 flex-1 高度链真正生效
          （对齐 ai-social/layout，与 agent-playground 修复同因——否则
          aside 撑到自然高度，底部按钮被推出 viewport） */}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </AppShell>
  );
}
