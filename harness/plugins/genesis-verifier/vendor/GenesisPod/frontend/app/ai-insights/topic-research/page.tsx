'use client';

/**
 * Topic Research Page (moved from /ai-research/topic-research)
 *
 * 专题研究列表页面
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { useAuth } from '@/contexts/AuthContext';
import { useTopicInsightsStore } from '@/stores/topicInsightsStore';
import { toast, confirm } from '@/stores';
import {
  TopicCard,
  CreateTopicDialog,
  TopicDetail,
  TopicSharingModal,
} from '@/components/ai-insights';
import ShareModal from '@/components/common/dialogs/ShareModal';
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

const SearchIcon = ({ className }: { className?: string }) => (
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
      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
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

// Tab icons
const AllIcon = () => (
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
      d="M4 6h16M4 10h16M4 14h16M4 18h16"
    />
  </svg>
);

const MacroIcon = () => (
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
      d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const TechnologyIcon = () => (
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
      d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
    />
  </svg>
);

const CompanyIcon = () => (
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
      d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
    />
  </svg>
);

export default function TopicResearchPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user } = useAuth();
  const {
    topics,
    isLoadingTopics,
    error,
    fetchTopics,
    triggerRefresh,
    deleteTopic,
    updateTopic,
    clearError,
  } = useTopicInsightsStore();

  const [activeType, setActiveType] = useState<ResearchTopicType | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState<ResearchTopic | null>(
    null
  );
  const [sharingTopic, setSharingTopic] = useState<ResearchTopic | null>(null);
  const [shareModalTopic, setShareModalTopic] = useState<ResearchTopic | null>(
    null
  );
  const [editingTopic, setEditingTopic] = useState<ResearchTopic | null>(null);

  // Topic type tabs with i18n
  const topicTypeTabs = [
    {
      type: null as ResearchTopicType | null,
      labelKey: 'topicResearch.tabs.all',
      icon: <AllIcon />,
    },
    {
      type: ResearchTopicType.MACRO,
      labelKey: 'topicResearch.tabs.macro',
      icon: <MacroIcon />,
    },
    {
      type: ResearchTopicType.TECHNOLOGY,
      labelKey: 'topicResearch.tabs.technology',
      icon: <TechnologyIcon />,
    },
    {
      type: ResearchTopicType.COMPANY,
      labelKey: 'topicResearch.tabs.company',
      icon: <CompanyIcon />,
    },
  ];

  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearchQuery(value), 400);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

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

  const handleTopicCreated = (topic: ResearchTopic) => {
    setSelectedTopic(topic);
  };

  const handleRefresh = async (topicId: string) => {
    try {
      await triggerRefresh(topicId);
    } catch (err) {
      // Error is already handled in store
    }
  };

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

  const handleCopyLink = async (topicId: string) => {
    const url = `${window.location.origin}/ai-insights/topic/${topicId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('topicResearch.linkCopied') || 'Link copied');
    } catch (err) {
      console.error('Failed to copy link:', err);
      toast.error(t('common.copyFailed') || 'Copy failed');
    }
  };

  const handleEdit = (topic: ResearchTopic) => {
    setEditingTopic(topic);
    setShowCreateDialog(true);
  };

  const handleVisibilityChange = async (
    topicId: string,
    visibility: 'PRIVATE' | 'SHARED' | 'PUBLIC'
  ) => {
    try {
      await updateTopic(topicId, { visibility });
    } catch (err) {
      // Error is handled in store
    }
  };

  const topicsList = Array.isArray(topics) ? topics : [];

  if (selectedTopic) {
    return (
      <TopicDetail
        topic={selectedTopic}
        onBack={() => {
          setSelectedTopic(null);
          loadTopics();
        }}
      />
    );
  }

  return (
    <div className="h-full overflow-auto bg-gray-50">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-gray-100 bg-white/80 backdrop-blur-sm">
        <div className="px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-600 shadow-lg shadow-blue-500/25">
                <svg
                  className="h-7 w-7 text-white"
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
                <h1 className="text-2xl font-bold text-gray-900">
                  {t('topicResearch.title')}
                </h1>
                <p className="text-sm text-gray-500">
                  {t('topicResearch.subtitle')}
                </p>
              </div>
            </div>
          </div>

          {/* Type Tabs */}
          <div className="mt-6 flex items-center gap-6 border-b border-gray-200">
            {topicTypeTabs.map((tab) => (
              <button
                key={tab.type || 'all'}
                onClick={() => setActiveType(tab.type)}
                className={`relative flex items-center gap-2 pb-3 text-sm font-medium transition-colors ${
                  activeType === tab.type
                    ? 'text-blue-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.icon}
                {t(tab.labelKey)}
                {activeType === tab.type && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />
                )}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="mt-6">
            <div className="relative">
              <SearchIcon className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder={t('topicResearch.searchPlaceholder')}
                className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-12 pr-4 text-sm outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-8 py-6">
        {error && (
          <div className="mb-6 rounded-lg bg-red-50 p-4">
            <div className="flex items-center justify-between">
              <p className="text-red-600">{error}</p>
              <button
                onClick={clearError}
                className="text-sm text-red-600 hover:underline"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        )}

        {isLoadingTopics ? (
          <div className="flex items-center justify-center py-20">
            <LoaderIcon className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : topicsList.length === 0 ? (
          <EmptyState
            icon={<FolderOpenIcon className="h-12 w-12" />}
            title={
              searchInput
                ? t('topicResearch.noMatchingTopics')
                : t('topicResearch.noTopics')
            }
            description={
              searchInput
                ? t('topicResearch.noMatchingTopicsDesc')
                : t('topicResearch.noTopicsDesc')
            }
            action={
              !searchInput
                ? {
                    label: t('topicResearch.createFirstTopic'),
                    onClick: () => setShowCreateDialog(true),
                  }
                : undefined
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {topicsList.map((topic) => (
              <TopicCard
                key={topic.id}
                topic={topic}
                currentUserId={user?.id}
                onClick={() => setSelectedTopic(topic)}
                onDelete={() => handleDelete(topic.id)}
                onShare={() => setSharingTopic(topic)}
                onShareToSocial={() => setShareModalTopic(topic)}
                onEdit={() => handleEdit(topic)}
                onVisibilityChange={(visibility) =>
                  handleVisibilityChange(topic.id, visibility)
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Dialog */}
      <CreateTopicDialog
        isOpen={showCreateDialog}
        onClose={() => {
          setShowCreateDialog(false);
          setEditingTopic(null);
        }}
        onCreated={(topic) => {
          setShowCreateDialog(false);
          setEditingTopic(null);
          if (editingTopic) {
            loadTopics();
          } else {
            setSelectedTopic(topic);
          }
        }}
        defaultType={activeType || ResearchTopicType.MACRO}
        editTopic={editingTopic}
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

      {/* Social Share Modal */}
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
    </div>
  );
}
