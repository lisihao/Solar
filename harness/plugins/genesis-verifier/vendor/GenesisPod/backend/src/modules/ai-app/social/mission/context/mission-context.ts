/**
 * MissionContext —— social SocialPublishMission 跨 stage 共享的可变状态包
 *
 * Mirror of playground/mission/context/mission-context.ts，
 * 适配 social 12-stage pipeline 的 phase 结构（参见 docs/architecture/ai-app/
 * social/agent-team-w4-implementation-plan.md §"12 Stage → Harness Primitive 映射"）。
 *
 * 类型分组：
 *   • MissionInvariants  ← 装配后不变（s1 之前确定）
 *   • PlanPhaseCtx       ← s2 platform-probe 结果
 *   • TransformPhaseCtx  ← s3 content-transform 各平台版本
 *   • AssessPhaseCtx     ← s4 leader assess-transform verdict
 *   • CraftPhaseCtx      ← s5 cover-craft 封面输出
 *   • ComposePhaseCtx    ← s6 body-compose HTML schema
 *   • PolishPhaseCtx     ← s7 polish-review fix list
 *   • PublishPhaseCtx    ← s8 + s8b publish-execute 结果
 *   • VerifyPhaseCtx     ← s9 publish-verify 回读校验
 *   • SignoffPhaseCtx    ← s10 leader foreword + signoff
 *   • PersistPhaseCtx    ← s11 mission-persist trajectory
 */

import type {
  ContentTransformerOutput,
  CoverArtistOutput,
  ComposerOutput,
  PolishReviewerOutput,
  PublishExecutorOutput,
  PublishVerifierOutput,
  PlatformProbeOutput,
  LeaderOutput,
} from "../agents";
import type { MissionBudgetPool } from "@/modules/ai-harness/facade";
import type { BillingRuntimeEnvAdapter } from "@/modules/ai-harness/facade";

/** Mission 启动入参（与 playground.RunMissionInput 对位，但 social 业务字段） */
export interface RunSocialMissionInput {
  /** Social content row id（library / drafts 表里的 row） */
  contentId: string;
  /** 目标平台列表，至少 1 个 */
  platforms: readonly string[];
  /** 用户已连接的 connection.id 映射（平台 → connectionId） */
  connectionIds: Readonly<Record<string, string>>;
  /** 内容质量档位 */
  depth: "quick" | "standard" | "deep";
  /** 调度档位（影响 budget multiplier） */
  budgetProfile: "lean" | "standard" | "rich";
  /** 用户主语言 */
  language: "zh-CN" | "en-US";
  /** 是否单平台短路（PR-5 才用，PR-3c 透传） */
  forceMissionPath?: boolean;
}

/** raw content snapshot — 从 SocialContent 表 hydrate，供 s3/s5/s6 消费 */
export interface RawContentBag {
  title: string;
  body: string;
  digest: string | null;
  coverImageUrl: string | null;
}

/** s1 Steward 4 闸输入 — dispatcher 在 mission 启动时一次性查 DB 装配 */
export interface StewardInputs {
  /** 预算池剩余美元（pool.snapshot().remainingCostUsd） */
  remainingCreditsUsd: number;
  /** 本次 mission 估算消耗（depth × budgetProfile heuristic） */
  estimatedCostUsd: number;
  /** Per-platform session 过期时间 ISO string（""=未知 / 已过期） */
  sessionExpiresAt: Readonly<Record<string, string>>;
  /** 用户当前 running mission 数（防资源耗尽） */
  inProgressMissionCount: number;
  /** 用户 BYOK key 1h 内冷却次数（health） */
  keyCooldownCount1h: number;
}

// ─── Phase 0: Invariants ───────────────────────────────────────────
export interface MissionInvariants {
  readonly missionId: string;
  readonly userId: string;
  readonly input: RunSocialMissionInput;
  readonly t0: number;

  // 基础设施 dep（mission 内长生命周期）
  readonly billing: BillingRuntimeEnvAdapter;
  readonly pool: MissionBudgetPool;
  readonly budgetMultiplier: number;

  /**
   * Per-platform 浏览器 context id（W2 BrowserContextTool 通过 contextId 复用同一 Page）。
   * Mission 启动时按 connectionId 派生：`social-{platform}-{connectionId}`。
   */
  readonly contextIds: Readonly<Record<string, string>>;

  /**
   * Raw content snapshot —— dispatcher 在 openSession 之后立即查 SocialContent
   * 注入，让 s3/s5/s6 不需要重复查 DB。
   */
  readonly contentRaw: RawContentBag;

  /**
   * S1 Steward 4 闸输入 —— dispatcher 装配 remainingCredits / estimatedCost /
   * 每平台 session 过期时间 / 用户当前 running mission 数 / key 1h 冷却次数。
   */
  readonly stewardInputs: StewardInputs;
}

type LeaderPlanOutput = Extract<LeaderOutput, { phase: "plan" }>;
type LeaderAssessOutput = Extract<LeaderOutput, { phase: "assess-transform" }>;
type LeaderForewordOutput = Extract<LeaderOutput, { phase: "foreword" }>;
type LeaderSignoffOutput = Extract<LeaderOutput, { phase: "signoff" }>;

// ─── Phase 1: Plan（s2 platform-probe）─────────────────────────────
export interface PlanPhaseCtx {
  /** s2-platform-probe 输出 */
  probeResults?: PlatformProbeOutput;
  /** s4 leader plan 输出（M0 plan phase 在 social 跑在 s4 之前的可选预备 stage；
   *  当前简化版 s2 后即用 probe 结果作为 plan 输入，不显式调 leader-plan） */
  leaderPlan?: LeaderPlanOutput;
}

// ─── Phase 2: Transform（s3 content-transform）────────────────────
export interface TransformPhaseCtx {
  /** s3 输出：平台 -> 各自 ContentTransformerOutput */
  platformVersions?: Record<string, ContentTransformerOutput>;
}

// ─── Phase 3: Assess（s4 leader-assess-transform）─────────────────
export interface AssessPhaseCtx {
  /** s4 leader M1 verdict */
  leaderAssess?: LeaderAssessOutput;
}

// ─── Phase 4: Craft（s5 cover-craft）──────────────────────────────
export interface CraftPhaseCtx {
  /** s5 输出：平台 -> 封面 schema */
  covers?: Record<string, CoverArtistOutput>;
}

// ─── Phase 5: Compose（s6 body-compose）───────────────────────────
export interface ComposePhaseCtx {
  /** s6 输出：平台 -> 正文 HTML schema */
  composed?: Record<string, ComposerOutput>;
}

// ─── Phase 6: Polish（s7 polish-review）───────────────────────────
export interface PolishPhaseCtx {
  /** s7 输出：平台 -> critique + fix */
  polished?: Record<string, PolishReviewerOutput>;
}

// ─── Phase 7: Publish（s8 + s8b）──────────────────────────────────
export interface PublishPhaseCtx {
  /** s8 输出：平台 -> 真发结果 */
  published?: Record<string, PublishExecutorOutput>;
  /** s8b 重试次数（每平台） */
  retryRound?: Record<string, number>;
}

// ─── Phase 8: Verify（s9 publish-verify）──────────────────────────
export interface VerifyPhaseCtx {
  /** s9 输出：平台 -> 发布后回读校验 */
  verified?: Record<string, PublishVerifierOutput>;
}

// ─── Phase 9: Signoff（s10 leader foreword + signoff）─────────────
export interface SignoffPhaseCtx {
  /** M6 foreword */
  leaderForeword?: LeaderForewordOutput & { generatedAt: string };
  /** M7 signoff */
  leaderSignOff?: LeaderSignoffOutput;
}

// ─── Phase 10: Persist（s11 mission-persist + s12 postlude）──────
export interface PersistPhaseCtx {
  /** s11 落盘行数 */
  trajectoryStored?: number;
}

/**
 * 完整合成类型 —— stage 当前签名收完整 ctx；后续 PR 可逐 stage 改窄签名。
 */
export type MissionContext = MissionInvariants &
  PlanPhaseCtx &
  TransformPhaseCtx &
  AssessPhaseCtx &
  CraftPhaseCtx &
  ComposePhaseCtx &
  PolishPhaseCtx &
  PublishPhaseCtx &
  VerifyPhaseCtx &
  SignoffPhaseCtx &
  PersistPhaseCtx;
