/**
 * Reconciler Agent —— Stage B' 对账节点
 *
 * 上游：mission-pipeline-baseline.md §3.5 / mission-pipeline-reconciler.md
 *
 * 职责：N 个并行 Researcher 完成后、Analyst 之前**强制对账**：
 *   - 抽取事实表（entity, attribute, value, sources[]）
 *   - 检测冲突（同 (entity, attribute) 多 value）
 *   - 检测重叠（跨 dim 内容相似度高）
 *   - 检测空白（plan 覆盖 - 实际产出）
 *   - 汇总图候选池（去重 + 黑名单过滤）
 *   - 输出 reconciliationReport：可读 markdown，下游 Analyst / Writer 强制消费
 *
 * 关键差异（vs TI）：
 *   - TI 的 consistency-check 是 optional log；本 Reconciler 强制阻塞
 *   - 输出结构化 conflicts/overlaps/gaps 字段，不只是 markdown 文本
 *   - 图候选池去重 + 挂 evidenceCitationIndex（baseline §7.4 红线）
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";

const FactTriple = z.object({
  id: z.string(),
  entity: z.string(),
  attribute: z.string(),
  value: z.string(),
  sources: z.array(z.string()).min(1), // URL 或 [N] 编号
});

const Conflict = z.object({
  factIds: z.array(z.string()).min(2),
  resolutionType: z.enum(["kept-both", "preferred-one", "flagged-unresolved"]),
  preferredFactId: z.string().optional(),
  rationale: z.string().min(20),
});

const Overlap = z.object({
  dimensionPair: z.tuple([z.string(), z.string()]),
  similarityScore: z.number().min(0).max(1),
  overlappingClaim: z.string(),
  resolutionAction: z.enum([
    "merge-into-cross-dim",
    "keep-both",
    "drop-from-second",
  ]),
});

const Gap = z.object({
  dimensionId: z.string(),
  expectedAspects: z.array(z.string()).min(1),
  severity: z.enum(["critical", "minor"]),
});

const FigureCandidate = z.object({
  id: z.string(),
  type: z.enum(["reference", "extracted_chart"]),
  evidenceCitationIndex: z.number().int().min(1),
  // P55-1: sourceUrl 必须 https（合规图来源）
  sourceUrl: z
    .string()
    .url()
    .refine((u) => /^https:\/\//i.test(u), { message: "sourceUrl 必须 https" }),
  imageUrl: z.string().url().optional(),
  data: z.unknown().optional(),
  caption: z.string(),
  relevanceScore: z.number().min(0).max(1),
  passedGarbageFilter: z.boolean(),
  fromDimensionId: z.string(),
});

// ★ ACH 竞争性假设分析 (2026-05-29 前瞻洞察 L2)：情报分析 tradecraft —— 列举未来假设并
//   主动从已有 findings 中寻找**证伪证据**（而非确认证据），供 Analyst 的 foresight 消费
//   （已 refuted 的假设不得进入 baseCase）。
const AlternativeHypothesis = z.object({
  id: z.string(),
  statement: z.string().min(20), // "若 X，则 Y" 形式的未来因果陈述
  likelihood: z.enum(["low", "medium", "high"]),
  refutingEvidence: z
    .array(
      z.object({
        claim: z.string(), // 来自 researcher findings 的反证
        source: z.string(), // URL 或 [N] 编号
        strength: z.enum(["weak", "moderate", "strong"]),
      }),
    )
    .min(1), // ACH 核心：每个假设至少 1 条证伪证据
  status: z.enum(["plausible", "unlikely", "refuted"]),
});

const Input = z.object({
  topic: z.string(),
  language: z.enum(["zh-CN", "en-US"]),
  plan: z.object({
    themeSummary: z.string(),
    dimensions: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        rationale: z.string(),
      }),
    ),
  }),
  researcherResults: z.array(
    z.object({
      dimension: z.string(),
      findings: z.array(
        z.object({
          claim: z.string(),
          evidence: z.string(),
          source: z.string(),
        }),
      ),
      summary: z.string(),
      // ★ Phase P1-1: Researcher 抽到的图候选（baseline §7.4 图来源红线）
      figureCandidates: z
        .array(
          z.object({
            sourceUrl: z.string(),
            imageUrl: z.string().optional(),
            caption: z.string(),
            sourcePageOrSection: z.string().optional(),
            relevanceHint: z.enum(["high", "medium", "low"]).optional(),
          }),
        )
        .default([]),
    }),
  ),
});

const Output = z.object({
  factTable: z.array(FactTriple),
  conflicts: z.array(Conflict),
  overlaps: z.array(Overlap),
  gaps: z.array(Gap),
  figureCandidates: z.array(FigureCandidate),
  // ★ ACH (2026-05-29 L2)：竞争性假设分析。default [] 让单维/证据不足时合法短路。
  alternativeHypotheses: z.array(AlternativeHypothesis).default([]),
  // P71-1: reconciliationReport cap 5000 字符（避免下游 prompt 爆）
  reconciliationReport: z.string().min(20).max(5000),
  // P78-2: 对齐 TI report-editor.deduplicationStats（统计去重指标供 UI 展示）
  deduplicationStats: z
    .object({
      duplicatesRemoved: z.number().int().min(0).default(0),
      termVariantsUnified: z.number().int().min(0).default(0),
      dataInconsistenciesFlagged: z.number().int().min(0).default(0),
    })
    .optional(),
  // P81-2: 术语对照表（多个 dim 写"AI" / "人工智能" / "机器学习" 时合并到主术语）
  termGlossary: z
    .array(
      z.object({
        canonical: z.string(),
        variants: z.array(z.string()).min(1),
      }),
    )
    .default([]),
  // P114-1: 处理 figure pool 的统计（figure 来源跟踪）
  figurePoolStats: z
    .object({
      totalCandidates: z.number().int().min(0).default(0),
      filteredAsGarbage: z.number().int().min(0).default(0),
      duplicates: z.number().int().min(0).default(0),
      finalAccepted: z.number().int().min(0).default(0),
    })
    .optional(),
});

@DefineAgent({
  id: "playground.reconciler",
  version: "1.0.0",
  identity: {
    role: "reconciler",
    description:
      "Reconcile cross-dimension findings: extract fact table, detect conflicts/overlaps/gaps, build figure candidate pool",
  },
  loop: "react",
  // PR-X-skill-bridge: cross-dim-fact-check SKILL.md 提供完整对账协议
  skills: ["cross-dim-fact-check"],
  // 2026-05-09 工具矩阵审计：之前 ["information","processing"] 注入 ~30 工具
  // catalog 到 prompt（每次 mission 烧 3-5K tokens × 6 dim ≈ 30K），但 prompt
  // body 6 步全部是"do NOT produce new research, only reconcile"，从未调用任
  // 何 tool。"二次确认 rag-search / web-search 验证存疑事实"是过期意图——
  // budget(maxTokens=20k/maxIter=3) 也不支持。清空避免无谓 token 烧。
  // 未来若要做事实复核，应先把 prompt 改成显式调用，再恢复 toolCategories。
  toolCategories: [],
  taskProfile: {
    creativity: "deterministic",
    outputLength: "medium",
    taskKind: "classify",
    reasoningDepth: "minimal",
  },
  inputSchema: Input,
  outputSchema: Output,
  // ★ 2026-05-29 L2：+4k tokens 头寸给 ACH 竞争性假设输出（2-4 假设 + 证伪证据）
  budget: { maxTokens: 24_000, maxIterations: 3, maxWallTimeMs: 120_000 },
})
export class ReconcilerAgent extends AgentSpec<typeof Input, typeof Output> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    const langInstruction =
      input.language === "zh-CN" ? "用中文输出。" : "Respond in English.";
    return [
      `You are a reconciler for a multi-dimension research mission.`,
      `Topic: "${input.topic}". ${langInstruction}`,
      `Number of researcher outputs: ${input.researcherResults.length}.`,
      ``,
      `## Your job (do NOT produce new research, only reconcile)`,
      ``,
      `1. **Extract fact table**: scan all findings, distill (entity, attribute, value, sources[]) triples.`,
      `   - sources is a list of URL or finding source strings — multi-source increases confidence.`,
      `   - Each fact gets a stable id like "fact-1", "fact-2"...`,
      ``,
      `2. **Detect conflicts**: same (entity, attribute) with different values.`,
      `   - resolutionType:`,
      `     * "preferred-one" if one source has clearly higher credibility (gov / academic > blog) → set preferredFactId`,
      `     * "kept-both" if sources are equally credible → keep both with annotation`,
      `     * "flagged-unresolved" only if no enough info to decide (rare; <30% of conflicts)`,
      `   - rationale must be ≥ 20 chars explaining the decision.`,
      ``,
      `3. **Detect overlaps**: cross-dim claims with similar meaning (semantic, not exact match).`,
      `   - similarityScore: estimate 0-1 (you don't run embeddings, judge by reading)`,
      `   - resolutionAction:`,
      `     * "merge-into-cross-dim" — core finding shared across dims, write once in cross-dim section`,
      `     * "keep-both" — different angle on same topic, keep in respective dims`,
      `     * "drop-from-second" — verbatim duplicate, keep in primary dim`,
      ``,
      `4. **Detect gaps**: plan.dimensions[i].rationale promises certain aspects but findings don't cover.`,
      `   - severity "critical" if gap breaks dim's purpose; "minor" if peripheral.`,
      ``,
      `5. **Figure candidates**: 把 researcherResults[*].figureCandidates 的所有图聚合到一个数组。`,
      `   - 去重：sourceUrl 相同 → 保 relevanceHint 最高的一条`,
      `   - 跨 dim 合并：每个候选保留 sourceUrl / imageUrl / caption / sourcePageOrSection / relevanceHint 原字段`,
      `   - 不要凭空创造图，不要"建议生成图"。只汇总 Researcher 已抽到的真实图。`,
      `   - 单 mission 最多保留 20 张（按 relevanceHint=high 优先 + caption 信息量倒序）`,
      `   - 没有任何 figureCandidates 输入时给 [] —— 宁缺勿滥。`,
      ``,
      `6. **reconciliationReport**: concise markdown summary, ≤1500 chars total. Sections:`,
      `   - "# 对账总览" / "# Reconciliation Overview"`,
      `   - "## 事实表概要" / "## Fact Table Summary"  (count + 关键 entity)`,
      `   - "## 冲突" — list each conflict + resolution + rationale snippet`,
      `   - "## 重叠" — list each overlap + action`,
      `   - "## 空白" — list each gap + severity`,
      `   - "## 下游消费指引" — 一句话告诉 Analyst/Writer 注意什么（如"对 dim-2 中事实 X，必须采用 [N] 的来源"）`,
      `   Down-stream Analyst & Writer MUST consume this — be precise and quotable.`,
      ``,
      `7. **竞争性假设分析 (ACH)** —— 情报分析方法，为下游 foresight 提供"经过证伪检验"的未来假设：`,
      `   - 基于 fact table 列举 2-4 个"未来可能走向"假设，每个写成"若 X，则 Y"的因果陈述（面向未来，非过去事实）。`,
      `   - ★ 关键纪律：对每个假设，**主动从 researcher findings 中找证伪证据**（refuting evidence），不是找支持证据。`,
      `     人天然爱找确认证据，ACH 强制反过来——这是它的全部价值所在。`,
      `   - 每个假设至少 1 条 refutingEvidence，标 strength (weak/moderate/strong) + source（[N] 或 URL）。`,
      `   - status：refuted（有 strong 证伪）/ unlikely（有 moderate 证伪）/ plausible（仅 weak 证伪，仍站得住）。`,
      `   - 不要凭空臆测：假设和证伪证据都必须能从已有 findings 追溯。证据不足就少列或给 []。`,
      ``,
      `## Hard rules`,
      `- factTable.length ≥ 3 (最起码抽几个核心事实)`,
      `- 每个 conflict 必须有 rationale ≥ 20 chars`,
      `- conflicts 中 flagged-unresolved 占比 ≤ 30%`,
      `- gaps 可以是空数组（covered well 也合法）`,
      ``,
      `## Output JSON shape:`,
      `{`,
      `  "factTable": [{ "id":"fact-1","entity":"...","attribute":"...","value":"...","sources":["..."] }],`,
      `  "conflicts": [{ "factIds":["fact-1","fact-3"], "resolutionType":"preferred-one", "preferredFactId":"fact-1", "rationale":"..." }],`,
      `  "overlaps": [{ "dimensionPair":["dim-1","dim-2"], "similarityScore":0.7, "overlappingClaim":"...", "resolutionAction":"merge-into-cross-dim" }],`,
      `  "gaps": [{ "dimensionId":"dim-2", "expectedAspects":["..."], "severity":"minor" }],`,
      `  "figureCandidates": [],`,
      `  "alternativeHypotheses": [`,
      `    { "id":"hyp-1", "statement":"若…则…（面向未来的因果陈述）", "likelihood":"medium",`,
      `      "refutingEvidence":[{ "claim":"<来自 findings 的反证>", "source":"[3]", "strength":"moderate" }],`,
      `      "status":"unlikely" }`,
      `  ],`,
      `  "reconciliationReport": "<markdown>",`,
      `  "deduplicationStats": {`,
      `    "duplicatesRemoved": <number>,`,
      `    "termVariantsUnified": <number>,`,
      `    "dataInconsistenciesFlagged": <number>`,
      `  },`,
      `  "termGlossary": [`,
      `    { "canonical": "人工智能", "variants": ["AI", "Artificial Intelligence", "AGI"] }`,
      `    // ... 在多个 dim 中混用同一概念时，建立主术语 → 变体的映射`,
      `  ],`,
      `  "figurePoolStats": {`,
      `    "totalCandidates": <number>,`,
      `    "filteredAsGarbage": <number>,`,
      `    "duplicates": <number>,`,
      `    "finalAccepted": <number>`,
      `  }`,
      `}`,
    ].join("\n");
  }

  /**
   * 业务规则校验（mission-pipeline-reconciler.md §5）
   */
  validateBusinessRules(output: z.infer<typeof Output>): void {
    const issues: string[] = [];
    if (!output.factTable || output.factTable.length < 3) {
      issues.push(
        `factTable.length=${output.factTable?.length ?? 0} (要求 ≥3)`,
      );
    }
    // P9-3: 检查 factTable id 唯一
    const seenFactIds = new Set<string>();
    // P83-3: 同 (entity, attribute) 出现多次时必须有对应 conflict（否则就是真重复）
    const entAttr = new Map<string, string[]>(); // key → factIds
    for (const f of output.factTable ?? []) {
      if (seenFactIds.has(f.id)) {
        issues.push(`factTable id 重复: ${f.id}`);
      }
      seenFactIds.add(f.id);
      const key = `${f.entity}::${f.attribute}`;
      const arr = entAttr.get(key) ?? [];
      arr.push(f.id);
      entAttr.set(key, arr);
    }
    for (const [key, ids] of entAttr) {
      if (ids.length > 1) {
        const hasConflict = (output.conflicts ?? []).some((c) =>
          ids.every((fid) => c.factIds.includes(fid)),
        );
        if (!hasConflict) {
          issues.push(
            `factTable 重复 (entity, attribute)=${key} factIds=${ids.join(",")} 但未在 conflicts 中标记`,
          );
        }
      }
    }
    // P9-3: conflict.factIds 必须 ⊆ factTable.id
    for (const c of output.conflicts ?? []) {
      for (const fid of c.factIds) {
        if (!seenFactIds.has(fid)) {
          issues.push(`conflict 引用了不存在的 factId: ${fid}`);
        }
      }
    }
    for (const c of output.conflicts) {
      if (c.resolutionType === "preferred-one" && !c.preferredFactId) {
        issues.push(`conflict ${c.factIds.join(",")} 缺 preferredFactId`);
      }
      if (!c.rationale || c.rationale.length < 20) {
        issues.push(
          `conflict ${c.factIds.join(",")} rationale 太短（要求 ≥20）`,
        );
      }
    }
    const unresolved = output.conflicts.filter(
      (c) => c.resolutionType === "flagged-unresolved",
    ).length;
    if (
      output.conflicts.length > 0 &&
      unresolved / output.conflicts.length > 0.3
    ) {
      issues.push(
        `unresolved conflicts=${unresolved}/${output.conflicts.length} 超过 30%`,
      );
    }
    for (const f of output.figureCandidates) {
      if (!f.evidenceCitationIndex)
        issues.push(`figure ${f.id} 缺 evidenceCitationIndex`);
      if (!f.sourceUrl) issues.push(`figure ${f.id} 缺 sourceUrl`);
    }
    // P48-1: figureCandidates cap 20（mission 级，避免单 dim 暴涨）
    if (output.figureCandidates.length > 20) {
      issues.push(
        `figureCandidates.length=${output.figureCandidates.length} 超上限 20`,
      );
    }
    // ★ ACH (2026-05-29 L2)：每个假设必须有证伪证据；标 refuted 的须有 strong 级证伪
    for (const h of output.alternativeHypotheses ?? []) {
      if (!h.refutingEvidence || h.refutingEvidence.length === 0) {
        issues.push(`hypothesis ${h.id} 缺 refutingEvidence（ACH 要求 ≥1）`);
      }
      if (
        h.status === "refuted" &&
        !(h.refutingEvidence ?? []).some((e) => e.strength === "strong")
      ) {
        issues.push(`hypothesis ${h.id} 标记 refuted 但无 strong 级证伪证据`);
      }
    }
    // ACH 列表 cap 8（避免发散，对账阶段不是自由头脑风暴）
    if ((output.alternativeHypotheses ?? []).length > 8) {
      issues.push(
        `alternativeHypotheses.length=${output.alternativeHypotheses.length} 超上限 8`,
      );
    }
    if (issues.length > 0) throw new Error(issues.join("; "));
  }
}
