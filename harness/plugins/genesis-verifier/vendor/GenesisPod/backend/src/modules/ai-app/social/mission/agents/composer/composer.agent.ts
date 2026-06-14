/**
 * ComposerAgent — 正文 HTML 编排员
 *
 * S6 compose-body: 把 ContentTransformer 输出的正文注入平台 HTML schema：
 * - WeChat: rich_pages wxw-img / js_insertlocalimg / data-imgfileid（PR #111 字节级）
 * - XHS: 段落 ≤500 字符切分 / 移除外链 / plain text
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";
import { buildPromptFromDuty } from "../../services/duty-loader";

const Input = z.object({
  platform: z.string(),
  body: z.string(),
  contextId: z.string(),
});

const Output = z.object({
  platform: z.string(),
  bodyHtml: z.string(),
  imageUploadStats: z.object({
    total: z.number().int().min(0),
    uploaded: z.number().int().min(0),
    failed: z.number().int().min(0),
    fallback: z.number().int().min(0),
  }),
  bodyChars: z.number().int().min(0),
});

export type ComposerInput = z.infer<typeof Input>;
export type ComposerOutput = z.infer<typeof Output>;

@DefineAgent({
  id: "social.composer",
  version: "1.0.0",
  identity: {
    role: "composer",
    description: "正文 HTML schema 注入 —— rich_pages wxw-img 字节级 schema",
  },
  loop: "react",
  toolCategories: ["automation"],
  taskProfile: { creativity: "deterministic", outputLength: "medium" },
  inputSchema: Input,
  outputSchema: Output,
  budget: { maxTokens: 8_000, maxIterations: 4 },
})
export class ComposerAgent extends AgentSpec<typeof Input, typeof Output> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    return buildPromptFromDuty(
      "composer",
      "compose-body",
      input as unknown as Record<string, unknown>,
    );
  }
}
