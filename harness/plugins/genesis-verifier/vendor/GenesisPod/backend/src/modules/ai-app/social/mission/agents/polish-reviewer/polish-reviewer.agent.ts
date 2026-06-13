/**
 * PolishReviewerAgent — 内容润色 + 合规检查
 *
 * S7 polish-review: 4 维度评分（合规/SEO/错别字/风格），critique 必修项调
 * harness CritiqueRefineService.refine() 修订，optional 项只 emit warning。
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";
import { buildPromptFromDuty } from "../../services/duty-loader";
import { loadFormatSpec } from "../../services/skill-md-loader";

const Input = z.object({
  platform: z.string(),
  title: z.string(),
  digest: z.string().nullable(),
  bodyHtml: z.string(),
});

const Output = z.object({
  platform: z.string(),
  verdict: z.enum(["pass", "needs-refine", "reject"]),
  scores: z.object({
    compliance: z.number().int().min(0).max(100),
    seo: z.number().int().min(0).max(100),
    typo: z.number().int().min(0).max(100),
    style: z.number().int().min(0).max(100),
    /** 质量分（信息增量/不灌水/可读/准确/洞察）；< 75 视为不合格，须 refine */
    quality: z.number().int().min(0).max(100),
  }),
  fixes: z
    .array(
      z.object({
        field: z.enum(["title", "digest", "body"]),
        before: z.string(),
        after: z.string(),
      }),
    )
    .default([]),
  /**
   * verdict != pass 时必填：修订后的**完整正文 HTML**（已去灌水/补实质/修八股、
   * 满足《公众号格式规范》≥2000字+分节）。s7 会用它回写 composed.bodyHtml 真正生效。
   * verdict=pass 时为 null。
   */
  refinedBody: z.string().nullable().default(null),
  warnings: z.array(z.string()).default([]),
});

export type PolishReviewerInput = z.infer<typeof Input>;
export type PolishReviewerOutput = z.infer<typeof Output>;

@DefineAgent({
  id: "social.polish-reviewer",
  version: "1.0.0",
  identity: {
    role: "polish-reviewer",
    description:
      "内容润色 + SEO + 合规 —— 复用 CritiqueRefineService critique+refine",
  },
  loop: "react",
  toolCategories: [],
  taskProfile: { creativity: "low", outputLength: "medium" },
  inputSchema: Input,
  outputSchema: Output,
  budget: { maxTokens: 6_000, maxIterations: 3 },
})
export class PolishReviewerAgent extends AgentSpec<
  typeof Input,
  typeof Output
> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    // 复审对照与 content-transformer 同一份《公众号格式规范》（单一真源，避免漂移）
    const platformFormat =
      input.platform === "WECHAT_MP" ? loadFormatSpec("wechat-mp") : "";
    return buildPromptFromDuty("polish-reviewer", "polish-review", {
      ...(input as unknown as Record<string, unknown>),
      platformFormat,
    });
  }
}
