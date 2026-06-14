/**
 * TimelineConflictPanel - 章节时间线冲突面板
 *
 * 在章节编辑器侧边栏显示当前章节的时间线冲突
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  ChevronRight,
  X,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/states/EmptyState';
import {
  getChapterTimelineConflicts,
  type TimelineConflict,
} from '@/services/ai-writing/api';

interface TimelineConflictPanelProps {
  chapterId: string;
  chapterNumber: number;
  onClose?: () => void;
  onJumpToChapter?: (chapterNumber: number) => void;
}

export function TimelineConflictPanel({
  chapterId,
  chapterNumber,
  onClose,
  onJumpToChapter,
}: TimelineConflictPanelProps) {
  const [conflicts, setConflicts] = useState<TimelineConflict[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchConflicts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getChapterTimelineConflicts(chapterId);
      setConflicts(data.conflicts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conflicts');
    } finally {
      setLoading(false);
    }
  }, [chapterId]);

  useEffect(() => {
    fetchConflicts();
  }, [fetchConflicts]);

  const getSeverityConfig = (severity: string) => {
    switch (severity) {
      case 'HIGH':
        return {
          color: 'text-red-600',
          bg: 'bg-red-50',
          border: 'border-red-200',
          icon: <AlertTriangle className="h-4 w-4 text-red-500" />,
          label: 'High',
        };
      case 'MEDIUM':
        return {
          color: 'text-yellow-600',
          bg: 'bg-yellow-50',
          border: 'border-yellow-200',
          icon: <AlertCircle className="h-4 w-4 text-yellow-500" />,
          label: 'Medium',
        };
      default:
        return {
          color: 'text-gray-600',
          bg: 'bg-gray-50',
          border: 'border-gray-200',
          icon: <Clock className="h-4 w-4 text-gray-400" />,
          label: 'Low',
        };
    }
  };

  // Memoized severity counts to avoid recalculation on every render
  const severityCounts = useMemo(() => {
    const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    conflicts.forEach((c) => {
      if (c.severity in counts) {
        counts[c.severity as keyof typeof counts]++;
      }
    });
    return counts;
  }, [conflicts]);

  const {
    HIGH: highCount,
    MEDIUM: mediumCount,
    LOW: lowCount,
  } = severityCounts;

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-yellow-500" />
          <h3 className="font-semibold text-gray-900">Timeline Conflicts</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchConflicts}
            disabled={loading}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            title="Refresh"
            aria-label="Refresh timeline conflicts"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Close panel"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="border-b border-gray-100 px-4 py-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">Chapter {chapterNumber}</span>
          <div className="flex gap-2">
            {highCount > 0 && (
              <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                {highCount} High
              </span>
            )}
            {mediumCount > 0 && (
              <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                {mediumCount} Med
              </span>
            )}
            {lowCount > 0 && (
              <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                {lowCount} Low
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && conflicts.length === 0 ? (
          <div className="flex items-center justify-center p-8">
            <RefreshCw className="h-5 w-5 animate-spin text-gray-400" />
            <span className="ml-2 text-sm text-gray-500">Analyzing...</span>
          </div>
        ) : error ? (
          <div className="p-4">
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          </div>
        ) : conflicts.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<CheckCircle className="h-8 w-8" />}
            title="No Conflicts"
            description="This chapter has no timeline conflicts"
          />
        ) : (
          <div className="p-2">
            {conflicts.map((conflict) => {
              const config = getSeverityConfig(conflict.severity);
              const isExpanded = expandedId === conflict.id;

              return (
                <div
                  key={conflict.id}
                  className={`mb-2 overflow-hidden rounded-lg border ${config.border}`}
                >
                  <button
                    onClick={() =>
                      setExpandedId(isExpanded ? null : conflict.id)
                    }
                    className={`flex w-full items-start gap-2 p-3 text-left ${config.bg}`}
                  >
                    {config.icon}
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className={`font-medium ${config.color}`}>
                          {conflict.subject}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs ${config.bg} ${config.color}`}
                        >
                          {config.label}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-gray-600">
                        {conflict.description}
                      </p>
                    </div>
                    <ChevronRight
                      className={`h-4 w-4 text-gray-400 transition-transform ${
                        isExpanded ? 'rotate-90' : ''
                      }`}
                    />
                  </button>

                  {isExpanded && (
                    <div className="border-t border-gray-200 bg-white p-3">
                      {/* Conflicting Statements */}
                      <div className="mb-3">
                        <h5 className="mb-2 text-xs font-medium uppercase text-gray-500">
                          Conflicting Statements
                        </h5>
                        <div className="space-y-2">
                          {conflict.conflictingStatements.map(
                            (statement, idx) => (
                              <div
                                key={idx}
                                className="rounded border-l-2 border-gray-300 bg-gray-50 p-2 text-sm text-gray-700"
                              >
                                {statement}
                              </div>
                            )
                          )}
                        </div>
                      </div>

                      {/* Source Info */}
                      <div className="mb-3 flex items-center gap-4 text-sm">
                        <span className="text-gray-500">
                          Source: Chapter {conflict.sourceChapter}
                        </span>
                        {conflict.targetChapter !== undefined && (
                          <>
                            <span className="text-gray-300">|</span>
                            <button
                              onClick={() => {
                                if (conflict.targetChapter !== undefined) {
                                  onJumpToChapter?.(conflict.targetChapter);
                                }
                              }}
                              className="text-blue-600 hover:text-blue-800"
                            >
                              Jump to Chapter {conflict.targetChapter}
                            </button>
                          </>
                        )}
                      </div>

                      {/* Suggested Resolution */}
                      {conflict.suggestedResolution && (
                        <div className="rounded-md bg-blue-50 p-2">
                          <h5 className="mb-1 text-xs font-medium text-blue-700">
                            Suggested Resolution
                          </h5>
                          <p className="text-sm text-blue-600">
                            {conflict.suggestedResolution}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default TimelineConflictPanel;
