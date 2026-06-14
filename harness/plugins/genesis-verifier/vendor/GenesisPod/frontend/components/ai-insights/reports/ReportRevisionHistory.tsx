'use client';

/**
 * Report Revision History Component
 *
 * v7.0 报告修订历史:
 * - 版本时间线
 * - 变更差异预览
 * - 回滚功能
 */

import { useState, useCallback } from 'react';
import { useTranslation } from '@/lib/i18n';
import { ClientDate } from '@/components/common/ClientDate';
import { LoadingState } from '@/components/ui/states';

// Revision types
interface ReportRevision {
  id: string;
  version: number;
  title: string;
  summary: string;
  changeType: 'create' | 'edit' | 'ai_edit' | 'rollback';
  changeDescription: string;
  author: string;
  createdAt: string;
  wordCount: number;
  wordCountDelta: number;
}

interface ReportRevisionHistoryProps {
  revisions: ReportRevision[];
  currentVersion: number;
  isLoading?: boolean;
  onPreview?: (revisionId: string) => void;
  onRollback?: (revisionId: string) => Promise<void>;
  onCompare?: (fromId: string, toId: string) => void;
}

// Icons
const ClockIcon = ({ className }: { className?: string }) => (
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
      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
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

const AIIcon = ({ className }: { className?: string }) => (
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
      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
    />
  </svg>
);

const RollbackIcon = ({ className }: { className?: string }) => (
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
      d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
    />
  </svg>
);

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

const EyeIcon = ({ className }: { className?: string }) => (
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
      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
    />
  </svg>
);

// Change type config (icons and colors only, labels come from i18n)
const changeTypeIcons: Record<
  string,
  {
    icon: React.ComponentType<{ className?: string }>;
    color: string;
  }
> = {
  create: {
    icon: PlusIcon,
    color: 'text-green-600 bg-green-50',
  },
  edit: { icon: EditIcon, color: 'text-blue-600 bg-blue-50' },
  ai_edit: {
    icon: AIIcon,
    color: 'text-purple-600 bg-purple-50',
  },
  rollback: {
    icon: RollbackIcon,
    color: 'text-orange-600 bg-orange-50',
  },
};

export function ReportRevisionHistory({
  revisions,
  currentVersion,
  isLoading = false,
  onPreview,
  onRollback,
  onCompare,
}: ReportRevisionHistoryProps) {
  const { t } = useTranslation();
  const [selectedRevisions, setSelectedRevisions] = useState<Set<string>>(
    new Set()
  );
  const [isRollingBack, setIsRollingBack] = useState<string | null>(null);

  // Get change type label from i18n
  const getChangeTypeLabel = (changeType: string) => {
    const key = `topicResearch.contentPanel.revisionHistory.changeTypes.${changeType}`;
    const translated = t(key);
    // If translation key not found, return the changeType itself
    return translated === key ? changeType : translated;
  };

  // Toggle revision selection for comparison
  const toggleSelection = useCallback((revisionId: string) => {
    setSelectedRevisions((prev) => {
      const next = new Set(prev);
      if (next.has(revisionId)) {
        next.delete(revisionId);
      } else if (next.size < 2) {
        next.add(revisionId);
      }
      return next;
    });
  }, []);

  // Handle rollback
  const handleRollback = useCallback(
    async (revisionId: string) => {
      if (!onRollback) return;

      setIsRollingBack(revisionId);
      try {
        await onRollback(revisionId);
      } finally {
        setIsRollingBack(null);
      }
    },
    [onRollback]
  );

  // Handle compare
  const handleCompare = useCallback(() => {
    if (selectedRevisions.size !== 2 || !onCompare) return;

    const [fromId, toId] = Array.from(selectedRevisions);
    onCompare(fromId, toId);
    setSelectedRevisions(new Set());
  }, [selectedRevisions, onCompare]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingState
          text={t('topicResearch.contentPanel.revisionHistory.loading')}
        />
      </div>
    );
  }

  if (revisions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <ClockIcon className="h-12 w-12 text-gray-300" />
        <p className="mt-3 text-gray-500">
          {t('topicResearch.contentPanel.revisionHistory.noHistory')}
        </p>
        <p className="mt-1 text-sm text-gray-400">
          {t('topicResearch.contentPanel.revisionHistory.noHistoryHint')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">
              {t('topicResearch.contentPanel.revisionHistory.revisionHistory')}
            </h3>
            <p className="mt-0.5 text-xs text-gray-400">
              {t('topicResearch.contentPanel.revisionHistory.totalVersions', {
                count: revisions.length,
                version: currentVersion,
              })}
            </p>
          </div>

          {/* Compare button */}
          {onCompare && selectedRevisions.size === 2 && (
            <button
              onClick={handleCompare}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              {t('topicResearch.contentPanel.revisionHistory.actions.compare')}
            </button>
          )}
        </div>

        {selectedRevisions.size > 0 && selectedRevisions.size < 2 && (
          <p className="mt-2 text-xs text-blue-500">
            {t('topicResearch.contentPanel.revisionHistory.selectMore', {
              count: selectedRevisions.size,
              defaultValue: `Selected ${selectedRevisions.size} version(s), select 1 more to compare`,
            })}
          </p>
        )}
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-auto p-4">
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute bottom-0 left-4 top-0 w-0.5 bg-gray-200" />

          {/* Revision items */}
          <div className="space-y-4">
            {revisions.map((revision) => {
              const config =
                changeTypeIcons[revision.changeType] || changeTypeIcons.edit;
              const Icon = config.icon;
              const isCurrent = revision.version === currentVersion;
              const isSelected = selectedRevisions.has(revision.id);

              return (
                <div
                  key={revision.id}
                  className={`relative flex gap-4 pl-10 ${
                    isSelected ? '-mx-4 rounded-lg bg-blue-50 px-4 py-2' : ''
                  }`}
                >
                  {/* Timeline dot */}
                  <div
                    className={`absolute left-2 flex h-5 w-5 items-center justify-center rounded-full ${
                      isCurrent
                        ? 'bg-blue-600 ring-4 ring-blue-100'
                        : 'border-2 border-gray-300 bg-white'
                    }`}
                  >
                    {isCurrent && (
                      <div className="h-2 w-2 rounded-full bg-white" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        {/* Version and badge */}
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">
                            v{revision.version}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${config.color}`}
                          >
                            <Icon className="h-3 w-3" />
                            {getChangeTypeLabel(revision.changeType)}
                          </span>
                          {isCurrent && (
                            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
                              {t(
                                'topicResearch.contentPanel.revisionHistory.current'
                              )}
                            </span>
                          )}
                        </div>

                        {/* Description */}
                        <p className="mt-1 line-clamp-2 text-sm text-gray-600">
                          {revision.changeDescription}
                        </p>

                        {/* Meta info */}
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-400">
                          <span>
                            {revision.author ||
                              t(
                                'topicResearch.contentPanel.revisionHistory.unknown'
                              )}
                          </span>
                          <ClientDate
                            date={revision.createdAt}
                            format="datetime"
                          />
                          <span>
                            {t(
                              'topicResearch.contentPanel.revisionHistory.characters',
                              { count: revision.wordCount }
                            )}
                            {revision.wordCountDelta !== 0 && (
                              <span
                                className={
                                  revision.wordCountDelta > 0
                                    ? 'text-green-500'
                                    : 'text-red-500'
                                }
                              >
                                {' '}
                                ({revision.wordCountDelta > 0 ? '+' : ''}
                                {revision.wordCountDelta})
                              </span>
                            )}
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1">
                        {/* Select for compare */}
                        {onCompare && (
                          <button
                            onClick={() => toggleSelection(revision.id)}
                            className={`rounded p-1.5 transition-colors ${
                              isSelected
                                ? 'bg-blue-100 text-blue-600'
                                : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
                            }`}
                            title={
                              isSelected
                                ? t(
                                    'topicResearch.contentPanel.revisionHistory.actions.deselect'
                                  )
                                : t(
                                    'topicResearch.contentPanel.revisionHistory.actions.select'
                                  )
                            }
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {}}
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                          </button>
                        )}

                        {/* Preview */}
                        {onPreview && (
                          <button
                            onClick={() => onPreview(revision.id)}
                            className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                            title={t(
                              'topicResearch.contentPanel.revisionHistory.actions.preview'
                            )}
                          >
                            <EyeIcon className="h-4 w-4" />
                          </button>
                        )}

                        {/* Rollback */}
                        {onRollback && !isCurrent && (
                          <button
                            onClick={() => handleRollback(revision.id)}
                            disabled={isRollingBack !== null}
                            className="rounded p-1.5 text-gray-400 transition-colors hover:bg-orange-50 hover:text-orange-600 disabled:opacity-50"
                            title={t(
                              'topicResearch.contentPanel.revisionHistory.actions.rollback'
                            )}
                          >
                            {isRollingBack === revision.id ? (
                              <div className="h-4 w-4 animate-spin rounded-full border-2 border-orange-300 border-t-orange-600" />
                            ) : (
                              <RollbackIcon className="h-4 w-4" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
