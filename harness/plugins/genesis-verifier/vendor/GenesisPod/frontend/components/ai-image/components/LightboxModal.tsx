'use client';

import type { GeneratedImage } from '../types';
import { ClientDate } from '@/components/common/ClientDate';

interface LightboxModalProps {
  image: GeneratedImage | null;
  onClose: () => void;
  onDownload: (image: GeneratedImage) => void;
  onContextMenu: (e: React.MouseEvent, image: GeneratedImage) => void;
}

export function LightboxModal({
  image,
  onClose,
  onDownload,
  onContextMenu,
}: LightboxModalProps) {
  if (!image) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-3 text-white transition hover:bg-white/20"
      >
        <svg
          className="h-6 w-6"
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
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDownload(image);
        }}
        className="absolute right-20 top-4 z-10 rounded-full bg-white/10 p-3 text-white transition hover:bg-white/20"
      >
        <svg
          className="h-6 w-6"
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
      </button>
      <div
        className="flex max-h-[90vh] max-w-[95vw] flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={image.imageUrl}
          alt={image.prompt}
          className="max-h-[70vh] max-w-[95vw] rounded-t-lg object-contain shadow-2xl"
          onContextMenu={(e) => onContextMenu(e, image)}
        />
        <div className="w-full max-w-[95vw] rounded-b-lg bg-gray-900/95 px-4 py-3">
          {image.enhancedPrompt && (
            <p className="line-clamp-2 text-sm text-gray-300">
              {image.enhancedPrompt}
            </p>
          )}
          <div className="mt-1 flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {image.width} x {image.height} -{' '}
              <ClientDate date={image.createdAt} format="datetime" />
            </p>
            <p className="text-xs text-gray-600">ESC to close</p>
          </div>
        </div>
      </div>
    </div>
  );
}
