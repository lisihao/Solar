'use client';

/**
 * Global AI Bar — 路线图支柱六 6b
 *
 * Cmd+K 唤起的全局 AI 对话入口。
 * 支持快速操作（深度研究 / 写报告 / 团队分析 / 问答），
 * - ask 操作在 Bar 内原地执行，展示 AI 回答后提供"继续对话"跳转
 * - 其余操作路由到对应模块并传递 query 参数
 */

import { useEffect, useRef, useCallback, useState, KeyboardEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Search,
  X,
  BookOpen,
  FileText,
  Users,
  MessageSquare,
  ArrowRight,
  Command,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import {
  QuickAction,
  GlobalAIBarState,
  GlobalAIBarActions,
} from './useGlobalAIBar';
import { sendQuickAsk } from '@/services/global-ai-bar/api';
import AIMessageRenderer from '@/components/ui/content/AIMessageRenderer';

// ─────────────────────────────────────────────────────────
// Quick action config
// ─────────────────────────────────────────────────────────

interface ActionConfig {
  id: QuickAction;
  label: string;
  description: string;
  path: string;
  queryParam: string;
  Icon: React.ComponentType<{ className?: string }>;
  colorClass: string;
}

const QUICK_ACTIONS: ActionConfig[] = [
  {
    id: 'research',
    label: '深度研究',
    description: '多步骤 AI 研究报告',
    path: '/ai-research',
    queryParam: 'q',
    Icon: BookOpen,
    colorClass: 'text-blue-400',
  },
  {
    id: 'write',
    label: '写报告',
    description: '长文写作助手',
    path: '/ai-writing',
    queryParam: 'q',
    Icon: FileText,
    colorClass: 'text-green-400',
  },
  {
    id: 'teams',
    label: '团队分析',
    description: '多 Agent 协作辩论',
    path: '/ai-teams',
    queryParam: 'topic',
    Icon: Users,
    colorClass: 'text-purple-400',
  },
  {
    id: 'ask',
    label: '问答',
    description: '多模型智能问答',
    path: '/ai-ask',
    queryParam: 'q',
    Icon: MessageSquare,
    colorClass: 'text-orange-400',
  },
];

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────

type BarMode = 'input' | 'loading' | 'result';

type Props = GlobalAIBarState & GlobalAIBarActions;

export function GlobalAIBar({
  isOpen,
  query,
  selectedAction,
  close,
  setQuery,
  setSelectedAction,
}: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<BarMode>('input');
  const [answer, setAnswer] = useState('');
  const [answerSessionId, setAnswerSessionId] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Reset to input mode when bar opens/closes; cancel any in-flight request on close
  useEffect(() => {
    if (isOpen) {
      setMode('input');
      setAnswer('');
      setAnswerSessionId(null);
      setAskError(null);
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    } else {
      abortRef.current?.abort();
      abortRef.current = null;
    }
  }, [isOpen]);

  const getEffectiveAction = (): ActionConfig => {
    const found = QUICK_ACTIONS.find((a) => a.id === selectedAction);
    return found ?? QUICK_ACTIONS[3]; // default: ask
  };

  const handleSubmit = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    const action = getEffectiveAction();

    if (action.id === 'ask') {
      // Cancel any previous in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setMode('loading');
      setAskError(null);
      try {
        const result = await sendQuickAsk(trimmed);
        if (controller.signal.aborted) return;
        setAnswer(result.answer);
        setAnswerSessionId(result.sessionId);
        setMode('result');
      } catch (err) {
        if (controller.signal.aborted) return;
        setAskError(
          err instanceof Error && err.message
            ? `获取回答失败：${err.message}`
            : '获取回答失败，请重试或前往 AI 问答页面。'
        );
        setMode('result');
      }
    } else {
      // Route to the target module
      const params = new URLSearchParams({ [action.queryParam]: trimmed });
      close();
      router.push(`${action.path}?${params.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, selectedAction, close, router]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleSubmit();
    }
    if (e.key === 'Escape') {
      if (mode === 'loading') {
        abortRef.current?.abort();
        abortRef.current = null;
        setMode('input');
      } else if (mode === 'result') {
        setMode('input');
      } else {
        close();
      }
    }
  };

  const handleActionClick = (action: ActionConfig) => {
    setSelectedAction(action.id === selectedAction ? null : action.id);
    if (mode === 'result') setMode('input');
    inputRef.current?.focus();
  };

  if (!isOpen) return null;

  const activeAction = selectedAction
    ? QUICK_ACTIONS.find((a) => a.id === selectedAction)
    : null;
  const placeholderText = activeAction
    ? `${activeAction.description}...`
    : '描述你的任务，或选择一个快速操作';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={close}
        aria-hidden="true"
      />

      {/* Bar container */}
      <div
        role="dialog"
        aria-label="Global AI Bar"
        aria-modal="true"
        className="fixed left-1/2 top-[20%] z-50 w-full max-w-2xl -translate-x-1/2 px-4"
      >
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-gray-900 shadow-2xl">
          {/* Input row */}
          <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
            <Search className="h-5 w-5 shrink-0 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholderText}
              disabled={mode === 'loading'}
              className="flex-1 bg-transparent text-base text-white placeholder-gray-500 outline-none disabled:opacity-50"
            />
            {query && mode === 'input' && (
              <button
                onClick={() => setQuery('')}
                className="rounded p-1 text-gray-400 hover:text-white"
                aria-label="清空输入"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            {mode === 'result' && (
              <button
                onClick={() => {
                  setMode('input');
                  setAnswer('');
                  setAnswerSessionId(null);
                  setAskError(null);
                }}
                className="rounded p-1 text-gray-400 hover:text-white"
                aria-label="返回输入"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={() => void handleSubmit()}
              disabled={!query.trim() || mode === 'loading'}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
            >
              {mode === 'loading' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  发送
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </div>

          {/* Inline answer area (result mode) */}
          {mode === 'result' && (
            <div className="border-b border-white/10">
              {askError ? (
                <div className="flex items-start gap-2 px-4 py-3 text-sm text-red-400">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{askError}</span>
                </div>
              ) : (
                <div className="max-h-[300px] overflow-y-auto overflow-x-hidden px-4 py-3">
                  <AIMessageRenderer
                    content={answer || '（无回答内容）'}
                    className="text-sm"
                    isDark
                  />
                </div>
              )}
              {answerSessionId && (
                <div className="border-t border-white/5 px-4 py-2">
                  <Link
                    href={`/ai-ask?sessionId=${answerSessionId}`}
                    onClick={close}
                    className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                  >
                    在 AI 问答中继续对话
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* Loading indicator */}
          {mode === 'loading' && (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>AI 思考中…</span>
            </div>
          )}

          {/* Quick actions */}
          <div className="flex gap-2 px-4 py-3">
            {QUICK_ACTIONS.map((action) => {
              const isActive = selectedAction === action.id;
              return (
                <button
                  key={action.id}
                  onClick={() => handleActionClick(action)}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    isActive
                      ? 'border-blue-500/60 bg-blue-500/20 text-white'
                      : 'border-white/10 text-gray-400 hover:border-white/20 hover:text-white'
                  }`}
                >
                  <action.Icon
                    className={`h-3.5 w-3.5 ${isActive ? 'text-blue-400' : action.colorClass}`}
                  />
                  {action.label}
                </button>
              );
            })}
          </div>

          {/* Hint footer */}
          <div className="flex items-center justify-between border-t border-white/10 px-4 py-2 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <Command className="h-3 w-3" />
              <span>K</span>
              <span className="ml-1">唤起 / 关闭</span>
            </span>
            <span>Enter 发送 &nbsp;·&nbsp; Esc 关闭</span>
          </div>
        </div>
      </div>
    </>
  );
}
