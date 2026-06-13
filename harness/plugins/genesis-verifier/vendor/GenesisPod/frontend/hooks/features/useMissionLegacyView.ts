/**
 * useMissionLegacyView.ts — canonical view -> frontend legacy DerivedView shape adapter
 *
 * 落地依据：thinning plan §B5-2 / §3.4 / §7.2
 *
 * 2026-05-26 收口：原 lib/features/agent-playground/view-to-derived.shim.ts 删除后
 * 这层适配从 page.tsx 抽出为独立 hook，与 useMissionDetailView 配套使用。
 * 命名含 "Legacy" 显式提示这是过渡 adapter；component-level cutover 完成
 * （ArtifactReader / TodoDetailDrawer / MissionTodoBoard 等改吃 canonical view）后此 hook 即可退役。
 *
 * canonical view -> DerivedView 形状适配规则：
 *   - mission.status -> legacy completedAt / failedAt / cancelledAt / rejectedAt (由 finishedAt 派生)
 *   - 14 backend canonical stage -> 5 frontend StageId (STAGE_STEPS 聚合)
 *   - agents trace 由 raw events 解析（§7.2 raw event timeline display 合规）
 *   - verdicts / memoryIndex / dimensionPipelines 优先 canonical view，缺则 events 派生
 *   - reportArtifact (ReportArtifactV2 | EmptyArtifactSentinel) -> ReportDraft 形状
 */

import { useMemo } from 'react';
import type { MissionDetailView } from '@/services/agent-playground/api';
import type { PlaygroundEvent } from '@/hooks/features/useAgentPlaygroundStream';
import {
  STAGE_STEPS,
  aggregateStageStatus,
  type AgentLiveState,
  type AgentPhase,
  type AgentRole,
  type AgentTraceItem,
  type CostState,
  type DerivedView,
  type MemoryIndexState,
  type MissionState,
  type ReportDraft,
  type StageId,
  type StageState,
  type StageStatus,
  type StepStatus,
  type VerifierVerdict,
  type DimensionPipelineState,
  type ChapterState,
} from '@/lib/features/agent-playground/mission-presentation.types';

const DV_STAGE_ORDER: StageId[] = [
  'leader',
  'researchers',
  'analyst',
  'writer',
  'reviewer',
];

const DV_KNOWN_AGENT_ROLES = new Set<AgentRole>([
  'leader',
  'researcher',
  'analyst',
  'writer',
  'reviewer',
]);

export function useMissionLegacyView(
  missionView: MissionDetailView | null | undefined,
  events: PlaygroundEvent[]
): DerivedView {
  return useMemo(
    () => buildLegacyDerivedView(missionView, events),
    [missionView, events]
  );
}

function buildLegacyDerivedView(
  view: MissionDetailView | null | undefined,
  events: PlaygroundEvent[]
): DerivedView {
  if (!view) return dvZeroView();
  return {
    mission: dvProjectMission(view),
    stages: dvProjectStages(view),
    agents: dvProjectAgents(view, events),
    cost: dvProjectCost(view, events),
    verdicts: dvProjectVerdicts(view, events),
    memory: dvProjectMemory(view, events),
    reports: dvProjectReports(view),
    finalReport: dvProjectFinalReport(view),
    dimensionPipelines: dvProjectDimensionPipelines(view, events),
  };
}

function dvProjectMission(view: MissionDetailView): MissionState {
  const m = view.mission;
  const startedAt = m.startedAt ? Date.parse(m.startedAt) : undefined;
  const finishedAt = m.finishedAt ? Date.parse(m.finishedAt) : undefined;
  const out: MissionState = {
    startedAt,
    topic: m.topic ?? m.title,
    depth: m.depth,
    language: m.language,
    themeSummary: m.themeSummary,
    dimensions: m.dimensions?.map((d) => ({
      id: d.id,
      name: d.name,
      rationale: d.rationale ?? '',
    })),
    finalScore: m.finalScore,
    maxCredits: m.maxCredits,
    wallTimeMs: m.wallTimeMs,
    status: m.status,
  };
  if (m.status === 'completed') {
    out.completedAt = finishedAt;
  } else if (m.status === 'failed') {
    out.failedAt = finishedAt;
    out.failedMessage = m.failureMessage;
  } else if (m.status === 'cancelled') {
    out.cancelledAt = finishedAt;
  } else if (m.status === 'quality-failed') {
    out.rejectedAt = finishedAt;
    out.rejectedReason = m.failureCode ?? undefined;
    out.rejectedMessage = m.failureMessage;
  }
  return out;
}

function dvProjectStages(view: MissionDetailView): StageState[] {
  const stepStates = new Map<string, StepStatus>();
  const startedAtByStage = new Map<StageId, number>();
  const endedAtByStage = new Map<StageId, number>();
  const attemptsByStage = new Map<StageId, number>();
  // ★ 2026-05-27 Screenshot_35 修复：mission 已终态 (completed / quality-failed
  //   / failed / cancelled) 仍残留个别 stage.status === 'running' 时，DAG 节点
  //   popup 会显示"运行中"。前端做 terminal sweep，让 status 与 mission 终态一致。
  // ★ 2026-05-27 强化 (Screenshot 66-69): 不只看 status 字段, 还看时间戳 — 后端
  //   有时把 completedAt/failedAt/cancelledAt 写完了 status 字段还没更新到 row
  //   (race window). 任何一个终态时间戳被设置, 都视为该方向的终态。
  const missionStatus = view.mission.status;
  const m = view.mission;
  const hasCompletedAt = !!(m as { completedAt?: string }).completedAt;
  const hasFailedAt = !!(m as { failedAt?: string }).failedAt;
  const hasCancelledAt = !!(m as { cancelledAt?: string }).cancelledAt;
  // canonical status 字段只暴露 starting/running/completed/quality-failed 四值;
  //   failure/cancel 通过 failedAt/cancelledAt 时间戳表达 (类型设计).
  const isTerminalSuccess =
    missionStatus === 'completed' ||
    missionStatus === 'quality-failed' ||
    hasCompletedAt;
  const isTerminalFailure = hasFailedAt || hasCancelledAt;
  for (const s of view.stages) {
    let effectiveStatus = s.status;
    if (effectiveStatus === 'running') {
      if (isTerminalSuccess) effectiveStatus = 'done';
      else if (isTerminalFailure) effectiveStatus = 'failed';
    }
    stepStates.set(s.id, dvMapBackendStageStatusToStep(effectiveStatus));
    const stageId = dvCanonicalStageToFrontendStage(s.id);
    if (!stageId) continue;
    const startedTs = s.startedAt ? Date.parse(s.startedAt) : undefined;
    const endedTs = s.endedAt ? Date.parse(s.endedAt) : undefined;
    if (startedTs != null) {
      const existing = startedAtByStage.get(stageId);
      if (existing == null || startedTs < existing) {
        startedAtByStage.set(stageId, startedTs);
      }
    }
    if (endedTs != null) {
      const existing = endedAtByStage.get(stageId);
      if (existing == null || endedTs > existing) {
        endedAtByStage.set(stageId, endedTs);
      }
    }
    if (s.attempts != null && s.attempts > 0) {
      const existing = attemptsByStage.get(stageId) ?? 0;
      attemptsByStage.set(stageId, Math.max(existing, s.attempts));
    }
  }
  return DV_STAGE_ORDER.map((stageId): StageState => {
    const status = aggregateStageStatus(stageId, stepStates);
    return {
      id: stageId,
      status,
      startedAt: startedAtByStage.get(stageId),
      endedAt: endedAtByStage.get(stageId),
      attempts: attemptsByStage.get(stageId),
    };
  });
}

function dvProjectAgents(
  view: MissionDetailView,
  events: PlaygroundEvent[]
): AgentLiveState[] {
  const traceByAgent = dvCollectAgentTraces(events);
  const out =
    view.agents.length === 0
      ? dvCollectAgentSummary(events, traceByAgent)
      : view.agents
          .filter((a) => DV_KNOWN_AGENT_ROLES.has(a.role as AgentRole))
          .map(
            (a): AgentLiveState => ({
              agentId: a.id,
              role: a.role as AgentRole,
              phase: a.phase as AgentPhase,
              modelId: a.modelId,
              retryCount: a.retryCount,
              failureMessage: a.failureMessage,
              // ★ 2026-05-27 (Screenshot_19)：透传 ComputeUsagePanel 需要的 4 字段
              attempt: (a as { attempt?: number }).attempt,
              dimension: (a as { dimension?: string }).dimension,
              iterations: (a as { iterations?: number }).iterations,
              wallTimeMs: (a as { wallTimeMs?: number }).wallTimeMs,
              startedAt: (a as { startedAt?: number }).startedAt,
              endedAt: (a as { endedAt?: number }).endedAt,
              trace: traceByAgent.get(a.id) ?? [],
              // ★ 2026-05-29: backend agent-view.projector 现已暴露 per-agent
              //   tokensUsed / costUsd / toolCallCount（各 agent 终态事件携带 RunResult
              //   用量）。优先用 canonical 值；缺失时回退 trace 派生（#109 老路径，
              //   覆盖 buffer evict / 旧 mission 无新字段的情况）。
              ...(() => {
                const traceMetrics = computeAgentTraceMetrics(
                  traceByAgent.get(a.id) ?? []
                );
                const ca = a as {
                  tokensUsed?: number;
                  costUsd?: number;
                  toolCallCount?: number;
                };
                return {
                  tokensUsed: ca.tokensUsed ?? traceMetrics.tokensUsed,
                  toolCallCount: ca.toolCallCount ?? traceMetrics.toolCallCount,
                  costUsd: ca.costUsd,
                };
              })(),
            })
          );

  // ★ 2026-05-27 (Screenshot_17 状态一致 mirror)：mission 已终态时，前端 fallback
  //   path 也 sweep 滞留 running/pending 的 agent，与 backend agent-view.projector
  //   行为对齐。让 view.agents 空（live mission 后 buffer evict）走 events 派生
  //   的路径也不会显示 "23 个 Agent 正在工作"假象。
  // ★ 2026-05-27 强化 (Screenshot 66-69 Leader/Writer 仍"运行中"): 同步 dvProjectStages
  //   的强化逻辑 — 不只 status 字段, 还看时间戳。
  const status = view.mission?.status;
  const m = view.mission;
  const hasCompletedAt = !!(m as { completedAt?: string } | undefined)
    ?.completedAt;
  const hasFailedAt = !!(m as { failedAt?: string } | undefined)?.failedAt;
  const hasCancelledAt = !!(m as { cancelledAt?: string } | undefined)
    ?.cancelledAt;
  const isTerminalSuccess =
    status === 'completed' || status === 'quality-failed' || hasCompletedAt;
  const isTerminalFailure = hasFailedAt || hasCancelledAt;
  const isTerminal = isTerminalSuccess || isTerminalFailure;
  if (isTerminal) {
    for (const a of out) {
      if (a.phase === 'running' || a.phase === 'pending') {
        a.phase = isTerminalSuccess ? 'completed' : 'failed';
      }
    }
  }
  return out;
}

/**
 * ★ 2026-05-27 (#109): 从 trace 派生 per-agent tokens / 工具调用次数, 给
 *   ComputeUsagePanel AgentInstanceTable 用。backend canonical view 暂未在
 *   agent 字段上暴露这些计数, 先在前端聚合。
 */
function computeAgentTraceMetrics(trace: AgentTraceItem[]): {
  tokensUsed?: number;
  toolCallCount?: number;
} {
  if (!trace || trace.length === 0) return {};
  let tokens = 0;
  let actionCount = 0;
  for (const t of trace) {
    if (typeof t.tokensUsed === 'number') tokens += t.tokensUsed;
    if (t.kind === 'action') actionCount += 1;
  }
  return {
    tokensUsed: tokens > 0 ? tokens : undefined,
    toolCallCount: actionCount > 0 ? actionCount : undefined,
  };
}

function dvProjectCost(
  view: MissionDetailView,
  events: PlaygroundEvent[]
): CostState {
  const c = view.cost;
  // ★ 2026-05-27 (回归恢复)：baseline 15d2e93ab 从 cost:tick 事件 deltaTokens /
  //   deltaCostUsd 按 stage 聚合 byStage。thinning shim 直接给 [] → ComputeUsagePanel /
  //   CostBreakdownPanel 永远显示空。这里从 events 派生回来。
  const byStageMap = new Map<string, { tokensUsed: number; costUsd: number }>();
  let summedTokens = 0;
  let summedCost = 0;
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    const e = ev as { type?: string; payload?: Record<string, unknown> };
    if (!e.type) continue;
    if (e.type.endsWith('cost:tick') || e.type === 'cost:tick') {
      const p = e.payload ?? {};
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
  }
  return {
    tokensUsed: c?.tokensUsed != null ? Number(c.tokensUsed) : summedTokens,
    costUsd: c?.costUsd ?? summedCost,
    byStage: Array.from(byStageMap.entries()).map(([stage, v]) => ({
      stage,
      tokensUsed: v.tokensUsed,
      costUsd: v.costUsd,
    })),
  };
}

function dvProjectReports(view: MissionDetailView): ReportDraft[] {
  const artifact = view.reportArtifact;
  if (!artifact || typeof artifact !== 'object') return [];
  const a = artifact as Record<string, unknown>;
  if (a.kind === 'empty-artifact') return [];
  const metadata = a.metadata as { topic?: string } | undefined;
  const sections = (a.sections as unknown[]) ?? [];
  const citations = (a.citations as { url?: string }[]) ?? [];
  return [
    {
      attempt: 1,
      report: {
        title: metadata?.topic,
        summary: undefined,
        sections: sections
          .filter(
            (s): s is { title?: string; anchor?: string } =>
              s != null && typeof s === 'object'
          )
          .map((s) => ({
            heading: s.title ?? '',
            body: '',
            sources: [],
          })),
        conclusion: undefined,
        citations: citations.map((c) => c.url ?? '').filter(Boolean),
      },
    },
  ];
}

function dvProjectFinalReport(
  view: MissionDetailView
): ReportDraft['report'] | null {
  const reports = dvProjectReports(view);
  return reports.length > 0 ? reports[0].report : null;
}

function dvProjectVerdicts(
  view: MissionDetailView,
  events: PlaygroundEvent[]
): VerifierVerdict[] {
  const v = view.verdicts;
  if (Array.isArray(v) && v.length > 0) return v;
  return dvDeriveVerdictsFromEvents(events);
}

function dvProjectMemory(
  view: MissionDetailView,
  events: PlaygroundEvent[]
): MemoryIndexState | null {
  const mi = view.memoryIndex;
  if (mi) return mi;
  return dvDeriveMemoryFromEvents(events);
}

function dvProjectDimensionPipelines(
  view: MissionDetailView,
  events: PlaygroundEvent[]
): Map<string, DimensionPipelineState> {
  // ★ 2026-05-29 根因修复（"采集完成后列表永远不刷新 / 永远停在采集完成"）：
  //   原实现 dimensionPipelines 是本文件里唯一没有 events 派生兜底的字段 —— 100%
  //   依赖 canonical view (useMissionDetailView)。canonical view 只在 stream 事件
  //   携带 refreshHints 时 refetch，而 refreshHints 只由 live WS dispatcher 注入，
  //   replay/polling 的持久化事件不带 hint。WS 一断进 polling（Railway 每次 push
  //   重启杀 WS / 长 mission / 自定义域名代理 socket.io 困难）→ canonical 永不 refetch
  //   → dimensionPipelines 冻结在采集阶段快照 (chapters:[]) → 维度卡片 deriveDimSubStatus
  //   看到 chapters.length===0 → 永远「采集完成」。后台其实早写完章节（事件全在 DB）。
  //   thinning 重构（2026-05）把 cost/verdicts/memory/agents/trace 的 events 派生
  //   全砍了，5-27 逐一"回归恢复"，唯独漏了 dimensionPipelines —— 这就是本回归。
  //   修法：与同文件其它字段一致，从 events 派生（移植 backend extractDimensionPipelines
  //   的完整章节状态机），再与 canonical 做 per-dimension 合并（章节多/有 grade 的胜出），
  //   让 events（WS+polling 都会持续增长）驱动列表推进，摆脱对 live-WS refreshHints 的依赖。
  const dimNames = (view.mission.dimensions ?? [])
    .map((d) => d.name)
    .filter((n): n is string => typeof n === 'string' && n.length > 0);
  const fromEvents = dvDeriveDimensionPipelinesFromEvents(events, dimNames);

  const canonical = view.dimensionPipelines as
    | Record<string, DimensionPipelineState>
    | undefined;
  const canonicalEntries = canonical ? Object.entries(canonical) : [];

  // per-dimension merge：events 与 canonical 各自可能更新（WS 退化时 events 靠
  //   replay/polling，未必比 canonical 新；canonical refetch 后也未必比 events 新）。
  //   按 chapter index + 状态推进度逐章合并，谁的状态更靠后用谁，绝不让任一侧回退。
  const merged = new Map<string, DimensionPipelineState>(fromEvents);
  for (const [key, canonPipe] of canonicalEntries) {
    const evPipe = merged.get(key);
    if (!evPipe) {
      merged.set(key, canonPipe);
      continue;
    }
    merged.set(key, {
      dimension: evPipe.dimension || canonPipe.dimension,
      chapters: dvMergeChapters(evPipe.chapters, canonPipe.chapters),
      totalWordCount: evPipe.totalWordCount ?? canonPipe.totalWordCount,
      integrationDegraded:
        evPipe.integrationDegraded || canonPipe.integrationDegraded,
      grade: evPipe.grade ?? canonPipe.grade,
    });
  }

  // ★ 2026-05-27 (Screenshot_80 续 — "各个状态都要遍历"): mission 终态时也扫荡
  //   chapter.status, 让 dim pipeline / 章节进度 / Mission DAG 节点状态与 mission
  //   "已完成" pill 一致。残留 writing/reviewing/revising/pending 在终态下要 promote。
  const m = view.mission;
  const hasCompletedAt = !!(m as { completedAt?: string }).completedAt;
  const hasFailedAt = !!(m as { failedAt?: string }).failedAt;
  const hasCancelledAt = !!(m as { cancelledAt?: string }).cancelledAt;
  const isTerminalSuccess =
    m.status === 'completed' || m.status === 'quality-failed' || hasCompletedAt;
  const isTerminalFailure = hasFailedAt || hasCancelledAt;
  const isTerminal = isTerminalSuccess || isTerminalFailure;
  if (!isTerminal) return merged;
  const sweepChStatus = (s: ChapterState['status']): ChapterState['status'] => {
    if (s === 'done' || s === 'passed') return s;
    if (s === 'failed' || s === 'failed-finalized') return s;
    return isTerminalSuccess ? 'done' : 'failed-finalized';
  };
  const out = new Map<string, DimensionPipelineState>();
  for (const [key, pipeline] of merged) {
    out.set(key, {
      ...pipeline,
      chapters: pipeline.chapters.map((c) => ({
        ...c,
        status: sweepChStatus(c.status),
      })),
    });
  }
  return out;
}

/**
 * 章节状态推进度排名（越大越靠后）。终态(done/passed/failed*)高于进行中，
 * 进行中按 writing→reviewing→revising 时间序。逐章合并时取排名更高的一方，
 * 避免 events / canonical 任一侧把已推进的章节状态回退。
 */
const DV_CH_STATUS_RANK: Record<ChapterState['status'], number> = {
  pending: 1,
  writing: 2,
  reviewing: 3,
  revising: 4,
  passed: 5,
  failed: 5,
  'failed-finalized': 5,
  done: 6,
};

function dvMergeChapters(a: ChapterState[], b: ChapterState[]): ChapterState[] {
  const byIndex = new Map<number, ChapterState>();
  const consider = (c: ChapterState) => {
    const existing = byIndex.get(c.index);
    if (!existing) {
      byIndex.set(c.index, { ...c });
      return;
    }
    const winner =
      DV_CH_STATUS_RANK[c.status] >= DV_CH_STATUS_RANK[existing.status]
        ? c
        : existing;
    const loser = winner === c ? existing : c;
    byIndex.set(c.index, {
      ...loser,
      ...winner, // winner.status 胜出
      heading: winner.heading || loser.heading,
      thesis: winner.thesis ?? loser.thesis,
      wordCount: winner.wordCount ?? loser.wordCount,
      score: winner.score ?? loser.score,
      critique: winner.critique ?? loser.critique,
      attempts: Math.max(winner.attempts ?? 0, loser.attempts ?? 0),
    });
  };
  a.forEach(consider);
  b.forEach(consider);
  return [...byIndex.values()].sort((x, y) => x.index - y.index);
}

/**
 * 从 raw events 派生 dimension → chapter pipeline（移植 backend
 * mission-view.projector.ts extractDimensionPipelines 的完整章节状态机）。
 * 后端与前端读同一批事件，逻辑须一致；前端这份是 canonical view 未 refetch 时的
 * liveness 兜底（events 由 WS+polling 持续增长）。
 */
function dvDeriveDimensionPipelinesFromEvents(
  events: PlaygroundEvent[],
  dimNames: string[]
): Map<string, DimensionPipelineState> {
  const out = new Map<string, DimensionPipelineState>();
  for (const dim of dimNames) {
    out.set(dim, { dimension: dim, chapters: [] });
  }
  const sfx = (type: string): string =>
    type.includes('.') ? type.slice(type.indexOf('.') + 1) : type;
  const getPipe = (dim: string): DimensionPipelineState => {
    const existing = out.get(dim);
    if (existing) return existing;
    const fresh: DimensionPipelineState = { dimension: dim, chapters: [] };
    out.set(dim, fresh);
    return fresh;
  };

  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    const e = ev as { type?: string; payload?: Record<string, unknown> };
    if (!e.type) continue;
    const suffix = sfx(e.type);
    const p = e.payload;
    if (!p) continue;
    const dim = typeof p.dimension === 'string' ? p.dimension : undefined;
    if (!dim) continue;
    const pipe = getPipe(dim);

    if (suffix === 'dimension:outline:planned') {
      const chapters = Array.isArray(p.chapters)
        ? (p.chapters as Array<{
            index: number;
            heading: string;
            thesis?: string;
          }>)
        : [];
      for (const c of chapters) {
        const existing = pipe.chapters.find((x) => x.index === c.index);
        if (existing) {
          if (c.heading) existing.heading = c.heading;
          if (c.thesis) existing.thesis = c.thesis;
        } else {
          pipe.chapters.push({
            index: c.index,
            heading: c.heading,
            thesis: c.thesis,
            status: 'pending',
            attempts: 0,
          });
        }
      }
      pipe.chapters.sort((a, b) => a.index - b.index);
    } else if (
      suffix === 'chapter:writing:started' ||
      suffix === 'chapter:writing:completed'
    ) {
      const heading =
        typeof p.heading === 'string'
          ? p.heading
          : typeof p.chapterTitle === 'string'
            ? p.chapterTitle
            : '';
      const index =
        typeof p.chapterIndex === 'number'
          ? p.chapterIndex
          : typeof p.index === 'number'
            ? p.index
            : pipe.chapters.length + 1;
      let chapter = pipe.chapters.find((c) => c.index === index);
      if (!chapter) {
        chapter = { index, heading, status: 'pending', attempts: 0 };
        pipe.chapters.push(chapter);
      } else if (heading && !chapter.heading) {
        chapter.heading = heading;
      }
      if (suffix === 'chapter:writing:started') {
        const attempt = typeof p.attempt === 'number' ? p.attempt : undefined;
        chapter.status = attempt && attempt > 1 ? 'revising' : 'writing';
        chapter.attempts = attempt ?? chapter.attempts + 1;
      } else if (suffix === 'chapter:writing:completed') {
        chapter.status = 'reviewing';
        if (typeof p.wordCount === 'number') chapter.wordCount = p.wordCount;
      }
    } else if (suffix === 'chapter:review:completed') {
      const index =
        typeof p.chapterIndex === 'number'
          ? p.chapterIndex
          : typeof p.index === 'number'
            ? p.index
            : undefined;
      if (index != null) {
        let chapter = pipe.chapters.find((c) => c.index === index);
        if (!chapter) {
          chapter = { index, heading: '', status: 'pending', attempts: 0 };
          pipe.chapters.push(chapter);
        }
        chapter.score = typeof p.score === 'number' ? p.score : chapter.score;
        chapter.critique =
          typeof p.critique === 'string' ? p.critique : chapter.critique;
        const decision =
          typeof p.decision === 'string' ? p.decision : undefined;
        const score = typeof p.score === 'number' ? p.score : 0;
        chapter.status =
          decision === 'pass' || score >= 75 ? 'passed' : 'revising';
      }
    } else if (suffix === 'chapter:done') {
      const index =
        typeof p.chapterIndex === 'number'
          ? p.chapterIndex
          : typeof p.index === 'number'
            ? p.index
            : pipe.chapters.length + 1;
      const heading =
        typeof p.heading === 'string'
          ? p.heading
          : typeof p.chapterTitle === 'string'
            ? p.chapterTitle
            : '';
      let chapter = pipe.chapters.find((c) => c.index === index);
      if (!chapter) {
        chapter = { index, heading, status: 'pending', attempts: 0 };
        pipe.chapters.push(chapter);
      } else if (heading && !chapter.heading) {
        chapter.heading = heading;
      }
      const qualified = p.qualified === true;
      chapter.status = qualified ? 'done' : 'failed-finalized';
      if (typeof p.wordCount === 'number') chapter.wordCount = p.wordCount;
      if (typeof p.finalScore === 'number' && chapter.score == null) {
        chapter.score = p.finalScore;
      }
    } else if (
      suffix === 'chapter:revision' ||
      suffix === 'chapter:rewritten'
    ) {
      const index =
        typeof p.chapterIndex === 'number'
          ? p.chapterIndex
          : typeof p.index === 'number'
            ? p.index
            : 0;
      const chapter = pipe.chapters.find((c) => c.index === index);
      if (chapter) chapter.status = 'revising';
    } else if (suffix === 'dimension:integrating:completed') {
      const totalWordCount =
        typeof p.totalWordCount === 'number' ? p.totalWordCount : undefined;
      if (totalWordCount != null) pipe.totalWordCount = totalWordCount;
    } else if (suffix === 'dimension:integrating:failed') {
      pipe.integrationDegraded = true;
    } else if (suffix === 'dimension:degraded') {
      pipe.integrationDegraded = true;
    } else if (suffix === 'dimension:graded') {
      // ★ 与 backend todo-board.projector 一致：overall 优先，旧 replay 事件回退 overallScore。
      const overall =
        typeof p.overall === 'number'
          ? p.overall
          : typeof p.overallScore === 'number'
            ? p.overallScore
            : 0;
      const grade = typeof p.grade === 'string' ? p.grade : '—';
      const summary = typeof p.summary === 'string' ? p.summary : '';
      const failed = typeof p.failed === 'boolean' ? p.failed : undefined;
      const skipped = typeof p.skipped === 'boolean' ? p.skipped : undefined;
      const phase = typeof p.phase === 'string' ? p.phase : undefined;
      pipe.grade = {
        overall,
        grade,
        axes: {},
        summary,
        ...(failed !== undefined && { failed }),
        ...(skipped !== undefined && { skipped }),
        ...(phase !== undefined && { phase }),
      };
    }
  }
  return out;
}

function dvDeriveVerdictsFromEvents(
  events: PlaygroundEvent[]
): VerifierVerdict[] {
  const verdicts: VerifierVerdict[] = [];
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    const e = ev as { type?: string; payload?: Record<string, unknown> };
    // ★ 2026-05-27 #97 修复：backend 实际 emit COLON 形态（playground.events.ts
    //   注册为 `verifier:verdict`，s8-writer-draft-report.stage.ts:327 实际发送）。
    //   前端旧代码用 DOT → 永远不匹配 → verdicts 永远空。同时容忍 legacy DOT 形态。
    if (
      (e.type === 'playground.verifier:verdict' ||
        e.type === 'playground.verifier.verdict') &&
      e.payload
    ) {
      const p = e.payload;
      if (typeof p.verifierId === 'string' && typeof p.score === 'number') {
        verdicts.push({
          verifierId: p.verifierId,
          score: p.score,
          critique: typeof p.critique === 'string' ? p.critique : undefined,
          criteria:
            p.criteria && typeof p.criteria === 'object'
              ? (p.criteria as Record<string, number>)
              : undefined,
          modelId: typeof p.modelId === 'string' ? p.modelId : undefined,
          attempt: typeof p.attempt === 'number' ? p.attempt : undefined,
        });
      }
    }
  }
  return verdicts;
}

function dvDeriveMemoryFromEvents(
  events: PlaygroundEvent[]
): MemoryIndexState | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (!ev || typeof ev !== 'object') continue;
    const e = ev as { type?: string; payload?: Record<string, unknown> };
    // ★ 2026-05-27 修复 Screenshot_48：backend 实际 emit 的是 `memory:indexed`
    //   (COLON, 注册在 playground.events.ts:175)；S8-writer 完成后由
    //   trajectory indexer 发出。旧版前端找 `memory.index` (DOT, 不存在) →
    //   memory panel 永远空 + 显示"backend 待补数据"假象。同时兼容 .index
    //   后缀以防有别处保留旧形态。
    if (
      e.type === 'playground.memory:indexed' ||
      e.type === 'playground.memory.index' ||
      e.type === 'playground.memory.indexed'
    ) {
      if (!e.payload) continue;
      const p = e.payload;
      if (typeof p.chunks === 'number') {
        return {
          chunks: p.chunks,
          namespace: typeof p.namespace === 'string' ? p.namespace : undefined,
          tags: Array.isArray(p.tags)
            ? p.tags.filter((t): t is string => typeof t === 'string')
            : undefined,
        };
      }
    }
  }
  return null;
}

function dvCollectAgentTraces(
  events: PlaygroundEvent[]
): Map<string, AgentTraceItem[]> {
  // ★ 2026-05-27 (Screenshot_13/15/16 回归)：恢复 baseline 15d2e93ab derive.ts 的
  //   完整 trace 提取。Backend 发的是 `agent:thought` / `agent:action` /
  //   `agent:observation` / `agent:reflection` / `agent:error` (COLON)，
  //   thinning 期间 shim 误改成 `.thought` (DOT) → 永远不匹配 → 所有 trace 为空 →
  //   AgentInspector / TodoDetailDrawer 工具调用 / Tokens / 推理过程全部丢失。
  //   规则覆盖：
  //   - agent:thought  →  { kind: 'thought', text, (capture modelId on side) }
  //   - agent:action   →  { kind: 'action',  toolId, input } + parallel_tool_call 拍平
  //   - agent:observation → { kind: 'observation', toolId, output, latencyMs, tokensUsed, error }
  //   - agent:reflection → { kind: 'reflection', text or verdict }
  //   - agent:error    →  { kind: 'error', error }
  const out = new Map<string, AgentTraceItem[]>();
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    const e = ev as {
      type?: string;
      payload?: Record<string, unknown>;
      agentId?: string;
      timestamp?: number;
    };
    if (!e.type) continue;
    const kind = dvTraceKindFromEventType(e.type);
    if (!kind) continue;
    const p = e.payload ?? {};
    const agentId =
      (typeof p.agentId === 'string' ? p.agentId : undefined) ?? e.agentId;
    if (!agentId) continue;
    // Hydration safety: fallback 0 而非 Date.now()
    const ts =
      (typeof p.originalTs === 'number' ? p.originalTs : undefined) ??
      (typeof e.timestamp === 'number' ? e.timestamp : 0);
    const trace = out.get(agentId) ?? [];

    if (kind === 'action') {
      // parallel_tool_call 拍平：每个 calls[] 元素拆成独立 action trace
      const subKind = typeof p.kind === 'string' ? p.kind : undefined;
      if (subKind === 'parallel_tool_call' && Array.isArray(p.calls)) {
        (p.calls as unknown[]).forEach((sub, i) => {
          if (!sub || typeof sub !== 'object') return;
          const s = sub as Record<string, unknown>;
          trace.push({
            kind: 'action',
            ts: ts + i * 0.001,
            toolId:
              (typeof s.toolId === 'string' ? s.toolId : undefined) ??
              (typeof s.skillId === 'string' ? s.skillId : undefined) ??
              (typeof s.kind === 'string' ? s.kind : undefined),
            input: s.input,
          });
        });
        trace.sort((a, b) => a.ts - b.ts);
        out.set(agentId, trace);
        continue;
      }
      trace.push({
        kind: 'action',
        ts,
        toolId:
          (typeof p.toolId === 'string' ? p.toolId : undefined) ??
          (typeof p.skillId === 'string' ? p.skillId : undefined) ??
          (typeof p.subagentName === 'string' ? p.subagentName : undefined) ??
          (typeof p.kind === 'string' ? p.kind : undefined),
        input: p.input,
      });
    } else if (kind === 'observation') {
      trace.push({
        kind: 'observation',
        ts,
        toolId:
          (typeof p.toolId === 'string' ? p.toolId : undefined) ??
          (typeof p.kind === 'string' ? p.kind : undefined),
        output: p.output,
        latencyMs: typeof p.latencyMs === 'number' ? p.latencyMs : undefined,
        tokensUsed: typeof p.tokensUsed === 'number' ? p.tokensUsed : undefined,
        error: typeof p.error === 'string' ? p.error : undefined,
      });
    } else if (kind === 'thought') {
      trace.push({
        kind: 'thought',
        ts,
        text: typeof p.text === 'string' ? p.text : undefined,
      });
    } else if (kind === 'reflection') {
      const text = typeof p.text === 'string' ? p.text : undefined;
      const verdict = typeof p.verdict === 'string' ? p.verdict : undefined;
      trace.push({
        kind: 'reflection',
        ts,
        text: text ?? (verdict ? `[verdict: ${verdict}]` : undefined),
      });
    } else {
      trace.push({
        kind: 'error',
        ts,
        error:
          (typeof p.error === 'string' ? p.error : undefined) ??
          (typeof p.message === 'string' ? p.message : undefined),
      });
    }
    trace.sort((a, b) => a.ts - b.ts);
    out.set(agentId, trace);
  }
  return out;
}

function dvCollectAgentSummary(
  events: PlaygroundEvent[],
  traceByAgent: Map<string, AgentTraceItem[]>
): AgentLiveState[] {
  const out = new Map<string, AgentLiveState>();
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    const e = ev as {
      type?: string;
      agentId?: string;
      payload?: Record<string, unknown>;
      timestamp?: number;
    };
    if (!e.type) continue;
    const agentId =
      (typeof e.payload?.agentId === 'string'
        ? e.payload.agentId
        : undefined) ?? e.agentId;
    if (!agentId) continue;
    const role = dvExtractRole(e) ?? dvDeriveRoleFromAgentId(agentId);
    if (!role || !DV_KNOWN_AGENT_ROLES.has(role)) continue;
    const a =
      out.get(agentId) ??
      ({
        agentId,
        role,
        phase: 'pending' as AgentPhase,
        trace: traceByAgent.get(agentId) ?? [],
      } as AgentLiveState);

    // ★ 2026-05-27 (回归恢复)：优先从 `agent:lifecycle` 单事件 + payload.phase
    //   读取生命周期（baseline 15d2e93ab 原本是这个路径）。这是 harness 发的
    //   单一 lifecycle 信号；business 派生（chapter:writing:completed 等）作为 fallback。
    if (
      e.type === 'playground.agent:lifecycle' ||
      e.type === 'agent:lifecycle' ||
      e.type.endsWith('.agent:lifecycle')
    ) {
      const p = e.payload ?? {};
      const phase = p.phase;
      if (phase === 'started') {
        if (a.phase === 'pending') a.phase = 'running';
        a.startedAt ??= e.timestamp;
        if (typeof p.attempt === 'number') a.attempt = p.attempt;
        if (typeof p.dimension === 'string') a.dimension = p.dimension;
      } else if (phase === 'completed') {
        a.phase = 'completed';
        a.endedAt = e.timestamp;
        // baseline 还落 wallTimeMs / iterations 让 Inspector / 卡片显示真实耗时
        if (typeof p.wallTimeMs === 'number') {
          a.wallTimeMs = p.wallTimeMs;
        } else if (a.startedAt && typeof e.timestamp === 'number') {
          a.wallTimeMs = e.timestamp - a.startedAt;
        }
        if (typeof p.iterations === 'number') a.iterations = p.iterations;
      } else if (phase === 'failed') {
        a.phase = 'failed';
        a.endedAt = e.timestamp;
        const msg = p.error ?? p.message;
        if (typeof msg === 'string') a.failureMessage = msg;
        if (typeof p.wallTimeMs === 'number') {
          a.wallTimeMs = p.wallTimeMs;
        } else if (a.startedAt && typeof e.timestamp === 'number') {
          a.wallTimeMs = e.timestamp - a.startedAt;
        }
        if (typeof p.iterations === 'number') a.iterations = p.iterations;
      }
      if (typeof p.modelId === 'string') a.modelId = p.modelId;
      out.set(agentId, a);
      continue;
    }
    // dimension:retrying → 把 agent.retryCount + lastRetryReason 落上
    if (
      e.type === 'playground.dimension:retrying' ||
      e.type.endsWith('.dimension:retrying')
    ) {
      const p = e.payload ?? {};
      a.retryCount = (a.retryCount ?? 0) + 1;
      if (typeof p.reason === 'string') a.lastRetryReason = p.reason;
      out.set(agentId, a);
      continue;
    }
    // ★ 2026-05-27 修复（Screenshot_5 "全是未启动"）：playground 不发独立 agent.X
    //   事件，agent 生命周期 derive 自 chapter / dim / leader 等业务事件。
    //   规则与后端 agent-view.projector.deriveVerbFromEventType 对齐。
    const verb =
      e.type === 'playground.agent.started' || e.type === 'agent.started'
        ? 'started'
        : e.type === 'playground.agent.completed' ||
            e.type === 'agent.completed'
          ? 'completed'
          : e.type === 'playground.agent.failed' || e.type === 'agent.failed'
            ? 'failed'
            : dvDeriveAgentVerbFromEventType(e.type);
    if (verb === 'started') {
      if (a.phase === 'pending') a.phase = 'running';
      a.startedAt ??= e.timestamp;
    } else if (verb === 'completed') {
      a.phase = 'completed';
      a.endedAt = e.timestamp;
    } else if (verb === 'failed') {
      a.phase = 'failed';
      a.endedAt = e.timestamp;
      a.failureMessage =
        typeof e.payload?.message === 'string'
          ? e.payload.message
          : a.failureMessage;
    } else {
      // 任何带 agentId 的事件，没有显式 verb 也至少标 running
      if (a.phase === 'pending') a.phase = 'running';
    }
    if (e.payload && typeof e.payload.modelId === 'string') {
      a.modelId = e.payload.modelId;
    }
    out.set(agentId, a);
  }
  return [...out.values()];
}

function dvDeriveRoleFromAgentId(agentId: string): AgentRole | null {
  const prefix = agentId.split(/[#.]/)[0]?.toLowerCase();
  if (!prefix) return null;
  // 收口到 AgentRole 5 个值；prefix 在外延上更细（critic/reconciler/steward/verifier）
  // 视觉上归到最贴近的 5 个 canonical role：
  //   critic / verifier → reviewer（同 reviewer 一类，看产出 quality）
  //   reconciler → analyst（综合多源、聚合视角）
  //   steward → leader（leader 的辅助管理职责）
  if (prefix.includes('writer')) return 'writer';
  if (
    prefix.includes('reviewer') ||
    prefix === 'quality-judge' ||
    prefix === 'critic' ||
    prefix.includes('critic') ||
    prefix === 'verifier'
  )
    return 'reviewer';
  if (prefix === 'researcher') return 'researcher';
  if (prefix === 'leader' || prefix === 'steward') return 'leader';
  if (prefix === 'reconciler' || prefix === 'analyst') return 'analyst';
  return null;
}

function dvDeriveAgentVerbFromEventType(
  eventType: string
): 'started' | 'completed' | 'failed' | null {
  if (
    eventType.endsWith('chapter:writing:completed') ||
    eventType.endsWith('chapter:done') ||
    eventType.endsWith('chapter:review:completed') ||
    eventType.endsWith('dimension:research:completed') ||
    eventType.endsWith('dimension:graded') ||
    eventType.endsWith('dimension:integrating:completed') ||
    eventType.endsWith('leader:signed') ||
    eventType.endsWith('leader:decision') ||
    eventType.endsWith('critic:verdict')
  ) {
    return 'completed';
  }
  if (
    eventType.endsWith('chapter:writing:failed') ||
    eventType.endsWith('dimension:retry-failed') ||
    eventType.endsWith('dimension:integrating:failed')
  ) {
    return 'failed';
  }
  if (
    eventType.endsWith('chapter:writing:started') ||
    eventType.endsWith('chapter:review:started') ||
    eventType.endsWith('dimension:research:started') ||
    eventType.endsWith('dimension:integrating:started') ||
    eventType.endsWith('dimension:outline:planned')
  ) {
    return 'started';
  }
  return null;
}

function dvMapBackendStageStatusToStep(
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
): StepStatus {
  if (status === 'skipped') return 'done';
  return status;
}

function dvCanonicalStageToFrontendStage(canonicalId: string): StageId | null {
  for (const stageId of DV_STAGE_ORDER) {
    if (STAGE_STEPS[stageId].includes(canonicalId)) {
      return stageId;
    }
  }
  return null;
}

function dvTraceKindFromEventType(type: string): AgentTraceItem['kind'] | null {
  // ★ 2026-05-27 (Screenshot_13 回归)：backend harness 用 `agent:thought` (COLON) 而非
  //   `agent.thought` (DOT)。thinning shim 误改 → 永远不匹配。这里保留 COLON 主格式
  //   + DOT 兼容（防 fixture / 旧 stream 退化用）。
  if (type.endsWith(':thought') || type.endsWith('.thought')) return 'thought';
  if (type.endsWith(':action') || type.endsWith('.action')) return 'action';
  if (type.endsWith(':observation') || type.endsWith('.observation'))
    return 'observation';
  if (type.endsWith(':reflection') || type.endsWith('.reflection'))
    return 'reflection';
  if (type.endsWith(':error') || type.endsWith('.error')) return 'error';
  return null;
}

function dvExtractRole(ev: {
  payload?: Record<string, unknown>;
}): AgentRole | null {
  const p = ev.payload;
  if (!p) return null;
  if (typeof p.role === 'string') return p.role as AgentRole;
  return null;
}

function dvZeroView(): DerivedView {
  return {
    mission: {},
    stages: DV_STAGE_ORDER.map((id) => ({
      id,
      status: 'pending' as StageStatus,
    })),
    agents: [],
    cost: { tokensUsed: 0, costUsd: 0, byStage: [] },
    verdicts: [],
    memory: null,
    reports: [],
    finalReport: null,
    dimensionPipelines: new Map(),
  };
}
