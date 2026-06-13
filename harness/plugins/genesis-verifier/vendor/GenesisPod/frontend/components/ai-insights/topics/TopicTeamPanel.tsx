'use client';

/**
 * Topic Team Panel - Leader-driven Research Panel
 *
 * v8.0: 参照 AI Writing 设计精髓
 * - SVG 协作视图：节点连线、状态动效、悬停提示
 * - 任务按状态分组：执行中优先
 * - 简洁进度统计 + 底部状态栏
 */

import { useMemo, useState, useEffect } from 'react';
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { ModelBadge } from '@/components/common/badges/ModelBadge';
import {
  TeamTopologyCanvas,
  AVATAR_ROW_Y,
  type TeamTopologyNode,
  type TeamTopologyConnection,
  type TeamTopologyLegendItem,
} from '@/components/common/team-topology';
import {
  AgentInspector,
  type AgentInspectorAgent,
  type AgentConfigEntry,
} from '@/components/common/agent-inspector';
import {
  LeaderChatDock,
  type LeaderChatMessage as LeaderChatMessageData,
} from '@/components/common/leader-chat';
import type {
  MissionStatus,
  TaskStatus,
  TeamInfo,
  LeaderDecisionType,
} from '@/services/topic-insights/api';
import { leaderChat, getTeamMessages } from '@/services/topic-insights/api';
import { useTopicInsightsStore } from '@/stores/topicInsightsStore';
// TaskStatus is used in type annotations below

/**
 * Leader 决策类型 → chip 配色 + 国际化标签。
 * 走 i18n 工厂模式（与原 ResearchCollaborationPanel.getDecisionTypeConfig 一致）。
 */
function getTiDecisionTypeConfig(
  t: (key: string) => string
): Record<LeaderDecisionType, { label: string; colorClass: string }> {
  return {
    DIRECT_ANSWER: {
      label: t('topicResearch.collaboration.panel.decisionTypes.directAnswer'),
      colorClass: 'border-blue-200 bg-blue-50 text-blue-700',
    },
    CREATE_TODO: {
      label: t('topicResearch.collaboration.panel.decisionTypes.createTodo'),
      colorClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    },
    CLARIFY: {
      label: t('topicResearch.collaboration.panel.decisionTypes.clarify'),
      colorClass: 'border-amber-200 bg-amber-50 text-amber-700',
    },
    ACKNOWLEDGE: {
      label: t('topicResearch.collaboration.panel.decisionTypes.acknowledge'),
      colorClass: 'border-gray-200 bg-gray-50 text-gray-700',
    },
  };
}

/**
 * ★ 类型守卫：验证是否为非空字符串数组
 * 防止后端返回无效数据导致渲染错误
 */
function isValidStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(
    (item) => typeof item === 'string' && item.trim().length > 0
  );
}

interface SimpleRefreshProgress {
  phase: string;
  progress: number;
  message: string;
  currentDimension?: string;
  completedDimensions: number;
  totalDimensions: number;
}

interface TopicTeamPanelProps {
  topicId: string;
  topicName: string;
  missionStatus?: MissionStatus | null;
  isRefreshing: boolean;
  refreshProgress: SimpleRefreshProgress | null;
  onStartRefresh?: () => void;
  onContinueRefresh?: () => void;
  onCancelRefresh?: () => void;
  /** 错误信息 */
  error?: string | null;
  /** ★ 是否有编辑权限（只有创建者/管理员才能运行任务） */
  canEdit?: boolean;
  /** ★ 团队信息（包含 Agent 使用的 AI 模型） */
  teamInfo?: TeamInfo | null;
  /** V5: 研究深度 */
  researchDepth?: 'quick' | 'standard' | 'thorough';
  onResearchDepthChange?: (depth: 'quick' | 'standard' | 'thorough') => void;
  /** AI Quality Review toggle */
  enableAiQualityReview?: boolean;
  onEnableAiQualityReviewChange?: (enabled: boolean) => void;
}

// Agent 角色定义
type ResearchAgentRole = 'leader' | 'researcher' | 'reviewer' | 'synthesizer';

interface ResearchAgent {
  id: string;
  role: ResearchAgentRole;
  name: string;
  status: 'idle' | 'working' | 'completed' | 'error';
  /** ★ 具体工作状态：研究中、审核中、修订中、整合中 */
  workingStatus?: string;
  taskCount: number;
  completedCount: number;
}

// Agent icon and color mapping (name will be translated)
const AGENT_ICON_MAP: Record<
  ResearchAgentRole,
  { icon: string; color: string }
> = {
  leader: { icon: '👑', color: 'purple' },
  researcher: { icon: '🔍', color: 'blue' },
  reviewer: { icon: '✅', color: 'green' },
  synthesizer: { icon: '📝', color: 'orange' },
};

// ★ 默认显示信息，用于未知角色
const DEFAULT_AGENT_ICON = { icon: '🤖', color: 'gray' };

// Agent 显示信息工厂函数
const getAgentDisplayFactory = (t: (key: string) => string) => {
  return (role: string): { name: string; icon: string; color: string } => {
    const roleKey = role.toLowerCase() as ResearchAgentRole;
    const iconInfo = AGENT_ICON_MAP[roleKey] || DEFAULT_AGENT_ICON;
    const nameKey = `topicResearch.agentNames.${roleKey}`;
    return {
      name: t(nameKey) || role,
      ...iconInfo,
    };
  };
};

// Agent 角色详细信息工厂函数
// ★ v8.0: 技能和工具由 Leader 根据任务动态分配，这里显示的是角色的能力范围
const getAgentRoleInfoFactory = (t: (key: string) => string) => {
  return (
    role: string
  ): { description: string; capabilities: string[]; note: string } => {
    const roleKey = role.toLowerCase() as ResearchAgentRole;
    const validRoles: ResearchAgentRole[] = [
      'leader',
      'researcher',
      'reviewer',
      'synthesizer',
    ];

    // Helper to parse comma-separated capabilities string into array
    const parseCapabilities = (capStr: string): string[] => {
      return capStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    };

    if (validRoles.includes(roleKey)) {
      return {
        description: t(`topicResearch.agentDescriptions.${roleKey}`),
        capabilities: parseCapabilities(
          t(`topicResearch.agentCapabilities.${roleKey}`)
        ),
        note:
          roleKey === 'leader'
            ? t('topicResearch.agentNotes.leader')
            : t('topicResearch.agentNotes.worker'),
      };
    }

    return {
      description: t('topicResearch.agentDescriptions.default'),
      capabilities: parseCapabilities(
        t('topicResearch.agentCapabilities.default')
      ),
      note: t('topicResearch.agentNotes.worker'),
    };
  };
};

// Phase display mapping factory
const getPhaseDisplay = (
  t: (key: string) => string
): Record<string, string> => ({
  idle: t('topicResearch.status.idle'),
  unknown: t('topicResearch.status.idle'),
  planning: t('topicResearch.status.planning'),
  PLANNING: t('topicResearch.status.planning'),
  researching: t('topicResearch.status.researching'),
  RESEARCHING: t('topicResearch.status.researching'),
  EXECUTING: t('topicResearch.status.executing'),
  reviewing: t('topicResearch.status.reviewing'),
  REVIEWING: t('topicResearch.status.reviewing'),
  synthesizing: t('topicResearch.status.synthesizing'),
  SYNTHESIZING: t('topicResearch.status.synthesizing'),
  completed: t('topicResearch.status.completed'),
  COMPLETED: t('topicResearch.status.completed'),
  failed: t('topicResearch.status.failed'),
  FAILED: t('topicResearch.status.failed'),
  paused: t('topicResearch.status.paused'),
  PAUSED: t('topicResearch.status.paused'),
  cancelled: t('topicResearch.status.cancelled'),
  CANCELLED: t('topicResearch.status.cancelled'),
});

// 状态图标映射
const statusIcons: Record<string, string> = {
  PENDING: '⏳',
  EXECUTING: '🔄',
  COMPLETED: '✅',
  FAILED: '❌',
  NEEDS_REVISION: '↻',
};

// 状态颜色映射
const statusColors: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-600',
  EXECUTING: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  NEEDS_REVISION: 'bg-yellow-100 text-yellow-700',
};

export function TopicTeamPanel({
  topicId,
  topicName,
  missionStatus,
  isRefreshing,
  refreshProgress,
  onStartRefresh,
  onContinueRefresh,
  onCancelRefresh,
  error,
  canEdit = true,
  teamInfo,
  researchDepth = 'standard',
  onResearchDepthChange,
  enableAiQualityReview,
  onEnableAiQualityReviewChange,
}: TopicTeamPanelProps) {
  const { t } = useTranslation();
  const phaseDisplay = useMemo(() => getPhaseDisplay(t), [t]);
  const getAgentDisplay = useMemo(() => getAgentDisplayFactory(t), [t]);
  const getAgentRoleInfo = useMemo(() => getAgentRoleInfoFactory(t), [t]);

  // ★ 判断任务是否正在进行中 - 同时检查 isRefreshing 和 missionStatus
  // 这修复了一个 bug：当 isRefreshing 因为某种原因没有正确同步时，
  // 按钮仍然可以通过检查 missionStatus 来显示正确的状态
  const isMissionActive = useMemo(() => {
    // 如果 isRefreshing 已经是 true，直接返回
    if (isRefreshing) return true;
    // 检查 missionStatus 是否表示正在进行
    if (missionStatus) {
      // ★ 如果任务已完成/取消/错误，直接返回 false
      // 不再检查子任务状态，避免已完成的任务显示为"进行中"
      if (
        ['COMPLETED', 'CANCELLED', 'ERROR', 'FAILED'].includes(
          missionStatus.status
        )
      ) {
        return false;
      }
      // 检查 mission 状态是否是活动状态
      if (
        ['PLANNING', 'EXECUTING', 'REVIEWING'].includes(missionStatus.status)
      ) {
        return true;
      }
      // 只在非终止状态下检查子任务
      // 检查是否有正在执行的任务（不包括 PENDING/ASSIGNED，因为这些可能是未开始的任务）
      if (missionStatus.tasks?.some((t) => t.status === 'EXECUTING')) {
        return true;
      }
    }
    return false;
  }, [isRefreshing, missionStatus]);

  // 从 missionStatus 构建 agents
  const { agents, tasksByStatus, stats } = useMemo(() => {
    const tasks = missionStatus?.tasks || [];

    // 按类型分组任务
    const dimensionTasks = tasks.filter(
      (t) => t.taskType === 'dimension_research'
    );
    const reviewTasks = tasks.filter((t) => t.taskType === 'quality_review');
    const synthesisTasks = tasks.filter(
      (t) => t.taskType === 'report_synthesis'
    );

    // 构建 agents 列表
    const agentList: ResearchAgent[] = [
      {
        id: 'leader',
        role: 'leader',
        name: 'Research Leader',
        status: isRefreshing ? 'working' : 'idle',
        taskCount: tasks.length,
        completedCount: tasks.filter((t) => t.status === 'COMPLETED').length,
      },
    ];

    // 添加研究员
    // ★ v7.5: 动态收集所有参与研究的 Agent（从任务的 assignedAgent 字段）
    // 这样新创建的任务（如通过 Leader 对话添加的维度）也会显示对应的 Agent
    const uniqueAgentIds = new Set<string>();
    dimensionTasks.forEach((t) => {
      if (t.assignedAgent) {
        uniqueAgentIds.add(t.assignedAgent);
      }
    });

    // 合并 leaderPlan 中的分配信息（用于获取 Agent 名称等元信息）
    const agentAssignments = missionStatus?.leaderPlan?.agentAssignments || [];
    const researcherAssignments = agentAssignments.filter(
      (a) => a.agentType === 'dimension_researcher'
    );

    // 把 leaderPlan 中的 agentId 也加入
    researcherAssignments.forEach((a) => {
      if (a.agentId) uniqueAgentIds.add(a.agentId);
    });

    // 如果没有任何 Agent，使用默认逻辑
    if (uniqueAgentIds.size === 0 && dimensionTasks.length > 0) {
      // 兜底：按任务数量估算（最大 6 个）
      const fallbackCount = Math.max(1, Math.min(dimensionTasks.length, 6));
      for (let i = 0; i < fallbackCount; i++) {
        uniqueAgentIds.add(`researcher-${i}`);
      }
    }

    // 遍历所有唯一的 Agent
    const sortedAgentIds = Array.from(uniqueAgentIds).sort();
    sortedAgentIds.forEach((agentId, i) => {
      // 查找 leaderPlan 中的分配信息（如果有）
      const assignment = researcherAssignments.find(
        (a) => a.agentId === agentId
      );

      // 通过 assignedAgent 匹配任务
      const assignedTasks = dimensionTasks.filter(
        (t) => t.assignedAgent === agentId
      );

      const hasExecuting = assignedTasks.some((t) => t.status === 'EXECUTING');
      const hasNeedsRevision = assignedTasks.some(
        (t) => t.status === 'NEEDS_REVISION'
      );
      const allCompleted =
        assignedTasks.length > 0 &&
        assignedTasks.every((t) => t.status === 'COMPLETED');

      // ★ 确定具体工作状态
      let workingStatus: string | undefined;
      if (hasExecuting) {
        workingStatus = t('topicResearch.workingStatus.researching');
      } else if (hasNeedsRevision) {
        workingStatus = t('topicResearch.workingStatus.revising');
      }

      // ★ 从 agentId 提取更友好的名称
      // agentId 格式如: researcher_美国AI政策洞察_1737xxx 或 researcher_strategy_governance
      let displayName =
        assignment?.role ||
        t('topicResearch.agentNames.researcherIndex', { index: i + 1 });
      if (!assignment?.role && agentId.startsWith('researcher_')) {
        const parts = agentId.replace('researcher_', '').split('_');
        // 取第一个有意义的部分作为名称，移除时间戳
        const namePart = parts.find((p) => p && !/^\d{10,}$/.test(p));
        if (namePart) {
          displayName =
            namePart.length > 8 ? namePart.substring(0, 8) + '...' : namePart;
        }
      }

      agentList.push({
        id: agentId,
        role: 'researcher',
        name: displayName,
        status:
          hasExecuting || hasNeedsRevision
            ? 'working'
            : allCompleted
              ? 'completed'
              : 'idle',
        workingStatus,
        taskCount: assignedTasks.length,
        completedCount: assignedTasks.filter((t) => t.status === 'COMPLETED')
          .length,
      });
    });

    // 审核员
    if (reviewTasks.length > 0) {
      const hasExecuting = reviewTasks.some(
        (task) => task.status === 'EXECUTING'
      );
      const allCompleted = reviewTasks.every(
        (task) => task.status === 'COMPLETED'
      );
      agentList.push({
        id: 'reviewer',
        role: 'reviewer',
        name: t('topicResearch.agentNames.qualityReviewer'),
        status: hasExecuting ? 'working' : allCompleted ? 'completed' : 'idle',
        workingStatus: hasExecuting
          ? t('topicResearch.workingStatus.reviewing')
          : undefined,
        taskCount: reviewTasks.length,
        completedCount: reviewTasks.filter(
          (task) => task.status === 'COMPLETED'
        ).length,
      });
    }

    // 撰写者
    if (synthesisTasks.length > 0) {
      const hasExecuting = synthesisTasks.some(
        (task) => task.status === 'EXECUTING'
      );
      const allCompleted = synthesisTasks.every(
        (task) => task.status === 'COMPLETED'
      );
      agentList.push({
        id: 'synthesizer',
        role: 'synthesizer',
        name: t('topicResearch.agentNames.reportWriter'),
        status: hasExecuting ? 'working' : allCompleted ? 'completed' : 'idle',
        workingStatus: hasExecuting
          ? t('topicResearch.workingStatus.integrating')
          : undefined,
        taskCount: synthesisTasks.length,
        completedCount: synthesisTasks.filter(
          (task) => task.status === 'COMPLETED'
        ).length,
      });
    }

    // 按状态分组任务（用于任务列表）
    const byStatus = tasks.reduce(
      (acc, task) => {
        if (!acc[task.status]) acc[task.status] = [];
        acc[task.status].push(task);
        return acc;
      },
      {} as Record<string, TaskStatus[]>
    );

    // 统计
    const completed = missionStatus?.completedTasks || 0;
    const total = missionStatus?.totalTasks || 0;
    const progress = missionStatus?.progress || 0;
    const executing = tasks.filter((t) => t.status === 'EXECUTING').length;
    const failed = tasks.filter((t) => t.status === 'FAILED').length;

    return {
      agents: agentList,
      tasksByStatus: byStatus,
      stats: { completed, total, progress, executing, failed },
    };
  }, [missionStatus, isRefreshing]);

  // ★ 统一状态计算：综合考虑 currentPhase 和 isMissionActive，确保上下一致
  const rawPhase =
    missionStatus?.currentPhase || refreshProgress?.phase || 'idle';

  // ★ 修复状态不一致：如果有任务正在执行但 currentPhase 显示为 idle/unknown，强制显示为 researching
  const currentPhase = useMemo(() => {
    // 如果后端返回的 phase 是明确的状态，直接使用
    if (
      [
        'planning',
        'PLANNING',
        'researching',
        'RESEARCHING',
        'EXECUTING',
        'reviewing',
        'REVIEWING',
        'completed',
        'COMPLETED',
        'failed',
        'FAILED',
      ].includes(rawPhase)
    ) {
      return rawPhase;
    }
    // 如果 isMissionActive 为 true，但 phase 是 idle/unknown，强制显示为 researching
    if (isMissionActive) {
      return 'researching';
    }
    // 检查 missionStatus.status 是否为活动状态
    if (
      missionStatus?.status &&
      ['PLANNING', 'EXECUTING', 'REVIEWING'].includes(missionStatus.status)
    ) {
      return missionStatus.status.toLowerCase();
    }
    return rawPhase;
  }, [rawPhase, isMissionActive, missionStatus?.status]);

  const hasMission = !!missionStatus && (missionStatus.tasks?.length || 0) > 0;

  // ★ 用时计算：进行中时每秒更新，完成后显示实际耗时（completedAt - startedAt）
  const [elapsedDisplay, setElapsedDisplay] = useState<string>('');
  useEffect(() => {
    const startTime = missionStatus?.startedAt ?? missionStatus?.createdAt;
    if (!startTime || !hasMission) {
      setElapsedDisplay('');
      return;
    }
    const isActive = ['PLANNING', 'EXECUTING', 'REVIEWING'].includes(
      missionStatus?.status ?? ''
    );
    const format = (ms: number) => {
      const s = Math.floor(ms / 1000);
      const m = Math.floor(s / 60);
      const h = Math.floor(m / 60);
      if (h > 0) return `${h}h ${m % 60}m`;
      if (m > 0) return `${m}m ${s % 60}s`;
      return `${s}s`;
    };

    // ★ 已完成：用 completedAt - startedAt 显示实际报告耗时，不随时间增长
    if (!isActive && missionStatus?.completedAt) {
      const elapsed =
        new Date(missionStatus.completedAt).getTime() -
        new Date(startTime).getTime();
      setElapsedDisplay(format(Math.max(0, elapsed)));
      return;
    }

    const update = () => {
      const elapsed = Date.now() - new Date(startTime).getTime();
      setElapsedDisplay(format(elapsed));
    };
    update();
    if (!isActive) return;
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [
    missionStatus?.startedAt,
    missionStatus?.completedAt,
    missionStatus?.createdAt,
    missionStatus?.status,
    hasMission,
  ]);

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Header */}
      <div className="border-b border-gray-100 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="min-w-0 truncate text-sm font-semibold text-gray-800">
            {topicName}
          </h3>
          <span
            className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
              currentPhase === 'completed'
                ? 'bg-green-100 text-green-700'
                : currentPhase === 'failed'
                  ? 'bg-red-100 text-red-700'
                  : isRefreshing
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-600'
            }`}
          >
            {phaseDisplay[currentPhase] || currentPhase}
          </span>
        </div>

        {/* Progress stats */}
        {hasMission && (
          <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1 text-green-600">
              <CheckCircle2 className="h-3 w-3" /> {stats.completed}
            </span>
            {stats.executing > 0 && (
              <span className="flex items-center gap-1 text-blue-600">
                <RefreshCw className="h-3 w-3" /> {stats.executing}
              </span>
            )}
            {stats.failed > 0 && (
              <span className="flex items-center gap-1 text-red-600">
                <XCircle className="h-3 w-3" /> {stats.failed}
              </span>
            )}
            <span className="text-gray-400">
              {t('topicResearch.common.totalTasks', { count: stats.total })}
            </span>
            {elapsedDisplay && (
              <span className="ml-auto flex items-center gap-1 text-gray-400">
                <Clock className="h-3 w-3" /> {elapsedDisplay}
              </span>
            )}
          </div>
        )}

        {/* Progress bar */}
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full transition-all duration-500 ${
                currentPhase === 'failed'
                  ? 'bg-red-500'
                  : currentPhase === 'completed'
                    ? 'bg-green-500'
                    : 'bg-blue-500'
              }`}
              style={{ width: `${stats.progress}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-xs text-gray-400">
            <span>{t('topicResearch.common.overallProgress')}</span>
            <span>{Math.round(stats.progress)}%</span>
          </div>
        </div>
      </div>

      {/* SVG Team Visualization */}
      <div className="relative border-b border-gray-100">
        <TopicTeamCanvasView
          topicId={topicId}
          topicName={topicName}
          agents={agents}
          teamInfo={teamInfo}
          missionStatus={missionStatus}
          getAgentDisplay={getAgentDisplay}
          getAgentRoleInfo={getAgentRoleInfo}
        />
      </div>

      {/* Task List - 按状态排序 */}
      <div className="flex-1 overflow-y-auto">
        {!hasMission ? (
          <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
            <div className="mb-3 text-3xl">👑</div>
            <p className="text-sm font-medium text-gray-700">
              {t('topicResearch.common.waitingForLeader')}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {t('topicResearch.common.clickStartHint')}
            </p>
          </div>
        ) : (
          <div className="space-y-1 p-3">
            {/* 执行中的任务 */}
            {tasksByStatus['EXECUTING']?.map((task) => (
              <TaskItem key={task.id} task={task} />
            ))}
            {/* 待处理的任务 */}
            {tasksByStatus['PENDING']?.map((task) => (
              <TaskItem key={task.id} task={task} />
            ))}
            {/* 需要修订的任务 */}
            {tasksByStatus['NEEDS_REVISION']?.map((task) => (
              <TaskItem key={task.id} task={task} />
            ))}
            {/* 已完成的任务 */}
            {tasksByStatus['COMPLETED']?.map((task) => (
              <TaskItem key={task.id} task={task} />
            ))}
            {/* 失败的任务 */}
            {tasksByStatus['FAILED']?.map((task) => (
              <TaskItem key={task.id} task={task} />
            ))}
          </div>
        )}
      </div>

      {/* Bottom Status Bar */}
      <div className="border-t border-gray-100 px-4 py-2">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="text-gray-500">
            {t('topicResearch.common.phase')}:{' '}
            {phaseDisplay[currentPhase] || currentPhase}
          </span>
          {/* ★ 统一使用 currentPhase 显示状态，与上方保持一致 */}
          <span
            className={`rounded-full px-2 py-0.5 ${
              currentPhase === 'completed'
                ? 'bg-green-100 text-green-700'
                : currentPhase === 'failed'
                  ? 'bg-red-100 text-red-700'
                  : [
                        'planning',
                        'PLANNING',
                        'researching',
                        'RESEARCHING',
                        'EXECUTING',
                        'reviewing',
                        'REVIEWING',
                      ].includes(currentPhase)
                    ? 'bg-blue-100 text-blue-700'
                    : missionStatus &&
                        ['PAUSED', 'CANCELLED'].includes(
                          missionStatus.status || ''
                        )
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-gray-100 text-gray-600'
            }`}
          >
            {[
              'planning',
              'PLANNING',
              'researching',
              'RESEARCHING',
              'EXECUTING',
              'reviewing',
              'REVIEWING',
            ].includes(currentPhase)
              ? t('topicResearch.status.inProgress')
              : missionStatus &&
                  ['PAUSED', 'CANCELLED'].includes(missionStatus.status || '')
                ? t('topicResearch.status.paused')
                : currentPhase === 'completed'
                  ? t('topicResearch.status.completed')
                  : currentPhase === 'failed'
                    ? t('topicResearch.status.failed')
                    : t('topicResearch.status.idle')}
          </span>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <div className="mb-1 flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" />
              <span>{t('topicResearch.errors.startResearchFailed')}</span>
            </div>
            <p className="text-xs text-red-600">
              {typeof error === 'string'
                ? error
                : t('topicResearch.errors.startResearchFailed')}
            </p>
          </div>
        )}

        {/* V5: Research Depth Badge (when mission is active) */}
        {isMissionActive && researchDepth && (
          <div className="mb-2 flex items-center gap-1.5 rounded-md bg-gray-50 px-2.5 py-1.5 text-xs text-gray-600">
            <span className="font-medium text-gray-500">
              {t('topicResearch.researchDepth.label')}:
            </span>
            <span
              className={`rounded px-1.5 py-0.5 font-medium ${
                researchDepth === 'thorough'
                  ? 'bg-purple-100 text-purple-700'
                  : researchDepth === 'quick'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-blue-100 text-blue-700'
              }`}
            >
              {t(`topicResearch.researchDepth.${researchDepth}`)}
            </span>
          </div>
        )}

        {/* V5: Research Depth Selector */}
        {!isMissionActive && canEdit && onResearchDepthChange && (
          <div className="mb-2">
            <div className="mb-1 text-xs font-medium text-gray-500">
              {t('topicResearch.researchDepth.label')}
            </div>
            <div className="grid grid-cols-3 gap-1">
              {(['quick', 'standard', 'thorough'] as const).map((depth) => {
                const labels: Record<string, string> = {
                  quick: t('topicResearch.researchDepth.quick'),
                  standard: t('topicResearch.researchDepth.standard'),
                  thorough: t('topicResearch.researchDepth.thorough'),
                };
                const descriptions: Record<string, string> = {
                  quick: t('topicResearch.researchDepth.quickDesc'),
                  standard: t('topicResearch.researchDepth.standardDesc'),
                  thorough: t('topicResearch.researchDepth.thoroughDesc'),
                };
                const isSelected = researchDepth === depth;
                return (
                  <button
                    key={depth}
                    onClick={() => onResearchDepthChange(depth)}
                    className={`rounded-md px-2 py-1.5 text-xs transition-all ${
                      isSelected
                        ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300'
                        : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                    }`}
                    title={descriptions[depth]}
                  >
                    <div className="font-medium">{labels[depth]}</div>
                    <div className="mt-0.5 whitespace-nowrap text-[10px] opacity-70">
                      {descriptions[depth]}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* AI Quality Review Toggle */}
        {!isMissionActive && canEdit && onEnableAiQualityReviewChange && (
          <div className="mb-2 flex items-center justify-between rounded-md bg-gray-50 px-2.5 py-2">
            <div>
              <div className="text-xs font-medium text-gray-600">
                {t('topicResearch.qualityReview.aiReviewLabel') ||
                  'AI Quality Review'}
              </div>
              <div className="text-[10px] text-gray-400">
                {t('topicResearch.qualityReview.aiReviewDesc') ||
                  'Use AI for in-depth quality analysis (slower)'}
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                onEnableAiQualityReviewChange(!enableAiQualityReview)
              }
              className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                enableAiQualityReview ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${
                  enableAiQualityReview ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        )}

        {/* AI Quality Review active badge */}
        {isMissionActive && enableAiQualityReview && (
          <div className="mb-1 flex items-center gap-1 text-[10px] text-purple-600">
            <span>
              {t('topicResearch.qualityReview.aiReviewLabel') ||
                'AI Quality Review'}{' '}
              enabled
            </span>
          </div>
        )}

        {/* Action Buttons - 三个等宽按钮：开始/更新/取消 */}
        {/* ★ 权限提示：没有编辑权限时显示提示 */}
        {!canEdit && (
          <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <span className="font-medium">
              {t('topicResearch.common.readOnlyMode')}
            </span>{' '}
            -{t('topicResearch.sharing.readOnlyHint')}
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          {/* 开始按钮 - 从头开始新研究 */}
          <button
            onClick={onStartRefresh}
            disabled={isMissionActive || !canEdit}
            title={
              !canEdit
                ? t('topicResearch.common.needEditPermission')
                : undefined
            }
            className={`flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
              isMissionActive || !canEdit
                ? 'cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400'
                : 'bg-blue-600 text-white shadow-sm hover:bg-blue-700'
            }`}
          >
            <span>▶</span>
            {t('topicResearch.common.start')}
          </button>

          {/* 更新按钮 - 在现有基础上更新 */}
          <button
            onClick={onContinueRefresh}
            disabled={isMissionActive || !missionStatus || !canEdit}
            title={
              !canEdit
                ? t('topicResearch.common.needEditPermission')
                : undefined
            }
            className={`flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
              isMissionActive || !missionStatus || !canEdit
                ? 'cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400'
                : 'bg-green-600 text-white shadow-sm hover:bg-green-700'
            }`}
          >
            <span>🔄</span>
            {t('topicResearch.common.update')}
          </button>

          {/* 取消按钮 - 停止当前任务 */}
          <button
            onClick={onCancelRefresh}
            disabled={!isMissionActive || !canEdit}
            title={
              !canEdit
                ? t('topicResearch.common.needEditPermission')
                : undefined
            }
            className={`flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
              !isMissionActive || !canEdit
                ? 'cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400'
                : 'border border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
            }`}
          >
            <span>⏹</span>
            {t('topicResearch.common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// SVG Team Canvas View - Uses shared TeamTopologyCanvas
// ============================================
function TopicTeamCanvasView({
  topicId,
  topicName,
  agents,
  teamInfo,
  missionStatus,
  getAgentDisplay,
  getAgentRoleInfo,
}: {
  topicId: string;
  topicName: string;
  agents: ResearchAgent[];
  teamInfo?: TeamInfo | null;
  missionStatus?: MissionStatus | null;
  getAgentDisplay: (role: string) => {
    name: string;
    icon: string;
    color: string;
  };
  getAgentRoleInfo: (role: string) => {
    description: string;
    capabilities: string[];
    note: string;
  };
}) {
  const { t } = useTranslation();

  // ── Leader 对话状态（持久化 + 富展示，全面替代右下角内嵌面板） ──
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<LeaderChatMessageData[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatSending, setChatSending] = useState(false);
  const fetchTodos = useTopicInsightsStore((s) => s.fetchTodos);
  const fetchMissionStatus = useTopicInsightsStore((s) => s.fetchMissionStatus);
  const selectTodoInStore = useTopicInsightsStore((s) => s.selectTodo);
  const tiDecisionTypeConfig = useMemo(() => getTiDecisionTypeConfig(t), [t]);

  const activeMissionId = missionStatus?.id;

  // 打开对话框时拉取持久化历史（来自 team-messages，与右下角 panel 同源）
  useEffect(() => {
    if (!chatOpen || !topicId || !activeMissionId) return;
    let cancelled = false;
    setChatLoading(true);
    setChatError(null);
    getTeamMessages(topicId, { missionId: activeMissionId, limit: 50 })
      .then((msgs) => {
        if (cancelled) return;
        const filtered: LeaderChatMessageData[] = msgs
          .filter(
            (m) =>
              m.messageType === 'USER_MESSAGE' ||
              m.messageType === 'LEADER_RESPONSE'
          )
          .map((m) => ({
            id: m.id,
            role: m.messageType === 'USER_MESSAGE' ? 'user' : 'assistant',
            content: m.content,
            createdAt: m.createdAt,
            meta: m.metadata,
          }));
        setChatMessages(filtered);
      })
      .catch((e) => {
        if (!cancelled) {
          setChatError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setChatLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chatOpen, topicId, activeMissionId]);

  const handleLeaderSend = async (text: string) => {
    setChatSending(true);
    setChatError(null);

    const userMsgId = `user-${Date.now()}`;
    const thinkingId = `thinking-${Date.now()}`;
    const now = new Date().toISOString();
    setChatMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: text, createdAt: now },
      {
        id: thinkingId,
        role: 'assistant',
        content: '__THINKING__',
        createdAt: now,
      },
    ]);

    try {
      const resp = await leaderChat(
        topicId,
        text,
        activeMissionId ?? undefined
      );
      // 把 decisionType / understanding / todo / clarifyOptions 放进 meta，
      // 由 renderAssistantHeaderExtra / renderAssistantBodyPrefix /
      // renderAssistantBodyExtra 槽消费
      setChatMessages((prev) =>
        prev
          .filter((m) => m.id !== thinkingId)
          .concat({
            id: `asst-${Date.now()}`,
            role: 'assistant',
            content: resp.response,
            createdAt: new Date().toISOString(),
            meta: {
              decisionType: resp.decisionType,
              understanding: resp.understanding,
              todoCreated: resp.todo,
              clarifyOptions: resp.clarifyOptions,
            },
          })
      );

      // ★ Leader 创建 TODO 后刷新：
      //   - 右侧 TODO 列表（fetchTodos）
      //   - 左侧拓扑图 / 维度列表（fetchMissionStatus 拉新的 tasks）
      // fire-and-forget：刷新失败不应污染 chatError 让对话本身看起来失败
      if (resp.decisionType === 'CREATE_TODO' && resp.todo && activeMissionId) {
        void fetchTodos(topicId, activeMissionId);
        void fetchMissionStatus(topicId);
      }
    } catch (e) {
      setChatError(e instanceof Error ? e.message : String(e));
      setChatMessages((prev) => prev.filter((m) => m.id !== thinkingId));
    } finally {
      setChatSending(false);
    }
  };

  // Map ResearchAgent[] → TeamTopologyNode[]
  const { nodes, rows, connections, legendItems } = useMemo(() => {
    const leader = agents.find((a) => a.role === 'leader');
    const researchers = agents.filter((a) => a.role === 'researcher');
    const reviewer = agents.find((a) => a.role === 'reviewer');
    const synthesizer = agents.find((a) => a.role === 'synthesizer');

    const colorMap: Record<string, string> = {
      purple: 'purple',
      blue: 'blue',
      green: 'green',
      orange: 'orange',
      gray: 'gray',
    };

    const topoNodes: TeamTopologyNode[] = agents.map((agent) => {
      const display = getAgentDisplay(agent.role);
      return {
        id: agent.id,
        name: display.name,
        role: agent.role,
        icon: display.icon,
        status: agent.status,
        statusLabel: agent.workingStatus,
        colorKey:
          agent.role === 'leader'
            ? 'purple'
            : colorMap[display.color] || 'gray',
        isLeader: agent.role === 'leader',
        avatarRole: agent.role,
        taskProgress:
          agent.taskCount > 0
            ? { completed: agent.completedCount, total: agent.taskCount }
            : undefined,
      };
    });

    // Build rows: [leader] → [researchers] → [reviewer, synthesizer]
    const rowIds: string[][] = [];
    if (leader) rowIds.push([leader.id]);
    if (researchers.length > 0) rowIds.push(researchers.map((r) => r.id));
    const bottomRow: string[] = [];
    if (reviewer) bottomRow.push(reviewer.id);
    if (synthesizer) bottomRow.push(synthesizer.id);
    if (bottomRow.length > 0) rowIds.push(bottomRow);

    // Build connections: leader→researchers, researchers→bottom
    const conns: TeamTopologyConnection[] = [];
    if (leader) {
      researchers.forEach((r) => conns.push({ from: leader.id, to: r.id }));
      [reviewer, synthesizer].forEach((b) => {
        if (b) {
          researchers.forEach((r) => conns.push({ from: r.id, to: b.id }));
        }
      });
    }

    const legend: TeamTopologyLegendItem[] = [
      { color: 'bg-purple-500', label: 'Leader' },
      {
        color: 'bg-blue-500',
        label: t('topicResearch.common.working'),
        animated: true,
      },
      { color: 'bg-green-500', label: t('topicResearch.status.completed') },
      { color: 'bg-gray-400', label: t('topicResearch.status.idle') },
    ];

    return {
      nodes: topoNodes,
      rows: rowIds,
      connections: conns,
      legendItems: legend,
    };
  }, [agents, getAgentDisplay, t]);

  return (
    <>
      <TeamTopologyCanvas
        nodes={nodes}
        rows={rows}
        connections={connections}
        heightClass="h-[280px]"
        viewBoxHeight={280}
        rowYPositions={[...AVATAR_ROW_Y]}
        patternId="topic-research"
        legendItems={legendItems}
        renderTooltip={(node) => {
          const agent = agents.find((a) => a.id === node.id);
          if (!agent) return null;
          const display = getAgentDisplay(agent.role);
          return (
            <div className="text-xs">
              <div className="font-semibold text-gray-800">
                {display.icon} {agent.name}
              </div>
              <div className="mt-0.5 text-gray-500">
                {agent.taskCount > 0
                  ? t('topicResearch.common.taskProgress', {
                      completed: agent.completedCount,
                      total: agent.taskCount,
                    })
                  : t('topicResearch.common.noTasks')}
              </div>
              {agent.status === 'working' && (
                <div className="mt-0.5 text-blue-600">
                  {t('topicResearch.common.executing')}
                </div>
              )}
            </div>
          );
        }}
        renderDetail={(node, onClose) => {
          const agent = agents.find((a) => a.id === node.id);
          if (!agent) return null;
          const payload = buildTopicAgentInspectorPayload(
            agent,
            teamInfo,
            missionStatus,
            getAgentDisplay,
            getAgentRoleInfo,
            t
          );
          return (
            <AgentInspector
              open
              onClose={onClose}
              mode="modal"
              agent={payload}
              onChat={
                agent.role === 'leader'
                  ? () => {
                      onClose();
                      setChatOpen(true);
                    }
                  : undefined
              }
              chatLabel="与该 Leader 对话"
            />
          );
        }}
      />
      <LeaderChatDock
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        messages={chatMessages}
        loading={chatLoading}
        sending={chatSending}
        error={chatError}
        onSend={handleLeaderSend}
        title="与 Leader 对话"
        subtitle={topicName}
        accentColor="violet"
        assistantName="Leader"
        userName="You"
        renderAssistantHeaderExtra={(m) => {
          const dt = m.meta?.decisionType as LeaderDecisionType | undefined;
          if (!dt) return null;
          const cfg = tiDecisionTypeConfig[dt];
          if (!cfg) return null;
          return (
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${cfg.colorClass}`}
            >
              {cfg.label}
            </span>
          );
        }}
        renderAssistantBodyPrefix={(m) => {
          const understanding = m.meta?.understanding as string | undefined;
          if (!understanding) return null;
          return (
            <p className="mt-1 text-[11px] italic text-gray-500">
              💭 {understanding}
            </p>
          );
        }}
        renderAssistantBodyExtra={(m) => {
          const todo = m.meta?.todoCreated as
            | { id: string; title: string; assignedAgent?: string }
            | undefined;
          const clarifyOptions = m.meta?.clarifyOptions as string[] | undefined;
          if (!todo && !clarifyOptions?.length) return null;
          return (
            <>
              {todo && (
                <button
                  type="button"
                  onClick={() => {
                    // 关弹窗 + 选中 TODO（store 触发，listening 的 TopicContentPanel
                    // 会自动切到 research_collab tab 并打开 TodoDetailPanel）
                    setChatOpen(false);
                    selectTodoInStore(todo.id);
                  }}
                  className="mt-2 inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-100"
                >
                  <span>
                    ✓ 已创建任务 {todo.title}
                    {todo.assignedAgent && (
                      <span className="ml-1 text-blue-500">
                        → {todo.assignedAgent}
                      </span>
                    )}
                  </span>
                  <span className="text-blue-500">查看</span>
                </button>
              )}
              {clarifyOptions && clarifyOptions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {clarifyOptions.map((option, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => void handleLeaderSend(option)}
                      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700 transition-colors hover:border-amber-300 hover:bg-amber-100"
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
            </>
          );
        }}
      />
    </>
  );
}

// ============================================
// Build AgentInspector payload from TI domain data
// ============================================
function buildTopicAgentInspectorPayload(
  agent: ResearchAgent,
  teamInfo: TeamInfo | null | undefined,
  missionStatus: MissionStatus | null | undefined,
  getAgentDisplay: (role: string) => {
    name: string;
    icon: string;
    color: string;
  },
  getAgentRoleInfo: (role: string) => {
    description: string;
    capabilities: string[];
    note: string;
  },
  t: (key: string, params?: Record<string, string | number>) => string
): AgentInspectorAgent {
  const display = getAgentDisplay(agent.role);
  const roleInfo = getAgentRoleInfo(agent.role);

  // 状态徽章
  const statusLabel =
    agent.status === 'working'
      ? t('topicResearch.common.working')
      : agent.status === 'completed'
        ? t('topicResearch.status.completed')
        : agent.status === 'error'
          ? t('common.error')
          : t('topicResearch.status.idle');
  const statusColorClass =
    agent.status === 'working'
      ? 'text-blue-600'
      : agent.status === 'completed'
        ? 'text-emerald-600'
        : agent.status === 'error'
          ? 'text-red-600'
          : 'text-gray-500';

  // 技能 / 工具 —— 优先 Leader 分配的真实数据
  // 匹配顺序：精确 id → id 包含 → role 兜底
  // role 兜底必要：reviewer/synthesizer 的 agent.id 是硬编码 'reviewer'/'synthesizer'，
  // 但 teamInfo.agents 里通常是 UUID + role 字段，需 role 字段才能匹配上
  const teamAgent = teamInfo?.agents?.find(
    (ta) =>
      ta.id === agent.id || ta.id.includes(agent.id) || ta.role === agent.role
  );
  const realSkills = isValidStringArray(teamAgent?.skills)
    ? teamAgent.skills
    : undefined;
  const realTools = isValidStringArray(teamAgent?.tools)
    ? teamAgent.tools
    : undefined;
  const hasRealData = !!realSkills || !!realTools;

  // AI 模型
  const modelValue: React.ReactNode = (() => {
    if (agent.role === 'leader') {
      const leaderModel =
        teamInfo?.leaderModel ||
        missionStatus?.leaderModelId ||
        missionStatus?.leaderModelName;
      return leaderModel ? (
        <span className="font-mono text-sm font-medium text-indigo-700">
          {leaderModel}
        </span>
      ) : (
        <span className="font-mono text-sm text-gray-400">
          {t('topicResearch.common.notSpecified')}
        </span>
      );
    }
    const tasks = missionStatus?.tasks || [];
    let assignedTasks: TaskStatus[];
    if (agent.role === 'researcher') {
      assignedTasks = tasks.filter(
        (tk) =>
          tk.assignedAgent === agent.id && tk.taskType === 'dimension_research'
      );
    } else if (agent.role === 'reviewer') {
      assignedTasks = tasks.filter((tk) => tk.taskType === 'quality_review');
    } else if (agent.role === 'synthesizer') {
      assignedTasks = tasks.filter((tk) => tk.taskType === 'report_synthesis');
    } else {
      assignedTasks = [];
    }
    const modelEntries = new Map<
      string,
      { id: string; displayName?: string }
    >();
    for (const task of assignedTasks) {
      if (task.modelId && !modelEntries.has(task.modelId)) {
        modelEntries.set(task.modelId, {
          id: task.modelId,
          displayName: task.modelDisplayName,
        });
      }
    }
    const models = [...modelEntries.values()];
    if (models.length === 0) {
      return (
        <span className="font-mono text-sm text-gray-400">
          {t('topicResearch.common.notSpecified')}
        </span>
      );
    }
    return (
      <span className="flex flex-wrap gap-1">
        {models.map((model, idx: number) => (
          <span key={model.id}>
            <ModelBadge
              modelId={model.id}
              displayName={model.displayName}
              variant="compact"
            />
            {idx < models.length - 1 && ', '}
          </span>
        ))}
      </span>
    );
  })();

  // 任务进度（X / Y + 进度条）—— 作为 config 一行的 value
  // dl 左边已经有 "任务进度" label，value 内部不再重复 label，只显示数值 + 进度条
  const progressValue: React.ReactNode | undefined =
    agent.taskCount > 0 ? (
      <span className="block w-full">
        <span className="text-[11px] font-medium text-gray-700">
          {t('topicResearch.common.taskProgressValue', {
            completed: agent.completedCount,
            total: agent.taskCount,
          })}
        </span>
        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-gray-200">
          <span
            className={`block h-full ${
              agent.completedCount === agent.taskCount
                ? 'bg-green-500'
                : 'bg-blue-500'
            }`}
            style={{
              width: `${(agent.completedCount / agent.taskCount) * 100}%`,
            }}
          />
        </span>
      </span>
    ) : undefined;

  // 装配 config 顺序：进度 → 模型 → 技能 → 工具 → 配置说明（无真实数据时）
  const config: AgentConfigEntry[] = [];
  if (progressValue) {
    config.push({
      label: t('topicResearch.common.taskProgressLabel'),
      value: progressValue,
    });
  }
  config.push({ label: t('topicResearch.common.aiModel'), value: modelValue });

  if (realSkills && realSkills.length > 0) {
    config.push({
      label: t('topicResearch.common.assignedSkills'),
      chips: realSkills,
      chipsClassName: 'bg-blue-50 text-blue-700',
    });
  } else if (roleInfo.capabilities && roleInfo.capabilities.length > 0) {
    config.push({
      label: t('topicResearch.common.capabilityRange'),
      chips: roleInfo.capabilities,
      chipsClassName: 'bg-gray-50 text-gray-600',
    });
  }

  if (realTools && realTools.length > 0) {
    config.push({
      label: t('topicResearch.common.assignedTools'),
      chips: realTools,
      chipsClassName: 'bg-green-50 text-green-700',
    });
  }

  if (!hasRealData && roleInfo.note) {
    config.push({
      label: t('topicResearch.common.configMethod'),
      value: <span className="italic text-gray-600">{roleInfo.note}</span>,
    });
  }

  // 副标题只显示纯状态。
  // role 名在 zh.json 有两套键（如 reportWriter vs synthesizer），
  // 拼接成 "{role} · {status}" 易出现 "报告撰写者 · 撰写者 · 已完成" 这类
  // 视觉冗余 —— icon 本身已表达角色，title 是 agent 名称，副标题保持简洁。
  return {
    name: agent.name,
    description: roleInfo.description,
    icon: display.icon,
    iconClassName: 'bg-blue-50 text-blue-600',
    statusLabel,
    statusColorClass,
    config,
  };
}

// ============================================
// Task Item - 简洁单行显示
// ============================================

function TaskItem({ task }: { task: TaskStatus }) {
  const { t } = useTranslation();
  const icon = statusIcons[task.status] || '⏳';
  const colorClass = statusColors[task.status] || statusColors.PENDING;

  return (
    <div
      className={`flex items-center gap-2 rounded-md border border-gray-100 px-2.5 py-1.5 ${
        task.status === 'EXECUTING'
          ? 'border-blue-200 bg-blue-50/50'
          : task.status === 'COMPLETED'
            ? 'border-green-200 bg-green-50/30'
            : task.status === 'FAILED'
              ? 'border-red-200 bg-red-50/50'
              : 'bg-white'
      }`}
    >
      {/* 状态图标 */}
      <span className="text-xs">{icon}</span>

      {/* 任务名 */}
      <span className="min-w-0 flex-1 truncate text-xs text-gray-700">
        {task.dimensionName || task.title}
      </span>

      {/* 状态标签（不显示具体进度） */}
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${colorClass}`}>
        {task.status === 'COMPLETED'
          ? t('topicResearch.common.completed')
          : task.status === 'FAILED'
            ? t('topicResearch.common.failed')
            : task.status === 'EXECUTING'
              ? t('topicResearch.common.inProgress')
              : task.status === 'NEEDS_REVISION'
                ? t('topicResearch.common.needsRevision')
                : t('topicResearch.common.pendingProcess')}
      </span>
    </div>
  );
}
