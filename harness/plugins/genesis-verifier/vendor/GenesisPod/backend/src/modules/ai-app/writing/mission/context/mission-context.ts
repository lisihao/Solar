/**
 * WritingMissionContext —— 跨 stage 共享的可变状态包（按 phase 拆类型）
 *
 * runMission() 装配阶段构造一个 WritingMissionContext，每个 stage 函数读取之前
 * stage 的产物 + 写入自己的产物到 ctx，最后由 s8-persist stage 落盘 + 投影 WritingArtifact。
 *
 * 设计决策（照 playground mission-context.ts）：
 *   • ctx 是 mutable —— stage 通过 ctx.X = ... 写产物，不返回独立结构
 *   • readonly 字段在装配后不可变（mission lifetime 不变量）
 *   • 可变字段为 optional —— 表示「尚未到达该 stage」
 *   • 不放基础设施（pool/billing/lifecycle 等）—— 那些是 dep（见 mission-deps.ts）
 *
 * 类型分组（对齐迁移规格 §pipelineSteps 的 ctxWrites）：
 *   • WritingMissionInvariants  ←  装配后不变（s1 之前确定）
 *   • BudgetPhaseCtx            ←  s1 写 budgetEval
 *   • WorldPhaseCtx             ←  s2 写 worldSettings + bibleSnapshot
 *   • OutlinePhaseCtx           ←  s3 写 outlinePlan + chapterPlan
 *   • DraftPhaseCtx             ←  s4 逐章追加 chapterDrafts + chapterFailures
 *   • ConsistencyPhaseCtx       ←  s5 写 consistencyIssues + extractedFacts
 *   • EditPhaseCtx              ←  s6 写 revisedChapters + editStats
 *   • QualityPhaseCtx           ←  s7 写 qualityMetrics + qualityVerdict
 *   • PersistPhaseCtx           ←  s8 写 writingArtifact + trajectoryStored
 */

import type { MissionBudgetPool } from "@/modules/ai-harness/facade";
import type { BillingRuntimeEnvAdapter } from "@/modules/ai-harness/facade";

import type { WritingMissionInput } from "../../services/mission/writing-mission.types";
import type {
  StoryArchitectOutput,
  BibleKeeperOutput,
  ConsistencyCheckerOutput,
  ConsistencyIssue,
  EditorOutput,
} from "../../agents";

// ─── Phase 0: Invariants（s1 装配后不变）────────────────────────────────
export interface WritingMissionInvariants {
  readonly missionId: string;
  readonly userId: string;
  readonly input: WritingMissionInput;
  readonly t0: number;

  // 基础设施 dep（mission 内长生命周期）
  readonly pool: MissionBudgetPool;
  readonly billing: BillingRuntimeEnvAdapter;
  readonly budgetMultiplier: number;

  /** Abort signal：s4/s5 长循环每轮入口检查，dispatcher 装配时注入。 */
  readonly signal?: AbortSignal;
}

// ─── Phase 1: Budget（s1-mission-budget-eval 产物）──────────────────────
export interface BudgetPhaseCtx {
  /** s1-mission-budget-eval.stage.ts —— 预算闸结果 */
  budgetEval?: {
    approved: boolean;
    estimatedTokens: number;
    estimatedCostUsd: number;
    reason?: string;
  };
}

// ─── Phase 2: World（s2-world-build 产物）───────────────────────────────
export interface WorldPhaseCtx {
  /** s2-world-build.stage.ts —— 世界观设定（落库后回填） */
  worldSettings?: BibleKeeperOutput["result"]["worldSettings"];

  /** s2-world-build.stage.ts —— Story Bible 快照 */
  bibleSnapshot?: BibleKeeperOutput["result"]["snapshot"];
}

// ─── Phase 3: Outline（s3-outline-plan 产物）────────────────────────────
export interface OutlinePhaseCtx {
  /** s3-outline-plan.stage.ts —— 故事大纲 */
  outlinePlan?: StoryArchitectOutput["result"]["storyOutline"];

  /** s3-outline-plan.stage.ts —— 逐章计划（章节分解结果） */
  chapterPlan?: StoryArchitectOutput["result"]["chapterBreakdown"];
}

// ─── Phase 4: Draft（s4-chapter-fanout 逐章产物）────────────────────────
export interface DraftPhaseCtx {
  /**
   * s4-chapter-fanout.stage.ts —— 逐章草稿指针（append 语义）。
   * 只存「章 id + 状态 + 字数」指针，正文从 writingChapter 读，避免 JSON 膨胀
   * （迁移规格 §4.2）。
   */
  chapterDrafts?: Array<{
    chapterId: string;
    status: "DRAFTED" | "FAILED";
    wordCount: number;
  }>;

  /** s4-chapter-fanout.stage.ts —— 软失败章（不阻断后续章，markStageDegraded） */
  chapterFailures?: Array<{
    chapterId: string;
    reason: string;
    occurredAt: number;
  }>;
}

// ─── Phase 5: Consistency（s5-consistency-check 产物）───────────────────
export interface ConsistencyPhaseCtx {
  /** s5-consistency-check.stage.ts —— 一致性问题列表 */
  consistencyIssues?: ConsistencyIssue[];

  /** s5-consistency-check.stage.ts —— 提取的新事实 */
  extractedFacts?: NonNullable<ConsistencyCheckerOutput["extractedFacts"]>;
}

// ─── Phase 6: Edit（s6-edit-polish 产物）────────────────────────────────
export interface EditPhaseCtx {
  /**
   * s6-edit-polish.stage.ts —— 修订后章节指针（append 语义，与 chapterDrafts 同形）。
   * 正文落 writingChapter，ctx 只存指针。
   */
  revisedChapters?: Array<{
    chapterId: string;
    // M5 fix：真实章号，供 projector 按章号查标题（不再按数组下标 idx+1，
    // 否则中间章 FAILED 被过滤后幸存章会整体错位串标题）。
    chapterNumber: number;
    status: "REVISED" | "FAILED";
    wordCount: number;
  }>;

  /** s6-edit-polish.stage.ts —— 编辑统计（聚合各章 EditorOutput.stats） */
  editStats?: EditorOutput["stats"];
}

// ─── Phase 7: Quality（s7-quality-evaluate 产物，post-gen）──────────────
export interface QualityPhaseCtx {
  /** s7-quality-evaluate.stage.ts —— 质量指标 */
  qualityMetrics?: {
    overall: number;
    coherence: number;
    completeness: number;
    consistency: number;
  };

  /** s7-quality-evaluate.stage.ts —— 质量判定 */
  qualityVerdict?: {
    passed: boolean;
    score: number;
    reason?: string;
  };
}

// ─── Phase 8: Persist（s8-mission-persist 产物）─────────────────────────
export interface PersistPhaseCtx {
  /** s8-mission-persist.stage.ts —— 最终产物（含 sections[] + metadata + quality） */
  writingArtifact?: {
    id: string;
    projectId: string;
    sections: Array<{
      chapterId: string;
      chapterNumber: number;
      title: string;
      wordCount: number;
      quality?: number;
    }>;
    metadata: {
      totalWords: number;
      chapterCount: number;
    };
    quality: {
      overall: number;
      consistency: number;
      completeness: number;
    };
  };

  /** s8-mission-persist.stage.ts —— 落库的轨迹/章节数（best-effort 计数） */
  trajectoryStored?: number;
}

/**
 * WritingMissionContext —— 完整合成类型（trunk + 所有 stage 函数当前签名都用这个）。
 */
export type WritingMissionContext = WritingMissionInvariants &
  BudgetPhaseCtx &
  WorldPhaseCtx &
  OutlinePhaseCtx &
  DraftPhaseCtx &
  ConsistencyPhaseCtx &
  EditPhaseCtx &
  QualityPhaseCtx &
  PersistPhaseCtx;
