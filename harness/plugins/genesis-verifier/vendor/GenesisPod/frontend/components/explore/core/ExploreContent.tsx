'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { config } from '@/lib/utils/config';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/utils/auth';
import { confirm } from '@/stores';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { Alert } from '@/components/ui/feedback/Alert';
import PDFThumbnail from '@/components/ui/viewers/PDFThumbnail';
import PDFViewer from '@/components/ui/viewers/PDFViewer';
import HTMLViewer from '@/components/ui/viewers/HTMLViewer';
import ReaderView from '@/components/ui/viewers/ReaderView';
import TextSelectionToolbar from '@/components/ui/content/TextSelectionToolbar';
import NotesList from '@/components/common/resource-lists/NotesList';
import CommentsList from '@/components/common/comments/CommentsList';
import SimilarResourcesList from '@/components/common/resource-lists/SimilarResourcesList';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ReportWorkspace } from '@/components/common/report-workspace';
import ResourceThumbnail from '../resources/ResourceThumbnail';
import { InsightChip } from '../InsightBadge';
import { useReportWorkspace } from '@/hooks';
import FilterPanel from '@/components/common/selectors/FilterPanel';
import { ImportUrlDialog } from '@/components/common/dialogs/ImportUrlDialog';
import { ImportFileDialog } from '@/components/common/dialogs/ImportFileDialog';
import ResponsiveNav, {
  type TabType,
  type SortByType,
} from '@/components/layout/ResponsiveNav';
import {
  AIContextBuilder,
  type Resource as AIResource,
} from '@/lib/features/ai-office/context-builder';
import type { Resource as AIOfficeResource } from '@/lib/types/ai-office';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Minus,
  Table2,
  ThumbsUp,
  TrendingUp,
  Clock,
  Star,
  ChevronDown,
  FlaskConical,
  Cpu,
} from 'lucide-react';
import { useAIModels, pickPreferredModel, userHasBYOK } from '@/hooks';
import { ModelSelect } from '@/components/common/model-config/ModelSelect';
import { BYOKRequiredBanner } from '@/components/common/byok/BYOKRequiredBanner';
import { ClientDate } from '@/components/common/ClientDate';
import { formatDateSafe } from '@/lib/utils/date';

// Import extracted modules
import type {
  Resource,
  SearchSuggestion,
  AIMessage,
  AIInsight,
} from '../utils/types';
import { PAGE_SIZE, FILE_RESTRICTIONS, TYPE_MAP } from '../utils/constants';
import {
  extractImagesFromMarkdown,
  extractYouTubeVideoId,
  extractArxivId,
  getResourceThumbnail,
  parseMarkdownToInsights,
  getResourceDisplayMode,
} from '../utils/utils';
import { Base64Image } from '../resources/Base64Image';
import { getSourceName, getSourceBadgeColor } from '../utils/resourceHelpers';
import {
  saveAIAnalysisToDatabase,
  generateSummary as generateSummaryHelper,
  generateInsights as generateInsightsHelper,
} from '../utils/aiHelpers';
import { useBookmarks } from '../hooks/useBookmarks';
import { usePDFText } from '../hooks/usePDFText';
import { useI18n } from '@/lib/i18n/i18n-context';

import { logger } from '@/lib/utils/logger';

// Right Panel Toggle Icon - left wide, right narrow
// Fill shows current visible state: expanded = left filled, collapsed = right filled
function RightPanelToggleIcon({
  state,
}: {
  state: 'expanded' | 'collapsed' | 'pinned';
}) {
  // When expanded/pinned: left (content area) is visible, so fill left
  // When collapsed: right (AI panel) is minimized, so fill right
  const isExpanded = state === 'expanded' || state === 'pinned';
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-7">
      {/* Outer frame */}
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      {/* Left wide panel - fill when expanded */}
      <rect
        x="3"
        y="3"
        width="12"
        height="18"
        rx="2"
        fill={isExpanded ? '#9ca3af' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {/* Right narrow panel - fill when collapsed */}
      <rect
        x="15"
        y="3"
        width="6"
        height="18"
        rx="2"
        fill={!isExpanded ? '#6b7280' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

type YouTubeLibraryTab = 'genesis' | 'solar';
type PaperLibraryTab = 'recent' | 'insights' | 'hot';
const VALID_TABS: TabType[] = [
  'youtube',
  'papers',
  'blogs',
  'reports',
  'policy',
  'news',
];

interface SolarYouTubeReport {
  id: string;
  title: string;
  generatedAt: string;
  source: string;
  module?: string;
  subtitle?: string;
  path: string;
  empty?: boolean;
  excerpt: string;
  content: string;
  metrics?: {
    model?: string;
    reasoningEffort?: string;
    materialVideos?: number;
    channels?: string[];
    tags?: string[];
    mailStatus?: string;
    backend?: string | null;
    operatorLine?: string | null;
  };
}

interface PaperTrendTableRow {
  paperId: string;
  title: string;
  date: string;
  rank: number;
  topic: string;
  tags?: string[];
  hfUrl?: string | null;
  arxivUrl?: string | null;
  summary?: string;
  tableRank: number;
  appearances: number;
  bestRank: number;
  trendScore: number;
  latestDate?: string;
}

interface PaperTrendTopic {
  topic: string;
  totalScore: number;
  latestScore: number;
  delta: number;
  count: number;
  values: number[];
  countValues: number[];
}

interface PaperTrendData {
  generatedAt: string;
  latestDailyDate: string | null;
  windows: {
    day: string;
    week: string;
    month: string;
    quarter: string;
  };
  dates: string[];
  dailyCounts: Array<{ date: string; count: number }>;
  topics: PaperTrendTopic[];
  headline?: {
    leadingTopic?: string;
    leadingScore?: number;
    papersToday?: number;
    papersInQuarter?: number;
  };
  tables: {
    day: PaperTrendTableRow[];
    week: PaperTrendTableRow[];
    month: PaperTrendTableRow[];
    quarter: PaperTrendTableRow[];
  };
  source?: {
    rows?: number;
    method?: string;
    sqlite?: string;
    coverage?: {
      startDate?: string;
      endDate?: string;
      days?: number;
      rows?: number;
      papers?: number;
      hfRows?: number;
      arxivRows?: number;
      arxivUrlRows?: number;
    };
  };
}

const getSolarYouTubeChannelId = (resource: Resource) => {
  if (typeof resource.metadata?.channelId === 'string') {
    return resource.metadata.channelId;
  }

  try {
    const url = new URL(resource.sourceUrl);
    return url.searchParams.get('channel_id') || '';
  } catch {
    return '';
  }
};

const isSolarYouTubeChannel = (resource: Resource) => {
  const abstract = String(resource.abstract || '');
  return (
    resource.type === 'YOUTUBE_VIDEO' &&
    Boolean(getSolarYouTubeChannelId(resource)) &&
    (resource.metadata?.importedAs === 'youtube-channel-subscription' ||
      resource.sourceType === 'solar-harness:youtube-channel' ||
      resource.sourceUrl?.includes('/feeds/videos.xml') ||
      abstract.includes('YouTube subscription channel') ||
      abstract.includes('YouTube频道已同步'))
  );
};

const isSolarYouTubeVideo = (resource: Resource) =>
  resource.type === 'YOUTUBE_VIDEO' &&
  (resource.metadata?.importedAs === 'youtube-video' ||
    resource.sourceType === 'solar-harness:youtube-video');

const metadataString = (resource: Resource, key: string) => {
  const value = resource.metadata?.[key];
  return typeof value === 'string' ? value : '';
};

const metadataNumber = (resource: Resource, key: string) => {
  const value = resource.metadata?.[key];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const paperTrendTime = (resource: Resource) => {
  const date =
    metadataString(resource, 'fetchedAt') ||
    metadataString(resource, 'lastSeenAt') ||
    metadataString(resource, 'dailyDate') ||
    resource.publishedAt;
  const parsed = Date.parse(date);
  return Number.isFinite(parsed) ? parsed : 0;
};

const paperTrendRank = (resource: Resource) => {
  const dailyRank = metadataNumber(resource, 'dailyRank');
  const trendingRank = metadataNumber(resource, 'trendingRank');
  return dailyRank || trendingRank || 9999;
};

const withRecentPaperTrendSummary = (resource: Resource): Resource => {
  const dailyDate = metadataString(resource, 'dailyDate');
  const fetchedAt = metadataString(resource, 'fetchedAt');
  const dailyRank = metadataNumber(resource, 'dailyRank');
  const trendingRank = metadataNumber(resource, 'trendingRank');
  const rankLabels = [
    dailyRank ? `Daily #${dailyRank}` : '',
    trendingRank ? `Trending #${trendingRank}` : '',
  ].filter(Boolean);
  const topicTags = Array.isArray(resource.metadata?.topicTags)
    ? resource.metadata.topicTags
        .filter((tag): tag is string => typeof tag === 'string')
        .slice(0, 4)
        .join(' / ')
    : '';
  const timeLabel = dailyDate || fetchedAt || resource.publishedAt || 'N/A';
  const trendLine = [
    `最近趋势：${timeLabel}`,
    rankLabels.join(' · '),
    topicTags ? `方向 ${topicTags}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    ...resource,
    abstract: `${trendLine}\n${resource.abstract || ''}`.trim(),
    metadata: {
      ...resource.metadata,
      sourceName: 'HF/arXiv 最近趋势',
    },
  };
};

const getSolarYouTubeVideoDescription = (resource: Resource) => {
  const candidates = [
    resource.rawData?.description,
    resource.metadata?.description,
    resource.content,
    resource.abstract,
  ];

  return (
    candidates
      .find(
        (value): value is string =>
          typeof value === 'string' && value.trim().length > 0
      )
      ?.trim() || ''
  );
};

const formatDuration = (seconds: unknown) => {
  const value = Number(seconds || 0);
  if (!Number.isFinite(value) || value <= 0) return '';
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = Math.floor(value % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
};

const getSolarReportMetricLabels = (report: SolarYouTubeReport) => {
  const metrics = report.metrics || {};
  return [
    report.module || 'AI Influence 大咖访谈及大展洞察报告',
    typeof metrics.materialVideos === 'number'
      ? `${metrics.materialVideos} 个视频素材`
      : '',
    metrics.model && metrics.model !== 'N/A' ? `模型 ${metrics.model}` : '',
    metrics.reasoningEffort && metrics.reasoningEffort !== 'N/A'
      ? `推理 ${metrics.reasoningEffort}`
      : '',
    metrics.mailStatus ? `邮件 ${metrics.mailStatus}` : '',
  ].filter(Boolean);
};

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const { user, isAdmin, accessToken } = useAuth();
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const [youtubeLibraryTab, setYoutubeLibraryTab] =
    useState<YouTubeLibraryTab>('genesis');
  const [paperLibraryTab, setPaperLibraryTab] =
    useState<PaperLibraryTab>('recent');
  const [selectedYouTubeChannel, setSelectedYouTubeChannel] =
    useState<Resource | null>(null);
  const [youtubeChannelVideos, setYoutubeChannelVideos] = useState<Resource[]>(
    []
  );
  const [loadingChannelVideos, setLoadingChannelVideos] = useState(false);
  const [solarReports, setSolarReports] = useState<SolarYouTubeReport[]>([]);
  const [selectedSolarReport, setSelectedSolarReport] =
    useState<SolarYouTubeReport | null>(null);
  const [loadingSolarReports, setLoadingSolarReports] = useState(false);
  const [paperTrendData, setPaperTrendData] =
    useState<PaperTrendData | null>(null);
  const [loadingPaperTrendData, setLoadingPaperTrendData] = useState(false);

  // Infinite scroll ref
  const loadMoreTriggerRef = useRef<HTMLDivElement>(null);

  const [activeTab, setActiveTab] = useState<TabType>('youtube');
  const [selectedResource, setSelectedResource] = useState<Resource | null>(
    null
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');
  const [htmlViewMode, setHtmlViewMode] = useState<'reader' | 'original'>(
    'reader'
  );

  useEffect(() => {
    const urlTab = searchParams?.get('tab');
    if (urlTab && VALID_TABS.includes(urlTab as TabType)) {
      setActiveTab(urlTab as TabType);
    }
  }, [searchParams]);

  // AI interaction states
  const [aiMessages, setAiMessages] = useState<AIMessage[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiInsights, setAiInsights] = useState<AIInsight[]>([]);
  const [aiMethodology, setAiMethodology] = useState<AIInsight[]>([]);
  const [aiRightTab, setAiRightTab] = useState<
    'assistant' | 'notes' | 'comments' | 'similar'
  >('assistant');
  // 三状态: expanded(默认展开), collapsed(收起), pinned(固定)
  const [aiPanelState, setAiPanelState] = useState<
    'expanded' | 'collapsed' | 'pinned'
  >('expanded');
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(true);

  // 右侧面板切换: expanded → collapsed → pinned → expanded
  const handleAiPanelToggle = () => {
    if (aiPanelState === 'expanded') {
      setAiPanelState('collapsed');
    } else if (aiPanelState === 'collapsed') {
      setAiPanelState('pinned');
    } else {
      setAiPanelState('expanded');
    }
  };

  // Resizable AI panel width
  const [aiPanelWidth, setAiPanelWidth] = useState(() => {
    // Responsive default: wider on larger screens
    if (typeof window !== 'undefined') {
      if (window.innerWidth >= 1920) return 560;
      if (window.innerWidth >= 1536) return 520;
      if (window.innerWidth >= 1280) return 480;
    }
    return 420;
  });
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const resizeRef = useRef<HTMLDivElement>(null);

  // Context menu for adding to notes
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [notesRefreshKey, setNotesRefreshKey] = useState(0);
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);

  // Auto-hide toast after 3 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Panel resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingPanel(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingPanel) return;
      const newWidth = window.innerWidth - e.clientX;
      // Constrain between 320px and 900px (allows wider AI panel)
      setAiPanelWidth(Math.min(900, Math.max(320, newWidth)));
    };

    const handleMouseUp = () => {
      setIsResizingPanel(false);
    };

    if (isResizingPanel) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingPanel]);

  const { models: allAiModels } = useAIModels();
  // 显示 CHAT、CHAT_FAST 和 MULTIMODAL 类型的模型（都支持文本聊天）
  // Guard against undefined during SSR/hydration
  const aiModels = (allAiModels || []).filter(
    (m) =>
      m.modelType === 'CHAT' ||
      m.modelType === 'CHAT_FAST' ||
      m.modelType === 'MULTIMODAL'
  );
  const [aiModel, setAiModel] = useState(''); // 将在 aiModels 加载后设置默认值
  const [isStreaming, setIsStreaming] = useState(false);

  // 设置默认 AI 模型 — 严格 BYOK：用户 key 模型优先（pickPreferredModel）
  useEffect(() => {
    if (aiModels.length > 0 && !aiModel) {
      const defaultModel = pickPreferredModel(aiModels);
      if (defaultModel) setAiModel(defaultModel.modelId);
    }
  }, [aiModels, aiModel]);

  // PDF text extraction - using custom hook
  const pdfText = usePDFText(selectedResource);

  // Article content from ReaderView for AI analysis
  const [articleTextContent, setArticleTextContent] = useState<string>('');

  // Attachment upload states for AI chat
  const [attachments, setAttachments] = useState<File[]>([]);
  const attachmentFileInputRef = useRef<HTMLInputElement>(null);

  // Search and filter states
  const [sortBy, setSortBy] = useState<
    'publishedAt' | 'qualityScore' | 'trendingScore'
  >('publishedAt'); // 默认「最新」（按发布时间倒序）
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [filterCategory, setFilterCategory] = useState<string>('');

  // Advanced filter states
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<
    'all' | '24h' | '7d' | '30d' | '90d'
  >('all');
  const [minQualityScore, setMinQualityScore] = useState<number>(0);

  // File upload states
  const [uploadingFile, setUploadingFile] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Search suggestions states
  const [searchSuggestions, setSearchSuggestions] = useState<
    SearchSuggestion[]
  >([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [searchMode, setSearchMode] = useState<'agent' | 'search'>('search');

  // Bookmark states - using custom hook
  const { bookmarks, defaultCollectionId, isBookmarked, toggleBookmark } =
    useBookmarks();

  // Upvote states
  const [upvotes, setUpvotes] = useState<Set<string>>(new Set());
  const [upvotesLoading, setUpvotesLoading] = useState(false);

  // Report workspace (legacy - for /workspace page)
  const { addResource, hasResource, canAddMore } = useReportWorkspace();

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
          // Handle wrapped response { success: true, data: {...} }
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

  // Import states
  const [showImportUrlDialog, setShowImportUrlDialog] = useState(false);
  const [showImportFileDialog, setShowImportFileDialog] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tabParam = searchParams?.get('tab');
    if (tabParam && VALID_TABS.includes(tabParam as TabType)) {
      const nextTab = tabParam as TabType;
      if (nextTab !== activeTab) {
        setActiveTab(nextTab);
      }
    }
  }, [activeTab, searchParams]);

  useEffect(() => {
    fetchResources();
  }, [
    activeTab,
    searchQuery,
    sortBy,
    sortOrder,
    filterCategory,
    youtubeLibraryTab,
    paperLibraryTab,
    searchParams,
  ]);

  useEffect(() => {
    if (activeTab !== 'youtube' || youtubeLibraryTab !== 'solar') return;

    const loadSolarReports = async () => {
      try {
        setLoadingSolarReports(true);
        const response = await fetch(
          '/local-data/solar-youtube-insights.json',
          {
            cache: 'no-store',
          }
        );
        if (!response.ok) {
          throw new Error('Failed to load Solar YouTube reports');
        }
        const data = await response.json();
        setSolarReports(Array.isArray(data.reports) ? data.reports : []);
      } catch (error) {
        logger.error('Failed to load Solar YouTube reports:', error);
        setSolarReports([]);
      } finally {
        setLoadingSolarReports(false);
      }
    };

    loadSolarReports();
  }, [activeTab, youtubeLibraryTab]);

  useEffect(() => {
    const isPapersTab =
      activeTab === 'papers' || searchParams?.get('tab') === 'papers';
    if (!isPapersTab || paperLibraryTab !== 'recent') return;

    const loadPaperTrendData = async () => {
      try {
        setLoadingPaperTrendData(true);
        const response = await fetch(
          `/local-data/solar-hf-paper-trends.json?v=${Date.now()}`,
          { cache: 'no-store' }
        );
        if (!response.ok) {
          throw new Error('Failed to load Solar HF paper trends');
        }
        const data = await response.json();
        setPaperTrendData(data);
      } catch (error) {
        logger.error('Failed to load Solar HF paper trends:', error);
        setPaperTrendData(null);
      } finally {
        setLoadingPaperTrendData(false);
      }
    };

    loadPaperTrendData();
  }, [activeTab, paperLibraryTab, searchParams]);

  const fetchYouTubeChannelVideos = async (channel: Resource) => {
    const channelId = getSolarYouTubeChannelId(channel);

    if (!channelId) {
      setYoutubeChannelVideos([]);
      return;
    }

    try {
      setLoadingChannelVideos(true);
      const response = await fetch(
        `${config.apiUrl}/resources?type=YOUTUBE_VIDEO&take=1200&skip=0`
      );
      const result = await response.json();
      const data = result?.data ?? result;
      const rows = Array.isArray(data) ? data : data?.data || [];
      const videos = rows
        .filter((row: Resource) => isSolarYouTubeVideo(row))
        .filter((row: Resource) => row.metadata?.channelId === channelId)
        .filter(
          (row: Resource) => Number(row.metadata?.durationSeconds || 0) >= 600
        )
        .sort((a: Resource, b: Resource) => {
          const left = Date.parse(a.publishedAt || '') || 0;
          const right = Date.parse(b.publishedAt || '') || 0;
          return right - left;
        });

      setYoutubeChannelVideos(videos);
    } catch (error) {
      logger.error('Failed to fetch YouTube channel videos:', error);
      setYoutubeChannelVideos([]);
    } finally {
      setLoadingChannelVideos(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'youtube') return;

    const channelId = searchParams?.get('channelId') || '';
    if (!channelId) {
      if (selectedYouTubeChannel) {
        setSelectedYouTubeChannel(null);
        setYoutubeChannelVideos([]);
      }
      return;
    }

    setYoutubeLibraryTab('genesis');
    setSelectedSolarReport(null);
    setSelectedResource(null);
    setViewMode('list');

    if (
      selectedYouTubeChannel &&
      getSolarYouTubeChannelId(selectedYouTubeChannel) === channelId
    ) {
      return;
    }

    const channel = resources.find(
      (resource) =>
        isSolarYouTubeChannel(resource) &&
        getSolarYouTubeChannelId(resource) === channelId
    );
    if (!channel) return;

    setSelectedYouTubeChannel(channel);
    setYoutubeChannelVideos([]);
    void fetchYouTubeChannelVideos(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, searchParams, resources, selectedYouTubeChannel]);

  // Handle opening resource from URL parameter (from library page)
  useEffect(() => {
    const resourceId = searchParams?.get('id');
    if (!resourceId) return;

    // Helper function to handle the resource (same behavior as handleResourceClick)
    const handleResource = (resource: Resource) => {
      if (isSolarYouTubeChannel(resource)) {
        setActiveTab('youtube');
        setYoutubeLibraryTab('genesis');
        setViewMode('list');
        setSelectedYouTubeChannel(resource);
        void fetchYouTubeChannelVideos(resource);
        return;
      }

      // For YouTube videos, redirect to the YouTube page
      if (
        resource.type === 'YOUTUBE' ||
        resource.type === 'YOUTUBE_VIDEO' ||
        resource.videoId
      ) {
        const videoId =
          (typeof resource.metadata?.videoId === 'string'
            ? resource.metadata.videoId
            : '') ||
          resource.videoId ||
          extractYouTubeVideoId(resource.sourceUrl);

        if (videoId) {
          router.push(`/explore/youtube?videoId=${videoId}`);
          return;
        }
      }

      // For non-YouTube resources, show in detail view
      setSelectedResource(resource);
      setViewMode('detail');
      // Clear previous AI data and article content
      setAiMessages([]);
      setAiSummary(null);
      setAiInsights([]);
      setArticleTextContent('');
      // Auto-generate summary and insights (same as handleResourceClick)
      generateSummary(resource);
      generateInsights(resource);
    };

    // First try to find in current resources
    const resource = resources.find((r) => r.id === resourceId);
    if (resource) {
      handleResource(resource);
      return;
    }

    // If not found in current resources, fetch directly from API
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
          // Handle wrapped response { success: true, data: {...} }
          const data = result?.data ?? result;
          handleResource(data);
        }
      } catch (error) {
        logger.error('Failed to fetch resource by id:', error);
      }
    };

    fetchResourceById();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, router]);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [aiMessages]);

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
      const urlTab =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('tab')
          : searchParams?.get('tab');
      const effectiveTab =
        urlTab && VALID_TABS.includes(urlTab as TabType)
          ? (urlTab as TabType)
          : activeTab;

      // Handle YouTube tab separately - fetch from both sources
      if (effectiveTab === 'youtube') {
        if (youtubeLibraryTab === 'solar') {
          setResources([]);
          setHasMore(false);
          setPage(0);
          setSelectedYouTubeChannel(null);
          setYoutubeChannelVideos([]);
          setLoading(false);
          setLoadingMore(false);
          return;
        }

        // Root YouTube library shows subscribed channels. Videos are loaded after
        // a channel is selected so channel cards do not enter the video insight flow.
        const resourcesUrl = `${config.apiUrl}/resources?type=YOUTUBE_VIDEO&take=200&skip=0`;
        const resourcesRes = await fetch(resourcesUrl);
        const resourcesData = await resourcesRes.json();
        // API returns { success, data: { data: [...], pagination } } format
        const resResponseData = resourcesData?.data ?? resourcesData;
        const resourceRows = Array.isArray(resResponseData)
          ? resResponseData
          : resResponseData?.data || [];
        const channelRows = resourceRows.filter(isSolarYouTubeChannel);

        setResources(channelRows);
        setSelectedYouTubeChannel(null);
        setYoutubeChannelVideos([]);
        setHasMore(false);
        setPage(0);
        setLoading(false);
        setLoadingMore(false);
        return;
      }

      if (effectiveTab === 'papers') {
        const params = new URLSearchParams({
          type: 'PAPER',
          take: '300',
          skip: '0',
          sortBy: sortBy,
          sortOrder: sortOrder,
        });

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

        const res = await fetch(`${config.apiUrl}/resources?${params.toString()}`);
        const result = await res.json();
        const data = result?.data ?? result;
        const responseData = data?.data ?? data;
        const paperRows = Array.isArray(responseData)
          ? responseData
          : responseData?.data || [];
        const filteredPapers =
          paperLibraryTab === 'recent'
            ? paperRows
                .filter(
                  (resource: Resource) =>
                    resource.metadata?.importedAs === 'hf-hot-paper'
                )
                .sort(
                  (a: Resource, b: Resource) =>
                    paperTrendTime(b) - paperTrendTime(a) ||
                    paperTrendRank(a) - paperTrendRank(b)
                )
                .slice(0, 80)
                .map(withRecentPaperTrendSummary)
            : paperRows.filter((resource: Resource) => {
                const importedAs = resource.metadata?.importedAs;
                return (
                  importedAs ===
                  (paperLibraryTab === 'insights'
                    ? 'hf-paper-insight-report'
                    : 'hf-hot-paper')
                );
              });

        setResources(filteredPapers);
        setHasMore(false);
        setPage(0);
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
      params.append(
        'type',
        typeMap[
          effectiveTab as
            | 'papers'
            | 'blogs'
            | 'reports'
            | 'youtube'
            | 'news'
            | 'policy'
        ]
      );

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
      const data = result?.data ?? result;
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

  // Infinite scroll with IntersectionObserver
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
        rootMargin: '100px', // Start loading 100px before reaching the end
        threshold: 0.1,
      }
    );

    observer.observe(trigger);

    return () => {
      observer.disconnect();
    };
  }, [hasMore, loadingMore, loading, loadMoreResources]);

  const handleApplyFilters = () => {
    fetchResources();
  };

  const handleResetFilters = () => {
    setSelectedCategories([]);
    setSelectedSources([]);
    setDateRange('all');
    setMinQualityScore(0);
    fetchResources();
  };

  const handleFileUpload = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Get restrictions for current tab
    const restrictions = FILE_RESTRICTIONS[activeTab];
    if (!restrictions) {
      setToast({ message: '当前标签页不支持文件上传', type: 'error' });
      return;
    }

    // Check file size
    if (file.size > restrictions.maxSize) {
      const maxSizeMB = restrictions.maxSize / (1024 * 1024);
      setToast({
        message: `文件大小超过限制（最大 ${maxSizeMB}MB）`,
        type: 'error',
      });
      return;
    }

    // Check file type
    const fileExt = '.' + file.name.split('.').pop()?.toLowerCase();
    const acceptedExts = restrictions.accept
      .split(',')
      .map((ext) => ext.trim().toLowerCase());
    const isValidType = acceptedExts.some((ext) => {
      if (ext.includes('*')) {
        const mimeType = file.type.split('/')[0];
        return ext.startsWith(mimeType);
      }
      return fileExt === ext || file.type === ext;
    });

    if (!isValidType) {
      setToast({
        message: `请上传${restrictions.label}（${restrictions.accept}）`,
        type: 'error',
      });
      return;
    }

    setSelectedFile(file);
    setUploadingFile(true);

    try {
      // Map tab to resource type
      const typeMap: Record<string, string> = {
        papers: 'PAPER',
        blogs: 'BLOG',
        reports: 'REPORT',
        youtube: 'YOUTUBE_VIDEO',
        news: 'NEWS',
        policy: 'POLICY',
      };

      const resourceType = typeMap[activeTab];

      // Create FormData
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', resourceType);

      // Upload file to backend
      const response = await fetch(`${config.apiUrl}/resources/upload-file`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || '文件上传失败');
      }

      const result = await response.json();
      // Handle wrapped response { success: true, data: {...} }
      const data = result?.data ?? result;
      logger.debug('File uploaded successfully:', data);

      // Show success message
      setToast({
        message: `文件 "${file.name}" 上传成功！`,
        type: 'success',
      });

      // Refresh resources list
      await fetchResources();
    } catch (error) {
      logger.error('File upload error:', error);
      const errorMessage =
        error instanceof Error ? error.message : '文件上传失败';
      setToast({ message: errorMessage, type: 'error' });
    } finally {
      setUploadingFile(false);
      setSelectedFile(null);
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  const handleResourceClick = (resource: Resource) => {
    if (isSolarYouTubeChannel(resource)) {
      const channelId = getSolarYouTubeChannelId(resource);
      if (channelId) {
        router.push(
          `/explore?tab=youtube&channelId=${encodeURIComponent(channelId)}`
        );
      }
      setActiveTab('youtube');
      setYoutubeLibraryTab('genesis');
      setSelectedYouTubeChannel(resource);
      setYoutubeChannelVideos([]);
      void fetchYouTubeChannelVideos(resource);
      return;
    }

    if (isSolarYouTubeVideo(resource)) {
      const videoId =
        (typeof resource.metadata?.videoId === 'string'
          ? resource.metadata.videoId
          : '') ||
        resource.videoId ||
        extractYouTubeVideoId(resource.sourceUrl);

      if (videoId) {
        router.push(
          `/explore/youtube?videoId=${encodeURIComponent(videoId)}&resourceId=${encodeURIComponent(resource.id)}`
        );
        return;
      }
    }

    // For YouTube videos, navigate to the YouTube page
    if (
      resource.type === 'YOUTUBE' ||
      resource.type === 'YOUTUBE_VIDEO' ||
      resource.videoId
    ) {
      const videoId =
        resource.videoId || extractYouTubeVideoId(resource.sourceUrl);

      if (videoId) {
        router.push(`/explore/youtube?videoId=${encodeURIComponent(videoId)}`);
        return;
      }
    }

    setSelectedResource(resource);
    setViewMode('detail');
    // Clear previous AI data and article content
    setAiMessages([]);
    setAiSummary(null);
    setAiInsights([]);
    setArticleTextContent('');
    // Auto-generate summary and insights
    generateSummary(resource);
    generateInsights(resource);
  };

  const handleBackToList = () => {
    setViewMode('list');
  };

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (
        selectedSuggestionIndex >= 0 &&
        searchSuggestions[selectedSuggestionIndex]
      ) {
        // Select the highlighted suggestion
        handleSuggestionClick(searchSuggestions[selectedSuggestionIndex]);
      } else {
        // Perform normal search
        setShowSuggestions(false);
        fetchResources();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSuggestionIndex((prev) =>
        prev < searchSuggestions.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSuggestionIndex((prev) => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setSelectedSuggestionIndex(-1);
    }
  };

  // Fetch search suggestions with debouncing
  const fetchSearchSuggestions = useCallback(async (query: string) => {
    if (!query || query.trim().length < 2) {
      setSearchSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    try {
      const params = new URLSearchParams({
        q: query.trim(),
        limit: '5',
      });

      const url = `${config.apiUrl}/resources/search/suggestions?${params.toString()}`;
      const res = await fetch(url);
      const result = await res.json();
      // Handle wrapped API response { success: true, data: T }
      const data = result?.data ?? result;

      if (data.suggestions && Array.isArray(data.suggestions)) {
        setSearchSuggestions(data.suggestions);
        setShowSuggestions(data.suggestions.length > 0);
      }
    } catch (error) {
      logger.error('Failed to fetch suggestions:', error);
      setSearchSuggestions([]);
      setShowSuggestions(false);
    }
  }, []);

  // Debounce search suggestions
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchSearchSuggestions(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, fetchSearchSuggestions]);

  // Handle clicks outside suggestions dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
        setSelectedSuggestionIndex(-1);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSuggestionClick = (suggestion: SearchSuggestion) => {
    setSearchQuery(suggestion.title);
    setShowSuggestions(false);
    setSelectedSuggestionIndex(-1);
    // Navigate to the resource detail
    const resource = resources.find((r) => r.id === suggestion.id);
    if (resource) {
      handleResourceClick(resource);
    } else {
      // If not in current list, fetch and show it
      fetchResourceById(suggestion.id);
    }
  };

  const fetchResourceById = async (id: string) => {
    try {
      const res = await fetch(`${config.apiUrl}/resources/${id}`);
      const result = await res.json();
      // Handle wrapped API response { success: true, data: T }
      const resource = result?.data ?? result;
      if (resource) {
        handleResourceClick(resource);
      }
    } catch (error) {
      logger.error('Failed to fetch resource:', error);
    }
  };

  // AI Functions - using imported helpers with local state
  const generateSummary = async (resource: Resource) => {
    await generateSummaryHelper(
      resource,
      articleTextContent,
      setAiSummary,
      setAiLoading
    );
  };

  const generateInsights = async (resource: Resource) => {
    await generateInsightsHelper(resource, articleTextContent, setAiInsights);
  };

  // Handle article loaded from ReaderView
  const handleArticleLoaded = (article: {
    success: boolean;
    title: string;
    content: string;
    textContent: string;
    excerpt?: string;
    byline?: string;
    siteName?: string;
    length?: number;
    sourceUrl: string;
  }) => {
    logger.debug('Article loaded from ReaderView:', {
      title: article.title,
      textLength: article.textContent.length,
      siteName: article.siteName,
    });
    // Store the extracted text content for AI analysis
    setArticleTextContent(article.textContent);
  };

  // Handle context menu for adding to notes
  const handleContextMenu = (e: React.MouseEvent, text: string) => {
    e.preventDefault();
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();

    if (selectedText) {
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        text: selectedText,
      });
    } else if (text) {
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        text: text,
      });
    }
  };

  // Save selected text to notes
  const saveToNotes = async () => {
    if (!contextMenu) return;

    try {
      setSavingNote(true);
      logger.debug('Saving note to resource:', {
        resourceId: selectedResource?.id || 'none',
        contentPreview: contextMenu.text.substring(0, 50) + '...',
      });

      const response = await fetch(`${config.apiBaseUrl}/api/v1/notes`, {
        method: 'POST',
        headers: {
          ...getAuthHeader(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          resourceId: selectedResource?.id || null,
          content: contextMenu.text,
          tags: ['AI-Generated'],
          isPublic: false,
        }),
      });

      if (response.ok) {
        const noteResult = await response.json();
        // Handle wrapped response { success: true, data: {...} }
        const savedNote = noteResult?.data ?? noteResult;
        logger.debug('Note saved successfully:', savedNote);
        setToast({ message: 'Note saved successfully!', type: 'success' });

        // Close context menu first
        setContextMenu(null);

        // Switch to notes tab
        setAiRightTab('notes');

        // Trigger notes list refresh after a small delay
        setTimeout(() => {
          setNotesRefreshKey((prev) => prev + 1);
          logger.debug('Notes list refreshed');
        }, 100);
      } else {
        const errorData = await response.json();
        logger.error('Failed to save note:', {
          status: response.status,
          error: errorData,
        });
        setToast({
          message: `Failed to save note: ${errorData.message || 'Unknown error'}`,
          type: 'error',
        });
      }
    } catch (error) {
      logger.error('Failed to save note:', error);
      setToast({
        message: '保存笔记失败：网络错误或服务器无响应',
        type: 'error',
      });
    } finally {
      setSavingNote(false);
    }
  };

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't close if clicking on the context menu itself
      if (target.closest('.context-menu')) {
        return;
      }
      setContextMenu(null);
    };
    if (contextMenu) {
      // Use mousedown to detect clicks outside, but delay adding the listener
      // to avoid catching the same click that opened the menu
      const timer = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 0);
      return () => {
        clearTimeout(timer);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [contextMenu]);

  // Attachment handling functions
  const handleAttachmentClick = () => {
    attachmentFileInputRef.current?.click();
  };

  const handleAttachmentFileChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newFiles = Array.from(files);
    setAttachments((prev) => [...prev, ...newFiles]);

    // Reset input to allow selecting the same file again
    if (e.target) {
      e.target.value = '';
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // Save conversation to notes
  const saveConversationToNotes = async () => {
    if (!selectedResource || aiMessages.length === 0) {
      setToast({ message: '没有可保存的对话', type: 'error' });
      return;
    }

    try {
      // Format conversation as markdown
      let conversationText = `# AI Conversation: ${selectedResource.title}\n\n`;
      conversationText += `**Resource:** ${selectedResource.title}\n`;
      conversationText += `**Date:** ${formatDateSafe(new Date(), 'datetime')}\n\n`;
      conversationText += `---\n\n`;

      aiMessages.forEach((msg) => {
        const role = msg.role === 'user' ? '👤 You' : '🤖 AI';
        conversationText += `**${role}** (${formatDateSafe(msg.timestamp, 'time')})\n\n`;
        conversationText += `${msg.content}\n\n`;
        conversationText += `---\n\n`;
      });

      // Save to notes using the existing notes API
      const response = await fetch(`${config.apiUrl}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resourceId: selectedResource.id,
          content: conversationText,
          type: 'AI_CONVERSATION',
        }),
      });

      if (!response.ok) throw new Error('Failed to save conversation');

      setToast({ message: '对话已保存到笔记！', type: 'success' });
      setNotesRefreshKey((prev) => prev + 1); // Refresh notes list
    } catch (error) {
      logger.error('Failed to save conversation:', error);
      setToast({ message: '保存对话失败，请重试', type: 'error' });
    }
  };

  const sendAIMessage = async () => {
    if (!aiInput.trim() || !selectedResource) return;

    const userMessage: AIMessage = {
      role: 'user',
      content: aiInput,
      timestamp: new Date(),
    };

    setAiMessages((prev) => [...prev, userMessage]);
    const currentInput = aiInput;
    setAiInput('');
    setIsStreaming(true);

    try {
      // Build context using AIContextBuilder
      const resourceForAI: AIResource = {
        ...selectedResource,
        type: selectedResource.type, // Convert to AIResource type
        pdfText: pdfText || undefined,
      } as AIResource;

      let context = AIContextBuilder.buildContext(resourceForAI, {
        includeCore: true,
        includeMetadata: true,
        includeMetrics: true,
        includeTaxonomy: true,
        maxContentLength: 15000,
      });

      logger.debug(
        `Built AI context for ${selectedResource.type}:`,
        context.substring(0, 200) + '...'
      );

      // Add attachment information to context
      if (attachments.length > 0) {
        context += `\n\nAttached files for comparison (${attachments.length}):\n`;
        attachments.forEach((file, index) => {
          context += `${index + 1}. ${file.name} (${(file.size / 1024).toFixed(2)} KB, ${file.type || 'unknown type'})\n`;
        });
        context +=
          '\nNote: The user has uploaded these files for comparison or reference. Please acknowledge them in your response.';
      }

      // BYOK: Include auth header so backend can use user's personal API key
      const res = await fetch('/api/ai-service/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({
          message: currentInput,
          context: context,
          model: aiModel,
          stream: true,
        }),
      });

      if (!res.ok) throw new Error('Failed to fetch');

      // Handle SSE stream
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      const assistantMessage: AIMessage = {
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      };

      setAiMessages((prev) => [...prev, assistantMessage]);
      const messageIndex = aiMessages.length + 1;

      // Buffer for partial SSE lines split across chunks
      let sseBuffer = '';
      let streamDone = false;

      while (reader && !streamDone) {
        const { done, value } = await reader.read();
        if (done) break;

        // Append decoded chunk to buffer and split into lines
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        // Keep the last (possibly incomplete) line in the buffer
        sseBuffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              streamDone = true;
              break;
            }

            try {
              const parsed = JSON.parse(data);
              if (parsed.error) {
                // Handle error events from backend
                setAiMessages((prev) => {
                  const newMessages = [...prev];
                  if (newMessages[messageIndex]) {
                    newMessages[messageIndex] = {
                      ...newMessages[messageIndex],
                      content:
                        newMessages[messageIndex].content ||
                        `AI 服务错误: ${parsed.error}`,
                    };
                  }
                  return newMessages;
                });
                streamDone = true;
                break;
              }
              if (parsed.content) {
                setAiMessages((prev) => {
                  const newMessages = [...prev];
                  if (newMessages[messageIndex]) {
                    newMessages[messageIndex] = {
                      ...newMessages[messageIndex],
                      content:
                        newMessages[messageIndex].content + parsed.content,
                    };
                  }
                  return newMessages;
                });
              }
            } catch (e) {
              logger.debug('Failed to parse SSE data:', e);
            }
          }
        }
      }
    } catch (error) {
      logger.error('Failed to send message:', error);
      const errorMessage: AIMessage = {
        role: 'assistant',
        content: 'AI 服务暂时不可用，请稍后重试。如果问题持续，请联系管理员。',
        timestamp: new Date(),
      };
      setAiMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleQuickAction = async (
    action: 'summary' | 'insights' | 'methodology'
  ) => {
    if (!selectedResource) return;

    // Check if we already have cached data in database
    if (action === 'summary' && selectedResource.aiSummary) {
      logger.debug('Using cached summary from database');
      setAiSummary(selectedResource.aiSummary);
      const assistantMessage: AIMessage = {
        role: 'assistant',
        content: selectedResource.aiSummary,
        timestamp: new Date(),
      };
      setAiMessages((prev) => [...prev, assistantMessage]);
      return;
    }

    if (
      action === 'insights' &&
      selectedResource.keyInsights &&
      selectedResource.keyInsights.length > 0
    ) {
      logger.debug('Using cached insights from database');
      setAiInsights(selectedResource.keyInsights);
      return;
    }

    if (action === 'methodology' && selectedResource.methodology) {
      logger.debug('Using cached methodology from database');
      const parsedMethodology = parseMarkdownToInsights(
        selectedResource.methodology
      );
      setAiMethodology(parsedMethodology);
      return;
    }

    setAiLoading(true);

    try {
      // Use article text content if available (from Reader Mode), otherwise fall back to abstract
      const mainContent = articleTextContent || selectedResource.abstract || '';

      // Don't call AI with insufficient content - need at least 50 chars beyond the title
      if (mainContent.length < 50) {
        const warningMessage =
          '内容尚未加载完成，请先切换到「阅读模式」等待文章内容加载后再试。';
        if (action === 'summary') {
          setAiSummary(warningMessage);
        }
        setAiLoading(false);
        return;
      }

      // Limit content length to avoid token limits (max ~8000 chars for context)
      const truncatedContent =
        mainContent.length > 8000
          ? mainContent.substring(0, 8000) + '\n\n[Content truncated...]'
          : mainContent;
      const content = `Title: ${selectedResource.title}\n\nContent:\n${truncatedContent}`;

      // BYOK: Include auth header so backend can use user's personal API key
      const res = await fetch('/api/ai-service/ai/quick-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({
          content: content,
          action: action,
          model: aiModel,
        }),
      });

      const result = await res.json();
      // Handle wrapped API response { success: true, data: T }
      const data = result?.data ?? result;

      // Parse and set the appropriate state based on action type
      if (action === 'summary') {
        setAiSummary(data.content);
        // Save to database
        if (data.content) {
          saveAIAnalysisToDatabase(selectedResource.id, {
            aiSummary: data.content,
          });
        }
      } else if (action === 'insights') {
        // Handle insights response - content may be array (pre-parsed) or string
        let parsedInsights: AIInsight[] = [];
        if (Array.isArray(data.content)) {
          parsedInsights = data.content;
        } else if (typeof data.content === 'string') {
          try {
            const insights = JSON.parse(data.content);
            if (Array.isArray(insights)) {
              parsedInsights = insights;
            }
          } catch {
            // If not valid JSON, try to parse markdown format
            logger.debug(
              'JSON parsing failed, trying markdown parsing for insights'
            );
            parsedInsights = parseMarkdownToInsights(data.content);
          }
        }
        setAiInsights(parsedInsights);
        // Save to database
        if (parsedInsights.length > 0) {
          saveAIAnalysisToDatabase(selectedResource.id, {
            keyInsights: parsedInsights,
          });
        }
      } else if (action === 'methodology') {
        // Handle methodology response - content may be array (pre-parsed) or string
        let parsedMethodology: AIInsight[] = [];
        let methodologyText = '';
        if (Array.isArray(data.content)) {
          parsedMethodology = data.content;
          methodologyText = JSON.stringify(data.content);
        } else if (typeof data.content === 'string') {
          methodologyText = data.content;
          try {
            const methodology = JSON.parse(data.content);
            if (Array.isArray(methodology)) {
              parsedMethodology = methodology;
            }
          } catch {
            // If not valid JSON, try to parse markdown format
            logger.debug(
              'JSON parsing failed, trying markdown parsing for methodology'
            );
            parsedMethodology = parseMarkdownToInsights(data.content);
          }
        }
        setAiMethodology(parsedMethodology);
        // Save to database
        if (methodologyText) {
          saveAIAnalysisToDatabase(selectedResource.id, {
            methodology: methodologyText,
          });
        }
      }

      // Only add summary to chat messages, not insights/methodology
      // (insights/methodology are displayed as structured blocks)
      if (action === 'summary') {
        const assistantMessage: AIMessage = {
          role: 'assistant',
          content: data.content,
          timestamp: new Date(),
        };
        setAiMessages((prev) => [...prev, assistantMessage]);
      }
    } catch (error) {
      logger.error(`Failed to execute ${action}:`, error);
      const errorMessage: AIMessage = {
        role: 'assistant',
        content: `执行 ${action} 失败，请检查AI服务`,
        timestamp: new Date(),
      };
      setAiMessages((prev) => [...prev, errorMessage]);
    } finally {
      setAiLoading(false);
    }
  };

  // Upvote function - calls backend API
  const toggleUpvote = async (resourceId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    // Require user to be logged in
    if (!user || !accessToken) {
      // Optionally show a login prompt
      logger.warn('User must be logged in to upvote');
      return;
    }

    // Optimistic update for better UX
    const wasUpvoted = upvotes.has(resourceId);
    const newUpvotes = new Set(upvotes);

    if (wasUpvoted) {
      newUpvotes.delete(resourceId);
      // 减少点赞数
      setResources((prev) =>
        prev.map((r) =>
          r.id === resourceId
            ? { ...r, upvoteCount: Math.max(0, (r.upvoteCount || 0) - 1) }
            : r
        )
      );
      if (selectedResource?.id === resourceId) {
        setSelectedResource((prev) =>
          prev
            ? {
                ...prev,
                upvoteCount: Math.max(0, (prev.upvoteCount || 0) - 1),
              }
            : null
        );
      }
    } else {
      newUpvotes.add(resourceId);
      // 增加点赞数
      setResources((prev) =>
        prev.map((r) =>
          r.id === resourceId
            ? { ...r, upvoteCount: (r.upvoteCount || 0) + 1 }
            : r
        )
      );
      if (selectedResource?.id === resourceId) {
        setSelectedResource((prev) =>
          prev
            ? {
                ...prev,
                upvoteCount: (prev.upvoteCount || 0) + 1,
              }
            : null
        );
      }
    }
    setUpvotes(newUpvotes);

    // Call backend API
    try {
      const response = await fetch(
        `${config.apiUrl}/resources/${resourceId}/upvote`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to toggle upvote');
      }

      const result = await response.json();
      // Handle wrapped response { success: true, data: {...} }
      const data = result?.data ?? result;

      // Update with server state (authoritative)
      if (data.upvoted) {
        setUpvotes((prev) => new Set([...prev, resourceId]));
      } else {
        setUpvotes((prev) => {
          const next = new Set(prev);
          next.delete(resourceId);
          return next;
        });
      }

      // Update upvote count from server
      setResources((prev) =>
        prev.map((r) =>
          r.id === resourceId ? { ...r, upvoteCount: data.upvoteCount } : r
        )
      );
      if (selectedResource?.id === resourceId) {
        setSelectedResource((prev) =>
          prev ? { ...prev, upvoteCount: data.upvoteCount } : null
        );
      }
    } catch (error) {
      logger.error('Failed to toggle upvote:', error);
      // Revert optimistic update on error
      if (wasUpvoted) {
        setUpvotes((prev) => new Set([...prev, resourceId]));
        setResources((prev) =>
          prev.map((r) =>
            r.id === resourceId
              ? { ...r, upvoteCount: (r.upvoteCount || 0) + 1 }
              : r
          )
        );
      } else {
        setUpvotes((prev) => {
          const next = new Set(prev);
          next.delete(resourceId);
          return next;
        });
        setResources((prev) =>
          prev.map((r) =>
            r.id === resourceId
              ? { ...r, upvoteCount: Math.max(0, (r.upvoteCount || 0) - 1) }
              : r
          )
        );
      }
    }
  };

  const hasUpvoted = (resourceId: string) => {
    return upvotes.has(resourceId);
  };

  // Comment click handler - opens comment section
  const handleCommentClick = (resource: Resource, e: React.MouseEvent) => {
    e.stopPropagation();
    handleResourceClick(resource);
    // Switch to comments tab in detail view
    setAiRightTab('comments');
  };

  // Admin: Delete resource handler
  const handleDeleteResource = async (
    resourceId: string,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    if (!isAdmin) return;

    if (
      !(await confirm({
        title: '确定要删除这个资源吗？',
        description: '此操作无法撤销。',
        type: 'danger',
      }))
    ) {
      return;
    }

    try {
      const response = await fetch(
        `${config.apiUrl}/admin/resources/${resourceId}`,
        {
          method: 'DELETE',
          headers: getAuthHeader(),
        }
      );

      if (response.ok) {
        // Remove from local state
        setResources((prev) => prev.filter((r) => r.id !== resourceId));
        // If viewing the deleted resource, go back to list
        if (selectedResource?.id === resourceId) {
          setSelectedResource(null);
          setViewMode('list');
        }
        setToast({ message: '资源已删除', type: 'success' });
      } else {
        const errorData = await response.json().catch(() => ({}));
        setToast({
          message: errorData.message || '删除资源失败',
          type: 'error',
        });
      }
    } catch (err) {
      logger.error('Failed to delete resource:', err);
      setToast({ message: '删除资源失败：网络错误', type: 'error' });
    }
  };

  const hasSolarYouTubeChannelResources = resources.some(isSolarYouTubeChannel);
  const hasYouTubeVideoResources = resources.some(
    (resource) => resource.type === 'YOUTUBE_VIDEO'
  );
  const isYoutubeListMode =
    viewMode === 'list' &&
    (activeTab === 'youtube' ||
      youtubeLibraryTab === 'solar' ||
      Boolean(selectedYouTubeChannel) ||
      hasSolarYouTubeChannelResources ||
      hasYouTubeVideoResources);
  const isSolarYouTubeReportsMode =
    isYoutubeListMode && youtubeLibraryTab === 'solar';
  const isYouTubeChannelVideoMode =
    isYoutubeListMode &&
    youtubeLibraryTab === 'genesis' &&
    Boolean(selectedYouTubeChannel);
  const hasSolarHfPaperResources = resources.some((resource) => {
    const importedAs = resource.metadata?.importedAs;
    return (
      importedAs === 'hf-paper-insight-report' || importedAs === 'hf-hot-paper'
    );
  });
  const isPaperUrlMode =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('tab') === 'papers';
  const isPaperListMode =
    viewMode === 'list' &&
    (activeTab === 'papers' ||
      searchParams?.get('tab') === 'papers' ||
      isPaperUrlMode ||
      hasSolarHfPaperResources);
  const urlActiveTab = searchParams?.get('tab');
  const navigationActiveTab =
    urlActiveTab && VALID_TABS.includes(urlActiveTab as TabType)
      ? (urlActiveTab as TabType)
      : activeTab;

  const renderYouTubeLibraryTabs = () => {
    const tabClass = (tab: YouTubeLibraryTab) =>
      `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        youtubeLibraryTab === tab
          ? 'bg-gray-900 text-white'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      }`;

    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-3">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
          <button
            type="button"
            className={tabClass('genesis')}
            onClick={() => {
              setYoutubeLibraryTab('genesis');
              setSelectedSolarReport(null);
            }}
          >
            GenesisPod YouTube
          </button>
          <button
            type="button"
            className={tabClass('solar')}
            onClick={() => {
              setYoutubeLibraryTab('solar');
              setSelectedYouTubeChannel(null);
              setYoutubeChannelVideos([]);
              router.replace('/explore?tab=youtube');
            }}
          >
            Solar-harness 洞察
          </button>
        </div>

        {selectedYouTubeChannel && youtubeLibraryTab === 'genesis' && (
          <button
            type="button"
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            onClick={() => {
              setSelectedYouTubeChannel(null);
              setYoutubeChannelVideos([]);
              router.replace('/explore?tab=youtube');
            }}
          >
            返回频道
          </button>
        )}

        {selectedSolarReport && youtubeLibraryTab === 'solar' && (
          <button
            type="button"
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            onClick={() => setSelectedSolarReport(null)}
          >
            返回报告
          </button>
        )}
      </div>
    );
  };

  const renderPaperLibraryTabs = () => {
    if (!isPaperListMode) return null;

    const tabClass = (tab: PaperLibraryTab) =>
      `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        paperLibraryTab === tab
          ? 'bg-gray-900 text-white'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      }`;

    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-3">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
          <button
            type="button"
            className={tabClass('recent')}
            onClick={() => {
              setPaperLibraryTab('recent');
              setSelectedResource(null);
              setViewMode('list');
            }}
          >
            最近趋势
          </button>
          <button
            type="button"
            className={tabClass('insights')}
            onClick={() => {
              setPaperLibraryTab('insights');
              setSelectedResource(null);
              setViewMode('list');
            }}
          >
            HF 洞察报告
          </button>
          <button
            type="button"
            className={tabClass('hot')}
            onClick={() => {
              setPaperLibraryTab('hot');
              setSelectedResource(null);
              setViewMode('list');
            }}
          >
            热门论文
          </button>
        </div>

        <p className="text-xs text-gray-500">
          {paperLibraryTab === 'recent'
            ? '最近同步数据里的 HuggingFace / arXiv 热点趋势'
            : paperLibraryTab === 'insights'
              ? '来自 AI Influence 的 HuggingFace 论文洞察报告'
              : 'HuggingFace / arXiv 当前 AI、计算、芯片、软件相关热榜'}
        </p>
      </div>
    );
  };

  const formatTrendNumber = (value?: number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? new Intl.NumberFormat('en-US').format(Math.round(value))
      : 'N/A';

  const renderSparkBars = (
    values: number[] = [],
    colorClass = 'bg-sky-500',
    heightClass = 'h-12'
  ) => {
    const max = Math.max(1, ...values);

    return (
      <div className={`flex ${heightClass} items-end gap-0.5`}>
        {values.map((value, index) => {
          const height = Math.max(8, Math.round((value / max) * 100));
          return (
            <span
              key={`${index}-${value}`}
              className={`min-w-[3px] flex-1 rounded-t-sm ${colorClass}`}
              style={{
                height: `${height}%`,
                opacity: value > 0 ? 0.45 + height / 190 : 0.16,
              }}
              title={`${paperTrendData?.dates?.[index] || index}: ${value}`}
            />
          );
        })}
      </div>
    );
  };

  const renderTrendDelta = (delta: number) => {
    if (delta > 0) {
      return (
        <span className="inline-flex items-center gap-1 text-emerald-700">
          <ArrowUpRight className="h-3.5 w-3.5" />
          +{formatTrendNumber(delta)}
        </span>
      );
    }

    if (delta < 0) {
      return <span className="text-rose-700">{formatTrendNumber(delta)}</span>;
    }

    return (
      <span className="inline-flex items-center gap-1 text-gray-500">
        <Minus className="h-3.5 w-3.5" />
        0
      </span>
    );
  };

  const renderTrendTable = (
    title: string,
    subtitle: string,
    rows: PaperTrendTableRow[],
    accentClass = 'text-sky-700'
  ) => (
    <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-3 py-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-950">{title}</h3>
          <p className="mt-1 text-xs text-gray-500">{subtitle}</p>
        </div>
        <Table2 className={`h-4 w-4 flex-shrink-0 ${accentClass}`} />
      </div>
      <div>
        <table className="w-full table-fixed border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <th className="w-9 px-3 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">论文</th>
              <th className="w-24 px-2 py-2 font-medium">方向</th>
              <th className="w-16 px-2 py-2 text-right font-medium">热度</th>
              <th className="w-20 px-2 py-2 text-right font-medium">信号</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${title}-${row.paperId}`} className="border-t">
                <td className="border-t border-gray-100 px-3 py-2 align-top text-xs font-semibold text-gray-400">
                  {row.tableRank}
                </td>
                <td className="border-t border-gray-100 px-2 py-2 align-top">
                  <p className="line-clamp-2 text-xs font-medium leading-snug text-gray-950">
                    {row.hfUrl || row.arxivUrl ? (
                      <a
                        href={row.hfUrl || row.arxivUrl || '#'}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="hover:text-red-600 hover:underline"
                      >
                        {row.title}
                      </a>
                    ) : (
                      row.title
                    )}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] leading-none">
                    {row.hfUrl && (
                      <a
                        href={row.hfUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="font-medium text-sky-700 hover:underline"
                      >
                        HF
                      </a>
                    )}
                    {row.arxivUrl && (
                      <a
                        href={row.arxivUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="font-medium text-rose-700 hover:underline"
                      >
                        arXiv
                      </a>
                    )}
                    <span className="text-gray-400">{row.date}</span>
                  </div>
                  {row.summary && (
                    <p className="mt-1 line-clamp-1 text-[11px] leading-relaxed text-gray-500">
                      {row.summary}
                    </p>
                  )}
                </td>
                <td className="border-t border-gray-100 px-2 py-2 align-top">
                  <span className="inline-flex max-w-full rounded-full bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-700">
                    {row.topic || 'N/A'}
                  </span>
                </td>
                <td className="border-t border-gray-100 px-2 py-2 text-right align-top font-mono text-xs text-gray-800">
                  {formatTrendNumber(row.trendScore)}
                </td>
                <td className="border-t border-gray-100 px-2 py-2 text-right align-top font-mono text-[11px] text-gray-600">
                  <div>{formatTrendNumber(row.appearances)} 次</div>
                  <div className="mt-0.5 text-gray-400">
                    best #{formatTrendNumber(row.bestRank)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );

  const renderPaperTrendDashboard = () => {
    if (!isPaperListMode || paperLibraryTab !== 'recent') return null;

    if (loadingPaperTrendData) {
      return (
        <div className="space-y-5">
          <div className="h-72 animate-pulse rounded-xl border border-gray-200 bg-white" />
          <div className="grid gap-4 lg:grid-cols-2">
            {[1, 2, 3, 4].map((item) => (
              <div
                key={item}
                className="h-56 animate-pulse rounded-lg border border-gray-200 bg-white"
              />
            ))}
          </div>
        </div>
      );
    }

    if (!paperTrendData) {
      return (
        <Alert
          tone="warn"
          title="趋势数据未加载"
        >
          未能读取本地 Solar HuggingFace / arXiv 趋势快照。
        </Alert>
      );
    }

    const topics = paperTrendData.topics || [];
    const leadingTopic =
      paperTrendData.headline?.leadingTopic || topics[0]?.topic || 'N/A';
    const maxTopicScore = Math.max(
      1,
      ...topics.map((topic) => topic.totalScore || 0)
    );
    const topicColors = [
      'bg-sky-500',
      'bg-emerald-500',
      'bg-amber-500',
      'bg-rose-500',
      'bg-violet-500',
      'bg-cyan-500',
      'bg-slate-500',
      'bg-lime-500',
    ];
    const trendTables = [
      {
        key: 'day',
        title: '当日热点论文',
        subtitle: paperTrendData.windows.day,
        rows: paperTrendData.tables.day,
        accent: 'text-rose-700',
      },
      {
        key: 'week',
        title: '当周热点论文',
        subtitle: paperTrendData.windows.week,
        rows: paperTrendData.tables.week,
        accent: 'text-amber-700',
      },
      {
        key: 'month',
        title: '当月热点论文',
        subtitle: paperTrendData.windows.month,
        rows: paperTrendData.tables.month,
        accent: 'text-emerald-700',
      },
      {
        key: 'quarter',
        title: '当季热点论文',
        subtitle: paperTrendData.windows.quarter,
        rows: paperTrendData.tables.quarter,
        accent: 'text-sky-700',
      },
    ];

    return (
      <div className="space-y-6">
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="border-b border-gray-100 p-5 lg:border-b-0 lg:border-r">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-red-600">
                    <Activity className="h-4 w-4" />
                    热点趋势雷达
                  </p>
                  <p className="mt-1 max-w-xl text-xs leading-relaxed text-gray-500">
                    按最近一季论文进入热榜的次数和排名加权汇总；条越长，说明这个方向越持续热门。
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-normal text-gray-950">
                    {leadingTopic}
                  </h2>
                </div>
                <span className="rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600">
                  最新 {paperTrendData.latestDailyDate || 'N/A'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">今日论文</p>
                  <p className="mt-1 font-mono text-2xl font-semibold text-gray-950">
                    {formatTrendNumber(paperTrendData.headline?.papersToday)}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">季度样本</p>
                  <p className="mt-1 font-mono text-2xl font-semibold text-gray-950">
                    {formatTrendNumber(
                      paperTrendData.headline?.papersInQuarter
                    )}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">领先热度</p>
                  <p className="mt-1 font-mono text-2xl font-semibold text-gray-950">
                    {formatTrendNumber(paperTrendData.headline?.leadingScore)}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">历史覆盖</p>
                  <p className="mt-1 font-mono text-2xl font-semibold text-gray-950">
                    {formatTrendNumber(paperTrendData.source?.coverage?.rows)}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-gray-500">
                    {paperTrendData.source?.coverage?.startDate || 'N/A'} 起
                  </p>
                  <p className="truncate text-[11px] text-gray-500">
                    独立 arXiv {formatTrendNumber(paperTrendData.source?.coverage?.arxivRows)} 条
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {topics.map((topic, index) => {
                  const width = Math.max(
                    6,
                    Math.round((topic.totalScore / maxTopicScore) * 100)
                  );
                  return (
                    <div key={topic.topic}>
                      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                        <span className="font-medium text-gray-800">
                          {topic.topic}
                        </span>
                        <span className="font-mono text-gray-500">
                          {formatTrendNumber(topic.totalScore)}
                        </span>
                      </div>
                      <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className={`h-full rounded-full ${topicColors[index % topicColors.length]}`}
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <BarChart3 className="h-4 w-4" />
                    30 天论文同步量
                  </p>
                  <p className="mt-1 text-sm text-gray-600">
                    每根柱代表当天同步到的热榜论文数量；柱越高，说明当天样本越多，低谷通常代表当天采集覆盖较少。
                  </p>
                </div>
              </div>
              {renderSparkBars(
                paperTrendData.dailyCounts.map((item) => item.count),
                'bg-gray-800',
                'h-40'
              )}
              <div className="mt-3 flex justify-between text-xs text-gray-400">
                <span>{paperTrendData.dates[0] || 'N/A'}</span>
                <span>
                  {paperTrendData.dates[paperTrendData.dates.length - 1] ||
                    'N/A'}
                </span>
              </div>
              <p className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-500">
                这张图看的是“采集覆盖量”，不是论文热度本身；热度判断看左侧雷达和下方各方向走势图。
              </p>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-950">
                热点走势图
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                每张小图展示该方向最近 30 天的加权热度：排名越靠前、出现越频繁，柱子越高；右上角是今日相对前一日的变化。
              </p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {topics.slice(0, 6).map((topic, index) => (
              <article
                key={topic.topic}
                className="rounded-lg border border-gray-200 bg-white p-4"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-gray-950">
                      {topic.topic}
                    </h3>
                    <p className="mt-1 text-xs text-gray-500">
                      {formatTrendNumber(topic.count)} 篇相关论文进入样本
                    </p>
                  </div>
                  <div className="text-right text-xs font-medium">
                    {renderTrendDelta(topic.delta)}
                    <p className="mt-1 font-mono text-gray-500">
                      今日 {formatTrendNumber(topic.latestScore)}
                    </p>
                  </div>
                </div>
                {renderSparkBars(
                  topic.values,
                  topicColors[index % topicColors.length],
                  'h-16'
                )}
              </article>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-3">
            <h2 className="text-base font-semibold text-gray-950">
              热点论文榜单
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              按窗口内累计热度排序；“信号”显示进入榜单次数和该窗口内最佳名次。
            </p>
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            {trendTables.map((table) =>
              renderTrendTable(
                table.title,
                table.subtitle,
                table.rows,
                table.accent
              )
            )}
          </div>
        </section>
      </div>
    );
  };

  const renderYouTubeChannelVideos = () => {
    if (!isYouTubeChannelVideoMode || !selectedYouTubeChannel) return null;

    const longVideos = Number(selectedYouTubeChannel.metadata?.longVideos || 0);

    return (
      <div className="space-y-5">
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="flex items-center gap-4 p-5">
            <div className="h-24 w-36 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
              <ResourceThumbnail
                resource={selectedYouTubeChannel}
                className="h-full w-full"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">
                  YouTube Channel
                </span>
                <span>{longVideos} 个 10 分钟以上视频</span>
              </div>
              <h2 className="truncate text-xl font-semibold text-gray-900">
                {selectedYouTubeChannel.title}
              </h2>
              <p className="mt-1 line-clamp-2 text-sm text-gray-600">
                {selectedYouTubeChannel.abstract}
              </p>
            </div>
          </div>
        </section>

        {loadingChannelVideos && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
            正在加载频道视频...
          </div>
        )}

        {!loadingChannelVideos && youtubeChannelVideos.length === 0 && (
          <EmptyState
            title="这个频道暂无长视频"
            description="Solar-harness 当前没有同步到 10 分钟以上的视频"
          />
        )}

        {!loadingChannelVideos &&
          youtubeChannelVideos.map((video) => (
            <article
              key={video.id}
              onClick={() => handleResourceClick(video)}
              className="group w-full cursor-pointer overflow-hidden rounded-xl border border-gray-200 bg-white transition-all hover:shadow-lg"
            >
              <div className="flex h-44 w-full overflow-hidden">
                <div className="relative h-44 w-64 flex-shrink-0 overflow-hidden bg-gray-100">
                  <ResourceThumbnail
                    resource={video}
                    className="h-full w-full"
                  />
                  {formatDuration(video.metadata?.durationSeconds) && (
                    <span className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium text-white">
                      {formatDuration(video.metadata?.durationSeconds)}
                    </span>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col p-5">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <ClientDate
                      date={video.publishedAt}
                      format="date"
                      locale="en-US"
                      dateOptions={{
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      }}
                    />
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">
                      {String(video.metadata?.transcriptStatus || 'missing')}
                    </span>
                    {Number(video.metadata?.transcriptChars || 0) > 0 && (
                      <span>
                        {Number(video.metadata?.transcriptChars)} 字转录
                      </span>
                    )}
                  </div>
                  <h3 className="line-clamp-2 text-lg font-semibold text-red-600 group-hover:underline">
                    {video.title}
                  </h3>
                  <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-gray-700">
                    {getSolarYouTubeVideoDescription(video) ||
                      'Solar-harness 暂未采集到该视频介绍'}
                  </p>
                  <div className="mt-auto pt-3 text-sm font-medium text-gray-500">
                    打开视频与字幕
                  </div>
                </div>
              </div>
            </article>
          ))}
      </div>
    );
  };

  const renderSolarYouTubeReports = () => {
    if (!isSolarYouTubeReportsMode) return null;

    if (loadingSolarReports) {
      return (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
          正在加载 Solar-harness YouTube 洞察...
        </div>
      );
    }

    if (selectedSolarReport) {
      return (
        <article className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 p-6">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">
                {selectedSolarReport.source}
              </span>
              <span>{selectedSolarReport.generatedAt}</span>
              {selectedSolarReport.empty && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                  空采集
                </span>
              )}
            </div>
            <h2 className="text-2xl font-semibold text-gray-900">
              {selectedSolarReport.title}
            </h2>
            {selectedSolarReport.subtitle && (
              <p className="mt-2 text-sm leading-relaxed text-gray-600">
                {selectedSolarReport.subtitle}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {getSolarReportMetricLabels(selectedSolarReport).map((label) => (
                <span
                  key={label}
                  className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700"
                >
                  {label}
                </span>
              ))}
            </div>
            {!!selectedSolarReport.metrics?.channels?.length && (
              <p className="mt-3 text-xs text-gray-500">
                来源频道：{selectedSolarReport.metrics.channels.join('、')}
              </p>
            )}
            <p className="mt-2 break-all text-xs text-gray-500">
              {selectedSolarReport.path}
            </p>
          </div>
          <div className="prose prose-sm max-w-none p-6 text-gray-800">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {selectedSolarReport.content}
            </ReactMarkdown>
          </div>
        </article>
      );
    }

    if (solarReports.length === 0) {
      return (
        <EmptyState
          title="暂无 Solar-harness 洞察报告"
          description="同步脚本尚未生成本地 YouTube 洞察索引"
        />
      );
    }

    return (
      <div className="space-y-5">
        {solarReports.map((report) => (
          <article
            key={report.id}
            onClick={() => setSelectedSolarReport(report)}
            className="group cursor-pointer rounded-xl border border-gray-200 bg-white p-6 transition-all hover:shadow-lg"
          >
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">
                {report.source}
              </span>
              <span>{report.generatedAt}</span>
              {report.empty && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                  空采集
                </span>
              )}
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              {getSolarReportMetricLabels(report).map((label) => (
                <span
                  key={label}
                  className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700"
                >
                  {label}
                </span>
              ))}
            </div>
            <h2 className="line-clamp-2 text-xl font-semibold text-red-600 group-hover:underline">
              {report.title}
            </h2>
            {report.subtitle && (
              <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-gray-600">
                {report.subtitle}
              </p>
            )}
            <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-gray-700">
              {report.excerpt || '报告暂无正文摘要'}
            </p>
          </article>
        ))}
      </div>
    );
  };

  return (
    <>
      <ReportWorkspace />

      {/* Center Content Area */}
      <main
        className={`min-w-0 flex-1 bg-gray-50 ${viewMode === 'detail' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'}`}
      >
        {/* Sticky Search Bar Container - Only show in list view */}
        {viewMode === 'list' && (
          <div className="sticky top-0 z-10 bg-gray-50 pb-4 pt-6">
            <div className="mx-auto max-w-6xl px-8">
              {/* Large Search Bar */}
              <div className="mb-4">
                <div className="relative rounded-lg border border-gray-300 bg-white shadow-sm">
                  <div className="flex items-center">
                    {/* Search Icon */}
                    <div className="flex items-center px-4 py-3">
                      <svg
                        className="h-5 w-5 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                        />
                      </svg>
                    </div>

                    {/* Search Input */}
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder={t('explore.searchPlaceholder')}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={handleSearch}
                      onFocus={() => {
                        if (searchQuery.length >= 2) {
                          setShowSuggestions(true);
                        }
                      }}
                      className="flex-1 border-none px-4 py-3 text-sm focus:outline-none focus:ring-0"
                    />

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 px-4">
                      {/* File Upload Button */}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept={FILE_RESTRICTIONS[activeTab]?.accept || '*'}
                        onChange={handleFileChange}
                        className="hidden"
                      />
                    </div>
                  </div>

                  {/* Search Suggestions Dropdown */}
                  {showSuggestions && searchSuggestions.length > 0 && (
                    <div
                      ref={suggestionsRef}
                      className="absolute left-0 right-0 top-full z-20 mt-2 max-h-96 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg"
                    >
                      {searchSuggestions.map((suggestion, index) => (
                        <div
                          key={suggestion.id}
                          onClick={() => handleSuggestionClick(suggestion)}
                          className={`cursor-pointer border-b border-gray-100 px-4 py-3 transition-colors last:border-b-0 ${
                            index === selectedSuggestionIndex
                              ? 'border-l-4 border-l-red-500 bg-red-50'
                              : 'hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            {/* Type Icon */}
                            <div className="mt-1 flex-shrink-0">
                              {suggestion.type === 'PAPER' && (
                                <svg
                                  className="h-5 w-5 text-blue-500"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                                  />
                                </svg>
                              )}
                              {suggestion.type === 'PROJECT' && (
                                <svg
                                  className="h-5 w-5 text-green-500"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                                  />
                                </svg>
                              )}
                              {suggestion.type === 'NEWS' && (
                                <svg
                                  className="h-5 w-5 text-orange-500"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"
                                  />
                                </svg>
                              )}
                              {suggestion.type === 'BLOG' && (
                                <svg
                                  className="h-5 w-5 text-purple-500"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                  />
                                </svg>
                              )}
                              {suggestion.type === 'REPORT' && (
                                <svg
                                  className="h-5 w-5 text-indigo-500"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                                  />
                                </svg>
                              )}
                              {suggestion.type === 'POLICY' && (
                                <svg
                                  className="h-5 w-5 text-red-500"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                                  />
                                </svg>
                              )}
                              {suggestion.type === 'YOUTUBE_VIDEO' && (
                                <svg
                                  className="h-5 w-5 text-red-600"
                                  fill="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                                </svg>
                              )}
                            </div>

                            {/* Content */}
                            <div className="min-w-0 flex-1">
                              <div className="mb-1 flex items-center gap-2">
                                <h4 className="truncate text-sm font-medium text-gray-900">
                                  {suggestion.title}
                                </h4>
                                <span className="flex-shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                                  {suggestion.type.toLowerCase()}
                                </span>
                              </div>
                              <p className="line-clamp-2 text-xs text-gray-600">
                                {suggestion.highlight}
                              </p>
                            </div>

                            {/* Arrow Icon */}
                            <div className="mt-1 flex-shrink-0">
                              <svg
                                className="h-4 w-4 text-gray-400"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M9 5l7 7-7 7"
                                />
                              </svg>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Tabs and Filters */}
              <ResponsiveNav
                activeTab={navigationActiveTab}
                onTabChange={(tab) => {
                  setActiveTab(tab);
                  router.replace(`/explore?tab=${tab}`);
                }}
                onImportUrlClick={() => setShowImportUrlDialog(true)}
                onImportFileClick={() => setShowImportFileDialog(true)}
                onFilterClick={() => setShowFilterPanel(true)}
                filterActive={
                  selectedCategories.length > 0 ||
                  selectedSources.length > 0 ||
                  dateRange !== 'all' ||
                  minQualityScore > 0
                }
                sortBy={sortBy}
                onSortChange={setSortBy}
                youtubeLibraryTab={youtubeLibraryTab}
                onYouTubeLibraryTabChange={(tab) => {
                  setYoutubeLibraryTab(tab);
                  if (tab === 'genesis') {
                    setSelectedSolarReport(null);
                  } else {
                    setSelectedYouTubeChannel(null);
                    setYoutubeChannelVideos([]);
                    router.replace('/explore?tab=youtube');
                  }
                }}
              />
              {renderPaperLibraryTabs()}
            </div>
          </div>
        )}

        {/* Content Area */}
        <div
          className={`${viewMode === 'detail' ? 'flex w-full flex-1 flex-col overflow-hidden px-2 pt-2' : 'mx-auto max-w-6xl px-8 pb-6'}`}
        >
          {/* List View */}
          {viewMode === 'list' && (
            <>
              {renderSolarYouTubeReports()}
              {renderYouTubeChannelVideos()}

              {/* Loading State */}
              {loading &&
                !isSolarYouTubeReportsMode &&
                !isYouTubeChannelVideoMode && (
                  <div className="space-y-5">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="flex animate-pulse items-start gap-4 rounded-xl border border-gray-200 bg-white p-6"
                      >
                        <div className="h-6 w-6 flex-shrink-0 rounded bg-gray-200"></div>
                        <div className="flex-1">
                          <div className="mb-3 h-3 w-48 rounded bg-gray-200"></div>
                          <div className="mb-3 h-6 w-3/4 rounded bg-gray-200"></div>
                          <div className="mb-2 h-4 w-full rounded bg-gray-200"></div>
                          <div className="h-4 w-5/6 rounded bg-gray-200"></div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

              {!loading &&
                !isSolarYouTubeReportsMode &&
                !isYouTubeChannelVideoMode &&
                isPaperListMode &&
                paperLibraryTab === 'recent' &&
                renderPaperTrendDashboard()}

              {/* Resource Cards - Horizontal Layout */}
              {!loading &&
                !isSolarYouTubeReportsMode &&
                !isYouTubeChannelVideoMode &&
                !(isPaperListMode && paperLibraryTab === 'recent') &&
                resources.length > 0 && (
                  <div className="space-y-5">
                    {resources
                      .filter((resource) => {
                        // Filter out invalid resources (no title or empty title)
                        if (!resource.title || resource.title.trim() === '')
                          return false;
                        // Apply source filter if any sources are selected
                        if (selectedSources.length === 0) return true;
                        const sourceName = getSourceName(resource);
                        if (!sourceName) return false;
                        // Check if any selected source matches (case-insensitive partial match)
                        return selectedSources.some(
                          (selected) =>
                            sourceName
                              .toLowerCase()
                              .includes(selected.toLowerCase()) ||
                            selected
                              .toLowerCase()
                              .includes(sourceName.toLowerCase())
                        );
                      })
                      .map((resource) => (
                        <article
                          key={resource.id}
                          onClick={() => handleResourceClick(resource)}
                          className="group w-full cursor-pointer overflow-hidden rounded-xl border border-gray-200 bg-white transition-all hover:shadow-lg"
                        >
                          <div className="flex h-48 w-full overflow-hidden">
                            {/* Thumbnail - 论文使用竖向比例(w-36)，其他使用横向比例(w-64) */}
                            <div
                              className={`relative h-48 flex-shrink-0 overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100 ${resource.type === 'PAPER' ? 'w-36' : 'w-64'}`}
                            >
                              <ResourceThumbnail
                                resource={resource}
                                className="h-full w-full"
                              />
                            </div>

                            {/* Content - 右侧内容区 */}
                            <div className="flex min-w-0 flex-1 flex-col overflow-hidden p-5">
                              {/* Date, Source Badge, Tags, and Stats */}
                              <div className="mb-2 flex flex-shrink-0 flex-wrap items-center gap-2 text-xs text-gray-500">
                                <ClientDate
                                  date={resource.publishedAt}
                                  format="date"
                                  locale="en-US"
                                  dateOptions={{
                                    day: 'numeric',
                                    month: 'short',
                                    year: 'numeric',
                                  }}
                                />
                                {/* Source Badge */}
                                {(() => {
                                  const sourceName = getSourceName(resource);
                                  return sourceName ? (
                                    <span
                                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${getSourceBadgeColor(sourceName, resource.type)}`}
                                      title={`Source: ${sourceName}`}
                                    >
                                      <span className="max-w-[120px] truncate">
                                        {sourceName}
                                      </span>
                                    </span>
                                  ) : null;
                                })()}
                                {resource.upvoteCount !== undefined && (
                                  <span className="flex items-center gap-1 text-gray-600">
                                    <svg
                                      className="h-3 w-3"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M5 10l7-7m0 0l7 7m-7-7v18"
                                      />
                                    </svg>
                                    {resource.upvoteCount}
                                  </span>
                                )}
                                {resource.categories &&
                                  resource.categories
                                    .slice(0, 2)
                                    .map((cat, i) => (
                                      <span key={i} className="text-gray-600">
                                        {cat}
                                      </span>
                                    ))}
                                {/* AI Insights Chip - 紧凑版 */}
                                {resource.keyInsights &&
                                  resource.keyInsights.length > 0 && (
                                    <InsightChip
                                      insights={resource.keyInsights}
                                    />
                                  )}
                              </div>

                              {/* Title */}
                              <h2
                                className="mb-2 flex-shrink-0 truncate text-xl font-semibold text-red-600 hover:underline"
                                title={resource.title}
                              >
                                {resource.title}
                                {resource.linkHealth === 'BROKEN' && (
                                  <span
                                    className="ml-1 inline-flex items-center text-amber-500"
                                    title="链接可能已失效"
                                  >
                                    <svg
                                      className="h-3.5 w-3.5"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                                      />
                                    </svg>
                                  </span>
                                )}
                              </h2>

                              {/* Abstract or Fallback Info */}
                              <p
                                className="line-clamp-2 min-h-0 flex-shrink overflow-hidden text-ellipsis text-sm leading-relaxed text-gray-700"
                                title={
                                  resource.aiSummary || resource.abstract || ''
                                }
                              >
                                {resource.aiSummary || resource.abstract || (
                                  <span className="text-gray-500">
                                    {resource.sourceUrl && (
                                      <>
                                        <span className="font-medium">
                                          Source:
                                        </span>{' '}
                                        {new URL(
                                          resource.sourceUrl
                                        ).hostname.replace('www.', '')}
                                      </>
                                    )}
                                    {resource.authors &&
                                      resource.authors.length > 0 && (
                                        <>
                                          {resource.sourceUrl && ' • '}
                                          <span className="font-medium">
                                            By:
                                          </span>{' '}
                                          {resource.authors
                                            .slice(0, 3)
                                            .map(
                                              (a) =>
                                                a.name ||
                                                a.username ||
                                                'Unknown'
                                            )
                                            .join(', ')}
                                          {resource.authors.length > 3 &&
                                            ' et al.'}
                                        </>
                                      )}
                                  </span>
                                )}
                              </p>

                              {/* Spacer */}
                              <div className="flex-1"></div>

                              {/* Bottom Actions */}
                              <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-t border-gray-100 pt-2 sm:gap-6">
                                {/* Bookmark Button - Simple version */}
                                <button
                                  onClick={(e) =>
                                    toggleBookmark(resource.id, e)
                                  }
                                  className={`flex items-center gap-2 text-sm transition-colors ${
                                    isBookmarked(resource.id)
                                      ? 'text-blue-600 hover:text-blue-700'
                                      : 'text-gray-600 hover:text-blue-600'
                                  }`}
                                >
                                  <svg
                                    className="h-4 w-4"
                                    fill={
                                      isBookmarked(resource.id)
                                        ? 'currentColor'
                                        : 'none'
                                    }
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
                                    />
                                  </svg>
                                  {isBookmarked(resource.id)
                                    ? 'Bookmarked'
                                    : 'Bookmark'}
                                </button>
                                {/* Upvote Button */}
                                {resource.upvoteCount !== undefined && (
                                  <button
                                    className={`flex items-center gap-2 text-sm transition-colors ${
                                      hasUpvoted(resource.id)
                                        ? 'font-medium text-blue-600'
                                        : 'text-gray-600 hover:text-blue-600'
                                    }`}
                                    onClick={(e) =>
                                      toggleUpvote(resource.id, e)
                                    }
                                    title="点赞"
                                  >
                                    <ThumbsUp
                                      className={`h-4 w-4 ${
                                        hasUpvoted(resource.id)
                                          ? 'fill-current'
                                          : ''
                                      }`}
                                    />
                                    {resource.upvoteCount}
                                  </button>
                                )}
                                {/* Comment Button */}
                                {resource.commentCount !== undefined && (
                                  <button
                                    className="flex items-center gap-2 text-sm text-gray-600 transition-colors hover:text-green-600"
                                    onClick={(e) =>
                                      handleCommentClick(resource, e)
                                    }
                                    title="评论"
                                  >
                                    <svg
                                      className="h-4 w-4"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                                      />
                                    </svg>
                                    {resource.commentCount}
                                  </button>
                                )}

                                {/* Admin Delete Button */}
                                {isAdmin && (
                                  <button
                                    onClick={(e) =>
                                      handleDeleteResource(resource.id, e)
                                    }
                                    className="flex items-center gap-2 text-sm text-gray-400 transition-colors hover:text-red-600"
                                    title="Delete resource (Admin)"
                                  >
                                    <svg
                                      className="h-4 w-4"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                      />
                                    </svg>
                                    Delete
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </article>
                      ))}
                  </div>
                )}

              {/* Infinite Scroll Trigger */}
              {!loading &&
                !isSolarYouTubeReportsMode &&
                !isYouTubeChannelVideoMode &&
                !(isPaperListMode && paperLibraryTab === 'recent') &&
                resources.length > 0 &&
                hasMore && (
                  <div
                    ref={loadMoreTriggerRef}
                    className="mt-6 flex justify-center py-4"
                  >
                    {loadingMore && (
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <svg
                          className="h-4 w-4 animate-spin"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                        加载中...
                      </div>
                    )}
                  </div>
                )}

              {/* No More Results */}
              {!loading &&
                !isSolarYouTubeReportsMode &&
                !isYouTubeChannelVideoMode &&
                !(isPaperListMode && paperLibraryTab === 'recent') &&
                resources.length > 0 &&
                !hasMore && (
                  <div className="mt-6 text-center">
                    <p className="text-sm text-gray-400">— 已加载全部内容 —</p>
                  </div>
                )}

              {/* Empty State */}
              {!loading &&
                !isSolarYouTubeReportsMode &&
                !isYouTubeChannelVideoMode &&
                !(isPaperListMode && paperLibraryTab === 'recent') &&
                resources.length === 0 && (
                  <EmptyState
                    title="No content available"
                    description="Try running the data crawler first"
                  />
                )}
            </>
          )}

          {/* Detail View */}
          {viewMode === 'detail' && selectedResource && (
            <div className="flex min-h-0 flex-1 flex-col">
              {/* Modern Header - 参考 Notion/Linear 设计风格 */}
              <div className="flex-shrink-0 border-b border-gray-200 bg-white">
                {/* 顶部工具栏 */}
                <div className="flex h-12 items-center justify-between px-4">
                  {/* 左侧：返回按钮 + 面包屑 */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleBackToList}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                      title="返回列表"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 19l-7-7 7-7"
                        />
                      </svg>
                    </button>

                    {/* 面包屑导航 */}
                    <nav className="flex items-center text-sm">
                      <span className="text-gray-400">
                        {selectedResource.type === 'POLICY'
                          ? 'Policy'
                          : selectedResource.type === 'PAPER'
                            ? 'Papers'
                            : selectedResource.type}
                      </span>
                      <svg
                        className="mx-2 h-4 w-4 text-gray-300"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                      <span
                        className="max-w-[300px] truncate font-medium text-gray-700"
                        title={selectedResource.title}
                      >
                        {selectedResource.title.length > 40
                          ? selectedResource.title.substring(0, 40) + '...'
                          : selectedResource.title}
                      </span>
                    </nav>
                  </div>

                  {/* 右侧：视图切换 + 操作按钮 */}
                  <div className="flex items-center gap-2">
                    {/* View Mode Toggle - 简洁的 Segmented Control (仅在 HTML 模式显示) */}
                    {getResourceDisplayMode(selectedResource) === 'html' && (
                      <div className="flex h-8 items-center rounded-md border border-gray-200 bg-gray-50 p-0.5">
                        <button
                          onClick={() => setHtmlViewMode('reader')}
                          className={`flex h-7 items-center gap-1.5 rounded px-3 text-xs font-medium transition-all ${
                            htmlViewMode === 'reader'
                              ? 'bg-white text-gray-900 shadow-sm'
                              : 'text-gray-500 hover:text-gray-700'
                          }`}
                        >
                          <svg
                            className="h-3.5 w-3.5"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
                          </svg>
                          Reader
                        </button>
                        <button
                          onClick={() => setHtmlViewMode('original')}
                          className={`flex h-7 items-center gap-1.5 rounded px-3 text-xs font-medium transition-all ${
                            htmlViewMode === 'original'
                              ? 'bg-white text-gray-900 shadow-sm'
                              : 'text-gray-500 hover:text-gray-700'
                          }`}
                        >
                          <svg
                            className="h-3.5 w-3.5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
                            />
                          </svg>
                          Original
                        </button>
                      </div>
                    )}

                    {/* 展开/收起详情 */}
                    <button
                      onClick={() => setIsHeaderCollapsed(!isHeaderCollapsed)}
                      className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
                        isHeaderCollapsed
                          ? 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                          : 'bg-gray-100 text-gray-700'
                      }`}
                      title={isHeaderCollapsed ? '显示详情' : '隐藏详情'}
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      {isHeaderCollapsed ? 'Info' : 'Info'}
                    </button>
                  </div>
                </div>

                {/* Expanded Content - 精简的信息面板 */}
                {!isHeaderCollapsed && (
                  <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-3">
                    <div className="flex items-center justify-between gap-4">
                      {/* 左侧：元信息 */}
                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        {/* 日期 */}
                        <span className="flex items-center gap-1.5">
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={1.5}
                              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                            />
                          </svg>
                          <ClientDate
                            date={selectedResource.publishedAt}
                            format="date"
                            locale="en-US"
                            dateOptions={{
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            }}
                          />
                        </span>

                        {/* 分类标签 */}
                        {selectedResource.categories &&
                          selectedResource.categories.length > 0 && (
                            <div className="flex items-center gap-1.5">
                              {selectedResource.categories
                                .slice(0, 2)
                                .map((cat, i) => (
                                  <span
                                    key={i}
                                    className="rounded-full bg-gray-200/80 px-2 py-0.5 text-xs font-medium text-gray-600"
                                  >
                                    {cat}
                                  </span>
                                ))}
                            </div>
                          )}

                        {/* 作者 */}
                        {selectedResource.authors &&
                          selectedResource.authors.length > 0 && (
                            <span className="flex items-center gap-1.5">
                              <svg
                                className="h-4 w-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={1.5}
                                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                                />
                              </svg>
                              {selectedResource.authors
                                .slice(0, 2)
                                .map((a) => a.name || a.username || 'Unknown')
                                .join(', ')}
                            </span>
                          )}

                        {/* 统计 */}
                        {selectedResource.viewCount !== undefined && (
                          <span className="flex items-center gap-1">
                            <svg
                              className="h-4 w-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={1.5}
                                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                              />
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={1.5}
                                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                              />
                            </svg>
                            {selectedResource.viewCount}
                          </span>
                        )}
                      </div>

                      {/* 右侧：操作按钮 */}
                      <div className="flex items-center gap-2">
                        {/* 点赞 */}
                        {selectedResource.upvoteCount !== undefined && (
                          <button
                            onClick={(e) =>
                              toggleUpvote(selectedResource.id, e)
                            }
                            className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-sm transition-colors ${
                              hasUpvoted(selectedResource.id)
                                ? 'bg-blue-100 font-medium text-blue-600'
                                : 'bg-white text-gray-600 hover:bg-gray-100'
                            }`}
                          >
                            <ThumbsUp
                              className={`h-4 w-4 ${hasUpvoted(selectedResource.id) ? 'fill-current' : ''}`}
                            />
                            {selectedResource.upvoteCount}
                          </button>
                        )}

                        {/* 收藏 */}
                        <button
                          onClick={() => toggleBookmark(selectedResource.id)}
                          className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-sm transition-colors ${
                            isBookmarked(selectedResource.id)
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-white text-gray-600 hover:bg-gray-100'
                          }`}
                        >
                          <svg
                            className="h-4 w-4"
                            fill={
                              isBookmarked(selectedResource.id)
                                ? 'currentColor'
                                : 'none'
                            }
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
                            />
                          </svg>
                          Save
                        </button>

                        {/* 外部链接 */}
                        <a
                          href={selectedResource.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-sm text-gray-600 transition-colors hover:bg-gray-100"
                        >
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                            />
                          </svg>
                          Open
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Embedded Content - 移除Preview头部，直接显示内容以最大化阅读区域 */}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
                {/* Display preview - 使用客户端渲染避免浏览器阻止iframe */}
                {/* Content viewer — routed by getResourceDisplayMode */}
                {getResourceDisplayMode(selectedResource) === 'pdf' ? (
                  <TextSelectionToolbar
                    resourceId={selectedResource.id}
                    onAddToNotes={(text) => {
                      logger.debug('Added to notes from PDF:', text);
                    }}
                    onAskAI={(text) => {
                      // Switch to AI panel and set the question
                      setAiPanelState('expanded');
                      setAiInput(`Explain this: ${text}`);
                    }}
                    showClipboardFAB={true}
                    className="h-full w-full flex-1"
                  >
                    <PDFViewer
                      url={
                        selectedResource.pdfUrl || selectedResource.sourceUrl
                      }
                      title={selectedResource.title}
                      className="h-full w-full"
                    />
                  </TextSelectionToolbar>
                ) : getResourceDisplayMode(selectedResource) === 'youtube' ? (
                  // YouTube 视频播放器
                  (() => {
                    const videoId = extractYouTubeVideoId(
                      selectedResource.sourceUrl
                    );
                    return videoId ? (
                      <div className="flex h-full w-full flex-col bg-black">
                        <iframe
                          src={`https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1`}
                          title={selectedResource.title}
                          className="h-full w-full"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      </div>
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gray-900">
                        <div className="text-center text-white">
                          <svg
                            className="mx-auto h-16 w-16 text-red-500"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z" />
                          </svg>
                          <p className="mt-4 text-lg font-medium">
                            无法加载视频
                          </p>
                          <a
                            href={selectedResource.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 inline-block text-blue-400 hover:underline"
                          >
                            在 YouTube 上观看
                          </a>
                        </div>
                      </div>
                    );
                  })()
                ) : getResourceDisplayMode(selectedResource) === 'html' ? (
                  htmlViewMode === 'reader' ? (
                    <TextSelectionToolbar
                      resourceId={selectedResource.id}
                      onAddToNotes={(text) => {
                        logger.debug('Added to notes from Reader:', text);
                      }}
                      onAskAI={(text) => {
                        setAiPanelState('expanded');
                        setAiInput(`Explain this: ${text}`);
                      }}
                      className="h-full w-full flex-1"
                    >
                      <ReaderView
                        url={selectedResource.sourceUrl}
                        title={selectedResource.title}
                        category={selectedResource.type}
                        isImportedResource={true}
                        className="h-full w-full"
                        onArticleLoaded={handleArticleLoaded}
                      />
                    </TextSelectionToolbar>
                  ) : (
                    <TextSelectionToolbar
                      resourceId={selectedResource.id}
                      onAddToNotes={(text) => {
                        logger.debug('Added to notes from HTML:', text);
                      }}
                      onAskAI={(text) => {
                        setAiPanelState('expanded');
                        setAiInput(`Explain this: ${text}`);
                      }}
                      className="h-full w-full flex-1"
                    >
                      <HTMLViewer
                        url={selectedResource.sourceUrl}
                        title={selectedResource.title}
                        className="h-full w-full"
                      />
                    </TextSelectionToolbar>
                  )
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gray-50">
                    <div className="text-center">
                      <svg
                        className="mx-auto h-16 w-16 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                      <p className="mt-4 text-lg font-medium text-gray-600">
                        预览不可用
                      </p>
                      <p className="mt-2 text-sm text-gray-500">
                        该资源暂无可用的PDF或HTML预览
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Right AI Interaction Panel - Only show in detail view */}
      {aiPanelState !== 'collapsed' && viewMode === 'detail' && (
        <aside
          className="relative hidden flex-shrink-0 flex-col border-l border-gray-200 bg-white lg:flex"
          style={{ width: aiPanelWidth }}
        >
          {/* Resize Handle */}
          <div
            ref={resizeRef}
            onMouseDown={handleResizeStart}
            className={`absolute -left-1 top-0 z-20 h-full w-2 cursor-col-resize transition-colors ${
              isResizingPanel ? 'bg-red-400' : 'hover:bg-red-300/50'
            }`}
            title="拖拽调整面板宽度"
          />
          {/* Top Tab Navigation - Icon + Text Style */}
          <div className="border-b border-gray-100 bg-gray-50 px-2 py-2">
            <div className="flex items-center gap-1">
              {/* Toggle button at left of tab bar - three states: expanded → collapsed → pinned */}
              <button
                type="button"
                onClick={handleAiPanelToggle}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 hover:shadow-sm"
                aria-label={
                  aiPanelState === 'expanded'
                    ? '收起 AI 助手面板'
                    : '展开 AI 助手面板'
                }
              >
                <RightPanelToggleIcon state={aiPanelState} />
              </button>
              {/* Tab buttons */}
              <div className="grid flex-1 grid-cols-4 gap-1">
                <button
                  onClick={() => setAiRightTab('assistant')}
                  className={`group relative flex flex-col items-center justify-center gap-1 rounded-md px-2 py-2 text-xs font-medium transition-all duration-200 ${
                    aiRightTab === 'assistant'
                      ? 'bg-gradient-to-br from-red-500 to-red-600 text-white shadow-md shadow-red-500/20'
                      : 'bg-white text-gray-600 shadow-sm hover:bg-gray-50 hover:shadow'
                  }`}
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                    />
                  </svg>
                  <span className="leading-tight">Chat</span>
                </button>
                <button
                  onClick={() => setAiRightTab('notes')}
                  className={`group relative flex flex-col items-center justify-center gap-1 rounded-md px-2 py-2 text-xs font-medium transition-all duration-200 ${
                    aiRightTab === 'notes'
                      ? 'bg-gradient-to-br from-red-500 to-red-600 text-white shadow-md shadow-red-500/20'
                      : 'bg-white text-gray-600 shadow-sm hover:bg-gray-50 hover:shadow'
                  }`}
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    />
                  </svg>
                  <span className="leading-tight">Notes</span>
                </button>
                <button
                  onClick={() => setAiRightTab('comments')}
                  className={`group relative flex flex-col items-center justify-center gap-1 rounded-md px-2 py-2 text-xs font-medium transition-all duration-200 ${
                    aiRightTab === 'comments'
                      ? 'bg-gradient-to-br from-red-500 to-red-600 text-white shadow-md shadow-red-500/20'
                      : 'bg-white text-gray-600 shadow-sm hover:bg-gray-50 hover:shadow'
                  }`}
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                    />
                  </svg>
                  <span className="leading-tight">Comments</span>
                </button>
                <button
                  onClick={() => setAiRightTab('similar')}
                  className={`group relative flex flex-col items-center justify-center gap-1 rounded-md px-2 py-2 text-xs font-medium transition-all duration-200 ${
                    aiRightTab === 'similar'
                      ? 'bg-gradient-to-br from-red-500 to-red-600 text-white shadow-md shadow-red-500/20'
                      : 'bg-white text-gray-600 shadow-sm hover:bg-gray-50 hover:shadow'
                  }`}
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                    />
                  </svg>
                  <span className="leading-tight">Similar</span>
                </button>
              </div>
            </div>
          </div>
          {/* Main Content Area */}
          <div className="flex-1 overflow-y-auto p-4">
            {selectedResource ? (
              aiRightTab === 'assistant' ? (
                <div className="space-y-4">
                  {/* BYOK Required Banner — 严格 BYOK 模式下没配 key 调用必败 */}
                  {aiModels.length > 0 && !userHasBYOK(aiModels) && (
                    <BYOKRequiredBanner compact />
                  )}
                  {/* Model Selector */}
                  <div className="flex items-center justify-between rounded-lg bg-gradient-to-r from-gray-50 to-gray-100 p-3">
                    <div className="flex items-center gap-2">
                      <Cpu size={16} className="text-gray-500" aria-hidden />
                      <span className="text-xs font-medium text-gray-700">
                        AI Model
                      </span>
                    </div>
                    <div className="min-w-[200px]">
                      <ModelSelect
                        value={aiModel}
                        onChange={setAiModel}
                        models={aiModels}
                      />
                    </div>
                  </div>

                  {/* Quick Actions */}
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-700">
                      Quick Actions:
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => handleQuickAction('summary')}
                        disabled={aiLoading || isStreaming}
                        className="flex flex-col items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs transition-colors hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <svg
                          className="h-4 w-4 text-red-600"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                          />
                        </svg>
                        <span className="text-gray-700">Summary</span>
                      </button>
                      <button
                        onClick={() => handleQuickAction('insights')}
                        disabled={aiLoading || isStreaming}
                        className="flex flex-col items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs transition-colors hover:border-orange-300 hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <svg
                          className="h-4 w-4 text-orange-600"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                          />
                        </svg>
                        <span className="text-gray-700">Insights</span>
                      </button>
                      <button
                        onClick={() => handleQuickAction('methodology')}
                        disabled={aiLoading || isStreaming}
                        className="flex flex-col items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs transition-colors hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <svg
                          className="h-4 w-4 text-blue-600"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 008 10.586V5L7 4z"
                          />
                        </svg>
                        <span className="text-gray-700">Methods</span>
                      </button>
                    </div>
                  </div>

                  {/* AI Summary Section - Card Style */}
                  {aiSummary && (
                    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
                      <div className="flex items-center justify-between border-b border-gray-100 bg-gradient-to-r from-red-50 to-orange-50 px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-600 text-white shadow-sm">
                            <svg
                              className="h-4 w-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                              />
                            </svg>
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-gray-900">
                              AI Summary
                            </h3>
                            <p className="text-sm text-gray-500">
                              Select text for more options
                            </p>
                          </div>
                        </div>
                      </div>
                      <TextSelectionToolbar
                        resourceId={selectedResource?.id}
                        onAskAI={(text) => {
                          setAiInput(text);
                        }}
                      >
                        <div className="prose prose-sm max-w-none cursor-text select-text p-3 text-sm">
                          {(() => {
                            const { images, textContent } =
                              extractImagesFromMarkdown(aiSummary);
                            return (
                              <>
                                {/* Render extracted images first */}
                                {images.map((img, idx) => (
                                  <Base64Image
                                    key={idx}
                                    src={img.src}
                                    alt={img.alt}
                                  />
                                ))}
                                {/* Render text content with markdown */}
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {textContent}
                                </ReactMarkdown>
                              </>
                            );
                          })()}
                        </div>
                      </TextSelectionToolbar>
                    </div>
                  )}

                  {/* AI Loading Indicator - only for quick actions, not chat streaming */}
                  {aiLoading && !isStreaming && (
                    <div className="flex items-center justify-center gap-2 py-4">
                      <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-red-600"></div>
                      <span className="text-sm text-gray-600">
                        AI processing...
                      </span>
                    </div>
                  )}

                  {/* AI Insights Section - Card Style */}
                  {aiInsights.length > 0 && (
                    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
                      <div className="flex items-center justify-between border-b border-gray-100 bg-gradient-to-r from-orange-50 to-yellow-50 px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-600 text-white shadow-sm">
                            <svg
                              className="h-4 w-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                              />
                            </svg>
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-gray-900">
                              {aiInsights.length} Key Insights
                            </h3>
                            <p className="text-sm text-gray-500">
                              Select text for more options
                            </p>
                          </div>
                        </div>
                      </div>
                      <TextSelectionToolbar
                        resourceId={selectedResource?.id}
                        onAskAI={(text) => {
                          setAiInput(text);
                        }}
                      >
                        <div className="space-y-2 p-3">
                          {aiInsights.map((insight, i) => (
                            <div
                              key={i}
                              className={`group cursor-text select-text rounded-lg border-2 p-2.5 transition-all ${
                                insight.importance === 'high'
                                  ? 'border-red-200 bg-red-50 hover:border-red-300 hover:bg-red-100'
                                  : insight.importance === 'medium'
                                    ? 'border-orange-200 bg-orange-50 hover:border-orange-300 hover:bg-orange-100'
                                    : 'border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-gray-100'
                              }`}
                            >
                              <div className="flex items-start">
                                <div className="flex-1">
                                  <h4 className="text-sm font-semibold leading-snug text-gray-900">
                                    {insight.title}
                                  </h4>
                                  <p className="mt-1 text-sm leading-relaxed text-gray-600">
                                    {insight.description}
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </TextSelectionToolbar>
                    </div>
                  )}

                  {/* AI Methodology Section - Card Style */}
                  {aiMethodology.length > 0 && (
                    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
                      <div className="flex items-center justify-between border-b border-gray-100 bg-gradient-to-r from-blue-50 to-cyan-50 px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
                            <svg
                              className="h-4 w-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 008 10.586V5L7 4z"
                              />
                            </svg>
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-gray-900">
                              Research Methodology
                            </h3>
                            <p className="text-sm text-gray-500">
                              Select text for more options
                            </p>
                          </div>
                        </div>
                      </div>
                      <TextSelectionToolbar
                        resourceId={selectedResource?.id}
                        onAskAI={(text) => {
                          setAiInput(text);
                        }}
                      >
                        <div className="space-y-2 p-3">
                          {aiMethodology.map((method, i) => (
                            <div
                              key={i}
                              className={`group cursor-text select-text rounded-lg border-2 p-2.5 transition-all ${
                                method.importance === 'high'
                                  ? 'border-blue-200 bg-blue-50 hover:border-blue-300 hover:bg-blue-100'
                                  : method.importance === 'medium'
                                    ? 'border-cyan-200 bg-cyan-50 hover:border-cyan-300 hover:bg-cyan-100'
                                    : 'border-teal-200 bg-teal-50 hover:border-teal-300 hover:bg-teal-100'
                              }`}
                            >
                              <div className="flex items-start gap-2">
                                <FlaskConical className="h-4 w-4 flex-shrink-0 text-blue-600" />
                                <div className="flex-1">
                                  <h4 className="text-sm font-semibold leading-snug text-gray-900">
                                    {method.title}
                                  </h4>
                                  <p className="mt-1 text-sm leading-relaxed text-gray-600">
                                    {method.description}
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </TextSelectionToolbar>
                    </div>
                  )}

                  {/* Chat Messages */}
                  {aiMessages.length > 0 && (
                    <TextSelectionToolbar
                      resourceId={selectedResource?.id}
                      onAskAI={(text) => {
                        setAiPanelState('expanded');
                        setAiInput(text);
                      }}
                    >
                      <div className="space-y-3 border-t border-gray-200 pt-4">
                        {aiMessages.map((msg, i) => (
                          <div
                            key={i}
                            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`group relative rounded-lg px-3 py-2 ${
                                msg.role === 'user'
                                  ? 'max-w-[80%] bg-gradient-to-br from-red-500 to-red-600 text-white'
                                  : 'w-full cursor-text select-text bg-gray-100 text-gray-800'
                              }`}
                            >
                              {/* Copy button — AI messages only */}
                              {msg.role === 'assistant' && (
                                <button
                                  onClick={() => {
                                    navigator.clipboard
                                      .writeText(msg.content)
                                      .then(() =>
                                        setToast({
                                          message: '已复制',
                                          type: 'success',
                                        })
                                      )
                                      .catch(() => {});
                                  }}
                                  className="absolute right-2 top-2 rounded p-1 text-gray-400 opacity-0 transition-opacity hover:bg-gray-200 hover:text-gray-700 group-hover:opacity-100"
                                  title="复制"
                                >
                                  <svg
                                    className="h-3.5 w-3.5"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                    />
                                  </svg>
                                </button>
                              )}
                              <div className="prose prose-sm !max-w-none text-sm leading-relaxed [&>*]:my-1 [&>ol]:my-1 [&>ol]:list-decimal [&>ol]:pl-5 [&>p]:my-1 [&>ul]:my-1 [&>ul]:list-disc [&>ul]:pl-5 [&_li]:my-0.5">
                                {(() => {
                                  const { images, textContent } =
                                    extractImagesFromMarkdown(msg.content);
                                  return (
                                    <>
                                      {images.map((img, idx) => (
                                        <Base64Image
                                          key={idx}
                                          src={img.src}
                                          alt={img.alt}
                                        />
                                      ))}
                                      <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                      >
                                        {textContent}
                                      </ReactMarkdown>
                                    </>
                                  );
                                })()}
                              </div>
                              <div
                                className={`mt-1 text-[10px] ${
                                  msg.role === 'user'
                                    ? 'text-red-100'
                                    : 'text-gray-500'
                                }`}
                              >
                                <ClientDate
                                  date={msg.timestamp}
                                  format="time"
                                />
                              </div>
                            </div>
                          </div>
                        ))}

                        {/* Inline Loading Message */}
                        {isStreaming && (
                          <div className="flex justify-start">
                            <div className="w-full rounded-lg bg-gray-100 px-3 py-2 text-gray-900">
                              <div className="flex items-center gap-2">
                                <div className="h-3 w-3 animate-spin rounded-full border-b-2 border-red-600"></div>
                                <p className="text-sm">
                                  {aiModels.find((m) => m.modelId === aiModel)
                                    ?.name || aiModel}
                                  正在思考...
                                </p>
                              </div>
                            </div>
                          </div>
                        )}

                        <div ref={chatEndRef} />
                      </div>
                    </TextSelectionToolbar>
                  )}

                  {/* Tips when no messages */}
                  {aiMessages.length === 0 && !aiLoading && (
                    <div className="border-t border-gray-200 pt-4">
                      <p className="mb-3 text-xs text-gray-500">
                        💡 你可以问：
                      </p>
                      <div className="space-y-2">
                        <button
                          onClick={() => {
                            setAiInput('这篇文章的主要贡献是什么？');
                          }}
                          className="w-full rounded-lg bg-gray-50 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-100"
                        >
                          这篇文章的主要贡献是什么？
                        </button>
                        <button
                          onClick={() => {
                            setAiInput('有哪些实际应用场景？');
                          }}
                          className="w-full rounded-lg bg-gray-50 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-100"
                        >
                          有哪些实际应用场景？
                        </button>
                        <button
                          onClick={() => {
                            setAiInput('有什么局限性？');
                          }}
                          className="w-full rounded-lg bg-gray-50 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-100"
                        >
                          有什么局限性？
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : aiRightTab === 'notes' ? (
                <div className="p-4">
                  <NotesList
                    resourceId={selectedResource.id}
                    refreshKey={notesRefreshKey}
                    showActions={true}
                    onDeleteNote={(noteId) => {
                      // Refresh notes list after deletion
                      setNotesRefreshKey(Date.now());
                    }}
                  />
                </div>
              ) : aiRightTab === 'comments' ? (
                <div className="p-4">
                  <CommentsList resourceId={selectedResource.id} />
                </div>
              ) : aiRightTab === 'similar' ? (
                <div className="p-4">
                  <SimilarResourcesList
                    resourceId={selectedResource.id}
                    onResourceClick={(resource) => {
                      // Navigate to the similar resource
                      const newResource = resources.find(
                        (r) => r.id === resource.id
                      );
                      const targetResource = newResource || resource;

                      // For YouTube videos, navigate to YouTube page
                      if (
                        targetResource.type === 'YOUTUBE' ||
                        targetResource.type === 'YOUTUBE_VIDEO' ||
                        targetResource.videoId
                      ) {
                        const videoId = extractYouTubeVideoId(
                          targetResource.sourceUrl
                        );
                        if (videoId) {
                          router.push(`/explore/youtube?videoId=${videoId}`);
                          return;
                        }
                      }

                      if (newResource) {
                        setSelectedResource(newResource);
                        setViewMode('detail');
                      } else {
                        // If not in current list, fetch the resource and display it
                        fetch(
                          `${config.apiBaseUrl}/api/v1/resources/${resource.id}`
                        )
                          .then((res) => res.json())
                          .then((result) => {
                            // Handle wrapped API response { success: true, data: {...} }
                            const resourceData = result?.data ?? result;
                            if (resourceData) {
                              setSelectedResource(resourceData as Resource);
                              setViewMode('detail');
                            }
                          })
                          .catch((err) => {
                            logger.error(
                              'Failed to fetch similar resource:',
                              err
                            );
                          });
                      }
                    }}
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-lg border border-gray-200 bg-gradient-to-br from-purple-50 to-pink-50 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <svg
                        className="h-5 w-5 text-purple-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                      <h3 className="text-sm font-semibold text-gray-900">
                        文生图 / 图生图
                      </h3>
                    </div>
                    <p className="text-xs text-gray-600">
                      基于当前资源内容，生成相关的可视化图像，或从图片生成图片
                    </p>
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-xs font-medium text-gray-700">
                      快捷生成选项:
                    </h4>
                    <div className="grid grid-cols-2 gap-2">
                      <button className="flex flex-col items-center gap-2 rounded-lg border border-purple-200 bg-white p-3 text-xs transition-colors hover:border-purple-300 hover:bg-purple-50">
                        <svg
                          className="h-6 w-6 text-purple-600"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                          />
                        </svg>
                        <span className="text-gray-700">数据图表</span>
                      </button>
                      <button className="flex flex-col items-center gap-2 rounded-lg border border-purple-200 bg-white p-3 text-xs transition-colors hover:border-purple-300 hover:bg-purple-50">
                        <svg
                          className="h-6 w-6 text-purple-600"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
                          />
                        </svg>
                        <span className="text-gray-700">概念图</span>
                      </button>
                      <button className="flex flex-col items-center gap-2 rounded-lg border border-purple-200 bg-white p-3 text-xs transition-colors hover:border-purple-300 hover:bg-purple-50">
                        <svg
                          className="h-6 w-6 text-purple-600"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
                          />
                        </svg>
                        <span className="text-gray-700">架构图</span>
                      </button>
                      <button className="flex flex-col items-center gap-2 rounded-lg border border-purple-200 bg-white p-3 text-xs transition-colors hover:border-purple-300 hover:bg-purple-50">
                        <svg
                          className="h-6 w-6 text-purple-600"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                          />
                        </svg>
                        <span className="text-gray-700">场景图</span>
                      </button>
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <p className="mb-3 text-xs font-medium text-gray-700">
                      自定义提示词:
                    </p>
                    <textarea
                      placeholder="描述你想要生成的图像..."
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                      rows={3}
                    />
                    <button className="mt-2 w-full rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-4 py-2 text-sm font-medium text-white transition-all hover:from-purple-700 hover:to-pink-700">
                      生成图像
                    </button>
                  </div>

                  <Alert tone="warn">
                    功能开发中，即将支持DALL-E、Stable Diffusion等模型
                  </Alert>
                </div>
              )
            ) : (
              <div className="flex h-full items-center justify-center px-4 text-center">
                <div>
                  <div className="mb-6 flex justify-center">
                    <svg
                      className="h-16 w-16 text-gray-300"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                      />
                    </svg>
                  </div>
                  <p className="mb-2 text-sm text-gray-500">
                    No content selected
                  </p>
                  <p className="text-xs text-gray-400">
                    Click on any paper, project, or news item to analyze it with
                    AI
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Input Area */}
          <div className="border-t border-gray-200 p-4">
            {/* Attachments Display */}
            {attachments.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {attachments.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm"
                  >
                    <svg
                      className="h-4 w-4 flex-shrink-0 text-gray-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    <span className="max-w-[150px] truncate text-gray-700">
                      {file.name}
                    </span>
                    <button
                      onClick={() => removeAttachment(index)}
                      className="flex-shrink-0 text-gray-400 hover:text-red-500"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Hidden File Input */}
            <input
              ref={attachmentFileInputRef}
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png"
              onChange={handleAttachmentFileChange}
              className="hidden"
            />

            <div className="relative">
              <textarea
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendAIMessage();
                  }
                }}
                disabled={!selectedResource || aiLoading}
                placeholder={
                  selectedResource
                    ? 'Ask anything about this content...'
                    : 'Select a resource first...'
                }
                rows={3}
                className="w-full resize-none rounded-lg border border-gray-300 bg-gray-50 px-4 py-3 pr-24 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
              />
              <div className="absolute bottom-3 right-3 flex items-center gap-2">
                <button
                  onClick={handleAttachmentClick}
                  className="p-1.5 text-gray-400 transition-colors hover:text-gray-600"
                  disabled={!selectedResource}
                  title="Upload attachment"
                >
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                    />
                  </svg>
                </button>
                <button
                  onClick={saveConversationToNotes}
                  className="p-1.5 text-gray-400 transition-colors hover:text-gray-600"
                  disabled={!selectedResource || aiMessages.length === 0}
                  title="Save conversation to notes"
                >
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
                    />
                  </svg>
                </button>
                <button
                  onClick={sendAIMessage}
                  disabled={!selectedResource || !aiInput.trim() || aiLoading}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {aiLoading ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white"></div>
                  ) : (
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 10l7-7m0 0l7 7m-7-7v18"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* Collapsed AI Panel - elegant vertical tab */}
      {aiPanelState === 'collapsed' && viewMode === 'detail' && (
        <div className="group relative hidden flex-shrink-0 lg:flex">
          <button
            type="button"
            onClick={() => setAiPanelState('expanded')}
            className="flex h-full w-12 flex-col items-center border-l border-gray-200 bg-gradient-to-b from-gray-50 to-white pt-3 text-gray-500 transition-all duration-200 hover:w-14 hover:border-gray-300 hover:from-gray-100 hover:text-gray-700 hover:shadow-lg"
            aria-label="展开 AI 助手面板"
          >
            {/* Toggle icon */}
            <div className="mb-3 rounded-lg bg-white p-1.5 shadow-sm ring-1 ring-gray-200 transition-all group-hover:bg-gray-50 group-hover:ring-gray-300">
              <RightPanelToggleIcon state="collapsed" />
            </div>
            {/* Vertical text */}
            <span className="text-xs font-semibold tracking-widest [writing-mode:vertical-rl]">
              AI Chat
            </span>
            {/* Subtle indicator dots */}
            <div className="mb-4 mt-auto flex flex-col gap-1.5">
              <div className="h-1.5 w-1.5 rounded-full bg-gray-400 transition-colors group-hover:bg-gray-500" />
              <div className="h-1.5 w-1.5 rounded-full bg-gray-300 transition-colors group-hover:bg-gray-400" />
              <div className="h-1.5 w-1.5 rounded-full bg-gray-200 transition-colors group-hover:bg-gray-300" />
            </div>
          </button>
        </div>
      )}

      {/* Import URL Dialog */}
      <ImportUrlDialog
        isOpen={showImportUrlDialog}
        onClose={() => setShowImportUrlDialog(false)}
        activeTab={activeTab}
        onImportSuccess={() => {
          fetchResources();
        }}
        apiBaseUrl={config.apiBaseUrl}
      />

      {/* Import File Dialog */}
      <ImportFileDialog
        isOpen={showImportFileDialog}
        onClose={() => setShowImportFileDialog(false)}
        activeTab={activeTab}
        onImportSuccess={() => {
          fetchResources();
        }}
        apiBaseUrl={config.apiBaseUrl}
      />

      {/* Context Menu for Adding to Notes */}
      {contextMenu && (
        <div
          className="context-menu fixed z-50 rounded-lg border-2 border-blue-500 bg-white py-2 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              logger.debug('Button clicked!');
              saveToNotes();
            }}
            disabled={savingNote}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm font-medium hover:bg-blue-100 disabled:opacity-50"
          >
            <svg
              className="h-4 w-4 text-blue-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            {savingNote ? 'Saving...' : 'Add to Notes'}
          </button>
        </div>
      )}

      {/* Filter Panel */}
      <FilterPanel
        isOpen={showFilterPanel}
        onClose={() => setShowFilterPanel(false)}
        activeTab={activeTab}
        selectedCategories={selectedCategories}
        setSelectedCategories={setSelectedCategories}
        dateRange={dateRange}
        setDateRange={setDateRange}
        minQualityScore={minQualityScore}
        setMinQualityScore={setMinQualityScore}
        selectedSources={selectedSources}
        setSelectedSources={setSelectedSources}
        onApply={handleApplyFilters}
        onReset={handleResetFilters}
      />
    </>
  );
}

export default HomeContent;
