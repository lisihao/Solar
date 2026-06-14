'use client';

import { useState } from 'react';
import { RefreshCw, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { SyncStatusIndicator, SyncStatus } from './SyncStatusIndicator';

export type SyncDirection = 'push' | 'pull' | 'both';

interface SyncControlsProps {
  status: SyncStatus;
  lastSyncAt?: Date | string | null;
  pendingChanges?: {
    local?: number;
    remote?: number;
    conflicts?: number;
  };
  onSync: (direction: SyncDirection) => Promise<void>;
  disabled?: boolean;
  showDirectionButtons?: boolean;
  className?: string;
}

export function SyncControls({
  status,
  lastSyncAt,
  pendingChanges,
  onSync,
  disabled = false,
  showDirectionButtons = false,
  className = '',
}: SyncControlsProps) {
  const [syncing, setSyncing] = useState(false);

  const handleSync = async (direction: SyncDirection) => {
    if (syncing || disabled) return;
    setSyncing(true);
    try {
      await onSync(direction);
    } finally {
      setSyncing(false);
    }
  };

  const isDisabled = disabled || syncing || status === 'syncing';
  const currentStatus = syncing ? 'syncing' : status;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <SyncStatusIndicator
        status={currentStatus}
        lastSyncAt={lastSyncAt}
        pendingChanges={pendingChanges}
      />

      <div className="flex items-center gap-1">
        {showDirectionButtons ? (
          <>
            <button
              onClick={() => handleSync('push')}
              disabled={isDisabled}
              className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors ${
                isDisabled
                  ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                  : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
              }`}
              title="Push local changes to cloud"
            >
              <ArrowUp className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Push</span>
            </button>
            <button
              onClick={() => handleSync('pull')}
              disabled={isDisabled}
              className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors ${
                isDisabled
                  ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                  : 'bg-purple-50 text-purple-700 hover:bg-purple-100'
              }`}
              title="Pull changes from cloud"
            >
              <ArrowDown className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Pull</span>
            </button>
            <button
              onClick={() => handleSync('both')}
              disabled={isDisabled}
              className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors ${
                isDisabled
                  ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                  : 'bg-green-50 text-green-700 hover:bg-green-100'
              }`}
              title="Sync both ways"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sync All</span>
            </button>
          </>
        ) : (
          <button
            onClick={() => handleSync('both')}
            disabled={isDisabled}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              isDisabled
                ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                : 'bg-gray-900 text-white hover:bg-gray-800'
            }`}
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
        )}
      </div>
    </div>
  );
}
