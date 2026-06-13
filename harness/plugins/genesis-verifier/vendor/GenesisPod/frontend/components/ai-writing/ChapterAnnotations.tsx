'use client';

/**
 * ChapterAnnotations - 章节批注组件
 *
 * 功能:
 * - 展示章节的批注列表
 * - 添加/编辑/删除批注
 * - 批量解决批注
 * - 支持不同类型批注（评论、建议、问题、引用）
 */

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  MessageSquare,
  Lightbulb,
  AlertTriangle,
  Paperclip,
  FileText,
  Check,
  RotateCcw,
  Pencil,
  Trash2,
} from 'lucide-react';
import { confirm } from '@/stores';
import {
  getChapterAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
  resolveAnnotations,
  type ChapterAnnotation,
  type AnnotationType,
  type AnnotationStatus,
} from '@/services/ai-writing/api';
import { formatDateSafe } from '@/lib/utils/date';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { LoadingState } from '@/components/ui';

interface ChapterAnnotationsProps {
  chapterId: string;
  chapterContent: string;
  onHighlightText?: (startOffset: number, endOffset: number) => void;
  onClose?: () => void;
}

// 批注类型配置
const ANNOTATION_TYPE_CONFIG: Record<
  AnnotationType,
  { label: string; color: string; icon: ReactNode }
> = {
  COMMENT: {
    label: '评论',
    color: 'bg-blue-100 text-blue-700 border-blue-200',
    icon: <MessageSquare className="h-3 w-3" />,
  },
  SUGGESTION: {
    label: '建议',
    color: 'bg-green-100 text-green-700 border-green-200',
    icon: <Lightbulb className="h-3 w-3" />,
  },
  ISSUE: {
    label: '问题',
    color: 'bg-red-100 text-red-700 border-red-200',
    icon: <AlertTriangle className="h-3 w-3" />,
  },
  REFERENCE: {
    label: '引用',
    color: 'bg-purple-100 text-purple-700 border-purple-200',
    icon: <Paperclip className="h-3 w-3" />,
  },
};

const STATUS_CONFIG: Record<
  AnnotationStatus,
  { label: string; color: string }
> = {
  OPEN: { label: '待处理', color: 'bg-yellow-100 text-yellow-700' },
  RESOLVED: { label: '已解决', color: 'bg-green-100 text-green-700' },
  DISMISSED: { label: '已忽略', color: 'bg-gray-100 text-gray-500' },
};

export default function ChapterAnnotations({
  chapterId,
  chapterContent,
  onHighlightText,
  onClose,
}: ChapterAnnotationsProps) {
  const [annotations, setAnnotations] = useState<ChapterAnnotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AnnotationStatus | 'ALL'>('ALL');
  const [isAdding, setIsAdding] = useState(false);
  const [newAnnotation, setNewAnnotation] = useState({
    content: '',
    type: 'COMMENT' as AnnotationType,
    selectedText: '',
    startOffset: 0,
    endOffset: 0,
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  // 加载批注
  const loadAnnotations = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const status = filter === 'ALL' ? undefined : filter;
      const result = await getChapterAnnotations(chapterId, status);
      setAnnotations(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载批注失败');
    } finally {
      setLoading(false);
    }
  }, [chapterId, filter]);

  useEffect(() => {
    loadAnnotations();
  }, [loadAnnotations]);

  // 添加批注
  const handleAddAnnotation = async () => {
    if (!newAnnotation.content.trim()) return;

    try {
      await createAnnotation(chapterId, {
        content: newAnnotation.content,
        type: newAnnotation.type,
        startOffset: newAnnotation.startOffset,
        endOffset: newAnnotation.endOffset,
        selectedText: newAnnotation.selectedText,
      });
      setIsAdding(false);
      setNewAnnotation({
        content: '',
        type: 'COMMENT',
        selectedText: '',
        startOffset: 0,
        endOffset: 0,
      });
      await loadAnnotations();
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加批注失败');
    }
  };

  // 更新批注
  const handleUpdateAnnotation = async (id: string, content: string) => {
    try {
      await updateAnnotation(chapterId, id, { content });
      setEditingId(null);
      await loadAnnotations();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新批注失败');
    }
  };

  // 更新状态
  const handleUpdateStatus = async (id: string, status: AnnotationStatus) => {
    try {
      await updateAnnotation(chapterId, id, { status });
      await loadAnnotations();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新状态失败');
    }
  };

  // 删除批注
  const handleDeleteAnnotation = async (id: string) => {
    if (!(await confirm({ title: '确定要删除此批注吗？', type: 'danger' })))
      return;

    try {
      await deleteAnnotation(chapterId, id);
      await loadAnnotations();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除批注失败');
    }
  };

  // 批量解决
  const handleBulkResolve = async () => {
    if (selectedIds.length === 0) return;

    try {
      await resolveAnnotations(chapterId, selectedIds);
      setSelectedIds([]);
      await loadAnnotations();
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量解决失败');
    }
  };

  // 选中文本时触发
  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    // 计算在章节内容中的偏移量
    const startOffset = chapterContent.indexOf(selectedText);
    if (startOffset === -1) return;

    setNewAnnotation({
      ...newAnnotation,
      selectedText,
      startOffset,
      endOffset: startOffset + selectedText.length,
    });
    setIsAdding(true);
  };

  // 格式化时间
  const formatTime = (dateStr: string) => {
    return formatDateSafe(dateStr, 'datetime-short');
  };

  // 过滤后的批注
  const filteredAnnotations =
    filter === 'ALL'
      ? annotations
      : annotations.filter((a) => a.status === filter);

  // 统计
  const stats = {
    total: annotations.length,
    open: annotations.filter((a) => a.status === 'OPEN').length,
    resolved: annotations.filter((a) => a.status === 'RESOLVED').length,
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingState size="lg" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-gray-500" />
          <h3 className="font-semibold text-gray-800">批注</h3>
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            {stats.open} 待处理 / {stats.total} 总计
          </span>
        </div>
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

      {/* 工具栏 */}
      <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2">
        {/* 过滤器 */}
        <div className="flex gap-1">
          {(['ALL', 'OPEN', 'RESOLVED', 'DISMISSED'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`rounded px-2 py-1 text-xs ${
                filter === status
                  ? 'bg-violet-600 text-white'
                  : 'text-gray-600 hover:bg-gray-200'
              }`}
            >
              {status === 'ALL' ? '全部' : STATUS_CONFIG[status].label}
            </button>
          ))}
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2">
          {selectedIds.length > 0 && (
            <button
              onClick={handleBulkResolve}
              className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700"
            >
              解决 ({selectedIds.length})
            </button>
          )}
          <button
            onClick={() => setIsAdding(true)}
            className="rounded bg-violet-600 px-2 py-1 text-xs text-white hover:bg-violet-700"
          >
            + 添加批注
          </button>
        </div>
      </div>

      {/* 添加批注表单 */}
      {isAdding && (
        <div className="border-b border-gray-100 bg-violet-50 p-4">
          {newAnnotation.selectedText && (
            <div className="mb-2 rounded bg-white p-2 text-sm text-gray-600">
              <span className="text-xs text-gray-400">选中文本:</span>
              <p className="mt-1 italic">
                &quot;{newAnnotation.selectedText}&quot;
              </p>
            </div>
          )}
          <div className="mb-2 flex gap-2">
            {Object.entries(ANNOTATION_TYPE_CONFIG).map(([type, config]) => (
              <button
                key={type}
                onClick={() =>
                  setNewAnnotation({
                    ...newAnnotation,
                    type: type as AnnotationType,
                  })
                }
                className={`rounded border px-2 py-1 text-xs ${
                  newAnnotation.type === type
                    ? config.color
                    : 'border-gray-200 bg-white text-gray-600'
                }`}
              >
                {config.icon} {config.label}
              </button>
            ))}
          </div>
          <textarea
            value={newAnnotation.content}
            onChange={(e) =>
              setNewAnnotation({ ...newAnnotation, content: e.target.value })
            }
            placeholder="输入批注内容..."
            className="mb-2 w-full rounded border border-gray-200 p-2 text-sm focus:border-violet-400 focus:outline-none"
            rows={3}
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setIsAdding(false);
                setNewAnnotation({
                  content: '',
                  type: 'COMMENT',
                  selectedText: '',
                  startOffset: 0,
                  endOffset: 0,
                });
              }}
              className="rounded px-3 py-1 text-sm text-gray-600 hover:bg-gray-100"
            >
              取消
            </button>
            <button
              onClick={handleAddAnnotation}
              disabled={!newAnnotation.content.trim()}
              className="rounded bg-violet-600 px-3 py-1 text-sm text-white hover:bg-violet-700 disabled:opacity-50"
            >
              添加
            </button>
          </div>
        </div>
      )}

      {/* 提示 */}
      <div className="flex items-center gap-1 border-b border-gray-100 bg-blue-50 px-4 py-2 text-xs text-blue-600">
        <Lightbulb className="h-3 w-3" /> 提示:
        在右侧内容区选中文本后，可添加针对该文本的批注
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 px-4 py-2 text-sm text-red-600">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            关闭
          </button>
        </div>
      )}

      {/* 批注列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        {filteredAnnotations.length === 0 ? (
          <EmptyState
            size="sm"
            title={
              filter === 'ALL'
                ? '暂无批注'
                : `没有${STATUS_CONFIG[filter].label}的批注`
            }
          />
        ) : (
          <div className="space-y-3">
            {filteredAnnotations.map((annotation) => {
              const typeConfig = ANNOTATION_TYPE_CONFIG[annotation.type];
              const statusConfig = STATUS_CONFIG[annotation.status];
              const isEditing = editingId === annotation.id;

              return (
                <div
                  key={annotation.id}
                  className={`rounded-lg border p-3 ${typeConfig.color.replace('text-', 'border-').split(' ')[2]} bg-white`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(annotation.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedIds([...selectedIds, annotation.id]);
                          } else {
                            setSelectedIds(
                              selectedIds.filter((id) => id !== annotation.id)
                            );
                          }
                        }}
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-violet-600"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded px-2 py-0.5 text-xs ${typeConfig.color}`}
                          >
                            {typeConfig.icon} {typeConfig.label}
                          </span>
                          <span
                            className={`rounded px-2 py-0.5 text-xs ${statusConfig.color}`}
                          >
                            {statusConfig.label}
                          </span>
                        </div>

                        {/* 选中的文本 */}
                        {annotation.selectedText && (
                          <button
                            onClick={() =>
                              onHighlightText?.(
                                annotation.startOffset,
                                annotation.endOffset
                              )
                            }
                            className="mt-2 w-full rounded bg-gray-50 p-2 text-left text-sm italic text-gray-500 hover:bg-gray-100"
                          >
                            &quot;{annotation.selectedText}&quot;
                          </button>
                        )}

                        {/* 批注内容 */}
                        {isEditing ? (
                          <div className="mt-2">
                            <textarea
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              className="w-full rounded border border-gray-200 p-2 text-sm"
                              rows={2}
                            />
                            <div className="mt-1 flex justify-end gap-2">
                              <button
                                onClick={() => setEditingId(null)}
                                className="text-xs text-gray-500 hover:text-gray-700"
                              >
                                取消
                              </button>
                              <button
                                onClick={() =>
                                  handleUpdateAnnotation(
                                    annotation.id,
                                    editContent
                                  )
                                }
                                className="text-xs text-violet-600 hover:text-violet-700"
                              >
                                保存
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="mt-2 text-sm text-gray-700">
                            {annotation.content}
                          </p>
                        )}

                        <div className="mt-2 text-xs text-gray-400">
                          {formatTime(annotation.createdAt)}
                          {annotation.resolvedAt && (
                            <span className="ml-2">
                              · 解决于 {formatTime(annotation.resolvedAt)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 操作菜单 */}
                    <div className="flex gap-1">
                      {annotation.status === 'OPEN' && (
                        <button
                          onClick={() =>
                            handleUpdateStatus(annotation.id, 'RESOLVED')
                          }
                          className="rounded p-1 text-green-600 hover:bg-green-50"
                          title="标记为已解决"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {annotation.status !== 'OPEN' && (
                        <button
                          onClick={() =>
                            handleUpdateStatus(annotation.id, 'OPEN')
                          }
                          className="rounded p-1 text-yellow-600 hover:bg-yellow-50"
                          title="重新打开"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setEditingId(annotation.id);
                          setEditContent(annotation.content);
                        }}
                        className="rounded p-1 text-gray-500 hover:bg-gray-100"
                        title="编辑"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteAnnotation(annotation.id)}
                        className="rounded p-1 text-red-500 hover:bg-red-50"
                        title="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
