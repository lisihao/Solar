'use client';

import AppShell from '@/components/layout/AppShell';
import { MissionRunView } from '@/components/me/team/views/MissionRunView';

/**
 * /missions —— 我的团队任务（从 Agent 团队剥离的独立任务区）。
 * 列表态：页头 + 下发任务弹窗 + 任务卡片（MissionRunView 内 ListShell）。
 * 详情态：点卡进 canonical MissionDetailFrame 整屏详情（与 playground 同款）。
 */
export default function MissionsPage() {
  return (
    <AppShell>
      <MissionRunView />
    </AppShell>
  );
}
