'use client';

/**
 * SocialComputePanel —— AI 社媒「算力消耗」tab。
 *
 * 不复用 playground ComputeUsagePanel：后者 StageBars/ROLE_META 硬编码 research 角色，
 * 社媒角色（Composer/PublishExecutor…）传进去会 0 值/崩。本组件吃社媒自己的 derive 产物
 * （SocialMissionView.cost + agents），全程 canonical UI primitives + design tokens。
 *
 * Section A · 总览（总成本 / 总 tokens / 工具调用 / 平均延迟）
 * Section B · 阶段分布（cost.byStage）
 * Section C · 角色实例（每角色 模型 / 状态 / 迭代 / 耗时 / 工具数）
 * Section D · 工具延迟（每 toolId 调用次数 / 平均延迟）
 */

import { Coins, Cpu, Activity, Gauge, Layers, Wrench } from 'lucide-react';
import { StatCard } from '@/components/ui/cards';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { TruncatedCell } from '@/components/common/tables';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { cn } from '@/lib/utils/common';
import {
  socialRoleLabel,
  type SocialMissionView,
} from '@/lib/features/ai-social/derive-social';
import { statusToken } from '@/lib/design/tokens';

function fmtUsd(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.001) return `$${n.toFixed(5)}`;
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}
function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
function fmtLatency(ms: number): string {
  if (!ms || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** stage 标签人性化（cost.byStage 的 key 形如 content-transform-wechat） */
function humanizeStage(stage: string): string {
  return stage.replace(/-/g, ' ');
}

const AGENT_STATUS: Record<string, { label: string; className: string }> = {
  running: {
    label: statusToken.running.label,
    className: `${statusToken.running.bg} ${statusToken.running.text}`,
  },
  completed: {
    label: statusToken.done.label,
    className: `${statusToken.done.bg} ${statusToken.done.text}`,
  },
  failed: {
    label: statusToken.failed.label,
    className: `${statusToken.failed.bg} ${statusToken.failed.text}`,
  },
  pending: {
    label: statusToken.pending.label,
    className: `${statusToken.pending.bg} ${statusToken.pending.text}`,
  },
};

export function SocialComputePanel({ view }: { view: SocialMissionView }) {
  const { cost, agents } = view;

  // 工具统计 + 调用次数 + 平均延迟（从 agent trace 聚合）
  const toolMap = new Map<
    string,
    { count: number; latencySum: number; latencyN: number }
  >();
  let totalActions = 0;
  let latencySum = 0;
  let latencyN = 0;
  for (const a of agents) {
    for (const t of a.trace) {
      if (t.kind === 'action' && t.toolId) {
        totalActions++;
        const cur = toolMap.get(t.toolId) ?? {
          count: 0,
          latencySum: 0,
          latencyN: 0,
        };
        cur.count++;
        toolMap.set(t.toolId, cur);
      }
      if (t.kind === 'observation') {
        if (t.latencyMs != null) {
          latencySum += t.latencyMs;
          latencyN++;
          if (t.toolId) {
            const cur = toolMap.get(t.toolId) ?? {
              count: 0,
              latencySum: 0,
              latencyN: 0,
            };
            cur.latencySum += t.latencyMs;
            cur.latencyN++;
            toolMap.set(t.toolId, cur);
          }
        }
      }
    }
  }
  const avgLatency = latencyN > 0 ? latencySum / latencyN : 0;
  const toolRows = [...toolMap.entries()]
    .map(([toolId, v]) => ({
      toolId,
      count: v.count,
      avgLatency: v.latencyN > 0 ? v.latencySum / v.latencyN : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const byStage = [...cost.byStage].sort((a, b) => b.tokensUsed - a.tokensUsed);
  const maxStageTokens = Math.max(1, ...byStage.map((s) => s.tokensUsed));

  const hasData = cost.tokensUsed > 0 || agents.length > 0 || totalActions > 0;

  if (!hasData) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState
          icon={<Gauge className="h-8 w-8" />}
          title="暂无算力数据"
          description="任务执行后，token 消耗、模型、工具调用与延迟会在此汇总。"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 overflow-auto p-4">
      {/* A · 总览 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="总成本"
          value={fmtUsd(cost.costUsd)}
          hint="估算"
          icon={<Coins className="h-5 w-5" />}
          tone="amber"
        />
        <StatCard
          label="总 tokens"
          value={fmtTokens(cost.tokensUsed)}
          hint="所有阶段累计"
          icon={<Cpu className="h-5 w-5" />}
          tone="violet"
        />
        <StatCard
          label="工具调用"
          value={String(totalActions)}
          hint="tool / 动作次数"
          icon={<Activity className="h-5 w-5" />}
          tone="blue"
        />
        <StatCard
          label="平均延迟"
          value={fmtLatency(avgLatency)}
          hint="单次工具调用平均"
          icon={<Gauge className="h-5 w-5" />}
          tone="emerald"
        />
      </div>

      {/* B · 阶段分布 */}
      {byStage.length > 0 && (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-700">
            <Layers className="h-4 w-4 text-gray-400" />
            阶段分布
          </h3>
          <div className="space-y-2">
            {byStage.map((s) => (
              <div key={s.stage} className="text-xs">
                <div className="mb-0.5 flex items-center justify-between">
                  <span className="truncate text-gray-600">
                    {humanizeStage(s.stage)}
                  </span>
                  <span className="font-mono shrink-0 text-gray-500">
                    {fmtTokens(s.tokensUsed)} · {fmtUsd(s.costUsd)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-400 to-purple-500"
                    style={{
                      width: `${Math.round((s.tokensUsed / maxStageTokens) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* C · 角色实例 */}
      {agents.length > 0 && (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-700">
            <Cpu className="h-4 w-4 text-gray-400" />
            角色实例
          </h3>
          <Table className="w-full table-fixed">
            <colgroup>
              <col className="w-[20%]" />
              <col className="w-[12%]" />
              <col className="w-[28%]" />
              <col className="w-[10%]" />
              <col className="w-[14%]" />
              <col className="w-[16%]" />
            </colgroup>
            <THead>
              <Tr>
                <Th>角色</Th>
                <Th>状态</Th>
                <Th>模型</Th>
                <Th className="text-right">迭代</Th>
                <Th className="text-right">耗时</Th>
                <Th className="text-right">工具数</Th>
              </Tr>
            </THead>
            <TBody>
              {agents.map((a) => {
                const st = AGENT_STATUS[a.phase] ?? AGENT_STATUS.pending;
                const toolCount = new Set(
                  a.trace
                    .filter((t) => t.kind === 'action' && t.toolId)
                    .map((t) => t.toolId)
                ).size;
                return (
                  <Tr key={a.agentId}>
                    <Td className="font-medium text-gray-900">
                      <TruncatedCell className="max-w-[160px] font-medium text-gray-900">
                        {socialRoleLabel(a.role)}
                      </TruncatedCell>
                    </Td>
                    <Td>
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[11px] font-medium',
                          st.className
                        )}
                      >
                        {st.label}
                      </span>
                    </Td>
                    <Td className="font-mono text-xs text-gray-600">
                      <TruncatedCell className="font-mono max-w-[180px] text-xs text-gray-600">
                        {a.modelId ?? '—'}
                      </TruncatedCell>
                    </Td>
                    <Td className="font-mono text-right text-gray-600">
                      {a.iterations ?? '—'}
                    </Td>
                    <Td className="font-mono text-right text-gray-600">
                      {a.wallTimeMs != null ? fmtLatency(a.wallTimeMs) : '—'}
                    </Td>
                    <Td className="font-mono text-right text-gray-600">
                      {toolCount}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </section>
      )}

      {/* D · 工具延迟 */}
      {toolRows.length > 0 && (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-700">
            <Wrench className="h-4 w-4 text-gray-400" />
            工具延迟
          </h3>
          <Table>
            <THead>
              <Tr>
                <Th>工具</Th>
                <Th className="text-right">调用次数</Th>
                <Th className="text-right">平均延迟</Th>
              </Tr>
            </THead>
            <TBody>
              {toolRows.map((t) => (
                <Tr key={t.toolId}>
                  <Td className="font-mono text-xs text-gray-700">
                    <TruncatedCell className="font-mono max-w-[200px] text-xs text-gray-700">
                      {t.toolId}
                    </TruncatedCell>
                  </Td>
                  <Td className="font-mono text-right text-gray-600">
                    {t.count}
                  </Td>
                  <Td className="font-mono text-right text-gray-600">
                    {fmtLatency(t.avgLatency)}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </section>
      )}
    </div>
  );
}
