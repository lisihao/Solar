'use client';

/**
 * PhaseTransition - Phase change divider in chat stream
 *
 * Shows phase icon + label + summary + research directions (if any)
 * Uses Lucide icons + colored dots for directions
 */

import { Lightbulb, Rocket, MessagesSquare, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils/common';
import type { DiscussionPhase } from '@/hooks';

interface PhaseTransitionProps {
  phase: DiscussionPhase;
  summary: string;
  directions?: string[];
}

const PHASE_CONFIG: Record<
  string,
  {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    gradient: string;
    iconColor: string;
    dotColor: string;
  }
> = {
  ideation: {
    icon: Lightbulb,
    label: '创意构思阶段',
    gradient: 'from-yellow-50 to-amber-50',
    iconColor: 'text-amber-600',
    dotColor: 'bg-amber-500',
  },
  execution: {
    icon: Rocket,
    label: '深度搜索阶段',
    gradient: 'from-blue-50 to-indigo-50',
    iconColor: 'text-blue-600',
    dotColor: 'bg-blue-500',
  },
  findings: {
    icon: MessagesSquare,
    label: '发现交叉阶段',
    gradient: 'from-purple-50 to-pink-50',
    iconColor: 'text-purple-600',
    dotColor: 'bg-purple-500',
  },
  synthesis: {
    icon: BookOpen,
    label: '综合成稿阶段',
    gradient: 'from-green-50 to-emerald-50',
    iconColor: 'text-green-600',
    dotColor: 'bg-green-500',
  },
};

const DIRECTION_COLORS = [
  'bg-purple-500',
  'bg-blue-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
];

export function PhaseTransition({
  phase,
  summary,
  directions,
}: PhaseTransitionProps) {
  const config = PHASE_CONFIG[phase];

  if (!config) {
    return null;
  }

  const Icon = config.icon;

  return (
    <div className="my-6 flex justify-center">
      <div
        className={cn(
          'w-full max-w-2xl rounded-xl border border-gray-200 bg-gradient-to-br p-5 shadow-sm',
          config.gradient
        )}
      >
        {/* Phase Icon and Label */}
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm">
            <Icon className={cn('h-5 w-5', config.iconColor)} />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900">
              {config.label}
            </h3>
          </div>
        </div>

        {/* Summary */}
        <p className="mb-3 text-sm leading-relaxed text-gray-700">{summary}</p>

        {/* Research Directions */}
        {directions && directions.length > 0 && (
          <div className="mt-3 border-t border-gray-200/60 pt-3">
            <h4 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
              确定的研究方向
            </h4>
            <div className="space-y-2">
              {directions.map((direction, index) => (
                <div
                  key={index}
                  className="flex items-start gap-2.5 rounded-lg bg-white/80 p-2.5 shadow-sm"
                >
                  <span
                    className={cn(
                      'mt-0.5 h-2 w-2 flex-shrink-0 rounded-full',
                      DIRECTION_COLORS[index % DIRECTION_COLORS.length]
                    )}
                  />
                  <span className="flex-1 text-sm leading-snug text-gray-800">
                    {direction}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
