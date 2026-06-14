'use client';

/**
 * Reference Panel Component
 *
 * v7.0 参考文献面板:
 * - 分组筛选（按维度/来源/时间）
 * - 跳转原文链接
 * - 跳转报告引用位置
 */

import { useState, useMemo, useCallback } from 'react';
import type { TopicEvidence, TopicDimension } from '@/lib/types/topic-insights';
import { recalculateCredibilityScores } from '@/services/topic-insights/api';
import { ClientDate } from '@/components/common/ClientDate';
import { useI18n } from '@/lib/i18n';

import { logger } from '@/lib/utils/logger';
import { LoadingState } from '@/components/ui/states';
type FilterType = 'all' | 'dimension' | 'source' | 'time';
type SortType = 'time' | 'credibility' | 'dimension';

interface ReferencePanelProps {
  evidence: TopicEvidence[];
  dimensions?: TopicDimension[];
  isLoading?: boolean;
  onNavigateToReport?: (evidenceId: string) => void;
  // ★ 新增：用于重新计算可信度
  topicId?: string;
  reportId?: string;
  onRecalculateComplete?: () => void;
}

// Source type display names
const sourceTypeLabels: Record<string, string> = {
  web: '网页',
  arxiv: '学术论文',
  scholar: '学术文献',
  github: 'GitHub',
  hackernews: 'Hacker News',
  news: '新闻',
  local_policy: '政策文件',
  local_report: '本地报告',
};

// Icons
const ExternalLinkIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
    />
  </svg>
);

const DocumentIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
    />
  </svg>
);

const FilterIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
    />
  </svg>
);

const BookOpenIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
    />
  </svg>
);

const RefreshIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
    />
  </svg>
);

// Credibility level display
// ★ 修复：后端存储 0-100 的百分比，不是 0-1 的小数
function getCredibilityDisplay(
  score: number | null,
  t: (key: string, params?: Record<string, string | number>) => string
): {
  label: string;
  color: string;
  percentage: string;
} {
  if (score === null || score === undefined)
    return {
      label: t('topicResearch.contentPanel.notEvaluated'),
      color: 'text-gray-400',
      percentage: '',
    };
  // 后端使用 0-100 scale (70+高可信, 40-70中可信, <40低可信)
  if (score >= 70)
    return {
      label: t('topicResearch.contentPanel.highCredibility'),
      color: 'text-green-600',
      percentage: `${score}%`,
    };
  if (score >= 40)
    return {
      label: t('topicResearch.contentPanel.mediumCredibility'),
      color: 'text-yellow-600',
      percentage: `${score}%`,
    };
  return {
    label: t('topicResearch.contentPanel.lowCredibility'),
    color: 'text-red-600',
    percentage: `${score}%`,
  };
}

export function ReferencePanel({
  evidence,
  dimensions = [],
  isLoading = false,
  onNavigateToReport,
  topicId,
  reportId,
  onRecalculateComplete,
}: ReferencePanelProps) {
  const { t } = useI18n();
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [filterValue, setFilterValue] = useState<string>('');
  const [sortBy, setSortBy] = useState<SortType>('time');
  const [searchQuery, setSearchQuery] = useState('');
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [recalculateResult, setRecalculateResult] = useState<{
    updated: number;
    avgScore: number;
  } | null>(null);

  // ★ 安全处理：确保 evidence 是数组
  const safeEvidence = Array.isArray(evidence) ? evidence : [];

  // Get unique source types
  const sourceTypes = useMemo(() => {
    const types = new Set<string>();
    safeEvidence.forEach((e) => {
      if (e.sourceType) types.add(e.sourceType);
    });
    return Array.from(types);
  }, [safeEvidence]);

  // Filter and sort evidence
  const filteredEvidence = useMemo(() => {
    let result = [...safeEvidence];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.title?.toLowerCase().includes(query) ||
          e.url?.toLowerCase().includes(query) ||
          e.snippet?.toLowerCase().includes(query)
      );
    }

    // Apply type filter
    if (filterType === 'dimension' && filterValue) {
      // Note: dimensionId is not in TopicEvidence type, filter by reportId as fallback
      result = result.filter((e) => e.reportId === filterValue);
    } else if (filterType === 'source' && filterValue) {
      result = result.filter((e) => e.sourceType === filterValue);
    } else if (filterType === 'time' && filterValue) {
      const now = new Date();
      const days = parseInt(filterValue, 10);
      const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      result = result.filter((e) => {
        const date = e.publishedAt
          ? new Date(e.publishedAt)
          : new Date(e.createdAt);
        return date >= cutoff;
      });
    }

    // Apply sorting
    result.sort((a, b) => {
      if (sortBy === 'time') {
        const dateA = a.publishedAt
          ? new Date(a.publishedAt)
          : new Date(a.createdAt);
        const dateB = b.publishedAt
          ? new Date(b.publishedAt)
          : new Date(b.createdAt);
        return dateB.getTime() - dateA.getTime();
      } else if (sortBy === 'credibility') {
        return (b.credibilityScore || 0) - (a.credibilityScore || 0);
      } else if (sortBy === 'dimension') {
        return (a.reportId || '').localeCompare(b.reportId || '');
      }
      return 0;
    });

    return result;
  }, [evidence, searchQuery, filterType, filterValue, sortBy]);

  // Handle navigate to report
  const handleNavigateToReport = useCallback(
    (evidenceId: string) => {
      onNavigateToReport?.(evidenceId);
    },
    [onNavigateToReport]
  );

  // ★ 处理重新计算可信度
  const handleRecalculateCredibility = useCallback(async () => {
    if (!topicId || !reportId || isRecalculating) return;

    setIsRecalculating(true);
    setRecalculateResult(null);

    try {
      const result = await recalculateCredibilityScores(topicId, reportId);
      setRecalculateResult(result);
      // 通知父组件刷新数据
      onRecalculateComplete?.();
    } catch (error) {
      logger.error('Failed to recalculate credibility scores:', error);
    } finally {
      setIsRecalculating(false);
    }
  }, [topicId, reportId, isRecalculating, onRecalculateComplete]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingState text="加载参考文献..." />
      </div>
    );
  }

  if (evidence.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <BookOpenIcon className="h-12 w-12 text-gray-300" />
        <p className="mt-3 text-gray-500">暂无参考文献</p>
        <p className="mt-1 text-sm text-gray-400">
          研究完成后将在此显示引用来源
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header with filters */}
      <div className="border-b border-gray-200 bg-white p-4">
        {/* Search */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索参考文献..."
            className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-100"
          />
          <svg
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>

        {/* Filter and sort controls */}
        <div className="mt-3 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <FilterIcon className="h-4 w-4 text-gray-400" />
            <select
              value={filterType}
              onChange={(e) => {
                setFilterType(e.target.value as FilterType);
                setFilterValue('');
              }}
              className="rounded border border-gray-200 bg-white py-1 pl-2 pr-6 text-sm text-gray-900 focus:border-blue-400 focus:outline-none"
            >
              <option value="all">
                {t('topicResearch.contentPanel.filterAll')}
              </option>
              <option value="dimension">
                {t('topicResearch.contentPanel.filterByDimension')}
              </option>
              <option value="source">
                {t('topicResearch.contentPanel.filterBySource')}
              </option>
              <option value="time">
                {t('topicResearch.contentPanel.filterByTime')}
              </option>
            </select>

            {filterType === 'dimension' && dimensions.length > 0 && (
              <select
                value={filterValue}
                onChange={(e) => setFilterValue(e.target.value)}
                className="rounded border border-gray-200 bg-white py-1 pl-2 pr-6 text-sm text-gray-900 focus:border-blue-400 focus:outline-none"
              >
                <option value="">选择维度</option>
                {dimensions.map((dim) => (
                  <option key={dim.id} value={dim.id}>
                    {dim.name}
                  </option>
                ))}
              </select>
            )}

            {filterType === 'source' && sourceTypes.length > 0 && (
              <select
                value={filterValue}
                onChange={(e) => setFilterValue(e.target.value)}
                className="rounded border border-gray-200 bg-white py-1 pl-2 pr-6 text-sm text-gray-900 focus:border-blue-400 focus:outline-none"
              >
                <option value="">选择来源</option>
                {sourceTypes.map((type) => (
                  <option key={type} value={type}>
                    {sourceTypeLabels[type] || type}
                  </option>
                ))}
              </select>
            )}

            {filterType === 'time' && (
              <select
                value={filterValue}
                onChange={(e) => setFilterValue(e.target.value)}
                className="rounded border border-gray-200 bg-white py-1 pl-2 pr-6 text-sm text-gray-900 focus:border-blue-400 focus:outline-none"
              >
                <option value="">选择时间</option>
                <option value="7">最近7天</option>
                <option value="30">最近30天</option>
                <option value="90">最近3个月</option>
                <option value="365">最近1年</option>
              </select>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-gray-400">排序:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortType)}
              className="rounded border border-gray-200 bg-white py-1 pl-2 pr-6 text-sm text-gray-900 focus:border-blue-400 focus:outline-none"
            >
              <option value="time">时间</option>
              <option value="credibility">可信度</option>
              <option value="dimension">维度</option>
            </select>
          </div>
        </div>

        {/* Results count and recalculate button */}
        <div className="mt-2 flex items-center justify-between">
          <p className="text-xs text-gray-500">
            共 {filteredEvidence.length} 条参考文献
            {searchQuery && ` (搜索: "${searchQuery}")`}
          </p>

          {/* ★ 重新计算可信度按钮 */}
          {topicId && reportId && (
            <button
              onClick={handleRecalculateCredibility}
              disabled={isRecalculating}
              className="flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 transition-colors hover:border-blue-400 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
              title="重新计算所有证据的可信度评分"
            >
              <RefreshIcon
                className={`h-3.5 w-3.5 ${isRecalculating ? 'animate-spin' : ''}`}
              />
              {isRecalculating ? '计算中...' : '重算可信度'}
            </button>
          )}
        </div>

        {/* ★ 重新计算结果提示 */}
        {recalculateResult && (
          <div className="mt-2 rounded-md bg-green-50 px-3 py-2 text-xs text-green-700">
            ✓ 已更新 {recalculateResult.updated} 条证据的可信度，平均分:{' '}
            {recalculateResult.avgScore}%
          </div>
        )}
      </div>

      {/* Evidence list */}
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-3">
          {filteredEvidence.map((item) => {
            const credibility = getCredibilityDisplay(item.credibilityScore, t);

            return (
              <div
                key={item.id}
                className="rounded-lg border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h4 className="line-clamp-2 font-medium text-gray-900">
                      {item.title || '无标题'}
                    </h4>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      {/* Source type */}
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">
                        {sourceTypeLabels[item.sourceType || ''] ||
                          item.sourceType ||
                          '未知'}
                      </span>
                      {/* Domain */}
                      {item.domain && (
                        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-600">
                          {item.domain}
                        </span>
                      )}
                      {/* Credibility */}
                      <span className={credibility.color}>
                        {credibility.percentage || credibility.label}
                      </span>
                      {/* Date */}
                      <ClientDate
                        date={item.publishedAt || item.createdAt}
                        format="date"
                        className="text-gray-400"
                      />
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                        title={t('topicResearch.contentPanel.openOriginal')}
                      >
                        <ExternalLinkIcon className="h-4 w-4" />
                      </a>
                    )}
                    {onNavigateToReport && (
                      <button
                        onClick={() => handleNavigateToReport(item.id)}
                        className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                        title="跳转到报告引用"
                      >
                        <DocumentIcon className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Snippet */}
                {item.snippet && (
                  <p className="mt-2 line-clamp-3 text-sm text-gray-600">
                    {item.snippet}
                  </p>
                )}

                {/* Source URL */}
                {item.url && (
                  <p className="mt-2 truncate text-xs text-gray-400">
                    {item.url}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
