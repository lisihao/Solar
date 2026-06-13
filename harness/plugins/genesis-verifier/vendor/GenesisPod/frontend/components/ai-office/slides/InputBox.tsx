'use client';

/**
 * AI Slides V5.0 - Input Box
 *
 * Input area with:
 * - ⊕ Import button (opens ImportModal)
 * - Pro/Creative mode toggle
 * - Submit button
 */

import React, { useState, useRef, useCallback } from 'react';
import { Plus, Send, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/common';

type InputMode = 'professional' | 'creative';

interface InputBoxProps {
  onSubmit: (message: string, mode: InputMode) => void;
  onImportClick: () => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}

export function InputBox({
  onSubmit,
  onImportClick,
  placeholder = '输入您的需求...',
  disabled = false,
  loading = false,
  className,
}: InputBoxProps) {
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<InputMode>('professional');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    if (!message.trim() || disabled || loading) return;
    onSubmit(message.trim(), mode);
    setMessage('');
  }, [message, mode, disabled, loading, onSubmit]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Auto-resize textarea
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  };

  return (
    <div
      className={cn('rounded-lg border border-slate-200 bg-white', className)}
    >
      {/* Input area */}
      <div className="p-3">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || loading}
          rows={2}
          className={cn(
            'w-full resize-none bg-transparent text-sm text-slate-800 placeholder-slate-400',
            'focus:outline-none',
            (disabled || loading) && 'cursor-not-allowed opacity-50'
          )}
        />
      </div>

      {/* Bottom toolbar */}
      <div className="flex items-center justify-between border-t border-slate-100 px-2 py-1.5">
        <div className="flex items-center gap-1">
          {/* Import button */}
          <button
            onClick={onImportClick}
            disabled={disabled || loading}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
              disabled || loading
                ? 'cursor-not-allowed text-slate-300'
                : 'text-slate-500 hover:bg-orange-50 hover:text-orange-600'
            )}
            title="导入数据"
          >
            <Plus className="h-5 w-5" />
          </button>

          {/* Mode toggle */}
          <div className="flex items-center rounded-lg bg-slate-100 p-0.5">
            <button
              onClick={() => setMode('professional')}
              disabled={disabled || loading}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                mode === 'professional'
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              )}
            >
              Pro
            </button>
            <button
              onClick={() => setMode('creative')}
              disabled={disabled || loading}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                mode === 'creative'
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              )}
            >
              Crea
            </button>
          </div>
        </div>

        {/* Submit button */}
        <button
          onClick={handleSubmit}
          disabled={!message.trim() || disabled || loading}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
            !message.trim() || disabled || loading
              ? 'cursor-not-allowed text-slate-300'
              : 'bg-orange-500 text-white hover:bg-orange-600'
          )}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}

export default InputBox;
