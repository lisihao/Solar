/**
 * QuickViewSynthesizerAgent —— 快速视图结构化字段的专用合成
 *
 * 背景（2026-05-29）：用户反馈 playground「快速视图」质量远低于 Topic Insights，
 * 而「连续视图」(fullMarkdown，由 Writer 团队逐章写) 质量 OK —— 证明不缺料。
 * 根因：keyFindingsByDimension(含 body)/trends/riskMatrix 等结构化字段原本和
 * 6 个散文章节(themeSummary/preface/crossDimAnalysis/...) 挤在 AnalystAgent
 * 一次 outputLength="long"(≈8K) 的调用里，排在输出尾部的 body 被 token 预算
 * 饿死 → 卡片只剩干瘪标题。
 *
 * 解法：把这 5 组结构化字段从 analyst 主调用拆出来，单独一次聚焦调用：
 *   - 输入复用已有的富 researcherResults(claim/evidence/source) + analyst 的
 *     themeSummary/insights(跨维度视角)
 *   - taskProfile: creativity=medium + outputLength=extended(16K) —— 给 body 足够空间
 *   - body 必填(非 optional) —— 强制 LLM self-heal 补齐，杜绝空 body
 * 完全不动 Writer / 连续视图链路，零回归。
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";

const ResearcherFinding = z.object({
  dimension: z.string(),
  findings: z.array(
    z.object({
      claim: z.string(),
      evidence: z.string(),
      source: z.string().min(1),
    }),
  ),
  summary: z.string(),
});

const Input = z.object({
  topic: z.string(),
  language: z.enum(["zh-CN", "en-US"]),
  researcherResults: z.array(ResearcherFinding).min(1),
  /** analyst 主调用产出的主题综合，给快速视图卡片提供跨维度定调（避免与正文矛盾） */
  themeSummary: z.string().optional(),
  /** analyst 主调用提炼的跨维度洞察，供卡片提炼时参考 */
  insights: z
    .array(
      z.object({
        headline: z.string(),
        narrative: z.string(),
        supportingDimensions: z.array(z.string()),
        confidence: z.number(),
      }),
    )
    .optional(),
});

const Output = z.object({
  keyFindingsByDimension: z
    .array(
      z.object({
        dimensionName: z.string(),
        findings: z.array(
          z.object({
            finding: z.string(),
            // ★ body 必填：这是本 agent 存在的全部意义，缺失会触发 self-heal 重补
            body: z.string(),
            significance: z.enum(["high", "medium", "low"]),
          }),
        ),
      }),
    )
    .optional(),
  trendsByDimension: z
    .array(
      z.object({
        dimensionName: z.string(),
        trends: z.array(
          z.object({
            trend: z.string(),
            direction: z.enum([
              "increasing",
              "decreasing",
              "stable",
              "emerging",
            ]),
            timeframe: z.string(),
          }),
        ),
      }),
    )
    .optional(),
  riskMatrix: z
    .array(
      z.object({
        riskType: z.string(),
        probability: z.enum(["高", "中", "低"]),
        impact: z.enum(["高", "中", "低"]),
        timeframe: z.string(),
      }),
    )
    .optional(),
  recommendationsByAudience: z
    .object({
      forEnterprise: z
        .object({
          shortTerm: z.array(z.string()),
          midTerm: z.array(z.string()),
        })
        .optional(),
      forInvestors: z
        .object({
          shortTerm: z.array(z.string()),
          midTerm: z.array(z.string()),
        })
        .optional(),
    })
    .optional(),
  whatYouWillLearn: z.array(z.string()).optional(),
});

@DefineAgent({
  id: "playground.quick-view-synthesizer",
  identity: {
    role: "analyst",
    description: "Synthesize rich structured quick-view cards from research",
  },
  // 单次结构化合成，无需 reflexion/工具：react 一轮生成 → finalize
  loop: "react",
  taskProfile: { creativity: "medium", outputLength: "extended" },
  inputSchema: Input,
  outputSchema: Output,
  budget: { maxTokens: 24_000, maxIterations: 3, maxIterationsHardCap: 4 },
})
export class QuickViewSynthesizerAgent extends AgentSpec<
  typeof Input,
  typeof Output
> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    const dimNames = input.researcherResults.map((r) => r.dimension);
    return [
      `你为关于「${input.topic}」的多维度研究生成「快速视图」结构化卡片。`,
      `语言：${input.language}。`,
      `输入里有 ${input.researcherResults.length} 个维度的 researcher 原始发现`,
      `(每条含 claim / evidence / source)${input.themeSummary ? "，以及一段主题综合 themeSummary 和若干跨维度 insights" : ""}。`,
      `维度列表：${dimNames.join(" / ")}。`,
      ``,
      `你的唯一任务是产出 5 组结构化字段，喂报告的「快速视图」卡片区。`,
      `这些卡片要和正文质量对齐 —— 信息密度高、有数字/实体/时间窗口，不能是空泛口号。`,
      ``,
      `## 必须输出的字段`,
      ``,
      `1. keyFindingsByDimension：覆盖**每一个**维度，每维度抽 2-4 条最重要的 finding。`,
      `   每条 finding 是「标题 + 解释段」双层结构：`,
      `   • finding: 8-20 字中文标题，提炼核心点（如「能源供给约束与液冷拐点」）`,
      `   • body:    ★必填★ 80-200 字中文解释段，写成完整四段式「发现 + 证据 + 数字/案例 + 解读」。`,
      `     - 必须带具体数字 / 实体名 / 时间窗口 / 来源类别，直接取材于该维度的 claim/evidence`,
      `     - 不允许只写标题不写 body；不允许照抄 themeSummary 措辞`,
      `     - body 越实越好 —— 这是本视图质量的核心`,
      `   • significance: high(决定性证据/多源一致/直接驱动结论) | medium(重要但单源/待印证) | low(背景)`,
      ``,
      `2. trendsByDimension：每维度 1-2 条 trend，标 direction 和 timeframe`,
      `   • direction: increasing(上升) | decreasing(下降) | stable(稳态) | emerging(新兴)`,
      `   • timeframe: 如「12个月」「2026Q3」「未来 3 年」`,
      ``,
      `3. riskMatrix：3-6 条结构化风险，每条 { riskType, probability: 高/中/低, impact: 高/中/低, timeframe }`,
      `   • probability「高」≈12个月内大概率；「中」24个月内可能；「低」仅理论可能`,
      `   • impact「高」≈颠覆主结论;「中」影响一个维度;「低」局部影响`,
      ``,
      `4. recommendationsByAudience：按 forEnterprise / forInvestors 两受众，`,
      `   每受众分 shortTerm(6-12月，≥2 条) / midTerm(1-3年，≥1 条)，具体可执行。`,
      `   forEnterprise 关注落地路径；forInvestors 关注配置 / 风险敞口。`,
      ``,
      `5. whatYouWillLearn：3-5 条精炼读后感（「读完本报告你将了解…」），每条 ≤30 字。`,
      ``,
      `严格按 outputSchema 字段名返回 JSON。所有 finding 的 body 都必须填写真实内容。`,
    ].join("\n");
  }
}
