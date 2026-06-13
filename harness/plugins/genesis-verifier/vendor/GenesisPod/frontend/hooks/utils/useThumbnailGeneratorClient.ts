'use client';

import { useState, useCallback } from 'react';
import { config } from '@/lib/utils/config';

import { logger } from '@/lib/utils/logger';
// Lazy load PDF.js only in browser context
let pdfjsLib: typeof import('pdfjs-dist') | null = null;

const initPdfJs = async () => {
  if (pdfjsLib || typeof window === 'undefined') {
    return;
  }
  pdfjsLib = await import('pdfjs-dist');
  if (pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  }
};

interface ThumbnailGeneratorOptions {
  scale?: number;
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
}

interface GenerateThumbnailResult {
  thumbnailDataUrl: string | null;
  error: string | null;
  isGenerating: boolean;
}

/**
 * Hook for generating PDF thumbnails
 *
 * Features:
 * - Generate thumbnail from PDF URL
 * - Configurable scale and quality
 * - Automatic error handling
 * - Loading states
 */
export function useThumbnailGenerator(options: ThumbnailGeneratorOptions = {}) {
  const {
    scale = 1.5,
    quality = 0.8,
    maxWidth = 200,
    maxHeight = 280,
  } = options;

  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolveUrl = useCallback((url: string): string => {
    if (!url) {
      return url;
    }

    try {
      const parsed = new URL(url, config.apiBaseUrl);
      return parsed.toString();
    } catch {
      // If parsing fails (e.g., data URI), return original value
      return url;
    }
  }, []);

  /**
   * Generate thumbnail from PDF URL
   */
  const generateThumbnail = useCallback(
    async (pdfUrl: string): Promise<string | null> => {
      setIsGenerating(true);
      setError(null);

      try {
        // Initialize PDF.js if not already done
        await initPdfJs();

        if (!pdfjsLib) {
          throw new Error('PDF.js library failed to load');
        }

        const resolvedPdfUrl = resolveUrl(pdfUrl);

        // Load PDF document
        const loadingTask = pdfjsLib.getDocument(resolvedPdfUrl);
        const pdf = await loadingTask.promise;

        // Get first page
        const page = await pdf.getPage(1);

        // Calculate viewport
        const viewport = page.getViewport({ scale });

        // Adjust scale to fit maxWidth/maxHeight
        let adjustedScale = scale;
        if (viewport.width > maxWidth) {
          adjustedScale = (maxWidth / viewport.width) * scale;
        }
        if (viewport.height > maxHeight) {
          const heightScale = (maxHeight / viewport.height) * scale;
          adjustedScale = Math.min(adjustedScale, heightScale);
        }

        const finalViewport = page.getViewport({ scale: adjustedScale });

        // Create canvas
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        if (!context) {
          throw new Error('Failed to get canvas context');
        }

        canvas.width = finalViewport.width;
        canvas.height = finalViewport.height;

        // Render PDF page to canvas
        const renderContext = {
          canvasContext: context,
          viewport: finalViewport,
          canvas: canvas,
        };

        await page.render(renderContext).promise;

        // Convert canvas to data URL
        const thumbnailDataUrl = canvas.toDataURL('image/jpeg', quality);

        setIsGenerating(false);
        return thumbnailDataUrl;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to generate thumbnail';
        logger.error('Thumbnail generation error:', err);
        setError(errorMessage);
        setIsGenerating(false);
        return null;
      }
    },
    [scale, quality, maxWidth, maxHeight]
  );

  /**
   * Generate thumbnail and upload to backend
   */
  const generateAndUploadThumbnail = useCallback(
    async (resourceId: string, pdfUrl: string): Promise<boolean> => {
      try {
        // Generate thumbnail
        const thumbnailDataUrl = await generateThumbnail(pdfUrl);

        if (!thumbnailDataUrl) {
          return false;
        }

        // Convert data URL to Blob
        const response = await fetch(thumbnailDataUrl);
        const blob = await response.blob();

        // Upload to backend
        const formData = new FormData();
        formData.append('thumbnail', blob, 'thumbnail.jpg');

        const uploadResponse = await fetch(
          `${config.apiBaseUrl}/api/v1/resources/${resourceId}/thumbnail`,
          {
            method: 'POST',
            body: formData,
          }
        );

        if (!uploadResponse.ok) {
          throw new Error('Failed to upload thumbnail');
        }

        return true;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to upload thumbnail';
        logger.error('Thumbnail upload error:', err);
        setError(errorMessage);
        return false;
      }
    },
    [generateThumbnail]
  );

  /**
   * Batch generate thumbnails for multiple resources
   */
  const batchGenerateThumbnails = useCallback(
    async (
      resources: Array<{ id: string; pdfUrl: string }>
    ): Promise<{ success: number; failed: number; errors: string[] }> => {
      setIsGenerating(true);
      setError(null);

      let success = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const resource of resources) {
        try {
          const result = await generateAndUploadThumbnail(
            resource.id,
            resource.pdfUrl
          );
          if (result) {
            success++;
          } else {
            failed++;
            errors.push(`Failed to generate thumbnail for ${resource.id}`);
          }
        } catch (err) {
          failed++;
          const errorMessage =
            err instanceof Error ? err.message : 'Unknown error';
          errors.push(`${resource.id}: ${errorMessage}`);
        }

        // Small delay to avoid overwhelming the server
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      setIsGenerating(false);
      return { success, failed, errors };
    },
    [generateAndUploadThumbnail]
  );

  return {
    generateThumbnail,
    generateAndUploadThumbnail,
    batchGenerateThumbnails,
    isGenerating,
    error,
  };
}

/**
 * Utility function to check if a resource needs thumbnail generation
 */
export function needsThumbnail(resource: {
  type: string;
  pdfUrl?: string | null;
  thumbnailUrl?: string | null;
}): boolean {
  return (
    resource.type === 'PAPER' && !!resource.pdfUrl && !resource.thumbnailUrl
  );
}
