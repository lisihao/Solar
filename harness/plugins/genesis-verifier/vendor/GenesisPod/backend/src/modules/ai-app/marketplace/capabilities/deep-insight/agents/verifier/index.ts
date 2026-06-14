/**
 * Verifier stage agent — barrel export
 *
 * 客观事实核验员，当前唯一 mode: citation-audit（核 [N] 引用是否对应真实 source）。
 * 历史预留 mode（number-check / claim-grounding / source-tier）已删
 * （2026-05-15 PR-E），从未接入 orchestrator 也无 SKILL.md duty body。
 */

export {
  VerifierAgent,
  type VerifierInput,
  type VerifierOutput,
} from "./verifier.agent";
