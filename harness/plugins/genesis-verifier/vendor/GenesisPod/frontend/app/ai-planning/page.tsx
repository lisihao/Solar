'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useAiPlanningStore } from '@/stores/aiPlanningStore';
import AppShell from '@/components/layout/AppShell';
import CreatePlanDialog from '@/components/ai-planning/CreatePlanDialog';
import { useTranslation } from '@/lib/i18n';
import { toast, confirm } from '@/stores';
import type { PlanSummary } from '@/services/ai-planning/api';
import { setVisibility } from '@/services/ai-planning/api';
import { PHASE_KEYS } from '@/lib/constants/ai-planning';
import {
  AssetCard,
  type AssetCardBadge,
  type AssetVisibility,
  type AssetVisibilityOption,
} from '@/components/ui/cards/asset-card';
import { Globe, Lock, Users, Lightbulb, Plus } from 'lucide-react';
import { CreateCard } from '@/components/ui/cards/CreateCard';
import { PageHeaderHero } from '@/components/ui/page-header-hero';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { LoadingState } from '@/components/ui/states';

const PLAN_GRADIENTS = [
  'from-amber-500 to-orange-600',
  'from-violet-500 to-purple-600',
  'from-blue-500 to-cyan-600',
  'from-emerald-500 to-teal-600',
  'from-rose-500 to-pink-600',
  'from-indigo-500 to-blue-600',
  'from-fuchsia-500 to-pink-600',
  'from-cyan-500 to-blue-600',
];

function getPlanGradient(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return PLAN_GRADIENTS[Math.abs(hash) % PLAN_GRADIENTS.length];
}

const VISIBILITY_OPTIONS: Record<AssetVisibility, AssetVisibilityOption> = {
  PRIVATE: {
    value: 'PRIVATE',
    label: '私有',
    icon: <Lock className="h-3 w-3" />,
    className: 'bg-gray-100 text-gray-600',
  },
  SHARED: {
    value: 'SHARED',
    label: '共享',
    icon: <Users className="h-3 w-3" />,
    className: 'bg-blue-100 text-blue-600',
  },
  PUBLIC: {
    value: 'PUBLIC',
    label: '公开',
    icon: <Globe className="h-3 w-3" />,
    className: 'bg-green-100 text-green-600',
  },
};

export default function AiPlanningPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, accessToken, isLoading: authLoading } = useAuth();
  const {
    plans,
    templates,
    isLoadingPlans,
    isCreating,
    fetchPlans,
    fetchTemplates,
    createPlan,
    updatePlan,
    deletePlan,
  } = useAiPlanningStore();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingPlan, setEditingPlan] = useState<PlanSummary | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const isAuthenticated = !!accessToken;

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      fetchPlans();
      fetchTemplates();
    }
  }, [authLoading, isAuthenticated, fetchPlans, fetchTemplates]);

  const filteredPlans = (plans || []).filter((plan) => {
    if (!searchQuery) return true;
    return (
      plan.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      plan.goal.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  const handleCreate = async (data: Parameters<typeof createPlan>[0]) => {
    try {
      const planId = await createPlan(data);
      setShowCreateDialog(false);
      router.push(`/ai-planning/${planId}`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t('aiPlanning.error.createFailed')
      );
    }
  };

  const handleEdit = async (
    planId: string,
    data: { name?: string; goal?: string }
  ) => {
    try {
      await updatePlan(planId, data);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t('aiPlanning.error.updateFailed')
      );
    }
  };

  const handleDelete = async (planId: string) => {
    if (
      !(await confirm({ title: t('aiPlanning.confirmDelete'), type: 'danger' }))
    )
      return;
    try {
      await deletePlan(planId);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t('aiPlanning.error.deleteFailed')
      );
    }
  };

  const handleVisibilityChange = async (
    planId: string,
    next: 'PRIVATE' | 'SHARED' | 'PUBLIC'
  ) => {
    try {
      await setVisibility(planId, next);
      void fetchPlans();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新可见性失败');
    }
  };

  if (authLoading) {
    return (
      <AppShell>
        <LoadingState />
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
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>
          <h2 className="text-xl font-semibold text-gray-700">
            {t('aiPlanning.signIn')}
          </h2>
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
            title={t('aiPlanning.title')}
            subtitle={t('aiPlanning.subtitle')}
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
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
              </svg>
            }
            iconGradient="from-amber-500 to-orange-600"
            iconShadowClass="shadow-amber-500/25"
            actions={
              <button
                onClick={() => setShowCreateDialog(true)}
                className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-amber-700"
              >
                <Plus className="h-5 w-5" />
                {t('aiPlanning.newPlan')}
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
                placeholder={t('aiPlanning.search.plans')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-12 pr-4 text-sm outline-none transition-all focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
              />
            </div>
          </PageHeaderHero>
        </div>

        {/* Content */}
        <div className="px-8 py-6">
          {isLoadingPlans ? (
            <LoadingState />
          ) : filteredPlans.length === 0 ? (
            <EmptyState
              icon={<Lightbulb className="h-12 w-12" />}
              title={t('aiPlanning.empty.noPlans')}
              description={t('aiPlanning.empty.noPlansDesc')}
              action={{
                label: t('aiPlanning.newPlan'),
                onClick: () => setShowCreateDialog(true),
              }}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredPlans.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  onClick={() => router.push(`/ai-planning/${plan.id}`)}
                  onEditClick={() => setEditingPlan(plan)}
                  onDelete={() => handleDelete(plan.id)}
                  onVisibilityChange={(next) =>
                    void handleVisibilityChange(plan.id, next)
                  }
                />
              ))}

              {/* Create New Card */}
              <CreateCard
                title={t('aiPlanning.newPlan')}
                onClick={() => setShowCreateDialog(true)}
              />
            </div>
          )}
        </div>
      </main>

      {showCreateDialog && (
        <CreatePlanDialog
          templates={templates}
          onClose={() => setShowCreateDialog(false)}
          onCreate={handleCreate}
          isCreating={isCreating}
        />
      )}

      {editingPlan && (
        <CreatePlanDialog
          templates={templates}
          onClose={() => setEditingPlan(null)}
          onCreate={handleCreate}
          isCreating={isCreating}
          editMode={{
            name: editingPlan.name,
            goal: editingPlan.goal,
            onSave: async (data) => {
              await handleEdit(editingPlan.id, data);
              await fetchPlans();
            },
          }}
        />
      )}
    </AppShell>
  );
}

// Plan Card Component
function PlanCard({
  plan,
  onClick,
  onEditClick,
  onDelete,
  onVisibilityChange,
}: {
  plan: PlanSummary;
  onClick: () => void;
  onEditClick: () => void;
  onDelete: () => void;
  onVisibilityChange?: (next: AssetVisibility) => void;
}) {
  const { t } = useTranslation();

  const currentPhaseKey = PHASE_KEYS[plan.currentPhase] || '';
  const activePhase = Object.entries(plan.phaseStatus).find(
    ([, s]) => s.status === 'active'
  );
  const gradient = getPlanGradient(plan.id);

  const phaseBadge: AssetCardBadge = {
    key: 'phase',
    label: `${t('aiPlanning.card.phase')} ${plan.currentPhase}${t('aiPlanning.card.of')}${plan.totalPhases}`,
    className: activePhase
      ? 'bg-amber-100 text-amber-700'
      : 'bg-gray-100 text-gray-600',
  };

  return (
    <AssetCard
      title={plan.name}
      description={plan.goal}
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
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
          />
        </svg>
      }
      gradient={gradient}
      badges={[phaseBadge]}
      isOwner
      visibility={plan.visibility ?? 'PRIVATE'}
      visibilityOptions={VISIBILITY_OPTIONS}
      visibilityToggleCycle={['PRIVATE', 'SHARED', 'PUBLIC']}
      onVisibilityToggle={onVisibilityChange}
      onEdit={onEditClick}
      onDelete={onDelete}
      onClick={onClick}
      customSection={
        <div>
          <div className="flex items-center gap-1.5">
            {[1, 2, 3, 4, 5, 6].map((phase) => {
              const status = plan.phaseStatus[phase]?.status || 'pending';
              return (
                <div
                  key={phase}
                  className={`h-1.5 flex-1 rounded-full ${
                    status === 'completed'
                      ? 'bg-green-400'
                      : status === 'active'
                        ? 'animate-pulse bg-amber-400'
                        : 'bg-gray-200'
                  }`}
                />
              );
            })}
          </div>
          {activePhase && currentPhaseKey && (
            <p className="mt-1.5 text-xs text-amber-600">
              · {t(`aiPlanning.phases.${currentPhaseKey}`)}
            </p>
          )}
        </div>
      }
      stats={[
        {
          key: 'members',
          icon: <Users className="h-3.5 w-3.5" />,
          text: `${plan.memberCount} AI`,
        },
      ]}
      timestamp={plan.updatedAt}
    />
  );
}
