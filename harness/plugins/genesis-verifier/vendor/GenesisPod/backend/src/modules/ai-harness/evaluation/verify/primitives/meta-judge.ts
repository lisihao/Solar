/**
 * MetaJudge — 分歧仲裁（consensus 判 escalate_to_meta 时调）
 *
 * 归属：@/modules/ai-harness/evaluation/verify/primitives/
 *
 * 用更强的 model 读各 judge 的 critique 做最终裁决，产出 pass/fail + 解释。
 */

import type {
  Message,
  Verdict,
  ConsensusDecision,
} from "@/modules/ai-harness/runner/env/types";
import type { LLMCaller } from "@/modules/ai-harness/runner/env/react-runner";
import { callJudgeLLM } from "./self-judge";

const META_JUDGE_SYSTEM_PROMPT = `你是一位 meta 级评审员。下面有多位 judge 对同一 draft 的评价，他们分数分歧明显。

请基于他们的 critique 内容、不看 draft 原文，仲裁 pass / fail，并给出一句解释。

输出 JSON：
{
  "score": 0-100,   // 综合分
  "verdict": "pass" | "fail",
  "critique": "仲裁说明 ≤ 200 字"
}
`;

/**
 * MetaJudge 对外只暴露 resolve 方法（不实现 JudgeSpec，因为它不评估 draft 本身）。
 */
export class MetaJudge {
  constructor(private readonly llm: LLMCaller) {}

  async resolve(verdicts: readonly Verdict[]): Promise<ConsensusDecision> {
    const messages: Message[] = [
      { role: "system", content: META_JUDGE_SYSTEM_PROMPT },
      {
        role: "user",
        content:
          "以下 judges 的评价：\n\n" +
          verdicts
            .map(
              (v) =>
                `[${v.judgeId}] score=${v.score}\ncritique: ${v.critique.slice(0, 500)}`,
            )
            .join("\n\n") +
          "\n\n请仲裁。",
      },
    ];
    // 借用 self-judge 里的 callJudgeLLM（通用 JSON 解析）
    const rawSpan = {
      traceId: "meta",
      spanId: "meta",
      parentSpanId: undefined,
      name: "meta",
      attributes: {},
      startedAt: Date.now(),
      setAttributes: () => undefined,
      end: () => undefined,
      recordException: () => undefined,
    };
    const out = await callJudgeLLM(this.llm, messages, rawSpan);
    const avgScore = out.score;
    // 解析 verdict 如果没有就按 score 自动判
    const verdict: ConsensusDecision["verdict"] =
      avgScore >= 70 ? "pass" : "fail";
    return {
      verdict,
      score: Math.round(avgScore),
      note: out.critique,
    };
  }
}
