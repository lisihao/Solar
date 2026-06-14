/**
 * PublishExecutorAgent — 平台真实发布执行员
 *
 * Social 独有 agent（playground 无对标）—— 唯一产生副作用的角色。
 *
 * S8 publish-to-platform: WeChat 通过 browser-context goto + evaluate (saveDraft) /
 * XHS 通过 XhsMcpAdapter / Twitter 通过 BYOK key + WebhookTrigger。
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";
import { buildPromptFromDuty } from "../../services/duty-loader";

const Input = z.object({
  platform: z.string(),
  contextId: z.string(),
  platformVersion: z.object({
    title: z.string(),
    digest: z.string().nullable(),
    bodyHtml: z.string(),
    coverUrl: z.string(),
    thumbMediaId: z.string().nullable(),
    cropMultiList: z.array(z.unknown()).default([]),
  }),
  connectionId: z.string(),
});

const Output = z.object({
  platform: z.string(),
  status: z.enum(["PUBLISHED", "DRAFT", "FAILED"]),
  platformResponse: z.record(z.string(), z.unknown()),
  draftUrl: z.string().nullable(),
  retriedTimes: z.number().int().min(0),
});

export type PublishExecutorInput = z.infer<typeof Input>;
export type PublishExecutorOutput = z.infer<typeof Output>;

@DefineAgent({
  id: "social.publish-executor",
  version: "1.0.0",
  identity: {
    role: "publish-executor",
    description: "平台真实发布执行员 —— browser-context op + ret code 重试矩阵",
  },
  loop: "react",
  toolCategories: ["automation"],
  taskProfile: { creativity: "deterministic", outputLength: "short" },
  inputSchema: Input,
  outputSchema: Output,
  budget: { maxTokens: 4_000, maxIterations: 5, maxIterationsHardCap: 6 },
})
export class PublishExecutorAgent extends AgentSpec<
  typeof Input,
  typeof Output
> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    return buildPromptFromDuty(
      "publish-executor",
      "publish-to-platform",
      input as unknown as Record<string, unknown>,
    );
  }
}
