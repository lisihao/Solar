/**
 * useGoogleDrive - Google Drive 连接管理 Hook
 *
 * 功能：
 * 1. OAuth 连接管理
 * 2. 连接状态监控
 * 3. 断开连接
 * 4. 同步触发
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useApiGet, useApiDelete, useApiPost } from '../core';
import type { ApiError } from '@/lib/api/client';
import { logger } from '@/lib/utils/logger';
import {
  getConnections,
  disconnectGoogleDrive as disconnectApi,
  getConnectUrl as getConnectUrlApi,
  triggerSync as triggerSyncApi,
  getSyncStatus as getSyncStatusApi,
  type GoogleDriveConnection,
  type SyncStatus,
} from '@/services/google-drive/api';

// ==================== 类型定义 ====================

export interface UseGoogleDriveOptions {
  /** 是否立即加载 */
  immediate?: boolean;
  /** 自动刷新间隔（毫秒） */
  refreshInterval?: number;
  /** 连接 ID（如果只关注单个连接） */
  connectionId?: string;
}

export interface UseGoogleDriveResult {
  // 连接状态
  connections: GoogleDriveConnection[];
  connection: GoogleDriveConnection | null;
  isConnected: boolean;
  isConnecting: boolean;

  // 加载状态
  loading: boolean;
  error: ApiError | null;

  // 同步状态
  syncStatus: SyncStatus | null;
  isSyncing: boolean;

  // 操作方法
  connect: () => Promise<void>;
  disconnect: (connectionId: string) => Promise<void>;
  refresh: () => Promise<void>;
  triggerSync: (connectionId?: string, fullSync?: boolean) => Promise<void>;

  // 辅助方法
  getConnectionById: (id: string) => GoogleDriveConnection | undefined;
}

// ==================== Hook 实现 ====================

/**
 * Google Drive 连接管理 Hook
 */
export function useGoogleDrive(
  options: UseGoogleDriveOptions = {}
): UseGoogleDriveResult {
  const { immediate = true, refreshInterval, connectionId } = options;

  // 获取连接列表
  const {
    data: connectionsData,
    loading: connectionsLoading,
    error: connectionsError,
    execute: fetchConnections,
  } = useApiGet<{ connections: GoogleDriveConnection[] }>(
    '/google-drive/connections',
    {
      immediate,
      cacheKey: 'google-drive-connections',
      cacheTTL: 1 * 60 * 1000, // 1分钟缓存
    }
  );

  // 获取同步状态
  const {
    data: syncStatusData,
    loading: syncStatusLoading,
    execute: fetchSyncStatus,
  } = useApiGet<{ status: SyncStatus[] }>(
    connectionId
      ? `/google-drive/sync/status?connectionId=${connectionId}`
      : '/google-drive/sync/status',
    {
      immediate,
      cacheKey: connectionId
        ? `google-drive-sync-status-${connectionId}`
        : 'google-drive-sync-status',
      cacheTTL: 30 * 1000, // 30秒缓存
    }
  );

  // 断开连接
  const { execute: disconnectExecute, loading: disconnecting } = useApiDelete(
    '/google-drive/disconnect'
  );

  // 触发同步
  const { execute: syncExecute, loading: syncing } =
    useApiPost('/google-drive/sync');

  // 计算派生状态
  const connections = useMemo(
    () => connectionsData?.connections ?? [],
    [connectionsData]
  );

  const connection = useMemo(() => {
    if (!connectionId) return connections[0] || null;
    return connections.find((c) => c.id === connectionId) || null;
  }, [connections, connectionId]);

  const isConnected = connections.length > 0;

  const syncStatus = useMemo(() => {
    if (!syncStatusData?.status) return null;
    if (connectionId) {
      return (
        syncStatusData.status.find((s) => s.connectionId === connectionId) ||
        null
      );
    }
    return syncStatusData.status[0] || null;
  }, [syncStatusData, connectionId]);

  const isSyncing = syncStatus?.isSyncing ?? syncing;

  // 连接到 Google Drive
  const connect = useCallback(async () => {
    try {
      const { url } = await getConnectUrlApi();
      window.location.href = url;
    } catch (error) {
      logger.error('Failed to get connect URL:', error);
      throw error;
    }
  }, []);

  // 断开连接
  const disconnect = useCallback(
    async (id: string) => {
      try {
        await disconnectApi(id);
        await fetchConnections();
      } catch (error) {
        logger.error('Failed to disconnect:', error);
        throw error;
      }
    },
    [fetchConnections]
  );

  // 刷新数据
  const refresh = useCallback(async () => {
    await Promise.all([fetchConnections(), fetchSyncStatus()]);
  }, [fetchConnections, fetchSyncStatus]);

  // 触发同步
  const triggerSync = useCallback(
    async (targetConnectionId?: string, fullSync = false) => {
      try {
        await triggerSyncApi(targetConnectionId, fullSync);
        // 等待一下让服务器更新状态
        await new Promise((resolve) => setTimeout(resolve, 500));
        await fetchSyncStatus();
      } catch (error) {
        logger.error('Failed to trigger sync:', error);
        throw error;
      }
    },
    [fetchSyncStatus]
  );

  // 获取指定连接
  const getConnectionById = useCallback(
    (id: string) => connections.find((c) => c.id === id),
    [connections]
  );

  // 自动刷新
  useEffect(() => {
    if (!refreshInterval || !immediate) return;

    const timer = setInterval(() => {
      refresh();
    }, refreshInterval);

    return () => clearInterval(timer);
  }, [refreshInterval, immediate, refresh]);

  return {
    // 连接状态
    connections,
    connection,
    isConnected,
    isConnecting: disconnecting,

    // 加载状态
    loading: connectionsLoading || syncStatusLoading,
    error: connectionsError,

    // 同步状态
    syncStatus,
    isSyncing,

    // 操作方法
    connect,
    disconnect,
    refresh,
    triggerSync,

    // 辅助方法
    getConnectionById,
  };
}

// ==================== 导出类型 ====================

export type { GoogleDriveConnection, SyncStatus };
