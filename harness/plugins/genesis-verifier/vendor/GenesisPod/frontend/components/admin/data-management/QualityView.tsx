'use client';

import React, { useState } from 'react';
import { CheckCircle, AlertCircle, Trash2 } from 'lucide-react';
import { ClientDate } from '@/components/common/ClientDate';

type ResourceType = 'PAPER' | 'BLOG' | 'REPORT' | 'YOUTUBE_VIDEO' | 'NEWS';

interface QualityItem {
  id: string;
  title: string;
  url: string;
  qualityScore: number;
  isDuplicate: boolean;
  needsReview: boolean;
  createdAt: string;
}

const MOCK_QUALITY_ITEMS: QualityItem[] = [
  {
    id: '1',
    title: '机器学习基础概念',
    url: 'https://example.com/paper1',
    qualityScore: 4.5,
    isDuplicate: false,
    needsReview: false,
    createdAt: '2024-11-19',
  },
  {
    id: '2',
    title: '深度学习应用',
    url: 'https://example.com/paper2',
    qualityScore: 2.8,
    isDuplicate: true,
    needsReview: true,
    createdAt: '2024-11-18',
  },
];

export function QualityView({ resourceType }: { resourceType: ResourceType }) {
  const [items] = useState<QualityItem[]>(MOCK_QUALITY_ITEMS);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const toggleSelect = (id: string) => {
    setSelectedIds(
      selectedIds.includes(id)
        ? selectedIds.filter((s) => s !== id)
        : [...selectedIds, id]
    );
  };

  const getQualityColor = (score: number) => {
    if (score >= 4) return 'text-green-600 bg-green-50';
    if (score >= 3) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  };

  const stats = {
    total: items.length,
    duplicates: items.filter((i) => i.isDuplicate).length,
    needsReview: items.filter((i) => i.needsReview).length,
    avgScore: (
      items.reduce((sum, i) => sum + i.qualityScore, 0) / items.length
    ).toFixed(2),
  };

  return (
    <div className="space-y-6">
      {/* 统计卡片 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-600">
            总数
          </p>
          <p className="mt-2 text-2xl font-bold text-gray-900">{stats.total}</p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-600">
            平均质量评分
          </p>
          <p className="mt-2 text-2xl font-bold text-blue-600">
            {stats.avgScore}/5
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-600">
            重复项
          </p>
          <p className="mt-2 text-2xl font-bold text-orange-600">
            {stats.duplicates}
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-600">
            需审核
          </p>
          <p className="mt-2 text-2xl font-bold text-red-600">
            {stats.needsReview}
          </p>
        </div>
      </div>

      {/* 质量列表 */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">数据项目</h3>
          {selectedIds.length > 0 && (
            <button className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-100">
              <Trash2 className="h-4 w-4" />
              删除选中 ({selectedIds.length})
            </button>
          )}
        </div>

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="divide-y divide-gray-200">
            {items.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-gray-500">
                <p>暂无数据</p>
              </div>
            ) : (
              items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-4 p-4 transition-colors hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(item.id)}
                    onChange={() => toggleSelect(item.id)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />

                  <div className="min-w-0 flex-1">
                    <h5 className="truncate font-medium text-gray-900">
                      {item.title}
                    </h5>
                    <p className="mt-1 truncate text-xs text-gray-500">
                      {item.url}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      <ClientDate date={item.createdAt} format="date" />
                    </p>
                  </div>

                  <div className="flex flex-shrink-0 items-center gap-3">
                    {/* 质量评分 */}
                    <div
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${getQualityColor(item.qualityScore)}`}
                    >
                      {item.qualityScore}/5
                    </div>

                    {/* 状态标记 */}
                    <div className="flex gap-1">
                      {item.isDuplicate && (
                        <span className="inline-flex rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-800">
                          重复
                        </span>
                      )}
                      {item.needsReview && (
                        <span className="inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
                          待审
                        </span>
                      )}
                      {!item.isDuplicate && !item.needsReview && (
                        <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                          已核准
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
