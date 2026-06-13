/**
 * PDF Thumbnail Generation Utility
 * Client-side PDF rendering using PDF.js
 */

import * as pdfjsLib from 'pdfjs-dist';
import { config } from './config';

import { logger } from '@/lib/utils/logger';
// Configure PDF.js worker
// PDF.js 5.x uses .mjs extension and different build path
if (typeof window !== 'undefined') {
  // Use unpkg which has latest versions
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
}

export interface ThumbnailOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'png' | 'jpeg';
}

const DEFAULT_OPTIONS: Required<ThumbnailOptions> = {
  width: 400,
  height: 566, // A4 ratio
  quality: 0.85,
  format: 'jpeg',
};

/**
 * Generate thumbnail from PDF URL
 * @param pdfUrl PDF file URL
 * @param options Thumbnail generation options
 * @returns Base64 encoded thumbnail image
 */
export async function generatePdfThumbnail(
  pdfUrl: string,
  options: ThumbnailOptions = {}
): Promise<string | null> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    // Load PDF document
    const loadingTask = pdfjsLib.getDocument(pdfUrl);
    const pdf = await loadingTask.promise;

    // Get first page
    const page = await pdf.getPage(1);

    // Calculate scale to fit target dimensions
    const viewport = page.getViewport({ scale: 1.0 });
    const scale = Math.min(
      opts.width / viewport.width,
      opts.height / viewport.height
    );
    const scaledViewport = page.getViewport({ scale });

    // Create canvas
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to get canvas context');
    }

    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;

    // Render PDF page to canvas
    const renderContext = {
      canvas: canvas,
      canvasContext: context,
      viewport: scaledViewport,
    };
    await page.render(renderContext).promise;

    // Convert canvas to base64
    const mimeType = opts.format === 'png' ? 'image/png' : 'image/jpeg';
    const dataUrl = canvas.toDataURL(mimeType, opts.quality);

    return dataUrl;
  } catch (error) {
    logger.error('Failed to generate PDF thumbnail:', error);
    return null;
  }
}

/**
 * Generate thumbnail and save to backend
 * @param resourceId Resource ID
 * @param pdfUrl PDF file URL
 * @param options Thumbnail generation options
 * @returns Saved thumbnail URL
 */
export async function generateAndSaveThumbnail(
  resourceId: string,
  pdfUrl: string,
  options: ThumbnailOptions = {}
): Promise<string | null> {
  try {
    // Generate thumbnail
    const thumbnail = await generatePdfThumbnail(pdfUrl, options);
    if (!thumbnail) {
      return null;
    }

    // Convert base64 to blob
    const response = await fetch(thumbnail);
    const blob = await response.blob();

    // Create form data
    const formData = new FormData();
    formData.append('thumbnail', blob, `${resourceId}.jpg`);

    // Upload to backend
    const uploadResponse = await fetch(
      `${config.apiUrl}/resources/${resourceId}/thumbnail`,
      {
        method: 'POST',
        body: formData,
      }
    );

    if (!uploadResponse.ok) {
      throw new Error('Failed to upload thumbnail');
    }

    const result = (await uploadResponse.json()) as { thumbnailUrl: string };
    return result.thumbnailUrl;
  } catch (error) {
    logger.error('Failed to generate and save thumbnail:', error);
    return null;
  }
}

/**
 * Batch generate thumbnails for multiple resources
 * @param resources Array of resources with id and pdfUrl
 * @param onProgress Progress callback
 * @returns Statistics of generation results
 */
export async function batchGenerateThumbnails(
  resources: Array<{ id: string; pdfUrl: string }>,
  onProgress?: (current: number, total: number, resourceId: string) => void
): Promise<{ success: number; failed: number; skipped: number }> {
  const stats = { success: 0, failed: 0, skipped: 0 };
  const total = resources.length;

  for (let i = 0; i < total; i++) {
    const resource = resources[i];

    if (onProgress) {
      onProgress(i + 1, total, resource.id);
    }

    try {
      const thumbnailUrl = await generateAndSaveThumbnail(
        resource.id,
        resource.pdfUrl
      );

      if (thumbnailUrl) {
        stats.success++;
      } else {
        stats.failed++;
      }
    } catch (error) {
      logger.error(`Failed to process resource ${resource.id}:`, error);
      stats.failed++;
    }

    // Add delay to avoid overwhelming the server
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return stats;
}

/**
 * Check if thumbnail exists for a resource
 * @param resourceId Resource ID
 * @returns Whether thumbnail exists
 */
export async function thumbnailExists(resourceId: string): Promise<boolean> {
  try {
    const response = await fetch(`${config.apiUrl}/resources/${resourceId}`, {
      method: 'HEAD',
    });
    return response.ok;
  } catch {
    return false;
  }
}
