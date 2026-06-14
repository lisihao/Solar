'use client';

import { useState, useEffect, useCallback } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import {
  Gauge,
  RefreshCw,
  Loader2,
  RotateCcw,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';
import { AdminPageLayout } from '@/components/admin/layout';
import { TruncatedCell } from '@/components/common/tables';

// ============================
// Types
// ============================

type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreaker {
  entityId: string;
  state: BreakerState;
  successRate: number;
  avgResponseTime: number;
  isAvailable: boolean;
  currentLoad: number;
  failureCount: number;
  lastFailure?: string;
}

interface CircuitBreakerConfig {
  failureThreshold: number;
  defaultCooldownMs: number;
  rateLimitCooldownMs: number;
  halfOpenSuccessThreshold: number;
  inactiveTtlMs: number;
  cleanupIntervalMs: number;
  maxResponseSamples: number;
}

interface CircuitBreakersResponse {
  breakers: CircuitBreaker[];
  total: number;
}

interface CircuitBreakerStatsResponse {
  totalBreakers: number;
  oldestBreakerAge: number | null;
  config: CircuitBreakerConfig;
}

interface ResetResponse {
  success: boolean;
  entityId: string;
}

// ============================
// Helpers
// ============================

function formatAge(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function getSuccessRateColor(rate: number): string {
  if (rate >= 90) return 'text-green-600';
  if (rate >= 70) return 'text-yellow-600';
  return 'text-red-600';
}

// ============================
// Constants
// ============================

const BREAKER_STATE_BADGE: Record<BreakerState, string> = {
  CLOSED: 'bg-green-100 text-green-800',
  OPEN: 'bg-red-100 text-red-800',
  HALF_OPEN: 'bg-yellow-100 text-yellow-800',
};

// ============================
// StatCard
// ============================

interface StatCardProps {
  label: string;
  value: string | number;
  colorClass?: string;
  subtext?: string;
}

function StatCard({
  label,
  value,
  colorClass = 'text-gray-900',
  subtext,
}: StatCardProps) {
  return (
    <div className="rounded-lg bg-white p-4 shadow">
      <div className={`text-2xl font-bold ${colorClass}`}>{value}</div>
      <div className="text-sm text-gray-500">{label}</div>
      {subtext && <div className="mt-1 text-xs text-gray-400">{subtext}</div>}
    </div>
  );
}

// ============================
// CircuitBreakerRow
// ============================

interface CircuitBreakerRowProps {
  breaker: CircuitBreaker;
  onReset: (entityId: string) => Promise<void>;
  resetting: boolean;
}

function CircuitBreakerRow({
  breaker,
  onReset,
  resetting,
}: CircuitBreakerRowProps) {
  const badgeClass =
    BREAKER_STATE_BADGE[breaker.state] ?? 'bg-gray-100 text-gray-600';
  const rateColor = getSuccessRateColor(breaker.successRate);

  return (
    <Tr className="hover:bg-gray-50">
      {/* Entity ID */}
      <Td className="px-4 py-3">
        <TruncatedCell className="font-mono max-w-[240px] text-xs text-gray-700">
          {breaker.entityId}
        </TruncatedCell>
      </Td>

      {/* State */}
      <Td className="px-4 py-3">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}
        >
          {breaker.state}
        </span>
      </Td>

      {/* Success Rate */}
      <Td className="px-4 py-3">
        <span className={`text-sm font-medium ${rateColor}`}>
          {breaker.successRate.toFixed(1)}%
        </span>
      </Td>

      {/* Avg Response Time */}
      <Td className="px-4 py-3 text-sm text-gray-600">
        {formatMs(breaker.avgResponseTime)}
      </Td>

      {/* Current Load */}
      <Td className="px-4 py-3 text-sm text-gray-600">{breaker.currentLoad}</Td>

      {/* Available */}
      <Td className="px-4 py-3">
        {breaker.isAvailable ? (
          <CheckCircle className="h-4 w-4 text-green-600" />
        ) : (
          <XCircle className="h-4 w-4 text-red-500" />
        )}
      </Td>

      {/* Actions */}
      <Td className="px-4 py-3">
        <button
          title="Reset circuit breaker"
          disabled={resetting}
          onClick={() => void onReset(breaker.entityId)}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40"
        >
          {resetting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" />
          )}
          Reset
        </button>
      </Td>
    </Tr>
  );
}

// ============================
// Main Page
// ============================

export default function KernelResourcesPageContent({
  embedded,
}: { embedded?: boolean } = {}) {
  const [breakers, setBreakers] = useState<CircuitBreaker[]>([]);
  const [breakerStats, setBreakerStats] =
    useState<CircuitBreakerStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [resettingIds, setResettingIds] = useState<Set<string>>(new Set());

  const apiUrl = config.apiUrl;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [breakersRes, statsRes] = await Promise.all([
        fetch(`${apiUrl}/admin/kernel/resources/circuit-breakers`, {
          headers: getAuthHeader(),
        }),
        fetch(`${apiUrl}/admin/kernel/resources/circuit-breakers/stats`, {
          headers: getAuthHeader(),
        }),
      ]);

      if (breakersRes.ok) {
        const json = await breakersRes.json();
        const data = (json?.data ?? json) as CircuitBreakersResponse;
        setBreakers(data.breakers ?? []);
      }

      if (statsRes.ok) {
        const json = await statsRes.json();
        const data = (json?.data ?? json) as CircuitBreakerStatsResponse;
        setBreakerStats(data);
      }
    } catch (err) {
      logger.error('KernelResources', 'Failed to fetch resource data', err);
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  // Initial fetch
  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      void fetchData();
    }, 10_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleReset = useCallback(
    async (entityId: string) => {
      setResettingIds((prev) => new Set(prev).add(entityId));
      try {
        const res = await fetch(
          `${apiUrl}/admin/kernel/resources/circuit-breakers/${encodeURIComponent(entityId)}/reset`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...getAuthHeader(),
            },
          }
        );
        if (!res.ok) throw new Error(`Reset failed: ${res.status}`);
        const json = await res.json();
        const data = (json?.data ?? json) as ResetResponse;
        if (data.success) {
          // Refresh data after a successful reset
          void fetchData();
        }
      } catch (err) {
        logger.error(
          'KernelResources',
          `Failed to reset breaker ${entityId}`,
          err
        );
      } finally {
        setResettingIds((prev) => {
          const next = new Set(prev);
          next.delete(entityId);
          return next;
        });
      }
    },
    [apiUrl, fetchData]
  );

  // Derived counts
  const openCount = breakers.filter((b) => b.state === 'OPEN').length;
  const halfOpenCount = breakers.filter((b) => b.state === 'HALF_OPEN').length;
  const closedCount = breakers.filter((b) => b.state === 'CLOSED').length;

  const refreshButton = (
    <button
      onClick={() => void fetchData()}
      disabled={loading}
      className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
      Refresh
    </button>
  );

  const body = (
    <div className="space-y-6">
      {embedded && <div className="flex justify-end">{refreshButton}</div>}
      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Total Breakers"
          value={breakerStats?.totalBreakers ?? breakers.length}
          colorClass="text-gray-900"
        />
        <StatCard
          label="Closed (Healthy)"
          value={closedCount}
          colorClass="text-green-600"
        />
        <StatCard
          label="Open (Tripped)"
          value={openCount}
          colorClass="text-red-600"
        />
        <StatCard
          label="Half-Open (Testing)"
          value={halfOpenCount}
          colorClass="text-yellow-600"
        />
      </div>

      {/* Config Info */}
      {breakerStats?.config && (
        <div className="rounded-lg bg-white p-4 shadow">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Circuit Breaker Configuration
          </h3>
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <span className="text-gray-500">Failure Threshold:</span>{' '}
              <span className="font-medium text-gray-800">
                {breakerStats.config.failureThreshold}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Default Cooldown:</span>{' '}
              <span className="font-medium text-gray-800">
                {formatMs(breakerStats.config.defaultCooldownMs)}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Rate Limit Cooldown:</span>{' '}
              <span className="font-medium text-gray-800">
                {formatMs(breakerStats.config.rateLimitCooldownMs)}
              </span>
            </div>
            <div>
              <span className="text-gray-500">
                Half-Open Success Threshold:
              </span>{' '}
              <span className="font-medium text-gray-800">
                {breakerStats.config.halfOpenSuccessThreshold}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Oldest Breaker Age:</span>{' '}
              <span className="font-medium text-gray-800">
                {formatAge(breakerStats.oldestBreakerAge)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Circuit Breakers Table */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            Circuit Breakers
          </h2>
          {breakers.length > 0 && (
            <span className="text-xs text-gray-400">
              {breakers.length} registered
            </span>
          )}
        </div>

        <div className="rounded-lg bg-white shadow">
          {loading && breakers.length === 0 ? (
            <div className="flex items-center justify-center gap-2 p-12 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading circuit breakers...
            </div>
          ) : breakers.length === 0 ? (
            <EmptyState
              icon={<Gauge className="h-12 w-12" />}
              title="No circuit breakers registered."
              size="sm"
            />
          ) : (
            <div className="overflow-x-auto">
              <Table className="w-full table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-[28%]" />
                  <col className="w-[12%]" />
                  <col className="w-[14%]" />
                  <col className="w-[14%]" />
                  <col className="w-[8%]" />
                  <col className="w-[10%]" />
                  <col className="w-[14%]" />
                </colgroup>
                <THead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                  <Tr>
                    <Th className="px-4 py-3">Entity ID</Th>
                    <Th className="px-4 py-3">State</Th>
                    <Th className="px-4 py-3">Success Rate</Th>
                    <Th className="px-4 py-3">Avg Response</Th>
                    <Th className="px-4 py-3">Load</Th>
                    <Th className="px-4 py-3">Available</Th>
                    <Th className="px-4 py-3">Actions</Th>
                  </Tr>
                </THead>
                <TBody className="divide-y">
                  {breakers.map((breaker) => (
                    <CircuitBreakerRow
                      key={breaker.entityId}
                      breaker={breaker}
                      onReset={handleReset}
                      resetting={resettingIds.has(breaker.entityId)}
                    />
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </div>
      </section>
    </div>
  );

  if (embedded) return body;

  return (
    <AdminPageLayout
      title="Resource Control"
      description="Monitor circuit breakers and resource availability across AI engine components"
      icon={Gauge}
      domain="ai"
      actions={refreshButton}
    >
      {body}
    </AdminPageLayout>
  );
}
