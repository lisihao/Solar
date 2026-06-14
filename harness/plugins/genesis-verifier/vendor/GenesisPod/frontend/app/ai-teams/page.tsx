'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useAiGroupStore } from '@/stores/ai-teams';
import {
  Topic,
  TopicType,
  CreateTopicDto,
  UpdateTopicDto,
} from '@/lib/types/ai-teams';
import { useAIModels, AIModel } from '@/hooks';
import { ModelBadges } from '@/components/common/badges/ModelBadges';
import AppShell from '@/components/layout/AppShell';
import { Users, Plus } from 'lucide-react';
import { CreateCard } from '@/components/ui/cards/CreateCard';
import { PageHeaderHero } from '@/components/ui/page-header-hero';
import { EmptyState } from '@/components/ui/states/EmptyState';
import ShareModal from '@/components/common/dialogs/ShareModal';
import { Modal } from '@/components/ui/dialogs/Modal';
import * as api from '@/services/ai-teams/api';
import { PublicTopic, JoinRequest } from '@/services/ai-teams/api';
import { useTranslation } from '@/lib/i18n';
import { logger } from '@/lib/utils/logger';
import { toast, confirm } from '@/stores';
import {
  AssetCard,
  type AssetCardBadge,
  type AssetVisibility,
  type AssetVisibilityOption,
} from '@/components/ui/cards/asset-card';
import { Globe, Lock, Sparkles, Users as UsersIcon } from 'lucide-react';
import { Tabs } from '@/components/ui/tabs';
import { LoadingState } from '@/components/ui/states';

type TabType = 'my-teams' | 'discover';

export default function AIGroupPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const processedParamsRef = useRef(false);
  const { user, accessToken, isLoading: authLoading } = useAuth();
  const {
    topics,
    isLoadingTopics,
    fetchTopics,
    createTopic,
    deleteTopic,
    updateTopic,
  } = useAiGroupStore();
  const { models: aiModels } = useAIModels();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [prefilledTopic, setPrefilledTopic] = useState('');
  const [editingTopic, setEditingTopic] = useState<Topic | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabType>('my-teams');

  // Public topics state
  const [publicTopics, setPublicTopics] = useState<PublicTopic[]>([]);
  const [isLoadingPublicTopics, setIsLoadingPublicTopics] = useState(false);
  const [myJoinRequests, setMyJoinRequests] = useState<JoinRequest[]>([]);
  const [joiningTopicId, setJoiningTopicId] = useState<string | null>(null);
  const [joinRequestMessage, setJoinRequestMessage] = useState('');
  const [showJoinDialog, setShowJoinDialog] = useState<PublicTopic | null>(
    null
  );
  // ★ Social share modal state
  const [shareModalTopic, setShareModalTopic] = useState<Topic | null>(null);

  const isAuthenticated = !!accessToken;

  // 查找模型：优先用 modelId 匹配（新方式），兼容旧数据
  const findModel = (aiModel: string) => {
    const models = aiModels || [];
    return (
      models.find((m) => m.modelId === aiModel) ||
      models.find((m) => m.modelName === aiModel) ||
      models.find((m) => m.id === aiModel)
    );
  };

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      fetchTopics();
      // Also fetch my join requests
      api
        .getMyJoinRequests()
        .then(setMyJoinRequests)
        .catch((err) => logger.error('Failed to fetch join requests:', err));
    }
  }, [authLoading, isAuthenticated, fetchTopics]);

  // ?topic=xxx — from Global AI Bar or ActionCards
  useEffect(() => {
    if (processedParamsRef.current) return;
    const topic = searchParams?.get('topic');
    if (!topic?.trim()) return;
    processedParamsRef.current = true;
    setPrefilledTopic(topic.trim());
    setShowCreateDialog(true);
  }, [searchParams]); // searchParams may be null on first SSR render, re-run when populated

  // Fetch public topics when discover tab is active
  useEffect(() => {
    if (activeTab === 'discover' && isAuthenticated) {
      setIsLoadingPublicTopics(true);
      api
        .getPublicTopics({ search: searchQuery, limit: 50 })
        .then((publicTopicsList) => {
          // Filter out topics user is already a member of
          const myTopicIds = new Set((topics || []).map((t) => t.id));
          const pendingRequestTopicIds = new Set(
            myJoinRequests
              .filter((r) => r.status === 'PENDING')
              .map((r) => r.topicId)
          );
          const filteredTopics = publicTopicsList.filter(
            (t) => !myTopicIds.has(t.id) && !pendingRequestTopicIds.has(t.id)
          );
          setPublicTopics(filteredTopics);
        })
        .catch((err) =>
          logger.error(
            'Failed to fetch public topics:',
            err instanceof Error ? err.message : String(err)
          )
        )
        .finally(() => setIsLoadingPublicTopics(false));
    }
  }, [activeTab, isAuthenticated, searchQuery, myJoinRequests, topics]);

  // Handle join request
  const handleJoinRequest = async (topic: PublicTopic) => {
    setJoiningTopicId(topic.id);
    try {
      await api.requestToJoinTopic(topic.id, joinRequestMessage);
      // Refresh my join requests
      const requests = await api.getMyJoinRequests();
      setMyJoinRequests(requests);
      setShowJoinDialog(null);
      setJoinRequestMessage('');
      toast.success(t('aiTeams.joinRequest.sentAlert', { name: topic.name }));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t('aiTeams.joinRequest.sendFailed')
      );
    } finally {
      setJoiningTopicId(null);
    }
  };

  // Cancel join request
  const handleCancelJoinRequest = async (requestId: string) => {
    if (
      !(await confirm({
        title: t('aiTeams.pendingRequests.confirmCancel'),
        type: 'warning',
      }))
    )
      return;
    try {
      await api.cancelJoinRequest(requestId);
      const requests = await api.getMyJoinRequests();
      setMyJoinRequests(requests);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t('aiTeams.pendingRequests.cancelFailed')
      );
    }
  };

  // 过滤topics
  const filteredTopics = (topics || []).filter((topic) => {
    if (!searchQuery) return true;
    return (
      topic.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      topic.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  if (authLoading) {
    return (
      <AppShell>
        <div className="flex flex-1 items-center justify-center">
          <LoadingState size="lg" text="" />
        </div>
      </AppShell>
    );
  }

  if (!isAuthenticated) {
    return (
      <AppShell>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
          <svg
            className="h-16 w-16 text-gray-300"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
          <h2 className="text-xl font-semibold text-gray-700">
            {t('aiTeams.signInRequired')}
          </h2>
          <p className="text-gray-500">{t('aiTeams.signInDesc')}</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="flex-1 overflow-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-gray-100 bg-white/50 backdrop-blur-sm">
          <PageHeaderHero
            title={t('aiTeams.title')}
            subtitle={t('aiTeams.subtitle')}
            icon={
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
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            }
            iconGradient="from-violet-500 to-purple-600"
            iconShadowClass="shadow-violet-500/25"
            actions={
              <button
                onClick={() => setShowCreateDialog(true)}
                className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-violet-700"
              >
                <Plus className="h-5 w-5" />
                {t('aiTeams.newTeam')}
              </button>
            }
          />

          {/* Tabs + Search below hero */}
          <div className="px-8 pb-4">
            <Tabs
              variant="pill"
              value={activeTab}
              onChange={(v) => setActiveTab(v as TabType)}
              items={[
                {
                  key: 'my-teams',
                  label: (
                    <>
                      {t('aiTeams.myTeams')}
                      {topics.length > 0 && (
                        <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-600">
                          {topics.length}
                        </span>
                      )}
                    </>
                  ),
                },
                {
                  key: 'discover',
                  label: (
                    <>
                      {t('aiTeams.discover')}
                      {myJoinRequests.filter((r) => r.status === 'PENDING')
                        .length > 0 && (
                        <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-600">
                          {
                            myJoinRequests.filter((r) => r.status === 'PENDING')
                              .length
                          }{' '}
                          {t('aiTeams.pendingRequests.pending')}
                        </span>
                      )}
                    </>
                  ),
                },
              ]}
            />

            {/* Search Bar */}
            <div className="mt-4">
              <div className="relative">
                <svg
                  className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
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
                <input
                  type="text"
                  placeholder={
                    activeTab === 'my-teams'
                      ? t('aiTeams.search.myTeams')
                      : t('aiTeams.search.publicTeams')
                  }
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-12 pr-4 text-sm outline-none transition-all focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Content based on active tab */}
        <div className="px-8 py-6">
          {activeTab === 'my-teams' ? (
            // My Teams Tab
            <>
              {isLoadingTopics ? (
                <LoadingState size="lg" />
              ) : filteredTopics.length === 0 ? (
                <EmptyState
                  icon={<Users className="h-16 w-16" />}
                  title={t('aiTeams.empty.noTeams')}
                  description={t('aiTeams.empty.noTeamsDesc')}
                  action={
                    <div className="flex gap-3">
                      <button
                        onClick={() => setShowCreateDialog(true)}
                        className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
                      >
                        {t('aiTeams.createTeam')}
                      </button>
                      <button
                        onClick={() => setActiveTab('discover')}
                        className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        {t('aiTeams.empty.discoverTeams')}
                      </button>
                    </div>
                  }
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {filteredTopics.map((topic) => (
                    <TopicCard
                      key={topic.id}
                      topic={topic}
                      currentUserId={user?.id}
                      onClick={() => router.push(`/ai-teams/${topic.id}`)}
                      onEdit={(topic) => {
                        setEditingTopic(topic);
                      }}
                      onDelete={async (topicId) => {
                        if (
                          await confirm({
                            title: t('aiTeams.confirmDelete'),
                            type: 'danger',
                          })
                        ) {
                          await deleteTopic(topicId);
                          await fetchTopics();
                        }
                      }}
                      onTogglePublic={async (topicId, makePublic) => {
                        await updateTopic(topicId, {
                          type: makePublic
                            ? TopicType.PUBLIC
                            : TopicType.PRIVATE,
                        });
                        await fetchTopics();
                      }}
                      onShare={(topic) => setShareModalTopic(topic)}
                      findModel={findModel}
                    />
                  ))}

                  {/* Create New Card */}
                  <CreateCard
                    title={t('aiTeams.newTeam')}
                    onClick={() => setShowCreateDialog(true)}
                  />
                </div>
              )}
            </>
          ) : (
            // Discover Tab
            <>
              {/* Pending Join Requests Section */}
              {myJoinRequests.filter((r) => r.status === 'PENDING').length >
                0 && (
                <div className="mb-6">
                  <h3 className="mb-3 text-sm font-semibold text-gray-700">
                    {t('aiTeams.pendingRequests.title')} (
                    {
                      myJoinRequests.filter((r) => r.status === 'PENDING')
                        .length
                    }
                    )
                  </h3>
                  <div className="space-y-2">
                    {myJoinRequests
                      .filter((r) => r.status === 'PENDING')
                      .map((request) => (
                        <div
                          key={request.id}
                          className="flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50 p-3"
                        >
                          <div>
                            <span className="font-medium text-gray-900">
                              {request.topic?.name ||
                                t('aiTeams.pendingRequests.unknownTeam')}
                            </span>
                            <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-600">
                              {t('aiTeams.pendingRequests.pending')}
                            </span>
                          </div>
                          <button
                            onClick={() => handleCancelJoinRequest(request.id)}
                            className="text-sm text-gray-500 hover:text-red-600"
                          >
                            {t('aiTeams.pendingRequests.cancelRequest')}
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Public Topics Grid */}
              {isLoadingPublicTopics ? (
                <LoadingState size="lg" />
              ) : publicTopics.length === 0 ? (
                <EmptyState
                  type="search"
                  title={t('aiTeams.empty.noPublicTeams')}
                  description={t('aiTeams.empty.noPublicTeamsDesc')}
                  action={{
                    label: t('aiTeams.createTeam'),
                    onClick: () => {
                      setActiveTab('my-teams');
                      setShowCreateDialog(true);
                    },
                  }}
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {publicTopics.map((topic) => (
                    <PublicTopicCard
                      key={topic.id}
                      topic={topic}
                      onJoinRequest={() => setShowJoinDialog(topic)}
                      isJoining={joiningTopicId === topic.id}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* Join Request Dialog */}
      <Modal
        open={!!showJoinDialog}
        onClose={() => {
          setShowJoinDialog(null);
          setJoinRequestMessage('');
        }}
        title={t('aiTeams.joinRequest.title')}
        size="sm"
        footer={
          showJoinDialog ? (
            <>
              <button
                onClick={() => {
                  setShowJoinDialog(null);
                  setJoinRequestMessage('');
                }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {t('aiTeams.joinRequest.cancel')}
              </button>
              <button
                onClick={() => handleJoinRequest(showJoinDialog)}
                disabled={joiningTopicId === showJoinDialog.id}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {joiningTopicId === showJoinDialog.id
                  ? t('aiTeams.joinRequest.sending')
                  : t('aiTeams.joinRequest.sendRequest')}
              </button>
            </>
          ) : null
        }
      >
        {showJoinDialog && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-500">
                {showJoinDialog.avatar ? (
                  <span className="text-2xl">{showJoinDialog.avatar}</span>
                ) : (
                  <svg
                    className="h-6 w-6 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                    />
                  </svg>
                )}
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">
                  {showJoinDialog.name}
                </h3>
                <p className="text-sm text-gray-500">
                  {t('aiTeams.joinRequest.members', {
                    count: showJoinDialog.memberCount,
                  })}{' '}
                  ·{' '}
                  {t('aiTeams.joinRequest.aiMembers', {
                    count: showJoinDialog.aiMemberCount,
                  })}
                </p>
              </div>
            </div>
            {showJoinDialog.description && (
              <p className="text-sm text-gray-600">
                {showJoinDialog.description}
              </p>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700">
                {t('aiTeams.joinRequest.messageLabel')}
              </label>
              <textarea
                value={joinRequestMessage}
                onChange={(e) => setJoinRequestMessage(e.target.value)}
                placeholder={t('aiTeams.joinRequest.messagePlaceholder')}
                rows={3}
                className="mt-1 w-full resize-none rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
          </div>
        )}
      </Modal>

      {/* Create Topic Dialog */}
      {showCreateDialog && (
        <CreateTopicDialog
          aiModels={aiModels}
          initialName={prefilledTopic}
          onClose={() => {
            setShowCreateDialog(false);
            setPrefilledTopic('');
          }}
          onCreate={async (dto) => {
            const topic = await createTopic(dto);
            setShowCreateDialog(false);
            setPrefilledTopic('');
            router.push(`/ai-teams/${topic.id}`);
          }}
        />
      )}

      {editingTopic && (
        <EditTopicDialog
          topic={editingTopic}
          onClose={() => setEditingTopic(null)}
          onUpdate={async (topicId, dto) => {
            await updateTopic(topicId, dto);
            setEditingTopic(null);
            await fetchTopics();
          }}
        />
      )}

      {/* ★ Social Share Modal (same as AI Image / AI Research) */}
      <ShareModal
        isOpen={!!shareModalTopic}
        onClose={() => setShareModalTopic(null)}
        shareUrl={
          shareModalTopic
            ? `${typeof window !== 'undefined' ? window.location.origin : ''}/ai-teams/${shareModalTopic.id}`
            : ''
        }
        title={shareModalTopic?.name || ''}
        description={shareModalTopic?.description || ''}
      />
    </AppShell>
  );
}

// Vibrant gradient color schemes for team cards
const TEAM_GRADIENTS = [
  {
    from: 'from-violet-500',
    to: 'to-purple-600',
    shadow: 'shadow-violet-500/30',
  },
  { from: 'from-blue-500', to: 'to-cyan-500', shadow: 'shadow-blue-500/30' },
  {
    from: 'from-emerald-500',
    to: 'to-teal-500',
    shadow: 'shadow-emerald-500/30',
  },
  { from: 'from-orange-500', to: 'to-red-500', shadow: 'shadow-orange-500/30' },
  { from: 'from-pink-500', to: 'to-rose-500', shadow: 'shadow-pink-500/30' },
  {
    from: 'from-indigo-500',
    to: 'to-blue-600',
    shadow: 'shadow-indigo-500/30',
  },
  {
    from: 'from-amber-500',
    to: 'to-orange-500',
    shadow: 'shadow-amber-500/30',
  },
  { from: 'from-cyan-500', to: 'to-blue-500', shadow: 'shadow-cyan-500/30' },
  {
    from: 'from-fuchsia-500',
    to: 'to-pink-500',
    shadow: 'shadow-fuchsia-500/30',
  },
  { from: 'from-lime-500', to: 'to-green-500', shadow: 'shadow-lime-500/30' },
];

// Get consistent gradient based on topic id
function getTeamGradient(topicId: string) {
  let hash = 0;
  for (let i = 0; i < topicId.length; i++) {
    hash = (hash << 5) - hash + topicId.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % TEAM_GRADIENTS.length;
  return TEAM_GRADIENTS[index];
}

// Topic Card Component
function TopicCard({
  topic,
  currentUserId,
  onClick,
  onEdit,
  onDelete,
  onTogglePublic,
  onShare,
  findModel,
}: {
  topic: Topic;
  currentUserId?: string;
  onClick: () => void;
  onEdit: (topic: Topic) => void;
  onDelete: (topicId: string) => void;
  onTogglePublic: (topicId: string, isPublic: boolean) => void;
  onShare?: (topic: Topic) => void;
  findModel: (aiModel: string) => AIModel | undefined;
}) {
  const { t } = useTranslation();
  const [isTogglingPublic, setIsTogglingPublic] = useState(false);

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return t('aiTeams.card.justNow');
    if (minutes < 60) return t('aiTeams.card.mAgo', { count: minutes });
    if (hours < 24) return t('aiTeams.card.hAgo', { count: hours });
    if (days < 7) return t('aiTeams.card.dAgo', { count: days });
    // Return React component for dates older than 7 days
    return null; // Will be handled by ClientDate component below
  };

  // Check if current user is the creator (owner)
  const isOwner = currentUserId === topic.createdById;

  // Get gradient colors for this topic
  const gradient = getTeamGradient(topic.id);

  // Check if topic is public
  const isPublic = topic.type === TopicType.PUBLIC;

  // Handle public toggle
  const handleTogglePublic = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isOwner || isTogglingPublic) return;

    setIsTogglingPublic(true);
    try {
      await onTogglePublic(topic.id, !isPublic);
    } finally {
      setIsTogglingPublic(false);
    }
  };

  const visibilityOptions: Record<AssetVisibility, AssetVisibilityOption> = {
    PRIVATE: {
      value: 'PRIVATE',
      label: t('aiTeams.card.makePrivate'),
      icon: <Lock className="h-3 w-3" />,
      className: 'bg-gray-100 text-gray-600',
    },
    SHARED: {
      value: 'SHARED',
      label: t('aiTeams.card.makePrivate'),
      icon: <Lock className="h-3 w-3" />,
      className: 'bg-blue-100 text-blue-600',
    },
    PUBLIC: {
      value: 'PUBLIC',
      label: t('aiTeams.card.makePublic'),
      icon: <Globe className="h-3 w-3" />,
      className: 'bg-green-100 text-green-600',
    },
  };

  const tagBadges: AssetCardBadge[] = (() => {
    const metadata = topic.metadata as { tags?: string[] } | null;
    const tags = metadata?.tags;
    if (!tags || !Array.isArray(tags) || tags.length === 0) return [];
    const visible = tags.slice(0, 3).map((tag, idx) => ({
      key: `tag-${idx}`,
      label: tag,
      className: 'bg-blue-50 text-blue-600',
    }));
    if (tags.length > 3) {
      visible.push({
        key: 'tag-more',
        label: `+${tags.length - 3}`,
        className: 'bg-gray-100 text-gray-500',
      });
    }
    return visible;
  })();

  const unreadBadge: AssetCardBadge | null =
    topic.unreadCount && topic.unreadCount > 0
      ? {
          key: 'unread',
          label: topic.unreadCount > 99 ? '99+' : String(topic.unreadCount),
          className: 'bg-red-500 text-white shadow-sm',
        }
      : null;

  const formattedTime = formatTime(topic.updatedAt);

  return (
    <AssetCard
      title={topic.name}
      description={topic.description}
      icon={
        topic.avatar ? (
          <span className="text-2xl drop-shadow-sm">{topic.avatar}</span>
        ) : (
          <UsersIcon className="h-6 w-6 text-white" />
        )
      }
      gradient={`${gradient.from} ${gradient.to}`}
      badges={[...(unreadBadge ? [unreadBadge] : []), ...tagBadges]}
      visibility={isPublic ? 'PUBLIC' : 'PRIVATE'}
      visibilityOptions={visibilityOptions}
      isOwner={isOwner}
      onVisibilityToggle={(next) => {
        if (isTogglingPublic) return;
        if (next === 'PUBLIC' && !isPublic) {
          void handleTogglePublic({
            stopPropagation: () => {},
          } as React.MouseEvent);
        } else if (next === 'PRIVATE' && isPublic) {
          void handleTogglePublic({
            stopPropagation: () => {},
          } as React.MouseEvent);
        }
      }}
      visibilityToggleCycle={['PRIVATE', 'PUBLIC']}
      onShareToSocial={onShare ? () => onShare(topic) : undefined}
      onEdit={() => onEdit(topic)}
      onDelete={() => onDelete(topic.id)}
      onClick={onClick}
      stats={[
        {
          key: 'members',
          icon: <UsersIcon className="h-3.5 w-3.5" />,
          text: String(topic.memberCount),
        },
        {
          key: 'ai',
          icon: <Sparkles className="h-3.5 w-3.5" />,
          text: `${topic.aiMemberCount} AI`,
        },
        ...(formattedTime !== null
          ? [
              {
                key: 'time',
                icon: <span className="text-xs text-gray-400">·</span>,
                text: formattedTime,
              },
            ]
          : []),
      ]}
      timestamp={formattedTime === null ? topic.updatedAt : undefined}
      customSection={
        <div className="flex items-center">
          <div className="flex -space-x-2">
            {(topic.members || []).slice(0, 4).map((member) => (
              <div
                key={member.id}
                className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-gray-200 text-xs font-medium text-gray-600"
                title={member.user.fullName || member.user.username || 'User'}
              >
                {member.user.avatarUrl ? (
                  <img
                    src={member.user.avatarUrl}
                    alt=""
                    className="h-full w-full rounded-full object-cover"
                  />
                ) : (
                  (member.user.fullName ||
                    member.user.username ||
                    'U')[0].toUpperCase()
                )}
              </div>
            ))}
            {topic.memberCount > 4 && (
              <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-gray-100 text-xs font-medium text-gray-500">
                +{topic.memberCount - 4}
              </div>
            )}
          </div>
          {(topic.aiMembers || []).length > 0 && (
            <>
              <div className="mx-2 h-4 w-px bg-gray-200" />
              <div className="flex -space-x-2">
                {(topic.aiMembers || []).slice(0, 2).map((ai) => {
                  const model = findModel(ai.aiModel);
                  return (
                    <div
                      key={ai.id}
                      className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-gradient-to-br from-blue-500 to-cyan-500"
                      title={ai.displayName}
                    >
                      {model?.iconUrl ? (
                        <img
                          src={model.iconUrl}
                          alt={model.name || ''}
                          className="h-4 w-4"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            const fallback = e.currentTarget
                              .nextElementSibling as HTMLElement;
                            if (fallback) fallback.style.display = 'flex';
                          }}
                        />
                      ) : null}
                      <span
                        className="flex h-4 w-4 items-center justify-center text-xs text-white"
                        style={{
                          display: model?.iconUrl ? 'none' : 'flex',
                        }}
                      >
                        {model?.icon || '🤖'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      }
      labels={{
        setPrivate: t('aiTeams.card.makePrivate'),
        setPublic: t('aiTeams.card.makePublic'),
        shareToSocial: t('aiTeams.card.share') || '分享',
        edit: t('aiTeams.card.editTeam'),
        delete: t('aiTeams.card.deleteTeam'),
      }}
    />
  );
}

// Create Topic Dialog
function CreateTopicDialog({
  aiModels,
  initialName = '',
  onClose,
  onCreate,
}: {
  aiModels: AIModel[];
  initialName?: string;
  onClose: () => void;
  onCreate: (dto: CreateTopicDto) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState('');
  const [selectedAI, setSelectedAI] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleAddTag = () => {
    const trimmedTag = tagInput.trim();
    if (trimmedTag && !tags.includes(trimmedTag)) {
      setTags([...tags, trimmedTag]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((tag) => tag !== tagToRemove));
  };

  const handleCreate = async () => {
    if (!name.trim()) return;

    setIsCreating(true);
    try {
      await onCreate({
        name: name.trim(),
        description: description.trim() || undefined,
        metadata: tags.length > 0 ? { tags } : undefined,
        aiMembers: selectedAI.map((aiId) => {
          // aiId 是 model.id（数据库唯一 ID），需要找到对应的 modelId
          const model = (aiModels || []).find((m) => m.id === aiId);
          return {
            aiModel: model?.modelId || aiId, // 使用 modelId（唯一）而不是旧的 id
            displayName: `AI-${model?.name || aiId}`,
          };
        }),
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('aiTeams.create.title')}
      size="md"
      contentClassName="space-y-4"
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {t('aiTeams.create.cancel')}
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || isCreating}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isCreating
              ? t('aiTeams.create.creating')
              : t('aiTeams.create.createButton')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            {t('aiTeams.create.nameRequired')}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('aiTeams.create.namePlaceholder')}
            className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            {t('aiTeams.create.description')}
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('aiTeams.create.descriptionPlaceholder')}
            rows={3}
            className="mt-1 w-full resize-none rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Tags */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            {t('aiTeams.create.tags')}
          </label>
          <div className="mt-1 flex gap-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddTag();
                }
              }}
              placeholder={t('aiTeams.create.tagsPlaceholder')}
              className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={handleAddTag}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {t('aiTeams.create.add')}
            </button>
          </div>
          {tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-600"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:text-blue-800"
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
                </span>
              ))}
            </div>
          )}
        </div>

        {/* AI Members */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            {t('aiTeams.create.addAI')}
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(aiModels || []).map((model) => (
              <button
                key={model.id}
                onClick={() => {
                  setSelectedAI((prev) =>
                    prev.includes(model.id)
                      ? prev.filter((id) => id !== model.id)
                      : [...prev, model.id]
                  );
                }}
                className={`flex items-center gap-3 rounded-lg border-2 p-3 text-left transition-colors ${
                  selectedAI.includes(model.id)
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {model.iconUrl ? (
                  <img
                    src={model.iconUrl}
                    alt={model.name}
                    className="h-6 w-6"
                    onError={(e) => {
                      // 图片加载失败时隐藏，显示 fallback
                      e.currentTarget.style.display = 'none';
                      const fallback = e.currentTarget
                        .nextElementSibling as HTMLElement;
                      if (fallback) fallback.style.display = 'block';
                    }}
                  />
                ) : null}
                <span
                  className="text-2xl"
                  style={{ display: model.iconUrl ? 'none' : 'block' }}
                >
                  {model.icon || '🤖'}
                </span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                    {model.name}
                    <ModelBadges model={model} />
                  </div>
                  <div className="text-xs text-gray-500">
                    {model.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// Edit Topic Dialog
function EditTopicDialog({
  topic,
  onClose,
  onUpdate,
}: {
  topic: Topic;
  onClose: () => void;
  onUpdate: (topicId: string, dto: UpdateTopicDto) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(topic.name);
  const [description, setDescription] = useState(topic.description || '');
  const [tags, setTags] = useState<string[]>(
    (topic.metadata?.tags as string[]) || []
  );
  const [tagInput, setTagInput] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  const handleAddTag = () => {
    const trimmedTag = tagInput.trim();
    if (trimmedTag && !tags.includes(trimmedTag)) {
      setTags([...tags, trimmedTag]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((tag) => tag !== tagToRemove));
  };

  const handleUpdate = async () => {
    if (!name.trim()) return;

    setIsUpdating(true);
    try {
      await onUpdate(topic.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        metadata: { ...topic.metadata, tags },
      });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('aiTeams.edit.title')}
      size="md"
      contentClassName="space-y-4"
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {t('aiTeams.create.cancel')}
          </button>
          <button
            onClick={handleUpdate}
            disabled={!name.trim() || isUpdating}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isUpdating
              ? t('aiTeams.edit.updating')
              : t('aiTeams.edit.updateButton')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            {t('aiTeams.create.nameRequired')}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            {t('aiTeams.create.description')}
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="mt-1 w-full resize-none rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Tags */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            {t('aiTeams.create.tags')}
          </label>
          <div className="mt-1 flex gap-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddTag();
                }
              }}
              placeholder={t('aiTeams.create.tagsPlaceholder')}
              className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={handleAddTag}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {t('aiTeams.create.add')}
            </button>
          </div>
          {tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-600"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:text-blue-800"
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
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// Public Topic Card for Discover Tab
function PublicTopicCard({
  topic,
  onJoinRequest,
  isJoining,
}: {
  topic: PublicTopic;
  onJoinRequest: () => void;
  isJoining: boolean;
}) {
  const { t } = useTranslation();

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / 86400000);

    if (days < 1) return t('aiTeams.publicCard.today');
    if (days < 7) return t('aiTeams.publicCard.daysAgo', { count: days });
    if (days < 30)
      return t('aiTeams.publicCard.weeksAgo', { count: Math.floor(days / 7) });
    // Return null for older dates to use ClientDate component
    return null;
  };

  const tagBadges: AssetCardBadge[] = (() => {
    const tags = topic.metadata?.tags;
    if (!tags || tags.length === 0) return [];
    const visible: AssetCardBadge[] = tags.slice(0, 3).map((tag, idx) => ({
      key: `tag-${idx}`,
      label: tag,
      className: 'bg-violet-50 text-violet-600',
    }));
    if (tags.length > 3) {
      visible.push({
        key: 'tag-more',
        label: `+${tags.length - 3}`,
        className: 'bg-gray-100 text-gray-500',
      });
    }
    return visible;
  })();

  const formattedTime = formatTime(topic.createdAt);

  return (
    <AssetCard
      title={topic.name}
      description={topic.description}
      icon={
        topic.avatar ? (
          <span className="text-2xl">{topic.avatar}</span>
        ) : (
          <Globe className="h-6 w-6 text-white" />
        )
      }
      gradient="from-green-500 to-teal-500"
      badges={[
        {
          key: 'public',
          label: t('aiTeams.publicCard.public'),
          className: 'bg-green-100 text-green-600',
        },
        ...tagBadges,
      ]}
      stats={[
        {
          key: 'members',
          icon: <UsersIcon className="h-3.5 w-3.5" />,
          text: t('aiTeams.publicCard.members', { count: topic.memberCount }),
        },
        {
          key: 'ai',
          icon: <Sparkles className="h-3.5 w-3.5" />,
          text: `${topic.aiMemberCount} AI`,
        },
        ...(formattedTime !== null
          ? [
              {
                key: 'time',
                icon: <span className="text-xs text-gray-400">·</span>,
                text: formattedTime,
              },
            ]
          : []),
      ]}
      timestamp={formattedTime === null ? topic.createdAt : undefined}
      customSection={
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-600">
            {topic.createdBy.avatarUrl ? (
              <img
                src={topic.createdBy.avatarUrl}
                alt=""
                className="h-full w-full rounded-full object-cover"
              />
            ) : (
              (topic.createdBy.fullName ||
                topic.createdBy.username ||
                'U')[0].toUpperCase()
            )}
          </div>
          <span className="text-xs text-gray-500">
            {t('aiTeams.publicCard.createdBy', {
              name:
                topic.createdBy.fullName || topic.createdBy.username || 'User',
            })}
          </span>
        </div>
      }
      footerExtra={
        <button
          onClick={onJoinRequest}
          disabled={isJoining}
          className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isJoining
            ? t('aiTeams.publicCard.applying')
            : t('aiTeams.publicCard.applyToJoin')}
        </button>
      }
    />
  );
}
