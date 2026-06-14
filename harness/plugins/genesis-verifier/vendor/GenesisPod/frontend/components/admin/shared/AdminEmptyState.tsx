// 纯展示组件 — 无 hooks/state，可在 RSC 中复用（不写 'use client'）。
import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/common';

interface AdminEmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

/**
 * AdminEmptyState — Standalone empty state per standards/20-admin-ui-design.md § 3.
 *
 * For use outside `AdminDataTable` (which has its own emptyState slot).
 */
export default function AdminEmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: AdminEmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-4 py-12 text-center',
        className
      )}
    >
      {Icon && <Icon className="mb-3 h-12 w-12 text-gray-300" />}
      <h3 className="text-sm font-medium text-gray-900">{title}</h3>
      {description && (
        <p className="mt-1 text-sm text-gray-500">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
