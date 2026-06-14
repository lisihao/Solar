/**
 * StewardAgent — 4 闸资源守门员
 *
 * S1 budget-eval: 预算 / session 健康 / concurrency / key 健康 4 闸表，
 * 任一闸 fail mission 立即 terminate。
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";
import { buildPromptFromDuty } from "../../services/duty-loader";

const Input = z.object({
  userId: z.string(),
  platforms: z.array(z.string()).min(1),
  remainingCreditsUsd: z.number().min(0),
  estimatedCostUsd: z.number().min(0),
  sessionExpiresAt: z.record(z.string(), z.string()),
  inProgressMissionCount: z.number().int().min(0),
  keyCooldownCount1h: z.number().int().min(0),
});

const Output = z.object({
  verdict: z.enum(["pass", "gated"]),
  gateFailed: z
    .enum(["budget", "session-expired", "concurrency", "key-health"])
    .nullable(),
  evidence: z.string(),
  estimatedCostUsd: z.number(),
  remainingCreditsUsd: z.number(),
});

export type StewardInput = z.infer<typeof Input>;
export type StewardOutput = z.infer<typeof Output>;

@DefineAgent({
  id: "social.steward",
  version: "1.0.0",
  identity: {
    role: "steward",
    description:
      "SocialPublishMission 资源守门员 —— 预算/session/concurrency/key 4 闸",
  },
  loop: "react",
  toolCategories: [],
  taskProfile: { creativity: "deterministic", outputLength: "minimal" },
  inputSchema: Input,
  outputSchema: Output,
  budget: { maxTokens: 2_000, maxIterations: 2 },
})
export class StewardAgent extends AgentSpec<typeof Input, typeof Output> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    return buildPromptFromDuty(
      "steward",
      "budget-eval",
      input as unknown as Record<string, unknown>,
    );
  }
}
