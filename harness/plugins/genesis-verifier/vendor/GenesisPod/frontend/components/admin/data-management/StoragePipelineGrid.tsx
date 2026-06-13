'use client';

import { ArrowRight, Cloud, Database, Info } from 'lucide-react';
import { TruncatedCell } from '@/components/common/tables';

interface OffloadFieldStat {
  table: string;
  field: string;
  uriField: string;
  r2Prefix: string;
  totalRows: number;
  rowsWithUri: number;
  rowsWithDbContent: number;
}

interface StoragePipelineGridProps {
  rows: OffloadFieldStat[];
  loading?: boolean;
  onShowR2Detail?: (r2Prefix: string) => void;
}

const STATE_COLORS = {
  Complete: 'bg-emerald-100 text-emerald-700',
  Active: 'bg-blue-100 text-blue-700',
  Pending: 'bg-amber-100 text-amber-700',
  Empty: 'bg-gray-100 text-gray-500',
} as const;

const STATE_LABELS: Record<keyof typeof STATE_COLORS, string> = {
  Complete: 'Complete',
  Active: 'Active',
  Pending: 'Pending',
  Empty: 'No Data',
};

function deriveState(row: OffloadFieldStat): keyof typeof STATE_COLORS {
  // 该字段从未被写入过任何数据 — 没东西可搬
  if (row.rowsWithUri === 0 && row.rowsWithDbContent === 0) return 'Empty';
  // DB 已清空，全部已迁移
  if (row.rowsWithDbContent === 0) return 'Complete';
  // 一行都还没搬
  if (row.rowsWithUri === 0) return 'Pending';
  // 部分已迁移、部分还在 DB
  return 'Active';
}

/**
 * Coverage = 已迁移 / (已迁移 + DB 仍存)
 * 分母是"实际有过数据的行"，不含字段从未写过的行。
 * 没有数据时显示 — 而非 0%（0% 会让人误以为"未迁移"）。
 */
function deriveCoverage(row: OffloadFieldStat): number | null {
  const denom = row.rowsWithUri + row.rowsWithDbContent;
  if (denom === 0) return null;
  return (row.rowsWithUri / denom) * 100;
}

export default function StoragePipelineGrid({
  rows,
  loading,
  onShowR2Detail,
}: StoragePipelineGridProps) {
  const columns = [
    { key: 'field', label: 'Field', width: 'w-[260px]' },
    { key: 'route', label: 'R2 Route', width: 'w-[280px]' },
    {
      key: 'totalRows',
      label: 'Total Rows',
      width: 'w-[110px]',
      align: 'right',
    },
    { key: 'migrated', label: 'Migrated', width: 'w-[110px]', align: 'right' },
    { key: 'remaining', label: 'In DB', width: 'w-[110px]', align: 'right' },
    { key: 'coverage', label: 'Coverage', width: 'w-[200px]' },
    { key: 'status', label: 'Status', width: 'w-[100px]' },
    { key: 'actions', label: '操作', width: 'w-[110px]' },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-3 text-xs leading-5 text-gray-600">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600" />
        <div className="space-y-1">
          <div>
            <span className="font-medium text-gray-700">列含义</span>：
            <span className="font-semibold">TOTAL ROWS</span> 表里所有行 ·{' '}
            <span className="font-semibold">MIGRATED</span> 已搬到 R2 的行（DB
            字段已清）· <span className="font-semibold">IN DB</span> DB
            字段还有内容的行（待搬）·{' '}
            <span className="font-semibold">COVERAGE</span> = MIGRATED /
            (MIGRATED + IN DB)
          </div>
          <div>
            <span className="font-medium text-gray-700">状态</span>：
            <span className="text-gray-500">No Data</span> 该字段从未写入过 ·{' '}
            <span className="text-amber-700">Pending</span> 有数据待搬 ·{' '}
            <span className="text-blue-700">Active</span> 部分已迁 ·{' '}
            <span className="text-emerald-700">Complete</span> 已全部迁完
          </div>
          <div>
            <span className="font-medium text-gray-700">迁移规则</span>
            ：DB 字段 ≥ 2KB 才搬到 R2（小内容留 DB 只记 size）；后台 24h
            一次，"立即运行 Offload" 可手动触发。
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed divide-y divide-gray-200">
            <colgroup>
              <col className="w-[20%]" />
              <col className="w-[18%]" />
              <col className="w-[9%]" />
              <col className="w-[9%]" />
              <col className="w-[8%]" />
              <col className="w-[14%]" />
              <col className="w-[8%]" />
              <col className="w-[14%]" />
            </colgroup>
            <thead className="bg-gray-50">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`${col.width} px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-600 ${
                      col.align === 'right' ? 'text-right' : 'text-left'
                    }`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {columns.map((col) => (
                      <td key={col.key} className="px-4 py-3">
                        <div className="h-5 rounded bg-gray-200" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-4 py-12 text-center"
                  >
                    <Database className="mx-auto h-12 w-12 text-gray-300" />
                    <p className="mt-2 text-sm text-gray-500">
                      暂无注册的 Offload 目标
                    </p>
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const state = deriveState(row);
                  const coverage = deriveCoverage(row);
                  const barColor =
                    coverage === null
                      ? 'bg-gray-300'
                      : coverage >= 95
                        ? 'bg-emerald-500'
                        : coverage >= 50
                          ? 'bg-blue-500'
                          : 'bg-amber-500';
                  return (
                    <tr
                      key={`${row.table}.${row.field}`}
                      className="transition-colors hover:bg-gray-50"
                    >
                      {/* Field */}
                      <td className="px-4 py-2.5">
                        <TruncatedCell
                          className="font-mono max-w-[240px] text-sm font-medium text-gray-900"
                          tooltip={`${row.table}.${row.field} (uri: ${row.uriField})`}
                        >
                          {row.table}.{row.field}
                        </TruncatedCell>
                        <TruncatedCell className="font-mono mt-0.5 max-w-[240px] text-xs text-gray-400">
                          {row.uriField}
                        </TruncatedCell>
                      </td>

                      {/* R2 Route */}
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2 text-xs text-gray-600">
                          <TruncatedCell className="font-mono max-w-[100px] rounded bg-gray-100 px-2 py-0.5 text-gray-700">
                            {row.field}
                          </TruncatedCell>
                          <ArrowRight className="h-3 w-3 flex-shrink-0 text-gray-400" />
                          <TruncatedCell className="font-mono max-w-[140px] rounded bg-blue-50 px-2 py-0.5 text-blue-700">
                            {row.r2Prefix}
                          </TruncatedCell>
                        </div>
                      </td>

                      {/* Total Rows */}
                      <td className="px-4 py-2.5 text-right text-sm text-gray-600">
                        {row.totalRows.toLocaleString()}
                      </td>

                      {/* Migrated */}
                      <td className="px-4 py-2.5 text-right text-sm font-medium text-emerald-700">
                        {row.rowsWithUri.toLocaleString()}
                      </td>

                      {/* Remaining */}
                      <td className="px-4 py-2.5 text-right text-sm text-amber-600">
                        {row.rowsWithDbContent > 0
                          ? row.rowsWithDbContent.toLocaleString()
                          : '-'}
                      </td>

                      {/* Coverage */}
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
                            <div
                              className={`h-full rounded-full ${barColor}`}
                              style={{
                                width:
                                  coverage === null
                                    ? '0%'
                                    : `${Math.min(100, coverage)}%`,
                              }}
                            />
                          </div>
                          <span className="w-10 text-right text-xs font-medium text-gray-600">
                            {coverage === null
                              ? '—'
                              : `${coverage.toFixed(0)}%`}
                          </span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATE_COLORS[state]}`}
                        >
                          {STATE_LABELS[state]}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-2.5">
                        {onShowR2Detail && (
                          <button
                            type="button"
                            onClick={() => onShowR2Detail(row.r2Prefix)}
                            className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                          >
                            <Cloud className="h-3 w-3" />
                            R2 详情
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
