'use client';

import { ScenarioCard, ScenarioRun } from '../types';
import { useI18n } from '@/lib/i18n';
import {
  AssetCard,
  type AssetCardBadge,
  type AssetVisibility,
  type AssetVisibilityOption,
} from '@/components/ui/cards/asset-card';
import { Building2, Globe, Layers, Lock, Target, Users } from 'lucide-react';

interface ScenarioCardItemProps {
  scenario: ScenarioCard;
  latestRun: ScenarioRun | null;
  onView: () => void;
  onEdit: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
  onVisibilityChange?: (scenario: ScenarioCard, next: AssetVisibility) => void;
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

const SCENARIO_GRADIENTS = [
  'from-indigo-500 to-purple-600',
  'from-blue-500 to-cyan-600',
  'from-violet-500 to-fuchsia-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600',
  'from-cyan-500 to-blue-600',
  'from-fuchsia-500 to-pink-600',
];

function getScenarioGradient(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return SCENARIO_GRADIENTS[Math.abs(hash) % SCENARIO_GRADIENTS.length];
}

export function ScenarioCardItem({
  scenario,
  latestRun,
  onView,
  onEdit,
  onDelete,
  onVisibilityChange,
}: ScenarioCardItemProps) {
  const { t } = useI18n();
  const gradient = getScenarioGradient(scenario.id);

  const statusBadge: AssetCardBadge = latestRun
    ? {
        key: 'status',
        label:
          latestRun.status === 'RUNNING'
            ? t('aiSimulation.scenarioCard.statusRunning')
            : latestRun.status === 'COMPLETED'
              ? t('aiSimulation.scenarioCard.statusCompleted')
              : latestRun.status === 'PAUSED'
                ? t('aiSimulation.scenarioCard.statusPaused')
                : latestRun.status,
        className:
          latestRun.status === 'RUNNING'
            ? 'bg-green-100 text-green-700'
            : latestRun.status === 'COMPLETED'
              ? 'bg-blue-100 text-blue-700'
              : latestRun.status === 'PAUSED'
                ? 'bg-yellow-100 text-yellow-700'
                : 'bg-purple-100 text-purple-700',
      }
    : {
        key: 'status',
        label: t('aiSimulation.scenarioCard.statusNotRunning'),
        className: 'bg-gray-100 text-gray-600',
      };

  const industryBadge: AssetCardBadge = {
    key: 'industry',
    label: `${scenario.industry}${scenario.region ? ` · ${scenario.region}` : ''}`,
    className: 'bg-gray-100 text-gray-600',
  };

  return (
    <AssetCard
      title={scenario.name}
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
            d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
          />
        </svg>
      }
      gradient={gradient}
      badges={[industryBadge, statusBadge]}
      isOwner
      visibility={scenario.visibility}
      visibilityOptions={VISIBILITY_OPTIONS}
      visibilityToggleCycle={['PRIVATE', 'SHARED', 'PUBLIC']}
      onVisibilityToggle={
        onVisibilityChange
          ? (next) => onVisibilityChange(scenario, next)
          : undefined
      }
      onEdit={() => onEdit({ stopPropagation: () => {} } as React.MouseEvent)}
      onDelete={() =>
        onDelete({ stopPropagation: () => {} } as React.MouseEvent)
      }
      onClick={onView}
      stats={[
        {
          key: 'companies',
          icon: <Building2 className="h-3.5 w-3.5" />,
          text: `${t('aiSimulation.scenarioCard.companies')} ${scenario.companies?.length || 0}`,
        },
        {
          key: 'roles',
          icon: <Layers className="h-3.5 w-3.5" />,
          text: `${t('aiSimulation.scenarioCard.roles')} ${scenario.agents?.length || 0}`,
        },
        ...(latestRun?.currentRound
          ? [
              {
                key: 'round',
                icon: <Target className="h-3.5 w-3.5" />,
                text: t('aiSimulation.scenarioCard.round', {
                  round: latestRun.currentRound,
                }),
              },
            ]
          : []),
      ]}
      timestamp={scenario.updatedAt || scenario.createdAt}
      labels={{
        edit: t('aiSimulation.scenarioCard.editScenario'),
        delete: t('aiSimulation.scenarioCard.deleteScenario'),
      }}
    />
  );
}
