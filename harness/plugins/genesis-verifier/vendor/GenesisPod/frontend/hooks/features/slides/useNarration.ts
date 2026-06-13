/**
 * AI Slides V5.0 - Narration Hook
 *
 * Hook for generating and managing voice narrations for slides
 */

import { useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { logger } from '@/lib/utils/logger';

/**
 * Get auth headers for API requests
 */
function getAuthHeaders(accessToken: string | null): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  return headers;
}

// ============================================
// Types
// ============================================

export type NarrationStyle =
  | 'formal'
  | 'casual'
  | 'professional'
  | 'storytelling';

export interface NarrationOptions {
  /** Narration style */
  style?: NarrationStyle;
  /** Language */
  language?: 'zh' | 'en';
  /** Target audience */
  targetAudience?: string;
  /** Words per minute */
  wordsPerMinute?: number;
}

export interface Narration {
  pageIndex: number;
  script: string;
  audioUrl?: string;
  estimatedDuration: number;
}

export interface NarrationResult {
  narrations: Narration[];
  totalDuration: number;
  stats?: {
    totalPages: number;
    totalWords: number;
    averageWordsPerPage: number;
  };
}

// ============================================
// Hook
// ============================================

export function useNarration() {
  const { user, accessToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Memoize auth headers
  const authHeaders = useMemo(() => getAuthHeaders(accessToken), [accessToken]);

  /**
   * Generate narrations for a mission
   */
  const generateNarrations = useCallback(
    async (
      missionId: string,
      options?: NarrationOptions
    ): Promise<NarrationResult | null> => {
      if (!user?.id) {
        setError('User not authenticated');
        return null;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/ai-office/slides/narrations/${missionId}`,
          {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(options || {}),
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || 'Failed to generate narrations');
        }

        const result = await response.json();
        return result.data as NarrationResult;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to generate narrations';
        logger.error('[useNarration] generateNarrations error:', err);
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user?.id, authHeaders]
  );

  /**
   * Get existing narrations for a mission
   */
  const getNarrations = useCallback(
    async (missionId: string): Promise<NarrationResult | null> => {
      if (!user?.id) {
        setError('User not authenticated');
        return null;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/ai-office/slides/narrations/${missionId}`,
          {
            method: 'GET',
            headers: authHeaders,
          }
        );

        if (!response.ok) {
          if (response.status === 404) {
            // No narrations yet
            return { narrations: [], totalDuration: 0 };
          }
          throw new Error('Failed to get narrations');
        }

        const result = await response.json();
        return result.data as NarrationResult;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to get narrations';
        logger.error('[useNarration] getNarrations error:', err);
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user?.id, authHeaders]
  );

  return {
    loading,
    error,
    generateNarrations,
    getNarrations,
  };
}
