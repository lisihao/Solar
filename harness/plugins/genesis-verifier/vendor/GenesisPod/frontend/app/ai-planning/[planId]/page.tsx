'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft, Download, Settings } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAiPlanningStore } from '@/stores/aiPlanningStore';
import AppShell from '@/components/layout/AppShell';
import PlanPhaseBar from '@/components/ai-planning/PlanPhaseBar';
import { PlanTeamPanel } from '@/components/ai-planning/PlanTeamPanel';
import {
  PlanContentPanel,
  type PlanContentTabType,
} from '@/components/ai-planning/PlanContentPanel';
import { ExportDialog } from '@/components/common/dialogs/ExportDialog';
import PlanSettingsModal from '@/components/ai-planning/PlanSettingsModal';
import { useTranslation } from '@/lib/i18n';
import { toast, confirm } from '@/stores';
import { LoadingState } from '@/components/ui/states';

export default function PlanDetailPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams();
  const planId = params?.planId as string;

  const { accessToken, isLoading: authLoading } = useAuth();
  const {
    currentPlan,
    fetchPlanDetail,
    updatePlan,
    advancePhase,
    retryPhase,
    replanFromPhase,
    cancelPhase,
    deletePlan,
  } = useAiPlanningStore();

  const [isAdvancing, setIsAdvancing] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [phaseError, setPhaseError] = useState<string | null>(null);
  const [contentTab, setContentTab] = useState<PlanContentTabType>('phases');
  const [selectedPhase, setSelectedPhase] = useState<number | null>(null);

  const isAuthenticated = !!accessToken;

  useEffect(() => {
    if (!authLoading && isAuthenticated && planId) {
      fetchPlanDetail(planId);
    }
  }, [authLoading, isAuthenticated, planId, fetchPlanDetail]);

  // Stable polling: poll whenever plan is in-progress (not just when a phase is active).
  // Auto-advance creates a ~3s gap between phases where no phase is "active".
  // Without this broader condition, polling stops and never discovers the next phase starting.
  const shouldPoll = currentPlan
    ? (() => {
        if (currentPlan.currentPhase === 0) return false; // not started
        const statuses = Object.values(currentPlan.phaseStatus);
        const completedOrSkipped = statuses.filter(
          (s) => s.status === 'completed' || s.status === 'skipped'
        ).length;
        if (completedOrSkipped >= currentPlan.totalPhases) return false; // all done
        const currentPhaseStatus =
          currentPlan.phaseStatus[currentPlan.currentPhase];
        if (currentPhaseStatus?.status === 'failed') return false; // needs user action
        return true;
      })()
    : false;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    if (!planId || !shouldPoll) return;

    pollRef.current = setInterval(() => {
      fetchPlanDetail(planId).catch(() => {
        // Silently retry on next interval — prevents unhandled rejection
        // from freezing the UI when network/auth issues occur
      });
    }, 5000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [planId, shouldPoll, fetchPlanDetail]);

  const handleAdvance = async () => {
    if (!planId) return;
    setIsAdvancing(true);
    setPhaseError(null);
    try {
      await advancePhase(planId);
      toast.success(t('aiPlanning.actions.advanceSuccess'));
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : t('aiPlanning.error.advanceFailed');
      setPhaseError(msg);
      toast.error(msg);
    } finally {
      setIsAdvancing(false);
    }
  };

  const handleRetry = async (phase: number) => {
    if (!planId) return;
    setPhaseError(null);
    try {
      await retryPhase(planId, phase);
      toast.success(t('aiPlanning.actions.retrySuccess'));
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : t('aiPlanning.error.retryFailed');
      setPhaseError(msg);
      toast.error(msg);
    }
  };

  const handleReplan = async (startPhase: number) => {
    if (!planId) return;
    setPhaseError(null);
    try {
      await replanFromPhase(planId, startPhase);
      toast.success(t('aiPlanning.actions.replanSuccess'));
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : t('aiPlanning.error.replanFailed');
      setPhaseError(msg);
      toast.error(msg);
    }
  };

  const handleCancel = async () => {
    if (!planId) return;
    setPhaseError(null);
    try {
      await cancelPhase(planId);
      toast.success(t('aiPlanning.actions.cancelSuccess'));
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : t('aiPlanning.error.cancelFailed');
      setPhaseError(msg);
      toast.error(msg);
    }
  };

  const handleExport = () => {
    setShowExport(true);
  };

  const handleDelete = async () => {
    if (!planId) return;
    if (
      !(await confirm({ title: t('aiPlanning.confirmDelete'), type: 'danger' }))
    )
      return;
    try {
      await deletePlan(planId);
      router.push('/ai-planning');
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t('aiPlanning.error.deleteFailed')
      );
    }
  };

  const handleSettingsSave = async (data: {
    name: string;
    goal: string;
    depth: string;
  }) => {
    if (!planId) return;
    try {
      await updatePlan(planId, data);
      toast.success(t('aiPlanning.settings.saveSuccess'));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t('aiPlanning.error.updateFailed')
      );
    }
  };

  const handleDepthChange = async (
    depth: 'quick' | 'standard' | 'comprehensive'
  ) => {
    if (!planId) return;
    try {
      await updatePlan(planId, { depth });
      toast.success(t('aiPlanning.settings.saveSuccess'));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t('aiPlanning.error.updateFailed')
      );
    }
  };

  // Left panel phase click → switch to Tasks tab and expand that phase
  const handlePhaseSelect = (phase: number) => {
    setContentTab('phases');
    setSelectedPhase(phase);
  };

  // Build export scope options: "full" always available, "report" only when Phase 6 done
  const exportScopeOptions = useMemo(() => {
    if (!currentPlan) return [];
    const hasReport =
      currentPlan.phaseStatus[currentPlan.totalPhases]?.status === 'completed';
    const options = [];
    if (hasReport) {
      options.push({
        key: 'report',
        label: t('aiPlanning.export.scopeReport'),
        description: t('aiPlanning.export.scopeReportDesc'),
        selector: "[data-export-content='planning']",
      });
    }
    options.push({
      key: 'full',
      label: t('aiPlanning.export.scopeFull'),
      description: t('aiPlanning.export.scopeFullDesc'),
      selector: "[data-export-content='planning-full']",
    });
    return options;
  }, [currentPlan, t]);

  // Determine if any phase is currently active
  const isAnyPhaseActive =
    currentPlan &&
    Object.values(currentPlan.phaseStatus).some((s) => s.status === 'active');

  // Auth loading
  if (authLoading) {
    return (
      <AppShell>
        <LoadingState />
      </AppShell>
    );
  }

  // Not authenticated
  if (!isAuthenticated) {
    return (
      <AppShell>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
          <h2 className="text-xl font-semibold text-gray-700">
            {t('aiPlanning.signIn')}
          </h2>
        </div>
      </AppShell>
    );
  }

  // Loading plan detail
  if (!currentPlan) {
    return (
      <AppShell>
        <LoadingState />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex h-full flex-1 flex-col overflow-hidden bg-gray-50">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/ai-planning')}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-gray-900">
                {currentPlan.name}
              </h1>
              <p className="max-w-md truncate text-xs text-gray-500">
                {currentPlan.goal}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Status indicator */}
            {isAnyPhaseActive && (
              <div className="flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5">
                <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
                <span className="text-sm font-medium text-blue-700">
                  {t('aiPlanning.status.inProgress')}
                </span>
              </div>
            )}
            {/* Export */}
            {Object.values(currentPlan.phaseStatus).some(
              (s) => s.status === 'completed'
            ) && (
              <button
                onClick={handleExport}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-800"
              >
                <Download className="h-4 w-4" />
                {t('aiPlanning.actions.exportShort')}
              </button>
            )}
            {/* Settings */}
            <button
              onClick={() => setShowSettings(true)}
              className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            >
              <Settings className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Phase Bar */}
        <div className="border-b border-gray-100 bg-gray-50">
          <PlanPhaseBar
            currentPhase={currentPlan.currentPhase}
            phaseStatus={currentPlan.phaseStatus}
            onPhaseClick={() => setContentTab('phases')}
          />
        </div>

        {/* Main content: left panel + right panel */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Panel - Team (collapsible, matching AI Insights) */}
          <div
            className={`hidden flex-shrink-0 border-r border-gray-200 bg-white transition-all duration-300 lg:block ${
              leftPanelCollapsed ? 'w-12' : 'w-[360px]'
            }`}
          >
            {leftPanelCollapsed ? (
              <div className="flex h-full flex-col items-center py-4">
                <button
                  onClick={() => setLeftPanelCollapsed(false)}
                  className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                  title={t('aiPlanning.team.expandPanel')}
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
                      d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                    />
                  </svg>
                </button>
                <div className="mt-4 flex flex-col items-center gap-2">
                  {isAnyPhaseActive && (
                    <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
                  )}
                  <span
                    className="text-xs text-gray-500"
                    style={{ writingMode: 'vertical-rl' }}
                  >
                    {t('aiPlanning.team.planningTeam')}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {t('aiPlanning.team.planningTeam')}
                  </span>
                  <button
                    onClick={() => setLeftPanelCollapsed(true)}
                    className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                    title={t('aiPlanning.team.collapsePanel')}
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
                        d="M9 9V5m0 0H5m4 0L4 10m11-1V5m0 0h4m-4 0l5 5M9 15v4m0 0H5m4 0l-5-5m11 5l5-5m-5 5v-4m0 4h4"
                      />
                    </svg>
                  </button>
                </div>
                <div className="flex-1 overflow-hidden">
                  <PlanTeamPanel
                    plan={currentPlan}
                    isAdvancing={isAdvancing}
                    onStart={handleAdvance}
                    onAdvance={handleAdvance}
                    onRetry={handleRetry}
                    onReplan={handleReplan}
                    onCancel={handleCancel}
                    onPhaseSelect={handlePhaseSelect}
                    onDepthChange={handleDepthChange}
                    error={phaseError}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Right Panel - Content */}
          <div className="flex-1 overflow-hidden">
            <PlanContentPanel
              plan={currentPlan}
              planId={planId}
              activeTab={contentTab}
              onTabChange={setContentTab}
              selectedPhase={selectedPhase}
              onPhaseDeselect={() => setSelectedPhase(null)}
              onExport={handleExport}
              onRetryPhase={handleRetry}
            />
          </div>
        </div>
      </div>

      {/* Export dialog */}
      <ExportDialog
        isOpen={showExport}
        onClose={() => setShowExport(false)}
        contentSelector="[data-export-content='planning']"
        contentTitle={currentPlan.name}
        moduleType="planning"
        sourceId={planId}
        availableFormats={['PDF', 'DOCX', 'PPTX', 'HTML']}
        contentScopeOptions={exportScopeOptions}
      />

      {/* Settings modal */}
      {showSettings && (
        <PlanSettingsModal
          open={showSettings}
          onClose={() => setShowSettings(false)}
          plan={currentPlan}
          onSave={handleSettingsSave}
        />
      )}
    </AppShell>
  );
}
