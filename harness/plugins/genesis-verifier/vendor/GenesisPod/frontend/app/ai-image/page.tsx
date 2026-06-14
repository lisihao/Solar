'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/lib/i18n';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { confirm } from '@/stores';
import ShareModal from '@/components/common/dialogs/ShareModal';

import { logger } from '@/lib/utils/logger';
import ClientDate from '@/components/common/ClientDate';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { LoadingState } from '@/components/ui/states';
import { Plus } from 'lucide-react';
import { PageHeaderHero } from '@/components/ui/page-header-hero';
import { CreateCard } from '@/components/ui/cards/CreateCard';
// AI Image Team - Preview (3 core agents)
const AI_TEAM_PREVIEW = [
  {
    id: 'analyst',
    icon: '🎨',
    nameKey: 'aiImage.team.styleAnalyst',
    color: 'from-pink-500 to-rose-600',
  },
  {
    id: 'prompt',
    icon: '✍️',
    nameKey: 'aiImage.team.promptExpert',
    color: 'from-purple-500 to-violet-600',
  },
  {
    id: 'generator',
    icon: '🖼️',
    nameKey: 'aiImage.team.imageGenerator',
    color: 'from-blue-500 to-cyan-600',
  },
];

interface GeneratedImage {
  id: string;
  prompt: string;
  enhancedPrompt?: string;
  imageUrl: string;
  createdAt: string;
  width: number;
  height: number;
  isBookmarked?: boolean;
  visibility?: 'PRIVATE' | 'PUBLIC';
}

export default function AIImagePage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { t } = useTranslation();

  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [isLoadingImages, setIsLoadingImages] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [shareImage, setShareImage] = useState<GeneratedImage | null>(null);

  // Fetch image history
  const fetchHistory = useCallback(async () => {
    if (!user) return;

    setIsLoadingImages(true);
    try {
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/ai-image/history`,
        {
          headers: { ...getAuthHeader() },
        }
      );
      if (response.ok) {
        const result = await response.json();
        // Handle wrapped response { success: true, data: [...] }
        const data = result?.data ?? result;
        setImages(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      logger.error('Failed to fetch history:', err);
    } finally {
      setIsLoadingImages(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      void fetchHistory();
    }
  }, [user, fetchHistory]);

  const handleDelete = async (e: React.MouseEvent, imageId: string) => {
    e.stopPropagation();
    if (
      !(await confirm({
        title: t('aiImage.actions.confirmDelete'),
        type: 'danger',
      }))
    )
      return;

    try {
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/ai-image/${imageId}`,
        {
          method: 'DELETE',
          headers: { ...getAuthHeader() },
        }
      );
      if (response.ok) {
        setImages((prev) => prev.filter((img) => img.id !== imageId));
      }
    } catch (err) {
      logger.error('Failed to delete image:', err);
    }
  };

  const handleToggleBookmark = async (
    e: React.MouseEvent,
    image: GeneratedImage
  ) => {
    e.stopPropagation();

    try {
      const method = image.isBookmarked ? 'DELETE' : 'POST';
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/ai-image/${image.id}/bookmark`,
        {
          method,
          headers: { ...getAuthHeader() },
        }
      );
      if (response.ok) {
        setImages((prev) =>
          prev.map((img) =>
            img.id === image.id
              ? { ...img, isBookmarked: !img.isBookmarked }
              : img
          )
        );
      }
    } catch (err) {
      logger.error('Failed to toggle bookmark:', err);
    }
  };

  const handleToggleVisibility = async (
    e: React.MouseEvent,
    image: GeneratedImage
  ) => {
    e.stopPropagation();
    const newVisibility = image.visibility === 'PUBLIC' ? 'PRIVATE' : 'PUBLIC';

    try {
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/ai-image/${image.id}/visibility`,
        {
          method: 'POST',
          headers: {
            ...getAuthHeader(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ visibility: newVisibility }),
        }
      );
      if (response.ok) {
        setImages((prev) =>
          prev.map((img) =>
            img.id === image.id ? { ...img, visibility: newVisibility } : img
          )
        );
      }
    } catch (err) {
      logger.error('Failed to toggle visibility:', err);
    }
  };

  const handleShare = (e: React.MouseEvent, image: GeneratedImage) => {
    e.stopPropagation();
    setShareImage(image);
  };

  // Removed formatTime function - using ClientDate component instead

  // Filter images by search query
  const filteredImages = images.filter((image) => {
    if (!searchQuery) return true;
    return (
      image.prompt?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      image.enhancedPrompt?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  if (authLoading) {
    return (
      <AppShell>
        <LoadingState />
      </AppShell>
    );
  }

  if (!user) {
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
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <h2 className="text-xl font-semibold text-gray-700">
            {t('aiImage.signIn.title')}
          </h2>
          <p className="text-gray-500">{t('aiImage.signIn.description')}</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="flex-1 overflow-auto">
        {/* Header - Sticky */}
        <div className="sticky top-0 z-10 border-b border-gray-100 bg-white/80 backdrop-blur-sm">
          <PageHeaderHero
            title={t('aiImage.title')}
            subtitle={t('aiImage.subtitle', { count: 3 })}
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
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            }
            iconGradient="from-pink-500 to-rose-600"
            iconShadowClass="shadow-pink-500/25"
            actions={
              <button
                onClick={() => router.push('/ai-image/create')}
                className="flex items-center gap-2 rounded-lg bg-pink-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-pink-700"
              >
                <Plus className="h-5 w-5" />
                {t('aiImage.startCreating')}
              </button>
            }
          >
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
                placeholder={t('aiImage.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-12 pr-4 text-sm outline-none transition-all focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20"
              />
            </div>
          </PageHeaderHero>
        </div>

        {/* Content */}
        <div className="px-8 py-6">
          {isLoadingImages ? (
            <LoadingState />
          ) : filteredImages.length === 0 && !searchQuery ? (
            /* Empty State */
            <div className="flex flex-col items-center justify-center py-12">
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
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <h3 className="mt-4 text-lg font-medium text-gray-700">
                {t('aiImage.empty.title')}
              </h3>
              <p className="mt-2 text-sm text-gray-500">
                {t('aiImage.empty.description')}
              </p>

              {/* AI Team Preview */}
              <div className="mt-6 rounded-xl bg-pink-50 p-4">
                <p className="mb-3 text-center text-xs font-medium text-pink-700">
                  {t('aiImage.team.title')}
                </p>
                <div className="flex items-center justify-center gap-4">
                  {AI_TEAM_PREVIEW.map((agent) => (
                    <div key={agent.id} className="flex flex-col items-center">
                      <span
                        className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${agent.color} text-xl shadow-sm`}
                      >
                        {agent.icon}
                      </span>
                      <span className="mt-1.5 text-xs text-gray-500">
                        {t(agent.nameKey)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={() => router.push('/ai-image/create')}
                className="mt-6 rounded-lg bg-pink-600 px-4 py-2 text-sm font-medium text-white hover:bg-pink-700"
              >
                {t('aiImage.startCreating')}
              </button>
            </div>
          ) : filteredImages.length === 0 && searchQuery ? (
            <EmptyState
              type="search"
              title={t('aiImage.noResults.title')}
              description={t('aiImage.noResults.description')}
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {filteredImages.map((image) => {
                return (
                  <div
                    key={image.id}
                    onClick={() =>
                      router.push(`/ai-image/create?id=${image.id}`)
                    }
                    className="group relative cursor-pointer overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-all hover:border-pink-300 hover:shadow-md"
                  >
                    {/* Image - Fixed aspect ratio */}
                    <div className="relative aspect-square overflow-hidden bg-gray-100">
                      <img
                        src={image.imageUrl}
                        alt={image.prompt}
                        className="absolute inset-0 h-full w-full object-cover transition-transform group-hover:scale-105"
                        loading="lazy"
                      />

                      {/* Overlay with actions */}
                      <div className="absolute inset-0 flex items-start justify-end gap-1 bg-gradient-to-b from-black/40 via-transparent to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={(e) => handleToggleVisibility(e, image)}
                          className={`rounded-lg p-1.5 shadow-sm transition-colors ${
                            image.visibility === 'PUBLIC'
                              ? 'bg-green-500 text-white'
                              : 'bg-white/90 text-gray-600 hover:bg-white hover:text-gray-800'
                          }`}
                          title={
                            image.visibility === 'PUBLIC'
                              ? t('aiImage.visibility.public')
                              : t('aiImage.visibility.private')
                          }
                        >
                          {image.visibility === 'PUBLIC' ? (
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
                                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                              />
                            </svg>
                          )}
                        </button>
                        {image.visibility === 'PUBLIC' && (
                          <button
                            onClick={(e) => handleShare(e, image)}
                            className="rounded-lg bg-white/90 p-1.5 text-gray-600 shadow-sm hover:bg-white hover:text-blue-600"
                            title={t('share.shareImage')}
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
                                d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
                              />
                            </svg>
                          </button>
                        )}
                        <button
                          onClick={(e) => handleToggleBookmark(e, image)}
                          className={`rounded-lg p-1.5 shadow-sm transition-colors ${
                            image.isBookmarked
                              ? 'bg-pink-500 text-white'
                              : 'bg-white/90 text-gray-600 hover:bg-white hover:text-pink-600'
                          }`}
                          title={
                            image.isBookmarked
                              ? t('aiImage.actions.unbookmark')
                              : t('aiImage.actions.bookmark')
                          }
                        >
                          <svg
                            className="h-4 w-4"
                            fill={image.isBookmarked ? 'currentColor' : 'none'}
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                            />
                          </svg>
                        </button>
                        <button
                          onClick={(e) => handleDelete(e, image.id)}
                          className="rounded-lg bg-white/90 p-1.5 text-gray-600 shadow-sm hover:bg-white hover:text-red-600"
                          title={t('aiImage.actions.delete')}
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
                      </div>

                      {/* Bottom info overlay - inside the image */}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/40 to-transparent p-3 pt-8">
                        <p className="line-clamp-1 text-xs font-medium text-white/90">
                          {image.prompt}
                        </p>
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-[10px] text-white/60">
                            {image.width} × {image.height}
                          </span>
                          <span className="text-[10px] text-white/60">
                            <ClientDate
                              date={image.createdAt}
                              format="relative"
                            />
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Create New Card */}
              <CreateCard
                title={t('aiImage.createNew')}
                onClick={() => router.push('/ai-image/create')}
                className="aspect-square"
              />
            </div>
          )}
        </div>
      </main>

      {/* Share Modal */}
      {shareImage && (
        <ShareModal
          isOpen={!!shareImage}
          onClose={() => setShareImage(null)}
          shareUrl={`${typeof window !== 'undefined' ? window.location.origin : ''}/share/image/${shareImage.id}`}
          title={shareImage.prompt}
          description={shareImage.enhancedPrompt}
          imageUrl={shareImage.imageUrl}
        />
      )}
    </AppShell>
  );
}
