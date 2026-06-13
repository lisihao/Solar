'use client';

import AppShell from '@/components/layout/AppShell';

export default function AgentPlaygroundLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell>
      {/* flex flex-col + min-h-0：让 MissionDetailFrame 的 flex-1 真正生效
          （与 app/ai-social/layout.tsx 对齐，否则 aside 会撑到自然高度
          把底部按钮挤出 viewport）*/}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </AppShell>
  );
}
