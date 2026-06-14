/**
 * ResearchCollaborationPanel - 研究协作面板
 *
 * TODO 列表 + 进度统计。
 *
 * 历史：原本同时承载「与 Leader 对话」（QuickCommandBar + 对话消息区）。
 * 2026-04-25 起 Leader 对话改由「点击拓扑图 Leader 节点 → AgentInspector
 * → LeaderChatDock 浮窗」承载，本面板仅保留 TODO List。
 */

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ListTodo, ChevronUp, ChevronDown, Loader2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { cn } from '@/lib/utils/common';
import { ResearchTodoList } from '../research-control/ResearchTodoList';
import { TodoDetailPanel } from '../panels/TodoDetailPanel';
import { useTopicInsightsStore } from '@/stores/topicInsightsStore';
import { useI18n } from '@/lib/i18n';
import type { MissionStatus, TaskStatus } from '@/services/topic-insights/api';
import type {
  ResearchTodo,
  ResearchTodoStatus,
  ResearchTodoType,
  TodoSummary,
} from '@/lib/types/topic-insights';

// WebSocket 事件类型
interface WsEvent {
  type: string;
  data: unknown;
  timestamp: string;
}

interface ResearchCollaborationPanelProps {
  topicId: string;
  missionId?: string;
  missionStatus?: MissionStatus | null;
  wsEvents?: WsEvent[];
  className?: string;
}

/**
 * 将 TaskStatus 转换为 ResearchTodo 格式
 */
function convertTaskToTodo(task: TaskStatus): ResearchTodo {
  // 状态映射
  const statusMap: Record<string, ResearchTodoStatus> = {
    PENDING: 'PENDING' as ResearchTodoStatus,
    ASSIGNED: 'QUEUED' as ResearchTodoStatus,
    EXECUTING: 'IN_PROGRESS' as ResearchTodoStatus,
    REVIEWING: 'REVIEWING' as ResearchTodoStatus, // ★ v7.2: Leader 审核中
    COMPLETED: 'COMPLETED' as ResearchTodoStatus,
    NEEDS_REVISION: 'PAUSED' as ResearchTodoStatus,
    FAILED: 'FAILED' as ResearchTodoStatus,
  };

  // 类型映射
  const typeMap: Record<string, ResearchTodoType> = {
    dimension_research: 'DIMENSION_RESEARCH' as ResearchTodoType,
    quality_review: 'QUALITY_REVIEW' as ResearchTodoType,
    report_synthesis: 'REPORT_WRITING' as ResearchTodoType,
    leader_planning: 'LEADER_PLANNING' as ResearchTodoType,
  };

  // ★ 修复：进度数据优先从 WebSocket 实时事件获取
  // 这里只设置基础值，实际进度会在 useMemo 中通过 WebSocket 事件覆盖
  let progress = task.progress || 0;
  if (!task.progress) {
    if (task.status === 'COMPLETED' || task.status === 'FAILED') {
      progress = 100;
    }
    // EXECUTING 状态的进度由 WebSocket 实时事件提供，不设置硬编码默认值
  }

  // ★ 修复：构建状态消息，确保失败原因清晰显示
  let statusMessage: string | undefined;
  if (task.status === 'FAILED') {
    // 失败时优先显示错误信息
    statusMessage =
      task.result?.error || task.resultSummary || 'Task execution failed';
  } else if (task.resultSummary) {
    statusMessage = task.resultSummary;
  }

  return {
    id: task.id,
    topicId: '', // ★ 空字符串表示这是从 ResearchTask 转换的，不是真正的 ResearchTodo
    missionId: '',
    type: typeMap[task.taskType] || ('DIMENSION_RESEARCH' as ResearchTodoType),
    title: task.title,
    description: task.description || task.dimensionName,
    dimensionName: task.dimensionName,
    agentName: task.assignedAgent,
    modelId: task.modelId, // ★ 传递 Agent 使用的模型 ID
    status: statusMap[task.status] || ('PENDING' as ResearchTodoStatus),
    progress,
    priority: 0,
    dependsOn: task.dependencies || [], // ★ 传递任务依赖关系
    // ★ ResearchTask 不支持暂停/取消/优先级调整操作
    // 这些功能只对真正的 ResearchTodo（用户创建的任务）有效
    userCanPause: false,
    userCanCancel: false,
    userCanPrioritize: false,
    createdAt: task.startedAt || new Date().toISOString(),
    updatedAt: task.completedAt || new Date().toISOString(),
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    // ★ 新增：传递任务结果（包含成功数据或错误信息）
    result: task.result,
    // ★ 新增：状态消息，用于显示失败原因
    statusMessage,
  };
}

/**
 * 计算 TODO 统计摘要
 */
function calculateSummary(todos: ResearchTodo[]): TodoSummary {
  const total = todos.length;
  let completed = 0,
    inProgress = 0,
    pending = 0,
    queued = 0,
    paused = 0,
    failed = 0,
    cancelled = 0;

  for (const todo of todos) {
    switch (todo.status) {
      case 'COMPLETED':
        completed++;
        break;
      case 'IN_PROGRESS':
      case 'REVIEWING': // ★ v7.2: 审核中也算进行中
        inProgress++;
        break;
      case 'PENDING':
        pending++;
        break;
      case 'QUEUED':
        queued++;
        break;
      case 'PAUSED':
        paused++;
        break;
      case 'FAILED':
        failed++;
        break;
      case 'CANCELLED':
        cancelled++;
        break;
    }
  }

  return {
    total,
    completed,
    inProgress,
    pending,
    queued,
    paused,
    failed,
    cancelled,
    overallProgress: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}

export function ResearchCollaborationPanel({
  topicId,
  missionId,
  missionStatus,
  wsEvents = [],
  className,
}: ResearchCollaborationPanelProps) {
  const { t } = useI18n();
  const [isTasksCollapsed, setIsTasksCollapsed] = useState(false);

  const {
    todos: apiTodos,
    isLoadingTodos,
    fetchTodos,
    selectedTodoId,
    selectTodo: setSelectedTodoId,
  } = useTopicInsightsStore();

  // ★ 从 WebSocket 事件中提取实时进度
  // 同时支持 taskId 和 dimensionName 两种匹配方式
  const { taskProgressMap, dimensionProgressMap } = useMemo(() => {
    const taskMap = new Map<string, number>();
    const dimensionMap = new Map<string, number>();
    if (!wsEvents || wsEvents.length === 0)
      return { taskProgressMap: taskMap, dimensionProgressMap: dimensionMap };

    // 遍历所有事件，收集最新的进度（后面的事件会覆盖前面的）
    for (const event of wsEvents) {
      if (
        event.type === 'task:progress' ||
        event.type === 'task:started' ||
        event.type === 'task:completed' ||
        event.type === 'dimension:research_progress'
      ) {
        const data = event.data as {
          taskId?: string;
          progress?: number;
          dimensionName?: string;
        };
        // 按 taskId 存储（取最大值，进度只增不减）
        if (data.taskId && typeof data.progress === 'number') {
          const existing = taskMap.get(data.taskId) ?? 0;
          taskMap.set(data.taskId, Math.max(existing, data.progress));
        }
        // ★ 同时按 dimensionName 存储（取最大值，进度只增不减）
        if (data.dimensionName && typeof data.progress === 'number') {
          const key = data.dimensionName.toLowerCase().trim();
          const existing = dimensionMap.get(key) ?? 0;
          dimensionMap.set(key, Math.max(existing, data.progress));
        }
      }
    }
    return { taskProgressMap: taskMap, dimensionProgressMap: dimensionMap };
  }, [wsEvents]);

  // 合并 missionStatus.tasks 和 apiTodos（用户请求的TODO可能不在tasks中）
  const { todos, todosSummary } = useMemo(() => {
    const tasks = missionStatus?.tasks || [];
    // ★ 转换任务时应用实时进度
    const convertedTodos = tasks.map((task) => {
      const todo = convertTaskToTodo(task);
      // 如果有实时进度数据，使用实时进度
      // 1. 首先尝试按 taskId 匹配
      let realtimeProgress = taskProgressMap.get(task.id);
      // 2. 如果没有匹配到，尝试按 dimensionName 匹配（关键修复）
      if (realtimeProgress === undefined && task.dimensionName) {
        realtimeProgress = dimensionProgressMap.get(
          task.dimensionName.toLowerCase().trim()
        );
      }
      // 3. 应用实时进度（取 WebSocket 和 API 的较大值，进度只增不减）
      // ★ 修复进度回退 bug：两个进度通道（emitAgentWorking→DB / emitProgress→WS）
      //   可能因事件到达顺序不同导致 WS 低值覆盖 DB 高值
      if (realtimeProgress !== undefined) {
        todo.progress = Math.max(todo.progress, realtimeProgress);
      }
      return todo;
    });
    const taskIds = new Set(convertedTodos.map((t) => t.id));

    // ★ 收集已有任务的维度名称和标题，用于去重 USER_REQUEST
    // 当用户请求新增维度时，会创建 USER_REQUEST todo，然后 executeAddDimension 又创建 ResearchTask
    // 两者描述同一个维度但 ID 不同，需要基于 dimensionName 或 title 去重
    const taskDimensionNames = new Set<string>();
    const taskTitlePrefixes = new Set<string>();

    for (const todo of convertedTodos) {
      if (todo.dimensionName) {
        taskDimensionNames.add(todo.dimensionName.toLowerCase().trim());
      }
      // 也收集 "研究: XXX" 格式的标题（去掉前缀后的部分）
      const titleMatch = todo.title.match(/^研究[：:]\s*(.+)$/);
      if (titleMatch) {
        taskTitlePrefixes.add(titleMatch[1].toLowerCase().trim());
      }
    }

    // 合并 API 返回的 TODO（去重，补充用户请求等类型）
    const mergedTodos = [...convertedTodos];
    for (const apiTodo of apiTodos) {
      // 基本 ID 去重
      if (taskIds.has(apiTodo.id)) {
        continue;
      }

      // ★ USER_REQUEST 类型的 TODO：如果已存在同名的 DIMENSION_RESEARCH 任务，则跳过
      // 这避免了"研究：XX维度"同时显示 USER_REQUEST 和 DIMENSION_RESEARCH 两条记录
      if (apiTodo.type === 'USER_REQUEST') {
        let shouldSkip = false;

        // 方法1: 基于 dimensionName 匹配
        if (apiTodo.dimensionName) {
          const normalizedName = apiTodo.dimensionName.toLowerCase().trim();
          if (taskDimensionNames.has(normalizedName)) {
            shouldSkip = true;
          }
        }

        // 方法2: 基于标题匹配（如 "研究：XX" 与 "研究: XX"）
        if (!shouldSkip) {
          const todoTitleMatch = apiTodo.title.match(/^研究[：:]\s*(.+)$/);
          if (todoTitleMatch) {
            const normalizedTitle = todoTitleMatch[1].toLowerCase().trim();
            if (
              taskTitlePrefixes.has(normalizedTitle) ||
              taskDimensionNames.has(normalizedTitle)
            ) {
              shouldSkip = true;
            }
          }
        }

        // 方法3: 基于"新增章节/维度"标题匹配
        // 当用户请求 "新增章节：XX" 时，executeAddDimension 会创建 "研究: XX" 任务
        // 两者需要去重，只显示 ResearchTask
        if (!shouldSkip) {
          const addDimensionMatch = apiTodo.title.match(
            /^(?:新增|添加)(?:章节|维度)[：:]\s*(.+)$/
          );
          if (addDimensionMatch) {
            const normalizedTitle = addDimensionMatch[1].toLowerCase().trim();
            if (
              taskTitlePrefixes.has(normalizedTitle) ||
              taskDimensionNames.has(normalizedTitle)
            ) {
              shouldSkip = true;
            }
          }
        }

        if (shouldSkip) {
          continue;
        }
      }

      mergedTodos.push(apiTodo);
    }

    // 按状态和优先级排序
    mergedTodos.sort((a, b) => {
      // 状态优先级：进行中 > 待处理 > 已完成
      const statusOrder: Record<string, number> = {
        IN_PROGRESS: 0,
        QUEUED: 1,
        PENDING: 2,
        PAUSED: 3,
        COMPLETED: 4,
        FAILED: 5,
        CANCELLED: 6,
      };
      const statusDiff =
        (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
      if (statusDiff !== 0) return statusDiff;
      // 同状态按优先级排序
      return (b.priority ?? 0) - (a.priority ?? 0);
    });

    return {
      todos: mergedTodos,
      todosSummary: calculateSummary(mergedTodos),
    };
  }, [missionStatus?.tasks, apiTodos, taskProgressMap, dimensionProgressMap]);

  // Load TODOs from API (包括用户请求创建的 TODO)
  useEffect(() => {
    if (topicId) {
      void fetchTodos(topicId, missionId);
    }
  }, [topicId, missionId, fetchTodos]);

  // Handle TODO selection
  const handleSelectTodo = useCallback(
    (todoId: string) => {
      setSelectedTodoId(todoId);
    },
    [setSelectedTodoId]
  );

  const handleCloseDetail = useCallback(() => {
    setSelectedTodoId(null);
  }, [setSelectedTodoId]);

  // 获取当前选中的 TODO 对象（用于传递给 TodoDetailPanel，避免 API 调用）
  const selectedTodo = useMemo(() => {
    if (!selectedTodoId) return undefined;
    return todos.find((t) => t.id === selectedTodoId);
  }, [selectedTodoId, todos]);

  // ★ 任务区 flex 样式
  const getTasksFlexStyle = () => {
    if (isTasksCollapsed) {
      // 折叠：固定高度 88px (标题栏 48px + 进度条 40px)
      return 'flex-none h-[88px]';
    }
    // 展开：填满整个容器（对话区已迁移到弹窗）
    return 'flex-1 min-h-[200px]';
  };

  return (
    <div className={cn('flex h-full', className)}>
      {/* Main Content Area - 双区域布局 */}
      <div
        className={cn(
          'flex flex-col gap-3 p-3 transition-all duration-300',
          selectedTodoId ? 'w-1/2' : 'w-full'
        )}
      >
        {/* ★ 任务区 - 上半部分（可折叠） */}
        <div
          className={cn(
            'flex flex-col overflow-hidden rounded-lg border bg-white transition-all duration-300',
            getTasksFlexStyle()
          )}
        >
          {/* 标题栏 - 固定高度 48px */}
          <div
            className="flex h-12 shrink-0 cursor-pointer items-center gap-2 border-b px-4 hover:bg-gray-50"
            onClick={() => setIsTasksCollapsed(!isTasksCollapsed)}
          >
            <ListTodo className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-medium">
              {t('topicResearch.collaboration.panel.taskList')}
            </span>
            {todos.length > 0 && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                {todosSummary.completed}/{todos.length}
              </span>
            )}
            <div className="ml-auto">
              {isTasksCollapsed ? (
                <ChevronDown className="h-4 w-4 text-gray-400" />
              ) : (
                <ChevronUp className="h-4 w-4 text-gray-400" />
              )}
            </div>
          </div>
          {/* 折叠时：紧凑进度条 - 固定高度 40px */}
          {isTasksCollapsed ? (
            <div className="flex h-10 shrink-0 items-center gap-3 px-4">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full bg-blue-500 transition-all duration-500"
                  style={{ width: `${todosSummary.overallProgress}%` }}
                />
              </div>
              <span className="shrink-0 text-xs text-gray-500">
                {t('topicResearch.collaboration.panel.progressBar.percent', {
                  percent: todosSummary.overallProgress,
                })}
              </span>
              {todosSummary.inProgress > 0 && (
                <span className="flex shrink-0 items-center gap-1 text-xs text-blue-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t(
                    'topicResearch.collaboration.panel.progressBar.inProgress',
                    {
                      count: todosSummary.inProgress,
                    }
                  )}
                </span>
              )}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4">
              {isLoadingTodos && !todos.length ? (
                <div className="flex h-32 items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : todos.length === 0 ? (
                <EmptyState
                  size="sm"
                  title={t('topicResearch.collaboration.panel.noTasks')}
                />
              ) : (
                <ResearchTodoList
                  topicId={topicId}
                  todos={todos}
                  summary={todosSummary}
                  selectedTodoId={selectedTodoId}
                  onTodoSelect={handleSelectTodo}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* TODO Detail Panel - Shows when a TODO is selected */}
      {selectedTodoId && (
        <TodoDetailPanel
          topicId={topicId}
          todoId={selectedTodoId}
          initialTodo={selectedTodo}
          onClose={handleCloseDetail}
          wsEvents={wsEvents}
          className="w-1/2"
        />
      )}
    </div>
  );
}

export default ResearchCollaborationPanel;
