'use client';

/**
 * Topic Research Tab Component
 *
 * 专题研究 TAB 组件，用于内嵌在 AI Insights 页面中
 * ★ v8.0: 使用独立路由 /ai-insights/topic/[topicId] 而非本地状态切换
 *         这样浏览器刷新能正确保持在详情页
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n';
import { useAuth } from '@/contexts/AuthContext';
import { useTopicInsightsStore } from '@/stores/topicInsightsStore';
import { confirm } from '@/stores';
import { TopicCard } from './TopicCard';
import { CreateTopicDialog } from '../dialogs/CreateTopicDialog';
import { TopicSharingModal } from '../dialogs/TopicSharingModal';
import ShareModal from '@/components/common/dialogs/ShareModal';
import { EmptyState } from '@/components/ui/states/EmptyState';
import type { ResearchTopic } from '@/lib/types/topic-insights';
import { ResearchTopicType } from '@/lib/types/topic-insights';

// Icons
const PlusIcon = ({ className }: { className?: string }) => (
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
      d="M12 4v16m8-8H4"
    />
  </svg>
);

const LoaderIcon = ({ className }: { className?: string }) => (
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
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
    />
  </svg>
);

const FolderOpenIcon = ({ className }: { className?: string }) => (
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
      d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"
    />
  </svg>
);

interface TopicResearchTabProps {
  activeType: ResearchTopicType | null;
  searchQuery: string;
  showCreateDialog: boolean;
  onShowCreateDialog: (show: boolean) => void;
  initialCreateName?: string;
}

/**
 * ★ Topic Research 列表组件
 * 点击卡片时导航到独立路由 /ai-research/topic/[topicId]
 * 这样浏览器刷新能正确保持在详情页
 */
export function TopicResearchTab({
  activeType,
  searchQuery,
  showCreateDialog,
  onShowCreateDialog,
  initialCreateName = '',
}: TopicResearchTabProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();

  const {
    topics,
    topicsTotal,
    hasMoreTopics,
    isLoadingMoreTopics,
    isLoadingTopics,
    error,
    fetchTopics,
    loadMoreTopics,
    triggerRefresh,
    deleteTopic,
    updateTopic,
    clearError,
  } = useTopicInsightsStore();

  const [sharingTopic, setSharingTopic] = useState<ResearchTopic | null>(null);
  const [editingTopic, setEditingTopic] = useState<ResearchTopic | null>(null);
  // ★ 社交分享弹窗状态
  const [shareModalTopic, setShareModalTopic] = useState<ResearchTopic | null>(
    null
  );

  // Ensure topics is always an array
  const topicsList = Array.isArray(topics) ? topics : [];

  // Current filter options (shared between fetch and loadMore)
  const filterOptions = useMemo(
    () => ({
      type: activeType || undefined,
      search: searchQuery || undefined,
    }),
    [activeType, searchQuery]
  );

  // Load topics
  const loadTopics = useCallback(async () => {
    try {
      await fetchTopics({
        type: activeType || undefined,
        search: searchQuery || undefined,
      });
    } catch (err) {
      // Error is handled in store
    }
  }, [activeType, searchQuery, fetchTopics]);

  useEffect(() => {
    loadTopics();
  }, [loadTopics]);

  // Infinite scroll: IntersectionObserver on sentinel element
  // ★ Must find the closest scrollable ancestor as `root`, because the page
  // uses a nested `overflow-auto` container (not the viewport for scrolling).
  const sentinelRef = useRef<HTMLDivElement>(null);

  // ★ Use refs to always access latest values in IntersectionObserver callback,
  // avoiding stale closure issues that caused "sometimes works, sometimes doesn't".
  const filterOptionsRef = useRef(filterOptions);
  filterOptionsRef.current = filterOptions;
  const hasMoreRef = useRef(hasMoreTopics);
  hasMoreRef.current = hasMoreTopics;
  const isLoadingMoreRef = useRef(isLoadingMoreTopics);
  isLoadingMoreRef.current = isLoadingMoreTopics;

  // Track whether sentinel should be in the DOM so the effect re-runs
  // when topics finish loading and the sentinel element appears.
  const sentinelVisible = !isLoadingTopics && topicsList.length > 0;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    // Find closest scrollable ancestor to use as IntersectionObserver root
    let scrollRoot: Element | null = null;
    let el: Element | null = sentinel.parentElement;
    while (el) {
      const style = getComputedStyle(el);
      if (
        style.overflow === 'auto' ||
        style.overflow === 'scroll' ||
        style.overflowY === 'auto' ||
        style.overflowY === 'scroll'
      ) {
        scrollRoot = el;
        break;
      }
      el = el.parentElement;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          hasMoreRef.current &&
          !isLoadingMoreRef.current
        ) {
          void loadMoreTopics(filterOptionsRef.current);
        }
      },
      { root: scrollRoot, rootMargin: '200px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMoreTopics, sentinelVisible]);

  // ★ 点击专题卡片 - 导航到独立路由
  const handleTopicClick = useCallback(
    (topic: ResearchTopic) => {
      router.push(`/ai-insights/topic/${topic.id}`);
    },
    [router]
  );

  // Handle topic created/updated - 刷新列表或导航
  const handleTopicCreated = (topic: ResearchTopic) => {
    onShowCreateDialog(false);
    setEditingTopic(null); // ★ 关闭编辑模式
    // ★ 如果是编辑模式，刷新列表；如果是创建模式，导航到新专题
    if (editingTopic) {
      loadTopics();
    } else {
      router.push(`/ai-insights/topic/${topic.id}`);
    }
  };

  // Handle refresh
  const handleRefresh = async (topicId: string) => {
    try {
      await triggerRefresh(topicId);
    } catch (err) {
      // Error is already handled in store
    }
  };

  // Handle delete
  const handleDelete = async (topicId: string) => {
    if (
      !(await confirm({
        title: t('topicResearch.confirmDelete'),
        type: 'danger',
      }))
    )
      return;
    try {
      await deleteTopic(topicId);
    } catch (err) {
      // Error is already handled in store
    }
  };

  // ★ Handle edit - 打开编辑对话框
  const handleEdit = useCallback(
    (topic: ResearchTopic) => {
      setEditingTopic(topic);
      onShowCreateDialog(true);
    },
    [onShowCreateDialog]
  );

  // ★ Handle visibility change - 切换可见性
  const handleVisibilityChange = useCallback(
    async (topicId: string, visibility: 'PRIVATE' | 'SHARED' | 'PUBLIC') => {
      try {
        await updateTopic(topicId, { visibility });
      } catch (err) {
        // Error is handled in store
      }
    },
    [updateTopic]
  );

  return (
    <>
      {/* Error */}
      {error && (
        <div className="mb-6 rounded-lg bg-red-50 p-4">
          <div className="flex items-center justify-between">
            <p className="text-red-600">
              {typeof error === 'string'
                ? error
                : t('topicResearch.createDialog.operationFailed')}
            </p>
            <button
              onClick={clearError}
              className="text-sm text-red-600 hover:underline"
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoadingTopics ? (
        <div className="flex items-center justify-center py-20">
          <LoaderIcon className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      ) : topicsList.length === 0 ? (
        <EmptyState
          icon={<FolderOpenIcon className="h-16 w-16" />}
          title={
            searchQuery
              ? t('topicResearch.noMatchingTopics')
              : t('topicResearch.noTopics')
          }
          description={
            searchQuery
              ? t('topicResearch.noMatchingTopicsDesc')
              : t('topicResearch.noTopicsDesc')
          }
          action={
            !searchQuery
              ? {
                  label: t('topicResearch.createFirstTopic'),
                  onClick: () => onShowCreateDialog(true),
                }
              : undefined
          }
        />
      ) : (
        /* Topics Grid */
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {topicsList.map((topic) => (
            <TopicCard
              key={topic.id}
              topic={topic}
              currentUserId={user?.id}
              onClick={() => handleTopicClick(topic)}
              onDelete={() => handleDelete(topic.id)}
              onShare={() => setSharingTopic(topic)}
              onShareToSocial={() => setShareModalTopic(topic)}
              onEdit={() => handleEdit(topic)}
              onVisibilityChange={(visibility) =>
                handleVisibilityChange(topic.id, visibility)
              }
            />
          ))}

          {/* Create New Card */}
          <button
            onClick={() => onShowCreateDialog(true)}
            className="flex h-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-white p-6 transition-colors hover:border-blue-400 hover:bg-blue-50"
          >
            <PlusIcon className="h-10 w-10 text-gray-400" />
            <span className="mt-2 text-sm font-medium text-gray-600">
              {t('topicResearch.createTopic')}
            </span>
          </button>
        </div>
      )}

      {/* Infinite scroll sentinel + loading indicator */}
      {!isLoadingTopics && topicsList.length > 0 && (
        <div ref={sentinelRef} className="flex justify-center py-4">
          {isLoadingMoreTopics && (
            <LoaderIcon className="h-6 w-6 animate-spin text-blue-600" />
          )}
          {hasMoreTopics && !isLoadingMoreTopics && (
            <span className="text-xs text-gray-400">
              {t('topicResearch.showingCount', {
                shown: topicsList.length,
                total: topicsTotal,
              })}
            </span>
          )}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <CreateTopicDialog
        isOpen={showCreateDialog}
        onClose={() => {
          onShowCreateDialog(false);
          setEditingTopic(null); // ★ 关闭时重置编辑状态
        }}
        onCreated={handleTopicCreated}
        defaultType={activeType || ResearchTopicType.MACRO}
        editTopic={editingTopic} // ★ 传入要编辑的专题
        initialName={initialCreateName}
      />

      {/* Sharing Modal */}
      {sharingTopic && (
        <TopicSharingModal
          topicId={sharingTopic.id}
          topicName={sharingTopic.name}
          isOpen={!!sharingTopic}
          onClose={() => setSharingTopic(null)}
        />
      )}

      {/* ★ Social Share Modal (same as AI Image) */}
      <ShareModal
        isOpen={!!shareModalTopic}
        onClose={() => setShareModalTopic(null)}
        shareUrl={
          shareModalTopic
            ? `${typeof window !== 'undefined' ? window.location.origin : ''}/ai-insights/topic/${shareModalTopic.id}`
            : ''
        }
        title={shareModalTopic?.name || ''}
        description={shareModalTopic?.description || ''}
      />
    </>
  );
}
