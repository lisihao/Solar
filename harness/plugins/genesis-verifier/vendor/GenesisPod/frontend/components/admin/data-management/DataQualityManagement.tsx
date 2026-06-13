'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { toast } from '@/stores';
import { AdminModal } from '@/components/admin/shared';
import { ConfirmDialog } from '@/components/ui/dialogs/ConfirmDialog';
import WhitelistManagement from '@/components/admin/WhitelistManagement';
import {
  AlertCircle,
  AlertTriangle,
  Compass,
  Download,
  ExternalLink,
  Filter,
  RefreshCw,
  Shield,
  Trash2,
  TrendingUp,
} from 'lucide-react';

interface DataQualityMetric {
  id: string;
  resourceType: string;
  resourceId: string;
  sourceUrl?: string;
  qualityScore: number;
  completenessScore: number;
  relevanceScore: number;
  duplicateScore: number;
  isDuplicate: boolean;
  issues?: string[];
  category?: string;
  reviewStatus: string;
  reviewedAt?: string;
}

interface QualityStats {
  resourceType: string;
  averageQualityScore: number;
  totalItems: number;
  approvedItems: number;
  rejectedItems: number;
  needsReviewItems: number;
  duplicateRate: number;
}

export default function DataQualityManagement() {
  const [metrics, setMetrics] = useState<DataQualityMetric[]>([]);
  const [stats, setStats] = useState<QualityStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string>('');
  const [minQualityScore, setMinQualityScore] = useState(50);
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);
  // 治理工具栏聚合状态
  const [whitelistOpen, setWhitelistOpen] = useState(false);
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [lastCleanup, setLastCleanup] = useState<{
    deleted: number;
    archived: number;
  } | null>(null);

  useEffect(() => {
    fetchQualityData();
  }, []);

  const runBrokenCleanup = useCallback(async () => {
    setCleanupConfirmOpen(false);
    setCleanupRunning(true);
    try {
      const res = await fetch(`${config.apiUrl}/resources/cleanup/broken`, {
        method: 'POST',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = (await res.json()) as
        | { deleted: number; archived: number }
        | { data?: { deleted: number; archived: number } };
      const result =
        (raw as { data?: { deleted: number; archived: number } }).data ??
        (raw as { deleted: number; archived: number });
      setLastCleanup(result);
      toast.success(
        '清理完成',
        `删除 ${result.deleted} 条，归档 ${result.archived} 条（有用户笔记/评论的保留）`
      );
    } catch (e) {
      toast.error('清理失败', (e as Error).message);
    } finally {
      setCleanupRunning(false);
    }
  }, []);

  const fetchQualityData = async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch(
        `${config.apiUrl}/data-management/dashboard/summary`,
        { headers: getAuthHeader() }
      );
      if (!res.ok) {
        throw new Error(
          res.status === 401
            ? 'Unauthorized (session expired — please re-login)'
            : `Failed to fetch quality metrics: HTTP ${res.status}`
        );
      }

      const result = await res.json();
      // Global ResponseTransformInterceptor 包: { success, data: T, metadata }
      // dashboard/summary 当前返回 { totalResources, ... } 不是 statistics[]，未来若加
      // statistics 字段会在此自动接上；Array.isArray 守住运行时崩溃。
      const summaryPayload = result?.data ?? result;
      setStats(
        Array.isArray(summaryPayload?.statistics)
          ? summaryPayload.statistics
          : []
      );

      // Fetch detailed metrics (in a real app, this would be paginated)
      const metricsRes = await fetch(
        `${config.apiUrl}/data-management/quality-metrics`,
        { headers: getAuthHeader() }
      );
      if (metricsRes.ok) {
        const metricsRaw = await metricsRes.json();
        // backend 真值: { data: DataQualityMetric[], stats: {...} }
        // 经 interceptor 包: { success, data: { data: [...], stats: {...} } }
        // 注意 metricsRaw.data 是嵌套 wrapper，metrics 数组在 metricsRaw.data.data
        const metricsPayload = metricsRaw?.data ?? metricsRaw;
        const list = Array.isArray(metricsPayload?.data)
          ? metricsPayload.data
          : Array.isArray(metricsPayload)
            ? metricsPayload
            : [];
        setMetrics(list);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load quality data'
      );
    } finally {
      setLoading(false);
    }
  };

  const filteredMetrics = metrics.filter((m) => {
    if (selectedType && m.resourceType !== selectedType) return false;
    if (m.qualityScore < minQualityScore) return false;
    if (showDuplicatesOnly && !m.isDuplicate) return false;
    return true;
  });

  const getQualityColor = (score: number) => {
    if (score >= 80) return 'bg-green-100 text-green-700';
    if (score >= 60) return 'bg-yellow-100 text-yellow-700';
    return 'bg-red-100 text-red-700';
  };

  const getQualityBgColor = (score: number) => {
    if (score >= 80) return 'bg-green-500';
    if (score >= 60) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <RefreshCw className="mx-auto mb-4 h-8 w-8 animate-spin text-blue-600" />
          <p className="text-gray-600">Loading quality metrics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-8">
      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200/50 bg-red-50/50 p-4 backdrop-blur-sm">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
          <div>
            <h3 className="font-semibold text-red-900">Error</h3>
            <p className="text-sm text-red-800">{error}</p>
          </div>
        </div>
      )}

      {/* Quality Overview Cards */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.resourceType}
            className="rounded-xl border border-gray-200/50 bg-white/70 p-5 shadow-sm backdrop-blur-sm transition-shadow hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-900">
                {stat.resourceType}
              </h3>
              <TrendingUp className="h-4 w-4 text-blue-600" />
            </div>

            <div className="mt-3 space-y-2">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-600">Quality Score</span>
                  <span
                    className={`text-sm font-semibold ${getQualityColor(
                      stat.averageQualityScore
                    )}`}
                  >
                    {stat.averageQualityScore.toFixed(1)}%
                  </span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-gray-200">
                  <div
                    className={`h-2 rounded-full ${getQualityBgColor(
                      stat.averageQualityScore
                    )}`}
                    style={{ width: `${stat.averageQualityScore}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded bg-blue-50 p-2">
                  <span className="font-semibold text-blue-700">
                    {stat.totalItems}
                  </span>
                  <span className="text-blue-600"> items</span>
                </div>
                <div className="rounded bg-green-50 p-2">
                  <span className="font-semibold text-green-700">
                    {stat.approvedItems}
                  </span>
                  <span className="text-green-600"> approved</span>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-2 text-xs text-gray-600">
                <span>
                  {stat.rejectedItems} rejected • {stat.needsReviewItems} review
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 治理操作按钮 (顶部行) — 学用户管理顶部 Add 按钮形态 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200/50 bg-white/70 px-5 py-3 shadow-sm backdrop-blur-sm">
        <div className="text-xs text-gray-500">
          {lastCleanup ? (
            <span>
              上次失效资源清理：删除{' '}
              <span className="font-medium text-red-600">
                {lastCleanup.deleted}
              </span>
              ，归档{' '}
              <span className="font-medium text-amber-600">
                {lastCleanup.archived}
              </span>
            </span>
          ) : (
            <span>
              治理工具：白名单接入、失效资源清理与采集源配置，挂在表上方
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setWhitelistOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
          >
            <Shield className="h-4 w-4" />
            白名单
          </button>
          <button
            type="button"
            onClick={() => setCleanupConfirmOpen(true)}
            disabled={cleanupRunning}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cleanupRunning ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            {cleanupRunning ? '清理中...' : '失效资源清理'}
          </button>
          <Link
            href="/admin/data/collection"
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
          >
            <Compass className="h-4 w-4" />
            采集源
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-gray-200/50 bg-white/70 p-5 shadow-sm backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-semibold text-gray-900">Filters</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600">
              Resource Type
            </label>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="mt-1 rounded-lg border border-gray-300 px-3 py-1 text-sm"
            >
              <option value="">All Types</option>
              {stats.map((s) => (
                <option key={s.resourceType} value={s.resourceType}>
                  {s.resourceType}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600">
              Min Quality Score
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={minQualityScore}
              onChange={(e) => setMinQualityScore(parseInt(e.target.value))}
              className="mt-1 w-32"
            />
            <span className="ml-2 text-sm text-gray-600">
              {minQualityScore}%
            </span>
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showDuplicatesOnly}
              onChange={(e) => setShowDuplicatesOnly(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-600">Duplicates Only</span>
          </label>

          <button
            onClick={() => fetchQualityData()}
            className="ml-auto flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>

          <button className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <Download className="h-4 w-4" />
            Export
          </button>
        </div>
      </div>

      {/* Quality Metrics Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200/50 bg-white/70 shadow-sm backdrop-blur-sm">
        <div className="border-b border-gray-100/50 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600/10">
                <svg
                  className="h-5 w-5 text-blue-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </div>
              <h2 className="font-semibold text-gray-900">Quality Metrics</h2>
            </div>
            <span className="text-xs text-gray-500">
              {filteredMetrics.length} items
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100/50 bg-gray-50/50">
              <tr>
                <th className="px-6 py-3 text-left font-semibold text-gray-900">
                  Resource
                </th>
                <th className="px-6 py-3 text-left font-semibold text-gray-900">
                  Type
                </th>
                <th className="px-6 py-3 text-left font-semibold text-gray-900">
                  Quality
                </th>
                <th className="px-6 py-3 text-left font-semibold text-gray-900">
                  Completeness
                </th>
                <th className="px-6 py-3 text-left font-semibold text-gray-900">
                  Relevance
                </th>
                <th className="px-6 py-3 text-left font-semibold text-gray-900">
                  Status
                </th>
                <th className="px-6 py-3 text-left font-semibold text-gray-900">
                  Issues
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredMetrics.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <svg
                        className="h-8 w-8 text-gray-300"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                        />
                      </svg>
                      <span className="text-sm text-gray-500">
                        No items found
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredMetrics.slice(0, 20).map((metric, idx) => (
                  <tr
                    key={metric.id}
                    className={`border-b border-gray-100/50 ${idx % 2 === 0 ? 'bg-white/50' : 'bg-gray-50/30'} transition-colors hover:bg-blue-50/30`}
                  >
                    <td className="px-6 py-4">
                      {metric.sourceUrl ? (
                        <a
                          href={metric.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block max-w-xs truncate text-blue-600 hover:underline"
                        >
                          {metric.sourceUrl.substring(0, 40)}...
                        </a>
                      ) : (
                        <span className="text-gray-500">-</span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-gray-700">
                      {metric.resourceType}
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-16 rounded-full bg-gray-200">
                          <div
                            className={`h-2 rounded-full ${getQualityBgColor(metric.qualityScore)}`}
                            style={{ width: `${metric.qualityScore}%` }}
                          />
                        </div>
                        <span
                          className={`font-semibold ${getQualityColor(metric.qualityScore)}`}
                        >
                          {metric.qualityScore}%
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-3">
                      <span className="text-gray-700">
                        {metric.completenessScore.toFixed(0)}%
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <span className="text-gray-700">
                        {metric.relevanceScore.toFixed(0)}%
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                          metric.reviewStatus === 'APPROVED'
                            ? 'bg-green-100 text-green-800'
                            : metric.reviewStatus === 'REJECTED'
                              ? 'bg-red-100 text-red-800'
                              : metric.reviewStatus === 'NEEDS_REVIEW'
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {metric.reviewStatus}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      {metric.isDuplicate && (
                        <span className="inline-flex rounded-full bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-800">
                          Duplicate
                        </span>
                      )}
                      {metric.issues && metric.issues.length > 0 && (
                        <span className="mt-1 block text-xs text-gray-600">
                          {metric.issues.length} issue
                          {metric.issues.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {filteredMetrics.length > 20 && (
          <div className="border-t border-gray-100/50 bg-gray-50/30 px-6 py-4 text-center text-sm text-gray-600">
            <span className="font-medium">
              Showing 20 of {filteredMetrics.length} items
            </span>
            <span className="mx-2 text-gray-400">•</span>
            <span>Use filters to refine results</span>
          </div>
        )}
      </div>

      <AdminModal
        open={whitelistOpen}
        onClose={() => setWhitelistOpen(false)}
        title="白名单管理"
        description="按资源类型管理允许接入的域名白名单"
        size="xl"
      >
        <div className="p-1">
          <WhitelistManagement />
        </div>
      </AdminModal>

      <ConfirmDialog
        open={cleanupConfirmOpen}
        onClose={() => setCleanupConfirmOpen(false)}
        onConfirm={runBrokenCleanup}
        title="确认清理无效资源？"
        description="无笔记/评论的 BROKEN 资源将被物理删除，有用户数据的改为 ARCHIVED 保留。此操作不可撤销。"
        type="warning"
        confirmText="确认清理"
        loading={cleanupRunning}
      />

      {cleanupRunning && (
        <div className="fixed bottom-4 right-4 inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-amber-700 shadow-md">
          <AlertTriangle className="h-4 w-4" />
          失效资源清理中...
        </div>
      )}
    </div>
  );
}
