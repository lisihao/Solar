'use client';

import { useState } from 'react';
import {
  Gauge,
  Filter,
  LineChart as LineChartIcon,
  LayoutGrid,
  Hash,
  RefreshCw,
} from 'lucide-react';
import AdminPageLayout, {
  AdminPageSection,
} from '@/components/admin/layout/AdminPageLayout';
import AdminTabs, { type AdminTab } from '@/components/admin/shared/AdminTabs';
import AdminLoadingSkeleton from '@/components/admin/shared/AdminLoadingSkeleton';
import { ErrorState } from '@/components/ui/states/ErrorState';
import { useOperationMetrics } from '@/hooks/domain/useOperationMetrics';
import OverviewPanel from '@/components/admin/operations/OverviewPanel';
import FunnelPanel from '@/components/admin/operations/FunnelPanel';
import RetentionPanel from '@/components/admin/operations/RetentionPanel';
import UserCostTable from '@/components/admin/operations/UserCostTable';
import ModuleHealthTable from '@/components/admin/operations/ModuleHealthTable';
import TopicsPanel from '@/components/admin/operations/TopicsPanel';

const TABS: AdminTab[] = [
  { key: 'overview', label: '经营总览', icon: Gauge },
  { key: 'funnel', label: '增长漏斗', icon: Filter },
  { key: 'retention', label: '留存', icon: LineChartIcon },
  { key: 'modules', label: '模块健康', icon: LayoutGrid },
  { key: 'topics', label: '主题运营', icon: Hash },
];

const DAYS = 30;
const WEEKS = 8;
const COST_LIMIT = 20;

export default function OperationsPage() {
  const [tab, setTab] = useState<string>('overview');
  const {
    overview,
    funnel,
    cohort,
    userCost,
    modules,
    topics,
    loading,
    error,
    refreshAll,
  } = useOperationMetrics({ days: DAYS, weeks: WEEKS, costLimit: COST_LIMIT });

  const refreshAction = (
    <button
      type="button"
      onClick={refreshAll}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
    >
      <RefreshCw className="h-4 w-4" />
      刷新
    </button>
  );

  return (
    <AdminPageLayout
      title="运营看板"
      description="经营总览 · 增长漏斗 · 留存 · 模块健康 · 主题运营"
      icon={Gauge}
      domain="overview"
      actions={refreshAction}
    >
      <div className="space-y-6">
        <AdminTabs
          tabs={TABS}
          activeKey={tab}
          onChange={setTab}
          mode="controlled"
        />

        {error && (
          <ErrorState
            error={error}
            title="部分指标加载失败"
            onRetry={refreshAll}
          />
        )}

        {tab === 'overview' && (
          <>
            {loading && !overview ? (
              <AdminLoadingSkeleton variant="cards" rows={4} />
            ) : (
              <OverviewPanel overview={overview} />
            )}

            {/* 单用户成本表常驻总览之下，便于直接审视单用户经济性 */}
            <AdminPageSection
              title="单用户成本 / 积分毛利"
              description="货币成本来自 ai_engine_metrics（唯一真源），积分毛利为近似口径"
            >
              <UserCostTable rows={userCost} days={DAYS} />
            </AdminPageSection>
          </>
        )}

        {tab === 'funnel' && (
          <>
            {loading && !funnel ? (
              <AdminLoadingSkeleton variant="cards" rows={4} />
            ) : (
              <FunnelPanel funnel={funnel} days={DAYS} />
            )}
          </>
        )}

        {tab === 'retention' && (
          <>
            {loading ? (
              <AdminLoadingSkeleton variant="table" rows={6} />
            ) : (
              <RetentionPanel cohort={cohort} weeks={WEEKS} />
            )}
          </>
        )}

        {tab === 'modules' && (
          <AdminPageSection
            title="模块健康"
            description="各模块发起 / 完成 / 失败 / 完成率"
          >
            <ModuleHealthTable
              rows={modules}
              loading={loading}
              error={!!error}
            />
          </AdminPageSection>
        )}

        {tab === 'topics' && (
          <AdminPageSection
            title="主题运营"
            description="热门主题 top 20（按事件频次）"
          >
            <TopicsPanel rows={topics} loading={loading} error={!!error} />
          </AdminPageSection>
        )}
      </div>
    </AdminPageLayout>
  );
}
