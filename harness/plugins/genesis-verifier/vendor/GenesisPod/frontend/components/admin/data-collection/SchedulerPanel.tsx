'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Calendar,
  Play,
  RefreshCw,
  Activity,
  Clock,
  Database,
  AlertCircle,
} from 'lucide-react';
import { Switch } from '@/components/ui/primitives/switch';
import { createLogger } from '@/lib/utils/logger';
import {
  getSchedulerStatus,
  updateSchedulerConfig,
  triggerAllCollections,
  triggerCollection,
  SchedulerStatus,
  SchedulerInfo,
} from '@/services/data-collection/api';

const logger = createLogger('SchedulerPanel');

interface SchedulerPanelProps {
  onRefresh?: () => void;
}

function formatTimeAgo(dateString?: string): string {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatTimeUntil(dateString?: string): string {
  if (!dateString) return '--';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  if (diffMs < 0) return 'Overdue';

  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
}

function SchedulerRow({
  scheduler,
  onTrigger,
}: {
  scheduler: SchedulerInfo;
  onTrigger: (resourceType: string) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-center gap-3">
        <span
          className={`h-2 w-2 rounded-full ${
            scheduler.isRunning ? 'animate-pulse bg-blue-500' : 'bg-emerald-500'
          }`}
        />
        <span className="w-28 font-medium text-gray-900">
          {scheduler.resourceType}
        </span>
        <span className="flex items-center gap-1 text-sm text-gray-500">
          <Database className="h-3.5 w-3.5" />
          {scheduler.activeSourceCount} sources
        </span>
        <span className="text-sm text-gray-500">
          {scheduler.isRunning ? 'Running...' : 'Idle'}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-4 text-sm text-gray-500">
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            Last: {formatTimeAgo(scheduler.lastRun)}
          </span>
        </div>
        <button
          onClick={() => onTrigger(scheduler.resourceType)}
          disabled={scheduler.isRunning}
          className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play className="mr-1 inline h-3 w-3" />
          Run
        </button>
      </div>
    </div>
  );
}

export default function SchedulerPanel({ onRefresh }: SchedulerPanelProps) {
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await getSchedulerStatus();
      setStatus(response);
    } catch (err) {
      logger.error('Failed to fetch scheduler status:', err);
      setError(
        err instanceof Error ? err.message : 'Failed to load scheduler status'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Auto-refresh status every 30 seconds when enabled
  useEffect(() => {
    if (!status?.enabled) return;

    const interval = setInterval(() => {
      fetchStatus();
    }, 30000);

    return () => clearInterval(interval);
  }, [status?.enabled, fetchStatus]);

  const handleToggle = async (enabled: boolean) => {
    if (updating) return;
    try {
      setUpdating(true);
      setError(null);
      const response = await updateSchedulerConfig({ enabled });
      setStatus(response);
    } catch (err) {
      logger.error('Failed to update scheduler config:', err);
      setError(
        err instanceof Error ? err.message : 'Failed to update configuration'
      );
    } finally {
      setUpdating(false);
    }
  };

  const handleIntervalChange = async (interval: '6h' | '12h' | '24h') => {
    if (updating) return;
    try {
      setUpdating(true);
      setError(null);
      const response = await updateSchedulerConfig({
        defaultInterval: interval,
      });
      setStatus(response);
    } catch (err) {
      logger.error('Failed to update interval:', err);
      setError(
        err instanceof Error ? err.message : 'Failed to update interval'
      );
    } finally {
      setUpdating(false);
    }
  };

  const handleRunAll = async () => {
    if (triggering) return;
    try {
      setTriggering(true);
      setError(null);
      await triggerAllCollections();
      // Refresh status after triggering
      await fetchStatus();
      onRefresh?.();
    } catch (err) {
      logger.error('Failed to trigger all collections:', err);
      setError(
        err instanceof Error ? err.message : 'Failed to trigger collections'
      );
    } finally {
      setTriggering(false);
    }
  };

  const handleTriggerSingle = async (resourceType: string) => {
    try {
      setError(null);
      await triggerCollection(resourceType);
      // Refresh status after triggering
      await fetchStatus();
      onRefresh?.();
    } catch (err) {
      logger.error(`Failed to trigger ${resourceType} collection:`, err);
      setError(
        err instanceof Error ? err.message : `Failed to trigger ${resourceType}`
      );
    }
  };

  if (loading) {
    return (
      <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50/50 p-6">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 animate-spin text-blue-600" />
          <span className="text-sm text-gray-600">
            Loading scheduler status...
          </span>
        </div>
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className="mb-6 rounded-xl border border-red-200 bg-red-50/50 p-6">
        <div className="flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-red-600" />
          <span className="text-sm text-red-700">{error}</span>
          <button
            onClick={fetchStatus}
            className="ml-auto text-sm font-medium text-red-600 hover:text-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50/50 p-6">
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <Calendar className="h-5 w-5 text-blue-600" />
        <h2 className="text-lg font-semibold text-gray-900">
          Automatic Collection Scheduler
        </h2>
        <button
          onClick={fetchStatus}
          className="ml-auto rounded-lg border border-gray-200 bg-white p-1.5 text-gray-500 hover:bg-gray-50 hover:text-gray-700"
          title="Refresh status"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Main toggle + interval selection */}
      <div className="mb-4 flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-4">
          <Switch
            checked={status?.enabled ?? false}
            onCheckedChange={handleToggle}
            disabled={updating}
          />
          <span className="font-medium text-gray-900">
            {status?.enabled ? 'Enabled' : 'Disabled'}
          </span>
          {status?.enabled && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
              Active
            </span>
          )}
        </div>

        {status?.enabled && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">Default Interval:</span>
            <select
              value={status.defaultInterval}
              onChange={(e) =>
                handleIntervalChange(e.target.value as '6h' | '12h' | '24h')
              }
              className="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              disabled={updating}
            >
              <option value="6h">Every 6 hours</option>
              <option value="12h">Every 12 hours</option>
              <option value="24h">Every 24 hours</option>
            </select>
          </div>
        )}
      </div>

      {/* Scheduler list */}
      {status?.enabled && status.schedulers.length > 0 && (
        <div className="mb-4 space-y-2">
          <div className="mb-2 text-sm font-medium text-gray-700">
            Active Schedulers ({status.schedulers.length})
          </div>
          {status.schedulers.map((scheduler) => (
            <SchedulerRow
              key={scheduler.resourceType}
              scheduler={scheduler}
              onTrigger={handleTriggerSingle}
            />
          ))}
        </div>
      )}

      {/* No schedulers message */}
      {status?.enabled && status.schedulers.length === 0 && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4 text-center text-sm text-gray-500">
          No active collection rules configured. Add rules in the Collection
          Configuration section.
        </div>
      )}

      {/* Action buttons */}
      {status?.enabled && (
        <div className="flex gap-2">
          <button
            onClick={handleRunAll}
            disabled={triggering || status.schedulers.length === 0}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {triggering ? (
              <>
                <Activity className="h-4 w-4 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Run All Now
              </>
            )}
          </button>
          <span className="flex items-center text-sm text-gray-500">
            {status.activeExecutions > 0 && (
              <>
                <Activity className="mr-1 h-4 w-4 animate-pulse text-blue-500" />
                {status.activeExecutions} running
              </>
            )}
          </span>
        </div>
      )}

      {/* Info when disabled */}
      {!status?.enabled && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
          <p>
            Automatic collection is currently disabled. Enable it to
            automatically collect data from all configured sources at regular
            intervals.
          </p>
          <p className="mt-2 text-xs text-gray-500">
            Set{' '}
            <code className="rounded bg-gray-100 px-1">
              DATA_COLLECTION_ENABLED=true
            </code>{' '}
            in environment variables for server-side persistence.
          </p>
        </div>
      )}
    </div>
  );
}
