'use client';

/**
 * ComputeUsagePanel —— 算力消耗（对标 Topic Insights，叠加我们独有能力）
 *
 * 信息架构：
 *   Section A · Token / Cost 总览（4 卡：总 tokens / 总成本 / 调用次数 / 平均延迟）
 *   Section B · 模型分布表（每个 modelId 的调用 / tokens / 占比 / 估算成本）
 *   Section C · 阶段（Stage）分布柱图  ← TI 也有
 *   Section D · Agent 实例耗时表        ← 我们独有：每个 Agent 实例 iter / wallTime / model
 *   Section E · 工具延迟表              ← 我们独有：每个 toolId 的调用次数 / 总延迟 / 平均
 *   Section F · 浪费分析（重试 / 重写）  ← 我们独有：retryCount / chapter rewrite 次数
 *
 * 全程使用 playground-ui primitives + design tokens。
 */

import React from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { TruncatedCell } from '@/components/common/tables';
import {
  Coins,
  Layers,
  Cpu,
  Wrench,
  AlertTriangle,
  Activity,
  Gauge,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';
import type {
  CostState,
  AgentLiveState,
  DimensionPipelineState,
} from '@/lib/features/agent-playground/mission-presentation.types';
import type { MissionTodo } from '@/lib/features/agent-playground/mission-todo.types';
import {
  fmtUsd,
  fmtTokens,
  fmtLatency,
  STAGE_LABEL,
  ROLE_LABEL,
} from '@/lib/features/agent-playground/formatters';
import { Card } from '@/components/agent-playground/ui';
import { StatCard } from '@/components/ui/cards';

interface Props {
  cost: CostState;
  agents: AgentLiveState[];
  todos: MissionTodo[];
  dimensionPipelines: Map<string, DimensionPipelineState>;
}

// ─── Section A · 总览 ────────────────────────────────
function SummaryStrip({
  totalTokens,
  costUsd,
  totalCalls,
  avgLatencyMs,
  hasLatencyData,
}: {
  totalTokens: number;
  costUsd: number;
  totalCalls: number;
  avgLatencyMs: number;
  /** true when at least one observation with latencyMs exists */
  hasLatencyData: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatCard
        label="总成本"
        value={fmtUsd(costUsd)}
        hint="估算（按 $3/1M tokens 折算）"
        icon={<Coins className="h-5 w-5" />}
        tone="amber"
      />
      <StatCard
        label="总 tokens"
        value={fmtTokens(totalTokens)}
        hint="所有 stage 累计"
        icon={<Cpu className="h-5 w-5" />}
        tone="violet"
      />
      <StatCard
        label="工具调用"
        value={String(totalCalls)}
        hint="tool / LLM 次数"
        icon={<Activity className="h-5 w-5" />}
        tone="blue"
      />
      <StatCard
        label="平均延迟"
        value={hasLatencyData ? fmtLatency(avgLatencyMs) : '—'}
        hint={
          hasLatencyData
            ? '工具单次调用平均（按 observation 事件计）'
            : '无 latencyMs 观测 — backend 未发出 observation.latencyMs'
        }
        icon={<Gauge className="h-5 w-5" />}
        tone="emerald"
      />
    </div>
  );
}

// ─── Section B · 模型分布 ─────────────────────────────
interface ModelRow {
  modelId: string;
  callCount: number;
  agentCount: number;
  estTokens: number;
  pct: number;
  estCostUsd: number;
}
const UNKNOWN_MODEL_KEY = '(unknown)';
const UNKNOWN_MODEL_LABEL = '未识别模型 · backend modelId 缺失';

function buildModelDistribution(
  agents: AgentLiveState[],
  totalTokensFallback: number
): ModelRow[] {
  const map = new Map<
    string,
    { callCount: number; agentSet: Set<string>; traceTokens: number }
  >();
  for (const a of agents) {
    const calls = a.trace.length;
    const tokensFromTrace = a.trace.reduce(
      (s, t) => s + (t.tokensUsed ?? 0),
      0
    );
    const m = a.modelId || UNKNOWN_MODEL_KEY;
    const cur = map.get(m) ?? {
      callCount: 0,
      agentSet: new Set(),
      traceTokens: 0,
    };
    cur.callCount += calls;
    cur.agentSet.add(a.agentId);
    cur.traceTokens += tokensFromTrace;
    map.set(m, cur);
  }
  const totalTraceTokens = [...map.values()].reduce(
    (s, v) => s + v.traceTokens,
    0
  );
  const totalCalls =
    [...map.values()].reduce((s, v) => s + v.callCount, 0) || 1;
  const totalBase =
    totalTraceTokens > 0 ? totalTraceTokens : Math.max(0, totalTokensFallback);
  const allRows = [...map.entries()]
    .map(([modelId, v]) => {
      const estTokens =
        totalTraceTokens > 0
          ? v.traceTokens
          : Math.round((totalBase * v.callCount) / totalCalls);
      return {
        modelId,
        callCount: v.callCount,
        agentCount: v.agentSet.size,
        estTokens,
        pct: totalBase > 0 ? Math.round((estTokens / totalBase) * 100) : 0,
        estCostUsd: (estTokens / 1_000_000) * 3,
      };
    })
    .sort((a, b) => b.estTokens - a.estTokens);

  const hasRealRows = allRows.some((r) => r.modelId !== UNKNOWN_MODEL_KEY);
  if (hasRealRows) {
    // Drop unknown rows when real model data is present — unknown is noise.
    return allRows.filter((r) => r.modelId !== UNKNOWN_MODEL_KEY);
  }
  // All rows are unknown: keep one row but relabel it so the user understands
  // it's a data availability issue, not a misconfiguration.
  return allRows.slice(0, 1).map((r) => ({
    ...r,
    modelId: UNKNOWN_MODEL_LABEL,
  }));
}

function ModelDistributionTable({ rows }: { rows: ModelRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Card className="overflow-hidden" bordered>
      <div className="border-b border-gray-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-violet-500" />
          <h3 className="text-sm font-semibold text-gray-900">模型分布</h3>
          <span className="text-xs text-gray-500">
            · 共 {rows.length} 个模型
          </span>
        </div>
      </div>
      <Table className="w-full table-fixed text-[12px]">
        <THead className="bg-gray-50/80">
          <Tr>
            <Th className="w-[36%] whitespace-nowrap px-3 py-2 text-left font-medium text-gray-600">
              模型 ID
            </Th>
            <Th className="w-[10%] whitespace-nowrap px-2 py-2 text-right font-medium text-gray-600">
              实例
            </Th>
            <Th className="w-[10%] whitespace-nowrap px-2 py-2 text-right font-medium text-gray-600">
              调用
            </Th>
            <Th className="w-[14%] whitespace-nowrap px-2 py-2 text-right font-medium text-gray-600">
              Tokens
            </Th>
            <Th className="w-[14%] whitespace-nowrap px-2 py-2 text-right font-medium text-gray-600">
              成本
            </Th>
            <Th className="w-[16%] whitespace-nowrap px-2 py-2 text-right font-medium text-gray-600">
              占比
            </Th>
          </Tr>
        </THead>
        <TBody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <Tr key={r.modelId} className="hover:bg-violet-50/30">
              <Td className="px-3 py-2">
                <TruncatedCell className="font-mono max-w-[200px] text-[11px] text-gray-700">
                  {r.modelId}
                </TruncatedCell>
              </Td>
              <Td className="px-2 py-2 text-right tabular-nums text-gray-700">
                {r.agentCount}
              </Td>
              <Td className="px-2 py-2 text-right tabular-nums text-gray-700">
                {r.callCount}
              </Td>
              <Td className="font-mono px-2 py-2 text-right tabular-nums text-gray-700">
                {fmtTokens(r.estTokens)}
              </Td>
              <Td className="font-mono px-2 py-2 text-right tabular-nums text-gray-700">
                {fmtUsd(r.estCostUsd)}
              </Td>
              <Td className="px-2 py-2 text-right">
                <div className="flex items-center justify-end gap-2">
                  <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-violet-400"
                      style={{ width: `${Math.min(100, r.pct)}%` }}
                    />
                  </div>
                  <span className="font-mono w-8 text-right text-[11px] text-gray-600">
                    {r.pct}%
                  </span>
                </div>
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
      <p className="px-4 py-2 text-[10px] text-gray-400">
        Tokens 估算来自 trace.tokensUsed 累加；当模型 id
        未捕获时归入「(未捕获)」。
      </p>
    </Card>
  );
}

// ─── Section C · Stage 柱图 ──────────────────────────
function StageBars({ cost }: { cost: CostState }) {
  const stages = [
    'leader',
    'researchers',
    'reconciler',
    'analyst',
    'writer',
    'reviewer',
    'critic',
  ];
  const data = stages.map((s) => {
    const d = cost.byStage.find((b) => b.stage === s);
    return {
      stage: s,
      label: STAGE_LABEL[s] ?? s,
      tokensUsed: d?.tokensUsed ?? 0,
      costUsd: d?.costUsd ?? 0,
    };
  });
  const max = Math.max(1, ...data.map((d) => d.tokensUsed));
  return (
    <Card className="p-4" bordered>
      <div className="mb-3 flex items-center gap-2">
        <Layers className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-semibold text-gray-900">阶段分布</h3>
      </div>
      <div className="space-y-2">
        {data.map((d) => (
          <div key={d.stage}>
            <div className="mb-0.5 flex items-baseline justify-between text-[11px]">
              <span className="text-gray-700">{d.label}</span>
              <span className="font-mono text-gray-500">
                {fmtTokens(d.tokensUsed)}
                {d.costUsd > 0 && (
                  <span className="ml-1.5 text-gray-400">
                    {fmtUsd(d.costUsd)}
                  </span>
                )}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full bg-gradient-to-r from-amber-300 to-orange-400 transition-all"
                style={{
                  width: `${Math.round((d.tokensUsed / max) * 100)}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Section D · Agent 实例表 ────────────────────────
function AgentInstanceTable({ agents }: { agents: AgentLiveState[] }) {
  if (agents.length === 0) return null;
  const sorted = [...agents].sort(
    (a, b) => (b.wallTimeMs ?? 0) - (a.wallTimeMs ?? 0)
  );
  return (
    <Card className="overflow-hidden" bordered>
      <div className="border-b border-gray-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-blue-500" />
          <h3 className="text-sm font-semibold text-gray-900">
            Agent 实例耗时
          </h3>
          <span className="text-xs text-gray-500">
            · 共 {agents.length} 个实例
          </span>
        </div>
      </div>
      <Table className="w-full table-fixed text-[12px]">
        <colgroup>
          <col className="w-[8%]" />
          <col className="w-[18%]" />
          <col className="w-[14%]" />
          <col className="w-[14%]" />
          <col className="w-[8%]" />
          <col className="w-[6%]" />
          <col className="w-[6%]" />
          <col className="w-[8%]" />
          <col className="w-[8%]" />
          <col className="w-[5%]" />
          <col className="w-[5%]" />
        </colgroup>
        <THead className="bg-gray-50/80">
          <Tr>
            <Th className="px-2 py-2 text-left font-medium text-gray-600">
              角色
            </Th>
            <Th className="px-2 py-2 text-left font-medium text-gray-600">
              实例 ID
            </Th>
            <Th className="px-2 py-2 text-left font-medium text-gray-600">
              维度
            </Th>
            <Th className="px-2 py-2 text-left font-medium text-gray-600">
              模型
            </Th>
            <Th className="px-2 py-2 text-left font-medium text-gray-600">
              状态
            </Th>
            <Th className="px-2 py-2 text-right font-medium text-gray-600">
              Iter
            </Th>
            <Th className="px-2 py-2 text-right font-medium text-gray-600">
              重试
            </Th>
            <Th className="px-2 py-2 text-right font-medium text-gray-600">
              Tokens
            </Th>
            <Th className="px-2 py-2 text-right font-medium text-gray-600">
              成本
            </Th>
            <Th className="px-2 py-2 text-right font-medium text-gray-600">
              工具
            </Th>
            <Th className="px-2 py-2 text-right font-medium text-gray-600">
              耗时
            </Th>
          </Tr>
        </THead>
        <TBody className="divide-y divide-gray-100">
          {sorted.map((a) => (
            <Tr key={a.agentId} className="hover:bg-blue-50/30">
              <Td className="px-3 py-2">
                <span className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-violet-200">
                  {ROLE_LABEL[a.role] ?? a.role}
                </span>
              </Td>
              <Td className="px-2 py-2">
                <TruncatedCell className="font-mono max-w-[160px] text-[11px] text-gray-700">
                  {a.agentId}
                </TruncatedCell>
              </Td>
              <Td className="px-2 py-2">
                <TruncatedCell className="max-w-[140px] text-[11px] text-gray-600">
                  {a.dimension ?? '—'}
                </TruncatedCell>
              </Td>
              <Td className="px-2 py-2">
                <TruncatedCell className="font-mono max-w-[140px] text-[10.5px] text-gray-500">
                  {a.modelId ?? '—'}
                </TruncatedCell>
              </Td>
              <Td className="px-2 py-2">
                {(() => {
                  const tone =
                    a.phase === 'running'
                      ? 'bg-orange-50 text-orange-700 ring-orange-200'
                      : a.phase === 'completed'
                        ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                        : a.phase === 'failed'
                          ? 'bg-red-50 text-red-700 ring-red-200'
                          : 'bg-gray-50 text-gray-600 ring-gray-200';
                  const label =
                    a.phase === 'running'
                      ? '运行中'
                      : a.phase === 'completed'
                        ? '已完成'
                        : a.phase === 'failed'
                          ? '失败'
                          : '待启动';
                  return (
                    <span
                      className={cn(
                        'inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ring-1',
                        tone
                      )}
                    >
                      {label}
                    </span>
                  );
                })()}
              </Td>
              <Td className="font-mono px-2 py-2 text-right tabular-nums text-gray-700">
                {a.iterations ?? 0}
              </Td>
              <Td
                className={cn(
                  'font-mono px-2 py-2 text-right tabular-nums',
                  (a.retryCount ?? 0) > 0
                    ? 'font-semibold text-orange-600'
                    : 'text-gray-400'
                )}
              >
                {a.retryCount ?? 0}
              </Td>
              <Td className="font-mono px-2 py-2 text-right tabular-nums text-gray-700">
                {a.tokensUsed != null ? fmtTokens(a.tokensUsed) : '—'}
              </Td>
              <Td className="font-mono px-2 py-2 text-right tabular-nums text-gray-700">
                {a.costUsd != null ? fmtUsd(a.costUsd) : '—'}
              </Td>
              <Td className="font-mono px-2 py-2 text-right tabular-nums text-gray-700">
                {a.toolCallCount ?? 0}
              </Td>
              <Td className="font-mono px-2 py-2 text-right tabular-nums text-gray-700">
                {a.wallTimeMs ? fmtLatency(a.wallTimeMs) : '—'}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

// ─── Section E · 工具延迟 ─────────────────────────────
interface ToolRow {
  toolId: string;
  callCount: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  errorCount: number;
  /** true = at least one observation event was recorded for this tool */
  hasObservation: boolean;
}
function buildToolStats(agents: AgentLiveState[]): ToolRow[] {
  // ★ 2026-05-27 (Screenshot_21) 修：tool 调用计数在 `agent:action`，但延迟 / 错误
  //   在配对的 `agent:observation`（baseline derive.ts 是这个结构）。原实现只读
  //   action.latencyMs → 永远是 0 → 总延迟 / 平均 列全空。
  //   现在：action.toolId 计算 callCount，observation 同 toolId 累加 latency/error。
  //   hasObservation 追踪是否有 observation 事件到达，用于区分「无数据」vs「真实 0」。
  const map = new Map<
    string,
    {
      callCount: number;
      totalLatency: number;
      errors: number;
      obsCount: number;
    }
  >();
  for (const a of agents) {
    for (const t of a.trace) {
      if (!t.toolId) continue;
      if (t.kind !== 'action' && t.kind !== 'observation') continue;
      const cur = map.get(t.toolId) ?? {
        callCount: 0,
        totalLatency: 0,
        errors: 0,
        obsCount: 0,
      };
      if (t.kind === 'action') {
        cur.callCount += 1;
      } else {
        // observation
        cur.obsCount += 1;
        if (typeof t.latencyMs === 'number') cur.totalLatency += t.latencyMs;
        if (t.error) cur.errors += 1;
      }
      map.set(t.toolId, cur);
    }
  }
  return [...map.entries()]
    .map(([toolId, v]) => ({
      toolId,
      callCount: v.callCount,
      totalLatencyMs: v.totalLatency,
      avgLatencyMs: v.obsCount > 0 ? v.totalLatency / v.obsCount : 0,
      errorCount: v.errors,
      hasObservation: v.obsCount > 0,
    }))
    .sort((a, b) => b.totalLatencyMs - a.totalLatencyMs);
}

function ToolLatencyTable({ rows }: { rows: ToolRow[] }) {
  if (rows.length === 0) return null;
  // ★ 2026-05-02 (#9 用户实证)：工具的使用应该是矩阵表 — 加成功率 + 总调用合计行
  const totalCalls = rows.reduce((s, r) => s + r.callCount, 0);
  const totalErrors = rows.reduce((s, r) => s + r.errorCount, 0);
  // Only rows that have observation events contribute to error counting.
  const rowsWithObs = rows.filter((r) => r.hasObservation);
  const obsCallCount = rowsWithObs.reduce((s, r) => s + r.callCount, 0);
  const overallSuccessRate =
    obsCallCount > 0 ? (1 - totalErrors / obsCallCount) * 100 : null;
  return (
    <Card className="overflow-hidden" bordered>
      <div className="border-b border-gray-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-emerald-500" />
          <h3 className="text-sm font-semibold text-gray-900">工具调用矩阵</h3>
          <span className="text-xs text-gray-500">
            · 共 {rows.length} 个工具 / {totalCalls} 次调用 ·{' '}
            {overallSuccessRate === null ? (
              <span className="font-medium italic text-gray-400">
                成功率未知
              </span>
            ) : (
              <span
                className={cn(
                  'font-medium',
                  overallSuccessRate >= 90
                    ? 'text-emerald-600'
                    : overallSuccessRate >= 70
                      ? 'text-amber-600'
                      : 'text-red-600'
                )}
              >
                成功率 {overallSuccessRate.toFixed(0)}%
              </span>
            )}
          </span>
        </div>
      </div>
      <Table className="w-full table-fixed text-[12px]">
        <colgroup>
          <col className="w-[34%]" />
          <col className="w-[12%]" />
          <col className="w-[14%]" />
          <col className="w-[12%]" />
          <col className="w-[12%]" />
          <col className="w-[16%]" />
        </colgroup>
        <THead className="bg-gray-50/80">
          <Tr>
            <Th className="w-[34%] whitespace-nowrap px-3 py-2 text-left font-medium text-gray-600">
              工具 ID
            </Th>
            <Th className="w-[12%] whitespace-nowrap px-2 py-2 text-right font-medium text-gray-600">
              调用
            </Th>
            <Th className="w-[14%] whitespace-nowrap px-2 py-2 text-right font-medium text-gray-600">
              总延迟
            </Th>
            <Th className="w-[12%] whitespace-nowrap px-2 py-2 text-right font-medium text-gray-600">
              平均
            </Th>
            <Th className="w-[12%] whitespace-nowrap px-2 py-2 text-right font-medium text-gray-600">
              失败
            </Th>
            <Th className="w-[16%] whitespace-nowrap px-2 py-2 text-right font-medium text-gray-600">
              成功率
            </Th>
          </Tr>
        </THead>
        <TBody className="divide-y divide-gray-100">
          {rows.map((r) => {
            // When no observation events arrived we cannot derive latency, errors, or
            // success-rate — show explicit "no observation" placeholders instead of
            // misleading zeros / 100 %.
            const noObs = !r.hasObservation;
            const successRate = noObs
              ? null
              : r.callCount > 0
                ? (1 - r.errorCount / r.callCount) * 100
                : null;
            return (
              <Tr key={r.toolId} className="hover:bg-emerald-50/30">
                <Td className="px-3 py-2">
                  <TruncatedCell className="font-mono max-w-[200px] text-[11px] text-gray-700">
                    {r.toolId}
                  </TruncatedCell>
                </Td>
                <Td className="font-mono px-2 py-2 text-right tabular-nums text-gray-700">
                  {r.callCount}
                </Td>
                <Td className="font-mono px-2 py-2 text-right tabular-nums text-gray-500">
                  {noObs ? (
                    <span className="text-[10px] italic text-gray-400">
                      无观测
                    </span>
                  ) : (
                    fmtLatency(r.totalLatencyMs)
                  )}
                </Td>
                <Td className="font-mono px-2 py-2 text-right tabular-nums text-gray-500">
                  {noObs ? (
                    <span className="text-[10px] italic text-gray-400">
                      无观测
                    </span>
                  ) : (
                    fmtLatency(r.avgLatencyMs)
                  )}
                </Td>
                <Td
                  className={cn(
                    'font-mono px-2 py-2 text-right tabular-nums',
                    noObs
                      ? 'text-gray-400'
                      : r.errorCount > 0
                        ? 'font-semibold text-red-600'
                        : 'text-gray-400'
                  )}
                >
                  {noObs ? (
                    <span className="text-[10px] italic">—</span>
                  ) : (
                    r.errorCount
                  )}
                </Td>
                <Td
                  className={cn(
                    'font-mono px-2 py-2 text-right tabular-nums',
                    successRate === null
                      ? 'text-gray-400'
                      : successRate >= 90
                        ? 'text-emerald-600'
                        : successRate >= 70
                          ? 'text-amber-600'
                          : 'text-red-600'
                  )}
                >
                  {successRate === null ? (
                    <span className="text-[10px] italic">未知</span>
                  ) : (
                    `${successRate.toFixed(0)}%`
                  )}
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
    </Card>
  );
}

// ─── Skill 使用矩阵 (#9 用户实证) ─────────────────────────────
interface SkillRow {
  agentRole: string;
  agentId: string;
  skills: string[];
}
function buildSkillRows(agents: AgentLiveState[]): SkillRow[] {
  // 从 trace 提取 skillId 类的 action（toolId 以 'skill' 开头 或匹配已知 skill 命名）
  const KNOWN_SKILL_PATTERNS =
    /^(dimension-|web-research|chapter-|dim-|m\d+-|leader-|critic-|writer-|reviewer-|reflexion|react-|skill:)/i;
  const result: SkillRow[] = [];
  for (const a of agents) {
    const skills = new Set<string>();
    for (const t of a.trace) {
      if (t.kind !== 'action' || !t.toolId) continue;
      // skill 识别：toolId 满足 KNOWN_SKILL_PATTERNS
      if (KNOWN_SKILL_PATTERNS.test(t.toolId)) {
        skills.add(t.toolId);
      }
    }
    if (skills.size > 0) {
      result.push({
        agentRole: a.role,
        agentId: a.agentId,
        skills: Array.from(skills),
      });
    }
  }
  return result;
}

function SkillUsageTable({ agents }: { agents: AgentLiveState[] }) {
  const rows = buildSkillRows(agents);
  if (rows.length === 0) return null;
  const totalSkillsApplied = rows.reduce((s, r) => s + r.skills.length, 0);
  return (
    <Card className="overflow-hidden" bordered>
      <div className="border-b border-gray-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-violet-500" />
          <h3 className="text-sm font-semibold text-gray-900">技能使用矩阵</h3>
          <span className="text-xs text-gray-500">
            · 共 {rows.length} 个 agent · {totalSkillsApplied} 次技能调用
          </span>
        </div>
      </div>
      <Table className="w-full text-[12px]">
        <THead className="bg-gray-50/80">
          <Tr>
            <Th className="w-[20%] px-3 py-2 text-left font-medium text-gray-600">
              Agent 角色
            </Th>
            <Th className="w-[25%] px-2 py-2 text-left font-medium text-gray-600">
              Agent ID
            </Th>
            <Th className="w-[55%] px-2 py-2 text-left font-medium text-gray-600">
              已应用技能
            </Th>
          </Tr>
        </THead>
        <TBody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <Tr key={r.agentId} className="hover:bg-violet-50/30">
              <Td className="px-3 py-2 text-[11px] text-gray-700">
                {r.agentRole}
              </Td>
              <Td className="px-2 py-2">
                <TruncatedCell className="font-mono max-w-[180px] text-[11px] text-gray-700">
                  {r.agentId}
                </TruncatedCell>
              </Td>
              <Td className="px-2 py-2 text-[11px] text-gray-700">
                <div className="flex flex-wrap gap-1">
                  {r.skills.map((s) => (
                    <span
                      key={s}
                      className="font-mono rounded bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-700"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

// ─── Section F · 浪费分析 ─────────────────────────────
function WasteAnalysis({
  agents,
  todos,
  dimensionPipelines,
}: {
  agents: AgentLiveState[];
  todos: MissionTodo[];
  dimensionPipelines: Map<string, DimensionPipelineState>;
}) {
  const totalRetries = agents.reduce((s, a) => s + (a.retryCount ?? 0), 0);
  let chapterRewrites = 0;
  for (const dp of dimensionPipelines.values()) {
    for (const c of dp.chapters) {
      chapterRewrites += Math.max(0, (c.attempts ?? 1) - 1);
    }
  }
  const reviewerRevise = todos.filter(
    (t) => t.origin === 'reviewer-revise'
  ).length;
  const selfHeal = todos.filter((t) => t.origin === 'self-heal-retry').length;
  const leaderReplay = todos.filter((t) =>
    t.origin.startsWith('leader-assess')
  ).length;

  if (
    totalRetries === 0 &&
    chapterRewrites === 0 &&
    reviewerRevise === 0 &&
    selfHeal === 0 &&
    leaderReplay === 0
  ) {
    return (
      <Card className="border-emerald-100 bg-emerald-50/50 p-4" bordered>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-emerald-600" />
          <p className="text-sm font-semibold text-emerald-700">
            零返工 · 0 次重试 / 0 次重写
          </p>
        </div>
        <p className="mt-1 text-xs text-emerald-700/80">
          本次 mission 没有 Agent 自愈重试，也没有 Chapter Reviewer 触发重写。
        </p>
      </Card>
    );
  }

  const cells = [
    {
      label: 'Agent 自愈重试',
      value: totalRetries,
      hint: 'finalize 校验失败 / fallback 模型',
    },
    {
      label: '章节重写',
      value: chapterRewrites,
      hint: 'Chapter Reviewer 评分 < 70 触发',
    },
    {
      label: 'Reviewer 重派',
      value: reviewerRevise,
      hint: 'Mission Reviewer 要求重写',
    },
    {
      label: 'Self-heal 任务',
      value: selfHeal,
      hint: '自愈生成的子任务',
    },
    {
      label: 'Leader 评审重派',
      value: leaderReplay,
      hint: 'S4 Leader 重新分配',
    },
  ].filter((c) => c.value > 0);

  return (
    <Card className="overflow-hidden" bordered>
      <div className="border-b border-amber-100 bg-amber-50/40 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <h3 className="text-sm font-semibold text-amber-800">
            返工 / 浪费分析
          </h3>
          <span className="text-xs text-amber-700/80">
            · 这些环节产生了额外的算力消耗
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 p-3 md:grid-cols-3 lg:grid-cols-5">
        {cells.map((c) => (
          <div
            key={c.label}
            className="rounded-md border border-amber-100 bg-amber-50/30 p-2"
          >
            <p className="text-[10px] font-medium text-amber-700/80">
              {c.label}
            </p>
            <p className="mt-0.5 text-xl font-bold text-amber-700">{c.value}</p>
            <p className="mt-0.5 text-[10px] text-amber-700/60">{c.hint}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── 主组件 ──────────────────────────────────────────
export function ComputeUsagePanel({
  cost,
  agents,
  todos,
  dimensionPipelines,
}: Props) {
  const totalCalls = agents.reduce(
    (s, a) => s + a.trace.filter((t) => t.kind === 'action' && t.toolId).length,
    0
  );
  // latency lives on observation events, not action events
  const { totalLatency, obsCount } = agents.reduce(
    (acc, a) => {
      for (const t of a.trace) {
        if (t.kind === 'observation' && t.toolId) {
          acc.obsCount += 1;
          if (typeof t.latencyMs === 'number') acc.totalLatency += t.latencyMs;
        }
      }
      return acc;
    },
    { totalLatency: 0, obsCount: 0 }
  );
  const hasLatencyData = obsCount > 0;
  const avgLatency = hasLatencyData ? totalLatency / obsCount : 0;
  const modelRows = buildModelDistribution(agents, cost.tokensUsed);
  const toolRows = buildToolStats(agents);

  return (
    <div className="space-y-4">
      <SummaryStrip
        totalTokens={cost.tokensUsed}
        costUsd={cost.costUsd}
        totalCalls={totalCalls}
        avgLatencyMs={avgLatency}
        hasLatencyData={hasLatencyData}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ModelDistributionTable rows={modelRows} />
        <StageBars cost={cost} />
      </div>
      <AgentInstanceTable agents={agents} />
      <ToolLatencyTable rows={toolRows} />
      <SkillUsageTable agents={agents} />
      <WasteAnalysis
        agents={agents}
        todos={todos}
        dimensionPipelines={dimensionPipelines}
      />
      <p className="text-[10px] text-gray-400">
        所有数字来自前端事件流推导。Cost 估算按 ~$3 / 1M tokens（混合模型）；以
        Credits 服务为准。
      </p>
    </div>
  );
}
