'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils/common';
import { useI18n } from '@/lib/i18n';
import {
  Brain,
  Search,
  ShieldCheck,
  FileText,
  CheckCircle2,
} from 'lucide-react';

type PipelinePhase =
  | 'planning'
  | 'researching'
  | 'reviewing'
  | 'synthesizing'
  | 'completed';

interface PipelinePhaseIndicatorProps {
  /** Current phase derived from mission status or WS events */
  currentPhase: PipelinePhase | null;
  /** Overall mission progress 0-100 */
  progress?: number;
  /** Whether the mission failed */
  isFailed?: boolean;
  className?: string;
  onPhaseClick?: (phase: PipelinePhase) => void;
}

const PHASES: {
  key: PipelinePhase;
  icon: React.ElementType;
  labelKey: string;
}[] = [
  { key: 'planning', icon: Brain, labelKey: 'topicResearch.pipeline.planning' },
  {
    key: 'researching',
    icon: Search,
    labelKey: 'topicResearch.pipeline.researching',
  },
  {
    key: 'reviewing',
    icon: ShieldCheck,
    labelKey: 'topicResearch.pipeline.reviewing',
  },
  {
    key: 'synthesizing',
    icon: FileText,
    labelKey: 'topicResearch.pipeline.synthesizing',
  },
  {
    key: 'completed',
    icon: CheckCircle2,
    labelKey: 'topicResearch.pipeline.completed',
  },
];

export function PipelinePhaseIndicator({
  currentPhase,
  progress,
  isFailed,
  className,
  onPhaseClick,
}: PipelinePhaseIndicatorProps) {
  const { t } = useI18n();

  const currentIndex = useMemo(() => {
    if (!currentPhase) return -1;
    return PHASES.findIndex((p) => p.key === currentPhase);
  }, [currentPhase]);

  if (!currentPhase) return null;

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {PHASES.map((phase, idx) => {
        const Icon = phase.icon;
        const isActive = idx === currentIndex;
        const isDone = idx < currentIndex;
        const isFutureOrFailed = idx > currentIndex;

        return (
          <div key={phase.key} className="flex items-center">
            {idx > 0 && (
              <div
                className={cn(
                  'h-0.5 w-4 sm:w-6',
                  isDone
                    ? 'bg-green-400'
                    : isActive
                      ? 'bg-blue-300'
                      : 'bg-gray-200'
                )}
              />
            )}
            <button
              type="button"
              className={cn(
                'flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium transition-all',
                isActive &&
                  !isFailed &&
                  'bg-blue-100 text-blue-700 ring-1 ring-blue-300',
                isActive &&
                  isFailed &&
                  'bg-red-100 text-red-700 ring-1 ring-red-300',
                isDone && 'bg-green-50 text-green-700',
                isFutureOrFailed && !isActive && 'text-gray-400',
                onPhaseClick &&
                  (isDone || isActive) &&
                  'cursor-pointer hover:ring-2 hover:ring-blue-200',
                !onPhaseClick && 'cursor-default'
              )}
              title={t(phase.labelKey)}
              onClick={() => onPhaseClick?.(phase.key)}
              disabled={!onPhaseClick || (!isDone && !isActive)}
            >
              <Icon
                className={cn(
                  'h-3.5 w-3.5',
                  isActive && !isFailed && 'animate-pulse'
                )}
              />
              <span className="hidden sm:inline">{t(phase.labelKey)}</span>
            </button>
          </div>
        );
      })}
      {progress !== undefined && progress > 0 && progress < 100 && (
        <span className="ml-2 text-xs text-gray-500">{progress}%</span>
      )}
    </div>
  );
}

/**
 * Derive the current pipeline phase from WebSocket events and mission status.
 */
export function derivePipelinePhase(
  wsEvents: Array<{ type: string; data: unknown; timestamp: string }>,
  missionStatus?: { phase?: string; status?: string } | null
): { phase: PipelinePhase | null; isFailed: boolean } {
  // Check mission status first
  if (missionStatus?.status === 'COMPLETED') {
    return { phase: 'completed', isFailed: false };
  }
  if (missionStatus?.status === 'FAILED') {
    // Determine which phase it failed in from the last WS event
    const lastPhase = getLastPhaseFromEvents(wsEvents);
    return { phase: lastPhase || 'planning', isFailed: true };
  }

  // Derive from WS events (latest event wins)
  // Iterate backwards to find the latest phase-indicating event
  for (let i = wsEvents.length - 1; i >= 0; i--) {
    const event = wsEvents[i];
    const type = event.type;

    if (type === 'mission:completed')
      return { phase: 'completed', isFailed: false };
    if (type === 'mission:failed') {
      const lastPhase = getLastPhaseFromEvents(wsEvents.slice(0, i));
      return { phase: lastPhase || 'planning', isFailed: true };
    }
    if (type === 'report:synthesis_completed')
      return { phase: 'completed', isFailed: false };
    if (type.startsWith('report:synthesis'))
      return { phase: 'synthesizing', isFailed: false };
    if (type === 'agent:working' || type === 'agent:completed') {
      const data = event.data as Record<string, unknown>;
      if (data.agentRole === 'reviewer')
        return { phase: 'reviewing', isFailed: false };
      if (data.agentRole === 'synthesizer')
        return { phase: 'synthesizing', isFailed: false };
    }
    if (type.startsWith('dimension:'))
      return { phase: 'researching', isFailed: false };
    if (type === 'leader:plan_ready')
      return { phase: 'researching', isFailed: false };
    if (type.startsWith('leader:'))
      return { phase: 'planning', isFailed: false };
    if (type === 'mission:started')
      return { phase: 'planning', isFailed: false };
  }

  // Check persisted mission phase
  if (missionStatus?.phase) {
    const phaseMap: Record<string, PipelinePhase> = {
      planning: 'planning',
      researching: 'researching',
      reviewing: 'reviewing',
      synthesizing: 'synthesizing',
    };
    const mapped = phaseMap[missionStatus.phase];
    if (mapped) return { phase: mapped, isFailed: false };
  }

  return { phase: null, isFailed: false };
}

function getLastPhaseFromEvents(
  events: Array<{ type: string; data: unknown }>
): PipelinePhase | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const type = events[i].type;
    if (type.startsWith('report:synthesis')) return 'synthesizing';
    if (type === 'agent:working' || type === 'agent:completed') {
      const data = events[i].data as Record<string, unknown>;
      if (data.agentRole === 'reviewer') return 'reviewing';
      if (data.agentRole === 'synthesizer') return 'synthesizing';
    }
    if (type.startsWith('dimension:') || type === 'leader:plan_ready')
      return 'researching';
    if (type.startsWith('leader:')) return 'planning';
  }
  return null;
}
