/**
 * DimensionQualityJudgeAgent —— 维度级 5-axis 评分（TI 同款）
 *
 * 5 个维度：
 *   - 广度 breadth：是否覆盖该维度的多个子主题
 *   - 深度 depth：每个子主题是否有充分论证
 *   - 证据 evidence：是否引用具体数据 / 时间 / 实体
 *   - 连贯性 coherence：章节衔接是否流畅、无重复
 *   - 时效性 freshness：引用的 source 是否近期
 *
 * 输出 grade（excellent/good/fair/poor）+ overall 总分 + 5 axis 分项。
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";
import {
  coercedScore,
  coercedEnum,
} from "@/common/utils/schema-coercion.utils";

const Input = z.object({
  topic: z.string(),
  dimension: z.string(),
  language: z.enum(["zh-CN", "en-US"]),
  abstract: z.string(),
  fullMarkdown: z.string(),
  totalWordCount: z.number().int(),
  /** 引用的 source 列表（含日期信息） */
  sources: z.array(
    z.object({
      url: z.string(),
      publishedDate: z.string().optional(),
    }),
  ),
});

// 2026-05-13 #65: LLM 偶发返回 score="80" / 80.5 / 缺 comment / 越界 → 旧 schema
// 直接拒绝 → simple-loop yield error+terminated{reason:"error"} → state=failed →
// 用户看到"grade 阶段失败 state=failed 无 5 轴评分"。改用 coercedScore + optional
// comment + axis fallback default，吸收输出漂移而不让整张评分丢。
const AxisScore = z.object({
  score: coercedScore(0, 100),
  comment: z.string().default(""),
});
// 缺整个 axis 时也兜底（避免一个轴缺失就整 grade 丢）
const AxisOrFallback = AxisScore.default({ score: 60, comment: "" });

const Output = z.object({
  dimension: z.string(),
  overall: coercedScore(0, 100),
  // grade enum 用 fail-closed 兜底 "fair"（中庸），LLM 给出"average"/"satisfactory"
  // 等非标 token 不再拒收。
  grade: coercedEnum(
    ["excellent", "good", "fair", "poor"] as const,
    "fair" as const,
  ),
  axes: z.object({
    breadth: AxisOrFallback,
    depth: AxisOrFallback,
    evidence: AxisOrFallback,
    coherence: AxisOrFallback,
    freshness: AxisOrFallback,
    // ★ B-axis (2026-05-06): sources_sufficiency — unique sources per dim/chapter
    sources_sufficiency: AxisOrFallback,
  }),
  summary: z.string().default(""),
});

@DefineAgent({
  id: "playground.dimension-quality-judge",
  identity: {
    role: "quality-judge",
    description: "5-axis quality grading for a dimension report",
  },
  loop: "simple",
  // PR-X-skill-bridge: per-dim 5-axis 评分协议
  skills: ["dimension-quality-review"],
  taskProfile: {
    creativity: "deterministic",
    outputLength: "medium",
    taskKind: "review",
  },
  inputSchema: Input,
  outputSchema: Output,
  budget: { maxTokens: 8_000, maxIterations: 3 },
})
export class DimensionQualityJudgeAgent extends AgentSpec<
  typeof Input,
  typeof Output
> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    const sourceList = input.sources
      .slice(0, 30)
      .map(
        (s, i) =>
          `  [${i}] ${s.url}${s.publishedDate ? ` (${s.publishedDate})` : ""}`,
      )
      .join("\n");
    return [
      `You are a strict quality judge for the dimension "${input.dimension}" of topic "${input.topic}".`,
      `Language: ${input.language}.`,
      ``,
      `## 6 个评分维度（每项 0-100，独立打分）`,
      ``,
      `### 1. 广度 breadth（相对评分）`,
      `- 该维度报告是否覆盖了该维度话题**自然具备**的各个子主题？`,
      `- ★ 相对于"本维度实际可展开的子话题数量"评分，不以固定 4 个视角为绝对门槛。`,
      `  本身子话题较少的窄维度，覆盖齐全也可 ≥ 80；反之若明显遗漏主要子话题则扣分。`,
      `- 评分标准：`,
      `  * 覆盖了该维度所有合理子话题 → ≥ 80`,
      `  * 遗漏 1-2 个次要子话题 → 60-79`,
      `  * 仅覆盖单一视角但该维度本身也只有一个自然子话题 → 65-75（不因自然窄而过度扣分）`,
      `  * 明显遗漏多个主要子话题 → ≤ 55`,
      ``,
      `### 2. 深度 depth`,
      `- 每个子主题是否有充分论证、案例、数据？`,
      `- 仅罗列没分析 → ≤ 50`,
      ``,
      `### 3. 证据 evidence（相对评分）`,
      `- 是否引用具体数字 / 时间 / 实体名 / 链接？`,
      `- ★ 相对于"本维度实际可获取的证据密度"评分，不以固定 5 个数字 + 5 条 URL 为绝对门槛。`,
      `  重点看：(a) 已有 findings 是否被充分引用为具体数字/实体，(b) 证据是否支撑论点而非空泛陈述。`,
      `- 评分标准：`,
      `  * 关键论点都有具体数字/实体/链接支撑，证据密度饱和 → ≥ 80`,
      `  * 多数论点有证据，少数论点缺支撑 → 60-79`,
      `  * 证据稀少，大量论点无可追溯支撑 → 40-59`,
      `  * 几乎全是空泛陈述，无具体证据 → ≤ 40`,
      `- 当前已收集 sources 数量: ${input.sources.length}（供参考，不作绝对门槛）`,
      ``,
      `### 4. 连贯性 coherence`,
      `- 章节衔接是否流畅？是否有重复 / 矛盾？`,
      `- 章节 abstract 是否和正文一致？`,
      ``,
      `### 5. 时效性 freshness`,
      `- 引用的 source 是否近期（2024 后为 ≥ 80，2023-24 为 60-80，更早 < 60）？`,
      `- 无日期视为低分`,
      ``,
      `### 6. 来源充分性 sources_sufficiency（相对评分）`,
      `- ★ 2026-05-21 P2 Evidence Contract：相对于"本维度实际可采集到的来源"评分，`,
      `  **不是**绝对数量。来源天然稀少的维度不因总量少而过度扣分；重点看：`,
      `  (a) 已收集来源是否被充分引用、(b) 章节间是否尽量分散来源而非全堆在一处。`,
      `- 评分标准：`,
      `  * 已收集来源被充分利用 + 章节间分布合理 → ≥ 80（即使总量不大也可满分）`,
      `  * 大量已收集来源未被引用，或来源全堆在个别章节 → 50-79`,
      `  * 正文几乎不带可追溯来源 → ≤ 40`,
      `  * 完全无 source URL → 0`,
      `- 当前已收集 sources 数量: ${input.sources.length}`,
      ``,
      `## overall 总分计算`,
      `weighted average: breadth 18% + depth 22% + evidence 22% + coherence 13% + freshness 13% + sources_sufficiency 12%`,
      ``,
      `## grade 映射`,
      `- ≥ 85 → "excellent"`,
      `- 70-84 → "good"`,
      `- 55-69 → "fair"`,
      `- < 55 → "poor"`,
      ``,
      `## 待评维度报告`,
      `### Abstract`,
      input.abstract,
      ``,
      `### Sources (${input.sources.length} 条)`,
      sourceList,
      ``,
      `### Full report (前 4000 字)`,
      input.fullMarkdown.slice(0, 4000),
      ``,
      `## 输出 JSON shape (字段名必须完全匹配)`,
      `{`,
      `  "dimension": "${input.dimension}",`,
      `  "overall": <0-100 整数>,`,
      `  "grade": "excellent" | "good" | "fair" | "poor",`,
      `  "axes": {`,
      `    "breadth":            { "score": <0-100>, "comment": "<具体观察>" },`,
      `    "depth":              { "score": <0-100>, "comment": "..." },`,
      `    "evidence":           { "score": <0-100>, "comment": "..." },`,
      `    "coherence":          { "score": <0-100>, "comment": "..." },`,
      `    "freshness":          { "score": <0-100>, "comment": "..." },`,
      `    "sources_sufficiency":{ "score": <0-100>, "comment": "<唯一 source 数量 + 每章域名覆盖>" }`,
      `  },`,
      `  "summary": "<2-3 句总评>"`,
      `}`,
    ].join("\n");
  }
}
