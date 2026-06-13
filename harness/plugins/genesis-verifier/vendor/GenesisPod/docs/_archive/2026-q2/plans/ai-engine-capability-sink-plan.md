# AI Engine 能力下沉方案

> 将 Topic Research 和 AI Writing 的通用能力提取到 AI Engine 共享层

## 一、下沉目标

### 1.1 待下沉能力清单

| 能力                 | 来源模块       | 目标位置                 | 优先级 |
| -------------------- | -------------- | ------------------------ | ------ |
| DataSourceRouter     | Topic Research | ai-engine/data/          | P0     |
| DataEnrichment       | Topic Research | ai-engine/data/          | P0     |
| EvidenceManagement   | Topic Research | ai-engine/evidence/      | P1     |
| ReviewWorkflow       | Topic Research | ai-engine/collaboration/ | P1     |
| QualityGate          | AI Writing     | ai-engine/quality/       | P1     |
| IncrementalExecution | Topic Research | ai-engine/orchestration/ | P2     |
| RealTimePush         | Both           | ai-engine/realtime/      | P2     |

### 1.2 预期收益

```
下沉前                              下沉后
┌─────────────────┐               ┌─────────────────┐
│  Topic Research │               │  Topic Research │
│  ├─ DataRouter  │               │  └─ 业务逻辑    │
│  ├─ Enrichment  │               └────────┬────────┘
│  ├─ Evidence    │                        │
│  └─ Review      │                        ▼
└─────────────────┘               ┌─────────────────┐
                                  │   AI Engine     │
┌─────────────────┐               │  ├─ data/       │◄── 共享
│   AI Writing    │               │  ├─ evidence/   │
│  ├─ QualityGate │               │  ├─ quality/    │
│  ├─ Expression  │               │  ├─ collab/     │
│  └─ Consistency │               │  └─ realtime/   │
└─────────────────┘               └────────┬────────┘
                                           │
┌─────────────────┐               ┌────────┴────────┐
│   AI Teams      │               │   AI Writing    │
│  └─ 无共享能力  │               │  └─ 业务逻辑    │
└─────────────────┘               └────────┬────────┘
                                           │
                                  ┌────────┴────────┐
                                  │   AI Teams      │
                                  │  └─ 业务逻辑    │
                                  └─────────────────┘
```

---

## 二、目录结构设计

### 2.1 AI Engine 新增模块

```
backend/src/modules/ai-engine/
├── ...existing modules...
│
├── data/                              # [NEW] 数据获取与增强
│   ├── abstractions/
│   │   ├── data-source.interface.ts      # IDataSource 接口
│   │   ├── data-enricher.interface.ts    # IDataEnricher 接口
│   │   └── index.ts
│   ├── sources/                          # 数据源实现
│   │   ├── web-search.source.ts          # 网络搜索
│   │   ├── news.source.ts                # 新闻源
│   │   ├── academic.source.ts            # 学术论文
│   │   ├── financial.source.ts           # 财务数据
│   │   └── index.ts
│   ├── enrichers/                        # 数据增强器
│   │   ├── content-extractor.enricher.ts # 内容提取
│   │   ├── figure-extractor.enricher.ts  # 图表提取
│   │   ├── metadata-enricher.ts          # 元数据增强
│   │   └── index.ts
│   ├── services/
│   │   ├── data-source-router.service.ts # ★ 核心路由
│   │   ├── data-enrichment.service.ts    # ★ 增强服务
│   │   ├── data-cache.service.ts         # 缓存层
│   │   └── index.ts
│   ├── dto/
│   │   ├── fetch-data.dto.ts
│   │   └── enrichment-options.dto.ts
│   ├── types/
│   │   └── data.types.ts
│   ├── data.module.ts
│   └── index.ts
│
├── evidence/                          # [NEW] 证据管理
│   ├── abstractions/
│   │   └── evidence.interface.ts
│   ├── services/
│   │   ├── evidence-storage.service.ts   # 证据存储
│   │   ├── evidence-retrieval.service.ts # 证据检索
│   │   ├── citation-manager.service.ts   # 引用管理
│   │   └── index.ts
│   ├── types/
│   │   └── evidence.types.ts
│   ├── evidence.module.ts
│   └── index.ts
│
├── quality/                           # [NEW] 质量控制
│   ├── abstractions/
│   │   ├── quality-gate.interface.ts     # IQualityGate
│   │   ├── quality-checker.interface.ts  # IQualityChecker
│   │   └── index.ts
│   ├── checkers/                         # 检查器实现
│   │   ├── diversity-checker.ts          # 多样性检查
│   │   ├── consistency-checker.ts        # 一致性检查
│   │   ├── factual-checker.ts            # 事实检查
│   │   └── index.ts
│   ├── services/
│   │   ├── quality-gate.service.ts       # ★ 质量门禁
│   │   ├── quality-registry.service.ts   # 检查器注册
│   │   └── index.ts
│   ├── types/
│   │   └── quality.types.ts
│   ├── quality.module.ts
│   └── index.ts
│
├── collaboration/                     # [EXTEND] 协作扩展
│   ├── ...existing patterns...
│   ├── review/                           # [NEW] 审查工作流
│   │   ├── review-workflow.service.ts    # ★ 审查流程
│   │   ├── review-assignment.service.ts  # 分配逻辑
│   │   └── index.ts
│   ├── todo/                             # [NEW] 待办管理
│   │   ├── todo.service.ts               # ★ TODO 服务
│   │   └── index.ts
│   └── index.ts
│
├── realtime/                          # [NEW] 实时推送
│   ├── abstractions/
│   │   ├── event-emitter.interface.ts
│   │   └── progress-tracker.interface.ts
│   ├── services/
│   │   ├── engine-event-emitter.service.ts # ★ 事件发射
│   │   ├── progress-tracker.service.ts     # 进度追踪
│   │   └── index.ts
│   ├── gateway/
│   │   └── engine-websocket.gateway.ts     # WebSocket 基类
│   ├── types/
│   │   └── realtime.types.ts
│   ├── realtime.module.ts
│   └── index.ts
│
└── orchestration/                     # [EXTEND] 编排扩展
    ├── ...existing services...
    ├── incremental/                      # [NEW] 增量执行
    │   ├── incremental-executor.service.ts  # ★ 增量执行器
    │   ├── diff-analyzer.service.ts         # 差异分析
    │   └── index.ts
    └── index.ts
```

---

## 三、核心接口设计

### 3.1 数据源接口 (IDataSource)

```typescript
// backend/src/modules/ai-engine/data/abstractions/data-source.interface.ts

/**
 * 数据源类型
 */
export type DataSourceType =
  | "web-search" // Google/Bing 搜索
  | "news" // 新闻 API
  | "academic" // 学术论文 (arXiv, PubMed)
  | "financial" // 财务数据 API
  | "social" // 社交媒体
  | "internal" // 内部知识库
  | "custom"; // 自定义源

/**
 * 数据源配置
 */
export interface DataSourceConfig {
  type: DataSourceType;
  priority: number; // 优先级 (1-10)
  maxResults?: number; // 最大结果数
  timeout?: number; // 超时时间 (ms)
  enabled?: boolean; // 是否启用
  credentials?: {
    // 凭证配置
    apiKey?: string;
    endpoint?: string;
  };
}

/**
 * 数据获取请求
 */
export interface DataFetchRequest {
  query: string; // 查询内容
  sources?: DataSourceType[]; // 指定数据源
  context?: {
    // 上下文信息
    domain?: string; // 领域 (research, writing)
    taskType?: string; // 任务类型
    locale?: string; // 语言/地区
  };
  filters?: {
    // 过滤条件
    dateRange?: { start: Date; end: Date };
    domains?: string[]; // 限定域名
    excludeDomains?: string[]; // 排除域名
  };
  options?: {
    maxResults?: number;
    includeMetadata?: boolean;
    deduplication?: boolean;
  };
}

/**
 * 数据获取结果
 */
export interface DataFetchResult {
  items: DataItem[];
  metadata: {
    totalCount: number;
    sources: DataSourceType[];
    fetchedAt: Date;
    queryTime: number; // 查询耗时 (ms)
  };
}

/**
 * 单条数据项
 */
export interface DataItem {
  id: string;
  source: DataSourceType;
  title: string;
  content: string;
  url?: string;
  publishedAt?: Date;
  author?: string;
  relevanceScore?: number; // 相关性评分 (0-1)
  metadata?: Record<string, unknown>;
}

/**
 * 数据源接口
 */
export interface IDataSource {
  readonly type: DataSourceType;
  readonly config: DataSourceConfig;

  /**
   * 检查数据源是否可用
   */
  isAvailable(): Promise<boolean>;

  /**
   * 获取数据
   */
  fetch(request: DataFetchRequest): Promise<DataItem[]>;

  /**
   * 评估查询与此数据源的匹配度
   */
  evaluateRelevance(
    query: string,
    context?: DataFetchRequest["context"],
  ): number;
}
```

### 3.2 数据增强接口 (IDataEnricher)

```typescript
// backend/src/modules/ai-engine/data/abstractions/data-enricher.interface.ts

/**
 * 增强类型
 */
export type EnrichmentType =
  | "content-extraction" // 内容提取（从 URL 获取完整内容）
  | "figure-extraction" // 图表提取
  | "metadata" // 元数据增强
  | "summarization" // 摘要生成
  | "translation" // 翻译
  | "sentiment" // 情感分析
  | "entity-extraction"; // 实体提取

/**
 * 增强选项
 */
export interface EnrichmentOptions {
  types: EnrichmentType[]; // 需要的增强类型
  maxContentLength?: number; // 最大内容长度
  extractFigures?: boolean; // 是否提取图表
  generateSummary?: boolean; // 是否生成摘要
  targetLanguage?: string; // 目标语言
}

/**
 * 增强后的数据项
 */
export interface EnrichedDataItem extends DataItem {
  enrichments: {
    fullContent?: string; // 完整内容
    summary?: string; // 摘要
    figures?: ExtractedFigure[]; // 提取的图表
    entities?: ExtractedEntity[]; // 提取的实体
    sentiment?: SentimentResult; // 情感分析
    translatedContent?: string; // 翻译内容
  };
  enrichedAt: Date;
}

/**
 * 提取的图表
 */
export interface ExtractedFigure {
  type: "image" | "chart" | "table" | "diagram";
  url?: string;
  base64?: string;
  caption?: string;
  sourceUrl: string;
}

/**
 * 数据增强器接口
 */
export interface IDataEnricher {
  readonly type: EnrichmentType;

  /**
   * 增强单条数据
   */
  enrich(
    item: DataItem,
    options?: Partial<EnrichmentOptions>,
  ): Promise<Partial<EnrichedDataItem["enrichments"]>>;

  /**
   * 批量增强
   */
  enrichBatch(
    items: DataItem[],
    options?: Partial<EnrichmentOptions>,
  ): Promise<EnrichedDataItem[]>;
}
```

### 3.3 证据管理接口 (IEvidenceManager)

```typescript
// backend/src/modules/ai-engine/evidence/abstractions/evidence.interface.ts

/**
 * 证据类型
 */
export type EvidenceType =
  | "citation" // 引用
  | "reference" // 参考
  | "inspiration" // 灵感来源
  | "fact" // 事实依据
  | "quote"; // 引述

/**
 * 证据记录
 */
export interface Evidence {
  id: string;
  type: EvidenceType;

  // 来源信息
  source: {
    url?: string;
    title: string;
    author?: string;
    publishedAt?: Date;
    domain?: string;
  };

  // 内容信息
  content: {
    original: string; // 原始内容
    snippet?: string; // 摘要片段
    usedPortion?: string; // 使用的部分
  };

  // 关联信息
  associations: {
    entityType: string; // 关联实体类型 (report, chapter, dimension)
    entityId: string; // 关联实体 ID
    location?: string; // 在实体中的位置
  };

  // 元数据
  metadata: {
    relevanceScore: number; // 相关性评分
    credibilityScore?: number; // 可信度评分
    citationCount: number; // 被引用次数
    createdAt: Date;
    updatedAt: Date;
  };
}

/**
 * 证据存储请求
 */
export interface SaveEvidenceRequest {
  type: EvidenceType;
  source: Evidence["source"];
  content: Evidence["content"];
  associations: Evidence["associations"];
  relevanceScore?: number;
}

/**
 * 证据检索请求
 */
export interface RetrieveEvidenceRequest {
  entityType?: string;
  entityId?: string;
  types?: EvidenceType[];
  minRelevanceScore?: number;
  limit?: number;
  offset?: number;
}

/**
 * 证据管理器接口
 */
export interface IEvidenceManager {
  /**
   * 保存证据
   */
  save(request: SaveEvidenceRequest): Promise<Evidence>;

  /**
   * 批量保存
   */
  saveBatch(requests: SaveEvidenceRequest[]): Promise<Evidence[]>;

  /**
   * 检索证据
   */
  retrieve(request: RetrieveEvidenceRequest): Promise<Evidence[]>;

  /**
   * 获取单条证据
   */
  getById(id: string): Promise<Evidence | null>;

  /**
   * 更新证据
   */
  update(id: string, updates: Partial<Evidence>): Promise<Evidence>;

  /**
   * 删除证据
   */
  delete(id: string): Promise<void>;

  /**
   * 生成引用格式
   */
  formatCitation(evidence: Evidence, style: CitationStyle): string;

  /**
   * 批量生成引用
   */
  generateBibliography(
    entityType: string,
    entityId: string,
    style: CitationStyle,
  ): Promise<string>;
}

export type CitationStyle = "apa" | "mla" | "chicago" | "harvard" | "ieee";
```

### 3.4 质量门禁接口 (IQualityGate)

```typescript
// backend/src/modules/ai-engine/quality/abstractions/quality-gate.interface.ts

/**
 * 质量维度
 */
export type QualityDimension =
  | "diversity" // 多样性（词汇、句式）
  | "consistency" // 一致性（风格、事实）
  | "factual" // 事实准确性
  | "coherence" // 连贯性
  | "completeness" // 完整性
  | "relevance" // 相关性
  | "originality"; // 原创性

/**
 * 质量检查结果
 */
export interface QualityCheckResult {
  dimension: QualityDimension;
  score: number; // 0-100
  passed: boolean; // 是否通过
  issues: QualityIssue[]; // 发现的问题
  suggestions: string[]; // 改进建议
  metadata?: Record<string, unknown>;
}

/**
 * 质量问题
 */
export interface QualityIssue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  location?: {
    start: number;
    end: number;
    text?: string;
  };
  suggestion?: string;
}

/**
 * 质量检查配置
 */
export interface QualityGateConfig {
  dimensions: QualityDimension[]; // 检查维度
  thresholds: {
    // 通过阈值
    [K in QualityDimension]?: number;
  };
  strictMode?: boolean; // 严格模式（任一不通过则失败）
  enableSuggestions?: boolean; // 是否生成建议
}

/**
 * 质量门禁结果
 */
export interface QualityGateResult {
  passed: boolean;
  overallScore: number; // 综合评分
  results: QualityCheckResult[]; // 各维度结果
  summary: {
    passedCount: number;
    failedCount: number;
    totalIssues: number;
    criticalIssues: number;
  };
  recommendation: "approve" | "revise" | "reject";
}

/**
 * 质量检查器接口
 */
export interface IQualityChecker {
  readonly dimension: QualityDimension;

  /**
   * 执行检查
   */
  check(
    content: string,
    context?: QualityCheckContext,
  ): Promise<QualityCheckResult>;
}

/**
 * 质量检查上下文
 */
export interface QualityCheckContext {
  contentType: "report" | "chapter" | "article" | "summary";
  previousContent?: string; // 之前的内容（用于一致性检查）
  referenceContent?: string; // 参考内容
  constraints?: Record<string, unknown>;
}

/**
 * 质量门禁服务接口
 */
export interface IQualityGate {
  /**
   * 执行质量门禁检查
   */
  evaluate(
    content: string,
    config: QualityGateConfig,
    context?: QualityCheckContext,
  ): Promise<QualityGateResult>;

  /**
   * 注册检查器
   */
  registerChecker(checker: IQualityChecker): void;

  /**
   * 获取可用检查器
   */
  getAvailableCheckers(): QualityDimension[];
}
```

### 3.5 审查工作流接口 (IReviewWorkflow)

```typescript
// backend/src/modules/ai-engine/collaboration/review/review.interface.ts

/**
 * 审查状态
 */
export type ReviewStatus =
  | "pending" // 待审查
  | "in_progress" // 审查中
  | "approved" // 已通过
  | "rejected" // 已拒绝
  | "revision_required"; // 需要修订

/**
 * 审查请求
 */
export interface ReviewRequest {
  entityType: string; // 实体类型
  entityId: string; // 实体 ID
  reviewerId?: string; // 审查者 ID（可选，自动分配）
  criteria: string[]; // 审查标准
  deadline?: Date; // 截止日期
  priority?: "low" | "medium" | "high";
  metadata?: Record<string, unknown>;
}

/**
 * 审查记录
 */
export interface Review {
  id: string;
  request: ReviewRequest;
  status: ReviewStatus;
  reviewer: {
    id: string;
    name: string;
    role: string;
  };
  feedback?: {
    overallRating: number; // 1-5
    comments: string;
    criteriaRatings: {
      [criterion: string]: number;
    };
    suggestions: ReviewSuggestion[];
  };
  timeline: ReviewEvent[];
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

/**
 * 审查建议
 */
export interface ReviewSuggestion {
  type: "addition" | "deletion" | "modification" | "question";
  location?: string;
  content: string;
  priority: "required" | "recommended" | "optional";
}

/**
 * 审查事件
 */
export interface ReviewEvent {
  type:
    | "created"
    | "assigned"
    | "started"
    | "feedback_added"
    | "completed"
    | "reopened";
  timestamp: Date;
  actor: string;
  details?: Record<string, unknown>;
}

/**
 * 审查工作流接口
 */
export interface IReviewWorkflow {
  /**
   * 创建审查请求
   */
  createReview(request: ReviewRequest): Promise<Review>;

  /**
   * 分配审查者
   */
  assignReviewer(reviewId: string, reviewerId: string): Promise<Review>;

  /**
   * 自动分配审查者
   */
  autoAssign(reviewId: string): Promise<Review>;

  /**
   * 提交审查反馈
   */
  submitFeedback(
    reviewId: string,
    feedback: Review["feedback"],
  ): Promise<Review>;

  /**
   * 更新审查状态
   */
  updateStatus(reviewId: string, status: ReviewStatus): Promise<Review>;

  /**
   * 获取审查记录
   */
  getReview(reviewId: string): Promise<Review | null>;

  /**
   * 获取实体的所有审查
   */
  getReviewsForEntity(entityType: string, entityId: string): Promise<Review[]>;

  /**
   * 获取审查者的待审列表
   */
  getPendingReviews(reviewerId: string): Promise<Review[]>;
}
```

### 3.6 实时推送接口 (IEventEmitter)

```typescript
// backend/src/modules/ai-engine/realtime/abstractions/event-emitter.interface.ts

/**
 * 事件类型定义
 */
export interface EngineEvent<T = unknown> {
  type: string;
  payload: T;
  metadata: {
    timestamp: Date;
    source: string; // 事件来源模块
    correlationId?: string; // 关联 ID
    userId?: string;
  };
}

/**
 * 进度事件
 */
export interface ProgressEvent {
  taskId: string;
  taskType: string;
  phase: string;
  progress: number; // 0-100
  message?: string;
  details?: Record<string, unknown>;
}

/**
 * 房间配置
 */
export interface RoomConfig {
  roomId: string;
  roomType: "topic" | "project" | "team" | "user";
  entityId: string;
}

/**
 * 事件发射器接口
 */
export interface IEngineEventEmitter {
  /**
   * 发射事件
   */
  emit<T>(event: EngineEvent<T>): void;

  /**
   * 发射到指定房间
   */
  emitToRoom<T>(roomConfig: RoomConfig, event: EngineEvent<T>): void;

  /**
   * 发射进度事件
   */
  emitProgress(roomConfig: RoomConfig, progress: ProgressEvent): void;

  /**
   * 订阅事件
   */
  subscribe<T>(
    eventType: string,
    handler: (event: EngineEvent<T>) => void,
  ): () => void;

  /**
   * 加入房间
   */
  joinRoom(socketId: string, roomConfig: RoomConfig): void;

  /**
   * 离开房间
   */
  leaveRoom(socketId: string, roomConfig: RoomConfig): void;
}

/**
 * 进度追踪器接口
 */
export interface IProgressTracker {
  /**
   * 开始追踪
   */
  start(taskId: string, totalSteps: number): void;

  /**
   * 更新进度
   */
  update(taskId: string, step: number, message?: string): void;

  /**
   * 增加进度
   */
  increment(taskId: string, message?: string): void;

  /**
   * 完成追踪
   */
  complete(taskId: string): void;

  /**
   * 失败
   */
  fail(taskId: string, error: string): void;

  /**
   * 获取当前进度
   */
  getProgress(taskId: string): ProgressEvent | null;

  /**
   * 设置进度回调
   */
  onProgress(
    taskId: string,
    callback: (progress: ProgressEvent) => void,
  ): () => void;
}
```

---

## 四、核心服务实现

### 4.1 DataSourceRouterService

```typescript
// backend/src/modules/ai-engine/data/services/data-source-router.service.ts

import { Injectable, Logger } from "@nestjs/common";
import {
  IDataSource,
  DataSourceType,
  DataFetchRequest,
  DataFetchResult,
  DataItem,
} from "../abstractions/data-source.interface";

@Injectable()
export class DataSourceRouterService {
  private readonly logger = new Logger(DataSourceRouterService.name);
  private readonly sources = new Map<DataSourceType, IDataSource>();

  /**
   * 注册数据源
   */
  registerSource(source: IDataSource): void {
    this.sources.set(source.type, source);
    this.logger.log(`Registered data source: ${source.type}`);
  }

  /**
   * 智能获取数据
   */
  async fetch(request: DataFetchRequest): Promise<DataFetchResult> {
    const startTime = Date.now();

    // 1. 选择数据源
    const selectedSources = await this.selectSources(request);

    if (selectedSources.length === 0) {
      return {
        items: [],
        metadata: {
          totalCount: 0,
          sources: [],
          fetchedAt: new Date(),
          queryTime: Date.now() - startTime,
        },
      };
    }

    // 2. 并行获取数据
    const results = await Promise.allSettled(
      selectedSources.map((source) => this.fetchFromSource(source, request)),
    );

    // 3. 合并结果
    const items: DataItem[] = [];
    const usedSources: DataSourceType[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "fulfilled") {
        items.push(...result.value);
        usedSources.push(selectedSources[i].type);
      } else {
        this.logger.warn(
          `Data source ${selectedSources[i].type} failed: ${result.reason}`,
        );
      }
    }

    // 4. 去重和排序
    const deduplicatedItems =
      request.options?.deduplication !== false
        ? this.deduplicateItems(items)
        : items;

    const sortedItems = this.sortByRelevance(deduplicatedItems);

    // 5. 限制结果数量
    const limitedItems = request.options?.maxResults
      ? sortedItems.slice(0, request.options.maxResults)
      : sortedItems;

    return {
      items: limitedItems,
      metadata: {
        totalCount: limitedItems.length,
        sources: usedSources,
        fetchedAt: new Date(),
        queryTime: Date.now() - startTime,
      },
    };
  }

  /**
   * 选择最优数据源组合
   */
  private async selectSources(
    request: DataFetchRequest,
  ): Promise<IDataSource[]> {
    // 如果指定了数据源，使用指定的
    if (request.sources?.length) {
      return request.sources
        .map((type) => this.sources.get(type))
        .filter((s): s is IDataSource => s !== undefined);
    }

    // 否则根据上下文智能选择
    const availableSources: Array<{ source: IDataSource; score: number }> = [];

    for (const source of this.sources.values()) {
      // 检查可用性
      const isAvailable = await source.isAvailable();
      if (!isAvailable) continue;

      // 评估相关性
      const relevanceScore = source.evaluateRelevance(
        request.query,
        request.context,
      );

      if (relevanceScore > 0.3) {
        // 阈值
        availableSources.push({ source, score: relevanceScore });
      }
    }

    // 按评分排序，取前 3 个
    return availableSources
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((s) => s.source);
  }

  /**
   * 从单个数据源获取数据
   */
  private async fetchFromSource(
    source: IDataSource,
    request: DataFetchRequest,
  ): Promise<DataItem[]> {
    const timeout = source.config.timeout || 10000;

    return Promise.race([
      source.fetch(request),
      new Promise<DataItem[]>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), timeout),
      ),
    ]);
  }

  /**
   * 去重
   */
  private deduplicateItems(items: DataItem[]): DataItem[] {
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = item.url || `${item.title}-${item.source}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * 按相关性排序
   */
  private sortByRelevance(items: DataItem[]): DataItem[] {
    return items.sort(
      (a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0),
    );
  }

  /**
   * 获取可用数据源
   */
  getAvailableSources(): DataSourceType[] {
    return Array.from(this.sources.keys());
  }
}
```

### 4.2 DataEnrichmentService

```typescript
// backend/src/modules/ai-engine/data/services/data-enrichment.service.ts

import { Injectable, Logger } from "@nestjs/common";
import pLimit from "p-limit";
import {
  IDataEnricher,
  EnrichmentType,
  EnrichmentOptions,
  EnrichedDataItem,
  DataItem,
} from "../abstractions/data-enricher.interface";

@Injectable()
export class DataEnrichmentService {
  private readonly logger = new Logger(DataEnrichmentService.name);
  private readonly enrichers = new Map<EnrichmentType, IDataEnricher>();
  private readonly concurrencyLimit = pLimit(5); // 并发限制

  /**
   * 注册增强器
   */
  registerEnricher(enricher: IDataEnricher): void {
    this.enrichers.set(enricher.type, enricher);
    this.logger.log(`Registered enricher: ${enricher.type}`);
  }

  /**
   * 增强数据
   */
  async enrich(
    items: DataItem[],
    options: EnrichmentOptions,
  ): Promise<EnrichedDataItem[]> {
    const enrichedItems: EnrichedDataItem[] = [];

    // 并发处理
    const tasks = items.map((item) =>
      this.concurrencyLimit(() => this.enrichItem(item, options)),
    );

    const results = await Promise.allSettled(tasks);

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "fulfilled") {
        enrichedItems.push(result.value);
      } else {
        // 增强失败时保留原始数据
        this.logger.warn(`Failed to enrich item: ${result.reason}`);
        enrichedItems.push({
          ...items[i],
          enrichments: {},
          enrichedAt: new Date(),
        });
      }
    }

    return enrichedItems;
  }

  /**
   * 增强单条数据
   */
  private async enrichItem(
    item: DataItem,
    options: EnrichmentOptions,
  ): Promise<EnrichedDataItem> {
    const enrichments: EnrichedDataItem["enrichments"] = {};

    for (const type of options.types) {
      const enricher = this.enrichers.get(type);
      if (!enricher) continue;

      try {
        const result = await enricher.enrich(item, options);
        Object.assign(enrichments, result);
      } catch (error) {
        this.logger.warn(
          `Enricher ${type} failed for item ${item.id}: ${error}`,
        );
      }
    }

    return {
      ...item,
      enrichments,
      enrichedAt: new Date(),
    };
  }

  /**
   * 获取可用增强器
   */
  getAvailableEnrichers(): EnrichmentType[] {
    return Array.from(this.enrichers.keys());
  }
}
```

### 4.3 QualityGateService

```typescript
// backend/src/modules/ai-engine/quality/services/quality-gate.service.ts

import { Injectable, Logger } from "@nestjs/common";
import {
  IQualityGate,
  IQualityChecker,
  QualityDimension,
  QualityGateConfig,
  QualityGateResult,
  QualityCheckResult,
  QualityCheckContext,
} from "../abstractions/quality-gate.interface";

@Injectable()
export class QualityGateService implements IQualityGate {
  private readonly logger = new Logger(QualityGateService.name);
  private readonly checkers = new Map<QualityDimension, IQualityChecker>();

  /**
   * 注册检查器
   */
  registerChecker(checker: IQualityChecker): void {
    this.checkers.set(checker.dimension, checker);
    this.logger.log(`Registered quality checker: ${checker.dimension}`);
  }

  /**
   * 执行质量门禁检查
   */
  async evaluate(
    content: string,
    config: QualityGateConfig,
    context?: QualityCheckContext,
  ): Promise<QualityGateResult> {
    const results: QualityCheckResult[] = [];
    let totalScore = 0;
    let passedCount = 0;
    let failedCount = 0;
    let totalIssues = 0;
    let criticalIssues = 0;

    // 执行各维度检查
    for (const dimension of config.dimensions) {
      const checker = this.checkers.get(dimension);
      if (!checker) {
        this.logger.warn(`No checker registered for dimension: ${dimension}`);
        continue;
      }

      try {
        const result = await checker.check(content, context);

        // 判断是否通过
        const threshold = config.thresholds[dimension] ?? 60;
        result.passed = result.score >= threshold;

        results.push(result);
        totalScore += result.score;

        if (result.passed) {
          passedCount++;
        } else {
          failedCount++;
        }

        totalIssues += result.issues.length;
        criticalIssues += result.issues.filter(
          (i) => i.severity === "error",
        ).length;
      } catch (error) {
        this.logger.error(`Quality check failed for ${dimension}: ${error}`);
      }
    }

    // 计算综合评分
    const overallScore = results.length > 0 ? totalScore / results.length : 0;

    // 判断是否通过门禁
    const passed = config.strictMode
      ? failedCount === 0
      : overallScore >= 60 && criticalIssues === 0;

    // 生成建议
    const recommendation = this.generateRecommendation(
      passed,
      overallScore,
      criticalIssues,
    );

    return {
      passed,
      overallScore: Math.round(overallScore),
      results,
      summary: {
        passedCount,
        failedCount,
        totalIssues,
        criticalIssues,
      },
      recommendation,
    };
  }

  /**
   * 生成建议
   */
  private generateRecommendation(
    passed: boolean,
    score: number,
    criticalIssues: number,
  ): QualityGateResult["recommendation"] {
    if (passed && score >= 80) return "approve";
    if (criticalIssues > 0 || score < 40) return "reject";
    return "revise";
  }

  /**
   * 获取可用检查器
   */
  getAvailableCheckers(): QualityDimension[] {
    return Array.from(this.checkers.keys());
  }
}
```

---

## 五、Facade 扩展

### 5.1 AIEngineFacade 新增方法

```typescript
// backend/src/modules/ai-engine/facade/ai-engine.facade.ts
// 在现有 Facade 中新增以下方法

@Injectable()
export class AIEngineFacade {
  // ... existing code ...

  constructor(
    // ... existing dependencies ...
    @Inject(DATA_FEATURE) private readonly data?: DataFeature,
    @Inject(EVIDENCE_FEATURE) private readonly evidence?: EvidenceFeature,
    @Inject(QUALITY_FEATURE) private readonly quality?: QualityFeature,
    @Inject(REVIEW_FEATURE) private readonly review?: ReviewFeature,
    @Inject(REALTIME_FEATURE) private readonly realtime?: RealtimeFeature,
  ) {}

  // ==================== 数据获取 ====================

  /**
   * 智能数据获取
   */
  async fetchData(request: DataFetchRequest): Promise<DataFetchResult> {
    if (!this.data?.router) {
      throw new Error("Data feature not available");
    }
    return this.data.router.fetch(request);
  }

  /**
   * 数据增强
   */
  async enrichData(
    items: DataItem[],
    options: EnrichmentOptions,
  ): Promise<EnrichedDataItem[]> {
    if (!this.data?.enrichment) {
      throw new Error("Data enrichment feature not available");
    }
    return this.data.enrichment.enrich(items, options);
  }

  /**
   * 获取并增强数据（组合方法）
   */
  async fetchAndEnrich(
    request: DataFetchRequest,
    enrichmentOptions: EnrichmentOptions,
  ): Promise<EnrichedDataItem[]> {
    const result = await this.fetchData(request);
    if (result.items.length === 0) return [];
    return this.enrichData(result.items, enrichmentOptions);
  }

  // ==================== 证据管理 ====================

  /**
   * 保存证据
   */
  async saveEvidence(request: SaveEvidenceRequest): Promise<Evidence> {
    if (!this.evidence?.manager) {
      throw new Error("Evidence feature not available");
    }
    return this.evidence.manager.save(request);
  }

  /**
   * 检索证据
   */
  async retrieveEvidence(
    request: RetrieveEvidenceRequest,
  ): Promise<Evidence[]> {
    if (!this.evidence?.manager) {
      throw new Error("Evidence feature not available");
    }
    return this.evidence.manager.retrieve(request);
  }

  /**
   * 生成参考文献
   */
  async generateBibliography(
    entityType: string,
    entityId: string,
    style: CitationStyle = "apa",
  ): Promise<string> {
    if (!this.evidence?.manager) {
      throw new Error("Evidence feature not available");
    }
    return this.evidence.manager.generateBibliography(
      entityType,
      entityId,
      style,
    );
  }

  // ==================== 质量控制 ====================

  /**
   * 质量门禁检查
   */
  async checkQuality(
    content: string,
    config: QualityGateConfig,
    context?: QualityCheckContext,
  ): Promise<QualityGateResult> {
    if (!this.quality?.gate) {
      throw new Error("Quality feature not available");
    }
    return this.quality.gate.evaluate(content, config, context);
  }

  // ==================== 协作审查 ====================

  /**
   * 创建审查请求
   */
  async createReview(request: ReviewRequest): Promise<Review> {
    if (!this.review?.workflow) {
      throw new Error("Review feature not available");
    }
    return this.review.workflow.createReview(request);
  }

  /**
   * 提交审查反馈
   */
  async submitReviewFeedback(
    reviewId: string,
    feedback: Review["feedback"],
  ): Promise<Review> {
    if (!this.review?.workflow) {
      throw new Error("Review feature not available");
    }
    return this.review.workflow.submitFeedback(reviewId, feedback);
  }

  // ==================== 实时推送 ====================

  /**
   * 发送进度事件
   */
  emitProgress(roomConfig: RoomConfig, progress: ProgressEvent): void {
    if (this.realtime?.eventEmitter) {
      this.realtime.eventEmitter.emitProgress(roomConfig, progress);
    }
  }

  /**
   * 获取进度追踪器
   */
  getProgressTracker(): IProgressTracker | null {
    return this.realtime?.progressTracker ?? null;
  }

  // ==================== 能力查询 ====================

  /**
   * 获取可用数据源
   */
  getAvailableDataSources(): DataSourceType[] {
    return this.data?.router?.getAvailableSources() ?? [];
  }

  /**
   * 获取可用增强器
   */
  getAvailableEnrichers(): EnrichmentType[] {
    return this.data?.enrichment?.getAvailableEnrichers() ?? [];
  }

  /**
   * 获取可用质量检查器
   */
  getAvailableQualityCheckers(): QualityDimension[] {
    return this.quality?.gate?.getAvailableCheckers() ?? [];
  }
}
```

### 5.2 Feature 模块定义

```typescript
// backend/src/modules/ai-engine/facade/facade.providers.ts

// 新增 Feature Token
export const DATA_FEATURE = Symbol("DATA_FEATURE");
export const EVIDENCE_FEATURE = Symbol("EVIDENCE_FEATURE");
export const QUALITY_FEATURE = Symbol("QUALITY_FEATURE");
export const REVIEW_FEATURE = Symbol("REVIEW_FEATURE");
export const REALTIME_FEATURE = Symbol("REALTIME_FEATURE");

// Feature 接口
export interface DataFeature {
  router: DataSourceRouterService;
  enrichment: DataEnrichmentService;
}

export interface EvidenceFeature {
  manager: EvidenceManagerService;
}

export interface QualityFeature {
  gate: QualityGateService;
}

export interface ReviewFeature {
  workflow: ReviewWorkflowService;
  todo: TodoService;
}

export interface RealtimeFeature {
  eventEmitter: EngineEventEmitterService;
  progressTracker: ProgressTrackerService;
}

// Provider 工厂
export const dataFeatureProvider: Provider = {
  provide: DATA_FEATURE,
  useFactory: (router, enrichment) => ({ router, enrichment }),
  inject: [DataSourceRouterService, DataEnrichmentService],
};

export const evidenceFeatureProvider: Provider = {
  provide: EVIDENCE_FEATURE,
  useFactory: (manager) => ({ manager }),
  inject: [EvidenceManagerService],
};

// ... 其他 Feature Provider ...
```

---

## 六、迁移步骤

### Phase 1: 基础设施 (1-2 周)

```
Step 1.1: 创建目录结构
├─ 创建 data/, evidence/, quality/, realtime/ 目录
├─ 创建抽象接口文件
└─ 创建模块文件

Step 1.2: 实现核心服务
├─ DataSourceRouterService
├─ DataEnrichmentService
├─ EvidenceManagerService
├─ QualityGateService
└─ EngineEventEmitterService

Step 1.3: 扩展 Facade
├─ 添加新的依赖注入
├─ 实现新的公共方法
└─ 更新模块导出
```

### Phase 2: 数据源迁移 (1 周)

```
Step 2.1: 迁移 Topic Research 数据源
├─ 将 data-source-router.service.ts 重构为实现 IDataSource
├─ 将各数据源 (web-search, news, academic) 独立为插件
└─ 注册到 DataSourceRouterService

Step 2.2: 迁移数据增强器
├─ 将 data-enrichment.service.ts 拆分为多个 IDataEnricher
├─ 实现 ContentExtractorEnricher
├─ 实现 FigureExtractorEnricher
└─ 注册到 DataEnrichmentService

Step 2.3: 更新 Topic Research 调用
├─ 替换直接服务调用为 Facade 调用
└─ 验证功能完整性
```

### Phase 3: 质量控制迁移 (1 周)

```
Step 3.1: 迁移 AI Writing 质量检查器
├─ 提取通用检查器到 quality/checkers/
├─ 保留写作专用检查器在 AI Writing
└─ 注册通用检查器到 QualityGateService

Step 3.2: 更新 AI Writing 调用
├─ 通用检查使用 Facade
├─ 写作专用检查保留直接调用
└─ 验证质量评分一致性
```

### Phase 4: 协作与实时推送 (1 周)

```
Step 4.1: 迁移审查工作流
├─ 提取 ReviewWorkflowService 到 collaboration/review/
├─ 提取 TodoService 到 collaboration/todo/
└─ 更新 Topic Research 调用

Step 4.2: 统一实时推送
├─ 创建 EngineEventEmitterService
├─ 创建 WebSocket 基类
├─ Topic Research Gateway 继承基类
├─ AI Writing Gateway 继承基类
└─ 验证事件推送

Step 4.3: 新增 AI Writing 支持
├─ AI Writing 接入 Facade 数据能力
├─ AI Writing 接入 Facade 审查能力
└─ 集成测试
```

### Phase 5: 文档与测试 (1 周)

```
Step 5.1: 单元测试
├─ DataSourceRouterService 测试
├─ DataEnrichmentService 测试
├─ QualityGateService 测试
└─ EvidenceManagerService 测试

Step 5.2: 集成测试
├─ Facade 完整流程测试
├─ Topic Research 集成测试
└─ AI Writing 集成测试

Step 5.3: 文档更新
├─ 更新 AI Engine 架构文档
├─ 新增能力使用指南
└─ 更新 CLAUDE.md
```

---

## 七、API 迁移对照表

### 7.1 Topic Research 迁移

| 原调用                                        | 新调用                                |
| --------------------------------------------- | ------------------------------------- |
| `dataSourceRouter.fetchDataForDimension()`    | `facade.fetchData(request)`           |
| `dataEnrichmentService.enrichSearchResults()` | `facade.enrichData(items, options)`   |
| `evidenceManagementService.saveEvidence()`    | `facade.saveEvidence(request)`        |
| `reviewWorkflowService.createReview()`        | `facade.createReview(request)`        |
| `eventEmitter.emit('research.progress')`      | `facade.emitProgress(room, progress)` |

### 7.2 AI Writing 新增调用

| 场景         | API 调用                                                           |
| ------------ | ------------------------------------------------------------------ |
| 自动素材搜索 | `facade.fetchAndEnrich({ query, context: { domain: 'writing' } })` |
| 引用追踪     | `facade.saveEvidence({ type: 'inspiration', ... })`                |
| 质量门禁     | `facade.checkQuality(content, config)`                             |
| 编辑审查     | `facade.createReview({ entityType: 'chapter', ... })`              |
| 进度推送     | `facade.emitProgress(room, progress)`                              |

---

## 八、风险与缓解

| 风险         | 缓解措施                     |
| ------------ | ---------------------------- |
| 接口不兼容   | 使用适配器模式，保持向后兼容 |
| 性能下降     | 增加缓存层，优化并发控制     |
| 功能回归     | 完善单元测试和集成测试       |
| 迁移中断服务 | 分阶段迁移，新旧并存过渡     |

---

## 九、成功指标

| 指标                | 目标                         |
| ------------------- | ---------------------------- |
| 代码复用率          | Topic Research 减少 30% 代码 |
| AI Writing 新增能力 | 数据增强、审查工作流         |
| 测试覆盖率          | 新模块 > 80%                 |
| 接口响应时间        | 无明显增加 (< 5%)            |
| 迁移周期            | 5 周内完成                   |

---

## 十、后续扩展

完成本次下沉后，以下 AI Apps 可快速接入：

| 模块      | 可用能力                     |
| --------- | ---------------------------- |
| AI Teams  | 数据获取、证据管理、协作审查 |
| AI Office | 数据增强、质量门禁           |
| AI Ask    | 数据获取（联网搜索）         |
| AI Coding | 质量门禁（代码质量检查）     |

---

**文档版本**: 1.0
**创建日期**: 2026-02-03
**维护者**: Claude Code
