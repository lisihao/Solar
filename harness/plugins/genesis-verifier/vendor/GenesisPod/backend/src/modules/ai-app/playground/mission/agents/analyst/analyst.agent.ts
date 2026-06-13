/**
 * Analyst Agent —— ReflexionLoop + self/critical verifiers
 *
 * 整合 N 个 researcher 的结果，做交叉验证、矛盾消解、洞察归纳。
 * < passThreshold 自动 critique → revise，最多 maxRevisions 轮。
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";

const ResearcherFinding = z.object({
  dimension: z.string(),
  findings: z.array(
    z.object({
      claim: z.string(),
      evidence: z.string(),
      // 必修 #17: 与 ResearcherAgent 一致放宽 — DOI / arxiv id / 带 query 的 URL 都算
      source: z.string().min(1),
    }),
  ),
  summary: z.string(),
});

const Input = z.object({
  topic: z.string(),
  language: z.enum(["zh-CN", "en-US"]),
  researcherResults: z.array(ResearcherFinding).min(1),
  // ★ Phase P1-5: Reconciler [3.5] 产物（mission-pipeline-baseline.md §3.5 / Q6）
  // Analyst 必须显式消费这些字段（contradictions / gaps），不允许"假装看不见"
  reconciliationReport: z
    .object({
      factTable: z.array(z.unknown()).optional(),
      conflicts: z
        .array(
          z.object({
            factIds: z.array(z.string()),
            resolutionType: z.enum([
              "kept-both",
              "preferred-one",
              "flagged-unresolved",
            ]),
            preferredFactId: z.string().optional(),
            rationale: z.string(),
          }),
        )
        .optional(),
      overlaps: z.array(z.unknown()).optional(),
      gaps: z.array(z.unknown()).optional(),
      reconciliationReport: z.string().optional(),
      // P86-1: Analyst 应使用 canonical term 表达
      termGlossary: z
        .array(
          z.object({
            canonical: z.string(),
            variants: z.array(z.string()),
          }),
        )
        .optional(),
      // ★ ACH (2026-05-29 L2)：Reconciler 的竞争性假设分析，foresight.baseCase 必须排除 refuted 的
      alternativeHypotheses: z
        .array(
          z.object({
            id: z.string(),
            statement: z.string(),
            likelihood: z.enum(["low", "medium", "high"]),
            status: z.enum(["plausible", "unlikely", "refuted"]),
          }),
        )
        .optional(),
    })
    .optional(),
  // ★ 第二轮简化提示（仅在 s6 stage 第一轮 LLM 返回 null/格式错误时由 orchestrator 注入）
  retryHint: z.string().optional(),
});

const Output = z.object({
  insights: z.array(
    z.object({
      headline: z.string(),
      narrative: z.string(),
      supportingDimensions: z.array(z.string()),
      confidence: z.number().min(0).max(1),
    }),
  ),
  contradictions: z
    .array(
      z.object({
        claim: z.string(),
        conflictingSources: z.array(z.string()),
        resolution: z.string(),
      }),
    )
    .optional(),
  themeSummary: z.string(),
  // ★ F-alignment (2026-05-06): 对齐 Topic Insight buildFullReportFromDimensions —— 4 个章节必填字段
  // 缺席时 assembler 用 themeSummary / dimension findings 兜底，确保报告结构完整。
  preface: z.string().optional(),
  crossDimAnalysis: z.string().optional(),
  riskAssessment: z.string().optional(),
  strategicRecommendations: z.string().optional(),
  // ★ PR-A0 (2026-05-06 Report Assembly Invariant Redesign v1.4):
  // 报告 segments 5/5 闭环 — 让 StructuralReportAssembler 不必依赖 leader foreword 出 conclusion 段
  conclusion: z.string().optional(),
  // ★ PR-quickview-parity (2026-05-09): 结构化 quickView 字段（参照 TI TopicReport shape）。
  //   prose 章节（preface / crossDimAnalysis / riskAssessment / strategicRecommendations / conclusion）
  //   喂全文章节；这 5 组结构化字段独立喂 ArtifactQuickView 卡片区，让快速视图脱离 prose 字数限制。
  //   全 optional：LLM 缺时 assembler 兜底空数组，前端卡片短路不渲染（无回归）。
  keyFindingsByDimension: z
    .array(
      z.object({
        dimensionName: z.string(),
        findings: z.array(
          z.object({
            finding: z.string(),
            // ★ 2026-05-27 (#108): body = 80-200 字解释段, 参照 Topic Insight 快速视图
            //   每个 finding 不仅有标题还有解释。LLM 可选输出, 缺时前端静默跳过。
            body: z.string().optional(),
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
  // ★ Foresight (2026-05-29 前瞻洞察 L1)：让"向前看"成为一等公民。
  //   编码业界前瞻方法论：超预测(数字概率+外部视角) / 情报ACH(置信度分离+路标信号) /
  //   情景规划(预定元素 vs 关键不确定性)。全 optional：缺失时 Outlook 章节退化但不崩。
  foresight: z
    .object({
      // 基准判断：可证伪 + 数字概率 + 置信度独立于概率（ICD-203 估测语言标准）
      baseCase: z
        .array(
          z.object({
            judgment: z.string(), // 对未来的具体判断（可证伪）
            probability: z.number().min(0).max(1), // 事件发生概率（数字，非"高/中/低"）
            confidence: z.enum(["low", "moderate", "high"]), // 对该判断本身的信心（与概率分离）
            horizon: z.enum(["0-6m", "6-18m", "18m-3y", "3y+"]),
            resolutionCriteria: z.string(), // 裁决标准（到期如何判定应验/证伪）
            baseRate: z.string().optional(), // 参照类历史基准率（外部视角，先于本案特殊性）
            evidenceIds: z.array(z.string()), // 引用 reconciler factTable 的证据 id
          }),
        )
        .min(1),
      // 情景分叉：乐观/中性/悲观三线，各带触发条件与概率
      scenarios: z.array(
        z.object({
          kind: z.enum(["bull", "base", "bear"]),
          narrative: z.string(),
          trigger: z.string(), // 该情景被触发的关键条件
          probability: z.number().min(0).max(1),
        }),
      ),
      predeterminedElements: z.array(z.string()), // 近乎必然（无论哪个情景都会发生）
      criticalUncertainties: z.array(z.string()), // 关键不确定性 = 真正的分叉点
      // 情报路标：把判断变得可跟踪、可证伪
      leadingIndicators: z.array(
        z.object({
          signal: z.string(), // 可观测的早期信号
          watchFor: z.string(), // 出现什么变化算应验 / 证伪
        }),
      ),
    })
    .optional(),
});

@DefineAgent({
  id: "playground.analyst",
  identity: {
    role: "analyst",
    description: "Synthesize multi-dimension research into top insights",
  },
  loop: "reflexion",
  skills: ["critical-review", "cross-dim-synthesis"],
  verifiers: ["self", "critical"],
  taskProfile: { creativity: "low", outputLength: "long" },
  inputSchema: Input,
  outputSchema: Output,
  // 整合 N 个 researcher 输出 + reflexion 至少 2-3 轮 critique→revise
  budget: { maxTokens: 60_000, maxIterations: 10 },
})
export class AnalystAgent extends AgentSpec<typeof Input, typeof Output> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    const recon = input.reconciliationReport;
    const conflictBlock = recon?.conflicts?.length
      ? [
          ``,
          `## ★ Reconciler 已识别冲突（必须在 contradictions 字段显式列出）`,
          ...recon.conflicts.map(
            (c, i) =>
              `${i + 1}. [${c.resolutionType}] factIds=${c.factIds.join(",")} → ${c.rationale.slice(0, 120)}`,
          ),
          ``,
        ]
      : [];
    const reportBlock = recon?.reconciliationReport
      ? [
          ``,
          `## Reconciler 总览`,
          recon.reconciliationReport.slice(0, 1500),
          ``,
        ]
      : [];
    const termBlock =
      recon?.termGlossary && recon.termGlossary.length > 0
        ? [
            ``,
            `## ★ 术语统一（必须采用 canonical term）`,
            ...recon.termGlossary.map(
              (g) => `- "${g.canonical}" 取代变体: ${g.variants.join(" / ")}`,
            ),
            ``,
          ]
        : [];
    // ★ ACH (2026-05-29 L2)：Reconciler 已做竞争性假设分析，foresight 必须尊重其结论
    const achBlock = recon?.alternativeHypotheses?.length
      ? [
          ``,
          `## ★ 竞争性假设分析结果（Reconciler 已证伪检验，foresight.baseCase 必须遵守）`,
          ...recon.alternativeHypotheses.map(
            (h) =>
              `- [${h.status}] ${h.statement.slice(0, 100)}（likelihood=${h.likelihood}）`,
          ),
          `★ 标记为 refuted 的假设禁止进入 foresight.baseCase；unlikely 的若要采用必须显式降低 probability。`,
          ``,
        ]
      : [];
    return [
      `You synthesize research on "${input.topic}" from ${input.researcherResults.length} dimensions.`,
      `Language: ${input.language}.`,
      ``,
      `Goals:`,
      `- Identify 3-7 top insights with cross-dimension support`,
      `- Surface contradictions between sources; propose resolution`,
      `- Each insight needs confidence score (0..1) + supporting dimensions`,
      `- ★ MANDATORY: 必须在 contradictions 字段中列出 Reconciler 识别的所有 conflicts，`,
      `  并对每个冲突写出最终采用的立场（preferred-one / kept-both 双方并列）。`,
      `  不能假装没看到冲突。`,
      `- ★ MANDATORY 报告章节（5 prose 字段必须全部输出，不能省略）：`,
      `  preface:                  200-300 字引言，交代研究背景和本报告的意义`,
      `  crossDimAnalysis:         400-600 字跨维度综合分析，找出各 dim 之间的因果链 / 相互强化 / 张力`,
      `  riskAssessment:           400-600 字风险评估，按"高/中/低"三级列主要风险 + 每条附应对建议`,
      `  strategicRecommendations: 400-600 字战略建议，按受众（企业决策者 / 投资者）分组，每组 ≥ 2 条可行建议`,
      `  conclusion:               150-250 字结论，提炼 3 个最重要的洞察 + 报告整体定调`,
      `- ★ MANDATORY 结构化 quickView 字段（5 组，独立喂报告"快速视图"卡片，与 prose 章节并存）：`,
      `  keyFindingsByDimension: 每维度抽 2-4 条 finding，每条标 significance (high/medium/low)`,
      `    - ★ 2026-05-27 (#108) finding + body 分字段双层结构（参照 Topic Insight 快速视图）：`,
      `      • finding: 8-20 字中文标题（提炼核心点，如"能源供给约束与液冷拐点"）`,
      `      • body:    80-200 字中文解释段，独立成段；写完整 "发现 + 证据 + 数字/案例 + 解读" 四段式`,
      `      • body 必须填写 — 不允许只输出 finding 不写 body；缺失会让快速视图卡片空白`,
      `      • body 必须带具体数字 / 实体名 / 时间窗口 / 来源类别；避免重复 themeSummary 措辞`,
      `    - high   = 决定性证据 / 多源一致 / 直接驱动结论`,
      `    - medium = 重要支撑但有待印证 / 单源`,
      `    - low    = 背景信息 / 不影响主要结论`,
      `  trendsByDimension: 每维度 1-2 条 trend，标 direction (increasing/decreasing/stable/emerging) 和 timeframe`,
      `    - increasing = 量级或采纳度上升`,
      `    - decreasing = 下降 / 衰退`,
      `    - stable     = 稳态 / 渐进 / 横盘`,
      `    - emerging   = 新兴 / 萌芽 / 未来 1-2 年值得关注`,
      `  riskMatrix: 3-6 条结构化风险，每条 { riskType, probability: 高/中/低, impact: 高/中/低, timeframe }`,
      `    - probability "高" ≈ 12 个月内大概率发生；"中" 24 个月内可能；"低" 仅理论可能`,
      `    - impact "高" ≈ 颠覆主结论 / 重大损失；"中" 影响一个维度；"低" 局部影响`,
      `  recommendationsByAudience: 按 forEnterprise / forInvestors 二受众，每受众分 shortTerm (6-12月) / midTerm (1-3年)`,
      `    - shortTerm 每受众至少 2 条具体可执行项；midTerm 至少 1 条`,
      `    - forEnterprise 关注落地路径；forInvestors 关注配置 / 风险敞口`,
      `  whatYouWillLearn: 3-5 条精炼读后感（"读完本报告你将了解…"），每条 ≤ 30 字，避免重复 themeSummary 措辞`,
      `- ★ MANDATORY 前瞻判断 foresight（洞察的最高价值在于"向前看"，必须输出，方法论硬约束）：`,
      `  这是报告 Outlook 章节的素材。务必基于上面的 factTable / 已对账证据做推断，不要凭空想象。`,
      `  baseCase: 2-4 条对未来的核心判断，每条必须：`,
      `    • judgment:           具体且可证伪的未来判断（不是"可能有变化"这类废话）`,
      `    • probability:        0~1 的数字概率（如 0.65）。禁用"高/中/低"——必须落到数字`,
      `    • confidence:         low/moderate/high，表示你对"这个判断"本身的信心，独立于 probability`,
      `      （probability 高 ≠ confidence 高：证据薄时即便概率估 0.7，confidence 也应为 low）`,
      `    • horizon:            0-6m / 6-18m / 18m-3y / 3y+ 之一`,
      `    • resolutionCriteria: 到期如何裁定应验/证伪（如"官方季度财报披露该指标 > X"）。必须可客观核验`,
      `    • baseRate:           ★ 外部视角优先：先给同类事件的历史基准率（如"同类技术过去 3 年商用化率约 30%"），再叠加本案特殊性`,
      `    • evidenceIds:        引用支撑该判断的 factTable 证据 id（来自 Reconciler）`,
      `  scenarios: 必须给 bull / base / bear 三条情景，每条 { kind, narrative, trigger(触发条件), probability }`,
      `    - 三条 probability 之和应接近 1（互斥穷尽近似）`,
      `  predeterminedElements: 近乎必然发生的要素（无论哪个情景都成立，如人口结构/已签约产能）`,
      `  criticalUncertainties: 真正决定走向的关键不确定性（情景之间的分叉点）`,
      `  leadingIndicators: 2-4 条早期信号，每条 { signal(可观测信号), watchFor(出现什么算应验/证伪) }`,
      `    - 目的：让读者能持续跟踪判断是否在兑现，让判断可证伪`,
      ...conflictBlock,
      ...reportBlock,
      ...termBlock,
      ...achBlock,
      ``,
      `Final output JSON shape (exact field names required):`,
      `{`,
      `  "themeSummary": "<400-600 字主题综合，这是报告执行摘要的核心，务必完整>",`,
      `  "preface": "<200-300 字前言，研究背景 + 报告意义>",`,
      `  "crossDimAnalysis": "<400-600 字跨维度综合分析>",`,
      `  "riskAssessment": "<400-600 字风险评估，高/中/低分级 + 应对建议>",`,
      `  "strategicRecommendations": "<400-600 字战略建议，按受众分组>",`,
      `  "conclusion": "<150-250 字结论，3 个核心洞察 + 整体定调>",`,
      `  "insights": [`,
      `    {`,
      `      "headline": "<short insight title>",`,
      `      "narrative": "<2-4 sentence explanation>",`,
      `      "supportingDimensions": ["<dimension name>", ...],`,
      `      "confidence": 0.85`,
      `    }`,
      `    // 3-7 insights`,
      `  ],`,
      `  "contradictions": [`,
      `    { "claim": "<conflicting claim>", "conflictingSources": ["..."], "resolution": "..." }`,
      `  ],`,
      `  "keyFindingsByDimension": [`,
      `    { "dimensionName": "<dim name>", "findings": [`,
      `      {`,
      `        "finding": "<8-20 字中文标题>",`,
      `        "body": "<80-200 字解释段，含数字/案例/时间窗口/解读>",`,
      `        "significance": "high" | "medium" | "low"`,
      `      }`,
      `    ] }`,
      `  ],`,
      `  "trendsByDimension": [`,
      `    { "dimensionName": "<dim name>", "trends": [`,
      `      { "trend": "<short trend>", "direction": "increasing"|"decreasing"|"stable"|"emerging", "timeframe": "<e.g. 12个月/2026Q3/未来 3 年>" }`,
      `    ] }`,
      `  ],`,
      `  "riskMatrix": [`,
      `    { "riskType": "<short label>", "probability": "高"|"中"|"低", "impact": "高"|"中"|"低", "timeframe": "<e.g. 6-12个月>" }`,
      `  ],`,
      `  "recommendationsByAudience": {`,
      `    "forEnterprise": { "shortTerm": ["<6-12月可执行项>", ...], "midTerm": ["<1-3年布局>", ...] },`,
      `    "forInvestors":  { "shortTerm": ["<配置/敞口建议>", ...], "midTerm": ["<中期主题>", ...] }`,
      `  },`,
      `  "whatYouWillLearn": ["<≤30 字读后感 1>", "<2>", "<3>"],`,
      `  "foresight": {`,
      `    "baseCase": [`,
      `      {`,
      `        "judgment": "<可证伪的未来判断>",`,
      `        "probability": 0.65,`,
      `        "confidence": "low"|"moderate"|"high",`,
      `        "horizon": "0-6m"|"6-18m"|"18m-3y"|"3y+",`,
      `        "resolutionCriteria": "<到期如何客观裁定应验/证伪>",`,
      `        "baseRate": "<同类事件历史基准率，可选但强烈建议>",`,
      `        "evidenceIds": ["<factTable id>", ...]`,
      `      }`,
      `      // 2-4 条`,
      `    ],`,
      `    "scenarios": [`,
      `      { "kind": "bull", "narrative": "...", "trigger": "<触发条件>", "probability": 0.25 },`,
      `      { "kind": "base", "narrative": "...", "trigger": "...", "probability": 0.55 },`,
      `      { "kind": "bear", "narrative": "...", "trigger": "...", "probability": 0.20 }`,
      `    ],`,
      `    "predeterminedElements": ["<近乎必然的要素>", ...],`,
      `    "criticalUncertainties": ["<关键不确定性/分叉点>", ...],`,
      `    "leadingIndicators": [`,
      `      { "signal": "<可观测早期信号>", "watchFor": "<出现什么算应验/证伪>" }`,
      `      // 2-4 条`,
      `    ]`,
      `  }`,
      `}`,
      ``,
      `Use field names exactly as shown.`,
      `confidence is a number between 0 and 1.`,
      `★ preface / crossDimAnalysis / riskAssessment / strategicRecommendations / conclusion 五个字段是报告章节骨架，`,
      `  必须输出真实内容（非占位符）。缺失任何一项将导致报告章节空白，质量评分自动 -20。`,
      `★ keyFindingsByDimension / trendsByDimension / riskMatrix / recommendationsByAudience / whatYouWillLearn 是快速视图骨架，`,
      `  缺失会让快速视图卡片空白；优先保证它们与 prose 章节内容一致（不要前后矛盾）。`,
      `★ foresight 是报告 Outlook 章节与"未来推演"卡片的唯一来源，是本报告体现洞察价值的核心，必须输出。`,
      `  probability 必须是 0~1 数字；baseCase 必须引用 factTable 证据；判断必须可证伪（有 resolutionCriteria）。`,
      ...(input.retryHint
        ? ["", `## ★ Retry 提示（上一次失败原因）`, input.retryHint, ""]
        : []),
    ].join("\n");
  }
}
