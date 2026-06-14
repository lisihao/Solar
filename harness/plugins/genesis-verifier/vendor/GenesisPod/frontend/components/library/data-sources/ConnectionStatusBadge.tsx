'use client';

import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  AlertCircle,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { useTranslation } from '@/lib/i18n';
import { StatusBadge, type BadgeTone } from '@/components/ui/badges';

export type ConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'syncing'
  | 'needs_reauth'
  | 'error';

interface ConnectionStatusBadgeProps {
  status: ConnectionStatus;
  /** Optional: Show only icon without text */
  iconOnly?: boolean;
  /** Optional: Additional CSS classes */
  className?: string;
}

const STATUS_MAP: Record<
  ConnectionStatus,
  { tone: BadgeTone; icon: LucideIcon; labelKey: string; pulse?: boolean }
> = {
  connected: {
    tone: 'success',
    icon: CheckCircle2,
    labelKey: 'dataSources.connected',
  },
  syncing: {
    tone: 'running',
    icon: Loader2,
    labelKey: 'dataSources.syncing',
    pulse: true,
  },
  needs_reauth: {
    tone: 'warning',
    icon: RefreshCw,
    labelKey: 'dataSources.needsReauth',
  },
  error: { tone: 'danger', icon: AlertCircle, labelKey: 'common.error' },
  disconnected: {
    tone: 'neutral',
    icon: XCircle,
    labelKey: 'dataSources.notConnected',
  },
};

/**
 * 连接状态徽章，现为 ui/badges/StatusBadge 的薄封装（enum→tone）。
 * 公开 API 不变（status / iconOnly / className）。
 */
export default function ConnectionStatusBadge({
  status,
  iconOnly = false,
  className = '',
}: ConnectionStatusBadgeProps) {
  const { t } = useTranslation();
  const cfg = STATUS_MAP[status] ?? STATUS_MAP.disconnected;
  const label = t(cfg.labelKey);

  if (iconOnly) {
    const Icon = cfg.icon;
    return (
      <span
        className={cn('inline-flex items-center justify-center', className)}
        title={label}
      >
        <Icon className={cn('h-4 w-4', cfg.pulse && 'animate-spin')} />
      </span>
    );
  }

  return (
    <StatusBadge
      tone={cfg.tone}
      icon={cfg.icon}
      pulse={cfg.pulse}
      label={label}
      size="md"
      className={className}
    />
  );
}
