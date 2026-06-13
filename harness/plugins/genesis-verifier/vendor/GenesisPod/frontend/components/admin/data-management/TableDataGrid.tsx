'use client';

import {
  ChevronUp,
  ChevronDown,
  Stethoscope,
  Trash2,
  Eye,
  Database,
  AlertTriangle,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import type { TableInfo, TableListQuery } from '@/hooks/domain';
import { TruncatedCell } from '@/components/common/tables';

// Category colors
const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  USER: { bg: 'bg-blue-100', text: 'text-blue-700' },
  RESOURCE: { bg: 'bg-green-100', text: 'text-green-700' },
  AI_SESSION: { bg: 'bg-violet-100', text: 'text-violet-700' },
  AI_CONFIG: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  KNOWLEDGE: { bg: 'bg-cyan-100', text: 'text-cyan-700' },
  RESEARCH: { bg: 'bg-purple-100', text: 'text-purple-700' },
  OFFICE: { bg: 'bg-pink-100', text: 'text-pink-700' },
  INGESTION: { bg: 'bg-teal-100', text: 'text-teal-700' },
  NOTIFICATION: { bg: 'bg-yellow-100', text: 'text-yellow-700' },
  LOG: { bg: 'bg-orange-100', text: 'text-orange-700' },
  SYSTEM: { bg: 'bg-gray-100', text: 'text-gray-700' },
  ANALYTICS: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  EXTERNAL: { bg: 'bg-rose-100', text: 'text-rose-700' },
  CACHE: { bg: 'bg-slate-100', text: 'text-slate-700' },
  OTHER: { bg: 'bg-neutral-100', text: 'text-neutral-700' },
};

// Health status icons and colors
const HEALTH_STATUS = {
  healthy: {
    icon: CheckCircle,
    color: 'text-emerald-500',
    bg: 'bg-emerald-100',
  },
  warning: {
    icon: AlertTriangle,
    color: 'text-amber-500',
    bg: 'bg-amber-100',
  },
  critical: {
    icon: XCircle,
    color: 'text-red-500',
    bg: 'bg-red-100',
  },
};

interface TableDataGridProps {
  tables: TableInfo[];
  query: TableListQuery;
  total: number;
  page: number;
  pageSize: number;
  loading?: boolean;
  onSort: (sortBy: TableListQuery['sortBy']) => void;
  onPageChange: (page: number) => void;
  onViewDetail: (tableName: string) => void;
  onDiagnose: (tableName: string) => void;
  onCleanup: (tableName: string) => void;
  cleaningTable?: string | null;
}

export default function TableDataGrid({
  tables,
  query,
  total,
  page,
  pageSize,
  loading,
  onSort,
  onPageChange,
  onViewDetail,
  onDiagnose,
  onCleanup,
  cleaningTable,
}: TableDataGridProps) {
  const { t } = useTranslation();

  const columns = [
    {
      key: 'name',
      labelKey: 'admin.tables.columns.name',
      sortable: true,
      width: 'w-[180px]',
    },
    {
      key: 'category',
      labelKey: 'admin.tables.columns.category',
      sortable: true,
      width: 'w-[120px]',
    },
    {
      key: 'rows',
      labelKey: 'admin.tables.columns.rows',
      sortable: true,
      width: 'w-[100px]',
    },
    {
      key: 'size',
      labelKey: 'admin.tables.columns.size',
      sortable: true,
      width: 'w-[100px]',
    },
    {
      key: 'cleanable',
      labelKey: 'admin.tables.columns.cleanable',
      sortable: true,
      width: 'w-[100px]',
    },
    {
      key: 'status',
      labelKey: 'admin.tables.columns.status',
      sortable: true,
      width: 'w-[100px]',
    },
    {
      key: 'actions',
      labelKey: 'admin.tables.columns.actions',
      sortable: false,
      width: 'w-[140px]',
    },
  ];

  const totalPages = Math.ceil(total / pageSize);

  const SortIcon = ({ column }: { column: string }) => {
    if (query.sortBy !== column) {
      return <ChevronDown className="h-4 w-4 text-gray-300" />;
    }
    return query.sortOrder === 'asc' ? (
      <ChevronUp className="h-4 w-4 text-emerald-600" />
    ) : (
      <ChevronDown className="h-4 w-4 text-emerald-600" />
    );
  };

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full table-fixed divide-y divide-gray-200">
          <colgroup>
            <col className="w-[22%]" />
            <col className="w-[14%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[12%]" />
            <col className="w-[22%]" />
          </colgroup>
          <thead className="bg-gray-50">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`${col.width} px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 ${
                    col.sortable ? 'cursor-pointer hover:bg-gray-100' : ''
                  }`}
                  onClick={() =>
                    col.sortable && onSort(col.key as TableListQuery['sortBy'])
                  }
                >
                  <div className="flex items-center gap-1">
                    {t(col.labelKey)}
                    {col.sortable && <SortIcon column={col.key} />}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {loading ? (
              // Loading skeleton
              Array.from({ length: 10 }).map((_, i) => (
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
                  <p className="mt-2 text-sm text-gray-500">
                    {t('admin.tables.empty')}
                  </p>
                </td>
              </tr>
            ) : (
              tables.map((table) => {
                const categoryColor =
                  CATEGORY_COLORS[table.category] || CATEGORY_COLORS.SYSTEM;
                const healthStatus = HEALTH_STATUS[table.healthStatus];
                const HealthIcon = healthStatus.icon;
                const isCleaning = cleaningTable === table.name;

                return (
                  <tr
                    key={table.name}
                    className="transition-colors hover:bg-gray-50"
                  >
                    {/* Name */}
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => onViewDetail(table.name)}
                        className="group flex min-w-0 items-center gap-2"
                      >
                        <TruncatedCell
                          className="max-w-[160px] font-medium text-gray-900 group-hover:text-emerald-600"
                          tooltip={`${table.displayName} (${table.name})`}
                        >
                          {table.displayName}
                        </TruncatedCell>
                      </button>
                      <TruncatedCell className="font-mono max-w-[160px] text-xs text-gray-400">
                        {table.name}
                      </TruncatedCell>
                    </td>

                    {/* Category */}
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${categoryColor.bg} ${categoryColor.text}`}
                      >
                        {t(`admin.tables.categories.${table.category}`)}
                      </span>
                    </td>

                    {/* Rows */}
                    <td className="px-4 py-2.5 text-sm text-gray-600">
                      {table.rowCount.toLocaleString()}
                    </td>

                    {/* Size */}
                    <td className="px-4 py-2.5 text-sm font-medium text-gray-900">
                      {table.sizeFormatted}
                    </td>

                    {/* Cleanable */}
                    <td className="px-4 py-2.5">
                      {table.cleanableBytes > 0 ? (
                        <span className="text-sm text-amber-600">
                          {formatBytes(table.cleanableBytes)}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">-</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`rounded-full p-1 ${healthStatus.bg}`}>
                          <HealthIcon
                            className={`h-3.5 w-3.5 ${healthStatus.color}`}
                          />
                        </span>
                        <span
                          className={`text-xs font-medium ${healthStatus.color}`}
                        >
                          {t(`admin.tables.health.${table.healthStatus}`)}
                        </span>
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => onViewDetail(table.name)}
                          className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                          title={t('admin.tables.actions.viewDetails')}
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => onDiagnose(table.name)}
                          className="rounded p-1.5 text-gray-400 hover:bg-amber-50 hover:text-amber-600"
                          title={t('admin.tables.actions.diagnose')}
                        >
                          <Stethoscope className="h-4 w-4" />
                        </button>
                        {table.hasCleanupPolicy && (
                          <button
                            onClick={() => onCleanup(table.name)}
                            disabled={isCleaning}
                            className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                            title={t('admin.tables.actions.cleanup')}
                          >
                            <Trash2
                              className={`h-4 w-4 ${isCleaning ? 'animate-pulse' : ''}`}
                            />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-3">
          <div className="text-sm text-gray-500">
            {t('admin.tables.pagination.showing', {
              from: (page - 1) * pageSize + 1,
              to: Math.min(page * pageSize, total),
              total,
            })}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('admin.tables.pagination.previous')}
            </button>
            <span className="text-sm text-gray-600">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('admin.tables.pagination.next')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper function
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
