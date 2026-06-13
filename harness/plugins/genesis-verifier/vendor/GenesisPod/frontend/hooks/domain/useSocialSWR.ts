/**
 * SWR Hooks for AI Social Module
 *
 * Data fetching hooks with SWR caching for optimized performance
 */

import useSWR from 'swr';
import type { SWRResponse } from 'swr';
import {
  getConnections,
  getConnection,
  getConnectionByPlatform,
  getContents,
  getContent,
  getPublishLogs,
} from '@/services/ai-social/api';
import type {
  SocialPlatformConnection,
  SocialContent,
  SocialPublishLog,
  SocialPlatformType,
  SocialContentStatus,
  SocialContentType,
  SocialContentSourceType,
  SocialReviewStatus,
} from '@/services/ai-social/api';
import {
  connectionsSWROptions,
  contentsSWROptions,
  contentDetailSWROptions,
  publishLogsSWROptions,
  getConnectionsKey,
  getConnectionKey,
  getConnectionByPlatformKey,
  getContentsKey,
  getContentKey,
  getPublishLogsKey,
} from '@/lib/features/ai-social/social-config';

// ==================== Type Definitions ====================

export interface UseSocialConnectionsResult extends SWRResponse<
  SocialPlatformConnection[]
> {
  connections: SocialPlatformConnection[];
  isLoading: boolean;
  isValidating: boolean;
  refresh: () => Promise<void>;
}

export interface UseSocialConnectionResult extends SWRResponse<SocialPlatformConnection | null> {
  connection: SocialPlatformConnection | null;
  isLoading: boolean;
  isValidating: boolean;
  refresh: () => Promise<void>;
}

export interface UseSocialContentsResult extends SWRResponse<{
  items: SocialContent[];
  total: number;
}> {
  contents: SocialContent[];
  total: number;
  isLoading: boolean;
  isValidating: boolean;
  refresh: () => Promise<void>;
}

export interface UseSocialContentResult extends SWRResponse<SocialContent | null> {
  content: SocialContent | null;
  isLoading: boolean;
  isValidating: boolean;
  refresh: () => Promise<void>;
}

export interface UseSocialPublishLogsResult extends SWRResponse<
  SocialPublishLog[]
> {
  logs: SocialPublishLog[];
  isLoading: boolean;
  isValidating: boolean;
  refresh: () => Promise<void>;
}

// ==================== Connection Hooks ====================

/**
 * Fetch all platform connections with SWR caching
 *
 * Features:
 * - 5 minute cache
 * - Revalidate on window focus
 * - Revalidate on reconnect
 * - Automatic deduplication
 *
 * @param enabled - Enable/disable fetching (default: true)
 * @returns SWR response with connections data
 */
export function useSocialConnectionsSWR(
  enabled = true
): UseSocialConnectionsResult {
  const key = enabled ? getConnectionsKey() : null;

  const swr = useSWR<SocialPlatformConnection[]>(
    key,
    async () => {
      return await getConnections();
    },
    connectionsSWROptions
  );

  return {
    ...swr,
    connections: swr.data || [],
    isLoading: !swr.error && !swr.data,
    isValidating: swr.isValidating,
    refresh: async () => {
      await swr.mutate();
    },
  };
}

/**
 * Fetch single connection by ID with SWR caching
 *
 * @param id - Connection ID
 * @param enabled - Enable/disable fetching (default: true)
 * @returns SWR response with connection data
 */
export function useSocialConnectionSWR(
  id: string | null,
  enabled = true
): UseSocialConnectionResult {
  const key = enabled && id ? getConnectionKey(id) : null;

  const swr = useSWR<SocialPlatformConnection | null>(
    key,
    async () => {
      if (!id) return null;
      return await getConnection(id);
    },
    connectionsSWROptions
  );

  return {
    ...swr,
    connection: swr.data || null,
    isLoading: !swr.error && !swr.data,
    isValidating: swr.isValidating,
    refresh: async () => {
      await swr.mutate();
    },
  };
}

/**
 * Fetch connection by platform type with SWR caching
 *
 * @param platformType - Platform type (WECHAT_MP, XIAOHONGSHU)
 * @param enabled - Enable/disable fetching (default: true)
 * @returns SWR response with connection data
 */
export function useSocialConnectionByPlatformSWR(
  platformType: SocialPlatformType | null,
  enabled = true
): UseSocialConnectionResult {
  const key =
    enabled && platformType ? getConnectionByPlatformKey(platformType) : null;

  const swr = useSWR<SocialPlatformConnection | null>(
    key,
    async () => {
      if (!platformType) return null;
      return await getConnectionByPlatform(platformType);
    },
    connectionsSWROptions
  );

  return {
    ...swr,
    connection: swr.data || null,
    isLoading: !swr.error && !swr.data,
    isValidating: swr.isValidating,
    refresh: async () => {
      await swr.mutate();
    },
  };
}

// ==================== Content Hooks ====================

/**
 * Fetch contents list with SWR caching
 *
 * Features:
 * - 1 minute cache
 * - Revalidate on window focus
 * - Revalidate on reconnect
 * - Supports filtering by status, type, source
 *
 * @param options - Filter options
 * @param enabled - Enable/disable fetching (default: true)
 * @returns SWR response with contents data
 */
export function useSocialContentsSWR(
  options?: {
    status?: SocialContentStatus;
    contentType?: SocialContentType;
    sourceType?: SocialContentSourceType;
    reviewStatus?: SocialReviewStatus;
    limit?: number;
    offset?: number;
  },
  enabled = true
): UseSocialContentsResult {
  const key = enabled ? getContentsKey(options) : null;

  const swr = useSWR<{ items: SocialContent[]; total: number }>(
    key,
    async () => {
      return await getContents(options);
    },
    contentsSWROptions
  );

  return {
    ...swr,
    contents: swr.data?.items || [],
    total: swr.data?.total || 0,
    isLoading: !swr.error && !swr.data,
    isValidating: swr.isValidating,
    refresh: async () => {
      await swr.mutate();
    },
  };
}

/**
 * Fetch single content by ID with SWR caching
 *
 * Features:
 * - On-demand caching
 * - No automatic refresh (manual control)
 * - Revalidate on reconnect
 * - Ideal for editing scenarios
 *
 * @param id - Content ID
 * @param enabled - Enable/disable fetching (default: true)
 * @returns SWR response with content data
 */
export function useSocialContentSWR(
  id: string | null,
  enabled = true
): UseSocialContentResult {
  const key = enabled && id ? getContentKey(id) : null;

  const swr = useSWR<SocialContent | null>(
    key,
    async () => {
      if (!id) return null;
      return await getContent(id);
    },
    contentDetailSWROptions
  );

  return {
    ...swr,
    content: swr.data || null,
    isLoading: !swr.error && !swr.data,
    isValidating: swr.isValidating,
    refresh: async () => {
      await swr.mutate();
    },
  };
}

// ==================== Publish Logs Hooks ====================

/**
 * Fetch publish logs for a content with SWR caching
 *
 * Features:
 * - 30 second cache
 * - Frequent revalidation during publishing
 * - Revalidate on focus and reconnect
 *
 * @param contentId - Content ID
 * @param enabled - Enable/disable fetching (default: true)
 * @returns SWR response with logs data
 */
export function useSocialPublishLogsSWR(
  contentId: string | null,
  enabled = true
): UseSocialPublishLogsResult {
  const key = enabled && contentId ? getPublishLogsKey(contentId) : null;

  const swr = useSWR<SocialPublishLog[]>(
    key,
    async () => {
      if (!contentId) return [];
      return await getPublishLogs(contentId);
    },
    publishLogsSWROptions
  );

  return {
    ...swr,
    logs: swr.data || [],
    isLoading: !swr.error && !swr.data,
    isValidating: swr.isValidating,
    refresh: async () => {
      await swr.mutate();
    },
  };
}

// ==================== Cache Mutation Helpers ====================

/**
 * Optimistically update connections cache after mutation
 *
 * @param mutate - SWR mutate function
 * @param updater - Function to update the cache
 */
export async function mutateConnections(
  mutate: UseSocialConnectionsResult['mutate'],
  updater: (current: SocialPlatformConnection[]) => SocialPlatformConnection[]
) {
  await mutate(async (current) => {
    if (!current) return current;
    return updater(current);
  }, false); // optimistic update without revalidation
}

/**
 * Optimistically update contents cache after mutation
 *
 * @param mutate - SWR mutate function
 * @param updater - Function to update the cache
 */
export async function mutateContents(
  mutate: UseSocialContentsResult['mutate'],
  updater: (current: { items: SocialContent[]; total: number }) => {
    items: SocialContent[];
    total: number;
  }
) {
  await mutate(async (current) => {
    if (!current) return current;
    return updater(current);
  }, false); // optimistic update without revalidation
}

/**
 * Invalidate and refresh all connections-related caches
 */
export function invalidateConnectionsCaches(
  mutate: (
    matcher: (key: unknown) => boolean,
    data?: unknown,
    opts?: { revalidate?: boolean }
  ) => Promise<unknown>
) {
  mutate(
    (key: unknown) => typeof key === 'string' && key.includes('/connections'),
    undefined,
    { revalidate: true }
  );
}

/**
 * Invalidate and refresh all contents-related caches
 */
export function invalidateContentsCaches(
  mutate: (
    matcher: (key: unknown) => boolean,
    data?: unknown,
    opts?: { revalidate?: boolean }
  ) => Promise<unknown>
) {
  mutate(
    (key: unknown) => typeof key === 'string' && key.includes('/contents'),
    undefined,
    { revalidate: true }
  );
}
