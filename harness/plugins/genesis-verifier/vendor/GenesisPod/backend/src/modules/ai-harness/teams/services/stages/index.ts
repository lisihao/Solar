/**
 * Stage primitives 桶（v5.1 R1-A）
 *
 * 7 核心 + 2 内置无 LLM = 9 个 primitive，全部 generic / business-agnostic；
 * 业务专属逻辑通过 hooks + crossStageState 注入。
 */

// abstractions
export * from "./abstractions";

// 7 个核心 primitive
export {
  PLAN_PRIMITIVE,
  type PlanStageOutput,
  type PlanStageHooks,
} from "./plan.primitive";
export {
  RESEARCH_PRIMITIVE,
  type ResearchStageOutput,
  type ResearchStageHooks,
} from "./research.primitive";
export {
  ASSESS_PRIMITIVE,
  type AssessStageOutput,
  type AssessStageHooks,
  type AssessDecision,
} from "./assess.primitive";
export {
  SYNTHESIZE_PRIMITIVE,
  type SynthesizeStageOutput,
  type SynthesizeStageHooks,
} from "./synthesize.primitive";
export {
  DRAFT_PRIMITIVE,
  type DraftStageOutput,
  type DraftStageHooks,
} from "./draft.primitive";
export {
  REVIEW_PRIMITIVE,
  type ReviewStageOutput,
  type ReviewStageHooks,
} from "./review.primitive";
export {
  SIGNOFF_PRIMITIVE,
  type SignoffStageOutput,
  type SignoffStageHooks,
} from "./signoff.primitive";

// 2 个内置无 LLM
export {
  PERSIST_PRIMITIVE,
  type PersistStageOutput,
  type PersistStageHooks,
} from "./persist.primitive";
export {
  LEARN_PRIMITIVE,
  type LearnStageOutput,
  type LearnStageHooks,
} from "./learn.primitive";

// 全 primitive 列表（PipelineRegistry 注册用）
import { PLAN_PRIMITIVE } from "./plan.primitive";
import { RESEARCH_PRIMITIVE } from "./research.primitive";
import { ASSESS_PRIMITIVE } from "./assess.primitive";
import { SYNTHESIZE_PRIMITIVE } from "./synthesize.primitive";
import { DRAFT_PRIMITIVE } from "./draft.primitive";
import { REVIEW_PRIMITIVE } from "./review.primitive";
import { SIGNOFF_PRIMITIVE } from "./signoff.primitive";
import { PERSIST_PRIMITIVE } from "./persist.primitive";
import { LEARN_PRIMITIVE } from "./learn.primitive";
import type { IStagePrimitive } from "./abstractions";

export const ALL_STAGE_PRIMITIVES: ReadonlyArray<IStagePrimitive> = [
  PLAN_PRIMITIVE,
  RESEARCH_PRIMITIVE,
  ASSESS_PRIMITIVE,
  SYNTHESIZE_PRIMITIVE,
  DRAFT_PRIMITIVE,
  REVIEW_PRIMITIVE,
  SIGNOFF_PRIMITIVE,
  PERSIST_PRIMITIVE,
  LEARN_PRIMITIVE,
];
