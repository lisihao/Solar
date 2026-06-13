'use client';

import { useEffect } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';

interface Props {
  totalSources: number;
  okCount: number;
  failCount: number;
  /** When fail/total >= 0.5, called with true; otherwise called with false */
  onAmberStateChange?: (amber: boolean) => void;
}

export function shouldShowAmber(
  failCount: number,
  totalSources: number
): boolean {
  if (totalSources === 0) return false;
  return failCount / totalSources >= 0.5;
}

export function SourceHealthSummary({
  totalSources,
  okCount,
  failCount,
  onAmberStateChange,
}: Props) {
  const amber = shouldShowAmber(failCount, totalSources);

  useEffect(() => {
    onAmberStateChange?.(amber);
  }, [amber, onAmberStateChange]);

  if (totalSources === 0) {
    return <span className="text-slate-400">0 源</span>;
  }

  return (
    <span
      className={`inline-flex items-center gap-1 ${amber ? 'text-amber-600' : 'text-slate-500'}`}
    >
      {totalSources} 源 ·
      <span className="inline-flex items-center gap-0.5">
        <CheckCircle
          className="h-3 w-3 text-emerald-500"
          aria-hidden="true"
        />
        {okCount}
      </span>
      ·
      <span className="inline-flex items-center gap-0.5">
        <XCircle
          className={`h-3 w-3 ${amber ? 'text-amber-500' : 'text-slate-400'}`}
          aria-hidden="true"
        />
        {failCount}
      </span>
    </span>
  );
}
