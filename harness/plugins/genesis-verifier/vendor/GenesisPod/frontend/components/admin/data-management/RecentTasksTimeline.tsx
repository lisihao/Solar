'use client';

import React from 'react';
import { CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

interface RecentTask {
  id: string;
  url: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  createdAt: string;
  error: string | null;
}

interface RecentTasksTimelineProps {
  tasks: RecentTask[];
  isLoading: boolean;
  isError: boolean;
}

const statusConfig = {
  SUCCESS: {
    icon: CheckCircle,
    color: 'text-green-500',
    bgColor: 'bg-green-100',
  },
  FAILED: {
    icon: XCircle,
    color: 'text-red-500',
    bgColor: 'bg-red-100',
  },
  PENDING: {
    icon: Clock,
    color: 'text-gray-500',
    bgColor: 'bg-gray-100',
  },
  PROCESSING: {
    icon: Loader2,
    color: 'text-blue-500',
    bgColor: 'bg-blue-100',
  },
  CANCELLED: {
    icon: XCircle,
    color: 'text-gray-500',
    bgColor: 'bg-gray-100',
  },
};

export function RecentTasksTimeline({
  tasks,
  isLoading,
  isError,
}: RecentTasksTimelineProps) {
  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center text-gray-500">
        <Loader2 className="mr-2 h-6 w-6 animate-spin" />
        加载最近任务...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-48 items-center justify-center text-red-500">
        <XCircle className="mr-2 h-6 w-6" />
        加载最近任务失败
      </div>
    );
  }

  if (!tasks || tasks.length === 0) {
    return (
      <div className="py-12 text-center text-gray-500">
        <p>暂无最近任务</p>
      </div>
    );
  }

  return (
    <div className="flow-root">
      <ul role="list" className="-mb-8">
        {tasks.map((task, taskIdx) => {
          const config = statusConfig[task.status] || statusConfig.PENDING;
          const Icon = config.icon;

          return (
            <li key={task.id}>
              <div className="relative pb-8">
                {taskIdx !== tasks.length - 1 ? (
                  <span
                    className="absolute left-4 top-4 -ml-px h-full w-0.5 bg-gray-200"
                    aria-hidden="true"
                  />
                ) : null}
                <div className="relative flex space-x-3">
                  <div>
                    <span
                      className={`${config.bgColor} ${config.color} flex h-8 w-8 items-center justify-center rounded-full ring-8 ring-white`}
                    >
                      <Icon
                        className={`h-5 w-5 ${
                          task.status === 'PROCESSING' ? 'animate-spin' : ''
                        }`}
                        aria-hidden="true"
                      />
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-1 justify-between space-x-4 pt-1.5">
                    <div>
                      <p className="truncate text-sm text-gray-500">
                        <span className="font-medium text-gray-900">
                          {task.status === 'SUCCESS'
                            ? '采集成功'
                            : task.status === 'FAILED'
                              ? '采集失败'
                              : '等待处理'}
                        </span>{' '}
                        - {task.url}
                      </p>
                      {task.status === 'FAILED' && task.error && (
                        <p className="mt-1 text-xs text-red-600">
                          原因: {task.error}
                        </p>
                      )}
                    </div>
                    <div className="whitespace-nowrap text-right text-sm text-gray-500">
                      <time dateTime={task.createdAt}>
                        {formatDistanceToNow(new Date(task.createdAt), {
                          addSuffix: true,
                          locale: ko,
                        })}
                      </time>
                    </div>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
