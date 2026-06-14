/**
 * writing.config.ts — WritingMission Pipeline 配置
 *
 * 把 writing 编排层的 8 个 stage（s1-s8）声明为 generic primitive，由 harness
 * MissionPipelineOrchestrator 顺序执行。`full_story` 为超集（s1→s8 全量），其余
 * task type 走 step 子集（各自独立 pipeline id，复用同一批 stage runner，stepId
 * 全局唯一即可跨 pipeline 复用，见迁移规格 §1.3）。
 *
 * 设计要点（参照 social/runtime/social.config.ts）：
 *   - 所有 step 用 primitive="persist"：writing 各 stage 都是「读写 ctx + side-effect」
 *     操作（写 Bible / writingChapter / project wordCount + 写 ctx），与 persist
 *     primitive 的单 hook 形态（hooks.persist({ ctx, ... })）天然契合。
 *   - 真实业务 LLM 调用在 stage adapter 内通过 AgentInvoker → AgentRunner 完成；
 *     本 config 只声明 step 顺序 + 元数据（timeoutMs / meta）。
 *   - roles 列表为空：persist primitive 不需要 ResolvedRole；agent 调用走 role
 *     service 薄包 invoker（AgentSpec 由 @DefineAgent 注册）。
 *   - dispatcher 按 input.missionType 选 pipeline → selectWritingPipeline(missionType)。
 *
 * step id 命名对齐 social（sN-<动词短语>），全局唯一（见迁移规格 §pipelineSteps）：
 *   s1-mission-budget-eval / s2-world-build / s3-outline-plan / s4-chapter-fanout /
 *   s5-consistency-check / s6-edit-polish / s7-quality-evaluate / s8-mission-persist
 */

import {
  defineMissionPipeline,
  type MissionPipelineConfig,
} from "@/modules/ai-harness/facade";

import type { WritingMissionType } from "../../services/mission/writing-mission.types";

// ─── step 元数据常量（逐 step timeoutMs，参照迁移规格 §1.2）──────────────
const S1_BUDGET = {
  primitive: "persist" as const,
  id: "s1-mission-budget-eval",
  timeoutMs: 60_000,
};
const S2_WORLD = {
  primitive: "persist" as const,
  id: "s2-world-build",
  timeoutMs: 120_000,
};
const S3_OUTLINE = {
  primitive: "persist" as const,
  id: "s3-outline-plan",
  timeoutMs: 120_000,
};
const S4_FANOUT = {
  primitive: "persist" as const,
  id: "s4-chapter-fanout",
  // 逐章 fan-out 是大头（迁移规格 §1.4），给足 30min
  timeoutMs: 30 * 60_000,
};
const S5_CONSISTENCY = {
  primitive: "persist" as const,
  id: "s5-consistency-check",
  timeoutMs: 300_000,
};
const S6_EDIT = {
  primitive: "persist" as const,
  id: "s6-edit-polish",
  timeoutMs: 300_000,
};
const S7_QUALITY = {
  primitive: "persist" as const,
  id: "s7-quality-evaluate",
  timeoutMs: 300_000,
};
const S8_PERSIST = {
  primitive: "persist" as const,
  id: "s8-mission-persist",
  timeoutMs: 60_000,
};

const DEFAULT_STEP_TIMEOUT_MS = 10 * 60_000;

/**
 * 超集 pipeline（full_story）：s1→s8 全量。
 */
export const WRITING_FULL_STORY_PIPELINE: MissionPipelineConfig =
  defineMissionPipeline({
    id: "writing-full-story-mission",
    roles: [],
    steps: [
      S1_BUDGET,
      S2_WORLD,
      S3_OUTLINE,
      S4_FANOUT,
      S5_CONSISTENCY,
      S6_EDIT,
      S7_QUALITY,
      S8_PERSIST,
    ],
    defaultStepTimeoutMs: DEFAULT_STEP_TIMEOUT_MS,
    meta: {
      description: "AI Writing Full-Story Mission",
      eventPrefix: "writing",
      runtimeVersion: "writing-pipeline-v1",
    },
  });

/**
 * 单章 pipeline（chapter）：s1 → s4(单章模式) → s5 → s6 → s8。
 * 跳过 s2(世界观)/s3(大纲)/s7(质量评估)，见迁移规格 §1.3。
 */
export const WRITING_CHAPTER_PIPELINE: MissionPipelineConfig =
  defineMissionPipeline({
    id: "writing-chapter-mission",
    roles: [],
    steps: [S1_BUDGET, S4_FANOUT, S5_CONSISTENCY, S6_EDIT, S8_PERSIST],
    defaultStepTimeoutMs: DEFAULT_STEP_TIMEOUT_MS,
    meta: {
      description: "AI Writing Single-Chapter Mission",
      eventPrefix: "writing",
      runtimeVersion: "writing-pipeline-v1",
    },
  });

/**
 * 大纲 pipeline（outline）：s1 → s2 → s3 → s8。只到大纲，不写正文。
 */
export const WRITING_OUTLINE_PIPELINE: MissionPipelineConfig =
  defineMissionPipeline({
    id: "writing-outline-mission",
    roles: [],
    steps: [S1_BUDGET, S2_WORLD, S3_OUTLINE, S8_PERSIST],
    defaultStepTimeoutMs: DEFAULT_STEP_TIMEOUT_MS,
    meta: {
      description: "AI Writing Outline Mission",
      eventPrefix: "writing",
      runtimeVersion: "writing-pipeline-v1",
    },
  });

/**
 * 一致性检查 pipeline（consistency_check）：s1 → s5 → s8。
 * 对已有章做一致性检查。
 */
export const WRITING_CONSISTENCY_PIPELINE: MissionPipelineConfig =
  defineMissionPipeline({
    id: "writing-consistency-mission",
    roles: [],
    steps: [S1_BUDGET, S5_CONSISTENCY, S8_PERSIST],
    defaultStepTimeoutMs: DEFAULT_STEP_TIMEOUT_MS,
    meta: {
      description: "AI Writing Consistency-Check Mission",
      eventPrefix: "writing",
      runtimeVersion: "writing-pipeline-v1",
    },
  });

/**
 * 修订/润色 pipeline（revision / edit）：s1 → s5 → s6 → s8。
 * 对已有章修订/润色。注：edit 为 TS-only 值，DB 映射回 CHAPTER（见迁移规格 §4.2）。
 */
export const WRITING_EDIT_PIPELINE: MissionPipelineConfig =
  defineMissionPipeline({
    id: "writing-edit-mission",
    roles: [],
    steps: [S1_BUDGET, S5_CONSISTENCY, S6_EDIT, S8_PERSIST],
    defaultStepTimeoutMs: DEFAULT_STEP_TIMEOUT_MS,
    meta: {
      description: "AI Writing Revision/Edit Mission",
      eventPrefix: "writing",
      runtimeVersion: "writing-pipeline-v1",
    },
  });

/**
 * 按 input.missionType 选择 pipeline（吃 TS 6 值，落库仍走 DB 5 值映射，
 * 两套不混，见迁移规格 §4.3）。
 */
export function selectWritingPipeline(
  missionType: WritingMissionType,
): MissionPipelineConfig {
  switch (missionType) {
    case "full_story":
      return WRITING_FULL_STORY_PIPELINE;
    case "chapter":
      return WRITING_CHAPTER_PIPELINE;
    case "outline":
      return WRITING_OUTLINE_PIPELINE;
    case "consistency_check":
      return WRITING_CONSISTENCY_PIPELINE;
    case "revision":
    case "edit":
      return WRITING_EDIT_PIPELINE;
    default: {
      // 穷尽性检查：新增 missionType 时编译期报错
      const _exhaustive: never = missionType;
      return _exhaustive;
    }
  }
}
