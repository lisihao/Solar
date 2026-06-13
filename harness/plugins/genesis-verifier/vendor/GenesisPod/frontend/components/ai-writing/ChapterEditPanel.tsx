'use client';

/**
 * ChapterEditPanel - 章节编辑面板
 *
 * 整合功能:
 * - 章节内容编辑 (支持 Markdown)
 * - 修订历史面板
 * - 批注侧边栏
 * - AI 辅助编辑工具
 */

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import {
  RotateCw,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Palette,
  ClipboardList,
  FileText,
  Bot,
} from 'lucide-react';
import { confirm } from '@/stores';
import ReactMarkdown from 'react-markdown';
import {
  updateChapterContent,
  aiEditChapter,
  type Chapter,
  type AiEditOperation,
} from '@/services/ai-writing/api';
import ChapterRevisionHistory from './ChapterRevisionHistory';
import ChapterAnnotations from './ChapterAnnotations';
import { LoadingInline } from '@/components/ui';

interface ChapterEditPanelProps {
  chapter: Chapter;
  onUpdate?: (chapter: Chapter) => void;
  onClose?: () => void;
}

type SidePanel = 'none' | 'revisions' | 'annotations';
type ViewMode = 'preview' | 'edit' | 'split';

const AI_OPERATIONS: Record<
  AiEditOperation,
  { label: string; icon: ReactNode; desc: string }
> = {
  rewrite: {
    label: '重写',
    icon: <RotateCw className="h-3.5 w-3.5" />,
    desc: '重新生成选中内容',
  },
  polish: {
    label: '润色',
    icon: <Sparkles className="h-3.5 w-3.5" />,
    desc: '优化文字表达',
  },
  expand: {
    label: '扩写',
    icon: <TrendingUp className="h-3.5 w-3.5" />,
    desc: '扩展内容细节',
  },
  condense: {
    label: '缩写',
    icon: <TrendingDown className="h-3.5 w-3.5" />,
    desc: '精简内容篇幅',
  },
  style_fix: {
    label: '风格修正',
    icon: <Palette className="h-3.5 w-3.5" />,
    desc: '调整写作风格',
  },
};

export default function ChapterEditPanel({
  chapter,
  onUpdate,
  onClose,
}: ChapterEditPanelProps) {
  const [content, setContent] = useState(chapter.content || '');
  const [originalContent, setOriginalContent] = useState(chapter.content || '');
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [sidePanel, setSidePanel] = useState<SidePanel>('none');
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<{
    start: number;
    end: number;
    text: string;
  } | null>(null);
  const [showAiMenu, setShowAiMenu] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const aiMenuRef = useRef<HTMLDivElement>(null);

  // 更新内容时检测变化
  useEffect(() => {
    setHasChanges(content !== originalContent);
  }, [content, originalContent]);

  // 同步外部章节变化
  useEffect(() => {
    if (chapter.content !== originalContent) {
      setContent(chapter.content || '');
      setOriginalContent(chapter.content || '');
    }
  }, [chapter.content, originalContent]);

  // 保存内容
  const handleSave = async () => {
    if (!hasChanges) return;

    try {
      setSaving(true);
      setError(null);

      const result = await updateChapterContent(chapter.id, {
        content,
        changeSummary: '手动编辑',
      });

      setOriginalContent(content);
      setHasChanges(false);
      onUpdate?.({
        ...chapter,
        content: result.chapter.content,
        wordCount: result.chapter.wordCount,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // 处理文本选择
  const handleTextSelect = useCallback(() => {
    const textarea = editorRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    if (start === end) {
      setSelection(null);
      setShowAiMenu(false);
      return;
    }

    const selectedText = content.substring(start, end);
    setSelection({ start, end, text: selectedText });
  }, [content]);

  // AI 编辑
  const handleAiEdit = async (operation: AiEditOperation) => {
    try {
      setAiLoading(true);
      setError(null);
      setShowAiMenu(false);

      // 如果没有选中内容，创建全文选择（兼容旧版后端）
      const effectiveSelection = selection
        ? {
            startOffset: selection.start,
            endOffset: selection.end,
            originalText: selection.text,
          }
        : {
            startOffset: 0,
            endOffset: content.length,
            originalText: content,
          };

      const result = await aiEditChapter(chapter.id, {
        operation,
        selection: effectiveSelection,
        userFeedback: aiPrompt || `执行${operation}操作`,
      });

      setContent(result.chapter.content);
      setOriginalContent(result.chapter.content);
      setSelection(null);
      setAiPrompt('');

      onUpdate?.({
        ...chapter,
        content: result.chapter.content,
        wordCount: result.chapter.wordCount,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 编辑失败');
    } finally {
      setAiLoading(false);
    }
  };

  // 回滚后更新
  const handleRollback = (newContent: string) => {
    setContent(newContent);
    setOriginalContent(newContent);
    onUpdate?.({
      ...chapter,
      content: newContent,
    });
  };

  // 高亮批注文本
  const handleHighlightText = (startOffset: number, endOffset: number) => {
    if (viewMode !== 'edit') {
      setViewMode('edit');
    }

    setTimeout(() => {
      const textarea = editorRef.current;
      if (!textarea) return;

      textarea.focus();
      textarea.setSelectionRange(startOffset, endOffset);
      textarea.scrollTop =
        (startOffset / content.length) * textarea.scrollHeight - 100;
    }, 100);
  };

  // 计算统计信息
  const wordCount = content.length;
  const charCount = content.replace(/\s/g, '').length;

  return (
    <div className="flex h-full flex-col bg-white">
      {/* 头部工具栏 */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold text-gray-800">
            第{chapter.chapterNumber}章 {chapter.title}
          </h2>
          {hasChanges && (
            <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700">
              未保存
            </span>
          )}
          <span className="text-xs text-gray-400">
            {wordCount.toLocaleString()} 字 / {charCount.toLocaleString()} 字符
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* 视图切换 */}
          <div className="flex rounded-lg border border-gray-200 p-0.5">
            {(['preview', 'edit', 'split'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`rounded px-2 py-1 text-xs ${
                  viewMode === mode
                    ? 'bg-violet-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {mode === 'preview'
                  ? '预览'
                  : mode === 'edit'
                    ? '编辑'
                    : '分屏'}
              </button>
            ))}
          </div>

          {/* 功能按钮 */}
          <button
            onClick={() =>
              setSidePanel(sidePanel === 'revisions' ? 'none' : 'revisions')
            }
            className={`flex items-center gap-1 rounded px-2 py-1 text-sm ${
              sidePanel === 'revisions'
                ? 'bg-violet-100 text-violet-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <ClipboardList className="h-3.5 w-3.5" /> 历史
          </button>
          <button
            onClick={() =>
              setSidePanel(sidePanel === 'annotations' ? 'none' : 'annotations')
            }
            className={`flex items-center gap-1 rounded px-2 py-1 text-sm ${
              sidePanel === 'annotations'
                ? 'bg-violet-100 text-violet-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <FileText className="h-3.5 w-3.5" /> 批注
          </button>

          {/* 保存按钮 - 始终显示 */}
          <button
            onClick={handleSave}
            disabled={saving || !content}
            className={`rounded px-3 py-1 text-sm ${
              hasChanges
                ? 'bg-violet-600 text-white hover:bg-violet-700'
                : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
            } disabled:opacity-50`}
          >
            {saving ? '保存中...' : hasChanges ? '保存' : '已保存'}
          </button>

          {/* 关闭按钮 */}
          {onClose && (
            <button
              onClick={() => {
                if (hasChanges) {
                  void (async () => {
                    if (
                      await confirm({
                        title: '有未保存的更改，确定要关闭吗？',
                        type: 'warning',
                      })
                    ) {
                      onClose();
                    }
                  })();
                } else {
                  onClose();
                }
              }}
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

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 px-4 py-2 text-sm text-red-600">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            关闭
          </button>
        </div>
      )}

      {/* AI 加载中 */}
      {aiLoading && (
        <div className="bg-violet-50 px-4 py-2">
          <LoadingInline
            text="AI 正在处理..."
            className="text-sm text-violet-700"
          />
        </div>
      )}

      {/* 主内容区 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 编辑/预览区 */}
        <div
          className={`flex-1 overflow-hidden ${sidePanel !== 'none' ? 'border-r border-gray-200' : ''}`}
        >
          <div className={`flex h-full ${viewMode === 'split' ? 'gap-0' : ''}`}>
            {/* 编辑区 */}
            {(viewMode === 'edit' || viewMode === 'split') && (
              <div
                className={`flex flex-col ${viewMode === 'split' ? 'w-1/2 border-r border-gray-100' : 'flex-1'}`}
              >
                {/* AI 工具栏 */}
                <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
                  <span className="text-xs text-gray-500">AI 工具:</span>
                  <div className="relative" ref={aiMenuRef}>
                    <button
                      onClick={() => setShowAiMenu(!showAiMenu)}
                      disabled={aiLoading}
                      className="flex items-center gap-1 rounded bg-violet-100 px-2 py-1 text-xs text-violet-700 hover:bg-violet-200 disabled:opacity-50"
                    >
                      <Bot className="h-3.5 w-3.5" />{' '}
                      {selection ? '编辑选中' : '编辑全文'}
                    </button>

                    {showAiMenu && (
                      <div className="absolute left-0 top-full z-10 mt-1 w-64 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
                        {selection && (
                          <div className="mb-2 rounded bg-gray-50 p-2 text-xs text-gray-600">
                            已选中: &quot;{selection.text.slice(0, 50)}
                            {selection.text.length > 50 ? '...' : ''}&quot;
                          </div>
                        )}
                        <input
                          type="text"
                          value={aiPrompt}
                          onChange={(e) => setAiPrompt(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && aiPrompt.trim()) {
                              e.preventDefault();
                              // 智能检测操作类型
                              const prompt = aiPrompt.toLowerCase();
                              let operation: AiEditOperation = 'rewrite';
                              if (
                                prompt.includes('扩写') ||
                                prompt.includes('expand') ||
                                prompt.includes('扩展')
                              ) {
                                operation = 'expand';
                              } else if (
                                prompt.includes('缩写') ||
                                prompt.includes('精简') ||
                                prompt.includes('condense')
                              ) {
                                operation = 'condense';
                              } else if (
                                prompt.includes('润色') ||
                                prompt.includes('polish') ||
                                prompt.includes('优化')
                              ) {
                                operation = 'polish';
                              } else if (
                                prompt.includes('风格') ||
                                prompt.includes('style')
                              ) {
                                operation = 'style_fix';
                              }
                              handleAiEdit(operation);
                            }
                          }}
                          placeholder="输入要求后按回车执行（如：扩写到3000字）"
                          className="mb-2 w-full rounded border border-gray-200 px-2 py-1 text-sm"
                          autoFocus
                        />
                        <p className="mb-2 text-xs text-gray-400">
                          按回车自动识别操作，或点击下方按钮选择
                        </p>
                        <div className="grid grid-cols-2 gap-1">
                          {Object.entries(AI_OPERATIONS).map(
                            ([key, config]) => (
                              <button
                                key={key}
                                onClick={() =>
                                  handleAiEdit(key as AiEditOperation)
                                }
                                className="flex items-center gap-1 rounded p-1.5 text-left text-xs hover:bg-gray-100"
                              >
                                <span>{config.icon}</span>
                                <span>{config.label}</span>
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  {selection && (
                    <span className="text-xs text-gray-400">
                      已选中 {selection.text.length} 字
                    </span>
                  )}
                </div>

                {/* 编辑器 */}
                <textarea
                  ref={editorRef}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onSelect={handleTextSelect}
                  onBlur={() => setTimeout(() => setShowAiMenu(false), 200)}
                  className="font-mono flex-1 resize-none p-4 text-sm leading-relaxed focus:outline-none"
                  placeholder="开始编写章节内容..."
                />
              </div>
            )}

            {/* 预览区 */}
            {(viewMode === 'preview' || viewMode === 'split') && (
              <div
                className={`overflow-y-auto ${viewMode === 'split' ? 'w-1/2' : 'flex-1'} p-4`}
              >
                {content ? (
                  <article className="prose prose-sm max-w-none">
                    <ReactMarkdown>{content}</ReactMarkdown>
                  </article>
                ) : (
                  <div className="py-8 text-center text-gray-400">暂无内容</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 侧边面板 */}
        {sidePanel !== 'none' && (
          <div className="w-80 flex-shrink-0 overflow-hidden">
            {sidePanel === 'revisions' && (
              <ChapterRevisionHistory
                chapterId={chapter.id}
                currentContent={content}
                onRollback={handleRollback}
                onClose={() => setSidePanel('none')}
              />
            )}
            {sidePanel === 'annotations' && (
              <ChapterAnnotations
                chapterId={chapter.id}
                chapterContent={content}
                onHighlightText={handleHighlightText}
                onClose={() => setSidePanel('none')}
              />
            )}
          </div>
        )}
      </div>

      {/* 底部状态栏 */}
      <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-1 text-xs text-gray-500">
        <div className="flex gap-4">
          <span>字数: {wordCount.toLocaleString()}</span>
          <span>字符: {charCount.toLocaleString()}</span>
          {selection && <span>选中: {selection.text.length}</span>}
        </div>
        <div className="flex gap-4">
          <span>Ctrl+S 保存</span>
          <span>选中文本后可使用 AI 工具</span>
        </div>
      </div>
    </div>
  );
}
