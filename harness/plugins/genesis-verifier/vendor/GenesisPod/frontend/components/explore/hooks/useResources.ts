import { useState, useEffect, useRef, useCallback } from 'react';
import { config } from '@/lib/utils/config';
import { useAuth } from '@/contexts/AuthContext';
import type { Resource } from '../utils/types';
import { PAGE_SIZE } from '../utils/constants';

import { logger } from '@/lib/utils/logger';
interface UseResourcesProps {
  activeTab: string;
  searchQuery: string;
  sortBy: 'publishedAt' | 'qualityScore' | 'trendingScore';
  sortOrder: 'asc' | 'desc';
  filterCategory: string;
  selectedCategories: string[];
  selectedSources: string[];
  dateRange: 'all' | '24h' | '7d' | '30d' | '90d';
  minQualityScore: number;
}

export function useResources({
  activeTab,
  searchQuery,
  sortBy,
  sortOrder,
  filterCategory,
  selectedCategories,
  selectedSources,
  dateRange,
  minQualityScore,
}: UseResourcesProps) {
  const { accessToken } = useAuth();
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);

  const loadMoreTriggerRef = useRef<HTMLDivElement>(null);

  const fetchResources = async (loadMore = false) => {
    try {
      if (loadMore) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setPage(0);
        setHasMore(true);
      }

      const currentPage = loadMore ? page + 1 : 0;

      // Handle YouTube tab separately
      if (activeTab === 'youtube') {
        const youtubeVideosUrl = `${config.apiUrl}/youtube-videos`;
        const youtubeRes = await fetch(youtubeVideosUrl, {
          headers: accessToken
            ? { Authorization: `Bearer ${accessToken}` }
            : {},
        });
        const youtubeData = await youtubeRes.json();
        // API returns { success, data: [...] } or { success, data: { data: [...] } }
        const ytResponseData = youtubeData?.data ?? youtubeData;
        const ytVideosArray = Array.isArray(ytResponseData)
          ? ytResponseData
          : ytResponseData?.data || [];
        const youtubeVideos = ytVideosArray.map(
          (video: Record<string, unknown>) => ({
            id: video.id as string,
            type: 'YOUTUBE' as const,
            title: video.title as string,
            abstract: null,
            sourceUrl: video.url as string,
            publishedAt: video.createdAt as string,
            videoId: video.videoId as string,
          })
        );

        const resourcesUrl = `${config.apiUrl}/resources?type=YOUTUBE_VIDEO&take=${PAGE_SIZE}&skip=${currentPage * PAGE_SIZE}`;
        const resourcesRes = await fetch(resourcesUrl, {
          headers: accessToken
            ? { Authorization: `Bearer ${accessToken}` }
            : {},
        });
        const resourcesData = await resourcesRes.json();
        // API returns { success, data: { data: [...], pagination } } format
        const resResponseData = resourcesData?.data ?? resourcesData;
        const resourceVideos = Array.isArray(resResponseData)
          ? resResponseData
          : resResponseData?.data || [];

        // Merge and deduplicate
        const seenVideoIds = new Set<string>();
        const allVideos: Resource[] = [];

        const getVideoId = (video: Record<string, unknown>): string | null => {
          if (video.videoId) return video.videoId as string;
          if (video.sourceUrl && typeof video.sourceUrl === 'string') {
            const match = video.sourceUrl.match(
              /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
            );
            return match ? match[1] : null;
          }
          return null;
        };

        for (const video of youtubeVideos) {
          const videoId = getVideoId(video);
          if (videoId && !seenVideoIds.has(videoId)) {
            seenVideoIds.add(videoId);
            allVideos.push(video);
          } else if (!videoId) {
            allVideos.push(video);
          }
        }

        for (const video of resourceVideos) {
          const videoId = getVideoId(video);
          if (videoId && !seenVideoIds.has(videoId)) {
            seenVideoIds.add(videoId);
            allVideos.push(video);
          } else if (!videoId) {
            allVideos.push(video);
          }
        }

        if (loadMore) {
          setResources((prev) => [...prev, ...allVideos]);
        } else {
          setResources(allVideos);
        }
        setHasMore(resourceVideos.length >= PAGE_SIZE);
        setPage(currentPage);
        setLoading(false);
        setLoadingMore(false);
        return;
      }

      // Build query params
      const params = new URLSearchParams({
        take: PAGE_SIZE.toString(),
        skip: (currentPage * PAGE_SIZE).toString(),
        sortBy: sortBy,
        sortOrder: sortOrder,
      });

      const typeMap: Record<string, string> = {
        papers: 'PAPER',
        blogs: 'BLOG',
        reports: 'REPORT',
        youtube: 'YOUTUBE_VIDEO',
        news: 'NEWS',
        policy: 'POLICY',
      };
      params.append('type', typeMap[activeTab] || 'PAPER');

      if (searchQuery) {
        params.append('search', searchQuery);
      }
      if (filterCategory) {
        params.append('category', filterCategory);
      }
      if (selectedCategories.length > 0) {
        selectedCategories.forEach((cat) => params.append('categories', cat));
      }
      if (dateRange !== 'all') {
        params.append('dateRange', dateRange);
      }
      if (minQualityScore > 0) {
        params.append('minQualityScore', minQualityScore.toString());
      }

      const url = `${config.apiUrl}/resources?${params.toString()}`;
      const res = await fetch(url, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
      const data = await res.json();
      // API returns { success, data: { data: [...], pagination } } format
      const responseData = data?.data ?? data;
      const newResources = Array.isArray(responseData)
        ? responseData
        : responseData?.data || [];

      if (loadMore) {
        setResources((prev) => [...prev, ...newResources]);
      } else {
        setResources(newResources);
      }
      setHasMore(newResources.length >= PAGE_SIZE);
      setPage(currentPage);
    } catch (error) {
      logger.error('Failed to fetch:', error);
      if (!loadMore) {
        setResources([]);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const loadMoreResources = useCallback(() => {
    if (!loadingMore && hasMore && !loading) {
      fetchResources(true);
    }
  }, [loadingMore, hasMore, loading]);

  useEffect(() => {
    fetchResources();
  }, [activeTab, searchQuery, sortBy, sortOrder, filterCategory]);

  // Infinite scroll
  useEffect(() => {
    const trigger = loadMoreTriggerRef.current;
    if (!trigger) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting && hasMore && !loadingMore && !loading) {
          loadMoreResources();
        }
      },
      {
        root: null,
        rootMargin: '100px',
        threshold: 0.1,
      }
    );

    observer.observe(trigger);

    return () => {
      observer.disconnect();
    };
  }, [hasMore, loadingMore, loading, loadMoreResources]);

  return {
    resources,
    loading,
    loadingMore,
    hasMore,
    loadMoreTriggerRef,
    setResources,
    fetchResources,
  };
}
