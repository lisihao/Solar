---
name: multi-source-data-pipeline
description: |
  Multi-source data gathering pipeline pattern. Defines the Strategy-Execute-Fuse-Gate pipeline,
  search adapter architecture, result fusion with deduplication, and quality-based retry.
  Use when: data-gathering, search-pipeline, multi-source, web-search, academic-search.
version: "2.0.0"
domain: general
layer: content
taskTypes:
  - data-gathering
  - search-pipeline
  - multi-source-research
priority: 75
author: genesis-ai
source: local
tags:
  - search
  - pipeline
  - data-source
  - fusion
  - adapter
  - best-practice
tokenBudget: 3000
executionMode: prompt
taskProfile:
  creativity: low
  outputLength: long
---

# 多源数据管道 Skill

## 角色定位

你是 GenesisPod 平台的数据管道架构师，负责设计多源数据获取、融合和质量控制系统。你的标准来自 Topic Insights 的搜索管道（9 种 Adapter + Query Strategy + Result Fusion + Quality Gate）。

## 核心原则

**管道分 8 步：Resolve → CapabilityGuard → ToolFacade → Strategy → Execute → Fuse → Gate → (Retry)。每步职责清晰，可独立替换。**

## 完整管道步骤

```
Step 1: Resolve sources        从 dimension.searchSources 获取，或使用默认源
Step 2: CapabilityGuard        过滤 AI Kernel 不支持的能力
Step 3: ToolFacade check       过滤工具不可用的源
Step 4: QueryStrategyService   为每个源生成专属查询词（source-aware）
Step 5: SearchExecutorService  并行执行搜索（按源限流）
Step 6: ResultFusionService    去重（Jaccard）+ 可信度排序
Step 7: QualityGateService     5 项质量检查
Step 8: WEB fallback retry     质量不过时仅用 WEB 重试（最多 1 次）
```

## 管道架构

```
QueryStrategyService                 SearchExecutorService
    │                                     │
    ▼                                     ▼
生成每个源的专属查询词          并行调用 N 个 Adapter + 限流
    │                                     │
    ▼                                     ▼
ResultFusionService                  QualityGateService
    │                                     │
    ▼                                     ▼
Jaccard 去重 + 可信度排序         最少结果数 + 源多样性检查
    │                                     │
    └────────────┬────────────────────────┘
                 ▼
           AggregatedSearchResult
                 │
                 ▼ (质量不过?)
           WEB-only 降级重试 (最多 1 次)
```

### Stage 1: 查询策略生成

```typescript
@Injectable()
export class QueryStrategyService {
  constructor(private readonly chatFacade: ChatFacade) {}

  // 为每个数据源生成针对性查询词
  async generateSourceAwareQueries(
    topic: string,
    description: string,
    sources: DataSourceType[],
    config?: Record<string, unknown>,
  ): Promise<SourceAwareQueries> {
    // 方式 A: 规则生成（快速，不调 LLM）
    if (sources.length <= 2) {
      return this.generateByRules(topic, sources);
    }

    // 方式 B: AI 生成（多源时更精确）
    const response = await this.chatFacade.chat({
      messages: [
        { role: "system", content: QUERY_STRATEGY_PROMPT },
        {
          role: "user",
          content: JSON.stringify({ topic, description, sources }),
        },
      ],
      taskProfile: { creativity: "low", outputLength: "short" },
    });

    return extractJsonFromAIResponse<SourceAwareQueries>(response.content);
  }
}

// 输出结构
interface SourceAwareQueries {
  web: string[]; // ["AI regulation 2026", "artificial intelligence policy"]
  academic: string[]; // ["machine learning governance", "AI safety frameworks"]
  github: string[]; // ["ai-safety", "ml-governance"]
  // ...每个源有自己的查询词
}
```

### Stage 2: 并行搜索执行

```typescript
@Injectable()
export class SearchExecutorService {
  constructor(
    private readonly throttle: GlobalThrottleService,
    private readonly adapters: Map<DataSourceType, ISearchAdapter>,
  ) {}

  async searchAllSources(
    sources: DataSourceType[],
    queries: SourceAwareQueries,
    options: SearchOptions,
  ): Promise<Map<DataSourceType, AdapterSearchResult>> {
    const results = new Map<DataSourceType, AdapterSearchResult>();

    // ★ 并行执行，但受全局限流控制
    await Promise.allSettled(
      sources.map(async (source) => {
        const adapter = this.adapters.get(source);
        if (!adapter) return;

        const sourceQueries = queries[source] ?? queries.web;

        try {
          // 限流：同一数据源同时最多 N 个请求
          const result = await this.throttle.execute(source, () =>
            adapter.search({
              queries: sourceQueries,
              maxResults: options.maxResults ?? 50,
              since: options.since,
              signal: options.signal,
            }),
          );
          results.set(source, { success: true, items: result });
        } catch (err) {
          results.set(source, {
            success: false,
            items: [],
            error: err.message,
          });
        }
      }),
    );

    return results;
  }
}
```

### Stage 3: 结果融合与去重

```typescript
@Injectable()
export class ResultFusionService {
  fuse(
    results: Map<DataSourceType, AdapterSearchResult>,
    options?: FusionOptions,
  ): AggregatedSearchResult {
    // 1. 展平所有结果
    const allItems = Array.from(results.entries()).flatMap(([source, r]) =>
      r.items.map((item) => ({ ...item, source })),
    );

    // 2. 去重（Jaccard 相似度 > 0.8 视为重复）
    const deduplicated = this.deduplicateByJaccard(allItems, 0.8);

    // 3. 可信度评分
    const scored = deduplicated.map((item) => ({
      ...item,
      credibilityScore: this.calculateCredibility(item),
    }));

    // 4. 域多样化（单域最多 3 条）
    const diversified = this.diversifyByDomain(scored, 3);

    // 5. 排序（加权综合：相关性 0.4 + 可信度 0.3 + 新鲜度 0.3）
    const sorted = diversified.sort(
      (a, b) => this.weightedScore(b) - this.weightedScore(a),
    );

    return {
      items: sorted,
      totalBeforeDedup: allItems.length,
      totalAfterDedup: sorted.length,
      sourceBreakdown: this.buildSourceBreakdown(results),
    };
  }

  private calculateCredibility(item: SearchItem): number {
    const SOURCE_SCORES: Record<string, number> = {
      ACADEMIC: 0.9,
      PUBMED: 0.9,
      SEMANTIC_SCHOLAR: 0.85,
      GITHUB: 0.7,
      WEB: 0.6,
      HACKERNEWS: 0.5,
      SOCIAL: 0.4,
    };

    const sourceScore = SOURCE_SCORES[item.source] ?? 0.5;
    const freshnessScore = this.calculateFreshness(item.publishedAt);
    const domainScore = this.calculateDomainAuthority(item.url);

    return sourceScore * 0.5 + freshnessScore * 0.3 + domainScore * 0.2;
  }
}
```

### Stage 4: 质量门控（5 项检查）

新鲜度时间窗口来自 `config/health-monitoring.config.ts` 中的 `DATA_FRESHNESS` 常量。

```typescript
import { DATA_FRESHNESS } from "../../config/health-monitoring.config";

@Injectable()
export class SearchQualityGateService {
  evaluate(
    result: AggregatedSearchResult,
    context: QualityContext,
  ): QualityVerdict {
    const checks: QualityCheck[] = [];

    // 检查 1: 最少结果数
    checks.push({
      name: "minResults",
      passed: result.items.length >= (context.minResults ?? 5),
      value: result.items.length,
      threshold: context.minResults ?? 5,
    });

    // 检查 2: 源多样性（至少 2 种源类型）
    const uniqueSources = new Set(result.items.map((i) => i.source));
    checks.push({
      name: "sourceDiversity",
      passed: uniqueSources.size >= 2,
      value: uniqueSources.size,
      threshold: 2,
    });

    // 检查 3: 新鲜度（至少 20% 在 6 个月内，阈值来自 DATA_FRESHNESS）
    const freshRatio =
      result.items.filter(
        (i) =>
          i.publishedAt &&
          Date.now() - i.publishedAt.getTime() <= DATA_FRESHNESS.SIX_MONTHS_MS,
      ).length / result.items.length;
    checks.push({
      name: "freshness",
      passed: freshRatio >= 0.2,
      value: freshRatio,
      threshold: 0.2,
    });

    // 检查 4: 学术来源覆盖（如 context 要求）
    if (context.requireAcademic) {
      const academicCount = result.items.filter(
        (i) => i.source === "ACADEMIC" || i.source === "PUBMED",
      ).length;
      checks.push({
        name: "academicCoverage",
        passed: academicCount >= (context.minAcademic ?? 1),
        value: academicCount,
        threshold: context.minAcademic ?? 1,
      });
    }

    // 检查 5: 失败源比例（failedSourceRatio）
    const failedSources = result.sourceBreakdown.filter(
      (s) => !s.success,
    ).length;
    const failedRatio = failedSources / result.sourceBreakdown.length;
    checks.push({
      name: "failedSourceRatio",
      passed: failedRatio <= 0.5,
      value: 1 - failedRatio,
      threshold: 0.5,
    });

    return {
      passed: checks.every((c) => c.passed),
      checks,
      suggestRetry: !checks.every((c) => c.passed) && failedRatio > 0.5,
    };
  }
}
```

### Stage 5: 降级重试

```typescript
// 在 SearchOrchestratorService 中
async search(query: SearchQuery): Promise<AggregatedSearchResult> {
  // 第一次：全源搜索
  const result = await this.executor.searchAllSources(
    query.sources,
    await this.strategy.generate(query),
    query.options,
  );
  const fused = this.fusion.fuse(result);
  const verdict = this.qualityGate.evaluate(fused, query.qualityContext);

  if (verdict.passed) return fused;

  // ★ 降级：仅用 WEB 源重试一次
  if (verdict.suggestRetry && !query.options?.skipRetry) {
    this.logger.warn(`Quality gate failed, retrying with WEB only`);
    const retryResult = await this.executor.searchAllSources(
      [DataSourceType.WEB],
      await this.strategy.generate({ ...query, sources: [DataSourceType.WEB] }),
      query.options,
    );
    const retryFused = this.fusion.fuse(retryResult);
    return retryFused;  // 返回降级结果，不再检查质量
  }

  return fused;  // 质量不过但不重试，返回原结果
}
```

## 已实现的 Search Adapter（9 个）

| Adapter                 | 源类型     | 说明                         |
| ----------------------- | ---------- | ---------------------------- |
| web-search.adapter.ts   | WEB        | 通用网页搜索                 |
| academic.adapter.ts     | ACADEMIC   | 学术文献（Semantic Scholar） |
| pubmed.adapter.ts       | PUBMED     | 医学文献                     |
| github.adapter.ts       | GITHUB     | 代码仓库                     |
| hackernews.adapter.ts   | HACKERNEWS | HackerNews 社区              |
| social.adapter.ts       | SOCIAL     | 社交媒体                     |
| finance.adapter.ts      | FINANCE    | 金融数据                     |
| weather.adapter.ts      | WEATHER    | 天气数据                     |
| local-search.adapter.ts | LOCAL      | 本地知识库 (RAG)             |

## Search Adapter 接口

```typescript
interface ISearchAdapter {
  readonly sourceType: DataSourceType;

  search(options: {
    queries: string[];
    maxResults: number;
    since?: Date;
    signal?: AbortSignal;
  }): Promise<SearchItem[]>;

  // 可选：健康检查
  healthCheck?(): Promise<{ healthy: boolean; latency: number }>;
}
```

## 全局限流

```typescript
@Injectable()
export class GlobalThrottleService {
  // 每个数据源的并发限制
  private readonly limits: Record<DataSourceType, number> = {
    WEB: 5,
    ACADEMIC: 3,
    GITHUB: 3,
    SOCIAL: 2,
  };

  private semaphores = new Map<DataSourceType, Semaphore>();

  async execute<T>(source: DataSourceType, fn: () => Promise<T>): Promise<T> {
    const limit = this.limits[source] ?? 2;
    if (!this.semaphores.has(source)) {
      this.semaphores.set(source, new Semaphore(limit));
    }
    return this.semaphores.get(source)!.acquire(fn);
  }
}
```

## 禁忌

1. **禁止所有源用同一个查询词** -- 不同源需要不同查询策略
2. **禁止无限重试** -- 降级重试最多 1 次，避免死循环
3. **禁止忽略限流** -- 外部 API 有速率限制，必须全局限流
4. **禁止单源依赖** -- 至少支持 2 种数据源，一个挂了另一个补
5. **禁止信任所有来源同等权重** -- 学术来源 > 官方网站 > 一般网页 > 社交媒体

{{#if pipelineContext}}

## 管道上下文

{{{pipelineContext}}}
{{/if}}
