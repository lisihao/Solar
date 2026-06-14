'use client';

import { useEffect, useState } from 'react';
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronLeft,
  Home,
  Check,
  Loader2,
  AlertCircle,
  FileText,
  FileSpreadsheet,
  FileImage,
  File,
} from 'lucide-react';
import { logger } from '@/lib/utils/logger';
import {
  useGoogleDriveFolders,
  type GoogleDriveFolder,
  type GoogleDriveFile,
} from '@/hooks/domain/useKnowledgeBase';
import { EmptyState } from '@/components/ui/states/EmptyState';

// Helper function to get file icon based on mime type
function getFileIcon(mimeType: string) {
  if (mimeType.includes('document') || mimeType.includes('text')) {
    return FileText;
  }
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
    return FileSpreadsheet;
  }
  if (mimeType.includes('image')) {
    return FileImage;
  }
  return File;
}

// Helper function to format file size
function formatFileSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface GoogleDriveFolderPickerProps {
  selectedFolderIds: string[];
  selectedFileIds?: string[];
  onSelectionChange: (
    folderIds: string[],
    folderNames: string[],
    fileIds?: string[],
    fileNames?: string[]
  ) => void;
  disabled?: boolean;
}

/**
 * Google Drive 文件夹和文件选择器
 * 支持多选文件夹和文件，用于知识库同步
 */
export default function GoogleDriveFolderPicker({
  selectedFolderIds,
  selectedFileIds = [],
  onSelectionChange,
  disabled = false,
}: GoogleDriveFolderPickerProps) {
  const {
    folders,
    files,
    loading,
    error,
    parentStack,
    fetchFolders,
    navigateToFolder,
    navigateBack,
    navigateToRoot,
  } = useGoogleDriveFolders();

  // 保存选中文件夹的名称映射
  const [selectedFolderNames, setSelectedFolderNames] = useState<
    Map<string, string>
  >(new Map());

  // 保存选中文件的名称映射
  const [selectedFileNames, setSelectedFileNames] = useState<
    Map<string, string>
  >(new Map());

  // 初始加载
  useEffect(() => {
    logger.debug('[GDrivePicker] Initial load, fetching folders...');
    fetchFolders().then((data) => {
      logger.debug('[GDrivePicker] Fetched:', {
        foldersCount: data?.folders?.length,
        filesCount: data?.files?.length,
      });
    });
  }, [fetchFolders]);

  // 同步 props 和内部状态 - 当 selectedFolderIds 从 props 变化时
  useEffect(() => {
    // 如果 props 中没有选择的文件夹，清空内部状态
    if (selectedFolderIds.length === 0) {
      setSelectedFolderNames(new Map());
    } else {
      // 从 folders 列表中查找名称并同步
      const newNamesMap = new Map<string, string>();
      selectedFolderIds.forEach((id) => {
        const folder = folders.find((f) => f.id === id);
        if (folder) {
          newNamesMap.set(id, folder.name);
        }
      });
      // 只有当有匹配到的文件夹时才更新，否则保持现有状态
      if (newNamesMap.size > 0) {
        setSelectedFolderNames(newNamesMap);
      }
    }
  }, [selectedFolderIds, folders]);

  // 同步 selectedFileIds 和 selectedFileNames
  useEffect(() => {
    if (selectedFileIds.length === 0) {
      setSelectedFileNames(new Map());
    } else {
      const newNamesMap = new Map<string, string>();
      selectedFileIds.forEach((id) => {
        const file = files.find((f) => f.id === id);
        if (file) {
          newNamesMap.set(id, file.name);
        }
      });
      if (newNamesMap.size > 0) {
        setSelectedFileNames(newNamesMap);
      }
    }
  }, [selectedFileIds, files]);

  // Debug: log current state
  logger.debug('[GDrivePicker] Current state', {
    foldersCount: folders.length,
    filesCount: files.length,
    selectedFolderIds,
    selectedFileIds,
  });

  const toggleFolderSelection = (folder: GoogleDriveFolder) => {
    if (disabled) return;

    const newSelectedIds = [...selectedFolderIds];
    const newNamesMap = new Map(selectedFolderNames);

    const index = newSelectedIds.indexOf(folder.id);
    if (index > -1) {
      // 取消选择
      newSelectedIds.splice(index, 1);
      newNamesMap.delete(folder.id);
    } else {
      // 添加选择
      newSelectedIds.push(folder.id);
      newNamesMap.set(folder.id, folder.name);
    }

    setSelectedFolderNames(newNamesMap);
    onSelectionChange(
      newSelectedIds,
      Array.from(newNamesMap.values()),
      selectedFileIds,
      Array.from(selectedFileNames.values())
    );
  };

  const toggleFileSelection = (file: GoogleDriveFile) => {
    if (disabled) return;

    const newSelectedIds = [...selectedFileIds];
    const newNamesMap = new Map(selectedFileNames);

    const index = newSelectedIds.indexOf(file.id);
    if (index > -1) {
      // 取消选择
      newSelectedIds.splice(index, 1);
      newNamesMap.delete(file.id);
    } else {
      // 添加选择
      newSelectedIds.push(file.id);
      newNamesMap.set(file.id, file.name);
    }

    setSelectedFileNames(newNamesMap);
    onSelectionChange(
      selectedFolderIds,
      Array.from(selectedFolderNames.values()),
      newSelectedIds,
      Array.from(newNamesMap.values())
    );
  };

  const handleFolderDoubleClick = (folder: GoogleDriveFolder) => {
    if (disabled || loading) return;
    navigateToFolder(folder);
  };

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="flex items-center gap-2 text-red-700">
          <AlertCircle className="h-5 w-5" />
          <span className="text-sm">
            {error.message.includes('No Google Drive connection')
              ? '请先在「资源库 → Google Drive」中连接您的 Google 账号'
              : `加载文件夹失败: ${error.message}`}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      {/* 导航栏 */}
      <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
        <button
          type="button"
          onClick={navigateToRoot}
          disabled={loading || disabled || parentStack.length === 0}
          className="rounded p-1 text-gray-600 hover:bg-gray-200 disabled:opacity-50"
          title="返回根目录"
        >
          <Home className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={navigateBack}
          disabled={loading || disabled || parentStack.length === 0}
          className="rounded p-1 text-gray-600 hover:bg-gray-200 disabled:opacity-50"
          title="返回上级"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex flex-1 items-center gap-1 overflow-x-auto text-sm text-gray-600">
          <span className="font-medium text-gray-900">我的云端硬盘</span>
          {parentStack.map((item, index) => (
            <span key={item.id} className="flex items-center">
              <ChevronRight className="h-4 w-4 text-gray-400" />
              <span
                className={
                  index === parentStack.length - 1
                    ? 'font-medium text-gray-900'
                    : ''
                }
              >
                {item.name}
              </span>
            </span>
          ))}
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
      </div>

      {/* 文件夹和文件列表 */}
      <div className="max-h-80 min-h-[160px] overflow-y-auto p-2">
        {loading && folders.length === 0 && files.length === 0 ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          </div>
        ) : folders.length === 0 && files.length === 0 ? (
          <EmptyState title="此目录为空" size="sm" />
        ) : (
          <div className="grid gap-1">
            {/* 文件夹列表 */}
            {folders.map((folder) => {
              const isSelected = selectedFolderIds.includes(folder.id);
              return (
                <div
                  key={folder.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-all ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-transparent hover:bg-gray-50'
                  } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
                  onClick={() => toggleFolderSelection(folder)}
                  onDoubleClick={() => handleFolderDoubleClick(folder)}
                >
                  {/* 选择框 */}
                  <div
                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${
                      isSelected
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-gray-300 bg-white'
                    }`}
                  >
                    {isSelected && <Check className="h-3.5 w-3.5" />}
                  </div>

                  {/* 文件夹图标 */}
                  {isSelected ? (
                    <FolderOpen className="h-5 w-5 flex-shrink-0 text-blue-600" />
                  ) : (
                    <Folder className="h-5 w-5 flex-shrink-0 text-yellow-500" />
                  )}

                  {/* 文件夹信息 */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {folder.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {folder.fileCount > 0
                        ? `${folder.fileCount} 个文件`
                        : '空文件夹'}
                    </p>
                  </div>

                  {/* 进入按钮 */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleFolderDoubleClick(folder);
                    }}
                    disabled={loading || disabled}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
                    title="进入文件夹"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              );
            })}

            {/* 文件列表 (可选择) */}
            {files.length > 0 && (
              <>
                {folders.length > 0 && (
                  <div className="my-2 border-t border-gray-200" />
                )}
                <p className="px-2 text-xs font-medium text-gray-500">
                  文件 ({files.length})
                </p>
                {files.map((file) => {
                  const FileIcon = getFileIcon(file.mimeType);
                  const isSelected = selectedFileIds.includes(file.id);
                  return (
                    <div
                      key={file.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-all ${
                        isSelected
                          ? 'border-green-500 bg-green-50'
                          : 'border-transparent hover:bg-gray-50'
                      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
                      onClick={() => toggleFileSelection(file)}
                    >
                      {/* 选择框 */}
                      <div
                        className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${
                          isSelected
                            ? 'border-green-600 bg-green-600 text-white'
                            : 'border-gray-300 bg-white'
                        }`}
                      >
                        {isSelected && <Check className="h-3.5 w-3.5" />}
                      </div>

                      {/* 文件图标 */}
                      <FileIcon
                        className={`h-5 w-5 flex-shrink-0 ${isSelected ? 'text-green-600' : 'text-gray-400'}`}
                      />

                      {/* 文件信息 */}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-gray-700">
                          {file.name}
                        </p>
                        {file.size && (
                          <p className="text-xs text-gray-400">
                            {formatFileSize(file.size)}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>

      {/* 选中提示 */}
      {(selectedFolderIds.length > 0 || selectedFileIds.length > 0) && (
        <div className="border-t border-gray-200 bg-gray-50 px-3 py-2">
          <p className="text-xs text-gray-600">
            已选择{' '}
            {selectedFolderIds.length > 0 && (
              <span className="text-blue-600">
                {selectedFolderIds.length} 个文件夹
                {selectedFolderNames.size > 0 && (
                  <span className="ml-1 text-gray-500">
                    ({Array.from(selectedFolderNames.values()).join(', ')})
                  </span>
                )}
              </span>
            )}
            {selectedFolderIds.length > 0 && selectedFileIds.length > 0 && '，'}
            {selectedFileIds.length > 0 && (
              <span className="text-green-600">
                {selectedFileIds.length} 个文件
                {selectedFileNames.size > 0 && (
                  <span className="ml-1 text-gray-500">
                    ({Array.from(selectedFileNames.values()).join(', ')})
                  </span>
                )}
              </span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
