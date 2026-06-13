/**
 * QuickCommandBar - Leader 对话输入框
 *
 * 简洁的大文本输入框，用于与 Leader 对话
 */

'use client';

import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/primitives/button';
import { Send, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { useI18n } from '@/lib/i18n';

import { logger } from '@/lib/utils/logger';
interface QuickCommandBarProps {
  topicId: string;
  missionId?: string;
  onSubmit: (instruction: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function QuickCommandBar({
  topicId: _topicId,
  missionId: _missionId,
  onSubmit,
  disabled = false,
  placeholder,
  className,
}: QuickCommandBarProps) {
  const { t } = useI18n();
  const [input, setInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const defaultPlaceholder =
    placeholder ||
    t('topicResearch.researchControl.quickCommandBar.placeholder');

  const handleSubmit = useCallback(async () => {
    if (!input.trim() || isSubmitting || disabled) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(input.trim());
      setInput('');
    } catch (error) {
      logger.error('[QuickCommandBar] Submit failed:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [input, isSubmitting, disabled, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Ctrl/Cmd + Enter 发送
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit]
  );

  // 自动调整高度
  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
      // 自动调整高度
      const textarea = e.target;
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
    },
    []
  );

  return (
    <div className={cn('flex gap-2', className)}>
      {/* 大文本输入框 */}
      <textarea
        ref={textareaRef}
        value={input}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={defaultPlaceholder}
        disabled={disabled || isSubmitting}
        rows={2}
        className={cn(
          'flex-1 resize-none rounded-lg border border-gray-200 bg-white px-4 py-3',
          'text-sm leading-relaxed placeholder:text-gray-400',
          'focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100',
          'disabled:cursor-not-allowed disabled:bg-gray-50 disabled:opacity-60',
          'transition-colors duration-150'
        )}
      />

      {/* 发送按钮 */}
      <Button
        onClick={handleSubmit}
        disabled={!input.trim() || disabled || isSubmitting}
        className="h-auto shrink-0 self-end px-4 py-3"
      >
        {isSubmitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
        <span className="ml-2">
          {t('topicResearch.researchControl.quickCommandBar.send')}
        </span>
      </Button>
    </div>
  );
}

export default QuickCommandBar;
