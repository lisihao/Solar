# 数据采集系统数据模型设计

## 文档信息

- **版本**: v1.0
- **创建日期**: 2025-11-21
- **最后更新**: 2025-11-21
- **状态**: Draft

---

## 一、数据库架构概览

### 1.1 多数据库架构

```
┌─────────────────────────────────────────────────────────────┐
│                     数据存储架构                             │
└─────────────────────────────────────────────────────────────┘

PostgreSQL (主数据库)
├── 结构化业务数据
├── 资源主表（resources）
├── 采集任务（collection_tasks）
├── 数据源配置（data_sources）
├── 去重记录（deduplication_records）
└── 质量指标（quality_metrics）

MongoDB (原始数据)
├── 完整原始数据（data_collection_raw_data）
├── 灵活Schema
├── 数据审计
└── 重新处理

Neo4j (知识图谱)
├── 实体节点（Author, Topic, Paper...）
├── 关系边（AUTHORED_BY, DISCUSSES...）
└── 图分析

Redis (缓存层)
├── URL哈希索引
├── 标题索引
├── 内容指纹
└── 任务队列

Qdrant (向量数据库)
├── 文本Embedding
├── 语义搜索
└── 相似推荐
```

---

## 二、PostgreSQL 数据模型

### 2.1 核心表结构

#### 2.1.1 资源表 (resources)

**用途**: 存储所有类型的资源（论文、博客、视频等）

```prisma
model Resource {
  id                    String            @id @default(uuid())

  // === 基础信息 ===
  type                  ResourceType      // PAPER|BLOG|REPORT|YOUTUBE|NEWS|PROJECT|POLICY
  title                 String
  abstract              String?           @db.Text
  content               String?           @db.Text

  // === 来源信息 ===
  sourceUrl             String            @unique
  sourceType            String            // arxiv, medium, youtube等
  sourcePlatform        String?           // 平台名称
  externalId            String?           @unique  // 外部ID（如arXiv ID）

  // === 文件资源 ===
  pdfUrl                String?
  htmlUrl               String?
  videoUrl              String?
  thumbnailUrl          String?
  attachments           Json?             // [{type, url, size}]

  // === 作者和机构 ===
  authors               Json?             // [{name, email, affiliation, orcid}]
  organizations         Json?             // ["Stanford", "MIT"]

  // === 时间信息 ===
  publishedAt           DateTime?
  submittedAt           DateTime?         // 提交时间（论文）
  updatedAt             DateTime          @updatedAt
  crawledAt             DateTime          @default(now())

  // === AI增强 ===
  aiSummary             String?           @db.Text
  keyInsights           Json?             // ["insight1", "insight2"]
  structuredAISummary   Json?             // {overview, keyPoints, applications}
  autoTags              Json?             // ["AI", "Machine Learning"]
  sentimentScore        Float?            // -1.0 to 1.0

  // === 分类和标签 ===
  primaryCategory       String?
  categories            Json?             // ["AI", "Computer Vision"]
  tags                  Json?             // 用户标签

  // === 质量指标 ===
  qualityScore          Float             @default(0)  // 0-10
  completenessScore     Float             @default(0)  // 完整性
  relevanceScore        Float             @default(0)  // 相关性
  duplicateScore        Float?            // 重复可能性

  // === 热度指标 ===
  trendingScore         Float             @default(0)
  viewCount             Int               @default(0)
  saveCount             Int               @default(0)
  upvoteCount           Int               @default(0)
  commentCount          Int               @default(0)
  citationCount         Int?              // 引用数（论文）

  // === 关联关系 ===
  rawDataId             String?           @unique  // ⭐ MongoDB ObjectId
  embeddingId           String?           @unique  // Qdrant点ID
  collectionTaskId      String?           // 关联采集任务
  collectionTask        CollectionTask?   @relation(fields: [collectionTaskId], references: [id])

  // === 状态管理 ===
  status                ResourceStatus    @default(ACTIVE)
  processingStatus      ProcessingStatus  @default(PENDING)
  qualityIssues         Json?             // [{type, severity, message}]

  // === 审计字段 ===
  createdAt             DateTime          @default(now())
  createdBy             String?
  updatedBy             String?
  deletedAt             DateTime?

  // === 索引优化 ===
  @@index([type, publishedAt])
  @@index([sourceType, crawledAt])
  @@index([qualityScore])
  @@index([status, processingStatus])
  @@index([externalId])
  @@index([collectionTaskId])

  @@map("resources")
}

enum ResourceType {
  PAPER
  BLOG
  REPORT
  YOUTUBE
  NEWS
  PROJECT
  POLICY
}

enum ResourceStatus {
  ACTIVE
  ARCHIVED
  DELETED
  DUPLICATE
  UNDER_REVIEW
}

enum ProcessingStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
  SKIPPED
}
```

#### 2.1.2 采集任务表 (collection_tasks)

**用途**: 管理所有采集任务的执行状态和历史

```prisma
model CollectionTask {
  id                  String              @id @default(uuid())

  // === 基础信息 ===
  name                String
  description         String?
  type                CollectionTaskType  // SCHEDULED|MANUAL|IMPORT|RETRY

  // === 数据源配置 ===
  sourceId            String
  source              DataSource          @relation(fields: [sourceId], references: [id])
  sourceConfig        Json                // {maxResults, category, dateRange}

  // === 执行配置 ===
  schedule            String?             // Cron表达式
  priority            Int                 @default(5)    // 1-10
  maxConcurrency      Int                 @default(5)
  timeout             Int                 @default(300)  // 秒
  retryCount          Int                 @default(3)

  // === 去重配置 ===
  deduplicationRules  Json                // {methods, thresholds}

  // === 执行状态 ===
  status              TaskStatus          @default(PENDING)
  progress            Float               @default(0)     // 0-100
  currentStep         String?

  // === 统计信息 ===
  totalItems          Int                 @default(0)
  processedItems      Int                 @default(0)
  successItems        Int                 @default(0)
  failedItems         Int                 @default(0)
  duplicateItems      Int                 @default(0)
  skippedItems        Int                 @default(0)

  // === 时间信息 ===
  scheduledAt         DateTime?
  startedAt           DateTime?
  completedAt         DateTime?
  nextRunAt           DateTime?

  // === 错误信息 ===
  errorMessage        String?             @db.Text
  errorStack          String?             @db.Text
  warnings            Json?               // ["warning1", "warning2"]

  // === 结果数据 ===
  resultSummary       Json?               // {avg_quality, sources, etc}
  logs                Json?               // 日志摘要

  // === 审计字段 ===
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  createdBy           String?

  // === 关联 ===
  resources           Resource[]

  // === 索引 ===
  @@index([status, scheduledAt])
  @@index([sourceId, status])
  @@index([type, createdAt])

  @@map("collection_tasks")
}

enum CollectionTaskType {
  SCHEDULED
  MANUAL
  IMPORT
  RETRY
}

enum TaskStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
  PAUSED
}
```

#### 2.1.3 数据源表 (data_sources)

**用途**: 管理所有数据源的配置和状态

```prisma
model DataSource {
  id                  String              @id @default(uuid())

  // === 基础信息 ===
  name                String              @unique
  description         String?
  type                DataSourceType
  category            ResourceType        // 对应的资源类型

  // === 连接配置 ===
  baseUrl             String
  apiEndpoint         String?
  authType            String?             // NONE|API_KEY|OAUTH|COOKIE
  credentials         String?             @db.Text  // 加密存储

  // === 采集配置 ===
  crawlerType         String              // API|SCRAPER|RSS
  crawlerConfig       Json                // {selectors, patterns}
  rateLimit           Int?                // 每秒请求数

  // === 内容过滤 ===
  keywords            Json?               // ["AI", "Machine Learning"]
  categories          Json?               // ["cs.AI", "cs.LG"]
  languages           Json?               // ["en", "zh"]
  minQualityScore     Float               @default(0)

  // === 去重配置 ===
  deduplicationConfig Json?               // {methods, thresholds}

  // === 状态管理 ===
  status              DataSourceStatus    @default(ACTIVE)
  isVerified          Boolean             @default(false)
  lastTestedAt        DateTime?
  lastSuccessAt       DateTime?
  lastErrorMessage    String?

  // === 统计信息 ===
  totalCollected      Int                 @default(0)
  totalSuccess        Int                 @default(0)
  totalFailed         Int                 @default(0)
  totalDuplicates     Int                 @default(0)
  successRate         Float               @default(0)
  averageQuality      Float               @default(0)

  // === 审计字段 ===
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  createdBy           String?

  // === 关联 ===
  tasks               CollectionTask[]

  // === 索引 ===
  @@index([type, status])
  @@index([category, status])

  @@map("data_sources")
}

enum DataSourceType {
  ARXIV
  PUBMED
  IEEE
  ACL_ANTHOLOGY
  MEDIUM
  DEVTO
  SUBSTACK
  HASHNODE
  YOUTUBE
  BILIBILI
  HACKERNEWS
  TECHCRUNCH
  THE_VERGE
  GITHUB
  PRODUCTHUNT
  POLICY_US
  POLICY_EU
  POLICY_CN
  GARTNER
  MCKINSEY
  IDC
  CUSTOM
  RSS
}

enum DataSourceStatus {
  ACTIVE
  PAUSED
  FAILED
  MAINTENANCE
  DEPRECATED
}
```

#### 2.1.4 去重记录表 (deduplication_records)

**用途**: 记录所有去重检测的结果，用于审计和分析

```prisma
model DeduplicationRecord {
  id                  String              @id @default(uuid())

  // === 去重信息 ===
  resourceId          String?             // 如果保留，指向保留的资源
  duplicateOfId       String?             // 指向原始资源

  // === 检测方式 ===
  method              String              // URL_HASH|TITLE_SIMILARITY|CONTENT_FINGERPRINT|AUTHOR_TIME
  similarity          Float               // 相似度 0-1
  confidence          Float               @default(1.0)  // 置信度

  // === 去重依据 ===
  urlHash             String?
  titleHash           String?
  contentFingerprint  String?
  authorTimeKey       String?

  // === 原始数据 ===
  originalData        Json                // 被去重的原始数据（标题、URL等）
  comparedWith        Json?               // 比较的资源信息

  // === 决策信息 ===
  decision            DuplicateDecision
  isCorrect           Boolean?            // 人工验证结果

  // === 处理信息 ===
  processedBy         String?             // USER_ID or SYSTEM
  processedAt         DateTime            @default(now())
  notes               String?

  // === 审计 ===
  createdAt           DateTime            @default(now())

  // === 索引 ===
  @@index([urlHash])
  @@index([titleHash])
  @@index([contentFingerprint])
  @@index([resourceId])
  @@index([decision])

  @@map("deduplication_records")
}

enum DuplicateDecision {
  AUTO_SKIP          // 自动跳过（高相似度）
  MANUAL_SKIP        // 人工确认跳过
  MERGED             // 合并资源
  FALSE_POSITIVE     // 误判，实际不重复
  PENDING_REVIEW     // 待人工审核
}
```

#### 2.1.5 数据质量指标表 (data_quality_metrics)

**用途**: 记录每个资源的详细质量评分

```prisma
model DataQualityMetric {
  id                  String              @id @default(uuid())

  // === 关联资源 ===
  resourceId          String              @unique

  // === 完整性指标 (40%) ===
  hasTitle            Boolean             @default(false)
  titleLength         Int                 @default(0)
  hasContent          Boolean             @default(false)
  contentLength       Int                 @default(0)
  hasAuthor           Boolean             @default(false)
  authorCount         Int                 @default(0)
  hasPublishDate      Boolean             @default(false)
  hasMetadata         Boolean             @default(false)
  completenessScore   Float               @default(0)

  // === 准确性指标 (30%) ===
  urlValid            Boolean             @default(false)
  urlStatusCode       Int?
  formatValid         Boolean             @default(false)
  categoryAccuracy    Float               @default(0)
  accuracyScore       Float               @default(0)

  // === 时效性指标 (20%) ===
  daysSincePublish    Int?
  daysSinceCrawl      Int?
  crawlTimeliness     Float               @default(0)
  timelinessScore     Float               @default(0)

  // === 可用性指标 (10%) ===
  pdfAccessible       Boolean             @default(false)
  imagesComplete      Boolean             @default(false)
  usabilityScore      Float               @default(0)

  // === 总分 ===
  totalScore          Float               @default(0)

  // === 质量问题 ===
  issues              Json?               // [{type, severity, message}]
  issueCount          Int                 @default(0)
  highSeverityIssues  Int                 @default(0)

  // === 审计 ===
  assessedAt          DateTime            @default(now())
  assessedBy          String?             // SYSTEM or USER_ID

  // === 索引 ===
  @@index([totalScore])
  @@index([completenessScore])
  @@index([issueCount])

  @@map("data_quality_metrics")
}
```

---

## 三、MongoDB 数据模型

### 3.1 原始数据集合 (data_collection_raw_data)

**用途**: 存储完整的原始采集数据，用于审计和重新处理

```javascript
{
  _id: ObjectId,

  // === 来源信息 ===
  source: "arxiv" | "medium" | "youtube" | "github" | ...,
  sourceType: "api" | "scraper" | "rss",
  sourceVersion: "v1.0",  // 采集器版本

  // === 完整原始数据 ===
  data: {
    // ===== 通用字段 =====
    externalId: String,        // 外部唯一ID
    url: String,               // 原始URL
    title: String,
    description: String,
    content: String,           // 完整内容（HTML/Markdown）
    contentType: String,       // text/html, text/markdown
    language: String,          // en, zh, etc.

    // ===== 作者和来源 =====
    authors: [{
      name: String,
      email: String,
      affiliation: String,
      orcid: String,
      url: String
    }],
    organizations: [String],
    publisher: String,
    source: String,

    // ===== 时间信息 =====
    publishedDate: ISODate,
    submittedDate: ISODate,
    updatedDate: ISODate,
    accessedDate: ISODate,

    // ===== 分类和标签 =====
    categories: [String],
    tags: [String],
    keywords: [String],
    subjects: [String],

    // ===== 文件和资源 =====
    pdfUrl: String,
    htmlUrl: String,
    videoUrl: String,
    thumbnailUrl: String,
    attachments: [{
      type: String,           // pdf, image, video
      url: String,
      size: Number,           // bytes
      filename: String
    }],

    // ===== 特定类型字段 =====

    // 论文特有字段
    abstract: String,
    journal: String,
    conference: String,
    doi: String,
    arxivId: String,
    pmid: String,              // PubMed ID
    citationCount: Number,
    references: [String],

    // 视频特有字段
    duration: Number,          // 秒
    viewCount: Number,
    likeCount: Number,
    dislikeCount: Number,
    commentCount: Number,
    channelId: String,
    channelName: String,
    transcript: String,        // 字幕文本
    chapters: [{
      timestamp: Number,
      title: String
    }],

    // 博客特有字段
    readTime: Number,          // 分钟
    wordCount: Number,
    claps: Number,             // Medium拍手数
    responses: Number,

    // GitHub特有字段
    stars: Number,
    forks: Number,
    watchers: Number,
    openIssues: Number,
    language: String,
    topics: [String],
    license: String,
    contributors: [{
      username: String,
      contributions: Number
    }],
    readme: String,

    // 政策特有字段
    policyType: String,        // regulation, standard, guideline
    jurisdiction: String,      // US, EU, CN
    effectiveDate: ISODate,
    expirationDate: ISODate,
    relatedPolicies: [String],

    // ===== 原始响应（最重要！）=====
    _rawResponse: Object       // 完整API响应或HTML源码
  },

  // === 采集元数据 ===
  collectionMetadata: {
    taskId: "uuid",
    collectorName: String,
    collectorVersion: "1.0.0",
    userAgent: String,
    ipAddress: String,
    proxyUsed: Boolean,
    proxyUrl: String,
    requestHeaders: Object,
    responseHeaders: Object,
    httpStatus: Number,
    responseTime: Number,      // 毫秒
    contentLength: Number,
    contentType: String,
    redirectCount: Number,
    finalUrl: String
  },

  // === 处理状态 ===
  processingStatus: {
    status: "pending" | "processing" | "completed" | "failed",
    steps: [{
      name: String,            // parse, deduplicate, store, enrich
      status: String,
      startedAt: ISODate,
      completedAt: ISODate,
      duration: Number,        // 毫秒
      error: String
    }],
    retryCount: Number,
    maxRetries: Number,
    lastError: String,
    lastErrorAt: ISODate
  },

  // === 去重信息 ===
  deduplication: {
    urlHash: String,           // MD5(规范化URL)
    titleHash: String,         // MD5(标题)
    contentFingerprint: String,// SimHash(64位16进制)
    authorTimeKey: String,     // MD5(author1_author2_date)
    isDuplicate: Boolean,
    duplicateOfId: String,     // MongoDB _id
    duplicateOfResourceId: String,  // PostgreSQL UUID
    similarity: Number,        // 0-1
    detectedBy: String,        // url|title|content|author_time
    detectedAt: ISODate
  },

  // === 质量评估 ===
  quality: {
    score: Number,             // 0-10
    completeness: Number,      // 0-1
    confidence: Number,        // 0-1
    issues: [{
      severity: "high" | "medium" | "low",
      type: String,
      field: String,
      message: String,
      suggestion: String
    }],
    assessedAt: ISODate
  },

  // === PostgreSQL关联 ===
  resourceId: "uuid",          // ⭐ 关联的Resource ID

  // === 数据生命周期 ===
  createdAt: ISODate,
  updatedAt: ISODate,
  accessedAt: ISODate,         // 最后访问时间
  _indexed: Boolean,           // 是否已建立向量索引
  _archived: Boolean,          // 是否已归档
  _version: Number,            // 版本号（用于数据迁移）

  // === 合规性 ===
  license: String,
  copyrightHolder: String,
  usageRights: String,
  requiresAttribution: Boolean
}
```

### 3.2 MongoDB 索引设计

```javascript
// 主要查询索引
db.data_collection_raw_data.createIndex(
  {
    source: 1,
    createdAt: -1,
  },
  {
    name: "idx_source_created",
  },
);

// 唯一性索引
db.data_collection_raw_data.createIndex(
  {
    "data.externalId": 1,
  },
  {
    unique: true,
    sparse: true,
    name: "idx_external_id_unique",
  },
);

// PostgreSQL关联索引
db.data_collection_raw_data.createIndex(
  {
    resourceId: 1,
  },
  {
    name: "idx_resource_id",
  },
);

// 去重索引
db.data_collection_raw_data.createIndex(
  {
    "deduplication.urlHash": 1,
  },
  {
    name: "idx_url_hash",
  },
);

db.data_collection_raw_data.createIndex(
  {
    "deduplication.titleHash": 1,
  },
  {
    name: "idx_title_hash",
  },
);

db.data_collection_raw_data.createIndex(
  {
    "deduplication.contentFingerprint": 1,
  },
  {
    name: "idx_content_fingerprint",
  },
);

// 处理状态索引
db.data_collection_raw_data.createIndex(
  {
    "processingStatus.status": 1,
    createdAt: -1,
  },
  {
    name: "idx_processing_status",
  },
);

// 质量评分索引
db.data_collection_raw_data.createIndex(
  {
    "quality.score": -1,
  },
  {
    name: "idx_quality_score",
  },
);

// 复合索引（用于分页查询）
db.data_collection_raw_data.createIndex(
  {
    source: 1,
    "processingStatus.status": 1,
    createdAt: -1,
  },
  {
    name: "idx_source_status_created",
  },
);
```

---

## 四、Redis 数据结构

### 4.1 去重缓存

```typescript
// URL哈希索引
Key: `url:{MD5_HASH}`
Type: String
Value: resourceId (UUID)
TTL: 86400 (24小时)

// 标题索引（用于相似度检测）
Key: `titles:recent`
Type: List
Value: `{resourceId}:::{normalized_title}`
MaxSize: 10000
TTL: -1 (永久)

// 内容指纹索引
Key: `fingerprints:index`
Type: Hash
Field: resourceId
Value: SimHash(16进制)
TTL: -1 (永久)

// 作者-时间索引
Key: `author:{author1}_{author2}:{date}`
Type: String
Value: resourceId
TTL: 2592000 (30天)
```

### 4.2 任务队列

```typescript
// BullMQ队列（由BullMQ自动管理）
Key: `bull:data-collection:*`
Type: Various (String, Hash, ZSet, List)

// 自定义任务状态
Key: `task:{taskId}:status`
Type: Hash
Fields: {
  status: 'running' | 'completed' | 'failed',
  progress: 0-100,
  processedItems: Number,
  successItems: Number,
  failedItems: Number,
  duplicateItems: Number
}
TTL: 604800 (7天)
```

### 4.3 API响应缓存

```typescript
// 资源列表缓存
Key: `api:resources:list:{hash(params)}`
Type: String
Value: JSON.stringify(response)
TTL: 3600 (1小时)

// 资源详情缓存
Key: `api:resource:{resourceId}`
Type: String
Value: JSON.stringify(resource)
TTL: 1800 (30分钟)
```

---

## 五、Neo4j 图数据模型

### 5.1 节点类型

```cypher
// 资源节点
(:Resource {
  id: String,          // 对应PostgreSQL ID
  type: String,
  title: String,
  publishedAt: DateTime
})

// 作者节点
(:Author {
  id: String,          // ORCID或自动生成
  name: String,
  email: String,
  affiliation: String
})

// 主题节点
(:Topic {
  id: String,
  name: String,
  category: String
})

// 机构节点
(:Organization {
  id: String,
  name: String,
  country: String
})

// 概念节点
(:Concept {
  id: String,
  name: String,
  description: String
})

// 事件节点
(:Event {
  id: String,
  name: String,
  date: DateTime
})
```

### 5.2 关系类型

```cypher
// 创作关系
(Resource)-[:AUTHORED_BY {
  position: Number,    // 作者顺序
  isCorresponding: Boolean
}]->(Author)

// 讨论关系
(Resource)-[:DISCUSSES {
  relevance: Float     // 0-1
}]->(Topic)

// 引用关系
(Resource)-[:CITES {
  citedAt: DateTime
}]->(Resource)

// 所属关系
(Author)-[:AFFILIATED_WITH {
  startDate: DateTime,
  endDate: DateTime,
  position: String
}]->(Organization)

// 关联关系
(Resource)-[:RELATED_TO {
  similarity: Float,   // 0-1
  method: String       // semantic, citation, topic
}]->(Resource)

// 属于关系
(Resource)-[:BELONGS_TO]->(Topic)

// 发表关系
(Resource)-[:PUBLISHED_IN {
  publishedAt: DateTime
}]->(Event)
```

---

## 六、Qdrant 向量数据模型

### 6.1 集合配置

```python
# 创建集合
client.create_collection(
    collection_name="resources",
    vectors_config={
        "size": 384,  # sentence-transformers/all-MiniLM-L6-v2
        "distance": "Cosine"
    }
)
```

### 6.2 点结构

```python
{
    "id": "resource-uuid",
    "vector": [0.1, 0.2, ..., 0.384],  # 384维向量
    "payload": {
        "resource_id": "uuid",
        "title": "...",
        "type": "PAPER",
        "primary_category": "AI",
        "published_at": "2025-11-21T00:00:00Z",
        "quality_score": 8.5,
        "created_at": "2025-11-21T10:30:00Z"
    }
}
```

---

## 七、数据一致性保证

### 7.1 双向引用机制

```typescript
// 采集流程中的一致性保证
async function storeResource(data: ParsedItem): Promise<void> {
  // 开始事务（逻辑事务）
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. MongoDB: 插入原始数据
    const rawDoc = await RawData.create(
      [
        {
          source: data.source,
          data: data.raw,
          resourceId: null, // 待设置
        },
      ],
      { session },
    );

    // 2. PostgreSQL: 创建资源
    const resource = await prisma.resource.create({
      data: {
        title: data.title,
        rawDataId: rawDoc[0]._id.toString(),
      },
    });

    // 3. MongoDB: 回写resourceId
    await RawData.updateOne(
      { _id: rawDoc[0]._id },
      { $set: { resourceId: resource.id } },
      { session },
    );

    // 提交事务
    await session.commitTransaction();
  } catch (error) {
    // 回滚
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}
```

### 7.2 数据修复脚本

```typescript
// 检查和修复数据一致性
async function repairDataConsistency(): Promise<void> {
  // 检查1: PostgreSQL有rawDataId但MongoDB中不存在
  const orphanedResources = await prisma.resource.findMany({
    where: {
      rawDataId: { not: null },
    },
  });

  for (const resource of orphanedResources) {
    const exists = await mongo
      .collection("data_collection_raw_data")
      .findOne({ _id: new ObjectId(resource.rawDataId) });

    if (!exists) {
      console.warn(`Resource ${resource.id} references non-existent rawDataId`);
      // 修复: 清空rawDataId
      await prisma.resource.update({
        where: { id: resource.id },
        data: { rawDataId: null },
      });
    }
  }

  // 检查2: MongoDB有resourceId但PostgreSQL中不存在
  const rawDocs = await mongo
    .collection("data_collection_raw_data")
    .find({ resourceId: { $ne: null } })
    .toArray();

  for (const doc of rawDocs) {
    const exists = await prisma.resource.findUnique({
      where: { id: doc.resourceId },
    });

    if (!exists) {
      console.warn(`RawData ${doc._id} references non-existent resourceId`);
      // 修复: 清空resourceId
      await mongo
        .collection("data_collection_raw_data")
        .updateOne({ _id: doc._id }, { $set: { resourceId: null } });
    }
  }
}
```

---

## 八、数据迁移策略

### 8.1 版本化Schema

```javascript
// MongoDB文档版本
{
  _version: 2,  // 当前版本
  // ... 其他字段
}

// 迁移脚本
async function migrateToV2() {
  const docs = await db.data_collection_raw_data.find({ _version: 1 });

  for await (const doc of docs) {
    // 应用迁移逻辑
    await db.data_collection_raw_data.updateOne(
      { _id: doc._id },
      {
        $set: {
          'deduplication.contentFingerprint': generateFingerprint(doc.data.content),
          _version: 2
        }
      }
    );
  }
}
```

---

## 附录

### A. 数据量估算

| 数据库     | 表/集合     | 日增量 | 月增量 | 年增量 | 单条大小 | 年存储量 |
| ---------- | ----------- | ------ | ------ | ------ | -------- | -------- |
| PostgreSQL | resources   | 500    | 15K    | 180K   | 5KB      | 900MB    |
| MongoDB    | raw_data    | 500    | 15K    | 180K   | 50KB     | 9GB      |
| Neo4j      | nodes+edges | 2000   | 60K    | 720K   | 1KB      | 720MB    |
| Qdrant     | vectors     | 500    | 15K    | 180K   | 1.5KB    | 270MB    |
| Redis      | cache       | -      | -      | -      | -        | <1GB     |

**总计**: 约 11GB/年

### B. 备份策略

- PostgreSQL: 每日全量备份 + WAL归档
- MongoDB: 每日全量备份 + Oplog增量
- Neo4j: 每周全量备份
- Qdrant: 每周快照
- Redis: AOF持久化 + 每日RDB快照

---

## 相关文档

- [产品需求文档](../prd/data-collection-system-v3.0.md)
- [技术架构文档](./architecture.md)
- [实施路线图](./implementation-roadmap.md)
