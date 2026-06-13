'use client';

/**
 * AI Floating Toolbar Component
 *
 * 参考 PRD: docs/prd/topic-research-report-editing.md
 *
 * 功能:
 * - 选中文本时在选区附近显示工具栏
 * - 提供 5 种预设 AI 编辑操作：重写、润色、扩展、压缩、风格
 * - 支持自定义指令输入
 * - 位置自动适应（不超出视口）
 * - 移动端适配
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useI18n } from '@/lib/i18n';
import type { AIEditOperation } from './types';

// Text selection info with DOMRect for positioning
export interface TextSelectionWithRect {
  text: string;
  startOffset: number;
  endOffset: number;
  rect: DOMRect;
}

// Style type for style operation
export type StyleType = 'academic' | 'business' | 'casual' | 'technical';

// AI edit operation request (extends base type with additional options)
export interface AIEditOperationRequest {
  operation: AIEditOperation;
  customInstruction?: string;
  styleType?: StyleType;
}

interface AIFloatingToolbarProps {
  selection: TextSelectionWithRect | null;
  onOperation: (request: AIEditOperationRequest) => void;
  isLoading?: boolean;
  containerRef: React.RefObject<HTMLElement>;
  className?: string;
}

// Operation button icon mapping
const OPERATION_ICONS: Record<AIEditOperation, string> = {
  rewrite: '🔄',
  polish: '✨',
  expand: '📈',
  compress: '📉',
  style: '🎨',
};

export function AIFloatingToolbar({
  selection,
  onOperation,
  isLoading = false,
  containerRef,
  className = '',
}: AIFloatingToolbarProps) {
  const { t } = useI18n();
  const [showStyleMenu, setShowStyleMenu] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customInstruction, setCustomInstruction] = useState('');
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [placement, setPlacement] = useState<'top' | 'bottom'>('top');

  const toolbarRef = useRef<HTMLDivElement>(null);

  // Operation buttons with i18n
  const operationButtons: {
    operation: AIEditOperation;
    icon: string;
    label: string;
    description: string;
  }[] = [
    {
      operation: 'rewrite',
      icon: OPERATION_ICONS.rewrite,
      label: t('topicResearch.aiEdit.rewrite'),
      description: t('topicResearch.aiEdit.rewriteDesc'),
    },
    {
      operation: 'polish',
      icon: OPERATION_ICONS.polish,
      label: t('topicResearch.aiEdit.polish'),
      description: t('topicResearch.aiEdit.polishDesc'),
    },
    {
      operation: 'expand',
      icon: OPERATION_ICONS.expand,
      label: t('topicResearch.aiEdit.expand'),
      description: t('topicResearch.aiEdit.expandDesc'),
    },
    {
      operation: 'compress',
      icon: OPERATION_ICONS.compress,
      label: t('topicResearch.aiEdit.compress'),
      description: t('topicResearch.aiEdit.compressDesc'),
    },
    {
      operation: 'style',
      icon: OPERATION_ICONS.style,
      label: t('topicResearch.aiEdit.style'),
      description: t('topicResearch.aiEdit.styleDesc'),
    },
  ];

  // Style options with i18n
  const styleOptions: { type: StyleType; label: string }[] = [
    { type: 'academic', label: t('topicResearch.aiEdit.styles.academic') },
    { type: 'business', label: t('topicResearch.aiEdit.styles.business') },
    { type: 'casual', label: t('topicResearch.aiEdit.styles.casual') },
    { type: 'technical', label: t('topicResearch.aiEdit.styles.technical') },
  ];

  // Extract primitive values from selection for stable dependencies
  const hasSelection = selection !== null;
  const selectionRectTop = selection?.rect.top ?? 0;
  const selectionRectBottom = selection?.rect.bottom ?? 0;
  const selectionRectLeft = selection?.rect.left ?? 0;
  const selectionRectWidth = selection?.rect.width ?? 0;

  // Check if mobile
  const isMobile = useCallback(() => {
    return window.innerWidth < 768;
  }, []);

  // Calculate optimal position
  const calculatePosition = useCallback(() => {
    if (!hasSelection || !toolbarRef.current) return;

    const toolbarHeight = toolbarRef.current.offsetHeight;
    const toolbarWidth = toolbarRef.current.offsetWidth;

    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollLeft = window.scrollX || document.documentElement.scrollLeft;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Calculate center x position
    let x =
      selectionRectLeft +
      scrollLeft +
      selectionRectWidth / 2 -
      toolbarWidth / 2;

    // Ensure toolbar doesn't overflow viewport horizontally
    const margin = 10;
    x = Math.max(margin, Math.min(x, viewportWidth - toolbarWidth - margin));

    // Calculate y position (above or below selection)
    const spaceAbove = selectionRectTop - scrollTop;
    const spaceBelow = viewportHeight - (selectionRectBottom - scrollTop);

    let y: number;
    let newPlacement: 'top' | 'bottom';

    // Prefer showing above selection
    if (spaceAbove >= toolbarHeight + 20) {
      y = selectionRectTop + scrollTop - toolbarHeight - 10;
      newPlacement = 'top';
    }
    // Show below if not enough space above
    else if (spaceBelow >= toolbarHeight + 20) {
      y = selectionRectBottom + scrollTop + 10;
      newPlacement = 'bottom';
    }
    // Show above even if space is limited
    else {
      y = Math.max(
        scrollTop + margin,
        selectionRectTop + scrollTop - toolbarHeight - 10
      );
      newPlacement = 'top';
    }

    setPosition({ x, y });
    setPlacement(newPlacement);
  }, [
    hasSelection,
    selectionRectTop,
    selectionRectBottom,
    selectionRectLeft,
    selectionRectWidth,
  ]);

  // Update position when selection changes
  useEffect(() => {
    if (hasSelection) {
      // Calculate after render
      requestAnimationFrame(calculatePosition);
    }
  }, [hasSelection, calculatePosition]);

  // Recalculate position on scroll/resize
  useEffect(() => {
    const handleScrollOrResize = () => {
      if (hasSelection) {
        calculatePosition();
      }
    };

    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);

    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [hasSelection, calculatePosition]);

  // Handle operation click
  const handleOperationClick = useCallback(
    (operation: AIEditOperation) => {
      if (isLoading) return;

      if (operation === 'style') {
        setShowStyleMenu(!showStyleMenu);
      } else {
        onOperation({ operation });
        setShowStyleMenu(false);
        setShowCustomInput(false);
      }
    },
    [isLoading, showStyleMenu, onOperation]
  );

  // Handle style selection
  const handleStyleSelect = useCallback(
    (styleType: StyleType) => {
      if (isLoading) return;
      onOperation({ operation: 'style', styleType });
      setShowStyleMenu(false);
    },
    [isLoading, onOperation]
  );

  // Handle custom instruction
  const handleCustomSubmit = useCallback(() => {
    if (isLoading || !customInstruction.trim()) return;
    onOperation({
      operation: 'rewrite',
      customInstruction: customInstruction.trim(),
    });
    setCustomInstruction('');
    setShowCustomInput(false);
  }, [isLoading, customInstruction, onOperation]);

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        toolbarRef.current &&
        !toolbarRef.current.contains(e.target as Node)
      ) {
        setShowStyleMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Don't render on mobile (use bottom panel instead)
  if (isMobile()) {
    return null;
  }

  // Don't render if no selection
  if (!selection) {
    return null;
  }

  return (
    <div
      ref={toolbarRef}
      className={`animate-in fade-in slide-in-from-bottom-2 fixed z-[100] duration-200 ${className}`}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      <div className="relative rounded-lg border border-gray-200 bg-white shadow-xl">
        {/* Arrow indicator */}
        {placement === 'top' ? (
          <div
            className="absolute -bottom-2 left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 border-b border-r border-gray-200 bg-white"
            style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}
          />
        ) : (
          <div
            className="absolute -top-2 left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 border-l border-t border-gray-200 bg-white"
            style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)' }}
          />
        )}

        {/* Main toolbar */}
        {!showCustomInput ? (
          <div className="flex items-center gap-1 p-2">
            {/* Operation buttons */}
            {operationButtons.map((btn) => (
              <div key={btn.operation} className="relative">
                <button
                  onClick={() => handleOperationClick(btn.operation)}
                  disabled={isLoading}
                  title={btn.description}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                    isLoading
                      ? 'cursor-not-allowed opacity-50'
                      : 'hover:bg-gray-100'
                  } ${
                    btn.operation === 'style' && showStyleMenu
                      ? 'bg-purple-50 text-purple-700'
                      : 'text-gray-700'
                  }`}
                >
                  <span>{btn.icon}</span>
                  <span>{btn.label}</span>
                  {btn.operation === 'style' && (
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
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  )}
                </button>

                {/* Style dropdown menu */}
                {btn.operation === 'style' && showStyleMenu && (
                  <div className="absolute left-0 top-full z-10 mt-1 w-36 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                    {styleOptions.map((option) => (
                      <button
                        key={option.type}
                        onClick={() => handleStyleSelect(option.type)}
                        disabled={isLoading}
                        className="flex w-full items-center px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            <div className="mx-1 h-6 w-px bg-gray-200" />

            {/* Custom instruction button */}
            <button
              onClick={() => setShowCustomInput(true)}
              disabled={isLoading}
              title={t('topicResearch.aiEdit.customInstruction')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                isLoading
                  ? 'cursor-not-allowed opacity-50'
                  : 'hover:bg-gray-100'
              } text-gray-700`}
            >
              <span>💬</span>
              <span>{t('topicResearch.aiEdit.custom')}</span>
            </button>

            {/* Loading indicator */}
            {isLoading && (
              <>
                <div className="mx-1 h-6 w-px bg-gray-200" />
                <div className="flex items-center gap-2 px-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-purple-600 border-t-transparent" />
                  <span className="text-xs text-purple-600">
                    {t('topicResearch.aiEdit.aiProcessing')}
                  </span>
                </div>
              </>
            )}
          </div>
        ) : (
          /* Custom instruction input */
          <div className="w-80 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">
                {t('topicResearch.aiEdit.customInstruction')}
              </span>
              <button
                onClick={() => {
                  setShowCustomInput(false);
                  setCustomInstruction('');
                }}
                className="text-gray-400 hover:text-gray-600"
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
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <textarea
              value={customInstruction}
              onChange={(e) => setCustomInstruction(e.target.value)}
              placeholder={t('topicResearch.aiEdit.inputPlaceholder')}
              className="mb-2 w-full rounded-lg border border-gray-200 p-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
              rows={3}
              autoFocus
            />

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowCustomInput(false);
                  setCustomInstruction('');
                }}
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50"
              >
                {t('topicResearch.aiEdit.cancel')}
              </button>
              <button
                onClick={handleCustomSubmit}
                disabled={isLoading || !customInstruction.trim()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 text-sm text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
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
                {t('topicResearch.aiEdit.execute')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
