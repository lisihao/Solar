'use client';

/**
 * LeaderChatDock - 通用 Leader 对话容器
 *
 * 在 LeaderChat 之上提供：
 * - modal：右下角浮窗（fixed, slide-in），点击外部 / X 关闭
 * - minimized：右下角浮球（圆形 chip + 消息计数）
 * - 头部 chrome：标题 + 副标题 + 最小化 + 关闭按钮
 *
 * 调用方按需选择形态（默认 modal），支持运行时最小化 / 恢复。
 */

import { useEffect, useState } from 'react';
import { Brain, Minus, X as XIcon } from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { LeaderChat } from './LeaderChat';
import type { LeaderChatDockMode, LeaderChatDockProps } from './types';

export function LeaderChatDock(props: LeaderChatDockProps) {
  const {
    open,
    onClose,
    title = '与 Leader 对话',
    subtitle,
    headerIcon,
    headerGradient = 'from-violet-500 to-purple-600',
    allowMinimize = true,
    defaultMode = 'modal',
    minimizeLabel = '最小化',
    closeLabel = '关闭',
    restoreLabel = '恢复 Leader 对话',
    messages,
    accentColor = 'violet',
    ...chatProps
  } = props;

  const [mode, setMode] = useState<LeaderChatDockMode>(defaultMode);

  // 重新打开时重置形态
  useEffect(() => {
    if (open) setMode(defaultMode);
  }, [open, defaultMode]);

  if (!open) return null;

  // ── 最小化态：右下角浮球 ──
  if (mode === 'minimized') {
    return (
      <button
        type="button"
        onClick={() => setMode('modal')}
        className={cn(
          'fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-2xl transition-transform hover:scale-105',
          'bg-gradient-to-br',
          headerGradient
        )}
        title={restoreLabel}
      >
        {headerIcon ?? <Brain className="h-6 w-6" />}
        {messages.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-bold text-violet-600 ring-2 ring-violet-500">
            {messages.length}
          </span>
        )}
      </button>
    );
  }

  // ── modal 态：右下角浮窗 ──
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-end bg-black/30 backdrop-blur-[2px] sm:items-center sm:justify-end sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex h-[88vh] w-full flex-col overflow-hidden rounded-t-2xl border border-gray-200 bg-white shadow-2xl sm:h-[80vh] sm:w-[560px] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={cn(
            'flex items-center justify-between border-b border-gray-100 px-4 py-3 text-white',
            'bg-gradient-to-r',
            headerGradient
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/20">
              {headerIcon ?? <Brain className="h-4 w-4" />}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{title}</p>
              {subtitle && (
                <p className="line-clamp-1 text-[11px] text-white/80">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {allowMinimize && (
              <button
                type="button"
                onClick={() => setMode('minimized')}
                className="rounded-full p-1.5 text-white/90 transition-colors hover:bg-white/20"
                title={minimizeLabel}
              >
                <Minus className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-1.5 text-white/90 transition-colors hover:bg-white/20"
              title={closeLabel}
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Chat body */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <LeaderChat
            messages={messages}
            accentColor={accentColor}
            {...chatProps}
          />
        </div>
      </div>
    </div>
  );
}
