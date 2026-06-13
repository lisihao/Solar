/**
 * mission-presentation.types.ts — Frontend PRESENTATION shape types + pure mapping helpers
 *
 * 落地依据：thinning plan §B4-4 / §B5-1 / §B5-2 / §3.4 / §7.2
 *
 * **2026-05-26 重命名收口**：原 derive-shapes.ts。
 *   - "derive" 名头容易引起 §3.4 truth derivation 误解；
 *   - 本文件实际是 §7.2 PRESENTATION types，由 useMissionPresentationView hook 输出，
 *     供 ComputeUsagePanel / ArtifactReader / TodoDetailDrawer 等组件展示
 *     events-derived UI summary（agent trace / chapter pipeline / tool latency 等）。
 *
 * **角色澄清（§3.4 + §7.2）**：
 *   - mission truth 由 backend canonical MissionDetailView 接管（GET /missions/:id/view）
 *   - MissionPresentationView (原 DerivedView) / AgentLiveState.trace[] / DimensionPipelineState
 *     是 PRESENTATION shapes —— 这些字段 backend 暂未在 canonical view 暴露
 *     （需要大量 telemetry payload），§7.2 显式允许 frontend 从 raw events 解析 UI-only summary
 *
 * **本文件包含**：
 *   1. 形状类型（types / interfaces，含 MissionPresentationView envelope）
 *   2. 不携带 mission truth 的纯映射 helper（STAGE_STEPS / mapStepIdToStageId /
 *      aggregateStageStatus）
 *
 * **不包含**：deriveView / deriveTodoLedger 等 mission truth 派生函数（已删除）。
 *
 * **历史 export 别名**：DerivedView 保留为 MissionPresentationView 别名，避免大规模
 * 改动 50+ 消费方 import 站点；新代码请用 MissionPresentationView。
 */

// ============================================================================
// Stage / Step enums
// ============================================================================

export type StageId =
  | 'leader'
  | 'researchers'
  | 'analyst'
  | 'writer'
  | 'reviewer';

export type StepStatus = 'pending' | 'running' | 'done' | 'failed';
export type StageStatus = 'pending' | 'running' | 'done' | 'failed';

/**
 * 把 backend pipeline 内部 stepId 映射到 5 个高层 StageId。
 * 一个 StageId 可对应多个 stepId（如 leader = s1-budget + s2-leader-plan +
 * s4-leader-assess + s10-leader-foreword-signoff + s11-persist）。
 */
export function mapStepIdToStageId(stepId: string | undefined): StageId | null {
  if (!stepId) return null;
  if (
    stepId === 'leader' ||
    stepId === 'researchers' ||
    stepId === 'analyst' ||
    stepId === 'writer' ||
    stepId === 'reviewer'
  ) {
    return stepId;
  }
  if (
    stepId === 's1-budget' ||
    stepId === 's2-leader-plan' ||
    stepId === 's4-leader-assess' ||
    stepId === 's10-leader-foreword-signoff' ||
    stepId === 's11-persist' ||
    stepId === 's12-self-evolution'
  ) {
    return 'leader';
  }
  if (stepId === 's3-researchers' || stepId === 's3-researcher-collect') {
    return 'researchers';
  }
  if (stepId === 's5-reconciler' || stepId === 's6-analyst') {
    return 'analyst';
  }
  if (
    stepId === 's7-writer-outline' ||
    stepId === 's8-writer' ||
    stepId === 's8-writer-draft' ||
    stepId === 's8b-section-quality-enhancement' ||
    stepId === 's8b-quality-enhancement'
  ) {
    return 'writer';
  }
  if (
    stepId === 's9-critic' ||
    stepId === 's9-reviewer-critic-l4' ||
    stepId === 's9b-objective-evaluation' ||
    stepId === 's9b-objective-eval'
  ) {
    return 'reviewer';
  }
  return null;
}

/**
 * 每 stage 含的 step 列表（顺序敏感）。Stage 状态由所有 step 状态聚合：
 *   任意 failed → failed
 *   所有 done → done
 *   任意 running 或部分 done → running
 *   否则 → pending
 *
 * 不含 s12-self-evolution（fire-and-forget postlude）；不含 s8b（可选 audit）。
 */
export const STAGE_STEPS: Record<StageId, readonly string[]> = {
  leader: [
    's1-budget',
    's2-leader-plan',
    's4-leader-assess',
    's10-leader-foreword-signoff',
    's11-persist',
  ],
  researchers: ['s3-researcher-collect'],
  analyst: ['s5-reconciler', 's6-analyst'],
  writer: ['s7-writer-outline', 's8-writer'],
  reviewer: ['s9-critic', 's9b-objective-eval'],
};

/** 由 step 状态聚合 stage 状态：failed > running > pending > done */
export function aggregateStageStatus(
  stageId: StageId,
  stepStates: Map<string, StepStatus>
): StageStatus {
  const steps = STAGE_STEPS[stageId];
  let hasFailed = false;
  let hasRunning = false;
  let doneCount = 0;
  let knownCount = 0;
  for (const step of steps) {
    const s = stepStates.get(step);
    if (s == null) continue;
    knownCount++;
    if (s === 'failed') hasFailed = true;
    else if (s === 'running') hasRunning = true;
    else if (s === 'done') doneCount++;
  }
  if (hasFailed) return 'failed';
  if (knownCount === 0) return 'pending';
  if (doneCount === steps.length) return 'done';
  if (hasRunning || doneCount > 0) return 'running';
  return 'pending';
}

// ============================================================================
// Stage / Agent shapes
// ============================================================================

export interface PreflightRisk {
  severity: 'warn' | 'block';
  reasons: {
    code: string;
    message: string;
    current?: number;
    threshold?: number;
  }[];
}

/**
 * T75: Per-stage process surface — projection of backend `StageProcessView`.
 * Optional on `StageState`; absent for system-only stages (s1-budget /
 * s11-persist / s12-self-evolution) and for missions whose events haven't
 * begun yet.
 */
export interface StageProcessTrace {
  inputs?: Array<{ label: string; value: string | number }>;
  llmCalls?: Array<{
    modelId?: string;
    tokensIn?: number;
    tokensOut?: number;
    durationMs?: number;
    costUsd?: number;
  }>;
  outputPeek?: Record<string, number | string>;
  reactTrace?: Array<{
    kind: 'thought' | 'action' | 'observation' | 'reflection' | 'error';
    ts: number;
    text?: string;
    toolId?: string;
    output?: string;
    latencyMs?: number;
    tokensUsed?: number;
    error?: string;
  }>;
  totalTokens?: number;
  totalDurationMs?: number;
  stepCount?: number;
}

export interface StageState {
  id: StageId;
  status: StageStatus;
  startedAt?: number;
  endedAt?: number;
  detail?: string;
  attempts?: number;
  preflightRisk?: PreflightRisk;
  /** T75: backend-derived per-stage process trace（available when present
   *  in the canonical view; legacy missions / no-LLM stages omit it）. */
  processTrace?: StageProcessTrace;
}

export type AgentRole =
  | 'leader'
  | 'researcher'
  | 'analyst'
  | 'writer'
  | 'reviewer';

export type AgentPhase = 'pending' | 'running' | 'completed' | 'failed';

export interface AgentTraceItem {
  kind: 'thought' | 'action' | 'observation' | 'reflection' | 'error';
  ts: number;
  text?: string;
  toolId?: string;
  input?: unknown;
  output?: unknown;
  latencyMs?: number;
  tokensUsed?: number;
  error?: string;
}

export interface AgentLiveState {
  agentId: string;
  role: AgentRole;
  phase: AgentPhase;
  startedAt?: number;
  endedAt?: number;
  wallTimeMs?: number;
  iterations?: number;
  attempt?: number;
  dimension?: string;
  modelId?: string;
  failureMessage?: string;
  retryCount?: number;
  lastRetryReason?: string;
  trace: AgentTraceItem[];
  // ★ 2026-05-27 (#109): 算力消耗 tab Agent 实例耗时表新增列, 由 trace 派生 fallback.
  tokensUsed?: number;
  toolCallCount?: number;
  costUsd?: number;
}

// ============================================================================
// Verdict / Memory / Cost / Report / Mission shapes
// ============================================================================

export interface VerifierVerdict {
  verifierId: string;
  score: number;
  critique?: string;
  criteria?: Record<string, number>;
  modelId?: string;
  attempt?: number;
}

export interface MemoryIndexState {
  chunks: number;
  namespace?: string;
  tags?: string[];
}

export interface CostState {
  tokensUsed: number;
  costUsd: number;
  byStage: { stage: string; tokensUsed: number; costUsd: number }[];
}

export interface ReportDraft {
  attempt: number;
  report: {
    title?: string;
    summary?: string;
    sections?: { heading: string; body: string; sources?: string[] }[];
    conclusion?: string;
    citations?: string[];
  };
}

export interface MissionState {
  startedAt?: number;
  completedAt?: number;
  failedAt?: number;
  failedMessage?: string;
  cancelledAt?: number;
  rejectedAt?: number;
  rejectedReason?: string;
  rejectedMessage?: string;
  topic?: string;
  depth?: string;
  language?: string;
  themeSummary?: string;
  dimensions?: { id: string; name: string; rationale: string }[];
  finalScore?: number;
  maxCredits?: number;
  wallTimeMs?: number;
  status?: string;
}

// ============================================================================
// Chapter / Dimension pipeline shapes
// ============================================================================

export interface ChapterState {
  index: number;
  heading: string;
  thesis?: string;
  status:
    | 'pending'
    | 'writing'
    | 'reviewing'
    | 'revising'
    | 'passed'
    | 'done'
    | 'failed-finalized'
    | 'failed';
  attempts: number;
  wordCount?: number;
  score?: number;
  critique?: string;
}

export interface DimensionPipelineState {
  dimension: string;
  chapters: ChapterState[];
  totalWordCount?: number;
  integrationDegraded?: boolean;
  grade?: {
    overall: number;
    grade: string;
    axes: Record<string, { score: number; comment: string }>;
    summary: string;
    failed?: boolean;
    skipped?: boolean;
    phase?: string;
  };
}

// ============================================================================
// Top-level DerivedView envelope
// ============================================================================

export interface MissionPresentationView {
  mission: MissionState;
  stages: StageState[];
  agents: AgentLiveState[];
  cost: CostState;
  verdicts: VerifierVerdict[];
  memory: MemoryIndexState | null;
  reports: ReportDraft[];
  finalReport: ReportDraft['report'] | null;
  dimensionPipelines: Map<string, DimensionPipelineState>;
}

/** @deprecated 旧名；新代码请用 MissionPresentationView。保留以避免大量 import 站点改动。 */
export type DerivedView = MissionPresentationView;
