/**
 * Forecast Red Team Agent —— 前瞻判断的对抗式复核（事前验尸 / pre-mortem）
 *
 * 上游：docs/architecture/playground-foresight-plan.md L2 §4.2
 *
 * 职责：与 L4 Critic（评当下报告质量）区分——本 agent 专评 foresight 的"未来脆性"：
 *   - 假设 6/12/24 个月后某条 baseCase 判断被事实推翻，复盘"哪个关键假设最先失效"
 *   - 输出每条脆弱点的失效场景 + 主观概率 + 影响等级
 *   - couldBeWrongIf：整体判断可能错在哪（反指标，回灌报告 Outlook 章节）
 *   - overallRobustness：报告前瞻部分能抵抗多少对抗推敲（0-100）
 *
 * 情报分析 tradecraft：pre-mortem / red team —— 强制从"它会怎么错"的视角出发，
 * 对冲 Writer/Analyst 的乐观确认偏差。
 *
 * 触发：与 L4 Critic 一致按 auditLayers 分档（s9c stage 控制），且仅当报告含 foresight。
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";

const ForesightBaseCase = z.object({
  judgment: z.string(),
  probability: z.number().min(0).max(1),
  confidence: z.enum(["low", "moderate", "high"]),
  horizon: z.enum(["0-6m", "6-18m", "18m-3y", "3y+"]),
});

const Input = z.object({
  topic: z.string(),
  language: z.enum(["zh-CN", "en-US"]),
  // 被红队的前瞻判断（来自 analyst.foresight）
  baseCase: z.array(ForesightBaseCase).min(1),
  scenarios: z
    .array(
      z.object({
        kind: z.enum(["bull", "base", "bear"]),
        narrative: z.string(),
        probability: z.number().min(0).max(1),
      }),
    )
    .default([]),
  criticalUncertainties: z.array(z.string()).default([]),
});

const Vulnerability = z.object({
  statement: z.string(), // 被攻击的核心假设
  failureScenario: z.string(), // "若…则该判断崩塌"
  timeHorizon: z.enum(["6m", "12m", "2y"]),
  likelihood: z.number().min(0).max(1), // 该失效场景的主观概率
  impactIfFails: z.enum(["minor", "moderate", "critical"]),
});

const Output = z.object({
  vulnerabilities: z.array(Vulnerability).default([]),
  couldBeWrongIf: z.array(z.string()).default([]), // 反指标，回灌 Outlook
  overallRobustness: z.number().min(0).max(100),
  rationale: z.string().min(20),
});

@DefineAgent({
  id: "playground.forecast-red-team",
  version: "1.0.0",
  identity: {
    role: "critic",
    description:
      "Forecast red team — pre-mortem adversarial review of foresight judgments, surfaces future fragility",
  },
  loop: "simple",
  // 复用 L4 元评审协议（同为独立对抗式复核）
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
export class ForecastRedTeamAgent extends AgentSpec<
  typeof Input,
  typeof Output
> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    const lang =
      input.language === "zh-CN" ? "用中文输出。" : "Respond in English.";
    const pct = (p: number) => `${Math.round(p * 100)}%`;
    return [
      `You are a forecast red team running a PRE-MORTEM on a report's forward-looking judgments. ${lang}`,
      `Mindset: assume each judgment below turns out WRONG within its horizon. Your only job is to`,
      `explain HOW it fails — which assumption breaks first, and what early failure path looks like.`,
      `Do NOT defend the forecasts. Do NOT add new forecasts. Attack the existing ones.`,
      ``,
      `## Topic`,
      `"${input.topic}"`,
      ``,
      `## Base-case judgments under test`,
      ...input.baseCase.map(
        (b, i) =>
          `${i + 1}. ${b.judgment}（概率 ${pct(b.probability)} · 置信度 ${b.confidence} · 时间窗 ${b.horizon}）`,
      ),
      input.scenarios.length
        ? `\n## Scenarios\n${input.scenarios
            .map((s) => `- [${s.kind}] ${pct(s.probability)}: ${s.narrative}`)
            .join("\n")}`
        : ``,
      input.criticalUncertainties.length
        ? `\n## Critical uncertainties already flagged\n${input.criticalUncertainties
            .map((u) => `- ${u}`)
            .join("\n")}`
        : ``,
      ``,
      `## What to produce`,
      `1. **vulnerabilities**: for the judgments most likely to fail, give:`,
      `   - statement: which assumption / judgment you are attacking`,
      `   - failureScenario: the concrete path by which it turns out wrong`,
      `   - timeHorizon: 6m / 12m / 2y — when the failure would become visible`,
      `   - likelihood: 0-1, your estimate the failure path materializes`,
      `   - impactIfFails: minor / moderate / critical (does it just dent the report or invalidate the thesis?)`,
      `2. **couldBeWrongIf**: short list of cross-cutting conditions under which the WHOLE forecast is wrong`,
      `   (these become the report's "判断可能错在哪" reverse-indicators).`,
      `3. **overallRobustness**: 0-100. How well do these forecasts survive adversarial scrutiny?`,
      `   - 80-100: well-hedged, base rates respected, falsifiable, few critical vulnerabilities`,
      `   - 50-79: plausible but with notable untested assumptions`,
      `   - <50: overconfident / unfalsifiable / one shock invalidates the thesis`,
      `4. **rationale**: 20+ chars summarizing the robustness verdict.`,
      ``,
      `## Discipline`,
      `- Adaptive count: list ONLY genuine vulnerabilities you would defend. A robust forecast may have one; a fragile one, several. Do not pad.`,
      `- A judgment with high probability but low confidence is a prime target — flag the thin evidence.`,
      ``,
      `## Output JSON shape`,
      `{`,
      `  "vulnerabilities": [`,
      `    { "statement":"...", "failureScenario":"...", "timeHorizon":"12m", "likelihood":0.3, "impactIfFails":"moderate" }`,
      `  ],`,
      `  "couldBeWrongIf": ["...", "..."],`,
      `  "overallRobustness": 72,`,
      `  "rationale": "<20+ chars>"`,
      `}`,
    ].join("\n");
  }
}
