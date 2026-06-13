/**
 * verification barrel
 *
 * 归属：@/modules/ai-harness/evaluation/verify/primitives/
 */

export {
  createSelfJudge,
  callJudgeLLM,
  type SelfJudgeOptions,
} from "./self-judge";
export {
  createExternalJudge,
  type ExternalJudgeOptions,
} from "./external-judge";
export { createConsensusResolver, type ConsensusOptions } from "./consensus";
export { MetaJudge } from "./meta-judge";

/**
 * 注：JudgeService（AI App 的 verifier 入口）已移至 ../verify/。
 * 本目录是 ReActRunner 的内部 JudgeSpec 工厂；App 层不要从这里 import。
 */
