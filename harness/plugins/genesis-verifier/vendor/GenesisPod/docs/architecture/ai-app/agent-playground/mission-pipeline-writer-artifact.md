# Writer ReportArtifact 子文档（Q7）

> **基线版本**：v0.1 / 2026-04-26
> **上游**：mission-pipeline-baseline.md §3.7 / §7 / §8 / §10 Q7 / §13 P0
> **优先级**：P0（含三视图、角标溯源、图文并茂、图来源红线）

---

## 1. 问题域

Writer 阶段的输出必须满足：

1. **结构化**：不是裸 markdown，而是 ReportArtifact（sections / citations / figures / quickView / factTable / metadata / quality）
2. **三视图共享**：连续 / 章节 / 快速视图共用同一份 ReportArtifact
3. **角标溯源**：[N] 与 citations 1:1，含 `occurrences[]` 反向定位
4. **图文并茂 + 图来源红线**：图必须来自参考文献原始内容（reference / extracted_chart 两类），禁止 AI 创造图
5. **质量硬指标**：10 维评分 + 局部回写

---

## 2. ReportArtifact 完整 Schema（baseline §7 摘录）

完整字段定义见 baseline §7.1 ~ §7.7。下面只列子文档增补。

### 2.1 RewriteRequest（局部回写）

```typescript
interface RewriteRequest {
  sectionId: string; // 要重写的 section
  reviewerCritique: string; // L3 Reviewer 的批评意见
  preserveFactIds: string[]; // 必须保留的 fact ids
  preserveFigureIds: string[]; // 必须保留的 figure ids
  targetMetrics: Partial<QualityVerdicts["dimensions"]>; // 必须改善的指标
  maxRound: 2;
}
```

---

## 3. Writer 内部 5 子节点 Spec

### 3.1 OutlinePlannerAgent（W1）

```typescript
@DefineAgent({
  id: 'playground.writer.outline-planner',
  loop: 'react',
  toolCategories: [],                 // 不调工具，纯规划
  budget: { maxTokens: 8_000, maxIterations: 2 },
  taskProfile: { creativity: 'low', outputLength: 'medium', reasoningDepth: 'moderate' },
  inputSchema: {
    plan, factTable, figureCandidates,
    lengthProfile, audienceProfile, withFigures,
  },
  outputSchema: {
    chapterOutlines: ChapterOutline[],
    targetWordsPerChapter: Record<string, number>,
    factAllocation: Record<string, string[]>,    // chapterId → factIds
    figurePlan?: Record<string, string[]>,       // chapterId → figureIds（仅 withFigures=true）
  },
})
```

**关键决策**：factTable 提前分配给章节，避免 W2 章节抢/漏事实（TI 短板）。

### 3.2 ChapterWriterAgent（W2，并行 ×N）

```typescript
@DefineAgent({
  id: 'playground.writer.chapter-writer',
  loop: 'react',
  toolCategories: [],
  budget: { maxTokens: 12_000, maxIterations: 3 },
  taskProfile: { creativity: 'medium', outputLength: 'long', reasoningDepth: 'moderate' },
  inputSchema: {
    chapterOutline, allocatedFacts, allocatedRefs, allocatedFigures,
    dimensionDraft, styleProfile, audienceProfile,
    rewriteRequest?: RewriteRequest,             // 局部回写时填
  },
  outputSchema: {
    sectionId, markdown,                         // markdown 含 baked [N] + ![](#fig-id)
    citationsUsed: number[],
    figureIdsUsed: string[],
    factsUsed: string[],
  },
  validateBusinessRules: validateChapterDraft,
})
```

**业务校验**：

- markdown 中 [N] 必须 ⊆ allocatedRefs
- markdown 中 fig-id 必须 ⊆ allocatedFigures（不可自创 figureId）
- factsUsed 必须 ⊆ allocatedFacts
- 字数在 targetWordsPerChapter ±20%

### 3.3 CrossDimSynthesizerAgent（W3）

```typescript
@DefineAgent({
  id: 'playground.writer.cross-dim-synth',
  loop: 'react',
  toolCategories: [],
  budget: { maxTokens: 16_000, maxIterations: 3 },
  taskProfile: { creativity: 'medium', outputLength: 'long', reasoningDepth: 'deep' },
  inputSchema: {
    chapterDrafts, factTable, reconciliationReport, analystInsights,
    styleProfile, audienceProfile,
  },
  outputSchema: {
    executiveSummary,                            // 400-600 字
    crossDimAnalysis,
    riskAssessment,
    strategicRecommendations,
    conclusion,
    noveltyScores: Record<string, number>,       // 每节自评新颖度
  },
  validateBusinessRules: validateNovelty,        // noveltyScore < 0.5 即 reject
})
```

**关键决策**：noveltyCheck 必须通过 0.5 阈值（独立 critic 二次评），避免 TI 套话。

### 3.4 ReportAssemblerService（W4，纯代码非 LLM）

```typescript
class ReportAssemblerService {
  assemble(input: AssembleInput): ReportArtifact {
    // 1. sections 树构建（按 type/level/anchor/offsets/wordCount）
    const sections = this.buildSectionTree(input.chapterDrafts, input.crossDim);

    // 2. citation 编号原子分配（与 markdown [N] 1:1）
    const citations = this.atomicAssignCitations(input);

    // 3. occurrences[] 反向定位（扫 markdown 算 paragraphIndex / characterOffset）
    this.fillCitationOccurrences(citations, sections);

    // 4. figures 强校验（baseline §7.4 表格 5 项）
    const figures = this.validateAndDedupeFigures(input.figureCandidates, citations);

    // 5. quickView 派生
    const quickView = this.deriveQuickView(input, sections, citations, figures);

    // 6. 50+ 项格式自动修复（照搬 TI report-assembler.service.ts:679-932）
    const fullMarkdown = this.applyFormatFixes(this.concatMarkdown(sections));

    // 7. metadata 填充
    const metadata = this.computeMetadata(input, fullMarkdown);

    return { content: { fullMarkdown, ... }, sections, citations, figures, quickView, factTable, metadata, quality };
  }
}
```

### 3.5 QualityGate + ReviewerAgent（W5）

```typescript
@DefineAgent({
  id: 'playground.writer.reviewer',
  loop: 'react',
  toolCategories: [],
  budget: { maxTokens: 12_000, maxIterations: 2 },
  taskProfile: { creativity: 'low', outputLength: 'medium', reasoningDepth: 'deep' },
  inputSchema: { artifact, factTable, reconciliationReport, audienceProfile },
  outputSchema: QualityVerdicts,
})
```

**触发局部回写**：

```typescript
const verdicts = await reviewer.run(artifact);
const failingChapters = sections.filter(s => verdicts.dimensions[s.id]?.overall < 70);
if (failingChapters.length > 0 && round < 2) {
  for (const ch of failingChapters) {
    await chapterWriter.run({ ...input, rewriteRequest: { sectionId: ch.id, ... } });
  }
  // 重新 W4 Assembler
}
```

---

## 4. 三视图渲染契约（前端实现协议）

### 4.1 共享数据 API

```
GET /agent-playground/missions/:missionId/report
→ { artifact: ReportArtifact, viewMode?: 'continuous'|'chapter'|'quick' }
```

### 4.2 路由 + 视图状态

| 视图 | 路由                       | 主组件             | 数据使用                                               |
| ---- | -------------------------- | ------------------ | ------------------------------------------------------ |
| 连续 | `?view=continuous`（默认） | `ContinuousReader` | `content.fullMarkdown` 整篇 + `sections` 浮动 mini-TOC |
| 章节 | `?view=chapter[&sec={id}]` | `ChapterReader`    | 按 `sections[].startOffset~endOffset` 切片 + 左侧 TOC  |
| 快速 | `?view=quick`              | `QuickReader`      | `quickView` 全部派生数据                               |

### 4.3 共享能力组件

- `<CitationTooltip>`：包裹所有 `<sup data-cite="N">`
- `<FigureCard>`：渲染 reference 类图
- `<ChartRenderer>`：渲染 extracted_chart 类图
- `<ReferencePanel>`：右侧/底部引用列表，点条目反向高亮 occurrences[]
- `<MiniTOC>`：连续视图的浮动目录
- `<ChapterTOC>`：章节视图的左侧树
- `<JumpToAnchor>`：URL hash 跳转

---

## 5. 角标溯源完整链路（W4 落实细节）

```
W4 ReportAssembler 阶段（baseline §8.3）
  1. atomicAssignCitations 给每个 chapterDraft 中的 [N] 分配全局唯一 number
  2. 不允许重排（避免与 TI 一致：citationIndex 一旦分配不改）
  3. fillCitationOccurrences 扫 fullMarkdown 算每个 [N] 的：
     - 所属 section.id
     - 段落 index（按 \n\n 分段）
     - 字符 offset（在 section 内）
  4. 输出 citations[i].occurrences[] 数组
```

前端实现（baseline §8.3）：

- ReactMarkdown 自定义 renderer 命中 `[N]` 文本 → `<sup data-cite="N">`
- CitationTooltip 包裹，hover 查 citations[index===N] → Portal 卡片
- 点条目 → scrollToReference(N) + ReferencePanel 高亮
- 反向溯源：点 ReferencePanel 引用条目 → 用 occurrences[] 高亮文中所有位置

---

## 6. 图文并茂 + 图来源红线（W2/W4 落实细节）

完整链路见 baseline §7.4 / §8.4。子文档摘要红线：

| 红线                                                                | W4 校验后处理                   |
| ------------------------------------------------------------------- | ------------------------------- |
| `evidenceCitationIndex` 不在 citations                              | 删除 figure                     |
| `sourceUrl` 缺失或不在 citations[N].url 找到对应                    | 删除 figure                     |
| `imageUrl` / `imageDataUri` 都缺（reference 类）                    | 删除 figure                     |
| `data + sourceUrl + sourcePageOrSection` 缺一（extracted_chart 类） | 删除 figure                     |
| 同 imageUrl 多 figure 重复                                          | 去重，figureIds 指向同一 figure |
| `isGarbageFigureUrl` 命中（QR / favicon / 广告 等）                 | 删除 figure                     |

W2 ChapterWriter prompt 必须含：

- "只能引用 W1 figurePlan 给定的 figureIds，不可自创"
- "不可调用 image-generation 工具"
- "图必须挂在已存在的 [N] 上"

---

## 7. 10 维质量硬指标（baseline §7.8）

| 维度               | 阈值                                     | 不达标动作             |
| ------------------ | ---------------------------------------- | ---------------------- |
| traceability       | 100% claim 有 [N]                        | error 级，强卡         |
| factualConsistency | factTable.conflict 全部 properly handled | error 级，强卡         |
| novelty            | cross-dim/recommendations ≥ 0.5          | reject 重写 W3         |
| coverage           | plan.dimensions 全有 chapter             | 标 [insufficient-data] |
| redundancy         | 章节间 4-gram Jaccard < 0.15             | 自动改写               |
| formatCorrectness  | LaTeX/Table/List/Heading 错误 = 0        | 50+ 自动修复（不重写） |
| citationDensity    | 加粗 ≤ 60 / 引用块 ≤ 8 / 单句引用 ≤ 2    | warning，自动调整      |
| styleConformance   | ≥ 70（独立 critic 评 styleProfile）      | reject 重写章节        |
| lengthAccuracy     | 实际字数 ±20% lengthProfile 目标         | 触发某章重写           |
| chapterBalance     | 标准差 < 平均 50%                        | 触发某章扩写/缩写      |

---

## 8. 实现要点

- W1~W5 全部基于现有 AgentRunner.run（边界 1）
- W4 是纯代码，不走 Loop（不烧 LLM token）
- 50+ 格式修复全部移植自 TI `report-assembler.service.ts`
- citation occurrences 计算用 markdown-it 的 token 流 + offset 累加
- figure 校验在 W4 前置（早删早清，避免 markdown 留死链接）

---

## 9. 验收标准

- 三视图渲染同一 ReportArtifact 不需要二次 API
- 连续视图 mini-TOC 高亮当前 section（滚动联动）
- 章节视图 URL 含 sec={id} 可分享
- 快速视图全部数据来自 quickView 派生（前端不再 slice/filter）
- 角标 hover 显示完整 citation 卡片
- 反向溯源：点 ReferencePanel 引用条目 → 文中所有位置高亮
- 图必须挂 [N]，删一张图 → 该图引用[N] 在 citations 列表中减一次 cited
- 局部回写：reviewer 评分低章节单独 W2 重跑，max 2 round
- 10 维硬指标全部进 quality.dimensions 字段持久化

---

## 10. 风险 / 边界

- noveltyScore 评分主观 → 用独立 critic agent + 多次评分平均
- factAllocation 可能漏分配（factTable 太大）→ W1 budget 不够时退化为 LLM 自决（但保留 factCandidate 提示）
- 局部回写可能引发跨章节不连贯 → W4 重组时检查跨章过渡段，必要时同步重写邻章衔接
- citation occurrences 字符 offset 在 markdown 修复后可能漂移 → W4 必须在格式修复**之后**计算 occurrences
