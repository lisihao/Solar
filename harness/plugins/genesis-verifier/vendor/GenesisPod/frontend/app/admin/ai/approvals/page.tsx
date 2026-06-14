'use client';

/**
 * Human-in-the-Loop Approvals Page
 *
 * 支柱六 6c：Human-in-the-Loop 干预控制台
 *
 * 管理员可在此页面实时查看、审批 Agent 执行过程中发起的人类干预请求。
 * 自动 5 秒轮询，支持 confirm / choose / input / review 四种交互模式。
 */

import { Users } from 'lucide-react';
import { AdminPageLayout } from '@/components/admin/layout';
import { HumanApprovalQueue } from '@/components/admin/human-approval';

export default function ApprovalsPage() {
  return (
    <AdminPageLayout
      title="Human-in-the-Loop"
      description="查看并处理 Agent 执行过程中发起的人类干预请求"
      icon={Users}
      domain="ai"
    >
      <HumanApprovalQueue />
    </AdminPageLayout>
  );
}
