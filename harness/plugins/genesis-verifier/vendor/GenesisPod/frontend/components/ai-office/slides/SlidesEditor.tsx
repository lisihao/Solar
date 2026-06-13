'use client';

/**
 * Slides Editor - 对话面板组件
 *
 * 包含 ConversationPanel、ToolCallCard 和 OutlineItem
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
  ChevronDown,
  Brain,
  FileText,
  Palette,
  Eye,
  Save,
  Layers,
  Grid3X3,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
  Copy,
  Play,
  Crown,
  Search,
  PenTool,
  CheckCircle,
  Users,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { useSlidesStore } from '@/stores';
import { formatDateSafe } from '@/lib/utils/date';
import { useI18n } from '@/lib/i18n';
import type {
  PageOutline,
  GenerationProgress,
  OutlinePlan,
} from '@/lib/types/slides';
import { PhaseTimeline } from './PhaseTimeline';

// ============================================================================
// 类型定义
// ============================================================================

export interface ToolCallItem {
  id: string;
  type:
    | 'thinking'
    | 'outline'
    | 'render'
    | 'image'
    | 'checkpoint'
    | 'data'
    | 'step'
    | 'user'
    | 'system';
  title: string;
  status: 'running' | 'completed' | 'error';
  content?: string;
  details?: Record<string, unknown>;
  timestamp: Date;
}

// ★ @ Mention 选项定义 (descriptions will be translated dynamically)
const MENTION_OPTIONS_BASE = [
  {
    id: 'leader',
    label: '@leader',
    icon: Crown,
    color: 'text-amber-500',
  },
  {
    id: 'analyst',
    label: '@analyst',
    icon: Search,
    color: 'text-blue-500',
  },
  {
    id: 'writer',
    label: '@writer',
    icon: PenTool,
    color: 'text-green-500',
  },
  {
    id: 'reviewer',
    label: '@reviewer',
    icon: CheckCircle,
    color: 'text-purple-500',
  },
  {
    id: 'team',
    label: '@team',
    icon: Users,
    color: 'text-orange-500',
  },
];

// ============================================================================
// ConversationPanel 组件
// ============================================================================

interface ConversationPanelProps {
  onSendMessage: (message: string) => void;
  onCancel: () => void;
  toolCalls: ToolCallItem[];
  generating: boolean;
  progress: GenerationProgress | null;
  outlinePlan: OutlinePlan | null;
  teamState: import('@/lib/types/slides-team').TeamExecutionState | null;
}

export function ConversationPanel({
  onSendMessage,
  onCancel,
  toolCalls,
  generating,
  progress,
  outlinePlan,
  teamState,
}: ConversationPanelProps) {
  const { t } = useI18n();
  const [inputValue, setInputValue] = useState('');
  const [outlineExpanded, setOutlineExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  // ★ @ Mention 状态
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { streamEvents, selectedPageIndex, setSelectedPageIndex } =
    useSlidesStore();

  // ★ @ Mention options with translated descriptions
  const MENTION_OPTIONS = React.useMemo(
    () =>
      MENTION_OPTIONS_BASE.map((option) => ({
        ...option,
        description: t(`office.slides.agents.${option.id}`),
      })),
    [t]
  );

  // 提取对话消息
  const chatMessages = React.useMemo(() => {
    const items: Array<{
      id: string;
      role: 'user' | 'system' | 'agent';
      author: string;
      message: string;
      timestamp: Date;
    }> = [];

    streamEvents.forEach((event, index) => {
      const data = (event.data || {}) as Record<string, unknown>;
      const timestamp =
        event.timestamp instanceof Date
          ? event.timestamp
          : new Date(event.timestamp);

      if (event.type === 'user_message') {
        if (!data.message) return;
        items.push({
          id: `${event.type}-${timestamp.getTime()}-${index}`,
          role: 'user',
          author: t('office.slides.me'),
          message: String(data.message),
          timestamp,
        });
        return;
      }

      if (event.type === 'system_message') {
        if (!data.message) return;
        items.push({
          id: `${event.type}-${timestamp.getTime()}-${index}`,
          role: 'system',
          author: String(data.source || t('office.slides.system')),
          message: String(data.message),
          timestamp,
        });
        return;
      }

      if (
        event.type === 'agent:working' ||
        event.type === 'agent:completed' ||
        event.type === 'mission:agent_working' ||
        event.type === 'mission:agent_done'
      ) {
        const message =
          data.thought || data.task || data.result || data.message || '';
        if (!message) return;
        items.push({
          id: `${event.type}-${timestamp.getTime()}-${index}`,
          role: 'agent',
          author: String(data.agentName || data.agent || 'Agent'),
          message: String(message),
          timestamp,
        });
      }
    });

    return items.slice(-50);
  }, [streamEvents]);

  const renderMessageText = useCallback((text: string) => {
    return text.split(/(@[\w-]+)/g).map((part, idx) => {
      if (part.startsWith('@')) {
        return (
          <span key={idx} className="font-medium text-orange-600">
            {part}
          </span>
        );
      }
      return <span key={idx}>{part}</span>;
    });
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [toolCalls, progress, chatMessages]);

  // ★ 检测 @ mention
  useEffect(() => {
    const text = inputValue;
    const lastAtIndex = text.lastIndexOf('@');

    if (lastAtIndex !== -1) {
      const afterAt = text.slice(lastAtIndex + 1);
      // 如果 @ 后面没有空格，说明用户正在输入 mention
      if (!afterAt.includes(' ')) {
        setShowMentionMenu(true);
        setMentionFilter(afterAt.toLowerCase());
        setSelectedMentionIndex(0);
      } else {
        setShowMentionMenu(false);
        setMentionFilter('');
      }
    } else {
      setShowMentionMenu(false);
      setMentionFilter('');
    }
  }, [inputValue]);

  // ★ 过滤后的 mention 选项
  const filteredMentionOptions = React.useMemo(() => {
    if (!mentionFilter) return MENTION_OPTIONS;
    return MENTION_OPTIONS.filter(
      (opt) =>
        opt.id.toLowerCase().includes(mentionFilter) ||
        opt.label.toLowerCase().includes(mentionFilter)
    );
  }, [mentionFilter]);

  // ★ 处理 mention 选择
  const handleMentionSelect = useCallback(
    (option: (typeof MENTION_OPTIONS)[0]) => {
      const lastAtIndex = inputValue.lastIndexOf('@');
      if (lastAtIndex !== -1) {
        const newValue = inputValue.slice(0, lastAtIndex) + option.label + ' ';
        setInputValue(newValue);
      }
      setShowMentionMenu(false);
      setMentionFilter('');
      textareaRef.current?.focus();
    },
    [inputValue]
  );

  const handleSend = useCallback(() => {
    if (!inputValue.trim()) return;
    onSendMessage(inputValue.trim());
    setInputValue('');
    setShowMentionMenu(false);
    setMentionFilter('');
  }, [inputValue, onSendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // ★ 处理 mention 菜单导航
      if (showMentionMenu && filteredMentionOptions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedMentionIndex((prev) =>
            prev < filteredMentionOptions.length - 1 ? prev + 1 : 0
          );
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedMentionIndex((prev) =>
            prev > 0 ? prev - 1 : filteredMentionOptions.length - 1
          );
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          handleMentionSelect(filteredMentionOptions[selectedMentionIndex]);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowMentionMenu(false);
          return;
        }
      }

      // 正常的 Enter 提交
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [
      handleSend,
      showMentionMenu,
      filteredMentionOptions,
      selectedMentionIndex,
      handleMentionSelect,
    ]
  );

  // 复制日志到剪贴板
  const handleCopyLog = useCallback(() => {
    const logText = streamEvents
      .map((event) => {
        const time = formatDateSafe(event.timestamp, 'time');
        const data = JSON.stringify(event.data, null, 2);
        return `[${time}] ${event.type}\n${data}`;
      })
      .join('\n\n');

    navigator.clipboard.writeText(logText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [streamEvents]);

  return (
    <div className="flex h-full w-[360px] flex-shrink-0 flex-col border-r border-slate-200 bg-slate-50">
      {/* 顶部：Agent 团队栏 - 紧凑图标设计 */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 bg-gradient-to-r from-slate-800 to-slate-900 px-3 py-1.5">
        <div className="flex items-center gap-0.5">
          {MENTION_OPTIONS.map((agent) => (
            <button
              key={agent.id}
              onClick={() => {
                setInputValue((prev) => prev + agent.label + ' ');
                textareaRef.current?.focus();
              }}
              className="group relative rounded p-1.5 transition-all hover:bg-slate-700"
              title={`@${agent.id} - ${agent.description}`}
            >
              <agent.icon className={cn('h-4 w-4', agent.color)} />
            </button>
          ))}
        </div>
        <button
          onClick={handleCopyLog}
          disabled={streamEvents.length === 0}
          className={cn(
            'rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-700 hover:text-slate-300',
            copied && 'text-green-400'
          )}
          title={t('office.slides.copyLogs')}
        >
          {copied ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* 中间：对话和进度区域 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {/* 对话记录 */}
        <div className="border-b border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">
              {t('office.slides.conversation')}
            </span>
            <span className="text-[10px] text-slate-400">
              {chatMessages.length} {t('office.slides.messages')}
            </span>
          </div>
          <div className="space-y-2">
            {chatMessages.length === 0 ? (
              <div className="py-2 text-center text-xs text-slate-400">
                {t('office.slides.noConversations')}
              </div>
            ) : (
              chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    'rounded-lg p-2.5',
                    msg.role === 'user' && 'ml-4 bg-blue-50',
                    msg.role === 'system' && 'bg-slate-100',
                    msg.role === 'agent' && 'mr-4 bg-amber-50'
                  )}
                >
                  <div className="mb-1 flex items-center gap-1.5 text-[10px]">
                    <span
                      className={cn(
                        'font-medium',
                        msg.role === 'user' && 'text-blue-600',
                        msg.role === 'system' && 'text-slate-600',
                        msg.role === 'agent' && 'text-amber-600'
                      )}
                    >
                      {msg.author}
                    </span>
                    <span className="text-slate-400">
                      {formatDateSafe(msg.timestamp, 'time')}
                    </span>
                  </div>
                  <div className="whitespace-pre-wrap text-sm text-slate-800">
                    {renderMessageText(msg.message)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 生成进度 */}
        <div className="p-3">
          <PhaseTimeline
            teamState={teamState}
            generating={generating}
            progress={
              progress
                ? {
                    currentPage: progress.currentPage,
                    totalPages: progress.totalPages,
                    message: progress.message,
                  }
                : undefined
            }
          />

          {/* 取消按钮 */}
          {generating && (
            <div className="mt-3 flex justify-center">
              <button
                onClick={onCancel}
                className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-100"
              >
                <X className="h-3.5 w-3.5" />
                {t('office.slides.cancelGeneration')}
              </button>
            </div>
          )}

          {/* 大纲预览 */}
          {outlinePlan && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-white p-2.5">
              <button
                onClick={() => setOutlineExpanded(!outlineExpanded)}
                className="flex w-full items-center gap-2 text-left text-xs font-medium text-slate-700"
              >
                <FileText className="h-3.5 w-3.5 text-blue-500" />
                {t('office.slides.outline')} ({outlinePlan.pages.length}{' '}
                {t('office.slides.pages')})
                <ChevronDown
                  className={cn(
                    'ml-auto h-3.5 w-3.5 transition-transform',
                    outlineExpanded ? '' : '-rotate-90'
                  )}
                />
              </button>

              <AnimatePresence>
                {outlineExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-2 space-y-1">
                      {outlinePlan.pages.map(
                        (page: PageOutline, index: number) => (
                          <OutlineItem
                            key={index}
                            page={page}
                            index={index}
                            isSelected={selectedPageIndex === index}
                            onClick={() => setSelectedPageIndex(index)}
                          />
                        )
                      )}
                    </div>

                    <div className="mt-2">
                      {generating ? (
                        <div className="flex items-center justify-center gap-1.5 rounded bg-orange-100 py-1 text-xs font-medium text-orange-700">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {t('office.slides.generating')}
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-1.5 rounded bg-green-100 py-1 text-xs font-medium text-green-700">
                          <CheckCircle2 className="h-3 w-3" />
                          {t('office.slides.completed')}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* 固定在底部的输入框 */}
      <div className="relative flex-shrink-0 border-t border-gray-200 bg-white p-3">
        {/* ★ @ Mention 菜单 */}
        <AnimatePresence>
          {showMentionMenu && filteredMentionOptions.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="absolute bottom-full left-3 right-3 z-50 mb-2 rounded-lg border border-gray-200 bg-white shadow-lg"
            >
              {filteredMentionOptions.map((option, index) => (
                <button
                  key={option.id}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
                    index === selectedMentionIndex
                      ? 'bg-orange-50 text-orange-700'
                      : 'hover:bg-gray-50',
                    index === 0 && 'rounded-t-lg',
                    index === filteredMentionOptions.length - 1 &&
                      'rounded-b-lg'
                  )}
                  onClick={() => handleMentionSelect(option)}
                  onMouseEnter={() => setSelectedMentionIndex(index)}
                >
                  <option.icon
                    className={cn('h-4 w-4 flex-shrink-0', option.color)}
                  />
                  <span className="text-sm font-medium">{option.label}</span>
                  <span className="truncate text-xs text-gray-400">
                    {option.description}
                  </span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('office.slides.inputPlaceholder')}
            rows={2}
            className="max-h-32 min-h-[56px] flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
          />
          <button
            onClick={() => {
              if (inputValue.trim()) {
                handleSend();
              } else {
                onSendMessage(`@leader ${t('office.slides.continue')}`);
              }
            }}
            className={cn(
              'rounded-lg p-2.5 transition-colors',
              inputValue.trim()
                ? 'bg-orange-500 text-white hover:bg-orange-600'
                : 'bg-green-500 text-white hover:bg-green-600'
            )}
            title={
              inputValue.trim()
                ? t('office.slides.sendMessage')
                : t('office.slides.continue')
            }
          >
            {inputValue.trim() ? (
              <Send className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// ToolCallCard 组件
// ============================================================================

export function ToolCallCard({ call }: { call: ToolCallItem }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const hasDetails = call.content || call.details;

  const getIcon = () => {
    switch (call.type) {
      case 'thinking':
        return <Brain className="h-4 w-4" />;
      case 'outline':
        return <FileText className="h-4 w-4" />;
      case 'render':
        return <Palette className="h-4 w-4" />;
      case 'image':
        return <Eye className="h-4 w-4" />;
      case 'checkpoint':
        return <Save className="h-4 w-4" />;
      case 'step':
        return <Layers className="h-4 w-4" />;
      case 'data':
        return <Grid3X3 className="h-4 w-4" />;
      default:
        return <Brain className="h-4 w-4" />;
    }
  };

  const getStatusIcon = () => {
    switch (call.status) {
      case 'running':
        return <Loader2 className="h-4 w-4 animate-spin text-orange-500" />;
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
    }
  };

  const getStatusBg = () => {
    switch (call.status) {
      case 'running':
        return 'border-orange-200 bg-orange-50';
      case 'completed':
        return 'border-gray-200 bg-white';
      case 'error':
        return 'border-red-200 bg-red-50';
    }
  };

  // 渲染详细信息
  const renderDetails = () => {
    if (!call.details) return null;

    const details = call.details as {
      dataPoints?: Array<{ type: string; value: string; context: string }>;
      insights?: string[];
    };

    return (
      <div className="space-y-2">
        {details.dataPoints && details.dataPoints.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-500">
              {t('office.slides.dataPoints')}
            </div>
            <div className="space-y-1">
              {details.dataPoints.map((dp, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded bg-blue-50 px-2 py-1 text-xs"
                >
                  <span className="font-semibold text-blue-700">
                    {dp.value}
                  </span>
                  <span className="text-gray-600">{dp.context}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {details.insights && details.insights.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-500">
              {t('office.slides.keyInsights')}
            </div>
            <div className="space-y-1">
              {details.insights.map((insight, i) => (
                <div
                  key={i}
                  className="rounded bg-green-50 px-2 py-1 text-xs text-green-700"
                >
                  {insight}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={cn('rounded-lg border', getStatusBg())}>
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className="flex w-full items-center gap-3 p-3 text-left"
        disabled={!hasDetails}
      >
        <div
          className={cn(
            'flex-shrink-0',
            call.status === 'running'
              ? 'text-orange-500'
              : call.status === 'error'
                ? 'text-red-500'
                : 'text-gray-500'
          )}
        >
          {getIcon()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-gray-900">
            {call.title}
          </div>
          {call.content && !expanded && (
            <div className="mt-0.5 truncate text-xs text-gray-500">
              {call.content.split('\n')[0]}
            </div>
          )}
          <div className="mt-0.5 text-[10px] text-gray-400">
            {formatDateSafe(call.timestamp, 'time')}
          </div>
        </div>
        {getStatusIcon()}
        {hasDetails && (
          <ChevronDown
            className={cn(
              'h-4 w-4 flex-shrink-0 text-gray-400 transition-transform',
              expanded ? '' : '-rotate-90'
            )}
          />
        )}
      </button>

      <AnimatePresence>
        {expanded && hasDetails && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 border-t border-gray-100 p-3">
              {call.content && (
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs text-gray-600">
                  {call.content}
                </pre>
              )}
              {renderDetails()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// OutlineItem 组件
// ============================================================================

function OutlineItem({
  page,
  index,
  isSelected,
  onClick,
}: {
  page: PageOutline;
  index: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
        isSelected
          ? 'bg-orange-100 ring-1 ring-orange-300'
          : 'bg-slate-50 hover:bg-slate-100'
      )}
    >
      <span
        className={cn(
          'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-[10px] font-medium',
          isSelected
            ? 'bg-orange-500 text-white'
            : 'bg-orange-100 text-orange-600'
        )}
      >
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'truncate font-medium',
            isSelected ? 'text-orange-700' : 'text-slate-700'
          )}
        >
          {page.title}
        </div>
        <div className="truncate text-[10px] text-slate-400">
          {page.templateType}
        </div>
      </div>
    </button>
  );
}
