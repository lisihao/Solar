'use client';

import { useState, useCallback } from 'react';
import { Cloud, Loader2, AlertCircle, MessageSquare } from 'lucide-react';
import { OrganizeChatMode } from '@/components/library/OrganizeChatMode';
import { useGoogleDrive } from '@/hooks/domain';
import { useGoogleDriveImport } from '@/hooks/domain/useGoogleDriveImport';
import { GoogleDriveFileBrowser } from './GoogleDriveFileBrowser';
import {
  SyncControls,
  type SyncDirection,
} from '@/components/common/sync/SyncControls';
import {
  ConflictResolver,
  type SyncConflict,
} from '@/components/common/sync/ConflictResolver';
import {
  syncBidirectional,
  resolveConflict,
} from '@/services/google-drive/api';
import { formatDateSafe } from '@/lib/utils/date';
import { LoadingState } from '@/components/ui/states';

import { logger } from '@/lib/utils/logger';
import { Alert } from '@/components/ui/feedback/Alert';
import { confirm } from '@/stores';
/**
 * Google Drive TAB 主内容组件
 * 检查连接状态，显示连接引导或文件浏览器
 */
export default function GoogleDriveTabContent() {
  const [showSettings, setShowSettings] = useState(false);
  // 数据源统一整理：Drive 对话整理浮层开关
  const [organizeChatOpen, setOrganizeChatOpen] = useState(false);
  const [importStatus, setImportStatus] = useState<{
    show: boolean;
    message: string;
    type: 'success' | 'error' | 'info';
  }>({ show: false, message: '', type: 'info' });
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);

  const {
    connections,
    connection,
    isConnected,
    loading,
    error,
    connect,
    disconnect,
    refresh,
    triggerSync,
    isSyncing,
    syncStatus,
  } = useGoogleDrive({
    immediate: true,
    refreshInterval: 30000, // 30秒自动刷新
  });

  // 使用临时 ID 来满足 hook 规则，实际会在有连接时被覆盖
  const importHook = useGoogleDriveImport({
    connectionId: connection?.id || 'temp',
    onComplete: (progress) => {
      const successCount = progress.successCount;
      const failedCount = progress.failedCount;
      setImportStatus({
        show: true,
        message:
          failedCount > 0
            ? `Imported ${successCount} files. ${failedCount} failed.`
            : `Successfully imported ${successCount} file${successCount !== 1 ? 's' : ''}`,
        type: failedCount > 0 ? 'error' : 'success',
      });
    },
    onError: (err) => {
      setImportStatus({
        show: true,
        message: err.message || 'Failed to import files',
        type: 'error',
      });
    },
  });

  // 处理连接
  const handleConnect = async () => {
    try {
      await connect();
    } catch (err) {
      logger.error('Failed to connect:', err);
    }
  };

  // 处理断开连接
  const handleDisconnect = async (connectionId: string) => {
    if (
      !(await confirm({
        title: 'Are you sure you want to disconnect Google Drive?',
        type: 'danger',
      }))
    ) {
      return;
    }

    try {
      await disconnect(connectionId);
      await refresh();
    } catch (err) {
      logger.error('Failed to disconnect:', err);
    }
  };

  // 处理同步（使用双向同步 API）
  const handleSync = async (direction: SyncDirection) => {
    try {
      const apiDirection =
        direction === 'push'
          ? 'export'
          : direction === 'pull'
            ? 'import'
            : undefined;
      const result = await syncBidirectional(apiDirection);

      // 检查是否有冲突
      if (result.conflicts && result.conflicts.length > 0) {
        setConflicts(
          result.conflicts.map((c) => ({
            id: c.fileId,
            fileName: c.fileName,
            localModifiedAt: c.localModified,
            remoteModifiedAt: c.remoteModified,
          }))
        );
      }

      setImportStatus({
        show: true,
        message:
          result.message ||
          `Synced: ${result.imported} imported, ${result.exported} exported`,
        type: result.success ? 'success' : 'error',
      });

      // 刷新连接状态
      await refresh();

      setTimeout(
        () => setImportStatus({ show: false, message: '', type: 'info' }),
        3000
      );
    } catch (err) {
      setImportStatus({
        show: true,
        message: err instanceof Error ? err.message : 'Failed to sync',
        type: 'error',
      });
    }
  };

  // 处理冲突解决
  const handleResolveConflict = async (
    conflictId: string,
    resolution: 'keep_local' | 'keep_remote'
  ) => {
    try {
      await resolveConflict(conflictId, resolution);
      setConflicts((prev) => prev.filter((c) => c.id !== conflictId));
      setImportStatus({
        show: true,
        message: 'Conflict resolved successfully',
        type: 'success',
      });
      setTimeout(
        () => setImportStatus({ show: false, message: '', type: 'info' }),
        3000
      );
    } catch (err) {
      setImportStatus({
        show: true,
        message:
          err instanceof Error ? err.message : 'Failed to resolve conflict',
        type: 'error',
      });
    }
  };

  // 处理导入文件
  const handleImportFiles = useCallback(
    async (fileIds: string[]) => {
      if (!connection) return;

      try {
        // 首先选择文件
        importHook.selectAll(fileIds);

        // 然后执行导入
        await importHook.importFiles({
          includeMetadata: true,
          generateSummary: true,
          extractText: true,
        });
      } catch (err) {
        setImportStatus({
          show: true,
          message:
            err instanceof Error ? err.message : 'Failed to import files',
          type: 'error',
        });
      }
    },
    [importHook, connection]
  );

  // 格式化日期
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return formatDateSafe(dateStr, 'datetime');
  };

  // 格式化文件大小
  const formatSize = (bytes: number | null | undefined) => {
    if (bytes === null || bytes === undefined || isNaN(bytes) || bytes === 0) {
      return '0 B';
    }
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    if (i < 0 || i >= sizes.length) return '0 B';
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  if (loading) {
    return <LoadingState />;
  }

  // 没有连接时显示连接界面
  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 py-20">
        <Cloud className="h-16 w-16 text-gray-400" />
        <h3 className="mt-4 text-lg font-medium text-gray-900">
          Connect your Google Drive
        </h3>
        <p className="mt-1 max-w-md text-center text-gray-500">
          Access and import your Google Drive files to Genesis. Your files will
          appear here after connecting.
        </p>
        <button
          onClick={handleConnect}
          className="mt-6 flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-white transition-colors hover:bg-blue-700"
        >
          <Cloud className="h-5 w-5" />
          Connect Google Drive
        </button>
        {error && (
          <p className="mt-3 text-sm text-red-600">
            {error.message || 'Connection failed'}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 状态提示 */}
      {importStatus.show && (
        <Alert
          tone={
            importStatus.type === 'success'
              ? 'success'
              : importStatus.type === 'error'
                ? 'error'
                : 'info'
          }
          onClose={() =>
            setImportStatus({ show: false, message: '', type: 'info' })
          }
        >
          {importStatus.message}
        </Alert>
      )}

      {/* 连接信息头部 */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between p-4">
          {/* 左侧：账户信息 */}
          <div className="flex items-center gap-4">
            {connections.map((conn) => (
              <div key={conn.id} className="flex items-center gap-3">
                {/* 用户头像 */}
                <div className="relative">
                  {conn.photoUrl ? (
                    <img
                      src={conn.photoUrl}
                      alt={conn.displayName || conn.email}
                      className="h-10 w-10 rounded-full border-2 border-white shadow-sm"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500 text-white">
                      {(conn.displayName || conn.email).charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${
                      conn.status === 'ACTIVE'
                        ? 'bg-green-500'
                        : conn.status === 'ERROR'
                          ? 'bg-red-500'
                          : 'bg-yellow-500'
                    }`}
                  />
                </div>

                {/* 账户信息 */}
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-gray-900">
                    {conn.displayName || 'Google Drive'}
                  </span>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>{conn.email}</span>
                    <span>·</span>
                    <span>{conn.filesCount ?? 0} files</span>
                    <span>·</span>
                    <span>{formatSize(conn.totalSize ?? 0)}</span>
                    {isSyncing && (
                      <>
                        <span>·</span>
                        <span className="flex items-center text-blue-600">
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          Syncing...
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* 右侧：同步控件和设置 */}
          <div className="flex items-center gap-3">
            {/* 数据源统一整理：Drive 文件对话整理 */}
            <button
              onClick={() => setOrganizeChatOpen(true)}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-50"
            >
              <MessageSquare className="h-4 w-4" />
              对话整理
            </button>
            <SyncControls
              status={
                isSyncing
                  ? 'syncing'
                  : connection?.status === 'ACTIVE'
                    ? 'synced'
                    : 'error'
              }
              lastSyncAt={connection?.lastSyncAt}
              pendingChanges={syncStatus?.pendingChanges}
              onSync={handleSync}
              disabled={!connection}
              showDirectionButtons={true}
            />
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`rounded-lg p-2 transition-colors ${
                showSettings
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
              }`}
            >
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* 设置面板 */}
        {showSettings && (
          <div className="border-t border-gray-100">
            <div className="divide-y divide-gray-100">
              {connections.map((conn) => (
                <div
                  key={conn.id}
                  className="flex items-center justify-between px-4 py-4"
                >
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-gray-900">
                      {conn.displayName || conn.email}
                    </div>
                    <div className="text-xs text-gray-500">
                      Last synced: {formatDate(conn.lastSyncAt)}
                    </div>
                    {conn.lastError && (
                      <div className="flex items-center gap-1 text-xs text-red-600">
                        <AlertCircle className="h-3 w-3" />
                        {conn.lastError}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleDisconnect(conn.id)}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
                  >
                    Disconnect
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 冲突解决面板 */}
      {conflicts.length > 0 && (
        <ConflictResolver
          conflicts={conflicts}
          onResolve={handleResolveConflict}
          onDismiss={() => setConflicts([])}
        />
      )}

      {/* 文件浏览器：仅连接正常时拉文件；ERROR/失效时不渲染（停止反复 400 轮询）+ 引导重连 */}
      {connection && connection.status === 'ACTIVE' ? (
        <GoogleDriveFileBrowser
          connectionId={connection.id}
          onImport={handleImportFiles}
        />
      ) : connection ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-red-200 bg-red-50/40 py-16">
          <AlertCircle className="h-12 w-12 text-red-500" />
          <h3 className="mt-3 text-base font-medium text-gray-900">
            Google Drive 连接已失效
          </h3>
          <p className="mt-1 max-w-md text-center text-sm text-gray-500">
            {connection.lastError ||
              '授权已过期或被撤销，暂时无法读取文件。请重新授权后继续。'}
          </p>
          <button
            onClick={handleConnect}
            className="mt-5 flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            <Cloud className="h-4 w-4" />
            重新授权
          </button>
        </div>
      ) : null}

      {/* 导入进度指示 */}
      {importHook.importing && connection && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 shadow-lg">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-blue-900">
                Importing files...
              </span>
              {importHook.progress && (
                <span className="text-xs text-blue-700">
                  {importHook.progressPercent}% (
                  {importHook.progress.processedFiles}/
                  {importHook.progress.totalFiles})
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 数据源统一整理：Google Drive 文件对话整理浮层 */}
      <OrganizeChatMode
        open={organizeChatOpen}
        onClose={() => setOrganizeChatOpen(false)}
        itemType="DRIVE"
      />
    </div>
  );
}
