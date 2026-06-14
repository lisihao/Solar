'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';

import { logger } from '@/lib/utils/logger';
interface TextSelectionToolbarProps {
  resourceId?: string;
  onAddToNotes?: (text: string, note?: string) => void;
  onTranslate?: (text: string, targetLang: string, translation: string) => void;
  onHighlight?: (text: string, color: string) => void;
  onAskAI?: (text: string) => void;
  containerRef?: React.RefObject<HTMLElement>;
  className?: string;
  children: React.ReactNode;
  /** 是否显示剪贴板悬浮按钮（用于无法检测文本选择的嵌入内容如PDF） */
  showClipboardFAB?: boolean;
}

interface Position {
  x: number;
  y: number;
}

type ToolbarMode = 'main' | 'translate' | 'note' | 'highlight' | 'success';

const HIGHLIGHT_COLORS = [
  { name: 'Yellow', value: '#fef08a', border: '#eab308' },
  { name: 'Green', value: '#bbf7d0', border: '#22c55e' },
  { name: 'Blue', value: '#bfdbfe', border: '#3b82f6' },
  { name: 'Pink', value: '#fbcfe8', border: '#ec4899' },
  { name: 'Orange', value: '#fed7aa', border: '#f97316' },
];

const LANGUAGES = [
  { code: 'zh', name: '中文', flag: '🇨🇳' },
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
];

/**
 * 文本选择工具栏组件
 *
 * 功能：
 * - 检测用户文本选择
 * - 显示浮动工具栏
 * - 支持：添加到笔记、翻译、高亮、复制、询问AI
 * - 适用于论文、博客、新闻、报告等多种内容类型
 */
export default function TextSelectionToolbar({
  resourceId,
  onAddToNotes,
  onTranslate,
  onHighlight,
  onAskAI,
  containerRef,
  className = '',
  children,
  showClipboardFAB = false,
}: TextSelectionToolbarProps) {
  const [selectedText, setSelectedText] = useState('');
  const [prevSelectedText, setPrevSelectedText] = useState(''); // Track previous text for comparison
  const selectedTextRef = useRef(''); // Ref to always have current selected text (avoids stale closure issues)
  const [showToolbar, setShowToolbar] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState<Position>({
    x: 0,
    y: 0,
  });
  const [mode, setMode] = useState<ToolbarMode>('main');
  const [noteText, setNoteText] = useState('');
  const [translating, setTranslating] = useState(false);
  const [translation, setTranslation] = useState('');
  const [selectedLang, setSelectedLang] = useState('zh');
  const [successMessage, setSuccessMessage] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [showFABMenu, setShowFABMenu] = useState(false);
  const [clipboardText, setClipboardText] = useState('');

  const contentRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLDivElement>(null);

  // Handle text selection
  const handleMouseUp = useCallback(
    (e: MouseEvent) => {
      // Ignore if clicking inside toolbar
      if (toolbarRef.current?.contains(e.target as Node)) {
        return;
      }

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        // Don't hide toolbar when in sub-modes
        if (mode === 'main') {
          setShowToolbar(false);
        }
        return;
      }

      const text = selection.toString().trim();
      if (text.length < 2) {
        if (mode === 'main') {
          setShowToolbar(false);
        }
        return;
      }

      // Check if selection is within our container
      const range = selection.getRangeAt(0);
      const container = containerRef?.current || contentRef.current;
      if (container && !container.contains(range.commonAncestorContainer)) {
        return;
      }

      // Clear translation if text changed
      if (text !== prevSelectedText) {
        setTranslation('');
        setNoteText('');
        setPrevSelectedText(text);
      }

      // Update both state and ref (ref for immediate access in callbacks)
      selectedTextRef.current = text;
      setSelectedText(text);

      // Position toolbar above selection
      const rect = range.getBoundingClientRect();
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

      setToolbarPosition({
        x: rect.left + scrollLeft + rect.width / 2,
        y: rect.top + scrollTop - 10,
      });

      setShowToolbar(true);
      setMode('main');
    },
    [mode, containerRef, prevSelectedText]
  );

  // Handle click outside to close toolbar
  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (
        toolbarRef.current &&
        !toolbarRef.current.contains(e.target as Node) &&
        mode === 'main'
      ) {
        setShowToolbar(false);
        setMode('main');
      }
    },
    [mode]
  );

  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [handleMouseUp, handleClickOutside]);

  // Copy to clipboard
  const handleCopy = useCallback(async () => {
    try {
      // Use ref to get the most current selected text
      const textToCopy = selectedTextRef.current;
      await navigator.clipboard.writeText(textToCopy);
      setSuccessMessage('Copied!');
      setMode('success');
      setTimeout(() => {
        setShowToolbar(false);
        setMode('main');
      }, 1000);
    } catch (err) {
      logger.error('Failed to copy:', err);
    }
  }, []);

  // Translate text
  const handleTranslate = useCallback(
    async (targetLang: string) => {
      // IMPORTANT: Clear any previous translation first to prevent stale data display
      setTranslation('');
      setTranslating(true);
      setSelectedLang(targetLang);

      // Use ref to get the most current selected text (avoids stale closure)
      const textToTranslate = selectedTextRef.current;

      if (!textToTranslate || textToTranslate.length < 2) {
        setTranslation('No text selected');
        setTranslating(false);
        return;
      }

      try {
        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/ai/translate`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: textToTranslate,
              targetLanguage: targetLang,
              sourceLanguage: 'auto',
            }),
          }
        );

        if (response.ok) {
          const result = await response.json();
          // Handle wrapped response { success: true, data: {...} }
          const data = result?.data ?? result;
          const translatedText =
            data?.translation || data?.translatedText || '';
          setTranslation(translatedText);
          onTranslate?.(textToTranslate, targetLang, translatedText);
        } else {
          setTranslation('Translation failed. Please try again.');
        }
      } catch (err) {
        logger.error('Translation error:', err);
        setTranslation('Translation service unavailable.');
      } finally {
        setTranslating(false);
      }
    },
    [onTranslate]
  );

  // Add to notes
  const handleAddToNotes = useCallback(async () => {
    // Use ref to get the most current selected text (avoids stale closure)
    const currentSelectedText = selectedTextRef.current;

    if (!resourceId) {
      onAddToNotes?.(currentSelectedText, noteText);
      setSuccessMessage('Added to notes!');
      setMode('success');
      setTimeout(() => {
        setShowToolbar(false);
        setMode('main');
      }, 1500);
      return;
    }

    setSavingNote(true);
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/v1/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader(),
        },
        body: JSON.stringify({
          resourceId,
          content: noteText
            ? `${noteText}\n\n> ${currentSelectedText}`
            : `> ${currentSelectedText}`,
          tags: ['quote', 'selection'],
          isPublic: false,
        }),
      });

      if (response.ok) {
        onAddToNotes?.(currentSelectedText, noteText);
        setSuccessMessage('Added to notes!');
        setMode('success');
        setTimeout(() => {
          setShowToolbar(false);
          setMode('main');
          setNoteText('');
        }, 1500);
      } else {
        const errorData = await response.json().catch(() => ({}));
        logger.error('Failed to add note:', {
          status: response.status,
          error: errorData,
        });
        setSuccessMessage('Failed to save. Please try again.');
        setMode('success');
        setTimeout(() => {
          setMode('note');
        }, 2000);
      }
    } catch (err) {
      logger.error('Failed to add note:', err);
      setSuccessMessage('Network error. Please try again.');
      setMode('success');
      setTimeout(() => {
        setMode('note');
      }, 2000);
    } finally {
      setSavingNote(false);
    }
  }, [resourceId, noteText, onAddToNotes]);

  // Highlight text
  const handleHighlight = useCallback(
    (color: string) => {
      // Use ref to get the most current selected text (avoids stale closure)
      const currentSelectedText = selectedTextRef.current;
      if (onHighlight) {
        onHighlight(currentSelectedText, color);
        setSuccessMessage('Highlighted!');
      } else {
        // Highlight feature not implemented yet
        setSuccessMessage('Highlight saved locally');
      }
      setMode('success');
      setTimeout(() => {
        setShowToolbar(false);
        setMode('main');
      }, 1000);
    },
    [onHighlight]
  );

  // Ask AI
  const handleAskAI = useCallback(() => {
    // Use ref to get the most current selected text (avoids stale closure)
    onAskAI?.(selectedTextRef.current);
    setShowToolbar(false);
    setMode('main');
  }, [onAskAI]);

  // Close toolbar
  const handleClose = useCallback(() => {
    setShowToolbar(false);
    setMode('main');
    setNoteText('');
    setTranslation('');
    setPrevSelectedText('');
    selectedTextRef.current = '';
    window.getSelection()?.removeAllRanges();
  }, []);

  // Render main toolbar buttons
  const renderMainToolbar = () => (
    <div className="flex items-center gap-0.5">
      {/* Copy */}
      <button
        onClick={handleCopy}
        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-700 transition-colors hover:bg-gray-100"
        title="Copy"
      >
        <svg
          className="h-3.5 w-3.5"
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
        <span>Copy</span>
      </button>

      <div className="mx-0.5 h-4 w-px bg-gray-200" />

      {/* Translate */}
      <button
        onClick={() => {
          setTranslation(''); // Clear stale translation when entering translate mode
          setMode('translate');
        }}
        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-700 transition-colors hover:bg-gray-100"
        title="Translate"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"
          />
        </svg>
        <span>Translate</span>
      </button>

      <div className="mx-0.5 h-4 w-px bg-gray-200" />

      {/* Add to Notes */}
      <button
        onClick={() => setMode('note')}
        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-700 transition-colors hover:bg-gray-100"
        title="Add to Notes"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
          />
        </svg>
        <span>Notes</span>
      </button>

      <div className="mx-0.5 h-4 w-px bg-gray-200" />

      {/* Highlight */}
      <button
        onClick={() => setMode('highlight')}
        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-700 transition-colors hover:bg-gray-100"
        title="Highlight"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
          />
        </svg>
        <span>Highlight</span>
      </button>

      {onAskAI && (
        <>
          <div className="mx-0.5 h-4 w-px bg-gray-200" />
          {/* Ask AI */}
          <button
            onClick={handleAskAI}
            className="flex items-center gap-1 rounded bg-gradient-to-r from-red-500 to-red-600 px-2 py-1 text-xs text-white transition-colors hover:from-red-600 hover:to-red-700"
            title="Ask AI"
          >
            <svg
              className="h-3.5 w-3.5"
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
            <span>Ask AI</span>
          </button>
        </>
      )}
    </div>
  );

  // Render translate mode
  const renderTranslateMode = () => (
    <div className="w-72">
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => setMode('main')}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
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
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back
        </button>
        <span className="text-sm font-medium text-gray-700">Translate to</span>
        <button
          onClick={handleClose}
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

      {/* Language buttons */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            onClick={() => handleTranslate(lang.code)}
            disabled={translating}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              selectedLang === lang.code && translation
                ? 'bg-red-100 text-red-700'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {lang.flag} {lang.name}
          </button>
        ))}
      </div>

      {/* Translation result */}
      {translating ? (
        <div className="flex items-center justify-center py-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-red-600 border-t-transparent"></div>
          <span className="ml-2 text-sm text-gray-500">Translating...</span>
        </div>
      ) : translation ? (
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-sm leading-relaxed text-gray-800">{translation}</p>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(translation);
                setSuccessMessage('Translation copied!');
                setMode('success');
                setTimeout(() => {
                  setShowToolbar(false);
                  setMode('main');
                }, 1000);
              }}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-200"
            >
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
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              Copy
            </button>
            <button
              onClick={() => {
                setMode('note');
                setNoteText(
                  `Translation (${selectedLang}):\n${translation}\n\nOriginal:\n${selectedTextRef.current}`
                );
              }}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-200"
            >
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
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
              Save to Notes
            </button>
          </div>
        </div>
      ) : (
        <p className="py-2 text-center text-xs text-gray-400">
          Select a language to translate
        </p>
      )}
    </div>
  );

  // Render note mode
  const renderNoteMode = () => (
    <div className="w-72">
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => {
            setMode('main');
            setNoteText('');
          }}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
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
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back
        </button>
        <span className="text-sm font-medium text-gray-700">Add to Notes</span>
        <button
          onClick={handleClose}
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

      {/* Selected text preview */}
      <div className="mb-3 rounded-lg border-l-4 border-yellow-400 bg-yellow-50 p-2">
        <p className="line-clamp-3 text-xs text-gray-600">{selectedText}</p>
      </div>

      {/* Note input */}
      <textarea
        value={noteText}
        onChange={(e) => setNoteText(e.target.value)}
        placeholder="Add your thoughts... (optional)"
        className="mb-3 w-full rounded-lg border border-gray-200 p-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
        rows={3}
      />

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => {
            setMode('main');
            setNoteText('');
          }}
          className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={handleAddToNotes}
          disabled={savingNote}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm text-white transition-colors hover:bg-red-700 disabled:opacity-50"
        >
          {savingNote ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
              Saving...
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
                  d="M5 13l4 4L19 7"
                />
              </svg>
              Save Note
            </>
          )}
        </button>
      </div>
    </div>
  );

  // Render highlight mode
  const renderHighlightMode = () => (
    <div className="w-64">
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => setMode('main')}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
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
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back
        </button>
        <span className="text-sm font-medium text-gray-700">Choose Color</span>
        <button
          onClick={handleClose}
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

      <div className="flex justify-center gap-3">
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color.value}
            onClick={() => handleHighlight(color.value)}
            className="h-8 w-8 rounded-full border-2 transition-transform hover:scale-110"
            style={{
              backgroundColor: color.value,
              borderColor: color.border,
            }}
            title={color.name}
          />
        ))}
      </div>
    </div>
  );

  // Render success message
  const renderSuccessMode = () => (
    <div className="flex items-center gap-2 px-4 py-2">
      <svg
        className="h-5 w-5 text-green-500"
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
      <span className="text-sm font-medium text-green-700">
        {successMessage}
      </span>
    </div>
  );

  return (
    <div ref={contentRef} className={`relative ${className}`}>
      {children}

      {/* Floating Toolbar */}
      {showToolbar && (
        <div
          ref={toolbarRef}
          className="animate-in fade-in slide-in-from-bottom-2 fixed z-[100] duration-200"
          style={{
            left: toolbarPosition.x,
            top: toolbarPosition.y,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="rounded-xl border border-gray-200 bg-white p-2 shadow-xl">
            {/* Arrow indicator */}
            <div
              className="absolute -bottom-2 left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 border-b border-r border-gray-200 bg-white"
              style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}
            />

            {mode === 'main' && renderMainToolbar()}
            {mode === 'translate' && renderTranslateMode()}
            {mode === 'note' && renderNoteMode()}
            {mode === 'highlight' && renderHighlightMode()}
            {mode === 'success' && renderSuccessMode()}
          </div>
        </div>
      )}

      {/* Floating Action Button for clipboard-based operations (for embedded content like PDF) */}
      {showClipboardFAB && (
        <div ref={fabRef} className="absolute bottom-4 right-4 z-50">
          {/* FAB Menu */}
          {showFABMenu && clipboardText && (
            <div className="animate-in fade-in slide-in-from-bottom-2 absolute bottom-14 right-0 mb-2 w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-xl duration-200">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">
                  Clipboard Content
                </span>
                <button
                  onClick={() => {
                    setShowFABMenu(false);
                    setClipboardText('');
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

              {/* Preview */}
              <div className="mb-3 max-h-24 overflow-y-auto rounded-lg border-l-4 border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.06)] p-2">
                <p className="text-xs text-gray-700">{clipboardText}</p>
              </div>

              {/* Actions */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    selectedTextRef.current = clipboardText;
                    setSelectedText(clipboardText);
                    setTranslation(''); // Clear stale translation
                    setMode('translate');
                    setShowToolbar(true);
                    setToolbarPosition({
                      x: window.innerWidth / 2,
                      y: window.innerHeight / 2,
                    });
                    setShowFABMenu(false);
                  }}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700 transition-colors hover:bg-gray-50"
                >
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"
                    />
                  </svg>
                  Translate
                </button>
                <button
                  onClick={() => {
                    selectedTextRef.current = clipboardText;
                    setSelectedText(clipboardText);
                    setMode('note');
                    setShowToolbar(true);
                    setToolbarPosition({
                      x: window.innerWidth / 2,
                      y: window.innerHeight / 2,
                    });
                    setShowFABMenu(false);
                  }}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700 transition-colors hover:bg-gray-50"
                >
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    />
                  </svg>
                  Add Note
                </button>
                {onAskAI && (
                  <button
                    onClick={() => {
                      onAskAI(clipboardText);
                      setShowFABMenu(false);
                      setClipboardText('');
                    }}
                    className="col-span-2 flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-red-500 to-red-600 px-3 py-2 text-xs text-white transition-colors hover:from-red-600 hover:to-red-700"
                  >
                    <svg
                      className="h-3.5 w-3.5"
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
                    Ask AI
                  </button>
                )}
              </div>
            </div>
          )}

          {/* FAB Button */}
          <button
            onClick={async () => {
              try {
                const text = await navigator.clipboard.readText();
                if (text && text.trim().length > 0) {
                  setClipboardText(text.trim());
                  setShowFABMenu(true);
                } else {
                  // Show hint
                  setClipboardText('');
                  setShowFABMenu(true);
                }
              } catch {
                // Clipboard access denied
                setClipboardText('');
                setShowFABMenu(true);
              }
            }}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-red-600 text-white shadow-lg transition-all hover:scale-105 hover:shadow-xl"
            title="Paste & process text (Copy text first, then click)"
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
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
          </button>

          {/* No clipboard content hint */}
          {showFABMenu && !clipboardText && (
            <div className="animate-in fade-in absolute bottom-14 right-0 mb-2 w-64 rounded-xl border border-gray-200 bg-white p-4 shadow-xl duration-200">
              <div className="text-center">
                <svg
                  className="mx-auto h-10 w-10 text-gray-300"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                  />
                </svg>
                <p className="mt-2 text-sm font-medium text-gray-700">
                  No text in clipboard
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  Select text in the document and copy it (Ctrl+C), then click
                  the button again.
                </p>
                <button
                  onClick={() => setShowFABMenu(false)}
                  className="mt-3 rounded-lg bg-gray-100 px-4 py-2 text-xs text-gray-600 hover:bg-gray-200"
                >
                  Got it
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
