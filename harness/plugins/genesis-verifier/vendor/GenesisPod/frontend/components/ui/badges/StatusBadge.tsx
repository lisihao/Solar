import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/common';

/**
 * StatusBadge — 状态徽章的视觉 SSOT（presentational）。
 *
 * 各业务域（admin / agent-playground / library / integrations…）把自己的状态
 * 枚举映射到统一的 `tone`，不再各自写 `bg-X-100 text-X-700` 类。语义图标 / 圆点 /
 * 脉冲（running）按需开启。纯展示、无 state，可在 RSC 复用。
 *
 * 取代：AdminStatusBadge / StatusPill / ReadStatusBadge / ConnectionStatusBadge /
 * SyncStatusIndicator / StatusDot（各域改为 enum→tone 的薄封装或直接调用）。
 */
export type BadgeTone =
  | 'success'
  | 'running'
  | 'danger'
  | 'warning'
  | 'info'
  | 'neutral';

export type BadgeSize = 'sm' | 'md';

interface ToneStyle {
  text: string;
  bg: string;
  ring: string;
  dot: string;
}

const TONE_STYLES: Record<BadgeTone, ToneStyle> = {
  success: {
    text: 'text-emerald-700',
    bg: 'bg-emerald-50',
    ring: 'ring-emerald-200',
    dot: 'bg-emerald-500',
  },
  running: {
    text: 'text-blue-700',
    bg: 'bg-blue-50',
    ring: 'ring-blue-200',
    dot: 'bg-blue-500',
  },
  danger: {
    text: 'text-red-700',
    bg: 'bg-red-50',
    ring: 'ring-red-200',
    dot: 'bg-red-500',
  },
  warning: {
    text: 'text-amber-700',
    bg: 'bg-amber-50',
    ring: 'ring-amber-200',
    dot: 'bg-amber-500',
  },
  info: {
    text: 'text-violet-700',
    bg: 'bg-violet-50',
    ring: 'ring-violet-200',
    dot: 'bg-violet-500',
  },
  neutral: {
    text: 'text-gray-600',
    bg: 'bg-gray-100',
    ring: 'ring-gray-200',
    dot: 'bg-gray-400',
  },
};

const SIZE_STYLES: Record<
  BadgeSize,
  { wrap: string; icon: string; dot: string }
> = {
  sm: {
    wrap: 'px-2 py-0.5 text-[11px] gap-1',
    icon: 'h-3 w-3',
    dot: 'h-1.5 w-1.5',
  },
  md: {
    wrap: 'px-2.5 py-1 text-xs gap-1.5',
    icon: 'h-3.5 w-3.5',
    dot: 'h-2 w-2',
  },
};

export interface StatusBadgeProps {
  /** 语义色调；各域把自己的状态枚举映射到此 */
  tone: BadgeTone;
  /** 文案 */
  label: React.ReactNode;
  /** 前置语义图标（与 dot 二选一，icon 优先） */
  icon?: LucideIcon;
  /** 前置圆点（icon 未给时生效） */
  dot?: boolean;
  /** 图标脉冲旋转（running 态常用） */
  pulse?: boolean;
  size?: BadgeSize;
  className?: string;
}

export function StatusBadge({
  tone,
  label,
  icon: Icon,
  dot = false,
  pulse = false,
  size = 'sm',
  className,
}: StatusBadgeProps) {
  const t = TONE_STYLES[tone];
  const s = SIZE_STYLES[size];

  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full font-medium ring-1',
        t.text,
        t.bg,
        t.ring,
        s.wrap,
        className
      )}
    >
      {Icon ? (
        <Icon
          className={cn(s.icon, pulse && 'animate-spin')}
          aria-hidden="true"
        />
      ) : dot ? (
        <span className={cn('rounded-full', s.dot, t.dot)} aria-hidden="true" />
      ) : null}
      {label}
    </span>
  );
}
