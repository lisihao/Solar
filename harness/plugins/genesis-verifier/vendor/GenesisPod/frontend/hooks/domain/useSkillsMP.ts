/**
 * SkillsMP Hook
 *
 * 提供 AI Skills 页面的数据获取功能
 */

import { useState, useCallback } from 'react';
import { useApiGet, useApiPost } from '../core';

// Types
export interface SkillItem {
  id: string;
  name: string;
  description: string;
  category: string;
  author: string;
  stars: number;
  downloads: string;
  tags: string[];
  featured: boolean;
  url: string;
  lastUpdated: string;
}

export interface SkillsStats {
  totalSkills: number;
  lastUpdated: string | null;
  weeklyGrowth: number;
  featuredCount: number;
  categoryCount: number;
}

export interface TimelineDataPoint {
  date: string;
  count: number;
  cumulative: number;
}

export interface SkillCategory {
  id: string;
  name: string;
  count: number;
}

interface SearchParams {
  query?: string;
  category?: string;
  sortBy?: 'stars' | 'downloads' | 'name';
  limit?: number;
  offset?: number;
}

/**
 * Hook for fetching skills stats
 */
export function useSkillsStats() {
  const { data, error, loading, refresh } =
    useApiGet<SkillsStats>('/skills/stats');

  return {
    stats: data,
    isLoading: loading,
    error,
    refresh,
  };
}

/**
 * Hook for fetching timeline data
 */
export function useSkillsTimeline() {
  const { data, error, loading, refresh } =
    useApiGet<TimelineDataPoint[]>('/skills/timeline');

  return {
    timeline: data ?? [],
    isLoading: loading,
    error,
    refresh,
  };
}

/**
 * Hook for searching skills
 */
export function useSkillsSearch(params: SearchParams) {
  const queryString = new URLSearchParams();
  if (params.query) queryString.set('q', params.query);
  if (params.category && params.category !== 'all')
    queryString.set('category', params.category);
  if (params.sortBy) queryString.set('sortBy', params.sortBy);
  if (params.limit) queryString.set('limit', String(params.limit));
  if (params.offset) queryString.set('offset', String(params.offset));

  const url = `/skills/search?${queryString.toString()}`;

  const { data, error, loading, refresh } = useApiGet<{
    skills: SkillItem[];
    total: number;
  }>(url);

  return {
    skills: data?.skills ?? [],
    total: data?.total ?? 0,
    isLoading: loading,
    error,
    refresh,
  };
}

/**
 * Hook for fetching popular skills
 */
export function usePopularSkills(limit: number = 50) {
  const { data, error, loading, refresh } = useApiGet<SkillItem[]>(
    `/skills/popular?limit=${limit}`
  );

  return {
    skills: data ?? [],
    isLoading: loading,
    error,
    refresh,
  };
}

/**
 * Hook for fetching featured skills
 */
export function useFeaturedSkills(limit: number = 20) {
  const { data, error, loading, refresh } = useApiGet<SkillItem[]>(
    `/skills/featured?limit=${limit}`
  );

  return {
    skills: data ?? [],
    isLoading: loading,
    error,
    refresh,
  };
}

/**
 * Hook for fetching skill categories
 */
export function useSkillCategories() {
  const { data, error, loading, refresh } =
    useApiGet<SkillCategory[]>('/skills/categories');

  return {
    categories: data ?? [],
    isLoading: loading,
    error,
    refresh,
  };
}

/**
 * Hook for syncing skills from SkillsMP
 */
export function useSkillsSync() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    success: boolean;
    message: string;
    skillsCount?: number;
  } | null>(null);

  const { execute } = useApiPost<
    { success: boolean; message: string; skillsCount?: number },
    void
  >('/skills/sync');

  const sync = useCallback(async () => {
    setIsSyncing(true);
    setSyncResult(null);
    try {
      const result = await execute();
      if (result) {
        setSyncResult(result);
      }
      return result;
    } catch (error) {
      const errorResult = {
        success: false,
        message: (error as Error).message || '同步失败',
      };
      setSyncResult(errorResult);
      return errorResult;
    } finally {
      setIsSyncing(false);
    }
  }, [execute]);

  return {
    sync,
    isSyncing,
    syncResult,
  };
}

/**
 * Combined hook for AI Skills page
 */
export function useAISkills(params: SearchParams = {}) {
  const {
    stats,
    isLoading: statsLoading,
    refresh: refreshStats,
  } = useSkillsStats();
  const {
    timeline,
    isLoading: timelineLoading,
    refresh: refreshTimeline,
  } = useSkillsTimeline();
  const {
    skills,
    total,
    isLoading: skillsLoading,
    refresh: refreshSkills,
  } = useSkillsSearch(params);
  const { skills: featuredSkills, refresh: refreshFeatured } =
    useFeaturedSkills();
  const { sync, isSyncing, syncResult } = useSkillsSync();

  const isLoading = statsLoading || timelineLoading || skillsLoading;

  const refreshAll = useCallback(() => {
    refreshStats();
    refreshTimeline();
    refreshSkills();
    refreshFeatured();
  }, [refreshStats, refreshTimeline, refreshSkills, refreshFeatured]);

  const handleSync = useCallback(async () => {
    const result = await sync();
    if (result?.success) {
      refreshAll();
    }
    return result;
  }, [sync, refreshAll]);

  return {
    // Data
    stats,
    timeline,
    skills,
    total,
    featuredSkills,

    // Loading states
    isLoading,
    isSyncing,

    // Actions
    sync: handleSync,
    syncResult,
    refreshAll,
  };
}
