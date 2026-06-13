/**
 * Google Drive 集成 API 客户端
 */

import { apiClient } from '@/lib/api/client';
import { getAuthHeader } from '@/lib/utils/auth';

// ==================== 类型定义 ====================

export interface GoogleDriveConnection {
  id: string;
  email: string;
  displayName: string | null;
  photoUrl: string | null;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'ERROR';
  lastSyncAt: string | null;
  lastError: string | null;
  syncConfig: SyncConfig;
  filesCount: number;
  foldersCount: number;
  totalSize: number;
  createdAt: string;
}

export interface SyncConfig {
  autoSync: boolean;
  syncInterval: number;
  syncOnStartup: boolean;
  includedFolders: string[];
  excludedFolders: string[];
  fileTypes: string[];
  maxFileSize: number;
}

export interface GoogleDriveFile {
  id: string;
  driveFileId: string;
  name: string;
  mimeType: string;
  size: number;
  iconUrl: string | null;
  thumbnailUrl: string | null;
  webViewLink: string;
  webContentLink: string | null;
  parentId: string | null;
  isFolder: boolean;
  description: string | null;
  driveCreatedAt: string;
  driveModifiedAt: string;
  syncStatus: 'PENDING' | 'SYNCING' | 'SUCCESS' | 'FAILED';
  lastSyncedAt: string | null;
  linkedResourceId: string | null;
  connection?: {
    id: string;
    email: string;
    displayName: string | null;
  };
}

export interface ListFilesParams {
  connectionId?: string;
  parentId?: string;
  search?: string;
  mimeType?: string;
  page?: number;
  limit?: number;
  sortBy?: 'name' | 'modifiedTime' | 'createdTime' | 'size';
  sortOrder?: 'asc' | 'desc';
}

export interface ListFilesResponse {
  files: GoogleDriveFile[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  folderPath?: FolderPathItem[];
}

export interface FolderPathItem {
  id: string;
  name: string;
  driveFileId: string;
}

export interface ImportFilesParams {
  connectionId: string;
  fileIds: string[];
  targetFolderId?: string;
  options?: {
    includeMetadata?: boolean;
    generateSummary?: boolean;
    extractText?: boolean;
  };
}

export interface ImportResult {
  success: boolean;
  importId: string;
  totalFiles: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface ImportProgress {
  importId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  totalFiles: number;
  processedFiles: number;
  successCount: number;
  failedCount: number;
  errors: Array<{
    fileId: string;
    fileName: string;
    error: string;
  }>;
  resourceIds: string[];
  startedAt: string;
  completedAt: string | null;
}

export interface ExportParams {
  connectionId: string;
  resourceIds: string[];
  targetFolderId: string;
  format?: 'original' | 'pdf' | 'docx' | 'markdown';
  options?: {
    includeMetadata?: boolean;
    createFolder?: boolean;
    folderName?: string;
  };
}

export interface ExportResult {
  success: boolean;
  exportId: string;
  totalResources: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface ExportProgress {
  exportId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  totalResources: number;
  processedResources: number;
  successCount: number;
  failedCount: number;
  errors: Array<{
    resourceId: string;
    resourceTitle: string;
    error: string;
  }>;
  driveFileIds: string[];
  targetFolderId: string;
  startedAt: string;
  completedAt: string | null;
}

export interface SyncStatus {
  connectionId: string;
  email: string;
  displayName: string | null;
  status: string;
  lastSyncAt: string | null;
  lastError: string | null;
  isSyncing: boolean;
  lastSync: SyncHistory | null;
  pendingChanges?: {
    local: number;
    remote: number;
    conflicts: number;
  };
}

export interface SyncConflict {
  fileId: string;
  fileName: string;
  localModified: string;
  remoteModified: string;
  resourceId: string;
  googleFileId: string;
}

export interface SyncResult {
  success: boolean;
  imported: number;
  exported: number;
  conflicts: SyncConflict[];
  errors: Array<{ fileId: string; error: string }>;
  syncedAt: string;
}

export interface SyncHistory {
  id: string;
  syncType: 'full' | 'incremental' | 'manual';
  status: 'PENDING' | 'SYNCING' | 'SUCCESS' | 'FAILED';
  filesProcessed: number;
  filesCreated: number;
  filesUpdated: number;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  errors: string[] | null;
}

// ==================== 连接管理 ====================

/**
 * 获取 Google OAuth 授权 URL
 */
export async function getConnectUrl(): Promise<{ url: string }> {
  return apiClient.get('/google-drive/connect', {
    headers: getAuthHeader(),
  });
}

/**
 * 完成 OAuth 连接
 */
export async function connectGoogleDrive(
  code: string,
  redirectUri?: string
): Promise<{
  success: boolean;
  connectionId: string;
  email: string;
  message: string;
}> {
  return apiClient.post(
    '/google-drive/connect',
    { code, redirectUri },
    { headers: getAuthHeader() }
  );
}

/**
 * 断开 Google Drive 连接
 */
export async function disconnectGoogleDrive(
  connectionId: string
): Promise<{ success: boolean }> {
  return apiClient.delete(`/google-drive/disconnect/${connectionId}`, {
    headers: getAuthHeader(),
  });
}

/**
 * 获取用户的所有连接
 */
export async function getConnections(): Promise<{
  connections: GoogleDriveConnection[];
}> {
  return apiClient.get('/google-drive/connections', {
    headers: getAuthHeader(),
  });
}

/**
 * 获取连接详情
 */
export async function getConnection(
  connectionId: string
): Promise<{ connection: GoogleDriveConnection }> {
  return apiClient.get(`/google-drive/connections/${connectionId}`, {
    headers: getAuthHeader(),
  });
}

/**
 * 更新连接配置
 */
export async function updateConnection(
  connectionId: string,
  syncConfig: Partial<SyncConfig>
): Promise<{ connection: GoogleDriveConnection }> {
  return apiClient.patch(
    `/google-drive/connections/${connectionId}`,
    { syncConfig },
    { headers: getAuthHeader() }
  );
}

// ==================== 文件操作 ====================

/**
 * 获取文件列表
 */
export async function listFiles(
  params: ListFilesParams
): Promise<ListFilesResponse> {
  const searchParams = new URLSearchParams();
  if (params.connectionId)
    searchParams.append('connectionId', params.connectionId);
  if (params.parentId) searchParams.append('parentId', params.parentId);
  if (params.search) searchParams.append('search', params.search);
  if (params.mimeType) searchParams.append('mimeType', params.mimeType);
  if (params.page) searchParams.append('page', String(params.page));
  if (params.limit) searchParams.append('limit', String(params.limit));
  if (params.sortBy) searchParams.append('sortBy', params.sortBy);
  if (params.sortOrder) searchParams.append('sortOrder', params.sortOrder);

  return apiClient.get(`/google-drive/files?${searchParams.toString()}`, {
    headers: getAuthHeader(),
  });
}

/**
 * 获取文件详情
 */
export async function getFile(
  fileId: string
): Promise<{ file: GoogleDriveFile }> {
  return apiClient.get(`/google-drive/files/${fileId}`, {
    headers: getAuthHeader(),
  });
}

/**
 * 刷新文件（从 Drive 重新同步）
 */
export async function refreshFile(
  fileId: string
): Promise<{ file: GoogleDriveFile }> {
  return apiClient.post(
    `/google-drive/files/${fileId}/refresh`,
    {},
    {
      headers: getAuthHeader(),
    }
  );
}

/**
 * 链接文件到资源
 */
export async function linkToResource(
  fileId: string,
  resourceId: string
): Promise<{ success: boolean }> {
  return apiClient.post(
    `/google-drive/files/${fileId}/link`,
    { resourceId },
    { headers: getAuthHeader() }
  );
}

/**
 * 取消链接
 */
export async function unlinkFromResource(
  fileId: string
): Promise<{ success: boolean }> {
  return apiClient.delete(`/google-drive/files/${fileId}/link`, {
    headers: getAuthHeader(),
  });
}

// ==================== 导入导出 ====================

/**
 * 导入文件到资源库
 */
export async function importFiles(
  params: ImportFilesParams
): Promise<ImportResult> {
  return apiClient.post('/google-drive/import', params, {
    headers: getAuthHeader(),
  });
}

/**
 * 获取导入进度
 */
export async function getImportProgress(
  importId: string
): Promise<{ progress: ImportProgress }> {
  return apiClient.get(`/google-drive/import/${importId}`, {
    headers: getAuthHeader(),
  });
}

/**
 * 导出资源到 Google Drive
 */
export async function exportResources(
  params: ExportParams
): Promise<ExportResult> {
  return apiClient.post('/google-drive/export', params, {
    headers: getAuthHeader(),
  });
}

/**
 * 获取导出进度
 */
export async function getExportProgress(
  exportId: string
): Promise<{ progress: ExportProgress }> {
  return apiClient.get(`/google-drive/export/${exportId}`, {
    headers: getAuthHeader(),
  });
}

// ==================== 同步 ====================

/**
 * 触发同步
 */
export async function triggerSync(
  connectionId?: string,
  fullSync = false
): Promise<{ success: boolean; syncId: string; connectionIds: string[] }> {
  return apiClient.post(
    '/google-drive/sync',
    { connectionId, fullSync },
    { headers: getAuthHeader() }
  );
}

/**
 * 触发双向同步
 */
export async function syncBidirectional(
  direction: 'import' | 'export' | undefined = undefined
): Promise<SyncResult & { message: string }> {
  return apiClient.post(
    '/google-drive/sync',
    { direction },
    { headers: getAuthHeader() }
  );
}

/**
 * 解决同步冲突
 */
export async function resolveConflict(
  conflictId: string,
  resolution: 'keep_local' | 'keep_remote'
): Promise<{ success: boolean; message: string }> {
  return apiClient.post(
    '/google-drive/sync/resolve',
    { conflictId, resolution },
    { headers: getAuthHeader() }
  );
}

/**
 * 链接本地资源到 Google Drive 文件
 */
export async function linkResourceToFile(
  resourceId: string,
  googleFileId: string
): Promise<{ success: boolean; message: string }> {
  return apiClient.post(
    '/google-drive/sync/link',
    { resourceId, googleFileId },
    { headers: getAuthHeader() }
  );
}

/**
 * 取消资源与 Google Drive 的链接
 */
export async function unlinkResourceFromSync(
  resourceId: string
): Promise<{ success: boolean; message: string }> {
  return apiClient.delete(`/google-drive/sync/link/${resourceId}`, {
    headers: getAuthHeader(),
  });
}

/**
 * 获取同步状态
 */
export async function getSyncStatus(
  connectionId?: string
): Promise<{ status: SyncStatus[] }> {
  const params = connectionId ? `?connectionId=${connectionId}` : '';
  return apiClient.get(`/google-drive/sync/status${params}`, {
    headers: getAuthHeader(),
  });
}

/**
 * 获取同步历史
 */
export async function getSyncHistory(
  connectionId: string,
  limit = 10
): Promise<{ history: SyncHistory[] }> {
  return apiClient.get(
    `/google-drive/sync/history/${connectionId}?limit=${limit}`,
    {
      headers: getAuthHeader(),
    }
  );
}

/**
 * 获取集成配置状态
 */
export async function getConfig(): Promise<{
  configured: boolean;
  callbackUrl: string;
}> {
  return apiClient.get('/google-drive/config', {
    headers: getAuthHeader(),
  });
}

// ==================== 默认导出 ====================

export default {
  // 连接管理
  getConnectUrl,
  connectGoogleDrive,
  disconnectGoogleDrive,
  getConnections,
  getConnection,
  updateConnection,
  // 文件操作
  listFiles,
  getFile,
  refreshFile,
  linkToResource,
  unlinkFromResource,
  // 导入导出
  importFiles,
  getImportProgress,
  exportResources,
  getExportProgress,
  // 同步
  triggerSync,
  syncBidirectional,
  resolveConflict,
  linkResourceToFile,
  unlinkResourceFromSync,
  getSyncStatus,
  getSyncHistory,
  getConfig,
};
