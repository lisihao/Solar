'use client';

/**
 * Change Summary Panel - 变更摘要面板
 *
 * 功能：
 * - 显示变更统计摘要
 * - 按类型分组展示变更列表
 * - 点击条目跳转到对应位置
 * - 全部 Checkin 功能
 *
 * 参考: docs/prd/topic-research-report-editing.md
 */

import { useMemo } from 'react';
import { useI18n } from '@/lib/i18n';
import type { ReportChange } from '@/components/common/annotations/ChangeHighlighter';

interface ChangeSummaryPanelProps {
  changes: ReportChange[];
  onCheckin: (changeId: string) => void;
  onCheckinAll: () => void;
  onJumpTo: (changeId: string) => void;
}

// Icons
const PlusIcon = ({ className }: { className?: string }) => (
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
      d="M12 4v16m8-8H4"
    />
  </svg>
);

const EditIcon = ({ className }: { className?: string }) => (
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
      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
    />
  </svg>
);

const TrashIcon = ({ className }: { className?: string }) => (
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
      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
    />
  </svg>
);

const ArrowRightIcon = ({ className }: { className?: string }) => (
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
      d="M9 5l7 7-7 7"
    />
  </svg>
);

const CheckAllIcon = ({ className }: { className?: string }) => (
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
      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

/**
 * Change Summary Panel Component
 */
export function ChangeSummaryPanel({
  changes,
  onCheckin,
  onCheckinAll,
  onJumpTo,
}: ChangeSummaryPanelProps) {
  const { t } = useI18n();

  // ★ 安全处理：确保 changes 是数组
  const safeChanges = Array.isArray(changes) ? changes : [];

  // Filter out checked-in changes
  const activeChanges = useMemo(() => {
    return safeChanges.filter((change) => !change.checkedInAt);
  }, [safeChanges]);

  // Group changes by type
  const changesByType = useMemo(() => {
    const added = activeChanges.filter((c) => c.changeType === 'ADDED');
    const modified = activeChanges.filter((c) => c.changeType === 'MODIFIED');
    const deleted = activeChanges.filter((c) => c.changeType === 'DELETED');

    return {
      added,
      modified,
      deleted,
    };
  }, [activeChanges]);

  // Calculate total words diff
  const totalWordsDiff = useMemo(() => {
    return activeChanges.reduce((sum, change) => sum + change.wordsDiff, 0);
  }, [activeChanges]);

  // Get change icon
  const getChangeIcon = (changeType: 'ADDED' | 'MODIFIED' | 'DELETED') => {
    switch (changeType) {
      case 'ADDED':
        return <PlusIcon className="h-4 w-4 text-green-600" />;
      case 'MODIFIED':
        return <EditIcon className="h-4 w-4 text-yellow-600" />;
      case 'DELETED':
        return <TrashIcon className="h-4 w-4 text-red-600" />;
    }
  };

  // Get change label
  const getChangeLabel = (changeType: 'ADDED' | 'MODIFIED' | 'DELETED') => {
    switch (changeType) {
      case 'ADDED':
        return t('topicResearch.reportPanels.changeSummary.added');
      case 'MODIFIED':
        return t('topicResearch.reportPanels.changeSummary.modified');
      case 'DELETED':
        return t('topicResearch.reportPanels.changeSummary.deleted');
    }
  };

  if (activeChanges.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <CheckAllIcon className="h-5 w-5" />
          <span>{t('topicResearch.reportPanels.changeSummary.noChanges')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">📊</span>
          <h3 className="text-sm font-semibold text-gray-900">
            {t('topicResearch.reportPanels.changeSummary.title')}
          </h3>
        </div>
        <button
          onClick={onCheckinAll}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
        >
          <CheckAllIcon className="h-4 w-4" />
          <span>
            {t('topicResearch.reportPanels.changeSummary.checkinAll')}
          </span>
        </button>
      </div>

      {/* Summary stats */}
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-gray-700">
              {t('topicResearch.reportPanels.changeSummary.totalChanges')}:
            </span>
            <span className="font-semibold text-gray-900">
              {t('topicResearch.reportPanels.changeSummary.changesCount', {
                count: activeChanges.length,
              })}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-gray-700">
              {t('topicResearch.reportPanels.changeSummary.wordsDiff')}:
            </span>
            <span
              className={`font-semibold ${
                totalWordsDiff > 0
                  ? 'text-green-600'
                  : totalWordsDiff < 0
                    ? 'text-red-600'
                    : 'text-gray-600'
              }`}
            >
              {totalWordsDiff > 0 ? '+' : ''}
              {totalWordsDiff}
            </span>
          </div>
        </div>
      </div>

      {/* Changes by type */}
      <div className="divide-y divide-gray-200">
        {/* Added changes */}
        {changesByType.added.length > 0 && (
          <div className="px-4 py-3">
            <div className="mb-2 flex items-center gap-2">
              {getChangeIcon('ADDED')}
              <h4 className="text-sm font-semibold text-gray-900">
                {getChangeLabel('ADDED')}: {changesByType.added.length} 处
              </h4>
            </div>
            <ul className="space-y-1.5">
              {changesByType.added.map((change) => (
                <li
                  key={change.id}
                  className="group flex items-start gap-2 rounded px-2 py-1.5 text-sm text-gray-700 transition-colors hover:bg-green-50"
                >
                  <span className="mt-1 text-xs text-gray-400">•</span>
                  <div className="flex-1">
                    {change.sectionName && (
                      <span className="font-medium text-green-700">
                        {change.sectionName}:
                      </span>
                    )}{' '}
                    <span className="text-gray-600">
                      {change.currentContent.slice(0, 60)}
                      {change.currentContent.length > 60 ? '...' : ''}
                    </span>
                  </div>
                  <button
                    onClick={() => onJumpTo(change.id)}
                    className="ml-auto flex items-center gap-1 rounded bg-white px-2 py-1 text-xs font-medium text-green-600 opacity-0 shadow-sm transition-all hover:bg-green-50 group-hover:opacity-100"
                  >
                    <span>
                      {t('topicResearch.reportPanels.changeSummary.jumpTo')}
                    </span>
                    <ArrowRightIcon className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Modified changes */}
        {changesByType.modified.length > 0 && (
          <div className="px-4 py-3">
            <div className="mb-2 flex items-center gap-2">
              {getChangeIcon('MODIFIED')}
              <h4 className="text-sm font-semibold text-gray-900">
                {getChangeLabel('MODIFIED')}: {changesByType.modified.length} 处
              </h4>
            </div>
            <ul className="space-y-1.5">
              {changesByType.modified.map((change) => (
                <li
                  key={change.id}
                  className="group flex items-start gap-2 rounded px-2 py-1.5 text-sm text-gray-700 transition-colors hover:bg-yellow-50"
                >
                  <span className="mt-1 text-xs text-gray-400">•</span>
                  <div className="flex-1">
                    {change.sectionName && (
                      <span className="font-medium text-yellow-700">
                        {change.sectionName}:
                      </span>
                    )}{' '}
                    <span className="text-gray-600">
                      {change.currentContent.slice(0, 60)}
                      {change.currentContent.length > 60 ? '...' : ''}
                    </span>
                  </div>
                  <button
                    onClick={() => onJumpTo(change.id)}
                    className="ml-auto flex items-center gap-1 rounded bg-white px-2 py-1 text-xs font-medium text-yellow-600 opacity-0 shadow-sm transition-all hover:bg-yellow-50 group-hover:opacity-100"
                  >
                    <span>
                      {t('topicResearch.reportPanels.changeSummary.jumpTo')}
                    </span>
                    <ArrowRightIcon className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Deleted changes */}
        {changesByType.deleted.length > 0 && (
          <div className="px-4 py-3">
            <div className="mb-2 flex items-center gap-2">
              {getChangeIcon('DELETED')}
              <h4 className="text-sm font-semibold text-gray-900">
                {getChangeLabel('DELETED')}: {changesByType.deleted.length} 处
              </h4>
            </div>
            <ul className="space-y-1.5">
              {changesByType.deleted.map((change) => (
                <li
                  key={change.id}
                  className="group flex items-start gap-2 rounded px-2 py-1.5 text-sm text-gray-700 transition-colors hover:bg-red-50"
                >
                  <span className="mt-1 text-xs text-gray-400">•</span>
                  <div className="flex-1">
                    {change.sectionName && (
                      <span className="font-medium text-red-700">
                        {change.sectionName}:
                      </span>
                    )}{' '}
                    <span className="text-gray-500 line-through">
                      {change.previousContent?.slice(0, 60)}
                      {(change.previousContent?.length || 0) > 60 ? '...' : ''}
                    </span>
                  </div>
                  <button
                    onClick={() => onJumpTo(change.id)}
                    className="ml-auto flex items-center gap-1 rounded bg-white px-2 py-1 text-xs font-medium text-red-600 opacity-0 shadow-sm transition-all hover:bg-red-50 group-hover:opacity-100"
                  >
                    <span>
                      {t('topicResearch.reportPanels.changeSummary.jumpTo')}
                    </span>
                    <ArrowRightIcon className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
