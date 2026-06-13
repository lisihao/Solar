'use client';

import { Star } from 'lucide-react';

interface TierBadgeProps {
  tier?: 1 | 2 | 3 | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const TIER_CONFIG = {
  3: { count: 3, colorClass: 'text-violet-600 fill-violet-600' },
  2: { count: 2, colorClass: 'text-blue-500 fill-blue-500' },
  1: { count: 1, colorClass: 'text-slate-500 fill-slate-500' },
} as const;

const ICON_SIZE = {
  sm: 'h-3 w-3',
  md: 'h-3.5 w-3.5',
  lg: 'h-4 w-4',
} as const;

const TEXT_SIZE = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
} as const;

export function TierBadge({ tier, size = 'md', className }: TierBadgeProps) {
  if (tier == null) return null;

  const { count, colorClass } = TIER_CONFIG[tier];
  const iconClass = ICON_SIZE[size];
  const textClass = TEXT_SIZE[size];
  return (
    <span
      className={`inline-flex items-center gap-0.5 ${textClass} ${colorClass} ${className ?? ''}`}
      aria-label={`Tier ${tier}`}
      role="img"
    >
      {Array.from({ length: count }).map((_, i) => (
        <Star key={i} className={iconClass} aria-hidden="true" />
      ))}
    </span>
  );
}
