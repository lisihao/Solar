/**
 * ResearchProgressSummary - 研究进度汇总组件
 *
 * 显示研究任务的整体进度和状态统计
 * 包含进度条、任务计数、状态分布等
 */

'use client';

import { useMemo } from 'react';
import { CheckCircle2, Clock, Loader2, AlertCircle, Pause } from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { useI18n } from '@/lib/i18n';
import type { TodoSummary, ResearchTodo } from '@/lib/types/topic-insights';
import { ResearchTodoStatus } from '@/lib/types/topic-insights';

interface ResearchProgressSummaryProps {
  summary?: TodoSummary | null;
  todos?: ResearchTodo[];
  className?: string;
  /** 是否显示详细统计 */
  showDetails?: boolean;
  /** 是否显示紧凑模式 */
  compact?: boolean;
}

/**
 * 从 TODO 列表计算统计数据
 */
function calculateStats(todos: ResearchTodo[]): TodoSummary {
  const total = todos.length;
  let completed = 0;
  let inProgress = 0;
  let pending = 0;
  let queued = 0;
  let paused = 0;
  let failed = 0;
  let cancelled = 0;

  // ★ 累计所有任务的进度用于计算加权平均
  let totalProgressSum = 0;

  for (const todo of todos) {
    switch (todo.status) {
      case ResearchTodoStatus.COMPLETED:
        completed++;
        totalProgressSum += 100; // 已完成 = 100%
        break;
      case ResearchTodoStatus.IN_PROGRESS:
        inProgress++;
        // ★ 使用任务自身的进度（0-100），而不是固定值
        totalProgressSum += todo.progress ?? 0;
        break;
      case ResearchTodoStatus.PENDING:
        pending++;
        // 待处理 = 0%
        break;
      case ResearchTodoStatus.QUEUED:
        queued++;
        // 排队中 = 0%
        break;
      case ResearchTodoStatus.PAUSED:
        paused++;
        // 已暂停：保留当前进度
        totalProgressSum += todo.progress ?? 0;
        break;
      case ResearchTodoStatus.FAILED:
        failed++;
        // 失败：保留失败前的进度
        totalProgressSum += todo.progress ?? 0;
        break;
      case ResearchTodoStatus.CANCELLED:
        cancelled++;
        // 取消的任务不计入进度
        break;
    }
  }

  // ★ 计算加权平均进度（排除已取消的任务）
  const effectiveTotal = total - cancelled;
  const overallProgress =
    effectiveTotal > 0 ? Math.round(totalProgressSum / effectiveTotal) : 0;

  return {
    total,
    completed,
    inProgress,
    pending,
    queued,
    paused,
    failed,
    cancelled,
    overallProgress,
  };
}

/**
 * 进度环组件
 */
function ProgressRing({
  progress,
  size = 48,
  strokeWidth = 4,
  className,
}: {
  progress: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <svg
      className={cn('-rotate-90 transform', className)}
      width={size}
      height={size}
    >
      {/* 背景圆 */}
      <circle
        className="text-gray-200"
        strokeWidth={strokeWidth}
        stroke="currentColor"
        fill="transparent"
        r={radius}
        cx={size / 2}
        cy={size / 2}
      />
      {/* 进度圆 */}
      <circle
        className="text-blue-500 transition-all duration-500"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        stroke="currentColor"
        fill="transparent"
        r={radius}
        cx={size / 2}
        cy={size / 2}
      />
    </svg>
  );
}

/**
 * 状态徽章组件
 */
function StatusBadge({
  count,
  label,
  icon: Icon,
  color,
  bgColor,
  animate,
  compact,
}: {
  count: number;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bgColor: string;
  animate?: boolean;
  compact?: boolean;
}) {
  if (count === 0) return null;

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-full px-2 py-1',
        bgColor,
        compact ? 'text-xs' : 'text-sm'
      )}
    >
      <Icon className={cn('h-3.5 w-3.5', color, animate && 'animate-spin')} />
      <span className={cn('font-medium', color)}>{count}</span>
      {!compact && <span className={cn('text-xs', color)}>{label}</span>}
    </div>
  );
}

export function ResearchProgressSummary({
  summary,
  todos,
  className,
  showDetails = true,
  compact = false,
}: ResearchProgressSummaryProps) {
  const { t } = useI18n();

  // 计算统计数据
  const stats = useMemo(() => {
    if (summary) return summary;
    if (todos && todos.length > 0) return calculateStats(todos);
    return null;
  }, [summary, todos]);

  if (!stats || stats.total === 0) {
    return (
      <div className={cn('py-4 text-center text-sm text-gray-500', className)}>
        {t('topicResearch.researchControl.progressSummary.noTasks')}
      </div>
    );
  }

  if (compact) {
    // 紧凑模式 - 用于 header 或侧边栏
    return (
      <div className={cn('flex items-center gap-3', className)}>
        <div className="relative">
          <ProgressRing
            progress={stats.overallProgress}
            size={32}
            strokeWidth={3}
          />
          <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold">
            {stats.overallProgress}%
          </span>
        </div>
        <div className="flex items-center gap-2">
          {stats.inProgress > 0 && (
            <StatusBadge
              count={stats.inProgress}
              label=""
              icon={Loader2}
              color="text-blue-600"
              bgColor="bg-blue-100"
              animate
              compact
            />
          )}
          <span className="text-xs text-gray-500">
            {stats.completed}/{stats.total}
          </span>
        </div>
      </div>
    );
  }

  // 完整模式
  return (
    <div className={cn('rounded-lg border bg-white p-4', className)}>
      {/* 顶部：进度环 + 标题 */}
      <div className="mb-4 flex items-center gap-4">
        <div className="relative">
          <ProgressRing
            progress={stats.overallProgress}
            size={56}
            strokeWidth={5}
          />
          <span className="absolute inset-0 flex items-center justify-center text-sm font-bold">
            {stats.overallProgress}%
          </span>
        </div>
        <div>
          <h4 className="font-semibold text-gray-900">
            {t(
              'topicResearch.researchControl.progressSummary.researchProgress'
            )}
          </h4>
          <p className="text-sm text-gray-500">
            {t('topicResearch.researchControl.progressSummary.completedTasks', {
              completed: stats.completed,
              total: stats.total,
            })}
          </p>
        </div>
      </div>

      {/* 进度条 */}
      <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div className="flex h-full">
          {/* 已完成 */}
          {stats.completed > 0 && (
            <div
              className="bg-green-500 transition-all duration-500"
              style={{ width: `${(stats.completed / stats.total) * 100}%` }}
            />
          )}
          {/* 进行中 */}
          {stats.inProgress > 0 && (
            <div
              className="animate-pulse bg-blue-500 transition-all duration-500"
              style={{ width: `${(stats.inProgress / stats.total) * 100}%` }}
            />
          )}
          {/* 已暂停 */}
          {stats.paused > 0 && (
            <div
              className="bg-orange-500 transition-all duration-500"
              style={{ width: `${(stats.paused / stats.total) * 100}%` }}
            />
          )}
          {/* 失败 */}
          {stats.failed > 0 && (
            <div
              className="bg-red-500 transition-all duration-500"
              style={{ width: `${(stats.failed / stats.total) * 100}%` }}
            />
          )}
        </div>
      </div>

      {/* 详细统计 */}
      {showDetails && (
        <div className="flex flex-wrap gap-2">
          <StatusBadge
            count={stats.completed}
            label={t('topicResearch.researchControl.progressSummary.completed')}
            icon={CheckCircle2}
            color="text-green-600"
            bgColor="bg-green-100"
          />
          <StatusBadge
            count={stats.inProgress}
            label={t(
              'topicResearch.researchControl.progressSummary.inProgress'
            )}
            icon={Loader2}
            color="text-blue-600"
            bgColor="bg-blue-100"
            animate
          />
          <StatusBadge
            count={stats.pending}
            label={t('topicResearch.researchControl.progressSummary.pending')}
            icon={Clock}
            color="text-gray-500"
            bgColor="bg-gray-100"
          />
          <StatusBadge
            count={stats.paused}
            label={t('topicResearch.researchControl.progressSummary.paused')}
            icon={Pause}
            color="text-orange-500"
            bgColor="bg-orange-100"
          />
          <StatusBadge
            count={stats.failed}
            label={t('topicResearch.researchControl.progressSummary.failed')}
            icon={AlertCircle}
            color="text-red-600"
            bgColor="bg-red-100"
          />
        </div>
      )}
    </div>
  );
}

export default ResearchProgressSummary;
