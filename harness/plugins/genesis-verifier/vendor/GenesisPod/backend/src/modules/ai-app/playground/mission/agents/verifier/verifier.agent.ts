/**
 * VerifierAgent —— 客观事实核验员
 *
 * 与 Reviewer 的根本区别:
 *   - Reviewer 评主观质量（流畅 / 结构 / 洞察）
 *   - Verifier 核客观事实（引用是否对应真实 source）
 *
 * 当前唯一 mode: citation-audit（核 [N] 引用是否对应真实 source）。
 *
 * 历史预留 mode（number-check / claim-grounding / source-tier）已删
 * （2026-05-15 PR-E）：从未接入 orchestrator，且 SKILL.md 也无 prompt body，
 * 留 schema 占位 = 死代码。后续真要补这些 mode 再加 SKILL.md duty + 改回
 * discriminatedUnion。
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";
import { buildPromptFromDuty } from "../_shared/skill-loader";

const Citation = z.object({
  index: z.number().int(),
  url: z.string(),
  inlineQuote: z.string().optional(),
});

const Input = z.object({
  mode: z.literal("citation-audit"),
  topic: z.string(),
  language: z.enum(["zh-CN", "en-US"]),
  citations: z.array(Citation).min(1),
});

const Verdict = z.object({
  index: z.number().int().optional(),
  url: z.string().optional(),
  status: z.enum([
    "verified",
    "unverified-but-plausible",
    "unverified-suspicious",
    "contradicted",
  ]),
  evidence: z.string(),
});

const Output = z.object({
  mode: z.literal("citation-audit"),
  summary: z.object({
    total: z.number().int(),
    verified: z.number().int(),
    unverified: z.number().int(),
    contradicted: z.number().int(),
  }),
  verdicts: z.array(Verdict),
});

export type VerifierInput = z.infer<typeof Input>;
export type VerifierOutput = z.infer<typeof Output>;

@DefineAgent({
  id: "playground.verifier",
  version: "1.0.0",
  identity: {
    role: "verifier",
    description: "客观事实核验员。citation-audit mode：核 [N] 引用真伪。",
  },
  loop: "simple",
  // PR-X-skill-bridge: 引用工具核验协议
  skills: ["citation-audit"],
  // 2026-05-09 工具矩阵审计：loop="simple" 决定 verifier 一次性产出，无 ReAct
  // 循环可调 tool；之前 ["information"] 仍把 25 工具 catalog 注入 prompt 烧
  // token，对单次 LLM 评分零价值。清空。
  toolCategories: [],
  taskProfile: {
    creativity: "deterministic",
    outputLength: "medium",
    taskKind: "sanity-check",
    reasoningDepth: "minimal",
  },
  inputSchema: Input,
  outputSchema: Output,
  budget: { maxTokens: 12_000, maxIterations: 4 },
})
export class VerifierAgent extends AgentSpec<typeof Input, typeof Output> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    return buildPromptFromDuty("verifier", "citation-audit", {
      ...(input as Record<string, unknown>),
      currentDate: new Date().toISOString().slice(0, 10),
    });
  }
}
