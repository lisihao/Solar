'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  TeamMission,
  AgentTask,
  MissionStatus,
  AgentTaskStatus,
} from '@/lib/types/ai-teams';
import { Target, Plus } from 'lucide-react';
import { useAiGroupStore } from '@/stores/ai-teams';
import { confirm } from '@/stores';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { LoadingState } from '@/components/ui';
import AIMessageRenderer from '@/components/ui/content/AIMessageRenderer';
import ClientDate from '@/components/common/ClientDate';
import { StatCard } from '@/components/ui/cards';

interface MissionProgressPanelProps {
  topicId: string;
  onCreateMission?: () => void;
  onFocusCanvas?: (mission: TeamMission, task?: AgentTask) => void;
}

// Status colors and labels
const missionStatusConfig: Record<
  MissionStatus,
  { color: string; bgColor: string; label: string; icon: string }
> = {
  PENDING: {
    color: 'text-gray-600',
    bgColor: 'bg-gray-100',
    label: '待开始',
    icon: '⏳',
  },
  PLANNING: {
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
    label: '规划中',
    icon: '📋',
  },
  IN_PROGRESS: {
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-100',
    label: '执行中',
    icon: '⚡',
  },
  PAUSED: {
    color: 'text-orange-600',
    bgColor: 'bg-orange-100',
    label: '已暂停',
    icon: '⏸️',
  },
  REVIEW: {
    color: 'text-purple-600',
    bgColor: 'bg-purple-100',
    label: '审核中',
    icon: '🔍',
  },
  COMPLETED: {
    color: 'text-green-600',
    bgColor: 'bg-green-100',
    label: '已完成',
    icon: '✅',
  },
  FAILED: {
    color: 'text-red-600',
    bgColor: 'bg-red-100',
    label: '失败',
    icon: '❌',
  },
  CANCELLED: {
    color: 'text-gray-600',
    bgColor: 'bg-gray-100',
    label: '已取消',
    icon: '🚫',
  },
};

const taskStatusConfig: Record<
  AgentTaskStatus,
  {
    color: string;
    bgColor: string;
    borderColor: string;
    icon: string;
    label: string;
  }
> = {
  PENDING: {
    color: 'text-gray-500',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    icon: '○',
    label: '等待中',
  },
  IN_PROGRESS: {
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    icon: '◐',
    label: '执行中',
  },
  BLOCKED: {
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    icon: '⊘',
    label: '阻塞',
  },
  AWAITING_REVIEW: {
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
    icon: '◉',
    label: '待审核',
  },
  REVISION_NEEDED: {
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
    icon: '↻',
    label: '需修订',
  },
  COMPLETED: {
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    icon: '✓',
    label: '已完成',
  },
  CANCELLED: {
    color: 'text-gray-400',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    icon: '○',
    label: '已取消',
  },
};

export default function MissionProgressPanel({
  topicId,
  onCreateMission,
  onFocusCanvas,
}: MissionProgressPanelProps) {
  const {
    missions,
    isLoadingMissions,
    fetchMissions,
    cancelMission,
    deleteMission,
    retryMission,
    resumeMission,
    typingAIs,
    currentTopic,
  } = useAiGroupStore();

  const [expandedMissions, setExpandedMissions] = useState<Set<string>>(
    new Set()
  );
  const [detailMission, setDetailMission] = useState<TeamMission | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false); // ★ 控制显示全部历史记录

  // Open canvas view for a specific mission
  const openCanvasForMission = (mission: TeamMission) => {
    if (onFocusCanvas) {
      onFocusCanvas(mission);
    }
  };

  // Load missions on mount
  useEffect(() => {
    fetchMissions(topicId);
  }, [topicId, fetchMissions]);

  // Polling for active missions - refresh every 5 seconds when there are active missions
  useEffect(() => {
    const hasActiveMissions =
      missions &&
      missions.some(
        (m) =>
          m.status === 'IN_PROGRESS' ||
          m.status === 'PLANNING' ||
          m.status === 'REVIEW' ||
          m.status === 'PENDING'
      );

    if (hasActiveMissions) {
      const intervalId = setInterval(() => {
        fetchMissions(topicId);
      }, 5000); // Poll every 5 seconds

      return () => clearInterval(intervalId);
    }
  }, [missions, topicId, fetchMissions]);

  // Auto-expand active missions
  useEffect(() => {
    if (missions && missions.length > 0) {
      const activeMissionIds = missions
        .filter(
          (m) =>
            m.status === 'IN_PROGRESS' ||
            m.status === 'PLANNING' ||
            m.status === 'REVIEW'
        )
        .map((m) => m.id);

      if (activeMissionIds.length > 0) {
        setExpandedMissions(new Set(activeMissionIds));
      }
    }
  }, [missions]);

  // Auto-update detailMission when missions list changes
  useEffect(() => {
    if (detailMission && missions) {
      const updatedMission = missions.find((m) => m.id === detailMission.id);
      if (
        updatedMission &&
        JSON.stringify(updatedMission) !== JSON.stringify(detailMission)
      ) {
        setDetailMission(updatedMission);
      }
    }
  }, [missions, detailMission]);

  const handleCancelMission = async (missionId: string) => {
    if (await confirm({ title: '确定要取消此任务吗？', type: 'warning' })) {
      await cancelMission(topicId, missionId);
    }
  };

  const handleRetryMission = async (
    missionId: string,
    mode: 'full' | 'continue' = 'continue'
  ) => {
    const confirmMsg =
      mode === 'full'
        ? '确定要重新执行此任务吗？这将重新规划所有子任务。'
        : '确定要继续执行此任务吗？';
    if (await confirm({ title: confirmMsg, type: 'warning' })) {
      await retryMission(topicId, missionId, { mode });
    }
  };

  const handleDeleteMission = async (missionId: string) => {
    if (
      await confirm({
        title: '确定要删除此任务吗？',
        description: '此操作不可恢复。',
        type: 'danger',
      })
    ) {
      await deleteMission(topicId, missionId);
    }
  };

  const handleResumeMission = async (missionId: string) => {
    await resumeMission(topicId, missionId);
  };

  const toggleMissionExpand = (missionId: string) => {
    setExpandedMissions((prev) => {
      const next = new Set(prev);
      if (next.has(missionId)) {
        next.delete(missionId);
      } else {
        next.add(missionId);
      }
      return next;
    });
  };

  // Ensure missions is always an array and deduplicate by id
  const missionsList = missions || [];
  const uniqueMissions = missionsList.filter(
    (mission, index, self) =>
      self.findIndex((m) => m.id === mission.id) === index
  );

  const activeMissions = uniqueMissions.filter(
    (m) =>
      m.status === 'IN_PROGRESS' ||
      m.status === 'PLANNING' ||
      m.status === 'REVIEW' ||
      m.status === 'PENDING'
  );

  const completedMissions = uniqueMissions.filter(
    (m) =>
      m.status === 'COMPLETED' ||
      m.status === 'FAILED' ||
      m.status === 'CANCELLED'
  );

  // Detail view modal - when a mission is selected for detail view
  if (detailMission) {
    return (
      <MissionDetailView
        mission={detailMission}
        typingAIs={typingAIs}
        onBack={() => setDetailMission(null)}
        onCancel={() => handleCancelMission(detailMission.id)}
        onRetry={(mode) => handleRetryMission(detailMission.id, mode)}
        onResume={() => handleResumeMission(detailMission.id)}
        onFocusCanvas={onFocusCanvas}
      />
    );
  }

  // Only show full-page loading on initial load (no data yet)
  // During refresh, keep showing existing data
  if (isLoadingMissions && (!missions || missions.length === 0)) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h3 className="font-semibold text-gray-900">Team Missions</h3>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <LoadingState size="md" />
        </div>
      </div>
    );
  }

  // Get the active mission for canvas view
  const activeMission =
    missionsList.find(
      (m) =>
        m.status === 'IN_PROGRESS' ||
        m.status === 'PLANNING' ||
        m.status === 'REVIEW' ||
        m.status === 'PENDING'
    ) ||
    missionsList[0] ||
    null;

  // Get AI members from current topic
  const aiMembers = currentTopic?.aiMembers || [];

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-slate-50/50 to-white">
      {/* Simple Header - Title only */}
      <div className="border-b border-gray-100 bg-white/80 px-4 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-sm">
            <svg
              className="h-4 w-4 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
              />
            </svg>
          </div>
          <h3 className="text-sm font-bold text-gray-800">Team Missions</h3>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {missionsList.length === 0 ? (
          <EmptyState
            icon={<Target className="h-12 w-12" />}
            title="开始您的第一个任务"
            description="创建一个任务让AI团队开始协作工作"
            action={
              <button
                onClick={onCreateMission}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-200 transition-all hover:shadow-xl hover:shadow-indigo-300"
              >
                <Plus className="h-4 w-4" />
                创建任务
              </button>
            }
          />
        ) : (
          <div className="space-y-3 p-3">
            {/* Active Missions */}
            {activeMissions.length > 0 && (
              <div className="space-y-3">
                {activeMissions.map((mission) => (
                  <MissionCard
                    key={mission.id}
                    mission={mission}
                    isExpanded={expandedMissions.has(mission.id)}
                    onToggle={() => toggleMissionExpand(mission.id)}
                    onViewDetail={() => setDetailMission(mission)}
                    onCancel={() => handleCancelMission(mission.id)}
                    onOpenCanvas={() => openCanvasForMission(mission)}
                    onRetry={(mode) => handleRetryMission(mission.id, mode)}
                    typingAIs={typingAIs}
                  />
                ))}
              </div>
            )}

            {/* Completed Missions - Enhanced Section */}
            {completedMissions.length > 0 && (
              <div className="pt-3">
                <div className="mb-3 flex items-center gap-3 px-1">
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gray-200 to-transparent"></div>
                  <div className="flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1">
                    <svg
                      className="h-3 w-3 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <span className="text-xs font-medium text-gray-500">
                      历史任务 ({completedMissions.length})
                    </span>
                  </div>
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gray-200 to-transparent"></div>
                </div>
                <div className="space-y-2">
                  {(showAllHistory
                    ? completedMissions
                    : completedMissions.slice(0, 5)
                  ).map((mission) => (
                    <MissionCard
                      key={mission.id}
                      mission={mission}
                      isExpanded={expandedMissions.has(mission.id)}
                      onToggle={() => toggleMissionExpand(mission.id)}
                      onViewDetail={() => setDetailMission(mission)}
                      onCancel={() => {}}
                      onDelete={() => handleDeleteMission(mission.id)}
                      onOpenCanvas={() => openCanvasForMission(mission)}
                      onRetry={(mode) => handleRetryMission(mission.id, mode)}
                      typingAIs={typingAIs}
                      isCompact
                    />
                  ))}
                </div>
                {/* ★ 展开/收起更多历史记录 */}
                {completedMissions.length > 5 && (
                  <button
                    onClick={() => setShowAllHistory(!showAllHistory)}
                    className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg py-2 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
                  >
                    {showAllHistory ? (
                      <>
                        <svg
                          className="h-3 w-3"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 15l7-7 7 7"
                          />
                        </svg>
                        收起
                      </>
                    ) : (
                      <>
                        <svg
                          className="h-3 w-3"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 9l-7 7-7-7"
                          />
                        </svg>
                        显示更多 ({completedMissions.length - 5} 个)
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Mission Card Component (列表视图)
function MissionCard({
  mission,
  isExpanded,
  onToggle,
  onViewDetail,
  onCancel,
  onDelete,
  onOpenCanvas,
  onRetry,
  typingAIs,
  isCompact = false,
}: {
  mission: TeamMission;
  isExpanded: boolean;
  onToggle: () => void;
  onViewDetail: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  onOpenCanvas: () => void;
  onRetry?: (mode: 'full' | 'continue') => void;
  typingAIs: Set<string>;
  isCompact?: boolean;
}) {
  const statusConfig = missionStatusConfig[mission.status];
  const isActive =
    mission.status === 'IN_PROGRESS' ||
    mission.status === 'PLANNING' ||
    mission.status === 'REVIEW';
  const isPending = mission.status === 'PENDING';
  const isFailed = mission.status === 'FAILED';
  const isCancelled = mission.status === 'CANCELLED';
  const isPaused = mission.status === 'PAUSED';
  // 只有 FAILED 和 CANCELLED 可以重试，PAUSED 使用 onResume
  const canRetry = isFailed || isCancelled;

  // Calculate task statistics
  const tasks = mission.tasks || [];
  const completedCount = tasks.filter((t) => t.status === 'COMPLETED').length;
  const inProgressCount = tasks.filter(
    (t) => t.status === 'IN_PROGRESS'
  ).length;

  return (
    <div
      className={`group overflow-hidden rounded-xl border transition-all ${
        isExpanded
          ? 'border-indigo-200 bg-white shadow-lg ring-1 ring-indigo-100'
          : isCompact
            ? 'border-gray-100 bg-gradient-to-r from-gray-50 to-slate-50/50 hover:border-gray-200'
            : 'border-gray-200/80 bg-white shadow-sm hover:border-gray-300 hover:shadow-md'
      }`}
    >
      {/* Card Header */}
      <div
        className={`flex cursor-pointer items-center gap-3 ${
          isCompact ? 'p-2.5' : 'p-3.5'
        }`}
        onClick={onToggle}
      >
        {/* Status Icon - Enhanced */}
        <div className="relative">
          <div
            className={`flex items-center justify-center rounded-xl text-base shadow-sm ${
              isCompact ? 'h-9 w-9' : 'h-11 w-11'
            } ${
              isActive
                ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white'
                : mission.status === 'COMPLETED'
                  ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white'
                  : mission.status === 'FAILED'
                    ? 'bg-gradient-to-br from-red-500 to-rose-600 text-white'
                    : `${statusConfig.bgColor} text-gray-600`
            }`}
          >
            {statusConfig.icon}
          </div>
          {isActive && (
            <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex h-3.5 w-3.5 rounded-full border-2 border-white bg-green-500"></span>
            </span>
          )}
        </div>

        {/* Title and Meta */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`truncate font-semibold text-gray-800 ${
                isCompact ? 'text-sm' : 'text-[15px]'
              }`}
            >
              {mission.title}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${statusConfig.bgColor} ${statusConfig.color}`}
            >
              {statusConfig.label}
            </span>
            <span className="text-gray-400">•</span>
            <span className="text-gray-500">
              👑 {mission.leader?.displayName || 'Unknown'}
            </span>
            {tasks.length > 0 && (
              <>
                <span className="text-gray-400">•</span>
                <span className="font-medium text-gray-600">
                  {completedCount}/{tasks.length}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Canvas Quick Access Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenCanvas();
          }}
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 text-white shadow-sm transition-all hover:shadow-md"
          title="在Canvas中查看"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
            />
          </svg>
        </button>

        {/* Expand Arrow */}
        <div
          className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all ${
            isExpanded ? 'bg-indigo-100' : 'bg-gray-100 group-hover:bg-gray-200'
          }`}
        >
          <svg
            className={`h-4 w-4 transition-transform ${
              isExpanded ? 'rotate-180 text-indigo-600' : 'text-gray-500'
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </div>

      {/* Progress Bar - Enhanced */}
      {!isCompact && tasks.length > 0 && (
        <div className="px-3.5 pb-3">
          <div className="h-2 overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full transition-all duration-700 ease-out ${
                mission.status === 'COMPLETED'
                  ? 'bg-gradient-to-r from-emerald-400 to-teal-500'
                  : mission.status === 'FAILED'
                    ? 'bg-gradient-to-r from-red-400 to-rose-500'
                    : 'bg-gradient-to-r from-blue-400 via-indigo-500 to-purple-500'
              }`}
              style={{
                width: `${tasks.length > 0 ? (completedCount / tasks.length) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Expanded Content - Quick Summary */}
      {isExpanded && (
        <div className="border-t border-gray-100 bg-gradient-to-b from-slate-50/50 to-white p-3.5">
          {/* Quick Stats - Enhanced */}
          {tasks.length > 0 && (
            <div className="mb-3 grid grid-cols-2 gap-2">
              <StatCard label="执行中" value={inProgressCount} tone="blue" />
              <StatCard label="已完成" value={completedCount} tone="emerald" />
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2">
            {/* View Detail Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onViewDetail();
              }}
              className="flex-1 rounded-xl bg-gradient-to-r from-gray-800 to-gray-900 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:from-gray-700 hover:to-gray-800 hover:shadow-md"
            >
              查看详情
            </button>
          </div>

          {/* Cancel Button (for active missions) */}
          {(isActive || isPending) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
              className="mt-2 w-full rounded-xl border border-red-200 bg-red-50 py-2 text-sm font-medium text-red-600 transition-all hover:bg-red-100"
            >
              取消任务
            </button>
          )}

          {/* ★ 继续执行按钮 (for cancelled/failed missions) */}
          {canRetry && onRetry && (
            <div className="mt-2 flex gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRetry('continue');
                }}
                className="flex-1 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:from-blue-600 hover:to-indigo-700 hover:shadow-md"
              >
                继续执行
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRetry('full');
                }}
                className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50"
                title="重新规划"
              >
                🔄
              </button>
            </div>
          )}

          {/* ★ 删除按钮 (for completed/failed/cancelled missions) */}
          {(mission.status === 'COMPLETED' ||
            mission.status === 'FAILED' ||
            mission.status === 'CANCELLED') &&
            onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl border border-gray-200 bg-white py-2 text-sm font-medium text-gray-500 transition-all hover:border-red-200 hover:bg-red-50 hover:text-red-600"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
                删除
              </button>
            )}
        </div>
      )}
    </div>
  );
}

// Mission Detail View (详情视图 - 全屏)
function MissionDetailView({
  mission,
  typingAIs,
  onBack,
  onCancel,
  onRetry,
  onResume,
  onFocusCanvas,
}: {
  mission: TeamMission;
  typingAIs: Set<string>;
  onBack: () => void;
  onCancel: () => void;
  onRetry?: (mode: 'full' | 'continue') => void;
  onResume?: () => void;
  onFocusCanvas?: (mission: TeamMission, task?: AgentTask) => void;
}) {
  const statusConfig = missionStatusConfig[mission.status];
  const tasks = mission.tasks || [];
  const isActive =
    mission.status === 'IN_PROGRESS' ||
    mission.status === 'PLANNING' ||
    mission.status === 'REVIEW';
  const isPending = mission.status === 'PENDING';
  const isFailed = mission.status === 'FAILED';
  const isCancelled = mission.status === 'CANCELLED';
  const isPaused = mission.status === 'PAUSED';
  // 只有 FAILED 和 CANCELLED 可以重试，PAUSED 使用 onResume
  const canRetry = isFailed || isCancelled;

  // Calculate stats
  const completedCount = tasks.filter((t) => t.status === 'COMPLETED').length;
  const inProgressCount = tasks.filter(
    (t) => t.status === 'IN_PROGRESS'
  ).length;
  const awaitingReviewCount = tasks.filter(
    (t) => t.status === 'AWAITING_REVIEW'
  ).length;
  const revisionCount = tasks.filter(
    (t) => t.status === 'REVISION_NEEDED'
  ).length;
  const pendingCount = tasks.filter((t) => t.status === 'PENDING').length;

  // Calculate performance metrics
  const totalRevisions = tasks.reduce(
    (sum, t) => sum + (t.revisionCount || 0),
    0
  );
  const avgRevisions =
    tasks.length > 0 ? (totalRevisions / tasks.length).toFixed(1) : '0';

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3">
        <button onClick={onBack} className="rounded-lg p-1 hover:bg-gray-100">
          <svg
            className="h-5 w-5 text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-lg">{statusConfig.icon}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusConfig.bgColor} ${statusConfig.color}`}
            >
              {statusConfig.label}
            </span>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-auto">
        {/* Mission Info */}
        <div className="border-b border-gray-100 p-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {mission.title}
          </h2>
          {mission.description && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-600">
              {mission.description}
            </p>
          )}
          <div className="mt-3 flex items-center gap-4 text-sm text-gray-500">
            <span className="flex items-center gap-1">
              👑 {mission.leader?.displayName || 'Unknown'}
            </span>
            <span>
              创建于 <ClientDate date={mission.createdAt} format="datetime" />
            </span>
          </div>
        </div>

        {/* Progress Overview */}
        {tasks.length > 0 && (
          <div className="border-b border-gray-100 p-4">
            <h3 className="mb-3 text-sm font-semibold text-gray-700">
              📊 任务进度
            </h3>
            {/* Progress Bar */}
            <div className="mb-3">
              <div className="mb-1 flex items-center justify-between text-sm text-gray-600">
                <span>完成进度</span>
                <span className="font-medium">
                  {completedCount}/{tasks.length} (
                  {Math.round((completedCount / tasks.length) * 100)}%)
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                <div
                  className={`h-full transition-all duration-500 ${
                    mission.status === 'COMPLETED'
                      ? 'bg-green-500'
                      : mission.status === 'FAILED'
                        ? 'bg-red-500'
                        : 'bg-gradient-to-r from-blue-500 to-purple-500'
                  }`}
                  style={{
                    width: `${(completedCount / tasks.length) * 100}%`,
                  }}
                />
              </div>
            </div>
            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-2">
              {inProgressCount > 0 && (
                <StatCard label="执行中" value={inProgressCount} tone="blue" />
              )}
              {awaitingReviewCount > 0 && (
                <StatCard
                  label="待审核"
                  value={awaitingReviewCount}
                  tone="violet"
                />
              )}
              {revisionCount > 0 && (
                <StatCard label="待修订" value={revisionCount} tone="amber" />
              )}
              {pendingCount > 0 && (
                <StatCard label="等待中" value={pendingCount} tone="gray" />
              )}
              <StatCard label="已完成" value={completedCount} tone="emerald" />
            </div>
          </div>
        )}

        {/* Task List */}
        <div className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">
            📋 子任务详情
          </h3>
          {tasks.length > 0 ? (
            <div className="space-y-3">
              {tasks.map((task, index) => (
                <TaskDetailCard
                  key={task.id}
                  task={task}
                  isWorking={typingAIs.has(task.assignedToId)}
                  taskNumber={index + 1}
                  onFocusCanvas={
                    onFocusCanvas
                      ? () => onFocusCanvas(mission, task)
                      : undefined
                  }
                />
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-gray-500">
              {mission.status === 'PLANNING' ? (
                <LoadingState size="md" text="Leader 正在分析和规划任务..." />
              ) : mission.status === 'PENDING' ? (
                '任务即将开始'
              ) : (
                '暂无子任务'
              )}
            </div>
          )}
        </div>

        {/* Final Result Summary Card (for completed missions) */}
        {mission.status === 'COMPLETED' && mission.finalResult && (
          <div className="border-t border-gray-100 bg-gradient-to-r from-green-50 to-emerald-50 p-3">
            <div className="flex items-start gap-2">
              <span className="text-lg">🏆</span>
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-xs font-medium text-green-800">
                  任务已完成
                </div>
                <div className="line-clamp-2 text-xs text-gray-600">
                  {(() => {
                    // 提取第一句话或前80个字符作为摘要
                    const text = mission.finalResult
                      .replace(/^#+\s*[^\n]*\n*/g, '')
                      .trim();
                    const firstSentence = text.split(/[。！？\n]/)[0];
                    return firstSentence.length > 80
                      ? firstSentence.substring(0, 80) + '...'
                      : firstSentence +
                          (text.length > firstSentence.length ? '...' : '');
                  })()}
                </div>
                <div className="mt-1 text-xs text-green-600">
                  详见聊天区最终交付消息
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Performance Summary (for completed missions) */}
        {mission.status === 'COMPLETED' && tasks.length > 0 && (
          <QuantitativePerformanceSummary
            mission={mission}
            tasks={tasks}
            completedCount={completedCount}
          />
        )}

        {/* Failed Mission Info */}
        {mission.status === 'FAILED' && (
          <div className="border-t border-gray-100 bg-red-50 p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-800">
              ⚠️ 任务失败
            </h3>
            <div className="text-sm text-red-700">
              {mission.summary || '任务执行过程中遇到问题，请查看详细日志'}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Actions */}
      {(isActive || isPending) && (
        <div className="border-t border-gray-200 p-4">
          <button
            onClick={onCancel}
            className="w-full rounded-lg bg-red-50 py-2.5 text-sm font-medium text-red-600 hover:bg-red-100"
          >
            取消任务
          </button>
        </div>
      )}

      {/* Paused Mission Actions */}
      {isPaused && onResume && (
        <div className="border-t border-gray-200 p-4">
          <button
            onClick={onResume}
            className="w-full rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 py-2.5 text-sm font-semibold text-white shadow-sm hover:shadow-md"
          >
            ▶️ 继续执行
          </button>
        </div>
      )}

      {/* Failed/Cancelled Mission Actions */}
      {canRetry && onRetry && (
        <div className="space-y-2 border-t border-gray-200 p-4">
          <button
            onClick={() => onRetry('continue')}
            className="w-full rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 py-2.5 text-sm font-semibold text-white shadow-sm hover:shadow-md"
          >
            ▶️ 继续执行未完成任务
          </button>
          <button
            onClick={() => onRetry('full')}
            className="w-full rounded-lg border border-gray-300 bg-white py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            🔄 重新规划并执行
          </button>
        </div>
      )}
    </div>
  );
}

// Task Detail Card Component (详情视图中的任务卡片)
function TaskDetailCard({
  task,
  isWorking,
  taskNumber,
  onFocusCanvas,
}: {
  task: AgentTask;
  isWorking: boolean;
  taskNumber: number;
  onFocusCanvas?: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const statusConfig = taskStatusConfig[task.status];

  const hasResult = !!task.result;
  const hasFeedback = !!task.leaderFeedback;

  // 【关键修复】只有当任务处于活动状态且正在执行时才显示 working 状态
  // 已完成、已取消或失败的任务不应显示 "正在思考和处理中"
  const isTaskActive =
    task.status === 'IN_PROGRESS' ||
    task.status === 'PENDING' ||
    task.status === 'AWAITING_REVIEW' ||
    task.status === 'REVISION_NEEDED';
  const showWorking = isWorking && isTaskActive;

  return (
    <div
      className={`rounded-xl border transition-all ${
        isExpanded ? 'border-blue-300 shadow-sm' : statusConfig.borderColor
      } ${statusConfig.bgColor}`}
      onClick={onFocusCanvas}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onFocusCanvas?.();
        }
      }}
    >
      {/* Task Header */}
      <div
        className="flex cursor-pointer items-start gap-3 p-3"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* Task Number & Status */}
        <div className="flex flex-col items-center gap-1">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-600">
            {taskNumber}
          </div>
          {showWorking ? (
            <svg
              className="h-4 w-4 animate-spin text-blue-600"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          ) : (
            <span className={`text-sm ${statusConfig.color}`}>
              {statusConfig.icon}
            </span>
          )}
        </div>

        {/* Task Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="font-medium text-gray-900">{task.title}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={`rounded-full px-2 py-0.5 ${statusConfig.bgColor} ${statusConfig.color}`}
                >
                  {statusConfig.label}
                </span>
                <span className="flex items-center gap-1 text-gray-500">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br from-purple-400 to-blue-400 text-[10px] text-white">
                    {task.assignedTo?.displayName?.charAt(0) || 'A'}
                  </span>
                  {task.assignedTo?.displayName || 'Unknown'}
                </span>
                {task.revisionCount > 0 && (
                  <span className="text-orange-500">
                    修订 {task.revisionCount}次
                  </span>
                )}
              </div>
            </div>
            <svg
              className={`h-5 w-5 shrink-0 text-gray-400 transition-transform ${
                isExpanded ? 'rotate-180' : ''
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>

          {/* Working Status - 仅在任务活动且正在处理时显示 */}
          {showWorking && (
            <div className="mt-2 flex items-center gap-2 text-xs text-blue-600">
              <span className="flex gap-0.5">
                <span
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-500"
                  style={{ animationDelay: '0ms' }}
                ></span>
                <span
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-500"
                  style={{ animationDelay: '150ms' }}
                ></span>
                <span
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-500"
                  style={{ animationDelay: '300ms' }}
                ></span>
              </span>
              正在思考和处理中...
            </div>
          )}
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="space-y-3 border-t border-gray-200/50 p-3">
          {/* Task Description */}
          {task.description && task.description !== task.title && (
            <div>
              <div className="mb-1 text-xs font-medium text-gray-500">
                任务描述
              </div>
              <div className="whitespace-pre-wrap text-sm text-gray-700">
                {task.description}
              </div>
            </div>
          )}

          {/* Task Result - 使用 Markdown 渲染支持表格 */}
          {hasResult && (
            <div className="rounded-lg bg-white/80 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-600">
                📝 执行成果
              </div>
              <div className="prose prose-sm prose-gray max-w-none">
                <AIMessageRenderer content={task.result || ''} />
              </div>
            </div>
          )}

          {/* Leader Feedback */}
          {hasFeedback && (
            <div
              className={`rounded-lg p-3 ${
                task.status === 'COMPLETED'
                  ? 'bg-green-100/60'
                  : task.status === 'REVISION_NEEDED'
                    ? 'bg-orange-100/60'
                    : 'bg-purple-100/60'
              }`}
            >
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-600">
                👑 Leader 评审
                {task.status === 'COMPLETED' && (
                  <span className="rounded-full bg-green-200 px-2 py-0.5 text-xs text-green-700">
                    ✓ 通过
                  </span>
                )}
                {task.status === 'REVISION_NEEDED' && (
                  <span className="rounded-full bg-orange-200 px-2 py-0.5 text-xs text-orange-700">
                    需修订
                  </span>
                )}
              </div>
              <div className="whitespace-pre-wrap text-sm text-gray-700">
                {task.leaderFeedback}
              </div>
            </div>
          )}

          {/* Timestamps */}
          <div className="flex flex-wrap gap-3 border-t border-gray-200/50 pt-2 text-xs text-gray-400">
            {task.startedAt && (
              <span>
                开始: <ClientDate date={task.startedAt} format="datetime" />
              </span>
            )}
            {task.completedAt && (
              <span>
                完成: <ClientDate date={task.completedAt} format="datetime" />
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// 量化绩效总结组件
function QuantitativePerformanceSummary({
  mission,
  tasks,
  completedCount,
}: {
  mission: TeamMission;
  tasks: AgentTask[];
  completedCount: number;
}) {
  // ========== 计算量化指标 ==========

  // 1. 总体效率指标
  const totalTasks = tasks.length;
  const completionRate =
    totalTasks > 0 ? (completedCount / totalTasks) * 100 : 0;

  // 一次通过率（无修订的任务占比）
  const firstPassTasks = tasks.filter(
    (t) => t.status === 'COMPLETED' && (t.revisionCount || 0) === 0
  ).length;
  const firstPassRate =
    completedCount > 0 ? (firstPassTasks / completedCount) * 100 : 0;

  // 总修订次数
  const totalRevisions = tasks.reduce(
    (sum, t) => sum + (t.revisionCount || 0),
    0
  );
  const avgRevisions = completedCount > 0 ? totalRevisions / completedCount : 0;

  // 2. 时间效率指标
  const calculateDuration = (
    startedAt: string | null,
    completedAt: string | null
  ): number | null => {
    if (!startedAt || !completedAt) return null;
    return (
      (new Date(completedAt).getTime() - new Date(startedAt).getTime()) /
      1000 /
      60
    ); // 分钟
  };

  const taskDurations = tasks
    .filter((t) => t.startedAt && t.completedAt)
    .map((t) => calculateDuration(t.startedAt, t.completedAt)!)
    .filter((d) => d !== null && d > 0);

  const avgDuration =
    taskDurations.length > 0
      ? taskDurations.reduce((a, b) => a + b, 0) / taskDurations.length
      : 0;

  const minDuration = taskDurations.length > 0 ? Math.min(...taskDurations) : 0;
  const maxDuration = taskDurations.length > 0 ? Math.max(...taskDurations) : 0;

  // 任务总耗时
  const missionDuration =
    mission.startedAt && mission.completedAt
      ? (new Date(mission.completedAt).getTime() -
          new Date(mission.startedAt).getTime()) /
        1000 /
        60
      : 0;

  // 3. 任务复杂度分布
  const priorityDistribution = {
    CRITICAL: tasks.filter((t) => t.priority === 'CRITICAL').length,
    HIGH: tasks.filter((t) => t.priority === 'HIGH').length,
    MEDIUM: tasks.filter((t) => t.priority === 'MEDIUM').length,
    LOW: tasks.filter((t) => t.priority === 'LOW').length,
  };

  const typeDistribution = tasks.reduce(
    (acc, t) => {
      acc[t.taskType] = (acc[t.taskType] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  // 4. 成员详细绩效
  interface AgentPerformance {
    agent: NonNullable<AgentTask['assignedTo']>;
    totalTasks: number;
    completedTasks: number;
    completionRate: number;
    firstPassTasks: number;
    firstPassRate: number;
    totalRevisions: number;
    avgDuration: number;
    efficiencyScore: number; // 综合效率评分 0-100
  }

  const agentPerformances: AgentPerformance[] = Array.from(
    new Map(tasks.map((t) => [t.assignedToId, t.assignedTo])).values()
  )
    .filter(
      (agent): agent is NonNullable<AgentTask['assignedTo']> => agent !== null
    )
    .map((agent) => {
      const agentTasks = tasks.filter((t) => t.assignedToId === agent.id);
      const agentCompleted = agentTasks.filter((t) => t.status === 'COMPLETED');
      const agentFirstPass = agentCompleted.filter(
        (t) => (t.revisionCount || 0) === 0
      );
      const agentRevisions = agentTasks.reduce(
        (sum, t) => sum + (t.revisionCount || 0),
        0
      );

      const agentDurations = agentTasks
        .filter((t) => t.startedAt && t.completedAt)
        .map((t) => calculateDuration(t.startedAt, t.completedAt)!)
        .filter((d) => d > 0);

      const agentAvgDuration =
        agentDurations.length > 0
          ? agentDurations.reduce((a, b) => a + b, 0) / agentDurations.length
          : 0;

      // 计算综合效率评分
      const completionRateScore =
        agentTasks.length > 0
          ? (agentCompleted.length / agentTasks.length) * 40
          : 0;
      const firstPassScore =
        agentCompleted.length > 0
          ? (agentFirstPass.length / agentCompleted.length) * 30
          : 0;
      const revisionPenalty = Math.min(agentRevisions * 5, 20); // 最多扣20分
      const efficiencyScore = Math.round(
        Math.max(
          0,
          Math.min(
            100,
            completionRateScore + firstPassScore + 30 - revisionPenalty
          )
        )
      );

      return {
        agent,
        totalTasks: agentTasks.length,
        completedTasks: agentCompleted.length,
        completionRate:
          agentTasks.length > 0
            ? (agentCompleted.length / agentTasks.length) * 100
            : 0,
        firstPassTasks: agentFirstPass.length,
        firstPassRate:
          agentCompleted.length > 0
            ? (agentFirstPass.length / agentCompleted.length) * 100
            : 0,
        totalRevisions: agentRevisions,
        avgDuration: agentAvgDuration,
        efficiencyScore,
      };
    })
    .sort((a, b) => b.efficiencyScore - a.efficiencyScore); // 按效率评分排序

  // 格式化时间
  const formatDuration = (minutes: number): string => {
    if (minutes < 1) return '<1分钟';
    if (minutes < 60) return `${Math.round(minutes)}分钟`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return mins > 0 ? `${hours}小时${mins}分钟` : `${hours}小时`;
  };

  // 获取评分颜色
  const getScoreColor = (score: number): string => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-blue-600';
    if (score >= 40) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getScoreLabel = (score: number): string => {
    if (score >= 90) return '卓越';
    if (score >= 80) return '优秀';
    if (score >= 70) return '良好';
    if (score >= 60) return '合格';
    if (score >= 40) return '待改进';
    return '不合格';
  };

  // 计算团队整体评分
  const teamScore =
    agentPerformances.length > 0
      ? Math.round(
          agentPerformances.reduce((sum, p) => sum + p.efficiencyScore, 0) /
            agentPerformances.length
        )
      : 0;

  return (
    <div className="border-t border-gray-100 p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">
        📊 量化绩效报告
      </h3>

      {/* 核心指标 - 横向列表布局 */}
      <div className="mb-3 rounded-lg bg-gradient-to-r from-blue-50 to-indigo-50 p-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-600">任务完成</span>
            <span className="text-sm font-semibold">
              <span className="text-green-600">{completedCount}</span>
              <span className="text-gray-400">/{totalTasks}</span>
              <span className="ml-1 text-green-600">
                ({completionRate.toFixed(0)}%)
              </span>
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-600">一次通过率</span>
            <span className="text-sm font-semibold text-blue-600">
              {firstPassRate.toFixed(0)}%
              <span className="ml-1 font-normal text-gray-400">
                ({firstPassTasks}/{completedCount})
              </span>
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-600">修订统计</span>
            <span className="text-sm font-semibold">
              共<span className="mx-0.5 text-orange-600">{totalRevisions}</span>
              次
              <span className="ml-1 font-normal text-gray-400">
                (平均 {avgRevisions.toFixed(1)}次/任务)
              </span>
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-600">总耗时</span>
            <span className="text-sm font-semibold text-gray-900">
              {formatDuration(missionDuration)}
            </span>
          </div>
        </div>
      </div>

      {/* 团队综合评分 */}
      <div className="mb-3">
        <StatCard
          label="团队综合评分"
          value={
            <>
              {teamScore}
              <span className="text-sm font-normal text-gray-400">/100</span>
            </>
          }
          hint={
            <>
              <span className={getScoreColor(teamScore)}>
                {getScoreLabel(teamScore)}
              </span>
              <span className="ml-2">基于完成率、一次通过率、修订次数</span>
            </>
          }
          tone={
            teamScore >= 80
              ? 'emerald'
              : teamScore >= 60
                ? 'blue'
                : teamScore >= 40
                  ? 'amber'
                  : 'red'
          }
        />
      </div>

      {/* 成员绩效排行 - 简洁列表 */}
      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-100 bg-gray-50 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-600">
              成员绩效排行
            </span>
            <span className="text-xs text-gray-400">完成 | 通过率 | 评分</span>
          </div>
        </div>
        <div className="divide-y divide-gray-50">
          {agentPerformances.map((perf, index) => (
            <div
              key={perf.agent.id}
              className="flex items-center justify-between px-3 py-2"
            >
              <div className="flex items-center gap-2">
                {/* 排名 */}
                <div
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${
                    index === 0
                      ? 'bg-yellow-100 text-yellow-700'
                      : index === 1
                        ? 'bg-gray-100 text-gray-600'
                        : index === 2
                          ? 'bg-orange-100 text-orange-700'
                          : 'bg-gray-50 text-gray-400'
                  }`}
                >
                  {index + 1}
                </div>
                {/* 头像和名称 */}
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-purple-400 to-blue-400 text-xs text-white">
                  {perf.agent.displayName?.charAt(0) || 'A'}
                </div>
                <span className="max-w-[80px] truncate text-sm font-medium text-gray-900">
                  {perf.agent.displayName}
                </span>
              </div>
              {/* 指标 */}
              <div className="flex items-center gap-3 text-xs">
                <span className="text-gray-600">
                  {perf.completedTasks}/{perf.totalTasks}
                </span>
                <span className="w-10 text-right text-blue-600">
                  {perf.firstPassRate.toFixed(0)}%
                </span>
                <span
                  className={`w-8 text-right font-semibold ${getScoreColor(perf.efficiencyScore)}`}
                >
                  {perf.efficiencyScore}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 任务分布 - 可折叠详情 */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">
          查看任务分布详情 ▾
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {/* 优先级分布 */}
          <div className="rounded bg-gray-50 p-2">
            <div className="mb-1 text-xs font-medium text-gray-600">优先级</div>
            <div className="space-y-0.5 text-xs">
              {priorityDistribution.CRITICAL > 0 && (
                <div className="flex justify-between">
                  <span className="text-red-600">紧急</span>
                  <span>{priorityDistribution.CRITICAL}</span>
                </div>
              )}
              {priorityDistribution.HIGH > 0 && (
                <div className="flex justify-between">
                  <span className="text-orange-600">高</span>
                  <span>{priorityDistribution.HIGH}</span>
                </div>
              )}
              {priorityDistribution.MEDIUM > 0 && (
                <div className="flex justify-between">
                  <span className="text-yellow-600">中</span>
                  <span>{priorityDistribution.MEDIUM}</span>
                </div>
              )}
              {priorityDistribution.LOW > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">低</span>
                  <span>{priorityDistribution.LOW}</span>
                </div>
              )}
            </div>
          </div>
          {/* 类型分布 */}
          <div className="rounded bg-gray-50 p-2">
            <div className="mb-1 text-xs font-medium text-gray-600">类型</div>
            <div className="space-y-0.5 text-xs">
              {Object.entries(typeDistribution).map(([type, count]) => (
                <div key={type} className="flex justify-between">
                  <span className="text-gray-600">{type}</span>
                  <span>{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
