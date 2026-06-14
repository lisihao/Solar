'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/lib/i18n';
import { useAIWritingStore, confirm } from '@/stores';
import {
  getStylePresets,
  type WritingStylePreset,
} from '@/services/ai-writing/api';
import { WRITING_AGENT_REGISTRY } from '@/lib/features/ai-writing/agent-config';
import ShareModal from '@/components/common/dialogs/ShareModal';
import { SkillsModal } from '@/components/common/skills/SkillsModal';
import {
  AssetCard,
  type AssetVisibility,
  type AssetVisibilityOption,
} from '@/components/ui/cards/asset-card';
import {
  FileText,
  Globe,
  Lock,
  PenLine,
  Pencil,
  Sparkles,
  Plus,
} from 'lucide-react';
import { CreateCard } from '@/components/ui/cards/CreateCard';
import { PageHeaderHero } from '@/components/ui/page-header-hero';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { LoadingState } from '@/components/ui';
import { Modal } from '@/components/ui/dialogs/Modal';

// AI Writing Team - Preview (5 core agents) - 使用统一配置
const AI_TEAM_PREVIEW = Object.values(WRITING_AGENT_REGISTRY)
  .filter((agent) => !agent.supportsMultiInstance || agent.id === 'writer')
  .map((agent) => ({
    id: agent.id,
    icon: agent.icon,
    name: agent.nameCn,
    color: agent.gradient,
  }));

// Genre options - will be translated dynamically
const GENRE_KEYS = [
  'NOVEL',
  'SHORT_STORY',
  'FANTASY',
  'SCIFI',
  'ROMANCE',
  'MYSTERY',
  'OTHER',
] as const;

// Word count options - will be translated dynamically
const WORD_COUNT_VALUES = [
  10000, 30000, 50000, 100000, 200000, 500000, 1000000,
] as const;

// Style category keys - will be translated dynamically
const STYLE_CATEGORY_KEYS = [
  'chinese_martial_arts',
  'chinese_web_novel',
  'foreign',
  'custom',
] as const;

// Vibrant gradient color schemes for project cards
const PROJECT_GRADIENTS = [
  {
    from: 'from-amber-500',
    to: 'to-orange-600',
    shadow: 'shadow-amber-500/30',
  },
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
  { from: 'from-pink-500', to: 'to-rose-500', shadow: 'shadow-pink-500/30' },
  {
    from: 'from-indigo-500',
    to: 'to-blue-600',
    shadow: 'shadow-indigo-500/30',
  },
  {
    from: 'from-fuchsia-500',
    to: 'to-pink-500',
    shadow: 'shadow-fuchsia-500/30',
  },
  { from: 'from-cyan-500', to: 'to-blue-500', shadow: 'shadow-cyan-500/30' },
];

function getProjectGradient(projectId: string) {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    hash = (hash << 5) - hash + projectId.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % PROJECT_GRADIENTS.length;
  return PROJECT_GRADIENTS[index];
}

export default function AIWritingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const processedParamsRef = useRef(false);
  const { user, isLoading: authLoading } = useAuth();
  const { t } = useTranslation();
  const {
    projects,
    isLoadingProjects,
    fetchProjects,
    createProject,
    updateProject,
    deleteProject,
  } = useAIWritingStore();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createForm, setCreateForm] = useState({
    description: '',
    genre: 'NOVEL',
    targetWords: 50000,
    writingStyle: '', // 写作风格预设ID
  });
  const [isCreating, setIsCreating] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Style presets
  const [stylePresets, setStylePresets] = useState<WritingStylePreset[]>([]);
  const [isLoadingStyles, setIsLoadingStyles] = useState(false);

  // Edit modal state
  const [editingProject, setEditingProject] = useState<
    (typeof projects)[0] | null
  >(null);
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    genre: '',
    targetWords: 50000,
    writingStyle: '',
  });
  const [isEditing, setIsEditing] = useState(false);

  // Share modal state
  const [shareProject, setShareProject] = useState<(typeof projects)[0] | null>(
    null
  );

  // Skills modal state
  const [showSkillsModal, setShowSkillsModal] = useState(false);

  useEffect(() => {
    if (user) {
      void fetchProjects();
    }
  }, [user, fetchProjects]);

  // ?q=xxx — from Global AI Bar or ActionCards
  useEffect(() => {
    if (processedParamsRef.current) return;
    const q = searchParams?.get('q');
    if (!q?.trim()) return;
    processedParamsRef.current = true;
    setCreateForm((prev) => ({ ...prev, description: q.trim() }));
    setShowCreateDialog(true);
  }, [searchParams]); // searchParams may be null on first SSR render, re-run when populated

  // Fetch style presets when dialog opens (create or edit)
  useEffect(() => {
    const dialogOpen = showCreateDialog || editingProject !== null;
    if (dialogOpen && stylePresets.length === 0 && !isLoadingStyles) {
      setIsLoadingStyles(true);
      getStylePresets()
        .then((res) => {
          setStylePresets(res.presets || []);
        })
        .catch(() => {
          // Ignore errors
        })
        .finally(() => {
          setIsLoadingStyles(false);
        });
    }
  }, [showCreateDialog, editingProject, stylePresets.length, isLoadingStyles]);

  const handleCreate = async () => {
    if (!createForm.description.trim()) return;

    setIsCreating(true);
    try {
      // Extract title from first line or first 30 chars
      const firstLine = createForm.description.split('\n')[0];
      const title =
        firstLine.length > 30 ? firstLine.slice(0, 30) + '...' : firstLine;

      const project = await createProject({
        name: title,
        description: createForm.description,
        genre: createForm.genre,
        targetWords: createForm.targetWords,
        writingStyle: createForm.writingStyle || undefined,
      });
      setShowCreateDialog(false);
      setCreateForm({
        description: '',
        genre: 'NOVEL',
        targetWords: 50000,
        writingStyle: '',
      });
      router.push(`/ai-writing/${project.id}`);
    } catch {
      // Error handled by store
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    if (
      await confirm({
        title: t('aiWriting.actions.confirmDelete'),
        type: 'danger',
      })
    ) {
      await deleteProject(projectId);
    }
  };

  const handleShare = (e: React.MouseEvent, project: (typeof projects)[0]) => {
    e.stopPropagation();
    setShareProject(project);
  };

  const handleEdit = (e: React.MouseEvent, project: (typeof projects)[0]) => {
    e.stopPropagation();
    setEditingProject(project);
    setEditForm({
      name: project.name,
      description: project.description || '',
      genre: project.genre || 'NOVEL',
      targetWords: project.targetWords || 50000,
      writingStyle: project.writingStyle || '',
    });
  };

  const handleSaveEdit = async () => {
    if (!editingProject) return;
    setIsEditing(true);
    try {
      await updateProject(editingProject.id, editForm);
      setEditingProject(null);
    } catch {
      // Error handled by store
    } finally {
      setIsEditing(false);
    }
  };

  const getGenreLabel = (genre: string) => {
    const genreKey = genre.toLowerCase().replace('_', '');
    return t(`aiWriting.genres.${genreKey}` as never) || genre;
  };

  const getStatusBadge = (status: string) => {
    const statusKey = status.toLowerCase();
    const label = t(`aiWriting.status.${statusKey}` as never);
    const colorConfig: Record<string, string> = {
      PLANNING: 'bg-purple-100 text-purple-700',
      OUTLINING: 'bg-blue-100 text-blue-700',
      WRITING: 'bg-amber-100 text-amber-700',
      REVISING: 'bg-orange-100 text-orange-700',
      COMPLETED: 'bg-green-100 text-green-700',
    };
    return {
      label,
      color: colorConfig[status] || 'bg-gray-100 text-gray-600',
    };
  };

  // Removed formatTime function - using ClientDate component instead

  // Filter projects by search query
  const filteredProjects = projects.filter((project) => {
    if (!searchQuery) return true;
    return (
      project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      project.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  if (authLoading) {
    return (
      <AppShell>
        <div className="flex flex-1 items-center justify-center">
          <LoadingState size="lg" />
        </div>
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
              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
            />
          </svg>
          <h2 className="text-xl font-semibold text-gray-700">
            {t('aiWriting.signIn.title')}
          </h2>
          <p className="text-gray-500">{t('aiWriting.signIn.description')}</p>
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
            title={t('aiWriting.title')}
            subtitle={t('aiWriting.subtitle', { count: 5 })}
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
                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                />
              </svg>
            }
            iconGradient="from-amber-500 to-orange-600"
            iconShadowClass="shadow-amber-500/25"
            actions={
              <>
                <button
                  onClick={() => setShowSkillsModal(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
                  title={t('aiWriting.skills.title') || 'AI Writing Skills'}
                >
                  <Sparkles className="h-4 w-4 text-amber-500" />
                </button>
                <button
                  onClick={() => setShowCreateDialog(true)}
                  className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-amber-700"
                >
                  <Plus className="h-5 w-5" />
                  {t('aiWriting.createDialog.startCreating')}
                </button>
              </>
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
                placeholder={t('aiWriting.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-12 pr-4 text-sm outline-none transition-all focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
              />
            </div>
          </PageHeaderHero>
        </div>

        {/* Content */}
        <div className="px-8 py-6">
          {isLoadingProjects ? (
            <LoadingState size="lg" />
          ) : filteredProjects.length === 0 && !searchQuery ? (
            <EmptyState
              icon={<Pencil className="h-12 w-12" />}
              title={t('aiWriting.empty.noProjects')}
              description={t('aiWriting.empty.noProjectsDesc')}
              action={{
                label: t('aiWriting.createDialog.startCreating'),
                onClick: () => setShowCreateDialog(true),
              }}
            />
          ) : filteredProjects.length === 0 && searchQuery ? (
            <EmptyState
              type="search"
              title={t('aiWriting.noResults.title')}
              description={t('aiWriting.noResults.description')}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredProjects.map((project) => {
                const status = getStatusBadge(project.status);
                const gradient = getProjectGradient(project.id);
                const visibilityOptions: Record<
                  AssetVisibility,
                  AssetVisibilityOption
                > = {
                  PRIVATE: {
                    value: 'PRIVATE',
                    label: t('aiWriting.visibility.private'),
                    icon: <Lock className="h-3 w-3" />,
                    className: 'bg-gray-100 text-gray-600',
                  },
                  SHARED: {
                    value: 'SHARED',
                    label: t('aiWriting.visibility.private'),
                    icon: <Lock className="h-3 w-3" />,
                    className: 'bg-blue-100 text-blue-600',
                  },
                  PUBLIC: {
                    value: 'PUBLIC',
                    label: t('aiWriting.visibility.public'),
                    icon: <Globe className="h-3 w-3" />,
                    className: 'bg-green-100 text-green-600',
                  },
                };

                return (
                  <AssetCard
                    key={project.id}
                    title={project.name}
                    description={project.description}
                    icon={<PenLine className="h-6 w-6 text-white" />}
                    gradient={`${gradient.from} ${gradient.to}`}
                    badges={[
                      {
                        key: 'genre',
                        label: getGenreLabel(project.genre || 'NOVEL'),
                        className: 'bg-gray-100 text-gray-600',
                      },
                      {
                        key: 'status',
                        label: status.label,
                        className: status.color,
                      },
                    ]}
                    visibility={
                      project.visibility as AssetVisibility | undefined
                    }
                    visibilityOptions={visibilityOptions}
                    isOwner
                    onVisibilityToggle={(next) => {
                      if (next !== 'SHARED') {
                        void updateProject(project.id, { visibility: next });
                      }
                    }}
                    visibilityToggleCycle={['PRIVATE', 'PUBLIC']}
                    onShareToSocial={() => {
                      handleShare(
                        { stopPropagation: () => {} } as React.MouseEvent,
                        project
                      );
                    }}
                    onEdit={() => {
                      handleEdit(
                        { stopPropagation: () => {} } as React.MouseEvent,
                        project
                      );
                    }}
                    onDelete={() => {
                      void handleDelete(
                        { stopPropagation: () => {} } as React.MouseEvent,
                        project.id
                      );
                    }}
                    onClick={() => router.push(`/ai-writing/${project.id}`)}
                    stats={[
                      {
                        key: 'words',
                        icon: <FileText className="h-3.5 w-3.5" />,
                        text: `${project.currentWords} / ${project.targetWords} ${t('aiWriting.unit.words')}`,
                      },
                    ]}
                    progress={
                      project.targetWords > 0
                        ? {
                            current: project.currentWords,
                            total: project.targetWords,
                            gradient: 'from-amber-400 to-orange-400',
                          }
                        : undefined
                    }
                    timestamp={project.updatedAt}
                    labels={{
                      setPrivate: t('aiWriting.visibility.private'),
                      setPublic: t('aiWriting.visibility.public'),
                      shareToSocial: t('share.shareWriting'),
                      edit: t('aiWriting.actions.edit'),
                      delete: t('aiWriting.actions.delete'),
                    }}
                  />
                );
              })}

              {/* Create New Card */}
              <CreateCard
                title={t('aiWriting.createDialog.title')}
                onClick={() => setShowCreateDialog(true)}
              />
            </div>
          )}
        </div>
      </main>

      {/* Create Dialog */}
      <Modal
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        title={t('aiWriting.createDialog.title')}
        size="md"
        contentClassName="space-y-4"
        footer={
          <>
            <button
              onClick={() => setShowCreateDialog(false)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {t('aiWriting.createDialog.cancel')}
            </button>
            <button
              onClick={handleCreate}
              disabled={!createForm.description.trim() || isCreating}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCreating
                ? t('aiWriting.createDialog.creating')
                : t('aiWriting.createDialog.startCreating')}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              {t('aiWriting.createDialog.whatToWrite')}
            </label>
            <textarea
              value={createForm.description}
              onChange={(e) =>
                setCreateForm({
                  ...createForm,
                  description: e.target.value,
                })
              }
              placeholder={t('aiWriting.createDialog.placeholder')}
              rows={5}
              className="mt-1 w-full resize-none rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              autoFocus
            />
          </div>

          {/* Options Toggle */}
          <button
            type="button"
            onClick={() => setShowOptions(!showOptions)}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
          >
            <svg
              className={`h-4 w-4 transition-transform ${showOptions ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
            {t('aiWriting.createDialog.optionalSettings')}
          </button>

          {/* Options */}
          {showOptions && (
            <div className="space-y-4 rounded-xl bg-gray-50 p-4">
              {/* Row 1: Genre and Word Count */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-500">
                    {t('aiWriting.createDialog.genre')}
                  </label>
                  <select
                    value={createForm.genre}
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        genre: e.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
                  >
                    {GENRE_KEYS.map((key) => (
                      <option key={key} value={key}>
                        {t(
                          `aiWriting.genres.${key.toLowerCase().replace('_', '')}` as never
                        )}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-500">
                    {t('aiWriting.createDialog.estimatedWords')}
                  </label>
                  <select
                    value={createForm.targetWords}
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        targetWords: Number(e.target.value),
                      })
                    }
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
                  >
                    {WORD_COUNT_VALUES.map((value) => {
                      const key =
                        value >= 1000000
                          ? '1000k'
                          : value >= 500000
                            ? '500k'
                            : value >= 200000
                              ? '200k'
                              : value >= 100000
                                ? '100k'
                                : value >= 50000
                                  ? '50k'
                                  : value >= 30000
                                    ? '30k'
                                    : '10k';
                      return (
                        <option key={value} value={value}>
                          {t(`aiWriting.wordCounts.${key}`)}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              {/* Row 2: Writing Style (full width) */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500">
                  {t('aiWriting.createDialog.writingStyle')}
                </label>
                <select
                  value={createForm.writingStyle}
                  onChange={(e) =>
                    setCreateForm({
                      ...createForm,
                      writingStyle: e.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
                  disabled={isLoadingStyles}
                >
                  <option value="">
                    {t('aiWriting.createDialog.autoRecommend')}
                  </option>
                  {/* Group by category */}
                  {STYLE_CATEGORY_KEYS.map((category) => {
                    const presetsInCategory = stylePresets.filter(
                      (p) => p.category === category
                    );
                    if (presetsInCategory.length === 0) return null;
                    const categoryKey =
                      category === 'chinese_martial_arts'
                        ? 'chineseMartialArts'
                        : category === 'chinese_web_novel'
                          ? 'chineseWebNovel'
                          : category;
                    return (
                      <optgroup
                        key={category}
                        label={t(
                          `aiWriting.styleCategories.${categoryKey}` as never
                        )}
                      >
                        {presetsInCategory.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.name} - {preset.description}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
                {createForm.writingStyle && (
                  <p className="mt-1.5 text-xs text-gray-500">
                    {
                      stylePresets.find((p) => p.id === createForm.writingStyle)
                        ?.representative
                    }
                  </p>
                )}
              </div>
            </div>
          )}

          {/* AI Team Preview */}
          <div className="rounded-xl bg-amber-50 p-4">
            <p className="mb-3 text-xs font-medium text-amber-700">
              {t('aiWriting.team.title')}
            </p>
            <div className="flex items-center gap-3">
              {AI_TEAM_PREVIEW.map((agent) => (
                <div key={agent.id} className="flex flex-col items-center">
                  <span
                    className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${agent.color} text-lg shadow-sm`}
                  >
                    {agent.icon}
                  </span>
                  <span className="mt-1 text-xs text-gray-500">
                    {agent.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      {/* Edit Dialog */}
      <Modal
        open={!!editingProject}
        onClose={() => setEditingProject(null)}
        title={t('aiWriting.editDialog.title')}
        size="md"
        contentClassName="space-y-4"
        footer={
          <>
            <button
              onClick={() => setEditingProject(null)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {t('aiWriting.createDialog.cancel')}
            </button>
            <button
              onClick={handleSaveEdit}
              disabled={!editForm.name.trim() || isEditing}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isEditing
                ? t('aiWriting.editDialog.saving')
                : t('aiWriting.editDialog.save')}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              {t('aiWriting.editDialog.workName')}
            </label>
            <input
              type="text"
              value={editForm.name}
              onChange={(e) =>
                setEditForm({ ...editForm, name: e.target.value })
              }
              className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              {t('aiWriting.editDialog.workDescription')}
            </label>
            <textarea
              value={editForm.description}
              onChange={(e) =>
                setEditForm({ ...editForm, description: e.target.value })
              }
              rows={4}
              className="mt-1 w-full resize-none rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>

          {/* Options */}
          <div className="space-y-4 rounded-xl bg-gray-50 p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500">
                  {t('aiWriting.createDialog.genre')}
                </label>
                <select
                  value={editForm.genre}
                  onChange={(e) =>
                    setEditForm({ ...editForm, genre: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
                >
                  {GENRE_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {t(
                        `aiWriting.genres.${key.toLowerCase().replace('_', '')}` as never
                      )}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500">
                  {t('aiWriting.editDialog.targetWords')}
                </label>
                <select
                  value={editForm.targetWords}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      targetWords: Number(e.target.value),
                    })
                  }
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
                >
                  {WORD_COUNT_VALUES.map((value) => {
                    const key =
                      value >= 1000000
                        ? '1000k'
                        : value >= 500000
                          ? '500k'
                          : value >= 200000
                            ? '200k'
                            : value >= 100000
                              ? '100k'
                              : value >= 50000
                                ? '50k'
                                : value >= 30000
                                  ? '30k'
                                  : '10k';
                    return (
                      <option key={value} value={value}>
                        {t(`aiWriting.wordCounts.${key}`)}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            {/* Writing Style */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">
                {t('aiWriting.createDialog.writingStyle')}
              </label>
              <select
                value={editForm.writingStyle}
                onChange={(e) =>
                  setEditForm({ ...editForm, writingStyle: e.target.value })
                }
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
                disabled={isLoadingStyles}
              >
                <option value="">
                  {t('aiWriting.createDialog.autoRecommend')}
                </option>
                {STYLE_CATEGORY_KEYS.map((category) => {
                  const presetsInCategory = stylePresets.filter(
                    (p) => p.category === category
                  );
                  if (presetsInCategory.length === 0) return null;
                  const categoryKey =
                    category === 'chinese_martial_arts'
                      ? 'chineseMartialArts'
                      : category === 'chinese_web_novel'
                        ? 'chineseWebNovel'
                        : category;
                  return (
                    <optgroup
                      key={category}
                      label={t(
                        `aiWriting.styleCategories.${categoryKey}` as never
                      )}
                    >
                      {presetsInCategory.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.name} - {preset.description}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
              {editForm.writingStyle && (
                <p className="mt-1.5 text-xs text-gray-500">
                  {
                    stylePresets.find((p) => p.id === editForm.writingStyle)
                      ?.representative
                  }
                </p>
              )}
            </div>
          </div>
        </div>
      </Modal>

      {/* Share Modal */}
      {shareProject && (
        <ShareModal
          isOpen={!!shareProject}
          onClose={() => setShareProject(null)}
          shareUrl={`${typeof window !== 'undefined' ? window.location.origin : ''}/share/writing/${shareProject.id}`}
          title={shareProject.name}
          description={shareProject.description}
        />
      )}

      {/* Skills Modal */}
      <SkillsModal
        open={showSkillsModal}
        onClose={() => setShowSkillsModal(false)}
        domain="writing"
        title={t('aiWriting.skills.title') || 'AI Writing Skills'}
        accentColor="text-amber-500"
      />
    </AppShell>
  );
}
