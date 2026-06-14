/**
 * Consensus Resolver — multi-judge 结果仲裁
 *
 * 归属：@/modules/ai-harness/evaluation/verify/primitives/
 *
 * 方案 §6.2 算法：
 *   - 全通过 → pass
 *   - 全否决 → fail
 *   - 分歧小（stddev < 10）→ pass (平均分)
 *   - 分歧中等（stddev < 25）→ escalate_to_meta（Phase 2 降级为 pass 平均分）
 *   - 分歧大 → escalate_to_human
 */

import type {
  ConsensusDecision,
  Verdict,
} from "@/modules/ai-harness/runner/env/types";
import type { ConsensusResolver } from "@/modules/ai-harness/runner/env/react-runner";

export interface ConsensusOptions {
  /** 判 pass 的分数阈值（默认 70） */
  readonly passThreshold?: number;
  /** stddev 到多少进入 escalate_to_meta（默认 10） */
  readonly agreementStddevMax?: number;
  /** stddev 到多少进入 escalate_to_human（默认 25） */
  readonly escalateStddevMax?: number;
}

export function createConsensusResolver(
  options: ConsensusOptions = {},
): ConsensusResolver {
  const passThreshold = options.passThreshold ?? 70;
  const agreementStddevMax = options.agreementStddevMax ?? 10;
  const escalateStddevMax = options.escalateStddevMax ?? 25;

  return (verdicts: readonly Verdict[]): ConsensusDecision => {
    if (verdicts.length === 0) {
      return { verdict: "pass", score: 70, note: "no verdicts, default pass" };
    }
    const scores = verdicts.map((v) => v.score);
    const avg = mean(scores);
    const passCount = verdicts.filter((v) => v.score >= passThreshold).length;

    if (passCount === verdicts.length) {
      return { verdict: "pass", score: Math.round(avg) };
    }
    if (passCount === 0) {
      return {
        verdict: "fail",
        score: Math.round(avg),
        note: allCritique(verdicts),
      };
    }

    const stdev = stddev(scores);
    if (stdev < agreementStddevMax) {
      // 分歧很小但不全通过 — 按多数判
      return passCount > verdicts.length / 2
        ? { verdict: "pass", score: Math.round(avg) }
        : {
            verdict: "fail",
            score: Math.round(avg),
            note: allCritique(verdicts),
          };
    }
    if (stdev < escalateStddevMax) {
      // 分歧中等：建议 meta 仲裁，但本 resolver 返回 escalate_to_meta 标记
      return {
        verdict: "escalate_to_meta",
        score: Math.round(avg),
        note: `judges diverge (stddev=${stdev.toFixed(1)})`,
      };
    }
    return {
      verdict: "escalate_to_human",
      score: Math.round(avg),
      note: `severe judge disagreement (stddev=${stdev.toFixed(1)})`,
    };
  };
}

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance =
    xs.reduce((acc, x) => acc + Math.pow(x - m, 2), 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

function allCritique(verdicts: readonly Verdict[]): string {
  return verdicts
    .map((v) => `[${v.judgeId}:${v.score}] ${v.critique.slice(0, 100)}`)
    .join(" | ")
    .slice(0, 500);
}
