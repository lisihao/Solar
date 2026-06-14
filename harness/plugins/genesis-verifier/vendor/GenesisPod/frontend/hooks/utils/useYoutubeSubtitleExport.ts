import { useState, useCallback } from 'react';

import { logger } from '@/lib/utils/logger';
export interface SubtitleSegment {
  text: string;
  start: number;
  duration: number;
}

export interface BilingualSubtitles {
  videoId: string;
  title: string;
  url: string;
  english: SubtitleSegment[];
  chinese: SubtitleSegment[];
}

export interface SubtitleExportOptions {
  format:
    | 'bilingual-side'
    | 'bilingual-stack'
    | 'english-only'
    | 'chinese-only';
  includeTimestamps: boolean;
  includeVideoUrl: boolean;
  includeMetadata: boolean;
}

interface UseYoutubeSubtitleExportReturn {
  isLoading: boolean;
  error: string | null;
  fetchSubtitles: (videoId: string) => Promise<BilingualSubtitles | null>;
  exportPdf: (
    videoId: string,
    title: string,
    englishSubtitles: SubtitleSegment[],
    chineseSubtitles: SubtitleSegment[],
    options: SubtitleExportOptions
  ) => Promise<void>;
}

const API_BASE_URL = (() => {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
  const apiVersion = process.env.NEXT_PUBLIC_API_VERSION || 'v1';
  return `${apiUrl}/api/${apiVersion}`;
})();

export function useYoutubeSubtitleExport(): UseYoutubeSubtitleExportReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch bilingual subtitles from API
   */
  const fetchSubtitles = useCallback(
    async (videoId: string): Promise<BilingualSubtitles | null> => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`${API_BASE_URL}/youtube/subtitles`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ videoId }),
        });

        if (!response.ok) {
          const errorData = await response
            .json()
            .catch(() => ({ message: 'Failed to fetch subtitles' }));
          throw new Error(errorData.message || `HTTP error ${response.status}`);
        }

        const result = await response.json();
        // Handle wrapped response { success: true, data: {...} }
        const data = result?.data ?? result;
        return data as BilingualSubtitles;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Unknown error occurred';
        setError(errorMessage);
        logger.error('Failed to fetch subtitles:', err);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  /**
   * Export subtitles as PDF
   */
  const exportPdf = useCallback(
    async (
      videoId: string,
      title: string,
      englishSubtitles: SubtitleSegment[],
      chineseSubtitles: SubtitleSegment[],
      options: SubtitleExportOptions
    ): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`${API_BASE_URL}/youtube/export-pdf`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            videoId,
            title,
            englishSubtitles,
            chineseSubtitles,
            options,
          }),
        });

        if (!response.ok) {
          const errorData = await response
            .json()
            .catch(() => ({ message: 'Failed to export PDF' }));
          throw new Error(errorData.message || `HTTP error ${response.status}`);
        }

        // Download the PDF file
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `youtube-subtitles-${videoId}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Unknown error occurred';
        setError(errorMessage);
        logger.error('Failed to export PDF:', err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  return {
    isLoading,
    error,
    fetchSubtitles,
    exportPdf,
  };
}
