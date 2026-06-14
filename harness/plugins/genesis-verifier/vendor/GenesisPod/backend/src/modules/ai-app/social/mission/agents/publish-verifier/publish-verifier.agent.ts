/**
 * PublishVerifierAgent — 发布后回读校验员
 *
 * S9 verify-publish: 4 维度真实回读
 *   1. URL 可达 (HTTP 200)
 *   2. 内容 diff (title/body levenshtein vs sent)
 *   3. 图片可访问 (HEAD 200 比例)
 *   4. 平台 ack (WeChat draft 列表 / XHS published)
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";
import { buildPromptFromDuty } from "../../services/duty-loader";

const Input = z.object({
  platform: z.string(),
  publishedUrl: z.string(),
  sentTitle: z.string(),
  sentBodyText: z.string(),
  contextId: z.string(),
});

const Output = z.object({
  platform: z.string(),
  url: z.string(),
  verified: z.boolean(),
  diffPercent: z.number().min(0).max(100),
  imageHealthRatio: z.string(),
  platformStatus: z.string(),
  warnings: z.array(z.string()).default([]),
});

export type PublishVerifierInput = z.infer<typeof Input>;
export type PublishVerifierOutput = z.infer<typeof Output>;

@DefineAgent({
  id: "social.publish-verifier",
  version: "1.0.0",
  identity: {
    role: "publish-verifier",
    description: "发布后回读校验 —— URL/diff/image/ack 4 维度",
  },
  loop: "react",
  toolCategories: ["automation", "information"],
  taskProfile: { creativity: "deterministic", outputLength: "short" },
  inputSchema: Input,
  outputSchema: Output,
  budget: { maxTokens: 3_000, maxIterations: 3 },
})
export class PublishVerifierAgent extends AgentSpec<
  typeof Input,
  typeof Output
> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    return buildPromptFromDuty(
      "publish-verifier",
      "verify-publish",
      input as unknown as Record<string, unknown>,
    );
  }
}
