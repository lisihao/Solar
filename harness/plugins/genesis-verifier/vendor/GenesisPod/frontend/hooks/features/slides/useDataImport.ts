/**
 * AI Slides V5.0 - Data Import Hook
 *
 * Hook for importing content from platform sources:
 * - AI Research reports
 * - AI Writing projects
 * - AI Teams discussions
 * - Library resources
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

export type SlidesSourceType =
  | 'research'
  | 'research-project'
  | 'writing'
  | 'teams'
  | 'library';

export interface SourceListItem {
  id: string;
  title: string;
  type: SlidesSourceType;
  preview?: string;
  thumbnailUrl?: string;
  createdAt: string;
  metadata?: {
    pageCount?: number;
    wordCount?: number;
    imageCount?: number;
  };
}

export interface SourceSection {
  title: string;
  content: string;
  order: number;
  perspective?: string;
  data?: Record<string, unknown>;
}

export interface OutlineNode {
  id: string;
  title: string;
  level: number;
  children?: OutlineNode[];
}

export interface SourceChartData {
  type: string;
  title: string;
  data: {
    labels: string[];
    series: unknown[];
  };
  source?: string;
}

export interface Asset {
  id: string;
  type: 'image' | 'document' | 'video' | 'audio';
  url: string;
  title?: string;
  description?: string;
  thumbnailUrl?: string;
}

export interface Reference {
  id: string;
  title: string;
  url?: string;
  source?: string;
}

export interface SlidesSourceData {
  sourceText: string;
  sourceType: SlidesSourceType;
  sourceId?: string;
  sections?: SourceSection[];
  outline?: OutlineNode[];
  charts?: SourceChartData[];
  images?: Asset[];
  keyFindings?: string[];
  references?: Reference[];
  metadata?: {
    title?: string;
    createdAt?: string;
    language?: string;
    genre?: string;
    style?: string;
    wordCount?: number;
    topic?: string;
    agents?: string[];
  };
}

// ============================================
// Hook
// ============================================

export function useDataImport() {
  const { user, accessToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Memoize auth headers
  const authHeaders = useMemo(() => getAuthHeaders(accessToken), [accessToken]);

  // Fetch sources for a specific type
  const fetchSources = useCallback(
    async (type: SlidesSourceType): Promise<SourceListItem[]> => {
      if (!user?.id) {
        setError('User not authenticated');
        return [];
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/ai-office/slides/sources/${type}`, {
          headers: authHeaders,
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch ${type} sources`);
        }

        const result = await response.json();
        return result.data?.sources || result.sources || [];
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to fetch sources';
        logger.error(`[useDataImport] fetchSources(${type}) error:`, err);
        setError(message);
        return [];
      } finally {
        setLoading(false);
      }
    },
    [user?.id, authHeaders]
  );

  // Import from Research
  const importFromResearch = useCallback(
    async (topicId: string): Promise<SlidesSourceData | null> => {
      if (!user?.id) {
        setError('User not authenticated');
        return null;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/ai-office/slides/import/research/${topicId}`,
          { method: 'POST', headers: authHeaders }
        );

        if (!response.ok) {
          throw new Error('Failed to import from research');
        }

        const result = await response.json();
        return result.data?.data || result.data || null;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Import failed';
        logger.error('[useDataImport] importFromResearch error:', err);
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user?.id, authHeaders]
  );

  // Import from Writing
  const importFromWriting = useCallback(
    async (projectId: string): Promise<SlidesSourceData | null> => {
      if (!user?.id) {
        setError('User not authenticated');
        return null;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/ai-office/slides/import/writing/${projectId}`,
          { method: 'POST', headers: authHeaders }
        );

        if (!response.ok) {
          throw new Error('Failed to import from writing');
        }

        const result = await response.json();
        return result.data?.data || result.data || null;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Import failed';
        logger.error('[useDataImport] importFromWriting error:', err);
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user?.id, authHeaders]
  );

  // Import from Teams
  const importFromTeams = useCallback(
    async (topicId: string): Promise<SlidesSourceData | null> => {
      if (!user?.id) {
        setError('User not authenticated');
        return null;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/ai-office/slides/import/teams/${topicId}`,
          { method: 'POST', headers: authHeaders }
        );

        if (!response.ok) {
          throw new Error('Failed to import from teams');
        }

        const result = await response.json();
        return result.data?.data || result.data || null;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Import failed';
        logger.error('[useDataImport] importFromTeams error:', err);
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user?.id, authHeaders]
  );

  // Import from Research Project
  const importFromResearchProject = useCallback(
    async (
      projectId: string,
      outputId?: string
    ): Promise<SlidesSourceData | null> => {
      if (!user?.id) {
        setError('User not authenticated');
        return null;
      }

      setLoading(true);
      setError(null);

      try {
        const url = outputId
          ? `/api/ai-office/slides/import/research-project/${projectId}?outputId=${outputId}`
          : `/api/ai-office/slides/import/research-project/${projectId}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: authHeaders,
        });

        if (!response.ok) {
          throw new Error('Failed to import from research project');
        }

        const result = await response.json();
        return result.data?.data || result.data || null;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Import failed';
        logger.error('[useDataImport] importFromResearchProject error:', err);
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user?.id, authHeaders]
  );

  // Import from Library
  const importFromLibrary = useCallback(
    async (resourceIds: string[]): Promise<Asset[]> => {
      if (!user?.id) {
        setError('User not authenticated');
        return [];
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/ai-office/slides/import/library`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ resourceIds }),
        });

        if (!response.ok) {
          throw new Error('Failed to import from library');
        }

        const result = await response.json();
        return result.data?.assets || result.assets || [];
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Import failed';
        logger.error('[useDataImport] importFromLibrary error:', err);
        setError(message);
        return [];
      } finally {
        setLoading(false);
      }
    },
    [user?.id, authHeaders]
  );

  return {
    loading,
    error,
    fetchSources,
    importFromResearch,
    importFromResearchProject,
    importFromWriting,
    importFromTeams,
    importFromLibrary,
  };
}
