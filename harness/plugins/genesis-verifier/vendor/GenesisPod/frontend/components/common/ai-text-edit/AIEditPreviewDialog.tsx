'use client';

/**
 * AI Edit Preview Dialog Component
 *
 * 参考 PRD: docs/prd/topic-research-report-editing.md
 *
 * 功能:
 * - 显示原文和 AI 编辑结果的对比
 * - 高亮变化部分
 * - 接受/拒绝/重新生成按钮
 */

import { useMemo } from 'react';
import { useI18n } from '@/lib/i18n';
import type { AIEditOperation } from './types';

interface AIEditPreviewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  original: string;
  edited: string;
  operation: AIEditOperation;
  styleType?: 'academic' | 'business' | 'casual' | 'technical';
  customInstruction?: string;
  onAccept: () => void;
  onReject: () => void;
  onRegenerate: () => void;
  isLoading?: boolean;
}

// Calculate diff for highlighting
function calculateDiff(original: string, edited: string) {
  // Simple word-level diff
  const originalWords = original.split(/\s+/);
  const editedWords = edited.split(/\s+/);

  const changes: { type: 'equal' | 'delete' | 'insert'; text: string }[] = [];

  let i = 0;
  let j = 0;

  while (i < originalWords.length || j < editedWords.length) {
    if (i >= originalWords.length) {
      // Remaining words are insertions
      changes.push({ type: 'insert', text: editedWords[j] });
      j++;
    } else if (j >= editedWords.length) {
      // Remaining words are deletions
      changes.push({ type: 'delete', text: originalWords[i] });
      i++;
    } else if (originalWords[i] === editedWords[j]) {
      // Words are equal
      changes.push({ type: 'equal', text: originalWords[i] });
      i++;
      j++;
    } else {
      // Words differ - mark as delete + insert
      changes.push({ type: 'delete', text: originalWords[i] });
      changes.push({ type: 'insert', text: editedWords[j] });
      i++;
      j++;
    }
  }

  return changes;
}

export function AIEditPreviewDialog({
  isOpen,
  onClose,
  original,
  edited,
  operation,
  styleType,
  customInstruction,
  onAccept,
  onReject,
  onRegenerate,
  isLoading = false,
}: AIEditPreviewDialogProps) {
  const { t } = useI18n();

  // Calculate diff
  const diff = useMemo(() => {
    return calculateDiff(original, edited);
  }, [original, edited]);

  // Get operation label
  const operationLabel = useMemo(() => {
    const labels: Record<AIEditOperation, string> = {
      rewrite: t('topicResearch.aiEdit.rewrite'),
      polish: t('topicResearch.aiEdit.polish'),
      expand: t('topicResearch.aiEdit.expand'),
      compress: t('topicResearch.aiEdit.compress'),
      style: t('topicResearch.aiEdit.styleDesc'),
    };

    let label = labels[operation] || t('topicResearch.aiEdit.aiEditPreview');

    if (operation === 'style' && styleType) {
      const styleLabels: Record<string, string> = {
        academic: t('topicResearch.aiEdit.styles.academic'),
        business: t('topicResearch.aiEdit.styles.business'),
        casual: t('topicResearch.aiEdit.styles.casual'),
        technical: t('topicResearch.aiEdit.styles.technical'),
      };
      label += ` (${styleLabels[styleType]})`;
    }

    if (customInstruction) {
      label = t('topicResearch.aiEdit.customInstruction');
    }

    return label;
  }, [operation, styleType, customInstruction, t]);

  // Stats
  const stats = useMemo(() => {
    const originalLength = original.length;
    const editedLength = edited.length;
    const diff = editedLength - originalLength;
    const diffPercent = originalLength
      ? Math.round((diff / originalLength) * 100)
      : 0;

    return {
      originalLength,
      editedLength,
      diff,
      diffPercent,
    };
  }, [original, edited]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4">
      <div className="animate-in fade-in slide-in-from-bottom-4 relative w-full max-w-4xl rounded-xl bg-white shadow-2xl duration-300">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100">
              <svg
                className="h-5 w-5 text-purple-600"
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
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {t('topicResearch.aiEdit.aiEditPreview')}
              </h2>
              <p className="text-sm text-gray-500">{operationLabel}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            title={t('common.close')}
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Stats bar */}
        <div className="border-b border-gray-200 bg-gray-50 px-6 py-3">
          <div className="flex items-center gap-6 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-700">
                {t('topicResearch.aiEdit.original')}:
              </span>
              <span>
                {stats.originalLength} {t('topicResearch.aiEdit.chars')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-700">
                {t('topicResearch.aiEdit.edited')}:
              </span>
              <span>
                {stats.editedLength} {t('topicResearch.aiEdit.chars')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-700">
                {t('common.change')}:
              </span>
              <span
                className={
                  stats.diff > 0
                    ? 'text-green-600'
                    : stats.diff < 0
                      ? 'text-red-600'
                      : 'text-gray-600'
                }
              >
                {stats.diff > 0 ? '+' : ''}
                {stats.diff} {t('topicResearch.aiEdit.chars')} (
                {stats.diffPercent > 0 ? '+' : ''}
                {stats.diffPercent}%)
              </span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="max-h-[60vh] overflow-y-auto p-6">
          {/* Original text */}
          <div className="mb-6">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-700">
                {t('topicResearch.aiEdit.original')}
              </h3>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
                {original}
              </p>
            </div>
          </div>

          {/* Edited text with diff highlighting */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-700">
                {t('topicResearch.aiEdit.edited')}
              </h3>
              <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                {t('common.highlightChanges')}
              </span>
            </div>
            <div className="rounded-lg border border-purple-200 bg-purple-50/30 p-4">
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
                {diff.map((change, index) => {
                  if (change.type === 'equal') {
                    return (
                      <span key={index} className="text-gray-800">
                        {change.text}{' '}
                      </span>
                    );
                  } else if (change.type === 'insert') {
                    return (
                      <span
                        key={index}
                        className="rounded bg-green-200 px-0.5 text-green-900"
                      >
                        {change.text}{' '}
                      </span>
                    );
                  } else if (change.type === 'delete') {
                    return (
                      <span
                        key={index}
                        className="rounded bg-red-200 px-0.5 text-red-900 line-through"
                      >
                        {change.text}{' '}
                      </span>
                    );
                  }
                  return null;
                })}
              </div>
            </div>
          </div>

          {/* Custom instruction display */}
          {customInstruction && (
            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3">
              <p className="text-xs font-medium text-blue-700">
                {t('topicResearch.aiEdit.customInstruction')}:
              </p>
              <p className="mt-1 text-sm text-blue-900">{customInstruction}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4">
          <div className="flex items-center gap-2">
            <button
              onClick={onReject}
              disabled={isLoading}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('topicResearch.aiEdit.discardChanges')}
            </button>
            <button
              onClick={onRegenerate}
              disabled={isLoading}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
                  {t('topicResearch.aiEdit.aiProcessing')}
                </>
              ) : (
                <>
                  <svg
                    className="h-4 w-4"
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
                  {t('topicResearch.aiEdit.regenerate')}
                </>
              )}
            </button>
          </div>

          <button
            onClick={onAccept}
            disabled={isLoading}
            className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            {t('topicResearch.aiEdit.acceptChanges')}
          </button>
        </div>
      </div>
    </div>
  );
}
