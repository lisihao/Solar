'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/common';

export interface AdminTab {
  key: string;
  label: string;
  icon?: LucideIcon;
}

interface AdminTabsProps {
  tabs: AdminTab[];
  /** Required when mode === 'controlled' */
  activeKey?: string;
  onChange?: (key: string) => void;
  /**
   * 'controlled': parent owns activeKey via state
   * 'route': syncs to URL query param (?tab=key)
   */
  mode?: 'controlled' | 'route';
  /** Query param name, defaults to 'tab' (mode='route' only) */
  paramName?: string;
  className?: string;
}

/**
 * AdminTabs — Segmented control per standards/20-admin-ui-design.md § 2.
 *
 * Two modes:
 * - `controlled`: parent manages activeKey + onChange
 * - `route`: syncs to URL ?{paramName}=key, default param 'tab'
 */
export default function AdminTabs({
  tabs,
  activeKey,
  onChange,
  mode = 'controlled',
  paramName = 'tab',
  className,
}: AdminTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const routeKey =
    mode === 'route' ? (searchParams?.get(paramName) ?? null) : null;
  const current = routeKey ?? activeKey ?? tabs[0]?.key;

  const handleClick = (key: string) => {
    if (mode === 'route' && pathname) {
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      params.set(paramName, key);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
    onChange?.(key);
  };

  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex items-center rounded-lg border border-gray-300 bg-white p-1 shadow-sm',
        className
      )}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = current === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => handleClick(tab.key)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-emerald-50 text-emerald-700'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            )}
          >
            {Icon && <Icon className="h-4 w-4" />}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
