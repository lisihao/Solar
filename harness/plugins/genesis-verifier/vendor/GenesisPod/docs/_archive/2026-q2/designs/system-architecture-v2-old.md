# GenesisPod - 技术架构设计

> **版本**: v2.0
> **创建日期**: 2025-11-07
> **最后更新**: 2026-03-05
> **架构师**: Genesis Team

---

## 目录

1. [系统架构概览](#1-系统架构概览)
2. [数据库设计](#2-数据库设计)
3. [API设计](#3-api设计)
4. [AI服务架构](#4-ai服务架构)
5. [部署架构](#5-部署架构)
6. [性能优化](#6-性能优化)

---

## 1. 系统架构概览

### 1.1 整体架构（6层模型）

```
┌──────────────────────────────────────────────────────────────────┐
│                          客户端层                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐                  │
│  │  Web App   │  │ Mobile App │  │  Browser   │                  │
│  │ (Next.js)  │  │   (React   │  │  Extension │                  │
│  │            │  │   Native)  │  │            │                  │
│  └──────┬─────┘  └──────┬─────┘  └──────┬─────┘                  │
└─────────┼────────────────┼────────────────┼────────────────────────┘
          └────────────────┴────────────────┘
                           │
                    ┌──────┴──────┐
                    │    CDN +    │
                    │   Nginx     │
                    └──────┬──────┘
                           │
┌──────────────────────────┴──────────────────────────────────────┐
│  L6 Intent Gateway（智能编排层）                                    │
│  用户入口 / 意图路由 / 追踪          modules/intent-gateway/       │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────────┐
│  L5 Open API（开放接口层）                                         │
│  MCP Server / Public API / Webhooks  modules/open-api/           │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────────┐
│  L4 AI Apps（业务应用层）                                          │
│  Research / Teams / Writing / Office  modules/ai-app/            │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────────┐
│  L2 AI Kernel（内核层）                                            │
│  进程管理 / IPC / 记忆 / 资源调度    modules/ai-kernel/            │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────────┐
│  L3 AI Engine（核心能力层）                                        │
│  LLM / Agents / Tools / RAG          modules/ai-engine/          │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────────┐
│  L1 Infrastructure（基础设施层）                                   │
│  Auth / Credits / Storage            modules/ai-infra/           │
└──────────────────────────┬──────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
     ┌────────┴────────┐      ┌────────┴────────┐
     │  PostgreSQL 16  │      │    Redis 7       │
     │  (主数据库)      │      │  (缓存/会话)     │
     │  结构化 + JSONB  │      │                 │
     │  + 图关系        │      │                 │
     └─────────────────┘      └─────────────────┘
```

### 1.2 技术栈

**前端**:

- **框架**: Next.js 14+ (App Router)
- **UI**: React 18+ + TypeScript
- **样式**: TailwindCSS
- **状态管理**: Zustand
- **数据获取**: TanStack Query (React Query)
- **表单**: React Hook Form + Zod

**后端**:

- **框架**: NestJS 10+
- **运行时**: Node.js 20 LTS
- **API**: REST (NestJS Controllers)
- **ORM**: Prisma
- **验证**: class-validator
- **认证**: JWT + Passport.js

**AI服务**:

- **LLM调用**: LiteLLM（统一路由 OpenAI / Claude / Grok 等）
- **调用方式**: `AiChatService.chat()` + `TaskProfile` + `modelType`
- **Embedding**: 应用层余弦相似度（JSONB存储向量）

**数据库**:

- **主数据库**: PostgreSQL 16（唯一数据库，结构化 + JSONB + 图关系）
- **缓存/会话**: Redis 7

**基础设施**:

- **容器**: Docker + Docker Compose
- **部署**: Railway
- **进程管理**: PM2
- **消息队列**: BullMQ (Redis-based)
- **日志**: Winston / NestJS Logger
- **监控**: Prometheus + Grafana

---

## 2. 数据库设计

### 2.1 PostgreSQL Schema

#### 核心表设计

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============ 用户相关 ============

model User {
  id              String    @id @default(uuid())
  email           String    @unique
  username        String?   @unique
  passwordHash    String?   @map("password_hash")

  // OAuth
  oauthProvider   String?   @map("oauth_provider")
  oauthId         String?   @map("oauth_id")

  // 订阅
  subscriptionTier String   @default("free") @map("subscription_tier")
  subscriptionExpiresAt DateTime? @map("subscription_expires_at")

  // 个人信息
  fullName        String?   @map("full_name")
  avatarUrl       String?   @map("avatar_url")
  bio             String?   @db.Text

  // 偏好设置
  preferences     Json      @default("{}")

  // 状态
  isActive        Boolean   @default(true) @map("is_active")
  isVerified      Boolean   @default(false) @map("is_verified")

  // 时间戳
  createdAt       DateTime  @default(now()) @map("created_at")
  lastLoginAt     DateTime? @map("last_login_at")

  // 关系
  interests       UserInterest[]
  collections     Collection[]
  activities      UserActivity[]
  learningPaths   LearningPath[]

  @@map("users")
}

model UserInterest {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  tag       String
  category  String?  // 'primary' | 'secondary'
  weight    Decimal  @default(1.0) @db.Decimal(5, 4)
  source    String   @default("manual")  // 'manual' | 'inferred'

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, tag])
  @@index([userId])
  @@index([tag])
  @@map("user_interests")
}

// ============ 资源相关 ============

enum ResourceType {
  PAPER
  PROJECT
  NEWS
  EVENT
  RSS
}

model Resource {
  id              String       @id @default(uuid())
  type            ResourceType

  // 基础信息
  title           String       @db.VarChar(1000)
  abstract        String?      @db.Text
  content         String?      @db.Text
  sourceUrl       String       @map("source_url") @db.Text
  pdfUrl          String?      @map("pdf_url") @db.Text
  codeUrl         String?      @map("code_url") @db.Text

  // 作者/机构
  authors         Json?        // [{name, affiliation, email}]
  organizations   Json?        // [string]

  // 时间
  publishedAt     DateTime?    @map("published_at")

  // AI生成字段
  aiSummary       String?      @map("ai_summary") @db.Text
  keyInsights     Json?        @map("key_insights")  // [string]
  difficultyLevel Int?         @map("difficulty_level")  // 1-10
  prerequisites   Json?        // [concept_id]

  // 分类
  primaryCategory String?      @map("primary_category")
  categories      Json?        @default("[]")
  tags            Json?        @default("[]")
  autoTags        Json?        @map("auto_tags") @default("[]")

  // 质量评分
  qualityScore    Decimal?     @map("quality_score") @db.Decimal(5, 2)
  trendingScore   Decimal?     @map("trending_score") @db.Decimal(10, 2)

  // 统计
  viewCount       Int          @default(0) @map("view_count")
  saveCount       Int          @default(0) @map("save_count")
  upvoteCount     Int          @default(0) @map("upvote_count")
  commentCount    Int          @default(0) @map("comment_count")

  // 元数据（type特有字段）
  metadata        Json?        @default("{}")

  // 向量（JSONB存储，应用层计算余弦相似度）
  embedding       Json?        @map("embedding")

  // 时间戳
  createdAt       DateTime     @default(now()) @map("created_at")
  updatedAt       DateTime     @updatedAt @map("updated_at")

  // 关系
  collectionItems CollectionItem[]
  activities      UserActivity[]

  @@index([type, publishedAt(sort: Desc)])
  @@index([qualityScore(sort: Desc)])
  @@index([trendingScore(sort: Desc)])
  @@index([createdAt(sort: Desc)])
  @@map("resources")
}

// ============ 收藏相关 ============

model Collection {
  id          String   @id @default(uuid())
  userId      String   @map("user_id")
  name        String   @db.VarChar(200)
  description String?  @db.Text
  isPublic    Boolean  @default(false) @map("is_public")
  sortOrder   Int      @default(0) @map("sort_order")

  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  user  User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  items CollectionItem[]

  @@index([userId])
  @@map("collections")
}

model CollectionItem {
  id           String    @id @default(uuid())
  collectionId String    @map("collection_id")
  resourceId   String    @map("resource_id")
  note         String?   @db.Text
  position     Int       @default(0)

  addedAt      DateTime  @default(now()) @map("added_at")

  collection Collection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  resource   Resource   @relation(fields: [resourceId], references: [id], onDelete: Cascade)

  @@unique([collectionId, resourceId])
  @@index([collectionId])
  @@index([resourceId])
  @@map("collection_items")
}

// ============ 用户行为 ============

enum ActivityType {
  VIEW
  CLICK
  SAVE
  UNSAVE
  UPVOTE
  COMMENT
  SHARE
}

model UserActivity {
  id              String       @id @default(uuid())
  userId          String       @map("user_id")
  resourceId      String       @map("resource_id")
  activityType    ActivityType @map("activity_type")

  // 行为详情
  durationSeconds Int?         @map("duration_seconds")
  scrollDepth     Decimal?     @map("scroll_depth") @db.Decimal(5, 2)
  metadata        Json?

  // 设备信息
  deviceType      String?      @map("device_type")
  userAgent       String?      @map("user_agent") @db.Text

  createdAt       DateTime     @default(now()) @map("created_at")

  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  resource Resource @relation(fields: [resourceId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt(sort: Desc)])
  @@index([resourceId])
  @@index([activityType])
  @@map("user_activities")
}

// ============ 学习路径 ============

enum LearningPathStatus {
  ACTIVE
  PAUSED
  COMPLETED
}

model LearningPath {
  id        String              @id @default(uuid())
  userId    String              @map("user_id")
  title     String              @db.VarChar(200)
  goal      String?             @db.Text
  status    LearningPathStatus  @default(ACTIVE)
  progress  Decimal             @default(0) @db.Decimal(5, 2)

  createdAt DateTime            @default(now()) @map("created_at")
  updatedAt DateTime            @updatedAt @map("updated_at")

  user  User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  steps LearningPathStep[]

  @@index([userId])
  @@map("learning_paths")
}

enum StepStatus {
  PENDING
  IN_PROGRESS
  COMPLETED
}

model LearningPathStep {
  id          String     @id @default(uuid())
  pathId      String     @map("path_id")
  stepOrder   Int        @map("step_order")
  conceptId   String     @map("concept_id")
  resources   Json?      // [resource_id]
  status      StepStatus @default(PENDING)

  completedAt DateTime?  @map("completed_at")

  path LearningPath @relation(fields: [pathId], references: [id], onDelete: Cascade)

  @@unique([pathId, stepOrder])
  @@index([pathId])
  @@map("learning_path_steps")
}
```

---

### 2.2 Redis缓存策略

```typescript
// 缓存键设计规范

// 用户Feed缓存
const feedKey = `feed:${userId}:${page}`;
// TTL: 5分钟

// 热榜缓存
const trendingKey = `trending:${type}`;
// TTL: 10分钟

// 资源详情缓存
const resourceKey = `resource:${resourceId}`;
// TTL: 1小时

// 搜索结果缓存
const searchKey = `search:${hash(query + filters)}`;
// TTL: 30分钟

// AI摘要缓存
const summaryKey = `ai:summary:${contentHash}`;
// TTL: 永久（内容不变）

// 使用示例
import { redisClient } from "./redis";

async function getResource(id: string): Promise<Resource> {
  const cacheKey = `resource:${id}`;

  // 先查缓存
  const cached = await redisClient.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  // 查数据库
  const resource = await prisma.resource.findUnique({
    where: { id },
  });

  // 写缓存
  if (resource) {
    await redisClient.setex(
      cacheKey,
      3600, // 1小时
      JSON.stringify(resource),
    );
  }

  return resource;
}
```

---

## 3. API设计

### 3.1 GraphQL Schema

```graphql
# ============ 类型定义 ============

type User {
  id: ID!
  email: String!
  username: String
  fullName: String
  avatarUrl: String
  subscriptionTier: SubscriptionTier!
  interests: [UserInterest!]!
  stats: UserStats!
  createdAt: DateTime!
}

enum SubscriptionTier {
  FREE
  PRO
  TEAM
  ENTERPRISE
}

type UserStats {
  totalSaves: Int!
  totalReads: Int!
  learningPathsCompleted: Int!
}

type Resource {
  id: ID!
  type: ResourceType!
  title: String!
  abstract: String
  sourceUrl: String!
  authors: [Author!]!
  publishedAt: DateTime

  # AI生成字段
  aiSummary: String
  keyInsights: [String!]
  difficultyLevel: Int

  # 统计
  viewCount: Int!
  saveCount: Int!
  upvoteCount: Int!

  # 用户交互状态（需要登录）
  isSaved: Boolean!
  isUpvoted: Boolean!

  # 相关内容
  relatedResources: [Resource!]!
}

enum ResourceType {
  PAPER
  PROJECT
  NEWS
  EVENT
  RSS
}

type Author {
  name: String!
  affiliation: String
  email: String
}

# ============ 查询 ============

type Query {
  # 当前用户
  me: User

  # Feed
  feed(page: Int = 1, limit: Int = 20, filters: FeedFilters): FeedResult!

  # 资源详情
  resource(id: ID!): Resource!

  # 搜索
  search(
    query: String!
    filters: SearchFilters
    page: Int = 1
    limit: Int = 20
  ): SearchResult!

  # 推荐
  recommendations(userId: ID, limit: Int = 20): [Resource!]!

  # 热榜
  trending(
    type: ResourceType
    timeRange: TimeRange = WEEK
    limit: Int = 20
  ): [Resource!]!

  # 学习路径
  learningPath(id: ID!): LearningPath!
  myLearningPaths: [LearningPath!]!

  # AI洞察
  aiInsights(type: InsightType!, params: Json): AIInsight!
}

input FeedFilters {
  types: [ResourceType!]
  tags: [String!]
  dateRange: DateRangeInput
  minQualityScore: Float
}

input DateRangeInput {
  start: DateTime
  end: DateTime
}

type FeedResult {
  items: [Resource!]!
  total: Int!
  hasMore: Boolean!
  cursor: String
}

# ============ 变更 ============

type Mutation {
  # 认证
  register(input: RegisterInput!): AuthPayload!
  login(input: LoginInput!): AuthPayload!
  refreshToken: AuthPayload!

  # 资源操作
  saveResource(resourceId: ID!, collectionId: ID, note: String): SaveResult!

  unsaveResource(resourceId: ID!): Boolean!
  upvoteResource(resourceId: ID!): Boolean!

  # 收藏夹
  createCollection(input: CreateCollectionInput!): Collection!
  updateCollection(id: ID!, input: UpdateCollectionInput!): Collection!
  deleteCollection(id: ID!): Boolean!

  # 用户设置
  updateProfile(input: UpdateProfileInput!): User!
  updateInterests(tags: [String!]!): User!

  # 学习路径
  createLearningPath(input: CreateLearningPathInput!): LearningPath!
  updateLearningPathProgress(
    pathId: ID!
    stepId: ID!
    status: StepStatus!
  ): LearningPath!
}

input RegisterInput {
  email: String!
  password: String!
  username: String
}

input LoginInput {
  email: String!
  password: String!
}

type AuthPayload {
  accessToken: String!
  refreshToken: String!
  user: User!
}

# ============ 订阅 ============

type Subscription {
  # 新内容通知
  newContent(tags: [String!]): Resource!

  # 学习路径更新
  learningPathUpdated(pathId: ID!): LearningPath!
}
```

---

### 3.2 REST API

```
# 认证
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout

# 用户
GET    /api/v1/users/me
PUT    /api/v1/users/me
GET    /api/v1/users/me/stats
GET    /api/v1/users/me/interests
PUT    /api/v1/users/me/interests

# 资源
GET    /api/v1/resources              # 列表（分页）
GET    /api/v1/resources/:id          # 详情
GET    /api/v1/resources/:id/related  # 相关内容
GET    /api/v1/resources/trending     # 热榜
GET    /api/v1/resources/latest       # 最新

# Feed
GET    /api/v1/feed                   # 个性化Feed
GET    /api/v1/feed/digest            # AI精选

# 搜索
GET    /api/v1/search?q=transformer   # 全文搜索
GET    /api/v1/search/suggestions     # 搜索建议

# 收藏
GET    /api/v1/collections            # 我的收藏夹
POST   /api/v1/collections            # 创建收藏夹
PUT    /api/v1/collections/:id        # 更新
DELETE /api/v1/collections/:id        # 删除

POST   /api/v1/collections/:id/items  # 添加item
DELETE /api/v1/collections/:id/items/:itemId  # 移除

# 学习路径
GET    /api/v1/learning-paths         # 我的学习路径
POST   /api/v1/learning-paths         # 创建
GET    /api/v1/learning-paths/:id     # 详情
PUT    /api/v1/learning-paths/:id     # 更新
DELETE /api/v1/learning-paths/:id     # 删除

# AI洞察
GET    /api/v1/ai/daily-insights      # AI日报
GET    /api/v1/ai/trend-report        # 趋势报告
POST   /api/v1/ai/compare             # 技术对比
POST   /api/v1/ai/research-gaps       # 研究空白
```

---

## 4. AI服务架构

### 4.1 AI服务设计

AI能力通过 `AiChatService.chat()` 统一调用，经 LiteLLM 路由至实际模型（OpenAI / Claude / Grok 等）。

```typescript
// 所有LLM调用必须通过AiChatService + TaskProfile
const response = await this.aiChatService.chat({
  messages: [{ role: "system", content: prompt }],
  modelType: AIModelType.CHAT,
  taskProfile: { creativity: "medium", outputLength: "medium" },
});
```

**TaskProfile 参考**:

| creativity    | temperature | 场景             |
| ------------- | ----------- | ---------------- |
| deterministic | 0.1         | 分类、提取、JSON |
| low           | 0.3         | 分析、总结       |
| medium        | 0.7         | 对话、研究       |
| high          | 0.9         | 创意写作         |

| outputLength | maxTokens | 场景       |
| ------------ | --------- | ---------- |
| minimal      | 500       | 分类标签   |
| short        | 1500      | 摘要       |
| medium       | 4000      | 标准分析   |
| long         | 8000      | 报告、章节 |

禁止硬编码模型名（如 `model: "gpt-4o"`）或温度值（如 `temperature: 0.7`）。

---

## 5. 部署架构

### 5.1 Docker Compose (本地开发)

```yaml
# docker-compose.yml

version: "3.8"

services:
  # PostgreSQL
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: genesis
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: genesis
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  # Redis
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

### 5.2 生产环境架构（Railway）

```
Internet
    |
CloudFlare CDN
    |
Railway Proxy (Fastly)
    |
┌──────────────────────────────────┐
│ Application Services (Railway)   │
│ ┌──────────┐  ┌────────────────┐ │
│ │ Next.js  │  │  NestJS API    │ │
│ │ Frontend │  │  (6-layer)     │ │
│ └──────────┘  └────────────────┘ │
└──────────────────────────────────┘
    |
┌──────────────────────────────────┐
│ Data Layer (Railway)             │
│ ┌──────────────────┐  ┌────────┐ │
│ │  PostgreSQL 16   │  │Redis 7 │ │
│ │  (唯一数据库)    │  │        │ │
│ └──────────────────┘  └────────┘ │
└──────────────────────────────────┘
```

---

## 6. 性能优化

### 6.1 查询优化

```typescript
// ✅ 好的做法：N+1问题解决

// ❌ 不好：N+1查询
async function getResourcesWithAuthors(ids: string[]) {
  const resources = await prisma.resource.findMany({
    where: { id: { in: ids } },
  });

  for (const resource of resources) {
    resource.authorDetails = await getAuthorDetails(resource.authors);
  }
  return resources;
}

// ✅ 好：使用include或批量查询
async function getResourcesWithAuthors(ids: string[]) {
  return await prisma.resource.findMany({
    where: { id: { in: ids } },
    include: {
      // 如果authors是关系
    },
  });
}
```

### 6.2 缓存策略

```typescript
// 多层缓存

// Layer 1: 应用内存缓存（热数据）
const memoryCache = new NodeCache({ stdTTL: 60 });

// Layer 2: Redis缓存
// Layer 3: 数据库

async function getResource(id: string): Promise<Resource> {
  // L1: 内存
  let resource = memoryCache.get(id);
  if (resource) return resource;

  // L2: Redis
  const cached = await redisClient.get(`resource:${id}`);
  if (cached) {
    resource = JSON.parse(cached);
    memoryCache.set(id, resource);
    return resource;
  }

  // L3: 数据库
  resource = await prisma.resource.findUnique({ where: { id } });

  if (resource) {
    await redisClient.setex(`resource:${id}`, 3600, JSON.stringify(resource));
    memoryCache.set(id, resource);
  }

  return resource;
}
```

---

**文档版本**: v2.0
**最后更新**: 2026-03-05
