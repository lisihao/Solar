'use client';

import { useState, useEffect, useCallback } from 'react';
import { Clock, RefreshCw, Loader2 } from 'lucide-react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';
import { AdminPageLayout } from '@/components/admin/layout';

// ============================
// Types
// ============================

interface SchedulerStats {
  running: number;
  ready: number;
  maxConcurrent: number;
  maxPerTenant: number;
}

// ============================
// StatCard
// ============================

interface StatCardProps {
  label: string;
  value: number;
  colorClass: string;
  subtext?: string;
}

function StatCard({ label, value, colorClass, subtext }: StatCardProps) {
  return (
    <div className="rounded-lg bg-white p-4 shadow">
      <div className={`text-2xl font-bold ${colorClass}`}>{value}</div>
      <div className="text-sm text-gray-500">{label}</div>
      {subtext && <div className="mt-0.5 text-xs text-gray-400">{subtext}</div>}
    </div>
  );
}

// ============================
// UtilizationBar
// ============================

interface UtilizationBarProps {
  running: number;
  maxConcurrent: number;
}

function UtilizationBar({ running, maxConcurrent }: UtilizationBarProps) {
  const pct =
    maxConcurrent > 0 ? Math.min(100, (running / maxConcurrent) * 100) : 0;

  const barColor =
    pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-violet-500';

  return (
    <div className="rounded-lg bg-white p-4 shadow">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium text-gray-700">
          Concurrency Utilization
        </span>
        <span className="text-gray-500">
          {running} / {maxConcurrent} slots
        </span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-gray-400">
        <span>0%</span>
        <span
          className={
            pct >= 90
              ? 'font-semibold text-red-600'
              : pct >= 70
                ? 'font-semibold text-yellow-600'
                : 'text-gray-500'
          }
        >
          {pct.toFixed(1)}%
        </span>
        <span>100%</span>
      </div>
    </div>
  );
}

// ============================
// Main Page
// ============================

export default function KernelSchedulerPageContent({
  embedded,
}: { embedded?: boolean } = {}) {
  const [stats, setStats] = useState<SchedulerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const apiUrl = config.apiUrl;

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/admin/kernel/scheduler/stats`, {
        headers: getAuthHeader(),
      });
      if (!res.ok)
        throw new Error(`Fetch scheduler stats failed: ${res.status}`);
      const json = await res.json();
      const data = (json?.data ?? json) as SchedulerStats;
      setStats(data);
    } catch (err) {
      logger.error('KernelScheduler', 'Failed to fetch scheduler stats', err);
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  // Initial fetch
  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      void fetchStats();
    }, 5_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const refreshButton = (
    <button
      onClick={() => void fetchStats()}
      disabled={loading}
      className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
      Refresh
    </button>
  );

  const body = (
    <div className="space-y-4">
      {embedded && <div className="flex justify-end">{refreshButton}</div>}
      {loading && !stats ? (
        <div className="flex items-center justify-center gap-2 p-12 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading scheduler stats...
        </div>
      ) : !stats ? (
        <div className="rounded-lg bg-white p-12 text-center text-sm text-gray-500 shadow">
          Scheduler stats unavailable.
        </div>
      ) : (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label="Running"
              value={stats.running}
              colorClass="text-green-600"
              subtext="Active processes"
            />
            <StatCard
              label="Ready"
              value={stats.ready}
              colorClass="text-violet-600"
              subtext="Queued for execution"
            />
            <StatCard
              label="Max Concurrent"
              value={stats.maxConcurrent}
              colorClass="text-gray-900"
              subtext="Global slot limit"
            />
            <StatCard
              label="Max Per Tenant"
              value={stats.maxPerTenant}
              colorClass="text-blue-600"
              subtext="Per-tenant slot limit"
            />
          </div>

          {/* Utilization Bar */}
          <UtilizationBar
            running={stats.running}
            maxConcurrent={stats.maxConcurrent}
          />

          {/* Auto-refresh notice */}
          <p className="text-right text-xs text-gray-400">
            Auto-refreshes every 5 seconds
          </p>
        </>
      )}
    </div>
  );

  if (embedded) return body;

  return (
    <AdminPageLayout
      title="Kernel Scheduler"
      description="Monitor AI kernel scheduler capacity and concurrency in real time"
      icon={Clock}
      domain="ai"
      actions={refreshButton}
    >
      {body}
    </AdminPageLayout>
  );
}
