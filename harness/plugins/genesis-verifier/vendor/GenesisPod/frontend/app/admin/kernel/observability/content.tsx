'use client';

import { useState, useEffect, useCallback } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import {
  Activity,
  RefreshCw,
  Loader2,
  DollarSign,
  BarChart3,
  AlertCircle,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { Tabs } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';
import { AdminPageLayout } from '@/components/admin/layout';
import { TruncatedCell } from '@/components/common/tables';

// ============================
// Types
// ============================

interface DashboardPeriod {
  startTime: string;
  endTime: string;
  minutes: number;
}

interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

interface Latency {
  p50: number;
  p95: number;
  p99: number;
}

interface ModelMetric {
  model: string;
  calls: number;
  tokens: number;
  cost: number;
  avgLatencyMs: number;
  errorRate: number;
}

interface ModuleMetric {
  moduleType: string;
  calls: number;
  tokens: number;
  cost: number;
  topModels: string[];
}

interface UserMetric {
  userId: string;
  calls: number;
  tokens: number;
  cost: number;
}

interface RecentError {
  id: string;
  model: string;
  error: string;
  timestamp: string;
}

interface DashboardData {
  period: DashboardPeriod;
  totalCalls: number;
  totalTokens: TokenUsage;
  totalCost: number;
  successRate: number;
  latency: Latency;
  fallbackRate: number;
  byModel: ModelMetric[];
  byModule: ModuleMetric[];
  byUser: UserMetric[];
  recentErrors: RecentError[];
}

interface CostsPeriod {
  hours: number;
  startTime: string;
  endTime: string;
}

interface CostsByUser {
  userId: string;
  totalCost: number;
  totalTokens: number;
  callCount: number;
  topModule: string;
  topModel: string;
}

interface CostsByModule {
  moduleType: string;
  totalCost: number;
  totalTokens: number;
  callCount: number;
  avgCostPerCall: number;
}

interface CostsByModel {
  model: string;
  provider: string;
  totalCost: number;
  totalTokens: number;
  callCount: number;
  avgTokensPerCall: number;
}

interface HourlyTrendItem {
  hour: string;
  cost: number;
  tokens: number;
  calls: number;
}

interface CostsData {
  period: CostsPeriod;
  totalCost: number;
  totalTokens: TokenUsage;
  byUser: CostsByUser[];
  byModule: CostsByModule[];
  byModel: CostsByModel[];
  hourlyTrend: HourlyTrendItem[];
}

// ============================
// Constants
// ============================

const METRICS_PERIODS = [
  { value: 15, label: '15m' },
  { value: 30, label: '30m' },
  { value: 60, label: '1h' },
  { value: 120, label: '2h' },
  { value: 360, label: '6h' },
  { value: 720, label: '12h' },
  { value: 1440, label: '24h' },
] as const;
const COSTS_HOURS = [1, 6, 12, 24] as const;

// ============================
// Helpers
// ============================

function formatCost(value: number): string {
  if (value >= 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(5)}`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

// ============================
// StatCard
// ============================

interface StatCardProps {
  label: string;
  value: string;
  colorClass?: string;
  subtext?: string;
  icon?: React.ReactNode;
}

function StatCard({
  label,
  value,
  colorClass = 'text-gray-900',
  subtext,
  icon,
}: StatCardProps) {
  return (
    <div className="rounded-lg bg-white p-4 shadow">
      {icon && <div className="mb-1 text-gray-400">{icon}</div>}
      <div className={`text-2xl font-bold ${colorClass}`}>{value}</div>
      <div className="text-sm text-gray-500">{label}</div>
      {subtext && <div className="mt-0.5 text-xs text-gray-400">{subtext}</div>}
    </div>
  );
}

// ============================
// SectionHeader
// ============================

function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
      {title}
    </h3>
  );
}

// ============================
// DataTable
// ============================

interface Column<T> {
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  keyFn: (row: T) => string;
  emptyMessage?: string;
  colWidths?: string[];
}

function DataTable<T>({
  columns,
  rows,
  keyFn,
  emptyMessage = 'No data',
  colWidths,
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg bg-white p-6 text-center text-sm text-gray-400 shadow">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg bg-white shadow">
      <Table className="w-full table-fixed text-left text-sm">
        {colWidths && (
          <colgroup>
            {colWidths.map((w, i) => (
              <col key={i} className={w} />
            ))}
          </colgroup>
        )}
        <THead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
          <Tr>
            {columns.map((col) => (
              <Th
                key={col.header}
                className={`px-4 py-3 ${col.className ?? ''}`}
              >
                {col.header}
              </Th>
            ))}
          </Tr>
        </THead>
        <TBody className="divide-y">
          {rows.map((row) => (
            <Tr key={keyFn(row)} className="hover:bg-gray-50">
              {columns.map((col) => (
                <Td
                  key={col.header}
                  className={`px-4 py-3 ${col.className ?? ''}`}
                >
                  {col.render(row)}
                </Td>
              ))}
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

// ============================
// MetricsTab
// ============================

interface MetricsTabProps {
  data: DashboardData | null;
  loading: boolean;
}

function MetricsTab({ data, loading }: MetricsTabProps) {
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 p-12 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading metrics...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg bg-white p-12 text-center text-sm text-gray-500 shadow">
        Metrics unavailable.
      </div>
    );
  }

  const modelColumns: Column<ModelMetric>[] = [
    {
      header: 'Model',
      render: (row) => (
        <TruncatedCell className="font-mono max-w-[200px] text-xs text-gray-800">
          {row.model}
        </TruncatedCell>
      ),
    },
    {
      header: 'Calls',
      render: (row) => (
        <span className="text-gray-700">{row.calls.toLocaleString()}</span>
      ),
    },
    {
      header: 'Tokens',
      render: (row) => (
        <span className="text-gray-700">{formatTokens(row.tokens)}</span>
      ),
    },
    {
      header: 'Cost',
      render: (row) => (
        <span className="font-medium text-emerald-700">
          {formatCost(row.cost)}
        </span>
      ),
    },
    {
      header: 'Avg Latency',
      render: (row) => (
        <span className="text-gray-600">{formatLatency(row.avgLatencyMs)}</span>
      ),
    },
    {
      header: 'Error Rate',
      render: (row) => (
        <span
          className={
            row.errorRate > 0.05 ? 'font-medium text-red-600' : 'text-gray-600'
          }
        >
          {formatPercent(row.errorRate)}
        </span>
      ),
    },
  ];

  const moduleColumns: Column<ModuleMetric>[] = [
    {
      header: 'Module',
      render: (row) => (
        <span className="font-medium text-gray-800">{row.moduleType}</span>
      ),
    },
    {
      header: 'Calls',
      render: (row) => (
        <span className="text-gray-700">{row.calls.toLocaleString()}</span>
      ),
    },
    {
      header: 'Tokens',
      render: (row) => (
        <span className="text-gray-700">{formatTokens(row.tokens)}</span>
      ),
    },
    {
      header: 'Cost',
      render: (row) => (
        <span className="font-medium text-emerald-700">
          {formatCost(row.cost)}
        </span>
      ),
    },
    {
      header: 'Top Models',
      render: (row) => (
        <TruncatedCell className="max-w-[180px] text-xs text-gray-500">
          {row.topModels.slice(0, 2).join(', ') || '-'}
        </TruncatedCell>
      ),
    },
  ];

  const recentErrors = data.recentErrors.slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Summary stat cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <StatCard
          label="Total Calls"
          value={data.totalCalls.toLocaleString()}
          colorClass="text-gray-900"
          icon={<BarChart3 className="h-4 w-4" />}
        />
        <StatCard
          label="Total Tokens"
          value={formatTokens(data.totalTokens.total)}
          colorClass="text-violet-700"
          subtext={`in ${formatTokens(data.totalTokens.input)} / out ${formatTokens(data.totalTokens.output)}`}
        />
        <StatCard
          label="Total Cost"
          value={formatCost(data.totalCost)}
          colorClass="text-emerald-700"
          icon={<DollarSign className="h-4 w-4" />}
        />
        <StatCard
          label="Success Rate"
          value={formatPercent(data.successRate)}
          colorClass={
            data.successRate < 0.9 ? 'text-red-600' : 'text-green-600'
          }
        />
        <StatCard
          label="Latency P50"
          value={formatLatency(data.latency.p50)}
          colorClass="text-blue-700"
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatCard
          label="Latency P95"
          value={formatLatency(data.latency.p95)}
          colorClass="text-blue-700"
        />
        <StatCard
          label="Latency P99"
          value={formatLatency(data.latency.p99)}
          colorClass={
            data.latency.p99 > 10_000 ? 'text-red-600' : 'text-blue-700'
          }
          subtext={`fallback ${formatPercent(data.fallbackRate)}`}
        />
      </div>

      {/* By Model */}
      <div className="space-y-2">
        <SectionHeader title="By Model" />
        <DataTable
          columns={modelColumns}
          rows={data.byModel}
          keyFn={(row) => row.model}
          emptyMessage="No model data in this period"
          colWidths={[
            'w-[28%]',
            'w-[12%]',
            'w-[14%]',
            'w-[14%]',
            'w-[16%]',
            'w-[16%]',
          ]}
        />
      </div>

      {/* By Module */}
      <div className="space-y-2">
        <SectionHeader title="By Module" />
        <DataTable
          columns={moduleColumns}
          rows={data.byModule}
          keyFn={(row) => row.moduleType}
          emptyMessage="No module data in this period"
        />
      </div>

      {/* Recent Errors */}
      <div className="space-y-2">
        <SectionHeader title="Recent Errors" />
        {recentErrors.length === 0 ? (
          <EmptyState size="sm" title="No recent errors" />
        ) : (
          <div className="divide-y rounded-lg bg-white shadow">
            {recentErrors.map((err) => (
              <div key={err.id} className="flex items-start gap-3 px-4 py-3">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-medium text-gray-700">
                      {err.model}
                    </span>
                    <span className="text-xs text-gray-400">
                      {formatTimestamp(err.timestamp)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-red-600">
                    {err.error}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================
// CostsTab
// ============================

interface CostsTabProps {
  data: CostsData | null;
  loading: boolean;
}

function CostsTab({ data, loading }: CostsTabProps) {
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 p-12 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading cost data...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg bg-white p-12 text-center text-sm text-gray-500 shadow">
        Cost data unavailable.
      </div>
    );
  }

  const userColumns: Column<CostsByUser>[] = [
    {
      header: 'User ID',
      render: (row) => (
        <TruncatedCell className="font-mono max-w-[160px] text-xs text-gray-700">
          {row.userId}
        </TruncatedCell>
      ),
    },
    {
      header: 'Cost',
      render: (row) => (
        <span className="font-medium text-emerald-700">
          {formatCost(row.totalCost)}
        </span>
      ),
    },
    {
      header: 'Tokens',
      render: (row) => (
        <span className="text-gray-700">{formatTokens(row.totalTokens)}</span>
      ),
    },
    {
      header: 'Calls',
      render: (row) => (
        <span className="text-gray-700">{row.callCount.toLocaleString()}</span>
      ),
    },
    {
      header: 'Top Module',
      render: (row) => (
        <TruncatedCell className="max-w-[140px] text-xs text-gray-500">
          {row.topModule || '-'}
        </TruncatedCell>
      ),
    },
    {
      header: 'Top Model',
      render: (row) => (
        <TruncatedCell className="font-mono max-w-[160px] text-xs text-gray-500">
          {row.topModel || '-'}
        </TruncatedCell>
      ),
    },
  ];

  const moduleColumns: Column<CostsByModule>[] = [
    {
      header: 'Module',
      render: (row) => (
        <span className="font-medium text-gray-800">{row.moduleType}</span>
      ),
    },
    {
      header: 'Cost',
      render: (row) => (
        <span className="font-medium text-emerald-700">
          {formatCost(row.totalCost)}
        </span>
      ),
    },
    {
      header: 'Tokens',
      render: (row) => (
        <span className="text-gray-700">{formatTokens(row.totalTokens)}</span>
      ),
    },
    {
      header: 'Calls',
      render: (row) => (
        <span className="text-gray-700">{row.callCount.toLocaleString()}</span>
      ),
    },
    {
      header: 'Avg Cost/Call',
      render: (row) => (
        <span className="text-gray-600">{formatCost(row.avgCostPerCall)}</span>
      ),
    },
  ];

  const modelColumns: Column<CostsByModel>[] = [
    {
      header: 'Model',
      render: (row) => (
        <TruncatedCell className="font-mono max-w-[200px] text-xs text-gray-800">
          {row.model}
        </TruncatedCell>
      ),
    },
    {
      header: 'Provider',
      render: (row) => (
        <span className="text-xs text-gray-500">{row.provider}</span>
      ),
    },
    {
      header: 'Cost',
      render: (row) => (
        <span className="font-medium text-emerald-700">
          {formatCost(row.totalCost)}
        </span>
      ),
    },
    {
      header: 'Tokens',
      render: (row) => (
        <span className="text-gray-700">{formatTokens(row.totalTokens)}</span>
      ),
    },
    {
      header: 'Calls',
      render: (row) => (
        <span className="text-gray-700">{row.callCount.toLocaleString()}</span>
      ),
    },
    {
      header: 'Avg Tokens/Call',
      render: (row) => (
        <span className="text-gray-600">
          {formatTokens(row.avgTokensPerCall)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Summary stat cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Total Cost"
          value={formatCost(data.totalCost)}
          colorClass="text-emerald-700"
          icon={<DollarSign className="h-4 w-4" />}
        />
        <StatCard
          label="Total Tokens"
          value={formatTokens(data.totalTokens.total)}
          colorClass="text-violet-700"
          subtext={`in ${formatTokens(data.totalTokens.input)} / out ${formatTokens(data.totalTokens.output)}`}
        />
        <StatCard
          label="Unique Users"
          value={data.byUser.length.toLocaleString()}
          colorClass="text-gray-900"
        />
        <StatCard
          label="Active Models"
          value={data.byModel.length.toLocaleString()}
          colorClass="text-blue-700"
          icon={<Zap className="h-4 w-4" />}
        />
      </div>

      {/* By User */}
      <div className="space-y-2">
        <SectionHeader title="By User" />
        <DataTable
          columns={userColumns}
          rows={data.byUser}
          keyFn={(row) => row.userId}
          emptyMessage="No user data in this period"
          colWidths={[
            'w-[20%]',
            'w-[12%]',
            'w-[14%]',
            'w-[12%]',
            'w-[20%]',
            'w-[22%]',
          ]}
        />
      </div>

      {/* By Module */}
      <div className="space-y-2">
        <SectionHeader title="By Module" />
        <DataTable
          columns={moduleColumns}
          rows={data.byModule}
          keyFn={(row) => row.moduleType}
          emptyMessage="No module data in this period"
        />
      </div>

      {/* By Model */}
      <div className="space-y-2">
        <SectionHeader title="By Model" />
        <DataTable
          columns={modelColumns}
          rows={data.byModel}
          keyFn={(row) => row.model}
          emptyMessage="No model data in this period"
          colWidths={[
            'w-[24%]',
            'w-[12%]',
            'w-[14%]',
            'w-[14%]',
            'w-[12%]',
            'w-[24%]',
          ]}
        />
      </div>
    </div>
  );
}

// ============================
// Main Page
// ============================

export default function KernelObservabilityPageContent({
  embedded,
}: { embedded?: boolean } = {}) {
  const [activeTab, setActiveTab] = useState<'metrics' | 'costs'>('metrics');
  const [metricsPeriod, setMetricsPeriod] = useState(1440);
  const [costsHours, setCostsHours] =
    useState<(typeof COSTS_HOURS)[number]>(24);

  const [dashboardData, setDashboardData] = useState<DashboardData | null>(
    null
  );
  const [costsData, setCostsData] = useState<CostsData | null>(null);

  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [loadingCosts, setLoadingCosts] = useState(true);

  const apiUrl = config.apiUrl;

  const fetchDashboard = useCallback(async () => {
    setLoadingMetrics(true);
    try {
      const res = await fetch(
        `${apiUrl}/admin/kernel/observability/dashboard?period=${metricsPeriod}`,
        { headers: getAuthHeader() }
      );
      if (!res.ok) throw new Error(`Dashboard fetch failed: ${res.status}`);
      const json = await res.json();
      const data = (json?.data ?? json) as DashboardData;
      setDashboardData(data);
    } catch (err) {
      logger.error('KernelObservability', 'Failed to fetch dashboard', err);
    } finally {
      setLoadingMetrics(false);
    }
  }, [apiUrl, metricsPeriod]);

  const fetchCosts = useCallback(async () => {
    setLoadingCosts(true);
    try {
      const res = await fetch(
        `${apiUrl}/admin/kernel/observability/costs?hours=${costsHours}`,
        { headers: getAuthHeader() }
      );
      if (!res.ok) throw new Error(`Costs fetch failed: ${res.status}`);
      const json = await res.json();
      const data = (json?.data ?? json) as CostsData;
      setCostsData(data);
    } catch (err) {
      logger.error('KernelObservability', 'Failed to fetch costs', err);
    } finally {
      setLoadingCosts(false);
    }
  }, [apiUrl, costsHours]);

  // Initial fetch and period-driven refetch for metrics
  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  // Initial fetch and period-driven refetch for costs
  useEffect(() => {
    void fetchCosts();
  }, [fetchCosts]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      void fetchDashboard();
      void fetchCosts();
    }, 30_000);
    return () => clearInterval(interval);
  }, [fetchDashboard, fetchCosts]);

  const isLoading = activeTab === 'metrics' ? loadingMetrics : loadingCosts;

  const handleRefresh = () => {
    if (activeTab === 'metrics') {
      void fetchDashboard();
    } else {
      void fetchCosts();
    }
  };

  const refreshButton = (
    <button
      onClick={handleRefresh}
      disabled={isLoading}
      className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
      Refresh
    </button>
  );

  const body = (
    <div className="space-y-4">
      {embedded && <div className="flex justify-end">{refreshButton}</div>}
      {/* Tabs */}
      <Tabs
        items={[
          { key: 'metrics', label: 'Metrics' },
          { key: 'costs', label: 'Costs' },
        ]}
        value={activeTab}
        onChange={(k) => setActiveTab(k as 'metrics' | 'costs')}
      />

      {/* Period selector */}
      {activeTab === 'metrics' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Period:</span>
          {METRICS_PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setMetricsPeriod(p.value)}
              className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                metricsPeriod === p.value
                  ? 'bg-violet-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {activeTab === 'costs' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Period:</span>
          {COSTS_HOURS.map((h) => (
            <button
              key={h}
              onClick={() => setCostsHours(h)}
              className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                costsHours === h
                  ? 'bg-violet-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {h}h
            </button>
          ))}
        </div>
      )}

      {/* Tab content */}
      {activeTab === 'metrics' && (
        <MetricsTab data={dashboardData} loading={loadingMetrics} />
      )}
      {activeTab === 'costs' && (
        <CostsTab data={costsData} loading={loadingCosts} />
      )}

      {/* Auto-refresh notice */}
      <p className="text-right text-xs text-gray-400">
        Auto-refreshes every 30 seconds
      </p>
    </div>
  );

  if (embedded) return body;

  return (
    <AdminPageLayout
      title="Observability"
      description="Monitor AI kernel LLM usage, cost, and performance metrics"
      icon={Activity}
      domain="ai"
      actions={refreshButton}
    >
      {body}
    </AdminPageLayout>
  );
}
