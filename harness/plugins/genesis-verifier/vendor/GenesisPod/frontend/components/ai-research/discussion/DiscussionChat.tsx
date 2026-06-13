'use client';

/**
 * DiscussionChat - Pure chat area for discussion-driven research
 *
 * Extracted from the original DiscussionChat: only the chat message stream,
 * search progress bar, and typing indicator. No embedded AgentPanel or
 * ReportPanel (those are in the outer ResearchProjectLayout).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Loader2,
  AlertCircle,
  X,
  Search,
  Sparkles,
  History,
  Trash2,
  ArrowLeft,
  RefreshCw,
  Send,
  StopCircle,
  Timer,
  Settings,
  Check,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { cn } from '@/lib/utils/common';
import type { DiscussionResearchState } from '@/hooks';
import {
  DEFAULT_OPTIONS,
  type ResearchCreationOptions,
} from '../research-creation-dialog';
import { ResearchOptionsBar } from './ResearchOptionsBar';
import { PhaseIndicator } from './PhaseIndicator';
import { ChatMessage } from './ChatMessage';
import { PhaseTransition } from './PhaseTransition';
import ClientDate from '@/components/common/ClientDate';
import { getFriendlyError } from './errorMessages';
import type { ResearchSession } from '../types';

// ==================== Types ====================

interface DiscussionChatProps {
  state: DiscussionResearchState;
  query: string;
  isSearching: boolean;
  sessions: ResearchSession[];
  onStartResearch: (query: string, options?: ResearchCreationOptions) => void;
  onStop: () => void;
  onViewSession: (session: ResearchSession) => void;
  onDeleteSession: (sessionId: string) => void | Promise<void>;
  viewingSession: ResearchSession | null;
  onBackToList: () => void;
  isIterating?: boolean;
  onRetry?: () => void;
  onSendFeedback?: (feedback: string) => Promise<void> | void;
  onExtendFeedback?: (additionalMs?: number) => Promise<boolean>;
  onSkipPhase?: () => Promise<void>;
  awaitingFeedback?: {
    round: number;
    score: number;
    gaps: { dataGaps: string[]; ideaGaps: string[] };
    timeoutMs: number;
  } | null;
  activeSessionId?: string | null;
  className?: string;
}

// ==================== Component ====================

export function DiscussionChat({
  state,
  query,
  isSearching,
  sessions,
  onStartResearch,
  onStop,
  onViewSession,
  onDeleteSession,
  viewingSession,
  onBackToList,
  isIterating,
  onRetry,
  onSendFeedback,
  onExtendFeedback,
  onSkipPhase,
  awaitingFeedback,
  activeSessionId,
  className,
}: DiscussionChatProps) {
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [feedbackInput, setFeedbackInput] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [dismissedError, setDismissedError] = useState(false);
  const [researchOptions, setResearchOptions] =
    useState<ResearchCreationOptions>(DEFAULT_OPTIONS);
  const [showOptions, setShowOptions] = useState(false);
  // Note: ref resets on tab-switch remount, so the summary bar disappears
  // when switching away from the discussion tab. This is acceptable since
  // the info is also visible in the report's metadata header.
  const lastSearchProgressRef = useRef(state.searchProgress);

  // Capture final search progress for summary display
  useEffect(() => {
    if (state.searchProgress) {
      lastSearchProgressRef.current = state.searchProgress;
    }
  }, [state.searchProgress]);

  // Reset dismissed state when a new error appears
  useEffect(() => {
    if (state.error) setDismissedError(false);
  }, [state.error]);

  useEffect(() => {
    if (!awaitingFeedback) {
      setCountdown(0);
      return;
    }
    const total = Math.ceil(awaitingFeedback.timeoutMs / 1000);
    setCountdown(total);
    const interval = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [awaitingFeedback]);

  // Determine view mode
  const isResearching = isSearching && state.phase !== 'idle';
  const isViewingHistory = viewingSession !== null && !isResearching;
  const showList = !isResearching && !isViewingHistory;

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [state.messages, state.typingAgent, autoScroll]);

  // Detect manual scroll to disable auto-scroll
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    setAutoScroll(isNearBottom);
  };

  const handleSubmit = useCallback(() => {
    const trimmed = searchInput.trim();
    if (!trimmed || isSearching) return;
    setSearchInput('');
    onStartResearch(trimmed, researchOptions);
  }, [searchInput, isSearching, researchOptions, onStartResearch]);

  const handleSendFeedback = useCallback(() => {
    const trimmed = feedbackInput.trim();
    if (!trimmed) return;
    onSendFeedback?.(trimmed);
    setFeedbackInput('');
  }, [feedbackInput, onSendFeedback]);

  const handleDelete = useCallback(
    async (sessionId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (deletingId) return;
      setDeletingId(sessionId);
      try {
        await onDeleteSession(sessionId);
      } finally {
        setDeletingId(null);
      }
    },
    [deletingId, onDeleteSession]
  );

  // ==================== List View ====================
  if (showList) {
    return (
      <div className={cn('flex h-full flex-col overflow-hidden', className)}>
        {/* Search Input */}
        <div className="flex-shrink-0 border-b border-gray-200 bg-white px-6 py-4">
          <div className="mx-auto max-w-3xl">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                placeholder="输入研究问题，开始多 Agent 讨论..."
                className="w-full rounded-xl border border-gray-300 bg-white py-3 pl-12 pr-32 text-sm text-gray-900 placeholder-gray-500 transition-colors focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-100"
              />
              <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                <button
                  onClick={() => setShowOptions((p) => !p)}
                  className={cn(
                    'flex items-center justify-center rounded-lg p-2 text-sm transition-all',
                    showOptions
                      ? 'bg-purple-100 text-purple-600'
                      : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
                  )}
                  title="研究选项"
                >
                  <Settings className="h-4 w-4" />
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!searchInput.trim() || isSearching}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all',
                    searchInput.trim() && !isSearching
                      ? 'bg-purple-600 text-white hover:bg-purple-700'
                      : 'cursor-not-allowed bg-gray-100 text-gray-400'
                  )}
                >
                  <Sparkles className="h-4 w-4" />
                  研究
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Research Options (inline, replaces modal) */}
        <ResearchOptionsBar
          options={researchOptions}
          onOptionsChange={setResearchOptions}
          visible={showOptions}
        />

        {/* Session History */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="mx-auto max-w-3xl">
            {sessions.length === 0 ? (
              <EmptyState
                icon={<Search className="h-12 w-12" />}
                title="开始你的第一次研究"
                description="输入一个研究问题，AI 研究团队将展开多角度讨论，深度搜索并产出研究报告"
              />
            ) : (
              <div className="space-y-2">
                <div className="mb-3 flex items-center gap-2 text-sm text-gray-500">
                  <History className="h-4 w-4" />
                  <span>历史研究 ({sessions.length})</span>
                </div>
                {sessions.map((session) => {
                  const isIterativeSession = session.mode === 'iterative';
                  return (
                    <button
                      key={session.id}
                      onClick={() => onViewSession(session)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg border bg-white p-4 text-left transition-colors',
                        isIterativeSession
                          ? 'border-gray-200 hover:border-blue-200 hover:bg-blue-50/30'
                          : 'border-gray-200 hover:border-purple-200 hover:bg-purple-50/30'
                      )}
                    >
                      <div
                        className={cn(
                          'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg',
                          isIterativeSession ? 'bg-blue-100' : 'bg-purple-100'
                        )}
                      >
                        {isIterativeSession ? (
                          <RefreshCw className="h-5 w-5 text-blue-600" />
                        ) : (
                          <Search className="h-5 w-5 text-purple-600" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="truncate text-sm font-medium text-gray-900">
                            {session.query}
                          </h4>
                          {isIterativeSession && (
                            <>
                              <span className="flex-shrink-0 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                                迭代
                              </span>
                              {session.report?.metadata?.searchRounds &&
                                session.report.metadata.searchRounds > 1 && (
                                  <span className="flex-shrink-0 text-[10px] text-gray-400">
                                    {session.report.metadata.searchRounds} 轮
                                  </span>
                                )}
                            </>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-3 text-xs text-gray-500">
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-xs font-medium',
                              session.status === 'COMPLETED'
                                ? 'bg-green-100 text-green-700'
                                : session.status === 'FAILED'
                                  ? 'bg-red-100 text-red-700'
                                  : session.id === activeSessionId
                                    ? 'bg-blue-100 text-blue-700'
                                    : 'bg-amber-100 text-amber-700'
                            )}
                          >
                            {session.status === 'COMPLETED'
                              ? '已完成'
                              : session.status === 'FAILED'
                                ? '失败'
                                : session.id === activeSessionId
                                  ? '进行中'
                                  : '已中断'}
                          </span>
                          <ClientDate
                            date={session.createdAt}
                            format="relative"
                          />
                          {session.sourcesUsed > 0 && (
                            <span>{session.sourcesUsed} 来源</span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={(e) => handleDelete(session.id, e)}
                        disabled={deletingId === session.id}
                        className="rounded p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                      >
                        {deletingId === session.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ==================== Viewing History ====================
  if (isViewingHistory && viewingSession) {
    const historyMessages = (viewingSession.discussion || []).map((msg) => ({
      ...msg,
      agentRole: msg.agentRole as import('@/hooks').DiscussionRole,
      phase: msg.phase as import('@/hooks').DiscussionPhase,
      messageType: msg.messageType as import('@/hooks').DiscussionMessageType,
      metadata: msg.metadata as import('@/hooks').DiscussionMessage['metadata'],
    }));

    return (
      <div className={cn('flex h-full flex-col overflow-hidden', className)}>
        {/* Back header */}
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
          <button
            onClick={onBackToList}
            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-gray-900">
              {viewingSession.query}
            </h3>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <ClientDate date={viewingSession.createdAt} format="relative" />
              {viewingSession.sourcesUsed > 0 && (
                <span>{viewingSession.sourcesUsed} 来源</span>
              )}
            </div>
          </div>
        </div>

        {/* History messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="mx-auto max-w-3xl">
            {historyMessages.length === 0 ? (
              <EmptyState
                icon={<AlertCircle className="h-10 w-10" />}
                title={
                  viewingSession.status === 'FAILED'
                    ? '研究执行失败'
                    : viewingSession.status !== 'COMPLETED'
                      ? '研究已中断'
                      : '讨论记录为空'
                }
                description={
                  viewingSession.status === 'FAILED'
                    ? viewingSession.error || '执行过程中发生错误'
                    : viewingSession.status !== 'COMPLETED'
                      ? '研究已中断，部分数据请查看迭代/报告 Tab'
                      : '该研究已完成但未保存讨论消息，请查看报告 Tab'
                }
              />
            ) : (
              historyMessages.map((message) => {
                if (message.messageType === 'system') {
                  return (
                    <PhaseTransition
                      key={message.id}
                      phase={message.phase}
                      summary={message.content}
                      directions={message.metadata?.directions}
                    />
                  );
                }
                return <ChatMessage key={message.id} message={message} />;
              })
            )}
          </div>
        </div>
      </div>
    );
  }

  // ==================== Active Research View ====================
  return (
    <div className={cn('flex h-full flex-col overflow-hidden', className)}>
      {/* Phase Indicator - top bar (flex-shrink-0 keeps it fixed) */}
      <PhaseIndicator currentPhase={state.phase} onSkipPhase={onSkipPhase} />

      {/* Search Progress Bar */}
      {state.phase === 'execution' && state.searchProgress && (
        <div className="flex-shrink-0 border-b border-blue-200 bg-blue-50 px-6 py-2.5">
          <div className="flex items-center gap-3">
            <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-blue-600" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-blue-900">
                {state.searchProgress.message}
              </p>
              <div className="mt-1 h-1.5 w-full rounded-full bg-blue-200">
                <div
                  className="h-1.5 rounded-full bg-blue-600 transition-all duration-500"
                  style={{
                    width: `${state.searchProgress.totalRounds > 0 ? (state.searchProgress.currentRound / state.searchProgress.totalRounds) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
            <span className="text-xs font-medium text-blue-600">
              {state.searchProgress.currentRound}/
              {state.searchProgress.totalRounds}
            </span>
          </div>
        </div>
      )}

      {/* Search Complete Summary (shows only during findings/synthesis of active research) */}
      {(state.phase === 'findings' || state.phase === 'synthesis') &&
        lastSearchProgressRef.current &&
        lastSearchProgressRef.current.totalRounds > 0 && (
          <div className="flex-shrink-0 border-b border-green-200 bg-green-50 px-6 py-2">
            <div className="flex items-center gap-2 text-xs text-green-700">
              <Check className="h-3.5 w-3.5" />
              <span>
                已搜索 {lastSearchProgressRef.current.resultsCount} 个来源，共{' '}
                {lastSearchProgressRef.current.totalRounds} 轮
              </span>
            </div>
          </div>
        )}

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4" onScroll={handleScroll}>
        <div className="mx-auto max-w-3xl">
          {/* Query Header */}
          <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">{query}</h2>
          </div>

          {/* Messages */}
          {state.messages.map((message) => {
            if (message.messageType === 'system') {
              return (
                <PhaseTransition
                  key={message.id}
                  phase={message.phase}
                  summary={message.content}
                  directions={message.metadata?.directions}
                />
              );
            }
            return <ChatMessage key={message.id} message={message} />;
          })}

          {/* Typing Indicator */}
          {state.typingAgent && (
            <div className="my-4 flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{state.typingAgent.name} 正在思考...</span>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>
      </div>

      {/* Error Banner */}
      {state.error &&
        !dismissedError &&
        (() => {
          const friendly = getFriendlyError(state.error);
          return (
            <div className="border-t border-red-200 bg-red-50 px-6 py-3">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-red-800">
                    {friendly.title}
                  </p>
                  <p className="mt-0.5 text-xs text-red-600">
                    {friendly.description}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  {friendly.retryable && onRetry && (
                    <button
                      onClick={onRetry}
                      className="flex items-center gap-1 rounded-md bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-200"
                    >
                      <RefreshCw className="h-3 w-3" />
                      重试
                    </button>
                  )}
                  <button
                    onClick={() => setDismissedError(true)}
                    className="rounded p-1 transition-colors hover:bg-red-100"
                  >
                    <X className="h-4 w-4 text-red-600" />
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* Iteration Evaluation Card */}
      {awaitingFeedback && (
        <div className="flex-shrink-0 border-t border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4">
          <div className="mx-auto max-w-3xl">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-900">
                  第 {awaitingFeedback.round} 轮评估
                </span>
                <span
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-sm font-bold',
                    awaitingFeedback.score >= 70
                      ? 'bg-green-100 text-green-700'
                      : awaitingFeedback.score >= 40
                        ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-red-100 text-red-700'
                  )}
                >
                  {awaitingFeedback.score.toFixed(1)}/100
                </span>
              </div>
              <div className="flex items-center gap-2">
                {onExtendFeedback && countdown > 0 && (
                  <button
                    onClick={() => {
                      void onExtendFeedback(120_000);
                      setCountdown(120);
                    }}
                    className="flex items-center gap-1 rounded-md border border-blue-200 bg-white px-2 py-0.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50"
                  >
                    <Timer className="h-3 w-3" />
                    需要更多时间
                  </button>
                )}
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <Timer className="h-3.5 w-3.5" />
                  <span
                    className={cn(
                      countdown > 0 &&
                        countdown <= 10 &&
                        'animate-pulse font-bold text-red-500'
                    )}
                  >
                    {countdown > 0 ? (
                      `${countdown}s 后自动继续`
                    ) : (
                      <span className="flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        自动继续中...
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </div>
            {/* Gaps */}
            <div className="grid grid-cols-2 gap-3">
              {awaitingFeedback.gaps.dataGaps.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-gray-500">
                    数据差距
                  </p>
                  <ul className="space-y-0.5">
                    {awaitingFeedback.gaps.dataGaps
                      .slice(0, 3)
                      .map((gap, i) => (
                        <li key={i} className="truncate text-xs text-gray-700">
                          <span className="mr-1 text-blue-500">-</span>
                          {gap}
                        </li>
                      ))}
                  </ul>
                </div>
              )}
              {awaitingFeedback.gaps.ideaGaps.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-gray-500">
                    创意差距
                  </p>
                  <ul className="space-y-0.5">
                    {awaitingFeedback.gaps.ideaGaps
                      .slice(0, 3)
                      .map((gap, i) => (
                        <li key={i} className="truncate text-xs text-gray-700">
                          <span className="mr-1 text-indigo-500">-</span>
                          {gap}
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Bar: Feedback Input (iterative) or Status Bar (single) */}
      {isIterating ? (
        <div className="flex-shrink-0 border-t border-gray-200 bg-white px-6 py-3">
          <div className="mx-auto max-w-3xl">
            <p className="mb-2 text-xs text-purple-600">
              {awaitingFeedback
                ? '输入反馈以引导下一轮研究方向，或等待自动继续'
                : '迭代研究进行中 — 输入内容将影响下一轮研究方向'}
            </p>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={feedbackInput}
                onChange={(e) => setFeedbackInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendFeedback()}
                placeholder="输入你的想法或研究方向建议..."
                className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-100"
              />
              <button
                onClick={handleSendFeedback}
                disabled={!feedbackInput.trim()}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all',
                  feedbackInput.trim()
                    ? 'bg-purple-600 text-white hover:bg-purple-700'
                    : 'cursor-not-allowed bg-gray-100 text-gray-400'
                )}
              >
                <Send className="h-4 w-4" />
                发送
              </button>
              <button
                onClick={onStop}
                className="flex items-center gap-1.5 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 transition-all hover:bg-red-50"
              >
                <StopCircle className="h-4 w-4" />
                停止
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-shrink-0 border-t border-gray-200 bg-white px-6 py-2">
          <div className="mx-auto flex max-w-3xl items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-500" />
              <span>研究进行中...</span>
            </div>
            <button
              onClick={onStop}
              className="flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 transition-all hover:bg-red-50"
            >
              <StopCircle className="h-4 w-4" />
              停止
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
