'use client';

import React, { useState, useEffect } from 'react';
import { config } from '@/lib/utils/config';
import { Loader2, AlertCircle } from 'lucide-react';

import { logger } from '@/lib/utils/logger';
import { ClientDate } from '@/components/common/ClientDate';
interface DataQualityMetric {
  id: string;
  resourceType: string;
  resourceId: string;
  qualityScore: number;
  isDuplicate: boolean;
  reviewStatus: string;
  createdAt: string;
}

const REVIEW_STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  NEEDS_REVIEW: 'bg-orange-100 text-orange-800',
};

const REVIEW_STATUS_NAMES: Record<string, string> = {
  PENDING: '待审核',
  APPROVED: '已批准',
  REJECTED: '已拒绝',
  NEEDS_REVIEW: '需审核',
};

const RESOURCE_TYPE_NAMES: Record<string, string> = {
  PAPER: '学术论文',
  PROJECT: '开源项目',
  NEWS: '科技新闻',
  YOUTUBE_VIDEO: 'YouTube视频',
  RSS: 'RSS订阅',
  REPORT: '行业报告',
  EVENT: '技术活动',
};

export function DataQualityManager() {
  const [metrics, setMetrics] = useState<DataQualityMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({
    totalItems: 0,
    duplicates: 0,
    avgQuality: 0,
    needsReview: 0,
  });

  useEffect(() => {
    fetchMetrics();
  }, []);

  const fetchMetrics = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `${config.apiUrl}/data-management/quality-metrics`
      );
      const result = await response.json();
      // Handle wrapped response { success: true, data: [...] }
      const data = result?.data ?? result;
      if (Array.isArray(data)) {
        setMetrics(data);
        calculateStats(data);
      } else if (data.success && data.data) {
        // Legacy format support
        setMetrics(data.data);
        calculateStats(data.data);
      }
    } catch (err) {
      setError('获取质量指标失败');
      logger.error(
        '获取质量指标失败',
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (items: DataQualityMetric[]) => {
    if (items.length === 0) {
      setStats({ totalItems: 0, duplicates: 0, avgQuality: 0, needsReview: 0 });
      return;
    }

    const duplicates = items.filter((m) => m.isDuplicate).length;
    const avgQuality =
      items.reduce((sum, m) => sum + m.qualityScore, 0) / items.length;
    const needsReview = items.filter(
      (m) => m.reviewStatus === 'NEEDS_REVIEW'
    ).length;

    setStats({
      totalItems: items.length,
      duplicates,
      avgQuality: Math.round(avgQuality * 100) / 100,
      needsReview,
    });
  };

  if (loading && metrics.length === 0) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded bg-red-50 p-4">
          <div className="flex gap-3">
            <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-700" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        </div>
      )}

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-gray-200 p-4">
          <h4 className="text-sm font-medium text-gray-600">总项目数</h4>
          <div className="mt-2 text-2xl font-bold">{stats.totalItems}</div>
        </div>

        <div className="rounded-lg border border-gray-200 p-4">
          <h4 className="text-sm font-medium text-gray-600">重复项目</h4>
          <div className="mt-2 text-2xl font-bold text-red-600">
            {stats.duplicates}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {stats.totalItems > 0
              ? ((stats.duplicates / stats.totalItems) * 100).toFixed(1)
              : 0}
            %
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 p-4">
          <h4 className="text-sm font-medium text-gray-600">平均质量分</h4>
          <div className="mt-2 text-2xl font-bold">{stats.avgQuality}</div>
          <div className="mt-2 h-1 w-full rounded bg-gray-200">
            <div
              className="h-1 rounded bg-blue-600"
              style={{ width: `${stats.avgQuality}%` }}
            />
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 p-4">
          <h4 className="text-sm font-medium text-gray-600">待审核项</h4>
          <div className="mt-2 text-2xl font-bold text-orange-600">
            {stats.needsReview}
          </div>
          <p className="mt-1 text-xs text-gray-500">需要手动审核</p>
        </div>
      </div>

      {/* 质量详情表 */}
      {metrics.length === 0 ? (
        <div className="rounded-lg border border-gray-200 p-8 text-center text-gray-500">
          暂无数据质量记录
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-600">
                  资源类型
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-600">
                  资源ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-600">
                  质量分数
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-600">
                  重复标记
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-600">
                  审核状态
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-600">
                  创建时间
                </th>
              </tr>
            </thead>
            <tbody>
              {metrics.slice(0, 10).map((metric) => (
                <tr
                  key={metric.id}
                  className="border-b border-gray-200 hover:bg-gray-50"
                >
                  <td className="px-6 py-4">
                    <span className="inline-block rounded border border-gray-300 bg-white px-2 py-1 text-xs">
                      {RESOURCE_TYPE_NAMES[metric.resourceType] ||
                        metric.resourceType}
                    </span>
                  </td>
                  <td className="font-mono max-w-xs truncate px-6 py-4 text-xs">
                    {metric.resourceId.slice(0, 8)}...
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-16 rounded bg-gray-200">
                        <div
                          className="h-2 rounded bg-blue-600"
                          style={{ width: `${metric.qualityScore}%` }}
                        />
                      </div>
                      <span className="text-sm">{metric.qualityScore}%</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-block rounded px-2 py-1 text-xs font-medium ${
                        metric.isDuplicate
                          ? 'bg-red-100 text-red-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {metric.isDuplicate ? '重复' : '原创'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-block rounded px-2 py-1 text-xs font-medium ${
                        REVIEW_STATUS_COLORS[metric.reviewStatus] ||
                        'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {REVIEW_STATUS_NAMES[metric.reviewStatus] ||
                        metric.reviewStatus}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right text-xs text-gray-600">
                    <ClientDate date={metric.createdAt} format="datetime" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {metrics.length > 10 && (
        <p className="text-center text-sm text-gray-500">
          仅显示最近10条，共 {metrics.length} 条记录
        </p>
      )}
    </div>
  );
}
