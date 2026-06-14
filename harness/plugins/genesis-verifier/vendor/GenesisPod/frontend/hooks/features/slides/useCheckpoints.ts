/**
 * Slides Engine - 检查点 Hook
 *
 * 管理检查点操作，包括：
 * - 获取检查点列表
 * - 恢复检查点
 * - 删除检查点
 */

import { useCallback, useState, useMemo } from 'react';
import { useSlidesStore } from '@/stores';
import { useAuth } from '@/contexts/AuthContext';
import { config } from '@/lib/utils/config';
import type {
  Checkpoint,
  CheckpointState,
  SourceSubscription,
} from '@/lib/types/slides';
import { logger } from '@/lib/utils/logger';

const API_BASE = config.apiUrl || '';

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

interface UseCheckpointsOptions {
  onRestoreSuccess?: (checkpointId: string) => void;
  onRestoreError?: (error: string) => void;
}

export function useCheckpoints(options: UseCheckpointsOptions = {}) {
  const { accessToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // Memoize auth headers
  const authHeaders = useMemo(() => getAuthHeaders(accessToken), [accessToken]);

  const {
    session,
    checkpoints,
    currentCheckpointId,
    setCheckpoints,
    setCurrentCheckpointId,
    setCheckpointsLoading,
    restoreFromCheckpointState,
    setError,
  } = useSlidesStore();

  /**
   * 获取会话的检查点列表
   */
  const fetchCheckpoints = useCallback(
    async (sessionId?: string) => {
      const targetSessionId = sessionId || session?.id;
      if (!targetSessionId) {
        logger.warn('No session ID provided');
        return;
      }

      setLoading(true);
      setCheckpointsLoading(true);

      try {
        const response = await fetch(
          `${API_BASE}/ai-office/slides/sessions/${targetSessionId}/checkpoints`,
          { headers: authHeaders }
        );

        if (!response.ok) {
          throw new Error('Failed to fetch checkpoints');
        }

        const result = await response.json();
        // Handle wrapped response { success: true, data: {...} }
        const data = result?.data ?? result;
        setCheckpoints(data?.checkpoints || []);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : '获取检查点失败';
        setError(errorMessage);
      } finally {
        setLoading(false);
        setCheckpointsLoading(false);
      }
    },
    [session?.id, setCheckpoints, setCheckpointsLoading, setError, authHeaders]
  );

  /**
   * 恢复到指定检查点
   */
  const restoreCheckpoint = useCallback(
    async (checkpointId: string) => {
      setRestoring(true);

      try {
        // 先获取检查点详情
        const detailResponse = await fetch(
          `${API_BASE}/ai-office/slides/checkpoints/${checkpointId}`,
          { headers: authHeaders }
        );

        if (!detailResponse.ok) {
          throw new Error('Failed to fetch checkpoint details');
        }

        const detailResult = await detailResponse.json();
        // Handle wrapped response { success: true, data: {...} }
        const detailData = detailResult?.data ?? detailResult;
        const checkpointState: CheckpointState = detailData.state;

        // ★ DIAGNOSTIC: Log checkpoint state for debugging
        logger.debug('[restoreCheckpoint] ★ Raw detailResult:', detailResult);
        logger.debug(
          '[restoreCheckpoint] ★ detailData keys:',
          Object.keys(detailData || {})
        );
        logger.debug('[restoreCheckpoint] ★ checkpointState:', {
          hasPages: !!checkpointState?.pages,
          pagesLength: checkpointState?.pages?.length,
          pagesType: typeof checkpointState?.pages,
          hasOutlinePlan: !!checkpointState?.outlinePlan,
          stateKeys: Object.keys(checkpointState || {}),
        });

        // 调用恢复 API
        const restoreResponse = await fetch(
          `${API_BASE}/ai-office/slides/restore/${checkpointId}`,
          { method: 'POST', headers: authHeaders }
        );

        if (!restoreResponse.ok) {
          throw new Error('Failed to restore checkpoint');
        }

        // 获取恢复 API 返回的 sessionId 和 sessionTitle
        const restoreResult = await restoreResponse.json();
        // Handle wrapped response { success: true, data: {...} }
        const restoreData = restoreResult?.data ?? restoreResult;
        const restoredSessionId = restoreData.sessionId || checkpointId;
        const sessionTitle =
          restoreData.sessionTitle ||
          (checkpointState.outlinePlan as { title?: string } | null)?.title ||
          '已恢复的演示文稿';

        // 更新本地状态
        restoreFromCheckpointState(checkpointState);
        setCurrentCheckpointId(checkpointId);

        // 设置 session - 使用正确的 sessionId（从 API 返回）
        const { setSession } = useSlidesStore.getState();
        setSession({
          id: restoredSessionId, // 使用真正的 sessionId
          userId: 'user',
          title: sessionTitle,
          status: 'active',
          currentCheckpointId: checkpointId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        logger.debug('[restoreCheckpoint] Restored pages:', {
          totalPages: checkpointState.pages?.length,
          pagesWithHtml: checkpointState.pages?.filter((p) => p.html).length,
        });

        options.onRestoreSuccess?.(checkpointId);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : '恢复检查点失败';
        setError(errorMessage);
        options.onRestoreError?.(errorMessage);
        // 重新抛出错误，让调用方可以处理
        throw err;
      } finally {
        setRestoring(false);
      }
    },
    [
      restoreFromCheckpointState,
      setCurrentCheckpointId,
      setError,
      options,
      authHeaders,
    ]
  );

  /**
   * 通过会话 ID 恢复
   * 自动获取会话的最新检查点并恢复
   */
  const restoreBySessionId = useCallback(
    async (sessionId: string) => {
      setRestoring(true);

      try {
        // 获取会话详情
        const sessionResponse = await fetch(
          `${API_BASE}/ai-office/slides/sessions/${sessionId}`,
          { headers: authHeaders }
        );

        if (!sessionResponse.ok) {
          throw new Error('Failed to fetch session details');
        }

        const sessionResult = await sessionResponse.json();
        // Handle wrapped response { success: true, data: {...} }
        const sessionData = sessionResult?.data ?? sessionResult;

        if (!sessionData.latestCheckpoint?.id) {
          throw new Error('Session has no checkpoints');
        }

        // 获取检查点详情
        const detailResponse = await fetch(
          `${API_BASE}/ai-office/slides/checkpoints/${sessionData.latestCheckpoint.id}`,
          { headers: authHeaders }
        );

        if (!detailResponse.ok) {
          throw new Error('Failed to fetch checkpoint details');
        }

        const detailResult = await detailResponse.json();
        // Handle wrapped response { success: true, data: {...} }
        const detailData = detailResult?.data ?? detailResult;
        const checkpointState: CheckpointState = detailData.state;

        // ★ DIAGNOSTIC: Log checkpoint state for debugging
        logger.debug('[restoreBySessionId] ★ Raw detailResult:', detailResult);
        logger.debug(
          '[restoreBySessionId] ★ detailData keys:',
          Object.keys(detailData || {})
        );
        logger.debug('[restoreBySessionId] ★ checkpointState:', {
          hasPages: !!checkpointState?.pages,
          pagesLength: checkpointState?.pages?.length,
          pagesType: typeof checkpointState?.pages,
          hasOutlinePlan: !!checkpointState?.outlinePlan,
          stateKeys: Object.keys(checkpointState || {}),
        });

        // 调用恢复 API
        const restoreResponse = await fetch(
          `${API_BASE}/ai-office/slides/restore/${sessionData.latestCheckpoint.id}`,
          { method: 'POST', headers: authHeaders }
        );

        if (!restoreResponse.ok) {
          throw new Error('Failed to restore checkpoint');
        }

        // 更新本地状态
        restoreFromCheckpointState(checkpointState);
        setCurrentCheckpointId(sessionData.latestCheckpoint.id);

        // 更新会话信息 - 转换日期
        // sourceSubscription 从后端根级别返回（与 session 平级），需手动合并
        const { setSession } = useSlidesStore.getState();
        setSession({
          id: sessionData.session.id,
          userId: sessionData.session.userId,
          title: sessionData.session.title,
          status: sessionData.session.status,
          currentCheckpointId: sessionData.session.currentCheckpointId,
          createdAt: new Date(sessionData.session.createdAt),
          updatedAt: new Date(sessionData.session.updatedAt),
          sourceSubscription:
            (sessionData.sourceSubscription as SourceSubscription | null) ??
            null,
        });

        options.onRestoreSuccess?.(sessionData.latestCheckpoint.id);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : '恢复会话失败';
        setError(errorMessage);
        options.onRestoreError?.(errorMessage);
        // 重新抛出错误，让调用方可以处理
        throw err;
      } finally {
        setRestoring(false);
      }
    },
    [
      restoreFromCheckpointState,
      setCurrentCheckpointId,
      setError,
      options,
      authHeaders,
    ]
  );

  /**
   * 清理旧检查点
   */
  const pruneCheckpoints = useCallback(
    async (keepCount: number = 10) => {
      if (!session?.id) {
        logger.warn('No session ID');
        return;
      }

      try {
        const response = await fetch(
          `${API_BASE}/ai-office/slides/sessions/${session.id}/prune?keepCount=${keepCount}`,
          { method: 'POST', headers: authHeaders }
        );

        if (!response.ok) {
          throw new Error('Failed to prune checkpoints');
        }

        const result = await response.json();
        // Handle wrapped response { success: true, data: {...} }
        const data = result?.data ?? result;

        // 刷新检查点列表
        await fetchCheckpoints();

        return data?.prunedCount || 0;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : '清理检查点失败';
        setError(errorMessage);
        return 0;
      }
    },
    [session?.id, fetchCheckpoints, setError, authHeaders]
  );

  /**
   * 获取指定检查点的预览数据
   */
  const getCheckpointPreview = useCallback(
    (checkpointId: string): Checkpoint | null => {
      return checkpoints.find((cp) => cp.id === checkpointId) || null;
    },
    [checkpoints]
  );

  /**
   * 按类型筛选检查点
   */
  const getCheckpointsByType = useCallback(
    (type: Checkpoint['type']): Checkpoint[] => {
      return checkpoints.filter((cp) => cp.type === type);
    },
    [checkpoints]
  );

  /**
   * 手动创建检查点
   */
  const createCheckpoint = useCallback(
    async (name: string) => {
      if (!session?.id) {
        logger.warn('No session ID');
        return;
      }

      try {
        const response = await fetch(
          `${API_BASE}/ai-office/slides/sessions/${session.id}/checkpoints`,
          {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ name, type: 'user_modified' }),
          }
        );

        if (!response.ok) {
          throw new Error('Failed to create checkpoint');
        }

        // 刷新检查点列表
        await fetchCheckpoints();
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : '创建检查点失败';
        setError(errorMessage);
      }
    },
    [session?.id, fetchCheckpoints, setError, authHeaders]
  );

  return {
    // 状态
    checkpoints,
    currentCheckpointId,
    loading,
    restoring,

    // 操作
    fetchCheckpoints,
    restoreCheckpoint,
    restoreBySessionId,
    pruneCheckpoints,
    createCheckpoint,

    // 工具
    getCheckpointPreview,
    getCheckpointsByType,
  };
}

export default useCheckpoints;
