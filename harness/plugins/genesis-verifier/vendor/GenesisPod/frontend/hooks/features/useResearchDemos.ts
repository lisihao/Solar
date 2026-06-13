/**
 * useResearchDemos - Research Demos API Hook
 *
 * CRUD + generate operations for research demos within a project
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';

export interface ResearchDemo {
  id: string;
  ideaId: string;
  projectId: string;
  title: string;
  htmlContent: string;
  status: 'PENDING' | 'GENERATING' | 'COMPLETED' | 'FAILED';
  error: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  idea?: {
    id: string;
    title: string;
    description?: string;
    agentRole: string | null;
  };
}

interface UseResearchDemosResult {
  demos: ResearchDemo[];
  isLoading: boolean;
  error: string | null;
  fetchDemos: (
    signal?: AbortSignal,
    options?: { silent?: boolean }
  ) => Promise<void>;
  generateDemo: (
    ideaId: string,
    title?: string
  ) => Promise<ResearchDemo | null>;
  getDemo: (demoId: string) => Promise<ResearchDemo | null>;
  deleteDemo: (demoId: string) => Promise<boolean>;
}

export function useResearchDemos(projectId: string): UseResearchDemosResult {
  const [demos, setDemos] = useState<ResearchDemo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDemos = useCallback(
    async (signal?: AbortSignal, { silent = false } = {}) => {
      if (!silent) {
        setIsLoading(true);
        setError(null);
      }
      try {
        const res = await fetch(
          `${config.apiBaseUrl}/api/v1/ai-studio/projects/${projectId}/demos`,
          { headers: { ...getAuthHeader() }, signal }
        );
        if (!res.ok) throw new Error('Failed to fetch demos');
        const result = await res.json();
        const data = result?.data ?? result;
        setDemos(Array.isArray(data) ? data : []);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const msg =
          err instanceof Error ? err.message : 'Failed to fetch demos';
        if (!silent) setError(msg);
        logger.error('Failed to fetch research demos:', err);
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [projectId]
  );

  const generateDemo = useCallback(
    async (ideaId: string, title?: string): Promise<ResearchDemo | null> => {
      try {
        const res = await fetch(
          `${config.apiBaseUrl}/api/v1/ai-studio/projects/${projectId}/ideas/${ideaId}/generate-demo`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({ title }),
          }
        );
        if (!res.ok) throw new Error('Failed to generate demo');
        const result = await res.json();
        const demo = result?.data ?? result;
        setDemos((prev) => [demo, ...prev]);
        return demo;
      } catch (err) {
        logger.error('Failed to generate demo:', err);
        return null;
      }
    },
    [projectId]
  );

  const getDemo = useCallback(
    async (demoId: string): Promise<ResearchDemo | null> => {
      try {
        const res = await fetch(
          `${config.apiBaseUrl}/api/v1/ai-studio/projects/${projectId}/demos/${demoId}`,
          { headers: { ...getAuthHeader() } }
        );
        if (!res.ok) throw new Error('Failed to get demo');
        const result = await res.json();
        return result?.data ?? result;
      } catch (err) {
        logger.error('Failed to get demo:', err);
        return null;
      }
    },
    [projectId]
  );

  const deleteDemo = useCallback(
    async (demoId: string): Promise<boolean> => {
      try {
        const res = await fetch(
          `${config.apiBaseUrl}/api/v1/ai-studio/projects/${projectId}/demos/${demoId}`,
          {
            method: 'DELETE',
            headers: { ...getAuthHeader() },
          }
        );
        if (!res.ok) throw new Error('Failed to delete demo');
        setDemos((prev) => prev.filter((d) => d.id !== demoId));
        return true;
      } catch (err) {
        logger.error('Failed to delete demo:', err);
        return false;
      }
    },
    [projectId]
  );

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    void fetchDemos(controller.signal);
    return () => controller.abort();
  }, [projectId, fetchDemos]);

  // Poll for in-progress demos (PENDING/GENERATING) until they complete
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasPendingRef = useRef(false);

  // Track pending status in ref to avoid effect re-triggering on every demos change
  const hasPending = demos.some(
    (d) => d.status === 'PENDING' || d.status === 'GENERATING'
  );

  useEffect(() => {
    // Only start/stop polling when pending status actually changes
    if (hasPending === hasPendingRef.current) return;
    hasPendingRef.current = hasPending;

    if (hasPending && !pollTimerRef.current) {
      pollTimerRef.current = setInterval(() => {
        void fetchDemos(undefined, { silent: true });
      }, 5000);
    } else if (!hasPending && pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, [hasPending, fetchDemos]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  return {
    demos,
    isLoading,
    error,
    fetchDemos,
    generateDemo,
    getDemo,
    deleteDemo,
  };
}

export default useResearchDemos;
