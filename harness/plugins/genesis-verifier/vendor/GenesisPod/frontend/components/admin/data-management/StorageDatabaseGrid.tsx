'use client';

import { Database } from 'lucide-react';
import { ProgressBar } from '@/components/ui/progress';
import { TruncatedCell } from '@/components/common/tables';

interface TableStat {
  table: string;
  rows: number;
  totalBytes: number;
  totalHuman: string;
}

interface StorageDatabaseGridProps {
  tables: TableStat[];
  totalBytes: number;
  loading?: boolean;
}

export default function StorageDatabaseGrid({
  tables,
  totalBytes,
  loading,
}: StorageDatabaseGridProps) {
  const columns = [
    { key: 'table', label: 'Table', width: 'w-[260px]' },
    { key: 'rows', label: 'Rows', width: 'w-[120px]', align: 'right' },
    { key: 'size', label: 'Size', width: 'w-[120px]', align: 'right' },
    { key: 'share', label: 'Share', width: 'w-[260px]' },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
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
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3">
                      <div className="h-5 rounded bg-gray-200" />
                    </td>
                  ))}
                </tr>
              ))
            ) : tables.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center">
                  <Database className="mx-auto h-12 w-12 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-500">暂无数据库表统计</p>
                </td>
              </tr>
            ) : (
              tables.map((row) => {
                const pct =
                  totalBytes > 0 ? (row.totalBytes / totalBytes) * 100 : 0;
                return (
                  <tr
                    key={row.table}
                    className="transition-colors hover:bg-gray-50"
                  >
                    <td className="font-mono px-4 py-3 text-sm font-medium text-gray-900">
                      <TruncatedCell className="font-mono max-w-[240px] text-sm font-medium text-gray-900">
                        {row.table}
                      </TruncatedCell>
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-600">
                      {row.rows.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium text-gray-900">
                      {row.totalHuman}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <ProgressBar
                          value={Math.min(100, pct)}
                          tone="success"
                          className="flex-1"
                        />
                        <span className="w-12 text-right text-xs font-medium text-gray-600">
                          {pct.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
