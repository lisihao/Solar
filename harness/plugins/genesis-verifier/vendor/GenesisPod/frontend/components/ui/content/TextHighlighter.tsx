'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { config } from '@/lib/utils/config';
import ClientDate from '@/components/common/ClientDate';
import { logger } from '@/lib/utils/logger';
export interface Highlight {
  id: string;
  text: string;
  startOffset: number;
  endOffset: number;
  color: string;
  note?: string;
  createdAt: string;
}

interface TextHighlighterProps {
  noteId: string;
  content: string;
  highlights: Highlight[];
  onHighlightAdded?: (highlight: Highlight) => void;
  onHighlightRemoved?: (highlightId: string) => void;
  className?: string;
}

/**
 * 文本高亮组件
 *
 * 功能：
 * - 文本选择检测
 * - 高亮创建UI（颜色选择）
 * - 高亮渲染
 * - 高亮删除
 * - 笔记标注
 */
export default function TextHighlighter({
  noteId,
  content,
  highlights,
  onHighlightAdded,
  onHighlightRemoved,
  className = '',
}: TextHighlighterProps) {
  const [selectedText, setSelectedText] = useState('');
  const [selectionRange, setSelectionRange] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [pickerPosition, setPickerPosition] = useState({ x: 0, y: 0 });
  const [selectedHighlight, setSelectedHighlight] = useState<Highlight | null>(
    null
  );
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteText, setNoteText] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);

  const colors = [
    { name: 'Yellow', value: '#ffeb3b' },
    { name: 'Green', value: '#4caf50' },
    { name: 'Blue', value: '#2196f3' },
    { name: 'Pink', value: '#e91e63' },
    { name: 'Orange', value: '#ff9800' },
  ];

  // Handle text selection
  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !contentRef.current) {
      setShowColorPicker(false);
      return;
    }

    const range = selection.getRangeAt(0);
    const selectedText = selection.toString().trim();

    if (selectedText.length === 0) {
      setShowColorPicker(false);
      return;
    }

    // Calculate offsets relative to content
    const preRange = range.cloneRange();
    preRange.selectNodeContents(contentRef.current);
    preRange.setEnd(range.startContainer, range.startOffset);
    const start = preRange.toString().length;
    const end = start + selectedText.length;

    setSelectedText(selectedText);
    setSelectionRange({ start, end });

    // Position the color picker near selection
    const rect = range.getBoundingClientRect();
    setPickerPosition({
      x: rect.left + rect.width / 2,
      y: rect.top - 10,
    });

    setShowColorPicker(true);
  }, []);

  // Add highlight
  const addHighlight = useCallback(
    async (color: string) => {
      if (!selectionRange || !selectedText) return;

      try {
        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/notes/${noteId}/highlights`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: selectedText,
              startOffset: selectionRange.start,
              endOffset: selectionRange.end,
              color,
              note: noteText || undefined,
            }),
          }
        );

        if (response.ok) {
          const result = await response.json();
          // Handle wrapped response { success: true, data: {...} }
          const updatedNote = result?.data ?? result;
          const newHighlight = (updatedNote?.highlights || [])[
            (updatedNote?.highlights?.length || 1) - 1
          ];
          onHighlightAdded?.(newHighlight);

          // Clear selection
          window.getSelection()?.removeAllRanges();
          setShowColorPicker(false);
          setShowNoteInput(false);
          setNoteText('');
          setSelectedText('');
          setSelectionRange(null);
        }
      } catch (err) {
        logger.error('Failed to add highlight:', err);
      }
    },
    [noteId, selectedText, selectionRange, noteText, onHighlightAdded]
  );

  // Remove highlight
  const removeHighlight = useCallback(
    async (highlightId: string) => {
      try {
        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/notes/${noteId}/highlights/${highlightId}`,
          { method: 'DELETE' }
        );

        if (response.ok) {
          onHighlightRemoved?.(highlightId);
          setSelectedHighlight(null);
        }
      } catch (err) {
        logger.error('Failed to remove highlight:', err);
      }
    },
    [noteId, onHighlightRemoved]
  );

  // Render text with highlights
  const renderHighlightedText = useCallback(() => {
    if (!content || highlights.length === 0) {
      return <div className="whitespace-pre-wrap">{content}</div>;
    }

    // Sort highlights by start position
    const sortedHighlights = [...highlights].sort(
      (a, b) => a.startOffset - b.startOffset
    );

    const elements: JSX.Element[] = [];
    let lastIndex = 0;

    sortedHighlights.forEach((highlight, idx) => {
      // Add text before highlight
      if (highlight.startOffset > lastIndex) {
        elements.push(
          <span key={`text-${idx}`}>
            {content.substring(lastIndex, highlight.startOffset)}
          </span>
        );
      }

      // Add highlighted text
      elements.push(
        <mark
          key={`highlight-${highlight.id}`}
          style={{ backgroundColor: highlight.color }}
          className="cursor-pointer rounded px-0.5 transition-opacity hover:opacity-80"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedHighlight(highlight);
          }}
          title={highlight.note || 'Click to view or remove highlight'}
        >
          {content.substring(highlight.startOffset, highlight.endOffset)}
        </mark>
      );

      lastIndex = highlight.endOffset;
    });

    // Add remaining text
    if (lastIndex < content.length) {
      elements.push(<span key="text-end">{content.substring(lastIndex)}</span>);
    }

    return <div className="whitespace-pre-wrap">{elements}</div>;
  }, [content, highlights]);

  return (
    <div className="relative">
      {/* Content */}
      <div
        ref={contentRef}
        className={`select-text ${className}`}
        onMouseUp={handleMouseUp}
      >
        {renderHighlightedText()}
      </div>

      {/* Color Picker */}
      {showColorPicker && (
        <div
          className="fixed z-50 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
          style={{
            left: pickerPosition.x,
            top: pickerPosition.y - 70,
            transform: 'translateX(-50%)',
          }}
        >
          <div className="mb-2 flex items-center gap-2">
            {colors.map((color) => (
              <button
                key={color.value}
                onClick={() => {
                  if (showNoteInput) {
                    addHighlight(color.value);
                  } else {
                    setShowNoteInput(true);
                  }
                }}
                className="h-6 w-6 rounded-full border-2 border-gray-300 transition-colors hover:border-gray-500"
                style={{ backgroundColor: color.value }}
                title={color.name}
              />
            ))}
          </div>

          {showNoteInput && (
            <div className="mt-2">
              <input
                type="text"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="添加笔记（可选）..."
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && colors[0]) {
                    addHighlight(colors[0].value);
                  }
                }}
              />
            </div>
          )}

          <button
            onClick={() => {
              setShowColorPicker(false);
              setShowNoteInput(false);
              setNoteText('');
            }}
            className="mt-2 w-full text-xs text-gray-600 hover:text-gray-800"
          >
            取消
          </button>
        </div>
      )}

      {/* Highlight Detail Popup */}
      {selectedHighlight && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="mb-3 text-lg font-semibold text-gray-900">
              高亮详情
            </h3>

            <div
              className="mb-3 rounded p-3"
              style={{ backgroundColor: selectedHighlight.color + '40' }}
            >
              <p className="text-sm text-gray-900">{selectedHighlight.text}</p>
            </div>

            {selectedHighlight.note && (
              <div className="mb-3">
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  笔记：
                </label>
                <p className="text-sm text-gray-600">
                  {selectedHighlight.note}
                </p>
              </div>
            )}

            <div className="mb-4 flex items-center justify-between text-xs text-gray-500">
              <span>
                创建于{' '}
                <ClientDate
                  date={selectedHighlight.createdAt}
                  format="datetime"
                />
              </span>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => removeHighlight(selectedHighlight.id)}
                className="flex-1 rounded bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
              >
                删除高亮
              </button>
              <button
                onClick={() => setSelectedHighlight(null)}
                className="flex-1 rounded bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
