'use client';

import React, { useState, useEffect } from 'react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { Loader2, AlertCircle } from 'lucide-react';

import { logger } from '@/lib/utils/logger';
import { ClientDate } from '@/components/common/ClientDate';
interface ImportTask {
  id: string;
  resourceType: string;
  sourceUrl: string;
  status: string;
  itemsProcessed: number;
  itemsSaved: number;
  itemsRejected: number;
  createdAt: string;
  completedAt?: string;
  executionTimeMs?: number;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  PROCESSING: 'bg-blue-100 text-blue-800',
  SUCCESS: 'bg-green-100 text-green-800',
  FAILED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-100 text-gray-800',
};

const STATUS_NAMES: Record<string, string> = {
  PENDING: '待处理',
  PROCESSING: '处理中',
  SUCCESS: '成功',
  FAILED: '失败',
  CANCELLED: '已取消',
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

export function CollectionMonitor() {
  const [tasks, setTasks] = useState<ImportTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 5000); // 每5秒刷新一次
    return () => clearInterval(interval);
  }, []);

  const fetchTasks = async () => {
    try {
      const response = await fetch(`${config.apiUrl}/data-management/tasks`, {
        headers: getAuthHeader(),
      });
      const result = await response.json();
      // Handle wrapped response { success: true, data: [...] }
      const data = result?.data ?? result;
      if (Array.isArray(data)) {
        setTasks(data);
      } else if (data.success && data.data) {
        // Legacy format support
        setTasks(data.data);
      }
    } catch (err) {
      setError('获取采集任务失败');
      logger.error(
        '获取采集任务失败',
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      setLoading(false);
    }
  };

  if (loading && tasks.length === 0) {
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

      {tasks.length === 0 ? (
        <div className="rounded border border-gray-200 p-8 text-center text-gray-500">
          暂无采集任务
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
                  数据源URL
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-600">
                  状态
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-600">
                  处理/保存
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-600">
                  已拒绝
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-600">
                  执行时间
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-600">
                  创建时间
                </th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr
                  key={task.id}
                  className="border-b border-gray-200 hover:bg-gray-50"
                >
                  <td className="px-6 py-4">
                    <span className="inline-block rounded border border-gray-300 bg-white px-2 py-1 text-xs">
                      {RESOURCE_TYPE_NAMES[task.resourceType] ||
                        task.resourceType}
                    </span>
                  </td>
                  <td className="font-mono max-w-xs truncate px-6 py-4 text-xs">
                    {task.sourceUrl.slice(0, 50)}...
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-block rounded px-2 py-1 text-xs font-medium ${
                        STATUS_COLORS[task.status] ||
                        'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {STATUS_NAMES[task.status] || task.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {task.itemsProcessed}/{task.itemsSaved}
                  </td>
                  <td className="px-6 py-4 text-sm text-red-600">
                    {task.itemsRejected}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {task.executionTimeMs
                      ? `${(task.executionTimeMs / 1000).toFixed(2)}s`
                      : '-'}
                  </td>
                  <td className="px-6 py-4 text-right text-xs text-gray-600">
                    <ClientDate date={task.createdAt} format="datetime" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tasks.length > 10 && (
        <p className="text-center text-sm text-gray-500">
          仅显示最近任务，共 {tasks.length} 条记录
        </p>
      )}
    </div>
  );
}
