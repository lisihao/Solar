'use client';

import { useState } from 'react';
import {
  FileText,
  Folder,
  Image,
  FileVideo,
  FileAudio,
  File,
} from 'lucide-react';
import type { GoogleDriveFile } from '@/services/google-drive/api';
import { formatDateSafe } from '@/lib/utils/date';

interface GoogleDriveFileCardProps {
  file: GoogleDriveFile;
  isSelected: boolean;
  onSelect: (fileId: string) => void;
  onNavigate?: (folderId: string) => void;
}

/**
 * Google Drive 文件卡片组件
 * 显示单个文件或文件夹，支持选择和导航
 */
export function GoogleDriveFileCard({
  file,
  isSelected,
  onSelect,
  onNavigate,
}: GoogleDriveFileCardProps) {
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
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;

    return formatDateSafe(dateStr, 'date');
  };

  // 处理点击
  const handleClick = (e: React.MouseEvent) => {
    // 如果点击的是 checkbox，不处理
    if ((e.target as HTMLElement).closest('input[type="checkbox"]')) {
      return;
    }

    if (file.isFolder && onNavigate) {
      onNavigate(file.driveFileId);
    } else {
      // 打开 Google Drive 链接
      window.open(file.webViewLink, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div
      onClick={handleClick}
      className={`group relative cursor-pointer rounded-xl border bg-white p-4 transition-all hover:border-gray-300 hover:shadow-md ${
        isSelected
          ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-400 ring-opacity-20'
          : 'border-gray-200'
      }`}
    >
      {/* 选择框 */}
      <div className="absolute right-3 top-3 z-10">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => {
            e.stopPropagation();
            onSelect(file.id);
          }}
          className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 transition-colors focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        />
      </div>

      {/* 缩略图或图标 */}
      <div className="mb-3 flex items-center justify-center">
        {file.thumbnailUrl && !imageError ? (
          <img
            src={file.thumbnailUrl}
            alt={file.name}
            onError={() => setImageError(true)}
            className="h-24 w-full rounded-lg object-cover"
          />
        ) : file.iconUrl && !imageError && !file.isFolder ? (
          <img
            src={file.iconUrl}
            alt={file.name}
            onError={() => setImageError(true)}
            className="h-12 w-12"
          />
        ) : (
          <div className="flex h-24 w-full items-center justify-center rounded-lg bg-gray-50">
            {getFileIcon()}
          </div>
        )}
      </div>

      {/* 文件信息 */}
      <div className="space-y-2">
        <h3
          className={`line-clamp-2 text-sm font-medium ${
            file.isFolder
              ? 'text-blue-700 group-hover:text-blue-800'
              : 'text-gray-900 group-hover:text-blue-600'
          }`}
          title={file.name}
        >
          {file.name}
        </h3>

        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{file.isFolder ? 'Folder' : formatSize(file.size)}</span>
          <span>{formatDate(file.driveModifiedAt)}</span>
        </div>

        {/* 同步状态标识 */}
        {file.syncStatus && (
          <div className="flex items-center gap-1">
            {file.syncStatus === 'SYNCING' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
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
              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 8 8">
                  <circle cx="4" cy="4" r="3" />
                </svg>
                Imported
              </span>
            )}
            {file.syncStatus === 'FAILED' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                Failed
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
