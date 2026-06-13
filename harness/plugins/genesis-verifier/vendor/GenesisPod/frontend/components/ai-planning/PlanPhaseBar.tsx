'use client';

import { useTranslation } from '@/lib/i18n';
import type { PlanPhaseStatus } from '@/services/ai-planning/api';
import { PHASE_KEYS } from '@/lib/constants/ai-planning';

interface PlanPhaseBarProps {
  currentPhase: number;
  phaseStatus: Record<number, PlanPhaseStatus>;
  onPhaseClick?: (phase: number) => void;
}

export default function PlanPhaseBar({
  currentPhase,
  phaseStatus,
  onPhaseClick,
}: PlanPhaseBarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-1 overflow-x-auto px-4 py-3">
      {[1, 2, 3, 4, 5, 6].map((phase) => {
        const status = phaseStatus[phase]?.status || 'pending';
        const isCompleted = status === 'completed';
        const isActive = status === 'active';

        return (
          <div key={phase} className="flex items-center">
            {phase > 1 && (
              <div
                className={`mx-1 h-0.5 w-6 ${isCompleted || phase <= currentPhase ? 'bg-green-400' : 'bg-gray-200'}`}
              />
            )}
            <button
              type="button"
              onClick={() => onPhaseClick?.(phase)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                isCompleted
                  ? 'bg-green-50 text-green-700'
                  : isActive
                    ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-300'
                    : 'bg-gray-50 text-gray-400'
              }`}
              disabled={status === 'pending'}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                  isCompleted
                    ? 'bg-green-500 text-white'
                    : isActive
                      ? 'animate-pulse bg-amber-400 text-white'
                      : 'bg-gray-200 text-gray-400'
                }`}
              >
                {isCompleted ? (
                  <svg
                    className="h-3 w-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  phase
                )}
              </span>
              <span className="hidden sm:inline">
                {t(`aiPlanning.phases.${PHASE_KEYS[phase]}`)}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
