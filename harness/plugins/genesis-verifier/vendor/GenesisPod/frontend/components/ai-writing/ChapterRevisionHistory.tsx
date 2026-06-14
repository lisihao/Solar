'use client';

/**
 * ChapterRevisionHistory - 章节修订历史组件
 *
 * 功能:
 * - 展示章节的版本历史
 * - 版本对比 (diff view)
 * - 回滚到指定版本
 */

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  Pencil,
  Bot,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Palette,
  Download,
  RotateCcw,
  ClipboardList,
} from 'lucide-react';
import { confirm } from '@/stores';
import {
  getChapterRevisions,
  compareRevisions,
  rollbackRevision,
  type ChapterRevision,
  type RevisionDiff,
  type RevisionChangeType,
} from '@/services/ai-writing/api';
import { formatDateSafe } from '@/lib/utils/date';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { LoadingState } from '@/components/ui';

interface ChapterRevisionHistoryProps {
  chapterId: string;
  currentContent: string;
  onRollback?: (newContent: string) => void;
  onClose?: () => void;
}

// 修改类型的显示配置
const CHANGE_TYPE_CONFIG: Record<
  RevisionChangeType,
  { label: string; color: string; icon: ReactNode }
> = {
  MANUAL_EDIT: {
    label: '手动编辑',
    color: 'bg-blue-100 text-blue-700',
    icon: <Pencil className="h-3 w-3" />,
  },
  AI_REWRITE: {
    label: 'AI重写',
    color: 'bg-purple-100 text-purple-700',
    icon: <Bot className="h-3 w-3" />,
  },
  AI_POLISH: {
    label: 'AI润色',
    color: 'bg-pink-100 text-pink-700',
    icon: <Sparkles className="h-3 w-3" />,
  },
  AI_EXPAND: {
    label: 'AI扩写',
    color: 'bg-green-100 text-green-700',
    icon: <TrendingUp className="h-3 w-3" />,
  },
  AI_CONDENSE: {
    label: 'AI缩写',
    color: 'bg-orange-100 text-orange-700',
    icon: <TrendingDown className="h-3 w-3" />,
  },
  AI_STYLE_FIX: {
    label: '风格修正',
    color: 'bg-yellow-100 text-yellow-700',
    icon: <Palette className="h-3 w-3" />,
  },
  IMPORTED: {
    label: '导入',
    color: 'bg-gray-100 text-gray-700',
    icon: <Download className="h-3 w-3" />,
  },
  ROLLBACK: {
    label: '版本回滚',
    color: 'bg-red-100 text-red-700',
    icon: <RotateCcw className="h-3 w-3" />,
  },
};

export default function ChapterRevisionHistory({
  chapterId,
  onRollback,
  onClose,
}: ChapterRevisionHistoryProps) {
  const [revisions, setRevisions] = useState<ChapterRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRevisions, setSelectedRevisions] = useState<string[]>([]);
  const [diffData, setDiffData] = useState<RevisionDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'diff'>('list');

  // 加载修订历史
  const loadRevisions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await getChapterRevisions(chapterId);
      setRevisions(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载修订历史失败');
    } finally {
      setLoading(false);
    }
  }, [chapterId]);

  useEffect(() => {
    loadRevisions();
  }, [loadRevisions]);

  // 选择版本进行对比
  const handleSelectRevision = (revisionId: string) => {
    if (selectedRevisions.includes(revisionId)) {
      setSelectedRevisions(selectedRevisions.filter((id) => id !== revisionId));
    } else if (selectedRevisions.length < 2) {
      setSelectedRevisions([...selectedRevisions, revisionId]);
    } else {
      // 替换最早选择的
      setSelectedRevisions([selectedRevisions[1], revisionId]);
    }
  };

  // 执行版本对比
  const handleCompare = async () => {
    if (selectedRevisions.length !== 2) return;

    try {
      setDiffLoading(true);
      const diff = await compareRevisions(
        chapterId,
        selectedRevisions[0],
        selectedRevisions[1]
      );
      setDiffData(diff);
      setViewMode('diff');
    } catch (err) {
      setError(err instanceof Error ? err.message : '版本对比失败');
    } finally {
      setDiffLoading(false);
    }
  };

  // 回滚到指定版本
  const handleRollback = async (revisionId: string) => {
    if (
      !(await confirm({
        title: '确定要回滚到此版本吗？',
        description: '当前内容将被覆盖。',
        type: 'warning',
      }))
    )
      return;

    try {
      setRollbackLoading(true);
      const result = await rollbackRevision(chapterId, revisionId);
      onRollback?.(result.chapter.content);
      await loadRevisions(); // 刷新列表
    } catch (err) {
      setError(err instanceof Error ? err.message : '版本回滚失败');
    } finally {
      setRollbackLoading(false);
    }
  };

  // 格式化时间
  const formatTime = (dateStr: string) => {
    return formatDateSafe(dateStr, 'datetime-short');
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingState size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 p-4 text-red-600">
        <p className="font-medium">加载失败</p>
        <p className="text-sm">{error}</p>
        <button
          onClick={loadRevisions}
          className="mt-2 text-sm text-red-700 underline"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-gray-500" />
          <h3 className="font-semibold text-gray-800">修订历史</h3>
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            {revisions.length} 个版本
          </span>
        </div>
        <div className="flex items-center gap-2">
          {viewMode === 'diff' && (
            <button
              onClick={() => {
                setViewMode('list');
                setDiffData(null);
              }}
              className="rounded px-3 py-1 text-sm text-gray-600 hover:bg-gray-100"
            >
              ← 返回列表
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
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
          )}
        </div>
      </div>

      {/* 对比工具栏 */}
      {viewMode === 'list' && selectedRevisions.length > 0 && (
        <div className="flex items-center justify-between border-b border-gray-100 bg-violet-50 px-4 py-2">
          <span className="text-sm text-violet-700">
            已选择 {selectedRevisions.length} 个版本
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedRevisions([])}
              className="rounded px-3 py-1 text-sm text-gray-600 hover:bg-white"
            >
              清除选择
            </button>
            <button
              onClick={handleCompare}
              disabled={selectedRevisions.length !== 2 || diffLoading}
              className="rounded bg-violet-600 px-3 py-1 text-sm text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {diffLoading ? '对比中...' : '对比版本'}
            </button>
          </div>
        </div>
      )}

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-4">
        {viewMode === 'list' ? (
          // 版本列表
          <div className="space-y-2">
            {revisions.length === 0 ? (
              <EmptyState size="sm" title="暂无修订历史" />
            ) : (
              revisions.map((revision, index) => {
                const config = CHANGE_TYPE_CONFIG[revision.changeType];
                const isSelected = selectedRevisions.includes(revision.id);

                return (
                  <div
                    key={revision.id}
                    className={`rounded-lg border p-3 transition-colors ${
                      isSelected
                        ? 'border-violet-300 bg-violet-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleSelectRevision(revision.id)}
                          className="mt-1 h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded px-2 py-0.5 text-xs ${config.color}`}
                            >
                              {config.icon} {config.label}
                            </span>
                            <span className="text-sm text-gray-500">
                              v{revision.versionNumber}
                            </span>
                            {index === 0 && (
                              <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">
                                当前版本
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-gray-600">
                            {revision.changeSummary || '无描述'}
                          </p>
                          <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                            <span>{formatTime(revision.createdAt)}</span>
                            <span>
                              {revision.wordCount.toLocaleString()} 字
                            </span>
                          </div>
                        </div>
                      </div>
                      {index > 0 && (
                        <button
                          onClick={() => handleRollback(revision.id)}
                          disabled={rollbackLoading}
                          className="rounded px-2 py-1 text-xs text-violet-600 hover:bg-violet-100 disabled:opacity-50"
                        >
                          回滚
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          // Diff 视图
          diffData && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
                <div className="text-sm">
                  <span className="text-gray-500">对比:</span>{' '}
                  <span className="font-medium">
                    v{diffData.revision1.versionNumber} ↔ v
                    {diffData.revision2.versionNumber}
                  </span>
                </div>
                <div className="flex gap-4 text-xs">
                  <span className="text-green-600">
                    +{diffData.diff.additions.length} 新增
                  </span>
                  <span className="text-red-600">
                    -{diffData.diff.deletions.length} 删除
                  </span>
                  <span className="text-yellow-600">
                    ~{diffData.diff.changes.length} 修改
                  </span>
                </div>
              </div>

              {/* 新增内容 */}
              {diffData.diff.additions.length > 0 && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                  <h4 className="mb-2 text-sm font-medium text-green-700">
                    新增内容
                  </h4>
                  {diffData.diff.additions.map((text, i) => (
                    <p key={i} className="mb-1 text-sm text-green-800">
                      + {text}
                    </p>
                  ))}
                </div>
              )}

              {/* 删除内容 */}
              {diffData.diff.deletions.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <h4 className="mb-2 text-sm font-medium text-red-700">
                    删除内容
                  </h4>
                  {diffData.diff.deletions.map((text, i) => (
                    <p
                      key={i}
                      className="mb-1 text-sm text-red-800 line-through"
                    >
                      - {text}
                    </p>
                  ))}
                </div>
              )}

              {/* 修改内容 */}
              {diffData.diff.changes.length > 0 && (
                <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3">
                  <h4 className="mb-2 text-sm font-medium text-yellow-700">
                    修改内容
                  </h4>
                  {diffData.diff.changes.map((change, i) => (
                    <div key={i} className="mb-2 text-sm">
                      <p className="text-red-600 line-through">
                        {change.before}
                      </p>
                      <p className="text-green-600">{change.after}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}
