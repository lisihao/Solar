'use client';

/**
 * Change Highlighter - 变更高亮组件
 *
 * 功能：根据变更数据为报告内容添加视觉标识
 * - 新增内容：绿色背景 (#E8F5E9)
 * - 修改内容：黄色背景 (#FFF8E1)
 * - 删除内容：红色背景 + 删除线 (#FFEBEE)
 * - 悬停显示 Checkin 按钮
 *
 * 参考: docs/prd/topic-research-report-editing.md
 */

import { useState, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useI18n } from '@/lib/i18n';

// Change type
export type ChangeType = 'ADDED' | 'MODIFIED' | 'DELETED';

// Report change
export interface ReportChange {
  id: string;
  sectionId?: string;
  sectionName?: string;
  changeType: ChangeType;
  previousContent?: string;
  currentContent: string;
  startOffset: number;
  endOffset: number;
  wordsDiff: number;
  checkedInAt?: string;
}

interface ChangeHighlighterProps {
  content: string;
  changes: ReportChange[];
  onCheckin: (changeId: string) => void;
  showChanges?: boolean;
}

// Icons
const CheckIcon = ({ className }: { className?: string }) => (
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
      d="M5 13l4 4L19 7"
    />
  </svg>
);

/**
 * Change Highlighter Component
 */
export function ChangeHighlighter({
  content,
  changes,
  onCheckin,
  showChanges = true,
}: ChangeHighlighterProps) {
  const { t } = useI18n();
  const [hoveredChangeId, setHoveredChangeId] = useState<string | null>(null);

  // ★ 安全处理：确保 changes 是数组
  const safeChanges = Array.isArray(changes) ? changes : [];

  // Filter out checked-in changes
  const activeChanges = useMemo(() => {
    return safeChanges.filter((change) => !change.checkedInAt);
  }, [safeChanges]);

  // Build segments from content and changes
  const segments = useMemo(() => {
    if (!showChanges || activeChanges.length === 0) {
      return [{ type: 'normal' as const, content }];
    }

    // Sort changes by start offset
    const sortedChanges = [...activeChanges].sort(
      (a, b) => a.startOffset - b.startOffset
    );

    const result: Array<{
      type: 'normal' | 'change';
      content: string;
      change?: ReportChange;
    }> = [];

    let currentOffset = 0;

    for (const change of sortedChanges) {
      // Add normal content before this change
      if (change.startOffset > currentOffset) {
        result.push({
          type: 'normal',
          content: content.slice(currentOffset, change.startOffset),
        });
      }

      // Add the change
      result.push({
        type: 'change',
        content: content.slice(change.startOffset, change.endOffset),
        change,
      });

      currentOffset = change.endOffset;
    }

    // Add remaining normal content
    if (currentOffset < content.length) {
      result.push({
        type: 'normal',
        content: content.slice(currentOffset),
      });
    }

    return result;
  }, [content, activeChanges, showChanges]);

  // Handle checkin
  const handleCheckin = useCallback(
    (changeId: string) => {
      onCheckin(changeId);
      setHoveredChangeId(null);
    },
    [onCheckin]
  );

  // Get change style class
  const getChangeClassName = (changeType: ChangeType): string => {
    switch (changeType) {
      case 'ADDED':
        return 'change-added';
      case 'MODIFIED':
        return 'change-modified';
      case 'DELETED':
        return 'change-deleted';
      default:
        return '';
    }
  };

  // Get change badge
  const getChangeBadge = (
    changeType: ChangeType,
    wordsDiff: number
  ): JSX.Element => {
    const badgeText =
      changeType === 'ADDED'
        ? `+${wordsDiff}`
        : changeType === 'MODIFIED'
          ? `±${Math.abs(wordsDiff)}`
          : `-${Math.abs(wordsDiff)}`;

    const badgeColor =
      changeType === 'ADDED'
        ? 'bg-green-500'
        : changeType === 'MODIFIED'
          ? 'bg-yellow-500'
          : 'bg-red-500';

    return (
      <span
        className={`change-badge absolute -top-2 right-1 rounded px-1.5 py-0.5 text-xs font-medium text-white ${badgeColor}`}
      >
        {badgeText}
      </span>
    );
  };

  return (
    <div className="change-highlighter">
      {segments.map((segment, index) => {
        if (segment.type === 'normal') {
          return (
            <div key={index} className="normal-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {segment.content}
              </ReactMarkdown>
            </div>
          );
        }

        // Change segment
        const { change } = segment;
        if (!change) return null;

        const isHovered = hoveredChangeId === change.id;

        return (
          <div
            key={change.id}
            className={`relative my-2 ${getChangeClassName(change.changeType)}`}
            onMouseEnter={() => setHoveredChangeId(change.id)}
            onMouseLeave={() => setHoveredChangeId(null)}
          >
            {/* Change badge */}
            {getChangeBadge(change.changeType, change.wordsDiff)}

            {/* Content */}
            <div className="px-2 py-1">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {segment.content}
              </ReactMarkdown>
            </div>

            {/* Checkin button (show on hover) */}
            {isHovered && change.changeType !== 'DELETED' && (
              <button
                onClick={() => handleCheckin(change.id)}
                className="checkin-btn absolute right-2 top-2 flex items-center gap-1 rounded bg-white px-2 py-1 text-xs font-medium text-gray-700 shadow-md transition-all hover:bg-gray-50"
                title={t('topicResearch.annotations.changes.confirmChange')}
              >
                <CheckIcon className="h-3 w-3" />
                <span>Checkin</span>
              </button>
            )}

            {/* Section name label */}
            {change.sectionName && (
              <div className="mt-1 text-xs text-gray-500">
                <span className="font-medium">{change.sectionName}</span>
              </div>
            )}
          </div>
        );
      })}

      {/* Styles */}
      <style jsx>{`
        .change-highlighter {
          @apply space-y-2;
        }

        .normal-content {
          @apply text-gray-800;
        }

        :global(.change-added) {
          background-color: #e8f5e9;
          border-left: 3px solid #4caf50;
          position: relative;
          border-radius: 4px;
        }

        :global(.change-modified) {
          background-color: #fff8e1;
          border-left: 3px solid #ffc107;
          position: relative;
          border-radius: 4px;
        }

        :global(.change-deleted) {
          background-color: #ffebee;
          border-left: 3px solid #f44336;
          text-decoration: line-through;
          color: #9e9e9e;
          position: relative;
          border-radius: 4px;
        }

        :global(.change-badge) {
          position: absolute;
          top: -8px;
          right: 4px;
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 4px;
        }

        :global(.checkin-btn) {
          display: none;
        }

        :global(.change-added:hover .checkin-btn),
        :global(.change-modified:hover .checkin-btn) {
          display: inline-flex;
        }
      `}</style>
    </div>
  );
}
