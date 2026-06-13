'use client';

import { useEffect } from 'react';

import { logger } from '@/lib/utils/logger';
/**
 * ChunkLoadError 处理组件
 *
 * 当 Next.js 部署新版本后，旧的 chunk 文件被删除，
 * 但用户浏览器可能缓存了旧的 HTML 引用旧的 chunk。
 * 这会导致 ChunkLoadError。
 *
 * 解决方案：检测到 ChunkLoadError 时自动刷新页面
 */
export function ChunkErrorHandler() {
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      const error = event.error;

      // 检测 ChunkLoadError
      if (
        error?.name === 'ChunkLoadError' ||
        error?.message?.includes('Loading chunk') ||
        error?.message?.includes('ChunkLoadError')
      ) {
        logger.warn(
          '[ChunkErrorHandler] Detected ChunkLoadError, reloading page...'
        );

        // 防止无限刷新循环
        const lastReloadKey = 'chunk_error_last_reload';
        const lastReload = sessionStorage.getItem(lastReloadKey);
        const now = Date.now();

        if (lastReload && now - parseInt(lastReload) < 10000) {
          // 10秒内已经刷新过，不再刷新
          logger.warn(
            '[ChunkErrorHandler] Recently reloaded, skipping to prevent loop'
          );
          return;
        }

        sessionStorage.setItem(lastReloadKey, now.toString());

        // 刷新页面（强制从服务器加载）
        window.location.reload();
      }
    };

    // 处理未捕获的 Promise rejection（动态 import 失败）
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;

      if (
        reason?.name === 'ChunkLoadError' ||
        reason?.message?.includes('Loading chunk') ||
        reason?.message?.includes('ChunkLoadError') ||
        reason?.message?.includes('Failed to fetch dynamically imported module')
      ) {
        logger.warn(
          '[ChunkErrorHandler] Detected ChunkLoadError in Promise, reloading page...'
        );

        const lastReloadKey = 'chunk_error_last_reload';
        const lastReload = sessionStorage.getItem(lastReloadKey);
        const now = Date.now();

        if (lastReload && now - parseInt(lastReload) < 10000) {
          return;
        }

        sessionStorage.setItem(lastReloadKey, now.toString());
        window.location.reload();
      }
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener(
        'unhandledrejection',
        handleUnhandledRejection
      );
    };
  }, []);

  return null;
}
