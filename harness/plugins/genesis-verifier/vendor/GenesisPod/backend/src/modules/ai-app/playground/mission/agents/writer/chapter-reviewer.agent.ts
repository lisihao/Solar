/**
 * ChapterReviewerAgent —— 单章节质量门控
 *
 * 接收 ChapterWriter 的草稿 → 评分 + decision (pass/revise) + critique。
 * < pass 阈值时 orchestrator 把 critique 喂回 ChapterWriter 重写。
 */

import { z } from "zod";
import {
  AgentSpec,
  DefineAgent,
  CHAPTER_REVIEWER_INTERNAL_MAX_ITERATIONS,
} from "@/modules/ai-harness/facade";
import {
  coercedScore,
  coercedInt,
  coercedEnum,
} from "@/common/utils/schema-coercion.utils";
// ★ 2026-05-21 P2：引用下限走单一权威，避免与 EvidenceBudget 的公式漂移
import { deriveCitationFloor } from "../../artifacts/evidence-budget";

const Input = z.object({
  topic: z.string(),
  dimension: z.string(),
  language: z.enum(["zh-CN", "en-US"]),
  chapter: z.object({
    index: z.number().int(),
    heading: z.string(),
    thesis: z.string(),
    body: z.string(),
    wordCount: z.number().int(),
    targetWords: z.number().int(),
  }),
  /**
   * ★ 2026-05-21 P2 Evidence Contract：本章实际分到的唯一来源数。
   * reviewer 的"引用充分"门槛由它派生（min(2, N)），而非硬性 ≥2 ——
   * 治"采得少却要求每章 ≥2 引用 → 结构性不可满足 → 重写循环"。
   * 缺省（旧调用方 / 测试）时按 ≥2 的标准行为。
   */
  availableSourceCount: z.number().int().min(0).optional(),
});

/** Iter 2d: critique 改结构化 issues 数组（替代大段叙述） */
const ReviewIssue = z.object({
  severity: z.enum(["must-fix", "should-fix", "nice-to-have"]),
  dimension: z.enum([
    "evidence",
    "logic",
    "structure",
    "citation",
    "length",
    "style",
  ]),
  /** 例 "§2 第 3 段" / "Implications" */
  pointer: z.string(),
  /** 一句话问题 */
  issue: z.string(),
  /** 一句话改法（动词开头）*/
  suggestion: z.string(),
});

const Output = z.object({
  /**
   * Coerced for local/quantized models that emit `"3"` or `3.0` instead of
   * an int. Floors floats; rejects non-numeric.
   */
  index: coercedInt(0, 10_000),
  /**
   * FAIL-CLOSED: unknown / missing values fall back to "revise" (conservative
   * branch). Never widen this default to "pass" — a hallucinated decision
   * must never silently approve a chapter past the quality gate.
   */
  decision: coercedEnum(["pass", "revise"] as const, "revise"),
  /**
   * Coerced + clamped to [0,100]. Runaway 150 → 100 rather than aborting
   * the whole mission; string "85" → 85.
   */
  score: coercedScore(0, 100),
  /** 结构化 issues（最多 6 条；pass 时可空数组） */
  issues: z.array(ReviewIssue).max(6).default([]),
  /** 1-2 句话总评摘要（≤ 300 字符）—— 替代旧 critique 中的"概括陈述"部分 */
  summary: z.string().max(300),
  /**
   * @deprecated 兼容旧客户端 —— 平铺 issues 拼成的可读文本。
   * 新前端应消费 issues + summary，不要直接展示这个字段。
   */
  critique: z.string().optional(),
});

@DefineAgent({
  id: "playground.chapter-reviewer",
  identity: {
    role: "chapter-reviewer",
    description: "Quality gate for a single chapter draft",
  },
  loop: "simple",
  // PR-X-skill-bridge: 6 项 chapter QA gate
  skills: ["chapter-quality-gate"],
  taskProfile: {
    creativity: "deterministic",
    outputLength: "short",
    taskKind: "review",
  },
  inputSchema: Input,
  outputSchema: Output,
  // ★ 2026-05-01 (PR-G iter9): maxIterations 走集中常量
  budget: {
    maxTokens: 6_000,
    maxIterations: CHAPTER_REVIEWER_INTERNAL_MAX_ITERATIONS,
  },
})
export class ChapterReviewerAgent extends AgentSpec<
  typeof Input,
  typeof Output
> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    // ★ 2026-05-21 P2 Evidence Contract：引用门槛由本章实际来源数派生（min(2, N)），
    //   缺省时按 ≥2 的标准行为。0 来源不要求引用。
    const sourceCount = input.availableSourceCount;
    const citationFloor =
      sourceCount === undefined ? 2 : deriveCitationFloor(sourceCount);
    return [
      `You are a quality gate for chapter ${input.chapter.index} "${input.chapter.heading}" of dimension "${input.dimension}".`,
      `Language: ${input.language}.`,
      ``,
      `## 评审 checklist（核心评分维度，总分 100）`,
      `★ 核心理念：质量优先，字数仅作参考。一段 800 字精炼论述胜过 2000 字注水。`,
      ``,
      `1. 观点独立性 (25 分)：每段是否包含独立、具体、可被证伪的 thesis claim？`,
      `   ★ 段首仅复述章节标题（如标题"产品定义"首句也是"本章定义产品"）= 不通过`,
      `   ★ 全章必须 ≥ 1~2 个独立分析判断（"这意味着..."/"核心原因在于..."/"值得警惕的是..."），`,
      `      不能仅复述 finding`,
      `2. 证据具体 (25 分)：是否含具体数字 / 时间 / 实体 / 案例？是否对 finding 有真实分析？`,
      citationFloor === 0
        ? `3. 引用充分 (20 分)：本章未分配到外部来源 —— **不因"缺引用标记"扣本项**；但本项不是免费分：若正文缺乏可追溯的具体事实 / 数字 / 实体，请改到"证据具体"维度扣分。`
        : `3. 引用充分 (20 分)：本章共分到 ${sourceCount ?? "若干"} 个唯一来源，正文含 ≥ ${citationFloor} 处引用标记（\`[N]\` / \`[label](url)\` / 裸 URL 任一形式）即满分。`,
      citationFloor === 0
        ? `   ★ 0 来源时引用格式不扣分，但内容必须有具体分析与事实支撑，否则从"证据具体"维度扣分（不得仅因"无引用"就放行一篇空泛章节）。`
        : `   ★ 不得要求超过 ${citationFloor} 处引用 —— 来源就这么多，强求更多是结构性错误。引用格式 NOT 计入扣分项（ReportAssembler 会统一规范化为 \`[N]\`）。`,
      `4. 去模板化 (20 分)：是否避免了固定八股？`,
      `   ★ 不允许每章首段都用 \`> **核心判断**：\` blockquote + 末段都用 \`**Implications**：\` 前缀`,
      `   ★ 不允许同一句式在所有章节复用（章节有自己的开头/收尾节奏）`,
      `   ★ 不允许"随着 X 的发展"/"在当今"/"众所周知"/"综上所述"等套话开头`,
      // ★ 2026-05-07 字数软化（用户对齐）：字数永不触发 revise
      `5. 字数参考 (10 分)：targetWords ${input.chapter.targetWords} 字（牵引参考），实际 ${input.chapter.wordCount} 字。`,
      `   ★ 字数权重最低（10/100）。**字数永不触发 revise** —— 即使章节只有 200 字，也不能以"字数不足"为由打回。`,
      `   ★ 评分依然给 0-10：实际字数 ≥ target × 50% 给满分；< 50% 时酌情扣分（最多扣 10）。`,
      `   ★ 字数超出（甚至 1.5×）不扣分 —— 详尽分析比硬塞更有价值。`,
      ``,
      `## decision 规则`,
      `- ≥ 60 分 → "pass"（核心 4 维度达标即可放行）`,
      `- < 60 → "revise" + critique 必须明确指出 观点/证据/引用/去模板化 中的问题`,
      `- ★ **字数永不作为 revise 触发条件**。即使一章只 100 字，只要观点/证据/引用/去模板化达标 → pass。`,
      `- ★ revise 主理由必须是观点 / 证据 / 引用 / 去模板化 中的问题，**不能涉及字数**。`,
      ``,
      `## ★ 防过度严格`,
      `chapter-writer 输出的 \`[N]\` 编号引用是合法格式。不要因"未使用 markdown link"扣分。`,
      `如果引用在 citationsUsed 字段中可追溯，且正文有 \`[N]\` 标记，引用合规直接给满分 20。`,
      ``,
      `## 章节草稿（${input.chapter.wordCount} 字）`,
      ``,
      input.chapter.body.slice(0, 6000),
      ``,
      `## 输出 JSON shape (字段名必须完全匹配)`,
      `{`,
      `  "index": ${input.chapter.index},`,
      `  "decision": "pass" or "revise",`,
      `  "score": <0-100 整数>,`,
      `  "summary": "<1-2 句总评，≤ 150 字>",`,
      `  "issues": [  // 0-6 条结构化问题。pass 时可为空数组。`,
      `    {`,
      `      "severity": "must-fix" | "should-fix" | "nice-to-have",`,
      `      "dimension": "evidence" | "logic" | "structure" | "citation" | "length" | "style",`,
      `      "pointer": "<位置如 §2 第 3 段 / 首段 / 末段>",`,
      `      "issue": "<一句话问题描述>",`,
      `      "suggestion": "<一句话改法，动词开头>"`,
      `    }`,
      `    // ★ 禁止"建议提升整体质量"这种笼统描述`,
      `    // ★ revise 必须 ≥ 1 条 must-fix；pass 可全部 nice-to-have 或空`,
      `  ],`,
      `  "critique": "<可选，旧客户端兼容字段：把 issues 串成可读文本>"`,
      `}`,
    ].join("\n");
  }
}
