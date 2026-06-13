/**
 * StewardAgent —— 资源 / 合规 / 边界守门员
 *
 * 与 Leader 的根本区别:
 *   - Leader 管"做什么 / 做得怎么样"（业务方向 + 质量问责）
 *   - Steward 管"能不能做 / 该不该做"（资源边界 + 合规 + 风险）
 *
 * 当前唯一 scope: budget-guard（预算 token / cost 阈值警告）。
 *
 * 历史预留 scope（compliance-check / data-boundary / source-diversity）已删
 * （2026-05-15 PR-E）：从未接入 orchestrator，且 SKILL.md 也无 prompt body，
 * 留 schema 占位 = 死代码。后续真要补这些 scope 再加 SKILL.md duty + 改回
 * discriminatedUnion。
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";
import { buildPromptFromDuty } from "../_shared/skill-loader";

const Input = z.object({
  scope: z.literal("budget-guard"),
  missionId: z.string(),
  language: z.enum(["zh-CN", "en-US"]),
  snapshot: z.object({
    tokensUsed: z.number().int(),
    tokensLimit: z.number().int(),
    costUsd: z.number(),
    stagesCompleted: z.array(z.string()),
    stagesPending: z.array(z.string()),
  }),
  thresholds: z.object({
    softWarnPct: z.number().int().default(70),
    hardBlockPct: z.number().int().default(95),
  }),
});

const Alert = z.object({
  level: z.enum(["info", "warning", "block"]),
  trigger: z.string(),
  current: z.string(),
  threshold: z.string(),
  suggestedAction: z.string(),
});

const Output = z.object({
  scope: z.literal("budget-guard"),
  alerts: z.array(Alert),
});

export type StewardInput = z.infer<typeof Input>;
export type StewardOutput = z.infer<typeof Output>;

@DefineAgent({
  id: "playground.steward",
  version: "1.0.0",
  identity: {
    role: "steward",
    description: "资源守门员。budget-guard scope：预算/速率/超阈值告警。",
  },
  loop: "reflexion",
  // PR-X-skill-bridge: budget guard 协议
  skills: ["budget-stewardship"],
  toolCategories: [],
  taskProfile: {
    creativity: "deterministic",
    outputLength: "short",
    taskKind: "sanity-check",
    reasoningDepth: "minimal",
  },
  inputSchema: Input,
  outputSchema: Output,
  budget: { maxTokens: 4_000, maxIterations: 2 },
})
export class StewardAgent extends AgentSpec<typeof Input, typeof Output> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    return buildPromptFromDuty("steward", "budget-guard", input as never);
  }
}
