'use client';

import { useState, useEffect, useMemo } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { TruncatedCell } from '@/components/common/tables';
import {
  Zap,
  Clock,
  Activity,
  DollarSign,
  BarChart3,
  Layers,
  Cpu,
  TrendingUp,
  Database,
  Shield,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useI18n } from '@/lib/i18n';
import { getProviderBrand } from '@/lib/constants/ai-provider-logos';
import { logger } from '@/lib/utils/logger';
import { getComputeUsage } from '@/services/topic-insights/api';
import { LoadingState } from '@/components/ui/states';
import { StatCard } from '@/components/ui/cards';

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

interface ComputeUsageSummary {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalCreditsConsumed: number;
  estimatedCostUsd: number;
  totalLlmCalls: number;
  totalDimensions: number;
  researchDurationMs: number;
  reportGenerationMs: number;
}

interface DimensionUsage {
  dimensionName: string;
  modelUsed: string | null;
  tokensUsed: number | null;
  sourcesUsed: number;
}

interface ModelDistributionItem {
  modelId: string;
  callCount: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCost: number;
  percentage: number;
}

interface CreditHistoryItem {
  operationType: string;
  amount: number;
  tokenCount: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationTokens: number | null;
  cacheReadTokens: number | null;
  modelName: string | null;
  createdAt: string;
}

interface MissionInfo {
  leaderModel: string | null;
  researchDepth: string | null;
  startedAt: string | null;
  completedAt: string | null;
  totalTasks: number;
  completedTasks: number;
}

interface LatencyStepSummary {
  name: string;
  durationMs: number;
  percentOfTotal: number;
  actionCount: number;
  avgTtltMs?: number;
}

interface TTFTStats {
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
}

interface LatencySummary {
  sessionId: string;
  type: string;
  status: string;
  totalDurationMs: number;
  steps: LatencyStepSummary[];
  llmCallCount: number;
  llmTotalTimeMs: number;
  llmTimePercent: number;
  overheadMs: number;
  ttft?: TTFTStats;
  ttlt?: TTFTStats;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgTokenThroughput: number;
}

interface LatencyActionItem {
  name: string;
  type: string;
  model: string;
  totalDurationMs: number;
  ttftMs?: number;
  ttltMs: number;
  inputTokens: number;
  outputTokens: number;
}

interface LatencyStepWithActions {
  name: string;
  durationMs: number;
  parentStepId?: string;
  actions: LatencyActionItem[];
}

interface MissionListItem {
  id: string;
  status: string;
  researchDepth: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface ComputeUsageData {
  summary: ComputeUsageSummary;
  dimensions: DimensionUsage[];
  modelDistribution: ModelDistributionItem[];
  creditHistory: CreditHistoryItem[];
  mission: MissionInfo | null;
  latency: LatencySummary | null;
  latencySteps: LatencyStepWithActions[];
  missions: MissionListItem[];
  currentMissionId: string | null;
}

interface ComputeUsageTabProps {
  topicId: string;
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function formatNumber(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('en-US');
}

function formatNumberFull(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US');
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const PHASE_LABELS: Record<string, string> = {
  initialization: 'Init',
  leader_planning: 'Planning',
  dimension_research: 'Research',
  cognitive_loop: 'Validation',
  report_synthesis: 'Synthesis',
  fact_check: 'Fact Check',
  finalization: 'Finalize',
};

const CHART_COLORS = [
  '#6366f1',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#14b8a6',
];

// ──────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────

function ModelName({ modelId }: { modelId: string }) {
  if (!modelId) return <span className="text-gray-400">—</span>;
  const brand = getProviderBrand(modelId);
  return (
    <span className="flex items-center gap-1.5">
      {brand.logo && (
        <img
          src={brand.logo}
          alt={brand.name}
          className="h-3.5 w-3.5 flex-shrink-0"
        />
      )}
      <span className="truncate text-xs text-gray-700">{modelId}</span>
    </span>
  );
}

function StepActionTree({ steps }: { steps: LatencyStepWithActions[] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const totalActions = steps.reduce((s, st) => s + st.actions.length, 0);

  // 构建树：顶层 = 没有 parentStepId 的，子 step 按维度名前缀归属
  const topLevel = steps.filter(
    (s) => !s.parentStepId && !s.name.includes('/')
  );
  const subSteps = steps.filter((s) => s.parentStepId || s.name.includes('/'));

  // 为每个顶层 step 找到子 step（通过名称前缀匹配）
  const getChildren = (parent: LatencyStepWithActions) => {
    const dimName = parent.name.startsWith('dimension_research:')
      ? parent.name.replace('dimension_research:', '')
      : null;
    if (!dimName) return [];
    return subSteps.filter((s) => s.name.startsWith(dimName + '/'));
  };

  function renderActions(actions: LatencyActionItem[]) {
    if (actions.length === 0) return null;
    return (
      <Table className="w-full text-[11px]">
        <THead>
          <Tr className="text-left text-gray-400">
            <Th className="pb-1 pr-2 font-medium">Action</Th>
            <Th className="pb-1 pr-2 font-medium">Model</Th>
            <Th className="pb-1 pr-2 text-right font-medium">TTFT</Th>
            <Th className="pb-1 pr-2 text-right font-medium">TTLT</Th>
            <Th className="pb-1 pr-2 text-right font-medium">In</Th>
            <Th className="pb-1 text-right font-medium">Out</Th>
          </Tr>
        </THead>
        <TBody>
          {actions.map((action, ai) => (
            <Tr
              key={`${action.name}-${ai}`}
              className="border-t border-gray-50 hover:bg-blue-50/30"
            >
              <Td className="py-1 pr-2 text-gray-600">{action.name || '—'}</Td>
              <Td className="py-1 pr-2 text-gray-400">
                <TruncatedCell className="max-w-[120px] text-gray-400">
                  {action.model}
                </TruncatedCell>
              </Td>
              <Td className="py-1 pr-2 text-right tabular-nums text-gray-400">
                {action.ttftMs != null
                  ? action.ttftMs < 1000
                    ? `${Math.round(action.ttftMs)}ms`
                    : `${(action.ttftMs / 1000).toFixed(1)}s`
                  : '—'}
              </Td>
              <Td className="py-1 pr-2 text-right font-medium tabular-nums text-gray-600">
                {action.ttltMs < 1000
                  ? `${Math.round(action.ttltMs)}ms`
                  : `${(action.ttltMs / 1000).toFixed(1)}s`}
              </Td>
              <Td className="py-1 pr-2 text-right tabular-nums text-gray-400">
                {formatNumber(action.inputTokens)}
              </Td>
              <Td className="py-1 text-right tabular-nums text-gray-400">
                {formatNumber(action.outputTokens)}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    );
  }

  return (
    <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
        <Layers className="h-4 w-4 text-gray-400" />
        Step → Action ({steps.length} steps, {totalActions} actions)
      </h3>
      <div className="max-h-[500px] space-y-1 overflow-y-auto">
        {topLevel.map((parent, idx) => {
          const key = `p-${idx}`;
          const isOpen = expanded[key] ?? false;
          const children = getChildren(parent);
          const hasContent = children.length > 0 || parent.actions.length > 0;
          const parentLabel = parent.name.startsWith('dimension_research:')
            ? parent.name.replace('dimension_research:', '')
            : (PHASE_LABELS[parent.name] ?? parent.name);

          return (
            <div key={key}>
              <button
                type="button"
                onClick={() => hasContent && toggle(key)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-gray-50"
              >
                <span className="text-gray-400">
                  {!hasContent ? '·' : isOpen ? '▼' : '▶'}
                </span>
                <span
                  className="flex-1 truncate font-medium text-gray-700"
                  title={parent.name}
                >
                  {parentLabel}
                </span>
                <span className="shrink-0 tabular-nums text-gray-500">
                  {formatDuration(parent.durationMs)}
                </span>
                {hasContent && (
                  <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] tabular-nums text-gray-400">
                    {children.length > 0
                      ? `${children.length} sub-steps`
                      : `${parent.actions.length} actions`}
                  </span>
                )}
              </button>
              {isOpen && (
                <div className="ml-4 border-l-2 border-gray-100 pl-3">
                  {children.length > 0 ? (
                    children.map((child, ci) => {
                      const childKey = `c-${idx}-${ci}`;
                      const childOpen = expanded[childKey] ?? false;
                      const childLabel = child.name.includes('/')
                        ? child.name.split('/').pop() || child.name
                        : child.name;
                      return (
                        <div key={childKey} className="my-0.5">
                          <button
                            type="button"
                            onClick={() =>
                              child.actions.length > 0 && toggle(childKey)
                            }
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs hover:bg-gray-50"
                          >
                            <span className="text-gray-300">
                              {child.actions.length === 0
                                ? '·'
                                : childOpen
                                  ? '▾'
                                  : '▸'}
                            </span>
                            <span
                              className="flex-1 truncate text-gray-600"
                              title={child.name}
                            >
                              {childLabel}
                            </span>
                            <span className="shrink-0 text-[11px] tabular-nums text-gray-400">
                              {formatDuration(child.durationMs)}
                            </span>
                            {child.actions.length > 0 && (
                              <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] tabular-nums text-blue-400">
                                {child.actions.length} actions
                              </span>
                            )}
                          </button>
                          {childOpen && child.actions.length > 0 && (
                            <div className="ml-5 pl-2">
                              {renderActions(child.actions)}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="pl-2">{renderActions(parent.actions)}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────
// Main Component
// ──────────────────────────────────────────────────────────────

export function ComputeUsageTab({ topicId }: ComputeUsageTabProps) {
  const { t } = useI18n();
  const [data, setData] = useState<ComputeUsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMissionId, setSelectedMissionId] = useState<
    string | undefined
  >(undefined);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = (await getComputeUsage(
          topicId,
          selectedMissionId
        )) as ComputeUsageData;
        if (!cancelled) {
          setData(result);
          // 首次加载时同步 selectedMissionId
          if (!selectedMissionId && result.currentMissionId) {
            setSelectedMissionId(result.currentMissionId);
          }
        }
      } catch (err) {
        if (!cancelled) {
          logger.error('[ComputeUsageTab] fetch error:', err);
          setError((err as Error).message ?? 'Failed to load');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void fetchData();
    return () => {
      cancelled = true;
    };
  }, [topicId, selectedMissionId]);

  // ── Derived chart data ──
  const tokenDonutData = useMemo(() => {
    if (!data) return [];
    return [
      { name: 'Input', value: data.summary.inputTokens, color: '#6366f1' },
      { name: 'Output', value: data.summary.outputTokens, color: '#10b981' },
    ].filter((d) => d.value > 0);
  }, [data]);

  const dimensionBarData = useMemo(() => {
    if (!data) return [];
    return data.dimensions
      .filter((d) => d.tokensUsed != null && d.tokensUsed > 0)
      .map((d) => ({
        name:
          d.dimensionName.length > 12
            ? d.dimensionName.substring(0, 12) + '...'
            : d.dimensionName,
        fullName: d.dimensionName,
        tokens: d.tokensUsed ?? 0,
        sources: d.sourcesUsed,
      }));
  }, [data]);

  const modelPieData = useMemo(() => {
    if (!data) return [];
    return data.modelDistribution.map((m, i) => ({
      name: m.modelId,
      value: m.callCount,
      tokens: m.totalTokens,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }));
  }, [data]);

  // ── Token consumption timeline (line chart by model) ──
  const tokenTimelineData = useMemo(() => {
    if (!data || data.creditHistory.length === 0)
      return {
        chartData: [] as Record<string, unknown>[],
        models: [] as string[],
      };

    // Collect unique models
    const modelSet = new Set<string>();
    data.creditHistory.forEach((c) => {
      if (c.modelName && c.tokenCount && c.tokenCount > 0)
        modelSet.add(c.modelName);
    });
    const models = Array.from(modelSet);

    // Group by minute (sort chronologically)
    const sorted = [...data.creditHistory]
      .filter((c) => c.tokenCount && c.tokenCount > 0 && c.modelName)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

    // Accumulate tokens per model over time
    const cumulative: Record<string, number> = {};
    models.forEach((m) => {
      cumulative[m] = 0;
    });

    const chartData: Record<string, unknown>[] = [];
    for (const item of sorted) {
      const model = item.modelName!;
      cumulative[model] = (cumulative[model] || 0) + (item.tokenCount || 0);
      const point: Record<string, unknown> = {
        time: new Date(item.createdAt).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };
      models.forEach((m) => {
        point[m] = cumulative[m];
      });
      chartData.push(point);
    }

    return { chartData, models };
  }, [data]);

  // ── Context accumulation curve (input tokens per call) ──
  const contextAccumulationData = useMemo(() => {
    if (!data || data.creditHistory.length === 0) return [];
    const sorted = [...data.creditHistory]
      .filter((c) => c.inputTokens != null && c.inputTokens > 0)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    return sorted.map((item, idx) => ({
      index: idx + 1,
      inputTokens: item.inputTokens ?? 0,
      cacheRead: item.cacheReadTokens ?? 0,
      cacheCreation: item.cacheCreationTokens ?? 0,
      model: item.modelName ?? '',
    }));
  }, [data]);

  // ── Cache hit rate over time (stacked area) ──
  const cacheHitRateData = useMemo(() => {
    if (!data || data.creditHistory.length === 0) return [];
    const sorted = [...data.creditHistory]
      .filter(
        (c) =>
          c.inputTokens != null &&
          c.inputTokens > 0 &&
          (c.cacheReadTokens || c.cacheCreationTokens)
      )
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    return sorted.map((item, idx) => {
      const input = item.inputTokens ?? 0;
      const cacheRead = item.cacheReadTokens ?? 0;
      const cacheCreate = item.cacheCreationTokens ?? 0;
      const nonCached = Math.max(0, input - cacheRead);
      const totalInput = input + cacheCreate;
      const hitRate =
        totalInput > 0 ? Math.round((cacheRead / totalInput) * 100) : 0;
      return {
        index: idx + 1,
        cacheRead,
        cacheCreation: cacheCreate,
        nonCached,
        hitRate,
      };
    });
  }, [data]);

  // ── Cache savings estimate ──
  const cacheSavings = useMemo(() => {
    if (!data) return { savedTokens: 0, savedUsd: 0 };
    const savedTokens = data.summary.cacheReadTokens;
    // Anthropic cache read = 0.1x input price, so savings = 0.9x
    // Average input price ~$3/1M tokens → savings ~$2.7/1M cached tokens
    const savedUsd = savedTokens > 0 ? (savedTokens * 2.7) / 1_000_000 : 0;
    return { savedTokens, savedUsd };
  }, [data]);

  // ── Loading / Error states ──
  if (loading) {
    return (
      <div className="flex h-full min-h-[300px] items-center justify-center">
        <LoadingState text={t('common.loading')} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full min-h-[300px] flex-col items-center justify-center px-8">
        <Zap className="h-10 w-10 text-gray-300" />
        <p className="mt-3 text-sm text-gray-500">
          {t('topicResearch.computeUsage.noData')}
        </p>
      </div>
    );
  }

  const { summary, dimensions, modelDistribution, creditHistory, mission } =
    data;

  return (
    <div className="space-y-6 overflow-y-auto p-4">
      {/* ═══ Mission Selector ═══ */}
      {data.missions && data.missions.length > 0 && (
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-gray-500">
            {t('topicResearch.computeUsage.missionInfo')}:
          </span>
          <select
            value={selectedMissionId ?? data.currentMissionId ?? ''}
            onChange={(e) => setSelectedMissionId(e.target.value || undefined)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 shadow-sm focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-200"
          >
            {data.missions.map((m, idx) => (
              <option key={m.id} value={m.id}>
                #{data.missions.length - idx}{' '}
                {m.startedAt
                  ? new Date(m.startedAt).toLocaleString(undefined, {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : new Date(m.createdAt).toLocaleString(undefined, {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                (
                {m.status === 'COMPLETED'
                  ? t('topicResearch.computeUsage.statusCompleted')
                  : m.status === 'EXECUTING'
                    ? t('topicResearch.computeUsage.statusExecuting')
                    : m.status === 'FAILED'
                      ? t('topicResearch.computeUsage.statusFailed')
                      : m.status}
                ){m.researchDepth ? ` · ${m.researchDepth}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* ═══ Section 1: Summary Cards ═══ */}
      <section>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <StatCard
            icon={<Zap className="h-5 w-5" />}
            label={t('topicResearch.computeUsage.totalTokens')}
            value={formatNumber(summary.totalTokens)}
            hint={
              summary.inputTokens > 0 || summary.outputTokens > 0
                ? t('topicResearch.computeUsage.inputOutput', {
                    input: formatNumber(summary.inputTokens),
                    output: formatNumber(summary.outputTokens),
                  })
                : `${summary.totalDimensions} ${t('topicResearch.computeUsage.dimension')}`
            }
            tone="blue"
          />
          <StatCard
            icon={<DollarSign className="h-5 w-5" />}
            label={t('topicResearch.computeUsage.creditsConsumed')}
            value={formatNumberFull(summary.totalCreditsConsumed)}
            hint={
              summary.estimatedCostUsd > 0
                ? `~$${summary.estimatedCostUsd.toFixed(2)} USD`
                : undefined
            }
            tone="emerald"
          />
          <StatCard
            icon={<Activity className="h-5 w-5" />}
            label={t('topicResearch.computeUsage.llmCalls')}
            value={formatNumberFull(summary.totalLlmCalls)}
            hint={`${summary.totalDimensions} ${t('topicResearch.computeUsage.dimension')}`}
            tone="violet"
          />
          <StatCard
            icon={<Clock className="h-5 w-5" />}
            label={t('topicResearch.computeUsage.researchDuration')}
            value={formatDuration(summary.researchDurationMs)}
            hint={
              summary.reportGenerationMs > 0
                ? `${t('topicResearch.computeUsage.reportGen')}: ${formatDuration(summary.reportGenerationMs)}`
                : undefined
            }
            tone="amber"
          />
          <StatCard
            icon={<TrendingUp className="h-5 w-5" />}
            label={t('topicResearch.computeUsage.avgTokenPerDim')}
            value={
              summary.totalDimensions > 0
                ? formatNumber(
                    Math.round(summary.totalTokens / summary.totalDimensions)
                  )
                : '—'
            }
            tone="blue"
          />
          {cacheSavings.savedTokens > 0 && (
            <StatCard
              icon={<Shield className="h-5 w-5" />}
              label={t('topicResearch.computeUsage.cacheSavings')}
              value={`~$${cacheSavings.savedUsd.toFixed(2)}`}
              hint={`${formatNumber(cacheSavings.savedTokens)} tokens cached`}
              tone="emerald"
            />
          )}
        </div>
      </section>

      {/* ═══ Section 2: Token Distribution (Donut + Dimension Bar) ═══ */}
      <section className="grid gap-4 lg:grid-cols-2">
        {/* Input/Output Donut */}
        {tokenDonutData.length > 0 && (
          <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
              <Zap className="h-4 w-4 text-gray-400" />
              {t('topicResearch.computeUsage.inputOutputChart')}
            </h3>
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={140} height={140}>
                <PieChart>
                  <Pie
                    data={tokenDonutData}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={65}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {tokenDonutData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => formatNumberFull(Number(value))}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {tokenDonutData.map((entry, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: entry.color }}
                    />
                    <span className="text-xs text-gray-600">{entry.name}</span>
                    <span className="text-xs font-medium tabular-nums text-gray-900">
                      {formatNumber(entry.value)}
                    </span>
                    <span className="text-xs text-gray-400">
                      (
                      {summary.totalTokens > 0
                        ? Math.round((entry.value / summary.totalTokens) * 100)
                        : 0}
                      %)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Dimension Token Bar Chart */}
        {dimensionBarData.length > 0 && (
          <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
              <Layers className="h-4 w-4 text-gray-400" />
              {t('topicResearch.computeUsage.dimensionBreakdown')}
            </h3>
            <ResponsiveContainer
              width="100%"
              height={dimensions.length * 36 + 30}
            >
              <BarChart
                data={dimensionBarData}
                layout="vertical"
                margin={{ top: 0, right: 40, bottom: 0, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v: number) => formatNumber(v)}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 10 }}
                  width={80}
                />
                <Tooltip
                  formatter={(value) => [
                    formatNumberFull(Number(value)) + ' tokens',
                    'Token',
                  ]}
                  labelFormatter={(label, payload) => {
                    const item = payload?.[0]?.payload as
                      | { fullName?: string }
                      | undefined;
                    return item?.fullName ?? String(label);
                  }}
                />
                <Bar dataKey="tokens" fill="#6366f1" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* ═══ Section 3: Model Distribution (Pie + Table) ═══ */}
      {modelDistribution.length > 0 && (
        <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-700">
            <BarChart3 className="h-4 w-4 text-gray-400" />
            {t('topicResearch.computeUsage.modelDistribution')}
          </h3>
          <div className="flex flex-col items-start gap-6 lg:flex-row">
            {/* Pie Chart */}
            <ResponsiveContainer width={200} height={200}>
              <PieChart>
                <Pie
                  data={modelPieData}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  dataKey="value"
                  label={({ name, percent }) => {
                    const n = String(name ?? '');
                    const p = Number(percent ?? 0);
                    return `${n.length > 10 ? n.substring(0, 10) + '..' : n} ${(p * 100).toFixed(0)}%`;
                  }}
                  labelLine={false}
                >
                  {modelPieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [`${value} calls`, 'Calls']} />
              </PieChart>
            </ResponsiveContainer>

            {/* Model Table */}
            <div className="min-w-0 flex-1 overflow-x-auto">
              <Table className="w-full text-sm">
                <THead>
                  <Tr className="border-b border-gray-100">
                    <Th className="pb-2 text-left text-xs font-medium text-gray-500">
                      {t('topicResearch.computeUsage.model')}
                    </Th>
                    <Th className="pb-2 text-right text-xs font-medium text-gray-500">
                      {t('topicResearch.computeUsage.calls')}
                    </Th>
                    <Th className="pb-2 text-right text-xs font-medium text-gray-500">
                      {t('topicResearch.computeUsage.input')}
                    </Th>
                    <Th className="pb-2 text-right text-xs font-medium text-gray-500">
                      {t('topicResearch.computeUsage.output')}
                    </Th>
                    <Th className="pb-2 text-right text-xs font-medium text-gray-500">
                      {t('topicResearch.computeUsage.total')}
                    </Th>
                  </Tr>
                </THead>
                <TBody className="divide-y divide-gray-50">
                  {modelDistribution.map((item, idx) => (
                    <Tr key={idx} className="hover:bg-gray-50">
                      <Td className="py-2.5 pr-4">
                        <ModelName modelId={item.modelId} />
                      </Td>
                      <Td className="py-2.5 text-right text-xs tabular-nums text-gray-600">
                        {formatNumberFull(item.callCount)}
                      </Td>
                      <Td className="py-2.5 text-right text-xs tabular-nums text-gray-400">
                        {formatNumber(item.inputTokens)}
                      </Td>
                      <Td className="py-2.5 text-right text-xs tabular-nums text-gray-400">
                        {formatNumber(item.outputTokens)}
                      </Td>
                      <Td className="py-2.5 text-right text-xs font-medium tabular-nums text-gray-700">
                        {formatNumber(item.totalTokens)}
                      </Td>
                    </Tr>
                  ))}
                  {/* Totals Row */}
                  <Tr className="border-t-2 border-gray-200 bg-gray-50 font-medium">
                    <Td className="py-2.5 pr-4 text-xs text-gray-700">
                      {t('topicResearch.computeUsage.total')}
                    </Td>
                    <Td className="py-2.5 text-right text-xs tabular-nums text-gray-700">
                      {formatNumberFull(
                        modelDistribution.reduce((s, m) => s + m.callCount, 0)
                      )}
                    </Td>
                    <Td className="py-2.5 text-right text-xs tabular-nums text-gray-500">
                      {formatNumber(
                        modelDistribution.reduce((s, m) => s + m.inputTokens, 0)
                      )}
                    </Td>
                    <Td className="py-2.5 text-right text-xs tabular-nums text-gray-500">
                      {formatNumber(
                        modelDistribution.reduce(
                          (s, m) => s + m.outputTokens,
                          0
                        )
                      )}
                    </Td>
                    <Td className="py-2.5 text-right text-xs tabular-nums text-gray-900">
                      {formatNumber(
                        modelDistribution.reduce((s, m) => s + m.totalTokens, 0)
                      )}
                    </Td>
                  </Tr>
                </TBody>
              </Table>
            </div>
          </div>
        </section>
      )}

      {/* ═══ Section 4: Mission Info ═══ */}
      {mission && (
        <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Cpu className="h-4 w-4 text-gray-400" />
            {t('topicResearch.computeUsage.missionInfo')}
          </h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <div>
              <p className="text-xs text-gray-500">
                {t('topicResearch.computeUsage.leaderModel')}
              </p>
              <div className="mt-1">
                <ModelName modelId={mission.leaderModel ?? ''} />
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500">
                {t('topicResearch.computeUsage.depth')}
              </p>
              <p className="mt-1 text-xs font-medium text-gray-700">
                {mission.researchDepth ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">
                {t('topicResearch.computeUsage.tasks')}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full bg-indigo-500"
                    style={{
                      width: `${mission.totalTasks > 0 ? (mission.completedTasks / mission.totalTasks) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span className="text-xs tabular-nums text-gray-600">
                  {mission.completedTasks}/{mission.totalTasks}
                </span>
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500">
                {t('topicResearch.computeUsage.startTime')}
              </p>
              <p className="mt-1 text-xs text-gray-700">
                {formatTime(mission.startedAt)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">
                {t('topicResearch.computeUsage.endTime')}
              </p>
              <p className="mt-1 text-xs text-gray-700">
                {formatTime(mission.completedAt)}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* ═══ Section 4.5: Performance Latency ═══ */}
      {!data.latency && (
        <section className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-500">
            <Activity className="h-4 w-4 text-gray-400" />
            {t('topicResearch.computeUsage.latency')}
          </h3>
          <p className="text-xs text-gray-400">
            {t('topicResearch.computeUsage.noLatencyData')}
          </p>
        </section>
      )}
      {data.latency && (
        <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Activity className="h-4 w-4 text-gray-400" />
            {t('topicResearch.computeUsage.latency')}
          </h3>

          {/* Summary Row */}
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              icon={<Clock className="h-5 w-5" />}
              label={t('topicResearch.computeUsage.researchDuration')}
              value={formatDuration(data.latency.totalDurationMs)}
              hint={`${data.latency.llmCallCount} ${t('topicResearch.computeUsage.calls')}`}
              tone="amber"
            />
            <StatCard
              icon={<Cpu className="h-5 w-5" />}
              label="LLM 累计耗时"
              value={formatDuration(data.latency.llmTotalTimeMs)}
              hint={
                data.latency.llmTimePercent > 100
                  ? `${Math.round(data.latency.llmTimePercent / 100)}x 并行`
                  : `${data.latency.llmTimePercent.toFixed(0)}%`
              }
              tone="blue"
            />
            <StatCard
              icon={<BarChart3 className="h-5 w-5" />}
              label="并行度"
              value={
                data.latency.llmTimePercent > 100
                  ? `${(data.latency.llmTimePercent / 100).toFixed(1)}x`
                  : `${Math.max(0, 100 - data.latency.llmTimePercent).toFixed(0)}% 空闲`
              }
              hint={`${data.latency.llmCallCount} ${t('topicResearch.computeUsage.calls')}`}
              tone="emerald"
            />
            <StatCard
              icon={<TrendingUp className="h-5 w-5" />}
              label={t('topicResearch.computeUsage.tokenThroughput')}
              value={`${data.latency.avgTokenThroughput.toFixed(1)}`}
              hint={t('topicResearch.computeUsage.tokensPerSec')}
              tone="blue"
            />
          </div>

          {/* Step Breakdown Bar Chart */}
          {data.latency.steps.length > 0 && (
            <div className="mb-4">
              <h4 className="mb-2 text-xs font-medium text-gray-500">
                {t('topicResearch.computeUsage.phaseBreakdown')}
              </h4>
              <div className="space-y-2">
                {data.latency.steps.map((step, idx) => {
                  const stepLabel = PHASE_LABELS[step.name] ?? step.name;
                  const barWidth = Math.max(
                    2,
                    Math.min(100, step.percentOfTotal)
                  );
                  return (
                    <div key={idx} className="flex items-center gap-3">
                      <span
                        className="w-24 shrink-0 truncate text-right text-xs text-gray-500"
                        title={step.name}
                      >
                        {stepLabel}
                      </span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <div className="h-5 flex-1 overflow-hidden rounded-full bg-gray-100">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${barWidth}%`,
                                backgroundColor:
                                  CHART_COLORS[idx % CHART_COLORS.length],
                              }}
                            />
                          </div>
                          <span className="w-16 shrink-0 text-right text-xs tabular-nums text-gray-600">
                            {formatDuration(step.durationMs)}
                          </span>
                          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-gray-400">
                            {step.percentOfTotal.toFixed(0)}%
                          </span>
                          {step.avgTtltMs != null && (
                            <span className="w-20 shrink-0 text-right text-[10px] tabular-nums text-gray-400">
                              TTLT{' '}
                              {step.avgTtltMs < 1000
                                ? `${step.avgTtltMs}ms`
                                : `${(step.avgTtltMs / 1000).toFixed(1)}s`}
                              <span className="text-gray-300">
                                {' '}
                                ({step.actionCount})
                              </span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TTFT Stats */}
          {data.latency.ttft && (
            <div>
              <h4 className="mb-2 text-xs font-medium text-gray-500">
                {t('topicResearch.computeUsage.ttftStats')}
              </h4>
              <div className="grid grid-cols-5 gap-2">
                {[
                  {
                    label: t('topicResearch.computeUsage.ttftAvg'),
                    value: data.latency.ttft.avgMs,
                  },
                  {
                    label: t('topicResearch.computeUsage.ttftP50'),
                    value: data.latency.ttft.p50Ms,
                  },
                  {
                    label: t('topicResearch.computeUsage.ttftP95'),
                    value: data.latency.ttft.p95Ms,
                  },
                  {
                    label: t('topicResearch.computeUsage.ttftMin'),
                    value: data.latency.ttft.minMs,
                  },
                  {
                    label: t('topicResearch.computeUsage.ttftMax'),
                    value: data.latency.ttft.maxMs,
                  },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    className="rounded-lg bg-gray-50 p-2 text-center"
                  >
                    <p className="text-[10px] text-gray-400">{label}</p>
                    <p className="text-sm font-semibold tabular-nums text-gray-700">
                      {value < 1000
                        ? `${Math.round(value)}ms`
                        : `${(value / 1000).toFixed(1)}s`}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TTLT Stats */}
          {data.latency.ttlt && (
            <div className="mt-3">
              <h4 className="mb-2 text-xs font-medium text-gray-500">
                TTLT (Time To Last Token)
              </h4>
              <div className="grid grid-cols-5 gap-2">
                {[
                  {
                    label: t('topicResearch.computeUsage.ttftAvg'),
                    value: data.latency.ttlt.avgMs,
                  },
                  {
                    label: t('topicResearch.computeUsage.ttftP50'),
                    value: data.latency.ttlt.p50Ms,
                  },
                  {
                    label: t('topicResearch.computeUsage.ttftP95'),
                    value: data.latency.ttlt.p95Ms,
                  },
                  {
                    label: t('topicResearch.computeUsage.ttftMin'),
                    value: data.latency.ttlt.minMs,
                  },
                  {
                    label: t('topicResearch.computeUsage.ttftMax'),
                    value: data.latency.ttlt.maxMs,
                  },
                ].map(({ label, value }) => (
                  <div
                    key={`ttlt-${label}`}
                    className="rounded-lg bg-blue-50/50 p-2 text-center"
                  >
                    <p className="text-[10px] text-gray-400">{label}</p>
                    <p className="text-sm font-semibold tabular-nums text-gray-700">
                      {value < 1000
                        ? `${Math.round(value)}ms`
                        : `${(value / 1000).toFixed(1)}s`}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ═══ Section 4.6: Step → Action Tree ═══ */}
      {data.latencySteps && data.latencySteps.length > 0 && (
        <StepActionTree steps={data.latencySteps} />
      )}

      {/* ═══ Section 5: Token Consumption Timeline (Line Chart) ═══ */}
      {tokenTimelineData.chartData.length > 2 && (
        <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
            <TrendingUp className="h-4 w-4 text-gray-400" />
            {t('topicResearch.computeUsage.tokenTimeline')}
          </h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart
              data={tokenTimelineData.chartData}
              margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} />
              <YAxis
                tick={{ fontSize: 10 }}
                tickFormatter={(v: number) => formatNumber(v)}
              />
              <Tooltip
                formatter={(value) =>
                  formatNumberFull(Number(value)) + ' tokens'
                }
              />
              {tokenTimelineData.models.map((model, i) => (
                <Line
                  key={model}
                  type="monotone"
                  dataKey={model}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  name={model}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <div className="mt-2 flex flex-wrap gap-3">
            {tokenTimelineData.models.map((model, i) => (
              <div key={model} className="flex items-center gap-1.5">
                <div
                  className="h-2 w-4 rounded"
                  style={{
                    backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                  }}
                />
                <span className="text-xs text-gray-500">{model}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ═══ Section 6: Context Accumulation + Cache Hit Rate ═══ */}
      {(contextAccumulationData.length > 2 || cacheHitRateData.length > 2) && (
        <section className="grid gap-4 lg:grid-cols-2">
          {/* Context Window Accumulation Curve */}
          {contextAccumulationData.length > 2 && (
            <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
                <Database className="h-4 w-4 text-gray-400" />
                {t('topicResearch.computeUsage.contextAccumulation')}
              </h3>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart
                  data={contextAccumulationData}
                  margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="index"
                    tick={{ fontSize: 10 }}
                    label={{
                      value: t('topicResearch.computeUsage.callIndex'),
                      position: 'insideBottom',
                      offset: -2,
                      fontSize: 10,
                      fill: '#9ca3af',
                    }}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v: number) => formatNumber(v)}
                  />
                  <Tooltip
                    formatter={(value, name) => [
                      formatNumberFull(Number(value)) + ' tokens',
                      name === 'inputTokens'
                        ? t('topicResearch.computeUsage.input')
                        : name === 'cacheRead'
                          ? t('topicResearch.computeUsage.cacheRead')
                          : String(name),
                    ]}
                    labelFormatter={(label) =>
                      `${t('topicResearch.computeUsage.callIndex')} ${label}`
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="inputTokens"
                    stroke="#6366f1"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    name="inputTokens"
                  />
                  <Line
                    type="monotone"
                    dataKey="cacheRead"
                    stroke="#14b8a6"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={{ r: 2 }}
                    name="cacheRead"
                  />
                </LineChart>
              </ResponsiveContainer>
              <div className="mt-2 flex flex-wrap gap-3">
                <div className="flex items-center gap-1.5">
                  <div className="h-0.5 w-4 bg-indigo-500" />
                  <span className="text-xs text-gray-500">
                    {t('topicResearch.computeUsage.inputTokensPerCall')}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-0.5 w-4 border-t-2 border-dashed border-teal-500" />
                  <span className="text-xs text-gray-500">
                    {t('topicResearch.computeUsage.cacheRead')}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Cache Hit Rate Stacked Area */}
          {cacheHitRateData.length > 2 && (
            <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
                <Shield className="h-4 w-4 text-gray-400" />
                {t('topicResearch.computeUsage.cacheHitRate')}
              </h3>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart
                  data={cacheHitRateData}
                  margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="index"
                    tick={{ fontSize: 10 }}
                    label={{
                      value: t('topicResearch.computeUsage.callIndex'),
                      position: 'insideBottom',
                      offset: -2,
                      fontSize: 10,
                      fill: '#9ca3af',
                    }}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v: number) => formatNumber(v)}
                  />
                  <Tooltip
                    formatter={(value, name) => [
                      formatNumberFull(Number(value)) + ' tokens',
                      name === 'cacheRead'
                        ? t('topicResearch.computeUsage.cacheRead')
                        : name === 'cacheCreation'
                          ? t('topicResearch.computeUsage.cacheCreation')
                          : t('topicResearch.computeUsage.nonCached'),
                    ]}
                    labelFormatter={(label, payload) => {
                      const item = payload?.[0]?.payload as
                        | { hitRate?: number }
                        | undefined;
                      return `#${label} — Hit rate: ${item?.hitRate ?? 0}%`;
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="cacheRead"
                    stackId="1"
                    fill="#14b8a6"
                    fillOpacity={0.6}
                    stroke="#14b8a6"
                    name="cacheRead"
                  />
                  <Area
                    type="monotone"
                    dataKey="cacheCreation"
                    stackId="1"
                    fill="#f59e0b"
                    fillOpacity={0.4}
                    stroke="#f59e0b"
                    name="cacheCreation"
                  />
                  <Area
                    type="monotone"
                    dataKey="nonCached"
                    stackId="1"
                    fill="#e5e7eb"
                    fillOpacity={0.5}
                    stroke="#d1d5db"
                    name="nonCached"
                  />
                </AreaChart>
              </ResponsiveContainer>
              <div className="mt-2 flex flex-wrap gap-3">
                <div className="flex items-center gap-1.5">
                  <div className="h-3 w-3 rounded-sm bg-teal-500/60" />
                  <span className="text-xs text-gray-500">
                    {t('topicResearch.computeUsage.cacheRead')}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-3 w-3 rounded-sm bg-amber-400/40" />
                  <span className="text-xs text-gray-500">
                    {t('topicResearch.computeUsage.cacheCreation')}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-3 w-3 rounded-sm bg-gray-200/50" />
                  <span className="text-xs text-gray-500">
                    {t('topicResearch.computeUsage.nonCached')}
                  </span>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ═══ Section 7: Credit History ═══ */}
      {creditHistory.length > 0 && (
        <section className="rounded-xl border border-gray-100 bg-white shadow-sm">
          <h3 className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-700">
            <Activity className="h-4 w-4 text-gray-400" />
            {t('topicResearch.computeUsage.creditHistory')}
            <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-500">
              {creditHistory.length}
            </span>
          </h3>
          <ul className="divide-y divide-gray-50">
            {creditHistory.slice(0, 20).map((item, idx) => (
              <li
                key={idx}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                    {item.operationType}
                  </span>
                  {item.modelName && (
                    <span className="truncate text-xs text-gray-500">
                      {item.modelName}
                    </span>
                  )}
                </div>
                <div className="flex flex-shrink-0 items-center gap-4 text-xs">
                  {item.tokenCount != null && item.tokenCount > 0 && (
                    <span className="tabular-nums text-gray-400">
                      {formatNumber(item.tokenCount)} tokens
                    </span>
                  )}
                  <span
                    className={`min-w-[60px] text-right font-medium tabular-nums ${item.amount < 0 ? 'text-rose-600' : 'text-emerald-600'}`}
                  >
                    {item.amount > 0 ? '+' : ''}
                    {formatNumberFull(item.amount)}
                  </span>
                  <span className="w-[80px] text-right text-gray-400">
                    {formatTime(item.createdAt)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {/* Totals Footer */}
          <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-3">
            <span className="text-xs font-medium text-gray-700">
              {t('topicResearch.computeUsage.totalCredits')}
            </span>
            <span className="text-sm font-bold tabular-nums text-rose-600">
              {formatNumberFull(
                creditHistory.reduce((s, c) => s + c.amount, 0)
              )}
            </span>
          </div>
        </section>
      )}
    </div>
  );
}
