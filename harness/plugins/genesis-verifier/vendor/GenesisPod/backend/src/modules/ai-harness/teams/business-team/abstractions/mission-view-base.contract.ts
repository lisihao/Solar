/**
 * mission-view-base.contract.ts —— Shared canonical MissionView base（B6 / B7 lift）
 *
 * Single source for cross-app mission detail view types. Each mission app
 * extends this base with app-specific domain fields.
 *
 * 落地依据：thinning plan
 *   §5.1 shared framework over multiple mission stores
 *   §6.2 base contract
 *   §6.4 status enums freeze
 *   §6.7 refresh semantics
 *   §16.4 harness may own shared read-model framework primitives
 *   §22.2 abstractions/ is approved harness subdir for canonical interfaces
 *
 * Lift rationale (plan §3.2 + §8.2 lift criteria):
 *   ✅ business-agnostic — no app-specific enum value here
 *   ✅ parameterizable — apps extend MissionViewBase with their own DomainView
 *   ✅ benefits 3 mission apps
 *   ✅ no app-code import
 *   ✅ harness-only fixture-testable
 *
 * Constraints:
 *   - this file MUST NOT reference any app-specific enum value (e.g. per-app
 *     persistence-to-view mapping stays in each app's own projector per §6.4.1.a)
 *   - this file MUST NOT import from any ai-app/*
 */

// ============================================================================
// Status enums (plan §6.4)
// ============================================================================

/** mission.status 6 values (§6.4.1). Terminal subset = 4. */
export type MissionStatus =
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "quality-failed";

export const TERMINAL_MISSION_STATUSES: ReadonlySet<MissionStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
  "quality-failed",
]);

export function isMissionTerminal(status: MissionStatus): boolean {
  return TERMINAL_MISSION_STATUSES.has(status);
}

/** stage.status 5 values (§6.4.2). */
export type StageStatus = "pending" | "running" | "done" | "failed" | "skipped";

/** agent.phase 4 values (§6.4.3). retryCount is auxiliary metadata, not authority. */
export type AgentPhase = "pending" | "running" | "completed" | "failed";

// ============================================================================
// Refresh hint (§6.7 / §6.7.2)
// ============================================================================

export type RefreshHintFamily =
  | "mission"
  | "stages"
  | "agents"
  | "artifact"
  | "todo"
  | "cost"
  | "memory";

export interface RefreshHint {
  family: RefreshHintFamily;
  mode: "refetch" | "patch";
  id?: string;
}

// ============================================================================
// Rerunnable stage entry (§6.5.2)
// ============================================================================

export interface RerunnableStageEntry {
  id: string;
  allowed: boolean;
  reason?: string;
}

// ============================================================================
// Base mission shape (§6.2)
// ============================================================================

export interface MissionViewBaseMission {
  id: string;
  /** outward canonical 字段名（§6.3 field-name compatibility）。 */
  title?: string;
  status: MissionStatus;
  startedAt?: string;
  finishedAt?: string;
  finalScore?: number;
  failureMessage?: string;
  resumable: boolean;
  canCancel: boolean;
  rerunnableStages: RerunnableStageEntry[];
}

export interface MissionViewBaseStage {
  id: string;
  label: string;
  status: StageStatus;
  startedAt?: string;
  endedAt?: string;
  detail?: string;
  attempts?: number;
  /**
   * Stage process detail. System-stage Drawer renders this directly without
   * needing to follow agentId indirection. Optional — projectors may omit it
   * when the stage has no LLM activity (e.g. s1-budget / s11-persist).
   *
   * T75 / 2026-05-27.
   */
  processTrace?: StageProcessView;
}

/**
 * Per-stage process surface — what the LLM stage actually did, structured so
 * the Drawer can render it without needing per-app code paths.
 *
 * MECE field semantics:
 *   - inputs    : high-level summary of what entered (counts / labels)
 *   - llmCalls  : telemetry per LLM round-trip (model / tokens / duration)
 *   - outputPeek: top-level structured output counts ({facts: 47, conflicts: 3})
 *   - reactTrace: ReAct loop steps (thought/action/observation/reflection/error)
 *   - totalTokens / totalDurationMs / stepCount: convenience aggregates
 */
export interface StageProcessView {
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
    kind: "thought" | "action" | "observation" | "reflection" | "error";
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

export interface MissionViewBaseAgent {
  id: string;
  role: string;
  phase: AgentPhase;
  modelId?: string;
  retryCount?: number;
  failureMessage?: string;
  // ★ 2026-05-27 (Screenshot_19)：ComputeUsagePanel "Agent 实例耗时" 需要这 4 字段。
  //   原 contract 只有 6 个，前端 dvProjectAgents 走 view.agents 短路时这些字段永远
  //   是 undefined → 维度 / iter / 耗时 三列空白。新增 optional 字段，向后兼容。
  attempt?: number;
  dimension?: string;
  iterations?: number;
  wallTimeMs?: number;
  startedAt?: number;
  endedAt?: number;
  // ★ 2026-05-29：per-agent 用量（"Agent 实例耗时"表的 Tokens / 成本 / 工具列）。
  //   由各 agent 终态事件（chapter:*:completed / agent:lifecycle）携带 RunResult 用量，
  //   projector 读取后填充。新增 optional 字段，向后兼容。
  tokensUsed?: number;
  costUsd?: number;
  toolCallCount?: number;
}

// ============================================================================
// Empty-state sentinels (§B2-2 / §B2-3)
// ============================================================================

export interface EmptyArtifactSentinel {
  kind: "empty-artifact";
  reason:
    | "not-yet-materialized"
    | "no-report-versions"
    | "v1-needs-normalization";
}

export interface TodoBoardSentinel<TEntry = unknown> {
  kind: "empty-todo-board" | "todo-board";
  items?: TEntry[];
  isFirstCutTruncated?: boolean;
}

export interface MissionMemorySentinel {
  kind: "empty-memory" | "memory";
  payload?: unknown;
}

// ============================================================================
// Cost view (shared shape across apps)
// ============================================================================

export interface MissionCostView {
  tokensUsed?: string | null;
  costUsd?: number | null;
  elapsedWallTimeMs?: number | null;
  trajectoryStored?: number | null;
  currency: "USD";
}

// ============================================================================
// MissionViewBase (generic over TArtifact)
// ============================================================================

/**
 * Canonical mission view base. Each mission app extends with its own
 * app-specific domain view alias of this generic interface.
 *
 * TArtifact: app-specific artifact shape (or EmptyArtifactSentinel fallback).
 * TTodoEntry: app-specific todo entry shape.
 */
export interface MissionViewBase<TArtifact = unknown, TTodoEntry = unknown> {
  mission: MissionViewBaseMission;
  stages: MissionViewBaseStage[];
  agents: MissionViewBaseAgent[];
  reportArtifact?: TArtifact | EmptyArtifactSentinel;
  todoBoard?: TodoBoardSentinel<TTodoEntry>;
  cost?: MissionCostView;
  memory?: MissionMemorySentinel;
  /** §6.7.1 — derived from persisted event state, monotonic per mission, multi-pod stable. */
  timelineVersion: number;
  /** §6.7.1 — derived from persisted view-relevant state. */
  snapshotVersion: number;
  refreshHints?: RefreshHint[];
}
