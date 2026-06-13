// 纯展示组件 — 无 hooks/state，可在 RSC 中复用（不写 'use client'）。
import { cn } from '@/lib/utils/common';
import {
  type StatusType,
  STATUS_COLORS,
  getStatusBadgeClasses,
} from '@/lib/features/admin/styles';

interface AdminStatusBadgeProps {
  status: StatusType;
  label: string;
  /** Show a colored dot before the label */
  dot?: boolean;
  className?: string;
}

/**
 * AdminStatusBadge — Status pill that enforces use of `getStatusBadgeClasses`
 * from `lib/admin/styles` (per standards/20-admin-ui-design.md).
 *
 * Callers MUST use this component rather than rolling their own
 * `bg-X-100 text-X-700` className soup.
 */
export default function AdminStatusBadge({
  status,
  label,
  dot = false,
  className,
}: AdminStatusBadgeProps) {
  const colors = STATUS_COLORS[status];

  return (
    <span className={cn(getStatusBadgeClasses(status), className)}>
      {dot && (
        <span
          className={cn('h-1.5 w-1.5 rounded-full', colors.dot)}
          aria-hidden="true"
        />
      )}
      {label}
    </span>
  );
}
