'use client';

import { useState } from 'react';
import {
  HardDrive,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import GoogleDriveFolderPicker from './GoogleDriveFolderPicker';
import { useTranslation } from '@/lib/i18n';

import { logger } from '@/lib/utils/logger';
interface GoogleDriveImportPanelProps {
  knowledgeBaseId: string;
  onImportComplete?: (count: number) => void;
}

/**
 * GoogleDriveImportPanel - 从 Google Drive 导入文件到知识库
 */
export default function GoogleDriveImportPanel({
  knowledgeBaseId,
  onImportComplete,
}: GoogleDriveImportPanelProps) {
  const { t } = useTranslation();
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
  const [selectedFolderNames, setSelectedFolderNames] = useState<string[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [selectedFileNames, setSelectedFileNames] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    count: number;
    message: string;
  } | null>(null);

  const handleSelectionChange = (
    folderIds: string[],
    folderNames: string[],
    fileIds?: string[],
    fileNames?: string[]
  ) => {
    setSelectedFolderIds(folderIds);
    setSelectedFolderNames(folderNames);
    if (fileIds !== undefined) {
      setSelectedFileIds(fileIds);
    }
    if (fileNames !== undefined) {
      setSelectedFileNames(fileNames);
    }
    // Clear previous results
    setError(null);
    setSuccess(null);
  };

  const handleImport = async () => {
    if (selectedFolderIds.length === 0 && selectedFileIds.length === 0) {
      setError('请至少选择一个文件夹或文件');
      return;
    }

    setImporting(true);
    setError(null);
    setSuccess(null);

    try {
      // Build resources array for the API
      const resources = [
        ...selectedFileIds.map((id, index) => ({
          sourceType: 'google_drive',
          sourceId: id,
          title: selectedFileNames[index] || `Google Drive 文件 ${id}`,
        })),
      ];

      // For folders, we need to add them to the KB's folder list and trigger sync
      if (selectedFolderIds.length > 0) {
        // Update KB with folder IDs
        const updateResponse = await fetch(
          `${config.apiUrl}/rag/knowledge-bases/${knowledgeBaseId}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              ...getAuthHeader(),
            },
            body: JSON.stringify({
              googleDriveFolderIds: selectedFolderIds,
            }),
          }
        );

        if (!updateResponse.ok) {
          const errorData = await updateResponse.json().catch(() => ({}));
          throw new Error(errorData.message || '添加文件夹失败');
        }
      }

      // Add individual files via add-resources endpoint
      if (resources.length > 0) {
        const addResponse = await fetch(
          `${config.apiUrl}/rag/knowledge-bases/${knowledgeBaseId}/add-resources`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...getAuthHeader(),
            },
            body: JSON.stringify({ resources }),
          }
        );

        if (!addResponse.ok) {
          const errorData = await addResponse.json().catch(() => ({}));
          throw new Error(errorData.message || '导入文件失败');
        }
      }

      // Trigger sync to fetch content
      const syncResponse = await fetch(
        `${config.apiUrl}/rag/knowledge-bases/${knowledgeBaseId}/sync`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeader(),
          },
        }
      );

      if (!syncResponse.ok) {
        // Sync failure is not critical, content will be synced later
        logger.warn('Sync failed, content will be synced later');
      }

      const totalCount = selectedFolderIds.length + selectedFileIds.length;
      setSuccess({
        count: totalCount,
        message: `成功添加 ${selectedFolderIds.length > 0 ? `${selectedFolderIds.length} 个文件夹` : ''}${selectedFolderIds.length > 0 && selectedFileIds.length > 0 ? '和 ' : ''}${selectedFileIds.length > 0 ? `${selectedFileIds.length} 个文件` : ''}`,
      });

      // Clear selection
      setSelectedFolderIds([]);
      setSelectedFolderNames([]);
      setSelectedFileIds([]);
      setSelectedFileNames([]);

      onImportComplete?.(totalCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败，请重试');
    } finally {
      setImporting(false);
    }
  };

  const hasSelection =
    selectedFolderIds.length > 0 || selectedFileIds.length > 0;

  return (
    <div className="space-y-4">
      {/* Google Drive 文件选择器 */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">
            选择要导入的文件夹或文件
          </label>
          <span className="text-xs text-gray-500">(单击选择，双击进入)</span>
        </div>
        <GoogleDriveFolderPicker
          selectedFolderIds={selectedFolderIds}
          selectedFileIds={selectedFileIds}
          onSelectionChange={handleSelectionChange}
          disabled={importing}
        />
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* 成功提示 */}
      {success && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-green-700">
          <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
          <span className="text-sm">{success.message}</span>
        </div>
      )}

      {/* 导入按钮 */}
      <div className="flex items-center justify-between">
        <a
          href="/me/integrations"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          管理 Google Drive 连接
        </a>
        <button
          onClick={handleImport}
          disabled={!hasSelection || importing}
          className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
        >
          {importing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              导入中...
            </>
          ) : (
            <>
              <HardDrive className="h-4 w-4" />
              导入到知识库
            </>
          )}
        </button>
      </div>

      {/* 说明 */}
      <div className="rounded-lg border border-green-200 bg-green-50 p-3">
        <div className="flex items-start gap-2">
          <HardDrive className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600" />
          <div className="text-sm text-green-800">
            <p className="font-medium">Google Drive 导入说明</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs">
              <li>支持导入文件夹（会同步文件夹内所有文档）</li>
              <li>支持导入单个文件（Docs、Sheets、PDF 等）</li>
              <li>导入后会自动同步内容并向量化</li>
              <li>后续文件变更会在知识库同步时自动更新</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
