'use client';

/**
 * useWritingDerivedView — Writing mission canonical view + events 双路派生 hook
 *
 * 仿 useMissionLegacyView，但面向 writing 领域事件类型。
 *
 * 双路原则（design doc §2）：
 *   - canonical view（WritingMissionViewEnvelope）提供 truth
 *   - raw events（WritingEvent[]）提供 immediacy + liveness（WS 退化 polling 后仍有增量）
 *   - 每字段"canonical 优先 + events 派生兜底"，避免 live-WS refreshHints 依赖
 *
 * 输出：
 *   - missionView   — MissionView（canonical，用于 MissionDetailFrame）
 *   - stageViews    — StageView[]（用于 StageStepper）
 *   - agentViews    — AgentView[]（用于 RoleCard）
 *   - costByStage   — per-stage token/cost（从 writing.cost:tick 事件派生）
 *   - isTerminal    — mission 是否已终态（停 polling / 停 WS 重连）
 *
 * ★ 事件 topic 对齐（backend writing.events.ts 精确字面量，含 writing. 前缀）：
 *   agent lifecycle:  "writing.agent:lifecycle"
 *   agent thought:    "writing.agent:thought"
 *   agent action:     "writing.agent:action"
 *   agent observation:"writing.agent:observation"
 *   agent reflection: "writing.agent:reflection"
 *   agent error:      "writing.agent:error"
 *   cost tick:        "writing.cost:tick"
 *   mission started:  "writing.mission:started"
 *   mission completed:"writing.mission:completed"
 *   mission failed:   "writing.mission:failed"
 *   mission cancelled:"writing.mission:cancelled"
 *   stage lifecycle:  "writing.stage:lifecycle"
 *
 * 注意：type.endsWith(':lifecycle') 等模式以 COLON 为分隔符（backend harness 标准）。
 */

import { useMemo } from 'react';
import {
  deriveMissionView,
  isMissionTerminal,
  deriveStageView,
  deriveAgentView,
  type MissionView,
  type StageView,
  type AgentView,
  type MissionDeriveInput,
  type StageDeriveInput,
  type AgentDeriveInput,
} from '@/lib/missions/derive';
import type { WritingMissionViewEnvelope } from '@/services/ai-writing/api';
import type { WritingEvent } from './useWritingStream';

/** per-stage cost 聚合（从 writing.cost:tick 事件派生） */
export interface WritingStageCost {
  stage: string;
  tokensUsed: number;
  costUsd: number;
}

export interface WritingDerivedView {
  missionView: MissionView | null;
  stageViews: StageView[];
  agentViews: AgentView[];
  costByStage: WritingStageCost[];
  /** 总 token / cost（canonical 优先，events 兜底） */
  totalTokens: number;
  totalCostUsd: number;
  isTerminal: boolean;
}

/**
 * 接 (missionView, events) 双路输入，返回 canonical + immediacy 合并的派生视图。
 *
 * useMemo 依赖 missionView + events 引用；events 数组随 WS 事件到来而更新，
 * 派生会随之重算（O(n) events 扫描，n 由 useMissionStream MAX_EVENTS=5000 上限）。
 */
export function useWritingDerivedView(
  missionView: WritingMissionViewEnvelope | null | undefined,
  events: WritingEvent[]
): WritingDerivedView {
  return useMemo(
    () => buildWritingDerivedView(missionView, events),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [missionView, events]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal builder（纯函数，可单测）
// ─────────────────────────────────────────────────────────────────────────────

function buildWritingDerivedView(
  envelope: WritingMissionViewEnvelope | null | undefined,
  events: WritingEvent[]
): WritingDerivedView {
  const { totalTokens, totalCostUsd, costByStage } = deriveCost(
    envelope,
    events
  );
  const agentViews = deriveAgents(envelope, events);
  const stageViews = deriveStages(envelope, events);
  const missionView = deriveMission(envelope, events);
  const isTerminal = missionView != null && isMissionTerminal(missionView);

  return {
    missionView,
    stageViews,
    agentViews,
    costByStage,
    totalTokens,
    totalCostUsd,
    isTerminal,
  };
}

// ─── Mission ─────────────────────────────────────────────────────────────────

function deriveMission(
  envelope: WritingMissionViewEnvelope | null | undefined,
  events: WritingEvent[]
): MissionView | null {
  if (!envelope) {
    // events 兜底：从 writing.mission:* 派生最小 MissionView
    return deriveMissionFromEvents(events);
  }

  const input: MissionDeriveInput = {
    missionId: envelope.missionId,
    status: envelope.status,
    // WritingMissionViewEnvelope 不含时间戳字段——以 events 兜底补充
    ...extractMissionTimesFromEvents(events),
  };
  return deriveMissionView(input);
}

function deriveMissionFromEvents(events: WritingEvent[]): MissionView | null {
  let missionId: string | undefined;
  let status: string | undefined;
  const times = extractMissionTimesFromEvents(events);

  for (const ev of events) {
    if (!ev?.type) continue;
    const p = ev.payload as Record<string, unknown> | undefined;
    if (!p) continue;
    if (typeof p.missionId === 'string') missionId = p.missionId;
    if (ev.type === 'writing.mission:started') status = 'running';
    else if (ev.type === 'writing.mission:completed') status = 'completed';
    else if (ev.type === 'writing.mission:failed') status = 'failed';
    else if (ev.type === 'writing.mission:cancelled') status = 'cancelled';
    else if (ev.type === 'writing.mission:aborted') status = 'cancelled';
  }

  if (!missionId) return null;
  return deriveMissionView({ missionId, status, ...times });
}

function extractMissionTimesFromEvents(
  events: WritingEvent[]
): Pick<
  MissionDeriveInput,
  'startedAt' | 'completedAt' | 'failedAt' | 'cancelledAt'
> {
  let startedAt: number | undefined;
  let completedAt: number | undefined;
  let failedAt: number | undefined;
  let cancelledAt: number | undefined;

  for (const ev of events) {
    if (!ev?.type) continue;
    if (ev.type === 'writing.mission:started') startedAt ??= ev.timestamp;
    else if (ev.type === 'writing.mission:completed')
      completedAt ??= ev.timestamp;
    else if (ev.type === 'writing.mission:failed') failedAt ??= ev.timestamp;
    else if (
      ev.type === 'writing.mission:cancelled' ||
      ev.type === 'writing.mission:aborted'
    ) {
      cancelledAt ??= ev.timestamp;
    }
  }
  return { startedAt, completedAt, failedAt, cancelledAt };
}

// ─── Stages ──────────────────────────────────────────────────────────────────

/**
 * Writing 的 stage 状态来自 writing.stage:lifecycle 事件。
 * H3 fix：后端 StagLifecycleSchema 实际 payload 是
 *   { stage, stepId, primitive?, status: 'started'|'completed'|'failed', ... }
 * 之前误读 payload.stageId / payload.phase（这两个字段根本不存在）→ 每条事件
 * 都被丢弃 → stageViews 永远为空，进度面板从来不渲染。改读 stage / status。
 *
 * canonical view 当前不含 stages 列表（WritingMissionViewEnvelope 未暴露），
 * 直接从 events 派生。
 */
export function deriveStages(
  _envelope: WritingMissionViewEnvelope | null | undefined,
  events: WritingEvent[]
): StageView[] {
  const stageMap = new Map<string, string>(); // stage → status string

  for (const ev of events) {
    if (!ev?.type) continue;
    if (ev.type !== 'writing.stage:lifecycle') continue;
    const p = ev.payload as Record<string, unknown> | undefined;
    if (!p) continue;
    const stageId = typeof p.stage === 'string' ? p.stage : undefined;
    const phase = typeof p.status === 'string' ? p.status : undefined;
    if (!stageId || !phase) continue;
    // phase: 'started' → 'running', 'completed' → 'done', 'failed' → 'failed'
    const current = stageMap.get(stageId);
    const mapped = mapStagePhase(phase);
    // 防状态回退：rank 更高的状态胜出
    if (
      !current ||
      STAGE_STATUS_RANK[mapped] > (STAGE_STATUS_RANK[current] ?? 0)
    ) {
      stageMap.set(stageId, mapped);
    }
  }

  if (stageMap.size === 0) return [];

  const inputs: StageDeriveInput[] = [...stageMap.entries()].map(
    ([id, status]) => ({
      id,
      short: id,
      status,
    })
  );
  return deriveStageView(inputs);
}

const STAGE_STATUS_RANK: Record<string, number> = {
  pending: 0,
  running: 1,
  done: 3,
  failed: 3,
  skipped: 3,
};

function mapStagePhase(phase: string): string {
  if (phase === 'started') return 'running';
  if (phase === 'completed') return 'done';
  if (phase === 'failed') return 'failed';
  if (phase === 'skipped') return 'skipped';
  return 'pending';
}

// ─── Agents ──────────────────────────────────────────────────────────────────

/**
 * 从 writing.agent:lifecycle 事件构建 agent 状态。
 * payload schema（AgentLifecycleSchema）：{ agentId, role, phase: 'started'|'completed'|'failed', modelId?, ... }
 *
 * 同时读 writing.agent:thought / action / observation / reflection / error 的 agentId，
 * 保证任何 trace 事件都能触发 agent 出现（phase fallback 为 running）。
 */
function deriveAgents(
  _envelope: WritingMissionViewEnvelope | null | undefined,
  events: WritingEvent[]
): AgentView[] {
  // agentId → AgentDeriveInput（可变 draft）
  const agentMap = new Map<string, AgentDeriveInput>();

  const getOrCreate = (agentId: string, role?: string): AgentDeriveInput => {
    const existing = agentMap.get(agentId);
    if (existing) return existing;
    const draft: AgentDeriveInput = {
      agentId,
      role: role ?? agentId,
      phase: 'pending',
    };
    agentMap.set(agentId, draft);
    return draft;
  };

  for (const ev of events) {
    if (!ev?.type) continue;
    const p = ev.payload as Record<string, unknown> | undefined;
    if (!p) continue;
    const agentId =
      (typeof p.agentId === 'string' ? p.agentId : undefined) ?? ev.agentId;
    if (!agentId) continue;

    if (ev.type === 'writing.agent:lifecycle') {
      const role = typeof p.role === 'string' ? p.role : undefined;
      const phase = typeof p.phase === 'string' ? p.phase : undefined;
      const draft = getOrCreate(agentId, role);
      if (role) draft.role = role;
      if (typeof p.modelId === 'string') draft.modelId = p.modelId;
      if (typeof p.dimension === 'string') draft.dimension = p.dimension;
      if (typeof p.wallTimeMs === 'number') draft.wallTimeMs = p.wallTimeMs;
      if (phase === 'started' && draft.phase === 'pending') {
        draft.phase = 'running';
      } else if (phase === 'completed') {
        draft.phase = 'completed';
        if (!draft.wallTimeMs && typeof p.wallTimeMs === 'number') {
          draft.wallTimeMs = p.wallTimeMs;
        }
      } else if (phase === 'failed') {
        draft.phase = 'failed';
        const msg = p.error ?? p.message;
        if (typeof msg === 'string') draft.failureMessage = msg;
      }
      continue;
    }

    // trace 事件（thought/action/observation/reflection/error）：确保 agent 存在 + 至少 running
    if (
      ev.type === 'writing.agent:thought' ||
      ev.type === 'writing.agent:action' ||
      ev.type === 'writing.agent:observation' ||
      ev.type === 'writing.agent:reflection' ||
      ev.type === 'writing.agent:error'
    ) {
      const draft = getOrCreate(agentId);
      if (draft.phase === 'pending') draft.phase = 'running';
      if (typeof p.modelId === 'string' && !draft.modelId) {
        draft.modelId = p.modelId;
      }
    }
  }

  if (agentMap.size === 0) return [];
  return deriveAgentView([...agentMap.values()]);
}

// ─── Cost ─────────────────────────────────────────────────────────────────────

function deriveCost(
  _envelope: WritingMissionViewEnvelope | null | undefined,
  events: WritingEvent[]
): {
  totalTokens: number;
  totalCostUsd: number;
  costByStage: WritingStageCost[];
} {
  const byStageMap = new Map<string, { tokensUsed: number; costUsd: number }>();
  let summedTokens = 0;
  let summedCost = 0;

  for (const ev of events) {
    if (!ev?.type) continue;
    // writing.cost:tick
    if (ev.type !== 'writing.cost:tick') continue;
    const p = ev.payload as Record<string, unknown> | undefined;
    if (!p) continue;
    const stage = typeof p.stage === 'string' ? p.stage : undefined;
    const dTok = typeof p.deltaTokens === 'number' ? p.deltaTokens : 0;
    const dCost = typeof p.deltaCostUsd === 'number' ? p.deltaCostUsd : 0;
    summedTokens += Math.max(0, dTok);
    summedCost += Math.max(0, dCost);
    if (stage && (dTok > 0 || dCost > 0)) {
      const prev = byStageMap.get(stage) ?? { tokensUsed: 0, costUsd: 0 };
      byStageMap.set(stage, {
        tokensUsed: prev.tokensUsed + dTok,
        costUsd: prev.costUsd + dCost,
      });
    }
  }

  const costByStage: WritingStageCost[] = [...byStageMap.entries()].map(
    ([stage, v]) => ({ stage, tokensUsed: v.tokensUsed, costUsd: v.costUsd })
  );

  return { totalTokens: summedTokens, totalCostUsd: summedCost, costByStage };
}
