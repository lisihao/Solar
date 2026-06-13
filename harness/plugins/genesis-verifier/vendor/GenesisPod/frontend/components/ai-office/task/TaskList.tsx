'use client';

/**
 * 任务列表组件 - Genspark风格
 * 显示所有AI Office任务，支持点击恢复上下文
 */

import React, { useState } from 'react';
import { useTaskStore, Task } from '@/stores/aiOfficeStore';
import { confirm } from '@/stores';
import { EmptyState } from '@/components/ui/states/EmptyState';
import {
  ListTodo,
  FileText,
  Presentation,
  FileSearch,
  BarChart,
  Clock,
  RefreshCw,
  Trash2,
  X,
  ChevronRight,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { zhCN, enUS } from 'date-fns/locale';
import { useTranslation } from '@/lib/i18n';

// 任务类型图标映射
const TASK_TYPE_ICONS: Record<Task['type'], React.ElementType> = {
  article: FileText,
  ppt: Presentation,
  summary: FileSearch,
  analysis: BarChart,
};

export default function TaskList() {
  const { t, locale } = useTranslation();
  const tasks = useTaskStore((state) => state.tasks);
  const currentTaskId = useTaskStore((state) => state.currentTaskId);
  const isTaskListOpen = useTaskStore((state) => state.isTaskListOpen);
  const toggleTaskList = useTaskStore((state) => state.toggleTaskList);
  const restoreTaskContext = useTaskStore((state) => state.restoreTaskContext);
  const deleteTask = useTaskStore((state) => state.deleteTask);

  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);

  // Get the date-fns locale based on current language
  const dateLocale = locale === 'zh' ? zhCN : enUS;

  // Get task type name from translation
  const getTaskTypeName = (type: Task['type']) => {
    return t(`aiOffice.taskList.types.${type}`);
  };

  if (!isTaskListOpen) {
    return null;
  }

  const handleTaskClick = (task: Task) => {
    restoreTaskContext(task._id);
  };

  const handleDeleteTask = async (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation(); // 阻止触发任务点击
    if (
      await confirm({
        title: t('aiOffice.taskList.deleteConfirm'),
        type: 'danger',
      })
    ) {
      deleteTask(taskId);
    }
  };

  return (
    <div className="fixed bottom-0 right-0 top-0 z-40 flex w-96 flex-col border-l border-gray-200 bg-white shadow-2xl">
      {/* 头部 */}
      <div className="flex-shrink-0 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="rounded-lg bg-blue-600 p-2">
              <ListTodo className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                {t('aiOffice.taskList.title')}
              </h2>
              <p className="text-xs text-gray-500">
                {t('aiOffice.taskList.total', { count: tasks.length })}
              </p>
            </div>
          </div>
          <button
            onClick={toggleTaskList}
            className="rounded-lg p-2 transition-colors hover:bg-white/50"
          >
            <X className="h-5 w-5 text-gray-600" />
          </button>
        </div>
      </div>

      {/* 任务列表 */}
      <div className="flex-1 overflow-y-auto">
        {tasks.length === 0 ? (
          <EmptyState
            icon={<ListTodo className="h-10 w-10" />}
            title={t('aiOffice.taskList.empty.title')}
            description={t('aiOffice.taskList.empty.description')}
          />
        ) : (
          <div className="space-y-3 p-4">
            {tasks.map((task) => {
              const TypeIcon = TASK_TYPE_ICONS[task.type];
              const isHovered = hoveredTaskId === task._id;
              const isCurrent = currentTaskId === task._id;

              // 计算是否最近刷新过（createdAt和refreshedAt不同）
              const hasBeenRefreshed =
                new Date(task.refreshedAt).getTime() !==
                new Date(task.createdAt).getTime();

              return (
                <div
                  key={task._id}
                  onClick={() => handleTaskClick(task)}
                  onMouseEnter={() => setHoveredTaskId(task._id)}
                  onMouseLeave={() => setHoveredTaskId(null)}
                  className={`
                    group relative cursor-pointer rounded-xl p-4 transition-all duration-200
                    ${
                      isCurrent
                        ? 'border-2 border-blue-500 bg-blue-50 shadow-md'
                        : 'border border-gray-200 bg-white hover:border-blue-300 hover:shadow-md'
                    }
                  `}
                >
                  {/* 左侧装饰条 */}
                  {isCurrent && (
                    <div className="absolute bottom-4 left-0 top-4 w-1 rounded-r-full bg-blue-600" />
                  )}

                  <div className="flex items-start space-x-3">
                    {/* 图标 */}
                    <div
                      className={`
                      flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg
                      ${isCurrent ? 'bg-blue-600' : 'bg-gray-100 group-hover:bg-blue-100'}
                    `}
                    >
                      <TypeIcon
                        className={`h-5 w-5 ${
                          isCurrent
                            ? 'text-white'
                            : 'text-gray-600 group-hover:text-blue-600'
                        }`}
                      />
                    </div>

                    {/* 内容 */}
                    <div className="min-w-0 flex-1">
                      {/* 标题 */}
                      <h3
                        className={`
                        mb-1 truncate text-sm font-semibold
                        ${isCurrent ? 'text-blue-900' : 'text-gray-900'}
                      `}
                      >
                        {task.title}
                      </h3>

                      {/* 类型标签 */}
                      <div className="mb-2 flex items-center space-x-2">
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                          {getTaskTypeName(task.type)}
                        </span>
                        {task.metadata.description && (
                          <span className="max-w-[150px] truncate text-xs text-gray-400">
                            {task.metadata.description}
                          </span>
                        )}
                      </div>

                      {/* 时间信息 */}
                      <div className="space-y-1">
                        <div className="flex items-center space-x-1 text-xs text-gray-500">
                          <Clock className="h-3 w-3" />
                          <span>{t('aiOffice.taskList.createdAt')}</span>
                          <span className="font-medium">
                            {formatDistanceToNow(new Date(task.createdAt), {
                              addSuffix: true,
                              locale: dateLocale,
                            })}
                          </span>
                        </div>

                        {hasBeenRefreshed && (
                          <div className="flex items-center space-x-1 text-xs text-blue-600">
                            <RefreshCw className="h-3 w-3" />
                            <span>{t('aiOffice.taskList.refreshedAt')}</span>
                            <span className="font-medium">
                              {formatDistanceToNow(new Date(task.refreshedAt), {
                                addSuffix: true,
                                locale: dateLocale,
                              })}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* 元数据 */}
                      {task.metadata.wordCount && (
                        <div className="mt-2 text-xs text-gray-500">
                          {t('aiOffice.taskList.words', {
                            count: task.metadata.wordCount,
                          })}
                        </div>
                      )}
                    </div>

                    {/* 操作按钮 */}
                    {isHovered && !isCurrent && (
                      <button
                        onClick={(e) => handleDeleteTask(e, task._id)}
                        className="flex-shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}

                    {/* 当前任务指示器 */}
                    {isCurrent && (
                      <div className="flex-shrink-0">
                        <ChevronRight className="h-5 w-5 text-blue-600" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
