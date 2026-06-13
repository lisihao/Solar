'use client';

import { useState } from 'react';
import {
  FileText,
  Folder,
  Image,
  FileVideo,
  FileAudio,
  File,
  ExternalLink,
  ChevronRight,
} from 'lucide-react';
import type { GoogleDriveFile } from '@/services/google-drive/api';
import { formatDateSafe } from '@/lib/utils/date';

interface GoogleDriveFileRowProps {
  file: GoogleDriveFile;
  isSelected: boolean;
  onSelect: (fileId: string) => void;
  onNavigate?: (folderId: string) => void;
}

/**
 * Google Drive 文件行组件 (列表视图)
 * 显示单个文件或文件夹的列表行
 */
export function GoogleDriveFileRow({
  file,
  isSelected,
  onSelect,
  onNavigate,
}: GoogleDriveFileRowProps) {
  const [imageError, setImageError] = useState(false);

  // 根据 MIME 类型获取图标
  const getFileIcon = () => {
    if (file.isFolder) {
      return <Folder className="h-5 w-5 text-blue-500" />;
    }

    const mimeType = file.mimeType.toLowerCase();

    if (mimeType.startsWith('image/')) {
      return <Image className="h-5 w-5 text-green-500" />;
    }
    if (mimeType.startsWith('video/')) {
      return <FileVideo className="h-5 w-5 text-purple-500" />;
    }
    if (mimeType.startsWith('audio/')) {
      return <FileAudio className="h-5 w-5 text-orange-500" />;
    }
    if (
      mimeType.includes('document') ||
      mimeType.includes('text') ||
      mimeType.includes('pdf')
    ) {
      return <FileText className="h-5 w-5 text-red-500" />;
    }
    return <File className="h-5 w-5 text-gray-500" />;
  };

  // 格式化文件大小
  const formatSize = (bytes: number) => {
    if (bytes === 0) return '-';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  // 格式化日期
  const formatDate = (dateStr: string) => {
    return formatDateSafe(dateStr, 'date');
  };

  // 获取文件类型显示文本
  const getFileType = () => {
    if (file.isFolder) return 'Folder';

    const mimeType = file.mimeType.toLowerCase();
    if (mimeType.includes('pdf')) return 'PDF';
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel'))
      return 'Spreadsheet';
    if (mimeType.includes('document') || mimeType.includes('word'))
      return 'Document';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint'))
      return 'Presentation';
    if (mimeType.startsWith('image/')) return 'Image';
    if (mimeType.startsWith('video/')) return 'Video';
    if (mimeType.startsWith('audio/')) return 'Audio';
    if (mimeType.includes('text')) return 'Text';
    return 'File';
  };

  // 处理行点击
  const handleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('input[type="checkbox"]')) {
      return;
    }
    if ((e.target as HTMLElement).closest('button')) {
      return;
    }

    if (file.isFolder && onNavigate) {
      onNavigate(file.driveFileId);
    } else {
      window.open(file.webViewLink, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div
      onClick={handleClick}
      className={`group flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-all hover:border-gray-300 hover:bg-gray-50 ${
        isSelected ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white'
      }`}
    >
      {/* 选择框 */}
      <input
        type="checkbox"
        checked={isSelected}
        onChange={(e) => {
          e.stopPropagation();
          onSelect(file.id);
        }}
        className="h-4 w-4 flex-shrink-0 cursor-pointer rounded border-gray-300 text-blue-600 transition-colors focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      />

      {/* 图标 */}
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center">
        {file.iconUrl && !imageError && !file.isFolder ? (
          <img
            src={file.iconUrl}
            alt={file.name}
            onError={() => setImageError(true)}
            className="h-6 w-6"
          />
        ) : (
          getFileIcon()
        )}
      </div>

      {/* 文件名 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`truncate text-sm font-medium ${
              file.isFolder
                ? 'text-blue-700 group-hover:text-blue-800'
                : 'text-gray-900 group-hover:text-blue-600'
            }`}
            title={file.name}
          >
            {file.name}
          </span>
          {file.isFolder && (
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-400" />
          )}
        </div>
        {/* 同步状态标识 */}
        {file.syncStatus && (
          <div className="mt-0.5 flex items-center gap-1">
            {file.syncStatus === 'SYNCING' && (
              <span className="inline-flex items-center gap-1 text-xs text-blue-600">
                <svg
                  className="h-3 w-3 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Syncing
              </span>
            )}
            {file.syncStatus === 'SUCCESS' && file.linkedResourceId && (
              <span className="inline-flex items-center gap-1 text-xs text-green-600">
                <svg
                  className="h-2.5 w-2.5"
                  fill="currentColor"
                  viewBox="0 0 8 8"
                >
                  <circle cx="4" cy="4" r="3" />
                </svg>
                Imported
              </span>
            )}
            {file.syncStatus === 'FAILED' && (
              <span className="text-xs text-red-600">Failed</span>
            )}
          </div>
        )}
      </div>

      {/* 文件类型 */}
      <div className="hidden w-24 flex-shrink-0 sm:block">
        <span className="text-sm text-gray-500">{getFileType()}</span>
      </div>

      {/* 文件大小 */}
      <div className="hidden w-20 flex-shrink-0 text-right md:block">
        <span className="text-sm text-gray-500">
          {file.isFolder ? '-' : formatSize(file.size)}
        </span>
      </div>

      {/* 修改日期 */}
      <div className="hidden w-28 flex-shrink-0 text-right lg:block">
        <span className="text-sm text-gray-500">
          {formatDate(file.driveModifiedAt)}
        </span>
      </div>

      {/* 操作按钮 */}
      <div className="flex flex-shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={(e) => {
            e.stopPropagation();
            window.open(file.webViewLink, '_blank', 'noopener,noreferrer');
          }}
          className="rounded-md p-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
          title="Open in Google Drive"
        >
          <ExternalLink className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
