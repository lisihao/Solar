'use client';

import {
  X,
  Database,
  Key,
  Link,
  HardDrive,
  Table2,
  FileCode,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import type { TableDetail } from '@/hooks/domain';

interface TableDetailModalProps {
  table: TableDetail | null;
  loading: boolean;
  open: boolean;
  onClose: () => void;
}

export default function TableDetailModal({
  table,
  loading,
  open,
  onClose,
}: TableDetailModalProps) {
  const { t } = useTranslation();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 mx-4 max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {table?.displayName || t('admin.tables.detail.title')}
            </h2>
            {table?.name && (
              <p className="font-mono text-sm text-gray-500">{table.name}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[calc(90vh-80px)] overflow-y-auto px-6 py-6">
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-emerald-600" />
            </div>
          ) : table ? (
            <div className="space-y-6">
              {/* Stats Row */}
              <div className="grid grid-cols-4 gap-4">
                <StatCard
                  icon={Table2}
                  label={t('admin.tables.detail.rows')}
                  value={table.rowCount.toLocaleString()}
                />
                <StatCard
                  icon={HardDrive}
                  label={t('admin.tables.detail.totalSize')}
                  value={table.sizeFormatted}
                />
                <StatCard
                  icon={Database}
                  label={t('admin.tables.detail.dataSize')}
                  value={formatBytes(table.dataSizeBytes)}
                />
                <StatCard
                  icon={FileCode}
                  label={t('admin.tables.detail.indexSize')}
                  value={formatBytes(table.indexSizeBytes)}
                />
              </div>

              {/* Schema Section */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-gray-900">
                  {t('admin.tables.detail.schema')}
                </h3>
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                          {t('admin.tables.detail.column')}
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                          {t('admin.tables.detail.type')}
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                          {t('admin.tables.detail.nullable')}
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                          {t('admin.tables.detail.key')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {table.schema.map((col) => (
                        <tr key={col.name} className="hover:bg-gray-50">
                          <td className="px-3 py-2">
                            <span className="font-mono text-sm text-gray-900">
                              {col.name}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className="font-mono text-xs text-gray-600">
                              {col.type}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`text-xs ${col.nullable ? 'text-gray-400' : 'text-amber-600'}`}
                            >
                              {col.nullable ? 'YES' : 'NOT NULL'}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              {col.isPrimaryKey && (
                                <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                                  <Key className="h-3 w-3" />
                                  PK
                                </span>
                              )}
                              {col.isForeignKey && (
                                <span className="inline-flex items-center gap-0.5 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">
                                  <Link className="h-3 w-3" />
                                  FK
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Related Tables */}
              {table.relatedTables.length > 0 && (
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-gray-900">
                    {t('admin.tables.detail.relatedTables')}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {table.relatedTables.map((relTable) => (
                      <span
                        key={relTable}
                        className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700"
                      >
                        <Link className="h-3 w-3" />
                        {relTable}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Sample Data */}
              {table.sampleData.length > 0 && (
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-gray-900">
                    {t('admin.tables.detail.sampleData')} (
                    {table.sampleData.length})
                  </h3>
                  <div className="overflow-hidden rounded-lg border border-gray-200">
                    <div className="max-h-64 overflow-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="sticky top-0 bg-gray-50">
                          <tr>
                            {Object.keys(table.sampleData[0])
                              .slice(0, 6)
                              .map((key) => (
                                <th
                                  key={key}
                                  className="px-3 py-2 text-left text-xs font-semibold text-gray-600"
                                >
                                  {key}
                                </th>
                              ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                          {table.sampleData.map((row, i) => (
                            <tr key={i} className="hover:bg-gray-50">
                              {Object.values(row)
                                .slice(0, 6)
                                .map((value, j) => (
                                  <td key={j} className="px-3 py-2">
                                    <span className="font-mono block max-w-[200px] truncate text-xs text-gray-600">
                                      {formatValue(value)}
                                    </span>
                                  </td>
                                ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* Cleanup Policy */}
              {table.cleanupPolicy && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <h3 className="mb-2 text-sm font-semibold text-amber-900">
                    {t('admin.tables.detail.cleanupPolicy')}
                  </h3>
                  <p className="text-sm text-amber-700">
                    {table.cleanupPolicy.description ||
                      `${table.cleanupPolicy.type} based cleanup`}
                  </p>
                  {table.cleanableRows > 0 && (
                    <p className="mt-2 text-sm text-amber-600">
                      {t('admin.tables.detail.cleanableEstimate', {
                        rows: table.cleanableRows.toLocaleString(),
                        size: formatBytes(table.cleanableBytes),
                      })}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center text-gray-500">
              {t('admin.tables.detail.notFound')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Stat card component
function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-gray-400" />
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className="mt-1 text-lg font-semibold text-gray-900">{value}</p>
    </div>
  );
}

// Helper functions
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[object]';
    }
  }
  return String(value);
}
