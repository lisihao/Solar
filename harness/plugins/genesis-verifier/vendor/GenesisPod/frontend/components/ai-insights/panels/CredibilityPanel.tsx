/**
 * CredibilityPanel - 报告质量评估面板
 *
 * 展示报告质量的用户友好评估，包含：
 * - 整体质量卡片（等级徽章 + 综合评分 + 双维度对比）
 * - 来源可信度详情（默认折叠）
 * - AI 评审详情（默认展开）
 * - 局限性声明（默认展开）
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { TruncatedCell } from '@/components/common/tables';
import {
  Shield,
  BookOpen,
  Brain,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Building,
  GraduationCap,
  Newspaper,
  FileText,
  Wrench,
  ArrowRight,
} from 'lucide-react';
import { cn, safeString } from '@/lib/utils/common';
import { logger } from '@/lib/utils/logger';
import {
  getCredibilityReport,
  regenerateCredibilityReport,
  recalculateCredibilityScores,
  type CredibilityReportData,
  type EvaluationDimension,
  type ChapterEvaluation,
  type RemediationTrace,
} from '@/services/topic-insights/api';

// ==================== Types ====================

export interface SourceBreakdown {
  government: number;
  academic: number;
  industry: number;
  news?: number;
  newsMajor?: number;
  newsOther?: number;
  blog: number;
  other?: number;
  total: number;
}

export interface TimeBreakdown {
  within1Month: number;
  within3Months: number;
  within6Months: number;
  within1Year?: number;
  older: number;
  unknown?: number;
  total: number;
}

export interface CoverageDetail {
  dimensionId: string;
  dimensionName: string;
  sourceCount?: number;
  sourcesCount?: number;
  targetCount: number;
  status:
    | 'sufficient'
    | 'moderate'
    | 'insufficient'
    | 'excellent'
    | 'good'
    | 'fair'
    | 'poor';
  coveragePercent?: number;
}

export interface AiQualityMetrics {
  planningRounds: number;
  revisionAverage: number;
  approvalRate: number;
  averageConfidence?: string;
  totalAgentActivities: number;
}

export interface CredibilityReport {
  id?: string;
  reportId?: string;
  overallScore: number;
  authorityScore: number;
  diversityScore: number;
  timelinessScore: number;
  coverageScore: number;
  sourceBreakdown: SourceBreakdown;
  timeBreakdown: TimeBreakdown;
  coverageDetails: CoverageDetail[];
  aiQualityMetrics: AiQualityMetrics;
  limitations: string[];
  createdAt?: string;
  aiEvaluation?: CredibilityReportData['aiEvaluation'];
  combinedScore?: number;
  combinedGrade?: string;
  summaryText?: string;
}

export interface CredibilityPanelProps {
  reportId?: string;
  topicId?: string;
  credibility?: CredibilityReport | null;
  isLoading?: boolean;
  onRefresh?: () => void;
}

// ==================== Helper Functions ====================

function getScoreColor(score: number): string {
  if (score >= 90) return 'text-green-600 dark:text-green-400';
  if (score >= 80) return 'text-blue-600 dark:text-blue-400';
  if (score >= 70) return 'text-yellow-600 dark:text-yellow-400';
  if (score >= 60) return 'text-orange-600 dark:text-orange-400';
  return 'text-red-600 dark:text-red-400';
}

function getScoreBarColor(score: number): string {
  if (score >= 90) return 'bg-green-500';
  if (score >= 80) return 'bg-blue-500';
  if (score >= 70) return 'bg-yellow-500';
  if (score >= 60) return 'bg-orange-500';
  return 'bg-red-500';
}

function getGradeColors(grade: string): {
  bg: string;
  text: string;
  border: string;
} {
  switch (grade.toUpperCase().charAt(0)) {
    case 'A':
      return {
        bg: 'bg-green-50 dark:bg-green-900/30',
        text: 'text-green-700 dark:text-green-300',
        border: 'border-green-200 dark:border-green-700',
      };
    case 'B':
      return {
        bg: 'bg-blue-50 dark:bg-blue-900/30',
        text: 'text-blue-700 dark:text-blue-300',
        border: 'border-blue-200 dark:border-blue-700',
      };
    case 'C':
      return {
        bg: 'bg-yellow-50 dark:bg-yellow-900/30',
        text: 'text-yellow-700 dark:text-yellow-300',
        border: 'border-yellow-200 dark:border-yellow-700',
      };
    case 'D':
      return {
        bg: 'bg-orange-50 dark:bg-orange-900/30',
        text: 'text-orange-700 dark:text-orange-300',
        border: 'border-orange-200 dark:border-orange-700',
      };
    default:
      return {
        bg: 'bg-red-50 dark:bg-red-900/30',
        text: 'text-red-700 dark:text-red-300',
        border: 'border-red-200 dark:border-red-700',
      };
  }
}

function scoreToGrade(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

// ==================== Sub Components ====================

/**
 * 进度条行
 */
function ScoreBar({
  label,
  score,
  maxScore = 100,
  comment,
}: {
  label: string;
  score: number;
  maxScore?: number;
  comment?: string;
}) {
  const pct = Math.min(100, (score / maxScore) * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        <span className="w-28 shrink-0 text-sm text-gray-700 dark:text-gray-300">
          {label}
        </span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
          <div
            className={cn('h-full transition-all', getScoreBarColor(score))}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span
          className={cn(
            'w-10 shrink-0 text-right text-sm font-medium',
            getScoreColor(score)
          )}
        >
          {Math.round(score)}
        </span>
      </div>
      {comment && (
        <p className="pl-[7.5rem] text-xs text-gray-500 dark:text-gray-400">
          {comment}
        </p>
      )}
    </div>
  );
}

/**
 * 章节评分卡片（可展开查看 10 维明细）
 */
function ChapterScoreCard({ chapter }: { chapter: ChapterEvaluation }) {
  const [expanded, setExpanded] = useState(false);
  const gradeColors = getGradeColors(chapter.grade);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={cn(
              'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-bold',
              gradeColors.bg,
              gradeColors.text
            )}
          >
            {chapter.grade}
          </span>
          <TruncatedCell className="max-w-[220px] text-sm font-medium text-gray-900 dark:text-gray-100">
            {chapter.chapterTitle}
          </TruncatedCell>
          <TruncatedCell className="font-mono max-w-[120px] shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            {chapter.writerModel}
          </TruncatedCell>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              'text-sm font-medium',
              getScoreColor(chapter.chapterScore)
            )}
          >
            {chapter.chapterScore}
          </span>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          )}
        </div>
      </button>
      {expanded && (
        <div className="border-t border-gray-100 px-3 pb-3 pt-2 dark:border-gray-700">
          <div className="space-y-2">
            {chapter.dimensions.map((dim: EvaluationDimension) =>
              dim.score !== undefined ? (
                <ScoreBar
                  key={dim.id}
                  label={dim.name}
                  score={dim.score}
                  comment={dim.comment}
                />
              ) : null
            )}
          </div>
          {chapter.feedback && (
            <div className="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              {chapter.feedback}
            </div>
          )}
          {chapter.remediationTraces &&
            chapter.remediationTraces.length > 0 && (
              <RemediationTraceSection traces={chapter.remediationTraces} />
            )}
        </div>
      )}
    </div>
  );
}

const REMEDIATION_ACTION_LABELS: Record<string, string> = {
  deepen_analysis: '深化分析',
  inject_evidence: '补充证据',
  add_recommendations: '追加建议',
  improve_style: '改善风格',
};

function RemediationTraceSection({ traces }: { traces: RemediationTrace[] }) {
  const remediatedTraces = traces.filter((t) => t.wasRemediated);
  if (remediatedTraces.length === 0) return null;

  return (
    <div className="mt-3 border-t border-gray-100 pt-2 dark:border-gray-700">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-gray-400 dark:text-gray-500">
        <Wrench className="h-3 w-3" />
        <span>补救记录</span>
      </div>
      <div className="space-y-2">
        {remediatedTraces.map((trace, i) => (
          <div
            key={i}
            className="rounded border border-gray-100 bg-gray-50/50 px-2.5 py-1.5 dark:border-gray-700 dark:bg-gray-800/50"
          >
            <div className="mb-1 text-xs font-medium text-gray-700 dark:text-gray-300">
              {trace.sectionTitle}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500 dark:text-gray-400">
              <span className="font-mono rounded bg-gray-100 px-1 dark:bg-gray-700">
                {trace.originalModel}
              </span>
              {trace.remediationModel &&
                trace.remediationModel !== trace.originalModel && (
                  <>
                    <ArrowRight className="h-3 w-3" />
                    <span className="font-mono rounded bg-blue-50 px-1 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                      {trace.remediationModel}
                    </span>
                  </>
                )}
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
              {Object.entries(trace.selfEvalScores).map(([dim, score]) => (
                <span
                  key={dim}
                  className={cn(
                    'rounded px-1 py-0.5',
                    score < 7
                      ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                  )}
                >
                  {dim.replace(/_/g, ' ')} {String(score)}/10
                </span>
              ))}
            </div>
            {trace.actions.length > 0 && (
              <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                {trace.actions
                  .map((a) => REMEDIATION_ACTION_LABELS[a.type] || a.type)
                  .join(' + ')}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 可折叠区块（带评分标签）
 */
function CollapsibleSection({
  title,
  icon: Icon,
  score,
  badge,
  defaultExpanded = true,
  children,
}: {
  title: string;
  icon: React.ElementType;
  score?: number;
  badge?: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center justify-between p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-gray-500" />
          <span className="font-medium text-gray-900 dark:text-white">
            {title}
          </span>
          {score !== undefined && (
            <span className={cn('text-sm font-semibold', getScoreColor(score))}>
              {Math.round(score)}/100
            </span>
          )}
          {badge && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-400">
              {badge}
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-gray-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-gray-400" />
        )}
      </button>
      {isExpanded && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3 dark:border-gray-700">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * 来源分布百分比行
 */
function SourceDistribution({ breakdown }: { breakdown: SourceBreakdown }) {
  const total = breakdown.total || 1;
  const newsCount =
    breakdown.news ?? (breakdown.newsMajor ?? 0) + (breakdown.newsOther ?? 0);

  const sources = [
    {
      key: 'academic',
      label: '学术',
      count: breakdown.academic || 0,
      color: 'bg-blue-500',
      icon: GraduationCap,
    },
    {
      key: 'industry',
      label: '行业',
      count: breakdown.industry || 0,
      color: 'bg-purple-500',
      icon: FileText,
    },
    {
      key: 'news',
      label: '新闻',
      count: newsCount,
      color: 'bg-green-500',
      icon: Newspaper,
    },
    {
      key: 'government',
      label: '政府',
      count: breakdown.government || 0,
      color: 'bg-red-500',
      icon: Building,
    },
    {
      key: 'blog',
      label: '博客/其他',
      count: (breakdown.blog || 0) + (breakdown.other || 0),
      color: 'bg-gray-400',
      icon: BookOpen,
    },
  ].filter((s) => s.count > 0);

  return (
    <div className="space-y-3">
      {/* 分布条 */}
      <div className="flex h-3 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
        {sources.map((source) => (
          <div
            key={source.key}
            className={cn(source.color, 'transition-all')}
            style={{ width: `${(source.count / total) * 100}%` }}
            title={`${source.label}: ${source.count} (${Math.round((source.count / total) * 100)}%)`}
          />
        ))}
      </div>
      {/* 图例 */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
        {sources.map((source) => {
          const Icon = source.icon;
          return (
            <div key={source.key} className="flex items-center gap-1">
              <div className={cn('h-2 w-2 rounded-full', source.color)} />
              <Icon className="h-3 w-3 text-gray-400" />
              <span>
                {source.label} {Math.round((source.count / total) * 100)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 时效分布
 */
function TimelinessDistribution({ breakdown }: { breakdown: TimeBreakdown }) {
  const total = breakdown.total || 1;
  const unknownCount =
    breakdown.unknown ??
    Math.max(
      0,
      total -
        (breakdown.within1Month || 0) -
        (breakdown.within3Months || 0) -
        (breakdown.within6Months || 0) -
        (breakdown.within1Year || 0) -
        (breakdown.older || 0)
    );

  const periods = [
    {
      key: '1m',
      label: '1个月内',
      count: breakdown.within1Month || 0,
      color: 'bg-green-500',
    },
    {
      key: '3m',
      label: '3个月内',
      count: breakdown.within3Months || 0,
      color: 'bg-blue-500',
    },
    {
      key: '6m',
      label: '6个月内',
      count: breakdown.within6Months || 0,
      color: 'bg-yellow-500',
    },
    {
      key: '1y',
      label: '1年内',
      count: breakdown.within1Year || 0,
      color: 'bg-orange-400',
    },
    {
      key: 'older',
      label: '更早',
      count: breakdown.older || 0,
      color: 'bg-gray-400',
    },
    {
      key: 'unknown',
      label: '日期未知',
      count: unknownCount,
      color: 'bg-gray-300',
    },
  ].filter((p) => p.count > 0);

  if (periods.length === 0) {
    return <p className="py-2 text-sm text-gray-500">暂无时效性数据</p>;
  }

  return (
    <div className="space-y-2">
      {periods.map((period) => (
        <div key={period.key} className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-xs text-gray-500">
            {period.label}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              className={cn(period.color, 'h-full transition-all')}
              style={{ width: `${(period.count / total) * 100}%` }}
            />
          </div>
          <span className="w-14 shrink-0 text-right text-xs text-gray-600 dark:text-gray-400">
            {period.count} ({Math.round((period.count / total) * 100)}%)
          </span>
        </div>
      ))}
    </div>
  );
}

// ==================== Main Component ====================

export function CredibilityPanel({
  reportId,
  topicId,
  credibility: propCredibility,
  isLoading: propIsLoading = false,
  onRefresh: propOnRefresh,
}: CredibilityPanelProps) {
  // 内部状态：用于 reportId 模式
  const [fetchedCredibility, setFetchedCredibility] =
    useState<CredibilityReportData | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isRecalculatingEvidence, setIsRecalculatingEvidence] = useState(false);

  const useReportIdMode = !!reportId && !!topicId;
  const credibility = useReportIdMode ? fetchedCredibility : propCredibility;
  const isLoading = useReportIdMode ? isFetching : propIsLoading;

  // 获取数据
  const fetchData = useCallback(async () => {
    if (!reportId || !topicId) return;

    setIsFetching(true);
    setFetchError(null);
    try {
      const data = await getCredibilityReport(topicId, reportId);
      setFetchedCredibility({
        ...data,
        sourceBreakdown: {
          ...data.sourceBreakdown,
        },
        timeBreakdown: {
          ...data.timeBreakdown,
          total:
            data.timeBreakdown.total ||
            data.timeBreakdown.within1Month +
              data.timeBreakdown.within3Months +
              data.timeBreakdown.within6Months +
              data.timeBreakdown.within1Year +
              (data.timeBreakdown.older || 0),
        },
      });
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : '加载可信度报告失败');
    } finally {
      setIsFetching(false);
    }
  }, [reportId, topicId]);

  // 刷新数据
  const handleRefresh = useCallback(async () => {
    if (useReportIdMode && reportId && topicId) {
      setIsFetching(true);
      setFetchError(null);
      try {
        const data = await regenerateCredibilityReport(topicId, reportId);
        setFetchedCredibility(data);
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : '重新生成报告失败');
      } finally {
        setIsFetching(false);
      }
    } else if (propOnRefresh) {
      propOnRefresh();
    }
  }, [useReportIdMode, reportId, topicId, propOnRefresh]);

  // 重新计算证据可信度
  const handleRecalculateEvidence = useCallback(async () => {
    if (!reportId || !topicId || isRecalculatingEvidence) return;

    setIsRecalculatingEvidence(true);
    try {
      await recalculateCredibilityScores(topicId, reportId);
      await fetchData();
    } catch (err) {
      logger.error('Failed to recalculate evidence credibility:', err);
    } finally {
      setIsRecalculatingEvidence(false);
    }
  }, [reportId, topicId, isRecalculatingEvidence, fetchData]);

  useEffect(() => {
    if (useReportIdMode) {
      void fetchData();
    }
  }, [useReportIdMode, fetchData]);

  const onRefresh = useReportIdMode ? handleRefresh : propOnRefresh;

  // 错误状态
  if (fetchError) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-center">
        <AlertTriangle className="mb-3 h-12 w-12 text-red-300" />
        <div className="mb-1 text-lg font-medium text-gray-900 dark:text-white">
          加载失败
        </div>
        <div className="mb-3 text-sm text-gray-500">
          {safeString(fetchError)}
        </div>
        <button
          onClick={() => void fetchData()}
          className="rounded-lg bg-blue-500 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-600"
        >
          重试
        </button>
      </div>
    );
  }

  // 加载状态
  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <Shield className="mx-auto mb-2 h-8 w-8 animate-pulse text-blue-500" />
          <div className="text-sm text-gray-500">正在分析报告质量...</div>
        </div>
      </div>
    );
  }

  // 无数据
  if (!credibility) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-center">
        <Shield className="mb-3 h-12 w-12 text-gray-300" />
        <div className="mb-1 text-lg font-medium text-gray-900 dark:text-white">
          暂无质量评估报告
        </div>
        <div className="mb-3 text-sm text-gray-500">
          报告生成完成后可查看质量评估
        </div>
        {onRefresh && (
          <button
            onClick={() => void onRefresh()}
            className="rounded-lg bg-blue-500 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-600"
          >
            重新分析
          </button>
        )}
      </div>
    );
  }

  // 计算综合评分
  const sourceScore = credibility.overallScore;
  const aiScore = credibility.aiEvaluation?.overallScore;
  const combinedScore =
    credibility.combinedScore ??
    (aiScore !== undefined
      ? Math.round(sourceScore * 0.4 + aiScore * 0.6)
      : sourceScore);
  const combinedGrade =
    credibility.combinedGrade ??
    (credibility.aiEvaluation?.grade || scoreToGrade(combinedScore));

  const gradeColors = getGradeColors(combinedGrade);

  // 来源维度评分
  const sourceDimensions = [
    { label: '权威性', score: credibility.authorityScore },
    { label: '多样性', score: credibility.diversityScore },
    { label: '时效性', score: credibility.timelinessScore },
    { label: '覆盖度', score: credibility.coverageScore },
  ];

  return (
    <div className="space-y-4">
      {/* 顶栏：标题 + 操作按钮 */}
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
          <Shield className="h-5 w-5" />
          报告质量评估
        </h2>
        <div className="flex items-center gap-2">
          {reportId && topicId && (
            <button
              onClick={() => void handleRecalculateEvidence()}
              disabled={isRecalculatingEvidence}
              className="flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 transition-colors hover:border-orange-400 hover:text-orange-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
              title="重新计算来源可信度"
            >
              <RefreshCw
                className={cn(
                  'h-3.5 w-3.5',
                  isRecalculatingEvidence && 'animate-spin'
                )}
              />
              {isRecalculatingEvidence ? '计算中...' : '重新计算'}
            </button>
          )}
          {onRefresh && (
            <button
              onClick={() => void onRefresh()}
              className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
            >
              重新生成
            </button>
          )}
        </div>
      </div>

      {/* 区域 1: 整体质量卡片 */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          {/* 等级徽章 */}
          <div
            className={cn(
              'flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-xl border-2 text-center',
              gradeColors.bg,
              gradeColors.text,
              gradeColors.border
            )}
          >
            <span className="text-3xl font-bold leading-none">
              {combinedGrade}
            </span>
            <span className="mt-1 text-xs opacity-75">等级</span>
          </div>

          {/* 综合评分 + 摘要 */}
          <div className="flex-1 space-y-3">
            <div>
              <span className="text-2xl font-bold text-gray-900 dark:text-white">
                综合评分: {combinedScore}/100
              </span>
            </div>
            {credibility.summaryText && (
              <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                {credibility.summaryText}
              </p>
            )}

            {/* 双维度进度条 */}
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-sm text-gray-500">
                  来源可信度
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className={cn(
                      'h-full transition-all',
                      getScoreBarColor(sourceScore)
                    )}
                    style={{ width: `${sourceScore}%` }}
                  />
                </div>
                <span
                  className={cn(
                    'w-14 shrink-0 text-right text-sm font-medium',
                    getScoreColor(sourceScore)
                  )}
                >
                  {Math.round(sourceScore)}/100
                </span>
              </div>
              {aiScore !== undefined && (
                <div className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-sm text-gray-500">
                    AI 评审
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    <div
                      className={cn(
                        'h-full transition-all',
                        getScoreBarColor(aiScore)
                      )}
                      style={{ width: `${aiScore}%` }}
                    />
                  </div>
                  <span
                    className={cn(
                      'w-14 shrink-0 text-right text-sm font-medium',
                      getScoreColor(aiScore)
                    )}
                  >
                    {Math.round(aiScore)}/100
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 区域 2: 来源可信度（默认折叠） */}
      <CollapsibleSection
        title="来源可信度"
        icon={BookOpen}
        score={sourceScore}
        defaultExpanded={false}
      >
        <div className="space-y-4">
          {/* 四个维度评分 */}
          <div className="space-y-2">
            {sourceDimensions.map((dim) => (
              <ScoreBar key={dim.label} label={dim.label} score={dim.score} />
            ))}
          </div>

          {/* 来源分布 */}
          <div>
            <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
              来源分布
            </p>
            <SourceDistribution breakdown={credibility.sourceBreakdown} />
          </div>

          {/* 时效分布 */}
          <div>
            <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
              时效分布
            </p>
            <TimelinessDistribution breakdown={credibility.timeBreakdown} />
          </div>
        </div>
      </CollapsibleSection>

      {/* 区域 3: AI 评审 — 按章节 + 模型对比（有数据时展示，默认展开） */}
      {credibility.aiEvaluation && (
        <CollapsibleSection
          title="AI 评审"
          icon={Brain}
          score={credibility.aiEvaluation.overallScore}
          badge={credibility.aiEvaluation.evaluatorModel || undefined}
          defaultExpanded={true}
        >
          <div className="space-y-5">
            {/* 模型对比表（多模型时展示） */}
            {credibility.aiEvaluation.modelComparison &&
              credibility.aiEvaluation.modelComparison.length > 1 && (
                <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    模型对比
                  </div>
                  <Table className="w-full text-sm">
                    <THead>
                      <Tr className="border-b border-gray-100 text-left text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                        <Th className="px-3 py-2">模型</Th>
                        <Th className="px-3 py-2">章节数</Th>
                        <Th className="px-3 py-2">均分</Th>
                        <Th className="hidden px-3 py-2 sm:table-cell">最强</Th>
                        <Th className="hidden px-3 py-2 sm:table-cell">最弱</Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {credibility.aiEvaluation.modelComparison.map((m) => (
                        <Tr
                          key={m.modelId}
                          className="border-b border-gray-50 dark:border-gray-800"
                        >
                          <Td className="font-mono px-3 py-2 text-xs">
                            <TruncatedCell className="font-mono max-w-[180px] text-xs">
                              {m.modelId}
                            </TruncatedCell>
                          </Td>
                          <Td className="px-3 py-2">{m.chapterCount}</Td>
                          <Td
                            className={cn(
                              'px-3 py-2 font-medium',
                              getScoreColor(m.avgScore)
                            )}
                          >
                            {m.avgScore}
                          </Td>
                          <Td className="hidden px-3 py-2 text-xs text-gray-500 sm:table-cell">
                            <TruncatedCell className="max-w-[140px] text-xs text-gray-500">
                              {m.bestDimension}
                            </TruncatedCell>
                          </Td>
                          <Td className="hidden px-3 py-2 text-xs text-gray-500 sm:table-cell">
                            <TruncatedCell className="max-w-[140px] text-xs text-gray-500">
                              {m.weakestDimension}
                            </TruncatedCell>
                          </Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </div>
              )}

            {/* 按章节评审 */}
            {credibility.aiEvaluation.chapters &&
              credibility.aiEvaluation.chapters.length > 0 && (
                <div className="space-y-3">
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    章节评审明细
                  </div>
                  {credibility.aiEvaluation.chapters.map((ch) => (
                    <ChapterScoreCard key={ch.chapterId} chapter={ch} />
                  ))}
                </div>
              )}

            {/* 综合反馈 */}
            {credibility.aiEvaluation.feedback && (
              <div className="rounded-lg bg-gray-50 p-3 text-sm leading-relaxed text-gray-700 dark:bg-gray-700/50 dark:text-gray-300">
                {credibility.aiEvaluation.feedback}
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* 区域 4: 局限性声明 */}
      {credibility.limitations.length > 0 && (
        <CollapsibleSection
          title="局限性声明"
          icon={AlertTriangle}
          defaultExpanded={true}
        >
          <div className="space-y-2">
            {credibility.limitations.map((limitation, idx) => (
              <div
                key={idx}
                className="flex items-start gap-2 rounded-lg bg-yellow-50 p-2.5 text-sm text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-300"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{limitation}</span>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}

export default CredibilityPanel;
