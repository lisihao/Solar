# 报告质量全链路可观测性系统设计

> 设计目标：在数据采集→入库→维度LLM→后处理→合成LLM→最终报告的每个环节插入质量探针，
> 持久化度量指标，实现精确定位、量化改进、持续演进。

## 1. 现状分析

### 已有质量基础设施

| 组件                     | 功能                     | 度量持久化             | 问题                   |
| ------------------------ | ------------------------ | ---------------------- | ---------------------- |
| ReportQualityGateService | 25+ 规则检查 + 自动修复  | Logger only            | 违规数据丢失，无法回溯 |
| CritiqueRefineService    | LLM 迭代评审 (Reflexion) | Memory only            | 评分历史丢失           |
| CredibilityReportService | 来源权威/多样/时效评分   | DB (CredibilityReport) | 唯一持久化的质量数据   |
| ReportAssemblerService   | 35+ 格式修复函数         | Logger only            | 修复统计丢失           |
| OutputReviewerService    | AI 输出审阅              | Logger only            | 审阅结果丢失           |

### 核心问题

```
当前：问题在前端渲染时被人眼发现 → 回头猜是哪一环出的问题 → 加正则兜底
目标：每一环自动检测+记录 → 精确定位问题环节 → 针对性修复 → 量化验证效果
```

## 2. 全链路探针架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Report Quality Trace (一次报告生成 = 一条 Trace)       │
│                                                                         │
│  Probe 1        Probe 2         Probe 3        Probe 4        Probe 5  │
│  证据采集质量    维度LLM输出质量   后处理修复统计   合成LLM输出质量   最终质量评分│
│     ↓               ↓               ↓               ↓              ↓    │
│  ┌──────┐      ┌──────┐       ┌──────┐       ┌──────┐       ┌──────┐  │
│  │Stage1│      │Stage2│       │Stage3│       │Stage4│       │Stage5│  │
│  │Span  │─────→│Span  │──────→│Span  │──────→│Span  │──────→│Span  │  │
│  └──────┘      └──────┘       └──────┘       └──────┘       └──────┘  │
│                                                                         │
│  持久化 → ReportQualityTrace (DB)                                        │
│  聚合   → QualityDashboard API                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## 3. 数据模型

### 3.1 ReportQualityTrace — 全链路追踪记录

存储在 `TopicReport.qualityTrace` (JSONB) 字段中，不需要新建表。

```typescript
interface ReportQualityTrace {
  /** Trace 版本（便于后续 schema 演进） */
  version: 1;
  /** 生成时间 */
  generatedAt: string; // ISO timestamp
  /** 管道版本（代码 commit hash 或 semver） */
  pipelineVersion: string;

  /** ── Stage 1: 证据采集质量 ── */
  evidenceQuality: {
    totalEvidences: number;
    /** 可信度分布 */
    credibilityDistribution: {
      high: number; // score >= 70
      medium: number; // 40-69
      low: number; // < 40
      unscored: number;
    };
    /** 来源多样性 */
    uniqueDomains: number;
    /** 有完整内容的证据比例 */
    fullContentRatio: number;
    /** 有可用图表的证据数 */
    evidencesWithFigures: number;
    /** 时效性：6个月内的占比 */
    recentRatio: number;
  };

  /** ── Stage 2: 维度 LLM 输出质量（per-dimension） ── */
  dimensionOutputs: Array<{
    dimensionId: string;
    dimensionName: string;

    /** LLM 原始输出指标 */
    rawOutput: {
      /** detailedContent 字数 */
      contentLength: number;
      /** keyFindings 数量 */
      keyFindingsCount: number;
      /** 引用的证据数 */
      citationsUsed: number;
      /** 唯一引用来源数 */
      uniqueSourcesCited: number;
      /** 图表引用数 */
      figureRefsCount: number;
      /** JSON 解析是否成功 */
      jsonParsed: boolean;
      /** 是否触发了 fallback（如 summary 替代 detailedContent） */
      usedFallback: boolean;
    };

    /** LLM 输出缺陷检测（后处理前，原始扫描） */
    defects: {
      /** 裸 LaTeX（未被 $ 包裹） */
      bareLatexCount: number;
      /** 破碎的 $ 嵌套 */
      brokenDollarNesting: number;
      /** \begin 环境未被 $$ 包裹 */
      unwrappedEnvironments: number;
      /** 伪代码行数 */
      pseudoCodeLines: number;
      /** 泄露的元标注（字数统计、角色名等） */
      leakedMetaNotes: number;
      /** 泄露的图片标注 */
      leakedFigureNotes: number;
      /** 超长列表项（>120字）数量 */
      longListItems: number;
      /** 困在列表中的结论段落 */
      trappedConclusions: number;
      /** 缺少 ### 标题的内容块 */
      missingHeadings: number;
      /** 标题回声（重复） */
      headingEchoes: number;
      /** HTML 实体泄露 */
      htmlEntities: number;
      /** 外语内容比例 */
      foreignContentRatio: number;
    };

    /** 质量门检查结果 */
    qualityGate: {
      passed: boolean;
      errorCount: number;
      warningCount: number;
      autoFixCount: number;
      /** 按规则统计 */
      violationsByRule: Record<string, number>;
    };

    /** Critique-Refine 结果（如果执行了） */
    critiqueRefine?: {
      initialScore: number;
      finalScore: number;
      iterations: number;
      stopReason: string;
    };
  }>;

  /** ── Stage 3: 后处理修复统计（全文级） ── */
  postProcessing: {
    /** 各修复函数触发次数 */
    fixesApplied: Record<string, number>;
    /** 总修复次数 */
    totalFixes: number;
    /** 修复前后字数变化 */
    charsBefore: number;
    charsAfter: number;
    /** 被截断的维度数 */
    truncatedDimensions: number;
    /** 去重移除的段落数 */
    deduplicatedParagraphs: number;
    /** 质量门警告 */
    warnings: string[];
  };

  /** ── Stage 4: 合成 LLM 输出质量 ── */
  synthesisOutput: {
    /** 各补充章节字数 */
    sectionLengths: {
      executiveSummary: number;
      preface: number;
      crossDimensionAnalysis: number;
      riskAssessment: number;
      strategicRecommendations: number;
      conclusion: number;
    };
    /** JSON 解析是否成功 */
    jsonParsed: boolean;
    /** 使用的 fallback 层级 (0=正常, 1=relaxed, 2=minimal) */
    fallbackLevel: number;
    /** 结论与其他章节的重复度 */
    conclusionOverlapRatio: number;
    /** 生成耗时 (ms) */
    generationTimeMs: number;
    /** Token 消耗 */
    tokensUsed: number;
  };

  /** ── Stage 5: 最终质量评分 ── */
  finalAssessment: {
    /** 综合质量评分 (0-100) */
    overallScore: number;
    /** 分项评分 */
    scores: {
      /** 格式正确性 (LaTeX, 标题, 列表等) */
      formatting: number;
      /** 内容完整性 (字数, 章节覆盖) */
      completeness: number;
      /** 来源质量 (引用密度, 来源多样性) */
      sourceQuality: number;
      /** 结构清晰度 (标题层级, 段落组织) */
      structure: number;
      /** 语言一致性 (外语比例, 术语统一) */
      languageConsistency: number;
    };
    /** 质量等级 */
    grade: "A" | "B" | "C" | "D" | "F";
    /** 主要问题摘要 */
    topIssues: Array<{
      category: string;
      description: string;
      severity: "error" | "warning";
      count: number;
    }>;
  };
}
```

### 3.2 数据库变更

在 `TopicReport` 表添加一个 JSONB 字段：

```sql
-- migration: add quality trace to topic report
ALTER TABLE "TopicReport" ADD COLUMN IF NOT EXISTS "qualityTrace" JSONB;
```

```prisma
model TopicReport {
  // ... existing fields ...
  qualityTrace  Json?   // ReportQualityTrace
}
```

## 4. 探针实现位置

### Probe 1: 证据采集质量

- **位置**: `report-synthesis.service.ts` → `synthesizeReport()` 加载证据后
- **时机**: 数据从 DB 读出后、送入 LLM 前
- **采集**: 证据数量、可信度分布、来源多样性、内容完整性

### Probe 2: 维度 LLM 输出质量

- **位置**: `report-assembler.service.ts` → `processDimensionContent()` 入口
- **时机**: LLM 返回的原始 detailedContent，后处理之前
- **采集**: 对原始内容执行缺陷扫描（裸LaTeX、元标注、伪代码等）

### Probe 3: 后处理修复统计

- **位置**: `report-assembler.service.ts` → `postProcessFinalReport()` 出口
- **时机**: 所有格式修复完成后
- **采集**: 每个修复函数的触发次数、修复前后字数变化

### Probe 4: 合成 LLM 输出质量

- **位置**: `report-synthesis.service.ts` → `generateComprehensiveReport()` 解析后
- **时机**: LLM 返回补充内容、JSON 解析后
- **采集**: 各章节字数、fallback 层级、重复度

### Probe 5: 最终质量评分

- **位置**: `report-synthesis.service.ts` → `synthesizeReport()` 最终存储前
- **时机**: 报告组装完成、所有后处理完成后
- **采集**: 综合评分计算

## 5. 核心服务设计

### 5.1 ReportQualityTraceService

```typescript
@Injectable()
export class ReportQualityTraceService {
  /** 创建新的 trace 上下文 */
  createTrace(reportId: string): QualityTraceContext;

  /** Probe 1: 记录证据质量 */
  recordEvidenceQuality(
    ctx: QualityTraceContext,
    evidences: TopicEvidence[],
  ): void;

  /** Probe 2: 扫描维度 LLM 原始输出缺陷 */
  scanDimensionDefects(
    ctx: QualityTraceContext,
    dimId: string,
    dimName: string,
    rawContent: string,
  ): DimensionDefectScan;

  /** Probe 2b: 记录维度质量门结果 */
  recordDimensionQualityGate(
    ctx: QualityTraceContext,
    dimId: string,
    qcResult: QualityCheckResult,
  ): void;

  /** Probe 3: 记录后处理修复统计 */
  recordPostProcessing(
    ctx: QualityTraceContext,
    fixes: Record<string, number>,
    charsBefore: number,
    charsAfter: number,
    warnings: string[],
  ): void;

  /** Probe 4: 记录合成 LLM 输出 */
  recordSynthesisOutput(
    ctx: QualityTraceContext,
    sections: Record<string, string>,
    fallbackLevel: number,
    timeMs: number,
    tokens: number,
  ): void;

  /** Probe 5: 计算最终质量评分 */
  computeFinalAssessment(ctx: QualityTraceContext): FinalAssessment;

  /** 完成 trace 并返回完整数据 */
  finalizeTrace(ctx: QualityTraceContext): ReportQualityTrace;
}
```

### 5.2 缺陷扫描器 (Probe 2 核心)

```typescript
/** 对 LLM 原始输出进行缺陷扫描（不修复，只计数） */
export function scanContentDefects(content: string): ContentDefectScan {
  return {
    bareLatexCount: countBareLatex(content),
    brokenDollarNesting: countBrokenDollarNesting(content),
    unwrappedEnvironments: countUnwrappedEnvironments(content),
    pseudoCodeLines: countPseudoCodeLines(content),
    leakedMetaNotes: countLeakedMetaNotes(content),
    leakedFigureNotes: countLeakedFigureNotes(content),
    longListItems: countLongListItems(content),
    trappedConclusions: countTrappedConclusions(content),
    missingHeadings: countMissingHeadings(content),
    headingEchoes: countHeadingEchoes(content),
    htmlEntities: countHtmlEntities(content),
    foreignContentRatio: measureForeignContentRatio(content),
  };
}
```

关键：**扫描函数与修复函数对应但独立**。每个修复函数都有对应的计数函数。

### 5.3 评分算法 (Probe 5)

```typescript
function computeOverallScore(
  trace: Partial<ReportQualityTrace>,
): FinalAssessment {
  const formatting = computeFormattingScore(trace); // LaTeX + 标题 + 列表
  const completeness = computeCompletenessScore(trace); // 字数 + 章节覆盖
  const sourceQuality = computeSourceScore(trace); // 引用密度 + 多样性
  const structure = computeStructureScore(trace); // 标题层级 + 段落组织
  const language = computeLanguageScore(trace); // 外语比例 + 术语

  // 加权综合
  const overall = Math.round(
    formatting * 0.25 +
      completeness * 0.2 +
      sourceQuality * 0.2 +
      structure * 0.2 +
      language * 0.15,
  );

  return {
    overallScore: overall,
    scores: {
      formatting,
      completeness,
      sourceQuality,
      structure,
      languageConsistency: language,
    },
    grade:
      overall >= 90
        ? "A"
        : overall >= 75
          ? "B"
          : overall >= 60
            ? "C"
            : overall >= 40
              ? "D"
              : "F",
    topIssues: extractTopIssues(trace),
  };
}
```

评分规则示例：

| 子项                | 满分条件                           | 扣分规则                                            |
| ------------------- | ---------------------------------- | --------------------------------------------------- |
| formatting (25%)    | 0 个 LaTeX 缺陷 + 0 个格式问题     | 每个裸LaTeX -3分，每个破碎$ -5分，每个伪代码块 -4分 |
| completeness (20%)  | 所有维度 ≥6000 字 + 所有章节有内容 | 每个 <4000 字维度 -10分，每个空章节 -15分           |
| sourceQuality (20%) | 引用密度 10-15/千字 + ≥10 唯一来源 | 密度 <5 扣 -15分，唯一来源 <5 扣 -10分              |
| structure (20%)     | 每个维度有 ### 标题 + 无回声       | 每个缺失标题 -5分，每个标题回声 -3分                |
| language (15%)      | 外语比例 <5% + 无泄露              | 外语 >10% 扣 -20分，每条元标注泄露 -5分             |

## 6. 管道集成方案

### 6.1 修改 report-synthesis.service.ts

```typescript
async synthesizeReport(topic, reportId, ...) {
  // ★ 创建质量追踪上下文
  const qualityTrace = this.qualityTraceService.createTrace(reportId);

  // 1. 加载证据
  const evidences = await this.loadEvidences(reportId);
  // ★ Probe 1: 证据质量
  this.qualityTraceService.recordEvidenceQuality(qualityTrace, evidences);

  // 2. 准备维度输入
  const dimensionInputs = this.prepareDimensionInputs(analyses);

  // 3. 处理每个维度
  for (const dim of dimensionInputs) {
    // ★ Probe 2: 扫描 LLM 原始输出缺陷（修复前）
    this.qualityTraceService.scanDimensionDefects(
      qualityTrace, dim.dimensionId, dim.dimensionName, dim.detailedContent
    );

    // 应用后处理
    const processed = this.assembler.processDimensionContent(...);

    // ★ Probe 2b: 记录质量门结果
    // (qualityGate 已在 assembler 内部调用，结果通过返回值传递)
  }

  // 4. 调用合成 LLM
  const synthesis = await this.generateComprehensiveReport(...);
  // ★ Probe 4: 合成输出质量
  this.qualityTraceService.recordSynthesisOutput(qualityTrace, synthesis, ...);

  // 5. 组装最终报告
  const assembled = this.assembler.buildFullReportFromDimensions(...);

  // 6. 后处理
  const { content, warnings } = this.assembler.postProcessFinalReport(assembled);
  // ★ Probe 3: 后处理统计
  this.qualityTraceService.recordPostProcessing(qualityTrace, ...);

  // ★ Probe 5: 最终评分
  const finalTrace = this.qualityTraceService.finalizeTrace(qualityTrace);

  // 7. 存储（带质量追踪）
  await this.prisma.topicReport.update({
    where: { id: reportId },
    data: {
      fullReport: content,
      qualityTrace: finalTrace as any,  // JSONB
    },
  });
}
```

### 6.2 修改 report-assembler.service.ts

每个修复函数调用需要计数：

```typescript
// 现有：
processed = stripLLMMetaNotes(processed);

// 改为：带计数的调用模式
const before = processed;
processed = stripLLMMetaNotes(processed);
if (before !== processed)
  fixes["stripLLMMetaNotes"] = (fixes["stripLLMMetaNotes"] || 0) + 1;
```

为避免大量重复代码，提供辅助函数：

```typescript
function applyAndCount(
  content: string,
  fn: (s: string) => string,
  name: string,
  fixes: Record<string, number>,
): string {
  const result = fn(content);
  if (result !== content) {
    fixes[name] = (fixes[name] || 0) + 1;
  }
  return result;
}
```

## 7. API 接口

### 7.1 查看报告质量追踪

```
GET /api/v1/ai/topic-insights/topics/:topicId/reports/:reportId/quality-trace
```

返回：`ReportQualityTrace` 完整数据

### 7.2 报告质量概览（简化版）

```
GET /api/v1/ai/topic-insights/topics/:topicId/reports/:reportId/quality-summary
```

返回：

```json
{
  "grade": "B",
  "overallScore": 78,
  "scores": {
    "formatting": 65,
    "completeness": 90,
    "sourceQuality": 85,
    "structure": 70,
    "languageConsistency": 80
  },
  "topIssues": [
    {
      "category": "formatting",
      "description": "3个裸LaTeX未被$包裹",
      "severity": "error",
      "count": 3
    },
    {
      "category": "structure",
      "description": "2个标题回声",
      "severity": "warning",
      "count": 2
    }
  ],
  "postProcessingFixes": 15,
  "pipelineVersion": "v4.5"
}
```

### 7.3 重新处理报告格式

```
POST /api/v1/ai/topic-insights/topics/:topicId/reports/:reportId/reprocess
```

不调 LLM，只跑后处理管道，更新 fullReport 和 qualityTrace。

## 8. 前端展示（可选，后续迭代）

在报告页面右上角添加"质量报告"入口：

```
┌───────────────────────────────────────┐
│ 报告质量评估          等级: B (78/100) │
│                                       │
│ 格式正确性  ████████░░  65            │
│ 内容完整性  █████████░  90            │
│ 来源质量    █████████░  85            │
│ 结构清晰度  ████████░░  70            │
│ 语言一致性  ████████░░  80            │
│                                       │
│ 主要问题:                              │
│ - [错误] 3个裸LaTeX未被$包裹           │
│ - [警告] 2个标题回声                    │
│ - [警告] 1个超长列表项                  │
│                                       │
│ 后处理修复: 15处                        │
│ 生成管道版本: v4.5                      │
│                                       │
│ [重新处理格式]  [重新生成报告]           │
└───────────────────────────────────────┘
```

## 9. 实施计划

### Phase 1: 基础追踪（本次实施）

- [x] 数据模型定义 (ReportQualityTrace interface)
- [ ] 缺陷扫描器实现 (scanContentDefects)
- [ ] ReportQualityTraceService 核心实现
- [ ] 管道集成（5个探针埋点）
- [ ] Prisma schema 添加 qualityTrace 字段
- [ ] 手写迁移 SQL
- [ ] reprocess API 端点

### Phase 2: 评分与聚合

- [ ] 评分算法实现 (computeOverallScore)
- [ ] quality-trace API 端点
- [ ] quality-summary API 端点
- [ ] 历史趋势聚合（跨报告对比）

### Phase 3: 前端可视化

- [ ] 质量评估面板组件
- [ ] 质量趋势图表
- [ ] 问题定位与一键修复

### Phase 4: 持续演进

- [ ] 新增缺陷类型自动注册
- [ ] 基于历史数据的 Prompt 自动调优建议
- [ ] 质量回归检测（新版本管道 vs 旧版本对比）

## 10. 关键设计原则

1. **只记录不阻断**：探针只采集数据，不影响正常管道流程。即使探针出错，报告生成不受影响
2. **扫描与修复分离**：每个修复函数有对应的计数函数，先扫描计数，再修复，修复后再扫描验证
3. **JSONB 存储**：不新建表，利用 PostgreSQL JSONB 灵活存储，schema 演进无需迁移
4. **向后兼容**：qualityTrace 字段可选，旧报告没有该字段不影响任何功能
5. **增量演进**：探针可以逐步添加，不需要一次性全部实现
