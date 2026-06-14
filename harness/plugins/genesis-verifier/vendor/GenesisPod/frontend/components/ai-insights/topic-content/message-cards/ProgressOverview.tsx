import { useState, useMemo } from 'react';
import type { UIMessage } from '../shared/types';
import type { MissionStatus } from '@/services/topic-insights/api';
import { safeString } from '@/lib/utils/common';
import { useI18n } from '@/lib/i18n';

interface ProgressOverviewProps {
  messages: UIMessage[];
  missionStatus?: MissionStatus | null;
}

export function ProgressOverview({
  messages,
  missionStatus,
}: ProgressOverviewProps) {
  const { t } = useI18n();
  const [dimensionsCollapsed, setDimensionsCollapsed] = useState(true);

  const dimensionStatus = useMemo(() => {
    const dimensions = new Map<
      string,
      { name: string; status: 'completed' | 'in_progress' | 'pending' }
    >();

    const isValidDimensionName = (name: string | null | undefined): boolean => {
      if (!name || typeof name !== 'string') return false;
      const trimmed = name.trim();
      if (trimmed.length === 0 || trimmed.length > 100) return false;
      const modelIdPatterns = [
        /^gemini-/i,
        /^gpt-/i,
        /^claude-/i,
        /^grok-/i,
        /^deepseek/i,
        /^qwen/i,
        /^glm-/i,
        /^\[.*\]$/,
      ];
      return !modelIdPatterns.some((pattern) => pattern.test(trimmed));
    };

    if (missionStatus?.tasks) {
      for (const task of missionStatus.tasks) {
        if (task.dimensionName && isValidDimensionName(task.dimensionName)) {
          const status =
            task.status === 'COMPLETED'
              ? 'completed'
              : ['EXECUTING', 'ASSIGNED'].includes(task.status)
                ? 'in_progress'
                : 'pending';
          dimensions.set(task.dimensionName, {
            name: task.dimensionName,
            status,
          });
        }
      }
    }

    for (const msg of messages) {
      if (msg.agentType === 'researcher' && msg.agent?.includes('研究员')) {
        const dimName = (msg.agent || '').replace('研究员', '').trim();
        // ★ Fix: 添加 isValidDimensionName 验证，过滤掉模型 ID
        if (
          dimName &&
          isValidDimensionName(dimName) &&
          !dimensions.has(dimName)
        ) {
          const status = safeString(msg.content).includes('完成')
            ? 'completed'
            : 'in_progress';
          dimensions.set(dimName, { name: dimName, status });
        }
      }
    }

    return Array.from(dimensions.values());
  }, [messages, missionStatus]);

  const completedCount = dimensionStatus.filter(
    (d) => d.status === 'completed'
  ).length;
  const totalCount = dimensionStatus.length || missionStatus?.totalTasks || 0;
  const progress =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  if (dimensionStatus.length === 0 && !missionStatus) return null;

  return (
    <div className="rounded-lg border border-white/50 bg-white/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">
          {t('topicResearch.messageCards.overview.title')}
        </span>
        <span className="text-sm text-gray-500">
          {completedCount}/{totalCount}{' '}
          {t('topicResearch.messageCards.overview.dimensionsCompleted')}
        </span>
      </div>

      <div className="my-2 h-1.5 overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {dimensionStatus.length > 0 && (
        <div
          className="cursor-pointer"
          onClick={() => setDimensionsCollapsed(!dimensionsCollapsed)}
        >
          <div className="mb-1 flex items-center gap-1 text-xs text-gray-500">
            <span>
              {t('topicResearch.messageCards.overview.dimensionDetails')}
            </span>
            <svg
              className={`h-3 w-3 transition-transform ${dimensionsCollapsed ? '' : 'rotate-180'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
          {!dimensionsCollapsed && (
            <div className="flex flex-wrap gap-1.5">
              {dimensionStatus.map((dim) => (
                <span
                  key={dim.name}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                    dim.status === 'completed'
                      ? 'bg-green-100 text-green-700'
                      : dim.status === 'in_progress'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {dim.status === 'completed' && '✓'}
                  {dim.status === 'in_progress' && (
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
                  )}
                  {dim.status === 'pending' && '○'}
                  <span className="max-w-[70px] truncate">{dim.name}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
