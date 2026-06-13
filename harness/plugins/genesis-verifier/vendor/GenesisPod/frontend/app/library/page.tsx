'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import dynamicImport from 'next/dynamic';
import { config } from '@/lib/utils/config';
import {
  Bookmark,
  FileText,
  Image,
  Database,
  User,
  Users,
  HardDrive,
  BookOpen,
  CheckCircle2,
  StickyNote,
  ThumbsUp,
} from 'lucide-react';
import {
  AssetCard,
  type AssetCardAction,
} from '@/components/ui/cards/asset-card';
import { useTranslation } from '@/lib/i18n';
import AppShell from '@/components/layout/AppShell';
import LibraryHeader from '@/components/library/header/LibraryHeader';
import LibrarySearchBar from '@/components/library/header/LibrarySearchBar';
import LibraryTabs, {
  type LibraryTabItem,
} from '@/components/library/nav/LibraryTabs';
import { Tag, UserStats } from '@/components/library/resources/CollectionNav';
import ReadStatusBadge from '@/components/library/resources/ReadStatusBadge';
import TagList from '@/components/library/resources/TagList';
import { getAuthHeader, getUserHash } from '@/lib/utils/auth';
import {
  useMultiSelect,
  useCollections,
  ReadStatus,
  CollectionItem,
  Collection,
  PaginatedResult,
} from '@/hooks';
import { useResourceStore } from '@/stores/aiOfficeStore';
import { useImageSourceStore, toast as showToast, confirm } from '@/stores';
import type {
  Resource as AIOfficeResource,
  WebMetadata,
} from '@/lib/types/ai-office';
import type { Note } from '@/components/common/resource-lists/NotesList';
import { logger } from '@/lib/utils/logger';
import AddToKnowledgeBaseDialog, {
  type ResourceToAdd,
} from '@/components/common/dialogs/AddToKnowledgeBaseDialog';
import { Modal } from '@/components/ui/dialogs/Modal';
import { ConfirmDialog } from '@/components/ui/dialogs/ConfirmDialog';
import {
  LoadingState,
  LoadingInline,
  EmptyState,
} from '@/components/ui/states';
import ClientDate from '@/components/common/ClientDate';

// 懒加载条件渲染的组件
const NotesList = dynamicImport(
  () => import('@/components/common/resource-lists/NotesList'),
  { ssr: false }
);

const KnowledgeGraphView = dynamicImport(
  () => import('@/components/common/views/KnowledgeGraphView'),
  { ssr: false, loading: () => <GraphLoadingSkeleton /> }
);

// Graph loading skeleton - Note: Cannot use hooks here since it's outside component
function GraphLoadingSkeleton() {
  return (
    <div className="flex h-[600px] items-center justify-center rounded-lg border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="text-center">
        <div className="mx-auto h-12 w-12 animate-pulse rounded-full bg-gradient-to-r from-purple-400 to-blue-400" />
        <p className="mt-4 text-gray-600">Loading knowledge graph...</p>
      </div>
    </div>
  );
}

const CollectionModal = dynamicImport(
  () => import('@/components/library/resources/CollectionModal'),
  { ssr: false }
);

const BatchActionBar = dynamicImport(
  () => import('@/components/library/resources/BatchActionBar'),
  { ssr: false }
);

const AIOrganizePanel = dynamicImport(
  () => import('@/components/library/AIOrganizePanel'),
  { ssr: false }
);

const NotionTabContent = dynamicImport(
  () => import('@/components/library/integrations/notion/NotionTabContent'),
  {
    ssr: false,
    loading: () => <LoadingState size="lg" text="" />,
  }
);

const GoogleDriveTabContent = dynamicImport(
  () =>
    import('@/components/library/integrations/google-drive/GoogleDriveTabContent'),
  {
    ssr: false,
    loading: () => <LoadingState size="lg" text="" />,
  }
);

const KnowledgeBaseTabContent = dynamicImport(
  () => import('@/components/library/knowledge-base/KnowledgeBaseTabContent'),
  {
    ssr: false,
    loading: () => <LoadingState size="lg" text="" />,
  }
);

const PersonalKnowledgeBaseTab = dynamicImport(
  () => import('@/components/library/knowledge-base/PersonalKnowledgeBaseTab'),
  {
    ssr: false,
    loading: () => <LoadingState size="lg" text="" />,
  }
);

const TeamKnowledgeBaseTab = dynamicImport(
  () => import('@/components/library/knowledge-base/TeamKnowledgeBaseTab'),
  {
    ssr: false,
    loading: () => <LoadingState size="lg" text="" />,
  }
);

// ★ v1.5.3 Wiki tab (Library 主形态) — KB selector + 三栏 + Diff 审阅
const WikiTab = dynamicImport(
  () => import('@/components/library/wiki/WikiTab'),
  {
    ssr: false,
    loading: () => <LoadingState size="lg" text="" />,
  }
);

const DataSourcesTab = dynamicImport(
  () => import('@/components/library/data-sources/DataSourcesTab'),
  {
    ssr: false,
    loading: () => <LoadingState size="lg" text="" />,
  }
);

export const dynamic = 'force-dynamic';

// Type for data source sub-tabs
type DataSourceSubTab =
  | 'overview'
  | 'bookmarks'
  | 'notes'
  | 'images'
  | 'notion'
  | 'google-drive'
  | 'feishu';

interface YouTubeVideo {
  id: string;
  videoId: string;
  title: string;
  url: string;
  transcript: unknown;
  translatedText?: string;
  aiReport?: unknown;
  createdAt: string;
}

interface Resource {
  id: string;
  type: string;
  title: string;
  abstract?: string;
  publishedAt: string;
  sourceUrl: string;
  thumbnailUrl?: string;
  upvoteCount?: number;
}

interface BookmarkedImage {
  id: string;
  prompt: string;
  enhancedPrompt?: string;
  imageUrl: string;
  width: number;
  height: number;
  createdAt: string;
  isBookmarked: boolean;
}

function LibraryPageContent() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');
  // Wiki detail (tab=wiki + ?kb=) is a focused full-page surface — hide the
  // shared Library header / tabs / px-8 padding so the wiki subheader and
  // page reader own the viewport. The grid landing keeps the shell.
  const wikiKbParam = searchParams?.get('kb');

  // 简化后的4个主TAB：数据源、个人知识库、团队知识库、知识图谱
  const [activeTab, setActiveTab] = useState<
    'wiki' | 'personal-kb' | 'team-kb' | 'data-sources' | 'graph'
  >(() => {
    // Initialize from URL parameter if present
    if (
      tabParam === 'wiki' ||
      tabParam === 'personal-kb' ||
      tabParam === 'team-kb' ||
      tabParam === 'data-sources' ||
      tabParam === 'graph'
    ) {
      return tabParam;
    }
    // 兼容旧的URL参数，重定向到数据源
    if (
      tabParam === 'bookmarks' ||
      tabParam === 'notes' ||
      tabParam === 'images' ||
      tabParam === 'notion' ||
      tabParam === 'google-drive'
    ) {
      return 'data-sources';
    }
    // ★ v1.5.3: Library 默认 tab 由 'data-sources' 改为 'wiki'（Wiki 主形态升级）
    return 'wiki';
  });

  // 数据源的初始子TAB（根据URL参数）
  const [initialDataSourceSubTab] = useState<DataSourceSubTab | undefined>(
    () => {
      if (tabParam === 'bookmarks') return 'bookmarks';
      if (tabParam === 'notes') return 'notes';
      if (tabParam === 'images') return 'images';
      if (tabParam === 'notion') return 'notion';
      if (tabParam === 'google-drive') return 'google-drive';
      return undefined;
    }
  );

  // 当前数据源子TAB（用于显示AI面板）
  const [currentDataSourceSubTab, setCurrentDataSourceSubTab] =
    useState<DataSourceSubTab>(initialDataSourceSubTab || 'overview');

  // Update activeTab when URL parameter changes
  useEffect(() => {
    if (
      tabParam === 'wiki' ||
      tabParam === 'personal-kb' ||
      tabParam === 'team-kb' ||
      tabParam === 'data-sources' ||
      tabParam === 'graph'
    ) {
      setActiveTab(tabParam);
    } else if (
      tabParam === 'bookmarks' ||
      tabParam === 'notes' ||
      tabParam === 'images' ||
      tabParam === 'notion' ||
      tabParam === 'google-drive'
    ) {
      // 旧的TAB参数重定向到数据源
      setActiveTab('data-sources');
    }
  }, [tabParam]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [paginatedItems, setPaginatedItems] =
    useState<PaginatedResult<CollectionItem> | null>(null);
  const [currentCollectionId, setCurrentCollectionId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'addedAt' | 'title' | 'publishedAt'>(
    'addedAt'
  );
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Tags and stats
  const [tags, setTags] = useState<Tag[]>([]);
  const [stats, setStats] = useState<UserStats | null>(null);

  // Multi-select mode
  const [selectionMode, setSelectionMode] = useState(false);
  const {
    selectedIds,
    selectedCount,
    toggleSelect,
    selectAll,
    clearAll,
    isSelected,
  } = useMultiSelect(50);

  // Modal states
  const [editNoteModalOpen, setEditNoteModalOpen] = useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<CollectionItem | null>(null);

  // Collection navigation states
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(
    null
  );
  const [collectionModalOpen, setCollectionModalOpen] = useState(false);
  const [collectionModalMode, setCollectionModalMode] = useState<
    'create' | 'edit'
  >('create');
  const [editingCollection, setEditingCollection] = useState<Collection | null>(
    null
  );

  // Infinite scroll ref
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Bookmarked images state
  const [bookmarkedImages, setBookmarkedImages] = useState<BookmarkedImage[]>(
    []
  );
  const [bookmarkedImagesLoading, setBookmarkedImagesLoading] = useState(false);
  const [bookmarkedImagesError, setBookmarkedImagesError] = useState<
    string | null
  >(null);
  const [bookmarkedImagesLoaded, setBookmarkedImagesLoaded] = useState(false);

  // 数据源中心：用户内容计数（书签 / 笔记 / 图片）
  // 书签数沿用 paginatedItems.pagination.total；笔记 / 图片单独拉总数
  const [notesTotal, setNotesTotal] = useState(0);
  const [imagesTotal, setImagesTotal] = useState(0);

  // Selected image ID for navigation from bookmarks to Images tab
  const [selectedImageId, setSelectedImageId] = useState<string | undefined>(
    undefined
  );

  // Image modal state
  const [viewImageModalOpen, setViewImageModalOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<BookmarkedImage | null>(
    null
  );

  // Add to Knowledge Base dialog state
  const [addToKBDialogOpen, setAddToKBDialogOpen] = useState(false);
  const [addToKBResources, setAddToKBResources] = useState<ResourceToAdd[]>([]);
  const [addToKBSourceType, setAddToKBSourceType] = useState<
    'BOOKMARK' | 'NOTE' | 'URL'
  >('BOOKMARK');

  // Knowledge Graph state
  const [graphData, setGraphData] = useState<{
    nodes: Array<{
      id: string;
      label: string;
      type:
        | 'User'
        | 'Collection'
        | 'Resource'
        | 'Note'
        | 'Author'
        | 'Topic'
        | 'Tag';
      properties: Record<string, unknown>;
    }>;
    edges: Array<{
      source: string;
      target: string;
      type: string;
      weight?: number;
    }>;
  } | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);

  // API hooks
  const collectionsApi = useCollections();

  // AI Office stores
  const aiOfficeStore = useResourceStore();
  const imageSourceStore = useImageSourceStore();

  // Toast state for notifications
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

  // Handle adding a note to AI Office
  const handleAddNoteToOffice = (note: Note) => {
    // Notes can be added as reference material
    // Create a pseudo-resource from the note
    const noteAsResource: Partial<AIOfficeResource> = {
      _id: `note-${note.id}`,
      userId: 'current-user',
      resourceId: note.id,
      resourceType: 'web_page' as const,
      status: 'collected' as const,
      collectedAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        title: note.resource?.title || 'Note',
        description: note.content.slice(0, 200),
        language: 'en',
      } as WebMetadata,
    };

    if (!aiOfficeStore.resources.some((r) => r._id === `note-${note.id}`)) {
      aiOfficeStore.addResource(noteAsResource as AIOfficeResource);
      setToast({
        message: 'Note added to AI Office',
        type: 'success',
      });
    } else {
      setToast({
        message: 'Note already in AI Office',
        type: 'error',
      });
    }
  };

  // Load tags and stats
  const loadTagsAndStats = useCallback(async () => {
    try {
      const [tagsData, statsData] = await Promise.all([
        collectionsApi.getTags(),
        collectionsApi.getStats(),
      ]);
      setTags(tagsData);
      setStats(statsData);
    } catch (err) {
      logger.error('Failed to load tags/stats:', err);
    }
  }, [collectionsApi]);

  // Load paginated items
  const loadItems = useCallback(
    async (page = 1, append = false) => {
      if (page === 1) setLoading(true);
      else setLoadingMore(true);

      try {
        // Determine filter based on activeCollectionId
        let collectionId: string | undefined;
        let status: ReadStatus | undefined;
        let tag: string | undefined;

        if (activeCollectionId) {
          if (activeCollectionId === 'recent') {
            // Recent items - no special filter, just sort by addedAt
          } else if (activeCollectionId === 'reading') {
            status = ReadStatus.READING;
          } else if (activeCollectionId === 'completed') {
            status = ReadStatus.COMPLETED;
          } else if (activeCollectionId.startsWith('tag:')) {
            tag = activeCollectionId.substring(4);
          } else {
            collectionId = activeCollectionId;
          }
        }

        const result = await collectionsApi.getItemsPaginated({
          collectionId,
          page,
          limit: 20,
          status,
          tag,
          search: searchQuery || undefined,
          sortBy,
          sortOrder,
        });

        if (append && paginatedItems) {
          setPaginatedItems({
            items: [...paginatedItems.items, ...result.items],
            pagination: result.pagination,
          });
        } else {
          setPaginatedItems(result);
        }
      } catch (err) {
        logger.error('Failed to load items:', err);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [
      activeCollectionId,
      searchQuery,
      sortBy,
      sortOrder,
      collectionsApi,
      paginatedItems,
    ]
  );

  const loadCollections = useCallback(async () => {
    try {
      const authHeaders = getAuthHeader();
      const response = await fetch(`${config.apiBaseUrl}/api/v1/collections`, {
        headers: authHeaders,
      });
      if (response.ok) {
        const result = await response.json();
        // Handle wrapped response { success: true, data: [...] }
        const data = result?.data ?? result;
        // Deduplicate collections by id to avoid displaying duplicates
        const uniqueCollections = (Array.isArray(data) ? data : []).filter(
          (collection: Collection, index: number, self: Collection[]) =>
            index === self.findIndex((c) => c.id === collection.id)
        );
        setCollections(uniqueCollections);
        // Set default collection ID
        const defaultCollection = uniqueCollections.find(
          (c: Collection) => c.name === '我的收藏'
        );
        if (defaultCollection) {
          setCurrentCollectionId(defaultCollection.id);
        }
        return uniqueCollections;
      }
      return [];
    } catch (err) {
      logger.error('Failed to load collections:', err);
      return [];
    }
  }, []);

  // Load bookmarked images
  const loadBookmarkedImages = useCallback(
    async (force = false) => {
      // 如果已经加载过且没有强制刷新，则跳过
      if (bookmarkedImagesLoaded && !force) {
        return;
      }

      setBookmarkedImagesLoading(true);
      setBookmarkedImagesError(null);
      try {
        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/ai-image/bookmarks`,
          { headers: { ...getAuthHeader() } }
        );
        if (response.ok) {
          const result = await response.json();
          // Handle wrapped response { success: true, data: [...] }
          const data: BookmarkedImage[] = result?.data ?? result;
          setBookmarkedImages(Array.isArray(data) ? data : []);
          setBookmarkedImagesLoaded(true);
        } else if (response.status === 429) {
          // Rate limit - 不设置 loaded，但设置错误信息，避免无限重试
          setBookmarkedImagesError('请求过于频繁，请稍后重试');
          setBookmarkedImagesLoaded(true); // 标记为已加载，避免重试
        } else {
          setBookmarkedImagesError('加载图片失败');
          setBookmarkedImagesLoaded(true);
        }
      } catch (err) {
        logger.error('Failed to load bookmarked images:', err);
        setBookmarkedImagesError('网络错误，请重试');
        setBookmarkedImagesLoaded(true); // 防止无限重试
      } finally {
        setBookmarkedImagesLoading(false);
      }
    },
    [bookmarkedImagesLoaded]
  );

  // Load items when switching to bookmarks subtab
  useEffect(() => {
    if (activeTab === 'data-sources') {
      loadItems(1, false);
    }
  }, [activeTab]);

  // 数据源中心：拉取笔记 + 图片总数（用于 ContentSummaryCard 实数显示）
  useEffect(() => {
    if (activeTab !== 'data-sources') return;

    let cancelled = false;

    // 笔记总数：复用 GET /notes 的 total 字段（take=1 减少传输量）
    const loadNotesTotal = async () => {
      try {
        const resp = await fetch(`${config.apiBaseUrl}/api/v1/notes?take=1`, {
          headers: { ...getAuthHeader() },
        });
        if (!resp.ok) return;
        const payload = (await resp.json()) as {
          total?: number;
          data?: { total?: number };
        };
        const total = payload.total ?? payload.data?.total ?? 0;
        if (!cancelled && typeof total === 'number') {
          setNotesTotal(total);
        }
      } catch (err) {
        logger.error('Failed to load notes total:', err);
      }
    };

    // 图片总数：使用书签图片端点（这是 Library 已暴露给用户的图片集合）
    const loadImagesTotal = async () => {
      try {
        const resp = await fetch(
          `${config.apiBaseUrl}/api/v1/ai-image/bookmarks`,
          { headers: { ...getAuthHeader() } }
        );
        if (!resp.ok) return;
        const payload = (await resp.json()) as unknown[] | { data?: unknown[] };
        const list = Array.isArray(payload)
          ? payload
          : Array.isArray(payload.data)
            ? payload.data
            : [];
        if (!cancelled) {
          setImagesTotal(list.length);
        }
      } catch (err) {
        logger.error('Failed to load images total:', err);
      }
    };

    void loadNotesTotal();
    void loadImagesTotal();

    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  // Reload items when search query changes (with debounce)
  useEffect(() => {
    if (
      activeTab === 'data-sources' &&
      currentDataSourceSubTab === 'bookmarks'
    ) {
      const timeoutId = setTimeout(() => {
        loadItems(1, false);
      }, 300);
      return () => clearTimeout(timeoutId);
    }
  }, [searchQuery, currentDataSourceSubTab]);

  // Load knowledge graph data
  const loadGraphData = useCallback(async () => {
    setGraphLoading(true);
    setGraphError(null);
    try {
      // 构建 API URL，包含用户个性化参数
      const params = new URLSearchParams();
      // 如果选中了特定收藏集，则筛选该收藏集的内容
      if (
        activeCollectionId &&
        !['recent', 'reading', 'completed'].includes(activeCollectionId) &&
        !activeCollectionId.startsWith('tag:')
      ) {
        params.append('collectionId', activeCollectionId);
      }
      const queryString = params.toString();
      const url = `${config.apiUrl}/knowledge-graph/overview${queryString ? `?${queryString}` : ''}`;

      const response = await fetch(url, {
        headers: { ...getAuthHeader() },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch knowledge graph');
      }

      const result = await response.json();
      // Handle wrapped response { success: true, data: {...} }
      const data = result?.data ?? result;
      setGraphData(data);
    } catch (err) {
      logger.error('Error fetching graph:', err);
      setGraphError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setGraphLoading(false);
    }
  }, [activeCollectionId]);

  // Initial load
  useEffect(() => {
    loadCollections();
    loadTagsAndStats();
  }, []);

  // Load graph data when tab changes
  useEffect(() => {
    if (activeTab === 'graph') {
      loadGraphData();
    }
  }, [activeTab, loadGraphData]);

  // Infinite scroll observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          paginatedItems?.pagination.hasMore &&
          !loadingMore
        ) {
          loadItems(paginatedItems.pagination.page + 1, true);
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [paginatedItems, loadingMore]);

  // Collection management handlers
  const handleCreateCollection = () => {
    setCollectionModalMode('create');
    setEditingCollection(null);
    setCollectionModalOpen(true);
  };

  const handleEditCollection = (collection: Collection) => {
    const fullCollection = collections.find((c) => c.id === collection.id);
    if (fullCollection) {
      setCollectionModalMode('edit');
      setEditingCollection(fullCollection);
      setCollectionModalOpen(true);
    }
  };

  const handleDeleteCollection = async (collection: Collection) => {
    if (
      !(await confirm({
        title: `Delete "${collection.name}"?`,
        description: 'All bookmarks in this collection will be removed.',
        type: 'danger',
      }))
    ) {
      return;
    }

    try {
      await collectionsApi.deleteCollection(collection.id);
      setCollections(collections.filter((c) => c.id !== collection.id));
      if (activeCollectionId === collection.id) {
        setActiveCollectionId(null);
      }
    } catch (err) {
      logger.error('Failed to delete collection:', err);
      showToast.error('Failed to delete collection');
    }
  };

  const handleSaveCollection = async (data: {
    name: string;
    description?: string;
    icon?: string;
    color?: string;
    isPublic: boolean;
  }) => {
    if (collectionModalMode === 'create') {
      const newCollection = await collectionsApi.createCollection(data);
      setCollections([...collections, { ...newCollection, items: [] }]);
    } else if (editingCollection) {
      await collectionsApi.updateCollection(editingCollection.id, data);
      setCollections(
        collections.map((c) =>
          c.id === editingCollection.id ? { ...c, ...data } : c
        )
      );
    }
  };

  // Batch operations
  const handleBatchMove = async (targetCollectionId: string) => {
    try {
      await collectionsApi.batchMoveItems(selectedIds, targetCollectionId);
      clearAll();
      setSelectionMode(false);
      loadItems(1, false);
      loadCollections();
    } catch (err) {
      logger.error('Failed to move items:', err);
      showToast.error('Failed to move items');
    }
  };

  const handleBatchDelete = async () => {
    try {
      await collectionsApi.batchDeleteItems(selectedIds);
      clearAll();
      setSelectionMode(false);
      loadItems(1, false);
      loadCollections();
      loadTagsAndStats();
    } catch (err) {
      logger.error('Failed to delete items:', err);
      showToast.error('Failed to delete items');
    }
  };

  const handleBatchUpdateStatus = async (status: ReadStatus) => {
    try {
      await collectionsApi.batchUpdateStatus(selectedIds, status);
      clearAll();
      setSelectionMode(false);
      loadItems(1, false);
      loadTagsAndStats();
    } catch (err) {
      logger.error('Failed to update status:', err);
      showToast.error('Failed to update status');
    }
  };

  const handleBatchAddTags = async (newTags: string[]) => {
    try {
      await collectionsApi.batchUpdateTags(selectedIds, newTags, 'add');
      clearAll();
      setSelectionMode(false);
      loadItems(1, false);
      loadTagsAndStats();
    } catch (err) {
      logger.error('Failed to add tags:', err);
      showToast.error('Failed to add tags');
    }
  };

  // Single item operations
  const handleUpdateItemStatus = async (itemId: string, status: ReadStatus) => {
    try {
      await collectionsApi.updateItem(itemId, { readStatus: status });
      // Update local state
      if (paginatedItems) {
        setPaginatedItems({
          ...paginatedItems,
          items: paginatedItems.items.map((item) =>
            item.id === itemId ? { ...item, readStatus: status } : item
          ),
        });
      }
      loadTagsAndStats();
    } catch (err) {
      logger.error('Failed to update status:', err);
    }
  };

  const handleUpdateItemTags = async (itemId: string, newTags: string[]) => {
    try {
      await collectionsApi.updateItem(itemId, { tags: newTags });
      // Update local state
      if (paginatedItems) {
        setPaginatedItems({
          ...paginatedItems,
          items: paginatedItems.items.map((item) =>
            item.id === itemId ? { ...item, tags: newTags } : item
          ),
        });
      }
      loadTagsAndStats();
    } catch (err) {
      logger.error('Failed to update tags:', err);
    }
  };

  // Handle edit note
  const handleEditNote = (item: CollectionItem) => {
    setSelectedItem(item);
    setEditNoteModalOpen(true);
  };

  // Handle remove from collection
  const handleRemove = (item: CollectionItem) => {
    setSelectedItem(item);
    setRemoveDialogOpen(true);
  };

  // Confirm remove from collection
  const confirmRemove = async () => {
    if (!selectedItem || !currentCollectionId) return;

    try {
      await collectionsApi.removeFromCollection(
        selectedItem.collectionId,
        selectedItem.resourceId
      );
      loadItems(1, false);
      loadCollections();
      loadTagsAndStats();
      setRemoveDialogOpen(false);
      setSelectedItem(null);
    } catch (err) {
      logger.error('Failed to remove:', err);
      showToast.error('Failed to remove from collection');
    }
  };

  // Update note
  const updateNote = async (newNote: string) => {
    if (!selectedItem) return;

    try {
      await collectionsApi.updateItem(selectedItem.id, { note: newNote });
      // Update local state
      if (paginatedItems) {
        setPaginatedItems({
          ...paginatedItems,
          items: paginatedItems.items.map((item) =>
            item.id === selectedItem.id ? { ...item, note: newNote } : item
          ),
        });
      }
      setEditNoteModalOpen(false);
      setSelectedItem(null);
    } catch (err) {
      logger.error('Failed to update note:', err);
      showToast.error('Failed to update note');
    }
  };

  const resolveThumbnailUrl = (thumbnailUrl?: string | null) => {
    if (!thumbnailUrl) return null;
    if (thumbnailUrl.startsWith('http')) return thumbnailUrl;
    return `${config.apiBaseUrl}${thumbnailUrl}`;
  };

  // Handle clicking on bookmarked AI image - navigate to Data Sources tab (images sub-tab)
  const handleBookmarkedImageClick = (imageId: string) => {
    setSelectedImageId(imageId);
    setActiveTab('data-sources');
  };

  // Handle clicking an image in Images tab to view full size
  const handleImageClick = (image: BookmarkedImage) => {
    setSelectedImage(image);
    setViewImageModalOpen(true);
  };

  // Handle removing bookmark from AI image
  const handleRemoveImageBookmark = async (
    imageId: string,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    try {
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/ai-image/${imageId}/bookmark`,
        {
          method: 'DELETE',
          headers: { ...getAuthHeader() },
        }
      );
      if (response.ok) {
        setBookmarkedImages((prev) => prev.filter((img) => img.id !== imageId));
      }
    } catch (err) {
      logger.error('Failed to remove bookmark:', err);
    }
  };

  // 工具函数：根据资源类型获取正确的链接
  // YouTube 视频打开专属 YouTube 页面，其他类型打开 Explore 详情页（带 PDF 阅读器和 AI 助手）
  const getResourceLink = (resource: Resource): string => {
    if (resource.type === 'YOUTUBE' || resource.type === 'YOUTUBE_VIDEO') {
      // 从 sourceUrl 提取 YouTube videoId
      const url = resource.sourceUrl || '';
      let videoId = '';
      try {
        const urlObj = new URL(url);
        if (urlObj.hostname.includes('youtu.be')) {
          videoId = urlObj.pathname.slice(1);
        } else if (urlObj.hostname.includes('youtube.com')) {
          videoId =
            urlObj.searchParams.get('v') ||
            urlObj.pathname.split('/').pop() ||
            '';
        }
      } catch {
        // URL 解析失败，尝试正则匹配
        const match = url.match(
          /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([a-zA-Z0-9_-]+)/
        );
        if (match) videoId = match[1];
      }
      return videoId
        ? `/explore/youtube?videoId=${videoId}`
        : `/explore?id=${resource.id}`;
    }
    // 所有非 YouTube 资源都跳转到 Explore 页面，和从 Explore 列表点击进入体验一致
    return `/explore?id=${resource.id}`;
  };

  // Type badge config
  const typeConfig: Record<
    string,
    {
      bg: string;
      text: string;
      borderColor: string;
      icon: (className: string) => React.ReactNode;
    }
  > = {
    PAPER: {
      bg: 'bg-blue-50',
      text: 'text-blue-700',
      borderColor: 'border-blue-200',
      icon: (className) => (
        <svg
          className={className}
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
      ),
    },
    BLOG: {
      bg: 'bg-purple-50',
      text: 'text-purple-700',
      borderColor: 'border-purple-200',
      icon: (className) => (
        <svg
          className={className}
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
      ),
    },
    NEWS: {
      bg: 'bg-orange-50',
      text: 'text-orange-700',
      borderColor: 'border-orange-200',
      icon: (className) => (
        <svg
          className={className}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v4m2-4a2 2 0 012 2v10a2 2 0 01-2 2"
          />
        </svg>
      ),
    },
    YOUTUBE: {
      bg: 'bg-red-50',
      text: 'text-red-700',
      borderColor: 'border-red-200',
      icon: (className) => (
        <svg
          className={className}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
    },
    YOUTUBE_VIDEO: {
      bg: 'bg-red-50',
      text: 'text-red-700',
      borderColor: 'border-red-200',
      icon: (className) => (
        <svg
          className={className}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
    },
    REPORT: {
      bg: 'bg-green-50',
      text: 'text-green-700',
      borderColor: 'border-green-200',
      icon: (className) => (
        <svg
          className={className}
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
      ),
    },
    PROJECT: {
      bg: 'bg-indigo-50',
      text: 'text-indigo-700',
      borderColor: 'border-indigo-200',
      icon: (className) => (
        <svg
          className={className}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
          />
        </svg>
      ),
    },
  };

  // Images Tab Content Component
  const ImagesTabContent = () => {
    // 仅在组件首次挂载时加载一次
    useEffect(() => {
      loadBookmarkedImages();
    }, []); // 空依赖数组，只运行一次

    if (bookmarkedImagesLoading) {
      return <LoadingState size="lg" text="" />;
    }

    // 显示错误状态
    if (bookmarkedImagesError) {
      return (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
            <svg
              className="h-8 w-8 text-red-500"
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
          </div>
          <h3 className="mb-2 text-lg font-semibold text-gray-900">加载失败</h3>
          <p className="mb-6 text-center text-sm text-gray-500">
            {bookmarkedImagesError}
          </p>
          <button
            onClick={() => {
              setBookmarkedImagesLoaded(false);
              setBookmarkedImagesError(null);
              loadBookmarkedImages(true);
            }}
            className="rounded-lg bg-pink-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pink-700"
          >
            重试
          </button>
        </div>
      );
    }

    if (!bookmarkedImages.length) {
      return (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
            <Image className="h-8 w-8 text-gray-400" />
          </div>
          <h3 className="mb-2 text-lg font-semibold text-gray-900">暂无图片</h3>
          <p className="mb-6 text-center text-sm text-gray-500">
            在 AI Image 页面收藏图片后，会显示在这里
          </p>
          <Link
            href="/ai-image"
            className="rounded-lg bg-pink-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pink-700"
          >
            前往 AI Image
          </Link>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {/* 操作栏 */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-500">
            {bookmarkedImages.length} 张图片
          </div>
          <button
            onClick={() => {
              const resources: ResourceToAdd[] = bookmarkedImages.map(
                (img) => ({
                  id: img.id,
                  name: img.prompt || `Image ${img.id.slice(0, 8)}`,
                  type: 'url' as const, // Images will be handled as URLs
                  url: img.imageUrl,
                })
              );
              setAddToKBResources(resources);
              setAddToKBSourceType('URL');
              setAddToKBDialogOpen(true);
            }}
            className="flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-violet-700"
          >
            <Database className="h-4 w-4" />
            加入知识库
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {bookmarkedImages.map((image) => (
            <div
              key={image.id}
              className="group relative cursor-pointer overflow-hidden rounded-lg border border-gray-200 bg-white transition-all hover:shadow-lg"
              onClick={() => handleImageClick(image)}
            >
              {/* 图片 */}
              <div className="aspect-square overflow-hidden bg-gray-100">
                <img
                  src={image.imageUrl}
                  alt={image.prompt}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
              </div>

              {/* 悬浮信息 */}
              <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/60 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
                <p className="line-clamp-2 text-xs text-white">
                  {image.enhancedPrompt || image.prompt}
                </p>
              </div>

              {/* 删除按钮 */}
              <button
                onClick={(e) => handleRemoveImageBookmark(image.id, e)}
                className="absolute right-2 top-2 rounded-lg bg-white p-1.5 opacity-0 shadow-md transition-all hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                title="删除"
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
              </button>

              {/* 底部信息 */}
              <div className="border-t border-gray-100 bg-white px-2 py-1.5">
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>
                    {image.width}×{image.height}
                  </span>
                  <span>
                    <ClientDate date={image.createdAt} format="date" />
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Resource Card —— 用 canonical AssetCard（替代原自写卡片）
  const ResourceCard = ({ item }: { item: CollectionItem }) => {
    const { resource } = item;
    const cfg = typeConfig[resource.type];
    const inSel = selectionMode;
    const itemSelected = isSelected(item.id);

    // 书签卡仅保留：编辑 + 删除（权限）+ 多选（批量入口）。查看/加Office/加Studio 已移除（2026-05-21）。
    const extraActions: AssetCardAction[] = inSel
      ? []
      : [
          {
            key: 'select',
            title: '多选',
            icon: <CheckCircle2 className="h-4 w-4" />,
            onClick: () => {
              setSelectionMode(true);
              toggleSelect(item.id);
            },
          },
        ];

    const card = (
      <AssetCard
        className={`cursor-pointer ${
          itemSelected ? 'border-violet-500 ring-2 ring-violet-200' : ''
        }`}
        title={resource.title}
        description={resource.abstract}
        badges={[
          {
            key: 'type',
            label: resource.type.replace('_', ' '),
            icon: cfg?.icon ? cfg.icon('h-3 w-3') : undefined,
            className: cfg ? `${cfg.text} bg-gray-100` : undefined,
          },
        ]}
        isOwner={!inSel}
        onEdit={inSel ? undefined : () => handleEditNote(item)}
        onDelete={inSel ? undefined : () => handleRemove(item)}
        extraActions={extraActions}
        onClick={inSel ? () => toggleSelect(item.id) : undefined}
        stats={
          resource.upvoteCount && resource.upvoteCount > 0
            ? [
                {
                  key: 'upvotes',
                  icon: <ThumbsUp className="h-3.5 w-3.5" />,
                  text: resource.upvoteCount,
                },
              ]
            : []
        }
        timestamp={resource.publishedAt}
        customSection={
          // 卡片被包在 <Link> 里：customSection 内的状态徽章/标签/展开等交互件
          // 必须挡住锚点默认跳转，否则"点任意按钮都直接跳到源"。各子元素自身 onClick
          // 仍先于此触发；preventDefault 不影响 select 展开与 onChange。
          <div
            className="space-y-2"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <ReadStatusBadge
                status={item.readStatus}
                onChange={(status) => handleUpdateItemStatus(item.id, status)}
                showLabel={false}
              />
              {item.tags && item.tags.length > 0 && (
                <TagList tags={item.tags} maxVisible={2} size="sm" />
              )}
            </div>
            {item.note && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50/60 px-2.5 py-1.5">
                <StickyNote className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
                <p className="line-clamp-2 text-xs italic text-amber-900">
                  {item.note}
                </p>
              </div>
            )}
          </div>
        }
      />
    );

    return (
      <div className="relative h-full">
        {inSel && (
          <div className="absolute left-3 top-3 z-20">
            <input
              type="checkbox"
              checked={itemSelected}
              onChange={() => toggleSelect(item.id)}
              className="h-5 w-5 cursor-pointer rounded border-gray-300 text-violet-600 focus:ring-violet-500"
            />
          </div>
        )}
        {inSel ? (
          card
        ) : (
          <Link href={getResourceLink(resource)} className="block h-full">
            {card}
          </Link>
        )}
      </div>
    );
  };

  // Library 主 Tab 配置（与 LibraryTabs 共用）
  // ★ v1.5.3: Wiki 升级为 Library 主形态，置首位且默认 active（详见 llm-wiki §7.1）
  const libraryTabs: LibraryTabItem[] = [
    {
      id: 'wiki',
      label: t('library.wiki.title') || 'Wiki',
      icon: BookOpen,
    },
    {
      id: 'personal-kb',
      label: t('knowledgeBase.personalKb'),
      icon: User,
    },
    {
      id: 'team-kb',
      label: t('knowledgeBase.teamKb'),
      icon: Users,
    },
    {
      id: 'data-sources',
      label: t('dataSources.title'),
      icon: HardDrive,
    },
  ];

  const inWikiDetail = activeTab === 'wiki' && Boolean(wikiKbParam);

  return (
    <AppShell>
      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-gray-50">
        {/* Unified Header: 标题 + 副标题 — hidden in wiki detail */}
        {!inWikiDetail && (
          <LibraryHeader
            title={t('library.title') || '知识库'}
            subtitle={t('library.subtitle') || '管理你的资源、笔记与团队知识'}
          />
        )}

        {/* Unified Tabs: 中性灰底 + 紫色下划线 indicator — hidden in wiki detail.
            学习 Agent 市场范式：Tab 在上、搜索在下。 */}
        {!inWikiDetail && (
          <LibraryTabs
            tabs={libraryTabs}
            activeTab={activeTab}
            onChange={(id) =>
              setActiveTab(
                id as 'wiki' | 'personal-kb' | 'team-kb' | 'data-sources'
              )
            }
          />
        )}

        {/* Search bar — 放在 Tab 下方（数据源 tab 有自己的子导航/内容，不挂全局搜索）。 */}
        {!inWikiDetail && activeTab !== 'data-sources' && (
          <div className="px-8 pt-4">
            <LibrarySearchBar
              placeholder={t('library.search.resources')}
              value={searchQuery}
              onChange={setSearchQuery}
            />
          </div>
        )}

        {/* Main content area — wiki detail owns its own padding via subheader */}
        <div className={inWikiDetail ? '' : 'px-8 py-6'}>
          {/* ★ v1.5.3 Wiki Tab (主形态) — Library 默认 tab */}
          {activeTab === 'wiki' && <WikiTab userHash={getUserHash()} />}

          {/* Personal Knowledge Base Tab */}
          {activeTab === 'personal-kb' && (
            <PersonalKnowledgeBaseTab searchQuery={searchQuery} />
          )}

          {/* Team Knowledge Base Tab */}
          {activeTab === 'team-kb' && (
            <TeamKnowledgeBaseTab searchQuery={searchQuery} />
          )}

          {/* Data Sources Tab - 包含子TAB：书签、笔记、图片、Notion、Google Drive */}
          {activeTab === 'data-sources' && (
            <DataSourcesTab
              initialSubTab={initialDataSourceSubTab}
              onSubTabChange={(subTab) => setCurrentDataSourceSubTab(subTab)}
              contentCounts={{
                bookmarks: paginatedItems?.pagination?.total ?? 0,
                notes: notesTotal,
                images: imagesTotal,
              }}
              renderOrganizePanel={(subTab) => (
                <AIOrganizePanel
                  collections={collections.map((c) => ({
                    id: c.id,
                    name: c.name,
                    itemCount: c.items?.length || 0,
                  }))}
                  onRefresh={() => {
                    void loadItems();
                  }}
                  activeTab={subTab}
                />
              )}
              renderBookmarks={() => {
                // 书签列表视图
                if (loading && !paginatedItems) {
                  return <LoadingState size="lg" text="" />;
                }

                if (!paginatedItems?.items?.length) {
                  return (
                    <EmptyState
                      icon={<Bookmark className="h-12 w-12" />}
                      title="暂无书签"
                      description="在 Explore 页面收藏资源后，会显示在这里"
                      action={
                        <Link
                          href="/explore"
                          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
                        >
                          前往探索
                        </Link>
                      }
                    />
                  );
                }

                return (
                  <div className="space-y-4">
                    {/* 操作栏 */}
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-gray-500">
                        {paginatedItems.pagination.total} 个书签
                      </div>
                      <button
                        onClick={() => {
                          const resources: ResourceToAdd[] =
                            paginatedItems.items.map((item) => ({
                              id: item.id,
                              name: item.resource.title,
                              type: 'bookmark' as const,
                              url: item.resource.sourceUrl,
                            }));
                          setAddToKBResources(resources);
                          setAddToKBSourceType('BOOKMARK');
                          setAddToKBDialogOpen(true);
                        }}
                        className="flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-violet-700"
                      >
                        <Database className="h-4 w-4" />
                        加入知识库
                      </button>
                    </div>

                    {/* 资源网格 */}
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {paginatedItems.items.map((item) => (
                        <ResourceCard key={item.id} item={item} />
                      ))}
                    </div>

                    {/* 加载更多指示器 */}
                    {paginatedItems.pagination.hasMore && (
                      <div
                        ref={loadMoreRef}
                        className="flex items-center justify-center py-8"
                      >
                        {loadingMore ? (
                          <LoadingInline text="加载更多..." />
                        ) : (
                          <div className="text-sm text-gray-400">
                            滚动加载更多
                          </div>
                        )}
                      </div>
                    )}

                    {/* 总计信息 */}
                    {paginatedItems.pagination.total > 0 && (
                      <div className="text-center text-sm text-gray-500">
                        显示 {paginatedItems.items.length} /{' '}
                        {paginatedItems.pagination.total} 个书签
                      </div>
                    )}
                  </div>
                );
              }}
              renderNotes={() => (
                <NotesList
                  showActions
                  onAddToOffice={handleAddNoteToOffice}
                  onAddToKnowledgeBase={(notes) => {
                    const resources: ResourceToAdd[] = notes.map((note) => ({
                      id: note.id,
                      name: note.name,
                      type: 'note' as const,
                    }));
                    setAddToKBResources(resources);
                    setAddToKBSourceType('NOTE');
                    setAddToKBDialogOpen(true);
                  }}
                />
              )}
              renderImages={() => <ImagesTabContent />}
              renderNotion={() => <NotionTabContent />}
              renderGoogleDrive={() => <GoogleDriveTabContent />}
            />
          )}

          {/* Knowledge Graph View */}
          {activeTab === 'graph' && (
            <div className="rounded-lg border border-gray-200 bg-white">
              {/* Graph Header */}
              <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-gray-900">
                    Knowledge Graph
                  </h3>
                  {activeCollectionId &&
                    !['recent', 'reading', 'completed'].includes(
                      activeCollectionId
                    ) &&
                    !activeCollectionId.startsWith('tag:') && (
                      <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700">
                        Filtered by Collection
                      </span>
                    )}
                  {graphData && (
                    <span className="text-xs text-gray-500">
                      {graphData.nodes.length} nodes · {graphData.edges.length}{' '}
                      edges
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={loadGraphData}
                    disabled={graphLoading}
                    className="flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-all hover:bg-gray-50 disabled:opacity-50"
                  >
                    {graphLoading ? (
                      <>
                        <svg
                          className="h-3 w-3 animate-spin"
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
                        Loading...
                      </>
                    ) : (
                      <>
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
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                          />
                        </svg>
                        Refresh
                      </>
                    )}
                  </button>
                  <Link
                    href="/library/knowledge-graph"
                    className="flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-all hover:bg-gray-50"
                    title="Open in full screen"
                  >
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
                        d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                      />
                    </svg>
                    Full Screen
                  </Link>
                </div>
              </div>

              {/* Graph Content */}
              <div className="h-[600px]">
                {graphLoading ? (
                  <GraphLoadingSkeleton />
                ) : graphError ? (
                  <div className="flex h-full items-center justify-center">
                    <div className="text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                        <svg
                          className="h-6 w-6 text-red-500"
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
                      </div>
                      <p className="mt-3 text-sm text-gray-600">{graphError}</p>
                      <button
                        onClick={loadGraphData}
                        className="mt-3 rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600"
                      >
                        Retry
                      </button>
                    </div>
                  </div>
                ) : graphData && graphData.nodes.length > 0 ? (
                  <KnowledgeGraphView
                    nodes={graphData.nodes}
                    edges={graphData.edges}
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 p-8">
                    <div className="text-center">
                      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-purple-100 to-blue-100">
                        <svg
                          className="h-8 w-8 text-purple-500"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                          />
                        </svg>
                      </div>
                      <h3 className="mt-4 text-lg font-semibold text-gray-900">
                        No Graph Data
                      </h3>
                      <p className="mt-2 max-w-sm text-sm text-gray-600">
                        {activeCollectionId
                          ? 'Add resources to this collection to visualize connections.'
                          : 'Add some resources to your library to see their relationships.'}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Batch Action Bar */}
      <BatchActionBar
        selectedCount={selectedCount}
        selectedIds={selectedIds}
        collections={collections}
        currentCollectionId={activeCollectionId || undefined}
        onMove={handleBatchMove}
        onDelete={handleBatchDelete}
        onUpdateStatus={handleBatchUpdateStatus}
        onAddTags={handleBatchAddTags}
        onClearSelection={() => {
          clearAll();
          setSelectionMode(false);
        }}
      />

      {/* Edit Note Modal */}
      <Modal
        open={editNoteModalOpen && selectedItem !== null}
        onClose={() => setEditNoteModalOpen(false)}
        title="Edit Bookmark Note"
        size="md"
        footer={
          <>
            <button
              type="button"
              onClick={() => setEditNoteModalOpen(false)}
              className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="edit-note-form"
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700"
            >
              Save Note
            </button>
          </>
        }
      >
        {selectedItem && (
          <>
            {/* Resource Info - Read-only */}
            <div className="mb-4 rounded-lg bg-gray-50 p-3">
              <p className="text-sm font-medium text-gray-700">
                {selectedItem.resource.title}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {selectedItem.resource.type.replace('_', ' ')} •{' '}
                <ClientDate
                  date={selectedItem.resource.publishedAt}
                  format="date"
                  locale="en-US"
                />
              </p>
            </div>

            <form
              id="edit-note-form"
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const newNote = formData.get('note') as string;
                void updateNote(newNote);
              }}
              className="space-y-4"
            >
              <div>
                <label
                  htmlFor="note"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  Your Personal Note
                </label>
                <textarea
                  id="note"
                  name="note"
                  rows={6}
                  defaultValue={selectedItem.note || ''}
                  placeholder="Add your thoughts, insights, or reminders about this resource..."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  This note is private and only visible to you.
                </p>
              </div>
            </form>
          </>
        )}
      </Modal>

      {/* Remove from Collection Confirmation Dialog */}
      <ConfirmDialog
        open={removeDialogOpen && selectedItem !== null}
        onClose={() => setRemoveDialogOpen(false)}
        onConfirm={confirmRemove}
        title="Remove from Collection"
        description={
          selectedItem
            ? `This will remove "${selectedItem.resource.title}" from your collection. The resource itself will not be deleted.`
            : 'This will remove the bookmark from your collection. The resource itself will not be deleted.'
        }
        type="warning"
        confirmText="Remove"
        cancelText="Cancel"
      />

      {/* Collection Create/Edit Modal */}
      <CollectionModal
        isOpen={collectionModalOpen}
        onClose={() => setCollectionModalOpen(false)}
        onSave={handleSaveCollection}
        collection={editingCollection}
        mode={collectionModalMode}
      />

      {/* Image Viewing Modal */}
      {viewImageModalOpen && selectedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => setViewImageModalOpen(false)}
        >
          <div
            className="relative max-h-[90vh] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setViewImageModalOpen(false)}
              className="absolute -right-4 -top-4 z-10 rounded-full bg-white p-2 text-gray-600 shadow-lg transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              <svg
                className="h-6 w-6"
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

            {/* Image */}
            <img
              src={selectedImage.imageUrl}
              alt={selectedImage.prompt}
              className="max-h-[80vh] max-w-full rounded-lg object-contain"
            />

            {/* Image info */}
            <div className="mt-4 rounded-lg bg-white/10 p-4 backdrop-blur-sm">
              <p className="text-sm text-white/90">
                {selectedImage.enhancedPrompt || selectedImage.prompt}
              </p>
              <div className="mt-2 flex items-center justify-between text-xs text-white/60">
                <span>
                  {selectedImage.width} × {selectedImage.height}
                </span>
                <span>
                  <ClientDate date={selectedImage.createdAt} format="date" />
                </span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="mt-3 flex justify-center gap-3">
              <a
                href={selectedImage.imageUrl}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
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
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                Download
              </a>
              <button
                onClick={(e) => {
                  handleRemoveImageBookmark(selectedImage.id, e);
                  setViewImageModalOpen(false);
                }}
                className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
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
                Remove from Library
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 animate-fade-in">
          <div
            className={`rounded-lg px-4 py-3 shadow-lg ${
              toast.type === 'success'
                ? 'bg-green-600 text-white'
                : 'bg-red-600 text-white'
            }`}
          >
            <div className="flex items-center gap-2">
              {toast.type === 'success' ? (
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
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              ) : (
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
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              )}
              <span className="text-sm font-medium">{toast.message}</span>
            </div>
          </div>
        </div>
      )}

      {/* Add to Knowledge Base Dialog */}
      {addToKBDialogOpen && (
        <AddToKnowledgeBaseDialog
          resources={addToKBResources}
          sourceType={addToKBSourceType}
          onClose={() => setAddToKBDialogOpen(false)}
          onSuccess={(kbId, count) => {
            setToast({
              message: `已添加 ${count} 个资源到知识库`,
              type: 'success',
            });
          }}
        />
      )}
    </AppShell>
  );
}

export default function LibraryPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-gray-50">
          <LoadingState size="lg" text="Loading..." />
        </div>
      }
    >
      <LibraryPageContent />
    </Suspense>
  );
}
