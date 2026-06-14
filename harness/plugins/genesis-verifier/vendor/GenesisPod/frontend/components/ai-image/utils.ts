// Utility functions for AI Image Generator

import { SUPPORTED_FILE_TYPES, SUPPORTED_FILE_EXTENSIONS } from './constants';
import type { UploadedFile } from './types';

import { logger } from '@/lib/utils/logger';
/**
 * Convert image URL to Base64
 */
export async function imageUrlToBase64(imageUrl: string): Promise<string> {
  try {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        const base64Data = base64.split(',')[1] || base64;
        resolve(base64Data);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    logger.error('Failed to convert image to base64:', err);
    throw err;
  }
}

/**
 * Get file icon SVG path based on file type
 */
export function getFileIcon(file: File): string {
  if (file.type.startsWith('image/'))
    return 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z';
  if (file.type === 'application/pdf')
    return 'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z';
  return 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z';
}

/**
 * Check if a file is supported
 */
export function isFileSupported(file: File): boolean {
  return (
    SUPPORTED_FILE_TYPES.includes(file.type) ||
    SUPPORTED_FILE_EXTENSIONS.some((ext) =>
      file.name.toLowerCase().endsWith(ext)
    ) ||
    file.type.startsWith('image/')
  );
}

/**
 * Process uploaded files and create UploadedFile objects
 */
export function processUploadedFiles(
  files: FileList,
  maxFileSize: number
): UploadedFile[] {
  const uploadedFiles: UploadedFile[] = [];

  Array.from(files).forEach((file) => {
    if (isFileSupported(file) && file.size <= maxFileSize) {
      const uploadedFile: UploadedFile = {
        file,
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      };

      if (file.type.startsWith('image/')) {
        uploadedFile.preview = URL.createObjectURL(file);
      }

      uploadedFiles.push(uploadedFile);
    }
  });

  return uploadedFiles;
}

/**
 * Get layout capacity information for template
 */
export function getLayoutCapacity(
  templateLayout: string
): { max: number; type: string } | null {
  if (templateLayout === 'statistics') {
    return { max: 12, type: '指标' };
  } else if (templateLayout === 'cards' || templateLayout === 'auto') {
    return { max: 15, type: '卡片' };
  } else if (templateLayout === 'timeline') {
    return { max: 5, type: '阶段' };
  } else if (templateLayout === 'ranking') {
    return { max: 15, type: '排名项' };
  }
  return null;
}

/**
 * Get max sections for template layout
 */
export function getMaxSections(templateLayout: string): number {
  if (templateLayout === 'statistics') return 12;
  if (templateLayout === 'timeline') return 5;
  if (templateLayout === 'matrix') return 4;
  if (templateLayout === 'ranking') return 15;
  return 15; // cards/auto
}

/**
 * Extract mentions from prompt text
 */
export function extractMentions(text: string): string[] {
  const mentions = text.match(/@\[(.*?)\]/g);
  if (!mentions) return [];
  return mentions.map((mention) => mention.slice(2, -1));
}

/**
 * Download image file
 */
export async function downloadImage(
  imageUrl: string,
  imageId: string,
  authHeaders?: HeadersInit
): Promise<void> {
  try {
    const response = await fetch(imageUrl, { headers: authHeaders });
    if (!response.ok) {
      throw new Error(`Download failed with status ${response.status}`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-image-${imageId}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    logger.error('Download failed:', err);
    // Fallback: open in new tab
    window.open(imageUrl, '_blank', 'noopener,noreferrer');
  }
}

/**
 * Copy image to clipboard
 */
export async function copyImageToClipboard(imageUrl: string): Promise<void> {
  const response = await fetch(imageUrl);
  const blob = await response.blob();
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
}

/**
 * Copy text to clipboard
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
