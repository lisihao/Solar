'use client';

/**
 * AI Research - 专项研究项目列表页
 * Fetches projects from AI Studio API and displays as card grid
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  Suspense,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslation } from '@/lib/i18n';
import { useAuth } from '@/contexts/AuthContext';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';
import { CreateProjectDialog } from '@/components/ai-research/CreateProjectDialog';
import { RenameProjectDialog } from '@/components/ai-research/RenameProjectDialog';
import { DeleteProjectDialog } from '@/components/ai-research/DeleteProjectDialog';
import {
  AssetCard,
  type AssetVisibility,
  type AssetVisibilityOption,
} from '@/components/ui/cards/asset-card';
import { FileText, Globe, Lock, FileSearch, Plus } from 'lucide-react';
import { CreateCard } from '@/components/ui/cards/CreateCard';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { PageHeaderHero } from '@/components/ui/page-header-hero';

interface ResearchProject {
  id: string;
  name: string;
  description?: string;
  status: string;
  visibility?: string;
  userId?: string;
  sourcesCount?: number;
  notesCount?: number;
  createdAt: string;
  updatedAt: string;
}

// Gradient color schemes for project cards
const PROJECT_GRADIENTS = [
  {
    from: 'from-indigo-500',
    to: 'to-blue-600',
    shadow: 'shadow-indigo-500/30',
  },
  {
    from: 'from-violet-500',
    to: 'to-purple-600',
    shadow: 'shadow-violet-500/30',
  },
  {
    from: 'from-emerald-500',
    to: 'to-teal-500',
    shadow: 'shadow-emerald-500/30',
  },
  { from: 'from-blue-500', to: 'to-cyan-500', shadow: 'shadow-blue-500/30' },
  {
    from: 'from-fuchsia-500',
    to: 'to-pink-500',
    shadow: 'shadow-fuchsia-500/30',
  },
  {
    from: 'from-amber-500',
    to: 'to-orange-600',
    shadow: 'shadow-amber-500/30',
  },
  { from: 'from-cyan-500', to: 'to-blue-500', shadow: 'shadow-cyan-500/30' },
  { from: 'from-pink-500', to: 'to-rose-500', shadow: 'shadow-pink-500/30' },
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

function ResearchPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const processedParamsRef = useRef(false);
  const { t } = useTranslation();
  const { user, isLoading: authLoading } = useAuth();

  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [crossModuleSource, setCrossModuleSource] = useState<{
    fromTopicId: string;
    contextTitle: string;
    contextSummary?: string;
  } | null>(null);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [renameProject, setRenameProject] = useState<ResearchProject | null>(
    null
  );
  const [renameName, setRenameName] = useState('');
  const [deleteProject, setDeleteProject] = useState<ResearchProject | null>(
    null
  );

  const fetchProjects = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/ai-studio/projects?status=ACTIVE`,
        {
          headers: getAuthHeader(),
        }
      );
      if (!response.ok) {
        throw new Error('Failed to fetch projects');
      }
      const result = await response.json();
      const data = result?.data ?? result;
      // Unwrap: interceptor wraps service { data: projects, pagination } →
      // response is { success, data: { data: [...], pagination }, metadata }
      const projectsArray = Array.isArray(data)
        ? data
        : Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data?.projects)
            ? data.projects
            : Array.isArray(data?.items)
              ? data.items
              : [];
      setProjects(projectsArray);
    } catch (err) {
      logger.error('Error fetching research projects:', err);
      setError(t('common.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  const openCreateDialog = useCallback(() => {
    setNewProjectName('');
    setShowCreateDialog(true);
  }, []);

  const createProject = useCallback(
    async (name: string) => {
      if (isCreating) return;
      const trimmedName = name.trim();
      if (!trimmedName) return;
      setIsCreating(true);
      setShowCreateDialog(false);
      try {
        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/ai-studio/projects`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...getAuthHeader(),
            },
            body: JSON.stringify({
              name: trimmedName,
              ...(crossModuleSource && {
                crossModuleSource: {
                  module: 'topic-insights',
                  sourceId: crossModuleSource.fromTopicId,
                  contextTitle: crossModuleSource.contextTitle,
                  contextSummary: crossModuleSource.contextSummary,
                  linkedAt: new Date().toISOString(),
                },
              }),
            }),
          }
        );
        if (!response.ok) {
          throw new Error('Failed to create project');
        }
        const result = await response.json();
        const project = result?.data ?? result;
        router.push(`/ai-research/${project.id}`);
      } catch (err) {
        logger.error('Error creating research project:', err);
        setError(t('common.loadError'));
      } finally {
        setIsCreating(false);
      }
    },
    [isCreating, t, router, crossModuleSource]
  );

  const handleRename = useCallback(
    async (projectId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      try {
        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/ai-studio/projects/${projectId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({ name: trimmed }),
          }
        );
        if (!response.ok) throw new Error('Failed to rename project');
        setProjects((prev) =>
          prev.map((p) => (p.id === projectId ? { ...p, name: trimmed } : p))
        );
      } catch (err) {
        logger.error('Error renaming project:', err);
        setError(t('common.loadError'));
      } finally {
        setRenameProject(null);
      }
    },
    [t]
  );

  const handleDelete = useCallback(
    async (projectId: string) => {
      try {
        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/ai-studio/projects/${projectId}`,
          {
            method: 'DELETE',
            headers: getAuthHeader(),
          }
        );
        if (!response.ok) throw new Error('Failed to delete project');
        setProjects((prev) => prev.filter((p) => p.id !== projectId));
      } catch (err) {
        logger.error('Error deleting project:', err);
        setError(t('common.loadError'));
      } finally {
        setDeleteProject(null);
      }
    },
    [t]
  );

  const handleToggleVisibility = useCallback(
    async (project: ResearchProject) => {
      const newVisibility =
        project.visibility === 'PUBLIC' ? 'PRIVATE' : 'PUBLIC';
      try {
        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/ai-studio/projects/${project.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({ visibility: newVisibility }),
          }
        );
        if (!response.ok) throw new Error('Failed to update visibility');
        setProjects((prev) =>
          prev.map((p) =>
            p.id === project.id ? { ...p, visibility: newVisibility } : p
          )
        );
      } catch (err) {
        logger.error('Error toggling project visibility:', err);
        setError(t('common.loadError'));
      }
    },
    [t]
  );

  useEffect(() => {
    if (user) {
      void fetchProjects();
    }
  }, [user, fetchProjects]);

  // Read URL params on mount to support cross-module navigation pre-fill
  useEffect(() => {
    if (processedParamsRef.current) return;

    // ?q=xxx — from Global AI Bar or ActionCards
    const q = searchParams?.get('q');
    if (q?.trim()) {
      processedParamsRef.current = true;
      setNewProjectName(q.trim().slice(0, 200));
      setShowCreateDialog(true);
      return;
    }

    // ?action=create&fromTopicId=...&contextTitle=... — from Topic Insights
    const action = searchParams?.get('action');
    if (action !== 'create') return;

    const fromTopicId = searchParams?.get('fromTopicId');
    const contextTitle = searchParams?.get('contextTitle');
    const contextSummary = searchParams?.get('contextSummary') || undefined;

    if (!fromTopicId || !contextTitle) return;

    processedParamsRef.current = true;
    const prefilledName = `深入研究：${contextTitle}`.slice(0, 200);
    setNewProjectName(prefilledName);
    setCrossModuleSource({ fromTopicId, contextTitle, contextSummary });
    setShowCreateDialog(true);
  }, [searchParams]); // searchParams may be null on first SSR render, re-run when populated

  // Filter projects by search query
  const filteredProjects = useMemo(
    () =>
      projects.filter((project) => {
        if (!searchQuery) return true;
        const query = searchQuery.toLowerCase();
        return (
          project.name.toLowerCase().includes(query) ||
          project.description?.toLowerCase().includes(query)
        );
      }),
    [projects, searchQuery]
  );

  if (authLoading) {
    return <LoadingState />;
  }

  return (
    <div className="h-full overflow-auto bg-gray-50">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-gray-100 bg-white/80 backdrop-blur-sm">
        <PageHeaderHero
          title={t('aiResearch.title')}
          subtitle={t('aiResearch.subtitle')}
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
                d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
              />
            </svg>
          }
          iconGradient="from-indigo-500 to-blue-600"
          iconShadowClass="shadow-indigo-500/25"
          actions={
            <button
              onClick={openCreateDialog}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
            >
              <Plus className="h-5 w-5" />
              {t('aiResearch.newResearch')}
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
              placeholder={t('aiResearch.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-12 pr-4 text-sm outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
        </PageHeaderHero>
      </div>

      {/* Content */}
      <div className="px-8 py-6">
        {error && (
          <div className="mb-6 rounded-lg bg-red-50 p-4">
            <div className="flex items-center justify-between">
              <p className="text-red-600">{error}</p>
              <button
                onClick={() => setError('')}
                className="text-sm text-red-600 hover:underline"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <LoadingState />
        ) : filteredProjects.length === 0 && !searchQuery ? (
          <EmptyState
            icon={<FileSearch className="h-12 w-12" />}
            title={t('aiResearch.empty.noProjects')}
            description={t('aiResearch.empty.noProjectsDesc')}
            action={{
              label: t('aiResearch.empty.createFirst'),
              onClick: openCreateDialog,
            }}
          />
        ) : filteredProjects.length === 0 && searchQuery ? (
          <EmptyState type="search" title={t('common.noResults')} />
        ) : (
          /* Project Card Grid */
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredProjects.map((project) => {
              const gradient = getProjectGradient(project.id);
              const isOwner = !project.userId || project.userId === user?.id;
              const visibilityOptions: Record<
                AssetVisibility,
                AssetVisibilityOption
              > = {
                PRIVATE: {
                  value: 'PRIVATE',
                  label: t('aiResearch.visibility.private'),
                  icon: <Lock className="h-3 w-3" />,
                  className: 'bg-gray-100 text-gray-600',
                },
                SHARED: {
                  value: 'SHARED',
                  label: t('aiResearch.visibility.private'),
                  icon: <Lock className="h-3 w-3" />,
                  className: 'bg-blue-100 text-blue-600',
                },
                PUBLIC: {
                  value: 'PUBLIC',
                  label: t('aiResearch.visibility.public'),
                  icon: <Globe className="h-3 w-3" />,
                  className: 'bg-green-100 text-green-600',
                },
              };

              return (
                <AssetCard
                  key={project.id}
                  title={project.name}
                  description={project.description}
                  icon={
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
                        d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
                      />
                    </svg>
                  }
                  gradient={`${gradient.from} ${gradient.to}`}
                  visibility={project.visibility as AssetVisibility | undefined}
                  visibilityOptions={visibilityOptions}
                  isOwner={isOwner}
                  onVisibilityToggle={(next) => {
                    if (next !== 'SHARED') {
                      void handleToggleVisibility(project);
                    }
                  }}
                  visibilityToggleCycle={['PRIVATE', 'PUBLIC']}
                  onEdit={() => {
                    setRenameName(project.name);
                    setRenameProject(project);
                  }}
                  onDelete={() => setDeleteProject(project)}
                  onClick={() => router.push(`/ai-research/${project.id}`)}
                  stats={
                    project.sourcesCount !== undefined
                      ? [
                          {
                            key: 'sources',
                            icon: <FileText className="h-3.5 w-3.5" />,
                            text: t('aiResearch.project.sourcesCount', {
                              count: project.sourcesCount,
                            }),
                          },
                        ]
                      : []
                  }
                  timestamp={project.updatedAt || project.createdAt}
                  labels={{
                    setPrivate: t('aiResearch.visibility.setPrivate'),
                    setPublic: t('aiResearch.visibility.setPublic'),
                    edit: t('aiResearch.project.rename'),
                    delete: t('common.delete'),
                  }}
                />
              );
            })}

            {/* Create New Card */}
            <CreateCard
              title={t('aiResearch.newResearch')}
              onClick={openCreateDialog}
            />
          </div>
        )}
      </div>

      {/* Dialogs */}
      <CreateProjectDialog
        isOpen={showCreateDialog}
        isCreating={isCreating}
        projectName={newProjectName}
        onProjectNameChange={setNewProjectName}
        onConfirm={() => void createProject(newProjectName)}
        onClose={() => setShowCreateDialog(false)}
      />

      <RenameProjectDialog
        isOpen={renameProject !== null}
        originalName={renameProject?.name ?? ''}
        renameName={renameName}
        onRenameNameChange={setRenameName}
        onConfirm={() =>
          renameProject
            ? void handleRename(renameProject.id, renameName)
            : undefined
        }
        onClose={() => setRenameProject(null)}
      />

      <DeleteProjectDialog
        isOpen={deleteProject !== null}
        projectName={deleteProject?.name ?? ''}
        onConfirm={() =>
          deleteProject ? void handleDelete(deleteProject.id) : undefined
        }
        onClose={() => setDeleteProject(null)}
      />
    </div>
  );
}

export default function ResearchPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ResearchPageContent />
    </Suspense>
  );
}
