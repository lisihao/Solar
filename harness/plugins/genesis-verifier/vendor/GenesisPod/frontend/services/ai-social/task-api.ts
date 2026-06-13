/**
 * AI Social Task API — 意图驱动重设计 v1
 *
 * 与后端 SocialTaskController + SocialDataSourceController 对接：
 *   POST   /api/v1/ai-social/tasks
 *   GET    /api/v1/ai-social/tasks
 *   GET    /api/v1/ai-social/tasks/:id
 *   DELETE /api/v1/ai-social/tasks/:id
 *   GET    /api/v1/ai-social/data-sources
 *   GET    /api/v1/ai-social/data-sources/:id/items
 *
 * 直接复用 services/ai-social/api.ts 里的 fetchWithAuth；为避免循环引用，
 * 这里复制最小化 auth wrapper。
 */

import { getAuthTokens } from '@/lib/utils/auth';
import type {
  CreateSocialTaskInput,
  SocialContentTask,
  SocialContentTaskListResult,
  SocialDataSourceDescriptor,
  SocialMissionSnapshot,
  SourceListResult,
} from './task-types';

async function fetchJson<T>(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<T> {
  const tokens = getAuthTokens();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers ?? {}) as Record<string, string>),
  };
  if (tokens?.accessToken) {
    headers['Authorization'] = `Bearer ${tokens.accessToken}`;
  }

  const timeout = options.timeout ?? 60000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const text = await response.text();
        if (text) {
          try {
            const parsed = JSON.parse(text) as { message?: string };
            message = parsed.message ?? text;
          } catch {
            message = text;
          }
        }
      } catch {
        // ignore body read error
      }
      throw new Error(message);
    }

    if (response.status === 204) {
      return undefined as T;
    }
    const body = (await response.json()) as unknown;
    // 后端 ResponseTransformInterceptor 把响应包装成 {success, data, metadata}。
    // 这里自动解包：识别到 wrapper 时返回 data；否则原样返回（向后兼容未解包的 endpoint）。
    if (
      body !== null &&
      typeof body === 'object' &&
      'success' in body &&
      'data' in body &&
      typeof (body as { success: unknown }).success === 'boolean'
    ) {
      return (body as { data: T }).data;
    }
    return body as T;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ============== Task endpoints ==============

export function createSocialTask(
  input: CreateSocialTaskInput
): Promise<{ id: string }> {
  return fetchJson<{ id: string }>('/api/v1/ai-social/tasks', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listSocialTasks(opts?: {
  status?: string;
  cursor?: string;
  limit?: number;
}): Promise<SocialContentTaskListResult> {
  const params = new URLSearchParams();
  if (opts?.status) params.set('status', opts.status);
  if (opts?.cursor) params.set('cursor', opts.cursor);
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return fetchJson<SocialContentTaskListResult>(
    `/api/v1/ai-social/tasks${qs ? `?${qs}` : ''}`
  );
}

export function getSocialTask(id: string): Promise<SocialContentTask> {
  return fetchJson<SocialContentTask>(`/api/v1/ai-social/tasks/${id}`);
}

export function cancelSocialTask(id: string): Promise<{ success: boolean }> {
  return fetchJson<{ success: boolean }>(`/api/v1/ai-social/tasks/${id}`, {
    method: 'DELETE',
  });
}

export function retrySocialTask(id: string): Promise<{ id: string }> {
  return fetchJson<{ id: string }>(`/api/v1/ai-social/tasks/${id}/retry`, {
    method: 'POST',
  });
}

/** mission 持久化快照（算力 + 终态）——事件 buffer 过期后回显历史 */
export function getSocialMissionSnapshot(
  id: string
): Promise<SocialMissionSnapshot> {
  return fetchJson<SocialMissionSnapshot>(
    `/api/v1/ai-social/tasks/${id}/mission-snapshot`
  );
}

/** 重命名任务（卡片「编辑」按钮）*/
export function renameSocialTask(
  id: string,
  title: string
): Promise<{ id: string }> {
  return fetchJson<{ id: string }>(`/api/v1/ai-social/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

// ============== Data source endpoints ==============

export function listSocialDataSources(): Promise<{
  items: SocialDataSourceDescriptor[];
}> {
  return fetchJson<{ items: SocialDataSourceDescriptor[] }>(
    '/api/v1/ai-social/data-sources'
  );
}

export function listSocialSourceItems(
  sourceId: string,
  opts?: { search?: string; cursor?: string; limit?: number; tags?: string[] }
): Promise<SourceListResult> {
  const params = new URLSearchParams();
  if (opts?.search) params.set('search', opts.search);
  if (opts?.cursor) params.set('cursor', opts.cursor);
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.tags?.length) params.set('tags', opts.tags.join(','));
  const qs = params.toString();
  return fetchJson<SourceListResult>(
    `/api/v1/ai-social/data-sources/${encodeURIComponent(sourceId)}/items${qs ? `?${qs}` : ''}`
  );
}
