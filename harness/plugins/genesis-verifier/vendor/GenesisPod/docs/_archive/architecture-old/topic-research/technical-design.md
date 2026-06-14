# Topic Research Module - Technical Design Document

> **Version**: 1.0
> **Author**: Architect Agent
> **Created**: 2026-01-11
> **Status**: Draft

---

## Document Information

| Item           | Value                                                                |
| -------------- | -------------------------------------------------------------------- |
| Module         | topic-research                                                       |
| English Name   | Topic Research                                                       |
| Chinese Name   | 专题研究                                                             |
| Dependencies   | AI Engine Teams, AI Engine Search, AI Engine LLM, Ingestion Crawlers |
| Key References | AI Teams, AI Writing, Deep Research                                  |

---

## 1. Architecture Overview

### 1.1 System Architecture Diagram

```
+==============================================================================+
|                           Frontend Layer                                       |
|  +------------------+  +------------------+  +------------------+              |
|  | TopicListPage    |  | TopicWorkspace   |  | ReportViewer     |              |
|  | /topic-research  |  | /topic-research/ |  | (with Evidence   |              |
|  |                  |  |    [topicId]     |  |  Panel)          |              |
|  +------------------+  +------------------+  +------------------+              |
+==============================================================================+
                                  |
                                  | REST API / SSE / WebSocket
                                  v
+==============================================================================+
|                         Backend: AI App Layer                                  |
|  +-------------------------------------------------------------------+        |
|  |                    TopicResearchModule                             |        |
|  |  +---------------------------+  +---------------------------+      |        |
|  |  | TopicResearchController   |  | TopicResearchGateway      |      |        |
|  |  | (REST + SSE)              |  | (WebSocket)               |      |        |
|  |  +---------------------------+  +---------------------------+      |        |
|  |               |                           |                        |        |
|  |               v                           v                        |        |
|  |  +-------------------------------------------------------------------+      |
|  |  |                   TopicResearchService                            |      |
|  |  |  - Topic CRUD                                                     |      |
|  |  |  - Report Management                                              |      |
|  |  |  - Refresh Orchestration                                          |      |
|  |  +-------------------------------------------------------------------+      |
|  |               |                                                      |      |
|  |  +------------+------------+-------------+-------------+             |      |
|  |  |            |            |             |             |             |      |
|  |  v            v            v             v             v             |      |
|  | +-----------+ +-----------+ +-----------+ +-----------+ +-----------+|      |
|  | |TopicTeam  | |DataSource | |Dimension  | |Report     | |Topic      ||      |
|  | |Orchestr.  | |Router     | |Research   | |Synthesis  | |Refresh    ||      |
|  | |           | |Service    | |Service    | |Service    | |Scheduler  ||      |
|  | +-----------+ +-----------+ +-----------+ +-----------+ +-----------+|      |
|  +-------------------------------------------------------------------+        |
+==============================================================================+
                                  |
                                  v
+==============================================================================+
|                      AI Engine Layer (Reuse)                                   |
|  +-------------+  +-------------+  +-------------+  +-------------+           |
|  | AI Teams    |  | Search      |  | LLM         |  | Constraint  |           |
|  | Framework   |  | Service     |  | Service     |  | Engine      |           |
|  +-------------+  +-------------+  +-------------+  +-------------+           |
|                                                                                |
|  +-------------+  +-------------+  +-------------+  +-------------+           |
|  | Research    |  | RAG         |  | Circuit     |  | Context     |           |
|  | Team Tpl    |  | Service     |  | Breaker     |  | Init Svc    |           |
|  +-------------+  +-------------+  +-------------+  +-------------+           |
+==============================================================================+
                                  |
                                  v
+==============================================================================+
|                       Data Sources Layer                                       |
|  +----------+  +----------+  +----------+  +----------+  +----------+         |
|  | Tavily/  |  | ArXiv    |  | GitHub   |  | Hacker   |  | RSS      |         |
|  | Serper   |  | Service  |  | Service  |  | News     |  | Service  |         |
|  | (Search) |  |          |  |          |  | Service  |  |          |         |
|  +----------+  +----------+  +----------+  +----------+  +----------+         |
|                                                                                |
|  +-----------------------------------+  +-----------------------------------+  |
|  |       Local Resource Library      |  |       Web Scraper Tool           |  |
|  |  (PostgreSQL + MongoDB via RAG)   |  |  (URL Content Extraction)        |  |
|  +-----------------------------------+  +-----------------------------------+  |
+==============================================================================+
                                  |
                                  v
+==============================================================================+
|                          Data Layer                                            |
|  +----------------+  +----------------+  +----------------+                    |
|  | ResearchTopic  |  | TopicDimension |  | TopicReport    |                    |
|  +----------------+  +----------------+  +----------------+                    |
|  +----------------+  +----------------+  +----------------+                    |
|  | TopicEvidence  |  | TopicSchedule  |  | TopicRefreshLog|                    |
|  +----------------+  +----------------+  +----------------+                    |
|  +----------------+                                                            |
|  | DimensionAna.  |   PostgreSQL (structured) + MongoDB (raw evidence)        |
|  +----------------+                                                            |
+==============================================================================+
```

### 1.2 Core Design Principles

1. **Reuse AI Engine Teams**: Topic Research Team is a predefined team template, leveraging existing AI Teams orchestration capabilities
2. **DataSourceRouter Pattern**: Intelligent routing based on dimension type and topic type
3. **NotebookLM-style Citations**: Every claim must be backed by traceable evidence
4. **Incremental Refresh**: Smart detection of changes to minimize redundant processing
5. **Event-Driven Architecture**: SSE for streaming progress, WebSocket for real-time notifications

---

## 2. Backend Module Design

### 2.1 Directory Structure

```
backend/src/modules/ai-app/topic-research/
+-- topic-research.module.ts            # Module definition
+-- topic-research.controller.ts        # REST API + SSE endpoints
+-- topic-research.gateway.ts           # WebSocket gateway
|
+-- services/
|   +-- index.ts                        # Service exports
|   +-- topic-research.service.ts       # Main service (CRUD + orchestration)
|   +-- topic-team-orchestrator.ts      # AI Team lifecycle management
|   +-- topic-refresh.scheduler.ts      # Cron-based refresh scheduler
|   +-- dimension-research.service.ts   # Per-dimension research execution
|   +-- data-source-router.service.ts   # Data source routing logic
|   +-- report-synthesis.service.ts     # Report generation with citations
|   +-- evidence-management.service.ts  # Evidence CRUD and deduplication
|   +-- incremental-refresh.service.ts  # Change detection and delta refresh
|
+-- dto/
|   +-- index.ts
|   +-- create-topic.dto.ts             # Topic creation DTO
|   +-- update-topic.dto.ts             # Topic update DTO
|   +-- trigger-refresh.dto.ts          # Manual refresh trigger DTO
|   +-- dimension-config.dto.ts         # Dimension configuration DTO
|   +-- topic-query.dto.ts              # Query/filter DTO
|
+-- types/
|   +-- index.ts
|   +-- research-types.ts               # Core type definitions
|   +-- dimension-config.ts             # Dimension templates by topic type
|   +-- data-source-mapping.ts          # Dimension -> data source mapping
|   +-- sse-events.ts                   # SSE event types
|
+-- prompts/
|   +-- index.ts
|   +-- research-lead.prompt.ts         # Research Lead system prompt
|   +-- research-analyst.prompt.ts      # Research Analyst prompts
|   +-- synthesis.prompt.ts             # Report synthesis prompts
|   +-- dimension-specific/             # Per-dimension prompts
|       +-- policy.prompt.ts
|       +-- market.prompt.ts
|       +-- technology.prompt.ts
|       +-- company.prompt.ts
|
+-- templates/
|   +-- index.ts
|   +-- macro-insight.template.ts       # Macro Insight dimension template
|   +-- tech-insight.template.ts        # Tech Insight dimension template
|   +-- company-insight.template.ts     # Company Insight dimension template
|
+-- events/
|   +-- topic-event-emitter.service.ts  # Event emission for WebSocket
```

### 2.2 Core Service Classes

#### 2.2.1 TopicResearchService (Main Service)

```typescript
/**
 * Topic Research Service
 * Main service for topic CRUD, refresh orchestration, and report management
 */
@Injectable()
export class TopicResearchService {
  private readonly logger = new Logger(TopicResearchService.name);

  constructor(
    private prisma: PrismaService,
    private teamOrchestrator: TopicTeamOrchestrator,
    private dataSourceRouter: DataSourceRouterService,
    private reportSynthesizer: ReportSynthesisService,
    private evidenceService: EvidenceManagementService,
    private eventEmitter: TopicEventEmitterService,
  ) {}

  // ==================== Topic CRUD ====================

  async createTopic(
    userId: string,
    dto: CreateTopicDto,
  ): Promise<ResearchTopic> {
    // 1. Create topic record
    // 2. Initialize dimensions based on topic type
    // 3. Optionally trigger initial research
  }

  async updateTopic(
    topicId: string,
    dto: UpdateTopicDto,
  ): Promise<ResearchTopic> {
    // Update topic metadata and configuration
  }

  async deleteTopic(topicId: string): Promise<void> {
    // Cascade delete: dimensions, reports, evidence, schedules
  }

  // ==================== Refresh Orchestration ====================

  async triggerRefresh(
    topicId: string,
    options: TriggerRefreshDto,
  ): Observable<RefreshProgressEvent> {
    // Returns SSE stream for progress tracking
  }

  async triggerDimensionRefresh(
    topicId: string,
    dimensionId: string,
  ): Observable<RefreshProgressEvent> {
    // Refresh single dimension
  }

  // ==================== Report Management ====================

  async getLatestReport(topicId: string): Promise<TopicReport | null> {}
  async getReportByVersion(
    topicId: string,
    version: number,
  ): Promise<TopicReport> {}
  async listReports(topicId: string): Promise<TopicReport[]> {}
  async compareReports(
    topicId: string,
    v1: number,
    v2: number,
  ): Promise<ReportDiff> {}
}
```

#### 2.2.2 TopicTeamOrchestrator

```typescript
/**
 * Topic Team Orchestrator
 * Manages AI Team lifecycle for topic research
 * Bridges Topic Research with AI Engine Teams
 */
@Injectable()
export class TopicTeamOrchestrator {
  private readonly logger = new Logger(TopicTeamOrchestrator.name);

  constructor(
    private prisma: PrismaService,
    private teamsService: TeamsService, // AI Engine Teams
    private aiChatService: AiChatService, // AI Engine LLM
    private constraintEngine: ConstraintEngine, // AI Engine Constraint
    private dimensionService: DimensionResearchService,
    private eventEmitter: TopicEventEmitterService,
  ) {}

  /**
   * Execute full topic research
   * Creates a virtual AI Team for the research task
   */
  async executeResearch(
    topic: ResearchTopic,
    dimensions: TopicDimension[],
    options: ResearchExecutionOptions,
  ): AsyncGenerator<ResearchProgressEvent> {
    // 1. Create research mission with constraint profile
    // 2. Execute dimension research in parallel (with concurrency limit)
    // 3. Synthesize final report
    // 4. Quality review by Research Lead
  }

  /**
   * Create Team Config for Topic Research
   * Based on RESEARCH_TEAM_CONFIG from AI Engine
   */
  private createTopicResearchTeamConfig(topic: ResearchTopic): TeamConfig {
    return {
      id: `topic-research-${topic.id}`,
      name: `${topic.name} Research Team`,
      type: "predefined",
      leaderRoleId: BUILTIN_ROLES.RESEARCH_LEAD,
      memberRoles: [
        { roleId: BUILTIN_ROLES.RESEARCHER, minCount: 2, maxCount: 4 },
        { roleId: BUILTIN_ROLES.ANALYST, minCount: 1, maxCount: 1 },
        { roleId: BUILTIN_ROLES.WRITER, minCount: 1, maxCount: 1 },
      ],
      constraintProfile: createConstraintProfile("thorough", {
        quality: {
          accuracy: "require_evidence",
          reviewRequired: true,
          minReviewScore: 8,
        },
      }),
      // ... other config
    };
  }

  /**
   * Execute dimension research tasks in parallel
   * Uses DAG executor pattern from AI Engine
   */
  private async executeDimensionTasks(
    topic: ResearchTopic,
    dimensions: TopicDimension[],
  ): Promise<DimensionAnalysis[]> {
    const concurrencyLimit = 3; // Max parallel dimension researches

    return mapWithConcurrency(
      dimensions.filter((d) => d.isEnabled),
      async (dimension) =>
        this.dimensionService.researchDimension(topic, dimension),
      concurrencyLimit,
    );
  }
}
```

#### 2.2.3 DataSourceRouterService

```typescript
/**
 * Data Source Router Service
 * Routes dimension research requests to appropriate data sources
 */
@Injectable()
export class DataSourceRouterService {
  private readonly logger = new Logger(DataSourceRouterService.name);

  constructor(
    private searchService: SearchService, // AI Engine Search (Tavily/Serper)
    private arxivService: ArxivService, // Ingestion Crawlers
    private githubService: GithubService, // Ingestion Crawlers
    private hackernewsService: HackernewsService, // Ingestion Crawlers
    private rssService: RssService, // Ingestion Crawlers
    private webScraperService: WebScraperService, // Ingestion Crawlers
    private ragService: RagService, // AI Engine RAG (Local DB)
  ) {}

  /**
   * Search across multiple data sources based on dimension config
   */
  async searchForDimension(
    topic: ResearchTopic,
    dimension: TopicDimension,
    options?: SearchOptions,
  ): Promise<AggregatedSearchResult> {
    // 1. Get data source config for dimension
    const sourceConfig = this.getSourceConfig(topic.type, dimension.name);

    // 2. Execute searches in parallel
    const searchPromises: Promise<SourceSearchResult>[] = [];

    for (const source of sourceConfig.primarySources) {
      searchPromises.push(this.searchSource(source, topic, dimension, options));
    }

    // 3. Aggregate and deduplicate results
    const results = await Promise.allSettled(searchPromises);
    return this.aggregateResults(results, sourceConfig);
  }

  /**
   * Get data source configuration for dimension
   */
  private getSourceConfig(
    topicType: ResearchTopicType,
    dimensionName: string,
  ): DimensionSourceConfig {
    return (
      DIMENSION_SOURCE_MAPPING[topicType][dimensionName] ||
      DEFAULT_SOURCE_CONFIG
    );
  }

  /**
   * Execute search on specific source
   */
  private async searchSource(
    source: DataSourceType,
    topic: ResearchTopic,
    dimension: TopicDimension,
    options?: SearchOptions,
  ): Promise<SourceSearchResult> {
    const query = this.buildSearchQuery(topic, dimension);

    switch (source) {
      case "web":
        return this.searchService.search(query, options?.maxResults || 10);
      case "arxiv":
        return this.arxivService.searchPapers(query, options?.maxResults || 10);
      case "github":
        return this.githubService.searchRepositories(
          query,
          options?.maxResults || 10,
        );
      case "hackernews":
        return this.hackernewsService.searchStories(
          query,
          options?.maxResults || 10,
        );
      case "local":
        return this.ragService.search(query, {
          limit: options?.maxResults || 10,
        });
      default:
        throw new Error(`Unknown data source: ${source}`);
    }
  }

  /**
   * Aggregate and deduplicate search results
   */
  private aggregateResults(
    results: PromiseSettledResult<SourceSearchResult>[],
    config: DimensionSourceConfig,
  ): AggregatedSearchResult {
    const allResults: SearchResultItem[] = [];
    const seenUrls = new Set<string>();
    const seenTitles = new Map<string, number>(); // title -> similarity threshold

    for (const result of results) {
      if (result.status === "fulfilled") {
        for (const item of result.value.items) {
          // URL deduplication
          const normalizedUrl = this.normalizeUrl(item.url);
          if (seenUrls.has(normalizedUrl)) continue;

          // Title similarity deduplication
          if (this.isTitleSimilar(item.title, seenTitles)) continue;

          seenUrls.add(normalizedUrl);
          seenTitles.set(item.title.toLowerCase(), 0.9);
          allResults.push(item);
        }
      }
    }

    // Sort by credibility score
    return {
      items: allResults.sort(
        (a, b) =>
          this.calculateCredibilityScore(b) - this.calculateCredibilityScore(a),
      ),
      totalCount: allResults.length,
      sources: config.primarySources,
    };
  }

  /**
   * Calculate credibility score for a search result
   * Based on: domain authority, source type, recency, content depth
   */
  private calculateCredibilityScore(item: SearchResultItem): number {
    let score = 0;

    // Domain authority (30%)
    score += this.getDomainAuthorityScore(item.domain) * 0.3;

    // Source type (25%): academic > official > news > blog
    score += this.getSourceTypeScore(item.sourceType) * 0.25;

    // Recency (20%)
    score += this.getRecencyScore(item.publishedAt) * 0.2;

    // Content depth (15%)
    score += this.getContentDepthScore(item.content?.length || 0) * 0.15;

    // Citation count if available (10%)
    score += this.getCitationScore(item.citationCount) * 0.1;

    return score;
  }
}
```

### 2.3 Dependency Injection Graph

```
TopicResearchModule
    |
    +-- TopicResearchController
    |       +-- TopicResearchService
    |       +-- TopicRefreshScheduler
    |
    +-- TopicResearchGateway
    |       +-- TopicEventEmitterService
    |
    +-- TopicResearchService
    |       +-- PrismaService
    |       +-- TopicTeamOrchestrator
    |       +-- DataSourceRouterService
    |       +-- ReportSynthesisService
    |       +-- EvidenceManagementService
    |       +-- TopicEventEmitterService
    |
    +-- TopicTeamOrchestrator
    |       +-- PrismaService
    |       +-- TeamsService (AI Engine)
    |       +-- AiChatService (AI Engine)
    |       +-- ConstraintEngine (AI Engine)
    |       +-- DimensionResearchService
    |       +-- TopicEventEmitterService
    |
    +-- DataSourceRouterService
    |       +-- SearchService (AI Engine)
    |       +-- ArxivService (Ingestion)
    |       +-- GithubService (Ingestion)
    |       +-- HackernewsService (Ingestion)
    |       +-- RssService (Ingestion)
    |       +-- WebScraperService (Ingestion)
    |       +-- RagService (AI Engine)
    |
    +-- DimensionResearchService
    |       +-- AiChatService (AI Engine)
    |       +-- DataSourceRouterService
    |       +-- EvidenceManagementService
    |
    +-- ReportSynthesisService
    |       +-- AiChatService (AI Engine)
    |       +-- EvidenceManagementService
    |
    +-- TopicRefreshScheduler
    |       +-- PrismaService
    |       +-- TopicResearchService
    |       +-- IncrementalRefreshService
    |
    +-- IncrementalRefreshService
            +-- PrismaService
            +-- DataSourceRouterService
```

---

## 3. Data Source Routing Design

### 3.1 Dimension to Data Source Mapping

```typescript
// types/data-source-mapping.ts

export type DataSourceType =
  | "web" // Tavily/Serper web search
  | "arxiv" // ArXiv academic papers
  | "scholar" // Semantic Scholar
  | "github" // GitHub repositories
  | "hackernews" // HackerNews stories
  | "rss" // RSS feeds
  | "local" // Local resource library (RAG)
  | "scraper"; // URL content scraper

export interface DimensionSourceConfig {
  primarySources: DataSourceType[];
  secondarySources: DataSourceType[];
  searchStrategy: "parallel" | "sequential" | "waterfall";
  minSourceCount: number;
  maxResultsPerSource: number;
  freshnessRequirement: "recent" | "standard" | "archival";
}

// ==================== MACRO INSIGHT MAPPING ====================
export const MACRO_INSIGHT_SOURCE_MAPPING: Record<
  string,
  DimensionSourceConfig
> = {
  policy: {
    primarySources: ["web", "local"],
    secondarySources: ["rss"],
    searchStrategy: "parallel",
    minSourceCount: 5,
    maxResultsPerSource: 10,
    freshnessRequirement: "recent",
  },
  market: {
    primarySources: ["web", "local"],
    secondarySources: ["rss"],
    searchStrategy: "parallel",
    minSourceCount: 5,
    maxResultsPerSource: 10,
    freshnessRequirement: "recent",
  },
  competition: {
    primarySources: ["web", "local"],
    secondarySources: ["hackernews"],
    searchStrategy: "parallel",
    minSourceCount: 5,
    maxResultsPerSource: 10,
    freshnessRequirement: "standard",
  },
  technology: {
    primarySources: ["arxiv", "scholar"],
    secondarySources: ["github", "hackernews", "web"],
    searchStrategy: "parallel",
    minSourceCount: 5,
    maxResultsPerSource: 10,
    freshnessRequirement: "standard",
  },
  investment: {
    primarySources: ["web"],
    secondarySources: ["local", "rss"],
    searchStrategy: "parallel",
    minSourceCount: 5,
    maxResultsPerSource: 10,
    freshnessRequirement: "recent",
  },
  talent: {
    primarySources: ["web"],
    secondarySources: ["arxiv", "github"],
    searchStrategy: "parallel",
    minSourceCount: 3,
    maxResultsPerSource: 8,
    freshnessRequirement: "standard",
  },
  international: {
    primarySources: ["web"],
    secondarySources: ["local", "rss"],
    searchStrategy: "parallel",
    minSourceCount: 5,
    maxResultsPerSource: 10,
    freshnessRequirement: "recent",
  },
  application: {
    primarySources: ["web", "hackernews"],
    secondarySources: ["github"],
    searchStrategy: "parallel",
    minSourceCount: 5,
    maxResultsPerSource: 10,
    freshnessRequirement: "standard",
  },
};

// ==================== TECH INSIGHT MAPPING ====================
export const TECH_INSIGHT_SOURCE_MAPPING: Record<
  string,
  DimensionSourceConfig
> = {
  principles: {
    primarySources: ["arxiv", "scholar"],
    secondarySources: ["web"],
    searchStrategy: "parallel",
    minSourceCount: 5,
    maxResultsPerSource: 10,
    freshnessRequirement: "archival",
  },
  frontier: {
    primarySources: ["arxiv", "scholar"],
    secondarySources: ["github", "hackernews"],
    searchStrategy: "parallel",
    minSourceCount: 5,
    maxResultsPerSource: 10,
    freshnessRequirement: "recent",
  },
  players: {
    primarySources: ["arxiv", "github"],
    secondarySources: ["web"],
    searchStrategy: "parallel",
    minSourceCount: 5,
    maxResultsPerSource: 10,
    freshnessRequirement: "standard",
  },
  patents: {
    primarySources: ["web"],
    secondarySources: ["arxiv", "scholar"],
    searchStrategy: "sequential",
    minSourceCount: 5,
    maxResultsPerSource: 10,
    freshnessRequirement: "standard",
  },
  applications: {
    primarySources: ["web", "github"],
    secondarySources: ["hackernews"],
    searchStrategy: "parallel",
    minSourceCount: 5,
    maxResultsPerSource: 10,
    freshnessRequirement: "standard",
  },
  commercialization: {
    primarySources: ["web"],
    secondarySources: ["github", "hackernews"],
    searchStrategy: "parallel",
    minSourceCount: 5,
    maxResultsPerSource: 10,
    freshnessRequirement: "recent",
  },
  challenges: {
    primarySources: ["arxiv", "web"],
    secondarySources: ["hackernews"],
    searchStrategy: "parallel",
    minSourceCount: 5,
    maxResultsPerSource: 10,
    freshnessRequirement: "standard",
  },
  roadmap: {
    primarySources: ["arxiv", "web"],
    secondarySources: ["rss"],
    searchStrategy: "parallel",
    minSourceCount: 5,
    maxResultsPerSource: 10,
    freshnessRequirement: "standard",
  },
};

// ==================== COMPANY INSIGHT MAPPING ====================
export const COMPANY_INSIGHT_SOURCE_MAPPING: Record<
  string,
  DimensionSourceConfig
> = {
  overview: {
    primarySources: ["web"],
    secondarySources: ["local"],
    searchStrategy: "parallel",
    minSourceCount: 3,
    maxResultsPerSource: 8,
    freshnessRequirement: "standard",
  },
  products: {
    primarySources: ["web"],
    secondarySources: ["hackernews", "github"],
    searchStrategy: "parallel",
    minSourceCount: 5,
    maxResultsPerSource: 10,
    freshnessRequirement: "standard",
  },
  businessModel: {
    primarySources: ["web", "local"],
    secondarySources: [],
    searchStrategy: "parallel",
    minSourceCount: 3,
    maxResultsPerSource: 8,
    freshnessRequirement: "standard",
  },
  financials: {
    primarySources: ["web"],
    secondarySources: ["local"],
    searchStrategy: "parallel",
    minSourceCount: 5,
    maxResultsPerSource: 10,
    freshnessRequirement: "recent",
  },
  technology: {
    primarySources: ["github", "arxiv"],
    secondarySources: ["scholar", "web"],
    searchStrategy: "parallel",
    minSourceCount: 5,
    maxResultsPerSource: 10,
    freshnessRequirement: "standard",
  },
  marketPosition: {
    primarySources: ["web", "local"],
    secondarySources: [],
    searchStrategy: "parallel",
    minSourceCount: 5,
    maxResultsPerSource: 10,
    freshnessRequirement: "standard",
  },
  strategy: {
    primarySources: ["web", "hackernews"],
    secondarySources: ["rss"],
    searchStrategy: "parallel",
    minSourceCount: 5,
    maxResultsPerSource: 10,
    freshnessRequirement: "recent",
  },
  swot: {
    // SWOT synthesizes from all other dimensions
    primarySources: [],
    secondarySources: [],
    searchStrategy: "parallel",
    minSourceCount: 0,
    maxResultsPerSource: 0,
    freshnessRequirement: "standard",
  },
};
```

### 3.2 Search Result Aggregation and Deduplication

```typescript
/**
 * 5-Layer Deduplication Strategy
 * Prevents duplicate content from different sources
 */
export class SearchResultDeduplicator {
  /**
   * Layer 1: Same source, same ID
   * e.g., same arXiv paper ID
   */
  private deduplicateSameSource(
    results: SearchResultItem[],
  ): SearchResultItem[] {
    const seen = new Map<string, SearchResultItem>();
    for (const item of results) {
      const key = `${item.source}:${item.externalId}`;
      if (!seen.has(key)) {
        seen.set(key, item);
      }
    }
    return Array.from(seen.values());
  }

  /**
   * Layer 2: Cross-source external ID match
   * e.g., DOI matching across arXiv and Semantic Scholar
   */
  private deduplicateCrossSourceId(
    results: SearchResultItem[],
  ): SearchResultItem[] {
    const seen = new Map<string, SearchResultItem>();
    for (const item of results) {
      if (item.externalId && !seen.has(item.externalId)) {
        seen.set(item.externalId, item);
      } else if (!item.externalId) {
        seen.set(`no-id-${results.indexOf(item)}`, item);
      }
    }
    return Array.from(seen.values());
  }

  /**
   * Layer 3: URL normalization and matching
   */
  private deduplicateByUrl(results: SearchResultItem[]): SearchResultItem[] {
    const seen = new Map<string, SearchResultItem>();
    for (const item of results) {
      const normalizedUrl = this.normalizeUrl(item.url);
      if (!seen.has(normalizedUrl)) {
        seen.set(normalizedUrl, item);
      }
    }
    return Array.from(seen.values());
  }

  /**
   * Layer 4: Title similarity (cosine similarity > 0.9)
   */
  private deduplicateByTitleSimilarity(
    results: SearchResultItem[],
    threshold: number = 0.9,
  ): SearchResultItem[] {
    const unique: SearchResultItem[] = [];

    for (const item of results) {
      const isDuplicate = unique.some(
        (existing) =>
          this.calculateTitleSimilarity(item.title, existing.title) >=
          threshold,
      );
      if (!isDuplicate) {
        unique.push(item);
      }
    }

    return unique;
  }

  /**
   * Layer 5: Content fingerprint (for scraped content)
   */
  private deduplicateByContentFingerprint(
    results: SearchResultItem[],
  ): SearchResultItem[] {
    const seen = new Map<string, SearchResultItem>();
    for (const item of results) {
      if (item.content) {
        const fingerprint = this.generateContentFingerprint(item.content);
        if (!seen.has(fingerprint)) {
          seen.set(fingerprint, item);
        }
      } else {
        seen.set(`no-content-${results.indexOf(item)}`, item);
      }
    }
    return Array.from(seen.values());
  }

  /**
   * Apply all deduplication layers
   */
  deduplicate(results: SearchResultItem[]): SearchResultItem[] {
    let deduplicated = results;
    deduplicated = this.deduplicateSameSource(deduplicated);
    deduplicated = this.deduplicateCrossSourceId(deduplicated);
    deduplicated = this.deduplicateByUrl(deduplicated);
    deduplicated = this.deduplicateByTitleSimilarity(deduplicated);
    deduplicated = this.deduplicateByContentFingerprint(deduplicated);
    return deduplicated;
  }

  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Remove tracking params, normalize protocol
      parsed.searchParams.delete("utm_source");
      parsed.searchParams.delete("utm_medium");
      parsed.searchParams.delete("utm_campaign");
      return parsed.toString().replace(/\/$/, "").toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  }

  private calculateTitleSimilarity(title1: string, title2: string): number {
    // Simple Jaccard similarity for demonstration
    // In production, use more sophisticated methods
    const words1 = new Set(title1.toLowerCase().split(/\s+/));
    const words2 = new Set(title2.toLowerCase().split(/\s+/));
    const intersection = new Set([...words1].filter((w) => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    return intersection.size / union.size;
  }

  private generateContentFingerprint(content: string): string {
    // Simple fingerprint: first 100 chars + length
    const normalized = content.replace(/\s+/g, " ").trim();
    return `${normalized.slice(0, 100)}:${normalized.length}`;
  }
}
```

---

## 4. AI Team Integration Design

### 4.1 Topic Research Team Template

```typescript
// templates/topic-research-team.ts

import { TeamConfig, BUILTIN_TEAMS } from "@/modules/ai-engine/teams";
import { BUILTIN_ROLES } from "@/modules/ai-engine/teams/abstractions/role.interface";
import { WorkflowConfig } from "@/modules/ai-engine/teams/abstractions/workflow.interface";
import { createConstraintProfile } from "@/modules/ai-engine/teams/constraints/constraint-profile";

/**
 * Topic Research Team Workflow
 * Hybrid workflow: parallel dimension research + sequential synthesis
 */
export const TOPIC_RESEARCH_WORKFLOW: WorkflowConfig = {
  id: "topic-research-workflow",
  name: "Topic Research Workflow",
  type: "hybrid",
  steps: [
    {
      id: "scope_definition",
      name: "Scope Definition",
      description: "Define research scope and prioritize dimensions",
      type: "task",
      executorRoles: [BUILTIN_ROLES.RESEARCH_LEAD],
      parallel: false,
      dependsOn: [],
    },
    {
      id: "dimension_research",
      name: "Dimension Research",
      description: "Research each dimension in parallel",
      type: "task",
      executorRoles: [BUILTIN_ROLES.RESEARCHER],
      parallel: true,
      dependsOn: ["scope_definition"],
      // Dynamic: spawns N tasks based on enabled dimensions
    },
    {
      id: "data_analysis",
      name: "Data Analysis",
      description: "Analyze and synthesize collected data",
      type: "task",
      executorRoles: [BUILTIN_ROLES.ANALYST],
      parallel: false,
      dependsOn: ["dimension_research"],
    },
    {
      id: "report_drafting",
      name: "Report Drafting",
      description: "Draft research report with citations",
      type: "task",
      executorRoles: [BUILTIN_ROLES.WRITER],
      parallel: false,
      dependsOn: ["data_analysis"],
    },
    {
      id: "quality_review",
      name: "Quality Review",
      description: "Review report quality and evidence accuracy",
      type: "review",
      executorRoles: [BUILTIN_ROLES.RESEARCH_LEAD],
      parallel: false,
      dependsOn: ["report_drafting"],
      reviewConfig: {
        reviewerRole: BUILTIN_ROLES.RESEARCH_LEAD,
        criteria: [
          {
            name: "Evidence Quality",
            description: "All claims backed by credible sources",
            weight: 0.35,
          },
          {
            name: "Completeness",
            description: "All dimensions adequately covered",
            weight: 0.25,
          },
          {
            name: "Accuracy",
            description: "Information is factually correct",
            weight: 0.25,
          },
          {
            name: "Clarity",
            description: "Report is well-structured and readable",
            weight: 0.15,
          },
        ],
        passThreshold: 0.75,
        maxReworks: 2,
      },
    },
  ],
  timeout: 2 * 60 * 60 * 1000, // 2 hours
};

/**
 * Topic Research Team Configuration
 */
export const TOPIC_RESEARCH_TEAM_CONFIG: TeamConfig = {
  id: "topic-research" as any,
  name: "Topic Research",
  description: "Multi-dimensional topic analysis with evidence tracking",
  type: "predefined",
  icon: "book-open",
  color: "#3B82F6",
  leaderRoleId: BUILTIN_ROLES.RESEARCH_LEAD,
  memberRoles: [
    {
      roleId: BUILTIN_ROLES.RESEARCHER,
      minCount: 2,
      maxCount: 4,
      required: true,
    },
    {
      roleId: BUILTIN_ROLES.ANALYST,
      minCount: 1,
      maxCount: 1,
      required: true,
    },
    {
      roleId: BUILTIN_ROLES.WRITER,
      minCount: 1,
      maxCount: 1,
      required: true,
    },
  ],
  workflow: TOPIC_RESEARCH_WORKFLOW,
  availableSkills: [
    "research-planning",
    "information-retrieval",
    "source-validation",
    "data-analysis",
    "trend-insight",
    "content-creation",
    "citation-management",
    "quality-review",
  ],
  availableTools: [
    "web_search",
    "academic_search",
    "github_search",
    "news_search",
    "url_scraper",
    "rag_search",
    "data_analysis",
    "text_generation",
  ],
  constraintProfile: createConstraintProfile("thorough", {
    quality: {
      depth: "comprehensive",
      accuracy: "require_evidence",
      reviewRequired: true,
      minReviewScore: 7.5,
      maxReworks: 2,
    },
  }),
  deliverableTypes: [
    "research_report",
    "evidence_collection",
    "summary_highlights",
  ],
  metadata: {
    category: "research",
    typicalDuration: "30min-2h",
    suitableFor: ["Macro Insight", "Tech Insight", "Company Insight"],
  },
};
```

### 4.2 Task Breakdown Strategy

```typescript
/**
 * Task Breakdown Service
 * Converts topic research into executable tasks
 */
@Injectable()
export class TopicTaskBreakdownService {
  /**
   * Break down topic research into dimension tasks
   */
  breakdownIntoTasks(
    topic: ResearchTopic,
    dimensions: TopicDimension[],
  ): TaskBreakdownResult {
    const tasks: ResearchTask[] = [];

    // 1. Scope Definition Task (Research Lead)
    tasks.push({
      id: `${topic.id}-scope`,
      type: "scope_definition",
      title: `Define scope for ${topic.name}`,
      description: `Analyze topic configuration and define research boundaries`,
      assigneeRole: BUILTIN_ROLES.RESEARCH_LEAD,
      priority: TaskPriority.HIGH,
      estimatedDuration: 5 * 60 * 1000, // 5 minutes
      dependsOn: [],
    });

    // 2. Dimension Research Tasks (Researchers, Parallel)
    const enabledDimensions = dimensions.filter((d) => d.isEnabled);
    for (const dimension of enabledDimensions) {
      tasks.push({
        id: `${topic.id}-dim-${dimension.id}`,
        type: "dimension_research",
        title: `Research: ${dimension.name}`,
        description: `Collect and analyze information for ${dimension.name} dimension`,
        assigneeRole: BUILTIN_ROLES.RESEARCHER,
        priority: this.getDimensionPriority(dimension),
        estimatedDuration: 15 * 60 * 1000, // 15 minutes per dimension
        dependsOn: [`${topic.id}-scope`],
        metadata: {
          dimensionId: dimension.id,
          dimensionName: dimension.name,
          searchQueries: dimension.searchQueries,
          searchSources: dimension.searchSources,
        },
      });
    }

    // 3. Data Analysis Task (Analyst)
    tasks.push({
      id: `${topic.id}-analysis`,
      type: "data_analysis",
      title: `Analyze collected data for ${topic.name}`,
      description: `Synthesize findings across all dimensions`,
      assigneeRole: BUILTIN_ROLES.ANALYST,
      priority: TaskPriority.MEDIUM,
      estimatedDuration: 10 * 60 * 1000, // 10 minutes
      dependsOn: enabledDimensions.map((d) => `${topic.id}-dim-${d.id}`),
    });

    // 4. Report Drafting Task (Writer)
    tasks.push({
      id: `${topic.id}-report`,
      type: "report_drafting",
      title: `Draft report for ${topic.name}`,
      description: `Create comprehensive report with citations`,
      assigneeRole: BUILTIN_ROLES.WRITER,
      priority: TaskPriority.MEDIUM,
      estimatedDuration: 15 * 60 * 1000, // 15 minutes
      dependsOn: [`${topic.id}-analysis`],
    });

    // 5. Quality Review Task (Research Lead)
    tasks.push({
      id: `${topic.id}-review`,
      type: "quality_review",
      title: `Review report for ${topic.name}`,
      description: `Verify evidence quality and report accuracy`,
      assigneeRole: BUILTIN_ROLES.RESEARCH_LEAD,
      priority: TaskPriority.HIGH,
      estimatedDuration: 5 * 60 * 1000, // 5 minutes
      dependsOn: [`${topic.id}-report`],
    });

    return {
      tasks,
      executionPlan: this.buildExecutionPlan(tasks),
      estimatedTotalDuration: this.calculateTotalDuration(
        tasks,
        enabledDimensions.length,
      ),
    };
  }

  /**
   * Build execution plan (DAG-based)
   */
  private buildExecutionPlan(tasks: ResearchTask[]): ExecutionPlan {
    // Group tasks by parallelization opportunity
    return {
      phases: [
        {
          name: "Planning",
          tasks: tasks.filter((t) => t.type === "scope_definition"),
        },
        {
          name: "Research",
          tasks: tasks.filter((t) => t.type === "dimension_research"),
          parallel: true,
        },
        {
          name: "Analysis",
          tasks: tasks.filter((t) => t.type === "data_analysis"),
        },
        {
          name: "Writing",
          tasks: tasks.filter((t) => t.type === "report_drafting"),
        },
        {
          name: "Review",
          tasks: tasks.filter((t) => t.type === "quality_review"),
        },
      ],
    };
  }

  private getDimensionPriority(dimension: TopicDimension): TaskPriority {
    // Higher sort order = lower priority
    if (dimension.sortOrder <= 2) return TaskPriority.HIGH;
    if (dimension.sortOrder <= 5) return TaskPriority.MEDIUM;
    return TaskPriority.LOW;
  }

  private calculateTotalDuration(
    tasks: ResearchTask[],
    parallelDimensions: number,
  ): number {
    // Sequential tasks + parallel dimension research (use max)
    const sequentialDuration = tasks
      .filter((t) => t.type !== "dimension_research")
      .reduce((sum, t) => sum + t.estimatedDuration, 0);

    const maxDimensionDuration = Math.max(
      ...tasks
        .filter((t) => t.type === "dimension_research")
        .map((t) => t.estimatedDuration),
      0,
    );

    return sequentialDuration + maxDimensionDuration;
  }
}
```

### 4.3 Parallel Execution Strategy

```typescript
/**
 * Dimension Research Executor
 * Handles parallel dimension research with concurrency control
 */
@Injectable()
export class DimensionResearchExecutor {
  private readonly DEFAULT_CONCURRENCY = 3;
  private readonly MAX_CONCURRENCY = 5;

  constructor(
    private dimensionResearchService: DimensionResearchService,
    private eventEmitter: TopicEventEmitterService,
  ) {}

  /**
   * Execute dimension research tasks in parallel
   */
  async executeDimensionTasks(
    topic: ResearchTopic,
    tasks: ResearchTask[],
    options?: { concurrency?: number },
  ): Promise<DimensionAnalysis[]> {
    const concurrency = Math.min(
      options?.concurrency || this.DEFAULT_CONCURRENCY,
      this.MAX_CONCURRENCY,
    );

    const dimensionTasks = tasks.filter((t) => t.type === "dimension_research");

    // Emit start event
    this.eventEmitter.emit(topic.id, "research:dimension_batch_start", {
      totalDimensions: dimensionTasks.length,
      concurrency,
    });

    // Execute with concurrency control
    const results = await mapWithConcurrency(
      dimensionTasks,
      async (task, index) => {
        const startTime = Date.now();

        // Emit task start
        this.eventEmitter.emit(topic.id, "research:dimension_start", {
          dimensionId: task.metadata?.dimensionId,
          dimensionName: task.metadata?.dimensionName,
          taskIndex: index,
          totalTasks: dimensionTasks.length,
        });

        try {
          const result = await this.dimensionResearchService.researchDimension(
            topic,
            task.metadata?.dimensionId,
            {
              searchQueries: task.metadata?.searchQueries,
              searchSources: task.metadata?.searchSources,
            },
          );

          // Emit task complete
          this.eventEmitter.emit(topic.id, "research:dimension_complete", {
            dimensionId: task.metadata?.dimensionId,
            dimensionName: task.metadata?.dimensionName,
            sourcesFound: result.sourcesUsed,
            duration: Date.now() - startTime,
          });

          return result;
        } catch (error) {
          // Emit task error
          this.eventEmitter.emit(topic.id, "research:dimension_error", {
            dimensionId: task.metadata?.dimensionId,
            dimensionName: task.metadata?.dimensionName,
            error: error instanceof Error ? error.message : "Unknown error",
          });

          throw error;
        }
      },
      concurrency,
    );

    // Emit batch complete
    this.eventEmitter.emit(topic.id, "research:dimension_batch_complete", {
      totalDimensions: dimensionTasks.length,
      successCount: results.filter((r) => r !== null).length,
    });

    return results.filter((r): r is DimensionAnalysis => r !== null);
  }
}
```

---

## 5. Refresh Mechanism Design

### 5.1 Refresh Types

| Type                | Description                    | Trigger            | Use Case                      |
| ------------------- | ------------------------------ | ------------------ | ----------------------------- |
| Full Refresh        | Re-research all dimensions     | Manual / First run | Initial report, major updates |
| Incremental Refresh | Only update changed dimensions | Scheduled / Manual | Regular updates               |
| Dimension Refresh   | Refresh single dimension       | Manual             | Targeted update               |
| Evidence Refresh    | Re-validate existing evidence  | Background         | Data quality maintenance      |

### 5.2 Incremental Update Algorithm

```typescript
/**
 * Incremental Refresh Service
 * Detects changes and determines what needs updating
 */
@Injectable()
export class IncrementalRefreshService {
  private readonly logger = new Logger(IncrementalRefreshService.name);

  // Thresholds for change detection
  private readonly NEW_SOURCES_THRESHOLD = 3; // Min new sources to trigger refresh
  private readonly FRESHNESS_DAYS = 7; // Consider sources older than this stale
  private readonly SIMILARITY_THRESHOLD = 0.85; // Content similarity threshold

  constructor(
    private prisma: PrismaService,
    private dataSourceRouter: DataSourceRouterService,
  ) {}

  /**
   * Analyze what has changed since last refresh
   */
  async analyzeChanges(topic: ResearchTopic): Promise<RefreshPlan> {
    const lastReport = await this.getLatestReport(topic.id);

    if (!lastReport) {
      // No previous report, need full refresh
      return {
        type: "full",
        dimensionsToRefresh: topic.dimensions
          .filter((d) => d.isEnabled)
          .map((d) => d.id),
        reason: "No previous report exists",
      };
    }

    const dimensionChanges: DimensionChange[] = [];
    const lastRefreshDate = lastReport.generatedAt;

    for (const dimension of topic.dimensions.filter((d) => d.isEnabled)) {
      const change = await this.detectDimensionChanges(
        topic,
        dimension,
        lastRefreshDate,
      );
      if (change.hasChanges) {
        dimensionChanges.push(change);
      }
    }

    if (dimensionChanges.length === 0) {
      return {
        type: "none",
        dimensionsToRefresh: [],
        reason: "No significant changes detected",
      };
    }

    // Determine refresh type based on change scope
    const changeRatio =
      dimensionChanges.length /
      topic.dimensions.filter((d) => d.isEnabled).length;
    const refreshType = changeRatio > 0.5 ? "full" : "incremental";

    return {
      type: refreshType,
      dimensionsToRefresh: dimensionChanges.map((c) => c.dimensionId),
      changes: dimensionChanges,
      reason: `${dimensionChanges.length} dimensions have significant changes`,
    };
  }

  /**
   * Detect changes for a specific dimension
   */
  private async detectDimensionChanges(
    topic: ResearchTopic,
    dimension: TopicDimension,
    lastRefreshDate: Date,
  ): Promise<DimensionChange> {
    // 1. Search for new sources since last refresh
    const newSources = await this.dataSourceRouter.searchForDimension(
      topic,
      dimension,
      {
        since: lastRefreshDate,
        maxResults: 20,
      },
    );

    // 2. Check if we have enough new sources
    const significantNewSources = newSources.items.filter(
      (s) => s.publishedAt && new Date(s.publishedAt) > lastRefreshDate,
    );

    const hasSignificantChanges =
      significantNewSources.length >= this.NEW_SOURCES_THRESHOLD;

    // 3. Check existing evidence freshness
    const existingEvidence = await this.prisma.topicEvidence.findMany({
      where: {
        analysis: {
          dimensionId: dimension.id,
        },
      },
      orderBy: { publishedAt: "desc" },
    });

    const staleEvidence = existingEvidence.filter((e) => {
      if (!e.publishedAt) return true;
      const daysSincePublished =
        (Date.now() - e.publishedAt.getTime()) / (1000 * 60 * 60 * 24);
      return daysSincePublished > this.FRESHNESS_DAYS;
    });

    const staleProportion =
      existingEvidence.length > 0
        ? staleEvidence.length / existingEvidence.length
        : 0;

    return {
      dimensionId: dimension.id,
      dimensionName: dimension.name,
      hasChanges: hasSignificantChanges || staleProportion > 0.5,
      newSourceCount: significantNewSources.length,
      staleSourceCount: staleEvidence.length,
      changeReason: hasSignificantChanges
        ? `${significantNewSources.length} new sources found`
        : staleProportion > 0.5
          ? `${Math.round(staleProportion * 100)}% of evidence is stale`
          : "No significant changes",
    };
  }

  /**
   * Execute incremental refresh
   */
  async executeIncrementalRefresh(
    topic: ResearchTopic,
    plan: RefreshPlan,
  ): Promise<TopicReport> {
    const lastReport = await this.getLatestReport(topic.id);

    if (!lastReport) {
      throw new Error("Cannot do incremental refresh without previous report");
    }

    // 1. Research only changed dimensions
    const newAnalyses: DimensionAnalysis[] = [];
    for (const dimensionId of plan.dimensionsToRefresh) {
      const dimension = topic.dimensions.find((d) => d.id === dimensionId);
      if (dimension) {
        const analysis = await this.dimensionResearchService.researchDimension(
          topic,
          dimension,
        );
        newAnalyses.push(analysis);
      }
    }

    // 2. Copy unchanged dimension analyses from last report
    const unchangedAnalyses = lastReport.dimensionAnalyses.filter(
      (a) => !plan.dimensionsToRefresh.includes(a.dimensionId),
    );

    // 3. Synthesize new report
    const allAnalyses = [...unchangedAnalyses, ...newAnalyses];

    return this.reportSynthesizer.synthesizeReport(topic, allAnalyses, {
      isIncremental: true,
      previousVersion: lastReport.version,
      changesFromPrev: plan.changes,
    });
  }

  private async getLatestReport(topicId: string): Promise<TopicReport | null> {
    return this.prisma.topicReport.findFirst({
      where: { topicId },
      orderBy: { version: "desc" },
      include: {
        dimensionAnalyses: {
          include: {
            evidences: true,
          },
        },
      },
    });
  }
}
```

### 5.3 Scheduler Implementation

```typescript
/**
 * Topic Refresh Scheduler
 * Cron-based scheduling for automatic topic refreshes
 */
@Injectable()
export class TopicRefreshScheduler implements OnModuleInit {
  private readonly logger = new Logger(TopicRefreshScheduler.name);

  constructor(
    private prisma: PrismaService,
    private topicService: TopicResearchService,
    private incrementalService: IncrementalRefreshService,
  ) {}

  async onModuleInit() {
    // Recover any failed scheduled refreshes on startup
    await this.recoverFailedRefreshes();
  }

  /**
   * Check for pending refreshes every hour
   */
  @Cron("0 * * * *") // Every hour at minute 0
  async checkPendingRefreshes() {
    const now = new Date();

    const topicsToRefresh = await this.prisma.researchTopic.findMany({
      where: {
        status: "ACTIVE",
        refreshFrequency: { not: "MANUAL" },
        nextRefreshAt: { lte: now },
      },
      include: {
        dimensions: true,
      },
    });

    this.logger.log(`Found ${topicsToRefresh.length} topics due for refresh`);

    for (const topic of topicsToRefresh) {
      // Process one at a time to avoid overwhelming resources
      await this.processScheduledRefresh(topic);
    }
  }

  /**
   * Process a scheduled refresh
   */
  private async processScheduledRefresh(
    topic: ResearchTopic & { dimensions: TopicDimension[] },
  ) {
    const refreshLog = await this.createRefreshLog(topic.id, "scheduled");

    try {
      this.logger.log(
        `Starting scheduled refresh for topic: ${topic.name} (${topic.id})`,
      );

      // 1. Analyze changes
      const plan = await this.incrementalService.analyzeChanges(topic);

      if (plan.type === "none") {
        this.logger.log(
          `No changes detected for topic: ${topic.name}, skipping refresh`,
        );
        await this.completeRefreshLog(refreshLog.id, {
          status: "completed",
          dimensionsRefreshed: 0,
          sourcesFound: 0,
        });
        await this.updateNextRefreshTime(topic);
        return;
      }

      // 2. Execute refresh
      let report: TopicReport;
      if (plan.type === "full") {
        report = await this.topicService.executeFullRefresh(topic.id);
      } else {
        report = await this.incrementalService.executeIncrementalRefresh(
          topic,
          plan,
        );
      }

      // 3. Update refresh log
      await this.completeRefreshLog(refreshLog.id, {
        status: "completed",
        reportId: report.id,
        dimensionsRefreshed: plan.dimensionsToRefresh.length,
        sourcesFound: report.totalSources,
        tokensUsed: report.totalTokens,
      });

      // 4. Update next refresh time
      await this.updateNextRefreshTime(topic);

      this.logger.log(`Completed scheduled refresh for topic: ${topic.name}`);
    } catch (error) {
      this.logger.error(
        `Failed scheduled refresh for topic: ${topic.name}`,
        error,
      );

      await this.completeRefreshLog(refreshLog.id, {
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });

      // Still update next refresh time to avoid infinite retry
      await this.updateNextRefreshTime(topic);
    }
  }

  /**
   * Calculate next refresh time based on frequency
   */
  private calculateNextRefreshTime(topic: ResearchTopic): Date {
    const now = new Date();

    switch (topic.refreshFrequency) {
      case "DAILY":
        return new Date(now.getTime() + 24 * 60 * 60 * 1000);
      case "WEEKLY":
        return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      case "BIWEEKLY":
        return new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      case "MONTHLY":
        const nextMonth = new Date(now);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        return nextMonth;
      default:
        return null; // Manual refresh, no next time
    }
  }

  private async updateNextRefreshTime(topic: ResearchTopic) {
    const nextRefresh = this.calculateNextRefreshTime(topic);

    await this.prisma.researchTopic.update({
      where: { id: topic.id },
      data: {
        lastRefreshAt: new Date(),
        nextRefreshAt: nextRefresh,
      },
    });
  }

  private async createRefreshLog(topicId: string, triggerType: string) {
    return this.prisma.topicRefreshLog.create({
      data: {
        topicId,
        triggerType,
        status: "running",
        startedAt: new Date(),
      },
    });
  }

  private async completeRefreshLog(
    logId: string,
    data: Partial<{
      status: string;
      reportId: string;
      dimensionsRefreshed: number;
      sourcesFound: number;
      tokensUsed: number;
      error: string;
    }>,
  ) {
    return this.prisma.topicRefreshLog.update({
      where: { id: logId },
      data: {
        ...data,
        completedAt: new Date(),
      },
    });
  }

  private async recoverFailedRefreshes() {
    // Find stuck refreshes (running for more than 1 hour)
    const stuckThreshold = new Date(Date.now() - 60 * 60 * 1000);

    const stuckLogs = await this.prisma.topicRefreshLog.findMany({
      where: {
        status: "running",
        startedAt: { lt: stuckThreshold },
      },
    });

    if (stuckLogs.length > 0) {
      this.logger.warn(
        `Found ${stuckLogs.length} stuck refresh logs, marking as failed`,
      );

      await this.prisma.topicRefreshLog.updateMany({
        where: { id: { in: stuckLogs.map((l) => l.id) } },
        data: {
          status: "failed",
          error: "Refresh timed out (exceeded 1 hour)",
          completedAt: new Date(),
        },
      });
    }
  }
}
```

---

## 6. Frontend-Backend Interaction Design

### 6.1 SSE Event Types

```typescript
// types/sse-events.ts

/**
 * SSE Event Types for Topic Research
 * Used for streaming progress updates during research
 */

// ==================== Research Progress Events ====================

export interface ResearchStartEvent {
  type: "research:start";
  data: {
    topicId: string;
    topicName: string;
    totalDimensions: number;
    estimatedDuration: number;
  };
}

export interface DimensionBatchStartEvent {
  type: "research:dimension_batch_start";
  data: {
    totalDimensions: number;
    concurrency: number;
  };
}

export interface DimensionStartEvent {
  type: "research:dimension_start";
  data: {
    dimensionId: string;
    dimensionName: string;
    taskIndex: number;
    totalTasks: number;
  };
}

export interface DimensionProgressEvent {
  type: "research:dimension_progress";
  data: {
    dimensionId: string;
    dimensionName: string;
    phase: "searching" | "analyzing" | "writing";
    sourcesFound: number;
    message: string;
  };
}

export interface DimensionCompleteEvent {
  type: "research:dimension_complete";
  data: {
    dimensionId: string;
    dimensionName: string;
    sourcesFound: number;
    duration: number;
    summary: string;
  };
}

export interface DimensionErrorEvent {
  type: "research:dimension_error";
  data: {
    dimensionId: string;
    dimensionName: string;
    error: string;
  };
}

export interface DimensionBatchCompleteEvent {
  type: "research:dimension_batch_complete";
  data: {
    totalDimensions: number;
    successCount: number;
    totalSources: number;
  };
}

// ==================== Synthesis Events ====================

export interface SynthesisStartEvent {
  type: "synthesis:start";
  data: {
    totalDimensions: number;
    totalSources: number;
  };
}

export interface SynthesisSectionEvent {
  type: "synthesis:section";
  data: {
    sectionName: string;
    progress: number;
  };
}

export interface SynthesisContentDeltaEvent {
  type: "synthesis:content_delta";
  data: {
    section: string;
    delta: string;
  };
}

export interface SynthesisCompleteEvent {
  type: "synthesis:complete";
  data: {
    reportId: string;
    version: number;
    totalSections: number;
    totalTokens: number;
  };
}

// ==================== Report Events ====================

export interface ReportReadyEvent {
  type: "report:ready";
  data: {
    reportId: string;
    version: number;
    executiveSummary: string;
    highlights: string[];
    totalDimensions: number;
    totalSources: number;
  };
}

// ==================== Error Events ====================

export interface ResearchErrorEvent {
  type: "research:error";
  data: {
    code: string;
    message: string;
    recoverable: boolean;
    dimensionId?: string;
  };
}

// ==================== Union Type ====================

export type TopicResearchSSEEvent =
  | ResearchStartEvent
  | DimensionBatchStartEvent
  | DimensionStartEvent
  | DimensionProgressEvent
  | DimensionCompleteEvent
  | DimensionErrorEvent
  | DimensionBatchCompleteEvent
  | SynthesisStartEvent
  | SynthesisSectionEvent
  | SynthesisContentDeltaEvent
  | SynthesisCompleteEvent
  | ReportReadyEvent
  | ResearchErrorEvent;
```

### 6.2 WebSocket Events

```typescript
// events/topic-websocket-events.ts

/**
 * WebSocket Event Types for Topic Research
 * Used for real-time notifications (not progress streaming)
 */

// ==================== Topic Events ====================

export interface TopicCreatedEvent {
  event: "topic:created";
  data: {
    topicId: string;
    topicName: string;
    type: ResearchTopicType;
    userId: string;
  };
}

export interface TopicUpdatedEvent {
  event: "topic:updated";
  data: {
    topicId: string;
    changes: Partial<ResearchTopic>;
  };
}

export interface TopicDeletedEvent {
  event: "topic:deleted";
  data: {
    topicId: string;
  };
}

// ==================== Refresh Events ====================

export interface RefreshStartedEvent {
  event: "refresh:started";
  data: {
    topicId: string;
    triggerType: "manual" | "scheduled";
    refreshType: "full" | "incremental" | "dimension";
    dimensionIds?: string[];
  };
}

export interface RefreshCompletedEvent {
  event: "refresh:completed";
  data: {
    topicId: string;
    reportId: string;
    version: number;
    duration: number;
    sourcesFound: number;
  };
}

export interface RefreshFailedEvent {
  event: "refresh:failed";
  data: {
    topicId: string;
    error: string;
  };
}

// ==================== Report Events ====================

export interface ReportGeneratedEvent {
  event: "report:generated";
  data: {
    topicId: string;
    reportId: string;
    version: number;
    isIncremental: boolean;
  };
}

// ==================== Schedule Events ====================

export interface ScheduleUpdatedEvent {
  event: "schedule:updated";
  data: {
    topicId: string;
    frequency: RefreshFrequency;
    nextRefreshAt: Date | null;
  };
}
```

### 6.3 API Endpoint Design

```typescript
// topic-research.controller.ts

@Controller("topic-research")
@UseGuards(JwtAuthGuard)
@ApiTags("Topic Research")
export class TopicResearchController {
  constructor(
    private topicService: TopicResearchService,
    private refreshScheduler: TopicRefreshScheduler,
  ) {}

  // ==================== Topic CRUD ====================

  @Post("topics")
  @ApiOperation({ summary: "Create a new research topic" })
  async createTopic(
    @Body() dto: CreateTopicDto,
    @CurrentUser() user: User,
  ): Promise<ResearchTopic> {
    return this.topicService.createTopic(user.id, dto);
  }

  @Get("topics")
  @ApiOperation({ summary: "List all topics for current user" })
  async listTopics(
    @Query() query: ListTopicsDto,
    @CurrentUser() user: User,
  ): Promise<PaginatedResponse<ResearchTopic>> {
    return this.topicService.listTopics(user.id, query);
  }

  @Get("topics/:id")
  @ApiOperation({ summary: "Get topic details" })
  async getTopic(
    @Param("id") id: string,
    @CurrentUser() user: User,
  ): Promise<ResearchTopicDetail> {
    return this.topicService.getTopic(id, user.id);
  }

  @Patch("topics/:id")
  @ApiOperation({ summary: "Update topic" })
  async updateTopic(
    @Param("id") id: string,
    @Body() dto: UpdateTopicDto,
    @CurrentUser() user: User,
  ): Promise<ResearchTopic> {
    return this.topicService.updateTopic(id, user.id, dto);
  }

  @Delete("topics/:id")
  @ApiOperation({ summary: "Delete topic" })
  async deleteTopic(
    @Param("id") id: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.topicService.deleteTopic(id, user.id);
  }

  // ==================== Refresh Operations (SSE) ====================

  @Post("topics/:id/refresh")
  @ApiOperation({ summary: "Trigger topic refresh (SSE stream)" })
  @Sse()
  triggerRefresh(
    @Param("id") id: string,
    @Body() dto: TriggerRefreshDto,
    @CurrentUser() user: User,
  ): Observable<MessageEvent<TopicResearchSSEEvent>> {
    return this.topicService
      .triggerRefresh(id, user.id, dto)
      .pipe(map((event) => ({ data: event })));
  }

  @Get("topics/:id/refresh/status")
  @ApiOperation({ summary: "Get current refresh status" })
  async getRefreshStatus(
    @Param("id") id: string,
    @CurrentUser() user: User,
  ): Promise<RefreshStatus> {
    return this.topicService.getRefreshStatus(id, user.id);
  }

  @Post("topics/:id/dimensions/:dimId/refresh")
  @ApiOperation({ summary: "Refresh single dimension (SSE stream)" })
  @Sse()
  refreshDimension(
    @Param("id") id: string,
    @Param("dimId") dimId: string,
    @CurrentUser() user: User,
  ): Observable<MessageEvent<TopicResearchSSEEvent>> {
    return this.topicService
      .triggerDimensionRefresh(id, dimId, user.id)
      .pipe(map((event) => ({ data: event })));
  }

  // ==================== Reports ====================

  @Get("topics/:id/reports")
  @ApiOperation({ summary: "List all reports for topic" })
  async listReports(
    @Param("id") id: string,
    @CurrentUser() user: User,
  ): Promise<TopicReport[]> {
    return this.topicService.listReports(id, user.id);
  }

  @Get("topics/:id/reports/latest")
  @ApiOperation({ summary: "Get latest report" })
  async getLatestReport(
    @Param("id") id: string,
    @CurrentUser() user: User,
  ): Promise<TopicReportDetail> {
    return this.topicService.getLatestReport(id, user.id);
  }

  @Get("topics/:id/reports/:version")
  @ApiOperation({ summary: "Get report by version" })
  async getReportByVersion(
    @Param("id") id: string,
    @Param("version", ParseIntPipe) version: number,
    @CurrentUser() user: User,
  ): Promise<TopicReportDetail> {
    return this.topicService.getReportByVersion(id, version, user.id);
  }

  @Get("topics/:id/reports/compare")
  @ApiOperation({ summary: "Compare two report versions" })
  async compareReports(
    @Param("id") id: string,
    @Query("v1", ParseIntPipe) v1: number,
    @Query("v2", ParseIntPipe) v2: number,
    @CurrentUser() user: User,
  ): Promise<ReportComparison> {
    return this.topicService.compareReports(id, v1, v2, user.id);
  }

  @Get("topics/:id/reports/:version/export")
  @ApiOperation({ summary: "Export report" })
  async exportReport(
    @Param("id") id: string,
    @Param("version", ParseIntPipe) version: number,
    @Query("format") format: "pdf" | "docx",
    @CurrentUser() user: User,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.topicService.exportReport(
      id,
      version,
      format,
      user.id,
    );
    res.setHeader("Content-Type", file.contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${file.filename}"`,
    );
    res.send(file.buffer);
  }

  // ==================== Evidence ====================

  @Get("topics/:id/reports/:version/evidence")
  @ApiOperation({ summary: "List evidence for report" })
  async listEvidence(
    @Param("id") id: string,
    @Param("version", ParseIntPipe) version: number,
    @CurrentUser() user: User,
  ): Promise<TopicEvidence[]> {
    return this.topicService.listEvidence(id, version, user.id);
  }

  @Get("topics/:id/evidence/:evidenceId")
  @ApiOperation({ summary: "Get evidence detail" })
  async getEvidenceDetail(
    @Param("id") id: string,
    @Param("evidenceId") evidenceId: string,
    @CurrentUser() user: User,
  ): Promise<EvidenceDetail> {
    return this.topicService.getEvidenceDetail(id, evidenceId, user.id);
  }

  // ==================== Dimensions ====================

  @Get("topics/:id/dimensions")
  @ApiOperation({ summary: "List dimensions for topic" })
  async listDimensions(
    @Param("id") id: string,
    @CurrentUser() user: User,
  ): Promise<TopicDimension[]> {
    return this.topicService.listDimensions(id, user.id);
  }

  @Patch("topics/:id/dimensions/:dimId")
  @ApiOperation({ summary: "Update dimension configuration" })
  async updateDimension(
    @Param("id") id: string,
    @Param("dimId") dimId: string,
    @Body() dto: UpdateDimensionDto,
    @CurrentUser() user: User,
  ): Promise<TopicDimension> {
    return this.topicService.updateDimension(id, dimId, user.id, dto);
  }

  // ==================== Templates ====================

  @Get("templates")
  @ApiOperation({ summary: "List dimension templates by topic type" })
  async listTemplates(
    @Query("type") type: ResearchTopicType,
  ): Promise<DimensionTemplate[]> {
    return this.topicService.getDimensionTemplates(type);
  }

  // ==================== Refresh History ====================

  @Get("topics/:id/refresh-logs")
  @ApiOperation({ summary: "Get refresh history" })
  async getRefreshLogs(
    @Param("id") id: string,
    @Query() query: PaginationDto,
    @CurrentUser() user: User,
  ): Promise<PaginatedResponse<TopicRefreshLog>> {
    return this.topicService.getRefreshLogs(id, user.id, query);
  }
}
```

---

## 7. Database Schema (Prisma)

The database schema is defined in the PRD. Key additions for implementation:

### 7.1 Index Optimization

```prisma
// Add to existing schema for query performance

@@index([userId, status])           // List topics by user
@@index([type])                     // Filter by topic type
@@index([nextRefreshAt])            // Scheduler lookup
@@index([topicId, sortOrder])       // Dimension ordering
@@index([dimensionId])              // Evidence by dimension
@@index([reportId])                 // Evidence by report
@@index([topicId, version])         // Report versioning
@@index([topicId, generatedAt])     // Latest report lookup
@@index([isActive, nextRunAt])      // Active schedules
@@index([topicId, startedAt])       // Refresh log timeline
```

### 7.2 MongoDB Collections for Raw Evidence

```typescript
// Evidence raw data stored in MongoDB for flexibility
interface EvidenceRawData {
  _id: ObjectId;
  evidenceId: string; // Link to PostgreSQL TopicEvidence.id
  topicId: string;
  dimensionId: string;

  // Full content
  fullContent: string; // Complete scraped content (not truncated)

  // Source metadata
  source: {
    type: "web" | "arxiv" | "github" | "hackernews" | "rss" | "local";
    externalId?: string; // arXiv ID, GitHub repo, etc.
    apiResponse?: any; // Raw API response for reference
  };

  // Extraction metadata
  extraction: {
    method: "search_result" | "scraper" | "api";
    extractedAt: Date;
    processingTime: number;
  };

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}
```

---

## 8. Implementation Plan

### Phase 1: Foundation (Week 1-2)

| Task                                  | Priority | Effort |
| ------------------------------------- | -------- | ------ |
| Create module structure and DTOs      | P0       | 1d     |
| Implement TopicResearchService (CRUD) | P0       | 2d     |
| Implement DataSourceRouterService     | P0       | 2d     |
| Create dimension templates            | P0       | 1d     |
| Database schema and migrations        | P0       | 1d     |
| Basic API endpoints                   | P0       | 1d     |

### Phase 2: Research Engine (Week 3-4)

| Task                       | Priority | Effort |
| -------------------------- | -------- | ------ |
| TopicTeamOrchestrator      | P0       | 3d     |
| DimensionResearchService   | P0       | 2d     |
| ReportSynthesisService     | P0       | 2d     |
| EvidenceManagementService  | P0       | 2d     |
| SSE streaming for progress | P0       | 1d     |

### Phase 3: Refresh Mechanism (Week 5-6)

| Task                      | Priority | Effort |
| ------------------------- | -------- | ------ |
| IncrementalRefreshService | P0       | 3d     |
| TopicRefreshScheduler     | P0       | 2d     |
| WebSocket notifications   | P1       | 1d     |
| Refresh history and logs  | P1       | 1d     |

### Phase 4: Quality and Polish (Week 7-8)

| Task                        | Priority | Effort |
| --------------------------- | -------- | ------ |
| Version comparison          | P1       | 2d     |
| Export functionality        | P1       | 2d     |
| Error handling improvements | P1       | 2d     |
| Performance optimization    | P1       | 2d     |
| Testing and documentation   | P0       | 2d     |

---

## 9. Technical Risks and Mitigations

| Risk                                        | Impact | Likelihood | Mitigation                                                  |
| ------------------------------------------- | ------ | ---------- | ----------------------------------------------------------- |
| Long refresh times for large topics         | High   | Medium     | Incremental refresh, parallel execution, progress streaming |
| Data source API rate limits                 | Medium | High       | Request throttling, caching, fallback sources               |
| High token costs for comprehensive research | Medium | Medium     | Cost profiling, model tiering, evidence reuse               |
| Evidence staleness                          | Medium | Low        | Clear timestamps, freshness indicators, easy manual refresh |
| Deduplication false positives               | Low    | Medium     | Configurable thresholds, manual override options            |

---

## 10. Appendix

### A. Authority Domain List

See `data-source-mapping.ts` for complete list of high/medium authority domains used in credibility scoring.

### B. Prompt Templates

See `prompts/` directory for Research Lead, Research Analyst, and Synthesis prompts.

### C. Frontend Component Mapping

| Backend Endpoint                 | Frontend Component   | Route                            |
| -------------------------------- | -------------------- | -------------------------------- |
| GET /topics                      | TopicListPage        | /topic-research                  |
| POST /topics                     | CreateTopicWizard    | /topic-research/create           |
| GET /topics/:id                  | TopicWorkspace       | /topic-research/[topicId]        |
| POST /topics/:id/refresh         | RefreshProgressPanel | (modal)                          |
| GET /topics/:id/reports/:version | ReportViewer         | /topic-research/[topicId]/report |
| GET /topics/:id/evidence         | EvidencePanel        | (sidebar)                        |

---

## Document History

| Version | Date       | Author          | Changes                  |
| ------- | ---------- | --------------- | ------------------------ |
| 1.0     | 2026-01-11 | Architect Agent | Initial technical design |
