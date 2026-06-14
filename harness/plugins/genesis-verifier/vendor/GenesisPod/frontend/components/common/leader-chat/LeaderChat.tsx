'use client';

/**
 * LeaderChat - 纯 UI 聊天组件（TI 风格）
 *
 * 数据驱动：messages / loading / sending / error 由调用方提供。
 * 不连后端 API，由 onSend 回调把发送动作交给业务层。
 *
 * 视觉规范（参照 Topic Insights 详情页右栏 "与 Leader 对话"）：
 * - 消息列表 vertical stack，无气泡
 * - 每条：左侧小 avatar，右侧（名字 + 时间）→（正文）
 * - User / Assistant 同布局，不用左/右反向 + 不同色气泡
 * - 输入区：简洁 textarea + 主色发送按钮
 */

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Brain, Loader2, Send, User as UserIcon } from 'lucide-react';
import { ClientDate } from '@/components/common/ClientDate';
import { cn } from '@/lib/utils/common';
import { LEADER_CHAT_MD_COMPONENTS } from './markdown';
import type { LeaderChatProps } from './types';

const DEFAULT_LABELS: Required<NonNullable<LeaderChatProps['labels']>> = {
  placeholder: '输入对话内容…',
  loading: '加载历史对话…',
  emptyTitle: '还没有对话记录',
  emptyHint: 'Leader 已掌握当前任务的完整上下文，直接问问看吧。',
  thinking: 'Leader 思考中…',
  sendFailed: '发送失败',
  send: '发送',
};

/** 主色 → Tailwind 类映射 */
const ACCENT_PRESET = {
  violet: {
    userIconBg: 'bg-blue-50 text-blue-600',
    assistantIconBg: 'bg-violet-50 text-violet-600',
    assistantName: 'text-violet-700',
    userName: 'text-blue-700',
    emptyIcon: 'text-violet-300',
    sendBg: 'bg-violet-600 hover:bg-violet-700',
    inputFocus: 'focus:border-violet-400 focus:ring-violet-100',
    typing: 'bg-violet-400',
  },
  blue: {
    userIconBg: 'bg-violet-50 text-violet-600',
    assistantIconBg: 'bg-blue-50 text-blue-600',
    assistantName: 'text-blue-700',
    userName: 'text-violet-700',
    emptyIcon: 'text-blue-300',
    sendBg: 'bg-blue-600 hover:bg-blue-700',
    inputFocus: 'focus:border-blue-400 focus:ring-blue-100',
    typing: 'bg-blue-400',
  },
  emerald: {
    userIconBg: 'bg-blue-50 text-blue-600',
    assistantIconBg: 'bg-emerald-50 text-emerald-600',
    assistantName: 'text-emerald-700',
    userName: 'text-blue-700',
    emptyIcon: 'text-emerald-300',
    sendBg: 'bg-emerald-600 hover:bg-emerald-700',
    inputFocus: 'focus:border-emerald-400 focus:ring-emerald-100',
    typing: 'bg-emerald-400',
  },
  amber: {
    userIconBg: 'bg-blue-50 text-blue-600',
    assistantIconBg: 'bg-amber-50 text-amber-600',
    assistantName: 'text-amber-700',
    userName: 'text-blue-700',
    emptyIcon: 'text-amber-300',
    sendBg: 'bg-amber-600 hover:bg-amber-700',
    inputFocus: 'focus:border-amber-400 focus:ring-amber-100',
    typing: 'bg-amber-400',
  },
} as const;

export function LeaderChat({
  messages,
  loading = false,
  error = null,
  sending = false,
  onSend,
  labels: labelOverrides,
  assistantIcon,
  userIcon,
  emptyIcon,
  accentColor = 'violet',
  enableMarkdown = true,
  renderAssistantHeaderExtra,
  renderAssistantBodyPrefix,
  renderAssistantBodyExtra,
  assistantName = 'Leader',
  userName = 'User',
}: LeaderChatProps) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const accent = ACCENT_PRESET[accentColor];

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages.length]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    try {
      await onSend(text);
    } catch {
      // 错误透传给调用方，由它通过 error prop 显示
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {labels.loading}
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {error}
          </div>
        ) : messages.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-white p-6 text-center">
            <div
              className={cn(
                'mx-auto mb-2 flex h-8 w-8 items-center justify-center',
                accent.emptyIcon
              )}
            >
              {emptyIcon ?? <Brain className="h-8 w-8" />}
            </div>
            <p className="text-sm font-medium text-gray-700">
              {labels.emptyTitle}
            </p>
            <p className="mt-1 text-[11px] text-gray-500">{labels.emptyHint}</p>
          </div>
        ) : (
          <ul className="space-y-4">
            {messages.map((m) => {
              const isUser = m.role === 'user';
              return (
                <li key={m.id} className="flex gap-2.5">
                  <span
                    className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                      isUser ? accent.userIconBg : accent.assistantIconBg
                    )}
                  >
                    {isUser
                      ? (userIcon ?? <UserIcon className="h-3.5 w-3.5" />)
                      : (assistantIcon ?? <Brain className="h-3.5 w-3.5" />)}
                  </span>
                  <div className="min-w-0 flex-1">
                    {/* Name + (assistant chip) + timestamp 行 */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'text-[12px] font-semibold',
                          isUser ? accent.userName : accent.assistantName
                        )}
                      >
                        {isUser ? userName : assistantName}
                      </span>
                      {!isUser &&
                        renderAssistantHeaderExtra &&
                        renderAssistantHeaderExtra(m)}
                      {m.content !== '__THINKING__' && (
                        <span className="text-[10px] text-gray-400">
                          <ClientDate date={m.createdAt} format="time" />
                          {m.tokensUsed && m.tokensUsed > 0 ? (
                            <span> · {m.tokensUsed} tk</span>
                          ) : null}
                        </span>
                      )}
                    </div>
                    {/* Body prefix (e.g. understanding) */}
                    {!isUser &&
                      m.content !== '__THINKING__' &&
                      renderAssistantBodyPrefix &&
                      renderAssistantBodyPrefix(m)}
                    {/* Body 正文 */}
                    <div className="mt-1 text-[13px] leading-relaxed text-gray-800">
                      {m.content === '__THINKING__' ? (
                        <div className="flex items-center gap-1.5 py-1">
                          <span className="inline-flex gap-1">
                            {[0, 150, 300].map((delay) => (
                              <span
                                key={delay}
                                className={cn(
                                  'h-1.5 w-1.5 animate-bounce rounded-full',
                                  accent.typing
                                )}
                                style={{ animationDelay: `${delay}ms` }}
                              />
                            ))}
                          </span>
                          <span className="text-[12px] text-gray-500">
                            {labels.thinking}
                          </span>
                        </div>
                      ) : isUser || !enableMarkdown ? (
                        <p className="whitespace-pre-wrap break-words">
                          {m.content}
                        </p>
                      ) : (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={LEADER_CHAT_MD_COMPONENTS}
                        >
                          {m.content}
                        </ReactMarkdown>
                      )}
                    </div>
                    {/* Body extra (e.g. TODO button / clarify options) */}
                    {!isUser &&
                      m.content !== '__THINKING__' &&
                      renderAssistantBodyExtra &&
                      renderAssistantBodyExtra(m)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-gray-100 bg-white p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              const ta = e.target;
              ta.style.height = 'auto';
              ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
            }}
            onKeyDown={onKeyDown}
            placeholder={labels.placeholder}
            rows={2}
            disabled={sending}
            className={cn(
              'flex-1 resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-[13px] leading-relaxed placeholder:text-gray-400 focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-gray-50',
              accent.inputFocus
            )}
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!input.trim() || sending}
            className={cn(
              'flex h-10 items-center gap-1.5 self-end rounded-xl px-4 text-[13px] font-medium text-white shadow transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50',
              accent.sendBg
            )}
            title={labels.send}
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            <span>{labels.send}</span>
          </button>
        </div>
        {error && (
          <p className="mt-2 text-[11px] text-red-600">
            {labels.sendFailed}：{error}
          </p>
        )}
      </div>
    </div>
  );
}
