'use client';

import { StatGrid } from '@/components/admin/_shared/admin-tables';
import { AdminPageSection } from '@/components/admin/layout/AdminPageLayout';
import type { OperationOverview } from '@/hooks/domain/useOperationMetrics';

interface OverviewPanelProps {
  overview?: OperationOverview;
}

function fmtInt(n: number | undefined): string {
  return (n ?? 0).toLocaleString();
}

function fmtPct(n: number | undefined): string {
  return `${((n ?? 0) * 100).toFixed(1)}%`;
}

function fmtUsd(n: number | undefined): string {
  return `$${(n ?? 0).toFixed(2)}`;
}

/**
 * 经营总览：核心规模计数 + 本波次增强的经营护栏指标
 * （arpuCredits / payingRate / stickiness / guardrail.activatedRetentionRate）。
 */
export default function OverviewPanel({ overview }: OverviewPanelProps) {
  const scale: Array<{ label: string; value: number | string }> = [
    { label: '总用户', value: fmtInt(overview?.totalUsers) },
    { label: '活跃用户', value: fmtInt(overview?.activeUsers) },
    { label: '总任务', value: fmtInt(overview?.totalMissions) },
    { label: '总成本', value: fmtUsd(overview?.totalCostUsd) },
  ];

  const guard: Array<{ label: string; value: number | string }> = [
    { label: '客单价 (积分)', value: fmtInt(overview?.arpuCredits) },
    { label: '付费率', value: fmtPct(overview?.payingRate) },
    { label: '黏性 (DAU/7d)', value: fmtPct(overview?.stickiness) },
    {
      label: '激活留存率',
      value: fmtPct(overview?.guardrail?.activatedRetentionRate),
    },
  ];

  return (
    <div className="space-y-6">
      <AdminPageSection title="规模" description="累计与活跃口径">
        <StatGrid items={scale} />
      </AdminPageSection>

      <AdminPageSection
        title="经营护栏"
        description="客单价 / 付费率 / 黏性 / 激活留存率（积分口径非货币）"
      >
        <StatGrid items={guard} />
      </AdminPageSection>
    </div>
  );
}
