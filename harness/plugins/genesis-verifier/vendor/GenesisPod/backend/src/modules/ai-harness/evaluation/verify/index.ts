/**
 * verify/ — AI App 的唯一 verifier 入口
 *
 * 任何业务模块需要 multi-judge / consensus / Reflexion 闭环时，
 * 只 import from "@/modules/ai-harness/evaluation/verify"（或 facade）。
 *
 * 不要直接 import primitives/* —— 那是 ReActRunner 与 JudgeService 的内部实现。
 */

export { JudgeService } from "./judge.service";
export type { BuiltInVerifierId } from "./judge.service";

// 共享算法（primitives/ 内部，re-export 让 App 用单一入口）
export { createConsensusResolver } from "./primitives/consensus";
export type { ConsensusOptions } from "./primitives/consensus";
export { MetaJudge } from "./primitives/meta-judge";

// IVerifier 契约（ReflexionLoop 在 spec.verifiers 接受这个类型）
export type { IVerifier } from "../../runner/loop/reflexion-loop";

// 类型 re-export（App 不必跨目录引用）
export type {
  Verdict,
  ConsensusDecision,
} from "@/modules/ai-harness/runner/env/types";
