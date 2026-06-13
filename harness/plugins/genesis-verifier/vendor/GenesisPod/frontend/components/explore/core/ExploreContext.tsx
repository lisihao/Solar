'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
  useEffect,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { config } from '@/lib/utils/config';
import { getAuthHeader, type User } from '@/lib/utils/auth';
import type { TabType } from '@/components/layout/ResponsiveNav';
import type {
  Resource,
  SearchSuggestion,
  AIMessage,
  AIInsight,
} from '../utils/types';
import { PAGE_SIZE } from '../utils/constants';
import { extractYouTubeVideoId } from '../utils/utils';
import { useBookmarks } from '../hooks/useBookmarks';

import { logger } from '@/lib/utils/logger';
interface ExploreContextValue {
  // Resources
  resources: Resource[];
  setResources: (
    resources: Resource[] | ((prev: Resource[]) => Resource[])
  ) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  loadingMore: boolean;
  hasMore: boolean;
  page: number;
  fetchResources: (loadMore?: boolean) => Promise<void>;

  // Active resource and view mode
  selectedResource: Resource | null;
  setSelectedResource: (resource: Resource | null) => void;
  viewMode: 'list' | 'detail';
  setViewMode: (mode: 'list' | 'detail') => void;
  handleResourceClick: (resource: Resource) => void;
  handleBackToList: () => void;

  // Tab and filters
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  sortBy: 'publishedAt' | 'qualityScore' | 'trendingScore';
  setSortBy: (sort: 'publishedAt' | 'qualityScore' | 'trendingScore') => void;
  sortOrder: 'asc' | 'desc';
  setSortOrder: (order: 'asc' | 'desc') => void;
  filterCategory: string;
  setFilterCategory: (category: string) => void;

  // Advanced filters
  showFilterPanel: boolean;
  setShowFilterPanel: (show: boolean) => void;
  selectedCategories: string[];
  setSelectedCategories: (categories: string[]) => void;
  selectedSources: string[];
  setSelectedSources: (sources: string[]) => void;
  dateRange: 'all' | '24h' | '7d' | '30d' | '90d';
  setDateRange: (range: 'all' | '24h' | '7d' | '30d' | '90d') => void;
  minQualityScore: number;
  setMinQualityScore: (score: number) => void;
  handleApplyFilters: () => void;
  handleResetFilters: () => void;

  // Search suggestions
  searchSuggestions: SearchSuggestion[];
  showSuggestions: boolean;
  setShowSuggestions: (show: boolean) => void;
  selectedSuggestionIndex: number;
  setSelectedSuggestionIndex: (
    index: number | ((prev: number) => number)
  ) => void;
  searchMode: 'agent' | 'search';
  setSearchMode: (mode: 'agent' | 'search') => void;
  fetchSearchSuggestions: (query: string) => Promise<void>;
  handleSuggestionClick: (suggestion: SearchSuggestion) => void;

  // HTML view mode
  htmlViewMode: 'reader' | 'original';
  setHtmlViewMode: (mode: 'reader' | 'original') => void;

  // Article content (for AI)
  articleTextContent: string;
  setArticleTextContent: (content: string) => void;

  // AI states
  aiMessages: AIMessage[];
  setAiMessages: (
    messages: AIMessage[] | ((prev: AIMessage[]) => AIMessage[])
  ) => void;
  aiInput: string;
  setAiInput: (input: string) => void;
  aiLoading: boolean;
  setAiLoading: (loading: boolean) => void;
  aiSummary: string | null;
  setAiSummary: (summary: string | null) => void;
  aiInsights: AIInsight[];
  setAiInsights: (insights: AIInsight[]) => void;
  aiMethodology: AIInsight[];
  setAiMethodology: (methodology: AIInsight[]) => void;
  aiRightTab: 'assistant' | 'notes' | 'comments' | 'similar';
  setAiRightTab: (tab: 'assistant' | 'notes' | 'comments' | 'similar') => void;
  isAiPanelCollapsed: boolean;
  setIsAiPanelCollapsed: (collapsed: boolean) => void;
  aiPanelWidth: number;
  setAiPanelWidth: (width: number) => void;
  aiModel: string;
  setAiModel: (model: string) => void;
  isStreaming: boolean;
  setIsStreaming: (streaming: boolean) => void;

  // Header
  isHeaderCollapsed: boolean;
  setIsHeaderCollapsed: (collapsed: boolean) => void;

  // Bookmarks
  bookmarks: Set<string>;
  defaultCollectionId: string | null;
  isBookmarked: (resourceId: string) => boolean;
  toggleBookmark: (resourceId: string) => Promise<void>;

  // Upvotes
  upvotes: Set<string>;
  setUpvotes: (
    upvotes: Set<string> | ((prev: Set<string>) => Set<string>)
  ) => void;
  upvotesLoading: boolean;

  // Import dialogs
  showImportUrlDialog: boolean;
  setShowImportUrlDialog: (show: boolean) => void;
  showImportFileDialog: boolean;
  setShowImportFileDialog: (show: boolean) => void;

  // Toast
  toast: { message: string; type: 'success' | 'error' } | null;
  setToast: (
    toast: { message: string; type: 'success' | 'error' } | null
  ) => void;

  // Notes refresh
  notesRefreshKey: number;
  setNotesRefreshKey: (key: number | ((prev: number) => number)) => void;

  // Auth
  user: User | null;
  isAdmin: boolean;
  accessToken: string | null;
}

const ExploreContext = createContext<ExploreContextValue | undefined>(
  undefined
);

export function ExploreProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isAdmin, accessToken } = useAuth();

  // Resources
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);

  // Active resource and view mode
  const initialTab = (searchParams?.get('tab') || 'youtube') as TabType;
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(
    null
  );
  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');
  const [htmlViewMode, setHtmlViewMode] = useState<'reader' | 'original'>(
    'reader'
  );

  // Search and filters
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<
    'publishedAt' | 'qualityScore' | 'trendingScore'
  >('publishedAt'); // 默认「最新」（按发布时间倒序）
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [filterCategory, setFilterCategory] = useState<string>('');

  // Advanced filters
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<
    'all' | '24h' | '7d' | '30d' | '90d'
  >('all');
  const [minQualityScore, setMinQualityScore] = useState<number>(0);

  // Search suggestions
  const [searchSuggestions, setSearchSuggestions] = useState<
    SearchSuggestion[]
  >([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [searchMode, setSearchMode] = useState<'agent' | 'search'>('search');

  // AI states
  const [aiMessages, setAiMessages] = useState<AIMessage[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiInsights, setAiInsights] = useState<AIInsight[]>([]);
  const [aiMethodology, setAiMethodology] = useState<AIInsight[]>([]);
  const [aiRightTab, setAiRightTab] = useState<
    'assistant' | 'notes' | 'comments' | 'similar'
  >('assistant');
  const [isAiPanelCollapsed, setIsAiPanelCollapsed] = useState(false);
  const [aiPanelWidth, setAiPanelWidth] = useState(420);
  const [aiModel, setAiModel] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(true);

  // Article content
  const [articleTextContent, setArticleTextContent] = useState<string>('');

  // Bookmarks
  const { bookmarks, defaultCollectionId, isBookmarked, toggleBookmark } =
    useBookmarks();

  // Upvotes
  const [upvotes, setUpvotes] = useState<Set<string>>(new Set());
  const [upvotesLoading, setUpvotesLoading] = useState(false);

  // Import dialogs
  const [showImportUrlDialog, setShowImportUrlDialog] = useState(false);
  const [showImportFileDialog, setShowImportFileDialog] = useState(false);

  // Toast
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);

  // Notes refresh
  const [notesRefreshKey, setNotesRefreshKey] = useState(0);

  // Auto-hide toast after 3 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Load user's upvoted resources on mount
  useEffect(() => {
    const fetchUserUpvotes = async () => {
      if (!user || !accessToken) return;

      try {
        setUpvotesLoading(true);
        const response = await fetch(
          `${config.apiUrl}/resources/user/upvotes`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        if (response.ok) {
          const result = await response.json();
          // API returns { success: true, data: { resourceIds: [...] } } format
          const data = result?.data ?? result;
          setUpvotes(new Set(data.resourceIds || []));
        }
      } catch (error) {
        logger.error('Failed to fetch user upvotes:', error);
      } finally {
        setUpvotesLoading(false);
      }
    };

    fetchUserUpvotes();
  }, [user, accessToken]);

  // Fetch resources
  const fetchResources = useCallback(
    async (loadMore = false) => {
      try {
        if (loadMore) {
          setLoadingMore(true);
        } else {
          setLoading(true);
          setPage(0);
          setHasMore(true);
        }

        const currentPage = loadMore ? page + 1 : 0;

        // Handle YouTube tab separately - fetch from both sources
        if (activeTab === 'youtube') {
          // Fetch from youtube-videos table
          const youtubeVideosUrl = `${config.apiUrl}/youtube-videos`;
          const youtubeRes = await fetch(youtubeVideosUrl, {
            headers: accessToken
              ? { Authorization: `Bearer ${accessToken}` }
              : {},
          });
          const youtubeData = await youtubeRes.json();
          interface VideoData {
            id: string;
            title: string;
            url: string;
            createdAt: string;
            videoId: string;
          }
          // API returns { success, data: [...] } or { success, data: { data: [...] } }
          const ytResponseData = youtubeData?.data ?? youtubeData;
          const ytVideosArray = Array.isArray(ytResponseData)
            ? ytResponseData
            : ytResponseData?.data || [];
          const youtubeVideos = ytVideosArray.map((video: VideoData) => ({
            id: video.id,
            type: 'YOUTUBE',
            title: video.title,
            abstract: null,
            sourceUrl: video.url,
            publishedAt: video.createdAt,
            videoId: video.videoId,
          }));

          // Fetch from resources table with type=YOUTUBE_VIDEO
          const resourcesUrl = `${config.apiUrl}/resources?type=YOUTUBE_VIDEO&take=${PAGE_SIZE}&skip=${currentPage * PAGE_SIZE}`;
          const resourcesRes = await fetch(resourcesUrl);
          const resourcesData = await resourcesRes.json();
          // API returns { success, data: { data: [...], pagination } } format
          const resResponseData = resourcesData?.data ?? resourcesData;
          const resourceVideos = Array.isArray(resResponseData)
            ? resResponseData
            : resResponseData?.data || [];

          // Merge and deduplicate by videoId
          const seenVideoIds = new Set<string>();
          const allVideos: Resource[] = [];

          const getVideoId = (video: {
            videoId?: string;
            sourceUrl?: string;
          }): string | null => {
            if (video.videoId) return video.videoId;
            if (video.sourceUrl) {
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

        // Build query params for other tabs
        const params = new URLSearchParams({
          take: PAGE_SIZE.toString(),
          skip: (currentPage * PAGE_SIZE).toString(),
          sortBy: sortBy,
          sortOrder: sortOrder,
        });

        // Map tab to resource type
        const typeMap: Record<
          'papers' | 'blogs' | 'reports' | 'youtube' | 'news' | 'policy',
          string
        > = {
          papers: 'PAPER',
          blogs: 'BLOG',
          reports: 'REPORT',
          youtube: 'YOUTUBE_VIDEO',
          news: 'NEWS',
          policy: 'POLICY',
        };
        params.append('type', typeMap[activeTab as keyof typeof typeMap]);

        if (searchQuery) {
          params.append('search', searchQuery);
        }
        if (filterCategory) {
          params.append('category', filterCategory);
        }

        // Add advanced filter parameters
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
        const res = await fetch(url);
        const result = await res.json();
        // Handle wrapped API response { success: true, data: T }
        // API returns { success, data: { data: [...], pagination } } format
        const data = result?.data ?? result;
        const newResources = Array.isArray(data) ? data : data?.data || [];

        if (loadMore) {
          setResources((prev) => [...prev, ...newResources]);
        } else {
          setResources(newResources);
        }

        setHasMore(newResources.length >= PAGE_SIZE);
        setPage(currentPage);
      } catch (error) {
        logger.error('Failed to fetch resources:', error);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [
      activeTab,
      searchQuery,
      sortBy,
      sortOrder,
      filterCategory,
      selectedCategories,
      dateRange,
      minQualityScore,
      page,
      accessToken,
    ]
  );

  // Fetch resources when dependencies change
  useEffect(() => {
    fetchResources();
  }, [activeTab, searchQuery, sortBy, sortOrder, filterCategory]);

  // Handle resource click
  const handleResourceClick = useCallback(
    (resource: Resource) => {
      // For YouTube videos, redirect to the YouTube page
      if (
        resource.type === 'YOUTUBE' ||
        resource.type === 'YOUTUBE_VIDEO' ||
        resource.videoId
      ) {
        const videoId =
          resource.videoId || extractYouTubeVideoId(resource.sourceUrl);
        if (videoId) {
          router.push(`/explore/youtube?videoId=${videoId}`);
          return;
        }
      }

      // For non-YouTube resources, show in detail view
      setSelectedResource(resource);
      setViewMode('detail');
      setAiMessages([]);
      setAiSummary(null);
      setAiInsights([]);
      setArticleTextContent('');
    },
    [router]
  );

  // Handle back to list
  const handleBackToList = useCallback(() => {
    setViewMode('list');
    setSelectedResource(null);
  }, []);

  // Handle apply filters
  const handleApplyFilters = useCallback(() => {
    setShowFilterPanel(false);
    fetchResources();
  }, [fetchResources]);

  // Handle reset filters
  const handleResetFilters = useCallback(() => {
    setSelectedCategories([]);
    setSelectedSources([]);
    setDateRange('all');
    setMinQualityScore(0);
  }, []);

  // Fetch search suggestions
  const fetchSearchSuggestions = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSearchSuggestions([]);
      return;
    }

    try {
      const response = await fetch(
        `${config.apiUrl}/resources/search/suggestions?query=${encodeURIComponent(query)}&limit=8`,
        { headers: getAuthHeader() }
      );

      if (response.ok) {
        const result = await response.json();
        // Handle wrapped response { success: true, data: [...] }
        const data = result?.data ?? result;
        setSearchSuggestions(Array.isArray(data) ? data : []);
        setShowSuggestions(true);
      }
    } catch (error) {
      logger.error('Failed to fetch search suggestions:', error);
    }
  }, []);

  // Handle suggestion click
  const handleSuggestionClick = useCallback(
    (suggestion: SearchSuggestion) => {
      setSearchQuery(suggestion.title);
      setShowSuggestions(false);
      setSelectedSuggestionIndex(-1);

      // Fetch the full resource and open it
      const fetchAndOpenResource = async () => {
        try {
          const response = await fetch(
            `${config.apiUrl}/resources/${suggestion.id}`,
            {
              headers: getAuthHeader(),
            }
          );
          if (response.ok) {
            const result = await response.json();
            // API returns { success: true, data: resource } format
            const resource = result?.data ?? result;
            handleResourceClick(resource);
          }
        } catch (error) {
          logger.error('Failed to fetch resource:', error);
        }
      };

      fetchAndOpenResource();
    },
    [handleResourceClick]
  );

  // Handle opening resource from URL parameter
  useEffect(() => {
    const resourceId = searchParams?.get('id');
    if (!resourceId) return;

    const handleResource = (resource: Resource) => {
      if (
        resource.type === 'YOUTUBE' ||
        resource.type === 'YOUTUBE_VIDEO' ||
        resource.videoId
      ) {
        const videoId =
          resource.videoId || extractYouTubeVideoId(resource.sourceUrl);
        if (videoId) {
          router.push(`/explore/youtube?videoId=${videoId}`);
          return;
        }
      }

      setSelectedResource(resource);
      setViewMode('detail');
      setAiMessages([]);
      setAiSummary(null);
      setAiInsights([]);
      setArticleTextContent('');
    };

    const resource = resources.find((r) => r.id === resourceId);
    if (resource) {
      handleResource(resource);
      return;
    }

    const fetchResourceById = async () => {
      try {
        const response = await fetch(
          `${config.apiUrl}/resources/${resourceId}`,
          {
            headers: getAuthHeader(),
          }
        );
        if (response.ok) {
          const result = await response.json();
          // API returns { success: true, data: resource } format
          const data = result?.data ?? result;
          handleResource(data);
        }
      } catch (error) {
        logger.error('Failed to fetch resource by id:', error);
      }
    };

    fetchResourceById();
  }, [searchParams, router, resources]);

  const value: ExploreContextValue = {
    resources,
    setResources,
    loading,
    setLoading,
    loadingMore,
    hasMore,
    page,
    fetchResources,
    selectedResource,
    setSelectedResource,
    viewMode,
    setViewMode,
    handleResourceClick,
    handleBackToList,
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    filterCategory,
    setFilterCategory,
    showFilterPanel,
    setShowFilterPanel,
    selectedCategories,
    setSelectedCategories,
    selectedSources,
    setSelectedSources,
    dateRange,
    setDateRange,
    minQualityScore,
    setMinQualityScore,
    handleApplyFilters,
    handleResetFilters,
    searchSuggestions,
    showSuggestions,
    setShowSuggestions,
    selectedSuggestionIndex,
    setSelectedSuggestionIndex,
    searchMode,
    setSearchMode,
    fetchSearchSuggestions,
    handleSuggestionClick,
    htmlViewMode,
    setHtmlViewMode,
    articleTextContent,
    setArticleTextContent,
    aiMessages,
    setAiMessages,
    aiInput,
    setAiInput,
    aiLoading,
    setAiLoading,
    aiSummary,
    setAiSummary,
    aiInsights,
    setAiInsights,
    aiMethodology,
    setAiMethodology,
    aiRightTab,
    setAiRightTab,
    isAiPanelCollapsed,
    setIsAiPanelCollapsed,
    aiPanelWidth,
    setAiPanelWidth,
    aiModel,
    setAiModel,
    isStreaming,
    setIsStreaming,
    isHeaderCollapsed,
    setIsHeaderCollapsed,
    bookmarks,
    defaultCollectionId,
    isBookmarked,
    toggleBookmark,
    upvotes,
    setUpvotes,
    upvotesLoading,
    showImportUrlDialog,
    setShowImportUrlDialog,
    showImportFileDialog,
    setShowImportFileDialog,
    toast,
    setToast,
    notesRefreshKey,
    setNotesRefreshKey,
    user,
    isAdmin,
    accessToken,
  };

  return (
    <ExploreContext.Provider value={value}>{children}</ExploreContext.Provider>
  );
}

export function useExplore() {
  const context = useContext(ExploreContext);
  if (!context) {
    throw new Error('useExplore must be used within ExploreProvider');
  }
  return context;
}
