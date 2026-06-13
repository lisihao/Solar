'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api/client';
import { createLogger } from '@/lib/utils/logger';
import {
  Activity,
  CheckCircle,
  Clock,
  Zap,
  AlertTriangle,
  Loader2,
  RefreshCw,
} from 'lucide-react';

const logger = createLogger('SkillsDashboard');

// ==================== Types ====================

type TimeRange = '24h' | '7d' | '30d';

interface DashboardData {
  totalExecutions: number;
  successRate: number;
  avgDuration: number;
  totalTokens: number;
  timeline: Array<{
    date: string;
    count: number;
    successRate: number;
  }>;
}

interface SkillHealth {
  skillId: string;
  name: string;
  score: number;
  status: 'healthy' | 'degraded' | 'critical' | 'unused';
  successRate: number;
  avgDuration: number;
  lastUsedAt: string | null;
}

interface UnusedSkill {
  skillId: string;
  name: string;
  lastUsedAt: string | null;
  usageCount: number;
}

interface TopSkill {
  skillId: string;
  name: string;
  value: number;
}

interface DomainStat {
  domain: string;
  count: number;
  percentage: number;
}

type TopSkillMetric = 'usage' | 'success' | 'failure';

// ==================== Formatters ====================

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return n.toLocaleString();
  return String(n);
}

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M tokens`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K tokens`;
  return `${n} tokens`;
}

function formatRelativeDate(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

// ==================== Sub-components ====================

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-purple-600" />
      <span className="ml-2 text-sm text-gray-500">Loading dashboard...</span>
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16">
      <AlertTriangle className="h-8 w-8 text-red-500" />
      <p className="text-sm text-gray-600">{message}</p>
      <button
        onClick={onRetry}
        className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Retry
      </button>
    </div>
  );
}

interface OverviewCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent?: 'green' | 'yellow' | 'red' | 'default';
}

function OverviewCard({
  label,
  value,
  icon,
  accent = 'default',
}: OverviewCardProps) {
  const accentClass = {
    green: 'text-emerald-600',
    yellow: 'text-amber-600',
    red: 'text-red-600',
    default: 'text-gray-900',
  }[accent];

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {label}
        </span>
        <span className="text-gray-400">{icon}</span>
      </div>
      <p className={`text-2xl font-semibold ${accentClass}`}>{value}</p>
    </div>
  );
}

function successRateAccent(rate: number): 'green' | 'yellow' | 'red' {
  if (rate >= 0.9) return 'green';
  if (rate >= 0.7) return 'yellow';
  return 'red';
}

// ==================== Health Grid ====================

interface HealthGridProps {
  items: SkillHealth[];
}

const HEALTH_STATUS_COLORS: Record<SkillHealth['status'], string> = {
  healthy: 'bg-emerald-500 hover:bg-emerald-600',
  degraded: 'bg-amber-400 hover:bg-amber-500',
  critical: 'bg-red-500 hover:bg-red-600',
  unused: 'bg-gray-200 hover:bg-gray-300',
};

const HEALTH_STATUS_TEXT: Record<SkillHealth['status'], string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  critical: 'Critical',
  unused: 'Unused',
};

const HEALTH_LEGEND_DOT: Record<SkillHealth['status'], string> = {
  healthy: 'bg-emerald-500',
  degraded: 'bg-amber-400',
  critical: 'bg-red-500',
  unused: 'bg-gray-300',
};

function HealthGrid({ items }: HealthGridProps) {
  const [selected, setSelected] = useState<SkillHealth | null>(null);

  if (items.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-gray-400">
        No health data available.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {items.map((skill) => (
          <button
            key={skill.skillId}
            title={skill.name}
            onClick={() =>
              setSelected(selected?.skillId === skill.skillId ? null : skill)
            }
            className={`h-7 w-7 rounded transition-all ${HEALTH_STATUS_COLORS[skill.status]} ${
              selected?.skillId === skill.skillId
                ? 'ring-2 ring-purple-500 ring-offset-1'
                : ''
            }`}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {(Object.keys(HEALTH_STATUS_COLORS) as SkillHealth['status'][]).map(
          (status) => (
            <span
              key={status}
              className="flex items-center gap-1.5 text-xs text-gray-500"
            >
              <span
                className={`inline-block h-2.5 w-2.5 rounded-sm ${HEALTH_LEGEND_DOT[status]}`}
              />
              {HEALTH_STATUS_TEXT[status]}
            </span>
          )
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
          <p className="font-medium text-gray-900">{selected.name}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
            <span>Status</span>
            <span className="text-gray-900">
              {HEALTH_STATUS_TEXT[selected.status]}
            </span>
            <span>Health Score</span>
            <span className="text-gray-900">{selected.score}</span>
            <span>Success Rate</span>
            <span className="text-gray-900">
              {formatPercent(selected.successRate)}
            </span>
            <span>Avg Duration</span>
            <span className="text-gray-900">
              {formatDuration(selected.avgDuration)}
            </span>
            <span>Last Used</span>
            <span className="text-gray-900">
              {formatRelativeDate(selected.lastUsedAt)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== Top Skills Table ====================

const METRIC_LABELS: Record<TopSkillMetric, string> = {
  usage: 'Calls',
  success: 'Successes',
  failure: 'Failures',
};

function TopSkillsTable({
  items,
  metric,
  onMetricChange,
}: {
  items: TopSkill[];
  metric: TopSkillMetric;
  onMetricChange: (m: TopSkillMetric) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {(Object.keys(METRIC_LABELS) as TopSkillMetric[]).map((m) => (
          <button
            key={m}
            onClick={() => onMetricChange(m)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              metric === m
                ? 'bg-purple-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-800'
            }`}
          >
            {METRIC_LABELS[m]}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400">
          No data available.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="w-8 pb-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                #
              </th>
              <th className="pb-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Skill Name
              </th>
              <th className="pb-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                {METRIC_LABELS[metric]}
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((skill, i) => (
              <tr
                key={skill.skillId}
                className="border-b border-gray-100 transition-colors hover:bg-gray-50"
              >
                <td className="py-2 text-xs text-gray-400">{i + 1}</td>
                <td className="max-w-[160px] truncate py-2 text-gray-900">
                  {skill.name}
                </td>
                <td className="py-2 text-right tabular-nums text-gray-700">
                  {formatNumber(skill.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ==================== Domain Distribution ====================

interface DomainBarChartProps {
  items: DomainStat[];
}

function DomainBarChart({ items }: DomainBarChartProps) {
  if (items.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-gray-400">
        No domain data available.
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      {items.map((d) => (
        <div
          key={d.domain}
          className="grid grid-cols-[120px_1fr_48px] items-center gap-2 text-sm"
        >
          <span className="truncate text-xs text-gray-600" title={d.domain}>
            {d.domain}
          </span>
          <div className="h-2 overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-purple-500"
              style={{ width: `${Math.min(d.percentage, 100)}%` }}
            />
          </div>
          <span className="text-right text-xs tabular-nums text-gray-500">
            {formatNumber(d.count)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ==================== Unused Skills List ====================

interface UnusedSkillsListProps {
  items: UnusedSkill[];
  onDisable: (skillId: string) => void;
  disabling: Set<string>;
}

function UnusedSkillsList({
  items,
  onDisable,
  disabling,
}: UnusedSkillsListProps) {
  if (items.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-gray-400">
        No unused skills in the last 30 days.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((skill) => (
        <li
          key={skill.skillId}
          className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2.5"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-900">
              {skill.name}
            </p>
            <p className="text-xs text-gray-500">
              Last used: {formatRelativeDate(skill.lastUsedAt)} &middot;{' '}
              {formatNumber(skill.usageCount)} total calls
            </p>
          </div>
          <button
            onClick={() => onDisable(skill.skillId)}
            disabled={disabling.has(skill.skillId)}
            className="shrink-0 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 shadow-sm transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
          >
            {disabling.has(skill.skillId) ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              'Disable'
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ==================== Section Wrapper ====================

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-semibold text-gray-900">{title}</h3>
      {children}
    </div>
  );
}

// ==================== Main Component ====================

export function SkillsDashboard() {
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const [topMetric, setTopMetric] = useState<TopSkillMetric>('usage');

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [healthItems, setHealthItems] = useState<SkillHealth[]>([]);
  const [unusedSkills, setUnusedSkills] = useState<UnusedSkill[]>([]);
  const [topSkills, setTopSkills] = useState<TopSkill[]>([]);
  const [domainStats, setDomainStats] = useState<DomainStat[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disabling, setDisabling] = useState<Set<string>>(new Set());

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dash, health, unused, top, domains] = await Promise.all([
        apiClient.get<DashboardData>(
          `/skills/analytics/dashboard?range=${timeRange}`
        ),
        apiClient.get<SkillHealth[]>('/skills/analytics/health'),
        apiClient.get<UnusedSkill[]>('/skills/analytics/unused?days=30'),
        apiClient.get<TopSkill[]>(
          `/skills/analytics/top?metric=${topMetric}&limit=10`
        ),
        apiClient.get<DomainStat[]>(
          `/skills/analytics/domains?range=${timeRange}`
        ),
      ]);
      setDashboard(dash);
      setHealthItems(Array.isArray(health) ? health : []);
      setUnusedSkills(Array.isArray(unused) ? unused : []);
      setTopSkills(Array.isArray(top) ? top : []);
      setDomainStats(Array.isArray(domains) ? domains : []);
    } catch (err) {
      logger.error('Failed to load skills dashboard', err);
      setError('Failed to load dashboard data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [timeRange, topMetric]);

  const fetchTopSkills = useCallback(async () => {
    try {
      const top = await apiClient.get<TopSkill[]>(
        `/skills/analytics/top?metric=${topMetric}&limit=10`
      );
      setTopSkills(Array.isArray(top) ? top : []);
    } catch (err) {
      logger.error('Failed to load top skills', err);
    }
  }, [topMetric]);

  // Refetch all when time range changes
  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // Refetch only top skills when metric changes (avoid full reload)
  useEffect(() => {
    if (!loading) {
      void fetchTopSkills();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topMetric]);

  const handleDisable = useCallback(async (skillId: string) => {
    setDisabling((prev) => new Set(prev).add(skillId));
    try {
      await apiClient.patch(`/admin/ai/skills/${skillId}`, { enabled: false });
      setUnusedSkills((prev) => prev.filter((s) => s.skillId !== skillId));
    } catch (err) {
      logger.error('Failed to disable skill', err);
    } finally {
      setDisabling((prev) => {
        const next = new Set(prev);
        next.delete(skillId);
        return next;
      });
    }
  }, []);

  // ---- render states ----

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorState message={error} onRetry={fetchAll} />;

  const successAccent = dashboard
    ? successRateAccent(dashboard.successRate)
    : 'default';

  return (
    <div className="space-y-5">
      {/* Header row: time range selector */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
          {(['24h', '7d', '30d'] as TimeRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setTimeRange(r)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                timeRange === r
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        <button
          onClick={fetchAll}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {/* Overview cards */}
      {dashboard && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <OverviewCard
            label="Total Executions"
            value={formatNumber(dashboard.totalExecutions)}
            icon={<Activity className="h-4 w-4" />}
          />
          <OverviewCard
            label="Success Rate"
            value={formatPercent(dashboard.successRate)}
            icon={<CheckCircle className="h-4 w-4" />}
            accent={successAccent}
          />
          <OverviewCard
            label="Avg Duration"
            value={formatDuration(dashboard.avgDuration)}
            icon={<Clock className="h-4 w-4" />}
          />
          <OverviewCard
            label="Token Cost"
            value={formatTokens(dashboard.totalTokens)}
            icon={<Zap className="h-4 w-4" />}
          />
        </div>
      )}

      {/* Middle row: health grid + top skills */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title="Skill Health">
          <HealthGrid items={healthItems} />
        </Section>

        <Section title="Top Skills">
          <TopSkillsTable
            items={topSkills}
            metric={topMetric}
            onMetricChange={setTopMetric}
          />
        </Section>
      </div>

      {/* Bottom row: domain distribution + unused skills */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title="Domain Distribution">
          <DomainBarChart items={domainStats} />
        </Section>

        <Section title="Unused Skills (30 days)">
          <UnusedSkillsList
            items={unusedSkills}
            onDisable={handleDisable}
            disabling={disabling}
          />
        </Section>
      </div>
    </div>
  );
}
