'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Download, X, AlertCircle } from 'lucide-react';
import { ExportDialog } from './export-dialog';
import { logger } from '@/lib/utils/logger';
import { getAuthHeader } from '@/lib/utils/auth';
import {
  useYoutubeSubtitleExport,
  BilingualSubtitles,
  SubtitleExportOptions,
  SubtitleSegment,
} from '@/hooks';

interface SubtitleExportButtonProps {
  videoId: string;
  className?: string;
  variant?: 'primary' | 'secondary' | 'icon';
  position?: 'top-right' | 'inline';
  /**
   * Pre-built English subtitle segments (e.g. merged by sentence). When provided
   * together with `chineseSegments`, the button skips the backend `/subtitles`
   * fetch and uses this local data directly. Any Chinese segment with empty
   * text will be filled in via batch translation before export.
   */
  englishSegments?: SubtitleSegment[];
  /** Chinese translations parallel to `englishSegments` (empty text = missing). */
  chineseSegments?: SubtitleSegment[];
  /** Video title used when exporting locally. */
  videoTitle?: string;
}

/**
 * Run async tasks with a concurrency cap, reporting progress via callback.
 */
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
  onProgress?: (done: number, total: number) => void
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let cursor = 0;
  let done = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    async () => {
      while (cursor < tasks.length) {
        const index = cursor++;
        results[index] = await tasks[index]();
        done += 1;
        onProgress?.(done, tasks.length);
      }
    }
  );

  await Promise.all(workers);
  return results;
}

export function SubtitleExportButton({
  videoId,
  className = '',
  variant = 'primary',
  position = 'inline',
  englishSegments,
  chineseSegments,
  videoTitle,
}: SubtitleExportButtonProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [subtitles, setSubtitles] = useState<BilingualSubtitles | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [translationProgress, setTranslationProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  const { isLoading, error, fetchSubtitles, exportPdf } =
    useYoutubeSubtitleExport();

  // Local data takes precedence over backend fetch.
  const hasLocalData = useMemo(
    () => Array.isArray(englishSegments) && englishSegments.length > 0,
    [englishSegments]
  );

  const localSubtitles = useMemo<BilingualSubtitles | null>(() => {
    if (!hasLocalData || !englishSegments) return null;
    return {
      videoId,
      title: videoTitle || `YouTube Video ${videoId}`,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      english: englishSegments,
      chinese: chineseSegments ?? [],
    };
  }, [hasLocalData, englishSegments, chineseSegments, videoId, videoTitle]);

  useEffect(() => {
    if (!isDialogOpen) return;
    if (hasLocalData && localSubtitles) {
      // Use local data directly - no backend round-trip needed.
      setSubtitles(localSubtitles);
      setFetchError(null);
      return;
    }
    if (!subtitles && videoId) {
      void handleFetchSubtitles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDialogOpen, videoId, hasLocalData, localSubtitles]);

  const handleFetchSubtitles = async () => {
    setFetchError(null);
    const result = await fetchSubtitles(videoId);
    if (result) {
      setSubtitles(result);
    } else {
      setFetchError('Failed to fetch subtitles. Please try again.');
    }
  };

  /**
   * Translate a single text chunk via the app BFF. Returns empty string on
   * failure so the overall export still succeeds with a partial result.
   */
  const translateChunk = async (text: string): Promise<string> => {
    try {
      const res = await fetch('/api/ai-service/ai/translate-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ text, targetLanguage: 'zh-CN' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      const data = result?.data ?? result;
      return typeof data?.translation === 'string' ? data.translation : '';
    } catch (err) {
      logger.warn('Fill-in translation failed for chunk:', err);
      return '';
    }
  };

  /**
   * Ensure Chinese segments are complete (fill any blanks via live translation).
   * Returns segments aligned 1:1 with `english`.
   */
  const ensureChineseComplete = async (
    english: SubtitleSegment[],
    chinese: SubtitleSegment[]
  ): Promise<SubtitleSegment[]> => {
    const filled: SubtitleSegment[] = english.map((en, i) => {
      const zh = chinese[i];
      return {
        text: zh?.text ?? '',
        start: zh?.start ?? en.start,
        duration: zh?.duration ?? en.duration,
      };
    });

    const missingIndices: number[] = [];
    filled.forEach((seg, i) => {
      const hasText = seg.text && seg.text.trim().length > 0;
      const source = english[i]?.text?.trim();
      if (!hasText && source) missingIndices.push(i);
    });

    if (missingIndices.length === 0) return filled;

    setTranslationProgress({ current: 0, total: missingIndices.length });

    const tasks = missingIndices.map(
      (i) => () => translateChunk(english[i].text)
    );
    const translated = await runWithConcurrency(tasks, 4, (done, total) =>
      setTranslationProgress({ current: done, total })
    );

    missingIndices.forEach((idx, k) => {
      filled[idx] = {
        text: translated[k] || english[idx].text, // fallback to source keeps PDF readable
        start: english[idx].start,
        duration: english[idx].duration,
      };
    });

    setTranslationProgress(null);
    return filled;
  };

  const handleExport = async (options: SubtitleExportOptions) => {
    if (!subtitles) {
      setFetchError('No subtitles available. Please try again.');
      return;
    }

    try {
      const needsChinese =
        options.format === 'bilingual-side' ||
        options.format === 'bilingual-stack' ||
        options.format === 'chinese-only';

      let chinese = subtitles.chinese;
      if (needsChinese) {
        chinese = await ensureChineseComplete(subtitles.english, chinese);
      }

      await exportPdf(
        subtitles.videoId,
        subtitles.title,
        subtitles.english,
        chinese,
        options
      );
      setIsDialogOpen(false);
    } catch (err) {
      logger.error('Export failed:', err);
      setTranslationProgress(null);
    }
  };

  const getButtonClasses = () => {
    const baseClasses =
      'transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2';

    if (variant === 'icon') {
      return `${baseClasses} inline-flex items-center justify-center p-2 rounded-full text-slate-600 hover:text-slate-900 hover:bg-slate-100 focus:ring-violet-500 ${className}`;
    }

    if (variant === 'secondary') {
      return `${baseClasses} inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:ring-blue-500 ${className}`;
    }

    return `${baseClasses} inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:ring-blue-500 ${className}`;
  };

  const positionClasses =
    position === 'top-right' ? 'fixed top-4 right-4 z-40' : '';

  return (
    <>
      <div className={positionClasses}>
        <button
          onClick={() => setIsDialogOpen(true)}
          className={getButtonClasses()}
          title="导出双语字幕为 PDF"
          aria-label="导出双语字幕为 PDF"
        >
          {variant === 'icon' ? (
            <Download className="h-5 w-5" strokeWidth={2} aria-hidden />
          ) : (
            <>
              <Download className="h-4 w-4" strokeWidth={2} aria-hidden />
              <span>Export PDF</span>
            </>
          )}
        </button>
      </div>

      <ExportDialog
        isOpen={isDialogOpen}
        onClose={() => {
          setIsDialogOpen(false);
          setFetchError(null);
          setTranslationProgress(null);
        }}
        onExport={handleExport}
        isLoading={isLoading || translationProgress !== null}
      />

      {/* Error Toast */}
      {(error || fetchError) && isDialogOpen && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 shadow-lg">
            <div className="flex items-start space-x-3">
              <AlertCircle
                className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600"
                aria-hidden
              />
              <div className="flex-1">
                <h3 className="text-sm font-medium text-red-800">Error</h3>
                <p className="mt-1 text-sm text-red-700">
                  {error || fetchError}
                </p>
              </div>
              <button
                onClick={() => setFetchError(null)}
                className="text-red-400 transition-colors hover:text-red-600"
                aria-label="关闭错误提示"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            {fetchError && !hasLocalData && (
              <button
                onClick={handleFetchSubtitles}
                className="mt-3 w-full rounded bg-red-100 px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-200"
              >
                Retry
              </button>
            )}
          </div>
        </div>
      )}

      {/* Loading Overlay - fetching or batch-translating */}
      {(isLoading || translationProgress !== null) && !isDialogOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black bg-opacity-30">
          <div className="flex items-center space-x-4 rounded-lg bg-white p-6 shadow-xl">
            <svg
              className="h-6 w-6 animate-spin text-violet-600"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden
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
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span className="font-medium text-gray-700">
              {translationProgress
                ? `翻译中 ${translationProgress.current}/${translationProgress.total}...`
                : '加载字幕中...'}
            </span>
          </div>
        </div>
      )}

      {/* In-dialog progress toast for batch translation */}
      {translationProgress !== null && isDialogOpen && (
        <div className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-full bg-white px-4 py-2 text-sm shadow-xl ring-1 ring-gray-200">
            <svg
              className="h-4 w-4 animate-spin text-violet-600"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden
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
            <span className="font-medium text-gray-700">
              正在补全中文翻译 {translationProgress.current}/
              {translationProgress.total}
            </span>
          </div>
        </div>
      )}
    </>
  );
}
