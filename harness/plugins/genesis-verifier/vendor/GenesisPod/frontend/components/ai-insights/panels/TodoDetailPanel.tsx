/**
 * TodoDetailPanel - TODO 详情面板
 *
 * 显示选中 TODO 的详细信息和 Agent 思考过程
 */

'use client';

import * as React from 'react';
import { useState, useEffect, useMemo } from 'react';
import {
  X,
  Clock,
  User,
  Brain,
  ChevronDown,
  ChevronUp,
  FileText,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Database,
  Search,
  Globe,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  Lightbulb,
} from 'lucide-react';
import { Button } from '@/components/ui/primitives/button';
import { EmptyState } from '@/components/ui/states/EmptyState';
import {
  getTodoDetails,
  getTaskActivities,
} from '@/services/topic-insights/api';
import { ClientDate } from '@/components/common/ClientDate';
import { ReviewResultCard } from '../collaboration/ReviewResultCard';
import { useI18n } from '@/lib/i18n';
import type {
  DimensionReviewResult,
  OverallReviewResult,
} from '../collaboration/ReviewResultCard';
import type {
  ResearchTodo,
  ResearchTodoStatus,
  ResearchTodoType,
  TodoResult,
} from '@/lib/types/topic-insights';
import type { AgentActivity } from '@/services/topic-insights/api';
import { cn, safeString } from '@/lib/utils/common';

import { logger } from '@/lib/utils/logger';

// 搜索结果类型
interface SearchResultsMetadata {
  total?: number;
  filtered?: number;
  searchTool?: string;
  query?: string;
  searchedAt?: string;
  freshnessInfo?: {
    newestDate?: string;
    oldestDate?: string;
    avgAgeInDays?: number;
  };
  // ★ 知识库搜索信息（用于溯源）
  knowledgeBaseInfo?: {
    enabled: boolean;
    knowledgeBaseIds?: string[];
    matchedCount: number;
    avgSimilarity?: number;
  };
  sources?: Array<{
    title: string;
    url: string;
    domain?: string;
    sourceType?: string;
    credibilityScore?: number;
    relevanceScore?: number;
    publishedDate?: string;
    // ★ 知识库来源标记
    isKnowledgeBase?: boolean;
    similarity?: number;
    documentId?: string;
  }>;
}

// ★ 工具类型映射
const TOOL_ICONS: Record<string, string> = {
  'web-search': '🔍',
  'knowledge-base': '📚',
  hackernews: '📰',
  'rag-search': '📚',
  'federal-register': '📜',
  'congress-gov': '⚖️',
  'whitehouse-news': '🏛️',
  'academic-search': '🎓',
  'data-analysis': '📊',
  web: '🌐',
  news: '📰',
  academic: '🎓',
};

const TOOL_NAMES: Record<string, string> = {
  'web-search': '网络搜索',
  'knowledge-base': '知识库',
  hackernews: 'HackerNews',
  'rag-search': '知识库',
  'federal-register': '联邦公报',
  'congress-gov': '国会立法',
  'whitehouse-news': '白宫新闻',
  'academic-search': '学术搜索',
  'data-analysis': '数据分析',
  web: '网页',
  news: '新闻',
  academic: '学术',
};

// ★ 工具使用摘要组件 - 提供快速概览
function ToolUsageSummary({ sr }: { sr: SearchResultsMetadata }) {
  // 统计各工具的结果数量
  // ★ 优化: 使用更稳定的依赖，避免频繁重新计算
  const sourcesLength = sr.sources?.length ?? 0;
  const searchTool = sr.searchTool;
  const total = sr.total;

  const toolStats = useMemo(() => {
    const stats: Record<string, number> = {};

    // 从来源中统计
    if (Array.isArray(sr.sources)) {
      sr.sources.forEach((source) => {
        if (source.isKnowledgeBase) {
          stats['knowledge-base'] = (stats['knowledge-base'] || 0) + 1;
        } else {
          const tool = source.sourceType || 'web';
          stats[tool] = (stats[tool] || 0) + 1;
        }
      });
    }

    // 确保主搜索工具被显示（仅当 sources 中没有该工具时）
    if (searchTool && !stats[searchTool] && total) {
      const totalFromSources = Object.values(stats).reduce(
        (sum, count) => sum + count,
        0
      );
      const missing = total - totalFromSources;
      if (missing > 0) {
        stats[searchTool] = missing;
      }
    }

    return stats;
  }, [sr.sources, sourcesLength, searchTool, total]);

  const hasTools = Object.keys(toolStats).length > 0;
  const hasKnowledgeBase = sr.knowledgeBaseInfo?.enabled;

  if (!hasTools && !hasKnowledgeBase) {
    return null;
  }

  return (
    <div className="rounded-lg border border-blue-100 bg-gradient-to-r from-blue-50 to-purple-50 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-700">
        <Search className="h-3.5 w-3.5" />
        使用工具
      </div>

      <div className="flex flex-wrap gap-2">
        {/* 主搜索工具 */}
        {Object.entries(toolStats).map(([tool, count]) => (
          <div
            key={tool}
            className={cn(
              'flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium',
              tool === 'knowledge-base'
                ? 'bg-purple-100 text-purple-700'
                : 'bg-blue-100 text-blue-700'
            )}
          >
            <span>{TOOL_ICONS[tool] || '🔧'}</span>
            <span>{TOOL_NAMES[tool] || tool}</span>
            <span className="rounded bg-white/60 px-1.5 py-0.5">{count}条</span>
          </div>
        ))}

        {/* 知识库特殊显示（如果有匹配但不在 sources 中） */}
        {hasKnowledgeBase &&
          sr.knowledgeBaseInfo!.matchedCount > 0 &&
          !toolStats['knowledge-base'] && (
            <div className="flex items-center gap-1 rounded-full bg-purple-100 px-2.5 py-1 text-xs font-medium text-purple-700">
              <span>📚</span>
              <span>知识库</span>
              <span className="rounded bg-white/60 px-1.5 py-0.5">
                {sr.knowledgeBaseInfo!.matchedCount}条
              </span>
              {sr.knowledgeBaseInfo!.avgSimilarity && (
                <span className="text-purple-500">
                  ({(sr.knowledgeBaseInfo!.avgSimilarity * 100).toFixed(0)}%)
                </span>
              )}
            </div>
          )}
      </div>

      {/* 时效性一行摘要 */}
      {sr.freshnessInfo && (
        <div className="mt-2 flex items-center gap-2 text-xs text-gray-600">
          <Clock className="h-3 w-3" />
          <span>数据时效:</span>
          {sr.freshnessInfo.avgAgeInDays !== undefined && (
            <span
              className={cn(
                'rounded px-1.5 py-0.5',
                (sr.freshnessInfo.avgAgeInDays ?? 999) <= 30
                  ? 'bg-green-100 text-green-700'
                  : (sr.freshnessInfo.avgAgeInDays ?? 999) <= 180
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-gray-100 text-gray-600'
              )}
            >
              平均 {sr.freshnessInfo.avgAgeInDays} 天前
            </span>
          )}
          {sr.freshnessInfo.newestDate && (
            <span className="text-green-600">
              最新:{' '}
              <ClientDate date={sr.freshnessInfo.newestDate} format="date" />
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ★ WebSocket事件类型
interface WsEvent {
  type: string;
  data: unknown;
  timestamp: string;
}

interface TodoDetailPanelProps {
  topicId: string;
  todoId: string;
  /** 直接传入的 TODO 数据（来自 missionStatus.tasks 转换），避免 API 调用 */
  initialTodo?: ResearchTodo;
  onClose: () => void;
  className?: string;
  /** ★ WebSocket事件，用于实时进度同步 */
  wsEvents?: WsEvent[];
}

// ★ 搜索结果详情展示组件
function SearchResultsDisplay({ sr }: { sr: SearchResultsMetadata }) {
  const [showAllSources, setShowAllSources] = useState(false);
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-blue-50 p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-blue-700">
        <Database className="h-4 w-4" />
        搜索结果详情
      </div>

      {/* 基本统计 */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded bg-blue-100 px-2 py-1 text-blue-700">
          找到 {safeString(sr.total)} 条
        </span>
        {sr.filtered && sr.filtered !== sr.total && (
          <span className="rounded bg-green-100 px-2 py-1 text-green-700">
            筛选 {safeString(sr.filtered)} 条
          </span>
        )}
      </div>

      {/* 搜索工具 */}
      {sr.searchTool && (
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <Search className="h-3 w-3" />
          <span>搜索工具:</span>
          <span className="rounded bg-purple-100 px-1.5 py-0.5 text-purple-700">
            {sr.searchTool}
          </span>
        </div>
      )}

      {/* 搜索查询 */}
      {sr.query && (
        <div className="text-xs text-gray-600">
          <span className="font-medium">查询:</span>{' '}
          <span className="italic">&quot;{sr.query}&quot;</span>
        </div>
      )}

      {/* 时效性信息 */}
      {sr.freshnessInfo && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
          <Clock className="h-3 w-3" />
          {sr.freshnessInfo.avgAgeInDays !== undefined && (
            <span
              className={cn(
                'rounded px-1.5 py-0.5',
                (sr.freshnessInfo.avgAgeInDays ?? 999) <= 30
                  ? 'bg-green-100 text-green-700'
                  : (sr.freshnessInfo.avgAgeInDays ?? 999) <= 180
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-gray-100 text-gray-600'
              )}
            >
              平均 {sr.freshnessInfo.avgAgeInDays} 天前
            </span>
          )}
          {sr.freshnessInfo.newestDate && (
            <span className="text-green-600">
              最新:{' '}
              <ClientDate date={sr.freshnessInfo.newestDate} format="date" />
            </span>
          )}
        </div>
      )}

      {/* ★ 知识库使用信息 */}
      {sr.knowledgeBaseInfo?.enabled && (
        <div className="flex flex-wrap items-center gap-2 rounded bg-purple-50 p-2 text-xs">
          <Database className="h-3 w-3 text-purple-600" />
          <span className="font-medium text-purple-700">知识库已启用</span>
          {sr.knowledgeBaseInfo.matchedCount > 0 ? (
            <>
              <span className="rounded bg-purple-100 px-1.5 py-0.5 text-purple-700">
                匹配 {sr.knowledgeBaseInfo.matchedCount} 条
              </span>
              {sr.knowledgeBaseInfo.avgSimilarity !== undefined && (
                <span className="text-purple-600">
                  相似度:{' '}
                  {(sr.knowledgeBaseInfo.avgSimilarity * 100).toFixed(1)}%
                </span>
              )}
            </>
          ) : (
            <span className="text-gray-500">未匹配到结果</span>
          )}
        </div>
      )}

      {/* 来源列表 */}
      {Array.isArray(sr.sources) && sr.sources.length > 0 && (
        <div className="mt-2 space-y-1">
          <div className="flex items-center gap-1 text-xs font-medium text-gray-600">
            <Globe className="h-3 w-3" />
            来源 ({sr.sources.length})
          </div>
          <div
            className={cn(
              'space-y-1 overflow-y-auto',
              showAllSources ? 'max-h-96' : 'max-h-32'
            )}
          >
            {(showAllSources ? sr.sources : sr.sources.slice(0, 5)).map(
              (source, idx) => (
                <a
                  key={idx}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    'flex items-start gap-1 rounded p-1.5 text-xs hover:bg-gray-50',
                    source.isKnowledgeBase ? 'bg-purple-50' : 'bg-white'
                  )}
                >
                  <ExternalLink
                    className={cn(
                      'mt-0.5 h-3 w-3 flex-shrink-0',
                      source.isKnowledgeBase
                        ? 'text-purple-500'
                        : 'text-blue-500'
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="truncate font-medium text-gray-700">
                        {source.title}
                      </span>
                      {source.isKnowledgeBase && (
                        <span className="flex-shrink-0 rounded bg-purple-100 px-1 py-0.5 text-[10px] text-purple-600">
                          知识库
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {source.domain && (
                        <span className="text-gray-400">{source.domain}</span>
                      )}
                      {source.relevanceScore != null && (
                        <span
                          className={cn(
                            'rounded px-1 py-0.5 text-[10px]',
                            source.relevanceScore >= 60
                              ? 'bg-green-100 text-green-700'
                              : source.relevanceScore >= 30
                                ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-gray-100 text-gray-500'
                          )}
                        >
                          相关 {source.relevanceScore}
                        </span>
                      )}
                      {source.credibilityScore != null && (
                        <span
                          className={cn(
                            'rounded px-1 py-0.5 text-[10px]',
                            source.credibilityScore >= 70
                              ? 'bg-blue-100 text-blue-700'
                              : source.credibilityScore >= 50
                                ? 'bg-gray-100 text-gray-600'
                                : 'bg-gray-100 text-gray-400'
                          )}
                        >
                          可信 {source.credibilityScore}
                        </span>
                      )}
                      {source.similarity !== undefined && (
                        <span className="text-purple-500">
                          相似度: {(source.similarity * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </div>
                </a>
              )
            )}
            {sr.sources.length > 5 && (
              <button
                type="button"
                onClick={() => setShowAllSources(!showAllSources)}
                className="w-full text-center text-xs text-blue-500 hover:text-blue-700 hover:underline"
              >
                {showAllSources
                  ? '收起'
                  : `展开全部 ${sr.sources.length} 条来源`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_KEYS: Record<ResearchTodoStatus, string> = {
  PENDING: 'pending',
  QUEUED: 'queued',
  IN_PROGRESS: 'inProgress',
  REVIEWING: 'reviewing',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

const STATUS_COLORS: Record<ResearchTodoStatus, string> = {
  PENDING: 'text-gray-500',
  QUEUED: 'text-blue-500',
  IN_PROGRESS: 'text-blue-600',
  REVIEWING: 'text-purple-600',
  PAUSED: 'text-orange-500',
  COMPLETED: 'text-green-600',
  FAILED: 'text-red-600',
  CANCELLED: 'text-gray-400',
};

// ★ 质量审核结果类型检测
function isQualityReviewResult(result: TodoResult): result is TodoResult & {
  dimensionReviews: NonNullable<TodoResult['dimensionReviews']>;
} {
  return Array.isArray((result as Record<string, unknown>).dimensionReviews);
}

// ★ 质量等级配色
const QUALITY_LEVEL_STYLES: Record<
  string,
  { text: string; bg: string; label: string }
> = {
  excellent: {
    text: 'text-emerald-700',
    bg: 'bg-emerald-100',
    label: '优秀',
  },
  good: { text: 'text-blue-700', bg: 'bg-blue-100', label: '良好' },
  acceptable: {
    text: 'text-yellow-700',
    bg: 'bg-yellow-100',
    label: '合格',
  },
  needs_revision: {
    text: 'text-orange-700',
    bg: 'bg-orange-100',
    label: '需修改',
  },
  rejected: { text: 'text-red-700', bg: 'bg-red-100', label: '不通过' },
};

function getScoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-600';
  if (score >= 60) return 'text-blue-600';
  if (score >= 40) return 'text-yellow-600';
  return 'text-red-600';
}

function getScoreBarColor(score: number): string {
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 60) return 'bg-blue-500';
  if (score >= 40) return 'bg-yellow-500';
  return 'bg-red-500';
}

// ★ 质量审核结果专用展示组件
function QualityReviewResultDisplay({
  result,
}: {
  result: TodoResult & {
    dimensionReviews: NonNullable<TodoResult['dimensionReviews']>;
  };
}) {
  const overallReview = result.overallReview;
  const qualityStyle =
    QUALITY_LEVEL_STYLES[overallReview?.qualityLevel || ''] ||
    QUALITY_LEVEL_STYLES.acceptable;

  return (
    <div className="space-y-3">
      {/* 总体评价 */}
      {overallReview && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-green-600" />
            <span
              className={cn(
                'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                qualityStyle.bg,
                qualityStyle.text
              )}
            >
              {qualityStyle.label}
            </span>
          </div>
          <span
            className={cn(
              'text-xl font-bold',
              getScoreColor(overallReview.score)
            )}
          >
            {Math.round(overallReview.score)}
            <span className="text-sm font-normal text-gray-400">/100</span>
          </span>
        </div>
      )}

      {/* 已审核维度数 */}
      <div className="rounded-md bg-blue-50 px-2 py-1 text-sm">
        <span className="text-blue-600">
          已审核 {safeString(result.reviewedTasks)} 个维度
        </span>
      </div>

      {/* 各维度评分 */}
      {result.dimensionReviews.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-gray-500">维度评分</div>
          <div className="space-y-2">
            {result.dimensionReviews.map((dim, idx) => {
              const dimStyle =
                QUALITY_LEVEL_STYLES[dim.qualityLevel] ||
                QUALITY_LEVEL_STYLES.acceptable;
              return (
                <div
                  key={idx}
                  className="rounded-lg border border-gray-200 bg-white p-2.5"
                >
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">
                      {dim.dimensionName}
                    </span>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-xs font-medium',
                          dimStyle.bg,
                          dimStyle.text
                        )}
                      >
                        {dimStyle.label}
                      </span>
                      <span
                        className={cn(
                          'text-sm font-bold',
                          getScoreColor(dim.score)
                        )}
                      >
                        {dim.score}
                      </span>
                    </div>
                  </div>
                  {/* 分数条 */}
                  <div className="mb-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        getScoreBarColor(dim.score)
                      )}
                      style={{ width: `${dim.score}%` }}
                    />
                  </div>
                  {/* 问题数 + 建议 */}
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    {dim.issues > 0 && (
                      <span className="flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 text-orange-500" />
                        {dim.issues} 个问题
                      </span>
                    )}
                    {dim.suggestions && dim.suggestions.length > 0 && (
                      <span className="flex items-center gap-1">
                        <Lightbulb className="h-3 w-3 text-yellow-500" />
                        {dim.suggestions.length} 条建议
                      </span>
                    )}
                  </div>
                  {/* 建议详情 */}
                  {dim.suggestions && dim.suggestions.length > 0 && (
                    <div className="mt-1.5 space-y-1">
                      {dim.suggestions.map((sug, si) => (
                        <div
                          key={si}
                          className="flex items-start gap-1 text-xs text-gray-600"
                        >
                          <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-yellow-500" />
                          <span>{sug}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 总体建议 */}
      {overallReview?.recommendations &&
        overallReview.recommendations.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-gray-500">改进建议</div>
            {overallReview.recommendations.map((rec, idx) => (
              <div
                key={idx}
                className="flex items-start gap-1.5 text-xs text-gray-600"
              >
                <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-yellow-500" />
                <span>{rec}</span>
              </div>
            ))}
          </div>
        )}

      {/* 需要重研提示 */}
      {overallReview?.needsReresearch && (
        <div className="flex items-center gap-2 rounded-md bg-orange-100 px-3 py-2">
          <AlertTriangle className="h-4 w-4 text-orange-600" />
          <span className="text-xs text-orange-700">部分维度需要重新研究</span>
        </div>
      )}

      {/* 反馈摘要 */}
      {result.feedback && (
        <p className="text-xs text-gray-500">{result.feedback}</p>
      )}
    </div>
  );
}

export function TodoDetailPanel({
  topicId,
  todoId,
  initialTodo,
  onClose,
  className,
  wsEvents,
}: TodoDetailPanelProps) {
  const { t } = useI18n();
  const [todo, setTodo] = useState<ResearchTodo | null>(initialTodo || null);
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [isLoading, setIsLoading] = useState(!initialTodo);
  const [error, setError] = useState<string | null>(null);
  const [expandedActivities, setExpandedActivities] = useState<Set<string>>(
    new Set()
  );

  // ★ 修复闪烁问题：使用 initialTodo.id 作为依赖，而不是整个对象
  // 整个对象作为依赖会导致每次父组件渲染时 useEffect 都重新执行
  const initialTodoId = initialTodo?.id;
  const initialTodoTopicId = initialTodo?.topicId;

  // ★ 从WebSocket事件中提取实时进度（与左侧面板使用同一数据源）
  const realtimeProgress = useMemo(() => {
    if (!wsEvents || !todo) return undefined;

    let progress: number | undefined;
    const dimensionNameLower = todo.dimensionName?.toLowerCase().trim();

    // 遍历所有事件，获取最新的进度（后面的事件覆盖前面的）
    for (const event of wsEvents) {
      if (
        event.type === 'dimension:research_progress' ||
        event.type === 'task:progress'
      ) {
        const data = event.data as {
          taskId?: string;
          progress?: number;
          dimensionName?: string;
        };

        // 按 taskId 匹配
        if (data.taskId === todoId && typeof data.progress === 'number') {
          progress = data.progress;
        }

        // 按 dimensionName 匹配
        if (
          dimensionNameLower &&
          data.dimensionName?.toLowerCase().trim() === dimensionNameLower &&
          typeof data.progress === 'number'
        ) {
          progress = data.progress;
        }
      }
    }

    return progress;
  }, [wsEvents, todoId, todo?.dimensionName]);

  useEffect(() => {
    // 如果已有 initialTodo，先设置基础数据
    if (initialTodo) {
      setTodo(initialTodo);
    }

    // ★ 根据数据来源选择正确的 API，避免不必要的 404 错误
    // - 来自 apiTodos（真正的 ResearchTodo 记录）：topicId 非空，使用 getTodoDetails
    // - 来自 missionStatus.tasks（ResearchTask 转换）：topicId 为空，使用 getTaskActivities
    const loadDetails = async () => {
      setIsLoading(true);
      setError(null);

      // 判断数据来源：apiTodos 的记录有 topicId，convertedTodos 的 topicId 为空
      const isFromApiTodos = initialTodoTopicId && initialTodoTopicId !== '';

      try {
        if (isFromApiTodos) {
          // 来自 apiTodos（真正的 ResearchTodo），用 getTodoDetails
          const response = await getTodoDetails(topicId, todoId);
          setTodo(response.todo);
          setActivities(response.activities || []);
        } else {
          // 来自 missionStatus.tasks（ResearchTask），用 getTaskActivities
          try {
            const taskResponse = await getTaskActivities(topicId, todoId);
            setActivities(taskResponse.activities || []);
            // 如果没有 initialTodo，用返回的 task 数据
            if (!initialTodoId && taskResponse.task) {
              // ★ 转换 task 数据为 todo 格式
              // 状态映射
              const statusMap: Record<string, string> = {
                COMPLETED: 'COMPLETED',
                EXECUTING: 'IN_PROGRESS',
                FAILED: 'FAILED',
                PENDING: 'PENDING',
              };
              const mappedStatus = (statusMap[
                taskResponse.task.status as string
              ] || 'PENDING') as ResearchTodoStatus;

              // ★ 使用后端同步到 DB 的 progress 值（与列表视图保持一致）
              // 仅在终态时覆盖为 100%
              const taskProgress = (taskResponse.task as { progress?: number })
                .progress;
              let progress = taskProgress || 0;
              if (
                taskResponse.task.status === 'COMPLETED' ||
                taskResponse.task.status === 'FAILED'
              ) {
                progress = 100;
              }

              const task = taskResponse.task as {
                id: string;
                missionId?: string;
                title: string;
                description?: string;
                dimensionName?: string;
                assignedAgent?: string;
                status: string;
                priority?: number;
                createdAt: string;
                updatedAt: string;
                startedAt?: string;
                completedAt?: string;
                result?: TodoResult;
                resultSummary?: string;
              };

              setTodo({
                id: task.id,
                topicId: '',
                missionId: task.missionId || '',
                type: 'DIMENSION_RESEARCH' as ResearchTodoType,
                title: task.title,
                description: task.description,
                dimensionName: task.dimensionName,
                agentName: task.assignedAgent,
                status: mappedStatus,
                progress,
                priority: task.priority || 0,
                dependsOn: [],
                userCanPause: false,
                userCanCancel: false,
                userCanPrioritize: false,
                createdAt: task.createdAt,
                updatedAt: task.updatedAt,
                startedAt: task.startedAt,
                completedAt: task.completedAt,
                result: task.result,
                // ★ 新增：如果失败，从 result.error 或 resultSummary 获取状态消息
                statusMessage:
                  task.status === 'FAILED'
                    ? task.result?.error || task.resultSummary || '任务执行失败'
                    : task.resultSummary,
              });
            }
          } catch (taskErr) {
            // 如果 getTaskActivities 失败，尝试 getTodoDetails 作为后备
            const response = await getTodoDetails(topicId, todoId);
            setTodo(response.todo);
            setActivities(response.activities || []);
          }
        }
      } catch (err) {
        // 所有尝试都失败
        if (!initialTodoId) {
          setError(
            err instanceof Error ? err.message : 'Failed to load details'
          );
        } else {
          logger.warn('Failed to load activities:', err);
        }
      } finally {
        setIsLoading(false);
      }
    };

    void loadDetails();
    // ★ 只依赖 ID，不依赖整个对象，避免无限循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicId, todoId, initialTodoId, initialTodoTopicId]);

  const toggleActivity = (activityId: string) => {
    setExpandedActivities((prev) => {
      const next = new Set(prev);
      if (next.has(activityId)) {
        next.delete(activityId);
      } else {
        next.add(activityId);
      }
      return next;
    });
  };

  const formatTimestamp = (timestamp: string | null | undefined) => {
    if (!timestamp) return '--:--:--';
    return (
      <ClientDate
        date={timestamp}
        format="time"
        timeOptions={{ hour: '2-digit', minute: '2-digit', second: '2-digit' }}
        fallback="--:--:--"
      />
    );
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}秒`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}分${seconds}秒`;
  };

  if (isLoading) {
    return (
      <div
        className={cn(
          'flex h-full items-center justify-center border-l bg-white',
          className
        )}
      >
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !todo) {
    return (
      <div
        className={cn(
          'flex h-full flex-col items-center justify-center border-l bg-white p-6',
          className
        )}
      >
        <AlertCircle className="mb-4 h-10 w-10 text-red-500" />
        <p className="text-sm text-muted-foreground">
          {typeof error === 'string' ? error : '无法加载详情'}
        </p>
        <Button variant="outline" size="sm" onClick={onClose} className="mt-4">
          关闭
        </Button>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full flex-col border-l bg-white', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="truncate pr-4 text-sm font-semibold text-gray-900">
          {todo.title}
        </h3>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {/* Status & Progress */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span
              className={cn('text-sm font-medium', STATUS_COLORS[todo.status])}
            >
              {t(
                `topicResearch.todoDetail.taskStatus.${STATUS_KEYS[todo.status]}`
              )}
            </span>
            {/* ★ 使用实时进度（优先）或todo.progress；已完成任务固定100% */}
            {(() => {
              const effectiveProgress =
                todo.status === 'COMPLETED'
                  ? 100
                  : (realtimeProgress ?? todo.progress);
              return effectiveProgress > 0 && effectiveProgress < 100 ? (
                <span className="text-xs text-muted-foreground">
                  {effectiveProgress}%
                </span>
              ) : null;
            })()}
          </div>

          {/* Progress bar - 使用实时进度；已完成任务不显示 */}
          {(() => {
            const effectiveProgress =
              todo.status === 'COMPLETED'
                ? 100
                : (realtimeProgress ?? todo.progress);
            return effectiveProgress > 0 && effectiveProgress < 100 ? (
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${effectiveProgress}%` }}
                />
              </div>
            ) : null;
          })()}

          {todo.statusMessage && todo.status !== 'FAILED' && (
            <p className="text-xs text-muted-foreground">
              {typeof todo.statusMessage === 'string'
                ? todo.statusMessage
                : '处理中...'}
            </p>
          )}
        </div>

        {/* ★ 失败原因显示 - 专门针对 FAILED 状态的醒目展示 */}
        {todo.status === 'FAILED' && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-red-700">
              <AlertCircle className="h-4 w-4" />
              失败原因
            </div>
            <p className="mt-1 text-sm text-red-600">
              {typeof todo.result?.error === 'string'
                ? todo.result.error
                : typeof todo.statusMessage === 'string'
                  ? todo.statusMessage
                  : '任务执行过程中发生错误，请查看详细日志'}
            </p>
            {typeof todo.result?.error === 'string' &&
              typeof todo.statusMessage === 'string' &&
              todo.result.error !== todo.statusMessage && (
                <p className="mt-1 text-xs text-muted-foreground">
                  详情: {todo.statusMessage}
                </p>
              )}
          </div>
        )}

        {/* Agent Info */}
        {todo.agentName && (
          <div className="flex items-center gap-2 text-sm">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">
              {t('topicResearch.todoDetail.executor')}
            </span>
            <span className="font-medium text-gray-900">{todo.agentName}</span>
            {todo.agentRole && (
              <span className="text-xs text-muted-foreground">
                ({todo.agentRole})
              </span>
            )}
          </div>
        )}

        {/* Time Info */}
        <div className="space-y-1 text-sm">
          {todo.startedAt && (
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">
                {t('topicResearch.todoDetail.startTime')}
              </span>
              <span>{formatTimestamp(todo.startedAt)}</span>
            </div>
          )}
          {todo.completedAt && (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="text-muted-foreground">
                {t('topicResearch.todoDetail.endTime')}
              </span>
              <span>{formatTimestamp(todo.completedAt)}</span>
            </div>
          )}
          {todo.actualMs && (
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">耗时:</span>
              <span>{formatDuration(todo.actualMs)}</span>
            </div>
          )}
        </div>

        {/* Result */}
        {todo.result && (
          <div className="space-y-3 rounded-lg bg-gray-50 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileText className="h-4 w-4" />
              结果
            </div>

            {/* ★ 质量审核结果 — 专用渲染 */}
            {isQualityReviewResult(todo.result) ? (
              <QualityReviewResultDisplay result={todo.result} />
            ) : (
              <>
                {/* Basic stats */}
                <div className="flex flex-wrap gap-3 text-sm">
                  {todo.result.sourcesFound !== undefined && (
                    <div className="rounded-md bg-blue-50 px-2 py-1">
                      <span className="text-blue-600">
                        {safeString(todo.result.sourcesFound)} 条来源
                      </span>
                    </div>
                  )}
                  {todo.result.wordCount !== undefined && (
                    <div className="rounded-md bg-green-50 px-2 py-1">
                      <span className="text-green-600">
                        {safeString(todo.result.wordCount)}{' '}
                        {t('topicResearch.todoDetail.wordUnit')}
                      </span>
                    </div>
                  )}
                  {todo.result.figuresUsed !== undefined &&
                    todo.result.figuresUsed > 0 && (
                      <div className="rounded-md bg-orange-50 px-2 py-1">
                        <span className="text-orange-600">
                          {todo.result.figuresUsed} 张图片
                        </span>
                      </div>
                    )}
                  {/* Show count if keyFindings is array */}
                  {Array.isArray(todo.result.keyFindings) && (
                    <div className="rounded-md bg-purple-50 px-2 py-1">
                      <span className="text-purple-600">
                        {t('topicResearch.todoDetail.keyFindingsCount', {
                          count: todo.result.keyFindings.length,
                        })}
                      </span>
                    </div>
                  )}
                  {typeof todo.result.keyFindings === 'number' && (
                    <div className="rounded-md bg-purple-50 px-2 py-1">
                      <span className="text-purple-600">
                        {t('topicResearch.todoDetail.keyFindingsCount', {
                          count: todo.result.keyFindings,
                        })}
                      </span>
                    </div>
                  )}
                </div>

                {/* Summary */}
                {todo.result.summary &&
                  typeof todo.result.summary === 'string' && (
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-gray-500">
                        {t('topicResearch.todoDetail.summary')}
                      </div>
                      <p className="text-sm text-gray-700">
                        {todo.result.summary}
                      </p>
                    </div>
                  )}

                {/* Key Findings - formatted */}
                {Array.isArray(todo.result.keyFindings) &&
                  todo.result.keyFindings.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-gray-500">
                        {t('topicResearch.todoDetail.keyFindings')}
                      </div>
                      <ul className="space-y-1">
                        {todo.result.keyFindings.map(
                          (
                            finding: {
                              finding?: string;
                              significance?: string;
                            },
                            idx: number
                          ) => (
                            <li
                              key={idx}
                              className="flex items-start gap-2 text-sm"
                            >
                              <span
                                className={cn(
                                  'mt-0.5 shrink-0 rounded px-1 py-0.5 text-xs',
                                  finding.significance === 'high'
                                    ? 'bg-red-100 text-red-700'
                                    : finding.significance === 'low'
                                      ? 'bg-gray-100 text-gray-600'
                                      : 'bg-yellow-100 text-yellow-700'
                                )}
                              >
                                {finding.significance === 'high'
                                  ? t(
                                      'topicResearch.todoDetail.significance.high'
                                    )
                                  : finding.significance === 'low'
                                    ? t(
                                        'topicResearch.todoDetail.significance.low'
                                      )
                                    : t(
                                        'topicResearch.todoDetail.significance.medium'
                                      )}
                              </span>
                              <span className="text-gray-700">
                                {(
                                  finding.finding ||
                                  t('topicResearch.todoDetail.unknownFinding')
                                ).replace(/[（(]\s*\d+\s*字\s*[)）]/g, '')}
                              </span>
                            </li>
                          )
                        )}
                      </ul>
                    </div>
                  )}

                {/* Trends - formatted */}
                {Array.isArray(todo.result.trends) &&
                  todo.result.trends.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-gray-500">
                        {t('topicResearch.todoDetail.trendAnalysis')}
                      </div>
                      <ul className="space-y-1">
                        {todo.result.trends.slice(0, 3).map(
                          (
                            trend: {
                              trend?: string;
                              direction?: string;
                              timeframe?: string;
                            },
                            idx: number
                          ) => (
                            <li key={idx} className="text-sm text-gray-700">
                              <span className="font-medium">{trend.trend}</span>
                              {trend.direction && (
                                <span className="ml-1 text-xs text-muted-foreground">
                                  ({trend.direction}
                                  {trend.timeframe
                                    ? `, ${trend.timeframe}`
                                    : ''}
                                  )
                                </span>
                              )}
                            </li>
                          )
                        )}
                      </ul>
                    </div>
                  )}
              </>
            )}

            {/* Error */}
            {todo.result.error && (
              <p className="text-sm text-red-600">
                {typeof todo.result.error === 'string'
                  ? todo.result.error
                  : t('topicResearch.todoDetail.executionError')}
              </p>
            )}
          </div>
        )}

        {/* Agent Thinking / Activities */}
        {activities.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Brain className="h-4 w-4" />
              {t('topicResearch.todoDetail.agentThinking')}
            </div>

            <div className="space-y-2">
              {activities.map((activity) => {
                const isExpanded = expandedActivities.has(activity.id);
                return (
                  <div
                    key={activity.id}
                    className="overflow-hidden rounded-lg border"
                  >
                    <button
                      onClick={() => toggleActivity(activity.id)}
                      className="flex w-full items-center justify-between p-3 text-left hover:bg-gray-50"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatTimestamp(activity.createdAt)}
                        </span>
                        <span className="truncate text-sm font-medium text-gray-900">
                          {safeString(activity.agentName || activity.agentRole)}
                        </span>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="space-y-2 px-3 pb-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="rounded bg-gray-100 px-1.5 py-0.5">
                            {safeString(activity.activityType)}
                          </span>
                          {activity.phase && (
                            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-600">
                              {safeString(activity.phase)}
                            </span>
                          )}
                          {activity.progress !== undefined && (
                            <span>{safeString(activity.progress)}%</span>
                          )}
                        </div>
                        <p className="whitespace-pre-wrap text-sm text-gray-700">
                          {safeString(activity.content)}
                        </p>
                        {activity.dimensionName && (
                          <div className="text-xs text-muted-foreground">
                            维度: {safeString(activity.dimensionName)}
                          </div>
                        )}

                        {/* ★ 审核结果卡片 */}
                        {activity.actionTaken === 'dimension_review' &&
                          activity.actionResult && (
                            <div className="mt-2">
                              <ReviewResultCard
                                reviewResult={
                                  activity.actionResult as unknown as DimensionReviewResult
                                }
                                type="dimension"
                                dimensionName={activity.dimensionName}
                                compact
                              />
                            </div>
                          )}
                        {activity.actionTaken === 'overall_review' &&
                          activity.actionResult && (
                            <div className="mt-2">
                              <ReviewResultCard
                                reviewResult={
                                  activity.actionResult as unknown as OverallReviewResult
                                }
                                type="overall"
                                compact
                              />
                            </div>
                          )}

                        {/* ★ 工具使用摘要 - 快速概览 */}
                        {/* ★ v8.1 修复：searchResults 是顶层字段，不在 metadata 中 */}
                        {activity.searchResults != null && (
                          <ToolUsageSummary
                            sr={activity.searchResults as SearchResultsMetadata}
                          />
                        )}

                        {/* ★ 搜索结果详情展示 */}
                        {activity.searchResults != null ? (
                          <SearchResultsDisplay
                            sr={activity.searchResults as SearchResultsMetadata}
                          />
                        ) : null}

                        {/* 其他 metadata（排除 searchResults 后显示） */}
                        {activity.metadata &&
                          Object.keys(activity.metadata).filter(
                            (k) => k !== 'searchResults'
                          ).length > 0 && (
                            <details className="text-xs">
                              <summary className="cursor-pointer font-medium text-gray-500 hover:text-gray-700">
                                其他元数据
                              </summary>
                              <pre className="mt-1 overflow-x-auto rounded bg-gray-50 p-2 text-gray-500">
                                {JSON.stringify(
                                  Object.fromEntries(
                                    Object.entries(activity.metadata).filter(
                                      ([k]) => k !== 'searchResults'
                                    )
                                  ),
                                  null,
                                  2
                                )}
                              </pre>
                            </details>
                          )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty state for activities */}
        {activities.length === 0 && (
          <EmptyState
            size="sm"
            icon={<Brain className="h-8 w-8 opacity-50" />}
            title="暂无 Agent 活动记录"
          />
        )}
      </div>
    </div>
  );
}

export default TodoDetailPanel;
