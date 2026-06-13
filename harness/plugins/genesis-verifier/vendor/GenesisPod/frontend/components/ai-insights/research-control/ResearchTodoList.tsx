/**
 * ResearchTodoList Component
 *
 * 研究任务列表组件 - 单一扁平表格形式
 * v2.0: 移除分组折叠，使用单一表格显示所有任务
 */

'use client';

import React, { useState, useMemo } from 'react';
import { confirm } from '@/stores';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { ModelBadge } from '@/components/common/badges/ModelBadge';
import {
  CheckCircle2,
  Circle,
  Clock,
  ClipboardList,
  Loader2,
  Pause,
  Play,
  X,
  RotateCcw,
  Link2,
  ChevronDown,
  ChevronRight,
  Lightbulb,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { useTranslation } from '@/lib/i18n';
import {
  ResearchTodo,
  ResearchTodoStatus,
  ResearchTodoType,
  TodoSummary,
} from '@/lib/types/topic-insights';
import { logger } from '@/lib/utils/logger';
import {
  pauseTodo,
  resumeTodo,
  cancelTodo,
  retryTodo,
  executeTodo,
} from '@/services/topic-insights/api';

// ==================== Types ====================

interface ResearchTodoListProps {
  todos: ResearchTodo[];
  summary?: TodoSummary | null;
  topicId: string;
  isLoading?: boolean;
  onTodoUpdated?: (todo: ResearchTodo) => void;
  onTodoDeleted?: (todoId: string) => void;
  onTodoSelect?: (todoId: string) => void;
  selectedTodoId?: string | null;
}

// ==================== Constants ====================

// Status config factory - returns config with translated labels
const getStatusConfig = (
  t: (key: string) => string
): Record<
  ResearchTodoStatus,
  { label: string; icon: React.ReactNode; color: string; bgColor: string }
> => ({
  [ResearchTodoStatus.PENDING]: {
    label: t('topicResearch.status.pending'),
    icon: <Circle className="h-3 w-3" />,
    color: 'text-gray-500',
    bgColor: 'bg-gray-100',
  },
  [ResearchTodoStatus.QUEUED]: {
    label: t('topicResearch.status.queued'),
    icon: <Clock className="h-3 w-3" />,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-50',
  },
  [ResearchTodoStatus.IN_PROGRESS]: {
    label: t('topicResearch.status.researching'),
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
  },
  [ResearchTodoStatus.REVIEWING]: {
    label: t('topicResearch.status.reviewing'),
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
  },
  [ResearchTodoStatus.PAUSED]: {
    label: t('topicResearch.status.paused'),
    icon: <Pause className="h-3 w-3" />,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
  },
  [ResearchTodoStatus.COMPLETED]: {
    label: t('topicResearch.status.completed'),
    icon: <CheckCircle2 className="h-3 w-3" />,
    color: 'text-green-600',
    bgColor: 'bg-green-50',
  },
  [ResearchTodoStatus.FAILED]: {
    label: t('topicResearch.status.failed'),
    icon: <X className="h-3 w-3" />,
    color: 'text-red-600',
    bgColor: 'bg-red-50',
  },
  [ResearchTodoStatus.CANCELLED]: {
    label: t('topicResearch.status.cancelled'),
    icon: <X className="h-3 w-3" />,
    color: 'text-gray-500',
    bgColor: 'bg-gray-100',
  },
});

const TYPE_ICONS: Record<ResearchTodoType, string> = {
  [ResearchTodoType.LEADER_PLANNING]: '🧠',
  [ResearchTodoType.DIMENSION_RESEARCH]: '🔍',
  [ResearchTodoType.REPORT_WRITING]: '📝',
  [ResearchTodoType.QUALITY_REVIEW]: '✅',
  [ResearchTodoType.USER_REQUEST]: '💬',
};

// ==================== Helper Functions ====================

/**
 * 从 agentName 中解析模型ID
 * 格式: "研究员名称 [model-id]" 或直接 agentName
 */
function parseAgentInfo(todo: ResearchTodo): {
  name: string;
  modelId: string | null;
  modelDisplayName: string | null;
} {
  // 优先使用直接的 modelId 字段
  if (todo.modelId) {
    return {
      name: todo.agentName || '待分配',
      modelId: todo.modelId,
      modelDisplayName: todo.modelDisplayName || null,
    };
  }

  // 尝试从 agentName 解析 [model-id] 格式
  const agentName = todo.agentName || '待分配';
  const modelMatch = agentName.match(/^(.+?)\s*\[([^\]]+)\]$/);

  if (modelMatch) {
    return {
      name: modelMatch[1].trim(),
      modelId: modelMatch[2],
      modelDisplayName: null,
    };
  }

  return {
    name: agentName,
    modelId: null,
    modelDisplayName: null,
  };
}

/**
 * 根据任务类型获取分配说明
 * 基于任务类型和 Agent 角色生成说明，不硬编码模型
 */
function getTaskTypeDescription(
  todo: ResearchTodo,
  t: (key: string, params?: Record<string, string | number>) => string
): { agentReason: string; modelReason: string } {
  // 如果后端提供了分配理由，直接使用
  if (todo.assignmentReason) {
    return {
      agentReason:
        todo.assignmentReason.agentReason ||
        t('topicResearch.assignmentReason.defaultAgent'),
      modelReason:
        todo.assignmentReason.modelReason ||
        t('topicResearch.assignmentReason.defaultModel'),
    };
  }

  // 根据任务类型生成说明
  const taskTypeReasons: Record<
    ResearchTodoType,
    { agentKey: string; modelKey: string }
  > = {
    [ResearchTodoType.LEADER_PLANNING]: {
      agentKey: 'topicResearch.assignmentReason.leaderPlanning',
      modelKey: 'topicResearch.assignmentReason.reasoningModel',
    },
    [ResearchTodoType.DIMENSION_RESEARCH]: {
      agentKey: 'topicResearch.assignmentReason.dimensionResearch',
      modelKey: 'topicResearch.assignmentReason.researchModel',
    },
    [ResearchTodoType.REPORT_WRITING]: {
      agentKey: 'topicResearch.assignmentReason.reportWriting',
      modelKey: 'topicResearch.assignmentReason.writingModel',
    },
    [ResearchTodoType.QUALITY_REVIEW]: {
      agentKey: 'topicResearch.assignmentReason.qualityReview',
      modelKey: 'topicResearch.assignmentReason.reviewModel',
    },
    [ResearchTodoType.USER_REQUEST]: {
      agentKey: 'topicResearch.assignmentReason.userRequest',
      modelKey: 'topicResearch.assignmentReason.flexibleModel',
    },
  };

  const reasons = taskTypeReasons[todo.type] || {
    agentKey: 'topicResearch.assignmentReason.defaultAgent',
    modelKey: 'topicResearch.assignmentReason.defaultModel',
  };

  // 如果有维度名称，附加到理由中
  const dimensionSuffix = todo.dimensionName
    ? t('topicResearch.assignmentReason.forDimension', {
        dimension: todo.dimensionName,
      })
    : '';

  return {
    agentReason: t(reasons.agentKey) + dimensionSuffix,
    modelReason: t(reasons.modelKey),
  };
}

/**
 * 排序优先级：进行中 > 待处理 > 已完成 > 失败
 */
function getStatusPriority(status: ResearchTodoStatus): number {
  switch (status) {
    case ResearchTodoStatus.IN_PROGRESS:
      return 0;
    case ResearchTodoStatus.QUEUED:
      return 1;
    case ResearchTodoStatus.PENDING:
      return 2;
    case ResearchTodoStatus.PAUSED:
      return 3;
    case ResearchTodoStatus.COMPLETED:
      return 4;
    case ResearchTodoStatus.FAILED:
      return 5;
    case ResearchTodoStatus.CANCELLED:
      return 6;
    default:
      return 99;
  }
}

// ==================== Components ====================

/**
 * 状态徽章
 */
function StatusBadge({
  status,
  progress,
}: {
  status: ResearchTodoStatus;
  progress?: number;
}) {
  const { t } = useTranslation();
  const STATUS_CONFIG = useMemo(() => getStatusConfig(t), [t]);
  const config = STATUS_CONFIG[status];
  const isRunning = status === ResearchTodoStatus.IN_PROGRESS;
  // ★ 修改：研究中状态始终显示进度百分比（即使是 0%）
  const showProgress = isRunning && typeof progress === 'number';
  const progressValue = progress ?? 0;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium shadow-sm',
        config.bgColor,
        config.color,
        isRunning && 'animate-pulse ring-2 ring-blue-300/50'
      )}
    >
      {config.icon}
      <span>{config.label}</span>
      {showProgress && (
        <span className="rounded-full bg-white/50 px-1.5 py-0.5 text-[10px] font-bold">
          {progressValue}%
        </span>
      )}
    </span>
  );
}

/**
 * 操作按钮
 */
function ActionButtons({
  todo,
  topicId,
  onUpdated,
}: {
  todo: ResearchTodo;
  topicId: string;
  onUpdated?: (todo: ResearchTodo) => void;
}) {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);

  const handleAction = async (action: string) => {
    setIsLoading(true);
    try {
      let result;
      switch (action) {
        case 'pause':
          result = await pauseTodo(topicId, todo.id);
          break;
        case 'resume':
          result = await resumeTodo(topicId, todo.id);
          break;
        case 'cancel':
          result = await cancelTodo(topicId, todo.id);
          break;
        case 'retry':
          result = await retryTodo(topicId, todo.id);
          break;
        case 'execute':
          result = await executeTodo(topicId, todo.id);
          break;
      }
      if (result?.todo && onUpdated) {
        onUpdated(result.todo);
      }
    } catch (err) {
      logger.error(`Failed to ${action} todo:`, err);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return <Loader2 className="h-4 w-4 animate-spin text-gray-400" />;
  }

  return (
    <div className="flex items-center gap-1">
      {todo.userCanPause && todo.status === ResearchTodoStatus.IN_PROGRESS && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleAction('pause');
          }}
          className="rounded p-1 text-orange-500 hover:bg-orange-50"
          title={t('common.pause')}
        >
          <Pause className="h-3.5 w-3.5" />
        </button>
      )}
      {todo.status === ResearchTodoStatus.PAUSED && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleAction('resume');
          }}
          className="rounded p-1 text-green-500 hover:bg-green-50"
          title={t('common.resume')}
        >
          <Play className="h-3.5 w-3.5" />
        </button>
      )}
      {todo.status === ResearchTodoStatus.FAILED && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleAction('retry');
          }}
          className="rounded p-1 text-blue-500 hover:bg-blue-50"
          title={t('topicResearch.researchControl.todoList.retry')}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
      {todo.type === ResearchTodoType.USER_REQUEST &&
        todo.status === ResearchTodoStatus.PENDING && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleAction('execute');
            }}
            className="flex items-center gap-1 rounded bg-green-500 px-2 py-0.5 text-xs text-white hover:bg-green-600"
            title={t('common.execute')}
          >
            <Play className="h-3 w-3" />
            {t('common.execute')}
          </button>
        )}
      {/* 取消按钮：对于未完成的 USER_REQUEST 任务显示 */}
      {todo.userCanCancel &&
        todo.status !== ResearchTodoStatus.COMPLETED &&
        todo.status !== ResearchTodoStatus.FAILED &&
        todo.status !== ResearchTodoStatus.CANCELLED && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              void (async () => {
                if (
                  await confirm({
                    title: t('topicResearch.errors.confirmCancelTask'),
                    type: 'warning',
                  })
                ) {
                  handleAction('cancel');
                }
              })();
            }}
            className="rounded p-1 text-red-500 hover:bg-red-50"
            title={t('common.cancel')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
    </div>
  );
}

// ==================== Main Component ====================

export function ResearchTodoList({
  todos,
  summary,
  topicId,
  isLoading,
  onTodoUpdated,
  onTodoSelect,
  selectedTodoId,
}: ResearchTodoListProps) {
  const { t } = useTranslation();
  const STATUS_CONFIG = useMemo(() => getStatusConfig(t), [t]);
  const [expandedTodoId, setExpandedTodoId] = useState<string | null>(null);

  // 按状态优先级排序
  const sortedTodos = useMemo(() => {
    return [...todos].sort((a, b) => {
      const priorityDiff =
        getStatusPriority(a.status) - getStatusPriority(b.status);
      if (priorityDiff !== 0) return priorityDiff;
      // 同状态按创建时间排序
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }, [todos]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">
          {t('topicResearch.researchControl.todoList.loading')}
        </span>
      </div>
    );
  }

  if (todos.length === 0) {
    return (
      <div className="py-8 text-center text-gray-500">
        <Circle className="mx-auto mb-2 h-8 w-8 text-gray-300" />
        <p>{t('topicResearch.researchControl.todoList.noTasks')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* 表头：任务列表 + 统计 */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-sm font-semibold text-gray-800">
            <ClipboardList className="h-4 w-4" />
            {t('topicResearch.researchControl.todoList.taskList')}
          </span>
          <span className="rounded-full bg-blue-500 px-2.5 py-0.5 text-xs font-medium text-white shadow-sm">
            {summary?.completed || 0}/{summary?.total || todos.length}
          </span>
        </div>
        {summary && (
          <div className="flex items-center gap-4 text-xs">
            {summary.inProgress > 0 && (
              <span className="flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-blue-600">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t('topicResearch.researchControl.todoList.inProgress')}{' '}
                {summary.inProgress}
              </span>
            )}
            {summary.failed > 0 && (
              <span className="rounded-full bg-red-50 px-2.5 py-1 text-red-600">
                {t('topicResearch.researchControl.todoList.failed')}{' '}
                {summary.failed}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 单一扁平表格 - 自适应宽度 */}
      <div className="overflow-hidden">
        <Table className="w-full table-fixed">
          <THead className="border-b border-gray-200 bg-gray-50/80">
            <Tr>
              <Th className="w-8 whitespace-nowrap px-2 py-2.5 text-center text-xs font-semibold text-gray-600">
                {t('topicResearch.researchControl.todoList.columnNumber')}
              </Th>
              <Th className="w-[32%] whitespace-nowrap px-3 py-2.5 text-center text-xs font-semibold text-gray-600">
                {t('topicResearch.researchControl.todoList.columnTask')}
              </Th>
              <Th className="w-[22%] whitespace-nowrap px-2 py-2.5 text-center text-xs font-semibold text-gray-600">
                {t('topicResearch.researchControl.todoList.columnAssignee')}
              </Th>
              <Th className="w-[18%] whitespace-nowrap px-2 py-2.5 text-center text-xs font-semibold text-gray-600">
                {t('topicResearch.researchControl.todoList.columnModel')}
              </Th>
              <Th className="w-[15%] whitespace-nowrap px-2 py-2.5 text-center text-xs font-semibold text-gray-600">
                {t('topicResearch.researchControl.todoList.columnStatus')}
              </Th>
              <Th className="w-12 whitespace-nowrap px-2 py-2.5 text-center text-xs font-semibold text-gray-600">
                {t('topicResearch.researchControl.todoList.columnActions')}
              </Th>
            </Tr>
          </THead>
          <TBody className="divide-y divide-gray-100 bg-white">
            {sortedTodos.map((todo, index) => {
              const {
                name: agentName,
                modelId,
                modelDisplayName,
              } = parseAgentInfo(todo);
              const isSelected = selectedTodoId === todo.id;

              // 依赖关系：此任务依赖于哪些任务（已完成的任务不再显示依赖提示）
              const hasDependencies =
                todo.dependsOn &&
                todo.dependsOn.length > 0 &&
                todo.status !== ResearchTodoStatus.COMPLETED &&
                todo.status !== ResearchTodoStatus.FAILED;
              // 计算哪些任务依赖于此任务（被阻塞）
              const blockingCount = sortedTodos.filter((t) =>
                t.dependsOn?.includes(todo.id)
              ).length;

              // 根据状态设置行样式（背景色 + 左边框）
              const rowStyles = (() => {
                if (isSelected) {
                  return 'bg-blue-50 border-l-4 border-l-blue-500 hover:bg-blue-100';
                }
                switch (todo.status) {
                  case ResearchTodoStatus.IN_PROGRESS:
                    return 'bg-blue-50/60 border-l-4 border-l-blue-400 hover:bg-blue-100/60';
                  case ResearchTodoStatus.COMPLETED:
                    return 'bg-green-50/40 border-l-4 border-l-green-400 hover:bg-green-100/40';
                  case ResearchTodoStatus.FAILED:
                    return 'bg-red-50/40 border-l-4 border-l-red-400 hover:bg-red-100/40';
                  case ResearchTodoStatus.PAUSED:
                    return 'bg-orange-50/40 border-l-4 border-l-orange-400 hover:bg-orange-100/40';
                  case ResearchTodoStatus.QUEUED:
                    return 'bg-yellow-50/40 border-l-4 border-l-yellow-400 hover:bg-yellow-100/40';
                  default:
                    return 'bg-white border-l-4 border-l-transparent hover:bg-gray-50 hover:border-l-gray-300';
                }
              })();

              const isExpanded = expandedTodoId === todo.id;
              const { agentReason, modelReason } = getTaskTypeDescription(
                todo,
                t
              );

              return (
                <React.Fragment key={todo.id}>
                  <Tr
                    onClick={() => onTodoSelect?.(todo.id)}
                    className={cn(
                      'cursor-pointer transition-all duration-150',
                      rowStyles
                    )}
                  >
                    {/* 序号 + 展开按钮 */}
                    <Td className="px-2 py-2 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedTodoId(isExpanded ? null : todo.id);
                        }}
                        className="flex items-center justify-center gap-0.5 text-xs text-gray-400 hover:text-gray-600"
                        title={t(
                          'topicResearch.researchControl.todoList.viewAssignmentReason'
                        )}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                        <span>{index + 1}</span>
                      </button>
                    </Td>

                    {/* 任务名称 */}
                    <Td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="flex-shrink-0 text-sm">
                          {TYPE_ICONS[todo.type]}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div
                            className="truncate text-sm font-medium text-gray-900"
                            title={todo.title}
                          >
                            {todo.title}
                          </div>
                          {todo.dimensionName &&
                            todo.dimensionName !== todo.title && (
                              <div
                                className="truncate text-xs text-gray-400"
                                title={todo.dimensionName}
                              >
                                {todo.dimensionName}
                              </div>
                            )}
                          {/* ★ 依赖关系提示 - 超过 2 个时只显示数量，悬停显示详情 */}
                          {hasDependencies && (
                            <div
                              className="mt-0.5 flex items-center gap-1 text-[10px] text-amber-600"
                              title={
                                todo.dependsOn.length > 2
                                  ? `${t('topicResearch.researchControl.todoList.waiting')}: ${todo.dependsOn
                                      .map((depId) => {
                                        const depTodo = sortedTodos.find(
                                          (t) => t.id === depId
                                        );
                                        return (
                                          depTodo?.title || depId.slice(0, 6)
                                        );
                                      })
                                      .join('\n')}`
                                  : undefined
                              }
                            >
                              <Clock className="h-2.5 w-2.5" />
                              <span>
                                {todo.dependsOn.length > 2 ? (
                                  <>
                                    {t(
                                      'topicResearch.researchControl.todoList.waitingTasks',
                                      { count: todo.dependsOn.length }
                                    )}
                                  </>
                                ) : (
                                  <>
                                    {t(
                                      'topicResearch.researchControl.todoList.waiting'
                                    )}{' '}
                                    {todo.dependsOn
                                      .map((depId) => {
                                        const depTodo = sortedTodos.find(
                                          (t) => t.id === depId
                                        );
                                        return (
                                          depTodo?.title || depId.slice(0, 6)
                                        );
                                      })
                                      .join('、')}
                                  </>
                                )}
                              </span>
                            </div>
                          )}
                        </div>
                        {/* ★ 被依赖指示器（此任务阻塞其他任务） */}
                        {blockingCount > 0 && (
                          <span
                            className="flex-shrink-0 text-orange-500"
                            title={t(
                              'topicResearch.researchControl.todoList.blockingTasks',
                              { count: blockingCount }
                            )}
                          >
                            <Link2 className="h-3 w-3" />
                          </span>
                        )}
                      </div>
                    </Td>

                    {/* 负责人 */}
                    <Td
                      className="truncate px-2 py-2 text-xs text-gray-600"
                      title={agentName}
                    >
                      {agentName}
                    </Td>

                    {/* 模型 */}
                    <Td className="px-2 py-2">
                      {modelId ? (
                        <ModelBadge
                          modelId={modelId}
                          displayName={modelDisplayName || undefined}
                          className="max-w-full"
                        />
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </Td>

                    {/* 状态 */}
                    <Td className="px-2 py-2">
                      <StatusBadge
                        status={todo.status}
                        progress={todo.progress}
                      />
                    </Td>

                    {/* 操作 */}
                    <Td className="px-2 py-2 text-center">
                      <ActionButtons
                        todo={todo}
                        topicId={topicId}
                        onUpdated={onTodoUpdated}
                      />
                    </Td>
                  </Tr>
                  {/* 展开的分配理由行 */}
                  {isExpanded && (
                    <Tr className="bg-amber-50/50">
                      <Td colSpan={6} className="px-4 py-3">
                        <div className="flex items-start gap-3 text-sm">
                          <Lightbulb className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                          <div className="flex-1 space-y-2">
                            <div className="font-medium text-gray-700">
                              {t(
                                'topicResearch.researchControl.todoList.assignmentReasonTitle'
                              )}
                            </div>
                            <div className="grid gap-2 text-xs text-gray-600 sm:grid-cols-2">
                              <div className="rounded-lg bg-white/60 p-2">
                                <div className="mb-1 font-medium text-gray-500">
                                  {t(
                                    'topicResearch.researchControl.todoList.whyThisAgent'
                                  )}
                                </div>
                                <div>{agentReason}</div>
                              </div>
                              <div className="rounded-lg bg-white/60 p-2">
                                <div className="mb-1 font-medium text-gray-500">
                                  {t(
                                    'topicResearch.researchControl.todoList.whyThisModel'
                                  )}
                                </div>
                                <div>{modelReason}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </Td>
                    </Tr>
                  )}
                </React.Fragment>
              );
            })}
          </TBody>
        </Table>
      </div>
    </div>
  );
}

export default ResearchTodoList;
