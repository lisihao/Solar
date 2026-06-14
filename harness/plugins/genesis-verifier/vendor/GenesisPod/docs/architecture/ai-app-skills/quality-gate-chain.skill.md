---
name: quality-gate-chain
description: |
  Multi-stage quality gate chain pattern for AI App outputs. Defines structural validation,
  content quality scoring, full-chain tracing, and the Critique-Refine (Reflexion) loop.
  Use when: quality-control, output-validation, critique-refine, content-review, quality-gate.
version: "2.0.0"
domain: general
layer: quality
taskTypes:
  - quality-control
  - output-validation
  - content-review
priority: 85
author: genesis-ai
source: local
tags:
  - quality
  - validation
  - critique-refine
  - reflexion
  - gate
  - best-practice
tokenBudget: 3000
executionMode: prompt
taskProfile:
  creativity: low
  outputLength: medium
---

# 质量门控链 Skill

## 角色定位

你是 GenesisPod 平台的质量保障架构师，负责设计 AI 输出的多阶段验证管道。你的标准来自 Topic Insights 的三阶段质量链和 Reflexion 循环。

## 核心原则

**质量验证分三层：结构验证（可自动修复）→ 内容评分（决定通过/返工）→ 全链路追踪（记录每步质量）。**

## 三阶段质量管道

```
AI 输出
   ↓
Stage 1: 结构验证 (StructuralValidator)
   ├── 自动修复 → 修复后的内容
   └── 不可修复 → 返回修复建议
   ↓
Stage 2: 内容评分 (ContentQualityGate)
   ├── score >= 0.7 → 通过
   └── score < 0.7 → CritiqueRefine 循环
   ↓
Stage 3: 全链路追踪 (QualityTrace)
   └── 记录每步评分 → 质量报告
```

## 两类质量门控：Code Gate vs LLM Gate

> **PK 审计教训（2026-03-12）**：并非所有质量门控都需要 LLM。TI 的 DefectScanner（12 个 regex counter 函数 + 7 个 detail 提取器）和 ReportQualityGate（纯代码检测 + auto-fix）是 0 LLM 调用的复杂代码分析门控。将它们转为 LLM Skill 会**降低性能并增加成本**。

| 类型                        | 是否调 LLM | 复杂度 | 示例                                                         |
| --------------------------- | ---------- | ------ | ------------------------------------------------------------ |
| **结构规则门控** (Stage 1)  | 否         | 低     | 标题层级检查、代码块闭合、字数限制                           |
| **代码分析门控** (Stage 1b) | 否         | 中-高  | DefectScanner (regex统计)、ReportQualityGate (代码检测+修复) |
| **LLM 评分门控** (Stage 2)  | 是（单次） | 中     | 内容质量评分、事实准确性评估                                 |
| **LLM 迭代门控** (Stage 3)  | 是（多轮） | 高     | CritiqueRefine 循环（critique→evaluate→refine×N）            |

**决策规则**：

- 能用 regex/counter/规则解决的 → Code Gate（Stage 1/1b），不调 LLM
- 需要语义理解但一次调用够的 → LLM 评分（Stage 2）
- 需要多轮改进的 → CritiqueRefine（Stage 3），注意 maxIterations 上限

### Stage 1: 结构验证（规则引擎，不调 LLM）

```typescript
@Injectable()
export class StructuralValidatorService {
  validate(content: string, rules: ValidationRule[]): ValidationResult {
    const violations: Violation[] = [];
    let fixedContent = content;

    for (const rule of rules) {
      const result = rule.check(fixedContent);
      if (!result.passed) {
        if (result.autoFixable) {
          fixedContent = result.fix(fixedContent); // 自动修复
          violations.push({ ...result, fixed: true });
        } else {
          violations.push({ ...result, fixed: false });
        }
      }
    }

    return {
      passed: violations.every((v) => v.fixed),
      violations,
      fixedContent,
      rewriteGuidance: violations
        .filter((v) => !v.fixed)
        .map((v) => v.guidance),
    };
  }
}
```

**常见验证规则**：

| 规则         | 可自动修复 | 说明                      |
| ------------ | ---------- | ------------------------- |
| 标题层级     | 是         | H1→H2→H3 顺序，不跳级     |
| 代码块闭合   | 是         | 未闭合的 ``` 自动补全     |
| 外语段落检测 | 否         | 目标语言以外的大段内容    |
| 最小字数     | 否         | 低于阈值需要 AI 重写      |
| 最大字数     | 是         | 截断 + 添加省略提示       |
| 格式滥用     | 是         | 过多粗体/引用 → 自动清理  |
| 水平线清理   | 是         | 删除多余 `---`            |
| JSON 结构    | 部分       | 修复截断 JSON（补全括号） |

### Stage 1b: 代码分析门控（复杂规则，仍不调 LLM）

当简单规则不够、但又不需要 LLM 语义理解时，使用复杂代码分析：

```typescript
// TI 实例：DefectScanner — 12 个 regex counter 函数，0 LLM 调用
@Injectable()
export class DefectScannerService {
  // 纯代码分析，不注入 ChatFacade
  scanReport(content: string): DefectReport {
    return {
      // 12 个独立的 regex/counter 检测函数
      missingCitations: this.countMissingCitations(content),
      brokenLinks: this.countBrokenLinks(content),
      duplicateParagraphs: this.detectDuplicates(content),
      formatViolations: this.checkFormatting(content),
      languageMixing: this.detectLanguageMixing(content),
      emptyHeadings: this.countEmptyHeadings(content),
      oversizedTables: this.detectOversizedTables(content),
      // ... 共 12 个维度
    };
  }

  // 每个检测函数都是纯 regex/string 分析
  private countMissingCitations(content: string): number {
    const claims = content.match(/据[^，。]+/g) ?? [];
    const citations = content.match(/\[\d+\]/g) ?? [];
    return Math.max(0, claims.length - citations.length);
  }
}

// TI 实例：ReportQualityGate — 代码检测 + 自动修复，0 LLM 调用
@Injectable()
export class ReportQualityGateService {
  // 纯代码检测 + 修复
  validateAndFix(content: string): { content: string; fixes: string[] } {
    const fixes: string[] = [];
    let fixed = content;

    // 检测并修复格式问题
    fixed = this.fixHeadingLevels(fixed, fixes);
    fixed = this.fixBrokenCodeBlocks(fixed, fixes);
    fixed = this.removeExcessiveFormatting(fixed, fixes);

    return { content: fixed, fixes };
  }
}
```

**判断标准**：如果检测逻辑可以用 regex、字符串匹配、计数器实现，就属于 Code Gate，不要升级为 LLM Gate。

### Stage 2: 内容评分（调 LLM 或规则混合）

```typescript
@Injectable()
export class ContentQualityGateService {
  constructor(private readonly chatFacade: ChatFacade) {}

  async evaluate(
    content: string,
    criteria: QualityCriteria,
  ): Promise<QualityVerdict> {
    // 方式 A: 规则评分（不调 LLM，快速）
    const ruleScores = this.evaluateByRules(content, criteria);

    // 方式 B: AI 评分（调 LLM，深度）
    const aiScores = await this.evaluateByAI(content, criteria);

    // 综合评分（加权）
    const overall = this.combineScores(ruleScores, aiScores, criteria.weights);

    return {
      passed: overall >= criteria.passThreshold,
      overallScore: overall,
      scores: { ...ruleScores, ...aiScores },
      failedCriteria: Object.entries({ ...ruleScores, ...aiScores })
        .filter(([, score]) => score < criteria.passThreshold)
        .map(([name]) => name),
    };
  }

  private evaluateByRules(content: string, criteria: QualityCriteria): Scores {
    // 新鲜度时间窗口使用 config/health-monitoring.config.ts 中的 DATA_FRESHNESS 常量
    // DATA_FRESHNESS.SIX_MONTHS_MS 和 ONE_YEAR_MS 是集中化的时间阈值
    return {
      // 来源多样性：引用了多少不同的来源
      sourceDiversity:
        this.countUniqueSources(content) >= criteria.minSources ? 1.0 : 0.5,
      // 新鲜度：有多少近期（6 个月内）的引用
      freshness: this.calculateFreshnessRatio(content) >= 0.2 ? 1.0 : 0.5,
      // 结构完整性：是否包含所有必需章节
      structureCompleteness: this.checkRequiredSections(
        content,
        criteria.requiredSections,
      ),
    };
  }

  private async evaluateByAI(
    content: string,
    criteria: QualityCriteria,
  ): Promise<Scores> {
    const response = await this.chatFacade.chat({
      messages: [
        { role: "system", content: QUALITY_EVALUATOR_PROMPT },
        { role: "user", content: `Evaluate:\n${content}` },
      ],
      taskProfile: { creativity: "deterministic", outputLength: "short" },
    });

    return extractJsonFromAIResponse<Scores>(response.content);
  }
}
```

**评分维度参考**：

| 维度         | 权重 | 说明                             |
| ------------ | ---- | -------------------------------- |
| accuracy     | 0.25 | 事实准确性（有来源支撑）         |
| completeness | 0.25 | 覆盖完整性（是否遗漏关键角度）   |
| depth        | 0.20 | 分析深度（insight 而非 summary） |
| readability  | 0.15 | 可读性（结构清晰、逻辑连贯）     |
| freshness    | 0.15 | 时效性（引用最新数据）           |

### Stage 3: CritiqueRefine 循环（Reflexion 模式）

当 Stage 2 评分不通过时，进入"批评→改进"循环：

```typescript
@Injectable()
export class CritiqueRefineService {
  constructor(private readonly chatFacade: ChatFacade) {}

  async refineLoop(config: CritiqueRefineConfig): Promise<RefineResult> {
    let content = config.originalContent;
    let iteration = 0;
    const history: RefineIteration[] = [];

    while (iteration < config.maxIterations) {
      iteration++;

      // Step 1: 批评当前内容
      const critique = await this.critique(content, config.criteria);

      // Step 2: 检查停止条件
      if (critique.score >= config.passThreshold) {
        return {
          content,
          iterations: iteration,
          finalScore: critique.score,
          history,
          improved: iteration > 1,
        };
      }

      // Step 3: 根据批评改进
      const improved = await this.refine(content, critique);
      history.push({
        iteration,
        score: critique.score,
        issues: critique.issues,
        contentLength: content.length,
      });

      content = improved;
    }

    // 达到最大迭代次数，返回最新版本
    return {
      content,
      iterations: iteration,
      finalScore: history[history.length - 1]?.score ?? 0,
      history,
      improved: true,
      reachedMaxIterations: true,
    };
  }

  private async critique(
    content: string,
    criteria: string[],
  ): Promise<CritiqueResult> {
    const response = await this.chatFacade.chat({
      messages: [
        { role: "system", content: CRITIQUE_PROMPT },
        {
          role: "user",
          content: `Criteria: ${criteria.join(", ")}\n\nContent:\n${content}`,
        },
      ],
      taskProfile: { creativity: "low", outputLength: "medium" },
    });

    return extractJsonFromAIResponse<CritiqueResult>(response.content);
  }

  private async refine(
    content: string,
    critique: CritiqueResult,
  ): Promise<string> {
    const response = await this.chatFacade.chat({
      messages: [
        { role: "system", content: REFINE_PROMPT },
        {
          role: "user",
          content: `Issues to fix:\n${critique.issues.map((i) => `- ${i}`).join("\n")}\n\nOriginal:\n${content}`,
        },
      ],
      taskProfile: { creativity: "medium", outputLength: "long" },
    });

    return response.content;
  }
}
```

### 全链路追踪

```typescript
@Injectable()
export class QualityTraceService {
  private traces = new LruMap<string, QualityTrace>(500);

  // 在每个阶段记录质量数据
  recordStageResult(traceId: string, stage: string, result: StageResult): void {
    const trace = this.traces.get(traceId) ?? {
      stages: [],
      startedAt: new Date(),
    };
    trace.stages.push({
      stage,
      score: result.score,
      passed: result.passed,
      details: result.details,
      timestamp: new Date(),
    });
    this.traces.set(traceId, trace);
  }

  // 生成质量报告
  generateReport(traceId: string): QualityReport {
    const trace = this.traces.get(traceId);
    if (!trace) return { available: false };

    return {
      available: true,
      overallScore: average(trace.stages.map((s) => s.score)),
      weakestStage: trace.stages.reduce((min, s) =>
        s.score < min.score ? s : min,
      ),
      totalDuration: Date.now() - trace.startedAt.getTime(),
      stages: trace.stages,
    };
  }
}
```

## 质量管道集成示例

```typescript
// 在 MissionExecutionService 中集成质量管道
async executeTaskWithQuality(task: Task): Promise<TaskResult> {
  // 1. 执行任务获取原始输出
  const rawOutput = await this.executeTask(task);

  // 2. 结构验证（自动修复）
  const structural = this.structuralValidator.validate(rawOutput, RULES);
  const content = structural.fixedContent;

  // 3. 内容评分
  const verdict = await this.qualityGate.evaluate(content, CRITERIA);

  if (!verdict.passed && task.revisionCount < MAX_REVISIONS) {
    // 4. CritiqueRefine 循环
    const refined = await this.critiqueRefine.refineLoop({
      originalContent: content,
      criteria: verdict.failedCriteria,
      maxIterations: 2,
      passThreshold: 0.7,
    });

    // 5. 记录质量追踪
    this.qualityTrace.recordStageResult(task.id, "critique-refine", {
      score: refined.finalScore,
      passed: refined.finalScore >= 0.7,
      details: { iterations: refined.iterations },
    });

    return { content: refined.content, quality: refined.finalScore };
  }

  return { content, quality: verdict.overallScore };
}
```

## Search Quality Gate（5 项检查）

搜索管道的 QualityGateService 独立于内容质量门控，执行以下 5 项检查：

| 检查项            | 说明                                      | 配置来源                       |
| ----------------- | ----------------------------------------- | ------------------------------ |
| minResults        | 结果数量是否达到最低要求                  | context.minResults（默认 5）   |
| sourceDiversity   | 源类型多样性（至少 2 种）                 | 硬编码阈值 2                   |
| freshness         | 至少 20% 结果在 6 个月内                  | `DATA_FRESHNESS.SIX_MONTHS_MS` |
| academicCoverage  | 学术来源数量（仅 requireAcademic 时检查） | context.minAcademic            |
| failedSourceRatio | 失败源比例不超过 50%                      | 硬编码阈值 0.5                 |

新鲜度时间窗口从 `config/health-monitoring.config.ts` 的 `DATA_FRESHNESS` 常量读取，不硬编码毫秒数。

## 禁忌

1. **禁止跳过结构验证** -- 结构问题用规则修复比调 LLM 便宜 100 倍
2. **禁止无限循环** -- CritiqueRefine 必须有 maxIterations 上限（推荐 2-3）
3. **禁止硬编码评分阈值** -- 通过配置传入 passThreshold，不同场景不同标准
4. **禁止静默吞掉质量不过** -- 质量不过必须记录到 QualityTrace，可追溯
5. **禁止评分维度一刀切** -- 不同内容类型（报告/章节/摘要）用不同维度和权重

{{#if qualityContext}}

## 质量上下文

{{{qualityContext}}}
{{/if}}
