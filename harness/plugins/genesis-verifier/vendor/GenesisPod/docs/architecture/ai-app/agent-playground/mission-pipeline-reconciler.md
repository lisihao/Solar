# Reconciler 子文档（[3.5] 节点 / Q6）

> **基线版本**：v0.1 / 2026-04-26
> **上游**：mission-pipeline-baseline.md §3.5 / §10 Q6 / §13 P0
> **优先级**：P0

---

## 1. 问题域

N 个 Researcher 并行产出独立 dim findings，可能出现：

- **事实冲突**：dim A 说 X、dim B 说反 X
- **数据矛盾**：同一指标不同数字
- **重叠覆盖**：dim 切分不 MECE，两 dim 写同一件事
- **空白漏掉**：所有 dim 假设 Y 由别人覆盖，结果没人写
- **图候选汇总**：多 dim 抓到的 figureCandidates 需统一去重过滤（参 baseline §7.4 [B]）

Reconciler 节点在 Researchers 完成后、Analyst 之前**强制对账**，输出结构化结果，下游 Analyst / Writer 必须显式消费。

---

## 2. Spec

```typescript
@DefineAgent({
  id: 'playground.reconciler',
  version: '1.0.0',
  loop: 'react',
  toolCategories: ['processing', 'information'],  // 用 rag-search 二次确认
  budget: { maxTokens: 20_000, maxIterations: 3, maxWallTimeMs: 120_000 },
  taskProfile: {
    creativity: 'deterministic',     // 对账活儿要稳定
    outputLength: 'medium',
    reasoningDepth: 'moderate',
  },
  inputSchema: ReconcilerInput,
  outputSchema: ReconcilerOutput,
  validateBusinessRules: validateReconcilerOutput,
})
```

---

## 3. 输入 / 输出契约

```typescript
interface ReconcilerInput {
  topic: string;
  language: "zh-CN" | "en-US";
  plan: { themeSummary: string; dimensions: Dimension[] };
  researcherResults: ResearcherOutput[]; // 含 figureCandidates
}

interface ReconcilerOutput {
  factTable: FactTriple[]; // 三元组事实表
  conflicts: Conflict[]; // 同 (entity, attribute) 多 value
  overlaps: Overlap[]; // 跨 dim 内容重叠
  gaps: Gap[]; // plan 覆盖 - 实际产出
  figureCandidates: FigureCandidate[]; // 去重过滤后的图候选池
  reconciliationReport: string; // 可读 markdown 总结
}

interface Conflict {
  factIds: string[]; // 涉及的 factTable id
  resolutionType: "kept-both" | "preferred-one" | "flagged-unresolved";
  preferredFactId?: string; // resolutionType='preferred-one' 时必填
  rationale: string; // 为什么这么处理
}

interface Overlap {
  dimensionPair: [string, string];
  similarityScore: number; // embedding cosine
  overlappingClaim: string;
  resolutionAction: "merge-into-cross-dim" | "keep-both" | "drop-from-second";
}

interface Gap {
  dimensionId: string; // plan 中的 dim
  expectedAspects: string[]; // plan.rationale 提示但未产出的 aspect
  severity: "critical" | "minor";
}

interface FigureCandidate {
  id: string;
  type: "reference" | "extracted_chart";
  evidenceCitationIndex: number; // 必挂引用
  sourceUrl: string;
  imageUrl?: string;
  data?: ChartData;
  caption: string;
  relevanceScore: number; // embedding 相似度（topic + dim）
  passedGarbageFilter: boolean;
  fromDimensionId: string;
}
```

---

## 4. 内部步骤（W1~W6 子流程）

```
R1. 抽取事实表
    遍历 researcherResults[].findings → 抽 (entity, attribute, value, sources[])
    LLM 辅助：把 finding.claim 解析成结构化三元组
    输出 factTable

R2. 冲突检测
    factTable 按 (entity, attribute) 分组
    多 value → flag conflict

R3. 冲突解决（按 credibilityScore 决策）
    - 单一来源高 credibility（>80）→ preferred-one
    - 多来源等可信 → kept-both + 标注分歧
    - 来源不足 → flagged-unresolved（极少数）

R4. 重叠检测
    跨 dim 提取所有 claim → embedding
    相似度 > 0.6 → overlap
    决策：核心论断 → merge-into-cross-dim；细节差异 → keep-both

R5. 空白检测
    plan.dimensions[i].rationale 中提示的 aspects
    vs 实际 findings 覆盖
    缺失关键 aspect → gap (critical)

R6. 图候选池构建
    汇总所有 researcherResults[].figureCandidates
    isGarbageFigureUrl 黑名单过滤（照搬 TI）
    Embedding 相似度过滤（照搬 TI figure-relevance.service.ts）
    去重（同 sourceUrl 合并）
    输出 figureCandidates

R7. reconciliationReport 生成
    把 conflicts / overlaps / gaps 写成可读 markdown
    供 Analyst 直接 quote 到 contradictions / gaps 字段
```

---

## 5. 业务规则校验

```typescript
function validateReconcilerOutput(out: ReconcilerOutput): void {
  // 每个 conflict 必须有 resolutionType
  for (const c of out.conflicts) {
    if (c.resolutionType === "preferred-one" && !c.preferredFactId)
      throw new Error("preferred-one conflict missing preferredFactId");
    if (!c.rationale || c.rationale.length < 20)
      throw new Error("conflict rationale too short");
  }
  // flagged-unresolved 比例不能过高
  const unresolved = out.conflicts.filter(
    (c) => c.resolutionType === "flagged-unresolved",
  ).length;
  if (unresolved / Math.max(1, out.conflicts.length) > 0.3)
    throw new Error("too many unresolved conflicts (>30%)");
  // 每张 figureCandidate 必须挂 evidenceCitationIndex + sourceUrl
  for (const f of out.figureCandidates) {
    if (!f.evidenceCitationIndex)
      throw new Error("figure missing evidenceCitationIndex");
    if (!f.sourceUrl) throw new Error("figure missing sourceUrl");
  }
}
```

---

## 6. 下游消费约束

| 下游      | 必须消费的字段                                                       |
| --------- | -------------------------------------------------------------------- |
| Analyst   | conflicts → contradictions / gaps → gaps（不允许假装看不见）         |
| Writer W1 | factTable → factAllocation 提前分配 / figureCandidates → figurePlan  |
| Writer W3 | conflicts → 显式处理（preferred-one 论断写主流，kept-both 标注分歧） |
| Writer W4 | reconciliationReport → 可作为 appendix（可选）                       |
| Reviewer  | factTable.conflict → 校验是否在终稿中被 properly handle              |

---

## 7. emit 事件

```typescript
{
  type: 'reconciliation:completed',
  payload: {
    factCount: number;
    conflictCount: number;
    overlapCount: number;
    gapCount: number;
    figureCandidateCount: number;
    unresolvedConflictCount: number;
  }
}
```

---

## 8. 实现要点

- factTable 抽取用 deterministic creativity，避免 LLM 漂移
- conflicts 解决依赖 credibilityScore，所以必须保证 Researcher 阶段的 source.credibilityScore 已计算
- 图候选过滤的 Embedding 调用走 EmbeddingService（已有）
- reconciliationReport 写法：每节单独标 `<!-- consumable-by: analyst -->` 注释，方便下游精确 quote

---

## 9. 验收标准

- 能识别同 entity 不同来源的数字冲突（如"销售额 X 亿"）
- 能识别两 dim 写同一件事（embedding > 0.6）
- 能识别 plan 提示但未覆盖的 aspect
- 输出 factTable 可被 Writer 直接消费做 factAllocation
- 输出 figureCandidates 已去重 + 过滤垃圾 + 挂 evidenceCitationIndex
- emit reconciliation:completed 事件含完整计数

---

## 10. 风险 / 边界

- 事实抽取可能漏抽（claim 不规范时）→ Reviewer 阶段 traceability 硬指标兜底
- 冲突解决策略可能保守（倾向 kept-both）→ 用户档位 thorough 时启用 L4 critic 强制裁决
- 重叠相似度阈值 0.6 可能误判（同 entity 不同 attribute 偶尔高相似）→ 二次校验（人工归并 vs 自动）
