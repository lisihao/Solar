'use client';

import { useState, useCallback, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { ClientDate } from '@/components/common/ClientDate';

interface MarkdownEditorProps {
  initialContent?: string;
  onChange?: (content: string) => void;
  onSave?: (content: string) => void;
  placeholder?: string;
  autoSave?: boolean;
  autoSaveInterval?: number; // in milliseconds
}

/**
 * Markdown编辑器组件
 *
 * 功能：
 * - 左右分栏：编辑器 + 实时预览
 * - 格式工具栏
 * - 自动保存
 * - 支持GitHub Flavored Markdown
 * - 代码高亮
 */
export default function MarkdownEditor({
  initialContent = '',
  onChange,
  onSave,
  placeholder = '在此输入Markdown内容...',
  autoSave = false,
  autoSaveInterval = 3000,
}: MarkdownEditorProps) {
  const [content, setContent] = useState(initialContent);
  const [viewMode, setViewMode] = useState<'split' | 'edit' | 'preview'>(
    'split'
  );
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Auto-save effect
  useEffect(() => {
    if (!autoSave || !onSave) return;

    const timer = setTimeout(() => {
      if (content !== initialContent) {
        onSave(content);
        setLastSaved(new Date());
      }
    }, autoSaveInterval);

    return () => clearTimeout(timer);
  }, [content, autoSave, autoSaveInterval, onSave, initialContent]);

  // Handle content change
  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
      onChange?.(newContent);
    },
    [onChange]
  );

  // Toolbar actions
  const insertMarkdown = useCallback(
    (before: string, after: string = '') => {
      const textarea = document.querySelector('textarea');
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = content.substring(start, end);
      const newContent =
        content.substring(0, start) +
        before +
        selectedText +
        after +
        content.substring(end);

      handleContentChange(newContent);

      // Restore focus and selection
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(
          start + before.length,
          start + before.length + selectedText.length
        );
      }, 0);
    },
    [content, handleContentChange]
  );

  const toolbarButtons = [
    { label: 'B', title: 'Bold', action: () => insertMarkdown('**', '**') },
    { label: 'I', title: 'Italic', action: () => insertMarkdown('*', '*') },
    {
      label: 'H1',
      title: 'Heading 1',
      action: () => insertMarkdown('\n# ', '\n'),
    },
    {
      label: 'H2',
      title: 'Heading 2',
      action: () => insertMarkdown('\n## ', '\n'),
    },
    {
      label: 'H3',
      title: 'Heading 3',
      action: () => insertMarkdown('\n### ', '\n'),
    },
    {
      label: 'Quote',
      title: 'Quote',
      action: () => insertMarkdown('\n> ', '\n'),
    },
    {
      label: 'Code',
      title: 'Inline Code',
      action: () => insertMarkdown('`', '`'),
    },
    {
      label: 'Code Block',
      title: 'Code Block',
      action: () => insertMarkdown('\n```\n', '\n```\n'),
    },
    {
      label: 'Link',
      title: 'Link',
      action: () => insertMarkdown('[', '](url)'),
    },
    {
      label: 'List',
      title: 'Bullet List',
      action: () => insertMarkdown('\n- ', '\n'),
    },
    {
      label: 'Numbered',
      title: 'Numbered List',
      action: () => insertMarkdown('\n1. ', '\n'),
    },
  ];

  return (
    <div className="flex h-full flex-col rounded-lg border border-gray-200 bg-white">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2">
        <div className="flex flex-wrap items-center gap-1">
          {toolbarButtons.map((btn, idx) => (
            <button
              key={idx}
              onClick={btn.action}
              title={btn.title}
              className="rounded px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200"
            >
              {btn.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex overflow-hidden rounded border border-gray-300">
            <button
              onClick={() => setViewMode('edit')}
              className={`px-3 py-1 text-xs ${viewMode === 'edit' ? 'bg-blue-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
            >
              编辑
            </button>
            <button
              onClick={() => setViewMode('split')}
              className={`px-3 py-1 text-xs ${viewMode === 'split' ? 'bg-blue-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
            >
              分栏
            </button>
            <button
              onClick={() => setViewMode('preview')}
              className={`px-3 py-1 text-xs ${viewMode === 'preview' ? 'bg-blue-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
            >
              预览
            </button>
          </div>

          {/* Save status */}
          {autoSave && lastSaved && (
            <span className="text-xs text-gray-500">
              已保存于 <ClientDate date={lastSaved} format="time" />
            </span>
          )}

          {/* Manual save button */}
          {onSave && (
            <button
              onClick={() => {
                onSave(content);
                setLastSaved(new Date());
              }}
              className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
            >
              保存
            </button>
          )}
        </div>
      </div>

      {/* Editor and Preview */}
      <div className="flex flex-1 overflow-hidden">
        {/* Editor */}
        {(viewMode === 'edit' || viewMode === 'split') && (
          <div
            className={`${viewMode === 'split' ? 'w-1/2' : 'w-full'} border-r border-gray-200`}
          >
            <textarea
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder={placeholder}
              className="font-mono h-full w-full resize-none p-4 text-sm focus:outline-none"
            />
          </div>
        )}

        {/* Preview */}
        {(viewMode === 'preview' || viewMode === 'split') && (
          <div
            className={`${viewMode === 'split' ? 'w-1/2' : 'w-full'} overflow-auto`}
          >
            <div className="prose prose-sm max-w-none p-4">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
              >
                {content || '*预览区域*'}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
