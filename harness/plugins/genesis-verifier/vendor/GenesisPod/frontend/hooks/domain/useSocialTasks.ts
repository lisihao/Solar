/**
 * useSocialTasks — 列任务（cursor 分页）
 * useSocialTask  — 单任务详情（含 sources + versions）
 *
 * GET /api/v1/ai-social/tasks
 * GET /api/v1/ai-social/tasks/:id
 */

import useSWR from 'swr';
import {
  cancelSocialTask,
  createSocialTask,
  getSocialTask,
  listSocialTasks,
} from '@/services/ai-social/task-api';
import type {
  CreateSocialTaskInput,
  SocialContentTask,
  SocialContentTaskListResult,
} from '@/services/ai-social/task-types';

export function useSocialTasks(opts?: {
  status?: string;
  limit?: number;
  refreshIntervalMs?: number;
}) {
  const key = ['ai-social', 'tasks', opts?.status ?? '', opts?.limit ?? 20];
  const { data, error, isLoading, mutate } = useSWR<SocialContentTaskListResult>(
    key,
    () => listSocialTasks({ status: opts?.status, limit: opts?.limit }),
    {
      refreshInterval: opts?.refreshIntervalMs ?? 5000,
      revalidateOnFocus: false,
    },
  );

  return {
    tasks: data?.items ?? [],
    nextCursor: data?.nextCursor,
    error,
    isLoading,
    refresh: mutate,
  };
}

export function useSocialTask(taskId: string | null, opts?: {
  refreshIntervalMs?: number;
}) {
  const { data, error, isLoading, mutate } = useSWR<SocialContentTask>(
    taskId ? ['ai-social', 'task', taskId] : null,
    () => getSocialTask(taskId!),
    {
      refreshInterval: opts?.refreshIntervalMs ?? 3000,
      revalidateOnFocus: false,
    },
  );

  return {
    task: data ?? null,
    error,
    isLoading,
    refresh: mutate,
  };
}

export async function createTaskAndRefresh(
  input: CreateSocialTaskInput,
  refresh?: () => void,
): Promise<{ id: string }> {
  const result = await createSocialTask(input);
  refresh?.();
  return result;
}

export async function cancelTaskAndRefresh(
  taskId: string,
  refresh?: () => void,
): Promise<void> {
  await cancelSocialTask(taskId);
  refresh?.();
}
