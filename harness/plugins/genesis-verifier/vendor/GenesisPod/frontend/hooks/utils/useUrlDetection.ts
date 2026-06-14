'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  detectAndParseUrls,
  ParsedUrl,
  DetectedUrl,
} from '@/services/ai-teams/api';

import { logger } from '@/lib/utils/logger';
// URL 检测正则表达式（与后端保持一致）
const URL_REGEX =
  /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)/gi;

interface UseUrlDetectionOptions {
  /** 防抖延迟（毫秒） */
  debounceMs?: number;
  /** 是否自动解析 */
  autoParseUrls?: boolean;
  /** 最大解析 URL 数量 */
  maxUrls?: number;
}

interface UseUrlDetectionResult {
  /** 检测到的 URL 列表 */
  detectedUrls: DetectedUrl[];
  /** 解析后的 URL 预览数据 */
  parsedUrls: ParsedUrl[];
  /** 是否正在解析 */
  isParsing: boolean;
  /** 解析错误 */
  error: string | null;
  /** 手动触发解析 */
  parseUrls: (text: string) => Promise<void>;
  /** 移除指定 URL 的预览 */
  removeUrl: (url: string) => void;
  /** 清空所有预览 */
  clearAll: () => void;
}

/**
 * URL 检测和解析 Hook
 *
 * @param text 要检测的文本内容
 * @param options 配置选项
 * @returns URL 检测和解析结果
 *
 * @example
 * ```tsx
 * const { detectedUrls, parsedUrls, isParsing } = useUrlDetection(messageContent, {
 *   debounceMs: 500,
 *   autoParseUrls: true,
 *   maxUrls: 5,
 * });
 * ```
 */
export function useUrlDetection(
  text: string,
  options: UseUrlDetectionOptions = {}
): UseUrlDetectionResult {
  const { debounceMs = 500, autoParseUrls = true, maxUrls = 5 } = options;

  const [detectedUrls, setDetectedUrls] = useState<DetectedUrl[]>([]);
  const [parsedUrls, setParsedUrls] = useState<ParsedUrl[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 缓存已解析的 URL，避免重复请求
  const parsedUrlsCache = useRef<Map<string, ParsedUrl>>(new Map());
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * 本地检测 URL（不调用 API）
   */
  const detectUrlsLocally = useCallback(
    (content: string): DetectedUrl[] => {
      const detected: DetectedUrl[] = [];
      let match: RegExpExecArray | null;

      // 重置正则表达式的 lastIndex
      URL_REGEX.lastIndex = 0;

      while ((match = URL_REGEX.exec(content)) !== null) {
        const url = match[0];
        const startIndex = match.index;
        const endIndex = startIndex + url.length;

        // 简单的类型识别
        let type: DetectedUrl['type'] = 'WEBPAGE';
        let platform: string | undefined;

        if (/\.(png|jpg|jpeg|gif|webp|svg)(\?.*)?$/i.test(url)) {
          type = 'IMAGE';
        } else if (/\.(mp4|webm|mov)(\?.*)?$/i.test(url)) {
          type = 'VIDEO';
        } else if (/youtube\.com|youtu\.be/i.test(url)) {
          type = 'VIDEO';
          platform = 'youtube';
        } else if (/bilibili\.com/i.test(url)) {
          type = 'VIDEO';
          platform = 'bilibili';
        } else if (/github\.com/i.test(url)) {
          type = 'CODE_REPO';
          platform = 'github';
        } else if (/twitter\.com|x\.com/i.test(url)) {
          type = 'SOCIAL';
          platform = 'twitter';
        }

        detected.push({
          url,
          startIndex,
          endIndex,
          type,
          platform,
        });
      }

      return detected.slice(0, maxUrls);
    },
    [maxUrls]
  );

  /**
   * 解析 URL（调用后端 API）
   */
  const parseUrls = useCallback(
    async (content: string) => {
      // 取消之前的请求
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const detected = detectUrlsLocally(content);
      setDetectedUrls(detected);

      if (detected.length === 0) {
        setParsedUrls([]);
        return;
      }

      // 检查缓存
      const urlsToFetch: string[] = [];
      const cachedResults: ParsedUrl[] = [];

      for (const d of detected) {
        const cached = parsedUrlsCache.current.get(d.url);
        if (cached && cached.status === 'success') {
          cachedResults.push(cached);
        } else {
          urlsToFetch.push(d.url);
        }
      }

      // 如果所有 URL 都在缓存中
      if (urlsToFetch.length === 0) {
        setParsedUrls(cachedResults);
        return;
      }

      setIsParsing(true);
      setError(null);

      // 先设置 pending 状态
      const pendingUrls: ParsedUrl[] = urlsToFetch.map((url) => ({
        type: 'WEBPAGE' as const,
        originalText: url,
        url,
        preview: {},
        status: 'parsing' as const,
      }));

      setParsedUrls([...cachedResults, ...pendingUrls]);

      try {
        abortControllerRef.current = new AbortController();

        const result = await detectAndParseUrls(content);

        // 更新缓存
        for (const parsed of result.parsedUrls) {
          if (parsed.status === 'success') {
            parsedUrlsCache.current.set(parsed.url, parsed);
          }
        }

        // 合并缓存和新解析的结果
        const finalResults: ParsedUrl[] = [];
        for (const d of detected) {
          const fromCache = parsedUrlsCache.current.get(d.url);
          const fromResult = result.parsedUrls.find((p) => p.url === d.url);
          if (fromCache) {
            finalResults.push(fromCache);
          } else if (fromResult) {
            finalResults.push(fromResult);
          }
        }

        setParsedUrls(finalResults);
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          // 请求被取消，忽略
          return;
        }
        logger.error('Failed to parse URLs:', err);
        setError((err as Error).message);

        // 将 pending 状态改为 failed
        setParsedUrls((prev) =>
          prev.map((p) =>
            p.status === 'parsing'
              ? {
                  ...p,
                  status: 'failed' as const,
                  error: (err as Error).message,
                }
              : p
          )
        );
      } finally {
        setIsParsing(false);
        abortControllerRef.current = null;
      }
    },
    [detectUrlsLocally]
  );

  /**
   * 移除指定 URL 的预览
   */
  const removeUrl = useCallback((url: string) => {
    setDetectedUrls((prev) => prev.filter((d) => d.url !== url));
    setParsedUrls((prev) => prev.filter((p) => p.url !== url));
    // 从缓存中移除
    parsedUrlsCache.current.delete(url);
  }, []);

  /**
   * 清空所有预览
   */
  const clearAll = useCallback(() => {
    setDetectedUrls([]);
    setParsedUrls([]);
    setError(null);
  }, []);

  /**
   * 自动检测和解析
   */
  useEffect(() => {
    if (!autoParseUrls) return;

    // 清除之前的定时器
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // 如果文本为空，清空状态
    if (!text.trim()) {
      setDetectedUrls([]);
      setParsedUrls([]);
      return;
    }

    // 先立即检测（不解析），给用户即时反馈
    const detected = detectUrlsLocally(text);
    setDetectedUrls(detected);

    // 如果检测到 URL，设置防抖定时器进行解析
    if (detected.length > 0) {
      debounceTimerRef.current = setTimeout(() => {
        parseUrls(text);
      }, debounceMs);
    } else {
      setParsedUrls([]);
    }

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [text, autoParseUrls, debounceMs, detectUrlsLocally, parseUrls]);

  /**
   * 组件卸载时清理
   */
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return useMemo(
    () => ({
      detectedUrls,
      parsedUrls,
      isParsing,
      error,
      parseUrls,
      removeUrl,
      clearAll,
    }),
    [detectedUrls, parsedUrls, isParsing, error, parseUrls, removeUrl, clearAll]
  );
}

export default useUrlDetection;
