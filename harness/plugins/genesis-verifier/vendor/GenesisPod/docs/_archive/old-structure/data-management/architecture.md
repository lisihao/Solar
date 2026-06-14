# 数据采集系统技术架构文档

## 文档信息

- **版本**: v1.0
- **创建日期**: 2025-11-21
- **最后更新**: 2025-11-21
- **状态**: Draft

---

## 一、系统架构概览

### 1.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                      数据采集调度中心                             │
│  (BullMQ + Redis + Priority Queue)                              │
└────────────────┬────────────────────────────────────────────────┘
                 │
     ┌───────────┼───────────┬───────────┬──────────┐
     │           │           │           │          │
┌────▼────┐ ┌───▼────┐ ┌───▼────┐ ┌───▼────┐ ┌──▼──────┐
│ arXiv   │ │ Medium │ │YouTube │ │ GitHub │ │Policy   │
│ Crawler │ │Crawler │ │Crawler │ │Crawler │ │Scraper  │
└────┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ └──┬──────┘
     │          │          │          │         │
     └──────────┴──────────┴──────────┴─────────┘
                         │
            ┌────────────▼───────────────┐
            │   数据预处理层               │
            │ • 格式统一化                │
            │ • 内容提取                  │
            │ • 元数据解析                │
            └────────────┬───────────────┘
                         │
            ┌────────────▼───────────────┐
            │   智能去重引擎               │
            │ • URL哈希去重               │
            │ • 标题相似度去重             │
            │ • 内容指纹去重               │
            │ • 作者+时间去重              │
            └────────────┬───────────────┘
                         │
                ┌────────┴─────────┐
                │                  │
        ┌───────▼────────┐  ┌─────▼──────────┐
        │   MongoDB      │  │  PostgreSQL    │
        │ (原始完整数据)  │  │ (结构化数据)    │
        │                │  │                │
        │ • 100%原始内容 │  │ • 规范化字段    │
        │ • 采集元数据   │  │ • 关联关系      │
        │ • 数据血缘     │  │ • 业务状态      │
        └───────┬────────┘  └─────┬──────────┘
                │  双向引用 ↔      │
                └──────────────────┘
                         │
            ┌────────────▼───────────────┐
            │   AI增强处理层              │
            │ • 自动摘要                  │
            │ • 智能分类                  │
            │ • 关键词提取                │
            │ • 质量评分                  │
            │ • 情感分析                  │
            └────────────┬───────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
  ┌─────▼──────┐  ┌─────▼──────┐  ┌─────▼──────┐
  │   Neo4j    │  │  Qdrant    │  │   Redis    │
  │ (知识图谱)  │  │ (向量索引)  │  │  (缓存层)  │
  └────────────┘  └────────────┘  └────────────┘
                         │
            ┌────────────▼───────────────┐
            │     数据质量监控             │
            │ • 完整性检查                │
            │ • 一致性验证                │
            │ • 异常告警                  │
            └─────────────────────────────┘
```

### 1.2 技术栈总览

| 层级         | 技术                  | 版本   | 用途              |
| ------------ | --------------------- | ------ | ----------------- |
| **任务调度** | BullMQ                | Latest | 分布式任务队列    |
| **缓存层**   | Redis                 | 7.x    | 缓存、会话、队列  |
| **后端框架** | NestJS                | 10.x   | 企业级Node.js框架 |
| **ORM**      | Prisma                | 5.x    | PostgreSQL ORM    |
| **NoSQL**    | MongoDB               | 7.x    | 原始数据存储      |
| **爬虫框架** | Playwright            | Latest | 动态网页爬取      |
| **HTML解析** | Cheerio               | Latest | 静态HTML解析      |
| **去重算法** | Custom                | -      | SimHash + MinHash |
| **AI服务**   | FastAPI               | Latest | Python AI服务     |
| **AI引擎**   | Grok/OpenAI           | Latest | 文本分析          |
| **向量化**   | sentence-transformers | Latest | Embedding生成     |
| **向量库**   | Qdrant                | 1.7+   | 语义搜索          |

---

## 二、核心模块设计

### 2.1 任务调度模块

#### 2.1.1 BullMQ队列设计

```typescript
// 队列配置
const queues = {
  "data-collection": {
    priority: {
      HIGH: 1, // 手动触发
      MEDIUM: 5, // 定时任务
      LOW: 10, // 补采任务
    },
    concurrency: {
      default: 5,
      per_source: 3,
    },
  },
};

// 任务结构
interface CollectionJob {
  id: string;
  type: "SCHEDULED" | "MANUAL" | "RETRY";
  sourceId: string;
  config: {
    maxResults: number;
    category?: string;
    dateRange?: { from: Date; to: Date };
  };
  metadata: {
    createdBy: string;
    priority: number;
    retryCount: number;
  };
}
```

#### 2.1.2 调度策略

```typescript
// Cron调度
const schedulers = {
  arxiv: {
    expression: "0 0,18 * * *", // 每天0点和18点
    timezone: "UTC",
    enabled: true,
  },
  github: {
    expression: "0 6 * * *", // 每天6点
    timezone: "UTC",
    enabled: true,
  },
  medium: {
    expression: "0 */6 * * *", // 每6小时
    timezone: "UTC",
    enabled: true,
  },
};
```

### 2.2 数据采集模块

#### 2.2.1 爬虫基类设计

```typescript
// backend/src/modules/crawler/base-crawler.service.ts

abstract class BaseCrawlerService {
  abstract sourceName: string;
  abstract sourceType: DataSourceType;

  constructor(
    protected readonly http: HttpService,
    protected readonly mongo: MongoService,
    protected readonly prisma: PrismaService,
    protected readonly dedup: DeduplicationService,
    protected readonly quality: QualityAssessmentService,
  ) {}

  // 核心采集流程
  async collect(config: CollectionConfig): Promise<CollectionResult> {
    // 1. 获取数据
    const rawItems = await this.fetchData(config);

    // 2. 解析数据
    const parsedItems = await this.parseData(rawItems);

    // 3. 去重检测
    const uniqueItems = await this.deduplicateItems(parsedItems);

    // 4. 数据存储
    const results = await this.storeItems(uniqueItems);

    // 5. 质量评估（异步）
    this.queueQualityAssessment(results);

    return this.generateReport(results);
  }

  // 子类实现的抽象方法
  protected abstract fetchData(config: CollectionConfig): Promise<any[]>;
  protected abstract parseData(rawItems: any[]): Promise<ParsedItem[]>;

  // 通用方法
  protected async deduplicateItems(items: ParsedItem[]): Promise<ParsedItem[]> {
    const unique: ParsedItem[] = [];
    for (const item of items) {
      const duplicate = await this.dedup.checkDuplicate({
        url: item.url,
        title: item.title,
        content: item.content,
      });

      if (!duplicate.isDuplicate) {
        unique.push(item);
      } else {
        // 记录重复
        await this.recordDuplicate(item, duplicate);
      }
    }
    return unique;
  }

  protected async storeItems(items: ParsedItem[]): Promise<StoredItem[]> {
    const results: StoredItem[] = [];

    for (const item of items) {
      // 1. 存储完整原始数据到MongoDB
      const rawDoc = await this.mongo.insertRawData({
        source: this.sourceName,
        sourceType: this.sourceType,
        data: item.raw, // 完整原始数据
        collectionMetadata: item.metadata,
        deduplication: {
          urlHash: this.dedup.generateUrlHash(item.url),
          titleHash: this.dedup.generateTitleHash(item.title),
          contentFingerprint: this.dedup.generateContentFingerprint(
            item.content,
          ),
        },
      });

      // 2. 创建PostgreSQL资源记录
      const resource = await this.prisma.resource.create({
        data: {
          type: item.type,
          title: item.title,
          abstract: item.abstract,
          content: item.content,
          sourceUrl: item.url,
          sourceType: this.sourceName,
          authors: JSON.stringify(item.authors),
          publishedAt: item.publishedAt,
          rawDataId: rawDoc._id.toString(), // ⭐ 关联MongoDB
          processingStatus: "PENDING",
        },
      });

      // 3. 回写resourceId到MongoDB
      await this.mongo.updateRawData(rawDoc._id, {
        resourceId: resource.id,
      });

      results.push({ rawDoc, resource });
    }

    return results;
  }
}
```

#### 2.2.2 具体爬虫实现示例

```typescript
// backend/src/modules/crawler/arxiv.service.ts

@Injectable()
export class ArxivCrawlerService extends BaseCrawlerService {
  sourceName = "arxiv";
  sourceType = DataSourceType.ARXIV;

  protected async fetchData(config: CollectionConfig): Promise<any[]> {
    const { maxResults, category } = config;

    // 调用arXiv API
    const response = await this.http.get("http://export.arxiv.org/api/query", {
      params: {
        search_query: category ? `cat:${category}` : "all",
        max_results: maxResults,
        sortBy: "submittedDate",
        sortOrder: "descending",
      },
    });

    // 解析XML
    const parser = new XMLParser();
    const result = parser.parse(response.data);

    return result.feed.entry || [];
  }

  protected async parseData(rawItems: any[]): Promise<ParsedItem[]> {
    return rawItems.map((item) => ({
      type: "PAPER",
      title: item.title.trim(),
      abstract: item.summary.trim(),
      content: item.summary.trim(),
      url: item.id,
      authors: item.author.map((a) => ({
        name: a.name,
        affiliation: a.affiliation?.name,
      })),
      publishedAt: new Date(item.published),
      raw: item, // 保留完整原始数据
      metadata: {
        arxivId: item.id.split("/").pop(),
        categories: item.category.map((c) => c.$.term),
        pdfUrl: `${item.id}.pdf`,
        doi: item["arxiv:doi"]?.[0],
      },
    }));
  }
}
```

### 2.3 去重引擎模块

详细实现参见产品需求文档中的代码示例。

核心算法：

1. **URL哈希去重**: MD5(规范化URL)
2. **标题相似度**: MinHash + LSH + Levenshtein距离
3. **内容指纹**: SimHash + 汉明距离
4. **作者+时间**: 组合键索引

### 2.4 数据质量模块

#### 2.4.1 质量评分服务

```typescript
// backend/src/modules/data-collection/services/quality-assessment.service.ts

@Injectable()
export class QualityAssessmentService {
  async assessQuality(resourceId: string): Promise<QualityScore> {
    const resource = await this.prisma.resource.findUnique({
      where: { id: resourceId },
      include: { rawData: true },
    });

    // 1. 完整性评分 (40%)
    const completeness = this.assessCompleteness(resource);

    // 2. 准确性评分 (30%)
    const accuracy = await this.assessAccuracy(resource);

    // 3. 时效性评分 (20%)
    const timeliness = this.assessTimeliness(resource);

    // 4. 可用性评分 (10%)
    const usability = await this.assessUsability(resource);

    const totalScore =
      completeness * 0.4 + accuracy * 0.3 + timeliness * 0.2 + usability * 0.1;

    // 检测质量问题
    const issues = this.detectIssues(resource, {
      completeness,
      accuracy,
      timeliness,
      usability,
    });

    // 更新数据库
    await this.prisma.resource.update({
      where: { id: resourceId },
      data: {
        qualityScore: totalScore,
        completenessScore: completeness,
        qualityIssues: JSON.stringify(issues),
      },
    });

    return {
      totalScore,
      completeness,
      accuracy,
      timeliness,
      usability,
      issues,
    };
  }

  private assessCompleteness(resource: Resource): number {
    let score = 0;

    // 标题 (10分)
    if (resource.title && resource.title.length > 10) score += 10;

    // 内容 (10分)
    if (resource.content && resource.content.length > 100) score += 10;

    // 作者 (10分)
    if (resource.authors && JSON.parse(resource.authors).length > 0)
      score += 10;

    // 时间 (5分)
    if (resource.publishedAt) score += 5;

    // 元数据 (5分)
    if (resource.categories || resource.tags) score += 5;

    return (score * 10) / 40; // 归一化到0-10
  }

  private async assessAccuracy(resource: Resource): Promise<number> {
    let score = 0;

    // URL有效性 (10分)
    if (await this.isUrlValid(resource.sourceUrl)) score += 10;

    // 格式正确性 (10分)
    if (resource.content && this.isContentValid(resource.content)) score += 10;

    // 分类准确性 (10分)
    // TODO: 基于AI分类置信度
    score += 10;

    return (score * 10) / 30; // 归一化到0-10
  }

  private assessTimeliness(resource: Resource): number {
    if (!resource.publishedAt) return 0;

    const daysSincePublish = this.getDaysSince(resource.publishedAt);
    const daysSinceCrawl = this.getDaysSince(resource.crawledAt);

    let score = 0;

    // 发布时间得分
    if (daysSincePublish <= 7) score += 10;
    else if (daysSincePublish <= 30) score += 8;
    else score += 5;

    // 采集及时性
    if (daysSinceCrawl - daysSincePublish <= 1) score += 10;
    else score += 5;

    return (score * 10) / 20; // 归一化到0-10
  }

  private async assessUsability(resource: Resource): Promise<number> {
    let score = 0;

    // PDF可访问性 (5分)
    if (resource.pdfUrl && (await this.isUrlValid(resource.pdfUrl))) score += 5;

    // 图片完整性 (5分)
    if (resource.thumbnailUrl && (await this.isUrlValid(resource.thumbnailUrl)))
      score += 5;

    return (score * 10) / 10; // 归一化到0-10
  }

  private detectIssues(resource: Resource, scores: any): QualityIssue[] {
    const issues: QualityIssue[] = [];

    if (!resource.title || resource.title.length < 10) {
      issues.push({
        type: "MISSING_TITLE",
        severity: "HIGH",
        message: "标题缺失或过短",
        suggestion: "从PDF或内容中提取标题",
      });
    }

    if (!resource.content || resource.content.length < 100) {
      issues.push({
        type: "MISSING_CONTENT",
        severity: "HIGH",
        message: "内容缺失或过短",
        suggestion: "重新采集完整内容",
      });
    }

    if (scores.completeness < 7) {
      issues.push({
        type: "INCOMPLETE_METADATA",
        severity: "MEDIUM",
        message: "元数据不完整",
        suggestion: "补充作者、时间等信息",
      });
    }

    return issues;
  }
}
```

### 2.5 AI增强模块

#### 2.5.1 AI编排服务

```typescript
// backend/src/modules/ai/ai-orchestrator.service.ts

@Injectable()
export class AIOrchestrator {
  constructor(
    private readonly grokClient: GrokClient,
    private readonly openaiClient: OpenAIClient,
    private readonly prisma: PrismaService,
  ) {}

  async enrichResource(resourceId: string): Promise<void> {
    const resource = await this.prisma.resource.findUnique({
      where: { id: resourceId },
    });

    // 准备内容
    const content = this.prepareContent(resource);

    try {
      // 1. 生成摘要
      const summary = await this.generateSummary(content);

      // 2. 提取洞察
      const insights = await this.extractInsights(content);

      // 3. 智能分类
      const classification = await this.classifyContent(content);

      // 4. 提取关键词
      const tags = await this.extractTags(content);

      // 5. 更新资源
      await this.prisma.resource.update({
        where: { id: resourceId },
        data: {
          aiSummary: summary,
          keyInsights: JSON.stringify(insights),
          primaryCategory: classification.primary,
          categories: JSON.stringify(classification.categories),
          autoTags: JSON.stringify(tags),
          processingStatus: "COMPLETED",
        },
      });
    } catch (error) {
      // 失败降级：使用基础处理
      await this.fallbackProcessing(resourceId, error);
    }
  }

  private async generateSummary(content: string): Promise<string> {
    // 优先使用Grok（快且便宜）
    try {
      return await this.grokClient.summarize(content, { maxLength: 200 });
    } catch (error) {
      // 降级到OpenAI
      return await this.openaiClient.summarize(content, { maxLength: 200 });
    }
  }

  private async extractInsights(content: string): Promise<string[]> {
    const prompt = `Extract 5-10 key insights from this content:\n\n${content}`;
    const response = await this.grokClient.chat(prompt);
    return this.parseInsights(response);
  }

  private async classifyContent(content: string): Promise<Classification> {
    const prompt = `Classify this content into relevant categories:\n\n${content}`;
    const response = await this.grokClient.chat(prompt);
    return this.parseClassification(response);
  }
}
```

---

## 三、数据流设计

### 3.1 完整数据采集流程

详见产品需求文档中的流程图。

### 3.2 数据存储策略

#### 3.2.1 双存储架构

**MongoDB**: 存储完整原始数据

- 优势: 灵活schema，适合存储不规则的原始数据
- 用途: 数据审计、重新处理、数据恢复

**PostgreSQL**: 存储结构化业务数据

- 优势: ACID事务、关系查询、性能优化
- 用途: 业务逻辑、用户交互、报表统计

**双向引用**:

```
PostgreSQL.Resource.rawDataId → MongoDB._id
MongoDB.document.resourceId → PostgreSQL.Resource.id
```

#### 3.2.2 缓存策略

```typescript
// Redis缓存层次
const cacheStrategy = {
  // L1: URL哈希（去重用）
  urlHash: {
    prefix: "url:",
    ttl: 86400, // 24小时
    type: "string",
  },

  // L2: 标题索引（相似度检测）
  titleIndex: {
    prefix: "titles:",
    ttl: -1, // 永久
    type: "list",
    maxSize: 10000,
  },

  // L3: 内容指纹（去重用）
  fingerprint: {
    prefix: "fp:",
    ttl: -1, // 永久
    type: "hash",
  },

  // L4: 资源列表（API响应）
  resourceList: {
    prefix: "res:list:",
    ttl: 3600, // 1小时
    type: "string",
  },
};
```

---

## 四、性能优化

### 4.1 并发控制

```typescript
// 并发限制
const concurrencyLimits = {
  global: 10, // 全局最大并发
  perSource: 3, // 每个数据源最大并发
  perIP: 5, // 每个IP最大并发（代理池）
  rateLimit: {
    arxiv: "1/s", // 每秒1次
    github: "5/s", // 每秒5次（API限制）
    medium: "2/s", // 每秒2次
  },
};
```

### 4.2 数据库优化

```sql
-- PostgreSQL索引优化
CREATE INDEX idx_resources_type_published ON resources(type, published_at DESC);
CREATE INDEX idx_resources_source_crawled ON resources(source_type, crawled_at DESC);
CREATE INDEX idx_resources_quality ON resources(quality_score DESC);
CREATE INDEX idx_resources_status ON resources(status, processing_status);
CREATE INDEX idx_resources_external_id ON resources(external_id);

-- MongoDB索引优化
db.data_collection_raw_data.createIndex({ "source": 1, "createdAt": -1 });
db.data_collection_raw_data.createIndex({ "data.externalId": 1 }, { unique: true, sparse: true });
db.data_collection_raw_data.createIndex({ "resourceId": 1 });
db.data_collection_raw_data.createIndex({ "deduplication.urlHash": 1 });
db.data_collection_raw_data.createIndex({ "deduplication.contentFingerprint": 1 });
```

### 4.3 队列优化

```typescript
// BullMQ优化配置
const queueConfig = {
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: {
      age: 86400, // 保留24小时
      count: 1000, // 最多保留1000个
    },
    removeOnFail: {
      age: 604800, // 保留7天
    },
  },
  settings: {
    stalledInterval: 30000, // 30秒检查一次
    maxStalledCount: 2,
  },
};
```

---

## 五、监控与告警

### 5.1 监控指标

```typescript
interface SystemMetrics {
  // 任务指标
  taskMetrics: {
    activeJobs: number;
    queueLength: number;
    avgWaitTime: number;
    completedToday: number;
    failedToday: number;
  };

  // 性能指标
  performanceMetrics: {
    cpuUsage: number;
    memoryUsage: number;
    networkIO: number;
    diskIO: number;
  };

  // 业务指标
  businessMetrics: {
    collectionRate: number; // 条/分钟
    deduplicationRate: number; // 去重率
    averageQualityScore: number; // 平均质量分
    successRate: number; // 成功率
  };
}
```

### 5.2 告警规则

```typescript
const alertRules = [
  {
    name: "采集成功率过低",
    condition: "successRate < 0.8",
    severity: "HIGH",
    action: "EMAIL + SLACK",
  },
  {
    name: "队列积压严重",
    condition: "queueLength > 1000",
    severity: "MEDIUM",
    action: "SLACK",
  },
  {
    name: "内存使用过高",
    condition: "memoryUsage > 0.9",
    severity: "HIGH",
    action: "EMAIL + AUTO_SCALE",
  },
  {
    name: "质量分下降",
    condition: "averageQualityScore < 7.0",
    severity: "MEDIUM",
    action: "EMAIL",
  },
];
```

---

## 六、安全设计

### 6.1 认证与授权

```typescript
// API认证
const authStrategy = {
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: "7d",
  },
  rbac: {
    roles: ["admin", "operator", "viewer"],
    permissions: {
      admin: ["*"],
      operator: ["read", "write", "execute"],
      viewer: ["read"],
    },
  },
};
```

### 6.2 数据安全

- API Key加密存储（AES-256）
- 敏感信息脱敏
- 数据传输HTTPS加密
- MongoDB备份策略（每日全量 + 实时增量）
- PostgreSQL WAL归档

---

## 七、部署架构

### 7.1 Docker Compose部署

```yaml
version: "3.8"

services:
  # 后端服务
  backend:
    build: ./backend
    environment:
      - NODE_ENV=production
    depends_on:
      - postgres
      - mongodb
      - redis

  # PostgreSQL
  postgres:
    image: postgres:16
    volumes:
      - postgres_data:/var/lib/postgresql/data

  # MongoDB
  mongodb:
    image: mongo:7
    volumes:
      - mongodb_data:/data/db

  # Redis
  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

  # Qdrant
  qdrant:
    image: qdrant/qdrant:latest
    volumes:
      - qdrant_data:/qdrant/storage

volumes:
  postgres_data:
  mongodb_data:
  redis_data:
  qdrant_data:
```

### 7.2 扩展性设计

```
┌─────────────────────────────────────────────┐
│           Load Balancer (Nginx)             │
└─────────────────┬───────────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
┌───▼───┐    ┌───▼───┐    ┌───▼───┐
│Backend│    │Backend│    │Backend│
│  #1   │    │  #2   │    │  #3   │
└───┬───┘    └───┬───┘    └───┬───┘
    │             │             │
    └─────────────┼─────────────┘
                  │
    ┌─────────────┴─────────────┐
    │                           │
┌───▼───────┐          ┌────────▼──────┐
│PostgreSQL │          │  MongoDB      │
│(Primary + │          │  (ReplicaSet) │
│ Replicas) │          └───────────────┘
└───────────┘
```

---

## 八、技术债务与未来优化

### 8.1 短期优化（1-3个月）

- [ ] 实现分布式爬虫（多机部署）
- [ ] 优化去重算法（引入Bloom Filter）
- [ ] 增加数据源（目标15+个）
- [ ] 完善监控告警系统

### 8.2 长期规划（6-12个月）

- [ ] 引入增量更新机制
- [ ] 构建数据仓库（OLAP分析）
- [ ] AI模型微调（提高分类准确度）
- [ ] 知识图谱自动构建

---

## 附录

### A. 相关文档

- [产品需求文档](../prd/data-collection-system-v3.0.md)
- [数据模型设计](./data-model.md)
- [实施路线图](./implementation-roadmap.md)

### B. 参考资料

- BullMQ官方文档: https://docs.bullmq.io/
- Playwright文档: https://playwright.dev/
- SimHash算法: https://en.wikipedia.org/wiki/SimHash
