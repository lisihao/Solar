'use client';

/**
 * useStageProcessTrace — Drawer 流式过程数据 (T75 / Screenshot_24-27)
 *
 * Backend canonical view 经 fetch-coalesce 250ms+ 才更新一次，Drawer 打开
 * 时看不到 stage 正在跑的实时 ReAct trace。本 hook 把 live event stream
 * 在前端按 STAGE→agentId pattern 本地累积，叠加到 canonical processTrace 上：
 *
 *   merged.reactTrace = canonical.reactTrace ∪ local.reactTrace  (dedup by ts)
 *   merged.totalTokens / totalDurationMs / stepCount 取 max(canonical, local)
 *   merged.inputs / llmCalls / outputPeek 优先 canonical（聚合统计字段）
 *
 * §3.4 single-source-of-truth 红线：local 累积**仅用于 reactTrace 实时刷新**，
 * 其余字段不构造前端 truth。下一次 view refetch 到来时 canonical 会自动
 * 接管/校正本地推算。
 */

import { useMemo } from 'react';
import type { StageProcessTrace } from '@/lib/features/agent-playground/mission-presentation.types';

export interface StageProcessTraceEventLike {
  type: string;
  payload?: unknown;
  agentId?: string;
  timestamp: number;
}

/**
 * Stage → agentId 模式映射。与 backend
 * `backend/src/modules/ai-app/agent-playground/mission/projectors/stage-view.projector.ts`
 * 中 `STAGE_AGENT_PATTERN` 一致。修改请同步两端。
 */
const STAGE_AGENT_PATTERN: Record<
  string,
  { ids?: string[]; prefixes?: string[] }
> = {
  's2-leader-plan': { ids: ['leader'] },
  's4-leader-assess': { ids: ['leader'] },
  's5-reconciler': { ids: ['reconciler'] },
  's6-analyst': { ids: ['analyst'], prefixes: ['analyst.'] },
  's7-writer-outline': { ids: ['outline-planner'] },
  's8-writer-draft': { prefixes: ['writer#', 'writer.'], ids: ['writer'] },
  's8b-quality-enhancement': { ids: ['writer'], prefixes: ['writer#'] },
  's9-critic-l4': { ids: ['critic', 'mission-critic'], prefixes: ['critic.'] },
  's9b-objective-evaluation': {
    ids: ['critic', 'evaluator'],
    prefixes: ['critic.', 'evaluator.'],
  },
  's10-leader-signoff': { ids: ['leader'] },
};

const SHARED_LEADER_STAGES = [
  's2-leader-plan',
  's4-leader-assess',
  's10-leader-signoff',
] as const;

type TraceKind = 'thought' | 'action' | 'observation' | 'reflection' | 'error';

function readTraceKind(type: string): TraceKind | null {
  if (type.endsWith('agent:thought')) return 'thought';
  if (type.endsWith('agent:action')) return 'action';
  if (type.endsWith('agent:observation')) return 'observation';
  if (type.endsWith('agent:reflection')) return 'reflection';
  if (type.endsWith('agent:error')) return 'error';
  return null;
}

function matchStageForAgent(agentId: string): string | null {
  for (const [stageId, hint] of Object.entries(STAGE_AGENT_PATTERN)) {
    if (hint.ids?.includes(agentId)) return stageId;
    if (hint.prefixes?.some((p) => agentId.startsWith(p))) return stageId;
  }
  return null;
}

/**
 * Pure merge function — exported for unit-test, hook below memoizes it.
 *
 * 输入：targetStageId, events (live stream), canonical trace (来自 view).
 * 输出：merged trace（canonical + 增量 reactTrace）.
 * 当 canonical 不存在 OR 没有 events → 原样返回 canonical（或 undefined）.
 */
export function mergeStageProcessTrace(
  targetStageId: string | undefined,
  events: ReadonlyArray<StageProcessTraceEventLike>,
  canonical: StageProcessTrace | undefined
): StageProcessTrace | undefined {
  {
    if (!targetStageId) return canonical;
    if (!events.length) return canonical;

    const localTrace: NonNullable<StageProcessTrace['reactTrace']> = [];
    let localTotalTokens = 0;
    let localTotalDurationMs = 0;
    let localStepCount = 0;
    let leaderClaimed: string | null = null;

    for (const ev of events) {
      const kind = readTraceKind(ev.type);
      if (!kind) continue;
      const payload = (ev.payload ?? {}) as Record<string, unknown>;
      const agentId =
        (typeof payload.agentId === 'string' ? payload.agentId : undefined) ??
        ev.agentId;
      if (!agentId) continue;
      let stageId = matchStageForAgent(agentId);
      if (!stageId) continue;
      // leader first-stage-wins（与 backend stage-view.projector 一致）
      if (agentId === 'leader') {
        if (leaderClaimed === null) leaderClaimed = SHARED_LEADER_STAGES[0];
        stageId = leaderClaimed;
      }
      if (stageId !== targetStageId) continue;

      const ts =
        typeof payload.originalTs === 'number'
          ? payload.originalTs
          : ev.timestamp;
      const text = typeof payload.text === 'string' ? payload.text : undefined;
      const toolId =
        typeof payload.toolId === 'string' ? payload.toolId : undefined;
      const output =
        typeof payload.output === 'string' ? payload.output : undefined;
      const latencyMs =
        typeof payload.latencyMs === 'number' ? payload.latencyMs : undefined;
      const tokensUsed =
        typeof payload.tokensUsed === 'number' ? payload.tokensUsed : undefined;
      const error =
        typeof payload.error === 'string' ? payload.error : undefined;
      const verdict =
        typeof payload.verdict === 'string' ? payload.verdict : undefined;
      const message =
        typeof payload.message === 'string' ? payload.message : undefined;

      const item: NonNullable<StageProcessTrace['reactTrace']>[number] = {
        kind,
        ts,
      };
      if (kind === 'thought') {
        item.text = text;
        const tokenCount =
          typeof payload.tokenCount === 'number'
            ? payload.tokenCount
            : undefined;
        if (tokenCount != null) localTotalTokens += tokenCount;
        localStepCount += 1;
      } else if (kind === 'action') {
        item.toolId = toolId;
        localStepCount += 1;
      } else if (kind === 'observation') {
        item.toolId = toolId;
        item.output = output;
        item.latencyMs = latencyMs;
        item.tokensUsed = tokensUsed;
        item.error = error;
        if (latencyMs != null) localTotalDurationMs += latencyMs;
        if (tokensUsed != null) localTotalTokens += tokensUsed;
      } else if (kind === 'reflection') {
        item.text = text ?? verdict;
      } else if (kind === 'error') {
        item.error = error ?? message;
      }
      localTrace.push(item);
    }

    if (localTrace.length === 0 && !canonical) return undefined;

    // 合并 canonical + local；dedup by (kind|ts|toolId) 防 view refetch 来后双倍。
    const merged: NonNullable<StageProcessTrace['reactTrace']> = [];
    const seen = new Set<string>();
    const key = (i: NonNullable<StageProcessTrace['reactTrace']>[number]) =>
      `${i.kind}|${i.ts}|${i.toolId ?? ''}`;
    for (const src of [
      canonical?.reactTrace ?? [],
      localTrace,
    ] as ReadonlyArray<NonNullable<StageProcessTrace['reactTrace']>>) {
      for (const item of src) {
        const k = key(item);
        if (seen.has(k)) continue;
        seen.add(k);
        merged.push(item);
      }
    }
    merged.sort((a, b) => a.ts - b.ts);

    const result: StageProcessTrace = {
      ...canonical,
      reactTrace: merged.length > 0 ? merged : canonical?.reactTrace,
      stepCount: Math.max(canonical?.stepCount ?? 0, merged.length),
      totalTokens: Math.max(canonical?.totalTokens ?? 0, localTotalTokens),
      totalDurationMs: Math.max(
        canonical?.totalDurationMs ?? 0,
        localTotalDurationMs
      ),
    };
    return result;
  }
}

/**
 * Hook wrapper around pure `mergeStageProcessTrace` — useMemo by inputs.
 */
export function useStageProcessTrace(
  targetStageId: string | undefined,
  events: ReadonlyArray<StageProcessTraceEventLike>,
  canonical: StageProcessTrace | undefined
): StageProcessTrace | undefined {
  return useMemo(
    () => mergeStageProcessTrace(targetStageId, events, canonical),
    [targetStageId, events, canonical]
  );
}
