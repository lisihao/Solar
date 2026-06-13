'use client';

import AppShell from '@/components/layout/AppShell';
import { MyTeamView } from '@/components/me/team/views/MyTeamView';

/**
 * /agents —— 我的团队（一人公司 OS，左侧主菜单「我的工作台」组）。
 * 双 Tab：我的专家（专家花名册：配模型、改名、下任务、移除）/ 专家任务（任务记录）。
 */
export default function AgentsPage() {
  return (
    <AppShell>
      <MyTeamView />
    </AppShell>
  );
}
