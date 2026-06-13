/**
 * SelfJudge — 同 agent 用更严格配置自评
 *
 * 位于：@/modules/ai-harness/evaluation/verify/primitives/ — 通用能力
 *
 * 实现原则：
 *   - 用 LLM 的"低温严谨"模式对 draft 做事后评估
 *   - 发现自己有偏的可能性；catch "我说服了自己" 的错
 *   - 参考：Reflexion / Self-RAG / Constitutional AI
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

const SELF_EVAL_SYSTEM_PROMPT = `你是同一个 agent 的"严格评估员"身份。刚才你产出了一份 draft，
现在用低温度、高标准重新审视。

评估维度（每项 0-10 分）：
  - accuracy        · 事实准确
  - completeness    · 覆盖充分
  - coherence       · 逻辑连贯
  - evidence_quality· 证据可靠
  - originality     · 洞察原创

输出 JSON：
{
  "score": 0-100,
  "criteria": { "accuracy": 0-10, ... },
  "critique": "一段中肯的批评 ≤ 500 字"
}

严格：发现任何明显缺陷都要扣分；模糊处宁可扣分。
`;

export interface SelfJudgeOptions {
  readonly judgeId?: string;
}

export function createSelfJudge<TResult>(
  options: SelfJudgeOptions = {},
): JudgeSpec<TResult> {
  return {
    judgeId: options.judgeId ?? "self",
    async evaluate(
      draft: TResult,
      _task: AgentTask,
      ctx: ReActExecutionContext,
    ): Promise<Omit<Verdict, "judgeId">> {
      const messages: Message[] = [
        { role: "system", content: SELF_EVAL_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            "请评估以下 draft：\n\n" +
            JSON.stringify(draft, null, 2).slice(0, 6000) +
            "\n\n严格输出 JSON。",
        },
      ];
      return callJudgeLLM(ctx.llm, messages, ctx.span);
    },
  };
}

/**
 * 公用 helper：调 LLM 产出 JSON verdict，解析失败 fallback 50 分。
 */
export async function callJudgeLLM(
  llm: LLMCaller,
  messages: Message[],
  span: { traceId: string; spanId: string } & {
    setAttributes: (a: Record<string, unknown>) => void;
    end: (a?: Record<string, unknown>) => void;
    recordException: (e: Error) => void;
    parentSpanId?: string;
    name: string;
    attributes: Record<string, unknown>;
    startedAt: number;
  },
): Promise<Omit<Verdict, "judgeId">> {
  try {
    const res = await llm.call({
      messages,
      modelTier: "standard",
      span: span as never, // Span 类型在运行时对齐（harness span object）
    });
    const parsed = tryParseJson(res.content);
    if (parsed && typeof parsed.score === "number") {
      return {
        score: Math.max(0, Math.min(100, parsed.score)),
        critique: (parsed.critique ?? "").slice(0, 500),
        criteria: parsed.criteria ?? undefined,
        modelId: res.modelId,
      };
    }
  } catch {
    // fallthrough
  }
  return { score: 50, critique: "judge LLM 解析失败，fallback 50 分" };
}

function tryParseJson(text: string): {
  score?: number;
  critique?: string;
  criteria?: Record<string, number>;
} | null {
  // 容忍 ```json ... ``` fence
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const body = fence ? fence[1] : text;
  try {
    return JSON.parse(body) as {
      score?: number;
      critique?: string;
      criteria?: Record<string, number>;
    };
  } catch {
    return null;
  }
}
