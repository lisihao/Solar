'use client';

/**
 * Research Progress Bar
 *
 * 显示研究进度:
 * - 进度百分比
 * - 阶段显示
 * - 预计剩余时间
 */

import { useI18n } from '@/lib/i18n';
import type { MissionStatus } from '@/services/topic-insights/api';

interface ResearchProgressBarProps {
  missionStatus: MissionStatus | null;
  isRefreshing: boolean;
  startTime?: Date | null;
}

export function ResearchProgressBar({
  missionStatus,
  isRefreshing,
  startTime,
}: ResearchProgressBarProps) {
  const { t } = useI18n();

  // 阶段显示映射
  const phaseDisplay: Record<string, { label: string; color: string }> = {
    planning: {
      label: t('topicResearch.researchControl.progressBar.phases.planning'),
      color: 'text-purple-600 bg-purple-50',
    },
    researching: {
      label: t('topicResearch.researchControl.progressBar.phases.researching'),
      color: 'text-blue-600 bg-blue-50',
    },
    reviewing: {
      label: t('topicResearch.researchControl.progressBar.phases.reviewing'),
      color: 'text-green-600 bg-green-50',
    },
    synthesizing: {
      label: t('topicResearch.researchControl.progressBar.phases.synthesizing'),
      color: 'text-orange-600 bg-orange-50',
    },
    completed: {
      label: t('topicResearch.researchControl.progressBar.phases.completed'),
      color: 'text-emerald-600 bg-emerald-50',
    },
    failed: {
      label: t('topicResearch.researchControl.progressBar.phases.failed'),
      color: 'text-red-600 bg-red-50',
    },
    idle: {
      label: t('topicResearch.researchControl.progressBar.phases.idle'),
      color: 'text-gray-500 bg-gray-50',
    },
  };
  // 计算进度
  const progress = missionStatus?.progress ?? 0;
  const completedTasks = missionStatus?.completedTasks ?? 0;
  const totalTasks = missionStatus?.totalTasks ?? 0;
  const currentPhase =
    missionStatus?.currentPhase ?? (isRefreshing ? 'researching' : 'idle');

  // 计算已用时间
  const elapsedTime = startTime
    ? Math.floor((Date.now() - startTime.getTime()) / 1000)
    : 0;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 预估剩余时间
  const estimatedRemaining =
    progress > 0 && elapsedTime > 0
      ? Math.round((elapsedTime / progress) * (100 - progress))
      : null;

  const phaseConfig = phaseDisplay[currentPhase] || phaseDisplay.idle;

  return (
    <div className="border-t border-gray-100 bg-gray-50/50 px-3 py-3">
      {/* 阶段标签 */}
      <div className="mb-2 flex items-center justify-between">
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${phaseConfig.color}`}
        >
          {phaseConfig.label}
        </span>
        {isRefreshing && (
          <span className="text-xs text-gray-400">
            {formatTime(elapsedTime)}
            {estimatedRemaining !== null &&
              ` / ~${formatTime(estimatedRemaining)}`}
          </span>
        )}
      </div>

      {/* 进度条 */}
      <div className="relative">
        <div className="h-2 overflow-hidden rounded-full bg-gray-200">
          <div
            className={`h-full transition-all duration-500 ease-out ${
              currentPhase === 'failed'
                ? 'bg-red-500'
                : currentPhase === 'completed'
                  ? 'bg-emerald-500'
                  : 'bg-gradient-to-r from-blue-500 to-purple-500'
            }`}
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>

        {/* 进度动画指示器 */}
        {isRefreshing && progress < 100 && (
          <div
            className="absolute top-0 h-2 w-16 animate-pulse rounded-full bg-gradient-to-r from-transparent via-white/50 to-transparent"
            style={{ left: `${Math.min(progress, 90)}%` }}
          />
        )}
      </div>

      {/* 进度详情 */}
      <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
        <span>
          {totalTasks > 0
            ? t('topicResearch.researchControl.progressBar.tasksLabel', {
                completed: completedTasks,
                total: totalTasks,
              })
            : t('topicResearch.researchControl.progressBar.preparing')}
        </span>
        <span className="font-medium text-gray-700">
          {t('topicResearch.researchControl.progressBar.progress', {
            percent: Math.round(progress),
          })}
        </span>
      </div>

      {/* 当前任务信息 */}
      {missionStatus?.tasks && missionStatus.tasks.length > 0 && (
        <div className="mt-2 border-t border-gray-100 pt-2">
          <p className="mb-1 text-xs text-gray-400">
            {t('topicResearch.researchControl.progressBar.currentTask')}
          </p>
          <div className="space-y-1">
            {missionStatus.tasks
              .filter((t) => t.status === 'EXECUTING')
              .slice(0, 2)
              .map((task) => (
                <div key={task.id} className="flex items-center gap-2 text-xs">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
                  <span className="truncate text-gray-600">
                    {task.dimensionName || task.title}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
