'use client';

import { useCallback } from 'react';
import { Download, Wallet } from 'lucide-react';
import { Th } from '@/components/admin/_shared/admin-tables';
import AdminEmptyState from '@/components/admin/shared/AdminEmptyState';
import type { OperationUserCost } from '@/hooks/domain/useOperationMetrics';

interface UserCostTableProps {
  rows: OperationUserCost[];
  days: number;
}

const CSV_HEADERS: Array<{ key: keyof OperationUserCost; label: string }> = [
  { key: 'userId', label: 'userId' },
  { key: 'userName', label: 'userName' },
  { key: 'costUsd', label: 'costUsd' },
  { key: 'tokens', label: 'tokens' },
  { key: 'spentCredits', label: 'spentCredits' },
  { key: 'marginProxyCredits', label: 'marginProxyCredits' },
];

function escapeCsv(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function UserCostTable({ rows, days }: UserCostTableProps) {
  const handleExport = useCallback(() => {
    const header = CSV_HEADERS.map((h) => h.label).join(',');
    const body = rows
      .map((r) => CSV_HEADERS.map((h) => escapeCsv(r[h.key] ?? '')).join(','))
      .join('\n');
    // BOM 前缀让 Excel 正确识别 UTF-8
    const blob = new Blob([`﻿${header}\n${body}`], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `user-cost-${days}d.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [rows, days]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          按货币成本（ai_engine_metrics 唯一真源）降序，近 {days} 天 Top{' '}
          {rows.length}
        </p>
        <button
          type="button"
          onClick={handleExport}
          disabled={rows.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40"
        >
          <Download className="h-4 w-4" />
          导出 CSV
        </button>
      </div>

      {rows.length === 0 ? (
        <AdminEmptyState
          icon={Wallet}
          title="暂无成本数据"
          description="窗口内还没有产生 LLM 成本记录"
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full">
            <thead className="border-b border-gray-100 bg-gray-50/50">
              <tr>
                <Th>用户</Th>
                <Th className="text-right">成本 (USD)</Th>
                <Th className="text-right">Tokens</Th>
                <Th className="text-right">消耗积分</Th>
                <Th className="text-right">毛利代理 (积分)</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((r) => (
                <tr key={r.userId} className="hover:bg-gray-50/50">
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                    {r.userName ? (
                      <div className="flex flex-col">
                        <span className="font-medium">{r.userName}</span>
                        <span className="font-mono text-xs text-gray-400">
                          {r.userId.slice(0, 8)}
                        </span>
                      </div>
                    ) : (
                      <span className="font-mono text-xs text-gray-500">
                        {r.userId.slice(0, 12)}…
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-900">
                    ${r.costUsd.toFixed(4)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                    {r.tokens.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                    {r.spentCredits.toLocaleString()}
                  </td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums ${
                      r.marginProxyCredits >= 0
                        ? 'text-emerald-600'
                        : 'text-red-600'
                    }`}
                  >
                    {r.marginProxyCredits.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
