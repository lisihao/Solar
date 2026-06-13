'use client';

import { useState, useEffect } from 'react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { extractYouTubeVideoId } from '../utils/utils';

import { logger } from '@/lib/utils/logger';
// 简单的内存缓存，用于存储已提取的缩略图
const thumbnailCache = new Map<string, string | null>();

// 请求队列，限制并发请求数
const pendingRequests = new Map<string, Promise<string | null>>();
const MAX_CONCURRENT_REQUESTS = 3;
let activeRequests = 0;
const requestQueue: Array<() => void> = [];

async function processQueue() {
  while (requestQueue.length > 0 && activeRequests < MAX_CONCURRENT_REQUESTS) {
    const next = requestQueue.shift();
    if (next) next();
  }
}

async function fetchThumbnailWithQueue(
  url: string,
  type: string,
  resourceId?: string
): Promise<string | null> {
  const cacheKey = `${url}:${type}`;

  // 检查缓存
  if (thumbnailCache.has(cacheKey)) {
    return thumbnailCache.get(cacheKey) || null;
  }

  // 检查是否已有相同请求在进行中
  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey)!;
  }

  // 创建新请求
  const requestPromise = new Promise<string | null>((resolve) => {
    const execute = async () => {
      activeRequests++;
      try {
        // 添加 resourceId 参数，支持服务端缓存
        let apiUrl = `${config.apiUrl}/resources/thumbnail/extract?url=${encodeURIComponent(url)}&type=${type}`;
        if (resourceId) {
          apiUrl += `&resourceId=${resourceId}`;
        }
        const response = await fetch(apiUrl, {
          headers: { ...getAuthHeader() },
        });
        if (response.ok) {
          const rawData = await response.json();
          // Handle wrapped response { success: true, data: {...} }
          const data = rawData?.data ?? rawData;
          const result = data.thumbnailUrl || null;
          thumbnailCache.set(cacheKey, result);
          resolve(result);
        } else {
          thumbnailCache.set(cacheKey, null);
          resolve(null);
        }
      } catch {
        thumbnailCache.set(cacheKey, null);
        resolve(null);
      } finally {
        activeRequests--;
        pendingRequests.delete(cacheKey);
        processQueue();
      }
    };

    if (activeRequests < MAX_CONCURRENT_REQUESTS) {
      execute();
    } else {
      requestQueue.push(execute);
    }
  });

  pendingRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

interface ResourceThumbnailProps {
  resource: {
    id: string;
    type: string;
    sourceUrl: string;
    thumbnailUrl?: string | null;
    title: string;
    metadata?: {
      imageUrl?: string;
      [key: string]: unknown;
    };
  };
  className?: string;
}

/**
 * 资源缩略图组件
 *
 * 动态获取和显示资源缩略图：
 * - YouTube: 直接从视频ID构建
 * - Blogs/News: 调用后端API提取og:image
 * - Papers/Reports: 显示类型图标（PDF缩略图需要单独生成）
 */
export default function ResourceThumbnail({
  resource,
  className = 'h-24 w-32',
}: ResourceThumbnailProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [useProxy, setUseProxy] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const fetchThumbnail = async () => {
      setIsLoading(true);
      setHasError(false);
      setUseProxy(false); // 重置代理状态

      // 1. 如果已有thumbnailUrl且不是占位图，直接使用
      if (resource.thumbnailUrl && !isPlaceholderImage(resource.thumbnailUrl)) {
        setThumbnailUrl(resource.thumbnailUrl);
        setIsLoading(false);
        return;
      }

      // 2. Solar YouTube channel subscriptions use a channel/representative cover.
      if (
        resource.type === 'YOUTUBE_VIDEO' &&
        resource.metadata?.importedAs === 'youtube-channel-subscription' &&
        resource.metadata?.imageUrl
      ) {
        setThumbnailUrl(String(resource.metadata.imageUrl));
        setIsLoading(false);
        return;
      }

      // 3. YouTube videos - 直接构建URL，无需API调用
      if (resource.type === 'YOUTUBE' || resource.type === 'YOUTUBE_VIDEO') {
        const videoId = extractYouTubeVideoId(resource.sourceUrl);
        if (videoId) {
          setThumbnailUrl(
            `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
          );
          setIsLoading(false);
          return;
        }
      }

      // 4. 如果有 metadata.imageUrl，直接使用
      if (resource.metadata?.imageUrl) {
        setThumbnailUrl(resource.metadata.imageUrl);
        setIsLoading(false);
        return;
      }

      // 5. arXiv论文 - 使用alphaXiv的公开CDN缩略图
      if (
        resource.type === 'PAPER' &&
        resource.sourceUrl?.includes('arxiv.org')
      ) {
        const match = resource.sourceUrl.match(/(\d+\.\d+)(v\d+)?/);
        if (match) {
          const arxivId = match[1];
          const version = match[2] || 'v1';
          // 使用alphaXiv的公开CDN (Amazon S3 + CloudFront)
          const thumbnailUrl = `https://paper-assets.alphaxiv.org/image/${arxivId}${version}.png`;
          setThumbnailUrl(thumbnailUrl);
          setIsLoading(false);
          return;
        }
      }

      // 6. PDF 文件 - 不提取缩略图，直接使用默认图标
      const isPdfUrl = resource.sourceUrl?.toLowerCase().endsWith('.pdf');
      if (isPdfUrl) {
        // PDF 文件不提取缩略图，使用 null 触发默认图标显示
        if (isMounted) {
          setThumbnailUrl(null);
          setIsLoading(false);
        }
        return;
      }

      // 7. 对于 Blogs/News/Reports/Policy，调用后端API动态提取（使用队列和缓存）
      // 传递 resourceId 以支持服务端缓存，下次请求直接从数据库获取
      const typesWithThumbnailExtraction = ['BLOG', 'NEWS', 'REPORT', 'POLICY'];
      if (
        typesWithThumbnailExtraction.includes(resource.type) &&
        resource.sourceUrl
      ) {
        try {
          const result = await fetchThumbnailWithQueue(
            resource.sourceUrl,
            resource.type,
            resource.id // 传递 resourceId 以启用服务端缓存
          );
          if (isMounted && result) {
            setThumbnailUrl(result);
            setIsLoading(false);
            return;
          }
        } catch (error) {
          logger.error('Failed to fetch thumbnail:', error);
        }
      }

      // 8. 没有可用缩略图
      if (isMounted) {
        setThumbnailUrl(null);
        setIsLoading(false);
      }
    };

    fetchThumbnail();

    return () => {
      isMounted = false;
    };
  }, [
    resource.id,
    resource.sourceUrl,
    resource.type,
    resource.thumbnailUrl,
    resource.metadata?.imageUrl,
  ]);

  // 通过代理加载图片的 URL
  const getProxiedUrl = (url: string): string => {
    return `${config.apiUrl}/proxy/image?url=${encodeURIComponent(url)}`;
  };

  const handleImageError = () => {
    // 如果还没尝试过代理，先尝试代理
    if (!useProxy && thumbnailUrl) {
      setUseProxy(true);
      return;
    }
    // 代理也失败了，显示默认图标
    setHasError(true);
    setThumbnailUrl(null);
  };

  // Filter out known broken/placeholder images
  const isPlaceholderImage = (url: string): boolean => {
    if (!url) return true;
    const placeholderPatterns = [
      /arxiv-logo/i,
      /placeholder/i,
      /default-image/i,
      /no-image/i,
      /blank.(png|jpg|gif)/i,
    ];
    return placeholderPatterns.some((pattern) => pattern.test(url));
  };

  // 获取类型对应的图标
  const TypeIcon = () => {
    const iconClass = 'h-10 w-10';
    switch (resource.type) {
      case 'PAPER':
        return (
          <svg
            className={`${iconClass} text-blue-600`}
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11zM8 15.5h8v1H8v-1zm0-3h8v1H8v-1zm0-3h5v1H8v-1z" />
          </svg>
        );
      case 'BLOG':
        return (
          <svg
            className={`${iconClass} text-green-600`}
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" />
          </svg>
        );
      case 'NEWS':
        return (
          <svg
            className={`${iconClass} text-orange-600`}
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M19 3H5c-1.11 0-2 .89-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.11-.9-2-2-2zm-1 16H6c-.55 0-1-.45-1-1V6c0-.55.45-1 1-1h12c.55 0 1 .45 1 1v12c0 .55-.45 1-1 1zM7 12h2v2H7zm0-3h2v2H7zm0-3h2v2H7zm4 6h6v2h-6zm0-3h6v2h-6zm0-3h6v2h-6z" />
          </svg>
        );
      case 'YOUTUBE':
      case 'YOUTUBE_VIDEO':
        return (
          <svg
            className={`${iconClass} text-red-600`}
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
          </svg>
        );
      case 'REPORT':
        return (
          <svg
            className={`${iconClass} text-indigo-600`}
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14h-2V9h-2V7h4v10z" />
          </svg>
        );
      case 'POLICY':
        return (
          <svg
            className={`${iconClass} text-amber-600`}
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z" />
          </svg>
        );
      case 'PROJECT':
        return (
          <svg
            className={`${iconClass} text-purple-600`}
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
          </svg>
        );
      default:
        return (
          <svg
            className={`${iconClass} text-gray-400`}
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11z" />
          </svg>
        );
    }
  };

  // 显示加载状态
  if (isLoading) {
    return <div className={`${className} animate-pulse bg-gray-200`} />;
  }

  // 有缩略图且未出错，显示图片（过滤占位图）
  if (thumbnailUrl && !hasError && !isPlaceholderImage(thumbnailUrl)) {
    // 如果直接加载失败，使用代理
    const imgSrc = useProxy ? getProxiedUrl(thumbnailUrl) : thumbnailUrl;
    return (
      <img
        src={imgSrc}
        alt={resource.title}
        className="h-full w-full bg-white object-contain"
        onError={handleImageError}
      />
    );
  }

  // 无缩略图或出错，显示类型图标
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
      <TypeIcon />
    </div>
  );
}
