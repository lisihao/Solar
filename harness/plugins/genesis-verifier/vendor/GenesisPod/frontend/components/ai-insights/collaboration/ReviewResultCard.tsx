/**
 * ReviewResultCard - 审核结果展示组件
 *
 * 展示质量审核的详细结果，包括：
 * - 质量等级徽章
 * - 总分和五维评分
 * - 问题列表
 * - 改进建议
 */

'use client';

import React from 'react';
import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  TrendingUp,
  TrendingDown,
  Minus,
  Target,
  BookOpen,
  Scale,
  Link2,
  Clock,
  Lightbulb,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { useI18n } from '@/lib/i18n';

// ==================== Types ====================

export type QualityLevel =
  | 'excellent'
  | 'good'
  | 'acceptable'
  | 'needs_revision'
  | 'rejected';

export interface ReviewScores {
  breadth: number;
  depth: number;
  evidence: number;
  coherence: number;
  currency: number;
}

export interface ReviewIssue {
  type: string;
  severity: 'critical' | 'major' | 'minor';
  description: string;
  affectedSection?: string;
}

export interface DimensionReviewResult {
  qualityLevel: QualityLevel;
  overallScore: number;
  scores: ReviewScores;
  issues: ReviewIssue[];
  suggestions: string[];
  needsReresearch: boolean;
  reresearchFocus?: string[];
}

export interface OverallReviewResult {
  qualityLevel: QualityLevel;
  overallScore: number;
  dimensionReviews: Array<{
    dimensionId: string;
    dimensionName: string;
    qualityLevel: QualityLevel;
    overallScore: number;
  }>;
  crossDimensionIssues: ReviewIssue[];
  coverageAnalysis: {
    coveredAspects: string[];
    missingAspects: string[];
    coverageScore: number;
  };
  recommendations: string[];
  needsReresearch: boolean;
  dimensionsToReresearch: string[];
}

export interface ReviewResultCardProps {
  reviewResult: DimensionReviewResult | OverallReviewResult;
  type: 'dimension' | 'overall';
  dimensionName?: string;
  compact?: boolean;
}

// ==================== Constants ====================

const getQualityLevelConfig = (t: (key: string) => string) => ({
  excellent: {
    label: t('topicResearch.collaboration.qualityLevel.excellent') || '优秀',
    color: 'text-emerald-600 dark:text-emerald-400',
    bgColor: 'bg-emerald-100 dark:bg-emerald-900/30',
    icon: CheckCircle,
  },
  good: {
    label: t('topicResearch.collaboration.qualityLevel.good') || '良好',
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    icon: TrendingUp,
  },
  acceptable: {
    label: t('topicResearch.collaboration.qualityLevel.acceptable') || '合格',
    color: 'text-yellow-600 dark:text-yellow-400',
    bgColor: 'bg-yellow-100 dark:bg-yellow-900/30',
    icon: Minus,
  },
  needs_revision: {
    label:
      t('topicResearch.collaboration.qualityLevel.needsRevision') || '需修改',
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-100 dark:bg-orange-900/30',
    icon: AlertTriangle,
  },
  rejected: {
    label: t('topicResearch.collaboration.qualityLevel.rejected') || '不通过',
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    icon: XCircle,
  },
});

const getScoreLabels = (t: (key: string) => string) => ({
  breadth: {
    label: t('topicResearch.collaboration.reviewDimensions.breadth') || '广度',
    icon: Target,
  },
  depth: {
    label: t('topicResearch.collaboration.reviewDimensions.depth') || '深度',
    icon: TrendingDown,
  },
  evidence: {
    label: t('topicResearch.collaboration.reviewDimensions.evidence') || '证据',
    icon: BookOpen,
  },
  coherence: {
    label:
      t('topicResearch.collaboration.reviewDimensions.coherence') || '连贯性',
    icon: Link2,
  },
  currency: {
    label:
      t('topicResearch.collaboration.reviewDimensions.currency') || '时效性',
    icon: Clock,
  },
});

const getSeverityConfig = (t: (key: string) => string) => ({
  critical: {
    label: t('topicResearch.collaboration.severity.critical') || '严重',
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
  },
  major: {
    label: t('topicResearch.collaboration.severity.major') || '重要',
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-100 dark:bg-orange-900/30',
  },
  minor: {
    label: t('topicResearch.collaboration.severity.minor') || '轻微',
    color: 'text-yellow-600 dark:text-yellow-400',
    bgColor: 'bg-yellow-100 dark:bg-yellow-900/30',
  },
});

// ==================== Helper Functions ====================

function getScoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 60) return 'text-blue-600 dark:text-blue-400';
  if (score >= 40) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

function getScoreBarColor(score: number): string {
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 60) return 'bg-blue-500';
  if (score >= 40) return 'bg-yellow-500';
  return 'bg-red-500';
}

// ==================== Sub Components ====================

/**
 * 质量等级徽章
 */
function QualityBadge({ level }: { level: QualityLevel }) {
  const { t } = useI18n();
  const configs = getQualityLevelConfig(t);
  const config = configs[level] || configs.acceptable;
  const Icon = config.icon;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1',
        config.bgColor
      )}
    >
      <Icon className={cn('h-4 w-4', config.color)} />
      <span className={cn('text-sm font-medium', config.color)}>
        {config.label}
      </span>
    </div>
  );
}

/**
 * 分数进度条
 */
function ScoreBar({
  label,
  score,
  icon: Icon,
}: {
  label: string;
  score: number;
  icon: React.ElementType;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 text-gray-600 dark:text-gray-400">
          <Icon className="h-3 w-3" />
          {label}
        </span>
        <span className={cn('font-medium', getScoreColor(score))}>{score}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            getScoreBarColor(score)
          )}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

/**
 * 问题列表
 */
function IssuesList({
  issues,
  compact,
}: {
  issues: ReviewIssue[];
  compact?: boolean;
}) {
  const { t } = useI18n();
  if (issues.length === 0) return null;

  const displayIssues = compact ? issues.slice(0, 3) : issues;
  const severityConfigs = getSeverityConfig(t);

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">
        {t('topicResearch.collaboration.issues') || '问题列表'} ({issues.length}
        )
      </h4>
      <div className="space-y-1.5">
        {displayIssues.map((issue, idx) => {
          // Handle both structured ReviewIssue and plain string issues
          const isString = typeof issue === 'string';
          const severity = isString ? 'major' : issue.severity || 'major';
          const description = isString
            ? (issue as unknown as string)
            : issue.description || String(issue);
          const severityConf =
            severityConfigs[severity as keyof typeof severityConfigs] ||
            severityConfigs.major;
          return (
            <div
              key={idx}
              className={cn(
                'rounded-md px-2 py-1.5 text-xs',
                severityConf.bgColor
              )}
            >
              <span className={cn('font-medium', severityConf.color)}>
                [{severityConf.label}]
              </span>{' '}
              <span className="text-gray-700 dark:text-gray-300">
                {description}
              </span>
            </div>
          );
        })}
        {compact && issues.length > 3 && (
          <div className="text-xs text-gray-500">
            {t('topicResearch.collaboration.moreIssues', {
              count: issues.length - 3,
            }) || `...还有 ${issues.length - 3} 个问题`}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 建议列表
 */
function SuggestionsList({
  suggestions,
  compact,
}: {
  suggestions: string[];
  compact?: boolean;
}) {
  const { t } = useI18n();
  if (suggestions.length === 0) return null;

  const displaySuggestions = compact ? suggestions.slice(0, 2) : suggestions;

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">
        {t('topicResearch.collaboration.suggestions') || '改进建议'} (
        {suggestions.length})
      </h4>
      <div className="space-y-1">
        {displaySuggestions.map((suggestion, idx) => (
          <div
            key={idx}
            className="flex items-start gap-1.5 text-xs text-gray-600 dark:text-gray-400"
          >
            <Lightbulb className="mt-0.5 h-3 w-3 flex-shrink-0 text-yellow-500" />
            <span>{suggestion}</span>
          </div>
        ))}
        {compact && suggestions.length > 2 && (
          <div className="text-xs text-gray-500">
            {t('topicResearch.collaboration.moreSuggestions', {
              count: suggestions.length - 2,
            }) || `...还有 ${suggestions.length - 2} 条建议`}
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== Main Component ====================

/**
 * 审核结果卡片
 */
export function ReviewResultCard({
  reviewResult,
  type,
  dimensionName,
  compact = false,
}: ReviewResultCardProps) {
  const { t } = useI18n();
  const qualityConfigs = getQualityLevelConfig(t);
  const scoreLabels = getScoreLabels(t);
  const isDimensionReview = type === 'dimension';
  const dimResult = reviewResult as DimensionReviewResult;
  const overallResult = reviewResult as OverallReviewResult;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <QualityBadge level={reviewResult.qualityLevel as QualityLevel} />
          {dimensionName && (
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {dimensionName}
            </span>
          )}
        </div>
        <div
          className={cn(
            'text-2xl font-bold',
            getScoreColor(reviewResult.overallScore)
          )}
        >
          {typeof reviewResult.overallScore === 'number'
            ? reviewResult.overallScore.toFixed(0)
            : reviewResult.overallScore}
          <span className="text-sm font-normal text-gray-400">/100</span>
        </div>
      </div>

      {/* Five Dimension Scores (only for dimension review) */}
      {isDimensionReview && dimResult.scores && (
        <div className="mb-4 grid grid-cols-5 gap-2">
          {(Object.keys(scoreLabels) as Array<keyof ReviewScores>).map(
            (key) => (
              <ScoreBar
                key={key}
                label={scoreLabels[key].label}
                score={dimResult.scores[key]}
                icon={scoreLabels[key].icon}
              />
            )
          )}
        </div>
      )}

      {/* Dimension Summary (only for overall review) */}
      {!isDimensionReview && overallResult.dimensionReviews && (
        <div className="mb-4 space-y-1">
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {t('topicResearch.collaboration.dimensionScores') || '各维度评分'}
          </h4>
          <div className="flex flex-wrap gap-2">
            {overallResult.dimensionReviews.map((dim) => (
              <div
                key={dim.dimensionId}
                className={cn(
                  'rounded-md px-2 py-1 text-xs',
                  qualityConfigs[dim.qualityLevel as QualityLevel]?.bgColor ||
                    'bg-gray-100 dark:bg-gray-700'
                )}
              >
                <span className="text-gray-700 dark:text-gray-300">
                  {dim.dimensionName}
                </span>
                <span
                  className={cn(
                    'ml-1 font-medium',
                    getScoreColor(dim.overallScore)
                  )}
                >
                  {dim.overallScore}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Issues */}
      {isDimensionReview && (
        <IssuesList issues={dimResult.issues || []} compact={compact} />
      )}
      {!isDimensionReview && (
        <IssuesList
          issues={overallResult.crossDimensionIssues || []}
          compact={compact}
        />
      )}

      {/* Suggestions */}
      {isDimensionReview && (
        <div className="mt-3">
          <SuggestionsList
            suggestions={dimResult.suggestions || []}
            compact={compact}
          />
        </div>
      )}
      {!isDimensionReview && (
        <div className="mt-3">
          <SuggestionsList
            suggestions={overallResult.recommendations || []}
            compact={compact}
          />
        </div>
      )}

      {/* Re-research Notice */}
      {reviewResult.needsReresearch && (
        <div className="mt-3 flex items-center gap-2 rounded-md bg-orange-100 px-3 py-2 dark:bg-orange-900/30">
          <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400" />
          <span className="text-xs text-orange-700 dark:text-orange-300">
            {t('topicResearch.collaboration.needsReresearch') ||
              '部分维度需要重新研究'}
            {isDimensionReview &&
              dimResult.reresearchFocus &&
              dimResult.reresearchFocus.length > 0 && (
                <span>: {dimResult.reresearchFocus.join(', ')}</span>
              )}
            {!isDimensionReview &&
              overallResult.dimensionsToReresearch &&
              overallResult.dimensionsToReresearch.length > 0 && (
                <span>
                  :{' '}
                  {t('topicResearch.collaboration.dimensionsToReresearch', {
                    count: overallResult.dimensionsToReresearch.length,
                  }) ||
                    `${overallResult.dimensionsToReresearch.length} 个维度需要重研`}
                </span>
              )}
          </span>
        </div>
      )}
    </div>
  );
}

export default ReviewResultCard;
