'use client';

import { useState, useMemo } from 'react';
import {
  format,
  startOfDay,
  endOfDay,
  subDays,
  subWeeks,
  subMonths,
} from 'date-fns';

interface Resource {
  id: string;
  type: 'PAPER' | 'PROJECT' | 'NEWS' | 'YOUTUBE_VIDEO';
  title: string;
  createdAt: Date;
  metadata?: {
    authors?: string[];
    tags?: string[];
    views?: number;
  };
}

interface TimelineViewProps {
  resources: Resource[];
}

type TimeRange = 'today' | 'week' | 'month' | 'all';

export default function TimelineView({ resources }: TimelineViewProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('week');
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());

  // 过滤和分组逻辑
  const filteredResources = useMemo(() => {
    let filtered = resources;

    // 时间过滤
    const now = new Date();
    const rangeStart = {
      today: startOfDay(now),
      week: subDays(now, 7),
      month: subMonths(now, 1),
      all: new Date(0),
    }[timeRange];

    filtered = filtered.filter((r) => new Date(r.createdAt) >= rangeStart);

    // 类型过滤
    if (selectedTypes.size > 0) {
      filtered = filtered.filter((r) => selectedTypes.has(r.type));
    }

    return filtered;
  }, [resources, timeRange, selectedTypes]);

  // 按日期分组
  const groupedByDate = useMemo(() => {
    const groups: Map<string, Resource[]> = new Map();

    filteredResources.forEach((resource) => {
      const dateKey = format(new Date(resource.createdAt), 'yyyy-MM-dd');
      if (!groups.has(dateKey)) {
        groups.set(dateKey, []);
      }
      groups.get(dateKey)!.push(resource);
    });

    return Array.from(groups.entries())
      .sort(([a], [b]) => b.localeCompare(a)) // 降序
      .map(([date, items]) => ({ date, items }));
  }, [filteredResources]);

  const resourceTypeIcons = {
    PAPER: '📄',
    PROJECT: '💻',
    NEWS: '📰',
    YOUTUBE_VIDEO: '🎥',
  };

  const resourceTypeColors = {
    PAPER: 'bg-blue-100 text-blue-800 border-blue-300',
    PROJECT: 'bg-green-100 text-green-800 border-green-300',
    NEWS: 'bg-orange-100 text-orange-800 border-orange-300',
    YOUTUBE_VIDEO: 'bg-red-100 text-red-800 border-red-300',
  };

  const toggleType = (type: string) => {
    const newSet = new Set(selectedTypes);
    if (newSet.has(type)) {
      newSet.delete(type);
    } else {
      newSet.add(type);
    }
    setSelectedTypes(newSet);
  };

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* 顶部工具栏 */}
      <div className="border-b border-gray-200 bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">📅 时间线视图</h1>

          <div className="flex items-center gap-4">
            {/* 时间范围选择 */}
            <div className="flex gap-2 rounded-lg bg-gray-100 p-1">
              {(['today', 'week', 'month', 'all'] as TimeRange[]).map(
                (range) => (
                  <button
                    key={range}
                    onClick={() => setTimeRange(range)}
                    className={`rounded-md px-4 py-2 text-sm font-medium transition-all ${
                      timeRange === range
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {
                      {
                        today: '今天',
                        week: '本周',
                        month: '本月',
                        all: '全部',
                      }[range]
                    }
                  </button>
                )
              )}
            </div>

            {/* 资源类型过滤 */}
            <div className="flex gap-2">
              {(['PAPER', 'PROJECT', 'NEWS', 'YOUTUBE_VIDEO'] as const).map(
                (type) => (
                  <button
                    key={type}
                    onClick={() => toggleType(type)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                      selectedTypes.has(type) || selectedTypes.size === 0
                        ? resourceTypeColors[type]
                        : 'border-gray-300 bg-white text-gray-400'
                    }`}
                  >
                    <span>{resourceTypeIcons[type]}</span>
                    <span>
                      {
                        {
                          PAPER: '论文',
                          PROJECT: '项目',
                          NEWS: '新闻',
                          YOUTUBE_VIDEO: '视频',
                        }[type]
                      }
                    </span>
                  </button>
                )
              )}
            </div>
          </div>
        </div>

        {/* 统计信息 */}
        <div className="mt-4 flex gap-6 text-sm text-gray-600">
          <div>
            总计:{' '}
            <span className="font-semibold text-gray-900">
              {filteredResources.length}
            </span>{' '}
            个资源
          </div>
          <div>
            时间跨度:{' '}
            <span className="font-semibold text-gray-900">
              {groupedByDate.length}
            </span>{' '}
            天
          </div>
        </div>
      </div>

      {/* 时间线内容 */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-4xl">
          {groupedByDate.length === 0 ? (
            <div className="flex h-64 items-center justify-center">
              <div className="text-center">
                <svg
                  className="mx-auto h-16 w-16 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                  />
                </svg>
                <p className="mt-4 text-sm text-gray-500">
                  当前时间范围内没有资源
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              {groupedByDate.map(({ date, items }) => (
                <div key={date} className="relative">
                  {/* 日期标签 */}
                  <div className="sticky top-0 z-10 mb-4 flex items-center gap-4 bg-gray-50 py-2">
                    <div className="flex-shrink-0 rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 px-4 py-2 text-white shadow-md">
                      <div className="text-xs font-medium">
                        {format(new Date(date), 'MMM')}
                      </div>
                      <div className="text-2xl font-bold">
                        {format(new Date(date), 'dd')}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-gray-900">
                        {format(new Date(date), 'EEEE')}
                      </div>
                      <div className="text-xs text-gray-500">
                        {items.length} 个资源
                      </div>
                    </div>
                  </div>

                  {/* 资源列表 */}
                  <div className="space-y-3 pl-8">
                    {items.map((resource) => (
                      <div
                        key={resource.id}
                        className="group relative cursor-pointer rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:border-purple-300 hover:shadow-md"
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={`flex-shrink-0 rounded-lg border px-3 py-1 text-2xl ${resourceTypeColors[resource.type]}`}
                          >
                            {resourceTypeIcons[resource.type]}
                          </div>
                          <div className="flex-1">
                            <h3 className="font-semibold text-gray-900 group-hover:text-purple-600">
                              {resource.title}
                            </h3>
                            <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
                              <span>
                                {format(new Date(resource.createdAt), 'HH:mm')}
                              </span>
                              {resource.metadata?.authors && (
                                <span>• {resource.metadata.authors[0]}</span>
                              )}
                              {resource.metadata?.tags && (
                                <span>
                                  •{' '}
                                  {resource.metadata.tags
                                    .slice(0, 2)
                                    .join(', ')}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
