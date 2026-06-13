/**
 * SWR Configuration for AI Social Module
 *
 * Global SWR configuration and options for social media content caching
 */

import { SWRConfiguration } from 'swr';

/**
 * Global SWR configuration for AI Social module
 */
export const socialSWRConfig: SWRConfiguration = {
  // Retry configuration
  errorRetryCount: 3,
  errorRetryInterval: 5000, // 5 seconds
  shouldRetryOnError: true,

  // Loading state
  loadingTimeout: 3000,
  onLoadingSlow: (key) => {
    console.warn('[SWR] Slow loading for:', key);
  },

  // Error handling
  onError: (error, key) => {
    console.error('[SWR] Error for key:', key, error);
  },

  // Success callback
  onSuccess: (data, key) => {
    // Optional: Log successful fetches in development
    if (process.env.NODE_ENV === 'development') {
      console.debug('[SWR] Success for key:', key);
    }
  },

  // Dedupe requests within 2 seconds
  dedupingInterval: 2000,

  // Focus revalidation
  revalidateOnFocus: true,

  // Reconnect revalidation
  revalidateOnReconnect: true,

  // Default revalidation interval (disabled by default, configured per-hook)
  revalidateOnMount: true,
};

/**
 * SWR options for connections list
 * - 5 minute cache
 * - Revalidate on focus
 * - Revalidate on reconnect
 */
export const connectionsSWROptions: SWRConfiguration = {
  ...socialSWRConfig,
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  refreshInterval: 5 * 60 * 1000, // 5 minutes
  dedupingInterval: 2000,
};

/**
 * SWR options for contents list
 * - 1 minute cache
 * - Revalidate on focus
 * - Revalidate on reconnect
 */
export const contentsSWROptions: SWRConfiguration = {
  ...socialSWRConfig,
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  refreshInterval: 60 * 1000, // 1 minute
  dedupingInterval: 2000,
};

/**
 * SWR options for single content detail
 * - On-demand fetching
 * - Revalidate on focus (for editing scenarios)
 * - No automatic refresh (manual control)
 */
export const contentDetailSWROptions: SWRConfiguration = {
  ...socialSWRConfig,
  revalidateOnFocus: false, // Disable during editing
  revalidateOnReconnect: true,
  refreshInterval: 0, // No automatic refresh
  dedupingInterval: 2000,
};

/**
 * SWR options for publish logs
 * - Short cache (30 seconds)
 * - Frequent revalidation during publishing
 */
export const publishLogsSWROptions: SWRConfiguration = {
  ...socialSWRConfig,
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  refreshInterval: 30 * 1000, // 30 seconds
  dedupingInterval: 1000,
};

/**
 * Generate SWR cache key for connections
 */
export function getConnectionsKey() {
  return '/api/ai-social/connections';
}

/**
 * Generate SWR cache key for single connection
 */
export function getConnectionKey(id: string) {
  return `/api/ai-social/connections/${id}`;
}

/**
 * Generate SWR cache key for connection by platform
 */
export function getConnectionByPlatformKey(platformType: string) {
  return `/api/ai-social/connections/platform/${platformType}`;
}

/**
 * Generate SWR cache key for contents list
 */
export function getContentsKey(options?: {
  status?: string;
  contentType?: string;
  sourceType?: string;
  reviewStatus?: string;
  limit?: number;
  offset?: number;
}) {
  if (!options || Object.keys(options).length === 0) {
    return '/api/ai-social/contents';
  }

  const params = new URLSearchParams();
  if (options.status) params.append('status', options.status);
  if (options.contentType) params.append('contentType', options.contentType);
  if (options.sourceType) params.append('sourceType', options.sourceType);
  if (options.reviewStatus) params.append('reviewStatus', options.reviewStatus);
  if (options.limit) params.append('limit', options.limit.toString());
  if (options.offset) params.append('offset', options.offset.toString());

  return `/api/ai-social/contents?${params.toString()}`;
}

/**
 * Generate SWR cache key for single content
 */
export function getContentKey(id: string) {
  return `/api/ai-social/contents/${id}`;
}

/**
 * Generate SWR cache key for publish logs
 */
export function getPublishLogsKey(contentId: string) {
  return `/api/ai-social/contents/${contentId}/logs`;
}

/**
 * Cache key patterns for invalidation
 */
export const CACHE_KEY_PATTERNS = {
  connections: /^\/api\/ai-social\/connections/,
  contents: /^\/api\/ai-social\/contents/,
  publishLogs: /^\/api\/ai-social\/contents\/.*\/logs/,
};
