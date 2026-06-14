> **⚠ 已归档** — 本文档为 V5 改进计划的原始设计稿，实际实现与本文档存在差异（约 60% 已实现）。
> 请参阅最新架构文档：[`docs/architecture/ai-apps/topic-research/v5-cognitive-research-architecture.md`](../../architecture/ai-apps/topic-research/v5-cognitive-research-architecture.md)
>
> 归档时间：2026-02-01

# Genesis Research V5 — 认知研究团队架构（已归档）

## 目录

- [1. 愿景与定位](#1-愿景与定位)
- [2. 真实研究团队对标](#2-真实研究团队对标)
- [3. V5 架构总览](#3-v5-架构总览)
  - [3.1 认知研究循环（核心范式）](#31-认知研究循环核心范式)
  - [3.2 五层架构](#32-五层架构)
  - [3.3 Phase 全景图](#33-phase-全景图)
- [4. Layer 1：研究设计层](#4-layer-1研究设计层)
  - [4.1 分析框架选择](#41-分析框架选择)
  - [4.2 研究假设生成](#42-研究假设生成)
  - [4.3 交付标准协商](#43-交付标准协商)
- [5. Layer 2：知识构建层](#5-layer-2知识构建层)
  - [5.1 假设驱动搜索](#51-假设驱动搜索)
  - [5.2 文献基线扫描](#52-文献基线扫描)
  - [5.3 迭代证据收集](#53-迭代证据收集)
- [6. Layer 3：分析推理层](#6-layer-3分析推理层)
  - [6.1 结构化分析方法](#61-结构化分析方法)
  - [6.2 交叉验证引擎](#62-交叉验证引擎)
  - [6.3 假设检验与修正](#63-假设检验与修正)
- [7. Layer 4：多稿迭代层](#7-layer-4多稿迭代层)
  - [7.1 初稿生成](#71-初稿生成)
  - [7.2 反思与自审](#72-反思与自审)
  - [7.3 定向修改](#73-定向修改)
- [8. Layer 5：编辑审校层](#8-layer-5编辑审校层)
  - [8.1 事实核查](#81-事实核查)
  - [8.2 编辑润色](#82-编辑润色)
  - [8.3 质量门控](#83-质量门控)
- [9. 基础设施](#9-基础设施)
  - [9.1 ResearchContext（研究上下文）](#91-researchcontext研究上下文)
  - [9.2 ResearchStrategy（策略模式）](#92-researchstrategy策略模式)
  - [9.3 类型定义](#93-类型定义)
- [10. 前端兼容性保障](#10-前端兼容性保障)
- [11. 与 V3 的关系](#11-与-v3-的关系)
- [12. 修改文件清单](#12-修改文件清单)
- [13. 分阶段实施路线](#13-分阶段实施路线)
- [14. 验证方案](#14-验证方案)
- [15. 研究深度参数对照](#15-研究深度参数对照)

---

## 1. 愿景与定位

**目标**：构建一个能替代 5-8 人专业研究团队的 AI 研究系统。

**对标物**：麦肯锡行业研究报告、头部券商深度研报、Anthropic 多 Agent 研究系统。

**核心范式转变**：

```
V3（流水线）: 搜索 → 写作 → 审查 → 完成
V5（认知循环）: 假设 → 搜索 → 分析 → 验证 → 修正假设 → 补充搜索 → 多稿迭代 → 审校
```

**三个不可妥协的标准**：

1. **每一个核心论断必须有 2+ 独立来源交叉验证**
2. **每一份报告必须有明确的分析框架和研究假设**
3. **每一个章节必须经过"写→审→改"至少两轮迭代**

---

## 2. 真实研究团队对标

| 研究团队角色                            | V5 对应机制             | 实现层    |
| --------------------------------------- | ----------------------- | --------- |
| **研究总监** — 立项、定框架、定标准     | Leader + ResearchDesign | Layer 1   |
| **文献研究员** — 读现有报告，建立基线   | 文献基线扫描            | Layer 2   |
| **数据研究员** — 多渠道搜集数据         | 假设驱动搜索 + 迭代收集 | Layer 2   |
| **分析师** — SWOT/PESTEL/建模分析       | 结构化分析方法          | Layer 3   |
| **事实核查员** — 验证数据准确性         | 交叉验证引擎            | Layer 3   |
| **高级研究员** — 提出洞察、检验假设     | 假设检验与修正          | Layer 3   |
| **撰稿人** — 撰写报告初稿               | SectionWriter           | Layer 4   |
| **编辑** — 审稿、润色、一致性检查       | 编辑审校                | Layer 5   |
| **团队评审会** — 交叉review、质疑、改进 | 反思与自审 + 质量门控   | Layer 4/5 |

---

## 3. V5 架构总览

### 3.1 认知研究循环（核心范式）

```
                    ┌──────────────────────────┐
                    │     Layer 1: 研究设计      │
                    │  框架选择 → 假设生成       │
                    │  → 交付标准协商            │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
              ┌────▶│     Layer 2: 知识构建      │
              │     │  文献基线 → 假设驱动搜索   │
              │     │  → 迭代证据收集            │
              │     └────────────┬─────────────┘
              │                  │
              │     ┌────────────▼─────────────┐
              │     │     Layer 3: 分析推理      │
   认知循环    │     │  结构化分析 → 交叉验证     │◀──┐
   (最多2轮)  │     │  → 假设检验与修正          │   │
              │     └────────────┬─────────────┘   │
              │                  │                  │
              │          假设被推翻?                │
              │           是 │  否                  │
              └───────────┘  │                     │
                    ┌────────▼─────────────┐       │
                    │     Layer 4: 多稿迭代  │      │
                    │  初稿 → 反思自审       │      │
                    │  → 定向修改 (2轮)      │      │
                    └────────────┬─────────┘       │
                                 │                  │
                    ┌────────────▼─────────────┐   │
                    │     Layer 5: 编辑审校      │   │
                    │  事实核查 → 编辑润色       │   │
                    │  → 质量门控               │───┘
                    └────────────┬─────────────┘ 质量不足
                                 │                 回 Layer 2
                                 ▼                 补充证据
                           输出最终报告
```

### 3.2 五层架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    TopicTeamOrchestrator                         │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │  Layer 1     │  │  Layer 2    │  │  Layer 3                │ │
│  │  研究设计    │─▶│  知识构建   │─▶│  分析推理               │ │
│  │             │  │             │  │  (含认知循环回路)        │ │
│  └─────────────┘  └─────────────┘  └───────────┬─────────────┘ │
│                                                 │               │
│  ┌─────────────┐  ┌─────────────────────────────▼─────────────┐│
│  │  Layer 5     │◀─│  Layer 4                                  ││
│  │  编辑审校    │  │  多稿迭代                                 ││
│  └──────┬──────┘  └───────────────────────────────────────────┘│
│         │                                                       │
│  ┌──────▼──────────────────────────────────────────────────┐   │
│  │              ResearchContext (全局研究上下文)             │   │
│  │  hypotheses[] │ analyticalFramework │ evidenceGraph      │   │
│  │  validatedClaims[] │ researchDesign │ draftHistory[]     │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 Phase 全景图

```
Phase 1    研究设计    Layer 1    Leader 选框架、生成假设、定标准
Phase 2    知识构建    Layer 2    文献扫描 + 假设驱动搜索 + 迭代补充
Phase 3    分析推理    Layer 3    结构化分析 + 交叉验证 + 假设检验
Phase 4    初稿写作    Layer 4    基于分析结果的章节写作
Phase 5    反思修改    Layer 4    自审 + 定向修改（2轮）
Phase 6    编辑审校    Layer 5    事实核查 + 润色 + 质量门控
Phase 7    报告合成    Layer 5    跨维度合成 + 输出

注意：Phase 编号用于后端日志和内部追踪。
前端只看到 currentPhase 的值，不变：
"planning" | "researching" | "reviewing" | "synthesizing" | "completed" | "failed"
```

**Phase → 前端 phase 映射（保证兼容）**：

| 内部 Phase       | 前端 currentPhase | progress 范围 |
| ---------------- | ----------------- | ------------- |
| Phase 1 研究设计 | `"planning"`      | 0-8           |
| Phase 2 知识构建 | `"researching"`   | 8-35          |
| Phase 3 分析推理 | `"researching"`   | 35-50         |
| Phase 4 初稿写作 | `"researching"`   | 50-70         |
| Phase 5 反思修改 | `"reviewing"`     | 70-82         |
| Phase 6 编辑审校 | `"reviewing"`     | 82-90         |
| Phase 7 报告合成 | `"synthesizing"`  | 90-100        |

---

## 4. Layer 1：研究设计层

### 4.1 分析框架选择

**文件**: `research-leader.service.ts`（扩展 `planResearch` 方法）

**原理**: 真实研究团队在动手搜索前，先确定用什么分析框架。框架决定了维度划分、搜索方向和分析结构。

**修改 LEADER_PLAN_PROMPT**，在维度规划前增加框架选择步骤：

```typescript
// 在 LEADER_PLAN_PROMPT 中新增的指令块
const RESEARCH_DESIGN_INSTRUCTION = `
## Step 0: 选择分析框架

在规划维度之前，你必须先选择一个或多个分析框架。框架决定了你如何拆解这个研究主题。

可用框架:
- PESTEL: 政治、经济、社会、技术、环境、法律（适合宏观行业分析）
- Porter五力: 供应商、买方、替代品、新进入者、行业竞争（适合竞争格局分析）
- 价值链分析: 上游→中游→下游→终端应用（适合产业链分析）
- SWOT: 优势、劣势、机会、威胁（适合企业/技术评估）
- 技术采纳曲线: 创新者→早期采用→早期多数→晚期多数→落后者（适合新技术分析）
- 情景分析: 乐观/基准/悲观情景（适合前瞻性分析）
- 自定义: 根据主题特性自行设计框架

选择原则:
1. 主题类型为 MACRO → 优先 PESTEL 或 情景分析
2. 主题类型为 TECHNOLOGY → 优先 技术采纳曲线 或 价值链
3. 主题类型为 COMPANY → 优先 Porter五力 或 SWOT
4. 可以组合使用（如 PESTEL + 价值链）
5. 维度划分必须与所选框架对齐

在 JSON 输出中新增字段:
"researchDesign": {
  "frameworks": ["PESTEL", "价值链"],
  "frameworkRationale": "宏观行业分析需要 PESTEL 覆盖外部因素，价值链分析产业结构",
  "hypotheses": [...],       // 见 4.2
  "deliverableStandard": ... // 见 4.3
}
`;
```

**输出扩展**（`LeaderPlan` 接口新增字段）：

```typescript
interface ResearchDesign {
  frameworks: AnalyticalFramework[];
  frameworkRationale: string;
  hypotheses: ResearchHypothesis[];
  deliverableStandard: DeliverableStandard;
}

type AnalyticalFramework =
  | "PESTEL"
  | "Porter"
  | "ValueChain"
  | "SWOT"
  | "TechAdoption"
  | "ScenarioAnalysis"
  | "Custom";
```

### 4.2 研究假设生成

**原理**: 研究不是漫无目的地搜索，而是带着假设去验证。假设驱动搜索方向，验证结果修正假设。

**在 LEADER_PLAN_PROMPT 中新增**:

```
## Step 1: 提出研究假设

基于所选框架，提出 3-5 个可验证的研究假设。每个假设必须：
1. 可证伪（能找到反面证据）
2. 有明确的验证标准
3. 与至少一个维度相关

假设格式：
"hypotheses": [
  {
    "id": "H1",
    "statement": "中国 AI 芯片将在 2025 年前实现 7nm 量产",
    "type": "trend",                          // trend | causal | comparative | predictive
    "verificationCriteria": "需要 2+ 独立来源确认量产时间线和工艺节点",
    "relatedDimensions": ["技术创新", "产业链"],
    "searchGuidance": "搜索: SMIC 7nm 量产进度, 华为昇腾芯片制程, 国产 EDA 工具链成熟度",
    "nullHypothesis": "7nm 量产受制于设备禁令，2025 年前无法实现"
  }
]
```

**数据结构**:

```typescript
interface ResearchHypothesis {
  id: string; // H1, H2, ...
  statement: string; // 假设陈述
  type: "trend" | "causal" | "comparative" | "predictive";
  verificationCriteria: string; // 验证标准
  relatedDimensions: string[]; // 关联维度
  searchGuidance: string; // 搜索指导
  nullHypothesis: string; // 反面假设

  // 以下字段在 Layer 3 验证后填充
  status?: "confirmed" | "rejected" | "modified" | "insufficient_evidence";
  evidence?: { supporting: string[]; contradicting: string[] };
  revisedStatement?: string; // 修正后的假设
}
```

### 4.3 交付标准协商

**在 LEADER_PLAN_PROMPT 中新增**:

```
## Step 2: 定义交付标准

根据主题复杂度，设定本次研究的质量标准：

"deliverableStandard": {
  "minSourcesPerClaim": 2,              // 每个核心论断的最少独立来源数
  "minDimensionWordCount": 5000,        // 每维度最少字数
  "requiredAnalysisMethods": ["对比分析", "趋势预测"],  // 必须使用的分析方法
  "crossValidationRequired": true,      // 是否要求交叉验证
  "hypothesisVerificationRequired": true // 是否要求假设验证
}
```

**数据结构**:

```typescript
interface DeliverableStandard {
  minSourcesPerClaim: number; // 默认 2
  minDimensionWordCount: number; // 默认 5000
  requiredAnalysisMethods: string[];
  crossValidationRequired: boolean; // 默认 true
  hypothesisVerificationRequired: boolean;
}
```

**与 researchMode 的关系**: 不再用 `standard`/`deep` 二分法。交付标准由 Leader 根据主题复杂度动态决定，用户通过 `topicConfig.researchDepth` 提供偏好（`"quick"` | `"standard"` | `"thorough"`），Leader 据此调整标准参数。

```typescript
// TopicConfig 扩展
interface TopicConfig {
  researchDepth?: "quick" | "standard" | "thorough"; // 替代 researchMode
  // ... 保留现有字段
}
```

**向后兼容**: `researchMode: "standard"` 映射为 `researchDepth: "standard"`，`"deep"` 映射为 `"thorough"`。

---

## 5. Layer 2：知识构建层

### 5.1 假设驱动搜索

**文件**: `data-source-router.service.ts`（扩展 `fetchDataForDimension`）

**原理**: 搜索不再只用 `searchQueries[0]`，而是根据假设生成正/反两方向的查询。

**修改 `buildSearchQueries`**:

```typescript
/**
 * 基于假设生成搜索查询（正面 + 反面）
 */
private buildHypothesisDrivenQueries(
  topic: ResearchTopic,
  dimension: TopicDimension,
  hypotheses: ResearchHypothesis[],
  strategy: ResearchStrategy,
): string[] {
  const queries: string[] = [];

  // 1. 维度基础查询（保留现有逻辑）
  const baseQueries = (dimension.searchQueries as string[]) || [];
  queries.push(...baseQueries.slice(0, strategy.getBaseQueryCount()));

  // 2. 假设正面查询
  const relatedHypotheses = hypotheses.filter(
    (h) => h.relatedDimensions.includes(dimension.name),
  );
  for (const h of relatedHypotheses) {
    if (h.searchGuidance) {
      // 从 searchGuidance 提取查询关键词
      const guidanceQueries = h.searchGuidance
        .split(",")
        .map((q) => q.replace(/^搜索:\s*/, "").trim())
        .filter(Boolean);
      queries.push(...guidanceQueries.slice(0, 2));
    }
  }

  // 3. 反面证据查询（假设检验需要）
  if (strategy.requiresHypothesisTesting()) {
    for (const h of relatedHypotheses) {
      if (h.nullHypothesis) {
        queries.push(`${topic.name} ${h.nullHypothesis}`);
      }
    }
  }

  // 去重 + 限制总数
  const uniqueQueries = [...new Set(queries)];
  return uniqueQueries.slice(0, strategy.getMaxQueriesPerDimension());
}
```

### 5.2 文献基线扫描

**文件**: `data-source-router.service.ts`（新增方法）

**原理**: 在搜索新闻/数据前，先搜索已有的研究报告、学术论文、行业白皮书，建立"前人怎么研究这个主题"的认知基线。

```typescript
/**
 * Phase 2.1: 文献基线扫描
 * 搜索已有研究报告/学术论文/白皮书，提取前人的研究框架和核心结论
 */
async scanLiteratureBaseline(
  topic: ResearchTopic,
  frameworks: AnalyticalFramework[],
): Promise<LiteratureBaseline> {
  const queries = [
    `"${topic.name}" research report 2024 2025`,
    `"${topic.name}" industry analysis whitepaper`,
    `"${topic.name}" 行业研究报告 深度分析`,
  ];

  // 使用 academic 和 web 数据源
  const results = await Promise.all(
    queries.map((q) =>
      this.searchSource("academic", q, { maxResults: 10 }),
    ),
  );

  // 提取有价值的文献
  const allItems = results
    .filter((r) => r?.items)
    .flatMap((r) => r.items);

  return {
    existingStudies: allItems.slice(0, 15),
    queryCount: queries.length,
  };
}
```

**Leader 消化文献基线**（在 GLOBAL_OUTLINE_PROMPT 中注入）:

```
## 已有研究概览

以下是该主题的已有研究成果，你应该：
1. 了解前人的研究方法和结论
2. 避免重复已有研究的基础发现
3. 在前人研究基础上挖掘更深的洞察
4. 指出与前人研究的差异点

已有研究：
{{literatureBaseline}}
```

### 5.3 迭代证据收集

**文件**: `topic-team-orchestrator.service.ts`（扩展 Phase 2）

**原理**: 不是"搜一轮不够再搜一轮"（V3 Gap Analysis），而是每轮搜索后评估"假设是否有足够证据验证"，决定是否继续和搜索什么。

```typescript
/**
 * Phase 2: 迭代知识构建
 * 最多 iterationLimit 轮，每轮：搜索 → 评估假设覆盖 → 决定下一步
 */
async buildKnowledge(
  topic: ResearchTopic,
  design: ResearchDesign,
  strategy: ResearchStrategy,
): Promise<KnowledgeBuildResult> {
  const iterationLimit = strategy.getKnowledgeIterations(); // quick=1, standard=2, thorough=3
  const context = this.researchContext;

  for (let round = 1; round <= iterationLimit; round++) {
    this.logger.log(`[Phase 2] Knowledge building round ${round}/${iterationLimit}`);

    // 2.1 执行搜索（第一轮全量，后续轮补充）
    if (round === 1) {
      await this.searchAllDimensions(topic, design);
    } else {
      // 补充搜索：只搜索证据不足的假设方向
      const gaps = this.assessHypothesisCoverage(design.hypotheses, context);
      if (gaps.length === 0) {
        this.logger.log(`[Phase 2] All hypotheses covered, stopping at round ${round}`);
        break;
      }
      await this.searchForGaps(topic, gaps);
    }

    // 2.2 评估假设覆盖度
    const coverage = this.assessHypothesisCoverage(design.hypotheses, context);
    const coveredCount = design.hypotheses.length - coverage.length;

    this.emitProgress({
      topicId: topic.id,
      reportId: context.reportId,
      phase: "researching",
      progress: 8 + Math.round((round / iterationLimit) * 27),
      completedDimensions: coveredCount,
      totalDimensions: design.hypotheses.length,
      message: `知识构建第 ${round} 轮：${coveredCount}/${design.hypotheses.length} 个假设已有足够证据`,
    });
  }

  return { totalEvidence: context.getAllEvidenceCount() };
}
```

---

## 6. Layer 3：分析推理层

### 6.1 结构化分析方法

**文件**: `dimension-mission.service.ts`（扩展写作 Phase 的分析步骤）

**原理**: 在写作之前，对每个维度的证据执行结构化分析。分析结果作为写作输入，确保内容有分析深度而非数据堆砌。

**修改 DIMENSION_RESEARCH_SYSTEM_PROMPT**，在输出 schema 中新增 `structuredAnalysis`：

```
## 分析步骤（在写作前执行）

基于所选框架 {{framework}}，对本维度的证据进行结构化分析：

1. 数据提取：从证据中提取所有可量化的数据点
2. 模式识别：识别趋势、异常、转折点
3. 因果推理：建立数据点之间的因果链条
4. 对比分析：与历史数据/行业基准/竞争对手对比
5. 推论生成：基于以上分析得出独立推论

输出到 JSON:
"structuredAnalysis": {
  "framework": "PESTEL",
  "dataPoints": [
    {"metric": "全球 AI 芯片市场规模", "value": "544亿美元", "year": "2024", "source": "[3]", "trend": "YoY +28%"}
  ],
  "patterns": [
    {"pattern": "算力需求指数级增长但供给线性增长", "evidence": "[1][4]", "significance": "high"}
  ],
  "causalChains": [
    {"cause": "大模型参数量每18月翻倍", "effect": "训练算力需求指数增长", "effect2": "芯片供不应求推升价格", "evidence": "[1][2][5]"}
  ],
  "comparisons": [
    {"subject": "中国 vs 美国 AI 芯片", "metric": "制程工艺", "valueA": "14nm", "valueB": "3nm", "gap": "3代", "source": "[2][6]"}
  ],
  "inferences": [
    {"inference": "制程差距将在 2-3 年内缩小至 1 代", "confidence": "medium", "basis": "基于 SMIC 良率提升曲线 [3] 和 ASML DUV 多重曝光技术 [7]"}
  ]
}
```

**数据结构**:

```typescript
interface StructuredAnalysis {
  framework: AnalyticalFramework;
  dataPoints: DataPoint[];
  patterns: Pattern[];
  causalChains: CausalChain[];
  comparisons: Comparison[];
  inferences: Inference[];
}

interface CausalChain {
  cause: string;
  effect: string;
  effect2?: string;
  evidence: string; // "[1][2]" 引用格式
}

interface Inference {
  inference: string;
  confidence: "high" | "medium" | "low";
  basis: string;
}
```

### 6.2 交叉验证引擎

**文件**: 新增 `cross-validation.service.ts`

**原理**: 对每个核心论断，检查是否有 2+ 独立来源支持。如果只有 1 个来源，标记为"unverified"；如果有矛盾来源，标记为"disputed"。

```typescript
@Injectable()
export class CrossValidationService {
  private readonly logger = new Logger(CrossValidationService.name);

  /**
   * 验证一组论断，返回验证结果
   */
  async validateClaims(
    claims: ExtractedClaim[],
    evidencePool: EvidenceData[],
    standard: DeliverableStandard,
  ): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    for (const claim of claims) {
      // 找支持该论断的独立来源（不同域名 = 独立来源）
      const supportingEvidence = this.findSupportingEvidence(
        claim,
        evidencePool,
      );
      const contradictingEvidence = this.findContradictingEvidence(
        claim,
        evidencePool,
      );

      const independentDomains = new Set(
        supportingEvidence.map((e) => e.domain),
      );
      const independentSourceCount = independentDomains.size;

      let status: ClaimValidationStatus;
      if (contradictingEvidence.length > 0) {
        status = "disputed";
      } else if (independentSourceCount >= standard.minSourcesPerClaim) {
        status = "verified";
      } else if (independentSourceCount === 1) {
        status = "unverified";
      } else {
        status = "unsupported";
      }

      results.push({
        claim,
        status,
        supportingSources: supportingEvidence.map((e) => e.citationIndex),
        contradictingSources: contradictingEvidence.map((e) => e.citationIndex),
        independentSourceCount,
      });
    }

    return results;
  }

  private findSupportingEvidence(
    claim: ExtractedClaim,
    pool: EvidenceData[],
  ): EvidenceData[] {
    // 基于 claim.keywords 在证据标题/内容中匹配
    return pool.filter((e) => {
      const text = `${e.title} ${e.snippet || ""}`.toLowerCase();
      return claim.keywords.some((kw) => text.includes(kw.toLowerCase()));
    });
  }

  private findContradictingEvidence(
    claim: ExtractedClaim,
    pool: EvidenceData[],
  ): EvidenceData[] {
    // 基于 claim.negationKeywords 匹配矛盾证据
    if (!claim.negationKeywords?.length) return [];
    return pool.filter((e) => {
      const text = `${e.title} ${e.snippet || ""}`.toLowerCase();
      return claim.negationKeywords.some((kw) =>
        text.includes(kw.toLowerCase()),
      );
    });
  }
}
```

**数据结构**:

```typescript
interface ExtractedClaim {
  id: string;
  statement: string;
  keywords: string[]; // 用于正向匹配
  negationKeywords?: string[]; // 用于反向匹配
  dimensionId: string;
  sourceEvidenceIndex: number; // 原始来源
}

type ClaimValidationStatus =
  | "verified"
  | "unverified"
  | "disputed"
  | "unsupported";

interface ValidationResult {
  claim: ExtractedClaim;
  status: ClaimValidationStatus;
  supportingSources: number[];
  contradictingSources: number[];
  independentSourceCount: number;
}
```

**写作层集成**: 验证结果注入 Section Writing prompt：

```
## 论断验证状态

以下论断已经过交叉验证，写作时必须遵守：
- ✅ verified: 可作为确定性结论引用
- ⚠️ unverified: 必须加"据某来源"等限定语
- ❌ disputed: 必须呈现正反双方观点
- 🚫 unsupported: 不可作为论据使用

{{validationResults}}
```

### 6.3 假设检验与修正

**文件**: `research-leader.service.ts`（新增方法）

**原理**: Layer 2 搜索完成后，Leader 审视证据对每个假设的支持/反对程度，更新假设状态。如果假设被推翻，触发认知循环回 Layer 2 补充搜索。

```typescript
/**
 * Phase 3: 假设检验 — Leader 审视证据对假设的验证结果
 */
async verifyHypotheses(
  topic: ResearchTopic,
  design: ResearchDesign,
  validationResults: ValidationResult[],
): Promise<HypothesisVerificationResult> {
  const leaderModel = await this.getReasoningModel();
  if (!leaderModel) {
    return { hypotheses: design.hypotheses, needsAdditionalSearch: false };
  }

  const response = await this.aiFacade.chat({
    messages: [
      {
        role: "system",
        content: `你是资深研究总监。审视以下研究假设和验证结果，对每个假设做出判定：
- confirmed: 有充分证据支持原假设
- rejected: 证据推翻原假设，给出修正后的结论
- modified: 部分正确，需要修正表述
- insufficient_evidence: 证据不足，需要补充搜索

如果有假设被 rejected 或 insufficient_evidence，说明需要补充搜索的方向。

输出 JSON:
{
  "verifiedHypotheses": [
    {
      "id": "H1",
      "status": "confirmed|rejected|modified|insufficient_evidence",
      "evidence": {"supporting": ["[1][3]"], "contradicting": ["[5]"]},
      "revisedStatement": "修正后的假设（仅 modified/rejected 时填写）",
      "additionalSearchNeeded": "需要补充搜索的方向（仅 insufficient_evidence 时填写）"
    }
  ],
  "needsAdditionalSearch": true/false,
  "searchDirections": ["具体的补充搜索方向"]
}`,
      },
      {
        role: "user",
        content: `专题: ${topic.name}\n\n假设:\n${JSON.stringify(design.hypotheses, null, 2)}\n\n验证结果:\n${JSON.stringify(validationResults.slice(0, 30), null, 2)}`,
      },
    ],
    model: leaderModel.modelId,
    taskProfile: { creativity: "low", outputLength: "medium" },
  });

  const result = JSON.parse(response.content);

  // 更新 design.hypotheses 状态
  for (const vh of result.verifiedHypotheses) {
    const h = design.hypotheses.find((h) => h.id === vh.id);
    if (h) {
      h.status = vh.status;
      h.evidence = vh.evidence;
      h.revisedStatement = vh.revisedStatement;
    }
  }

  return {
    hypotheses: design.hypotheses,
    needsAdditionalSearch: result.needsAdditionalSearch,
    searchDirections: result.searchDirections || [],
  };
}
```

**认知循环触发**（在 Orchestrator 中）:

```typescript
// Phase 3: 分析推理
const verificationResult = await this.researchLeaderService.verifyHypotheses(
  topic,
  design,
  validationResults,
);

// 认知循环：如果假设被推翻/证据不足，回到 Layer 2
if (verificationResult.needsAdditionalSearch && cognitiveLoopCount < 2) {
  this.logger.log(
    `[Phase 3] Cognitive loop triggered (round ${cognitiveLoopCount + 1})`,
  );
  cognitiveLoopCount++;

  // 补充搜索
  for (const direction of verificationResult.searchDirections) {
    await this.searchForDirection(topic, direction);
  }

  // 重新验证
  // ... 回到 Phase 3 开头
}
```

---

## 7. Layer 4：多稿迭代层

### 7.1 初稿生成

**文件**: `section-writer.service.ts`（修改 `writeSection`）

**与现有代码的关系**: 保留现有 SectionWriter 逻辑，但写作 prompt 注入更多上下文：

```typescript
// 写作 prompt 增强：注入分析结果和验证状态
const enhancedPrompt = `
${existingSectionPrompt}

## 分析结果（必须在写作中体现）
${JSON.stringify(structuredAnalysis)}

## 论断验证状态（必须遵守标注规则）
${formatValidationResults(validationResults)}

## 研究假设验证结论
${formatHypothesisResults(verifiedHypotheses)}

## 写作要求
- verified 论断：可直接陈述，引用 2+ 来源
- unverified 论断：使用"据 XX 报告"、"初步数据显示"等限定语
- disputed 论断：必须呈现正反观点和各自依据
- 因果链：必须展开论证（原因 → 机制 → 结果），不可用箭头缩写
- 对比分析：用表格或并列结构呈现，包含具体数值
`;
```

### 7.2 反思与自审

**文件**: `research-leader.service.ts`（扩展现有 SECTION_REVIEW_PROMPT）

**原理**: 每个章节写完后，Leader 不只打分，而是提出具体的修改指令。

**修改 SECTION_REVIEW_PROMPT**:

```typescript
const SECTION_REFLECTION_PROMPT = `
你是资深研究编辑。审视以下章节，从三个维度评估并给出具体修改指令：

## 评估维度

1. **论证深度** (40分)
   - 是否有独立推论（不只是重复证据）？
   - 因果链是否完整展开？
   - 对比分析是否有定量数据？

2. **证据支撑** (30分)
   - 核心论断是否有 2+ 独立来源？
   - 是否遵守了验证状态标注规则？
   - 数据是否准确引用？

3. **叙事质量** (30分)
   - 段落之间是否有逻辑递进？
   - 是否有"电报式"缩写？
   - 是否有数据堆砌而非分析？

输出 JSON:
{
  "score": 75,
  "revisionInstructions": [
    {
      "location": "第3段",
      "issue": "只列举了三个国家的政策，缺少对比分析",
      "instruction": "增加对比表格，对比中/美/欧三方在 AI 监管立场、时间线、执行力度上的差异",
      "priority": "high"
    }
  ],
  "needsRevision": true
}
`;
```

### 7.3 定向修改

**文件**: `section-writer.service.ts`（新增 `reviseSection` 方法）

**原理**: 不是重写整个章节，而是根据修改指令定向修改具体段落。

```typescript
/**
 * 根据反思指令定向修改章节
 */
async reviseSection(
  originalContent: string,
  revisionInstructions: RevisionInstruction[],
  evidenceData: EvidenceData[],
  modelId: string,
): Promise<string> {
  if (revisionInstructions.length === 0) return originalContent;

  const response = await this.aiFacade.chat({
    messages: [
      {
        role: "system",
        content: `你是研究报告编辑。根据以下修改指令，对章节内容进行定向修改。
规则：
1. 只修改指令涉及的段落，其他内容保持不变
2. 修改后的内容必须与上下文自然衔接
3. 新增内容必须有证据支撑（使用 [n] 引用格式）
4. 输出完整的修改后章节（不是 diff）`,
      },
      {
        role: "user",
        content: `## 原文\n${originalContent}\n\n## 修改指令\n${JSON.stringify(revisionInstructions)}\n\n## 可用证据\n${formatEvidence(evidenceData)}`,
      },
    ],
    model: modelId,
    taskProfile: { creativity: "medium", outputLength: "long" },
  });

  return response.content;
}
```

**迭代控制**（在 Orchestrator 中）：

```typescript
// Phase 5: 反思修改（每个章节最多 2 轮）
const MAX_REVISION_ROUNDS = 2;

for (const section of writtenSections) {
  let content = section.content;

  for (let round = 1; round <= MAX_REVISION_ROUNDS; round++) {
    const reflection = await this.researchLeaderService.reflectOnSection(content, ...);

    if (!reflection.needsRevision || reflection.score >= 80) {
      break; // 质量达标，停止迭代
    }

    content = await this.sectionWriterService.reviseSection(
      content,
      reflection.revisionInstructions,
      section.evidenceData,
      section.modelId,
    );

    this.logger.log(
      `[Phase 5] Section "${section.title}" revised (round ${round}, score ${reflection.score})`,
    );
  }

  section.content = content;
}
```

---

## 8. Layer 5：编辑审校层

### 8.1 事实核查

**文件**: 扩展 `cross-validation.service.ts`

**原理**: 在报告合成前，对最终内容做一次事实核查 — 检查引用的数据是否与原始证据一致。

```typescript
/**
 * 核查报告内容中引用的数据是否与原始证据匹配
 */
async factCheck(
  reportContent: string,
  evidencePool: TopicEvidence[],
): Promise<FactCheckResult[]> {
  // 提取报告中所有 [n] 引用及其上下文
  const citations = this.extractCitations(reportContent);
  const issues: FactCheckResult[] = [];

  for (const citation of citations) {
    const evidence = evidencePool.find(
      (e) => e.citationIndex === citation.index,
    );
    if (!evidence) {
      issues.push({
        citationIndex: citation.index,
        issue: "引用的证据不存在",
        severity: "error",
        context: citation.surroundingText,
      });
      continue;
    }

    // 检查引用的数据是否能在原始证据中找到
    if (citation.containsNumber) {
      const numberInEvidence = evidence.snippet?.includes(citation.number);
      if (!numberInEvidence) {
        issues.push({
          citationIndex: citation.index,
          issue: `报告中引用数据 "${citation.number}" 未在原始证据中找到`,
          severity: "warning",
          context: citation.surroundingText,
        });
      }
    }
  }

  return issues;
}
```

### 8.2 编辑润色

**文件**: 扩展 `report-editor.service.ts`

**原理**: 在现有去重逻辑之上，增加编辑层功能。

**扩展 DEDUP_CHECK_PROMPT 为 EDITORIAL_REVIEW_PROMPT**:

```typescript
const EDITORIAL_REVIEW_PROMPT = `
你是资深编辑。对以下研究报告进行编辑审校：

## 审校维度

1. 跨维度去重（保留现有逻辑）
2. 术语一致性：同一概念在不同维度中的用词是否统一？
3. 数据一致性：同一数据点在不同维度中的引用是否一致？
4. 过渡连贯性：维度之间的过渡是否自然？
5. 论调一致性：不同维度对同一问题的立场是否矛盾？如果矛盾，是否有说明？

输出 JSON:
{
  "deduplicationStats": { ... },  // 保留现有
  "terminologyFixes": [
    {"term": "AI 大模型", "inconsistentUsages": ["大语言模型", "LLM", "生成式AI"], "standardTerm": "大语言模型 (LLM)"}
  ],
  "dataInconsistencies": [
    {"dataPoint": "全球AI市场规模", "dimA": "技术创新: 5440亿", "dimB": "市场分析: 5400亿", "resolution": "统一为5440亿 [3]"}
  ],
  "toneConflicts": [
    {"topic": "AI监管影响", "dimA": "技术创新: 正面（促进安全发展）", "dimB": "市场分析: 负面（增加合规成本）", "resolution": "两者都保留，在跨维度分析中说明不同视角"}
  ]
}
`;
```

### 8.3 质量门控

**文件**: `topic-team-orchestrator.service.ts`

**原理**: 质量门控不是简单的"通过/拒绝"，而是基于交付标准的结构化检查。

```typescript
/**
 * Phase 6: 质量门控 — 基于交付标准检查
 */
async qualityGate(
  reportId: string,
  design: ResearchDesign,
  validationResults: ValidationResult[],
  factCheckResults: FactCheckResult[],
): Promise<QualityGateResult> {
  const standard = design.deliverableStandard;
  const checks: QualityCheck[] = [];

  // 检查 1：论断验证覆盖率
  const verifiedCount = validationResults.filter((v) => v.status === "verified").length;
  const verificationRate = verifiedCount / validationResults.length;
  checks.push({
    name: "交叉验证覆盖率",
    passed: verificationRate >= 0.6,
    value: `${Math.round(verificationRate * 100)}%`,
    threshold: "60%",
  });

  // 检查 2：事实核查错误
  const factErrors = factCheckResults.filter((f) => f.severity === "error");
  checks.push({
    name: "事实核查错误",
    passed: factErrors.length === 0,
    value: `${factErrors.length} 个错误`,
    threshold: "0 个错误",
  });

  // 检查 3：假设验证完成度
  const hypothesesVerified = design.hypotheses.filter(
    (h) => h.status && h.status !== "insufficient_evidence",
  ).length;
  checks.push({
    name: "假设验证完成度",
    passed: hypothesesVerified >= design.hypotheses.length * 0.8,
    value: `${hypothesesVerified}/${design.hypotheses.length}`,
    threshold: "80%",
  });

  const allPassed = checks.every((c) => c.passed);

  return {
    passed: allPassed,
    checks,
    action: allPassed
      ? "proceed"
      : factErrors.length > 0
        ? "fix_facts"       // 回 Layer 5 修复事实错误
        : "supplement_evidence",  // 回 Layer 2 补充证据
  };
}
```

---

## 9. 基础设施

### 9.1 ResearchContext（研究上下文）

**文件**: 新增 `research-context.ts`

**原理**: 替代 V3 的 `ResearchEvidenceStoreService`。不只存证据，还存假设、验证结果、分析结果、修改历史 — 研究全过程的认知状态。

```typescript
/**
 * 单次研究任务的完整上下文
 * 生命周期：创建于 Phase 1，销毁于报告输出后
 * 存储于内存（单次研究 <50MB），不需要持久化
 */
export class ResearchContext {
  readonly topicId: string;
  readonly reportId: string;
  readonly startedAt: Date;

  // Layer 1: 研究设计
  design: ResearchDesign | null = null;

  // Layer 2: 知识库
  private evidenceByDimension = new Map<string, EvidenceData[]>();
  private literatureBaseline: LiteratureBaseline | null = null;

  // Layer 3: 分析结果
  private analysisByDimension = new Map<string, StructuredAnalysis>();
  private validationResults: ValidationResult[] = [];
  private hypothesisVerification: HypothesisVerificationResult | null = null;

  // Layer 4: 写作历史
  private draftHistory = new Map<string, string[]>(); // sectionId → [v1, v2, ...]

  // Layer 5: 审校结果
  private factCheckResults: FactCheckResult[] = [];
  private editorialResults: EditorialReviewResult | null = null;

  // 统计
  llmCallCount = 0;
  readonly maxLlmCalls: number;

  constructor(topicId: string, reportId: string, maxLlmCalls = 300) {
    this.topicId = topicId;
    this.reportId = reportId;
    this.startedAt = new Date();
    this.maxLlmCalls = maxLlmCalls;
  }

  /** 检查 LLM 调用预算 */
  checkBudget(): void {
    if (this.llmCallCount >= this.maxLlmCalls) {
      throw new Error(`LLM call budget exceeded: ${this.llmCallCount}/${this.maxLlmCalls}`);
    }
  }

  // 证据管理
  addEvidence(dimensionId: string, evidence: EvidenceData[]): void { ... }
  getEvidence(dimensionId: string): EvidenceData[] { ... }
  getAllEvidence(): EvidenceData[] { ... }
  getAllEvidenceCount(): number { ... }

  // 分析结果管理
  setAnalysis(dimensionId: string, analysis: StructuredAnalysis): void { ... }
  getAnalysis(dimensionId: string): StructuredAnalysis | null { ... }

  // 写作版本管理
  saveDraft(sectionId: string, content: string): void {
    const history = this.draftHistory.get(sectionId) || [];
    history.push(content);
    this.draftHistory.set(sectionId, history);
  }
  getDraftHistory(sectionId: string): string[] {
    return this.draftHistory.get(sectionId) || [];
  }
}
```

### 9.2 ResearchStrategy（策略模式）

**文件**: 新增 `research-strategy.ts`

**原理**: 消除所有 `if (researchMode === "deep")` 分支，用策略模式统一控制研究深度。

```typescript
export interface ResearchStrategy {
  // Layer 2 参数
  getBaseQueryCount(): number;
  getMaxQueriesPerDimension(): number;
  getKnowledgeIterations(): number;
  getEnrichmentTopN(): number;
  requiresLiteratureBaseline(): boolean;

  // Layer 3 参数
  requiresHypothesisTesting(): boolean;
  requiresCrossValidation(): boolean;
  getMinSourcesPerClaim(): number;

  // Layer 4 参数
  getMaxRevisionRounds(): number;
  getTargetSectionWords(): { min: number; max: number };
  getOutputLength(): "long" | "extended";

  // Layer 5 参数
  requiresFactCheck(): boolean;
  requiresEditorialReview(): boolean;
}

export class QuickStrategy implements ResearchStrategy {
  getBaseQueryCount() {
    return 1;
  }
  getMaxQueriesPerDimension() {
    return 2;
  }
  getKnowledgeIterations() {
    return 1;
  }
  getEnrichmentTopN() {
    return 5;
  }
  requiresLiteratureBaseline() {
    return false;
  }
  requiresHypothesisTesting() {
    return false;
  }
  requiresCrossValidation() {
    return false;
  }
  getMinSourcesPerClaim() {
    return 1;
  }
  getMaxRevisionRounds() {
    return 0;
  }
  getTargetSectionWords() {
    return { min: 800, max: 1500 };
  }
  getOutputLength() {
    return "long" as const;
  }
  requiresFactCheck() {
    return false;
  }
  requiresEditorialReview() {
    return false;
  }
}

export class StandardStrategy implements ResearchStrategy {
  getBaseQueryCount() {
    return 2;
  }
  getMaxQueriesPerDimension() {
    return 4;
  }
  getKnowledgeIterations() {
    return 2;
  }
  getEnrichmentTopN() {
    return 8;
  }
  requiresLiteratureBaseline() {
    return true;
  }
  requiresHypothesisTesting() {
    return true;
  }
  requiresCrossValidation() {
    return true;
  }
  getMinSourcesPerClaim() {
    return 2;
  }
  getMaxRevisionRounds() {
    return 1;
  }
  getTargetSectionWords() {
    return { min: 1000, max: 2000 };
  }
  getOutputLength() {
    return "long" as const;
  }
  requiresFactCheck() {
    return true;
  }
  requiresEditorialReview() {
    return false;
  }
}

export class ThoroughStrategy implements ResearchStrategy {
  getBaseQueryCount() {
    return 3;
  }
  getMaxQueriesPerDimension() {
    return 6;
  }
  getKnowledgeIterations() {
    return 3;
  }
  getEnrichmentTopN() {
    return 10;
  }
  requiresLiteratureBaseline() {
    return true;
  }
  requiresHypothesisTesting() {
    return true;
  }
  requiresCrossValidation() {
    return true;
  }
  getMinSourcesPerClaim() {
    return 2;
  }
  getMaxRevisionRounds() {
    return 2;
  }
  getTargetSectionWords() {
    return { min: 1500, max: 2500 };
  }
  getOutputLength() {
    return "extended" as const;
  }
  requiresFactCheck() {
    return true;
  }
  requiresEditorialReview() {
    return true;
  }
}

export function createStrategy(depth?: string): ResearchStrategy {
  switch (depth) {
    case "quick":
      return new QuickStrategy();
    case "thorough":
      return new ThoroughStrategy();
    default:
      return new StandardStrategy();
  }
}
```

### 9.3 类型定义

**文件**: `types/research.types.ts`（扩展）

```typescript
// 保留现有 TopicConfig，新增 researchDepth
export interface TopicConfig {
  researchDepth?: "quick" | "standard" | "thorough";
  researchMode?: "standard" | "deep"; // ← 向后兼容，映射到 researchDepth
  enrichmentTopN?: number;
  enrichmentMaxLength?: number;
  enableFigures?: boolean;
  timeRange?: string;
  language?: string;
  searchTimeRange?: string;
  knowledgeBaseIds?: string[];
}

// 解析 TopicConfig，兼容旧字段
export function resolveResearchDepth(
  config?: TopicConfig | null,
): "quick" | "standard" | "thorough" {
  if (config?.researchDepth) return config.researchDepth;
  if (config?.researchMode === "deep") return "thorough";
  return "standard";
}
```

---

## 10. 前端兼容性保障

**原则：后端所有改进通过现有接口输出，前端零改动。**

| 检查项               | 现有接口                                                                                             | V5 行为                                                           | 兼容? |
| -------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----- |
| `currentPhase` 值域  | `"planning"` / `"researching"` / `"reviewing"` / `"synthesizing"` / `"completed"` / `"failed"`       | 不新增值，7 个内部 Phase 映射到现有 4 个                          | ✅    |
| WebSocket 事件类型   | 见 Section 3 的完整列表                                                                              | 不新增事件类型                                                    | ✅    |
| `ResearchTodoType`   | `LEADER_PLANNING` / `DIMENSION_RESEARCH` / `REPORT_WRITING` / `QUALITY_REVIEW` / `USER_REQUEST`      | 不新增类型，新 Phase 复用现有类型                                 | ✅    |
| `ResearchTodoStatus` | `PENDING` / `QUEUED` / `IN_PROGRESS` / `REVIEWING` / `PAUSED` / `COMPLETED` / `FAILED` / `CANCELLED` | 不新增状态                                                        | ✅    |
| `MissionStatus` 结构 | `{ progress, currentPhase, completedTasks, totalTasks, tasks }`                                      | 结构不变，tasks 数量可能更多                                      | ✅    |
| `TopicReport` 结构   | `fullReport` (Markdown) + `crossDimensionAnalysis` + `strategicRecommendations` 等                   | 所有输出写入现有字段，`crossDimensionAnalysis` 已定义但前端未渲染 | ✅    |
| `TopicConfig`        | `researchMode?: "standard" \| "deep"`                                                                | 新增 `researchDepth` 但 optional，旧字段保留                      | ✅    |
| `TopicEvidence`      | 现有 schema                                                                                          | 不变                                                              | ✅    |
| progress 百分比      | 0-100                                                                                                | 不变，只调整各 Phase 的区间分配                                   | ✅    |
| `DimensionAnalysis`  | `summary`, `keyFindings`, `dataPoints`                                                               | 不变，新增的 `structuredAnalysis` 放入 `dataPoints` JSON          | ✅    |

**Phase → TODO 类型映射**:

| 内部 Phase       | 使用的 ResearchTodoType |
| ---------------- | ----------------------- |
| Phase 1 研究设计 | `LEADER_PLANNING`       |
| Phase 2 知识构建 | `DIMENSION_RESEARCH`    |
| Phase 3 分析推理 | `DIMENSION_RESEARCH`    |
| Phase 4 初稿写作 | `REPORT_WRITING`        |
| Phase 5 反思修改 | `QUALITY_REVIEW`        |
| Phase 6 编辑审校 | `QUALITY_REVIEW`        |
| Phase 7 报告合成 | `REPORT_WRITING`        |

---

## 11. 与 V3 的关系

V5 不废弃 V3 的任何已实现代码，而是在其基础上分层增强：

| V3 组件                                         | V5 中的角色                    | 变化                                |
| ----------------------------------------------- | ------------------------------ | ----------------------------------- |
| `TopicTeamOrchestrator.executeRefresh`          | 保留为主入口，扩展内部调用链   | 增加 Layer 1/3/4.5/5 调用           |
| `ResearchLeaderService.planResearch`            | Layer 1 入口，扩展 prompt      | 新增框架选择和假设生成              |
| `DataSourceRouterService.fetchDataForDimension` | Layer 2 核心，增加假设驱动查询 | 新增 `buildHypothesisDrivenQueries` |
| `DimensionMissionService.executeSearchPhase`    | Layer 2 执行层，不变           | 不变                                |
| `DimensionMissionService.executeWritingPhase`   | Layer 4 核心                   | 写作 prompt 注入分析结果            |
| `SectionWriterService.writeSection`             | Layer 4 执行层                 | prompt 增强，不改接口               |
| `ResearchReviewerService`                       | Layer 5 质量门控的一部分       | 保留，增加交叉验证                  |
| `ReportSynthesisService`                        | Layer 5 报告合成               | 注入假设验证结论和跨维度洞察        |
| `ReportEditorService`                           | Layer 5 编辑审校               | 扩展 prompt 增加术语/数据一致性检查 |

**V3 改动的保留/废弃**:

| V3 改动                   | V5 态度                                      |
| ------------------------- | -------------------------------------------- |
| 多查询并行搜索            | ✅ 保留，纳入假设驱动搜索                    |
| EvidenceStore             | ⚠️ 替换为 ResearchContext                    |
| Phase 1.5 Gap Analysis    | ⚠️ 替换为迭代知识构建                        |
| Phase 3.5 辩论            | ❌ 废弃，替换为交叉验证                      |
| 写作补搜 (NEED_MORE_DATA) | ✅ 保留                                      |
| 质量审查重研              | ⚠️ 替换为质量门控 + 定向回路                 |
| 复杂度评分                | ❌ 废弃，由策略模式替代                      |
| standard/deep 二分法      | ❌ 废弃，替换为 quick/standard/thorough 策略 |

---

## 12. 修改文件清单

| 文件                                          | 改动                                                               | Layer    |
| --------------------------------------------- | ------------------------------------------------------------------ | -------- |
| `services/topic-team-orchestrator.service.ts` | 主编排流程重构 (7 Phase)                                           | 全局     |
| `services/research-leader.service.ts`         | 扩展 planResearch prompt + 新增 verifyHypotheses、reflectOnSection | L1/L3/L4 |
| `services/data-source-router.service.ts`      | 新增 buildHypothesisDrivenQueries、scanLiteratureBaseline          | L2       |
| `services/section-writer.service.ts`          | prompt 增强 + 新增 reviseSection                                   | L4       |
| `services/report-editor.service.ts`           | 扩展 EDITORIAL_REVIEW_PROMPT                                       | L5       |
| `services/cross-validation.service.ts`        | **新增**：交叉验证引擎                                             | L3       |
| `services/research-context.ts`                | **新增**：研究上下文（替代 EvidenceStore）                         | 基础设施 |
| `services/research-strategy.ts`               | **新增**：策略模式                                                 | 基础设施 |
| `types/research.types.ts`                     | 新增接口定义                                                       | 基础设施 |
| `prompts/dimension-research.prompt.ts`        | 写作 prompt 增强（分析结果注入、验证状态注入）                     | L4       |
| `prompts/report-synthesis.prompt.ts`          | 合成 prompt 增强（假设结论注入）                                   | L5       |
| `topic-research.module.ts`                    | 注册新服务                                                         | 基础设施 |

---

## 13. 分阶段实施路线

### Phase A：基础设施（第1周）

- [ ] 定义所有新 TypeScript 接口
- [ ] 实现 `ResearchStrategy` 三个策略类
- [ ] 实现 `ResearchContext` 替代 EvidenceStore
- [ ] 实现 `resolveResearchDepth` 兼容函数
- [ ] `npm run type-check` 通过

### Phase B：Layer 1 研究设计（第2周）

- [ ] 扩展 `LEADER_PLAN_PROMPT`：框架选择 + 假设生成 + 交付标准
- [ ] 扩展 `LeaderPlan` 接口，新增 `researchDesign`
- [ ] 在 Orchestrator 中集成 Phase 1
- [ ] 验证：Leader 输出包含框架、假设、标准

### Phase C：Layer 2 知识构建（第3周）

- [ ] 实现 `scanLiteratureBaseline`
- [ ] 实现 `buildHypothesisDrivenQueries`
- [ ] 实现迭代知识构建循环
- [ ] 验证：搜索结果包含正/反方向证据

### Phase D：Layer 3 分析推理（第4周）

- [ ] 扩展 `DIMENSION_RESEARCH_SYSTEM_PROMPT`：结构化分析输出
- [ ] 实现 `CrossValidationService`
- [ ] 实现 `verifyHypotheses`
- [ ] 实现认知循环回路
- [ ] 验证：论断有验证标签，假设有验证结论

### Phase E：Layer 4 多稿迭代（第5周）

- [ ] 增强 Section Writing prompt（注入分析结果和验证状态）
- [ ] 实现 `reflectOnSection` 和 `reviseSection`
- [ ] 实现 2 轮迭代控制
- [ ] 验证：章节经过反思修改，质量提升可度量

### Phase F：Layer 5 编辑审校（第6周）

- [ ] 实现事实核查
- [ ] 扩展编辑审校 prompt
- [ ] 实现质量门控
- [ ] 端到端集成测试
- [ ] 验证：完整 7 Phase 流程跑通

---

## 14. 验证方案

### 对比测试

选取 5 个主题，分别用 V3（standard）、V5（standard）、V5（thorough）生成报告，人工评分：

| 评分维度 | 权重 | 说明                           |
| -------- | ---- | ------------------------------ |
| 分析深度 | 25%  | 是否有独立推论，因果链是否完整 |
| 证据质量 | 25%  | 交叉验证率，引用准确性         |
| 洞察价值 | 20%  | 是否有超越常识的发现           |
| 可操作性 | 15%  | 建议是否具体可执行             |
| 叙事质量 | 15%  | 逻辑递进，段落连贯             |

### 自动化指标

```bash
# 每份报告自动统计
- 交叉验证率: verified/(verified+unverified+disputed) → 目标 >60%
- 假设验证完成率: (confirmed+rejected+modified)/total → 目标 >80%
- 事实核查错误数: factCheckErrors → 目标 0
- 平均章节迭代轮数: revisionRounds → 目标 >1.2
- 独立来源数/核心论断: avgSourcesPerClaim → 目标 >1.8
```

### 成本预算

| 深度                | LLM 调用数 | 预估成本 | 预估时间  |
| ------------------- | ---------- | -------- | --------- |
| quick               | ~55        | ~$0.55   | 5-8分钟   |
| standard            | ~120       | ~$1.20   | 12-18分钟 |
| thorough            | ~200       | ~$2.00   | 20-30分钟 |
| thorough + 认知循环 | ~280       | ~$2.80   | 25-35分钟 |

---

## 15. 研究深度参数对照

| 参数                   | quick    | standard  | thorough      |
| ---------------------- | -------- | --------- | ------------- |
| 基础查询数/维度        | 1        | 2         | 3             |
| 最大查询数/维度        | 2        | 4         | 6             |
| 知识构建迭代轮数       | 1        | 2         | 3             |
| enrichmentTopN         | 5        | 8         | 10            |
| 文献基线扫描           | 否       | 是        | 是            |
| 假设驱动搜索           | 否       | 是        | 是            |
| 交叉验证               | 否       | 是        | 是            |
| 假设检验               | 否       | 是        | 是            |
| 认知循环（回 Layer 2） | 否       | 否        | 是（最多2轮） |
| 章节迭代修改           | 0轮      | 1轮       | 2轮           |
| 事实核查               | 否       | 是        | 是            |
| 编辑审校               | 否       | 否        | 是            |
| 最少独立来源/论断      | 1        | 2         | 2             |
| 章节目标字数           | 800-1500 | 1000-2000 | 1500-2500     |
| outputLength           | long     | long      | extended      |
| 每维度最少字数         | 3000     | 5000      | 8000          |

---

**最后更新**: 2026-02-01
**版本**: 5.0（认知研究团队架构）
**状态**: 可实施

**架构演进路径**:

- V3: 流水线修补（搜索更多、写作更长）→ 已完成
- V5: 认知研究循环（假设驱动、交叉验证、多稿迭代）→ 当前版本
- V6（未来）: 多模型专家系统（不同 LLM 扮演不同角色）+ 实时数据源 + 用户协同编辑
