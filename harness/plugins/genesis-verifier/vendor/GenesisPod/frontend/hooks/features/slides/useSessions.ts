/**
 * Slides Engine - Sessions Hook
 *
 * 从后端加载、管理用户的会话列表
 */

import { useCallback, useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { config } from '@/lib/utils/config';
import type { SlidesSession } from '@/lib/types/slides';

import { logger } from '@/lib/utils/logger';
const API_BASE = config.apiUrl || '';
const API_OFFICE_BASE = `${API_BASE}/ai-office/slides`;

/**
 * Get auth headers for API requests
 */
function getAuthHeaders(accessToken: string | null): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  return headers;
}

export interface SessionWithCheckpoint extends SlidesSession {
  latestCheckpoint?: {
    id: string;
    type: string;
    timestamp: Date;
    pagesCount: number;
  } | null;
}

interface UseSessionsOptions {
  autoLoad?: boolean;
  status?: 'active' | 'completed' | 'archived';
  limit?: number;
}

export function useSessions(options: UseSessionsOptions = {}) {
  const { autoLoad = true, status, limit = 50 } = options;
  const { user, accessToken } = useAuth();
  const [sessions, setSessions] = useState<SessionWithCheckpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Memoize auth headers
  const authHeaders = useMemo(() => getAuthHeaders(accessToken), [accessToken]);

  /**
   * 从后端加载会话列表
   */
  const loadSessions = useCallback(async () => {
    if (!user?.id) {
      logger.warn('[useSessions] No user ID');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (status) {
        params.append('status', status);
      }
      if (limit) {
        params.append('limit', limit.toString());
      }

      const response = await fetch(
        `${API_BASE}/ai-office/slides/sessions?${params.toString()}`,
        { headers: authHeaders }
      );

      if (!response.ok) {
        throw new Error('Failed to load sessions');
      }

      const result = await response.json();
      // Handle wrapped response { success: true, data: {...} }
      const data = result?.data ?? result;

      // 转换日期字段
      const sessionsData = (data?.sessions || []).map(
        (
          session: SlidesSession & {
            latestCheckpoint?: {
              id: string;
              type: string;
              timestamp: string | Date;
              pagesCount: number;
            } | null;
          }
        ) => ({
          ...session,
          createdAt: new Date(session.createdAt),
          updatedAt: new Date(session.updatedAt),
          latestCheckpoint: session.latestCheckpoint
            ? {
                ...session.latestCheckpoint,
                timestamp: new Date(session.latestCheckpoint.timestamp),
              }
            : null,
        })
      );

      setSessions(sessionsData);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : '加载会话列表失败';
      setError(errorMessage);
      logger.error('[useSessions] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id, status, limit, authHeaders]);

  /**
   * 刷新会话列表
   */
  const refresh = useCallback(() => {
    return loadSessions();
  }, [loadSessions]);

  /**
   * 更新会话标题
   */
  const updateSession = useCallback(
    async (sessionId: string, title: string): Promise<boolean> => {
      try {
        const response = await fetch(
          `${API_OFFICE_BASE}/sessions/${sessionId}`,
          {
            method: 'PATCH',
            headers: authHeaders,
            body: JSON.stringify({ title }),
          }
        );

        if (!response.ok) {
          throw new Error('Failed to update session');
        }

        // 更新本地状态
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, title } : s))
        );

        return true;
      } catch (err) {
        logger.error('[useSessions] Update error:', err);
        setError(err instanceof Error ? err.message : '更新会话失败');
        return false;
      }
    },
    [authHeaders]
  );

  /**
   * 删除会话
   */
  const deleteSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      try {
        const response = await fetch(
          `${API_OFFICE_BASE}/sessions/${sessionId}`,
          {
            method: 'DELETE',
            headers: authHeaders,
          }
        );

        if (!response.ok) {
          throw new Error('Failed to delete session');
        }

        // 从本地状态移除
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));

        return true;
      } catch (err) {
        logger.error('[useSessions] Delete error:', err);
        setError(err instanceof Error ? err.message : '删除会话失败');
        return false;
      }
    },
    [authHeaders]
  );

  // 自动加载
  useEffect(() => {
    if (autoLoad && user?.id) {
      loadSessions();
    }
  }, [autoLoad, user?.id, loadSessions]);

  return {
    sessions,
    loading,
    error,
    loadSessions,
    refresh,
    updateSession,
    deleteSession,
  };
}

export default useSessions;
