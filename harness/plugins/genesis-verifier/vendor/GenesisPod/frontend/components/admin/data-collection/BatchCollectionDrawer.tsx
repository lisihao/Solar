'use client';

import { useState, useEffect, useRef } from 'react';
import {
  X,
  Play,
  Pause,
  Square,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  AlertCircle,
} from 'lucide-react';
import { logger } from '@/lib/utils/logger';
import { toast, confirm } from '@/stores';
import {
  createCollectionTask,
  executeTask,
  pauseTask,
  resumeTask,
  cancelTask,
  getCollectionTask,
  CollectionTask,
} from '@/services/data-collection/api';

interface DataSource {
  id: string;
  name: string;
  description?: string;
  type: string;
  category: string;
  status: 'ACTIVE' | 'PAUSED' | 'FAILED' | 'MAINTENANCE';
}

interface BatchCollectionDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  categoryName: string;
  sources: DataSource[];
}

interface TaskProgress {
  id: string;
  sourceId: string;
  sourceName: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progress: number;
  totalItems: number;
  successItems: number;
  failedItems: number;
  duplicateItems: number;
  errorMessage?: string;
}

export default function BatchCollectionDrawer({
  isOpen,
  onClose,
  categoryName,
  sources,
}: BatchCollectionDrawerProps) {
  const [selectedSources, setSelectedSources] = useState<Set<string>>(
    new Set()
  );
  const [taskProgress, setTaskProgress] = useState<Map<string, TaskProgress>>(
    new Map()
  );
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const taskProgressRef = useRef(taskProgress);

  // 保持 ref 与 state 同步
  useEffect(() => {
    taskProgressRef.current = taskProgress;
  }, [taskProgress]);

  // 默认选择所有ACTIVE的源
  useEffect(() => {
    if (isOpen && sources.length > 0) {
      const activeSourceIds = sources
        .filter((s) => s.status === 'ACTIVE')
        .map((s) => s.id);
      setSelectedSources(new Set(activeSourceIds));
    }
  }, [isOpen, sources]);

  // 轮询任务进度 - 通过 ref 读取最新 taskProgress，避免每次 setTaskProgress 重建 interval
  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(async () => {
      const currentProgress = taskProgressRef.current;
      if (currentProgress.size === 0) return;

      let hasRunning = false;

      for (const [taskId, progress] of currentProgress.entries()) {
        if (progress.status === 'RUNNING' || progress.status === 'PENDING') {
          try {
            const task = await getCollectionTask(taskId);

            setTaskProgress((prev) => {
              const next = new Map(prev);
              const existing = next.get(taskId);
              if (existing) {
                next.set(taskId, {
                  ...existing,
                  status: task.status,
                  progress: task.progress,
                  totalItems: task.totalItems,
                  successItems: task.successItems,
                  failedItems: task.failedItems,
                  duplicateItems: task.duplicateItems,
                  errorMessage: task.errorMessage,
                });
              }
              return next;
            });

            if (task.status === 'RUNNING' || task.status === 'PENDING') {
              hasRunning = true;
            }
          } catch (error) {
            logger.error(`Failed to fetch task ${taskId}:`, error);
            hasRunning = true; // 网络错误时保持轮询
          }
        }
      }

      // 如果所有任务都完成了，停止轮询
      if (!hasRunning) {
        setIsRunning(false);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isRunning]);

  const toggleSource = (sourceId: string) => {
    const newSelected = new Set(selectedSources);
    if (newSelected.has(sourceId)) {
      newSelected.delete(sourceId);
    } else {
      newSelected.add(sourceId);
    }
    setSelectedSources(newSelected);
  };

  const selectAll = () => {
    setSelectedSources(
      new Set(sources.filter((s) => s.status === 'ACTIVE').map((s) => s.id))
    );
  };

  const deselectAll = () => {
    setSelectedSources(new Set());
  };

  const handleRun = async () => {
    // 防止重复点击
    if (isRunning) {
      logger.debug('Collection already running, ignoring click');
      return;
    }

    if (selectedSources.size === 0) {
      toast.warning('请至少选择一个数据源');
      return;
    }

    // 立即设置运行状态，防止多次点击
    setIsRunning(true);
    setIsPaused(false);
    setTaskProgress(new Map());

    let hasAnyRunning = false;

    // 并行创建和执行所有任务，每个任务创建后立即显示
    const taskPromises = Array.from(selectedSources).map(async (sourceId) => {
      const source = sources.find((s) => s.id === sourceId);
      if (!source) return;

      try {
        // 创建任务
        logger.debug(`Creating task for ${source.name}...`);
        const taskResponse = await createCollectionTask({
          sourceId: source.id,
          name: `Batch: ${categoryName} - ${source.name}`,
          description: `Batch collection for ${categoryName} category`,
          type: 'MANUAL',
          sourceConfig: { maxResults: 50 },
          deduplicationRules: {},
        });

        const taskId = taskResponse.id;
        logger.debug(`Task created: ${taskId}, showing PENDING...`);

        // 立即添加到进度面板（PENDING 状态）
        setTaskProgress((prev) => {
          const next = new Map(prev);
          next.set(taskId, {
            id: taskId,
            sourceId: source.id,
            sourceName: source.name,
            status: 'PENDING',
            progress: 0,
            totalItems: 0,
            successItems: 0,
            failedItems: 0,
            duplicateItems: 0,
          });
          return next;
        });

        // 执行任务（后端会异步执行）
        await executeTask(taskId);
        logger.debug(`Task ${taskId} execution started, showing RUNNING...`);

        // 更新为 RUNNING 状态
        setTaskProgress((prev) => {
          const next = new Map(prev);
          const existing = next.get(taskId);
          if (existing) {
            next.set(taskId, { ...existing, status: 'RUNNING' });
          }
          return next;
        });

        hasAnyRunning = true;
      } catch (taskError) {
        logger.error(`Failed to start task for ${source.name}:`, taskError);
        const errorMsg =
          taskError instanceof Error ? taskError.message : 'Unknown error';
        // 单个任务失败不影响其他任务，立即显示失败状态
        setTaskProgress((prev) => {
          const next = new Map(prev);
          next.set(`failed-${sourceId}`, {
            id: `failed-${sourceId}`,
            sourceId: source.id,
            sourceName: source.name,
            status: 'FAILED',
            progress: 0,
            totalItems: 0,
            successItems: 0,
            failedItems: 0,
            duplicateItems: 0,
            errorMessage: errorMsg,
          });
          return next;
        });
      }
    });

    await Promise.all(taskPromises);

    // 如果没有成功启动任何任务，停止运行状态
    if (!hasAnyRunning) {
      setIsRunning(false);
    }
  };

  const handlePause = async () => {
    try {
      for (const [taskId, progress] of taskProgress.entries()) {
        if (progress.status === 'RUNNING') {
          await pauseTask(taskId);
        }
      }
      setIsPaused(true);
    } catch (error) {
      logger.error('Failed to pause tasks:', error);
    }
  };

  const handleResume = async () => {
    try {
      for (const [taskId, progress] of taskProgress.entries()) {
        if (progress.status === 'PENDING') {
          await resumeTask(taskId);
        }
      }
      setIsPaused(false);
    } catch (error) {
      logger.error('Failed to resume tasks:', error);
    }
  };

  const handleStop = async () => {
    if (!(await confirm({ title: '确定要停止所有任务吗？', type: 'warning' })))
      return;

    try {
      for (const [taskId, progress] of taskProgress.entries()) {
        if (progress.status === 'RUNNING' || progress.status === 'PENDING') {
          await cancelTask(taskId);
        }
      }
      setIsRunning(false);
      setIsPaused(false);
    } catch (error) {
      logger.error('Failed to stop tasks:', error);
    }
  };

  const handleClose = async () => {
    if (isRunning) {
      if (
        !(await confirm({
          title: '任务正在运行中，关闭后任务将继续在后台执行。确定关闭吗？',
          type: 'warning',
        }))
      ) {
        return;
      }
    }
    onClose();
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'RUNNING':
        return <Activity className="h-4 w-4 animate-pulse text-blue-600" />;
      case 'COMPLETED':
        return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
      case 'FAILED':
        return <XCircle className="h-4 w-4 text-red-600" />;
      case 'PENDING':
        return <Clock className="h-4 w-4 text-gray-600" />;
      default:
        return <Activity className="h-4 w-4 text-gray-600" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'RUNNING':
        return 'text-blue-700';
      case 'COMPLETED':
        return 'text-emerald-700';
      case 'FAILED':
        return 'text-red-700';
      case 'PENDING':
        return 'text-gray-700';
      default:
        return 'text-gray-700';
    }
  };

  // 计算总体统计
  const totalStats = {
    total: taskProgress.size,
    running: Array.from(taskProgress.values()).filter(
      (t) => t.status === 'RUNNING'
    ).length,
    completed: Array.from(taskProgress.values()).filter(
      (t) => t.status === 'COMPLETED'
    ).length,
    failed: Array.from(taskProgress.values()).filter(
      (t) => t.status === 'FAILED'
    ).length,
    totalItems: Array.from(taskProgress.values()).reduce(
      (sum, t) => sum + t.totalItems,
      0
    ),
    successItems: Array.from(taskProgress.values()).reduce(
      (sum, t) => sum + t.successItems,
      0
    ),
    failedItems: Array.from(taskProgress.values()).reduce(
      (sum, t) => sum + t.failedItems,
      0
    ),
    duplicateItems: Array.from(taskProgress.values()).reduce(
      (sum, t) => sum + t.duplicateItems,
      0
    ),
  };

  if (!isOpen) return null;

  return (
    <>
      {/* 背景遮罩 */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={handleClose} />

      {/* 侧边抽屉 */}
      <div className="fixed bottom-0 right-0 top-0 z-50 flex w-[60%] flex-col bg-white shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              批量采集 - {categoryName}
            </h2>
            <p className="mt-1 text-sm text-gray-500">选择数据源并开始采集</p>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 控制按钮区 */}
        <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={handleRun}
                disabled={isRunning || selectedSources.size === 0}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Play className="h-4 w-4" />
                开始采集
              </button>

              {isRunning && !isPaused && (
                <button
                  onClick={handlePause}
                  className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Pause className="h-4 w-4" />
                  暂停
                </button>
              )}

              {isPaused && (
                <button
                  onClick={handleResume}
                  className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Play className="h-4 w-4" />
                  继续
                </button>
              )}

              {isRunning && (
                <button
                  onClick={handleStop}
                  className="flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                >
                  <Square className="h-4 w-4" />
                  停止
                </button>
              )}
            </div>

            {taskProgress.size > 0 && (
              <div className="flex items-center gap-4 text-sm">
                <span className="text-gray-600">
                  已采集:{' '}
                  <span className="font-semibold text-emerald-600">
                    {totalStats.successItems}
                  </span>
                </span>
                <span className="text-gray-600">
                  失败:{' '}
                  <span className="font-semibold text-red-600">
                    {totalStats.failedItems}
                  </span>
                </span>
                <span className="text-gray-600">
                  重复:{' '}
                  <span className="font-semibold text-amber-600">
                    {totalStats.duplicateItems}
                  </span>
                </span>
              </div>
            )}
          </div>
        </div>

        {/* 主内容区 - 分栏布局 */}
        <div className="flex flex-1 overflow-hidden">
          {/* 左侧：数据源选择 */}
          <div className="flex w-2/5 flex-col border-r border-gray-200">
            <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">
                  数据源选择
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={selectAll}
                    className="text-xs text-blue-600 hover:text-blue-700"
                  >
                    全选
                  </button>
                  <span className="text-gray-300">|</span>
                  <button
                    onClick={deselectAll}
                    className="text-xs text-gray-600 hover:text-gray-700"
                  >
                    清空
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-500">
                已选择 {selectedSources.size} / {sources.length} 个数据源
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="space-y-2">
                {sources.map((source) => (
                  <label
                    key={source.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-all ${
                      selectedSources.has(source.id)
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    } ${source.status !== 'ACTIVE' ? 'cursor-not-allowed opacity-50' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSources.has(source.id)}
                      onChange={() => toggleSource(source.id)}
                      disabled={source.status !== 'ACTIVE'}
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">
                          {source.name}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            source.status === 'ACTIVE'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {source.status}
                        </span>
                      </div>
                      {source.description && (
                        <p className="mt-1 text-xs text-gray-500">
                          {source.description}
                        </p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* 右侧：进度显示 */}
          <div className="flex flex-1 flex-col">
            <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
              <h3 className="text-sm font-semibold text-gray-900">采集进度</h3>
              <p className="mt-1 text-xs text-gray-500">
                {taskProgress.size === 0
                  ? '点击"开始采集"后将显示实时进度'
                  : `${totalStats.completed} / ${totalStats.total} 完成`}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {taskProgress.size === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <Activity className="mb-3 h-12 w-12 text-gray-300" />
                  <p className="text-sm text-gray-500">
                    选择数据源后点击"开始采集"
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {Array.from(taskProgress.values()).map((progress) => (
                    <div
                      key={progress.id}
                      className="rounded-lg border border-gray-200 p-4"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(progress.status)}
                          <span className="text-sm font-medium text-gray-900">
                            {progress.sourceName}
                          </span>
                        </div>
                        <span
                          className={`text-xs font-medium ${getStatusColor(progress.status)}`}
                        >
                          {progress.status}
                        </span>
                      </div>

                      {/* 进度条 */}
                      <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                        <div
                          className={`h-full transition-all ${
                            progress.status === 'COMPLETED'
                              ? 'bg-emerald-500'
                              : progress.status === 'FAILED'
                                ? 'bg-red-500'
                                : 'bg-blue-500'
                          }`}
                          style={{ width: `${progress.progress}%` }}
                        />
                      </div>

                      {/* 统计信息 */}
                      <div className="grid grid-cols-4 gap-2 text-xs">
                        <div>
                          <span className="text-gray-500">进度</span>
                          <div className="font-semibold text-gray-900">
                            {progress.progress}%
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-500">成功</span>
                          <div className="font-semibold text-emerald-600">
                            {progress.successItems}
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-500">失败</span>
                          <div className="font-semibold text-red-600">
                            {progress.failedItems}
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-500">重复</span>
                          <div className="font-semibold text-amber-600">
                            {progress.duplicateItems}
                          </div>
                        </div>
                      </div>

                      {/* Error message for failed tasks */}
                      {progress.status === 'FAILED' &&
                        progress.errorMessage && (
                          <div className="mt-2 flex items-start gap-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
                            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                            <span>{progress.errorMessage}</span>
                          </div>
                        )}

                      {/* Special message when all items are duplicates */}
                      {progress.status === 'COMPLETED' &&
                        progress.successItems === 0 &&
                        progress.duplicateItems > 0 && (
                          <div className="mt-2 flex items-center gap-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">
                            <AlertCircle className="h-3 w-3" />
                            <span>
                              All {progress.duplicateItems} items already exist
                              (deduplicated)
                            </span>
                          </div>
                        )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
