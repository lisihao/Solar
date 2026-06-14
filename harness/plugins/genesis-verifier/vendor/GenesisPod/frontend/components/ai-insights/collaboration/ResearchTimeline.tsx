/**
 * ResearchTimeline - 研究历史时间线组件
 *
 * Phase 2.3: 可信度与追溯 - 增强版
 *
 * 功能：
 * - 按研究会话分组展示（第N次研究）
 * - 每个会话包含：研究规划、维度研究进展、团队互动、研究成果
 * - 每个研究员支持展开思考阶段时间线
 * - 支持查看历史版本和对比
 */

'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  getResearchHistory,
  getAgentActivities,
  getTeamMessages,
  type ResearchHistoryItem,
  type AgentActivity,
  type TeamMessage,
  type DimensionResult,
} from '@/services/topic-insights/api';
import {
  Calendar,
  Clock,
  Target,
  Layers,
  ChevronDown,
  ChevronRight,
  FileText,
  CheckCircle,
  XCircle,
  AlertTriangle,
  TrendingUp,
  BookOpen,
  ArrowRight,
  Brain,
  Search,
  MessageSquare,
  Users,
  Lightbulb,
  Database,
  Award,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { ClientDate } from '@/components/common/ClientDate';
import { useI18n } from '@/lib/i18n';

import { logger } from '@/lib/utils/logger';
// ==================== Types ====================

export type ResearchStatus =
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'IN_PROGRESS';

export type ThinkingPhase =
  | 'understanding'
  | 'searching'
  | 'writing'
  | 'reviewing'
  | 'integrating';

export type AgentRole = 'leader' | 'researcher' | 'reviewer' | 'synthesizer';

export interface ResearchTimelineProps {
  // 模式1: 传入 topicId，组件自动获取数据
  topicId?: string;
  // 模式2: 直接传入数据
  histories?: ResearchHistoryItem[];
  activities?: AgentActivity[];
  messages?: TeamMessage[];
  currentResearchNumber?: number;
  isLoading?: boolean;
  onSelectResearch?: (history: ResearchHistoryItem) => void;
  onCompareVersions?: (fromVersion: number, toVersion: number) => void;
  onViewReport?: (version: number) => void;
}

// ==================== Helper Functions ====================

// 扩展的 Activity 类型（包含 metadata 中的可选字段）
interface ExtendedAgentActivity extends AgentActivity {
  thinkingPhase?: ThinkingPhase;
  thinkingContent?: string;
  searchResults?: {
    total: number;
    filtered: number;
    searchTool?: string; // 使用的搜索工具 (web, academic, github, etc.)
    query?: string; // 搜索查询
    searchedAt?: string; // 搜索时间
    freshnessInfo?: {
      newestDate?: string;
      oldestDate?: string;
      avgAgeInDays?: number;
    };
    sources: Array<{
      title: string;
      url: string;
      domain?: string;
      sourceType: string;
      publishedDate?: string;
    }>;
  };
  writingProgress?: {
    sections: Array<{
      title: string;
      status: 'pending' | 'writing' | 'reviewing' | 'completed';
      revisions: number;
    }>;
    current?: string;
  };
  durationMs?: number;
}

// ★ 从活动记录中提取扩展字段
// 注意：thinkingPhase, thinkingContent, searchResults 现在是直接字段，不在 metadata 中
function getExtendedActivity(activity: AgentActivity): ExtendedAgentActivity {
  const metadata = activity.metadata || {};
  return {
    ...activity,
    // ★ 修复：优先使用直接字段，兼容旧数据从 metadata 获取
    thinkingPhase: (activity.thinkingPhase || metadata.thinkingPhase) as
      | ThinkingPhase
      | undefined,
    thinkingContent:
      activity.thinkingContent || (metadata.thinkingContent as string),
    searchResults: (activity.searchResults ||
      metadata.searchResults) as ExtendedAgentActivity['searchResults'],
    writingProgress:
      metadata.writingProgress as ExtendedAgentActivity['writingProgress'],
    durationMs: metadata.durationMs as number | undefined,
  };
}

// formatDuration: moved to component level to use i18n

// Status config: moved to component level to use i18n for labels

// Phase config: moved to component level to use i18n for labels

// ==================== Sub Components ====================

/**
 * 检查活动是否有有意义的内容可展示
 */
function hasMeaningfulContent(activity: ExtendedAgentActivity): boolean {
  // 有思考内容
  if (activity.thinkingContent && activity.thinkingContent.trim().length > 0) {
    return true;
  }
  // 有搜索结果
  if (activity.searchResults && activity.searchResults.total > 0) {
    return true;
  }
  // 有撰写进度
  if (
    activity.writingProgress?.sections &&
    activity.writingProgress.sections.length > 0
  ) {
    return true;
  }
  return false;
}

/**
 * 思考阶段时间线（单个研究员的思考过程）
 * ★ 只显示有有意义内容的阶段，跳过空阶段
 */
function ThinkingPhasesTimeline({
  activities,
  t,
  formatDuration,
  phaseConfig,
}: {
  activities: ExtendedAgentActivity[];
  t: (key: string, params?: Record<string, string | number>) => string;
  formatDuration: (ms: number) => string;
  phaseConfig: Record<
    ThinkingPhase,
    { icon: React.ElementType; label: string; color: string }
  >;
}) {
  // ★ 过滤出有有意义内容的活动
  const meaningfulActivities = activities.filter(hasMeaningfulContent);

  if (meaningfulActivities.length === 0) {
    return (
      <div className="text-xs italic text-gray-400">
        {t('topicResearch.collaboration.timeline.thinkingPhases.noProcess')}
      </div>
    );
  }

  return (
    <div className="space-y-2 border-l-2 border-gray-200 pl-3 dark:border-gray-700">
      {meaningfulActivities.map((activity) => {
        const phase = activity.thinkingPhase;
        const phaseInfo = phase ? phaseConfig[phase] : null;
        const Icon = phaseInfo?.icon || Brain;

        return (
          <div key={activity.id} className="relative">
            {/* 时间线节点 */}
            <div
              className={cn(
                'absolute -left-[17px] top-1 h-3 w-3 rounded-full border-2 border-white dark:border-gray-800',
                activity.activityType === 'COMPLETED'
                  ? 'bg-green-500'
                  : activity.activityType === 'FAILED'
                    ? 'bg-red-500'
                    : 'animate-pulse bg-blue-500'
              )}
            />

            {/* 阶段内容 */}
            <div className="rounded-lg bg-gray-50 p-2 text-xs dark:bg-gray-800/50">
              <div className="mb-1 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Icon className={cn('h-3 w-3', phaseInfo?.color)} />
                  <span className="font-medium text-gray-900 dark:text-white">
                    {phaseInfo?.label ||
                      t(
                        'topicResearch.collaboration.timeline.phaseLabels.searching'
                      )}
                  </span>
                </div>
                {activity.durationMs && (
                  <span className="text-gray-500">
                    {formatDuration(activity.durationMs)}
                  </span>
                )}
              </div>

              {/* 思考内容 */}
              {activity.thinkingContent && (
                <div className="mb-1 text-gray-700 dark:text-gray-300">
                  {activity.thinkingContent}
                </div>
              )}

              {/* 搜索结果统计 - 增强版 */}
              {activity.searchResults && activity.searchResults.total > 0 && (
                <div className="mt-1 space-y-1">
                  {/* 搜索工具和查询 */}
                  <div className="flex flex-wrap items-center gap-2 text-gray-500">
                    <Database className="h-3 w-3" />
                    <span>
                      {t(
                        'topicResearch.collaboration.timeline.searchResults.found',
                        {
                          total: activity.searchResults.total,
                        }
                      )}
                      {activity.searchResults.filtered > 0 &&
                        activity.searchResults.filtered <
                          activity.searchResults.total &&
                        t(
                          'topicResearch.collaboration.timeline.searchResults.filtered',
                          {
                            filtered: activity.searchResults.filtered,
                          }
                        )}
                    </span>
                    {activity.searchResults.searchTool && (
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                        {activity.searchResults.searchTool}
                      </span>
                    )}
                  </div>

                  {/* 搜索查询 */}
                  {activity.searchResults.query && (
                    <div className="truncate text-xs italic text-gray-400">
                      {t(
                        'topicResearch.collaboration.timeline.searchResults.query',
                        {
                          query: activity.searchResults.query,
                        }
                      )}
                    </div>
                  )}

                  {/* 时效性信息 */}
                  {activity.searchResults.freshnessInfo && (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                      <Clock className="h-3 w-3" />
                      {activity.searchResults.freshnessInfo.avgAgeInDays !==
                        undefined && (
                        <span>
                          {t(
                            'topicResearch.collaboration.timeline.searchResults.avgAge',
                            {
                              days: activity.searchResults.freshnessInfo
                                .avgAgeInDays,
                            }
                          )}
                        </span>
                      )}
                      {activity.searchResults.freshnessInfo.newestDate &&
                        (() => {
                          try {
                            const d = new Date(
                              activity.searchResults.freshnessInfo.newestDate
                            );
                            if (!isNaN(d.getTime())) {
                              return (
                                <span className="text-green-600 dark:text-green-400">
                                  {t(
                                    'topicResearch.collaboration.timeline.searchResults.newest'
                                  )}{' '}
                                  <ClientDate date={d} format="date" />
                                </span>
                              );
                            }
                          } catch {
                            // 忽略无效日期
                          }
                          return null;
                        })()}
                    </div>
                  )}

                  {/* 来源列表（显示前3个） */}
                  {Array.isArray(activity.searchResults.sources) &&
                    activity.searchResults.sources.length > 0 && (
                      <div className="space-y-0.5">
                        {activity.searchResults.sources
                          .slice(0, 3)
                          .map((source, idx) => (
                            <div
                              key={idx}
                              className="flex items-center gap-1 text-xs text-gray-500"
                            >
                              <span className="text-blue-500">+</span>
                              <span className="truncate">{source.title}</span>
                              {source.domain && (
                                <span className="flex-shrink-0 text-gray-400">
                                  ({source.domain})
                                </span>
                              )}
                            </div>
                          ))}
                        {activity.searchResults.sources.length > 3 && (
                          <div className="text-xs text-gray-400">
                            {t(
                              'topicResearch.collaboration.timeline.searchResults.moreSources',
                              {
                                count:
                                  activity.searchResults.sources.length - 3,
                              }
                            )}
                          </div>
                        )}
                      </div>
                    )}
                </div>
              )}

              {/* 撰写进度 */}
              {activity.writingProgress &&
                Array.isArray(activity.writingProgress.sections) &&
                activity.writingProgress.sections.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {activity.writingProgress.sections.map((section, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-1 text-gray-600 dark:text-gray-400"
                      >
                        <div
                          className={cn(
                            'h-1.5 w-1.5 rounded-full',
                            section.status === 'completed'
                              ? 'bg-green-500'
                              : section.status === 'writing'
                                ? 'bg-yellow-500'
                                : 'bg-gray-300'
                          )}
                        />
                        <span>{section.title}</span>
                        {section.revisions > 0 && (
                          <span className="text-gray-400">
                            {t(
                              'topicResearch.collaboration.timeline.writingProgress.revisions',
                              {
                                count: section.revisions,
                              }
                            )}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 从活动中提取有意义的摘要
 */
function extractMeaningfulSummary(activities: ExtendedAgentActivity[]): {
  sourcesFound: number;
  sourcesFiltered: number;
  keyInsight: string | null;
  sectionsWritten: number;
  searchTools: string[];
  avgFreshness: number | null;
} {
  let sourcesFound = 0;
  let sourcesFiltered = 0;
  let keyInsight: string | null = null;
  let sectionsWritten = 0;
  const searchTools: string[] = [];
  const freshnessValues: number[] = [];

  for (const activity of activities) {
    // 搜索结果统计
    if (activity.searchResults) {
      sourcesFound += activity.searchResults.total || 0;
      sourcesFiltered += activity.searchResults.filtered || 0;

      // 收集搜索工具
      if (
        activity.searchResults.searchTool &&
        !searchTools.includes(activity.searchResults.searchTool)
      ) {
        searchTools.push(activity.searchResults.searchTool);
      }

      // 收集时效性数据
      if (activity.searchResults.freshnessInfo?.avgAgeInDays !== undefined) {
        freshnessValues.push(activity.searchResults.freshnessInfo.avgAgeInDays);
      }
    }

    // 撰写进度
    if (activity.writingProgress?.sections) {
      sectionsWritten += activity.writingProgress.sections.filter(
        (s) => s.status === 'completed'
      ).length;
    }

    // 提取关键洞察（从思考内容中提取第一个有意义的句子）
    if (!keyInsight && activity.thinkingContent) {
      const content = activity.thinkingContent.trim();
      if (content.length > 10 && content.length < 200) {
        keyInsight = content;
      } else if (content.length >= 200) {
        // 截取第一句话
        const firstSentence = content.match(/^[^。！？.!?]+[。！？.!?]/);
        if (firstSentence) {
          keyInsight = firstSentence[0];
        }
      }
    }
  }

  // 计算平均时效性
  const avgFreshness =
    freshnessValues.length > 0
      ? Math.round(
          freshnessValues.reduce((a, b) => a + b, 0) / freshnessValues.length
        )
      : null;

  return {
    sourcesFound,
    sourcesFiltered,
    keyInsight,
    sectionsWritten,
    searchTools,
    avgFreshness,
  };
}

/**
 * 研究员卡片（按维度）- 显示有意义的研究成果摘要
 */
function ResearcherCard({
  dimensionName,
  activities,
  citations,
  t,
  formatDuration,
  phaseConfig,
}: {
  dimensionName: string;
  activities: ExtendedAgentActivity[];
  citations: number;
  t: (key: string, params?: Record<string, string | number>) => string;
  formatDuration: (ms: number) => string;
  phaseConfig: Record<
    ThinkingPhase,
    { icon: React.ElementType; label: string; color: string }
  >;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const completedActivities = activities.filter(
    (a) => a.activityType === 'COMPLETED'
  );
  const status =
    completedActivities.length === activities.length
      ? 'completed'
      : activities.some((a) => a.activityType === 'FAILED')
        ? 'failed'
        : 'in_progress';

  const totalDuration = activities.reduce(
    (sum, a) => sum + (a.durationMs || 0),
    0
  );

  // ★ 提取有意义的摘要信息
  const summary = extractMeaningfulSummary(activities);

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-white dark:bg-gray-800',
        status === 'completed' && 'border-green-200 dark:border-green-800',
        status === 'failed' && 'border-red-200 dark:border-red-800',
        status === 'in_progress' && 'border-blue-200 dark:border-blue-800'
      )}
    >
      {/* 头部 - 显示维度名称和状态 */}
      <div
        className="flex cursor-pointer items-center gap-2 p-2.5"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div
          className={cn(
            'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full',
            status === 'completed' && 'bg-green-100 dark:bg-green-900',
            status === 'failed' && 'bg-red-100 dark:bg-red-900',
            status === 'in_progress' && 'bg-blue-100 dark:bg-blue-900'
          )}
        >
          {status === 'completed' ? (
            <CheckCircle className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
          ) : status === 'failed' ? (
            <XCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
          ) : (
            <Clock className="h-3.5 w-3.5 animate-pulse text-blue-600 dark:text-blue-400" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-gray-900 dark:text-white">
              {dimensionName}
            </span>
            <span
              className={cn(
                'flex-shrink-0 rounded px-1.5 py-0.5 text-xs',
                status === 'completed' &&
                  'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
                status === 'failed' &&
                  'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
                status === 'in_progress' &&
                  'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
              )}
            >
              {status === 'completed'
                ? t(
                    'topicResearch.collaboration.timeline.dimensionResult.completed'
                  )
                : status === 'failed'
                  ? t('topicResearch.collaboration.timeline.status.failed')
                  : t('topicResearch.collaboration.timeline.status.inProgress')}
            </span>
          </div>

          {/* ★ 显示有意义的摘要而非阶段计数 */}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
            {summary.sourcesFound > 0 && (
              <span className="flex items-center gap-0.5">
                <Database className="h-3 w-3" />
                {t(
                  'topicResearch.collaboration.timeline.summary.sourcesFound',
                  {
                    count: summary.sourcesFound,
                  }
                )}
                {summary.sourcesFiltered > 0 &&
                  summary.sourcesFiltered < summary.sourcesFound && (
                    <span className="text-gray-400">
                      {t(
                        'topicResearch.collaboration.timeline.summary.filtered',
                        {
                          filtered: summary.sourcesFiltered,
                        }
                      )}
                    </span>
                  )}
              </span>
            )}
            {/* 显示使用的搜索工具 */}
            {summary.searchTools.length > 0 && (
              <span className="flex items-center gap-0.5">
                <Search className="h-3 w-3" />
                {summary.searchTools.join(', ')}
              </span>
            )}
            {/* 显示时效性 */}
            {summary.avgFreshness !== null && (
              <span
                className={cn(
                  'flex items-center gap-0.5',
                  summary.avgFreshness <= 30
                    ? 'text-green-600 dark:text-green-400'
                    : summary.avgFreshness <= 180
                      ? 'text-yellow-600 dark:text-yellow-400'
                      : 'text-gray-400'
                )}
              >
                <Clock className="h-3 w-3" />
                {t(
                  'topicResearch.collaboration.timeline.summary.avgFreshness',
                  {
                    days: summary.avgFreshness,
                  }
                )}
              </span>
            )}
            {citations > 0 && (
              <span className="flex items-center gap-0.5">
                <Award className="h-3 w-3" />
                {t('topicResearch.collaboration.timeline.summary.citations', {
                  count: citations,
                })}
              </span>
            )}
            {summary.sectionsWritten > 0 && (
              <span className="flex items-center gap-0.5">
                <FileText className="h-3 w-3" />
                {t(
                  'topicResearch.collaboration.timeline.summary.sectionsWritten',
                  {
                    count: summary.sectionsWritten,
                  }
                )}
              </span>
            )}
            {totalDuration > 0 && (
              <span className="flex items-center gap-0.5 text-gray-400">
                <Clock className="h-3 w-3" />
                {formatDuration(totalDuration)}
              </span>
            )}
          </div>

          {/* ★ 显示关键洞察（如果有） */}
          {summary.keyInsight && (
            <div className="mt-1 line-clamp-2 text-xs text-gray-600 dark:text-gray-400">
              <Lightbulb className="mr-1 inline h-3 w-3 text-yellow-500" />
              {summary.keyInsight}
            </div>
          )}
        </div>

        {activities.length > 0 && (
          <ChevronRight
            className={cn(
              'h-4 w-4 flex-shrink-0 text-gray-400 transition-transform',
              isExpanded && 'rotate-90'
            )}
          />
        )}
      </div>

      {/* 展开：详细过程（默认隐藏，仅供需要查看技术细节的用户） */}
      {isExpanded && activities.length > 0 && (
        <div className="border-t border-gray-100 p-2.5 dark:border-gray-700">
          <div className="mb-2 text-xs text-gray-400">
            {t('topicResearch.collaboration.timeline.thinkingPhases.title')}
          </div>
          <ThinkingPhasesTimeline
            activities={activities}
            t={t}
            formatDuration={formatDuration}
            phaseConfig={phaseConfig}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Leader 规划部分
 */
function LeaderPlanSection({
  goal,
  strategy,
  t,
}: {
  goal?: string;
  strategy?: string;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!goal && !strategy) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/30">
      <div
        className="flex cursor-pointer items-center gap-2 p-2.5"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <Target className="h-4 w-4 text-orange-600 dark:text-orange-400" />
        <span className="font-medium text-orange-900 dark:text-orange-200">
          {t('topicResearch.collaboration.timeline.leaderPlan')}
        </span>
        {isExpanded ? (
          <ChevronDown className="ml-auto h-4 w-4 text-orange-600" />
        ) : (
          <ChevronRight className="ml-auto h-4 w-4 text-orange-600" />
        )}
      </div>

      {isExpanded && (
        <div className="space-y-2 border-t border-orange-200 p-2.5 text-sm dark:border-orange-800">
          {goal && (
            <div>
              <div className="mb-1 text-xs font-medium text-orange-700 dark:text-orange-400">
                {t('topicResearch.collaboration.timeline.researchGoal')}
              </div>
              <div className="text-gray-700 dark:text-gray-300">{goal}</div>
            </div>
          )}
          {strategy && (
            <div>
              <div className="mb-1 text-xs font-medium text-orange-700 dark:text-orange-400">
                {t('topicResearch.collaboration.timeline.researchStrategy')}
              </div>
              <div className="text-gray-700 dark:text-gray-300">{strategy}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 维度研究结果卡片 - 显示关键发现和摘要
 */
function DimensionResultCard({
  result,
  t,
}: {
  result: DimensionResult;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { dimensionName, result: dimResult, resultSummary } = result;

  // 提取关键发现
  const keyFindings = Array.isArray(dimResult?.keyFindings)
    ? dimResult.keyFindings
    : [];
  const summary = dimResult?.summary || resultSummary;
  const sourcesFound = dimResult?.sourcesFound;

  return (
    <div className="overflow-hidden rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30">
      <div
        className="flex cursor-pointer items-center gap-2 p-2.5"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <CheckCircle className="h-4 w-4 flex-shrink-0 text-green-600 dark:text-green-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-gray-700 dark:text-gray-300">
              {dimensionName}
            </span>
            <span className="flex-shrink-0 rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300">
              {t(
                'topicResearch.collaboration.timeline.dimensionResult.completed'
              )}
            </span>
          </div>
          {/* 简要信息 */}
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            {keyFindings.length > 0 && (
              <span className="flex items-center gap-0.5">
                <Lightbulb className="h-3 w-3 text-yellow-500" />
                {t(
                  'topicResearch.collaboration.timeline.dimensionResult.keyFindings',
                  {
                    count: keyFindings.length,
                  }
                )}
              </span>
            )}
            {sourcesFound !== undefined && sourcesFound > 0 && (
              <span className="flex items-center gap-0.5">
                <Database className="h-3 w-3" />
                {t(
                  'topicResearch.collaboration.timeline.dimensionResult.sources',
                  {
                    count: sourcesFound,
                  }
                )}
              </span>
            )}
          </div>
        </div>
        {(summary || keyFindings.length > 0) && (
          <ChevronRight
            className={cn(
              'h-4 w-4 flex-shrink-0 text-gray-400 transition-transform',
              isExpanded && 'rotate-90'
            )}
          />
        )}
      </div>

      {/* 展开内容：摘要和关键发现 */}
      {isExpanded && (summary || keyFindings.length > 0) && (
        <div className="space-y-2 border-t border-green-200 p-2.5 dark:border-green-800">
          {/* 摘要 */}
          {summary && (
            <div className="text-xs text-gray-600 dark:text-gray-400">
              <span className="font-medium text-gray-700 dark:text-gray-300">
                {t(
                  'topicResearch.collaboration.timeline.dimensionResult.summary'
                )}
              </span>
              {summary}
            </div>
          )}

          {/* 关键发现列表 */}
          {keyFindings.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {t(
                  'topicResearch.collaboration.timeline.dimensionResult.findingsTitle'
                )}
              </div>
              <ul className="space-y-1">
                {keyFindings.slice(0, 5).map((finding, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-1.5 text-xs text-gray-600 dark:text-gray-400"
                  >
                    <span className="mt-0.5 text-blue-500">+</span>
                    <span>
                      {typeof finding === 'string'
                        ? finding
                        : finding.finding ||
                          t(
                            'topicResearch.collaboration.timeline.dimensionResult.unknownFinding'
                          )}
                    </span>
                  </li>
                ))}
                {keyFindings.length > 5 && (
                  <li className="text-xs text-gray-400">
                    {t(
                      'topicResearch.collaboration.timeline.dimensionResult.moreFindings',
                      {
                        count: keyFindings.length - 5,
                      }
                    )}
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 维度研究进展部分
 * ★ 即使没有详细活动记录，也显示已更新的维度列表和研究结果
 */
function DimensionProgressSection({
  dimensionActivities,
  dimensionsUpdated,
  dimensionResults,
  t,
  formatDuration,
  phaseConfig,
}: {
  dimensionActivities: Map<string, ExtendedAgentActivity[]>;
  dimensionsUpdated: string[];
  dimensionResults?: DimensionResult[];
  t: (key: string, params?: Record<string, string | number>) => string;
  formatDuration: (ms: number) => string;
  phaseConfig: Record<
    ThinkingPhase,
    { icon: React.ElementType; label: string; color: string }
  >;
}) {
  // 如果没有任何数据可显示，不渲染
  const hasDimensionActivities = dimensionActivities.size > 0;
  const hasDimensionResults = dimensionResults && dimensionResults.length > 0;
  const hasDimensionsUpdated = dimensionsUpdated.length > 0;

  if (
    !hasDimensionActivities &&
    !hasDimensionResults &&
    !hasDimensionsUpdated
  ) {
    return null;
  }

  // ★ 计算实际显示的维度数量
  const displayCount =
    dimensionActivities.size > 0
      ? dimensionActivities.size
      : dimensionResults && dimensionResults.length > 0
        ? dimensionResults.length
        : dimensionsUpdated.length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
        <Layers className="h-4 w-4" />
        <span>
          {t('topicResearch.collaboration.timeline.dimensionProgress')}
        </span>
        <span className="text-xs text-gray-500">
          {t('topicResearch.collaboration.timeline.dimensionsUpdatedCount', {
            count: displayCount,
          })}
        </span>
      </div>

      {dimensionActivities.size > 0 ? (
        // 有详细活动记录时显示卡片
        <div className="space-y-2">
          {Array.from(dimensionActivities.entries()).map(
            ([dimensionName, activities]) => (
              <ResearcherCard
                key={dimensionName}
                dimensionName={dimensionName}
                activities={activities}
                citations={0}
                t={t}
                formatDuration={formatDuration}
                phaseConfig={phaseConfig}
              />
            )
          )}
        </div>
      ) : dimensionResults && dimensionResults.length > 0 ? (
        // ★ 有研究结果时，显示带关键发现的卡片
        <div className="space-y-1.5">
          {dimensionResults.map((result, idx) => (
            <DimensionResultCard key={idx} result={result} t={t} />
          ))}
        </div>
      ) : (
        // ★ 没有研究结果时，显示简化的维度列表
        <div className="space-y-1.5">
          {dimensionsUpdated.map((dimName, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-2 dark:border-green-800 dark:bg-green-950/30"
            >
              <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {dimName}
              </span>
              <span className="ml-auto rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300">
                {t(
                  'topicResearch.collaboration.timeline.dimensionResult.completed'
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 团队互动部分
 */
function TeamInteractionSection({
  messages,
  t,
}: {
  messages: TeamMessage[];
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (messages.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-950/30">
      <div
        className="flex cursor-pointer items-center gap-2 p-2.5"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <MessageSquare className="h-4 w-4 text-purple-600 dark:text-purple-400" />
        <span className="font-medium text-purple-900 dark:text-purple-200">
          {t('topicResearch.collaboration.timeline.teamInteraction')}
        </span>
        <span className="ml-auto text-xs text-purple-600">
          {t('topicResearch.collaboration.timeline.messages', {
            count: messages.length,
          })}
        </span>
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-purple-600" />
        ) : (
          <ChevronRight className="h-4 w-4 text-purple-600" />
        )}
      </div>

      {isExpanded && (
        <div className="max-h-48 space-y-1.5 overflow-y-auto border-t border-purple-200 p-2.5 dark:border-purple-800">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className="rounded bg-white p-2 text-xs dark:bg-purple-900/30"
            >
              <div className="mb-0.5 flex items-center gap-1.5 text-purple-700 dark:text-purple-300">
                <Users className="h-3 w-3" />
                <span className="font-medium">{msg.senderName}</span>
                <ClientDate
                  date={msg.createdAt}
                  format="datetime"
                  className="text-gray-500"
                />
              </div>
              <div className="text-gray-700 dark:text-gray-300">
                {msg.content}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 研究成果部分
 */
function OutcomeSection({
  history,
  t,
}: {
  history: ResearchHistoryItem;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const netChange = (history.wordsAdded || 0) - (history.wordsRemoved || 0);
  const dimensionsUpdated = Array.isArray(history.dimensionsUpdated)
    ? history.dimensionsUpdated
    : [];
  const dimensionsKept = Array.isArray(history.dimensionsKept)
    ? history.dimensionsKept
    : [];

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-2.5 dark:border-gray-700 dark:bg-gray-800/50">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
        <TrendingUp className="h-4 w-4" />
        <span>{t('topicResearch.collaboration.timeline.outcome')}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
        <div className="rounded bg-blue-100 p-1.5 dark:bg-blue-900/30">
          <div className="mb-0.5 text-blue-600 dark:text-blue-400">
            {t('topicResearch.collaboration.timeline.updatedDimensions')}
          </div>
          <div className="text-lg font-semibold text-blue-700 dark:text-blue-300">
            {dimensionsUpdated.length}
          </div>
        </div>

        <div className="rounded bg-gray-100 p-1.5 dark:bg-gray-900/30">
          <div className="mb-0.5 text-gray-600 dark:text-gray-400">
            {t('topicResearch.collaboration.timeline.keptDimensions')}
          </div>
          <div className="text-lg font-semibold text-gray-700 dark:text-gray-300">
            {dimensionsKept.length}
          </div>
        </div>

        {(history.wordsAdded > 0 || history.wordsRemoved > 0) && (
          <div
            className={cn(
              'rounded p-1.5',
              netChange >= 0
                ? 'bg-green-100 dark:bg-green-900/30'
                : 'bg-red-100 dark:bg-red-900/30'
            )}
          >
            <div
              className={cn(
                'mb-0.5',
                netChange >= 0
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-red-600 dark:text-red-400'
              )}
            >
              {t('topicResearch.collaboration.timeline.wordChange')}
            </div>
            <div
              className={cn(
                'text-lg font-semibold',
                netChange >= 0
                  ? 'text-green-700 dark:text-green-300'
                  : 'text-red-700 dark:text-red-300'
              )}
            >
              {netChange >= 0 ? '+' : ''}
              {netChange}
            </div>
          </div>
        )}

        {history.newSourcesCount > 0 && (
          <div className="rounded bg-purple-100 p-1.5 dark:bg-purple-900/30">
            <div className="mb-0.5 text-purple-600 dark:text-purple-400">
              {t('topicResearch.collaboration.timeline.newSourcesCount')}
            </div>
            <div className="text-lg font-semibold text-purple-700 dark:text-purple-300">
              {history.newSourcesCount}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 研究会话卡片
 */
function SessionCard({
  history,
  dimensionActivities,
  sessionMessages,
  isCurrent,
  onSelect,
  onCompare,
  onViewReport,
  t,
  formatDuration,
  phaseConfig,
  getStatusConfig,
}: {
  history: ResearchHistoryItem;
  dimensionActivities: Map<string, ExtendedAgentActivity[]>;
  sessionMessages: TeamMessage[];
  isCurrent: boolean;
  onSelect?: () => void;
  onCompare?: () => void;
  onViewReport?: (version: number) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  formatDuration: (ms: number) => string;
  phaseConfig: Record<
    ThinkingPhase,
    { icon: React.ElementType; label: string; color: string }
  >;
  getStatusConfig: (status: string) => {
    icon: React.ElementType;
    label: string;
    color: string;
    borderColor: string;
  };
}) {
  const [isExpanded, setIsExpanded] = useState(isCurrent);
  // ★ 使用安全访问器
  const status = getStatusConfig(history.status);
  const StatusIcon = status.icon;

  return (
    <div className="space-y-3">
      {/* 会话分隔线 */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gray-300 to-transparent dark:via-gray-700" />
        <div
          className={cn(
            'flex items-center gap-2 rounded-full border-2 px-3 py-1 text-sm font-medium',
            status.borderColor,
            isCurrent && 'bg-blue-50 dark:bg-blue-950/30'
          )}
        >
          <StatusIcon className={cn('h-4 w-4', status.color)} />
          <span className="text-gray-900 dark:text-white">
            {t('topicResearch.collaboration.timeline.researchSession', {
              number: history.researchNumber,
            })}
          </span>
          <ClientDate
            date={history.startedAt}
            format="datetime"
            className="text-xs text-gray-500"
          />
          {history.totalDurationMs && (
            <span className="text-xs text-gray-500">
              {t('topicResearch.collaboration.timeline.duration', {
                duration: formatDuration(history.totalDurationMs),
              })}
            </span>
          )}
        </div>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gray-300 to-transparent dark:via-gray-700" />
      </div>

      {/* 会话卡片主体 */}
      <div
        className={cn(
          'overflow-hidden rounded-lg border-2 bg-white dark:bg-gray-800',
          status.borderColor
        )}
      >
        {/* 快速预览头部 */}
        <div
          className="flex cursor-pointer items-center gap-3 p-3"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2 text-sm">
              <span className={cn('font-medium', status.color)}>
                {status.label}
              </span>
              {history.reportVersionAfter && (
                <span className="text-gray-500">
                  {history.reportVersionBefore ? (
                    <>
                      v{history.reportVersionBefore}
                      <ArrowRight className="mx-0.5 inline h-3 w-3" />v
                      {history.reportVersionAfter}
                    </>
                  ) : (
                    t('topicResearch.collaboration.timeline.reportVersion', {
                      version: history.reportVersionAfter,
                    })
                  )}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <Layers className="h-3 w-3" />
                {t('topicResearch.collaboration.timeline.dimensionsUpdated', {
                  count: Array.isArray(history.dimensionsUpdated)
                    ? history.dimensionsUpdated.length
                    : 0,
                })}
              </span>
              {history.newSourcesCount > 0 && (
                <span className="flex items-center gap-1">
                  <Database className="h-3 w-3" />
                  {t('topicResearch.collaboration.timeline.newSources', {
                    count: history.newSourcesCount,
                  })}
                </span>
              )}
              {sessionMessages.length > 0 && (
                <span className="flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" />
                  {t('topicResearch.collaboration.timeline.interactions', {
                    count: sessionMessages.length,
                  })}
                </span>
              )}
            </div>
          </div>

          {isExpanded ? (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronRight className="h-5 w-5 text-gray-400" />
          )}
        </div>

        {/* 展开内容 */}
        {isExpanded && (
          <div className="space-y-3 border-t border-gray-200 p-3 dark:border-gray-700">
            {/* Leader 规划 */}
            <LeaderPlanSection
              goal={history.researchGoal}
              strategy={history.researchStrategy}
              t={t}
            />

            {/* 维度研究进展 */}
            <DimensionProgressSection
              dimensionActivities={dimensionActivities}
              dimensionsUpdated={
                Array.isArray(history.dimensionsUpdated)
                  ? history.dimensionsUpdated
                  : []
              }
              dimensionResults={history.dimensionResults}
              t={t}
              formatDuration={formatDuration}
              phaseConfig={phaseConfig}
            />

            {/* 团队互动 */}
            <TeamInteractionSection messages={sessionMessages} t={t} />

            {/* 研究成果 */}
            <OutcomeSection history={history} t={t} />

            {/* 操作按钮 */}
            <div className="flex flex-wrap items-center gap-2">
              {/* 查看详情按钮 - 点击切换展开/收起 */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsExpanded(!isExpanded);
                  if (onSelect) onSelect();
                }}
                className="flex items-center gap-1 rounded-lg bg-blue-500 px-2.5 py-1.5 text-xs text-white transition-colors hover:bg-blue-600"
              >
                <Target className="h-3.5 w-3.5" />
                {isExpanded
                  ? t('topicResearch.collaboration.timeline.collapseDetails')
                  : t('topicResearch.collaboration.timeline.viewDetails')}
              </button>

              {onViewReport && history.reportVersionAfter && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewReport(history.reportVersionAfter!);
                  }}
                  className="flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  <FileText className="h-3.5 w-3.5" />
                  {t('topicResearch.collaboration.timeline.viewReport', {
                    version: history.reportVersionAfter,
                  })}
                </button>
              )}

              {onCompare &&
                history.reportVersionBefore &&
                history.reportVersionAfter && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCompare();
                    }}
                    className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                  >
                    <TrendingUp className="h-3.5 w-3.5" />
                    {t('topicResearch.collaboration.timeline.compareVersions')}
                  </button>
                )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== Main Component ====================

export function ResearchTimeline({
  topicId,
  histories: propHistories,
  activities: propActivities,
  messages: propMessages,
  currentResearchNumber,
  isLoading: propIsLoading = false,
  onSelectResearch,
  onCompareVersions,
  onViewReport,
}: ResearchTimelineProps) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<'all' | 'current' | 'previous'>('all');

  // Helper function for formatting duration with i18n
  const formatDuration = (ms: number): string => {
    if (ms < 60000) {
      return t('topicResearch.collaboration.timeline.formatDuration.seconds', {
        count: Math.round(ms / 1000),
      });
    }
    if (ms < 3600000) {
      return t('topicResearch.collaboration.timeline.formatDuration.minutes', {
        count: Math.floor(ms / 60000),
      });
    }
    return t('topicResearch.collaboration.timeline.formatDuration.hours', {
      count: Math.floor(ms / 3600000),
      min: Math.floor((ms % 3600000) / 60000),
    });
  };

  // Status config with i18n
  const statusConfig: Record<
    ResearchStatus,
    {
      icon: React.ElementType;
      label: string;
      color: string;
      borderColor: string;
    }
  > = {
    COMPLETED: {
      icon: CheckCircle,
      label: t('topicResearch.collaboration.timeline.status.completed'),
      color: 'text-green-600 dark:text-green-400',
      borderColor: 'border-green-300 dark:border-green-700',
    },
    FAILED: {
      icon: XCircle,
      label: t('topicResearch.collaboration.timeline.status.failed'),
      color: 'text-red-600 dark:text-red-400',
      borderColor: 'border-red-300 dark:border-red-700',
    },
    CANCELLED: {
      icon: AlertTriangle,
      label: t('topicResearch.collaboration.timeline.status.cancelled'),
      color: 'text-yellow-600 dark:text-yellow-400',
      borderColor: 'border-yellow-300 dark:border-yellow-700',
    },
    IN_PROGRESS: {
      icon: Clock,
      label: t('topicResearch.collaboration.timeline.status.inProgress'),
      color: 'text-blue-600 dark:text-blue-400',
      borderColor: 'border-blue-300 dark:border-blue-700 shadow-md',
    },
  };

  const defaultStatusConfig = {
    icon: AlertTriangle,
    label: t('topicResearch.collaboration.timeline.status.unknown'),
    color: 'text-gray-600 dark:text-gray-400',
    borderColor: 'border-gray-300 dark:border-gray-700',
  };

  const getStatusConfig = (status: string) => {
    return statusConfig[status as ResearchStatus] || defaultStatusConfig;
  };

  // Phase config with i18n
  const phaseConfig: Record<
    ThinkingPhase,
    {
      icon: React.ElementType;
      label: string;
      color: string;
    }
  > = {
    understanding: {
      icon: Brain,
      label: t(
        'topicResearch.collaboration.timeline.phaseLabels.understanding'
      ),
      color: 'text-purple-600 dark:text-purple-400',
    },
    searching: {
      icon: Search,
      label: t('topicResearch.collaboration.timeline.phaseLabels.searching'),
      color: 'text-blue-600 dark:text-blue-400',
    },
    writing: {
      icon: FileText,
      label: t('topicResearch.collaboration.timeline.phaseLabels.writing'),
      color: 'text-green-600 dark:text-green-400',
    },
    reviewing: {
      icon: CheckCircle,
      label: t('topicResearch.collaboration.timeline.phaseLabels.reviewing'),
      color: 'text-yellow-600 dark:text-yellow-400',
    },
    integrating: {
      icon: Layers,
      label: t('topicResearch.collaboration.timeline.phaseLabels.integrating'),
      color: 'text-indigo-600 dark:text-indigo-400',
    },
  };

  // 自动获取数据（如果提供了 topicId）
  const [fetchedHistories, setFetchedHistories] = useState<
    ResearchHistoryItem[]
  >([]);
  const [fetchedActivities, setFetchedActivities] = useState<AgentActivity[]>(
    []
  );
  const [fetchedMessages, setFetchedMessages] = useState<TeamMessage[]>([]);
  const [isFetching, setIsFetching] = useState(false);

  useEffect(() => {
    if (!topicId) return;

    // ★ 防止内存泄漏：标记请求是否已取消
    let isCancelled = false;

    const fetchData = async () => {
      setIsFetching(true);
      try {
        const [historiesData, activitiesData, messagesData] = await Promise.all(
          [
            getResearchHistory(topicId),
            getAgentActivities(topicId).catch(() => []),
            getTeamMessages(topicId).catch(() => []),
          ]
        );

        // 只在未取消时更新状态
        if (!isCancelled) {
          setFetchedHistories(historiesData);
          setFetchedActivities(activitiesData);
          setFetchedMessages(messagesData);
        }
      } catch (error) {
        if (!isCancelled) {
          // 仅在开发环境输出详细错误
          if (process.env.NODE_ENV === 'development') {
            logger.error('Failed to fetch research timeline data:', error);
          }
          setFetchedHistories([]);
          setFetchedActivities([]);
          setFetchedMessages([]);
        }
      } finally {
        if (!isCancelled) {
          setIsFetching(false);
        }
      }
    };

    fetchData();

    // ★ 清理函数：组件卸载时取消请求
    return () => {
      isCancelled = true;
    };
  }, [topicId]);

  // 使用传入的数据或获取的数据（★ 安全处理：确保是数组）
  const histories = Array.isArray(propHistories)
    ? propHistories
    : Array.isArray(fetchedHistories)
      ? fetchedHistories
      : [];
  const activities = Array.isArray(propActivities)
    ? propActivities
    : Array.isArray(fetchedActivities)
      ? fetchedActivities
      : [];
  const messages = Array.isArray(propMessages)
    ? propMessages
    : Array.isArray(fetchedMessages)
      ? fetchedMessages
      : [];
  const isLoading = propIsLoading || isFetching;

  // 按研究序号倒序排列
  const sortedHistories = useMemo(() => {
    if (!histories || histories.length === 0) return [];
    return [...histories].sort((a, b) => b.researchNumber - a.researchNumber);
  }, [histories]);

  // 过滤
  const filteredHistories = useMemo(() => {
    return sortedHistories.filter((h) => {
      if (filter === 'current')
        return h.researchNumber === currentResearchNumber;
      if (filter === 'previous')
        return h.researchNumber !== currentResearchNumber;
      return true;
    });
  }, [sortedHistories, filter, currentResearchNumber]);

  // 按会话分组活动和消息
  const sessionData = useMemo(() => {
    if (!filteredHistories || filteredHistories.length === 0) return [];

    return filteredHistories.map((history) => {
      // 该会话的所有活动（★ 使用 Array.isArray 确保是数组）
      const safeActivities = Array.isArray(activities) ? activities : [];
      const sessionActivities = safeActivities.filter(
        (a) => a.missionId === history.missionId
      );

      // 按维度分组活动（转换为扩展类型）
      const dimensionActivities = new Map<string, ExtendedAgentActivity[]>();
      sessionActivities.forEach((activity) => {
        const key =
          activity.dimensionName ||
          t('topicResearch.collaboration.otherActivities');
        if (!dimensionActivities.has(key)) {
          dimensionActivities.set(key, []);
        }
        dimensionActivities.get(key)!.push(getExtendedActivity(activity));
      });

      // 该会话的消息（★ 使用 Array.isArray 确保是数组）
      const safeMessages = Array.isArray(messages) ? messages : [];
      const sessionMessages = safeMessages.filter(
        (m) => m.missionId === history.missionId
      );

      return {
        history,
        dimensionActivities,
        sessionMessages,
      };
    });
  }, [filteredHistories, activities, messages]);

  // 加载状态
  if (isLoading) {
    return (
      <div className="flex h-full min-h-[400px] flex-col items-center justify-center px-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gray-100">
          <Clock className="h-10 w-10 animate-pulse text-blue-500" />
        </div>
        <p className="mt-4 text-sm text-gray-500">
          {t('topicResearch.collaboration.timeline.loading')}
        </p>
      </div>
    );
  }

  // 无历史
  if (!histories || histories.length === 0) {
    return (
      <div className="flex h-full min-h-[400px] flex-col items-center justify-center px-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gray-100">
          <Calendar className="h-10 w-10 text-gray-400" />
        </div>
        <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">
          {t('topicResearch.collaboration.timeline.noHistory')}
        </h3>
        <p className="mt-2 max-w-sm text-center text-sm text-gray-500">
          {t('topicResearch.collaboration.timeline.noHistoryHint')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 标题和筛选 */}
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
          <Calendar className="h-5 w-5" />
          {t('topicResearch.collaboration.timeline.title')}
        </h2>
        <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
          {(['all', 'current', 'previous'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-md px-3 py-1 text-xs transition-colors',
                filter === f
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              )}
            >
              {f === 'all'
                ? t('topicResearch.collaboration.timeline.filterAll')
                : f === 'current'
                  ? t('topicResearch.collaboration.timeline.filterCurrent')
                  : t('topicResearch.collaboration.timeline.filterPrevious')}
            </button>
          ))}
        </div>
      </div>

      {/* 统计 */}
      <div className="flex items-center gap-4 text-sm text-gray-500">
        <span>
          {t('topicResearch.collaboration.timeline.totalResearch', {
            count: histories.length,
          })}
        </span>
        <span>
          {t('topicResearch.collaboration.timeline.successCount', {
            count: histories.filter((h) => h.status === 'COMPLETED').length,
          })}
        </span>
      </div>

      {/* 会话列表 */}
      <div className="space-y-4">
        {sessionData.map(
          ({ history, dimensionActivities, sessionMessages }) => (
            <SessionCard
              key={history.id}
              history={history}
              dimensionActivities={dimensionActivities}
              sessionMessages={sessionMessages}
              isCurrent={history.researchNumber === currentResearchNumber}
              onSelect={
                onSelectResearch ? () => onSelectResearch(history) : undefined
              }
              onCompare={
                onCompareVersions &&
                history.reportVersionBefore &&
                history.reportVersionAfter
                  ? () =>
                      onCompareVersions(
                        history.reportVersionBefore!,
                        history.reportVersionAfter!
                      )
                  : undefined
              }
              onViewReport={onViewReport}
              t={t}
              formatDuration={formatDuration}
              phaseConfig={phaseConfig}
              getStatusConfig={getStatusConfig}
            />
          )
        )}
      </div>
    </div>
  );
}

export default ResearchTimeline;
