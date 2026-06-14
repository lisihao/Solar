'use client';

/**
 * PlanTeamPanel - AI Planning left panel
 *
 * Faithfully follows TopicTeamPanel (AI Insights) 4-section structure:
 * 1. Header: plan name + status badge + progress stats + progress bar
 * 2. SVG Canvas: pentagon layout, Bezier curves, layered nodes, hover tooltip, click detail card, legend
 * 3. Phase Task List: 6 phases as clickable task items
 * 4. Bottom Bar: phase indicator + 3 action buttons (grid-cols-3)
 */

import { useMemo, useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils/common';
import { ModelBadge } from '@/components/common/badges/ModelBadge';
import ReplanModal from '@/components/ai-planning/ReplanModal';
import {
  TeamTopologyCanvas,
  TEAM_DETAIL_BG_COLORS,
  AVATAR_ROW_Y,
  type TeamTopologyNode,
  type TeamTopologyConnection,
  type TeamTopologyLegendItem,
} from '@/components/common/team-topology';
import type { PlanDetail } from '@/services/ai-planning/api';
import { PHASE_KEYS } from '@/lib/constants/ai-planning';
import {
  PLANNING_ROLES_CONFIG,
  PLANNING_WORKFLOW_CONFIG,
  getActiveAgentIndicesForPhase,
} from '@/lib/constants/planning-roles';

// ---- Props ----

interface PlanTeamPanelProps {
  plan: PlanDetail;
  isAdvancing: boolean;
  onStart: () => void;
  onAdvance: () => void;
  onRetry: (phase: number) => void;
  onReplan?: (startPhase: number) => void;
  onCancel?: () => void;
  onPhaseSelect?: (phase: number) => void;
  onDepthChange?: (depth: 'quick' | 'standard' | 'comprehensive') => void;
  error?: string | null;
}

// ---- Constants (matching AI Insights pattern) ----

const ROLE_ICON_MAP: Record<string, { icon: string; color: string }> = {
  leader: { icon: '\u{1F451}', color: 'purple' },
  researcher: { icon: '\u{1F50D}', color: 'blue' },
  analyst: { icon: '\u{1F4CA}', color: 'green' },
  copywriter: { icon: '\u{270D}\u{FE0F}', color: 'orange' },
  debaterPro: { icon: '\u{2694}\u{FE0F}', color: 'red' },
  debaterCon: { icon: '\u{1F6E1}\u{FE0F}', color: 'rose' },
};

// Fallback for unknown roles
const DEFAULT_ROLE_ICON = { icon: '\u{1F916}', color: 'gray' };

const PHASE_STATUS_ICONS: Record<string, string> = {
  pending: '\u{23F3}',
  active: '\u{1F504}',
  completed: '\u{2705}',
  skipped: '\u{23ED}\u{FE0F}',
  failed: '\u{274C}',
};

const PHASE_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  active: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  skipped: 'bg-gray-100 text-gray-500',
  failed: 'bg-red-100 text-red-700',
};

// Row layout: Leader → researcher/analyst/copywriter → debaterPro/debaterCon
const PLAN_ROWS: string[][] = [
  ['leader'],
  ['researcher', 'analyst', 'copywriter'],
  ['debaterPro', 'debaterCon'],
];

// ---- Main Component ----

export function PlanTeamPanel({
  plan,
  isAdvancing,
  onStart,
  onAdvance,
  onRetry,
  onReplan,
  onCancel,
  onPhaseSelect,
  onDepthChange,
  error,
}: PlanTeamPanelProps) {
  const { t } = useTranslation();
  const [showReplanModal, setShowReplanModal] = useState(false);

  // Stats
  const completedCount = Object.values(plan.phaseStatus).filter(
    (s) => s.status === 'completed'
  ).length;
  const activeCount = Object.values(plan.phaseStatus).filter(
    (s) => s.status === 'active'
  ).length;
  const progress =
    plan.totalPhases > 0
      ? Math.round((completedCount / plan.totalPhases) * 100)
      : 0;

  // Phase status
  const currentStatus = plan.phaseStatus[plan.currentPhase];
  const isCurrentActive = currentStatus?.status === 'active';
  const isCurrentCompleted = currentStatus?.status === 'completed';
  const allCompleted =
    plan.currentPhase === plan.totalPhases && isCurrentCompleted;

  // Active agents
  const activeAgentIndices = isCurrentActive
    ? getActiveAgentIndicesForPhase(plan.currentPhase)
    : [];

  // Status display
  const statusText = allCompleted
    ? t('aiPlanning.status.completed')
    : plan.currentPhase === 0
      ? t('aiPlanning.status.notStarted')
      : t('aiPlanning.status.inProgress');

  const statusColor = allCompleted
    ? 'bg-green-100 text-green-700'
    : isCurrentActive
      ? 'bg-blue-100 text-blue-700'
      : plan.currentPhase === 0
        ? 'bg-gray-100 text-gray-600'
        : 'bg-blue-100 text-blue-700';

  // Auto-advance pending: phase completed but not the last phase.
  // Backend auto-advances after ~3s, so buttons must stay disabled during the gap.
  // Timeout: if completedAt is >15s ago and next phase hasn't started, assume
  // auto-advance failed and re-enable buttons so user can manually advance.
  const isAutoAdvancePending = (() => {
    if (
      plan.currentPhase <= 0 ||
      !isCurrentCompleted ||
      plan.currentPhase >= plan.totalPhases
    )
      return false;
    const completedAt = currentStatus?.completedAt;
    if (completedAt) {
      const elapsed = Date.now() - new Date(completedAt).getTime();
      if (elapsed > 15000) return false; // >15s: auto-advance likely failed
    }
    return true;
  })();

  // Button states (matching AI Insights: Start/Replan/Cancel)
  const isMissionActive = isCurrentActive || isAutoAdvancePending;
  const canStart = !isAdvancing && !isMissionActive && !allCompleted;
  const canReplan =
    !isAdvancing &&
    !isMissionActive &&
    plan.currentPhase > 0 &&
    isCurrentCompleted;
  const canCancel = isCurrentActive && !isAdvancing;

  return (
    <div className="flex h-full flex-col bg-white">
      {/* 1. Header */}
      <div className="border-b border-gray-100 px-4 py-3">
        <div className="flex items-center justify-between">
          <h3 className="truncate text-sm font-semibold text-gray-800">
            {plan.name}
          </h3>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}
          >
            {statusText}
          </span>
        </div>

        {/* Progress stats */}
        <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
          <span className="text-green-600">
            {PHASE_STATUS_ICONS.completed} {completedCount}
          </span>
          {activeCount > 0 && (
            <span className="text-blue-600">
              {PHASE_STATUS_ICONS.active} {activeCount}
            </span>
          )}
          <span className="text-gray-400">
            {t('aiPlanning.team.totalPhases', { count: plan.totalPhases })}
          </span>
        </div>

        {/* Progress bar */}
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full transition-all duration-500 ${
                allCompleted ? 'bg-green-500' : 'bg-blue-500'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-xs text-gray-400">
            <span>{t('aiPlanning.team.overallProgress')}</span>
            <span>{progress}%</span>
          </div>
        </div>
      </div>

      {/* 2. SVG Canvas */}
      <div className="relative border-b border-gray-100">
        <PlanTeamCanvasView
          plan={plan}
          activeAgentIndices={activeAgentIndices}
        />
      </div>

      {/* 3. Phase Task List */}
      <div className="flex-1 overflow-y-auto">
        {plan.currentPhase === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
            <div className="mb-3 text-3xl">{ROLE_ICON_MAP.leader.icon}</div>
            <p className="text-sm font-medium text-gray-700">
              {t('aiPlanning.team.waitingForStart')}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {t('aiPlanning.team.clickStartHint')}
            </p>
          </div>
        ) : (
          <div className="space-y-1 p-3">
            {PLANNING_WORKFLOW_CONFIG.map((wf) => {
              const status = plan.phaseStatus[wf.phase];
              const phaseKey = PHASE_KEYS[wf.phase];
              const isActive = status?.status === 'active';
              const isCompleted = status?.status === 'completed';
              const agentIcons = wf.agentKeys
                .map((key) => ROLE_ICON_MAP[key]?.icon || '')
                .join(' ');

              return (
                <div
                  key={wf.phase}
                  onClick={() => onPhaseSelect?.(wf.phase)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 transition-colors',
                    isActive
                      ? 'border-blue-200 bg-blue-50/50'
                      : isCompleted
                        ? 'border-green-200 bg-green-50/30'
                        : 'border-gray-100 bg-white hover:bg-gray-50'
                  )}
                >
                  <span className="text-xs">
                    {PHASE_STATUS_ICONS[status?.status || 'pending']}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-gray-700">
                    {t(`aiPlanning.phases.${phaseKey}`)}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    {agentIcons}
                  </span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] ${PHASE_STATUS_COLORS[status?.status || 'pending']}`}
                  >
                    {t(`aiPlanning.phaseStatus.${status?.status || 'pending'}`)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. Bottom Bar */}
      <div className="border-t border-gray-100 px-4 py-2">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="text-gray-500">
            {t('aiPlanning.team.phase')}:{' '}
            {plan.currentPhase > 0
              ? t(`aiPlanning.phases.${PHASE_KEYS[plan.currentPhase]}`)
              : t('aiPlanning.status.notStarted')}
          </span>
          <span className={`rounded-full px-2 py-0.5 ${statusColor}`}>
            {statusText}
          </span>
        </div>

        {/* Research Depth Display (matching AI Insights) */}
        {plan.depth && (
          <div className="mb-2">
            <div className="mb-1 text-xs font-medium text-gray-500">
              {t('aiPlanning.create.depth')}
            </div>
            <div className="grid grid-cols-3 gap-1">
              {(['quick', 'standard', 'comprehensive'] as const).map(
                (depth) => {
                  const isSelected = plan.depth === depth;
                  const canChange =
                    !isMissionActive && !isAdvancing && onDepthChange;
                  return (
                    <button
                      key={depth}
                      type="button"
                      disabled={!canChange}
                      onClick={() => canChange && onDepthChange(depth)}
                      className={`rounded-md px-2 py-1.5 text-center text-xs transition-all ${
                        isSelected
                          ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300'
                          : canChange
                            ? 'bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600'
                            : 'bg-gray-50 text-gray-400'
                      } ${!canChange ? 'cursor-default' : 'cursor-pointer'}`}
                    >
                      <div className="font-medium">
                        {t(`aiPlanning.team.depth.${depth}`)}
                      </div>
                      <div className="mt-0.5 whitespace-nowrap text-[10px] opacity-70">
                        {t(`aiPlanning.team.depth.${depth}Desc`)}
                      </div>
                    </button>
                  );
                }
              )}
            </div>
          </div>
        )}

        {/* Error display (matching AI Insights) */}
        {error && (
          <div className="mb-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <div className="mb-1 flex items-center gap-2 font-medium">
              <span>{'\u26A0\uFE0F'}</span>
              <span>{t('aiPlanning.team.executionError')}</span>
            </div>
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}

        {/* Action Buttons - 3 equal buttons: Start/Update/Cancel (matching AI Insights) */}
        <div className="grid grid-cols-3 gap-2">
          {/* Start button - start planning or advance to next phase */}
          <button
            onClick={plan.currentPhase === 0 ? onStart : onAdvance}
            disabled={!canStart}
            className={`flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
              canStart
                ? 'bg-blue-600 text-white shadow-sm hover:bg-blue-700'
                : 'cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400'
            }`}
          >
            {isAdvancing ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <span>{'\u25B6'}</span>
            )}
            {t('aiPlanning.actions.start')}
          </button>

          {/* Replan button - re-execute from selected phase */}
          <button
            onClick={() => setShowReplanModal(true)}
            disabled={!canReplan}
            className={`flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
              canReplan
                ? 'bg-green-600 text-white shadow-sm hover:bg-green-700'
                : 'cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400'
            }`}
          >
            <span>{PHASE_STATUS_ICONS.active}</span>
            {t('aiPlanning.actions.replan')}
          </button>

          {/* Cancel button - stop current active phase */}
          <button
            onClick={onCancel}
            disabled={!canCancel}
            className={`flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
              canCancel
                ? 'border border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
                : 'cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400'
            }`}
          >
            <span>{'\u23F9'}</span>
            {t('aiPlanning.actions.cancel')}
          </button>
        </div>
      </div>

      {/* Replan Modal */}
      {showReplanModal && (
        <ReplanModal
          open={showReplanModal}
          onClose={() => setShowReplanModal(false)}
          onConfirm={(startPhase) => {
            setShowReplanModal(false);
            onReplan?.(startPhase);
          }}
          totalPhases={plan.totalPhases}
        />
      )}
    </div>
  );
}

// ============================================
// SVG Team Canvas - Uses shared TeamTopologyCanvas
// ============================================

function PlanTeamCanvasView({
  plan,
  activeAgentIndices,
}: {
  plan: PlanDetail;
  activeAgentIndices: number[];
}) {
  const { t } = useTranslation();

  const { nodes, connections, legendItems } = useMemo(() => {
    const topoNodes: TeamTopologyNode[] = PLANNING_ROLES_CONFIG.map(
      (role, index) => {
        const isActive = activeAgentIndices.includes(index);
        const roleIcon = ROLE_ICON_MAP[role.key] || DEFAULT_ROLE_ICON;

        return {
          id: role.key,
          name: t(`aiPlanning.roles.${role.nameKey}`),
          role: role.key,
          icon: roleIcon.icon,
          status: isActive ? ('working' as const) : ('idle' as const),
          statusLabel: isActive
            ? t('aiPlanning.team.legend.working')
            : undefined,
          colorKey: role.color,
          isLeader: index === 0,
          avatarRole: role.key,
        };
      }
    );

    // Leader → all members
    const conns: TeamTopologyConnection[] = PLANNING_ROLES_CONFIG.slice(1).map(
      (role) => ({
        from: 'leader',
        to: role.key,
      })
    );

    const legend: TeamTopologyLegendItem[] = [
      { color: 'bg-purple-500', label: t('aiPlanning.team.legend.leader') },
      {
        color: 'bg-blue-500',
        label: t('aiPlanning.team.legend.working'),
        animated: true,
      },
      { color: 'bg-green-500', label: t('aiPlanning.team.legend.completed') },
      { color: 'bg-gray-400', label: t('aiPlanning.team.legend.idle') },
    ];

    return { nodes: topoNodes, connections: conns, legendItems: legend };
  }, [activeAgentIndices, t]);

  return (
    <TeamTopologyCanvas
      nodes={nodes}
      rows={PLAN_ROWS}
      connections={connections}
      heightClass="h-[280px]"
      viewBoxHeight={280}
      rowYPositions={[...AVATAR_ROW_Y]}
      patternId="plan"
      legendItems={legendItems}
      renderTooltip={(node) => {
        const role = PLANNING_ROLES_CONFIG.find((r) => r.key === node.id);
        if (!role) return null;
        const roleIcon = ROLE_ICON_MAP[role.key] || DEFAULT_ROLE_ICON;
        return (
          <div className="text-xs">
            <div className="font-semibold text-gray-800">
              {roleIcon.icon} {t(`aiPlanning.roles.${role.nameKey}`)}
            </div>
            <div className="mt-0.5 text-gray-500">
              {t(`aiPlanning.roles.${role.descriptionKey}`)}
            </div>
          </div>
        );
      }}
      renderDetail={(node, onClose) => {
        const roleIndex = PLANNING_ROLES_CONFIG.findIndex(
          (r) => r.key === node.id
        );
        const role = PLANNING_ROLES_CONFIG[roleIndex];
        if (!role) return null;
        const roleIcon = ROLE_ICON_MAP[role.key] || DEFAULT_ROLE_ICON;
        const member = plan.members?.[roleIndex];

        return (
          <>
            <div className="absolute inset-0 z-20" onClick={onClose} />
            <div className="absolute left-1/2 top-1/2 z-30 w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-gray-200 bg-white p-4 shadow-lg">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-full',
                      TEAM_DETAIL_BG_COLORS[role.color] || 'bg-gray-50'
                    )}
                  >
                    <span className="text-xl">{roleIcon.icon}</span>
                  </div>
                  <div>
                    <div className="font-semibold text-gray-800">
                      {t(`aiPlanning.roles.${role.nameKey}`)}
                    </div>
                    <span className="text-xs text-gray-500">
                      {t('aiPlanning.team.agentDetail')}
                    </span>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
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
              </div>

              <div className="mb-3">
                <div className="mb-1 text-xs font-medium text-gray-500">
                  {'\u{1F4CB}'} {t('aiPlanning.team.responsibilities')}
                </div>
                <p className="text-sm text-gray-700">
                  {t(`aiPlanning.roles.${role.descriptionKey}`)}
                </p>
              </div>

              <div className="mb-3">
                <div className="mb-1.5 text-xs font-medium text-gray-500">
                  {'\u{1F3AF}'} {t('aiPlanning.team.skills')}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {role.skills.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-700"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mb-3">
                <div className="mb-1.5 text-xs font-medium text-gray-500">
                  {'\u{1F527}'} {t('aiPlanning.team.tools')}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {role.tools.map((tool) => (
                    <span
                      key={tool}
                      className="rounded-full bg-green-50 px-2.5 py-1 text-xs text-green-700"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </div>

              {member?.aiModel && (
                <div>
                  <div className="mb-1.5 text-xs font-medium text-gray-500">
                    AI Model
                  </div>
                  <div className="rounded-lg bg-gradient-to-r from-indigo-50 to-purple-50 px-3 py-2">
                    <ModelBadge modelId={member.aiModel} variant="compact" />
                  </div>
                </div>
              )}
            </div>
          </>
        );
      }}
    />
  );
}

export default PlanTeamPanel;
