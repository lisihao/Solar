'use client';

import { Cloud } from 'lucide-react';
import { TruncatedCell } from '@/components/common/tables';

interface CatalogRow {
  prefix: string;
  objects: number;
  bytes: number;
  bytesHuman: string;
  targetCount: number;
  managed: boolean;
  dbRows: number;
  migratedRows: number;
  remainingRows: number;
}

interface StorageCatalogGridProps {
  rows: CatalogRow[];
  loading?: boolean;
}

export default function StorageCatalogGrid({
  rows,
  loading,
}: StorageCatalogGridProps) {
  const columns = [
    { key: 'prefix', label: 'Prefix', width: 'w-[260px]' },
    { key: 'status', label: 'Status', width: 'w-[120px]' },
    { key: 'objects', label: 'Objects', width: 'w-[110px]', align: 'right' },
    { key: 'r2Size', label: 'R2 Size', width: 'w-[110px]', align: 'right' },
    {
      key: 'targets',
      label: 'Targets',
      width: 'w-[100px]',
      align: 'right',
    },
    { key: 'dbRows', label: 'DB Rows', width: 'w-[110px]', align: 'right' },
    {
      key: 'migrated',
      label: 'Migrated',
      width: 'w-[110px]',
      align: 'right',
    },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed divide-y divide-gray-200">
          <colgroup>
            <col className="w-[26%]" />
            <col className="w-[12%]" />
            <col className="w-[10%]" />
            <col className="w-[12%]" />
            <col className="w-[10%]" />
            <col className="w-[14%]" />
            <col className="w-[16%]" />
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
              Array.from({ length: 5 }).map((_, i) => (
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
                <td colSpan={columns.length} className="px-4 py-12 text-center">
                  <Cloud className="mx-auto h-12 w-12 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-500">
                    R2 中暂无前缀对象
                  </p>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.prefix}
                  className="transition-colors hover:bg-gray-50"
                >
                  <td className="font-mono px-4 py-3 text-sm font-medium text-gray-900">
                    <TruncatedCell className="font-mono max-w-[240px] text-sm font-medium text-gray-900">
                      {row.prefix}
                    </TruncatedCell>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        row.managed
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {row.managed ? 'Managed' : 'Observed'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-gray-600">
                    {row.objects.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-medium text-gray-900">
                    {row.bytesHuman}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-gray-600">
                    {row.targetCount > 0 ? row.targetCount : '-'}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-gray-600">
                    {row.dbRows > 0 ? row.dbRows.toLocaleString() : '-'}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-medium text-emerald-700">
                    {row.migratedRows > 0
                      ? row.migratedRows.toLocaleString()
                      : '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
