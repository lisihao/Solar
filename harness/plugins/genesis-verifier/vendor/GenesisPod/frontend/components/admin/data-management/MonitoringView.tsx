'use client';

import React from 'react';
import { TrendingUp, Activity, AlertCircle, Clock } from 'lucide-react';

type ResourceType = 'PAPER' | 'BLOG' | 'REPORT' | 'YOUTUBE_VIDEO' | 'NEWS';

interface MonitoringStats {
  successRate: number;
  todayCollected: number;
  duplicates: number;
  lastUpdate: string;
}

const RESOURCE_STATS: Record<ResourceType, MonitoringStats> = {
  PAPER: {
    successRate: 98.5,
    todayCollected: 234,
    duplicates: 45,
    lastUpdate: '2024-11-19 14:30',
  },
  BLOG: {
    successRate: 97.2,
    todayCollected: 45,
    duplicates: 8,
    lastUpdate: '2024-11-19 15:45',
  },
  REPORT: {
    successRate: 99.1,
    todayCollected: 12,
    duplicates: 2,
    lastUpdate: '2024-11-19 13:20',
  },
  YOUTUBE_VIDEO: {
    successRate: 96.8,
    todayCollected: 34,
    duplicates: 15,
    lastUpdate: '2024-11-19 14:00',
  },
  NEWS: {
    successRate: 97.9,
    todayCollected: 156,
    duplicates: 34,
    lastUpdate: '2024-11-19 15:30',
  },
};

export function MonitoringView({
  resourceType,
}: {
  resourceType: ResourceType;
}) {
  const stats = RESOURCE_STATS[resourceType];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* 成功率 */}
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">成功率</p>
              <p className="mt-3 text-3xl font-bold text-green-600">
                {stats.successRate}%
              </p>
            </div>
            <TrendingUp className="h-8 w-8 text-green-500 opacity-50" />
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-green-100">
            <div
              className="h-full bg-green-600"
              style={{ width: `${stats.successRate}%` }}
            />
          </div>
        </div>

        {/* 今日采集 */}
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">今日采集</p>
              <p className="mt-3 text-3xl font-bold text-blue-600">
                {stats.todayCollected}
              </p>
            </div>
            <Activity className="h-8 w-8 text-blue-500 opacity-50" />
          </div>
          <p className="mt-4 text-xs text-gray-500">项目数量</p>
        </div>

        {/* 重复项 */}
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">重复项</p>
              <p className="mt-3 text-3xl font-bold text-orange-600">
                {stats.duplicates}
              </p>
            </div>
            <AlertCircle className="h-8 w-8 text-orange-500 opacity-50" />
          </div>
          <p className="mt-4 text-xs text-gray-500">去重后移除</p>
        </div>

        {/* 最后更新 */}
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">最后更新</p>
              <p className="font-mono mt-3 text-sm text-gray-900">
                {stats.lastUpdate}
              </p>
            </div>
            <Clock className="h-8 w-8 text-gray-500 opacity-50" />
          </div>
          <p className="mt-4 text-xs text-gray-500">系统时间</p>
        </div>
      </div>

      {/* 采集进度概览 */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="mb-6 text-lg font-semibold text-gray-900">
          采集任务统计
        </h3>

        <div className="space-y-4">
          {[
            {
              name: '已完成',
              value: 1234,
              percentage: 85,
              color: 'bg-green-500',
            },
            {
              name: '进行中',
              value: 156,
              percentage: 10,
              color: 'bg-blue-500',
            },
            {
              name: '待处理',
              value: 56,
              percentage: 4,
              color: 'bg-yellow-500',
            },
            {
              name: '失败',
              value: 12,
              percentage: 1,
              color: 'bg-red-500',
            },
          ].map((item, idx) => (
            <div key={idx}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">
                  {item.name}
                </span>
                <span className="text-sm text-gray-600">
                  {item.value} ({item.percentage}%)
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                <div
                  className={`h-full ${item.color}`}
                  style={{ width: `${item.percentage}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 采集健康状态 */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">健康指标</h3>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[
            {
              label: '系统可用性',
              value: 99.9,
              unit: '%',
              color: 'text-green-600',
            },
            {
              label: '平均响应时间',
              value: 245,
              unit: 'ms',
              color: 'text-blue-600',
            },
            {
              label: '错误率',
              value: 0.1,
              unit: '%',
              color: 'text-red-600',
            },
            {
              label: '数据库连接',
              value: 98,
              unit: '%',
              color: 'text-purple-600',
            },
          ].map((metric, idx) => (
            <div key={idx} className="rounded-lg bg-gray-50 p-4">
              <p className="text-xs font-medium text-gray-600">
                {metric.label}
              </p>
              <p className={`mt-2 text-2xl font-bold ${metric.color}`}>
                {metric.value}
                {metric.unit}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
