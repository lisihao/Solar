'use client';

/**
 * Research Command Input
 *
 * @Leader 指令输入框:
 * - @Leader 提及检测
 * - 向上弹出菜单
 * - 多行输入支持
 */

import { useState, useRef, useCallback } from 'react';
import { useI18n } from '@/lib/i18n';

interface ResearchCommandInputProps {
  onSendInstruction: (instruction: string) => void;
  disabled?: boolean;
  isLoading?: boolean;
}

export function ResearchCommandInput({
  onSendInstruction,
  disabled = false,
  isLoading = false,
}: ResearchCommandInputProps) {
  const { t } = useI18n();
  const [userInput, setUserInput] = useState('');
  const [showLeaderMenu, setShowLeaderMenu] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Handle input change and detect @Leader mention
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setUserInput(value);

      // Detect @ trigger
      const cursorPos = e.target.selectionStart || 0;
      const textBeforeCursor = value.slice(0, cursorPos);
      const atMatch = textBeforeCursor.match(/@(\w*)$/);

      if (atMatch) {
        const query = atMatch[1].toLowerCase();
        if (query === '' || 'leader'.startsWith(query)) {
          setShowLeaderMenu(true);
        } else {
          setShowLeaderMenu(false);
        }
      } else {
        setShowLeaderMenu(false);
      }
    },
    []
  );

  // Select @Leader
  const handleSelectLeader = useCallback(() => {
    const cursorPos = inputRef.current?.selectionStart || userInput.length;
    const textBeforeCursor = userInput.slice(0, cursorPos);
    const textAfterCursor = userInput.slice(cursorPos);

    const newTextBefore = textBeforeCursor.replace(/@\w*$/, '@Leader ');
    const newText = newTextBefore + textAfterCursor;
    const newCursorPos = newTextBefore.length;

    setUserInput(newText);
    setShowLeaderMenu(false);

    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  }, [userInput]);

  // Send instruction
  const handleSendInstruction = useCallback(() => {
    if (!userInput.trim() || disabled || isLoading) return;

    // Clean @Leader from the instruction
    const cleanInstruction = userInput.replace(/@Leader\s*/gi, '').trim();
    if (cleanInstruction) {
      onSendInstruction(cleanInstruction);
      setUserInput('');
    }
  }, [userInput, disabled, isLoading, onSendInstruction]);

  // Handle key press (Enter to send)
  const handleKeyPress = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendInstruction();
      }
    },
    [handleSendInstruction]
  );

  return (
    <div className="relative border-t border-gray-200 bg-white p-3">
      {/* @Leader Dropdown */}
      {showLeaderMenu && (
        <div className="absolute bottom-full left-3 right-3 z-50 mb-2 rounded-lg border border-gray-200 bg-white py-2 shadow-lg">
          <div className="px-3 py-1 text-xs font-medium text-gray-400">
            {t('topicResearch.researchControl.commandInput.mentionLeader')}
          </div>
          <button
            onClick={handleSelectLeader}
            className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-gray-50"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-purple-400 to-purple-600 text-sm">
              👑
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-800">@Leader</div>
              <div className="text-xs text-gray-400">
                {t('topicResearch.researchControl.commandInput.leaderRole')}
              </div>
            </div>
          </button>
        </div>
      )}

      {/* Input Area */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <textarea
            ref={inputRef}
            value={userInput}
            onChange={handleInputChange}
            onKeyDown={handleKeyPress}
            onBlur={() => {
              setTimeout(() => setShowLeaderMenu(false), 200);
            }}
            placeholder={t(
              'topicResearch.researchControl.commandInput.placeholder'
            )}
            rows={2}
            className="w-full resize-none rounded-lg border border-gray-200 bg-white p-3 pr-10 text-sm text-gray-900 placeholder-gray-400 focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-100 disabled:bg-gray-50 disabled:text-gray-400"
            disabled={disabled || isLoading}
          />

          {/* 字符计数 */}
          <span className="absolute bottom-2 right-2 text-xs text-gray-300">
            {t('topicResearch.researchControl.commandInput.characterCount', {
              count: userInput.length,
            })}
          </span>
        </div>

        <button
          onClick={handleSendInstruction}
          disabled={!userInput.trim() || disabled || isLoading}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center self-end rounded-lg bg-purple-600 text-white transition-all hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {isLoading ? (
            <svg
              className="h-4 w-4 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          ) : (
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
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          )}
        </button>
      </div>

      {/* Help text */}
      <p className="mt-2 text-xs text-gray-400">
        {t('topicResearch.researchControl.commandInput.helpText')}
      </p>
    </div>
  );
}
