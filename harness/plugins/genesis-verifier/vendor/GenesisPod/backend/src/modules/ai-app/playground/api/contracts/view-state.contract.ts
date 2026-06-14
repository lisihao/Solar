/**
 * view-state.contract.ts —— Canonical mission detail view contract（B1-1）
 *
 * 单一源：本文件是 playground mission detail view 的 backend canonical 形状。
 * 任何前端类型、projector 输出、controller 返回都必须 mirror 此文件，禁止反向。
 *
 * 落地依据：
 *   docs/architecture/ai-app/playground/agent-team-thinning-plan-2026-05-26.md
 *   §6.2 Base contract / §6.3 Playground extension / §6.4 status enums / §6.7 refreshHints
 *
 * 配套：
 *   - artifact.contract.ts —— reportArtifact 形状
 *   - step-id-mapping.contract.ts —— 14 stage id 单一源
 *   - mission-view.projector.ts (B2-2)
 *
 * 设计约束（thinning plan §3.1）：
 *   - 前端不得 derive / 不得 synthesize / 不得 infer mission truth
 *   - sibling specialty 路由（dag/export/replay/leader-chat/report-version）不得
 *     重新定义 canonical view 已暴露字段
 */

import type { ReportArtifactView } from "./artifact.contract";

// ============================================================================
// Canonical base re-export from harness (B6 / B7 lift)
//
// 这些 type 物理位置在 ai-harness/teams/business-team/abstractions/
// mission-view-base.contract.ts，三 app 共享。本 file 仅 re-export +
// 在下方 extend playground 专属字段。
// ============================================================================

export {
  TERMINAL_MISSION_STATUSES,
  isMissionTerminal,
} from "@/modules/ai-harness/facade";
export type {
  MissionViewStatus as MissionStatus,
  MissionViewStageStatus as StageStatus,
  MissionViewAgentPhase as AgentPhase,
  RefreshHintFamily,
  RefreshHint,
  RerunnableStageEntry,
  MissionViewBaseMission,
  MissionViewBaseStage,
  MissionViewBaseAgent,
  EmptyArtifactSentinel,
  MissionMemorySentinel,
  MissionCostView,
  StageProcessView,
} from "@/modules/ai-harness/facade";

import type {
  MissionViewBase,
  TodoBoardSentinel as HarnessTodoBoardSentinel,
  MissionViewBaseMission,
} from "@/modules/ai-harness/facade";

// ============================================================================
// TodoBoardState（§6.6.3 — P0-3 实质 port，从 frontend MissionTodo 等价化）
// ============================================================================

export type TodoOrigin =
  | "leader-plan"
  | "leader-assess-retry"
  | "leader-assess-replace"
  | "leader-assess-extend"
  | "leader-assess-abort"
  | "leader-chat-create"
  | "self-heal-retry"
  | "reviewer-revise"
  | "critic-blindspot"
  | "reconciler-gap"
  | "system-stage"
  | "chapter-pipeline";

export type TodoScope =
  | "mission"
  | "dimension"
  | "chapter"
  | "review"
  | "system";

export type TodoStatus =
  | "pending"
  | "in_progress"
  | "blocked"
  | "done"
  | "failed"
  | "cancelled";

export type TodoAssigneeRole =
  | "leader"
  | "researcher"
  | "analyst"
  | "writer"
  | "reviewer"
  | "reconciler"
  | "critic"
  | "mission";

export interface TodoAssignee {
  role: TodoAssigneeRole;
  agentId?: string;
  dimensionName?: string;
}

export interface TodoArtifact {
  kind:
    | "finding-count"
    | "insight-count"
    | "fact-table"
    | "figure"
    | "chapter"
    | "verdict-score"
    | "critic-warning"
    | "foreword";
  label: string;
  value?: string | number;
}

export interface TodoNarrativeItem {
  ts: number;
  text: string;
  tone?: "info" | "success" | "warn" | "error";
}

/**
 * Backend canonical TodoBoardEntry — MissionTodo 等价（不含 UI-only 字段）。
 *
 * 落地依据：thinning plan §6.6.3 truth split。本 shape mirror frontend
 * `MissionTodo`（去掉 derived UI helper output 如 layer breadcrumb）。
 *
 * Frontend B5-1 删除 derive ecosystem 后，本 shape 即唯一 todo truth source。
 */
export interface TodoBoardEntry {
  id: string;
  parentId?: string;
  origin: TodoOrigin;
  createdBy: "leader" | "reviewer" | "critic" | "reconciler" | "system";
  createdAt: number;
  reasonText: string;
  scope: TodoScope;
  title: string;
  assignee: TodoAssignee;
  status: TodoStatus;
  startedAt?: number;
  endedAt?: number;
  artifacts: TodoArtifact[];
  narrativeLog: TodoNarrativeItem[];
  agentRefId?: string;
  dimensionRef?: string;
  systemStageId?: string;
  /** retry 双路径 pipelineKey 索引（§6.6.3 retry pipeline 关键字段）。 */
  retryPipelineKey?: string;
}

/**
 * §6.6.3 first-cut Todo board canonical shape — playground-specialized sentinel
 * narrows the harness `TodoBoardSentinel<TEntry>` to `TodoBoardEntry`.
 */
export type TodoBoardSentinel = HarnessTodoBoardSentinel<TodoBoardEntry>;

// ============================================================================
// PlaygroundDomainView（§6.3 frozen extension fields）
// ============================================================================

/**
 * 单个 dimension 的浅形（§5.2 dimensions 是 app-owned 业务字段）。
 * 完整 shape 由 mission 的 pipeline 写入；canonical view 只暴露此投影。
 */
export interface DimensionView {
  id: string;
  name: string;
  rationale?: string;
}

/** 引用条目（来源于 reportFull.citations 或 mission references）。 */
export interface MissionReferenceView {
  index: number;
  title: string;
  url: string;
  domain?: string;
  publishedAt?: string;
}

/**
 * 报告版本列表项（不含 reportFull，仅 summary 字段，对齐现有
 * GET /missions/:id/report-versions 返回）。
 */
export interface ReportVersionView {
  version: number;
  versionLabel: string | null;
  reportTitle: string | null;
  reportSummary: string | null;
  finalScore: number | null;
  leaderSigned: boolean | null;
  triggerType: string;
  generatedAt: string;
}

/** Leader journal 投影（§5.2 leaderJournal 是 app-owned 业务字段）。 */
export interface LeaderJournalView {
  /** opaque 暴露给前端的 journal 主体；具体业务字段 projector 决定。 */
  entries: Array<{
    stage?: string;
    timestamp?: string;
    title?: string;
    body?: string;
  }>;
}

/**
 * playground extension。冻结字段见 §6.3。
 *
 * 显式不暴露（§6.3 line 963-969）：
 *   - MissionElectionState / committedModelIds / reservations
 *
 * 显式 out of B1/B2 scope（§6.3 line 485-491）：
 *   - verifyConsensus / capabilityMeters / budgetTimeLimit
 *
 * 重新加入这些字段时必须同 PR 提供具体 TS shape 和 consuming UI。
 */
export interface PlaygroundDomainView extends MissionViewBase<
  ReportArtifactView,
  TodoBoardEntry
> {
  mission: MissionViewBaseMission & {
    /** 兼容 baggage，新消费方禁用，参 §6.3 field-name compatibility rule 4-5。 */
    topic?: string;
    depth?: string;
    language?: string;
    maxCredits?: number;
    wallTimeMs?: number;
    themeSummary?: string;
    dimensions?: DimensionView[];
    leaderJournal?: LeaderJournalView | null;
    leaderOverallScore?: number | null;
    leaderSigned?: boolean | null;
    leaderVerdict?: string | null;
    terminalOutcome?: string | null;
    /** §6.2 canonical fail enum（来自 AgentPlaygroundMission.failureCode）。 */
    failureCode?: string | null;
    /** §6.6 v1 = ResearchReport / v2 = ReportArtifact。 */
    reportArtifactVersion?: number | null;
    /**
     * UserProfile 投影 (W1 cutover：page.tsx 直接吃此字段，不再调旧 getMissionDetail)。
     * §6.3 playground extension。C5/G7 后是 configSnapshot 的读时投影。
     */
    userProfile?: unknown;
    /**
     * Reconciliation report 投影 (W1 cutover：page.tsx sidebar 用此判存在性)。
     * §6.3 playground extension。含 R2 off-load uri/size 时由 ArtifactComposer 处理；
     * page.tsx 仅做存在性判断（unknown shape ok）。
     */
    reconciliationReport?: unknown;
  };
  references: MissionReferenceView[];
  reportVersions: ReportVersionView[];
  /**
   * Verifier verdicts (P0-A: 暴露给前端，取代 shim 内 events 派生)。
   * §6.2 base 没有此字段；playground 业务字段，由 backend projector 派生。
   */
  verdicts: VerifierVerdictView[];
  /**
   * 内存索引状态 (P0-A: 暴露)。
   */
  memoryIndex: MemoryIndexView | null;
  /**
   * Dimension pipeline 状态（chapter 列表 / integrator state / 5-axis grade 等，
   * P0-A first cut：仅 chapters 简化形态。完整 ChapterState 等价化排 follow-up）。
   */
  dimensionPipelines: Record<string, DimensionPipelineView>;
}

// ============================================================================
// P0-A 新暴露字段（取代 shim 内 events 派生）
// ============================================================================

export interface VerifierVerdictView {
  verifierId: string;
  score: number;
  critique?: string;
  criteria?: Record<string, number>;
  modelId?: string;
  attempt?: number;
}

export interface MemoryIndexView {
  chunks: number;
  namespace?: string;
  tags?: string[];
}

export interface DimensionPipelineChapterView {
  index: number;
  heading: string;
  thesis?: string;
  status:
    | "pending"
    | "writing"
    | "reviewing"
    | "revising"
    | "passed"
    | "done"
    | "failed-finalized"
    | "failed";
  attempts: number;
  wordCount?: number;
  score?: number;
  critique?: string;
}

export interface DimensionPipelineView {
  dimension: string;
  chapters: DimensionPipelineChapterView[];
  totalWordCount?: number;
  integrationDegraded?: boolean;
  grade?: {
    overall: number;
    grade: string;
    summary: string;
    failed?: boolean;
    skipped?: boolean;
    phase?: string;
  };
}

// ============================================================================
// View envelope（endpoint response 顶层包装；§B2-3 GET /missions/:id/view）
// ============================================================================

/**
 * canonical view endpoint 返回的顶层 envelope。
 * 注：现有 `GET /missions/:id` 返回 `{ mission }`；canonical view 用 `{ view }`
 * 以避免 sibling-route 字段冲突，参见 §6.9 disposition table 第一行。
 */
export interface MissionViewEnvelope {
  view: PlaygroundDomainView;
}
