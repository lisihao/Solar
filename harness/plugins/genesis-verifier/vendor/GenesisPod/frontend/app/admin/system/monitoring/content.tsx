'use client';

import { useState, useEffect, useCallback } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states/EmptyState';
import {
  Activity,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Cpu,
  Database,
  Zap,
  TrendingUp,
  Clock,
  DollarSign,
  Server,
  AlertCircle,
  GitBranch,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Tabs } from '@/components/ui/tabs';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';
import { useTranslation } from '@/lib/i18n';
import { AdminPageLayout } from '@/components/admin/layout';
import { TruncatedCell } from '@/components/common/tables';

// ==================== Types ====================

interface SystemMetrics {
  cpu: { usage: number; cores: number; model: string };
  memory: { total: number; used: number; free: number; percentage: number };
  uptime: number;
  activeTasks: number;
  queuedTasks: number;
  collectionsPerMinute: number;
  errorRate: number;
}

interface ErrorStats {
  total: number;
  critical: number;
  error: number;
  warning: number;
  resolved: number;
  unresolved: number;
  byComponent: Record<string, number>;
  byErrorCode: Record<string, number>;
  trend: Array<{ date: string; count: number }>;
}

interface AggregatedError {
  errorCode: string;
  count: number;
  latestMessage: string;
  latestOccurrence: string;
  severity: string;
  component: string | null;
}

interface AIMetricsSummary {
  totalCalls: number;
  successRate: number;
  avgDuration: number;
  totalTokens: number;
  estimatedCost: number;
  byModel: Record<string, { calls: number; tokens: number; cost: number }>;
  byType: Record<
    string,
    { calls: number; successRate: number; avgDuration: number }
  >;
  trend: Array<{ date: string; calls: number; tokens: number; cost: number }>;
}

interface RealtimeMetrics {
  lastHour: {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    successRate: number;
    avgDuration: number;
    totalTokens: number;
    errorCounts: Record<string, number>;
  };
  callsPerMinute: Array<{ minute: string; calls: number }>;
}

interface AIDiagnosis {
  tools: { total: number; healthy: number; unhealthy: number };
  skills: { total: number; enabled: number; disabled: number };
  mcpServers: { total: number; connected: number; disconnected: number };
  externalTools: {
    total: number;
    configured: number;
    unconfigured: number;
  };
  breakpoints: Array<{
    code: string;
    severity: string;
    location: string;
    description: string;
    recommendation: string;
  }>;
}

// ─── Agent Trace types (mirrors backend trace.interface.ts) ───

type TraceStatus = 'running' | 'success' | 'error';
type TraceType =
  | 'research_mission'
  | 'team_execution'
  | 'tool_call'
  | 'mcp_request'
  | 'a2a_task';

interface TraceSummary {
  id: string;
  name: string;
  type: TraceType;
  status: TraceStatus;
  startTime: string;
  duration?: number;
  spanCount: number;
}

interface SpanData {
  id: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  type: string;
  status: TraceStatus;
  startTime: string;
  endTime?: string;
  duration?: number;
  metadata: Record<string, unknown>;
  error?: string;
}

interface TraceDetail extends TraceSummary {
  spans: SpanData[];
  metadata: Record<string, unknown>;
}

interface DashboardData {
  warnings?: string[];
  errors: {
    stats: ErrorStats;
    topErrors: AggregatedError[];
  } | null;
  aiMetrics: {
    summary: AIMetricsSummary;
    realtime: RealtimeMetrics;
    modelUsage: Array<{
      modelId: string;
      totalCalls: number;
      successfulCalls: number;
      totalTokens: number;
      estimatedCost: number;
    }>;
  } | null;
  aiDiagnosis: AIDiagnosis | null;
}

// ==================== Helper Functions ====================

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(1)} GB`;
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

function getSeverityColor(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'text-red-600 bg-red-50';
    case 'error':
      return 'text-orange-600 bg-orange-50';
    case 'warning':
      return 'text-yellow-600 bg-yellow-50';
    case 'high':
      return 'text-red-600 bg-red-50';
    case 'medium':
      return 'text-orange-600 bg-orange-50';
    case 'low':
      return 'text-yellow-600 bg-yellow-50';
    default:
      return 'text-gray-600 bg-gray-50';
  }
}

// ==================== Components ====================

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color = 'blue',
  trend,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  color?: string;
  trend?: { value: number; label: string };
}) {
  const colorClasses: Record<string, string> = {
    blue: 'text-blue-600',
    green: 'text-green-600',
    red: 'text-red-600',
    purple: 'text-purple-600',
    amber: 'text-amber-600',
    cyan: 'text-cyan-600',
  };

  return (
    <div className="rounded-lg bg-white p-4 shadow">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          <p className={`text-2xl font-bold ${colorClasses[color]}`}>{value}</p>
          {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
        </div>
        <Icon className={`h-8 w-8 ${colorClasses[color]} opacity-50`} />
      </div>
      {trend && (
        <div className="mt-2 flex items-center text-xs">
          <TrendingUp
            className={`mr-1 h-3 w-3 ${trend.value >= 0 ? 'text-green-500' : 'text-red-500'}`}
          />
          <span
            className={trend.value >= 0 ? 'text-green-500' : 'text-red-500'}
          >
            {trend.value >= 0 ? '+' : ''}
            {trend.value}%
          </span>
          <span className="ml-1 text-gray-400">{trend.label}</span>
        </div>
      )}
    </div>
  );
}

function TrendChart({
  data,
  label,
  color = 'blue',
}: {
  data: Array<{ date: string; count?: number; calls?: number }>;
  label: string;
  color?: string;
}) {
  const maxValue = Math.max(...data.map((d) => d.count ?? d.calls ?? 0), 1);

  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-500',
    red: 'bg-red-500',
    green: 'bg-green-500',
  };

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-gray-700">{label}</p>
      <div className="flex h-24 items-end gap-1">
        {data.map((item, i) => {
          const value = item.count ?? item.calls ?? 0;
          const height = Math.max((value / maxValue) * 100, 4);
          return (
            <div key={i} className="flex flex-1 flex-col items-center">
              <div
                className={`w-full rounded-t ${colorClasses[color]} transition-all`}
                style={{ height: `${height}%` }}
                title={`${item.date}: ${value}`}
              />
              <span className="mt-1 text-[10px] text-gray-400">
                {item.date.slice(-2)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HealthIndicator({
  status,
  label,
}: {
  status: 'healthy' | 'degraded' | 'unhealthy';
  label: string;
}) {
  const statusConfig = {
    healthy: { icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-50' },
    degraded: {
      icon: AlertCircle,
      color: 'text-yellow-500',
      bg: 'bg-yellow-50',
    },
    unhealthy: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50' },
  };

  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-3 py-2 ${config.bg}`}
    >
      <Icon className={`h-5 w-5 ${config.color}`} />
      <span className="text-sm font-medium text-gray-700">{label}</span>
    </div>
  );
}

// ==================== Main Component ====================

export default function MonitoringPageContent({
  embedded,
}: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [activeTab, setActiveTab] = useState<
    'overview' | 'errors' | 'ai' | 'traces'
  >('overview');
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [tracesLoading, setTracesLoading] = useState(false);
  const [expandedTraceId, setExpandedTraceId] = useState<string | null>(null);
  const [traceDetail, setTraceDetail] = useState<TraceDetail | null>(null);
  const [traceDetailLoading, setTraceDetailLoading] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const headers = getAuthHeader();

      // Fetch both endpoints independently — one failure should not block the other
      const [metricsRes, dashboardRes] = await Promise.all([
        fetch(`${config.apiUrl}/data-collection/monitor/metrics`, {
          headers,
        }).catch((err: unknown) => {
          logger.error('Failed to fetch metrics:', err);
          return null;
        }),
        fetch(`${config.apiUrl}/admin/monitoring/dashboard`, { headers }).catch(
          (err: unknown) => {
            logger.error('Failed to fetch dashboard:', err);
            return null;
          }
        ),
      ]);

      // Process metrics (independent)
      if (metricsRes?.ok) {
        const metricsData = await metricsRes.json();
        setMetrics(metricsData?.data ?? metricsData);
        setError(null);
      } else {
        setError(t('admin.monitoring.errors.fetchFailed'));
        logger.error(
          'Metrics fetch failed:',
          metricsRes ? `status ${metricsRes.status}` : 'network error'
        );
      }

      // Process dashboard (independent)
      if (dashboardRes?.ok) {
        const dashboardData = await dashboardRes.json();
        setDashboard(dashboardData?.data ?? dashboardData);
        setDashboardError(null);
      } else {
        setDashboardError(
          dashboardRes
            ? `Dashboard returned status ${dashboardRes.status}`
            : 'Dashboard fetch failed'
        );
        logger.error(
          'Dashboard fetch failed:',
          dashboardRes ? `status ${dashboardRes.status}` : 'network error'
        );
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('admin.monitoring.errors.fetchFailed');
      setError(message);
      logger.error('Failed to fetch monitoring data:', err);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => void fetchData(), 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchData]);

  const fetchTraces = useCallback(async () => {
    setTracesLoading(true);
    try {
      const res = await fetch(
        `${config.apiUrl}/admin/monitoring/traces?limit=20`,
        { headers: getAuthHeader() }
      ).catch(() => null);
      if (res?.ok) {
        const json = await res.json();
        const list = (json?.data ?? json) as TraceSummary[];
        setTraces(Array.isArray(list) ? list : []);
      }
    } finally {
      setTracesLoading(false);
    }
  }, []);

  // Auto-poll traces every 10 seconds when the traces tab is active
  useEffect(() => {
    if (activeTab !== 'traces') return;
    void fetchTraces();
    const interval = setInterval(() => void fetchTraces(), 10000);
    return () => clearInterval(interval);
  }, [activeTab, fetchTraces]);

  const fetchTraceDetail = useCallback(
    async (id: string) => {
      if (expandedTraceId === id) {
        setExpandedTraceId(null);
        setTraceDetail(null);
        return;
      }
      // Clear stale detail immediately to avoid briefly showing previous trace's data
      setExpandedTraceId(id);
      setTraceDetail(null);
      setTraceDetailLoading(true);
      // Capture the requested ID to guard against race conditions
      const requestedId = id;
      try {
        const res = await fetch(
          `${config.apiUrl}/admin/monitoring/traces/${id}`,
          { headers: getAuthHeader() }
        ).catch(() => null);
        if (res?.ok) {
          const json = await res.json();
          const detail = (json?.data ?? json) as TraceDetail;
          // Only apply result if this trace is still the expanded one
          setExpandedTraceId((current) => {
            if (current === requestedId) setTraceDetail(detail);
            return current;
          });
        }
      } finally {
        setTraceDetailLoading(false);
      }
    },
    [expandedTraceId]
  );

  const renderOverviewTab = () => (
    <>
      {/* System Health */}
      {dashboard ? (
        <div className="mb-6">
          <h3 className="mb-3 text-lg font-semibold text-gray-900">
            System Health
          </h3>
          <div className="flex flex-wrap gap-3">
            <HealthIndicator
              status={
                dashboard?.aiDiagnosis?.breakpoints?.length === 0
                  ? 'healthy'
                  : 'degraded'
              }
              label="AI Engine"
            />
            <HealthIndicator
              status={
                dashboard?.errors?.stats?.critical === 0
                  ? 'healthy'
                  : 'unhealthy'
              }
              label="Error Rate"
            />
            <HealthIndicator
              status={
                (dashboard?.aiMetrics?.summary?.successRate ?? 100) >= 95
                  ? 'healthy'
                  : 'degraded'
              }
              label="AI Success Rate"
            />
          </div>
        </div>
      ) : (
        <div className="mb-6 rounded-lg bg-gray-50 p-6 text-center text-sm text-gray-500">
          <AlertCircle className="mx-auto mb-2 h-6 w-6 text-gray-400" />
          Dashboard data unavailable. System health indicators require dashboard
          data.
        </div>
      )}

      {/* Stats Cards */}
      {metrics && (
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
          <StatCard
            title="CPU Usage"
            value={`${metrics.cpu.usage.toFixed(1)}%`}
            subtitle={`${metrics.cpu.cores} cores`}
            icon={Cpu}
            color="blue"
          />
          <StatCard
            title="Memory"
            value={`${metrics.memory.percentage.toFixed(1)}%`}
            subtitle={`${formatBytes(metrics.memory.used)} / ${formatBytes(metrics.memory.total)}`}
            icon={Database}
            color="purple"
          />
          <StatCard
            title="Uptime"
            value={formatUptime(metrics.uptime)}
            icon={Clock}
            color="green"
          />
          <StatCard
            title="Active Tasks"
            value={metrics.activeTasks}
            subtitle={`${metrics.queuedTasks} queued`}
            icon={Activity}
            color="amber"
          />
          <StatCard
            title="Error Rate"
            value={`${metrics.errorRate.toFixed(1)}%`}
            icon={AlertTriangle}
            color="red"
          />
        </div>
      )}

      {/* AI Metrics Quick View */}
      {dashboard?.aiMetrics?.summary ? (
        <div className="mb-6">
          <h3 className="mb-3 text-lg font-semibold text-gray-900">
            AI Engine (Last 7 Days)
          </h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard
              title="Total Calls"
              value={formatNumber(dashboard.aiMetrics.summary.totalCalls)}
              icon={Zap}
              color="blue"
            />
            <StatCard
              title="Success Rate"
              value={`${dashboard.aiMetrics.summary.successRate.toFixed(1)}%`}
              icon={CheckCircle}
              color="green"
            />
            <StatCard
              title="Avg Latency"
              value={`${dashboard.aiMetrics.summary.avgDuration}ms`}
              icon={Clock}
              color="purple"
            />
            <StatCard
              title="Est. Cost"
              value={formatCost(dashboard.aiMetrics.summary.estimatedCost)}
              icon={DollarSign}
              color="amber"
            />
          </div>
        </div>
      ) : (
        dashboard && (
          <div className="mb-6 rounded-lg bg-gray-50 p-4 text-center text-sm text-gray-500">
            No AI metrics data available for the last 7 days.
          </div>
        )
      )}

      {/* AI Diagnosis */}
      {dashboard?.aiDiagnosis ? (
        <div className="mb-6">
          <h3 className="mb-3 text-lg font-semibold text-gray-900">
            AI Capabilities
          </h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-lg bg-white p-4 shadow">
              <h4 className="mb-2 font-medium text-gray-900">Tools</h4>
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-2xl font-bold text-green-600">
                    {dashboard.aiDiagnosis.tools.healthy}
                  </span>
                  <span className="ml-1 text-sm text-gray-500">healthy</span>
                </div>
                {dashboard.aiDiagnosis.tools.unhealthy > 0 && (
                  <div>
                    <span className="text-2xl font-bold text-red-600">
                      {dashboard.aiDiagnosis.tools.unhealthy}
                    </span>
                    <span className="ml-1 text-sm text-gray-500">
                      unhealthy
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="rounded-lg bg-white p-4 shadow">
              <h4 className="mb-2 font-medium text-gray-900">Skills</h4>
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-2xl font-bold text-green-600">
                    {dashboard.aiDiagnosis.skills.enabled}
                  </span>
                  <span className="ml-1 text-sm text-gray-500">enabled</span>
                </div>
                <div className="ml-auto text-sm text-gray-400">
                  Total: {dashboard.aiDiagnosis.skills.total}
                </div>
              </div>
            </div>
            <div className="rounded-lg bg-white p-4 shadow">
              <h4 className="mb-2 font-medium text-gray-900">MCP Servers</h4>
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-2xl font-bold text-green-600">
                    {dashboard.aiDiagnosis.mcpServers.connected}
                  </span>
                  <span className="ml-1 text-sm text-gray-500">connected</span>
                </div>
                {dashboard.aiDiagnosis.mcpServers.disconnected > 0 && (
                  <div>
                    <span className="text-2xl font-bold text-red-600">
                      {dashboard.aiDiagnosis.mcpServers.disconnected}
                    </span>
                    <span className="ml-1 text-sm text-gray-500">
                      disconnected
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="rounded-lg bg-white p-4 shadow">
              <h4 className="mb-2 font-medium text-gray-900">External APIs</h4>
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-2xl font-bold text-green-600">
                    {dashboard.aiDiagnosis.externalTools.configured}
                  </span>
                  <span className="ml-1 text-sm text-gray-500">configured</span>
                </div>
                {dashboard.aiDiagnosis.externalTools.unconfigured > 0 && (
                  <div>
                    <span className="text-2xl font-bold text-amber-600">
                      {dashboard.aiDiagnosis.externalTools.unconfigured}
                    </span>
                    <span className="ml-1 text-sm text-gray-500">missing</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Breakpoints */}
          {dashboard.aiDiagnosis.breakpoints.length > 0 && (
            <div className="mt-4 rounded-lg bg-red-50 p-4">
              <h4 className="mb-2 flex items-center gap-2 font-medium text-red-800">
                <AlertTriangle className="h-5 w-5" />
                Issues Detected ({dashboard.aiDiagnosis.breakpoints.length})
              </h4>
              <div className="space-y-2">
                {dashboard.aiDiagnosis.breakpoints.slice(0, 5).map((bp, i) => (
                  <div
                    key={i}
                    className={`rounded p-2 ${getSeverityColor(bp.severity)}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">{bp.code}</span>
                      <span className="text-sm">{bp.description}</span>
                    </div>
                    <p className="mt-1 text-xs opacity-75">
                      {bp.recommendation}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        dashboard && (
          <div className="mb-6 rounded-lg bg-gray-50 p-4 text-center text-sm text-gray-500">
            No AI capabilities data available.
          </div>
        )
      )}
    </>
  );

  const renderErrorsTab = () => (
    <>
      {/* Error Stats */}
      {dashboard?.errors?.stats && (
        <div className="mb-6">
          <h3 className="mb-3 text-lg font-semibold text-gray-900">
            Error Statistics (Last 7 Days)
          </h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <StatCard
              title="Total Errors"
              value={dashboard.errors.stats.total}
              icon={AlertTriangle}
              color="red"
            />
            <StatCard
              title="Critical"
              value={dashboard.errors.stats.critical}
              icon={XCircle}
              color="red"
            />
            <StatCard
              title="Errors"
              value={dashboard.errors.stats.error}
              icon={AlertCircle}
              color="amber"
            />
            <StatCard
              title="Warnings"
              value={dashboard.errors.stats.warning}
              icon={AlertTriangle}
              color="amber"
            />
            <StatCard
              title="Unresolved"
              value={dashboard.errors.stats.unresolved}
              icon={Clock}
              color="purple"
            />
          </div>
        </div>
      )}

      {/* Error Trend */}
      {dashboard?.errors?.stats?.trend && (
        <div className="mb-6 rounded-lg bg-white p-4 shadow">
          <TrendChart
            data={dashboard.errors.stats.trend}
            label="Errors per Day"
            color="red"
          />
        </div>
      )}

      {/* Top Errors */}
      {dashboard?.errors?.topErrors &&
        dashboard.errors.topErrors.length > 0 && (
          <div className="mb-6">
            <h3 className="mb-3 text-lg font-semibold text-gray-900">
              Top Errors (Unresolved)
            </h3>
            <div className="rounded-lg bg-white shadow">
              <div className="overflow-x-auto">
                <Table className="w-full text-left text-sm">
                  <THead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                    <Tr>
                      <Th className="px-4 py-3">Error Code</Th>
                      <Th className="px-4 py-3">Count</Th>
                      <Th className="px-4 py-3">Severity</Th>
                      <Th className="px-4 py-3">Component</Th>
                      <Th className="px-4 py-3">Latest Message</Th>
                    </Tr>
                  </THead>
                  <TBody className="divide-y">
                    {dashboard.errors.topErrors.map((err, i) => (
                      <Tr key={i} className="hover:bg-gray-50">
                        <Td className="font-mono px-4 py-3 text-sm text-gray-900">
                          <TruncatedCell className="max-w-[160px] text-gray-900">
                            {err.errorCode}
                          </TruncatedCell>
                        </Td>
                        <Td className="px-4 py-3 font-bold text-red-600">
                          {err.count}
                        </Td>
                        <Td className="px-4 py-3">
                          <span
                            className={`rounded px-2 py-1 text-xs font-medium ${getSeverityColor(err.severity)}`}
                          >
                            {err.severity}
                          </span>
                        </Td>
                        <Td className="px-4 py-3 text-gray-600">
                          <TruncatedCell className="max-w-[140px] text-gray-600">
                            {err.component || '-'}
                          </TruncatedCell>
                        </Td>
                        <Td className="px-4 py-3 text-gray-500">
                          <TruncatedCell className="max-w-[360px] text-gray-500">
                            {err.latestMessage}
                          </TruncatedCell>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </div>
            </div>
          </div>
        )}

      {/* Errors by Component */}
      {dashboard?.errors?.stats?.byComponent && (
        <div className="mb-6">
          <h3 className="mb-3 text-lg font-semibold text-gray-900">
            Errors by Component
          </h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {Object.entries(dashboard.errors.stats.byComponent).map(
              ([component, count]) => (
                <div key={component} className="rounded-lg bg-white p-4 shadow">
                  <p className="text-sm text-gray-500">{component}</p>
                  <p className="text-2xl font-bold text-red-600">{count}</p>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Empty state when no error data */}
      {!dashboard?.errors && (
        <div className="rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500">
          <AlertCircle className="mx-auto mb-2 h-6 w-6 text-gray-400" />
          {dashboard
            ? 'No error tracking data available.'
            : 'Dashboard data unavailable. Error tracking requires dashboard data.'}
        </div>
      )}
    </>
  );

  const renderAITab = () => (
    <>
      {/* AI Metrics Summary */}
      {dashboard?.aiMetrics?.summary && (
        <div className="mb-6">
          <h3 className="mb-3 text-lg font-semibold text-gray-900">
            AI Metrics Summary (Last 7 Days)
          </h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <StatCard
              title="Total Calls"
              value={formatNumber(dashboard.aiMetrics.summary.totalCalls)}
              icon={Zap}
              color="blue"
            />
            <StatCard
              title="Success Rate"
              value={`${dashboard.aiMetrics.summary.successRate.toFixed(1)}%`}
              icon={CheckCircle}
              color="green"
            />
            <StatCard
              title="Avg Latency"
              value={`${dashboard.aiMetrics.summary.avgDuration}ms`}
              icon={Clock}
              color="purple"
            />
            <StatCard
              title="Total Tokens"
              value={formatNumber(dashboard.aiMetrics.summary.totalTokens)}
              icon={Server}
              color="cyan"
            />
            <StatCard
              title="Est. Cost"
              value={formatCost(dashboard.aiMetrics.summary.estimatedCost)}
              icon={DollarSign}
              color="amber"
            />
          </div>
        </div>
      )}

      {/* AI Calls Trend */}
      {dashboard?.aiMetrics?.summary?.trend && (
        <div className="mb-6 rounded-lg bg-white p-4 shadow">
          <TrendChart
            data={dashboard.aiMetrics.summary.trend}
            label="AI Calls per Day"
            color="blue"
          />
        </div>
      )}

      {/* Realtime Metrics */}
      {dashboard?.aiMetrics?.realtime && (
        <div className="mb-6">
          <h3 className="mb-3 text-lg font-semibold text-gray-900">
            Realtime (Last Hour)
          </h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard
              title="Calls"
              value={dashboard.aiMetrics.realtime.lastHour.totalCalls}
              icon={Zap}
              color="blue"
            />
            <StatCard
              title="Success Rate"
              value={`${dashboard.aiMetrics.realtime.lastHour.successRate.toFixed(1)}%`}
              icon={CheckCircle}
              color="green"
            />
            <StatCard
              title="Avg Latency"
              value={`${dashboard.aiMetrics.realtime.lastHour.avgDuration}ms`}
              icon={Clock}
              color="purple"
            />
            <StatCard
              title="Tokens"
              value={formatNumber(
                dashboard.aiMetrics.realtime.lastHour.totalTokens
              )}
              icon={Server}
              color="cyan"
            />
          </div>
        </div>
      )}

      {/* Model Usage */}
      {dashboard?.aiMetrics?.modelUsage &&
        dashboard.aiMetrics.modelUsage.length > 0 && (
          <div className="mb-6">
            <h3 className="mb-3 text-lg font-semibold text-gray-900">
              Model Usage
            </h3>
            <div className="rounded-lg bg-white shadow">
              <div className="overflow-x-auto">
                <Table className="w-full text-left text-sm">
                  <THead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                    <Tr>
                      <Th className="px-4 py-3">Model</Th>
                      <Th className="px-4 py-3">Total Calls</Th>
                      <Th className="px-4 py-3">Success</Th>
                      <Th className="px-4 py-3">Tokens</Th>
                      <Th className="px-4 py-3">Est. Cost</Th>
                    </Tr>
                  </THead>
                  <TBody className="divide-y">
                    {dashboard.aiMetrics.modelUsage.map((model, i) => (
                      <Tr key={i} className="hover:bg-gray-50">
                        <Td className="font-mono px-4 py-3 text-sm text-gray-900">
                          <TruncatedCell className="max-w-[220px] text-gray-900">
                            {model.modelId}
                          </TruncatedCell>
                        </Td>
                        <Td className="px-4 py-3 text-blue-600">
                          {formatNumber(model.totalCalls)}
                        </Td>
                        <Td className="px-4 py-3 text-green-600">
                          {formatNumber(model.successfulCalls)}
                        </Td>
                        <Td className="px-4 py-3 text-purple-600">
                          {formatNumber(model.totalTokens)}
                        </Td>
                        <Td className="px-4 py-3 text-amber-600">
                          {formatCost(model.estimatedCost)}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </div>
            </div>
          </div>
        )}

      {/* By Type */}
      {dashboard?.aiMetrics?.summary?.byType && (
        <div className="mb-6">
          <h3 className="mb-3 text-lg font-semibold text-gray-900">
            By Operation Type
          </h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {Object.entries(dashboard.aiMetrics.summary.byType).map(
              ([type, stats]) => (
                <div key={type} className="rounded-lg bg-white p-4 shadow">
                  <h4 className="mb-2 font-medium capitalize text-gray-900">
                    {type.replace(/_/g, ' ')}
                  </h4>
                  <p className="text-2xl font-bold text-blue-600">
                    {formatNumber(stats.calls)}
                  </p>
                  <div className="mt-2 flex justify-between text-xs text-gray-500">
                    <span>{stats.successRate.toFixed(1)}% success</span>
                    <span>{stats.avgDuration}ms avg</span>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Empty state when no AI metrics data */}
      {!dashboard?.aiMetrics && (
        <div className="rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500">
          <AlertCircle className="mx-auto mb-2 h-6 w-6 text-gray-400" />
          {dashboard
            ? 'No AI metrics data available.'
            : 'Dashboard data unavailable. AI metrics require dashboard data.'}
        </div>
      )}
    </>
  );

  const traceStatusColor = (status: TraceStatus) => {
    if (status === 'running') return 'bg-blue-500';
    if (status === 'success') return 'bg-green-500';
    return 'bg-red-500';
  };

  const traceTypeBadge = (type: TraceType) => {
    const map: Record<TraceType, string> = {
      research_mission: 'bg-purple-100 text-purple-700',
      team_execution: 'bg-orange-100 text-orange-700',
      tool_call: 'bg-cyan-100 text-cyan-700',
      mcp_request: 'bg-pink-100 text-pink-700',
      a2a_task: 'bg-yellow-100 text-yellow-700',
    };
    return map[type] ?? 'bg-gray-100 text-gray-700';
  };

  const buildSpanTree = (spans: SpanData[]) => {
    const roots: SpanData[] = [];
    const children: Record<string, SpanData[]> = {};
    for (const span of spans) {
      if (span.parentSpanId) {
        if (!children[span.parentSpanId]) children[span.parentSpanId] = [];
        children[span.parentSpanId].push(span);
      } else {
        roots.push(span);
      }
    }
    return { roots, children };
  };

  const renderSpan = (
    span: SpanData,
    depth: number,
    children: Record<string, SpanData[]>
  ): React.ReactNode => (
    <div key={span.id} style={{ marginLeft: depth * 16 }} className="mb-1">
      <div className="flex items-center gap-2 rounded px-2 py-1 hover:bg-gray-50">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${traceStatusColor(span.status)}`}
        />
        <span className="text-sm text-gray-700">{span.name}</span>
        <span className="text-xs text-gray-400">{span.type}</span>
        {span.duration !== undefined && (
          <span className="ml-auto text-xs text-gray-400">
            {span.duration}ms
          </span>
        )}
      </div>
      {children[span.id]?.map((child) =>
        renderSpan(child, depth + 1, children)
      )}
    </div>
  );

  const renderTracesTab = () => (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Agent Traces</h3>
        <button
          onClick={() => void fetchTraces()}
          disabled={tracesLoading}
          className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200 disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${tracesLoading ? 'animate-spin' : ''}`}
          />
          刷新
        </button>
      </div>

      {tracesLoading && traces.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-500">加载中…</div>
      ) : traces.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<GitBranch className="h-8 w-8" />}
          title="暂无 Agent Trace 数据"
        />
      ) : (
        <div className="rounded-lg bg-white shadow">
          {traces.map((trace) => (
            <div key={trace.id} className="border-b last:border-b-0">
              {/* Row */}
              <button
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
                onClick={() => void fetchTraceDetail(trace.id)}
              >
                {expandedTraceId === trace.id ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                )}
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${traceStatusColor(trace.status)}`}
                />
                <span className="flex-1 truncate text-sm font-medium text-gray-800">
                  {trace.name}
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${traceTypeBadge(trace.type)}`}
                >
                  {trace.type.replace('_', ' ')}
                </span>
                <span className="w-16 text-right text-xs text-gray-400">
                  {trace.spanCount} spans
                </span>
                {trace.duration !== undefined && (
                  <span className="w-16 text-right text-xs text-gray-400">
                    {trace.duration}ms
                  </span>
                )}
                <span className="w-32 text-right text-xs text-gray-400">
                  {new Date(trace.startTime).toLocaleTimeString()}
                </span>
              </button>

              {/* Expanded detail */}
              {expandedTraceId === trace.id && (
                <div className="border-t bg-gray-50 px-4 py-3">
                  {traceDetailLoading ? (
                    <p className="text-sm text-gray-400">加载详情…</p>
                  ) : traceDetail?.id === trace.id &&
                    traceDetail.spans.length > 0 ? (
                    (() => {
                      const { roots, children } = buildSpanTree(
                        traceDetail.spans
                      );
                      return (
                        <div className="text-sm">
                          {roots.map((root) => renderSpan(root, 0, children))}
                        </div>
                      );
                    })()
                  ) : (
                    <p className="text-sm text-gray-400">无 Span 数据</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );

  const actions = (
    <div className="flex items-center gap-2">
      <button
        onClick={() => void fetchData()}
        className="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
      >
        <RefreshCw className="h-4 w-4" />
        Refresh
      </button>
      <button
        onClick={() => setAutoRefresh(!autoRefresh)}
        className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
          autoRefresh
            ? 'bg-green-100 text-green-800'
            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
        }`}
      >
        <RefreshCw className={`h-4 w-4 ${autoRefresh ? 'animate-spin' : ''}`} />
        {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
      </button>
    </div>
  );

  const body = (
    <div>
      {/* 嵌入模式 (system hub Tab 内) 把 actions 内联到顶部 */}
      {embedded && <div className="mb-4 flex justify-end">{actions}</div>}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-4 text-red-800">
          {error}
        </div>
      )}

      {dashboardError && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-amber-50 p-4 text-amber-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span className="text-sm">
            Dashboard data unavailable: {dashboardError}
          </span>
        </div>
      )}

      {/* Tabs */}
      <Tabs
        className="mb-6"
        items={[
          { key: 'overview', label: 'Overview' },
          { key: 'errors', label: 'Error Tracking' },
          { key: 'ai', label: 'AI Metrics' },
          { key: 'traces', label: 'Agent Traces' },
        ]}
        value={activeTab}
        onChange={(k) =>
          setActiveTab(k as 'overview' | 'errors' | 'ai' | 'traces')
        }
      />

      {loading ? (
        <div className="p-8 text-center text-gray-500">
          {t('common.loading')}
        </div>
      ) : (
        <>
          {activeTab === 'overview' && renderOverviewTab()}
          {activeTab === 'errors' && renderErrorsTab()}
          {activeTab === 'ai' && renderAITab()}
          {activeTab === 'traces' && renderTracesTab()}
        </>
      )}
    </div>
  );

  // ★ 2026-05-12: 嵌入模式跳过外层 AdminPageLayout (system hub Tab 内).
  if (embedded) return body;

  return (
    <AdminPageLayout
      title={t('admin.monitoring.title')}
      description="System health, error tracking, and AI metrics"
      icon={Activity}
      domain="system"
      actions={actions}
    >
      {body}
    </AdminPageLayout>
  );
}
