'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { config } from '@/lib/utils/config';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/utils/auth';
import AppShell from '@/components/layout/AppShell';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { LoadingState } from '@/components/ui/states/LoadingState';
import PDFThumbnail from '@/components/ui/viewers/PDFThumbnail';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatDateSafe } from '@/lib/utils/date';
import ClientDate from '@/components/common/ClientDate';

// 懒加载条件渲染的重型组件
const PDFViewer = dynamic(() => import('@/components/ui/viewers/PDFViewer'), {
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
    </div>
  ),
  ssr: false,
});

const HTMLViewer = dynamic(() => import('@/components/ui/viewers/HTMLViewer'), {
  ssr: false,
});

const ReaderView = dynamic(() => import('@/components/ui/viewers/ReaderView'), {
  ssr: false,
});

const NotesList = dynamic(
  () => import('@/components/common/resource-lists/NotesList'),
  {
    ssr: false,
  }
);

const CommentsList = dynamic(
  () => import('@/components/common/comments/CommentsList'),
  { ssr: false }
);

const SimilarResourcesList = dynamic(
  () => import('@/components/common/resource-lists/SimilarResourcesList'),
  { ssr: false }
);

const ReportWorkspace = dynamic(
  () =>
    import('@/components/common/report-workspace').then((mod) => ({
      default: mod.ReportWorkspace,
    })),
  { ssr: false }
);

// Extract base64 images from markdown content
function extractImagesFromMarkdown(content: string): {
  images: Array<{ alt: string; src: string }>;
  textContent: string;
} {
  const imageRegex =
    /!\[([^\]]*)\]\s*\(\s*(data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+)\s*\)/g;
  const images: Array<{ alt: string; src: string }> = [];
  let textContent = content;

  let match;
  while ((match = imageRegex.exec(content)) !== null) {
    images.push({
      alt: match[1] || 'Generated Image',
      src: match[2],
    });
  }

  textContent = content.replace(imageRegex, '').trim();

  // Also try standalone base64 data
  if (images.length === 0 && content.includes('data:image/')) {
    const standaloneBase64Regex =
      /(data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+)/g;
    let standaloneMatch;
    while ((standaloneMatch = standaloneBase64Regex.exec(content)) !== null) {
      images.push({
        alt: 'Generated Image',
        src: standaloneMatch[1],
      });
    }
    textContent = content
      .replace(standaloneBase64Regex, '')
      .replace(/!\[[^\]]*\]\s*\(\s*\)/g, '')
      .replace(/!\[[^\]]*\]/g, '')
      .trim();
  }

  return { images, textContent };
}

// Base64 Image Component
function Base64Image({ src, alt }: { src: string; alt: string }) {
  const [imgError, setImgError] = useState<string | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  if (imgError) {
    return (
      <div className="my-3 rounded-lg border border-red-200 bg-red-50 p-4 text-center">
        <span className="block text-red-600">Image failed to load</span>
        <span className="mt-1 block text-xs text-gray-500">{imgError}</span>
        <a
          href={src}
          download={`generated-image-${Date.now()}.png`}
          className="mt-2 inline-block text-sm text-blue-600 hover:underline"
        >
          Download Image
        </a>
      </div>
    );
  }

  return (
    <div className="my-3">
      {!imgLoaded && (
        <div className="flex h-48 items-center justify-center rounded-lg bg-gray-100">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
        </div>
      )}
      <img
        src={src}
        alt={alt}
        className={`max-w-full rounded-lg shadow-md ${imgLoaded ? 'block' : 'hidden'}`}
        onLoad={() => setImgLoaded(true)}
        onError={() => {
          const sizeKB = Math.round(src.length / 1024);
          setImgError(`Failed to decode (${sizeKB} KB)`);
        }}
      />
      {imgLoaded && (
        <a
          href={src}
          download={`generated-image-${Date.now()}.png`}
          className="mt-2 inline-block text-sm text-blue-600 hover:underline"
        >
          Download Image
        </a>
      )}
    </div>
  );
}
import { useReportWorkspace } from '@/hooks';

// 懒加载对话框组件
const FilterPanel = dynamic(
  () => import('@/components/common/selectors/FilterPanel'),
  {
    ssr: false,
  }
);

const ImportUrlDialog = dynamic(
  () =>
    import('@/components/common/dialogs/ImportUrlDialog').then(
      (mod) => mod.ImportUrlDialog
    ),
  { ssr: false }
);

const ImportFileDialog = dynamic(
  () =>
    import('@/components/common/dialogs/ImportFileDialog').then(
      (mod) => mod.ImportFileDialog
    ),
  { ssr: false }
);
import ResponsiveNav, {
  type TabType,
  type SortByType,
} from '@/components/layout/ResponsiveNav';
import {
  AIContextBuilder,
  type Resource as AIResource,
} from '@/lib/features/ai-office/context-builder';
import { useResourceStore } from '@/stores/aiOfficeStore';
import type { Resource as AIOfficeResource } from '@/lib/types/ai-office';
import {
  ThumbsUp,
  TrendingUp,
  Clock,
  Star,
  ChevronDown,
  Cpu,
} from 'lucide-react';
import { useAIModels, pickPreferredModel, userHasBYOK } from '@/hooks';
import { ModelSelect } from '@/components/common/model-config/ModelSelect';
import { BYOKRequiredBanner } from '@/components/common/byok/BYOKRequiredBanner';
import { useImageSourceStore, toast as showToast, confirm } from '@/stores';

import { logger } from '@/lib/utils/logger';
interface Resource {
  id: string;
  type: string;
  title: string;
  abstract?: string;
  aiSummary?: string;
  keyInsights?: AIInsight[];
  methodology?: string;
  publishedAt: string;
  sourceUrl: string;
  pdfUrl?: string;
  thumbnailUrl?: string;
  authors?: Array<{ username?: string; platform?: string; name?: string }>;
  categories?: string[];
  qualityScore?: string;
  upvoteCount?: number;
  viewCount?: number;
  commentCount?: number;
  // Source information for display
  metadata?: {
    feedTitle?: string;
    channelName?: string;
    sourceName?: string;
    [key: string]: unknown;
  };
  sourceType?: string;
  // GitHub/原始数据增强
  rawData?: {
    readme?: string;
    description?: string;
    stars?: number;
    forks?: number;
    language?: string;
    languages?: Record<string, number>;
    contributors?: Array<unknown>;
    [key: string]: unknown;
  };
}

type PaperLibraryTab = 'recent' | 'insights' | 'hot';
const VALID_TABS: TabType[] = [
  'youtube',
  'papers',
  'blogs',
  'reports',
  'policy',
  'news',
];

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

interface SearchSuggestion {
  id: string;
  title: string;
  type: string;
  abstract: string;
  highlight: string;
}

interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface AIInsight {
  title: string;
  description: string;
  importance: 'high' | 'medium' | 'low';
}

// Helper function to parse markdown format to insights array
function parseMarkdownToInsights(markdown: string): AIInsight[] {
  const insights: AIInsight[] = [];

  // Split by #### headings (numbered items)
  const sections = markdown.split(/####\s+\d+\.\s+/);

  for (let i = 1; i < sections.length; i++) {
    const section = sections[i].trim();
    if (!section) continue;

    // Extract title (first line before newline or **)
    const titleMatch = section.match(/^([^\n*]+)/);
    const title = titleMatch ? titleMatch[1].trim() : '未命名';

    // Extract importance if present
    let importance: 'high' | 'medium' | 'low' = 'medium';
    if (
      section.includes('重要性：高') ||
      section.includes('importance: high') ||
      section.includes('**重要性：高**')
    ) {
      importance = 'high';
    } else if (
      section.includes('重要性：低') ||
      section.includes('importance: low') ||
      section.includes('**重要性：低**')
    ) {
      importance = 'low';
    }

    // Extract description (text after the importance line or after first newline)
    let description = section;
    // Remove title from description
    description = description.replace(/^([^\n*]+)/, '');
    // Remove importance markers
    description = description.replace(/\*\*重要性：[^*]+\*\*/g, '').trim();
    description = description.replace(/重要性：[^\n]+/g, '').trim();
    // Take first few lines as description
    const lines = description.split('\n').filter((line) => line.trim());
    description = lines.slice(0, 3).join(' ').substring(0, 200);

    if (title && description) {
      insights.push({ title, description, importance });
    }
  }

  return insights.length > 0 ? insights : [];
}

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const addSource = useImageSourceStore((state) => state.addSource);
  const imageSources = useImageSourceStore((state) => state.sources);
  const { user, isAdmin, accessToken } = useAuth();
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);

  // Initialize activeTab from URL query parameter if present
  const initialTab = (searchParams?.get('tab') || 'youtube') as TabType;
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [paperLibraryTab, setPaperLibraryTab] =
    useState<PaperLibraryTab>('recent');
  const [selectedResource, setSelectedResource] = useState<Resource | null>(
    null
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');
  const [htmlViewMode, setHtmlViewMode] = useState<'reader' | 'original'>(
    'reader'
  );

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
  const [isAiPanelCollapsed, setIsAiPanelCollapsed] = useState(false);
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(true);

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

  // Helper function to extract source name from resource
  const getSourceName = (resource: Resource): string | null => {
    // Try metadata fields first
    if (resource.metadata?.feedTitle) {
      return resource.metadata.feedTitle;
    }
    if (resource.metadata?.channelName) {
      return resource.metadata.channelName;
    }
    if (resource.metadata?.sourceName) {
      return resource.metadata.sourceName;
    }
    // Try authors (RSS feeds store channel name in author)
    if (resource.authors && resource.authors.length > 0) {
      const author = resource.authors[0];
      if (author.name) return author.name;
      if (author.username) return author.username;
    }
    // Try to extract from sourceUrl domain
    if (resource.sourceUrl) {
      try {
        const url = new URL(resource.sourceUrl);
        const hostname = url.hostname.replace('www.', '');
        // Known source domain mappings
        const domainMap: Record<string, string> = {
          'youtube.com': 'YouTube',
          'arxiv.org': 'arXiv',
          'github.com': 'GitHub',
          'medium.com': 'Medium',
          'news.ycombinator.com': 'Hacker News',
          'substack.com': 'Substack',
        };
        if (domainMap[hostname]) {
          return domainMap[hostname];
        }
        // Return cleaned domain name
        return hostname.split('.')[0];
      } catch {
        return null;
      }
    }
    return null;
  };

  // Get source badge color based on source type or name
  const getSourceBadgeColor = (
    sourceName: string,
    resourceType: string
  ): string => {
    const name = sourceName.toLowerCase();
    if (
      name.includes('youtube') ||
      resourceType === 'YOUTUBE_VIDEO' ||
      resourceType === 'YOUTUBE'
    ) {
      return 'bg-red-100 text-red-700';
    }
    if (name.includes('arxiv') || resourceType === 'PAPER') {
      return 'bg-orange-100 text-orange-700';
    }
    if (name.includes('github') || resourceType === 'PROJECT') {
      return 'bg-gray-100 text-gray-700';
    }
    if (name.includes('hacker') || resourceType === 'NEWS') {
      return 'bg-amber-100 text-amber-700';
    }
    if (resourceType === 'POLICY') {
      return 'bg-blue-100 text-blue-700';
    }
    if (resourceType === 'REPORT') {
      return 'bg-purple-100 text-purple-700';
    }
    if (resourceType === 'BLOG') {
      return 'bg-green-100 text-green-700';
    }
    return 'bg-gray-100 text-gray-600';
  };

  const { models: allAiModels } = useAIModels();
  // 显示 CHAT、CHAT_FAST 和 MULTIMODAL 类型的模型（都支持文本聊天）
  // CHAT_FAST 包括 Gemini Flash, GPT-4o-mini, Claude Haiku 等快速模型
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

  // PDF text extraction state
  const [pdfText, setPdfText] = useState<string>('');

  // Article content from ReaderView for AI analysis
  const [articleTextContent, setArticleTextContent] = useState<string>('');

  // Attachment upload states for AI chat
  const [attachments, setAttachments] = useState<File[]>([]);
  const attachmentFileInputRef = useRef<HTMLInputElement>(null);

  // Search and filter states
  const [sortBy, setSortBy] = useState<
    'publishedAt' | 'qualityScore' | 'trendingScore'
  >('trendingScore');
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

  // File type restrictions per tab
  const FILE_RESTRICTIONS: Record<
    string,
    { accept: string; maxSize: number; label: string }
  > = {
    papers: {
      accept: '.pdf,application/pdf',
      maxSize: 50 * 1024 * 1024,
      label: 'PDF文件',
    },
    blogs: {
      accept: 'image/*',
      maxSize: 10 * 1024 * 1024,
      label: '图片',
    },
    reports: {
      accept:
        '.pdf,.doc,.docx,.xlsx,.pptx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation',
      maxSize: 100 * 1024 * 1024,
      label: '报告文件 (PDF/Word/Excel/PPT)',
    },
    youtube: {
      accept: '.srt,.vtt,text/plain',
      maxSize: 5 * 1024 * 1024,
      label: '字幕文件',
    },
    news: { accept: 'image/*', maxSize: 10 * 1024 * 1024, label: '图片' },
    policy: {
      accept:
        '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      maxSize: 50 * 1024 * 1024,
      label: '政策文件 (PDF/Word)',
    },
  };

  // Search suggestions states
  const [searchSuggestions, setSearchSuggestions] = useState<
    SearchSuggestion[]
  >([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [searchMode, setSearchMode] = useState<'agent' | 'search'>('search');

  // Bookmark states
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());
  const [defaultCollectionId, setDefaultCollectionId] = useState<string | null>(
    null
  );

  // Upvote states
  const [upvotes, setUpvotes] = useState<Set<string>>(new Set());

  // Report workspace (legacy - for /workspace page)
  const { addResource, hasResource, canAddMore } = useReportWorkspace();

  // AI Office resource store - defer initialization to avoid hydration mismatch
  const [isHydrated, setIsHydrated] = useState(false);
  const aiOfficeStore = useResourceStore();

  useEffect(() => {
    // Mark as hydrated to prevent hydration mismatches
    setIsHydrated(true);
  }, []);

  // Helper function to convert page Resource to AI Office Resource
  const convertToAIOfficeResource = (resource: Resource): AIOfficeResource => {
    const baseResource = {
      _id: resource.id,
      userId: 'current-user', // TODO: Get from auth
      resourceId: resource.id,
      status: 'collected' as const,
      collectedAt: new Date(),
      updatedAt: new Date(),
    };

    // Determine resource type and create appropriate structure
    if (resource.type === 'youtube') {
      return {
        ...baseResource,
        resourceType: 'youtube_video',
        url: resource.sourceUrl,
        metadata: {
          title: resource.title,
          description: resource.abstract || '',
          channel: resource.metadata?.channelName || '',
          duration: 0,
          publishedAt: new Date(resource.publishedAt),
          statistics: { views: 0, likes: 0, comments: 0 },
          thumbnails: {
            default: resource.thumbnailUrl || '',
            medium: resource.thumbnailUrl || '',
            high: resource.thumbnailUrl || '',
          },
          tags: [],
          category: '',
        },
        content: {
          transcript: '',
          chapters: [],
        },
        aiAnalysis: {
          summary: resource.aiSummary || resource.abstract || '',
          keyPoints: [],
          topics: [],
          sentiment: 'neutral',
        },
      } as unknown as AIOfficeResource;
    } else if (resource.type === 'paper') {
      return {
        ...baseResource,
        resourceType: 'academic_paper',
        metadata: {
          title: resource.title,
          authors:
            resource.authors?.map((a) => ({
              name: a.name || a.username || '',
              affiliation: '',
              email: '',
            })) || [],
          abstract: resource.abstract || '',
          keywords: [],
          publishedAt: new Date(resource.publishedAt),
          venue: '',
          citations: 0,
          pdfUrl: resource.pdfUrl,
        },
        content: {
          fullText: '',
          sections: [],
          figures: [],
          tables: [],
          equations: [],
          references: [],
        },
        aiAnalysis: {
          summary: resource.aiSummary || resource.abstract || '',
          contributions: [],
          methodology: '',
          results: '',
          limitations: [],
          futureWork: [],
          impact: 'medium',
          field: '',
          subfields: [],
        },
      } as unknown as AIOfficeResource;
    } else {
      return {
        ...baseResource,
        resourceType: 'web_page',
        url: resource.sourceUrl,
        metadata: {
          title: resource.title,
          description: resource.abstract || '',
          language: 'en',
        },
        content: {
          cleanedText: resource.abstract || '',
          images: [],
          links: [],
        },
        aiAnalysis: {
          summary: resource.aiSummary || resource.abstract || '',
          mainTopics: [],
          keyInsights: [],
          credibility: 0.5,
        },
      } as unknown as AIOfficeResource;
    }
  };

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

  // Load bookmarks function
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
        // Handle wrapped response { success: true, data: [...] }
        const collections = Array.isArray(result?.data)
          ? result.data
          : Array.isArray(result)
            ? result
            : [];

        // Find or create default collection
        let defaultCollection = collections.find(
          (c: {
            name: string;
            id: string;
            items?: Array<{ resourceId: string }>;
          }) => c.name === '我的收藏'
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
            // Handle wrapped response { success: true, data: {...} }
            defaultCollection = createResult?.data ?? createResult;
          }
        }

        if (defaultCollection) {
          setDefaultCollectionId(defaultCollection.id);

          // Load bookmarked resource IDs
          const bookmarkedIds = new Set<string>(
            (defaultCollection.items || []).map(
              (item: { resourceId: string }) => item.resourceId
            )
          );
          setBookmarks(bookmarkedIds);
        }
      }
    } catch (err) {
      logger.error('Failed to load bookmarks:', err);
    }
  }, [user]);

  // Load bookmarks from backend API on mount
  useEffect(() => {
    loadBookmarks();
  }, [loadBookmarks]);

  useEffect(() => {
    fetchResources();
  }, [
    activeTab,
    searchQuery,
    sortBy,
    sortOrder,
    filterCategory,
    paperLibraryTab,
  ]);

  // Handle opening resource from URL parameter (from library page)
  useEffect(() => {
    const resourceId = searchParams?.get('id');
    if (!resourceId) return;

    // Helper function to handle the resource
    const handleResource = (resource: Resource) => {
      // For YouTube videos, redirect to the YouTube page
      if (
        resource.type === 'YOUTUBE' ||
        resource.type === 'YOUTUBE_VIDEO' ||
        (resource as { videoId?: string }).videoId
      ) {
        let videoId = (resource as { videoId?: string }).videoId;

        // If no videoId, extract from sourceUrl (handle multiple YouTube URL formats)
        if (!videoId && resource.sourceUrl) {
          // Try youtube.com/watch?v=xxx format
          let urlMatch = resource.sourceUrl.match(/[?&]v=([^&]+)/);
          if (urlMatch) {
            videoId = urlMatch[1];
          } else {
            // Try youtu.be/xxx format
            urlMatch = resource.sourceUrl.match(/youtu\.be\/([^?&]+)/);
            if (urlMatch) {
              videoId = urlMatch[1];
            } else {
              // Try youtube.com/embed/xxx format
              urlMatch = resource.sourceUrl.match(
                /youtube\.com\/embed\/([^?&]+)/
              );
              if (urlMatch) {
                videoId = urlMatch[1];
              }
            }
          }
        }

        if (videoId) {
          router.push(`/explore/youtube?videoId=${videoId}`);
          return;
        }
      }

      // For non-YouTube resources, show in detail view
      setSelectedResource(resource);
      setViewMode('detail');
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
  }, [searchParams, resources, router]);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [aiMessages]);

  // Extract PDF text when resource changes
  useEffect(() => {
    const extractPdfText = async () => {
      if (!selectedResource || !selectedResource.pdfUrl) {
        setPdfText('');
        return;
      }

      try {
        // Dynamically import PDF.js only on client side
        const pdfjsLib = await import('pdfjs-dist');

        // Configure worker - use unpkg which has latest versions
        pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

        const pdfUrl = `${config.apiUrl}/proxy/pdf?url=${encodeURIComponent(selectedResource.pdfUrl)}`;

        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;

        let fullText = '';
        const maxPages = Math.min(pdf.numPages, 20); // Limit to first 20 pages

        for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item: { str?: string } | object) =>
              'str' in item && typeof item.str === 'string' ? item.str : ''
            )
            .join(' ');
          fullText += pageText + '\n';

          // Break if we have enough text (>15000 chars is enough for AI context)
          if (fullText.length > 15000) {
            break;
          }
        }

        setPdfText(fullText.substring(0, 15000));
        logger.debug('PDF text extracted:', { length: fullText.length });
      } catch (error) {
        logger.error('Failed to extract PDF text:', error);
        setPdfText('');
      }
    };

    extractPdfText();
  }, [selectedResource]);

  const fetchResources = async () => {
    try {
      setLoading(true);

      // Handle YouTube tab separately - fetch from both sources
      if (activeTab === 'youtube') {
        // Fetch from youtube-videos table (user's saved videos)
        const youtubeVideosUrl = `${config.apiUrl}/youtube-videos`;
        const youtubeRes = await fetch(youtubeVideosUrl, {
          headers: accessToken
            ? { Authorization: `Bearer ${accessToken}` }
            : {},
        });
        const youtubeResult = await youtubeRes.json();
        // Handle wrapped API response { success: true, data: T }
        const youtubeData = youtubeResult?.data ?? youtubeResult;
        const youtubeVideos = (
          Array.isArray(youtubeData) ? youtubeData : youtubeData.data || []
        ).map(
          (video: {
            id: string;
            title: string;
            url: string;
            createdAt: string;
            videoId: string;
          }) => ({
            id: video.id,
            type: 'YOUTUBE',
            title: video.title,
            abstract: null,
            sourceUrl: video.url,
            publishedAt: video.createdAt,
            videoId: video.videoId,
          })
        );

        // Fetch from resources table with type=YOUTUBE_VIDEO
        const resourcesUrl = `${config.apiUrl}/resources?type=YOUTUBE_VIDEO&take=50&skip=0`;
        const resourcesRes = await fetch(resourcesUrl, {
          headers: getAuthHeader(),
        });
        const resourcesResult = await resourcesRes.json();
        // Handle wrapped API response { success: true, data: T }
        const resourcesData = resourcesResult?.data ?? resourcesResult;
        const resourceVideos = Array.isArray(resourcesData)
          ? resourcesData
          : resourcesData.data || [];

        // Merge both sources
        const allVideos = [...youtubeVideos, ...resourceVideos];
        setResources(allVideos);
        setLoading(false);
        return;
      }

      if (activeTab === 'papers') {
        const params = new URLSearchParams({
          take: '300',
          skip: '0',
          sortBy: sortBy,
          sortOrder: sortOrder,
          type: 'PAPER',
        });

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
        const res = await fetch(url, {
          headers: getAuthHeader(),
        });
        const result = await res.json();
        const data = result?.data ?? result;
        const responseData = data?.data ?? data;
        const paperResources: Resource[] = Array.isArray(responseData)
          ? responseData
          : responseData?.data || [];
        const nextPapers =
          paperLibraryTab === 'recent'
            ? paperResources
                .filter(
                  (resource) =>
                    resource.metadata?.importedAs === 'hf-hot-paper'
                )
                .sort(
                  (a, b) =>
                    paperTrendTime(b) - paperTrendTime(a) ||
                    paperTrendRank(a) - paperTrendRank(b)
                )
                .slice(0, 80)
                .map(withRecentPaperTrendSummary)
            : paperResources.filter((resource) => {
                const importedAs = resource.metadata?.importedAs;
                return typeof importedAs === 'string'
                  ? importedAs ===
                      (paperLibraryTab === 'insights'
                        ? 'hf-paper-insight-report'
                        : 'hf-hot-paper')
                  : false;
              });

        setResources(nextPapers);
        setLoading(false);
        return;
      }

      // Build query params
      const params = new URLSearchParams({
        take: '50',
        skip: '0',
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
          activeTab as
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
      const res = await fetch(url, {
        headers: getAuthHeader(),
      });
      const result = await res.json();
      // Handle wrapped API response { success: true, data: T }
      const data = result?.data ?? result;
      // API returns { success, data: { data: [...], pagination } } format
      const responseData = data?.data ?? data;
      const newResources = Array.isArray(responseData)
        ? responseData
        : responseData?.data || [];
      setResources(newResources);
    } catch (error) {
      logger.error('Failed to fetch:', error);
      setResources([]);
    } finally {
      setLoading(false);
    }
  };

  const renderPaperLibraryTabs = () => {
    const hasSolarHfPaperResources = resources.some((resource) => {
      const importedAs = resource.metadata?.importedAs;
      return (
        importedAs === 'hf-paper-insight-report' ||
        importedAs === 'hf-hot-paper'
      );
    });

    if (
      viewMode !== 'list' ||
      (activeTab !== 'papers' &&
        searchParams?.get('tab') !== 'papers' &&
        !hasSolarHfPaperResources)
    ) {
      return null;
    }

    const tabs: Array<{
      id: PaperLibraryTab;
      label: string;
      description: string;
    }> = [
      {
        id: 'recent',
        label: '最近趋势',
        description: '最近同步数据里的 HuggingFace / arXiv 热点趋势',
      },
      {
        id: 'insights',
        label: 'HF 洞察报告',
        description: 'AI Influence 汇总的 HuggingFace 趋势论文分析',
      },
      {
        id: 'hot',
        label: '热门论文',
        description: 'HuggingFace 与 arXiv 热门 AI / 计算 / 芯片 / 软件论文',
      },
    ];

    return (
      <div className="mb-5 rounded-lg border border-gray-200 bg-white p-2">
        <div className="grid gap-2 sm:grid-cols-3">
          {tabs.map((tab) => {
            const selected = paperLibraryTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setPaperLibraryTab(tab.id);
                  setSelectedResource(null);
                  setViewMode('list');
                }}
                className={`rounded-md px-4 py-3 text-left transition-colors ${
                  selected
                    ? 'bg-red-50 text-red-700 ring-1 ring-red-200'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <span className="block text-sm font-semibold">{tab.label}</span>
                <span className="mt-1 block text-xs leading-5 text-gray-500">
                  {tab.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

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
      showToast.warning('当前标签页不支持文件上传');
      return;
    }

    // Check file size
    if (file.size > restrictions.maxSize) {
      const maxSizeMB = restrictions.maxSize / (1024 * 1024);
      showToast.warning(`文件大小超过限制（最大 ${maxSizeMB}MB）`);
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
      showToast.warning(
        `请上传${restrictions.label}（${restrictions.accept}）`
      );
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
        headers: getAuthHeader(),
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
      showToast.success(
        `文件 "${file.name}" 上传成功！\n\n文件将保存为资源，您可以在列表中查看。`
      );

      // Refresh resources list
      await fetchResources();
    } catch (error) {
      logger.error('File upload error:', error);
      const errorMessage =
        error instanceof Error ? error.message : '文件上传失败';
      showToast.error(errorMessage);
    } finally {
      setUploadingFile(false);
      setSelectedFile(null);
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  const handleResourceClick = (resource: Resource) => {
    // For YouTube videos, navigate to the YouTube page
    if (
      resource.type === 'YOUTUBE' ||
      resource.type === 'YOUTUBE_VIDEO' ||
      (resource as { videoId?: string }).videoId
    ) {
      let videoId = (resource as { videoId?: string }).videoId;

      // If no videoId, extract from sourceUrl (handle multiple YouTube URL formats)
      if (!videoId && resource.sourceUrl) {
        // Try youtube.com/watch?v=xxx format
        let urlMatch = resource.sourceUrl.match(/[?&]v=([^&]+)/);
        if (urlMatch) {
          videoId = urlMatch[1];
        } else {
          // Try youtu.be/xxx format
          urlMatch = resource.sourceUrl.match(/youtu\.be\/([^?&]+)/);
          if (urlMatch) {
            videoId = urlMatch[1];
          } else {
            // Try youtube.com/embed/xxx format
            urlMatch = resource.sourceUrl.match(
              /youtube\.com\/embed\/([^?&]+)/
            );
            if (urlMatch) {
              videoId = urlMatch[1];
            }
          }
        }
      }

      if (videoId) {
        router.push(`/explore/youtube?videoId=${videoId}`);
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
      const res = await fetch(url, {
        headers: getAuthHeader(),
      });
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
      const res = await fetch(`${config.apiUrl}/resources/${id}`, {
        headers: getAuthHeader(),
      });
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

  // Helper function to save AI analysis to database
  const saveAIAnalysisToDatabase = async (
    resourceId: string,
    data: {
      aiSummary?: string;
      keyInsights?: AIInsight[];
      methodology?: string;
    }
  ) => {
    try {
      const res = await fetch(`${config.apiUrl}/resources/${resourceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        logger.debug('AI analysis saved to database for resource:', resourceId);
      }
    } catch (error) {
      logger.error('Failed to save AI analysis to database:', error);
    }
  };

  // AI Functions - with database caching
  const generateSummary = async (resource: Resource) => {
    if (!resource) return;

    // Check if we already have summary in database
    if (resource.aiSummary) {
      logger.debug('Using cached summary from database');
      setAiSummary(resource.aiSummary);
      return;
    }

    try {
      setAiLoading(true);
      // Use extracted article content if available, otherwise fallback to abstract/title
      const content = articleTextContent || resource.abstract || resource.title;
      logger.debug('Generating summary with content length:', content.length);

      // BYOK: Include auth header so backend can use user's personal API key
      const res = await fetch('/api/ai-service/ai/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({
          content: content,
          max_length: 200,
          language: 'zh',
        }),
      });

      if (!res.ok) {
        // 透传后端真实原因（模型额度不足 / 无可用模型 / provider 报错），
        // 不再硬编码"配置 ai-service.env"——实际走主后端 BYOK，文案误导。
        let detail = `AI 服务返回错误 (${res.status})`;
        try {
          const error = await res.json();
          detail = error.error || error.detail || error.message || detail;
        } catch {
          /* 保留默认 */
        }
        setAiSummary(`⚠️ 摘要生成失败：${detail}`);
        return;
      }

      const result = await res.json();
      // Handle wrapped API response { success: true, data: T }
      const data = result?.data ?? result;
      setAiSummary(data.summary);

      // Save to database for future use
      if (data.summary) {
        saveAIAnalysisToDatabase(resource.id, { aiSummary: data.summary });
      }
    } catch (error) {
      logger.error('Failed to generate summary:', error);
      setAiSummary(
        '⚠️ 无法连接到AI服务\n\n请确保 ai-service 已启动：\ncd ai-service && uvicorn main:app --reload'
      );
    } finally {
      setAiLoading(false);
    }
  };

  const generateInsights = async (resource: Resource) => {
    if (!resource) return;

    // Check if we already have insights in database
    if (resource.keyInsights && resource.keyInsights.length > 0) {
      logger.debug('Using cached insights from database');
      setAiInsights(resource.keyInsights);
      return;
    }

    try {
      // Use extracted article content if available, otherwise fallback to abstract/title
      const content = articleTextContent || resource.abstract || resource.title;
      logger.debug('Generating insights with content length:', content.length);

      // BYOK: Include auth header so backend can use user's personal API key
      const res = await fetch('/api/ai-service/ai/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({
          content: content,
          language: 'zh',
        }),
      });

      const result = await res.json();
      // Handle wrapped API response { success: true, data: T }
      const data = result?.data ?? result;
      const insights = data.insights || [];
      setAiInsights(insights);

      // Save to database for future use
      if (insights.length > 0) {
        saveAIAnalysisToDatabase(resource.id, { keyInsights: insights });
      }
    } catch (error) {
      logger.error('Failed to generate insights:', error);
    }
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
      showToast.error(
        'Failed to save note: Network error or server unreachable'
      );
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
      showToast.warning('No conversation to save');
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
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({
          resourceId: selectedResource.id,
          content: conversationText,
          type: 'AI_CONVERSATION',
        }),
      });

      if (!response.ok) throw new Error('Failed to save conversation');

      showToast.success('Conversation saved to notes successfully!');
      setNotesRefreshKey((prev) => prev + 1); // Refresh notes list
    } catch (error) {
      logger.error('Failed to save conversation:', error);
      showToast.error('Failed to save conversation. Please try again.');
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

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;

            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                setAiMessages((prev) => {
                  const newMessages = [...prev];
                  newMessages[messageIndex] = {
                    ...newMessages[messageIndex],
                    content: newMessages[messageIndex].content + parsed.content,
                  };
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

    setAiLoading(true);

    try {
      // Use article text content if available (from Reader Mode), otherwise fall back to abstract
      const mainContent =
        articleTextContent ||
        selectedResource.abstract ||
        selectedResource.aiSummary ||
        '';
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
      } else if (action === 'insights') {
        // Handle insights response - content may be array (pre-parsed) or string
        if (Array.isArray(data.content)) {
          setAiInsights(data.content);
        } else if (typeof data.content === 'string') {
          try {
            const insights = JSON.parse(data.content);
            if (Array.isArray(insights)) {
              setAiInsights(insights);
            } else {
              setAiInsights([]);
            }
          } catch {
            // If not valid JSON, try to parse markdown format
            logger.debug(
              'JSON parsing failed, trying markdown parsing for insights'
            );
            const parsedInsights = parseMarkdownToInsights(data.content);
            setAiInsights(parsedInsights);
          }
        } else {
          setAiInsights([]);
        }
      } else if (action === 'methodology') {
        // Handle methodology response - content may be array (pre-parsed) or string
        if (Array.isArray(data.content)) {
          setAiMethodology(data.content);
        } else if (typeof data.content === 'string') {
          try {
            const methodology = JSON.parse(data.content);
            if (Array.isArray(methodology)) {
              setAiMethodology(methodology);
            } else {
              setAiMethodology([]);
            }
          } catch {
            // If not valid JSON, try to parse markdown format
            logger.debug(
              'JSON parsing failed, trying markdown parsing for methodology'
            );
            const parsedMethodology = parseMarkdownToInsights(data.content);
            setAiMethodology(parsedMethodology);
          }
        } else {
          setAiMethodology([]);
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

  // Bookmark functions
  const toggleBookmark = async (resourceId: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }

    // Check if user is logged in
    if (!user) {
      window.location.href = '/login';
      return;
    }

    if (!defaultCollectionId) {
      logger.error('Default collection not found');
      return;
    }

    try {
      const authHeaders = getAuthHeader();
      const isCurrentlyBookmarked = bookmarks.has(resourceId);

      if (isCurrentlyBookmarked) {
        // Remove from collection
        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/collections/${defaultCollectionId}/items/${resourceId}`,
          {
            method: 'DELETE',
            headers: authHeaders,
          }
        );

        if (response.ok) {
          const newBookmarks = new Set(bookmarks);
          newBookmarks.delete(resourceId);
          setBookmarks(newBookmarks);
        }
      } else {
        // Add to collection
        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/collections/${defaultCollectionId}/items`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...authHeaders,
            },
            body: JSON.stringify({ resourceId }),
          }
        );

        if (response.ok) {
          const newBookmarks = new Set(bookmarks);
          newBookmarks.add(resourceId);
          setBookmarks(newBookmarks);
        }
      }
    } catch (err) {
      logger.error('Failed to toggle bookmark:', err);
    }
  };

  const isBookmarked = (resourceId: string) => {
    return bookmarks.has(resourceId);
  };

  // Upvote function
  const toggleUpvote = (resourceId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    const newUpvotes = new Set(upvotes);
    if (newUpvotes.has(resourceId)) {
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
        title: 'Delete this resource?',
        description: 'This action cannot be undone.',
        type: 'danger',
      }))
    ) {
      return;
    }

    try {
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/admin/resources/${resourceId}`,
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
      } else {
        showToast.error('Failed to delete resource');
      }
    } catch (err) {
      logger.error('Failed to delete resource:', err);
      showToast.error('Failed to delete resource');
    }
  };

  const urlActiveTab = searchParams?.get('tab');
  const navigationActiveTab =
    urlActiveTab && VALID_TABS.includes(urlActiveTab as TabType)
      ? (urlActiveTab as TabType)
      : activeTab;

  return (
    <AppShell>
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
                      placeholder="Ask or search anything..."
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
              {/* Loading State */}
              {loading && (
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

              {/* Resource Cards - Horizontal Layout */}
              {!loading && resources.length > 0 && (
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
                        className="cursor-pointer overflow-hidden rounded-xl border border-gray-200 bg-white transition-all hover:shadow-lg"
                      >
                        <div className="flex items-start gap-4 p-6">
                          {/* Icon */}
                          <div className="flex-shrink-0 pt-1">
                            {resource.type === 'PAPER' && (
                              <svg
                                className="h-6 w-6 text-blue-600"
                                fill="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11zM8 15.5h8v1H8v-1zm0-3h8v1H8v-1zm0-3h5v1H8v-1z" />
                              </svg>
                            )}
                            {resource.type === 'PROJECT' && (
                              <svg
                                className="h-6 w-6 text-purple-600"
                                fill="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                              </svg>
                            )}
                            {resource.type === 'NEWS' && (
                              <svg
                                className="h-6 w-6 text-orange-600"
                                fill="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path d="M19 3H5c-1.11 0-2 .89-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.11-.9-2-2-2zm-1 16H6c-.55 0-1-.45-1-1V6c0-.55.45-1 1-1h12c.55 0 1 .45 1 1v12c0 .55-.45 1-1 1zM7 12h2v2H7zm0-3h2v2H7zm0-3h2v2H7zm4 6h6v2h-6zm0-3h6v2h-6zm0-3h6v2h-6z" />
                              </svg>
                            )}
                            {(resource.type === 'YOUTUBE' ||
                              resource.type === 'YOUTUBE_VIDEO') && (
                              <svg
                                className="h-6 w-6 text-red-600"
                                fill="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                              </svg>
                            )}
                          </div>

                          {/* Content */}
                          <div className="min-w-0 flex-1">
                            {/* Date, Source Badge, Tags, and Stats */}
                            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
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
                            </div>

                            {/* Title */}
                            <h2 className="mb-3 text-xl font-semibold text-red-600 hover:underline">
                              {resource.title}
                            </h2>

                            {/* Abstract */}
                            {(resource.aiSummary || resource.abstract) && (
                              <p className="mb-4 line-clamp-3 text-sm leading-relaxed text-gray-700">
                                {resource.aiSummary || resource.abstract}
                              </p>
                            )}

                            {/* Bottom Actions */}
                            <div className="flex items-center gap-6 border-t border-gray-100 pt-3">
                              {/* Bookmark Button - Simple version */}
                              <button
                                onClick={(e) => toggleBookmark(resource.id, e)}
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
                                  onClick={(e) => toggleUpvote(resource.id, e)}
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
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const isAdded = aiOfficeStore.resources.some(
                                    (r) => r._id === resource.id
                                  );
                                  if (isAdded) {
                                    // 移除资源
                                    aiOfficeStore.removeResource(resource.id);
                                  } else {
                                    // 添加资源
                                    const aiResource =
                                      convertToAIOfficeResource(resource);
                                    aiOfficeStore.addResource(aiResource);
                                  }
                                }}
                                className={`flex items-center gap-2 text-sm transition-colors ${
                                  aiOfficeStore.resources.some(
                                    (r) => r._id === resource.id
                                  )
                                    ? 'cursor-pointer text-green-600 hover:text-red-600'
                                    : 'text-gray-600 hover:text-blue-600'
                                }`}
                                title={
                                  aiOfficeStore.resources.some(
                                    (r) => r._id === resource.id
                                  )
                                    ? '点击移除 AI Office'
                                    : '添加到 AI Office'
                                }
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
                                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                                  />
                                </svg>
                                {aiOfficeStore.resources.some(
                                  (r) => r._id === resource.id
                                )
                                  ? 'Added'
                                  : 'AI Reports'}
                              </button>

                              {/* To Image Button */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const isAlreadyAdded = imageSources.some(
                                    (s) => s.id === resource.id
                                  );
                                  if (!isAlreadyAdded) {
                                    const validTypes = [
                                      'paper',
                                      'blog',
                                      'report',
                                      'youtube',
                                      'news',
                                      'project',
                                    ];
                                    const resourceType =
                                      resource.type.toLowerCase();
                                    const mappedType =
                                      resourceType === 'youtube_video'
                                        ? 'youtube'
                                        : resourceType;

                                    addSource({
                                      id: resource.id,
                                      type: validTypes.includes(mappedType)
                                        ? (mappedType as
                                            | 'paper'
                                            | 'blog'
                                            | 'report'
                                            | 'youtube'
                                            | 'news'
                                            | 'project')
                                        : 'paper',
                                      title: resource.title,
                                      url:
                                        resource.sourceUrl ||
                                        resource.pdfUrl ||
                                        '',
                                      thumbnailUrl: resource.thumbnailUrl,
                                      addedAt: new Date(),
                                    });
                                    setToast({
                                      message: `Added "${resource.title}" to Image Source Pool`,
                                      type: 'success',
                                    });
                                  }
                                }}
                                className={`flex items-center gap-2 text-sm transition-colors ${
                                  imageSources.some((s) => s.id === resource.id)
                                    ? 'cursor-default font-medium text-purple-600'
                                    : 'text-gray-600 hover:text-purple-600'
                                }`}
                                title={
                                  imageSources.some((s) => s.id === resource.id)
                                    ? 'Already in Image Source Pool'
                                    : 'Add to Image Source Pool'
                                }
                                disabled={imageSources.some(
                                  (s) => s.id === resource.id
                                )}
                              >
                                <svg
                                  className="h-4 w-4"
                                  fill={
                                    imageSources.some(
                                      (s) => s.id === resource.id
                                    )
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
                                    d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                                  />
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                                  />
                                </svg>
                                {imageSources.some((s) => s.id === resource.id)
                                  ? 'Added'
                                  : 'Image'}
                              </button>

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

              {/* Empty State */}
              {!loading && resources.length === 0 && (
                <EmptyState
                  title="No content available"
                  description="Try running the data crawler first"
                  size="md"
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
                    {/* View Mode Toggle - 简洁的 Segmented Control */}
                    {selectedResource.type !== 'PAPER' &&
                      selectedResource.sourceUrl && (
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
                                .map((a) => a.username)
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

                        {/* AI Office */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const aiResource =
                              convertToAIOfficeResource(selectedResource);
                            aiOfficeStore.addResource(aiResource);
                          }}
                          disabled={aiOfficeStore.resources.some(
                            (r) => r._id === selectedResource.id
                          )}
                          className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-sm transition-colors ${
                            aiOfficeStore.resources.some(
                              (r) => r._id === selectedResource.id
                            )
                              ? 'bg-green-100 text-green-700'
                              : 'bg-white text-gray-600 hover:bg-gray-100'
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
                              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                            />
                          </svg>
                          {aiOfficeStore.resources.some(
                            (r) => r._id === selectedResource.id
                          )
                            ? 'Added'
                            : 'Add to AI'}
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
                {selectedResource.type === 'PAPER' &&
                selectedResource.pdfUrl ? (
                  <PDFViewer
                    url={selectedResource.pdfUrl}
                    title={selectedResource.title}
                    className="h-full w-full"
                  />
                ) : selectedResource.sourceUrl ? (
                  htmlViewMode === 'reader' ? (
                    <ReaderView
                      url={selectedResource.sourceUrl}
                      title={selectedResource.title}
                      category={selectedResource.type}
                      isImportedResource={true}
                      className="h-full w-full"
                      onArticleLoaded={handleArticleLoaded}
                    />
                  ) : (
                    <HTMLViewer
                      url={selectedResource.sourceUrl}
                      title={selectedResource.title}
                      className="h-full w-full"
                    />
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
      {!isAiPanelCollapsed && viewMode === 'detail' && (
        <aside className="relative hidden w-80 flex-shrink-0 flex-col border-l border-gray-200 bg-white lg:flex lg:w-96">
          <button
            type="button"
            onClick={() => setIsAiPanelCollapsed(true)}
            className="group absolute -left-4 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg bg-gradient-to-br from-red-50 to-pink-50 shadow-md ring-1 ring-red-200/50 transition-all duration-200 hover:shadow-lg hover:ring-red-300/60"
            aria-label="收起 AI 助手面板"
          >
            <svg
              className="h-4 w-4 text-gray-600 transition-all duration-200 group-hover:text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M9 5l7 7-7 7"
              />
            </svg>
            <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-red-400/0 to-pink-400/0 opacity-0 transition-opacity duration-200 group-hover:from-red-400/10 group-hover:to-pink-400/10 group-hover:opacity-100" />
          </button>

          {/* Top Tab Navigation - Icon + Text Style */}
          <div className="border-b border-gray-100 bg-gray-50 px-2 py-2">
            <div className="grid grid-cols-4 gap-1">
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
          {/* Main Content Area */}
          <div className="flex-1 overflow-y-auto p-6">
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
                            <p className="text-[11px] text-gray-500">
                              Right-click to add to notes
                            </p>
                          </div>
                        </div>
                      </div>
                      <div
                        className="prose prose-sm max-w-none cursor-text select-text p-3"
                        onContextMenu={(e) => handleContextMenu(e, aiSummary)}
                      >
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
                    </div>
                  )}

                  {/* AI Loading Indicator */}
                  {(aiLoading || isStreaming) && (
                    <div className="flex items-center justify-center gap-2 py-4">
                      <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-red-600"></div>
                      <span className="text-sm text-gray-600">
                        {isStreaming
                          ? `${(aiModels || []).find((m) => m.modelId === aiModel)?.name || aiModel} is thinking...`
                          : 'AI processing...'}
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
                            <p className="text-[11px] text-gray-500">
                              Right-click to add to notes
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-2 p-3">
                        {aiInsights.map((insight, i) => (
                          <div
                            key={i}
                            className={`group cursor-pointer rounded-lg border-2 p-2.5 transition-all ${
                              insight.importance === 'high'
                                ? 'border-red-200 bg-red-50 hover:border-red-300 hover:bg-red-100'
                                : insight.importance === 'medium'
                                  ? 'border-orange-200 bg-orange-50 hover:border-orange-300 hover:bg-orange-100'
                                  : 'border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-gray-100'
                            }`}
                            onContextMenu={(e) =>
                              handleContextMenu(
                                e,
                                `**${insight.title}**\n\n${insight.description}`
                              )
                            }
                          >
                            <div className="flex items-start">
                              <div className="flex-1">
                                <h4 className="text-sm font-semibold leading-snug text-gray-900">
                                  {insight.title}
                                </h4>
                                <p className="mt-1 text-xs leading-relaxed text-gray-600">
                                  {insight.description}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
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
                            <h3 className="text-xs font-bold text-gray-900">
                              Research Methodology
                            </h3>
                            <p className="text-[10px] text-gray-500">
                              Right-click to add to notes
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-2 p-3">
                        {aiMethodology.map((method, i) => (
                          <div
                            key={i}
                            className={`group cursor-pointer rounded-lg border-2 p-2.5 transition-all ${
                              method.importance === 'high'
                                ? 'border-blue-200 bg-blue-50 hover:border-blue-300 hover:bg-blue-100'
                                : method.importance === 'medium'
                                  ? 'border-cyan-200 bg-cyan-50 hover:border-cyan-300 hover:bg-cyan-100'
                                  : 'border-teal-200 bg-teal-50 hover:border-teal-300 hover:bg-teal-100'
                            }`}
                            onContextMenu={(e) =>
                              handleContextMenu(
                                e,
                                `**${method.title}**\n\n${method.description}`
                              )
                            }
                          >
                            <div className="flex items-start gap-2">
                              <span className="text-base">🔬</span>
                              <div className="flex-1">
                                <h4 className="text-xs font-semibold leading-snug text-gray-900">
                                  {method.title}
                                </h4>
                                <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
                                  {method.description}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Chat Messages */}
                  {aiMessages.length > 0 && (
                    <div className="space-y-3 border-t border-gray-200 pt-4">
                      {aiMessages.map((msg, i) => (
                        <div
                          key={i}
                          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[80%] rounded-lg px-3 py-2 ${
                              msg.role === 'user'
                                ? 'bg-gradient-to-br from-red-500 to-red-600 text-white'
                                : 'bg-gray-100 text-gray-800'
                            }`}
                            onContextMenu={
                              msg.role === 'assistant'
                                ? (e) => handleContextMenu(e, msg.content)
                                : undefined
                            }
                          >
                            <div className="prose-xs prose max-w-none text-xs leading-relaxed [&>*]:my-1 [&>ol]:my-1 [&>p]:my-1 [&>ul]:my-1">
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
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
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
                              <ClientDate date={msg.timestamp} format="time" />
                            </div>
                          </div>
                        </div>
                      ))}

                      {/* Inline Loading Message */}
                      {isStreaming && (
                        <div className="flex justify-start">
                          <div className="max-w-[80%] rounded-lg bg-gray-100 px-3 py-2 text-gray-900">
                            <div className="flex items-center gap-2">
                              <div className="h-3 w-3 animate-spin rounded-full border-b-2 border-red-600"></div>
                              <p className="text-xs">
                                {(aiModels || []).find(
                                  (m) => m.modelId === aiModel
                                )?.name || aiModel}
                                正在思考...
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      <div ref={chatEndRef} />
                    </div>
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
                <div className="p-6">
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
                <div className="p-6">
                  <CommentsList resourceId={selectedResource.id} />
                </div>
              ) : aiRightTab === 'similar' ? (
                <div className="p-6">
                  <SimilarResourcesList
                    resourceId={selectedResource.id}
                    onResourceClick={(resource) => {
                      // Navigate to the similar resource
                      const newResource = resources.find(
                        (r) => r.id === resource.id
                      );
                      if (newResource) {
                        setSelectedResource(newResource);
                      } else {
                        // If not in current list, open in new tab
                        window.open(resource.sourceUrl, '_blank');
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

                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs text-amber-800">
                      💡 功能开发中，即将支持DALL-E、Stable Diffusion等模型
                    </p>
                  </div>
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

      {isAiPanelCollapsed && viewMode === 'detail' && (
        <button
          type="button"
          onClick={() => setIsAiPanelCollapsed(false)}
          aria-label="展开 AI 助手面板"
          className="group absolute right-0 top-1/2 z-20 flex -translate-y-1/2 items-center gap-2 rounded-l-lg bg-gradient-to-br from-red-50 to-pink-50 px-4 py-3 text-sm font-medium text-gray-700 shadow-lg ring-1 ring-red-200/50 transition-all duration-200 hover:shadow-xl hover:ring-red-300/60"
        >
          <svg
            className="h-4 w-4 text-gray-600 transition-all duration-200 group-hover:text-red-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          <span className="transition-colors duration-200 group-hover:text-red-600">
            AI助手
          </span>
          <div className="absolute inset-0 rounded-l-lg bg-gradient-to-br from-red-400/0 to-pink-400/0 opacity-0 transition-opacity duration-200 group-hover:from-red-400/10 group-hover:to-pink-400/10 group-hover:opacity-100" />
        </button>
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
    </AppShell>
  );
}

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/ai-ask');
  }, [router]);

  return <LoadingState fullScreen size="lg" />;
}

function HomeLoadingFallback() {
  return (
    <div className="flex h-screen bg-gray-50">
      <div className="flex w-full items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-gray-600">加载中...</p>
        </div>
      </div>
    </div>
  );
}
