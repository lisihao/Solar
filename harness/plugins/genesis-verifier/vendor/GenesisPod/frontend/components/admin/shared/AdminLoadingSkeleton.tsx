// 纯展示组件 — 无 hooks/state，可在 RSC 中复用（不写 'use client'）。
import { cn } from '@/lib/utils/common';

type SkeletonVariant = 'table' | 'cards' | 'list';

interface AdminLoadingSkeletonProps {
  variant: SkeletonVariant;
  rows?: number;
  className?: string;
}

/**
 * AdminLoadingSkeleton — Page-level loading skeleton per standards/20-admin-ui-design.md.
 *
 * Variants:
 * - `table`: rectangle rows mimicking a table
 * - `cards`: 4-col grid of card placeholders (matches AdminStatsCards layout)
 * - `list`: stacked rounded blocks
 *
 * For inside-table loading, use AdminDataTable's built-in `loading` prop instead.
 */
export default function AdminLoadingSkeleton({
  variant,
  rows = 5,
  className,
}: AdminLoadingSkeletonProps) {
  if (variant === 'cards') {
    return (
      <div className={cn('grid grid-cols-2 gap-4 lg:grid-cols-4', className)}>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3 w-16 animate-pulse rounded bg-gray-200" />
                <div className="h-7 w-20 animate-pulse rounded bg-gray-200" />
              </div>
              <div className="h-10 w-10 animate-pulse rounded-lg bg-gray-200" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'list') {
    return (
      <div className={cn('space-y-3', className)}>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-lg border border-gray-200 bg-white"
          />
        ))}
      </div>
    );
  }

  // table variant
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-gray-200 bg-white',
        className
      )}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-gray-100 px-4 py-3 last:border-0"
        >
          <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
          <div className="h-4 flex-1 animate-pulse rounded bg-gray-200" />
          <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
        </div>
      ))}
    </div>
  );
}
