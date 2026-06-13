'use client';

import {
  MousePointerClick,
  Eye,
  Layers,
  BarChart3,
  Activity,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { ARCHITECTURE_LAYERS } from '@/lib/features/admin/architecture';
import { useTranslation } from '@/lib/i18n';
import { useApiGet } from '@/hooks/core';
import { useOverviewStatus } from '@/hooks/domain/useAdminStatus';
import AdminStatusBadge from '@/components/admin/shared/AdminStatusBadge';
import type { StatusType } from '@/lib/features/admin/styles';
import ArchitectureLayer from './ArchitectureLayer';

// 全局健康状态 → AdminStatusBadge 状态色
const HEALTH_BADGE: Record<string, StatusType> = {
  healthy: 'active',
  degraded: 'pending',
  unhealthy: 'error',
};

export default function ArchitectureDiagram() {
  const { t } = useTranslation();

  // 静态库存统计（无实时状态的卡片回落用）
  const { data: overviewStats } = useApiGet<Record<string, number>>(
    '/admin/overview-stats'
  );

  // 实时状态：30s 轮询（卡片健康灯 + 全局健康分）
  const { data: status, lastUpdatedAt } = useOverviewStatus();

  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-6 py-4 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Title */}
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 shadow-sm">
              <Layers className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-lg font-semibold tracking-tight text-slate-900">
                  {t('admin.architecture.title')}
                </h1>
                {status && (
                  <span className="font-mono flex items-center gap-1.5 rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-500">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                    LIVE · 30s
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-400">
                {t('admin.architecture.subtitle')}
              </p>
            </div>
          </div>

          {/* Right: 实时健康 + 入口 */}
          <div className="hidden items-center gap-2.5 md:flex">
            {status && (
              <>
                <AdminStatusBadge
                  status={HEALTH_BADGE[status.global.status] ?? 'inactive'}
                  label={`${t('admin.architecture.health.score')} ${status.global.healthScore}`}
                  dot
                />
                <div
                  className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5"
                  title={t('admin.architecture.health.running')}
                >
                  <Activity className="h-3.5 w-3.5 text-slate-400" />
                  <span className="font-mono text-sm font-semibold tabular-nums text-slate-800">
                    {status.global.runningProcesses}
                  </span>
                  <span className="text-xs text-slate-400">
                    {t('admin.architecture.health.running')}
                  </span>
                </div>
                <div className="h-5 w-px bg-slate-200" />
              </>
            )}
            <Link
              href="/admin/tenants"
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              <Users className="h-4 w-4" />
              {t('admin.nav.tenants')}
            </Link>
            <Link
              href="/admin/operations"
              className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-700"
            >
              <BarChart3 className="h-4 w-4" />
              {t('admin.nav.operations')}
            </Link>
          </div>
        </div>
      </header>

      {/* Architecture Layers */}
      <main className="flex-1 overflow-auto px-4 py-5">
        <div className="mx-auto max-w-5xl">
          <div className="space-y-0">
            {ARCHITECTURE_LAYERS.map((layer, index) => (
              <ArchitectureLayer
                key={layer.id}
                layer={layer}
                showArrow={index < ARCHITECTURE_LAYERS.length - 1}
                overviewStats={overviewStats ?? undefined}
                cardStatuses={status?.cards}
              />
            ))}
          </div>

          {/* Footer: legend + refresh time */}
          <div className="mt-5 flex items-center justify-center gap-5 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <MousePointerClick className="h-3.5 w-3.5" />
              {t('admin.architecture.legend.clickable')}
            </span>
            <span className="flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5" />
              {t('admin.architecture.legend.readOnly')}
            </span>
            {lastUpdatedAt && (
              <>
                <span className="h-3 w-px bg-slate-200" />
                <span className="font-mono">
                  {t('admin.architecture.health.updatedAt')}{' '}
                  {lastUpdatedAt.toLocaleTimeString()}
                </span>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
