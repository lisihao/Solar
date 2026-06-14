'use client';

/**
 * Collaboration Panel - 协作面板组件
 *
 * Phase 3.3: 协作审核工作流
 *
 * 功能：
 * 1. 显示当前协作者及状态
 * 2. 审核任务分配和进度
 * 3. 审核意见汇总
 * 4. 版本发布状态
 *
 * 使用方式：
 * 1. 自动获取模式：只传 topicId 和 reportId，组件自动获取数据
 * 2. 外部控制模式：传入 collaborators 和 reviewTasks 数据
 */

import { useState, useEffect, useCallback } from 'react';
import ClientDate from '@/components/common/ClientDate';
import {
  Users,
  CheckCircle2,
  Clock,
  AlertCircle,
  MessageSquare,
  User,
  MoreHorizontal,
  Send,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { useI18n } from '@/lib/i18n';
import {
  getReviewTasks,
  createReviewTasks,
  assignReviewTask,
  completeReviewTask,
  type ReviewTask as ApiReviewTask,
} from '@/services/topic-insights/api';

// ==================== Types ====================

interface Collaborator {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  userAvatar?: string;
  role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
  isOnline?: boolean;
  currentActivity?: string;
}

interface ReviewTask {
  id: string;
  sectionName: string;
  sectionOrder: number;
  assigneeId?: string;
  assigneeName?: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';
  approved?: boolean;
  score?: number;
  comments?: string;
  dueAt?: string;
  completedAt?: string;
}

interface ReviewComment {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  sectionName: string;
  content: string;
  status: 'PENDING' | 'ACCEPTED' | 'DISCUSSED' | 'DISMISSED';
  createdAt: string;
}

interface CollaborationPanelProps {
  topicId: string;
  reportId: string;
  /** 外部传入的协作者列表（外部控制模式） */
  collaborators?: Collaborator[];
  /** 外部传入的审核任务列表（外部控制模式） */
  reviewTasks?: ReviewTask[];
  reviewComments?: ReviewComment[];
  /** 当前用户ID（可选，用于高亮当前用户） */
  currentUserId?: string;
  /** 是否为所有者（可选，用于显示额外功能） */
  isOwner?: boolean;
  /** 外部分配任务回调（外部控制模式） */
  onAssignTask?: (taskId: string, assigneeId: string) => Promise<void>;
  /** 外部完成任务回调（外部控制模式） */
  onCompleteTask?: (
    taskId: string,
    approved: boolean,
    comments?: string
  ) => Promise<void>;
  onAcceptComment?: (commentId: string) => Promise<void>;
  onDismissComment?: (commentId: string) => Promise<void>;
  /** 外部刷新回调（外部控制模式） */
  onRefresh?: () => Promise<void>;
}

// ==================== Sub Components ====================

/**
 * 协作者列表
 */
function CollaboratorList({
  collaborators,
}: {
  collaborators: Collaborator[];
}) {
  const { t } = useI18n();
  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'OWNER':
        return (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
            Owner
          </span>
        );
      case 'ADMIN':
        return (
          <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700">
            Admin
          </span>
        );
      case 'EDITOR':
        return (
          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
            Editor
          </span>
        );
      default:
        return (
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
            Viewer
          </span>
        );
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <Users className="h-4 w-4" />
        {t('topicResearch.collaboration.currentCollaborators')}
      </div>
      <div className="space-y-1.5">
        {collaborators.map((c) => (
          <div
            key={c.id}
            className="flex items-center gap-2 rounded-lg p-2 hover:bg-gray-50"
          >
            <div className="relative">
              {c.userAvatar ? (
                <img
                  src={c.userAvatar}
                  alt={c.userName}
                  className="h-8 w-8 rounded-full"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200">
                  <User className="h-4 w-4 text-gray-500" />
                </div>
              )}
              {c.isOnline && (
                <div className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-green-500" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-gray-900">
                  {c.userName}
                </span>
                {getRoleBadge(c.role)}
              </div>
              {c.currentActivity && (
                <p className="truncate text-xs text-gray-500">
                  {c.currentActivity}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 审核任务列表
 */
function ReviewTaskList({
  tasks,
  collaborators,
  currentUserId,
  isOwner,
  onAssign,
  onComplete,
}: {
  tasks: ReviewTask[];
  collaborators: Collaborator[];
  currentUserId: string;
  isOwner: boolean;
  onAssign?: (taskId: string, assigneeId: string) => void;
  onComplete?: (taskId: string, approved: boolean) => void;
}) {
  const { t } = useI18n();
  const [selectedTask, setSelectedTask] = useState<string | null>(null);

  const getStatusIcon = (task: ReviewTask) => {
    switch (task.status) {
      case 'COMPLETED':
        return task.approved ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : (
          <AlertCircle className="h-4 w-4 text-red-500" />
        );
      case 'IN_PROGRESS':
        return <Clock className="h-4 w-4 animate-pulse text-blue-500" />;
      default:
        return (
          <div className="h-4 w-4 rounded-full border-2 border-gray-300" />
        );
    }
  };

  const getStatusText = (task: ReviewTask) => {
    switch (task.status) {
      case 'COMPLETED':
        return task.approved
          ? t('topicResearch.collaboration.reviewStatus.approved')
          : t('topicResearch.collaboration.reviewStatus.rejected');
      case 'IN_PROGRESS':
        return t('topicResearch.collaboration.reviewStatus.inProgress');
      case 'SKIPPED':
        return t('topicResearch.collaboration.reviewStatus.skipped');
      default:
        return t('topicResearch.collaboration.reviewStatus.pending');
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-gray-700">
        {t('topicResearch.collaboration.reviewTaskAssignment')}
      </div>
      <div className="divide-y rounded-lg border">
        {tasks.map((task) => (
          <div
            key={task.id}
            className={cn(
              'cursor-pointer p-3 transition-colors hover:bg-gray-50',
              selectedTask === task.id && 'bg-blue-50'
            )}
            onClick={() =>
              setSelectedTask(selectedTask === task.id ? null : task.id)
            }
          >
            <div className="flex items-center gap-3">
              {getStatusIcon(task)}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-gray-900">
                  {task.sectionName}
                </div>
                <div className="text-xs text-gray-500">
                  {task.assigneeName ||
                    t('topicResearch.collaboration.unassigned')}
                  {task.dueAt && (
                    <>
                      {' · '}
                      {t('topicResearch.collaboration.dueAt')}{' '}
                      <ClientDate date={task.dueAt} format="date" />
                    </>
                  )}
                </div>
              </div>
              <span
                className={cn(
                  'rounded px-2 py-0.5 text-xs',
                  task.status === 'COMPLETED' &&
                    task.approved &&
                    'bg-green-100 text-green-700',
                  task.status === 'COMPLETED' &&
                    !task.approved &&
                    'bg-red-100 text-red-700',
                  task.status === 'IN_PROGRESS' && 'bg-blue-100 text-blue-700',
                  task.status === 'PENDING' && 'bg-gray-100 text-gray-600'
                )}
              >
                {getStatusText(task)}
              </span>
            </div>

            {/* 展开详情 */}
            {selectedTask === task.id && (
              <div className="mt-3 space-y-2 border-t pt-3">
                {task.comments && (
                  <p className="text-sm text-gray-600">{task.comments}</p>
                )}
                {task.score !== undefined && (
                  <p className="text-sm text-gray-600">
                    {t('topicResearch.collaboration.score')}:{' '}
                    {Math.round(task.score)}/100
                  </p>
                )}

                {/* 操作按钮 */}
                <div className="flex gap-2">
                  {task.status === 'PENDING' && isOwner && (
                    <select
                      className="rounded border bg-white px-2 py-1 text-xs text-gray-900"
                      onChange={(e) => onAssign?.(task.id, e.target.value)}
                      value=""
                    >
                      <option value="">
                        {t('topicResearch.collaboration.assignTo')}
                      </option>
                      {collaborators
                        .filter((c) => c.role !== 'VIEWER')
                        .map((c) => (
                          <option key={c.userId} value={c.userId}>
                            {c.userName}
                          </option>
                        ))}
                    </select>
                  )}
                  {task.status === 'IN_PROGRESS' &&
                    task.assigneeId === currentUserId && (
                      <>
                        <button
                          className="rounded bg-green-500 px-3 py-1 text-xs text-white hover:bg-green-600"
                          onClick={(e) => {
                            e.stopPropagation();
                            onComplete?.(task.id, true);
                          }}
                        >
                          {t('topicResearch.collaboration.approve')}
                        </button>
                        <button
                          className="rounded bg-red-500 px-3 py-1 text-xs text-white hover:bg-red-600"
                          onClick={(e) => {
                            e.stopPropagation();
                            onComplete?.(task.id, false);
                          }}
                        >
                          {t('topicResearch.collaboration.reject')}
                        </button>
                      </>
                    )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 审核意见列表
 */
function ReviewCommentList({
  comments,
  onAccept,
  onDismiss,
}: {
  comments: ReviewComment[];
  onAccept?: (id: string) => void;
  onDismiss?: (id: string) => void;
}) {
  const { t } = useI18n();
  if (comments.length === 0) {
    return null;
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ACCEPTED':
        return (
          <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700">
            {t('topicResearch.collaboration.commentStatus.accepted')}
          </span>
        );
      case 'DISCUSSED':
        return (
          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
            {t('topicResearch.collaboration.commentStatus.discussed')}
          </span>
        );
      case 'DISMISSED':
        return (
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
            {t('topicResearch.collaboration.commentStatus.dismissed')}
          </span>
        );
      default:
        return (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
            {t('topicResearch.collaboration.commentStatus.pending')}
          </span>
        );
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <MessageSquare className="h-4 w-4" />
        {t('topicResearch.collaboration.reviewComments')}
      </div>
      <div className="space-y-3">
        {comments.map((comment) => (
          <div key={comment.id} className="rounded-lg bg-gray-50 p-3">
            <div className="flex items-start gap-2">
              {comment.authorAvatar ? (
                <img
                  src={comment.authorAvatar}
                  alt={comment.authorName}
                  className="h-6 w-6 rounded-full"
                />
              ) : (
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-300">
                  <User className="h-3 w-3 text-gray-500" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {comment.authorName}
                  </span>
                  <span className="text-xs text-gray-500">
                    ({comment.sectionName})
                  </span>
                  {getStatusBadge(comment.status)}
                </div>
                <p className="mt-1 text-sm text-gray-700">{comment.content}</p>
                {comment.status === 'PENDING' && (
                  <div className="mt-2 flex gap-2">
                    <button
                      className="text-xs text-green-600 hover:underline"
                      onClick={() => onAccept?.(comment.id)}
                    >
                      {t('topicResearch.collaboration.accept')}
                    </button>
                    <button
                      className="text-xs text-gray-500 hover:underline"
                      onClick={() => onDismiss?.(comment.id)}
                    >
                      {t('topicResearch.collaboration.dismiss')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 发布状态面板
 */
function PublishStatusPanel({
  tasks,
  onPublish,
}: {
  tasks: ReviewTask[];
  onPublish?: () => void;
}) {
  const { t } = useI18n();
  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === 'COMPLETED').length;
  const approved = tasks.filter((t) => t.approved === true).length;
  const rejected = tasks.filter((t) => t.approved === false).length;
  const pending = total - completed;

  const canPublish = pending === 0 && rejected === 0;

  return (
    <div className="space-y-3 rounded-lg bg-gray-50 p-4">
      <div className="text-sm font-medium text-gray-700">
        {t('topicResearch.collaboration.publishStatus')}
      </div>

      {/* 进度条 */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-gray-500">
          <span>{t('topicResearch.collaboration.reviewProgress')}</span>
          <span>
            {t('topicResearch.collaboration.completedOf', { completed, total })}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full bg-green-500 transition-all"
            style={{ width: `${(approved / total) * 100}%` }}
          />
        </div>
      </div>

      {/* 状态提示 */}
      {pending > 0 && (
        <div className="flex items-center gap-2 text-sm text-amber-600">
          <AlertCircle className="h-4 w-4" />
          {t('topicResearch.collaboration.pendingSections', { count: pending })}
        </div>
      )}
      {rejected > 0 && (
        <div className="flex items-center gap-2 text-sm text-red-600">
          <AlertCircle className="h-4 w-4" />
          {t('topicResearch.collaboration.rejectedSections', {
            count: rejected,
          })}
        </div>
      )}
      {canPublish && (
        <div className="flex items-center gap-2 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4" />
          {t('topicResearch.collaboration.readyToPublish')}
        </div>
      )}

      {/* 发布按钮 */}
      <button
        className={cn(
          'w-full rounded-lg py-2 text-sm font-medium transition-colors',
          canPublish
            ? 'bg-green-500 text-white hover:bg-green-600'
            : 'cursor-not-allowed bg-gray-200 text-gray-500'
        )}
        disabled={!canPublish}
        onClick={onPublish}
      >
        {canPublish
          ? t('topicResearch.collaboration.publish')
          : t('topicResearch.collaboration.completeReviewToPublish')}
      </button>
    </div>
  );
}

// ==================== Main Component ====================

export function CollaborationPanel({
  topicId,
  reportId,
  collaborators: propCollaborators,
  reviewTasks: propReviewTasks,
  reviewComments = [],
  currentUserId = '',
  isOwner = false,
  onAssignTask,
  onCompleteTask,
  onAcceptComment,
  onDismissComment,
  onRefresh,
}: CollaborationPanelProps) {
  const { t } = useI18n();
  // 内部状态：用于自动获取模式
  const [fetchedTasks, setFetchedTasks] = useState<ReviewTask[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 判断使用哪种模式（★ 使用 Array.isArray 确保是数组）
  const useAutoFetchMode = !propReviewTasks;
  const reviewTasks = useAutoFetchMode
    ? fetchedTasks
    : Array.isArray(propReviewTasks)
      ? propReviewTasks
      : [];
  const collaborators = Array.isArray(propCollaborators)
    ? propCollaborators
    : [];

  // 转换API任务格式到组件格式
  const convertApiTask = (task: ApiReviewTask): ReviewTask => ({
    id: task.id,
    sectionName: task.sectionName,
    sectionOrder: task.sectionOrder,
    assigneeId: task.assigneeId,
    assigneeName: task.assigneeName,
    status: task.status,
    approved: task.approved,
    score: task.score,
    comments: task.comments,
    dueAt: task.dueAt,
    completedAt: task.completedAt,
  });

  // 获取审核任务
  const fetchTasks = useCallback(async () => {
    if (!topicId || !reportId) return;

    setIsLoading(true);
    setError(null);
    try {
      const tasks = await getReviewTasks(topicId, reportId);
      setFetchedTasks(tasks.map(convertApiTask));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('topicResearch.collaboration.fetchTasksFailed')
      );
    } finally {
      setIsLoading(false);
    }
  }, [topicId, reportId]);

  // 自动获取模式：初始化时获取数据
  useEffect(() => {
    if (useAutoFetchMode) {
      fetchTasks();
    }
  }, [useAutoFetchMode, fetchTasks]);

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      if (onRefresh) {
        await onRefresh();
      } else if (useAutoFetchMode) {
        await fetchTasks();
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleAssign = async (taskId: string, assigneeId: string) => {
    if (onAssignTask) {
      await onAssignTask(taskId, assigneeId);
    } else if (useAutoFetchMode) {
      // 使用内置API分配任务
      const collaborator = collaborators.find((c) => c.userId === assigneeId);
      if (collaborator) {
        await assignReviewTask(
          topicId,
          reportId,
          taskId,
          assigneeId,
          collaborator.userName
        );
        await fetchTasks();
      }
    }
  };

  const handleComplete = async (taskId: string, approved: boolean) => {
    if (onCompleteTask) {
      await onCompleteTask(taskId, approved);
    } else if (useAutoFetchMode) {
      // 使用内置API完成任务
      await completeReviewTask(topicId, reportId, taskId, approved);
      await fetchTasks();
    }
  };

  // 加载状态
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto mb-2 h-8 w-8 animate-spin text-blue-500" />
          <p className="text-sm text-gray-500">
            {t('topicResearch.collaboration.loadingTasks')}
          </p>
        </div>
      </div>
    );
  }

  // 错误状态
  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <AlertCircle className="mx-auto mb-2 h-8 w-8 text-red-500" />
          <p className="mb-2 text-sm text-red-600">
            {typeof error === 'string'
              ? error
              : t('topicResearch.collaboration.loadFailed')}
          </p>
          <button
            onClick={handleRefresh}
            className="text-sm text-blue-600 hover:underline"
          >
            {t('topicResearch.collaboration.retry')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <h3 className="font-medium text-gray-900">
          {t('topicResearch.collaboration.title')}
        </h3>
        <button
          className="rounded p-1.5 transition-colors hover:bg-gray-100"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw
            className={cn(
              'h-4 w-4 text-gray-500',
              isRefreshing && 'animate-spin'
            )}
          />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        <CollaboratorList collaborators={collaborators} />

        <ReviewTaskList
          tasks={reviewTasks}
          collaborators={collaborators}
          currentUserId={currentUserId}
          isOwner={isOwner}
          onAssign={handleAssign}
          onComplete={handleComplete}
        />

        <ReviewCommentList
          comments={reviewComments}
          onAccept={onAcceptComment}
          onDismiss={onDismissComment}
        />

        <PublishStatusPanel tasks={reviewTasks} />
      </div>
    </div>
  );
}
