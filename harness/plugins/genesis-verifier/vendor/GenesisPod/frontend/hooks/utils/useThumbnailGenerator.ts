/**
 * React Hook for PDF Thumbnail Generation
 */

import { useState, useCallback } from 'react';

import { logger } from '@/lib/utils/logger';
interface ThumbnailStatus {
  [resourceId: string]: 'idle' | 'generating' | 'success' | 'error';
}

export function useThumbnailGenerator() {
  const [thumbnailStatus, setThumbnailStatus] = useState<ThumbnailStatus>({});
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  /**
   * Generate thumbnail for a single resource
   */
  const generateThumbnail = useCallback(
    async (resourceId: string, pdfUrl: string) => {
      try {
        setThumbnailStatus((prev) => ({ ...prev, [resourceId]: 'generating' }));

        // Dynamic import to avoid loading PDF.js on server
        const { generateAndSaveThumbnail } =
          await import('@/lib/utils/pdf-thumbnail');
        const thumbnailUrl = await generateAndSaveThumbnail(resourceId, pdfUrl);

        if (thumbnailUrl) {
          setThumbnailStatus((prev) => ({ ...prev, [resourceId]: 'success' }));
          return thumbnailUrl;
        } else {
          setThumbnailStatus((prev) => ({ ...prev, [resourceId]: 'error' }));
          return null;
        }
      } catch (error) {
        logger.error(`Failed to generate thumbnail for ${resourceId}:`, error);
        setThumbnailStatus((prev) => ({ ...prev, [resourceId]: 'error' }));
        return null;
      }
    },
    []
  );

  /**
   * Generate thumbnails for multiple resources
   */
  const generateBatchThumbnails = useCallback(
    async (resources: Array<{ id: string; pdfUrl: string }>) => {
      const total = resources.length;
      setProgress({ current: 0, total });

      const results = {
        success: 0,
        failed: 0,
        skipped: 0,
      };

      for (let i = 0; i < total; i++) {
        const resource = resources[i];
        setProgress({ current: i + 1, total });

        const thumbnailUrl = await generateThumbnail(
          resource.id,
          resource.pdfUrl
        );

        if (thumbnailUrl) {
          results.success++;
        } else {
          results.failed++;
        }

        // Add delay to avoid overwhelming the browser
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      setProgress(null);
      return results;
    },
    [generateThumbnail]
  );

  /**
   * Reset status for a resource
   */
  const resetStatus = useCallback((resourceId: string) => {
    setThumbnailStatus((prev) => {
      const next = { ...prev };
      delete next[resourceId];
      return next;
    });
  }, []);

  /**
   * Get status for a resource
   */
  const getStatus = useCallback(
    (resourceId: string) => {
      return thumbnailStatus[resourceId] || 'idle';
    },
    [thumbnailStatus]
  );

  return {
    generateThumbnail,
    generateBatchThumbnails,
    getStatus,
    resetStatus,
    progress,
    thumbnailStatus,
  };
}
