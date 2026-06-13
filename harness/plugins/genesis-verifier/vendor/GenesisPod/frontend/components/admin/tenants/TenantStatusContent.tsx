'use client';

import { useEffect, useState } from 'react';
import {
  Users,
  Activity,
  Zap,
  AlertTriangle,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import AdminPageLayout from '@/components/admin/layout/AdminPageLayout';
import AdminStatsCards from '@/components/admin/shared/AdminStatsCards';
import AdminStatusBadge from '@/components/admin/shared/AdminStatusBadge';
import AdminEmptyState from '@/components/admin/shared/AdminEmptyState';
import AdminLoadingSkeleton from '@/components/admin/shared/AdminLoadingSkeleton';
import { ErrorState } from '@/components/ui/states/ErrorState';
import { Th } from '@/components/admin/_shared/admin-tables';
import {
  useTenantStatus,
  type TenantActivityStatus,
  type TenantStatusRow,
} from '@/hooks/domain/useAdminStatus';
import type { StatusType } from '@/lib/features/admin/styles';

const PAGE_SIZE = 50;

const STATUS_BADGE: Record<
  TenantActivityStatus,
  { type: StatusType; label: string }
> = {
  attention: { type: 'error', label: '需关注' },
  running: { type: 'active', label: '运行中' },
  active: { type: 'configured', label: '活跃' },
  idle: { type: 'inactive', label: '闲置' },
};

function formatLastActive(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return date.toLocaleDateString();
}

export default function TenantStatusContent() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);

  // 输入防抖：停顿 400ms 后才发起搜索并回到第一页
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setOffset(0);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data, loading, error, refresh, lastUpdatedAt } = useTenantStatus({
    limit: PAGE_SIZE,
    offset,
    search: search || undefined,
  });

  const rows: TenantStatusRow[] = data?.tenants ?? [];
  const total = data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <AdminPageLayout
      title="租户状态"
      description="所有租户（用户）的实时运行状态与资源消耗，30 秒自动刷新"
      icon={Users}
      domain="user"
      actions={
        <div className="flex items-center gap-3">
          {lastUpdatedAt && (
            <span className="text-xs text-gray-400">
              更新于 {lastUpdatedAt.toLocaleTimeString()}
            </span>
          )}
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        <AdminStatsCards
          loading={!data && loading}
          cards={[
            {
              label: '租户总数',
              value: data?.summary.totalTenants ?? 0,
              icon: Users,
              semantic: 'slate',
            },
            {
              label: `活跃租户（${data?.windowHours ?? 24}h）`,
              value: data?.summary.activeTenants ?? 0,
              icon: Activity,
              semantic: 'emerald',
            },
            {
              label: '运行中任务',
              value: data?.summary.runningProcesses ?? 0,
              icon: Zap,
              semantic: 'blue',
            },
            {
              label: `失败/错误（${data?.windowHours ?? 24}h）`,
              value:
                (data?.summary.llmFailures ?? 0) + (data?.summary.errors ?? 0),
              icon: AlertTriangle,
              semantic:
                (data?.summary.llmFailures ?? 0) + (data?.summary.errors ?? 0) >
                0
                  ? 'red'
                  : 'slate',
            },
          ]}
        />

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="搜索邮箱 / 用户名"
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {error ? (
          <ErrorState error={error} onRetry={() => void refresh()} />
        ) : !data && loading ? (
          <AdminLoadingSkeleton variant="table" rows={8} />
        ) : rows.length === 0 ? (
          <AdminEmptyState
            icon={Users}
            title="没有匹配的租户"
            description={search ? '换个关键词试试' : '系统中还没有用户'}
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full">
              <thead className="border-b border-gray-100 bg-gray-50/50">
                <tr>
                  <Th>租户</Th>
                  <Th>状态</Th>
                  <Th className="text-right">运行中</Th>
                  <Th className="text-right">LLM 调用(24h)</Th>
                  <Th className="text-right">失败(24h)</Th>
                  <Th className="text-right">Tokens(24h)</Th>
                  <Th className="text-right">积分余额</Th>
                  <Th className="text-right">今日消耗</Th>
                  <Th className="text-right">错误(24h)</Th>
                  <Th>最近活跃</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r) => {
                  const badge = STATUS_BADGE[r.status];
                  return (
                    <tr key={r.userId} className="hover:bg-gray-50/50">
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {r.fullName || r.username || r.email}
                          </span>
                          <span className="text-xs text-gray-400">
                            {r.email}
                            {!r.isActive && ' · 已禁用'}
                          </span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <AdminStatusBadge
                          status={badge.type}
                          label={badge.label}
                          dot
                        />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-900">
                        {r.runningProcesses}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                        {r.llmCalls.toLocaleString()}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums ${
                          r.llmFailures + r.failedProcesses > 0
                            ? 'font-semibold text-red-600'
                            : 'text-gray-600'
                        }`}
                      >
                        {r.llmFailures + r.failedProcesses}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                        {r.tokens.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                        {r.creditsBalance.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                        {r.creditsSpentToday.toLocaleString()}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums ${
                          r.errors > 0
                            ? 'font-semibold text-red-600'
                            : 'text-gray-600'
                        }`}
                      >
                        {r.errors}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                        {formatLastActive(r.lastActiveAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              第 {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} 条，共{' '}
              {total} 个租户
              {data?.capped && '（聚合范围已截断至前 1000 个）'}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!hasPrev}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
                上一页
              </button>
              <button
                type="button"
                disabled={!hasNext}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40"
              >
                下一页
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </AdminPageLayout>
  );
}
