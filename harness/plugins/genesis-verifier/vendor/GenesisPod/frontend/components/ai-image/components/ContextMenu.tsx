'use client';

import type { GeneratedImage } from '../types';

interface ContextMenuProps {
  position: { x: number; y: number } | null;
  image: GeneratedImage | null;
  isBookmarked: boolean;
  isInLightbox: boolean;
  onBookmark: () => void;
  onRefine: () => void;
  onDownload: () => void;
  onCopyImage: () => void;
  onCopyLink: () => void;
  onOpenInNewTab: () => void;
  onViewFullscreen: () => void;
  onDelete: () => void;
}

export function ContextMenu({
  position,
  image,
  isBookmarked,
  isInLightbox,
  onBookmark,
  onRefine,
  onDownload,
  onCopyImage,
  onCopyLink,
  onOpenInNewTab,
  onViewFullscreen,
  onDelete,
}: ContextMenuProps) {
  if (!position || !image) return null;

  return (
    <div
      className="fixed z-[110] min-w-[160px] overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-xl"
      style={{
        left: Math.min(position.x, window.innerWidth - 180),
        top: Math.min(position.y, window.innerHeight - 320),
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={onBookmark}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-100"
      >
        <svg
          className={`h-3.5 w-3.5 ${isBookmarked ? 'text-amber-500' : 'text-gray-400'}`}
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
        {isBookmarked ? 'Remove from Library' : 'Add to Library'}
      </button>
      <button
        onClick={onRefine}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-purple-600 hover:bg-gray-100"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        Refine Image
      </button>
      <div className="my-1 border-t border-gray-200" />
      <button
        onClick={onDownload}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-100"
      >
        <svg
          className="h-3.5 w-3.5 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
        Download
      </button>
      <button
        onClick={onCopyImage}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-100"
      >
        <svg
          className="h-3.5 w-3.5 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
          />
        </svg>
        Copy Image
      </button>
      <button
        onClick={onCopyLink}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-100"
      >
        <svg
          className="h-3.5 w-3.5 text-gray-400"
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
        Copy Link
      </button>
      <div className="my-1 border-t border-gray-200" />
      <button
        onClick={onOpenInNewTab}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-100"
      >
        <svg
          className="h-3.5 w-3.5 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          />
        </svg>
        Open in New Tab
      </button>
      {!isInLightbox && (
        <button
          onClick={onViewFullscreen}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-100"
        >
          <svg
            className="h-3.5 w-3.5 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
            />
          </svg>
          View Fullscreen
        </button>
      )}
      <div className="my-1 border-t border-gray-200" />
      <button
        onClick={onDelete}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
          />
        </svg>
        Delete
      </button>
    </div>
  );
}
