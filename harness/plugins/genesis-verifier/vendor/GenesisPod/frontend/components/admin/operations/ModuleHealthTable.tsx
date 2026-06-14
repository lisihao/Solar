'use client';

import { Activity } from 'lucide-react';
import { Th } from '../_shared/admin-tables';
import {
  AdminLoadingSkeleton,
  AdminEmptyState,
} from '@/components/admin/shared';
import type { ModuleHealthRow } from '@/hooks/domain/useOperationMetrics';

interface ModuleHealthTableProps {
  rows: ModuleHealthRow[] | undefined;
  loading: boolean;
  error: boolean;
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}

function ratePct(rate: number): number {
  // 后端可能给 0-1 比例或 0-100 百分比，统一归一到百分比
  const pct = rate <= 1 ? rate * 100 : rate;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export default function ModuleHealthTable({
  rows,
  loading,
  error,
}: ModuleHealthTableProps) {
  if (loading) return <AdminLoadingSkeleton variant="table" rows={6} />;

  if (error || !rows || rows.length === 0) {
    return (
      <AdminEmptyState
        icon={Activity}
        title="暂无模块健康数据"
        description="所选时间窗内没有模块产生 user_event。"
      />
    );
  }

  const sorted = [...rows].sort((a, b) => b.started - a.started);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              <Th>模块</Th>
              <Th className="text-right">活跃用户</Th>
              <Th className="text-right">发起</Th>
              <Th className="text-right">完成</Th>
              <Th className="text-right">失败</Th>
              <Th>完成率</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {sorted.map((row) => {
              const pct = ratePct(row.completionRate);
              return (
                <tr key={row.module} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                    {row.module}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums text-gray-700">
                    {fmtNum(row.activeUsers)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums text-gray-700">
                    {fmtNum(row.started)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums text-emerald-600">
                    {fmtNum(row.completed)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums text-rose-600">
                    {fmtNum(row.failed)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 flex-shrink-0 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-[hsl(var(--primary))]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-10 text-right text-xs tabular-nums text-gray-600">
                        {pct}%
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
