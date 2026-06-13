'use client';

/**
 * Text Selection Context Menu Component
 *
 * 文本选择右键上下文菜单:
 * - 右键或选中文字时显示
 * - 支持 AI 编辑操作
 * - 支持添加批注
 * - 支持复制
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { AIEditOperation } from '../types';

// Annotation color options
type AnnotationColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple';

// SelectionInfo 已下沉到 lib/text-selection/types.ts 作为平台能力。
// 此处 re-export 保留向后兼容。
export type { SelectionInfo } from '@/lib/text-selection/types';
import type { SelectionInfo } from '@/lib/text-selection/types';

interface TextSelectionContextMenuProps {
  /** Container element reference */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /**
   * AI edit callback - triggers when user clicks "AI Edit"
   * Opens the AI Edit modal with the selected text
   * (New API - preferred)
   */
  onOpenAIEdit?: (selection: SelectionInfo) => void;
  /**
   * Legacy AI edit callback with preset operations
   * @deprecated Use onOpenAIEdit instead for the new modal-based flow
   */
  onAIEdit?: (operation: AIEditOperation, selectedText: string) => void;
  /** Add annotation callback */
  onAddAnnotation?: (data: {
    selectedText: string;
    startOffset: number;
    endOffset: number;
    color: AnnotationColor;
    /** Context before the selection for reliable matching */
    selectorPrefix?: string;
    /** Context after the selection for reliable matching */
    selectorSuffix?: string;
  }) => void;
  /** Whether AI operations are processing */
  isAIProcessing?: boolean;
}

// Color config for annotation
const ANNOTATION_COLORS: {
  color: AnnotationColor;
  label: string;
  bgClass: string;
}[] = [
  { color: 'yellow', label: '黄色', bgClass: 'bg-yellow-400' },
  { color: 'green', label: '绿色', bgClass: 'bg-green-400' },
  { color: 'blue', label: '蓝色', bgClass: 'bg-blue-400' },
  { color: 'pink', label: '粉色', bgClass: 'bg-pink-400' },
  { color: 'purple', label: '紫色', bgClass: 'bg-purple-400' },
];

// AI operation configs for legacy mode
const AI_OPERATIONS: {
  operation: AIEditOperation;
  icon: string;
  label: string;
}[] = [
  { operation: 'rewrite', icon: '🔄', label: '重写' },
  { operation: 'polish', icon: '✨', label: '润色' },
  { operation: 'expand', icon: '📈', label: '扩展' },
  { operation: 'compress', icon: '📉', label: '压缩' },
];

export function TextSelectionContextMenu({
  containerRef,
  onOpenAIEdit,
  onAIEdit,
  onAddAnnotation,
  isAIProcessing = false,
}: TextSelectionContextMenuProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [selectedText, setSelectedText] = useState('');
  const [selectionRange, setSelectionRange] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [showAnnotationColors, setShowAnnotationColors] = useState(false);
  const [showAIMenu, setShowAIMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const annotationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const aiMenuTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Determine which AI edit mode to use
  const useLegacyMode = !onOpenAIEdit && onAIEdit;

  // Handle context menu (right-click)
  const handleContextMenu = useCallback(
    (e: MouseEvent) => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();

      if (!text || !containerRef.current?.contains(e.target as Node)) {
        return;
      }

      e.preventDefault();

      // Get selection range for annotation
      const range = selection?.getRangeAt(0);
      let startOffset = 0;
      let endOffset = 0;

      if (range && containerRef.current) {
        // Calculate relative offset within container
        const preSelectionRange = document.createRange();
        preSelectionRange.selectNodeContents(containerRef.current);
        preSelectionRange.setEnd(range.startContainer, range.startOffset);
        startOffset = preSelectionRange.toString().length;
        endOffset = startOffset + text.length;
      }

      setSelectedText(text);
      setSelectionRange({ start: startOffset, end: endOffset });
      setPosition({ x: e.clientX, y: e.clientY });
      setVisible(true);
      setShowAnnotationColors(false);
      setShowAIMenu(false);
    },
    [containerRef]
  );

  // Close menu when clicking outside
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
      setVisible(false);
    }
  }, []);

  // Close menu on escape
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setVisible(false);
    }
  }, []);

  // Setup event listeners
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      container.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [containerRef, handleContextMenu, handleClickOutside, handleKeyDown]);

  // Handle opening AI edit modal
  const handleOpenAIEdit = useCallback(() => {
    if (onOpenAIEdit && selectedText && selectionRange) {
      // Extract context for reliable matching
      const containerText = containerRef.current?.textContent || '';
      const contextLength = 50;

      // Get prefix (text before selection)
      const prefix = containerText.slice(
        Math.max(0, selectionRange.start - contextLength),
        selectionRange.start
      );

      // Get suffix (text after selection)
      const suffix = containerText.slice(
        selectionRange.end,
        Math.min(containerText.length, selectionRange.end + contextLength)
      );

      onOpenAIEdit({
        text: selectedText,
        startOffset: selectionRange.start,
        endOffset: selectionRange.end,
        selectorPrefix: prefix,
        selectorSuffix: suffix,
      });
      setVisible(false);
    }
  }, [onOpenAIEdit, selectedText, selectionRange, containerRef]);

  // Handle AI operation (legacy mode with preset operations submenu)
  const handleAIOperation = useCallback(
    (operation: AIEditOperation) => {
      if (onAIEdit && selectedText) {
        onAIEdit(operation, selectedText);
        setVisible(false);
      }
    },
    [onAIEdit, selectedText]
  );

  // Handle add annotation
  const handleAddAnnotation = useCallback(
    (color: AnnotationColor) => {
      if (onAddAnnotation && selectedText && selectionRange) {
        // Extract context for reliable matching
        const containerText = containerRef.current?.textContent || '';
        const contextLength = 50;

        // Get prefix (text before selection)
        const prefix = containerText.slice(
          Math.max(0, selectionRange.start - contextLength),
          selectionRange.start
        );

        // Get suffix (text after selection)
        const suffix = containerText.slice(
          selectionRange.end,
          Math.min(containerText.length, selectionRange.end + contextLength)
        );

        onAddAnnotation({
          selectedText,
          startOffset: selectionRange.start,
          endOffset: selectionRange.end,
          color,
          selectorPrefix: prefix,
          selectorSuffix: suffix,
        });
        setVisible(false);
      }
    },
    [onAddAnnotation, selectedText, selectionRange, containerRef]
  );

  // Handle copy
  const handleCopy = useCallback(() => {
    if (selectedText) {
      navigator.clipboard.writeText(selectedText);
      setVisible(false);
    }
  }, [selectedText]);

  if (!visible) return null;

  // Adjust position to stay within viewport
  const adjustedPosition = {
    x: Math.max(10, Math.min(position.x, window.innerWidth - 200)),
    y: Math.max(10, Math.min(position.y, window.innerHeight - 300)),
  };

  return (
    <div
      ref={menuRef}
      className="animate-in fade-in slide-in-from-top-2 fixed z-[1000] duration-150"
      style={{
        left: `${adjustedPosition.x}px`,
        top: `${adjustedPosition.y}px`,
        transform: 'translateX(-50%)',
      }}
    >
      <div className="min-w-[180px] rounded-lg border border-gray-200 bg-white py-1 shadow-xl">
        {/* Selected text preview */}
        <div className="border-b border-gray-100 px-3 py-2">
          <p className="max-w-[200px] truncate text-xs text-gray-400">
            已选中: "
            {selectedText.length > 30
              ? selectedText.slice(0, 30) + '...'
              : selectedText}
            "
          </p>
        </div>

        {/* Copy */}
        <button
          onClick={handleCopy}
          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
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
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
          复制
        </button>

        {/* Divider */}
        <div className="my-1 border-t border-gray-100" />

        {/* Add Annotation */}
        {onAddAnnotation && (
          <div
            className="relative"
            onMouseEnter={() => {
              // Clear any pending close timeout
              if (annotationTimeoutRef.current) {
                clearTimeout(annotationTimeoutRef.current);
                annotationTimeoutRef.current = null;
              }
              setShowAnnotationColors(true);
              setShowAIMenu(false);
            }}
            onMouseLeave={() => {
              // Delay closing to allow mouse to move to submenu
              annotationTimeoutRef.current = setTimeout(() => {
                setShowAnnotationColors(false);
              }, 150);
            }}
          >
            <button className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
              <div className="flex items-center gap-2">
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
                    d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
                  />
                </svg>
                添加批注
              </div>
              <svg
                className="h-3 w-3"
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
            </button>

            {/* Color picker submenu */}
            {showAnnotationColors && (
              <div
                className="absolute left-full top-0 z-[1001] ml-1 min-w-[140px] rounded-lg border border-gray-200 bg-white py-2 shadow-lg"
                onMouseEnter={() => {
                  // Keep submenu open when mouse enters it
                  if (annotationTimeoutRef.current) {
                    clearTimeout(annotationTimeoutRef.current);
                    annotationTimeoutRef.current = null;
                  }
                }}
                onMouseLeave={() => {
                  // Close when leaving submenu
                  setShowAnnotationColors(false);
                }}
              >
                <p className="px-3 pb-2 text-xs text-gray-400">选择高亮颜色</p>
                <div className="flex gap-2 px-3">
                  {ANNOTATION_COLORS.map((item) => (
                    <button
                      key={item.color}
                      onClick={() => handleAddAnnotation(item.color)}
                      title={item.label}
                      className={`h-6 w-6 rounded-full ${item.bgClass} border-2 border-white shadow-sm transition-transform hover:scale-110`}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* AI Edit - New mode: Single entry that opens the AI Edit modal */}
        {onOpenAIEdit && (
          <button
            onClick={handleOpenAIEdit}
            disabled={isAIProcessing}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
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
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
              />
            </svg>
            AI 编辑
            {isAIProcessing && (
              <div className="ml-auto h-3 w-3 animate-spin rounded-full border border-purple-600 border-t-transparent" />
            )}
          </button>
        )}

        {/* AI Edit - Legacy mode: Submenu with preset operations */}
        {useLegacyMode && (
          <div
            className="relative"
            onMouseEnter={() => {
              // Clear any pending close timeout
              if (aiMenuTimeoutRef.current) {
                clearTimeout(aiMenuTimeoutRef.current);
                aiMenuTimeoutRef.current = null;
              }
              setShowAIMenu(true);
              setShowAnnotationColors(false);
            }}
            onMouseLeave={() => {
              // Delay closing to allow mouse to move to submenu
              aiMenuTimeoutRef.current = setTimeout(() => {
                setShowAIMenu(false);
              }, 150);
            }}
          >
            <button
              disabled={isAIProcessing}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <div className="flex items-center gap-2">
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
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                  />
                </svg>
                AI 编辑
                {isAIProcessing && (
                  <div className="h-3 w-3 animate-spin rounded-full border border-purple-600 border-t-transparent" />
                )}
              </div>
              <svg
                className="h-3 w-3"
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
            </button>

            {/* AI operations submenu */}
            {showAIMenu && (
              <div
                className="absolute left-full top-0 z-[1001] ml-1 min-w-[120px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                onMouseEnter={() => {
                  // Keep submenu open when mouse enters it
                  if (aiMenuTimeoutRef.current) {
                    clearTimeout(aiMenuTimeoutRef.current);
                    aiMenuTimeoutRef.current = null;
                  }
                }}
                onMouseLeave={() => {
                  // Close when leaving submenu
                  setShowAIMenu(false);
                }}
              >
                {AI_OPERATIONS.map((item) => (
                  <button
                    key={item.operation}
                    onClick={() => handleAIOperation(item.operation)}
                    disabled={isAIProcessing}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <span>{item.icon}</span>
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
