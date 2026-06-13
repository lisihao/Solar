/**
 * Critic Agent —— L4 独立复审（独立 critic，不参与生产）
 *
 * 上游：mission-pipeline-baseline.md §6 / mission-pipeline-audit-layers.md §4.5
 *
 * 职责：跳出 Writer/Reviewer 闭环，从外部视角看 ReportArtifact：
 *   - 检测 self-confirmation bias（Writer 自吹）
 *   - 识别 Reviewer 没看到的盲点（blindspots）
 *   - 标记论调偏倚（biasFlags）
 *   - 给改进方向（suggestions）
 *
 * 不与 Writer 通信（避免 self-confirmation），只读 ReportArtifact + Reviewer 评分。
 *
 * 触发：
 *   - auditLayers ∈ {thorough, paranoid}
 *   - 或 audienceProfile === 'executive' （高管阅读敏感）
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";

const Input = z.object({
  topic: z.string(),
  language: z.enum(["zh-CN", "en-US"]),
  audienceProfile: z.enum(["executive", "domain-expert", "general-public"]),
  styleProfile: z
    .enum(["academic", "executive", "journalistic", "technical"])
    .optional(),
  lengthProfile: z
    .enum(["brief", "standard", "deep", "extended", "epic", "mega"])
    .optional(),
  artifactSummary: z.object({
    title: z.string(),
    executiveSummary: z.string(),
    sectionCount: z.number(),
    sectionTitles: z.array(z.string()),
    citationCount: z.number(),
    factCount: z.number(),
    figureCount: z.number(),
    // ★ P2-NEW-1 (round 2): 与其他 reviewer score 字段保持一致 [0, 100]
    overallQuality: z.number().min(0).max(100),
    qualityDimensions: z.record(z.string(), z.number().min(0).max(100)),
  }),
  upstreamReviewerVerdict: z
    .object({
      score: z.number().min(0).max(100),
      critique: z.string().optional(),
    })
    .optional(),
});

const Output = z.object({
  overallVerdict: z.enum(["pass", "concerns", "fail"]),
  blindspots: z.array(z.string()).default([]),
  biasFlags: z.array(z.string()).default([]),
  suggestions: z.array(z.string()).default([]),
  rationale: z.string().min(20),
});

@DefineAgent({
  id: "playground.critic",
  version: "1.0.0",
  identity: {
    role: "critic",
    description:
      "L4 meta-critic — independent reviewer outside Writer/Reviewer loop, surfaces blindspots and biases",
  },
  loop: "simple",
  // PR-X-skill-bridge: report-meta-critic L4 协议
  skills: ["report-meta-critic"],
  toolCategories: [],
  taskProfile: {
    creativity: "low",
    outputLength: "medium",
    reasoningDepth: "deep",
    taskKind: "review",
  },
  inputSchema: Input,
  outputSchema: Output,
  budget: { maxTokens: 12_000, maxIterations: 2, maxWallTimeMs: 90_000 },
})
export class MissionCriticAgent extends AgentSpec<typeof Input, typeof Output> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    const lang =
      input.language === "zh-CN" ? "用中文输出。" : "Respond in English.";
    return [
      `You are an independent meta-critic for a research report. ${lang}`,
      `Your job: critique the artifact from an outsider's lens. You did NOT write this report,`,
      `you do NOT see Writer's reasoning, you do NOT defend any decision. You spot what an`,
      `executive reader would call out as weak / missing / biased.`,
      ``,
      `## Topic`,
      `"${input.topic}" (audience: ${input.audienceProfile}${input.styleProfile ? `, style: ${input.styleProfile}` : ""}${input.lengthProfile ? `, length: ${input.lengthProfile}` : ""})`,
      ``,
      `## Artifact summary you can see`,
      `- Title: ${input.artifactSummary.title}`,
      `- ${input.artifactSummary.sectionCount} sections, ${input.artifactSummary.citationCount} citations, ${input.artifactSummary.factCount} facts, ${input.artifactSummary.figureCount} figures`,
      `- Section titles: ${input.artifactSummary.sectionTitles.join(" / ")}`,
      `- Executive summary: """${input.artifactSummary.executiveSummary.slice(0, 500)}${input.artifactSummary.executiveSummary.length > 500 ? "…" : ""}"""`,
      `- Reviewer overall: ${input.artifactSummary.overallQuality}/100`,
      `- Quality dimensions: ${Object.entries(
        input.artifactSummary.qualityDimensions,
      )
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")}`,
      input.upstreamReviewerVerdict
        ? `- Upstream reviewer score: ${input.upstreamReviewerVerdict.score}, critique: ${input.upstreamReviewerVerdict.critique?.slice(0, 200) ?? "—"}`
        : ``,
      ``,
      `## What to check`,
      `1. **Blindspots**: aspects an ${input.audienceProfile} reader would expect but the section titles don't cover.`,
      `2. **Bias flags**: any sign of one-sided framing, missing counter-arguments, or vendor/political tilt.`,
      `3. **Self-confirmation**: does executive summary read like Writer convincing itself rather than evidence-driven?`,
      `4. **Coverage adequacy**: section count vs topic complexity; thin coverage = "concerns".`,
      `5. **Citation health**: count low? mostly blogs vs gov/academic? skewed dependence on few sources?`,
      `6. **Figure-text fit**: figureCount=${input.artifactSummary.figureCount}. 如 0 张图但 topic 强烈适合可视化（数据/对比/趋势）→ 列入 blindspots.`,
      `7. **Fact density**: factCount=${input.artifactSummary.factCount}. 低于 5 → 列入 concerns（结构化事实不足）.`,
      ``,
      `## Verdict rules`,
      `- "pass": no major issues, blindspots ≤ 1, biasFlags == 0`,
      `- "concerns": item count adapts to actual quality — list ONLY genuine issues you would defend to an executive (could be 1, could be 5). Do not pad to hit a "typical 2-3" feel.`,
      `- "fail": critical blindspot/bias that requires Writer to revise`,
      `- ★ Adaptive count: never invent issues to satisfy a perceived minimum. A strong report with one real concern lists exactly one item. A weak report with five distinct gaps lists all five.`,
      ``,
      `## Output JSON shape`,
      `{`,
      `  "overallVerdict": "pass"|"concerns"|"fail",`,
      `  "blindspots": ["...", "..."],`,
      `  "biasFlags": ["..."],`,
      `  "suggestions": ["..."],`,
      `  "rationale": "<20+ chars explaining the verdict>"`,
      `}`,
    ].join("\n");
  }
}
