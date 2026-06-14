'use client';

/**
 * StatusPill —— agent-playground 状态徽章，现为 ui/badges/StatusBadge 的薄封装。
 *
 * 把 StatusKey 映射到统一 StatusBadge 的 tone + 语义图标；公开 API 不变
 * （status / showLabel / size），调用点无需改动。视觉 SSOT 在 StatusBadge。
 */

import {
  CheckCircle2,
  Circle,
  Loader2,
  X as XIcon,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';
import { statusToken, type StatusKey } from '@/lib/design/tokens';
import {
  StatusBadge,
  type BadgeTone,
  type BadgeSize,
} from '@/components/ui/badges';

const STATUS_MAP: Record<StatusKey, { tone: BadgeTone; icon: LucideIcon }> = {
  done: { tone: 'success', icon: CheckCircle2 },
  running: { tone: 'running', icon: Loader2 },
  failed: { tone: 'danger', icon: XIcon },
  pending: { tone: 'neutral', icon: Circle },
  blocked: { tone: 'warning', icon: AlertTriangle },
  cancelled: { tone: 'neutral', icon: XIcon },
};

interface StatusPillProps {
  status: StatusKey;
  /** 是否显示文字 label（默认 true） */
  showLabel?: boolean;
  size?: BadgeSize;
}

export function StatusPill({
  status,
  showLabel = true,
  size = 'sm',
}: StatusPillProps) {
  const { tone, icon } = STATUS_MAP[status];
  return (
    <StatusBadge
      tone={tone}
      icon={icon}
      pulse={status === 'running'}
      size={size}
      label={showLabel ? statusToken[status].label : ''}
    />
  );
}
