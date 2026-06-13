/**
 * ExternalJudge — 用不同 model 交叉评估 draft
 *
 * 位于：@/modules/ai-harness/evaluation/verify/primitives/
 *
 * 典型用法：Claude 评 GPT 产物、或 GPT 评 Claude 产物。因不同模型的 bias 不同，
 * 交叉评估能发现 self-judge 找不到的盲点。
 */

import type {
  AgentTask,
  Message,
  Verdict,
} from "@/modules/ai-harness/runner/env/types";
import type {
  JudgeSpec,
  LLMCaller,
  ReActExecutionContext,
} from "@/modules/ai-harness/runner/env/react-runner";
import { callJudgeLLM } from "./self-judge";

const EXTERNAL_JUDGE_SYSTEM_PROMPT = `你是一位独立的高级评审员，来自与产出者不同的模型家族。

刚才某 agent 产出了一份 draft。请独立、无偏见地评估其：
  - accuracy（事实准确性）
  - completeness（覆盖充分性）
  - coherence（逻辑连贯性）
  - evidence_quality（证据可靠性）
  - originality（洞察原创性）

每项 0-10 分，输出 JSON：
{
  "score": 0-100,
  "criteria": { ... },
  "critique": "客观评价 ≤ 500 字"
}

作为外部审查员，你应对质量负责；若 draft 有明显问题必须给 < 60 分。
`;

export interface ExternalJudgeOptions {
  readonly judgeId?: string;
  /** 交叉评估用的 model id（与 draft 产出者不同族）。传给 LLMCaller 时走 modelTier=standard 默认。 */
  readonly externalLLM?: LLMCaller;
}

export function createExternalJudge<TResult>(
  options: ExternalJudgeOptions = {},
): JudgeSpec<TResult> {
  return {
    judgeId: options.judgeId ?? "external",
    async evaluate(
      draft: TResult,
      _task: AgentTask,
      ctx: ReActExecutionContext,
    ): Promise<Omit<Verdict, "judgeId">> {
      const llm = options.externalLLM ?? ctx.llm;
      const messages: Message[] = [
        { role: "system", content: EXTERNAL_JUDGE_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            "请独立评估以下 draft：\n\n" +
            JSON.stringify(draft, null, 2).slice(0, 6000) +
            "\n\n严格输出 JSON。",
        },
      ];
      return callJudgeLLM(llm, messages, ctx.span);
    },
  };
}
