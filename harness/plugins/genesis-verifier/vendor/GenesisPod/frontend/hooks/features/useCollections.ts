'use client';

import { useState, useCallback } from 'react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';

import { logger } from '@/lib/utils/logger';

// Helper to unwrap standard API response format { success: true, data: T }
function unwrapResponse<T>(result: unknown): T {
  if (
    result &&
    typeof result === 'object' &&
    'success' in result &&
    'data' in result
  ) {
    return (result as { data: T }).data;
  }
  return result as T;
}

export enum ReadStatus {
  UNREAD = 'UNREAD',
  READING = 'READING',
  COMPLETED = 'COMPLETED',
  ARCHIVED = 'ARCHIVED',
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  isDefault?: boolean;
  isPublic: boolean;
  itemCount?: number;
  createdAt: string;
  items?: CollectionItem[];
}

export interface CollectionItem {
  id: string;
  collectionId: string;
  resourceId: string;
  note?: string;
  readStatus: ReadStatus;
  readProgress: number;
  lastReadAt?: string;
  tags: string[];
  position: number;
  addedAt: string;
  resource: Resource;
  collection?: {
    id: string;
    name: string;
  };
}

export interface Resource {
  id: string;
  type: string;
  title: string;
  abstract?: string;
  publishedAt: string;
  sourceUrl: string;
  thumbnailUrl?: string;
  upvoteCount?: number;
}

export interface Tag {
  name: string;
  count: number;
}

export interface UserStats {
  totalItems: number;
  recentItems: number;
  byStatus: Record<string, number>;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

/**
 * Collections API Hook
 * Provides all collection-related API operations
 */
export function useCollections() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleError = (err: unknown, message: string) => {
    logger.error(message, err);
    setError(message);
    throw err;
  };

  /**
   * Get all user collections
   */
  const getCollections = useCallback(async (): Promise<Collection[]> => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/v1/collections`, {
        headers: getAuthHeader(),
      });
      if (!response.ok) throw new Error('Failed to fetch collections');
      return unwrapResponse(await response.json());
    } catch (err) {
      return handleError(err, 'Failed to load collections');
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Get single collection by ID
   */
  const getCollection = useCallback(async (id: string): Promise<Collection> => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/collections/${id}`,
        {
          headers: getAuthHeader(),
        }
      );
      if (!response.ok) throw new Error('Failed to fetch collection');
      return unwrapResponse(await response.json());
    } catch (err) {
      return handleError(err, 'Failed to load collection');
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Create a new collection
   */
  const createCollection = useCallback(
    async (data: {
      name: string;
      description?: string;
      icon?: string;
      color?: string;
      isPublic?: boolean;
    }): Promise<Collection> => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/collections`,
          {
            method: 'POST',
            headers: {
              ...getAuthHeader(),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
          }
        );
        if (!response.ok) throw new Error('Failed to create collection');
        return unwrapResponse(await response.json());
      } catch (err) {
        return handleError(err, 'Failed to create collection');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * Update a collection
   */
  const updateCollection = useCallback(
    async (
      id: string,
      data: {
        name?: string;
        description?: string;
        icon?: string;
        color?: string;
        isPublic?: boolean;
      }
    ): Promise<Collection> => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/collections/${id}`,
          {
            method: 'PATCH',
            headers: {
              ...getAuthHeader(),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
          }
        );
        if (!response.ok) throw new Error('Failed to update collection');
        return unwrapResponse(await response.json());
      } catch (err) {
        return handleError(err, 'Failed to update collection');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * Delete a collection
   */
  const deleteCollection = useCallback(async (id: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/collections/${id}`,
        {
          method: 'DELETE',
          headers: getAuthHeader(),
        }
      );
      if (!response.ok) throw new Error('Failed to delete collection');
    } catch (err) {
      return handleError(err, 'Failed to delete collection');
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Add item to collection
   */
  const addToCollection = useCallback(
    async (
      collectionId: string,
      resourceId: string,
      note?: string
    ): Promise<{ success: boolean; item?: CollectionItem }> => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/collections/${collectionId}/items`,
          {
            method: 'POST',
            headers: {
              ...getAuthHeader(),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ resourceId, note }),
          }
        );
        if (!response.ok) throw new Error('Failed to add to collection');
        return unwrapResponse(await response.json());
      } catch (err) {
        return handleError(err, 'Failed to add to collection');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * Remove item from collection
   */
  const removeFromCollection = useCallback(
    async (collectionId: string, resourceId: string): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/collections/${collectionId}/items/${resourceId}`,
          {
            method: 'DELETE',
            headers: getAuthHeader(),
          }
        );
        if (!response.ok) throw new Error('Failed to remove from collection');
      } catch (err) {
        return handleError(err, 'Failed to remove from collection');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * Update collection item (tags, read status, etc.)
   */
  const updateItem = useCallback(
    async (
      itemId: string,
      data: {
        note?: string;
        readStatus?: ReadStatus;
        readProgress?: number;
        tags?: string[];
        position?: number;
      }
    ): Promise<CollectionItem> => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/collections/items/${itemId}`,
          {
            method: 'PATCH',
            headers: {
              ...getAuthHeader(),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
          }
        );
        if (!response.ok) throw new Error('Failed to update item');
        return unwrapResponse(await response.json());
      } catch (err) {
        return handleError(err, 'Failed to update item');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * Get user's tags
   */
  const getTags = useCallback(async (): Promise<Tag[]> => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/collections/tags/all`,
        {
          headers: getAuthHeader(),
        }
      );
      if (!response.ok) throw new Error('Failed to fetch tags');
      return unwrapResponse(await response.json());
    } catch (err) {
      return handleError(err, 'Failed to load tags');
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Get user stats
   */
  const getStats = useCallback(async (): Promise<UserStats> => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/collections/stats/summary`,
        {
          headers: getAuthHeader(),
        }
      );
      if (!response.ok) throw new Error('Failed to fetch stats');
      return unwrapResponse(await response.json());
    } catch (err) {
      return handleError(err, 'Failed to load stats');
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Get paginated items
   */
  const getItemsPaginated = useCallback(
    async (options: {
      collectionId?: string;
      page?: number;
      limit?: number;
      status?: ReadStatus;
      tag?: string;
      search?: string;
      sortBy?: 'addedAt' | 'title' | 'publishedAt' | 'readProgress';
      sortOrder?: 'asc' | 'desc';
    }): Promise<PaginatedResult<CollectionItem>> => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (options.collectionId)
          params.append('collectionId', options.collectionId);
        if (options.page) params.append('page', String(options.page));
        if (options.limit) params.append('limit', String(options.limit));
        if (options.status) params.append('status', options.status);
        if (options.tag) params.append('tag', options.tag);
        if (options.search) params.append('search', options.search);
        if (options.sortBy) params.append('sortBy', options.sortBy);
        if (options.sortOrder) params.append('sortOrder', options.sortOrder);

        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/collections/items/paginated?${params}`,
          {
            headers: getAuthHeader(),
          }
        );
        if (!response.ok) throw new Error('Failed to fetch items');
        return unwrapResponse(await response.json());
      } catch (err) {
        return handleError(err, 'Failed to load items');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * Batch move items to another collection
   */
  const batchMoveItems = useCallback(
    async (
      itemIds: string[],
      targetCollectionId: string
    ): Promise<{ success: boolean; movedCount: number }> => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/collections/items/batch/move`,
          {
            method: 'POST',
            headers: {
              ...getAuthHeader(),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ itemIds, targetCollectionId }),
          }
        );
        if (!response.ok) throw new Error('Failed to move items');
        return unwrapResponse(await response.json());
      } catch (err) {
        return handleError(err, 'Failed to move items');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * Batch delete items
   */
  const batchDeleteItems = useCallback(
    async (
      itemIds: string[]
    ): Promise<{ success: boolean; deletedCount: number }> => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/collections/items/batch/delete`,
          {
            method: 'POST',
            headers: {
              ...getAuthHeader(),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ itemIds }),
          }
        );
        if (!response.ok) throw new Error('Failed to delete items');
        return unwrapResponse(await response.json());
      } catch (err) {
        return handleError(err, 'Failed to delete items');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * Batch update tags
   */
  const batchUpdateTags = useCallback(
    async (
      itemIds: string[],
      tags: string[],
      operation: 'add' | 'remove' | 'set' = 'set'
    ): Promise<{ success: boolean; updatedCount: number }> => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/collections/items/batch/tags`,
          {
            method: 'POST',
            headers: {
              ...getAuthHeader(),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ itemIds, tags, operation }),
          }
        );
        if (!response.ok) throw new Error('Failed to update tags');
        return unwrapResponse(await response.json());
      } catch (err) {
        return handleError(err, 'Failed to update tags');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * Batch update read status
   */
  const batchUpdateStatus = useCallback(
    async (
      itemIds: string[],
      status: ReadStatus
    ): Promise<{ success: boolean; updatedCount: number }> => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/collections/items/batch/status`,
          {
            method: 'POST',
            headers: {
              ...getAuthHeader(),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ itemIds, status }),
          }
        );
        if (!response.ok) throw new Error('Failed to update status');
        return unwrapResponse(await response.json());
      } catch (err) {
        return handleError(err, 'Failed to update status');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return {
    loading,
    error,
    // Collection operations
    getCollections,
    getCollection,
    createCollection,
    updateCollection,
    deleteCollection,
    // Item operations
    addToCollection,
    removeFromCollection,
    updateItem,
    // Query operations
    getTags,
    getStats,
    getItemsPaginated,
    // Batch operations
    batchMoveItems,
    batchDeleteItems,
    batchUpdateTags,
    batchUpdateStatus,
  };
}
