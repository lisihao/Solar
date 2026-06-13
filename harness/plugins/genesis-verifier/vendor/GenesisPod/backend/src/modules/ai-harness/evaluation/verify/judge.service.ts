/**
 * JudgeService — AI App / ReflexionLoop 的唯一 verifier 入口
 *
 * 设计分层：
 *   - verify/             ← AI App 唯一进入点（轻量，依赖 AiChatService），本文件
 *   - verify/primitives/  ← ReActRunner 内部 JudgeSpec 工厂（签名重 + 纯算法 consensus/MetaJudge）
 *
 * 共享算法（createConsensusResolver / MetaJudge / Verdict 类型）从
 * verify/primitives/ re-export 出去，App 永远只 `import from "@/ai-harness/evaluation/verify"`。
 *
 * 内置 verifiers：
 *   - self      · 同模型严苛自评（低 temp）
 *   - external  · 独立评审视角（不同模型族）
 *   - critical  · 批判性审查（找逻辑漏洞 / 缺论证 / 过度自信）
 *
 * Consensus：
 *   - 单 verifier 直接返回；多 verifier 走 createConsensusResolver（复用 runtime 算法）
 *   - 分歧严重时由 MetaJudge 仲裁
 */

import { Injectable, Logger } from "@nestjs/common";
import { AiChatService } from "../../../ai-engine/llm/chat/ai-chat.service";
import type { IVerifier } from "../../runner/loop/reflexion-loop";
import type { IContextEnvelope } from "../../agents/abstractions";
import { createConsensusResolver } from "./primitives/consensus";
import type {
  Verdict,
  ConsensusDecision,
} from "@/modules/ai-harness/runner/env/types";
import { AIModelType } from "@prisma/client";
import { MissionContext } from "../../../../common/context/mission-context";

export type BuiltInVerifierId = "self" | "external" | "critical";

const SELF_PROMPT = `You are a strict self-evaluator. Re-read the draft critically.
Score 0-100 across: accuracy, completeness, coherence, evidence, originality.
Be tough — flag any vague or unsupported claims.

Output JSON only:
{ "score": 0-100, "critique": "<= 400 chars" }`;

const EXTERNAL_PROMPT = `You are an independent senior reviewer from a different model family.
Evaluate the draft impartially across accuracy, completeness, coherence, evidence, originality.
If there is any obvious flaw the score must be < 60.

Output JSON only:
{ "score": 0-100, "critique": "<= 400 chars" }`;

const CRITICAL_PROMPT = `You are a critical-review specialist. Look for:
  - logical fallacies / non-sequiturs
  - missing counter-arguments
  - over-confident claims without evidence
  - unstated assumptions

Score 0-100. Lower scores for any flaw found.

Output JSON only:
{ "score": 0-100, "critique": "<= 400 chars" }`;

const PROMPTS: Record<BuiltInVerifierId, string> = {
  self: SELF_PROMPT,
  external: EXTERNAL_PROMPT,
  critical: CRITICAL_PROMPT,
};

/**
 * ★ P1-D (2026-04-29): 三 verifier 跨 model family 路由
 *
 * 业界 SOTA (Anthropic / o1) 用"不同模型族"做 consensus，避免同模型自评相关性高、
 * consensus 失真。本项目通过 AIModelType 让用户 BYOK 时自然路由到不同模型：
 *
 *   - self     → CHAT      writer 主模型严苛自评（捕捉模型自身 bias）
 *   - external → EVALUATOR 用户配置的独立评审模型（最可能不同 family；未配置则回落 CHAT）
 *   - critical → CHAT_FAST 不同 tier 模型（Haiku/mini/Flash 等，常与 CHAT 不同 family）
 *
 * 当用户未配置某 type 时，AiChatService 会自动 fallback 到 CHAT —— 不破坏现有行为。
 * 用户配置不同 family 时（如 CHAT=Sonnet / EVALUATOR=GPT-4o / CHAT_FAST=Haiku），
 * consensus 真正去相关，分数更可信。
 */
const MODEL_TYPE_BY_VERIFIER: Record<BuiltInVerifierId, AIModelType> = {
  self: AIModelType.CHAT,
  external: AIModelType.EVALUATOR,
  critical: AIModelType.CHAT_FAST,
};

@Injectable()
export class JudgeService {
  private readonly logger = new Logger(JudgeService.name);

  constructor(private readonly chat: AiChatService) {}

  /** 创建一个内置 verifier。可在 spec.verifiers 里直接 by-id 引用。
   *
   * ★ 2026-04-30 行为变更（治"critical 永远 50 分污染 composite"）：
   *   - parse 失败 / chat throw → 返回 **null**（abstain），上层 reflexion-loop /
   *     consensus 会跳过本 verdict，不再用兜底 50 分把 composite 一直拉低。
   */
  createVerifier(id: BuiltInVerifierId): IVerifier {
    return {
      id,
      evaluate: async ({ output, signal }) => {
        const draft =
          typeof output === "string" ? output : JSON.stringify(output, null, 2);
        try {
          const res = await this.chat.chat({
            systemPrompt: PROMPTS[id],
            messages: [
              {
                role: "user",
                content: `Evaluate this draft:\n\n${draft.slice(0, 8000)}`,
              },
            ],
            taskProfile: { creativity: "deterministic", outputLength: "short" },
            responseFormat: "json",
            // ★ P1-D (2026-04-29): 按 verifier id 路由到不同 modelType，
            // 让 BYOK 用户的 consensus 真正去相关。未配置某 type 时 chat()
            // 内部会自动 fallback 到 CHAT，不破坏现有行为。
            modelType: MODEL_TYPE_BY_VERIFIER[id],
            userId: MissionContext.get()?.userId,
            signal,
          });
          // 2026-05-13 #53: AiChatService 在 guardrail block 时返回
          // content="Request blocked by content safety guardrail: ..." + isError=true，
          // 不抛异常。JudgeService 此前忽略 isError，直接 parseVerdict → null →
          // 误以为"模型输出非 JSON"。改为先识别 guardrail/error 短路，静默 abstain。
          if (
            (res as { isError?: boolean }).isError ||
            /^Request blocked by content safety guardrail/i.test(
              res.content ?? "",
            ) ||
            /^Response filtered by content safety guardrail/i.test(
              res.content ?? "",
            )
          ) {
            this.logger.debug(
              `[judge:${id}] AiChatService returned guardrail/error placeholder — abstain.`,
            );
            return null;
          }
          const parsed = this.parseVerdict(res.content);
          if (!parsed) {
            this.logger.warn(
              `[judge:${id}] parseVerdict 返回 null — 模型输出非 JSON。原始 head=${res.content.slice(0, 200)}`,
            );
            return null;
          }
          return parsed;
        } catch (err) {
          this.logger.warn(
            `[judge:${id}] evaluation failed (abstain): ${err instanceof Error ? err.message : String(err)}`,
          );
          return null;
        }
      },
    };
  }

  /**
   * 用一组 verifier id 直接拼一组 IVerifier 数组（喂给 ReflexionLoop spec.verifiers）。
   */
  createVerifiers(ids: readonly BuiltInVerifierId[]): IVerifier[] {
    return ids.map((id) => this.createVerifier(id));
  }

  /**
   * 直接对 output 跑一组 verifier 并 consensus。返回 ConsensusDecision。
   * 业务方需要"先算分再决定下一步"时用此入口（ReflexionLoop 内部不用此 API）。
   */
  async judgeWithConsensus(input: {
    output: unknown;
    envelope: IContextEnvelope;
    verifierIds: readonly BuiltInVerifierId[];
    signal?: AbortSignal;
    passThreshold?: number;
  }): Promise<{ verdicts: Verdict[]; decision: ConsensusDecision }> {
    const verifiers = this.createVerifiers(input.verifierIds);
    // ★ 2026-04-30: evaluate() 返回 null 视为 abstain，从 consensus 中剔除。
    const raw = await Promise.all(
      verifiers.map(async (v) => {
        const r = await v.evaluate({
          output: input.output,
          envelope: input.envelope,
          signal: input.signal,
        });
        return r
          ? { judgeId: v.id, score: r.score, critique: r.critique }
          : null;
      }),
    );
    const verdicts: Verdict[] = raw.filter((v): v is Verdict => v !== null);
    const resolver = createConsensusResolver({
      passThreshold: input.passThreshold ?? 70,
    });
    return { verdicts, decision: resolver(verdicts) };
  }

  /**
   * ★ 2026-04-30: 增强容错 — 小模型经常输出"前导文字 + JSON 块 + 后续解释"。
   * 三步尝试：
   *   1. 先剥 ```json...``` 围栏
   *   2. 直接 JSON.parse
   *   3. 失败则正则抽第一个 {...} 块（覆盖 'Here is my evaluation: {...} done.' 之类）
   */
  private parseVerdict(
    raw: string,
  ): { score: number; critique: string } | null {
    let text = raw.trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fence) text = fence[1].trim();

    const tryParse = (
      candidate: string,
    ): { score: number; critique: string } | null => {
      try {
        const obj = JSON.parse(candidate) as {
          score?: unknown;
          critique?: unknown;
        };
        if (typeof obj.score === "number") {
          return {
            score: Math.max(0, Math.min(100, obj.score)),
            critique:
              typeof obj.critique === "string"
                ? obj.critique.slice(0, 500)
                : "",
          };
        }
      } catch {
        /* fall through */
      }
      return null;
    };

    const direct = tryParse(text);
    if (direct) return direct;

    // 抽取第一个 { ... } JSON 对象（贪婪匹配带 score 字段的对象）
    const objMatch = text.match(/\{[\s\S]*?"score"[\s\S]*?\}/);
    if (objMatch) {
      const extracted = tryParse(objMatch[0]);
      if (extracted) return extracted;
    }
    return null;
  }
}
