'use client';

import { Search } from 'lucide-react';
import { cn } from '@/lib/utils/common';

interface AdminToolbarProps {
  search?: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  };
  /** Filter dropdowns or segmented controls — sit next to search */
  filters?: React.ReactNode;
  /** Secondary actions (left-of-primary, after the flex-1 spacer) */
  secondaryActions?: React.ReactNode;
  /** Primary CTA (rightmost) */
  primaryAction?: React.ReactNode;
  className?: string;
}

/**
 * AdminToolbar — Single-row search + filter + actions bar per standards/20-admin-ui-design.md § 2.
 *
 * Layout: [search] [filters] ...flex-1 spacer... [secondaryActions] [primaryAction]
 */
export default function AdminToolbar({
  search,
  filters,
  secondaryActions,
  primaryAction,
  className,
}: AdminToolbarProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      {search && (
        <div className="relative min-w-[200px] max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder={search.placeholder ?? 'Search...'}
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
      )}
      {filters}
      <div className="flex-1" />
      {secondaryActions}
      {primaryAction}
    </div>
  );
}
