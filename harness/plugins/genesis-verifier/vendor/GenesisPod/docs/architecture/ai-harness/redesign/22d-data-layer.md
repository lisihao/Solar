# 22d · Topic Insights 数据层契约规范

## 概述

Topic Insights 数据层由 12 个核心 Service 组成，负责搜索、增强、管理和融合多源数据。所有 Service 遵循统一的架构模式：通过 Facade（ToolRegistry、ChatFacade）调用下层能力，禁止直接调用 AI Engine 内部服务。

**编写日期**: 2026-04-24  
**覆盖 Services**: 12 个  
**总行数**: 约 8000+ 行

---

## 5.1 · data-enrichment.service.ts（903 行）

### 核心职责

通过抓取完整网页内容增强搜索结果。将 snippet（100-300 字）扩充为完整内容（3000 字），支持图表提取和 Vision LLM 相关性审查。

### 关键架构

- **双通道选取**: topN 结果 + 高可信度来源（额外 10 条）
- **LRU fetchCache**: 容量 500，跨维度 URL 去重
- **arXiv 特殊处理**: /abs/ → /html/ 升级，含尾部斜杠修复
- **Vision LLM 图表审查**: 多模态相关性评分
- **图片补充搜索**: 不足 3 张时自动通过 image-search 补充

---

### 关键方法

#### method: enrichSearchResults（行 177-314）

**签名**: (results: DataSourceResult[], options?: DataEnrichmentOptions) -> Promise<EnrichedResult[]>

**业务不变量**:

1. 双通道结果无重复（URL 去重）
2. 所有缓存 key 通过 normalizeUrl() 生成
3. contentSource 标记准确：fetched vs snippet
4. 图表都经过 Vision LLM 相关性审查

**控制流伪码**:
\\\

1. 解析 options（topN=5, enableFigures=true）
2. 双通道集合
   - topN = results.slice(0, 5)
   - extraHighCred = 剩余中 credibilityScore >= 55，最多 10 条
3. 合并 toEnrich，URL 去重
4. 并行/顺序调用 enrichSingleResult()
5. 检查图表数 < 3 → supplementFiguresViaImageSearch()
6. 返回所有 urlValid !== false 的结果
   \\\

**关键参数**:

- HIGH_CREDIBILITY_THRESHOLD = 55
- MAX_EXTRA_HIGH_CRED = 10
- MIN_FIGURES_THRESHOLD = 3
- MAX_SEARCH_SUPPLEMENT_FIGURES = 5

---

#### method: enrichSingleResult（行 370-585）

**签名**: (result: DataSourceResult, ...) -> Promise<EnrichedResult>

**Prisma 操作**: 无（仅内存缓存）

**控制流伪码**:
\\\

1. 规范化 URL，检查 fetchCache
   - Cache hit → 返回缓存
2. ToolRegistry.web-scraper 抓取
   - 超时 10000ms → fallback 为 snippet
3. isContentMeaningful() 检查（>= 100 字，非错误页）
4. 图表提取（enableFigures=true）
   - arXiv /abs/ → /html/ 升级
   - 尾部斜杠补 URL（相对路径解析）
   - 三层质量关卡：
     a. 过滤无 imageUrl
     b. validateAndUpgradeFigures()：GET+Range + magic bytes
     c. filterRelevantFigures()：Vision LLM
5. 写 fetchCache（LRU）
6. 返回 EnrichedResult
   \\\

**关键细节**: arXiv HTML 版本 URL 必须以 / 结尾，否则相对路径 img.png 会解析到父目录

---

#### method: supplementFiguresViaImageSearch（行 738-833）

**签名**: (searchContext: string, maxCount: number) -> Promise<ExtractedFigure[]>

**业务用途**: 补充网页提取不足的图片

**控制流伪码**:
\\\

1. 获取 image-search 工具
2. 搜索查询 = "\ chart infographic data"
3. numResults = maxCount \* 2（过滤会损失）
4. ImageSearchResult → ExtractedFigure，标记 isImageSearchSupplement=true
5. 质量关卡 1: validateAndUpgradeFigures()
6. 质量关卡 2: filterRelevantFigures()（Vision LLM）
7. 限制 maxCount 返回
   \\\

**设计哲学**: v7 策略宁缺毋滥，搜索引擎图片多为营销图/头图，质量低

---

## 5.2 · data-source-router.service.ts（约 2700 行）

### 核心职责

数据源路由入口，协调规划、策略、抓取、增强。管理三层搜索优先级链。

**关键概念**:

- 推荐数据源搜索 → 智能搜索 → WEB fallback
- Promise.allSettled() 管理多源并发
- 聚合 + 排序 + 去重 + 多样性控制

---

### 关键方法

#### method: fetchDataForDimension（行 约 100-250）

**签名**: (request: DataSourceFetchRequest) -> Promise<AggregatedSearchResult>

**Prisma 读**: topicDimension, knowledgeBaseIds（LOCAL）

**调用者**: DimensionResearch 执行阶段

**业务不变量**:

1. 结果有序：按可信度降序
2. 域名多样性：单个域最多占 30%（高权威源 50%）
3. URL 去重：规范化 + 标题相似度 >= 0.9 去重
4. 降级可用：单层失败不影响其他层

**控制流伪码**:
\\\

1. validateRequest()，setCurrentTopic() 用于 LOCAL
2. DataSourcePlannerService.planDataSources()
3. 构建 sources = recommended + fallback
4. 三层搜索（try-catch 不中断）
   - 层 1: standardSearch(sources)
   - 层 2: agenticSearch()
   - 层 3: fallbackWebSearch()
5. DataSourceStrategyService.aggregateResults()
   - 去重 + 排序 + 多样性
6. 可选: enrichResults()
7. 返回 AggregatedSearchResult
   \\\

---

#### method: standardSearch（行 约 250-400）

**签名**: (sources: DataSourceType[], query: string) -> Promise<DataSourceResult[][]>

对每个推荐源 → DataSourceFetcherService.executeSearch()，Promise.allSettled() 并发

---

## 5.3 · data-source-planner.service.ts（394 行）

### 核心职责

AI 驱动数据源规划，推荐最适合数据源组合。

---

### 关键方法

#### method: planDataSources（行 53-119）

**签名**: (input: DataSourcePlanInput) -> Promise<DataSourcePlan>

**LLM 调用**: chatStructured，低创意度，JSON 强制验证

**LLM 系统提示核心要点**:

- 相关性优先 > 覆盖全面 > 权威可靠
- 吞吐量优先：OpenAlex（主力）+ ArXiv（补充）
- 场景匹配：政策/技术/市场/生物医学

**控制流伪码**:
\\\

1. getAvailableDataSources()：检查每个源在 ToolFacade 中是否启用
2. buildPlanningPrompt()
3. chatStructured()，自动 JSON 解析
4. validateRecommendedSources()：只来自可用源列表
5. 返回 DataSourcePlan
   \\\

**业务不变量**:

- 推荐来源仅来自可用源列表
- confidence 范围 0-100
- searchStrategy 包含完整策略

---

## 5.4 · data-source-fetcher.service.ts（1054 行）

### 核心职责

执行具体数据源搜索：Web、Academic、GitHub、HackerNews、Local、政策源、社媒。

---

### 关键方法

#### method: executeSearch（行 54-96）

**签名**: (source: DataSourceType, query: string, maxResults: number, since?: Date) -> Promise<DataSourceResult[]>

按 source 类型路由到具体实现。支持 11 种数据源。

---

#### method: searchAcademic（行 192-233）

**签名**: (query: string, maxResults: number) -> Promise<DataSourceResult[]>

**优先级链**: OpenAlex → Semantic Scholar → ArXiv → PubMed

**设计原则**: OpenAlex 首选（250M 论文，无限流；polite pool），ArXiv 作为有限流备选

---

#### method: searchLocal（行 548-621）

**签名**: (query: string, maxResults: number) -> Promise<DataSourceResult[]>

**Prisma 读**: topicConfig.knowledgeBaseIds（从 currentTopic）

**必要先决条件**: 必须提前调用 setCurrentTopic()

**控制流伪码**:
\\\

1. 从 currentTopic.topicConfig 获取 knowledgeBaseIds
2. 无配置返回 []
3. embeddingGenerate(query)
4. vectorSimilaritySearch(embedding, {limit, threshold: 0.3, knowledgeBaseIds})
5. 转换为 DataSourceResult[]
   - url: kb://{documentId}#{chunkId}
   - domain: "knowledge-base"
     \\\

---

#### method: searchSocialX（行 795-1026）

**签名**: (query: string, maxResults: number) -> Promise<DataSourceResult[]>

**优先级链**: Grok Live Search → Web Search fallback

**Grok Live Search 流程**:
\\\

1. 获取 xAI 模型
2. AI Prompt 让 Grok 搜索 X
3. 解析 JSON：trends[] with engagement/sentiment
4. 返回高 engagement 帖子（可信账户）
   \\\

**降级**: JSON 解析失败 → URL 抽取降级

---

## 5.5 · data-source-strategy.service.ts（377 行）

### 核心职责

结果处理：聚合、去重、可信度评分、域名多样性。

---

### 关键方法

#### method: aggregateResults（行 58-101）

**签名**: (results: PromiseSettledResult<DataSourceResult[]>[], sources: DataSourceType[]) -> AggregatedSearchResult

**控制流**:
\\\

1. 遍历 fulfilled 结果
2. URL 规范化去重
3. 标题相似度去重（Jaccard >= 0.9）
4. 可信度评分
5. 排序：降序
6. 强制域名多样性
7. 返回聚合结果
   \\\

---

#### method: calculateCredibilityScore（行 267-276）

**签名**: (item: DataSourceResult) -> number [0-100]

**公式**:
\\\
score =
sourceType _ 0.4 + // 100分:ACADEMIC/OPENALEX；95分:政策源
domainAuthority _ 0.3 +// 100分:顶级权威；50分:通用
recency _ 0.2 + // 100分:<=7天；25分:>730天
contentDepth _ 0.1 // 100分:>=500字；20分:<100字
\\\

---

#### method: enforceDomainDiversity（行 187-241）

**签名**: (results: DataSourceResult[], maxRatio?: number) -> DataSourceResult[]

**规则**:

- 默认 maxRatio = 30%
- 高权威域 > 40% → 允许 maxRatio 提升至 50%
- maxPerDomain = max(2, ceil(results.length \* maxRatio))

---

## 5.6 · leader-tool.service.ts（1054 行）

### 核心职责

为 Leader Agent 提供维度和任务操作工具。所有方法可变（DB 写）。

---

### 关键方法

#### method: createDimension（行 168-225）

**签名**: (params: CreateDimensionParams) -> Promise<LeaderActionResult>

**Prisma 操作**: INSERT + SELECT maxOrder

**控制流**:
\\\

1. 检查同名维度（重复返回 false）
2. 获取 maxSortOrder
3. INSERT TopicDimension
   - status = PENDING
   - sortOrder = maxOrder + 1
     \\\

---

#### method: deleteDimension（行 231-336）

**签名**: (params: DeleteDimensionParams) -> Promise<LeaderActionResult>

**业务不变量**: 不能删除有 in-flight mission 的维度

**控制流**:
\\\

1. 查找维度
2. 检查 in-flight mission（EXECUTING/REVIEWING）
   - 有 → 返回 false
3. 将 PENDING/EXECUTING 任务改为 FAILED
4. DELETE 维度
   \\\

---

#### method: mergeDimensions（行 543-645）

**签名**: (params: MergeDimensionsParams) -> Promise<LeaderActionResult>

**控制流**:
\\\

1. 查找目标维度
2. 查找源维度
3. 合并描述
4. UPDATE ResearchTask.dimensionId = targetId
5. UPDATE 目标维度描述
6. DELETE 源维度
   \\\

---

#### method: searchLatestData（行 720-833）

**签名**: (context: LeaderSearchContext, queries?: string[], capabilityContext?: AICapabilityContext) -> Promise<LeaderSearchResult[]>

**控制流**:
\\\

1. 获取当前日期 + 时效性描述
2. 检查 web-search 工具可用性
3. 生成/使用提供的查询（最多 3 个）
4. 增强查询：添加年份或 "latest"
5. 逐个搜索并收集结果
6. 返回 LeaderSearchResult[]
   \\\

---

#### method: leaderAgenticSearch（行 655-707）

**签名**: (params) -> Promise<{content, toolsUsed, tokensUsed}>

**模式**: Function Calling，LLM 自主决定调用哪些工具

**降级**: ToolFacade 不可用 → searchLatestData()

---

## 5.7 · evidence-management.service.ts（447 行）

### 核心职责

证据生命周期：查询、过滤、可信度评分、去重、统计。

---

### 关键方法

#### method: recalculateCredibilityScores（行 202-248）

**签名**: (reportId: string) -> Promise<{updated, avgScore}>

**业务用途**: 修复历史数据可信度评分

**流程**:
\\\

1. 获取报告所有证据
2. 逐个重新计算：
   - 补充缺失的 domain（从 URL 提取）
   - calculateCredibilityScore()
3. 事务更新
4. 返回更新数 + 平均分
   \\\

---

#### method: calculateCredibilityScore（行 254-403）

**签名**: (evidence: {domain, sourceType, snippet, publishedAt}) -> number [20-100]

**评分公式**:
\\\
score =
domainAuthority(0-40) + // 政府/学术40; 顶级媒体30; 通用15-22
sourceType(0-30) + // 学术30; 官方28; 新闻22; 报告20; WEB15
contentDepth(0-15) + // >=500字15; >=200字10; >=50字5
recency(0-15) // <=30天15; <=180天12; <=365天8; <=730天5

// min=20, max=100
\\\

**域名权威等级**:

1. Top：.gov/.edu, arxiv, nature, science, IEEE, 中国机构(CNKI, WANFANG, CAS) → 40分
2. High：顶级媒体/智库 → 30分
3. Medium：科技媒体 → 22分
4. Generic → 15分
5. None → 10分

---

## 5.8 · evidence-sync-compensation.service.ts（220 行）

### 核心职责

处理 Engine Evidence 写入失败的补偿重试（双写模式）。

**存储方式**: 内存队列 + 永久失败记录

**参数**:

- MAX_RETRIES = 3
- RETRY_INTERVAL_MS = 5 分钟
- MAX_QUEUE_SIZE = 1000

---

### 关键方法

#### method: queueForRetry（行 88-118）

**签名**: (topicEvidenceId: string, request: SaveEvidenceRequest, error: string) -> void

队列满 → 丢弃最旧记录

---

#### method: processRetryQueue（行 123-176）

**签名**: () -> Promise<void>

**调度**: setInterval() 每 5 分钟

**流程**:
\\\

1. 遍历待重试队列
2. TeamFacade.evidenceSave()
3. 成功 → 移除队列
4. 失败 → retryCount++
   - > = 3 → 移入永久失败
     > \\\

---

## 5.9 · knowledge-graph.service.ts（432 行）

### 核心职责

持久化知识图谱：实体抽取、关系提取、跨项目知识复用。

**存储**: 内存 Map（后续迁移图数据库）

---

### 关键方法

#### method: extractEntities（行 46-85）

**签名**: (request: EntityExtractionRequest) -> Promise<EntityExtractionResult>

**LLM**: chatWithSkills，entity-extraction 技能

**响应格式**:
\\\json
{
"entities": [
{"name", "type", "description", "aliases": [], "properties": {}, "confidence"}
],
"relations": [
{"sourceName", "targetName", "type", "description", "strength", "confidence"}
]
}
\\\

---

#### method: addEntity（行 90-125）

**签名**: (entity: KnowledgeEntity) -> string

**去重策略**:

1. 名称匹配 → 合并
2. 别名匹配 → 合并
3. 都不匹配 → 创建新实体

---

#### method: query（行 147-200）

**签名**: (options: KnowledgeGraphQueryOptions) -> KnowledgeSubgraph

**过滤维度**:

- entityTypes, minConfidence, topicIds, relationTypes, limit

---

#### method: findRelatedKnowledge（行 205-244）

**签名**: (query: string, topicId?: string) -> KnowledgeSubgraph

**匹配**: 词汇模糊匹配，返回前 20 个 + 其关系

---

## 5.10 · multi-language-research.service.ts（367 行）

### 核心职责

多语言支持：检测、跨语言查询、证据翻译、归一化。

**支持语言**: EN, ZH, JA, KO, DE, FR, ES, PT, RU, AR

---

### 关键方法

#### method: detectLanguage（行 65-107）

**签名**: (text: string) -> Promise<LanguageDetectionResult>

**返回**:
\\\ ypescript
{
primaryLanguage, confidence, isMultilingual, languageDistribution
}
\\\

---

#### method: generateCrossLanguageQueries（行 112-178）

**签名**: (request: CrossLanguageQueryRequest) -> Promise<CrossLanguageQueryResult>

**LLM 提示**: 保留术语 + 本地搜索模式 + 域特定术语

**返回**: translatedQueries + terminologyMapping

---

#### method: normalizeEvidence（行 183-289）

**签名**: (request: EvidenceNormalizationRequest) -> Promise<NormalizedEvidence>

**安全**: 外部内容通过 <external_source> 标签隔离（OWASP LLM01）

**返回**: translatedContent + translationQuality + culturalNotes

---

## 5.11 · rag-fusion.service.ts（437 行）

### 核心职责

多查询融合检索：变体生成 → 并发搜索 → RRF 融合。

---

### 关键方法

#### method: generateQueryVariants（行 55-189）

**签名**: (request: QueryVariantGenerationRequest) -> Promise<QueryVariantGenerationResult>

**变体类型**: paraphrased, decomposed, expanded, contrastive, temporal, domain_specific, aspect_focused

**权重范围**: 0.5-1.0，对比查询 0.6-0.7

---

#### method: fuseResults（行 214-332）

**签名**: (variantResults: VariantSearchResult[], config?: RAGFusionConfig) -> FusedSearchResult

**融合算法**: Reciprocal Rank Fusion (RRF)

**公式**:
\\\
RRF(d) = Σ weight(q) / (k + rank(d, q))
k = 60（平滑常数）
\\\

**覆盖度加成**:

- 在 3+ 变体中出现 → 乘以 1.2
- 在 2+ 变体中出现 → 乘以 1.1

---

#### method: fusionSearch（行 351-415）

**签名**: (request, searchFn, config?) -> Promise<FusedSearchResult>

**并发控制**: CONCURRENT_SEARCH_LIMIT = 3

**流程**:
\\\

1. generateQueryVariants()
2. mapWithConcurrency(variants, executeVariant, 3)
3. fuseResults()
   \\\

---

## 5.12 · data-source-connector.registry.ts（176 行）

### 核心职责

连接器管理：注册、发现、健康检查、搜索路由。

---

### 关键方法

#### method: register（行 38-53）

**签名**: (connector: IDataSourceConnector) -> void

重复注册 → 警告并覆盖

---

#### method: searchViaConnector（行 72-102）

**签名**: (sourceType, query, maxResults, options?) -> Promise<DataSourceResult[]>

**流程**:
\\\

1. 查找连接器
2. isAvailable()
3. connector.search()
4. 失败返回 []
   \\\

---

#### method: runHealthChecks（行 148-167）

**调度**: setInterval() 每 5 分钟

---

## 关键设计约束

### Facade 边界守护

- 禁止直接导入 AI Engine 内部实现
- 必须从 i-engine/facade 导入
- 例外：通过 Facade 导出的类型和接口

### 缓存策略

| 缓存             | 容量 | 用途                   |
| ---------------- | ---- | ---------------------- |
| fetchCache (LRU) | 500  | URL 去重 + 图表缓存    |
| 知识图谱 (Map)   | 无限 | 实体关系存储（可迁移） |

### Prisma 操作权限

| Service             | 操作 | 对象                         |
| ------------------- | ---- | ---------------------------- |
| leader-tool         | 写   | topicDimension, researchTask |
| evidence-management | 读写 | topicEvidence                |
| data-source-fetcher | 读   | topicConfig（currentTopic）  |
| 其他                | 无   | -                            |

### 外部集成

| 组件         | 工具                                                                                  | 用途       |
| ------------ | ------------------------------------------------------------------------------------- | ---------- |
| ToolRegistry | web-search, web-scraper, arxiv-search, github-search, hackernews-search, image-search | 数据源搜索 |
| ChatFacade   | chat, chatStructured, chatWithSkills                                                  | LLM 调用   |
| TeamFacade   | evidenceSave                                                                          | 双写补偿   |
| RAGFacade    | embeddingGenerate, vectorSimilaritySearch                                             | 向量检索   |

---

## 总结

**12 个 Service，约 8000+ 行代码**，实现完整数据层能力：

1. **搜索**: Web / Academic / GitHub / HackerNews / Local / 政策源 / 社媒
2. **增强**: 网页抓取 + 图表提取 + 图片补充
3. **融合**: RAG-Fusion 多查询变体融合
4. **管理**: 证据去重 / 可信度评分 / 引用索引
5. **知识**: 实体抽取 / 关系提取 / 跨项目复用
6. **多语**: 检测 / 翻译 / 归一化
7. **Leader**: 维度/任务操作 + 自主搜索

---

**版本**: 1.0  
**最后更新**: 2026-04-24  
**状态**: Final
