'use client';

import type { GeneratedImage } from '../types';

interface CanvasToolbarProps {
  image: GeneratedImage;
  onExpand: () => void;
  onDownload: () => void;
  onRefine: () => void;
  onCopy: () => void;
}

export function CanvasToolbar({
  image,
  onExpand,
  onDownload,
  onRefine,
  onCopy,
}: CanvasToolbarProps) {
  return (
    <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 shadow-lg">
      <button
        onClick={onExpand}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-gray-700 transition hover:bg-gray-100"
        title="View fullscreen"
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
            d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
          />
        </svg>
        <span className="hidden sm:inline">Expand</span>
      </button>
      <div className="h-4 w-px bg-gray-300" />
      <button
        onClick={onRefine}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-purple-600 transition hover:bg-purple-50"
        title="Refine this image"
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
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        <span className="hidden sm:inline">Refine</span>
      </button>
      <div className="h-4 w-px bg-gray-300" />
      <button
        onClick={onDownload}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-gray-700 transition hover:bg-gray-100"
        title="Download image"
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
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
        <span className="hidden sm:inline">Download</span>
      </button>
      <button
        onClick={onCopy}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-gray-700 transition hover:bg-gray-100"
        title="Copy image"
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
            d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
          />
        </svg>
      </button>
    </div>
  );
}
