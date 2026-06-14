'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n';
import {
  FileText,
  Plus,
  RefreshCw,
  Search,
  Filter,
  Eye,
  Edit3,
  Trash2,
  Send,
  Clock,
  CheckCircle,
  XCircle,
  Link,
  Sparkles,
  ArrowLeft,
  Globe,
  Loader2,
  Database,
  SlidersHorizontal,
} from 'lucide-react';
import {
  useSocialContents,
  useSocialPublish,
  useSocialConnections,
  SocialContent,
  SocialContentStatus,
  SocialPlatformConnection,
} from '@/hooks/domain/useAISocial';
import {
  AdvancedFilters,
  AdvancedFilterValues,
} from '../filters/AdvancedFilters';
import {
  useSocialContentsSWR,
  useSocialConnectionsSWR,
} from '@/hooks/domain/useSocialSWR';
import { confirm, toast } from '@/stores';
import { ContentTableSkeleton } from '../skeletons';
import { Tooltip } from '@/components/ui/feedback/Tooltip';
import { BatchActionBar } from '../filters/BatchActionBar';
import { motion } from 'framer-motion';
import { FadeIn } from '@/components/ui/animations';
import { Modal } from '@/components/ui/dialogs/Modal';
import { ClientDate } from '@/components/common/ClientDate';
import { TruncatedCell } from '@/components/common/tables';

// Types matching backend
type ContentStatus = SocialContentStatus;
type ContentType = 'WECHAT_ARTICLE' | 'XIAOHONGSHU_NOTE';
type SourceType =
  | 'MANUAL'
  | 'EXTERNAL_URL'
  | 'AI_EXPLORE'
  | 'AI_RESEARCH'
  | 'AI_OFFICE'
  | 'AI_WRITING'
  | 'AI_TOPIC_INSIGHTS';

const STATUS_CONFIG: Record<
  ContentStatus,
  { icon: typeof CheckCircle; color: string; bgColor: string }
> = {
  DRAFT: { icon: Edit3, color: 'text-gray-600', bgColor: 'bg-gray-100' },
  PENDING: { icon: Clock, color: 'text-amber-600', bgColor: 'bg-amber-100' },
  SCHEDULED: { icon: Clock, color: 'text-blue-600', bgColor: 'bg-blue-100' },
  PUBLISHING: {
    icon: RefreshCw,
    color: 'text-purple-600',
    bgColor: 'bg-purple-100',
  },
  PUBLISHED: {
    icon: CheckCircle,
    color: 'text-green-600',
    bgColor: 'bg-green-100',
  },
  FAILED: { icon: XCircle, color: 'text-red-600', bgColor: 'bg-red-100' },
};

interface ContentsTabProps {
  /**
   * PR-4 UI 候选 A：父组件传入此 callback 时，row click + 飞机按钮触发
   * onSelectContent 打开 ContentDetailDrawer，**不再**走旧的内置 publish modal。
   * 不传时保持旧行为（兼容遗留 import 点）。
   */
  onSelectContent?: (content: SocialContent) => void;
}

export default function ContentsTab({
  onSelectContent,
}: ContentsTabProps = {}) {
  const { t } = useTranslation();
  const router = useRouter();

  // Local state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ContentStatus | 'ALL'>(
    'ALL'
  );
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilterValues>({
    dateRange: { from: null, to: null },
    contentType: 'ALL',
    sourceType: 'ALL',
    reviewStatus: 'ALL',
    hasConnection: null,
  });

  // SWR data fetching with caching
  const {
    contents: swrContents,
    total: swrTotal,
    isLoading: swrLoading,
    isValidating: swrValidating,
    refresh: swrRefresh,
    error: swrError,
  } = useSocialContentsSWR(
    statusFilter === 'ALL' ? {} : { status: statusFilter }
  );

  const {
    connections: swrConnections,
    isLoading: connectionsLoading,
    isValidating: connectionsValidating,
  } = useSocialConnectionsSWR();

  // Legacy hooks for mutations
  const { removeContent } = useSocialContents();
  const { publish, loading: publishing } = useSocialPublish();

  // Use SWR data as primary source
  const contents = swrContents;
  const total = swrTotal;
  const loading = swrLoading;
  const error = swrError?.message || null;
  const connections = swrConnections;
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedSource, setSelectedSource] = useState<SourceType | null>(null);
  const [modalStep, setModalStep] = useState<1 | 2>(1);
  const [externalUrl, setExternalUrl] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);

  // Batch operation state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(
    null
  );
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);
  const [isBatchPublishing, setIsBatchPublishing] = useState(false);

  // Publish modal state
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [contentToPublish, setContentToPublish] =
    useState<SocialContent | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('');

  // SWR handles data loading automatically - no need for useEffect

  function resetModal() {
    setShowCreateModal(false);
    setSelectedSource(null);
    setModalStep(1);
    setExternalUrl('');
    setIsProcessing(false);
  }

  function cancelPublishModal() {
    setShowPublishModal(false);
    setContentToPublish(null);
    setSelectedConnectionId('');
  }

  const handleContinue = () => {
    if (!selectedSource) return;

    if (selectedSource === 'EXTERNAL_URL') {
      setModalStep(2);
    } else {
      router.push(`/ai-social/create?source=${selectedSource}`);
      resetModal();
    }
  };

  const handleProcessUrl = async () => {
    if (!externalUrl.trim()) return;

    setIsProcessing(true);
    router.push(
      `/ai-social/create?source=EXTERNAL_URL&url=${encodeURIComponent(externalUrl)}`
    );
    resetModal();
  };

  const handleRefresh = async () => {
    await swrRefresh();
    toast.success(t('common.refresh'));
  };

  const handleDelete = async (contentId: string) => {
    if (
      !(await confirm({ title: t('aiSocial.confirm.delete'), type: 'danger' }))
    )
      return;

    setDeletingId(contentId);
    const success = await removeContent(contentId);
    setDeletingId(null);

    if (success) {
      toast.success(t('aiSocial.toast.deleted'));
    } else {
      toast.error(error || t('common.error'));
    }
  };

  const handlePublish = (content: SocialContent) => {
    // PR-4 UI 候选 A：父组件传 onSelectContent 时，打开统一的 ContentDetailDrawer
    // 替代旧的 publish modal（双轨发布的入口之一）。drawer 内含发布表单 + 进度时间线
    if (onSelectContent) {
      onSelectContent(content);
      return;
    }

    // 兼容旧调用方（无 onSelectContent 传入）：保留原 publish modal 流程
    // If content already has a connectionId, publish directly
    if (content.connectionId) {
      confirmPublish(content.id, content.connectionId);
      return;
    }

    // Filter connections by content type
    const compatibleConnections = connections.filter((conn) => {
      if (content.contentType === 'WECHAT_ARTICLE') {
        return conn.platformType === 'WECHAT_MP';
      }
      if (content.contentType === 'XIAOHONGSHU_NOTE') {
        return conn.platformType === 'XIAOHONGSHU';
      }
      return true;
    });

    // If no compatible connections, show error
    if (compatibleConnections.length === 0) {
      toast.error(t('aiSocial.publish.noConnections'));
      return;
    }

    // If only one compatible connection, use it directly
    if (compatibleConnections.length === 1) {
      confirmPublish(content.id, compatibleConnections[0].id);
      return;
    }

    // Multiple connections - show modal to select
    setContentToPublish(content);
    setSelectedConnectionId('');
    setShowPublishModal(true);
  };

  const confirmPublish = async (contentId: string, connectionId: string) => {
    setPublishingId(contentId);
    setShowPublishModal(false);
    setContentToPublish(null);

    const result = await publish(contentId, connectionId);
    setPublishingId(null);

    if (result.success) {
      toast.success(t('aiSocial.toast.published'));
      swrRefresh(); // 使用 SWR 刷新内容列表
    } else {
      toast.error(result.errorMessage || t('common.error'));
    }
  };

  const getStatusBadge = (
    status: ContentStatus,
    errorMessage?: string | null
  ) => {
    const config = STATUS_CONFIG[status];
    const Icon = config.icon;
    const badge = (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${config.bgColor} ${config.color} ${status === 'FAILED' && errorMessage ? 'cursor-pointer' : ''}`}
      >
        <Icon
          className={`h-3 w-3 ${status === 'PUBLISHING' ? 'animate-spin' : ''}`}
        />
        {t(`aiSocial.status.${status.toLowerCase()}`)}
      </span>
    );

    // Show error message in tooltip for FAILED status
    if (status === 'FAILED' && errorMessage) {
      return <Tooltip content={errorMessage}>{badge}</Tooltip>;
    }

    return badge;
  };

  // Handle advanced filter changes with useCallback
  const handleAdvancedFiltersChange = useCallback(
    (newFilters: AdvancedFilterValues) => {
      setAdvancedFilters(newFilters);
    },
    []
  );

  // Filter contents by search query and advanced filters
  const filteredContents = useMemo(() => {
    return contents.filter((content) => {
      // Text search
      const matchesSearch = content.title
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;

      // Advanced filters
      // Date range filter
      if (advancedFilters.dateRange.from || advancedFilters.dateRange.to) {
        const contentDate = new Date(content.updatedAt).getTime();
        if (advancedFilters.dateRange.from) {
          const fromDate = new Date(advancedFilters.dateRange.from).getTime();
          if (contentDate < fromDate) return false;
        }
        if (advancedFilters.dateRange.to) {
          const toDate = new Date(advancedFilters.dateRange.to).getTime();
          // Add 1 day to include the end date fully
          if (contentDate > toDate + 86400000) return false;
        }
      }

      // Content type filter
      if (
        advancedFilters.contentType !== 'ALL' &&
        content.contentType !== advancedFilters.contentType
      ) {
        return false;
      }

      // Source type filter
      if (
        advancedFilters.sourceType !== 'ALL' &&
        content.sourceType !== advancedFilters.sourceType
      ) {
        return false;
      }

      // Review status filter
      if (
        advancedFilters.reviewStatus !== 'ALL' &&
        content.reviewStatus !== advancedFilters.reviewStatus
      ) {
        return false;
      }

      // Connection filter
      if (advancedFilters.hasConnection !== null) {
        const hasConn = !!content.connectionId;
        if (advancedFilters.hasConnection !== hasConn) return false;
      }

      return true;
    });
  }, [contents, searchQuery, advancedFilters]);

  // Batch operation handlers
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allIds = new Set(filteredContents.map((c) => c.id));
      setSelectedIds(allIds);
    } else {
      setSelectedIds(new Set());
    }
    setLastSelectedIndex(null);
  };

  const handleSelectOne = (
    contentId: string,
    index: number,
    shiftKey: boolean
  ) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);

      // Shift+Click for range selection
      if (shiftKey && lastSelectedIndex !== null) {
        const start = Math.min(lastSelectedIndex, index);
        const end = Math.max(lastSelectedIndex, index);
        for (let i = start; i <= end; i++) {
          if (filteredContents[i]) {
            newSet.add(filteredContents[i].id);
          }
        }
      } else {
        // Toggle single selection
        if (newSet.has(contentId)) {
          newSet.delete(contentId);
        } else {
          newSet.add(contentId);
        }
      }

      return newSet;
    });

    setLastSelectedIndex(index);
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
    setLastSelectedIndex(null);
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;

    const confirmMessage = t('aiSocial.confirm.batchDelete', {
      count: selectedIds.size,
    });

    if (!(await confirm({ title: confirmMessage, type: 'danger' }))) return;

    setIsBatchDeleting(true);

    const idsToDelete = Array.from(selectedIds);
    let successCount = 0;
    let failCount = 0;

    for (const id of idsToDelete) {
      try {
        const success = await removeContent(id);
        if (success) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (err) {
        failCount++;
      }
    }

    setIsBatchDeleting(false);
    setSelectedIds(new Set());
    setLastSelectedIndex(null);

    if (failCount === 0) {
      toast.success(
        t('aiSocial.toast.batchDeleteSuccess', { count: successCount })
      );
    } else {
      toast.error(
        t('aiSocial.toast.batchDeletePartial', {
          success: successCount,
          fail: failCount,
        })
      );
    }

    await swrRefresh();
  };

  const handleBatchPublish = async () => {
    if (selectedIds.size === 0) return;

    // Check if all selected items are DRAFT or FAILED
    const selectedContents = filteredContents.filter((c) =>
      selectedIds.has(c.id)
    );
    const invalidContents = selectedContents.filter(
      (c) => c.status !== 'DRAFT' && c.status !== 'FAILED'
    );

    if (invalidContents.length > 0) {
      toast.error(t('aiSocial.toast.batchPublishInvalid'));
      return;
    }

    const confirmMessage = t('aiSocial.confirm.batchPublish', {
      count: selectedIds.size,
    });

    if (!(await confirm({ title: confirmMessage, type: 'danger' }))) return;

    setIsBatchPublishing(true);

    const idsToPublish = Array.from(selectedIds);
    let successCount = 0;
    let failCount = 0;

    for (const id of idsToPublish) {
      try {
        const content = filteredContents.find((c) => c.id === id);
        if (!content) continue;

        const connectionId = content.connectionId || connections[0]?.id;
        if (!connectionId) {
          failCount++;
          continue;
        }

        const result = await publish(id, connectionId);
        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (err) {
        failCount++;
      }
    }

    setIsBatchPublishing(false);
    setSelectedIds(new Set());
    setLastSelectedIndex(null);

    if (failCount === 0) {
      toast.success(
        t('aiSocial.toast.batchPublishSuccess', { count: successCount })
      );
    } else {
      toast.error(
        t('aiSocial.toast.batchPublishPartial', {
          success: successCount,
          fail: failCount,
        })
      );
    }

    await swrRefresh();
  };

  // Check if batch publish should be available
  const canBatchPublish =
    selectedIds.size > 0 &&
    filteredContents
      .filter((c) => selectedIds.has(c.id))
      .every((c) => c.status === 'DRAFT' || c.status === 'FAILED');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {t('aiSocial.contents.title')}
          </h2>
          <div className="flex items-center gap-2">
            <p className="text-sm text-gray-500">
              {t('aiSocial.contents.description')}
            </p>
            {!loading && swrValidating && (
              <div className="flex items-center gap-1 text-xs text-blue-600">
                <Database className="h-3 w-3 animate-pulse" />
                <span>Refreshing...</span>
              </div>
            )}
            {!loading && !swrValidating && contents.length > 0 && (
              <div
                className="flex items-center gap-1 text-xs text-green-600"
                title="Data loaded from cache"
              >
                <Database className="h-3 w-3" />
                <span>Cached</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Tooltip content={t('aiSocial.contents.tooltip.refresh')}>
            <button
              onClick={handleRefresh}
              disabled={loading || swrValidating}
              className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:opacity-50"
              aria-label={t('aiSocial.contents.refresh')}
            >
              <RefreshCw
                className={`h-4 w-4 ${loading || swrValidating ? 'animate-spin' : ''}`}
              />
              {t('aiSocial.contents.refresh')}
            </button>
          </Tooltip>
          <Tooltip content={t('aiSocial.contents.tooltip.create')}>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2"
              aria-label={t('aiSocial.contents.create')}
            >
              <Plus className="h-4 w-4" />
              {t('aiSocial.contents.create')}
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={t('aiSocial.contents.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-gray-200 py-2 pl-10 pr-4 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
              aria-label={t('aiSocial.contents.searchPlaceholder')}
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as ContentStatus | 'ALL')
              }
              className="rounded-lg border border-gray-200 py-2 pl-3 pr-8 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
              aria-label={t('aiSocial.contents.table.status')}
            >
              <option value="ALL">{t('aiSocial.contents.allStatus')}</option>
              <option value="DRAFT">{t('aiSocial.status.draft')}</option>
              <option value="PENDING">{t('aiSocial.status.pending')}</option>
              <option value="SCHEDULED">
                {t('aiSocial.status.scheduled')}
              </option>
              <option value="PUBLISHED">
                {t('aiSocial.status.published')}
              </option>
              <option value="FAILED">{t('aiSocial.status.failed')}</option>
            </select>
            <Tooltip content={t('aiSocial.filters.advancedFilters')}>
              <button
                type="button"
                onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                className={`flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 ${
                  showAdvancedFilters
                    ? 'border-rose-500 bg-rose-50 text-rose-700'
                    : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
                aria-expanded={showAdvancedFilters}
                aria-controls="advanced-filters-panel"
              >
                <SlidersHorizontal className="h-4 w-4" />
                {t('aiSocial.filters.more')}
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Advanced Filters Panel */}
        {showAdvancedFilters && (
          <div id="advanced-filters-panel">
            <AdvancedFilters
              filters={advancedFilters}
              onChange={handleAdvancedFiltersChange}
            />
          </div>
        )}
      </div>

      {/* Loading State - Skeleton */}
      {loading && contents.length === 0 ? (
        <ContentTableSkeleton rows={5} />
      ) : filteredContents.length > 0 ? (
        /* Content List */
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <Table className="w-full table-fixed divide-y divide-gray-200">
            <colgroup>
              <col className="w-[5%]" />
              <col className="w-[30%]" />
              <col className="w-[14%]" />
              <col className="w-[14%]" />
              <col className="w-[12%]" />
              <col className="w-[11%]" />
              <col className="w-[14%]" />
            </colgroup>
            <THead className="bg-gray-50">
              <Tr>
                <Th className="px-6 py-3">
                  <input
                    type="checkbox"
                    checked={
                      filteredContents.length > 0 &&
                      selectedIds.size === filteredContents.length
                    }
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    disabled={isBatchDeleting || isBatchPublishing}
                    className="h-4 w-4 rounded border-gray-300 text-rose-600 focus:ring-rose-500 disabled:opacity-50"
                    aria-label={t('aiSocial.batch.selectAll')}
                  />
                </Th>
                <Th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  {t('aiSocial.contents.table.title')}
                </Th>
                <Th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  {t('aiSocial.contents.table.type')}
                </Th>
                <Th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  {t('aiSocial.contents.table.source')}
                </Th>
                <Th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  {t('aiSocial.contents.table.status')}
                </Th>
                <Th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  {t('aiSocial.contents.table.date')}
                </Th>
                <Th className="relative px-6 py-3">
                  <span className="sr-only">Actions</span>
                </Th>
              </Tr>
            </THead>
            <TBody className="divide-y divide-gray-200 bg-white">
              {filteredContents.map((content, index) => {
                const isSelected = selectedIds.has(content.id);
                return (
                  <motion.tr
                    key={content.id}
                    className={`hover:bg-gray-50 ${isSelected ? 'bg-rose-50' : ''}`}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isSelected) {
                        router.push(`/ai-social/edit/${content.id}`);
                      }
                    }}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2, delay: index * 0.02 }}
                  >
                    <Td className="whitespace-nowrap px-6 py-4">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() =>
                          handleSelectOne(content.id, index, false)
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectOne(content.id, index, e.shiftKey);
                        }}
                        disabled={isBatchDeleting || isBatchPublishing}
                        className="h-4 w-4 rounded border-gray-300 text-rose-600 focus:ring-rose-500 disabled:opacity-50"
                        aria-label={`${t('aiSocial.batch.select')} ${content.title}`}
                      />
                    </Td>
                    <Td className="whitespace-nowrap px-6 py-4">
                      <div className="flex items-center gap-3">
                        <FileText className="h-5 w-5 flex-shrink-0 text-gray-400" />
                        <button
                          onClick={() => {
                            // PR-4: 父组件传 onSelectContent 时打开统一 drawer；
                            // 否则保留旧行为（直接跳编辑页）
                            if (onSelectContent) {
                              onSelectContent(content);
                            } else {
                              router.push(`/ai-social/edit/${content.id}`);
                            }
                          }}
                          className="min-w-0 font-medium text-gray-900 hover:text-rose-600 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                          aria-label={`${t('aiSocial.contents.preview')} ${content.title}`}
                        >
                          <TruncatedCell className="max-w-[240px] text-gray-900">
                            {content.title}
                          </TruncatedCell>
                        </button>
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {t(
                        `aiSocial.contentTypes.${content.contentType.toLowerCase()}`
                      )}
                    </Td>
                    <Td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {t(
                        `aiSocial.sources.${content.sourceType.toLowerCase()}`
                      )}
                    </Td>
                    <Td className="whitespace-nowrap px-6 py-4">
                      {getStatusBadge(content.status, content.errorMessage)}
                    </Td>
                    <Td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      <ClientDate date={content.updatedAt} format="date" />
                    </Td>
                    <Td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-2">
                        {(content.status === 'DRAFT' ||
                          content.status === 'FAILED') && (
                          <Tooltip
                            content={t('aiSocial.contents.tooltip.publish')}
                          >
                            <button
                              onClick={() => handlePublish(content)}
                              disabled={publishingId === content.id}
                              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50"
                              aria-label={
                                content.status === 'FAILED'
                                  ? `${t('aiSocial.contents.retry')} ${content.title}`
                                  : `${t('aiSocial.contents.publish')} ${content.title}`
                              }
                            >
                              {publishingId === content.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Send className="h-4 w-4" />
                              )}
                            </button>
                          </Tooltip>
                        )}
                        {content.externalUrl && (
                          <Tooltip
                            content={t(
                              'aiSocial.contents.tooltip.viewExternal'
                            )}
                          >
                            <a
                              href={content.externalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                              aria-label={`${t('aiSocial.contents.viewExternal')} ${content.title}`}
                            >
                              <Link className="h-4 w-4" />
                            </a>
                          </Tooltip>
                        )}
                        <Tooltip
                          content={t('aiSocial.contents.tooltip.preview')}
                        >
                          <button
                            onClick={() =>
                              router.push(`/ai-social/edit/${content.id}`)
                            }
                            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
                            aria-label={`${t('aiSocial.contents.preview')} ${content.title}`}
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </Tooltip>
                        <Tooltip
                          content={t('aiSocial.contents.tooltip.delete')}
                        >
                          <button
                            onClick={() => handleDelete(content.id)}
                            disabled={deletingId === content.id}
                            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50"
                            aria-label={`${t('aiSocial.contents.delete')} ${content.title}`}
                          >
                            {deletingId === content.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        </Tooltip>
                      </div>
                    </Td>
                  </motion.tr>
                );
              })}
            </TBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          icon={<FileText className="h-12 w-12" />}
          title={t('aiSocial.contents.emptyTitle')}
          description={t('aiSocial.contents.emptyDescription')}
          action={{
            label: t('aiSocial.contents.createFirst'),
            onClick: () => setShowCreateModal(true),
          }}
        />
      )}

      {/* Create Content Modal */}
      <Modal
        open={showCreateModal}
        onClose={resetModal}
        size="md"
        title={
          modalStep === 1
            ? t('aiSocial.contents.createTitle')
            : t('aiSocial.sources.external_url')
        }
        subtitle={
          modalStep === 1
            ? t('aiSocial.contents.createDescription')
            : t('aiSocial.modal.enterUrl')
        }
        footer={
          modalStep === 1 ? (
            <>
              <button
                onClick={resetModal}
                className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleContinue}
                disabled={!selectedSource}
                className="flex-1 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('common.continue')}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={resetModal}
                className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleProcessUrl}
                disabled={!externalUrl.trim() || isProcessing}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('aiSocial.modal.processing')}
                  </>
                ) : (
                  t('aiSocial.modal.processUrl')
                )}
              </button>
            </>
          )
        }
      >
        {/* Step 1: Source Selection */}
        {modalStep === 1 && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 pb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-100">
                <Sparkles className="h-5 w-5 text-rose-600" />
              </div>
            </div>
            <label className="text-sm font-medium text-gray-700">
              {t('aiSocial.contents.selectSource')}
            </label>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  'EXTERNAL_URL',
                  'AI_EXPLORE',
                  'AI_RESEARCH',
                  'AI_OFFICE',
                  'AI_WRITING',
                  'AI_TOPIC_INSIGHTS',
                ] as SourceType[]
              ).map((source) => (
                <button
                  key={source}
                  type="button"
                  onClick={() => setSelectedSource(source)}
                  className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 ${
                    selectedSource === source
                      ? 'border-rose-500 bg-rose-50 ring-1 ring-rose-500'
                      : 'border-gray-200 hover:border-rose-300 hover:bg-rose-50'
                  }`}
                  aria-pressed={selectedSource === source}
                >
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                      selectedSource === source ? 'bg-rose-100' : 'bg-gray-100'
                    }`}
                  >
                    <FileText
                      className={`h-4 w-4 ${
                        selectedSource === source
                          ? 'text-rose-600'
                          : 'text-gray-600'
                      }`}
                    />
                  </div>
                  <span
                    className={`text-sm font-medium ${
                      selectedSource === source
                        ? 'text-rose-700'
                        : 'text-gray-900'
                    }`}
                  >
                    {t(`aiSocial.sources.${source.toLowerCase()}`)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: External URL Input */}
        {modalStep === 2 && selectedSource === 'EXTERNAL_URL' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setModalStep(1)}
                className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
                aria-label={t('common.back')}
              >
                <ArrowLeft className="h-5 w-5 text-gray-600" />
              </button>
            </div>
            <div className="space-y-3">
              <label
                htmlFor="external-url"
                className="text-sm font-medium text-gray-700"
              >
                {t('aiSocial.modal.urlLabel')}
              </label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <input
                  id="external-url"
                  type="url"
                  value={externalUrl}
                  onChange={(e) => setExternalUrl(e.target.value)}
                  placeholder="https://example.com/article"
                  className="w-full rounded-lg border border-gray-200 py-3 pl-11 pr-4 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                />
              </div>
              <p className="text-xs text-gray-500">
                {t('aiSocial.modal.urlHint')}
              </p>
            </div>
          </div>
        )}
      </Modal>

      {/* Publish Modal - Connection Selection */}
      <Modal
        open={showPublishModal && contentToPublish !== null}
        onClose={cancelPublishModal}
        size="sm"
        title={t('aiSocial.publish.selectAccount')}
        subtitle={t('aiSocial.publish.selectAccountDescription')}
        footer={
          <>
            <button
              onClick={cancelPublishModal}
              className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() =>
                contentToPublish &&
                confirmPublish(contentToPublish.id, selectedConnectionId)
              }
              disabled={!selectedConnectionId || publishing}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {publishing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('aiSocial.publish.publishing')}
                </>
              ) : (
                t('aiSocial.publish.confirm')
              )}
            </button>
          </>
        }
      >
        {/* Connection Selection */}
        <div className="space-y-3">
          {contentToPublish &&
            connections
              .filter((conn) => {
                if (contentToPublish.contentType === 'WECHAT_ARTICLE') {
                  return conn.platformType === 'WECHAT_MP';
                }
                if (contentToPublish.contentType === 'XIAOHONGSHU_NOTE') {
                  return conn.platformType === 'XIAOHONGSHU';
                }
                return true;
              })
              .map((conn) => (
                <button
                  key={conn.id}
                  onClick={() => setSelectedConnectionId(conn.id)}
                  className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 ${
                    selectedConnectionId === conn.id
                      ? 'border-rose-500 bg-rose-50 ring-1 ring-rose-500'
                      : 'border-gray-200 hover:border-rose-300 hover:bg-rose-50'
                  }`}
                  aria-pressed={selectedConnectionId === conn.id}
                >
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                      conn.platformType === 'WECHAT_MP'
                        ? 'bg-green-100'
                        : 'bg-red-100'
                    }`}
                  >
                    <span
                      className={`text-lg font-bold ${
                        conn.platformType === 'WECHAT_MP'
                          ? 'text-green-600'
                          : 'text-red-500'
                      }`}
                    >
                      {conn.platformType === 'WECHAT_MP' ? 'W' : 'X'}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">
                      {conn.accountName ||
                        t(
                          `aiSocial.platforms.${conn.platformType.toLowerCase()}`
                        )}
                    </p>
                    <p className="text-xs text-gray-500">
                      {conn.isActive
                        ? t('aiSocial.connections.connected')
                        : t('aiSocial.connections.disconnected')}
                    </p>
                  </div>
                </button>
              ))}
        </div>
      </Modal>

      {/* Batch Action Bar */}
      <BatchActionBar
        selectedCount={selectedIds.size}
        totalCount={filteredContents.length}
        onClearSelection={handleClearSelection}
        onBatchDelete={handleBatchDelete}
        onBatchPublish={canBatchPublish ? handleBatchPublish : undefined}
        isDeleting={isBatchDeleting}
        isPublishing={isBatchPublishing}
        showPublishAction={canBatchPublish}
      />
    </div>
  );
}
