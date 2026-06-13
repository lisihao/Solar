# Topic Research 数据能力系统优化方案

> 版本: 1.0 (已实施)
> 更新日期: 2025-01-19
> 状态: 已实施 Phase 1-3

## 一、问题诊断

### 1.1 核心问题

Topic Research 生成的内容大量使用 LLM 训练数据中的旧信息，而非实时搜索的最新数据。

### 1.2 根因分析

```
优化前的数据流（问题链路）:
┌────────────────────────────────────────────────────────────────┐
│ DataSourceRouter.fetchDataForDimension()                       │
│   └─ SearchService.search() ✅ 确实调用了                      │
│      └─ 返回 10 条结果（每条只有 snippet: 100-300字）          │
│                                                                 │
│ DimensionMissionService                                         │
│   └─ prepareEvidenceData() → 只提取 title + url + snippet     │
│   └─ createEvidenceSummary() → 10条标题的简要列表              │
│                                                                 │
│ SectionWriter.writeSection()                                   │
│   └─ formatEvidenceForPrompt()                                 │
│      └─ LLM 收到: 标题 + 域名 + snippet (总计 1000-3000字)    │
│                                                                 │
│ LLM 生成内容                                                    │
│   └─ 被要求写 2000-4000 字报告                                 │
│   └─ ❌ 被迫用训练数据"编造"内容 → 旧数据!                    │
└────────────────────────────────────────────────────────────────┘
```

### 1.3 核心缺陷

| 问题                | 影响                            | 严重程度 |
| ------------------- | ------------------------------- | -------- |
| snippet 内容不足    | LLM 只有 300 字参考，被迫"编造" | 高       |
| 无时间戳增强        | 搜索结果可能包含旧数据          | 高       |
| Leader 不知当前日期 | 无法评估数据时效性              | 高       |
| 无 URL 验证         | 引用链接可能失效                | 中       |
| Leader 无工具能力   | 无法主动获取最新信息            | 中       |

---

## 二、优化目标

### 2.1 核心目标

**让 Topic Research 的 Agent 具备主动获取最新、最全数据的能力**

### 2.2 具体指标

| 指标            | 优化前           | 优化后                |
| --------------- | ---------------- | --------------------- |
| 证据内容长度    | 300 字 (snippet) | 3000 字 (fullContent) |
| 搜索结果时效性  | 无限制           | 默认最近 6 个月       |
| 时间上下文      | 无               | 当前日期 + 时效性要求 |
| URL 验证        | 无               | 有效性检查            |
| Leader 工具能力 | 无               | 主动搜索能力          |

---

## 三、实施方案

### 3.1 优化后的数据流

```
优化后的数据流:
┌─────────────────────────────────────────────────────────────────────┐
│ DataSourceRouter.fetchDataForDimension()                            │
│   └─ buildSearchQuery() ← ★ 时间戳增强 (添加年份+时效关键词)       │
│   └─ SearchService.search(query, 15, since) ← ★ 默认6个月过滤      │
│      └─ 返回 15 条结果                                              │
│                                                                      │
│ DimensionMissionService                                              │
│   └─ DataEnrichmentService.enrichSearchResults() ← ★ 新增          │
│      └─ 并行抓取 Top 5 的完整网页内容 (3000字)                      │
│      └─ URL 验证 + 内容有效性检查                                   │
│   └─ LeaderToolService.generateEnhancedPlanningContext() ← ★ 新增  │
│      └─ Leader 主动搜索获取最新上下文                               │
│   └─ prepareEnrichedEvidenceData() ← ★ 包含 fullContent            │
│                                                                      │
│ SectionWriter.writeSection()                                        │
│   └─ formatEvidenceForPrompt() ← ★ 支持完整内容                    │
│      └─ LLM 收到: 完整内容 (15000-20000字) + 时间上下文            │
│   └─ temporalContext ← ★ 当前日期 + 时效性要求                     │
│                                                                      │
│ LLM 生成内容                                                         │
│   └─ ✅ 基于真实最新数据生成报告                                    │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 新增组件

#### 3.2.1 DataEnrichmentService

**位置**: `backend/src/modules/ai-app/research/topic-research/services/data-enrichment.service.ts`

**核心功能**:

```typescript
// 增强搜索结果：抓取完整网页内容
async enrichSearchResults(
  results: DataSourceResult[],
  options: { topN?: number; maxContentLength?: number }
): Promise<EnrichedResult[]>

// URL 有效性验证
async validateUrls(urls: string[], timeout?: number): Promise<UrlValidationResult[]>

// 过滤无效 URL 的结果
async filterValidResults(results: DataSourceResult[]): Promise<DataSourceResult[]>
```

**设计决策**:

- 只增强 Top 5 结果，平衡质量和性能
- 并行抓取，超时 10 秒
- 失败时降级到 snippet，不影响流程

#### 3.2.2 LeaderToolService

**位置**: `backend/src/modules/ai-app/research/topic-research/services/leader-tool.service.ts`

**核心功能**:

```typescript
// Leader 主动搜索获取最新数据
async searchLatestData(
  context: LeaderSearchContext,
  queries?: string[]
): Promise<LeaderSearchResult[]>

// 生成增强的规划上下文
async generateEnhancedPlanningContext(
  context: LeaderSearchContext
): Promise<EnhancedPlanningContext>
```

**设计决策**:

- Leader 可以自己生成搜索查询
- 搜索结果自动添加时间戳增强
- 生成上下文摘要供规划使用

### 3.3 修改组件

#### 3.3.1 DataSourceRouterService 增强

**文件**: `backend/src/modules/ai-app/research/topic-research/services/data-source-router.service.ts`

**变更**:

```typescript
// 搜索查询时间戳增强
private buildSearchQuery(topic, dimension): string {
  const baseQuery = ...;
  // ★ 新增：添加当前年份和时效性关键词
  return this.enhanceQueryWithTimestamp(baseQuery, dimension);
}

// 根据维度类型选择时效性关键词
private getFreshnessKeywords(dimension): string {
  // 政策类 → "latest policy regulation"
  // 市场类 → "market report forecast"
  // 技术类 → "emerging breakthrough latest"
  // 默认 → "latest recent"
}

// 默认时间过滤
const defaultSince = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000); // 6个月
const since = userConfiguredSince || defaultSince;
```

#### 3.3.2 Prompt 模板增强

**文件**: `backend/src/modules/ai-app/research/topic-research/prompts/dimension-research.prompt.ts`

**变更**:

```typescript
// 新增时间上下文
## 时间上下文
- **当前日期**: {{currentDate}}
- **时效性要求**: {{freshnessRequirement}}
- **重要**: 请基于提供的证据撰写，不要使用你训练数据中的旧信息

// 证据格式化支持完整内容
function formatEvidenceForPrompt(evidence) {
  const content = e.fullContent || e.snippet;  // ★ 优先完整内容
  const contentLabel = e.contentSource === "fetched" ? "完整内容" : "内容摘要";
  const freshnessLabel = getDateFreshnessLabel(e.publishedAt);  // ★ 时效性标签
  // ...
}

// 时效性要求描述
function getFreshnessRequirementDescription(searchTimeRange) {
  switch (searchTimeRange) {
    case "6months": return "优先引用最近 6 个月内的数据...";
    case "1year": return "优先引用最近 1 年内的数据...";
    // ...
  }
}
```

#### 3.3.3 DimensionMissionService 集成

**文件**: `backend/src/modules/ai-app/research/topic-research/services/dimension-mission.service.ts`

**变更**:

```typescript
// 注入新服务
constructor(
  // ... 原有服务
  private readonly dataEnrichment: DataEnrichmentService,
  private readonly leaderTool: LeaderToolService,
) {}

// 执行流程增强
async executeDimensionMission(...) {
  // 1. 搜索
  const searchResult = await this.dataSourceRouter.fetchDataForDimension(...);

  // 2. ★ 新增：数据增强
  const enrichedResults = await this.dataEnrichment.enrichSearchResults(
    searchResult.items,
    { topN: 5, maxContentLength: 3000 }
  );

  // 3. ★ 新增：生成时间上下文
  const temporalContext = {
    currentDate: getCurrentDateString(),
    freshnessRequirement: getFreshnessRequirementDescription(searchTimeRange),
  };

  // 4. ★ 新增：Leader 主动获取额外上下文
  const leaderContext = await this.leaderTool.generateEnhancedPlanningContext(...);

  // 5. 准备证据（使用增强数据）
  const evidenceData = this.prepareEnrichedEvidenceData(enrichedResults);

  // ... 后续流程
}
```

---

## 四、类型定义

### 4.1 新增类型

```typescript
// 增强后的搜索结果
interface EnrichedResult extends DataSourceResult {
  fullContent: string | null; // 完整网页内容（最多 3000 字）
  contentSource: "fetched" | "snippet"; // 内容来源
}

// 增强后的证据数据
interface EnrichedEvidenceData extends EvidenceData {
  fullContent?: string | null;
  contentSource?: "fetched" | "snippet";
}

// URL 验证结果
interface UrlValidationResult {
  url: string;
  isValid: boolean;
  statusCode?: number;
  errorReason?: string;
  hasContent: boolean; // 内容是否有意义
}

// 时间上下文
interface TemporalContext {
  currentDate: string; // "2025年1月19日"
  freshnessRequirement: string; // 时效性要求描述
}

// Leader 搜索上下文
interface LeaderSearchContext {
  topicName: string;
  topicDescription?: string;
  dimensionName: string;
  searchTimeRange?: string;
}
```

---

## 五、配置说明

### 5.1 数据增强配置

| 参数             | 默认值 | 说明                 |
| ---------------- | ------ | -------------------- |
| topN             | 5      | 增强的结果数量       |
| maxContentLength | 3000   | 每条内容最大字符数   |
| fetchTimeout     | 10000  | URL 抓取超时（毫秒） |
| parallel         | true   | 是否并行抓取         |

### 5.2 搜索策略配置

| 参数             | 默认值  | 说明                 |
| ---------------- | ------- | -------------------- |
| maxResults       | 15      | 每个数据源最大结果数 |
| defaultTimeRange | 6months | 默认时间过滤范围     |
| timeout          | 30000   | 搜索超时（毫秒）     |

---

## 六、效果对比

### 6.1 证据数据对比

**优化前**:

```
### 证据 [1]
- 标题: AI市场报告2024
- 来源: example.com (web)
- 发布日期: 未知
- 可信度: 未评分

内容摘要:
人工智能市场持续增长，预计到2025年将达到...（约200字）
```

**优化后**:

```
### 证据 [1]
- 标题: AI市场报告2024
- 来源: example.com (web)
- 发布日期: 2024-12-15 (近一个月)
- 可信度: 75/100

**完整内容**:
根据最新市场研究，2024年全球人工智能市场规模已达到1500亿美元，
同比增长35%。主要增长动力来自：

1. 生成式AI的企业应用加速
   - ChatGPT企业版用户突破100万
   - Microsoft Copilot渗透率达到25%
   ...

2. 自动驾驶技术商业化
   - Waymo在旧金山日运营超过10万单
   - 特斯拉FSD V12实现端到端神经网络
   ...

（约3000字完整内容）
```

### 6.2 时间上下文对比

**优化前**: LLM 不知道当前日期，可能输出过时信息

**优化后**:

```
## 时间上下文
- **当前日期**: 2025年1月19日
- **时效性要求**: 优先引用最近 6 个月内的数据和信息，超过 6 个月的数据请标注时间
- **重要**: 请基于提供的证据撰写，不要使用你训练数据中的旧信息
```

---

## 七、文件清单

### 7.1 新增文件

| 文件                                  | 说明            |
| ------------------------------------- | --------------- |
| `services/data-enrichment.service.ts` | 数据增强服务    |
| `services/leader-tool.service.ts`     | Leader 工具服务 |

### 7.2 修改文件

| 文件                                     | 变更说明                                  |
| ---------------------------------------- | ----------------------------------------- |
| `types/research.types.ts`                | 新增 EnrichedResult、EnrichedEvidenceData |
| `prompts/dimension-research.prompt.ts`   | 时间上下文、完整内容支持                  |
| `services/data-source-router.service.ts` | 时间戳增强、默认时间过滤                  |
| `services/section-writer.service.ts`     | TemporalContext 支持                      |
| `services/dimension-mission.service.ts`  | 集成新服务                                |
| `services/index.ts`                      | 导出新服务                                |
| `topic-research.module.ts`               | 注册新服务                                |

---

## 八、后续优化建议

### 8.1 Phase 4: Agent 工具调用（未实施）

给维度研究员 Agent 完整的工具调用能力：

```typescript
// DimensionResearcherAgent
const RESEARCHER_TOOLS = [
  BUILTIN_TOOLS.WEB_SEARCH,
  BUILTIN_TOOLS.WEB_SCRAPER,
  BUILTIN_TOOLS.RAG_SEARCH,
];

// 使用 FunctionCallingExecutor 实现 ReAct 循环
await this.functionCallingExecutor.execute(
  llmAdapter,
  systemPrompt,
  userPrompt,
  RESEARCHER_TOOLS,
  context,
  { maxIterations: 5, maxToolCalls: 10 },
);
```

### 8.2 潜在改进

1. **缓存机制**: 缓存已抓取的网页内容，避免重复抓取
2. **并发控制**: 控制并发抓取数量，避免 IP 被限制
3. **内容质量评估**: 使用 AI 评估抓取内容的质量
4. **反思检查点**: 在研究过程中评估数据质量，决定是否补充搜索

---

## 九、深度检视记录（2025-01-19）

### 9.1 检视结果摘要

| 检视项          | 状态 | 说明                              |
| --------------- | ---- | --------------------------------- |
| 数据流完整性    | ✅   | fullContent 正确传递到 LLM prompt |
| 时效性保障      | ✅   | temporalContext 包含用户配置      |
| Leader 工具能力 | ✅   | 主动搜索 + 上下文生成             |
| 端到端场景      | ✅   | 完整链路验证通过                  |

### 9.2 发现并修复的问题

**问题**: `temporalContext` 在 `executeDimensionMission()` 创建后未传递给 `writeSectionsWithReview()`

**影响**: SectionWriter 降级使用默认时效性要求，用户配置的 searchTimeRange 不生效

**修复** (dimension-mission.service.ts):

```typescript
// 1. 调用时传递 temporalContext
const sectionResults = await this.writeSectionsWithReview(
  ...
  modelId,
  temporalContext, // ★ 新增
);

// 2. 方法签名添加参数
private async writeSectionsWithReview(
  ...
  modelId?: string,
  temporalContext?: TemporalContext, // ★ 新增
)

// 3. writeInputs 中包含 temporalContext
const writeInputs = groupSections.map((section) => ({
  ...
  temporalContext, // ★ 新增
}));
```

### 9.3 验证的完整数据流

```
用户配置 (searchTimeRange: "6months")
         ↓
DataSourceRouter
  └─ buildSearchQuery() 添加年份
  └─ 6个月时间过滤
         ↓
DataEnrichmentService
  └─ Top 5 抓取完整内容 (3000字)
  └─ 超时降级到 snippet
         ↓
LeaderToolService
  └─ 主动搜索 3 个查询
  └─ 生成背景摘要
         ↓
temporalContext
  └─ currentDate + freshnessRequirement
         ↓
SectionWriter
  └─ formatEvidenceForPrompt(fullContent)
  └─ prompt 包含时间上下文
         ↓
LLM: 基于真实数据 + 时间感知生成
```

### 9.4 已实施的改进（2025-01-19 追加）

| 改进项            | 状态      | 说明                                                  |
| ----------------- | --------- | ----------------------------------------------------- |
| URL 有效性验证    | ✅ 已实施 | EnrichedResult 增加 urlValid 字段，检测 404/错误页面  |
| 增强结果数可配置  | ✅ 已实施 | 支持 topicConfig.enrichmentTopN / enrichmentMaxLength |
| 无效 URL 警告日志 | ✅ 已实施 | 自动记录发现的无效 URL 数量                           |

**新增配置项**（topicConfig）:

```typescript
{
  searchTimeRange?: "6months" | "1year" | "2years" | "3years" | "5years" | "all",
  enrichmentTopN?: number,      // 增强的结果数量，默认 5
  enrichmentMaxLength?: number, // 每条内容最大长度，默认 3000
}
```

**EnrichedResult 新增字段**:

```typescript
interface EnrichedResult extends DataSourceResult {
  fullContent: string | null;
  contentSource: "fetched" | "snippet";
  urlValid: boolean; // ★ 新增：内容是否有意义（非错误页面）
}
```

### 9.5 反思检查点服务（已实施）

新增 `ResearchReflectionService`，提供研究过程中的数据质量评估能力：

**核心功能**:

- `evaluateEvidence()` - AI 评估证据覆盖度和质量
- `quickCheck()` - 快速检查证据数量和有效性
- `suggestAdditionalQueries()` - 生成补充搜索查询

**ReflectionResult 结构**:

```typescript
interface ReflectionResult {
  decision: "sufficient" | "need_more" | "pivot";
  score: number; // 0-100
  gaps: string[]; // 信息缺口
  reasoning: string; // 评估理由
  suggestedQueries?: string[];
}
```

**快速检查规则**:

- 证据数量 < 3 → 需要完整评估
- 有效内容比例 < 50% → 需要完整评估
- 平均内容长度 < 200 字 → 需要完整评估

### 9.6 待改进项

| 改进项               | 优先级 | 说明                     |
| -------------------- | ------ | ------------------------ |
| 缓存机制             | P3     | 避免重复抓取             |
| 集成反思检查点到流程 | P2     | 在研究流程中自动触发评估 |

---

**文档版本**: 1.3
**最后更新**: 2025-01-19
**维护者**: Claude Code
