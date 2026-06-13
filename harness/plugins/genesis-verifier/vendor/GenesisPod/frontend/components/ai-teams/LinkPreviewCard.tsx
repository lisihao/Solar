'use client';

import { useState } from 'react';
import type { ParsedUrl } from '@/services/ai-teams/api';

interface LinkPreviewCardProps {
  preview: ParsedUrl;
  onRemove?: () => void;
  compact?: boolean;
}

/**
 * 链接预览卡片组件
 */
export function LinkPreviewCard({
  preview,
  onRemove,
  compact = false,
}: LinkPreviewCardProps) {
  const [imageError, setImageError] = useState(false);

  // 加载中状态
  if (preview.status === 'parsing') {
    return (
      <div className="animate-pulse rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded bg-gray-200" />
          <div className="h-3 w-24 rounded bg-gray-200" />
        </div>
        <div className="mt-2 h-4 w-3/4 rounded bg-gray-200" />
        <div className="mt-1 h-3 w-full rounded bg-gray-200" />
      </div>
    );
  }

  // 失败状态
  if (preview.status === 'failed') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-red-600">
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="text-xs">Failed to load preview</span>
          </div>
          {onRemove && (
            <button
              onClick={onRemove}
              className="text-red-400 hover:text-red-600"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>
        <a
          href={preview.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 block truncate text-xs text-red-500 hover:underline"
        >
          {preview.url}
        </a>
        {preview.error && (
          <p className="mt-1 text-xs text-red-400">{preview.error}</p>
        )}
      </div>
    );
  }

  // 获取类型图标
  const getTypeIcon = () => {
    switch (preview.type) {
      case 'IMAGE':
        return (
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        );
      case 'VIDEO':
        return (
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        );
      case 'CODE_REPO':
        return (
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <path
              fillRule="evenodd"
              d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
              clipRule="evenodd"
            />
          </svg>
        );
      case 'DOCUMENT':
        return (
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        );
      default:
        return (
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
            />
          </svg>
        );
    }
  };

  // 紧凑模式
  if (compact) {
    return (
      <div className="group flex items-center gap-2 rounded-md border border-gray-200 bg-white p-2 transition-colors hover:border-gray-300">
        {/* Favicon / Type Icon */}
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-gray-100 text-gray-500">
          {preview.preview.favicon && !imageError ? (
            <img
              src={preview.preview.favicon}
              alt=""
              className="h-4 w-4"
              onError={() => setImageError(true)}
            />
          ) : (
            getTypeIcon()
          )}
        </div>

        {/* Title & Site */}
        <div className="min-w-0 flex-1">
          <a
            href={preview.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-sm font-medium text-gray-900 hover:text-blue-600"
          >
            {preview.preview.title || preview.url}
          </a>
          {preview.preview.siteName && (
            <span className="text-xs text-gray-500">
              {preview.preview.siteName}
            </span>
          )}
        </div>

        {/* Remove Button */}
        {onRemove && (
          <button
            onClick={onRemove}
            className="flex-shrink-0 text-gray-400 opacity-0 transition-opacity hover:text-gray-600 group-hover:opacity-100"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>
    );
  }

  // 完整模式
  return (
    <div className="group overflow-hidden rounded-lg border border-gray-200 bg-white transition-shadow hover:shadow-md">
      {/* Preview Image */}
      {preview.preview.image && preview.type !== 'IMAGE' && !imageError && (
        <div className="relative aspect-video w-full overflow-hidden bg-gray-100">
          <img
            src={preview.preview.image}
            alt={preview.preview.title || ''}
            className="h-full w-full object-cover"
            onError={() => setImageError(true)}
          />
          {/* Video play icon overlay */}
          {preview.type === 'VIDEO' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 shadow-lg">
                <svg
                  className="h-6 w-6 text-gray-800"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Image type - show image directly */}
      {preview.type === 'IMAGE' && (
        <div className="relative aspect-video w-full overflow-hidden bg-gray-100">
          <img
            src={preview.url}
            alt={preview.preview.title || 'Image'}
            className="h-full w-full object-contain"
            onError={() => setImageError(true)}
          />
        </div>
      )}

      {/* Content */}
      <div className="p-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            {preview.preview.favicon ? (
              <img
                src={preview.preview.favicon}
                alt=""
                className="h-4 w-4"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <span className="text-gray-400">{getTypeIcon()}</span>
            )}
            <span>
              {preview.preview.siteName || new URL(preview.url).hostname}
            </span>
            {preview.platform && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
                {preview.platform}
              </span>
            )}
          </div>

          {onRemove && (
            <button
              onClick={onRemove}
              className="flex-shrink-0 text-gray-400 opacity-0 transition-opacity hover:text-gray-600 group-hover:opacity-100"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>

        {/* Title */}
        <a
          href={preview.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 block"
        >
          <h4 className="line-clamp-2 font-medium text-gray-900 hover:text-blue-600">
            {preview.preview.title || preview.url}
          </h4>
        </a>

        {/* Description */}
        {preview.preview.description && (
          <p className="mt-1 line-clamp-2 text-sm text-gray-600">
            {preview.preview.description}
          </p>
        )}

        {/* Author */}
        {preview.preview.author && (
          <p className="mt-2 text-xs text-gray-500">
            By {preview.preview.author}
          </p>
        )}

        {/* Metadata for specific types */}
        {preview.extractedContent?.metadata && (
          <div className="mt-2 flex flex-wrap gap-2">
            {preview.extractedContent.metadata.stars !== undefined && (
              <span className="flex items-center gap-1 text-xs text-gray-500">
                <svg
                  className="h-3 w-3"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                {(
                  preview.extractedContent.metadata.stars as number
                ).toLocaleString()}
              </span>
            )}
            {typeof preview.extractedContent.metadata.language === 'string' && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                {preview.extractedContent.metadata.language}
              </span>
            )}
            {preview.extractedContent.metadata.duration !== undefined && (
              <span className="text-xs text-gray-500">
                {formatDuration(
                  preview.extractedContent.metadata.duration as number
                )}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 链接预览列表组件
 */
export function LinkPreviewList({
  previews,
  onRemove,
  compact = false,
  maxVisible = 3,
}: {
  previews: ParsedUrl[];
  onRemove?: (url: string) => void;
  compact?: boolean;
  maxVisible?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  if (previews.length === 0) return null;

  const visiblePreviews = expanded ? previews : previews.slice(0, maxVisible);
  const hiddenCount = previews.length - maxVisible;

  return (
    <div className="space-y-2">
      {/* Header */}
      {previews.length > 1 && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>
            {previews.filter((p) => p.status === 'success').length} link(s)
            detected
          </span>
          {hiddenCount > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-blue-500 hover:text-blue-600"
            >
              {expanded ? 'Show less' : `Show ${hiddenCount} more`}
            </button>
          )}
        </div>
      )}

      {/* Preview Cards */}
      <div className={compact ? 'space-y-1' : 'space-y-2'}>
        {visiblePreviews.map((preview) => (
          <LinkPreviewCard
            key={preview.url}
            preview={preview}
            onRemove={onRemove ? () => onRemove(preview.url) : undefined}
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * 格式化时长
 */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default LinkPreviewCard;
