/**
 * Custom hook for managing bookmarks
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/utils/auth';
import { config } from '@/lib/utils/config';

import { logger } from '@/lib/utils/logger';
import { toast } from '@/stores';
export function useBookmarks() {
  const { user } = useAuth();
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());
  const [defaultCollectionId, setDefaultCollectionId] = useState<string | null>(
    null
  );

  const loadBookmarks = useCallback(async () => {
    // Only load bookmarks if user is authenticated
    if (!user) {
      return;
    }

    try {
      const authHeaders = getAuthHeader();

      // Get all collections
      const response = await fetch(`${config.apiBaseUrl}/api/v1/collections`, {
        headers: authHeaders,
      });

      if (response.ok) {
        const result = await response.json();
        // API returns { success, data: [...] } format
        const collections = Array.isArray(result?.data)
          ? result.data
          : Array.isArray(result)
            ? result
            : [];

        let defaultCollection = collections.find(
          (c: Record<string, unknown>) => c.name === '我的收藏'
        );

        if (!defaultCollection) {
          // Create default collection
          const createResponse = await fetch(
            `${config.apiBaseUrl}/api/v1/collections`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...authHeaders,
              },
              body: JSON.stringify({
                name: '我的收藏',
                description: '默认收藏集',
                isPublic: false,
              }),
            }
          );

          if (createResponse.ok) {
            const createResult = await createResponse.json();
            // API returns { success, data: collection } format
            defaultCollection = createResult?.data ?? createResult;
          }
        }

        if (defaultCollection) {
          setDefaultCollectionId(defaultCollection.id);

          // Load bookmarked resource IDs
          const bookmarkedIds = new Set<string>(
            (defaultCollection.items || []).map(
              (item: Record<string, unknown>) => item.resourceId as string
            )
          );
          setBookmarks(bookmarkedIds);
        }
      }
    } catch (err) {
      logger.error('Failed to load bookmarks:', err);
    }
  }, [user]);

  useEffect(() => {
    loadBookmarks();
  }, [loadBookmarks]);

  const isBookmarked = (resourceId: string) => {
    return bookmarks.has(resourceId);
  };

  const toggleBookmark = async (
    resourceId: string,
    e?: React.MouseEvent
  ): Promise<void> => {
    if (e) {
      e.stopPropagation();
    }

    if (!user) {
      toast.warning('Please log in first');
      return;
    }

    if (!defaultCollectionId) {
      toast.warning('Default collection not found');
      return;
    }

    try {
      const isCurrentlyBookmarked = bookmarks.has(resourceId);

      if (isCurrentlyBookmarked) {
        // Remove from collection
        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/collections/${defaultCollectionId}/items/${resourceId}`,
          {
            method: 'DELETE',
            headers: getAuthHeader(),
          }
        );

        if (response.ok) {
          setBookmarks((prev) => {
            const newSet = new Set(prev);
            newSet.delete(resourceId);
            return newSet;
          });
        } else {
          toast.error('Failed to remove bookmark');
        }
      } else {
        // Add to collection
        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/collections/${defaultCollectionId}/items`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...getAuthHeader(),
            },
            body: JSON.stringify({ resourceId }),
          }
        );

        if (response.ok) {
          setBookmarks((prev) => new Set([...prev, resourceId]));
        } else {
          toast.error('Failed to add bookmark');
        }
      }
    } catch (err) {
      logger.error('Failed to toggle bookmark:', err);
      toast.error('Bookmark operation failed');
    }
  };

  return {
    bookmarks,
    defaultCollectionId,
    isBookmarked,
    toggleBookmark,
    loadBookmarks,
  };
}
