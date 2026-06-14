# Topic Research 数据源增强 PRD

## 文档信息

| 项目     | 值                                   |
| -------- | ------------------------------------ |
| 版本     | 1.0                                  |
| 作者     | PM Agent                             |
| 日期     | 2026-01-21                           |
| 状态     | 需求分析完成                         |
| 优先级   | P0 - 高                              |
| 关联 PRD | macro-insight-quality-enhancement.md |

---

## 1. 背景与目标

### 1.1 用户需求

用户明确提出 4 个主要任务：

1. **实现缺失的数据源工具**：academic, github, hackernews, rss, local
2. **AI 规划模式**：让 AI 自主选择技能和工具，而非硬编码 searchSources
3. **消除技术负债**：移除 ghost values，修复不完整实现
4. **排查硬编码**：找出所有硬编码配置并制定改进策略

### 1.2 当前问题

#### Ghost Values 问题

`MACRO_INSIGHT_DIMENSIONS` 中使用了不存在于 `DataSourceType` 枚举的值：

| Ghost Value    | 出现位置                       | 实际处理         |
| -------------- | ------------------------------ | ---------------- |
| `local_policy` | 政策法规、国际动态维度         | 被静默过滤       |
| `local_report` | 市场、竞争、投资、公司相关维度 | 被静默过滤       |
| `news`         | 多个维度                       | 被静默过滤       |
| `arxiv`        | 技术趋势、人才、专利等维度     | 返回空（未实现） |
| `scholar`      | 技术原理、前沿水平维度         | 不存在           |
| `github`       | 技术趋势、应用等维度           | 返回空（未实现） |
| `hackernews`   | 技术趋势、应用等维度           | 返回空（未实现） |

#### 数据源实现状态

| DataSourceType   | 枚举存在 | 实现状态   | 备注                           |
| ---------------- | -------- | ---------- | ------------------------------ |
| WEB              | Yes      | **已实现** | 通过 web-search 工具           |
| ACADEMIC         | Yes      | **未实现** | ArxivService 存在但未集成      |
| GITHUB           | Yes      | **未实现** | GithubService 存在但未集成     |
| HACKERNEWS       | Yes      | **未实现** | HackernewsService 存在但未集成 |
| RSS              | Yes      | **未实现** | 标记 TODO                      |
| LOCAL            | Yes      | **未实现** | RAG 搜索未实现                 |
| FEDERAL_REGISTER | Yes      | **已实现** | 政策工具，未启用               |
| CONGRESS         | Yes      | **已实现** | 政策工具，未启用               |
| WHITEHOUSE       | Yes      | **已实现** | 政策工具，未启用               |

---

## 2. 需求分析

### 2.1 Epic 1: 数据源工具实现

#### US-001: Academic (ArXiv) 数据源

**用户故事**: 作为研究员，我希望在技术趋势、学术研究等维度能获取 arXiv 论文数据，以便获得权威的学术参考。

**现状分析**:

- `ArxivService` 已存在于 `backend/src/modules/ingestion/crawlers/arxiv.service.ts`
- 当前设计是将数据存入 MongoDB，不适合 Topic Research 的即时搜索需求
- 需要新增 `searchOnly` 模式或创建新的 ArXiv 搜索工具

**技术方案**:

1. **方案 A**: 在 `data-source-router.service.ts` 中直接调用 ArXiv API
2. **方案 B**: 创建 `ArxivSearchTool` 作为 AI Engine 工具（推荐）

**API 信息**:

- Endpoint: `http://export.arxiv.org/api/query`
- 认证: 无需 API Key
- 限速: 3 req/s

**验收标准**:

- [ ] 能够搜索 arXiv 论文并返回标题、摘要、作者、URL
- [ ] 支持按分类（cs.AI, cs.LG 等）过滤
- [ ] 响应时间 < 5s

---

#### US-002: GitHub 数据源

**用户故事**: 作为技术研究员，我希望在技术趋势、开源应用等维度能获取 GitHub 项目数据。

**现状分析**:

- `GithubService` 已存在，使用 GitHub Search API
- 需要 `GITHUB_TOKEN` 配置（否则限速很低）
- 需要新增搜索模式

**技术方案**:

- 创建 `GithubSearchTool` 或在路由服务中集成

**API 信息**:

- Endpoint: `https://api.github.com/search/repositories`
- 认证: GitHub Personal Access Token（可选但推荐）
- 限速: 无 Token 10 req/h, 有 Token 30 req/min

**密钥配置**:

```yaml
SecretCategory: GITHUB
SecretKey: GITHUB_TOKEN
Required: 推荐（否则限速严重）
```

**验收标准**:

- [ ] 能够搜索 GitHub 仓库并返回名称、描述、星标、URL
- [ ] 支持按语言、主题过滤
- [ ] 无 Token 时有降级提示

---

#### US-003: HackerNews 数据源

**用户故事**: 作为技术研究员，我希望在技术趋势、行业应用等维度能获取 HackerNews 讨论数据。

**现状分析**:

- `HackernewsService` 已存在，用于采集热门故事
- HN 官方 API 不支持搜索，需要使用 Algolia HN Search API

**技术方案**:

- 使用 Algolia HN Search API: `https://hn.algolia.com/api/v1/search`

**API 信息**:

- Endpoint: `https://hn.algolia.com/api/v1/search`
- 认证: 无需 API Key
- 限速: 无官方限制（建议 1 req/s）

**验收标准**:

- [ ] 能够搜索 HN 帖子并返回标题、URL、评分、评论数
- [ ] 支持按时间范围过滤
- [ ] 响应时间 < 3s

---

#### US-004: RSS 数据源

**用户故事**: 作为研究员，我希望能从预配置的 RSS 源获取行业新闻和博客更新。

**现状分析**:

- `RssService` 存在但未集成到 Topic Research
- RSS 是被动采集，需要预先配置订阅源

**技术方案**:

- 基于用户/主题配置的 RSS 源列表搜索已采集的内容
- 或实时拉取并搜索 RSS 内容

**依赖**:

- 需要 RSS 订阅管理功能
- 需要与 Resource/RAG 系统集成

**验收标准**:

- [ ] 能够从已配置的 RSS 源搜索内容
- [ ] 支持按来源、时间过滤
- [ ] 与资源库已有内容去重

---

#### US-005: Local (RAG) 数据源

**用户故事**: 作为用户，我希望研究能够引用我上传到资源库的文档和报告。

**现状分析**:

- 资源库（Library）模块已存在
- RAG/向量搜索能力待确认
- 需要实现语义搜索接口

**技术方案**:

- 接入 RAG 服务进行向量相似度搜索
- 或使用 PostgreSQL 全文搜索

**依赖**:

- RAG 服务/向量数据库
- 资源库索引

**验收标准**:

- [ ] 能够搜索用户资源库中的内容
- [ ] 支持按资源类型过滤
- [ ] 返回相关度评分

---

### 2.2 Epic 2: AI 规划模式

#### US-006: AI 自主选择数据源

**用户故事**: 作为用户，我希望 AI 能够根据研究主题和维度自动选择最合适的数据源，而不是依赖硬编码配置。

**现状分析**:

- 当前 `MACRO_INSIGHT_DIMENSIONS` 硬编码了 `searchSources`
- `ResearchPlannerService` 已实现 AI 规划研究步骤，但仅用于 Deep Research
- Topic Research 未使用 AI 规划

**功能需求**:

1. **数据源推荐**: AI 分析维度描述，推荐最适合的数据源组合
2. **动态调整**: 根据初始搜索结果质量，动态调整数据源策略
3. **用户覆盖**: 用户可手动覆盖 AI 推荐

**技术方案**:

```typescript
// 新增 AI 数据源规划器
interface DataSourcePlan {
  recommendedSources: DataSourceType[];
  rationale: string;
  fallbackSources: DataSourceType[];
}

// AI 规划提示词要点
- 分析维度名称和描述
- 考虑主题类型（MACRO/TECHNOLOGY/COMPANY）
- 输出推荐数据源和理由
```

**验收标准**:

- [ ] AI 能根据维度描述推荐数据源
- [ ] 推荐结果包含理由说明
- [ ] 用户可查看并覆盖推荐

---

#### US-007: 工具/技能自主选择

**用户故事**: 作为用户，我希望 AI 能够根据研究需求自主选择可用的工具和技能。

**功能需求**:

1. **工具发现**: AI 了解所有可用工具的能力
2. **工具选择**: 根据任务需求选择最合适的工具
3. **工具组合**: 支持多工具组合使用

**参考实现**:

- `AICapabilityResolver` 已实现工具可用性检查
- `ToolRegistry` 管理所有注册工具

**验收标准**:

- [ ] AI 能列出可用工具及其能力
- [ ] AI 能为特定任务选择工具
- [ ] 选择结果可解释

---

### 2.3 Epic 3: 技术负债清理

#### US-008: 移除 Ghost Values

**用户故事**: 作为开发者，我希望代码中没有"幽灵值"，所有配置都有对应的实现。

**问题清单**:
| 文件 | 位置 | Ghost Value | 修复方案 |
|------|------|-------------|----------|
| topic-research.service.ts | L72 | `local_policy` | 替换为 `federal-register`, `congress-gov` |
| topic-research.service.ts | L86 | `local_report` | 替换为 `local`（待实现）或移除 |
| topic-research.service.ts | L72,86... | `news` | 映射到 `web` 的新闻模式或创建 `news` 类型 |
| topic-research.service.ts | L114 | `scholar` | 映射到 `academic` 或移除 |

**验收标准**:

- [ ] 所有 `searchSources` 值都存在于 `DataSourceType` 枚举
- [ ] 每个 `DataSourceType` 都有对应的搜索实现（至少是 TODO 占位）
- [ ] 控制台无 "Unknown data source" 警告

---

#### US-009: 启用已实现的政策工具

**用户故事**: 作为研究员，我希望政策法规维度能使用已实现的政策工具获取官方数据。

**现状**:

- `FederalRegisterTool`, `CongressGovTool`, `WhiteHouseNewsTool` 已完整实现
- 在 `data-source-router.service.ts` 中已有调用代码
- 但 `searchSources` 未配置这些工具

**修复方案**:

```typescript
// 政策法规维度 searchSources 修改
// Before
searchSources: ["web", "local_policy", "news"];
// After
searchSources: ["web", "federal-register", "congress-gov", "whitehouse-news"];
```

**验收标准**:

- [ ] 政策法规维度默认启用政策工具
- [ ] 政策工具返回的数据被正确处理
- [ ] 工具启用状态可在 Admin 配置

---

#### US-010: 集成 DataEnrichmentService

**用户故事**: 作为用户，我希望研究报告的内容来自实际网页，而不是 AI 根据 snippet 编造的。

**现状**:

- `DataEnrichmentService` 已完整实现
- 但 `DimensionResearchService` 未调用它
- 导致 AI 只能看到 snippet（100-300 字）

**修复方案**:
在 `dimension-research.service.ts` 中调用增强服务：

```typescript
// 在 researchDimension 方法中
const searchResult = await this.dataSourceRouter.fetchDataForDimension(...);

// 新增：增强 Top N 结果
const enrichedResults = await this.dataEnrichmentService.enrichSearchResults(
  searchResult.items,
  { topN: 5, maxContentLength: 3000 }
);
```

**验收标准**:

- [ ] Top 5 搜索结果自动抓取完整内容
- [ ] AI 分析使用 fullContent 而非 snippet
- [ ] 增强失败时降级到 snippet

---

### 2.4 Epic 4: 硬编码排查与改进

#### US-011: 硬编码配置清单

**排查结果**:

| 类型   | 位置                              | 硬编码内容                 | 影响           | 改进建议                           |
| ------ | --------------------------------- | -------------------------- | -------------- | ---------------------------------- |
| 数据源 | topic-research.service.ts         | `searchSources` 数组       | 维度数据源固定 | 改为 AI 推荐 + 用户配置            |
| 数量   | data-source-router.service.ts:125 | `maxResults: 15`           | 结果数量固定   | 改为基于 researchDepth 动态配置    |
| 时间   | data-source-router.service.ts:116 | 默认 6 个月                | 时间范围固定   | 已支持 topicConfig，保持           |
| 参数   | 多处                              | `temperature`, `maxTokens` | AI 参数散落    | 已大部分使用 TaskProfile，继续推进 |

**已有良好实践**:

- AI 参数通过 `TaskProfile` 抽象，无需硬编码具体值
- 时间范围通过 `topicConfig.searchTimeRange` 配置
- 政策工具通过 Admin 配置启用/禁用

**待改进项**:

1. `MACRO_INSIGHT_DIMENSIONS` 等模板应可配置
2. `maxResults`, `minSources` 应基于 `researchDepth` 动态计算
3. 维度模板应支持用户自定义和模板市场

---

## 3. 技术方案

### 3.1 数据源工具架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                     AI Engine Tools Layer                           │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                │
│  │ web-search   │ │ arxiv-search │ │ github-search│                │
│  └──────────────┘ └──────────────┘ └──────────────┘                │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                │
│  │ hn-search    │ │ rss-search   │ │ rag-search   │   [NEW]        │
│  └──────────────┘ └──────────────┘ └──────────────┘                │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                │
│  │ fed-register │ │ congress-gov │ │ whitehouse   │   [EXISTING]   │
│  └──────────────┘ └──────────────┘ └──────────────┘                │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   DataSourceRouterService                           │
│  - 根据 searchSources 配置路由到对应工具                            │
│  - 通过 ToolRegistry 动态获取工具                                   │
│  - 支持 AI 推荐数据源（新增）                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 AI 规划模式架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Topic Research Flow                             │
└─────────────────────────────────────────────────────────────────────┘

    用户创建专题
         │
         ▼
┌─────────────────────┐
│  获取维度模板        │
│  (MACRO_INSIGHT_    │
│   DIMENSIONS)       │
└─────────────────────┘
         │
         ▼
┌─────────────────────┐         ┌─────────────────────┐
│  [NEW] AI 数据源     │ ──────► │  推荐 searchSources │
│  规划器              │         │  + 理由             │
└─────────────────────┘         └─────────────────────┘
         │
         ▼
┌─────────────────────┐
│  用户确认/覆盖       │
│  数据源配置          │
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│  执行研究            │
│  DataSourceRouter   │
└─────────────────────┘
```

### 3.3 数据源工具配置表

| 工具 ID            | 类型 | API 密钥      | 密钥类别 | 配置项          |
| ------------------ | ---- | ------------- | -------- | --------------- |
| `web-search`       | 信息 | Tavily/Serper | SEARCH   | numResults      |
| `arxiv-search`     | 信息 | 无需          | -        | category        |
| `github-search`    | 信息 | GITHUB_TOKEN  | GITHUB   | language        |
| `hn-search`        | 信息 | 无需          | -        | timeRange       |
| `rss-search`       | 信息 | 无需          | -        | feedIds         |
| `rag-search`       | 信息 | 无需          | -        | resourceTypes   |
| `federal-register` | 政策 | 无需          | -        | docType, agency |
| `congress-gov`     | 政策 | 可选          | CONGRESS | billType        |
| `whitehouse-news`  | 政策 | 无需          | -        | contentType     |

---

## 4. 任务拆分

### Phase 1: 技术负债清理 (2-3 天)

| ID     | 任务                       | 类型 | 预估  | 依赖   | 优先级 |
| ------ | -------------------------- | ---- | ----- | ------ | ------ |
| P1-001 | 移除 ghost values          | 后端 | 0.5d  | -      | P0     |
| P1-002 | 启用政策工具               | 后端 | 0.5d  | P1-001 | P0     |
| P1-003 | 集成 DataEnrichmentService | 后端 | 1d    | -      | P0     |
| P1-004 | 提升 maxResults 到 25      | 后端 | 0.25d | -      | P1     |
| P1-005 | 添加数据源映射验证         | 后端 | 0.5d  | P1-001 | P1     |

### Phase 2: 数据源工具实现 (5-7 天)

| ID     | 任务                        | 类型 | 预估  | 依赖       | 优先级 |
| ------ | --------------------------- | ---- | ----- | ---------- | ------ |
| P2-001 | 实现 ArxivSearchTool        | 后端 | 1d    | -          | P0     |
| P2-002 | 实现 GithubSearchTool       | 后端 | 1d    | -          | P0     |
| P2-003 | 实现 HackerNewsSearchTool   | 后端 | 1d    | -          | P1     |
| P2-004 | 实现 RssSearchTool          | 后端 | 1d    | -          | P2     |
| P2-005 | 实现 RagSearchTool (Local)  | 后端 | 1.5d  | RAG        | P2     |
| P2-006 | 更新 DataSourceType 枚举    | 后端 | 0.25d | P2-001     | P0     |
| P2-007 | 集成工具到 DataSourceRouter | 后端 | 0.5d  | P2-001~005 | P0     |
| P2-008 | Admin 密钥配置 UI           | 前端 | 0.5d  | P2-002     | P1     |

### Phase 3: AI 规划模式 (3-5 天)

| ID     | 任务                          | 类型 | 预估 | 依赖   | 优先级 |
| ------ | ----------------------------- | ---- | ---- | ------ | ------ |
| P3-001 | 设计 AI 数据源规划接口        | 设计 | 0.5d | -      | P0     |
| P3-002 | 实现 DataSourcePlannerService | 后端 | 1.5d | P3-001 | P0     |
| P3-003 | AI 规划提示词优化             | 后端 | 0.5d | P3-002 | P0     |
| P3-004 | 前端数据源配置 UI             | 前端 | 1d   | P3-002 | P1     |
| P3-005 | 用户覆盖 AI 推荐功能          | 全栈 | 0.5d | P3-004 | P1     |

### Phase 4: 配置化改进 (可选, 2-3 天)

| ID     | 任务             | 类型 | 预估 | 依赖   | 优先级 |
| ------ | ---------------- | ---- | ---- | ------ | ------ |
| P4-001 | 维度模板配置化   | 后端 | 1d   | -      | P2     |
| P4-002 | 研究深度动态配置 | 后端 | 0.5d | -      | P2     |
| P4-003 | 模板自定义 UI    | 前端 | 1d   | P4-001 | P2     |

---

## 5. 验收标准

### 5.1 Phase 1 验收

- [ ] 控制台无 "Unknown data source type" 警告
- [ ] 政策维度能获取 Federal Register, Congress.gov 数据
- [ ] Top 5 搜索结果有完整内容（非仅 snippet）
- [ ] 所有 `searchSources` 值都有对应实现

### 5.2 Phase 2 验收

- [ ] ArXiv 搜索返回有效论文数据
- [ ] GitHub 搜索返回有效仓库数据
- [ ] HackerNews 搜索返回有效帖子数据
- [ ] 工具在 Admin 可配置启用/禁用
- [ ] 无 API Key 时有合理降级

### 5.3 Phase 3 验收

- [ ] AI 能为维度推荐数据源
- [ ] 推荐包含理由说明
- [ ] 用户可覆盖 AI 推荐
- [ ] 推荐结果可追溯

---

## 6. 风险与缓解

| 风险              | 影响 | 缓解措施                    |
| ----------------- | ---- | --------------------------- |
| API 限速          | 中   | 添加限速器、缓存、降级      |
| RAG 依赖未就绪    | 中   | Local 数据源延后实现        |
| AI 规划结果不稳定 | 低   | 保留硬编码 fallback         |
| GitHub Token 泄露 | 高   | 使用 SecretService 加密存储 |
| arXiv API 慢      | 低   | 增加超时、并行请求          |

---

## 7. 附录

### 7.1 相关文件

| 文件                            | 说明                   |
| ------------------------------- | ---------------------- |
| `topic-research.service.ts`     | 维度模板定义           |
| `data-source-router.service.ts` | 数据源路由             |
| `dimension-research.service.ts` | 维度研究执行           |
| `data-enrichment.service.ts`    | 内容增强服务           |
| `data-source.types.ts`          | 数据源类型枚举         |
| `policy/*.ts`                   | 政策工具实现           |
| `arxiv.service.ts`              | 现有 ArXiv 采集器      |
| `github.service.ts`             | 现有 GitHub 采集器     |
| `hackernews.service.ts`         | 现有 HackerNews 采集器 |

### 7.2 变更记录

| 版本 | 日期       | 变更内容 | 作者     |
| ---- | ---------- | -------- | -------- |
| 1.0  | 2026-01-21 | 初始版本 | PM Agent |

---

**最后更新**: 2026-01-21
