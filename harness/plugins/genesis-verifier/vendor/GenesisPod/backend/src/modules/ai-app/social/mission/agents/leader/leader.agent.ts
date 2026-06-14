/**
 * LeaderAgent — SocialPublishMission 唯一最终负责对象
 *
 * 4 个 milestone phase:
 *   M0 plan            — 决定发布平台 + 内容版本策略
 *   M1 assess-transform — 评审 ContentTransformer 输出
 *   M6 foreword        — 发布前总览
 *   M7 signoff         — 发布后签字交付
 *
 * Prompt 不嵌 .ts，走 SKILL.md `<!-- duty:<phase>:start -->` body anchor 由
 * duty-loader 加载并模板渲染（mirror playground 模式）。
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";
import { buildPromptFromDuty } from "../../services/duty-loader";

const PlatformPlan = z.object({
  platform: z.string(),
  needsContentTransform: z.boolean(),
  transformReason: z.string().optional(),
  needsCoverGeneration: z.boolean(),
  coverReason: z.string().optional(),
  needsComposeSchema: z.boolean(),
  composeReason: z.string().optional(),
  qualityBar: z.enum(["quick", "standard", "deep"]),
  expectedRiskAreas: z.array(z.string()).default([]),
});

const PlatformVersion = z.object({
  platform: z.string(),
  title: z.string(),
  digest: z.string().optional(),
  body: z.string(),
  lengthMetrics: z.object({
    titleChars: z.number().int(),
    digestChars: z.number().int().optional(),
    bodyChars: z.number().int(),
  }),
});

const Input = z.discriminatedUnion("phase", [
  z.object({
    phase: z.literal("plan"),
    title: z.string(),
    rawContent: z.object({
      title: z.string(),
      body: z.string(),
      digest: z.string().nullable(),
      coverImageUrl: z.string().nullable(),
      images: z.array(z.string()).default([]),
    }),
    platforms: z.array(z.string()).min(1),
    connections: z.record(
      z.string(),
      z.object({ sessionDataAvailable: z.boolean() }),
    ),
  }),
  z.object({
    phase: z.literal("assess-transform"),
    platformVersions: z.array(PlatformVersion).min(1),
    qualityBar: z.enum(["quick", "standard", "deep"]),
  }),
  z.object({
    phase: z.literal("foreword"),
    platformVersions: z.array(PlatformVersion).min(1),
    risks: z.array(z.string()).default([]),
  }),
  z.object({
    phase: z.literal("signoff"),
    platformResults: z.array(
      z.object({
        platform: z.string(),
        // 2026-05-19: 加 'DRAFT' — publish-executor 发布到草稿箱时返这个状态
        //   （平台没有"立即发布"语义，公众号都是草稿）。之前 schema 只允许
        //   PUBLISHED/FAILED/DEGRADED，DRAFT mission 在 s11 signoff 卡死。
        status: z.enum(["PUBLISHED", "DRAFT", "FAILED", "DEGRADED"]),
        url: z.string().nullable(),
        verifierDiff: z.number().min(0).max(1).nullable(),
      }),
    ),
  }),
]);

const Output = z.discriminatedUnion("phase", [
  z.object({
    phase: z.literal("plan"),
    plans: z.array(PlatformPlan).min(1),
  }),
  z.object({
    phase: z.literal("assess-transform"),
    perPlatform: z.array(
      z.object({
        platform: z.string(),
        verdict: z.enum(["accept", "accept-degraded", "reject"]),
        reason: z.string(),
        nextAction: z.enum(["proceed", "regenerate-transform"]),
      }),
    ),
  }),
  z.object({
    phase: z.literal("foreword"),
    foreword: z.string().min(20).max(1500),
    confirmedItems: z.array(z.string()).min(1),
  }),
  z.object({
    phase: z.literal("signoff"),
    signoff: z.enum(["signed", "refused"]),
    overallScore: z.number().int().min(0).max(100),
    platformScores: z.record(z.string(), z.number().int().min(0).max(100)),
    accountabilityNote: z.string().min(20),
    refusalReason: z.string().nullable(),
  }),
]);

export type LeaderInput = z.infer<typeof Input>;
export type LeaderOutput = z.infer<typeof Output>;

@DefineAgent({
  id: "social.leader",
  version: "1.0.0",
  identity: {
    role: "leader",
    description:
      "SocialPublishMission 唯一最终负责对象。在 plan / assess-transform / foreword / signoff 4 个 milestone 全程在场，对最终发布产物签字承担问责。",
  },
  loop: "react",
  toolCategories: [],
  taskProfile: {
    creativity: "low",
    outputLength: "medium",
    reasoningDepth: "moderate",
  },
  inputSchema: Input,
  outputSchema: Output,
  budget: { maxTokens: 8_000, maxIterations: 3 },
})
export class LeaderAgent extends AgentSpec<typeof Input, typeof Output> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    const base = buildPromptFromDuty(
      "leader",
      input.phase,
      input as unknown as Record<string, unknown>,
    );
    // 2026-05-19 fix: Output schema 是 z.discriminatedUnion("phase", ...)，
    //   LLM 必须在输出 JSON 顶层带 phase 字段，否则 ReActLoop schema validation
    //   永远 reject "Invalid discriminator value"。SKILL.md duty 段的 JSON
    //   示例只展示业务字段没写 phase，这里强制追加规范化提示。
    const phaseEnforcement = [
      "",
      "## 输出 JSON 格式（强制要求）",
      "",
      `你的输出 JSON 必须包含 \`"phase": "${input.phase}"\` 作为顶层字段（这是 schema 的 discriminator）。`,
      "例如：",
      "```json",
      "{",
      `  "phase": "${input.phase}",`,
      "  // ... 业务字段",
      "}",
      "```",
      "",
      "缺少 `phase` 字段会导致 schema validation 失败，mission 终止。",
    ].join("\n");
    return base + phaseEnforcement;
  }
}
