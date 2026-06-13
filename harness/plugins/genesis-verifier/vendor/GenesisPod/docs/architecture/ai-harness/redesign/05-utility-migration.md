# Topic Insights · Utility 迁移清单

> 版本：v1（Gate 2）
>
> 原则：**先迁移 + 测试通过 + Pipeline 切换调用，才允许删除 legacy service**。

---

## 一、目录总览

新建目录 `backend/src/modules/ai-app/topic-insights/utils/`：

```
utils/
├── research/
│   ├── build-evidence-summary.ts     UT-RS-EVSUM
│   ├── build-figure-summary.ts       UT-RS-FIGSUM
│   └── assess-credibility.ts         UT-CRED-ASSESS
├── content-format/
│   ├── number-sub-headings.ts        UT-CF-NUMBERING
│   ├── sanitize-section-output.ts    UT-CF-SANITIZE
│   ├── apply-opening-conclusion-rules.ts  UT-CF-OPENING
│   ├── preprocess-dimension-content.ts    UT-CF-PREPROC
│   └── strip-html-tags.ts            UT-CF-HTMLSTRIP
├── figure/
│   ├── insert-figure-placeholders.ts UT-FIG-INSERT
│   ├── figure-registry.ts            UT-FIG-REGISTRY
│   └── is-valid-figure-url.ts        UT-FIG-VALIDURL
├── citation/
│   ├── format-citations.ts           UT-CIT-FORMAT
│   ├── allocate-citation-index.ts    UT-CIT-ALLOC
│   └── citation-density-check.ts     UT-CIT-DENSITY
├── evidence/
│   └── count-dimension-evidence.ts   UT-CRED-COUNT
├── quality/
│   ├── heuristic-dimension-score.ts  UT-QUAL-HEURISTIC
│   ├── quality-gate-rules.ts         UT-QG-RULES
│   ├── evaluate-quality-gate.ts      UT-QG-EVAL
│   └── detect-iron-wall/             UT-IW-* (6 files)
├── latex/
│   └── validate-latex-delimiters.ts  UT-LTX-VALIDATE
├── assemble/
│   ├── build-full-report.ts          UT-ASM-FULL
│   ├── build-toc.ts                  UT-ASM-TOC
│   ├── integrate-dimension-sections.ts  UT-ASM-INTEGRATE
│   ├── reprocess-formatting.ts       UT-ASM-REPROCESS
│   └── compute-report-diff.ts        UT-ASM-DIFF
└── section/
    └── build-section-dag.ts          UT-SEC-DAG
```

**约 30 个 utility 文件**（05 v1 估计 25 + Iron-wall 拆 6 - 原 1 = 30）。

---

## 二、迁移清单（按 utility 分组）

### 2.1 research/

#### UT-RS-EVSUM · build-evidence-summary.ts

**来源**: `DimensionMissionService.executeSearchPhase` 末尾段（line ~850-920）
**目标签名**:

```typescript
export function buildEvidenceSummary(
  evidences: Array<{
    title: string;
    domain: string;
    snippet: string;
    publishedAt?: Date;
    credibilityScore?: number;
    citationIndex?: number;
  }>,
  options?: { maxLength?: number; groupByDomain?: boolean },
): string;
```

**测试**: `evidences: []` → `"无证据"`；正常 case → 分组且 ≤ maxLength。

#### UT-RS-FIGSUM · build-figure-summary.ts

**来源**: 同上的 figures summary 段
**签名**:

```typescript
export function buildFigureSummary(
  figures: Array<{
    id: string;
    url: string;
    caption: string;
    evidenceIndex: number;
  }>,
): string;
```

#### UT-CRED-ASSESS · assess-credibility.ts

**来源**: `DimensionWritingService.saveEvidence` 内的 assessCredibility 调用段
**签名**:

```typescript
export function assessCredibility(input: {
  title: string;
  domain: string;
  publishedAt?: Date;
  sourceType: string;
  snippet: string;
}): number; // 0-100
```

**规则**：domain 白名单 / 黑名单、时效性衰减、长度启发式。需对照 legacy 代码精确迁移。

---

### 2.2 content-format/

#### UT-CF-NUMBERING · number-sub-headings.ts

**来源**: `SectionWriterService` / `ReportSynthesisService.saveDimensionAnalysis` 内
**签名**:

```typescript
export function numberSubHeadings(
  markdown: string,
  dimensionIndex: number,
  opts?: { startLevel?: number; prefix?: string },
): string;
```

#### UT-CF-SANITIZE · sanitize-section-output.ts

**来源**: 已存在的 utils；迁移路径最轻
**签名**: 保持现有

#### UT-CF-OPENING · apply-opening-conclusion-rules.ts

**来源**: 嵌入在 `SectionWriterService` 写作后处理段
**签名**:

```typescript
export function applyOpeningConclusionRules(markdown: string): string;
```

**规则**：移除模板化开头（"随着..." / "在当前..." / "综上所述，"）。

#### UT-CF-PREPROC · preprocess-dimension-content.ts

**来源**: `ReportSynthesisService.saveDimensionAnalysis` 内的 preprocess 函数
**签名**:

```typescript
export function preprocessDimensionContent(
  content: string,
  dimIndex: number,
  figureReferences?: FigureReference[],
): string;
```

**注意**：包含 chart 占位 `<!-- chart:X -->` 插入。

#### UT-CF-HTMLSTRIP · strip-html-tags.ts

**来源**: `TopicInsightsService.cleanHtmlTagsFromContent` + `TopicExportService.cleanHtmlTagsFromContent`（两份重复）
**签名**:

```typescript
export function stripHtmlTags(
  content: string | null | undefined,
): string | null;
```

---

### 2.3 figure/

#### UT-FIG-INSERT · insert-figure-placeholders.ts

**来源**: `ReportSynthesisService.saveDimensionAnalysis` 中的 insertions 段
**签名**:

```typescript
export function insertFigurePlaceholders(
  content: string,
  figures: FigureReference[],
  dimIndex: number,
): string;
```

#### UT-FIG-REGISTRY · figure-registry.ts

**来源**: `ReportAssemblerService` 内
**签名**:

```typescript
export class FigureRegistry {
  register(placeholder: string, url: string, caption: string): void;
  resolve(placeholder: string): FigureInfo | undefined;
  replaceInMarkdown(markdown: string): string;
}
```

#### UT-FIG-VALIDURL · is-valid-figure-url.ts

**来源**: `ReportSynthesisService.saveDimensionAnalysis` 的 `isValidFigureUrl` 内部函数
**签名**: `export function isValidFigureUrl(url: string | null | undefined): boolean;`

---

### 2.4 citation/

#### UT-CIT-FORMAT · format-citations.ts

**来源**: `CitationFormatterService`
**签名**:

```typescript
export function formatCitation(
  evidence: {
    authors?: string;
    title: string;
    year?: number;
    domain: string;
    url: string;
  },
  style?: "plain" | "apa" | "mla",
): string;
```

#### UT-CIT-ALLOC · allocate-citation-index.ts

**来源**: `DimensionWritingService.saveEvidence` 内的 citationIndex 事务分配
**签名**:

```typescript
export async function allocateCitationIndex(
  tx: Prisma.TransactionClient,
  reportId: string,
  count: number,
): Promise<number[]>;
```

**注意**：需要 tx，属于 Layer 1 的例外（但只接受 tx 参数，不自己创建 tx，所以仍符合"纯函数"精神）。

#### UT-CIT-DENSITY · citation-density-check.ts

**新增 utility**（旧没显式计算，但 quality gate 需要）
**签名**:

```typescript
export function computeCitationDensity(markdown: string): {
  citationsPer1000Words: number;
  evenness: number;
};
```

---

### 2.5 evidence/

#### UT-CRED-COUNT · count-dimension-evidence.ts

**新增**（CP-2.6c 强制 evidenceUsed 从 DB 读）
**签名**:

```typescript
export async function countDimensionEvidence(
  prisma: PrismaService,
  reportId: string,
  dimensionId: string,
): Promise<number>;
```

---

### 2.6 quality/

#### UT-QUAL-HEURISTIC · heuristic-dimension-score.ts

**来源**: `ReviewDimensionExecutor.computeHeuristicReview`（当前 executor 内）
**签名**:

```typescript
export function heuristicDimensionScore(
  analysis: { summary?: string; keyFindings?: unknown[]; detailedContent?: string; evidenceUsed: number; ... },
): { overallScore: number; axisScores: { breadth, depth, evidence, coherence, currency }; issues: Issue[] };
```

#### UT-QG-RULES · quality-gate-rules.ts

**来源**: `ReportQualityGateService`（963 行）中的规则定义段
**签名**:

```typescript
export const QUALITY_GATE_RULES: Record<RuleId, QualityRule> = {
  heading_hierarchy: { check(content, ctx) { ... } },
  citation_coverage: { ... },
  min_content_length: { ... },
  figure_placement: { ... },
  cross_references: { ... },
  iron_wall_compliance: { ... },
};
```

#### UT-QG-EVAL · evaluate-quality-gate.ts

**签名**:

```typescript
export function evaluateQualityGate(
  content: string,
  context: { evidenceCount: number; plan: LeaderPlan },
  rules?: RuleId[],
): QualityGateReport;
```

#### UT-IW-\* · detect-iron-wall/

**来源**: 散落在各 service（sanitize / opening-conclusion / iron-wall 硬编码）
**6 个文件**，每个签名：

```typescript
export function detectEmojiViolations(content: string): Violation[];
export function detectPlaceholderViolations(content: string): Violation[];
export function detectTemplateOpening(content: string): Violation[];
export function detectFuzzyQuantifiers(content: string): Violation[];
export function detectInternalRoleNames(content: string): Violation[];
export function detectHtmlTags(content: string): Violation[];
```

`Violation = { line, col, rule, snippet, severity }`。

---

### 2.7 latex/

#### UT-LTX-VALIDATE · validate-latex-delimiters.ts

**来源**: `LatexRepairService.validateLatexDelimiters`（已是纯函数）
**签名**: 保留原签名

```typescript
export function validateLatexDelimiters(content: string): {
  valid: boolean;
  issues: Array<{ line: number; issue: string }>;
};
```

---

### 2.8 assemble/

#### UT-ASM-FULL · build-full-report.ts

**来源**: `ReportAssemblerService.buildFullReportFromDimensions`
**签名**:

```typescript
export function buildFullReportFromDimensions(
  dimensionMetas: DimensionMeta[],
  synthesis: SynthesisResult,
  opts: { includeTOC?: boolean; figureRegistry?: FigureRegistry },
): string;
```

#### UT-ASM-TOC · build-toc.ts

**签名**:

```typescript
export function buildTableOfContents(
  markdown: string,
  opts?: { depth?: number },
): string;
```

#### UT-ASM-INTEGRATE · integrate-dimension-sections.ts

**来源**: `ResearchLeaderService.integrateDimensionResults` 的合章 + 铁墙清理段
**签名**:

```typescript
export function integrateDimensionSections(sections: SectionResult[]): {
  merged: string;
  wordCount: number;
  violations: Violation[];
};
```

#### UT-ASM-REPROCESS · reprocess-formatting.ts

**来源**: `ReportSynthesisService.reprocessExistingReport`
**签名**:

```typescript
export function reprocessReportFormatting(
  content: string,
  opts?: { reapplyCitationFormat?: boolean; rerunIronWallChecks?: boolean },
): string;
```

#### UT-ASM-DIFF · compute-report-diff.ts

**新增**（CP-M.5 changesFromPrev）
**签名**:

```typescript
export function computeReportDiff(
  oldReport: TopicReport,
  newReport: SynthesisResult,
): ReportDiff;
```

---

### 2.9 section/

#### UT-SEC-DAG · build-section-dag.ts

**新增**（用于 ST-03 的 section 并行批次生成）
**签名**:

```typescript
export function buildSectionDAG(sections: SectionPlan[]): SectionPlan[][]; // 批次数组，每批内部无依赖可并行
```

---

## 三、迁移工作量估算

| 组              | 文件数          | 每文件估计       | 小计       |
| --------------- | --------------- | ---------------- | ---------- |
| research/       | 3               | 1 人天（含测试） | 3 天       |
| content-format/ | 5               | 0.5 天           | 2.5 天     |
| figure/         | 3               | 0.5 天           | 1.5 天     |
| citation/       | 3               | 0.5 天           | 1.5 天     |
| evidence/       | 1               | 0.2 天           | 0.2 天     |
| quality/        | 3 + 6 Iron-wall | 0.5 天 / 0.3 天  | 3.3 天     |
| latex/          | 1               | 0.2 天           | 0.2 天     |
| assemble/       | 5               | 1 天             | 5 天       |
| section/        | 1               | 0.3 天           | 0.3 天     |
| **合计**        | **~30**         |                  | **~17 天** |

---

## 四、迁移前后对照测试

### 4.1 契约测试模板

对每个 utility，**pair-wise 对比**旧实现和新 utility：

```typescript
// __tests__/migration-parity/number-sub-headings.parity.spec.ts

describe("UT-CF-NUMBERING migration parity", () => {
  const cases = loadFixtures("fixtures/legacy-number-sub-headings/");

  for (const { input, expected } of cases) {
    it(`matches legacy output for ${input.name}`, () => {
      expect(numberSubHeadings(input.markdown, input.dimIndex)).toEqual(
        expected.output,
      );
    });
  }
});
```

### 4.2 Fixture 采集

Phase 0 基线捕获会录制每个 legacy 函数的 input/output pair，存成 JSON fixtures，供新 utility 对比测试。

---

## 五、迁移顺序（PR 分解）

**依赖链**：utility migration 可并行做，但有以下顺序偏好：

1. **PR 1**: research/ + content-format/（最基础，多个 stage 都要用）
2. **PR 2**: figure/ + citation/（assemble 依赖）
3. **PR 3**: evidence/（单独）
4. **PR 4**: quality/（含 Iron-wall 6 子）
5. **PR 5**: latex/
6. **PR 6**: assemble/（依赖前面所有）
7. **PR 7**: section/（ST-03 专用）

---

## 六、删除 legacy 的前置条件

对每个 legacy service，**以下所有条件满足**才允许物理删除：

1. 所有被迁移的函数在 utils/ 下有对应新实现
2. 契约测试通过（新 vs 旧输出一致）
3. Pipeline Stage 已切换调用新 utility
4. Feature flag `TOPIC_INSIGHTS_PIPELINE_ENABLED=1` 下的 e2e 测试通过
5. Golden 样本测试无回归

违反任何一条 → PR 拒绝合并。
