# 宏观洞察研究质量增强 PRD

## 文档信息

| 项目   | 值                         |
| ------ | -------------------------- |
| 版本   | 1.0                        |
| 作者   | PM Agent + Architect Agent |
| 日期   | 2026-01-21                 |
| 状态   | 设计完成                   |
| 优先级 | P0 - 高                    |

---

## 1. 问题概述

### 1.1 用户反馈

基于宏观洞察报告 [美国AI宏观洞察](https://genesis-ai.up.railway.app/share/topic/7133aaac-8813-42a6-9ace-6d3c6d7de629) 的用户反馈：

1. **链接质量问题**：政策分析链接指向列表页（如 `https://2021-2025.state.gov/policy-issues/`）而非具体文章
2. **内容提取不充分**：对于 Brookings 等专业智库文章，没有充分提炼与主题强相关的内容
3. **覆盖深度不足**：层级较深的法规内容没有充分覆盖

### 1.2 影响范围

- 所有宏观洞察研究专题
- 特别是政策法规、国际动态等维度

---

## 2. 根本原因分析

### 2.1 问题1：链接指向列表页

**根因**：政策维度的数据源配置未包含专业政策工具

```typescript
// 当前配置 (topic-research.service.ts:72)
searchSources: ["web", "local_policy", "news"]; // ← 未启用政策工具
```

**已有但未启用的工具**：

- `FederalRegisterTool` - 联邦公报搜索（返回具体行政命令、法规）
- `CongressGovTool` - 国会立法搜索（返回具体法案）
- `WhiteHouseNewsTool` - 白宫新闻（返回具体声明）

**代码位置**：

- 维度模板：`topic-research.service.ts:60-74`
- 数据源路由：`data-source-router.service.ts:390-427`

### 2.2 问题2：内容提取不充分

**根因**：`DataEnrichmentService` 已实现但未被调用

```typescript
// 当前只保留 snippet (dimension-research.service.ts:159-173)
snippet: item.snippet || null; // ← 100-300字摘要
```

**已有但未调用的服务**：

- `data-enrichment.service.ts` - 可抓取完整文章内容（3000字）
- 在 `services/index.ts` 中导出但从未被导入

### 2.3 问题3：覆盖深度不足

**根因组合**：

| 因素       | 当前值           | 问题                                  |
| ---------- | ---------------- | ------------------------------------- |
| 搜索查询数 | 只用第一个       | 其余 3 个预设查询被忽略               |
| 结果数量   | `maxResults: 15` | 限制过低                              |
| 最小来源   | `minSources: 5`  | 不足以覆盖复杂主题                    |
| 迭代搜索   | 无               | Deep Research 有，Topic Research 没有 |

**代码位置**：

- 只取第一个查询：`data-source-router.service.ts:237`
- 结果限制：`data-source-router.service.ts:125`

---

## 3. 解决方案

### 3.1 架构改进图

```
┌─────────────────────────────────────────────────────────────────────┐
│                     增强后的研究数据流                               │
└─────────────────────────────────────────────────────────────────────┘

                         ┌─────────────────┐
                         │  Research Topic │
                         └────────┬────────┘
                                  │
              ┌───────────────────▼───────────────────┐
              │        DimensionResearchService        │
              │   [增强] 支持 researchDepth 配置        │
              └───────────────────┬───────────────────┘
                                  │
    ┌─────────────────────────────▼─────────────────────────────┐
    │                 DataSourceRouterService                    │
    │   [修改1] 多查询支持: 执行所有 searchQueries               │
    │   [修改2] 动态 maxResults: 根据 researchDepth 调整         │
    │   [修改3] 政策工具路由: 启用专业政策数据源                  │
    └─────────────────────────────┬─────────────────────────────┘
                                  │
    ┌─────────────────────────────▼─────────────────────────────┐
    │                      数据源并行调用                         │
    │   ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐    │
    │   │ Web     │ │ Academic │ │ GitHub   │ │ HackerNews │    │
    │   └─────────┘ └──────────┘ └──────────┘ └────────────┘    │
    │   ┌─────────────────┐ ┌────────────┐ ┌──────────────┐     │
    │   │ FederalRegister │ │ Congress   │ │ WhiteHouse   │     │ [新启用]
    │   └─────────────────┘ └────────────┘ └──────────────┘     │
    └─────────────────────────────┬─────────────────────────────┘
                                  │
    ┌─────────────────────────────▼─────────────────────────────┐
    │              DataEnrichmentService [新调用]                 │
    │   - 抓取 Top N 结果的完整网页内容                           │
    │   - 将 snippet (200字) → fullContent (3000字)              │
    │   - URL 有效性验证                                         │
    └─────────────────────────────┬─────────────────────────────┘
                                  │
                         ┌────────▼────────┐
                         │   AI 分析生成    │
                         │  (使用增强内容)   │
                         └─────────────────┘
```

### 3.2 研究深度配置

```typescript
export type ResearchDepth = "quick" | "standard" | "thorough";

export const RESEARCH_DEPTH_CONFIGS = {
  quick: {
    maxResultsPerSource: 10,
    minSources: 5,
    maxQueries: 1,
    enableEnrichment: false,
    enrichTopN: 0,
    estimatedCredits: 100,
  },
  standard: {
    maxResultsPerSource: 20,
    minSources: 8,
    maxQueries: 2,
    enableEnrichment: true,
    enrichTopN: 5,
    estimatedCredits: 300,
  },
  thorough: {
    maxResultsPerSource: 30,
    minSources: 12,
    maxQueries: 4,
    enableEnrichment: true,
    enrichTopN: 10,
    estimatedCredits: 800,
  },
};
```

---

## 4. 实施任务

### Phase 1: 快速修复 (1-2 天)

| ID     | 任务             | 文件                                    | 改动                                                                          |
| ------ | ---------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| P1-001 | 启用政策专业工具 | `topic-research.service.ts:60-74`       | 添加 `federal-register`, `congress-gov`, `whitehouse-news` 到 `searchSources` |
| P1-002 | 提升搜索结果数量 | `data-source-router.service.ts:125`     | `maxResults: 15` → `maxResults: 25`                                           |
| P1-003 | 支持多查询执行   | `data-source-router.service.ts:220-251` | 修改 `buildSearchQuery` 支持多个查询                                          |
| P1-004 | 提升最小来源数   | `topic-research.service.ts:73`          | `minSources: 5` → `minSources: 8`                                             |

### Phase 2: 功能增强 (3-5 天)

| ID     | 任务             | 文件                                  | 改动                                               |
| ------ | ---------------- | ------------------------------------- | -------------------------------------------------- |
| P2-001 | 集成内容增强服务 | `dimension-research.service.ts`       | 调用 `DataEnrichmentService.enrichSearchResults()` |
| P2-002 | 研究深度配置类型 | 新建 `types/research-config.types.ts` | 定义 `ResearchDepth` 和配置                        |
| P2-003 | DTO 扩展         | `trigger-refresh.dto.ts`              | 添加 `researchDepth` 参数                          |
| P2-004 | 前端配置 UI      | `TopicSettings.tsx`                   | 研究深度选择器                                     |

### Phase 3: 架构优化 (可选)

| ID     | 任务           | 文件                                        | 改动                 |
| ------ | -------------- | ------------------------------------------- | -------------------- |
| P3-001 | 研究质量评估器 | 新建 `research-quality-assessor.service.ts` | AI 评估覆盖度        |
| P3-002 | 迭代搜索       | `dimension-research.service.ts`             | 根据评估结果迭代搜索 |

---

## 5. 验收标准

### 5.1 功能验收

- [ ] 政策维度的链接 80%+ 指向具体文章而非列表页
- [ ] 每个维度平均来源数 ≥ 15
- [ ] 内容增强后平均内容长度 ≥ 1500 字/来源
- [ ] URL 有效率 ≥ 95%

### 5.2 质量指标

| 指标       | 修复前     | 目标        |
| ---------- | ---------- | ----------- |
| 来源精准度 | ~40%       | >80%        |
| 内容丰富度 | 200字/来源 | 1500字/来源 |
| 来源数量   | 5-10       | 15-25       |
| 覆盖度评分 | 未测量     | >75         |

---

## 6. 关键代码位置

| 模块       | 文件                                       | 说明                 |
| ---------- | ------------------------------------------ | -------------------- |
| 维度模板   | `topic-research.service.ts:60-173`         | 维度定义和搜索源配置 |
| 数据源路由 | `data-source-router.service.ts`            | 搜索执行和结果聚合   |
| 维度研究   | `dimension-research.service.ts`            | 主研究流程           |
| 内容增强   | `data-enrichment.service.ts`               | 已实现未调用         |
| 政策工具   | `tools/categories/information/policy/*.ts` | 已实现未启用         |

---

## 7. 风险与缓解

| 风险                 | 影响 | 缓解措施                |
| -------------------- | ---- | ----------------------- |
| API 限速             | 中   | 添加速率限制和重试      |
| 执行时间增加         | 中   | 并行执行，进度反馈      |
| 积分消耗增加         | 中   | 显示预估，用户确认      |
| Congress.gov API Key | 低   | 配置引导，fallback 机制 |

---

**最后更新**: 2026-01-21
