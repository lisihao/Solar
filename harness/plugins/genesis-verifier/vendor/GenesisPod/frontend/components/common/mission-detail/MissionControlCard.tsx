'use client';

import { cn } from '@/lib/utils/common';

type MissionControlTone =
  | 'gray'
  | 'blue'
  | 'green'
  | 'red'
  | 'violet'
  | 'amber';

const TONE_CLASSES: Record<MissionControlTone, string> = {
  gray: 'bg-gray-100 text-gray-700',
  blue: 'bg-blue-100 text-blue-700',
  green: 'bg-emerald-100 text-emerald-700',
  red: 'bg-red-100 text-red-700',
  violet: 'bg-violet-100 text-violet-700',
  amber: 'bg-amber-100 text-amber-700',
};

export interface MissionControlCardProps {
  title?: string;
  statusLabel?: string;
  statusTone?: MissionControlTone;
  className?: string;
  children: React.ReactNode;
}

export function MissionControlCard({
  title = '运行配置',
  statusLabel,
  statusTone = 'gray',
  className,
  children,
}: MissionControlCardProps) {
  return (
    <div
      className={cn(
        'mt-3 rounded-xl border border-gray-200 bg-white px-3 py-3',
        className
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-500">{title}</span>
        {statusLabel && (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-semibold',
              TONE_CLASSES[statusTone]
            )}
          >
            {statusLabel}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
