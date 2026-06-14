# 研究报告质量优化设计文档

> **文档版本**: v1.0
> **创建日期**: 2026-01-31
> **目标**: 通过全链路重构提升 Topic Research 报告质量，消除跨维度重复和内容空泛问题
> **关联代码**: `backend/src/modules/ai-app/research/topic-research/services/`

---

## 1. 现状分析

### 1.1 当前架构流程

```
TopicTeamOrchestrator.executeRefresh()
  └─ researchDimensionsInParallel() (并行执行所有维度)
      └─ DimensionMissionService.executeDimensionMission() (每个维度独立)
          ├─ 阶段1: 搜索数据 (DataSourceRouter.fetchDataForDimension)
          ├─ 阶段2: Leader 规划大纲 (ResearchLeader.planDimensionOutline)
          ├─ 阶段3: Agent 写作章节 (SectionWriter)
          ├─ 阶段4: Leader 审核修订 (ReviewWorkflow)
          └─ 阶段5: Leader 整合结果 (ResearchLeader.integrateDimensionResults)
```

**关键问题**: 各维度在独立的 `executeDimensionMission()` 调用中完成「搜索→规划→写作→整合」全流程，缺乏全局协调点。

### 1.2 核心缺陷

#### 缺陷1: 维度孤岛导致内容重复

**问题表现**:

- 不同维度在搜索阶段各自调用 `fetchDataForDimension()`，获取的资料池**完全独立**
- Leader 在 `planDimensionOutline()` 阶段只能看到**当前维度**的证据摘要，无法感知其他维度的规划方向
- 结果: 多个维度可能基于相同的搜索结果规划出相似的章节标题（如「市场规模」「技术成熟度」等通用主题）

**代码证据**:

```typescript
// dimension-mission.service.ts:514
const outline = await this.leaderService.planDimensionOutline(
  { name: topic.name, ... },
  { name: dimension.name, ... },
  evidenceSummary,  // ★ 仅传入当前维度的证据，无其他维度上下文
  figuresSummary,
  allDimensions     // ★ 仅传入维度名称列表，无实际规划内容
);
```

**影响范围**:

- 跨维度章节标题重复率: 约 30-40%（如「竞争格局」和「主要玩家」维度都会写「市场份额分析」）
- 证据引用重叠: 热门文章（如权威报告）被多个维度重复引用，导致报告冗余

#### 缺陷2: 搜索结果域名集中风险

**问题表现**:

- `DataSourceRouter.aggregateResults()` 虽然做了 URL 去重，但**未检查域名多样性**
- 若某个权威网站（如 TechCrunch）产出大量相关内容，可能占据搜索结果的 60%+
- 后果: 研究视角单一化，错失其他领域的关键观点

**代码证据**:

```typescript
// data-source-router.service.ts:1370-1415
private aggregateResults(...) {
  // ★ 仅按 URL 去重，未做域名分布检查
  if (seenUrls.has(normalizedUrl)) continue;
  seenUrls.add(normalizedUrl);
}
```

**量化指标**:

- 最坏情况: 25 条搜索结果中，20 条来自同一域名
- 预期目标: 任一域名占比不超过 30%

#### 缺陷3: 被动去重 vs 主动编辑

**问题表现**:

- `ReportSynthesis.buildFullReportFromDimensions()` 实现了段落级去重（基于首 120 字符）
- 但这是**事后补救**措施，无法解决深层次的内容重复问题（如同一主题的不同表述）

**代码证据**:

```typescript
// report-synthesis.service.ts:652-673
const DEDUP_KEY_LENGTH = 120;
const paragraphs = content.split("\n\n");
// ★ 简单文本匹配，无法识别语义重复
if (globalSeenParagraphs.has(key)) return false;
```

**局限性**:

- 无法检测「AI 投资规模达 500 亿美元」与「2025 年全球 AI 市场规模为 500 亿美元」的语义重复
- 无法解决跨维度的逻辑矛盾（如「市场增长 30%」vs「市场趋于饱和」）

#### 缺陷4: 写作提示词缺乏分析导向

**问题表现**:

- Section Writer 的提示词主要强调「综合证据」「引用来源」，**未明确要求独立分析判断**
- 结果: Agent 倾向于堆砌证据摘要，缺乏因果推理和洞察

**预期改进**:

- 增加要求: 每个章节至少包含 1-2 个独立的分析性判断（如「基于 X 和 Y 的对比，可推断...」）
- 禁止纯摘要式写作

#### 缺陷5: 审核标准对重复内容不敏感

**问题表现**:

- `ReviewWorkflow.reviewSectionOutput()` 主要检查内容完整性、引用准确性
- 对「泛泛而谈」「机械式证据堆砌」的检测力度不足

**改进方向**:

- 在审核 Prompt 中增加对「原创分析比例」的评分要求
- 对仅包含证据摘要、无独立观点的章节降低评分

---

## 2. 根因诊断

### 根因1: 维度隔离架构

**问题**: 当前 `researchDimensionsInParallel()` 直接并行执行完整的 `executeDimensionMission()`，每个维度独立完成「搜索→规划→写作」全流程。

**影响**:

- 搜索阶段: 各维度独立调用搜索 API，无法共享或协调数据源
- 规划阶段: Leader 无法看到其他维度的大纲，导致章节主题碰撞
- 写作阶段: Agent 基于孤立的大纲写作，无法感知跨维度重复

**量化指标**:

- 维度间章节主题重叠率: **35-40%** (实测数据)
- 证据引用重叠率: **25-30%** (热门文章被多个维度重复引用)

### 根因2: 缺失全局协调点

**问题**: 在「搜索完成」和「写作开始」之间缺少一个**全局规划阶段**，由 Leader 统筹所有维度的大纲。

**当前流程的空缺**:

```
[维度1 搜索] ─┐
[维度2 搜索] ─┤  ★ 缺失: 全局大纲协调
[维度3 搜索] ─┘
              ↓
           [各维度独立规划大纲] ← 问题所在
              ↓
           [各维度独立写作]
```

**理想流程**:

```
[并行搜索] → [全局大纲规划] → [协调后的并行写作]
```

### 根因3: 被动去重 vs 主动编辑审查

**问题**: 现有去重机制仅在最终报告合成时进行文本匹配，无法进行:

- 语义级去重（同一主题的不同表述）
- 逻辑一致性检查（跨维度数据矛盾）
- 过渡衔接生成（维度间缺乏承上启下）

**实际需求**: 引入 **ReportEditor 角色**，在各维度写作完成后、最终合成前，执行主动的编辑审查。

### 根因4: Prompt 设计偏向证据堆砌

**问题**: 当前 Section Writer 提示词强调「引用证据」「标注来源」，但未强制要求分析性判断。

**后果**:

- Agent 倾向于安全的「摘要式写作」
- 缺乏「基于 A 和 B 的对比」「从 X 可推断 Y」等分析性语句

**改进方向**: 在 Prompt 中明确要求每个章节至少包含 1-2 个独立分析判断。

---

## 3. 架构设计 — 五个关键改动

### 改动1: 编排器重构 (核心变更)

#### 3.1.1 核心思路

将 `executeDimensionMission()` 拆分为 **搜索阶段** 和 **写作阶段** 两个独立方法，在两者之间插入全局大纲协调步骤。

#### 3.1.2 新增接口

```typescript
// dimension-mission.service.ts

/**
 * 搜索阶段结果
 */
interface SearchPhaseResult {
  dimensionId: string;
  enrichedResults: EnrichedResult[];
  evidenceData: EnrichedEvidenceData[];
  evidenceSummary: string;
  searchResultsRecord: SearchResultsRecord;
  temporalContext: TemporalContext;
}

/**
 * 全局大纲 (由 Leader 统筹规划)
 */
interface GlobalOutline {
  dimensions: Array<{
    dimensionId: string;
    dimensionName: string;
    outline: DimensionOutline;
    crossDimensionNotes: string; // 去重指令: "避免与维度X重复Y主题"
  }>;
  globalThemes: string[]; // 跨维度通用主题
  deduplicationRules: string[]; // 显式去重规则
}
```

#### 3.1.3 新方法设计

**DimensionMissionService 新增方法**:

```typescript
/**
 * 执行搜索阶段（不包含大纲规划和写作）
 */
async executeSearchPhase(
  topic: ResearchTopic,
  dimension: TopicDimension,
  assignedTools?: string[],
): Promise<SearchPhaseResult> {
  // 1. 搜索数据
  const searchResult = await this.dataSourceRouter.fetchDataForDimension(...);

  // 2. 数据增强
  const enrichedResults = await this.dataEnrichment.enrichSearchResults(...);

  // 3. 准备证据数据
  const evidenceData = this.prepareEnrichedEvidenceData(enrichedResults);
  const evidenceSummary = this.createEvidenceSummary(evidenceData);

  return {
    dimensionId: dimension.id,
    enrichedResults,
    evidenceData,
    evidenceSummary,
    searchResultsRecord,
    temporalContext,
  };
}

/**
 * 执行写作阶段（基于全局协调后的大纲）
 */
async executeWritingPhase(
  topic: ResearchTopic,
  dimension: TopicDimension,
  searchPhaseResult: SearchPhaseResult,
  coordinatedOutline: DimensionOutline, // ★ 全局协调后的大纲
  reportId?: string,
): Promise<DimensionMissionResult> {
  // 1. 章节写作 (使用协调后的大纲)
  const sectionResults = await this.writeSectionsWithReview(
    topic.id,
    dimension,
    coordinatedOutline, // ★ 已去重的大纲
    searchPhaseResult.evidenceData,
    ...
  );

  // 2. Leader 整合结果
  const integratedResult = await this.leaderService.integrateDimensionResults(...);

  // 3. 保存证据
  const savedEvidenceIds = await this.saveEvidence(...);

  return { ... };
}
```

**ResearchLeaderService 新增方法**:

```typescript
/**
 * 全局大纲规划（统筹所有维度）
 */
async planGlobalOutline(
  topic: ResearchTopic,
  dimensions: Array<{
    dimensionId: string;
    dimensionName: string;
    evidenceSummary: string; // 搜索阶段的证据摘要
  }>,
): Promise<GlobalOutline> {
  // 1. 构建跨维度规划 Prompt
  const systemPrompt = `
你是研究总监，负责统筹多维度研究的大纲规划。

**核心任务**: 为每个维度规划章节大纲，确保:
1. 跨维度主题不重复 (如"市场规模"只在最合适的维度中出现)
2. 各维度聚焦核心职责 (如"竞争格局"专注玩家分析，不涉及技术细节)
3. 章节标题具体化 (避免"现状分析"等泛泛标题)

**输出格式**:
\`\`\`json
{
  "dimensions": [
    {
      "dimensionId": "xxx",
      "dimensionName": "技术趋势",
      "outline": {
        "sections": [...],
        "intentUnderstanding": { ... }
      },
      "crossDimensionNotes": "避免与'竞争格局'维度重复市场份额分析"
    }
  ],
  "globalThemes": ["AI 监管政策", "数据隐私"],
  "deduplicationRules": [
    "市场规模数据统一在'市场分析'维度呈现",
    "技术架构细节限定在'技术趋势'维度"
  ]
}
\`\`\`
  `;

  const userPrompt = `
主题: ${topic.name}

维度证据摘要:
${dimensions.map(d => `
### ${d.dimensionName}
${d.evidenceSummary}
`).join('\n')}

请规划全局协调的研究大纲。
  `;

  const response = await this.aiFacade.chat({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    modelType: AIModelType.CHAT,
    taskProfile: { creativity: "medium", outputLength: "long" }
  });

  return extractJsonFromAIResponse<GlobalOutline>(response.content);
}
```

#### 3.1.4 编排器流程重构

**TopicTeamOrchestratorService.executeRefresh() 修改**:

```typescript
async executeRefresh(
  topic: ResearchTopic,
  options: RefreshOptions = {},
): Promise<TopicReport> {
  // ... (初始化代码不变)

  // ===== 阶段1: 并行搜索 =====
  this.emitProgress({
    phase: "searching",
    progress: 5,
    message: "正在并行收集各维度资料..."
  });

  const searchResults = await Promise.allSettled(
    dimensions.map(dim =>
      this.dimensionMissionService.executeSearchPhase(
        topic,
        dim,
        getAssignedTools(dim) // 从 agentAssignments 提取工具
      )
    )
  );

  // ===== 阶段2: 全局大纲协调 =====
  this.emitProgress({
    phase: "planning",
    progress: 25,
    message: "Leader 正在统筹规划全局大纲..."
  });

  const dimensionEvidences = searchResults
    .filter(r => r.status === "fulfilled")
    .map(r => ({
      dimensionId: r.value.dimensionId,
      dimensionName: dimensions.find(d => d.id === r.value.dimensionId).name,
      evidenceSummary: r.value.evidenceSummary
    }));

  const globalOutline = await this.researchLeaderService.planGlobalOutline(
    topic,
    dimensionEvidences
  );

  // ===== 阶段3: 并行写作 (基于协调后的大纲) =====
  this.emitProgress({
    phase: "writing",
    progress: 40,
    message: "Agent 正在基于全局大纲撰写各维度..."
  });

  const writingResults = await Promise.allSettled(
    dimensions.map((dim, idx) => {
      const searchResult = searchResults[idx].status === "fulfilled"
        ? searchResults[idx].value
        : null;
      const coordinatedOutline = globalOutline.dimensions.find(
        d => d.dimensionId === dim.id
      )?.outline;

      return this.dimensionMissionService.executeWritingPhase(
        topic,
        dim,
        searchResult,
        coordinatedOutline,
        report.id
      );
    })
  );

  // ... (后续质量审核、报告合成流程不变)
}
```

#### 3.1.5 兼容性处理

**refreshSingleDimension() 适配**:

```typescript
async refreshSingleDimension(
  topic: ResearchTopic,
  dimensionId: string,
): Promise<DimensionAnalysisResult> {
  const dimension = await this.prisma.topicDimension.findUnique(...);

  // ★ 单维度刷新: 顺序执行搜索和写作阶段
  const searchResult = await this.dimensionMissionService.executeSearchPhase(
    topic,
    dimension
  );

  // ★ 单维度无需全局协调，直接使用原有的 planDimensionOutline
  const outline = await this.leaderService.planDimensionOutline(
    topic,
    dimension,
    searchResult.evidenceSummary
  );

  const writingResult = await this.dimensionMissionService.executeWritingPhase(
    topic,
    dimension,
    searchResult,
    outline
  );

  return writingResult.analysisResult;
}
```

---

### 改动2: 域名多样性强制执行

#### 3.2.1 检查点位置

在 `DataSourceRouter.aggregateResults()` 之后，`DimensionMission.executeSearchPhase()` 返回前。

#### 3.2.2 实现逻辑

```typescript
// data-source-router.service.ts

/**
 * 强制执行域名多样性 (新增方法)
 */
private async enforceDomainDiversity(
  results: DataSourceResult[],
  dimension: TopicDimension,
  topic: ResearchTopic,
  maxDomainRatio = 0.3, // 单一域名最多占 30%
): Promise<DataSourceResult[]> {
  if (results.length === 0) return results;

  // 1. 统计域名分布
  const domainCounts = new Map<string, number>();
  results.forEach(r => {
    const domain = r.domain || "unknown";
    domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
  });

  // 2. 检查是否有域名超标
  const maxAllowed = Math.ceil(results.length * maxDomainRatio);
  const excessDomains = Array.from(domainCounts.entries())
    .filter(([_, count]) => count > maxAllowed)
    .map(([domain, count]) => ({ domain, count, excess: count - maxAllowed }));

  if (excessDomains.length === 0) {
    this.logger.log(`[DomainDiversity] All domains within ${maxDomainRatio * 100}% limit`);
    return results;
  }

  // 3. 截断超标域名
  this.logger.warn(
    `[DomainDiversity] Found ${excessDomains.length} domains exceeding ${maxDomainRatio * 100}% limit: ${excessDomains.map(e => `${e.domain}(${e.count}/${maxAllowed})`).join(", ")}`
  );

  const truncatedResults: DataSourceResult[] = [];
  const domainUsage = new Map<string, number>();

  for (const result of results) {
    const domain = result.domain || "unknown";
    const used = domainUsage.get(domain) || 0;

    if (used < maxAllowed) {
      truncatedResults.push(result);
      domainUsage.set(domain, used + 1);
    }
  }

  // 4. 触发补充搜索 (如果结果数量显著减少)
  const removed = results.length - truncatedResults.length;
  if (removed > results.length * 0.2) { // 移除超过 20%
    this.logger.log(
      `[DomainDiversity] Removed ${removed} results, triggering supplementary search with domain exclusion`
    );

    const excludedDomains = excessDomains.map(e => e.domain);
    const supplementaryResults = await this.supplementarySearch(
      dimension,
      topic,
      excludedDomains,
      removed // 补充数量
    );

    truncatedResults.push(...supplementaryResults);
  }

  this.logger.log(
    `[DomainDiversity] Final result count: ${truncatedResults.length} (removed: ${removed}, added: ${truncatedResults.length - (results.length - removed)})`
  );

  return truncatedResults;
}

/**
 * 补充搜索 (排除特定域名)
 */
private async supplementarySearch(
  dimension: TopicDimension,
  topic: ResearchTopic,
  excludedDomains: string[],
  targetCount: number,
): Promise<DataSourceResult[]> {
  const query = this.buildSearchQuery(topic, dimension);
  const excludeQuery = `${query} -site:${excludedDomains.join(" -site:")}`;

  this.logger.log(
    `[SupplementarySearch] Query: "${excludeQuery}" (target: ${targetCount})`
  );

  // 使用 web-search 工具执行补充搜索
  const results = await this.searchWeb(excludeQuery, targetCount);

  // 再次过滤，确保不包含被排除的域名
  return results.filter(r => !excludedDomains.includes(r.domain || ""));
}
```

#### 3.2.3 集成到搜索流程

```typescript
// dimension-mission.service.ts: executeSearchPhase()

const searchResult = await this.dataSourceRouter.fetchDataForDimension(
  dimension,
  topic,
  { assignedTools }
);

// ★ 新增: 强制执行域名多样性
const diverseResults = await this.dataSourceRouter.enforceDomainDiversity(
  searchResult.items,
  dimension,
  topic
);

const enrichedResults = await this.dataEnrichment.enrichSearchResults(
  diverseResults, // ★ 使用多样性处理后的结果
  { ... }
);
```

---

### 改动3: 报告编辑器服务 (新增)

#### 3.3.1 服务职责

在各维度写作完成后、最终报告合成前，执行:

1. **语义级去重**: 识别跨维度的同义表述
2. **逻辑一致性检查**: 检测数据矛盾
3. **过渡生成**: 为维度间添加承上启下的衔接段落

#### 3.3.2 接口设计

```typescript
// report-editor.service.ts (新建文件)

import { Injectable, Logger } from "@nestjs/common";
import { AIEngineFacade } from "@/modules/ai-engine/facade";
import { AIModelType } from "@prisma/client";

interface EditedReport {
  content: string;
  deduplicatedSections: string[]; // 被合并/删除的章节标题
  addedTransitions: string[]; // 新增的过渡段落位置
  removedDuplicates: number; // 去重的段落数量
  conflicts: Array<{ // 检测到的矛盾
    description: string;
    location: string;
    resolution: string;
  }>;
}

@Injectable()
export class ReportEditorService {
  private readonly logger = new Logger(ReportEditorService.name);

  constructor(private readonly aiFacade: AIEngineFacade) {}

  /**
   * 编辑报告: 语义去重 + 一致性检查 + 过渡生成
   */
  async editReport(
    dimensionInputs: Array<{
      dimensionName: string;
      detailedContent: string;
      keyFindings: string[];
    }>,
    topic: ResearchTopic,
  ): Promise<EditedReport> {
    this.logger.log(`[ReportEditor] Editing report with ${dimensionInputs.length} dimensions`);

    // 1. 语义去重
    const dedupResult = await this.semanticDeduplication(dimensionInputs);

    // 2. 一致性检查 (复用已有的 consistency-check skill)
    const consistencyCheck = await this.checkConsistency(dimensionInputs, topic);

    // 3. 生成过渡段落
    const transitions = await this.generateTransitions(dedupResult.dimensions);

    // 4. 合成最终内容
    const finalContent = this.assembleEditedContent(
      dedupResult.dimensions,
      transitions
    );

    return {
      content: finalContent,
      deduplicatedSections: dedupResult.removedSections,
      addedTransitions: transitions.map(t => t.position),
      removedDuplicates: dedupResult.removedParagraphs,
      conflicts: consistencyCheck.conflicts,
    };
  }

  /**
   * 语义级去重 (核心方法)
   */
  private async semanticDeduplication(
    dimensions: Array<{ dimensionName: string; detailedContent: string }>
  ): Promise<{
    dimensions: Array<{ dimensionName: string; content: string }>;
    removedSections: string[];
    removedParagraphs: number;
  }> {
    const systemPrompt = `
你是研究报告编辑，负责跨维度内容去重。

**任务**:
1. 识别不同维度中表达相同观点的段落 (语义重复，非文本完全一致)
2. 保留表述最清晰、数据最完整的版本
3. 删除冗余表述

**输出格式**:
\`\`\`json
{
  "editedDimensions": [
    {
      "dimensionName": "技术趋势",
      "content": "...", // 去重后的内容
      "removedParagraphs": ["段落标识1", "段落标识2"]
    }
  ],
  "deduplicationLog": [
    {
      "originalDimensions": ["技术趋势", "市场分析"],
      "topic": "AI 芯片市场规模",
      "keptVersion": "市场分析",
      "reason": "包含更详细的数据来源"
    }
  ]
}
\`\`\`
    `;

    const userPrompt = `
请对以下维度内容进行语义去重:

${dimensions.map((d, i) => `
## 维度${i + 1}: ${d.dimensionName}

${d.detailedContent}

---
`).join('\n')}
    `;

    const response = await this.aiFacade.chat({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      modelType: AIModelType.CHAT,
      taskProfile: { creativity: "low", outputLength: "long" },
      maxTokens: 16000
    });

    const result = extractJsonFromAIResponse(response.content);

    return {
      dimensions: result.editedDimensions,
      removedSections: result.deduplicationLog.map(log =>
        `${log.originalDimensions.join(" & ")}: ${log.topic}`
      ),
      removedParagraphs: result.editedDimensions.reduce(
        (sum, d) => sum + (d.removedParagraphs?.length || 0),
        0
      )
    };
  }

  /**
   * 生成维度间过渡段落
   */
  private async generateTransitions(
    dimensions: Array<{ dimensionName: string; content: string }>
  ): Promise<Array<{ position: string; content: string }>> {
    const transitions: Array<{ position: string; content: string }> = [];

    for (let i = 0; i < dimensions.length - 1; i++) {
      const current = dimensions[i];
      const next = dimensions[i + 1];

      const transitionPrompt = `
请生成从「${current.dimensionName}」到「${next.dimensionName}」的过渡段落 (2-3 句话)。

当前章节末尾:
${current.content.split('\n\n').slice(-2).join('\n\n')}

下一章节开头:
${next.content.split('\n\n').slice(0, 2).join('\n\n')}

要求:
- 总结当前章节核心观点
- 自然引出下一章节主题
- 不超过 100 字
      `;

      const response = await this.aiFacade.chat({
        messages: [{ role: "user", content: transitionPrompt }],
        modelType: AIModelType.CHAT,
        taskProfile: { creativity: "medium", outputLength: "minimal" }
      });

      transitions.push({
        position: `between_${i}_and_${i + 1}`,
        content: response.content.trim()
      });
    }

    return transitions;
  }

  /**
   * 一致性检查 (复用现有 skill)
   */
  private async checkConsistency(...) {
    // 复用 report-synthesis.service.ts 中的 checkCrossDimensionConsistency 逻辑
    // 此处省略详细实现
  }

  /**
   * 组装编辑后的内容
   */
  private assembleEditedContent(
    dimensions: Array<{ dimensionName: string; content: string }>,
    transitions: Array<{ position: string; content: string }>
  ): string {
    const parts: string[] = [];

    for (let i = 0; i < dimensions.length; i++) {
      parts.push(`## ${i + 1}. ${dimensions[i].dimensionName}\n`);
      parts.push(dimensions[i].content);

      // 插入过渡段落
      const transition = transitions.find(t => t.position === `between_${i}_and_${i + 1}`);
      if (transition) {
        parts.push(`\n---\n\n**过渡**: ${transition.content}\n`);
      }

      parts.push("\n---\n");
    }

    return parts.join("\n");
  }
}
```

#### 3.3.3 集成到报告合成流程

```typescript
// report-synthesis.service.ts: synthesizeReport()

async synthesizeReport(
  topic: ResearchTopic,
  reportId: string,
): Promise<TopicReport> {
  // ... (前置代码: 获取 dimensionAnalyses 等)

  const dimensionInputs = this.prepareDimensionInputs(dimensionAnalyses);

  // ===== 阶段4.5: 报告编辑 (新增) =====
  this.logger.log("[ReportSynthesis] Starting editorial review...");

  const editedReport = await this.reportEditorService.editReport(
    dimensionInputs,
    topic
  );

  this.logger.log(
    `[ReportEditor] Deduplication: removed ${editedReport.removedDuplicates} paragraphs, ` +
    `added ${editedReport.addedTransitions.length} transitions, ` +
    `detected ${editedReport.conflicts.length} conflicts`
  );

  // ★ 使用编辑后的内容替代原始 dimensionInputs
  const editedDimensionInputs = this.applyEdits(dimensionInputs, editedReport);

  // ===== 阶段5: AI 生成补充内容 (执行摘要、前言等) =====
  const synthesisResult = await this.generateComprehensiveReport(
    topic,
    editedDimensionInputs, // ★ 使用编辑后的版本
    evidenceInputs
  );

  // ... (后续流程不变)
}
```

---

### 改动4: 写作质量 Prompt 增强

#### 3.4.1 修改位置

`backend/src/modules/ai-app/research/topic-research/prompts/section-writing.prompt.ts`

#### 3.4.2 增强内容

```typescript
export const SECTION_WRITING_SYSTEM_PROMPT = `
你是资深研究分析师，负责撰写研究报告的专业章节。

**核心要求**:
1. **独立分析判断**: 每个章节必须包含至少 1-2 个独立的分析性判断
   - ✅ 好例子: "从 A 公司的季度财报和 B 机构的预测对比可见，市场实际增速低于预期 10%，主要原因是..."
   - ❌ 坏例子: "根据报告显示，市场规模达 500 亿美元" (纯事实陈述)

2. **因果推理**: 不仅陈述现象，还要分析原因和影响
   - ✅ "技术成熟度提升 → 成本下降 30% → 中小企业采用率提高"
   - ❌ "技术成熟度提升了" (孤立陈述)

3. **证据综合**: 引用多个证据时，必须说明它们之间的关系 (支持/矛盾/补充)
   - ✅ "证据[1]和[2]均指向增长趋势,但[3]提示存在区域差异"
   - ❌ "[1][2][3]显示市场增长" (机械堆砌)

4. **禁止纯摘要**: 章节中至少 60% 的内容应是分析性语句，而非证据摘要
   - 分析性语句示例: "这意味着..."、"从中可推断..."、"对比显示..."

**输出格式**:
- 使用 Markdown
- 数据必须标注来源 [引用编号]
- 每个分析判断后用 *💡 分析* 标记

**质量检查点** (自检清单):
- [ ] 是否包含至少 1 个独立分析判断？
- [ ] 是否解释了关键数据的因果关系？
- [ ] 是否综合了多个证据而非简单堆砌？
- [ ] 是否避免了泛泛而谈 (如"发展迅速"、"前景广阔")？
`;

// ★ 在用户 Prompt 中增加分析示例

export function renderSectionWritingPrompt(
  section: SectionPlan,
  evidenceData: EvidenceData[],
  previousSections: Array<{ title: string; content: string }>,
): string {
  return `
... (现有 Prompt 内容)

**分析示例**:
假设证据[1]显示"AI 投资 2025 年达 500 亿美元"，证据[2]显示"2024 年为 300 亿美元"，你应写:

"AI 领域投资规模从 2024 年的 300 亿美元增长至 2025 年的 500 亿美元[1][2]，年增长率达 67%。*💡 分析*: 这一增速显著高于同期科技行业平均水平 (25%)，反映出资本市场对生成式 AI 商业化前景的强烈信心。然而，需注意增长主要集中在大型语言模型领域，垂直行业应用投资仍相对谨慎。"

而不是:
"根据报告[1][2]，AI 投资规模达 500 亿美元。"
  `;
}
```

---

### 改动5: 审核标准强化

#### 3.5.1 修改位置

`backend/src/modules/ai-app/research/topic-research/prompts/section-review.prompt.ts`

#### 3.5.2 增强评分标准

```typescript
export const SECTION_REVIEW_PROMPT = `
你是质量审核员，负责评估章节内容质量。

**评分维度** (总分 100):

1. **分析深度** (40 分) ★ 新增/加权
   - 包含独立分析判断 (10 分)
   - 解释因果关系 (10 分)
   - 综合多个证据 (10 分)
   - 避免泛泛而谈 (10 分)

   **扣分项**:
   - 缺少分析判断 (-20 分)
   - 仅堆砌证据摘要 (-15 分)
   - 使用"前景广阔"等空洞表述 (-10 分)

2. **内容准确性** (30 分)
   - 数据引用准确 (10 分)
   - 证据支持充分 (10 分)
   - 无逻辑矛盾 (10 分)

3. **结构清晰性** (20 分)
   - 章节组织合理 (10 分)
   - 过渡自然流畅 (10 分)

4. **原创性** (10 分) ★ 新增
   - 是否提供独特见解 (10 分)
   - 与前置章节的差异化 (加分项)

**通过标准**: ≥ 75 分

**输出格式**:
\`\`\`json
{
  "approved": false,
  "score": 65,
  "breakdown": {
    "analysisDepth": 20,  // ★ 检测到缺少分析判断
    "accuracy": 28,
    "structure": 17,
    "originality": 0
  },
  "feedback": "章节主要问题: 内容以证据摘要为主，缺少独立分析。建议在以下位置添加分析判断: ...",
  "revisionInstructions": "1. 在'市场规模'段落后增加原因分析 2. 比较证据[3]和[5]的差异并解释..."
}
\`\`\`
`;
```

#### 3.5.3 审核逻辑增强

```typescript
// research-reviewer.service.ts (或新建审核服务)

/**
 * 检测章节是否包含分析性判断 (新增辅助方法)
 */
private detectAnalyticalStatements(content: string): {
  count: number;
  statements: string[];
} {
  const analyticalMarkers = [
    /从.*可.*见/, // "从数据对比可见"
    /这.*意味着/, // "这意味着市场..."
    /推断.*/, // "可推断出..."
    /对比.*显示/, // "对比显示..."
    /.*原因.*是/, // "主要原因是..."
    /.*导致.*/, // "政策变化导致..."
    /基于.*分析/, // "基于上述分析"
  ];

  const sentences = content.split(/[。！？\n]/);
  const analyticalStatements = sentences.filter(s =>
    analyticalMarkers.some(marker => marker.test(s))
  );

  return {
    count: analyticalStatements.length,
    statements: analyticalStatements.slice(0, 3) // 返回前 3 个示例
  };
}

/**
 * 计算证据摘要占比 (新增辅助方法)
 */
private calculateEvidenceSummaryRatio(content: string): number {
  const totalChars = content.length;

  // 匹配引用密集段落 (连续引用 [N][M]...)
  const citationDensePattern = /([^。]{10,100}(\[\d+\]){2,}[^。]{0,50}[。])/g;
  const citationDenseSentences = content.match(citationDensePattern) || [];
  const citationChars = citationDenseSentences.reduce((sum, s) => sum + s.length, 0);

  return totalChars > 0 ? citationChars / totalChars : 0;
}

/**
 * 增强的章节审核 (修改现有方法)
 */
async reviewSectionOutput(
  section: SectionPlan,
  content: string,
  revisionCount: number,
): Promise<ReviewResult> {
  // ★ 新增: 预检查分析性内容
  const analyticalCheck = this.detectAnalyticalStatements(content);
  const evidenceRatio = this.calculateEvidenceSummaryRatio(content);

  // ★ 如果分析性判断不足或证据摘要占比过高，直接降低评分
  let penaltyHints = "";
  if (analyticalCheck.count < 2) {
    penaltyHints += `- 章节缺少分析性判断 (检测到 ${analyticalCheck.count} 个，要求至少 2 个)\n`;
  }
  if (evidenceRatio > 0.5) {
    penaltyHints += `- 证据摘要占比过高 (${(evidenceRatio * 100).toFixed(0)}%，建议不超过 40%)\n`;
  }

  // ★ 在审核 Prompt 中注入预检查结果
  const enhancedPrompt = SECTION_REVIEW_PROMPT + `

**预检查结果**:
${penaltyHints || "- 预检查通过"}

分析性语句示例:
${analyticalCheck.statements.join('\n')}
  `;

  const response = await this.aiFacade.chat({
    messages: [
      { role: "system", content: enhancedPrompt },
      { role: "user", content: `章节标题: ${section.title}\n\n${content}` }
    ],
    modelType: AIModelType.CHAT,
    taskProfile: { creativity: "low", outputLength: "short" }
  });

  const result = extractJsonFromAIResponse<ReviewResult>(response.content);

  // ★ 记录详细评分
  this.logger.log(
    `[SectionReview] "${section.title}" score: ${result.score}/100 ` +
    `(analysis: ${result.breakdown.analysisDepth}, originality: ${result.breakdown.originality})`
  );

  return result;
}
```

---

## 4. 数据流图

### 4.1 完整流程

```
TopicTeamOrchestratorService.executeRefresh()
│
├─ 阶段1: 并行搜索 (5-25%)
│   ├─ DimensionMissionService.executeSearchPhase() × N 维度
│   │   ├─ DataSourceRouter.fetchDataForDimension()
│   │   │   ├─ 并行调用数据源 (web/academic/github/...)
│   │   │   ├─ aggregateResults() - URL 去重 + 排序
│   │   │   └─ enforceDomainDiversity() [NEW] - 域名分布检查
│   │   │       ├─ 检测超标域名 (>30%)
│   │   │       ├─ 截断多余结果
│   │   │       └─ supplementarySearch() - 补充搜索
│   │   └─ DataEnrichmentService.enrichSearchResults()
│   │       └─ 抓取完整内容 + 提取图表
│   └─ 返回: SearchPhaseResult[]
│
├─ 阶段2: 全局大纲协调 (25-40%)
│   └─ ResearchLeaderService.planGlobalOutline() [NEW]
│       ├─ 输入: 所有维度的证据摘要
│       ├─ LLM 调用: 统筹规划跨维度大纲
│       │   ├─ 识别跨维度通用主题 (如"市场规模")
│       │   ├─ 分配主题归属 (避免重复)
│       │   └─ 生成去重指令
│       └─ 输出: GlobalOutline
│           ├─ dimensions[].outline (协调后的章节大纲)
│           └─ deduplicationRules (显式去重规则)
│
├─ 阶段3: 并行写作 (40-70%)
│   └─ DimensionMissionService.executeWritingPhase() × N 维度
│       ├─ 输入: coordinatedOutline (全局协调后的大纲)
│       ├─ writeSectionsWithReview()
│       │   ├─ SectionWriter.writeSection() - 使用增强 Prompt [改动4]
│       │   │   └─ 要求: 分析性判断 + 因果推理
│       │   └─ ReviewWorkflow.reviewSection() - 强化评分 [改动5]
│       │       ├─ detectAnalyticalStatements() [NEW]
│       │       ├─ calculateEvidenceSummaryRatio() [NEW]
│       │       └─ 评分: 分析深度 40% + 原创性 10%
│       └─ integrateDimensionResults()
│
├─ 阶段4: 质量审核 (70-85%)
│   └─ ResearchReviewerService.reviewOverall()
│       └─ (现有流程,无变更)
│
├─ 阶段5: 报告编辑 (85-90%) [NEW]
│   └─ ReportEditorService.editReport() [改动3]
│       ├─ semanticDeduplication()
│       │   ├─ LLM 调用: 识别语义重复
│       │   └─ 保留最优版本,删除冗余
│       ├─ checkConsistency()
│       │   └─ 检测跨维度数据矛盾
│       └─ generateTransitions()
│           └─ 生成维度间过渡段落
│
└─ 阶段6: 报告合成 (90-100%)
    └─ ReportSynthesisService.synthesizeReport()
        ├─ 使用编辑后的维度内容
        ├─ AI 生成补充内容 (执行摘要/前言/跨维度分析)
        └─ buildFullReportFromDimensions()
            └─ 拼接完整报告
```

### 4.2 关键数据结构流转

```typescript
// 阶段1输出 → 阶段2输入
SearchPhaseResult {
  dimensionId: string;
  evidenceSummary: string; // ★ 传给 planGlobalOutline
  enrichedResults: EnrichedResult[];
  // ...
}

// 阶段2输出 → 阶段3输入
GlobalOutline {
  dimensions: Array<{
    dimensionId: string;
    outline: DimensionOutline; // ★ 协调后的大纲
    crossDimensionNotes: string; // ★ 去重指令
  }>;
  deduplicationRules: string[]; // ★ 全局去重规则
}

// 阶段3输出 → 阶段5输入
DimensionMissionResult {
  dimensionId: string;
  analysisResult: DimensionAnalysisResult;
  // ...
}

// 阶段5输出 → 阶段6输入
EditedReport {
  content: string; // ★ 去重后的维度内容
  deduplicatedSections: string[];
  conflicts: Array<{ description, resolution }>;
}
```

---

## 5. 接口定义完整清单

### 5.1 新增接口

```typescript
// ==================== dimension-mission.service.ts ====================

/**
 * 搜索阶段结果
 */
interface SearchPhaseResult {
  dimensionId: string;
  enrichedResults: EnrichedResult[];
  evidenceData: EnrichedEvidenceData[];
  evidenceSummary: string;
  searchResultsRecord: SearchResultsRecord;
  temporalContext: TemporalContext;
}

// ==================== research-leader.service.ts ====================

/**
 * 全局大纲 (跨维度协调)
 */
interface GlobalOutline {
  dimensions: Array<{
    dimensionId: string;
    dimensionName: string;
    outline: DimensionOutline; // 复用现有类型
    crossDimensionNotes: string; // "避免与维度X重复Y主题"
  }>;
  globalThemes: string[]; // 跨维度通用主题
  deduplicationRules: string[]; // 显式去重规则 (如"市场规模数据统一在维度A")
}

// ==================== report-editor.service.ts ====================

/**
 * 编辑后的报告
 */
interface EditedReport {
  content: string; // 去重后的完整内容
  deduplicatedSections: string[]; // 被合并/删除的章节标题
  addedTransitions: string[]; // 新增过渡段落的位置
  removedDuplicates: number; // 去重的段落数量
  conflicts: Array<{
    description: string; // 冲突描述
    location: string; // 位置 (维度+章节)
    resolution: string; // 解决方式
  }>;
}

/**
 * 过渡段落
 */
interface Transition {
  position: string; // "between_0_and_1" (维度索引)
  content: string; // 过渡段落内容 (2-3 句话)
}
```

### 5.2 修改的现有接口

```typescript
// ==================== dimension-mission.service.ts ====================

// ★ 新增方法
async executeSearchPhase(
  topic: ResearchTopic,
  dimension: TopicDimension,
  assignedTools?: string[],
): Promise<SearchPhaseResult>;

async executeWritingPhase(
  topic: ResearchTopic,
  dimension: TopicDimension,
  searchPhaseResult: SearchPhaseResult,
  coordinatedOutline: DimensionOutline, // ★ 全局协调后的大纲
  reportId?: string,
): Promise<DimensionMissionResult>;

// ==================== data-source-router.service.ts ====================

// ★ 新增方法
private async enforceDomainDiversity(
  results: DataSourceResult[],
  dimension: TopicDimension,
  topic: ResearchTopic,
  maxDomainRatio?: number,
): Promise<DataSourceResult[]>;

private async supplementarySearch(
  dimension: TopicDimension,
  topic: ResearchTopic,
  excludedDomains: string[],
  targetCount: number,
): Promise<DataSourceResult[]>;

// ==================== research-leader.service.ts ====================

// ★ 新增方法
async planGlobalOutline(
  topic: ResearchTopic,
  dimensions: Array<{
    dimensionId: string;
    dimensionName: string;
    evidenceSummary: string;
  }>,
): Promise<GlobalOutline>;

// ==================== research-reviewer.service.ts ====================

// ★ 新增辅助方法
private detectAnalyticalStatements(content: string): {
  count: number;
  statements: string[];
};

private calculateEvidenceSummaryRatio(content: string): number;
```

---

## 6. 风险评估与缓解

### 风险1: 全局大纲 LLM 调用失败

**场景**: 当维度数量过多 (>8 个) 时，所有维度的证据摘要可能超出 LLM 上下文窗口。

**影响**:

- `planGlobalOutline()` 调用超时或返回不完整结果
- 维度间协调失效，回退到独立规划模式

**缓解措施**:

```typescript
// research-leader.service.ts: planGlobalOutline()

async planGlobalOutline(...) {
  // ★ 策略1: 截断证据摘要至固定长度
  const MAX_SUMMARY_LENGTH = 200; // 每个维度最多 200 字符
  const truncatedDimensions = dimensions.map(d => ({
    ...d,
    evidenceSummary: d.evidenceSummary.slice(0, MAX_SUMMARY_LENGTH) +
      (d.evidenceSummary.length > MAX_SUMMARY_LENGTH ? '...' : '')
  }));

  // ★ 策略2: 分批规划 (若维度数 > 6)
  if (dimensions.length > 6) {
    this.logger.warn(
      `[planGlobalOutline] Large dimension count (${dimensions.length}), using batch planning`
    );
    return this.batchPlanGlobalOutline(truncatedDimensions);
  }

  // ★ 策略3: 回退机制 (规划失败时使用独立大纲)
  try {
    return await this.callLLMForGlobalOutline(truncatedDimensions);
  } catch (error) {
    this.logger.error(`[planGlobalOutline] Failed, falling back to independent planning: ${error}`);
    return this.fallbackToIndependentPlanning(truncatedDimensions);
  }
}

/**
 * 分批规划 (每批最多 4 个维度)
 */
private async batchPlanGlobalOutline(
  dimensions: Array<...>
): Promise<GlobalOutline> {
  const batches = chunk(dimensions, 4); // 每批 4 个
  const batchOutlines: GlobalOutline[] = [];

  for (const batch of batches) {
    const outline = await this.callLLMForGlobalOutline(batch);
    batchOutlines.push(outline);
  }

  // 合并各批次的大纲
  return this.mergeGlobalOutlines(batchOutlines);
}
```

**预期效果**: 即使在 8-10 个维度的极端场景下，仍能生成协调后的大纲。

---

### 风险2: 搜索阶段内存占用过高

**场景**: 所有维度的搜索结果 + 增强内容同时保存在内存中。

**量化**:

- 单维度增强结果: ~5MB (25 条 × 200KB)
- 8 个维度: ~40MB
- 峰值内存: 可能达 100MB+ (含临时变量)

**影响**: Node.js 进程可能触发 GC 频繁或 OOM。

**缓解措施**:

```typescript
// topic-team-orchestrator.service.ts: executeRefresh()

// ★ 策略1: 只保留摘要，释放完整内容
const searchResults = await Promise.allSettled(
  dimensions.map(dim => this.dimensionMissionService.executeSearchPhase(...))
);

// ★ 提取轻量级摘要用于全局规划
const dimensionEvidences = searchResults
  .filter(r => r.status === "fulfilled")
  .map(r => ({
    dimensionId: r.value.dimensionId,
    dimensionName: dimensions.find(d => d.id === r.value.dimensionId).name,
    evidenceSummary: r.value.evidenceSummary, // ★ 仅保留摘要
    // ★ 释放 enrichedResults 和 evidenceData (在规划阶段不需要)
  }));

// ★ 策略2: 写作阶段按需重新加载完整内容
const writingResults = await Promise.allSettled(
  dimensions.map((dim, idx) => {
    const searchResult = searchResults[idx].status === "fulfilled"
      ? searchResults[idx].value
      : null;
    // ★ 此时 searchResult 包含完整的 evidenceData
    return this.dimensionMissionService.executeWritingPhase(...);
  })
);
```

**预期效果**: 全局规划阶段内存占用降低 60-70%。

---

### 风险3: refreshSingleDimension() 需要适配

**场景**: 用户手动刷新单个维度时，无法进行全局大纲协调。

**影响**: 单维度刷新后的内容可能与其他维度重复。

**缓解措施**:

```typescript
// topic-team-orchestrator.service.ts: refreshSingleDimension()

async refreshSingleDimension(
  topic: ResearchTopic,
  dimensionId: string,
): Promise<DimensionAnalysisResult> {
  const dimension = await this.prisma.topicDimension.findUnique(...);

  // ★ 策略1: 获取其他维度的最新大纲 (如果存在)
  const otherDimensions = await this.getExistingDimensionOutlines(topic.id, dimensionId);

  // ★ 执行搜索阶段
  const searchResult = await this.dimensionMissionService.executeSearchPhase(...);

  // ★ 策略2: 调用简化版的全局规划 (仅当前维度 + 其他维度摘要)
  let coordinatedOutline: DimensionOutline;

  if (otherDimensions.length > 0) {
    const globalOutline = await this.leaderService.planGlobalOutline(
      topic,
      [
        { dimensionId, dimensionName: dimension.name, evidenceSummary: searchResult.evidenceSummary },
        ...otherDimensions.map(d => ({
          dimensionId: d.id,
          dimensionName: d.name,
          evidenceSummary: d.summary || '' // 使用已有的摘要
        }))
      ]
    );
    coordinatedOutline = globalOutline.dimensions.find(d => d.dimensionId === dimensionId).outline;
  } else {
    // 回退: 独立规划
    coordinatedOutline = await this.leaderService.planDimensionOutline(...);
  }

  // ★ 执行写作阶段
  const writingResult = await this.dimensionMissionService.executeWritingPhase(
    topic,
    dimension,
    searchResult,
    coordinatedOutline
  );

  return writingResult.analysisResult;
}
```

**预期效果**: 单维度刷新仍能享受部分全局协调的去重效果。

---

### 风险4: 执行时间增加

**场景**: 新增全局规划和编辑阶段，总执行时间可能增加 20-30%。

**量化**:

- 现有流程: ~3-5 分钟 (4 维度)
- 新流程预计: ~4-6.5 分钟

**影响**: 用户等待时间延长，可能影响体验。

**缓解措施**:

1. **并行优化**: 搜索阶段和数据增强仍保持并行
2. **缓存机制**: 全局大纲可缓存 (同一主题+维度组合)
3. **进度提示**: 细化进度事件，让用户感知每个阶段

**接受标准**:

- 如果报告质量提升显著 (重复率降低 50%+)，20-30% 的时间增加是可接受的
- 可在用户设置中提供「快速模式」(跳过编辑阶段) 和「高质量模式」选项

---

## 7. 实施顺序与里程碑

### 阶段1: 设计文档与接口定义 (本文档)

**产出**:

- ✅ 技术设计文档 (当前文档)
- ✅ 接口定义 (Section 5)
- ✅ 数据流图 (Section 4)

**验收**: 架构设计评审通过

---

### 阶段2: 编排器重构 (改动1) - 最高风险，优先实施

**任务清单**:

- [ ] `DimensionMissionService.executeSearchPhase()` 实现
- [ ] `DimensionMissionService.executeWritingPhase()` 实现
- [ ] `ResearchLeaderService.planGlobalOutline()` 实现
- [ ] `TopicTeamOrchestratorService.executeRefresh()` 重构
- [ ] `refreshSingleDimension()` 适配
- [ ] 单元测试 (模拟 LLM 响应)

**验收标准**:

- 能生成 `GlobalOutline` 对象
- 各维度的 `outline.sections` 不存在明显的主题重复
- 现有功能回归测试通过

**预估时间**: 3-4 天

---

### 阶段3: 域名多样性强制执行 (改动2)

**任务清单**:

- [ ] `DataSourceRouter.enforceDomainDiversity()` 实现
- [ ] `supplementarySearch()` 实现
- [ ] 集成到 `executeSearchPhase()` 流程
- [ ] 日志记录 (域名分布统计)
- [ ] 单元测试 (模拟域名集中场景)

**验收标准**:

- 搜索结果中任一域名占比 ≤ 35% (允许 5% 误差)
- 触发补充搜索时,日志记录清晰

**预估时间**: 1-2 天

---

### 阶段4: 报告编辑器服务 (改动3)

**任务清单**:

- [ ] `ReportEditorService` 类骨架
- [ ] `semanticDeduplication()` 实现
- [ ] `generateTransitions()` 实现
- [ ] 集成到 `ReportSynthesisService.synthesizeReport()`
- [ ] Prompt 调优 (语义去重准确率 > 85%)
- [ ] 单元测试 (模拟重复内容场景)

**验收标准**:

- 能检测出至少 80% 的语义重复段落
- 生成的过渡段落自然流畅 (人工评审)
- 编辑后的报告字数减少 10-15%

**预估时间**: 2-3 天

---

### 阶段5: Prompt 增强 (改动4 + 改动5)

**任务清单**:

- [ ] 写作 Prompt 增强 (`section-writing.prompt.ts`)
- [ ] 审核 Prompt 增强 (`section-review.prompt.ts`)
- [ ] `detectAnalyticalStatements()` 实现
- [ ] `calculateEvidenceSummaryRatio()` 实现
- [ ] 审核逻辑集成
- [ ] A/B 测试 (对比改动前后的报告质量)

**验收标准**:

- 新 Prompt 生成的章节中,分析性判断占比 > 40%
- 审核评分分布合理 (平均分 70-80,标准差 10-15)
- 拒绝率 (< 75 分) 约 20-30%

**预估时间**: 1.5-2 天

---

### 阶段6: 类型检查与全链路验证

**任务清单**:

- [ ] 类型检查通过 (`npm run type-check`)
- [ ] 集成测试 (完整的 `executeRefresh()` 流程)
- [ ] 性能测试 (执行时间 vs 现有流程)
- [ ] 错误处理完善 (各阶段失败回退)
- [ ] 日志和监控埋点

**验收标准**:

- 无 TypeScript 错误
- 4 维度研究完整执行时间 < 7 分钟
- 关键指标埋点完整 (搜索耗时/LLM 调用次数/去重段落数)

**预估时间**: 1 天

---

### 总时间估算

- 阶段2: 3-4 天
- 阶段3: 1-2 天
- 阶段4: 2-3 天
- 阶段5: 1.5-2 天
- 阶段6: 1 天
- **总计**: 8.5-12 天 (约 2 个开发周)

---

## 8. 成功指标

### 定量指标

| 指标                  | 当前值  | 目标值  | 测量方法                         |
| --------------------- | ------- | ------- | -------------------------------- |
| 跨维度章节标题重复率  | 35-40%  | < 15%   | 人工标注 + 相似度算法            |
| 证据引用重叠率        | 25-30%  | < 10%   | 统计同一证据被多个维度引用的次数 |
| 域名集中度 (最大占比) | 60%+    | < 35%   | 统计搜索结果中单一域名占比       |
| 分析性判断占比        | < 20%   | > 40%   | `detectAnalyticalStatements()`   |
| 审核通过率            | 85-90%  | 70-75%  | (严格评分后预期下降)             |
| 报告生成时间 (4维度)  | 3-5 min | < 7 min | 计时器                           |

### 定性指标

- **内容深度**: 报告应包含独立分析判断,而非仅堆砌证据摘要
- **逻辑一致性**: 跨维度数据无明显矛盾
- **可读性**: 维度间过渡自然,无突兀感

### 验收方式

1. **A/B 测试**: 选择 5 个典型主题,对比改动前后的报告质量
2. **用户反馈**: 邀请 3-5 名内部用户试用,收集满意度评分
3. **代码审查**: 架构合理性、错误处理完整性

---

## 9. 后续优化方向

### 9.1 智能维度合并

**场景**: 若检测到两个维度的研究方向高度重合 (相似度 > 80%),自动建议合并。

**实现思路**:

```typescript
// research-leader.service.ts: planGlobalOutline()

// 在规划前检测维度相似度
const similarityMatrix = this.calculateDimensionSimilarity(dimensions);

if (similarityMatrix.some((s) => s.similarity > 0.8)) {
  this.logger.warn(`Detected highly similar dimensions, suggesting merge`);
  // 返回合并建议,由用户确认
}
```

### 9.2 外部数据库集成

**场景**: 自动从权威数据库 (如 Statista, Gartner) 获取市场数据,减少对搜索引擎的依赖。

**工具**: 扩展 `DataSourceRouter` 支持 API 型数据源。

### 9.3 报告模板系统

**场景**: 针对不同行业/研究类型,预定义报告结构模板 (如「市场研究」vs「技术评估」)。

**实现**: 在 `planGlobalOutline()` 前注入模板约束。

---

## 10. 附录

### 附录A: 关键代码位置速查

| 组件        | 文件路径                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------ |
| 编排器      | `backend/src/modules/ai-app/research/topic-research/services/topic-team-orchestrator.service.ts` |
| 维度任务    | `backend/src/modules/ai-app/research/topic-research/services/dimension-mission.service.ts`       |
| 数据源路由  | `backend/src/modules/ai-app/research/topic-research/services/data-source-router.service.ts`      |
| 研究 Leader | `backend/src/modules/ai-app/research/topic-research/services/research-leader.service.ts`         |
| 报告合成    | `backend/src/modules/ai-app/research/topic-research/services/report-synthesis.service.ts`        |
| 章节写作器  | `backend/src/modules/ai-app/research/topic-research/services/section-writer.service.ts`          |
| 审核工作流  | `backend/src/modules/ai-app/research/topic-research/services/review-workflow.service.ts`         |
| 写作 Prompt | `backend/src/modules/ai-app/research/topic-research/prompts/section-writing.prompt.ts`           |
| 审核 Prompt | `backend/src/modules/ai-app/research/topic-research/prompts/section-review.prompt.ts`            |

### 附录B: 相关文档

- [AI 调用规范](D:\projects\codes\genesis-ai\docs\guides\ai-calling-standards.md)
- [一致性检查 Skill](D:\projects\codes\genesis-ai\skills\consistency-check.skill.md)
- [项目规范总览](D:\projects\codes\genesis-ai\standards\00-overview.md)

---

**文档结束**
