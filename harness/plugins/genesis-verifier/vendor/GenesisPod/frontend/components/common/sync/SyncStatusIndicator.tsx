'use client';

import {
  RefreshCw,
  Check,
  AlertTriangle,
  Clock,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { StatusBadge, type BadgeTone } from '@/components/ui/badges';

export type SyncStatus =
  | 'synced'
  | 'syncing'
  | 'pending'
  | 'conflict'
  | 'error'
  | 'not_connected';

interface SyncStatusIndicatorProps {
  status: SyncStatus;
  lastSyncAt?: Date | string | null;
  pendingChanges?: {
    local?: number;
    remote?: number;
    conflicts?: number;
  };
  className?: string;
  showLabel?: boolean;
}

const STATUS_MAP: Record<
  SyncStatus,
  { tone: BadgeTone; icon: LucideIcon; label: string; pulse?: boolean }
> = {
  synced: { tone: 'success', icon: Check, label: 'Synced' },
  syncing: { tone: 'running', icon: Loader2, label: 'Syncing...', pulse: true },
  pending: { tone: 'warning', icon: Clock, label: 'Pending' },
  conflict: { tone: 'warning', icon: AlertTriangle, label: 'Conflict' },
  error: { tone: 'danger', icon: AlertTriangle, label: 'Error' },
  not_connected: { tone: 'neutral', icon: RefreshCw, label: 'Not Connected' },
};

/**
 * 同步状态指示器：状态徽章走统一 StatusBadge，待同步计数 + 上次同步时间保留。
 */
export function SyncStatusIndicator({
  status,
  lastSyncAt,
  pendingChanges,
  className = '',
  showLabel = true,
}: SyncStatusIndicatorProps) {
  const cfg = STATUS_MAP[status] || STATUS_MAP.not_connected;

  const formatLastSync = (date: Date | string | null | undefined): string => {
    if (!date) return 'Never';
    const d = typeof date === 'string' ? new Date(date) : date;
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const hasPendingChanges =
    pendingChanges &&
    ((pendingChanges.local || 0) > 0 ||
      (pendingChanges.remote || 0) > 0 ||
      (pendingChanges.conflicts || 0) > 0);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <StatusBadge
        tone={cfg.tone}
        icon={cfg.icon}
        pulse={cfg.pulse}
        label={showLabel ? cfg.label : ''}
        size="md"
      />

      {hasPendingChanges && (
        <div className="flex items-center gap-1 text-xs text-gray-500">
          {(pendingChanges.local || 0) > 0 && (
            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-700">
              {pendingChanges.local} local
            </span>
          )}
          {(pendingChanges.remote || 0) > 0 && (
            <span className="rounded bg-purple-100 px-1.5 py-0.5 text-purple-700">
              {pendingChanges.remote} remote
            </span>
          )}
          {(pendingChanges.conflicts || 0) > 0 && (
            <span className="rounded bg-orange-100 px-1.5 py-0.5 text-orange-700">
              {pendingChanges.conflicts} conflicts
            </span>
          )}
        </div>
      )}

      {lastSyncAt && status !== 'syncing' && (
        <span className="text-xs text-gray-400">
          Last: {formatLastSync(lastSyncAt)}
        </span>
      )}
    </div>
  );
}
