# 06 - 数据库设计规范 | Database Design Standards

> **优先级**: 🔴 MUST
> **更新日期**: 2026-02-21
> **适用范围**: PostgreSQL 16 + Prisma (统一数据库架构)

---

## 目录

1. [数据库架构](#数据库架构)
2. [PostgreSQL规范](#postgresql规范)
3. [Prisma最佳实践](#prisma最佳实践)
4. [JSONB 原始数据存储](#jsonb-原始数据存储)
5. [知识图谱实现](#知识图谱实现)
6. [数据迁移](#数据迁移)
7. [性能优化](#性能优化)

---

## 数据库架构

### 统一 PostgreSQL 策略

GenesisPod 采用**统一的 PostgreSQL 架构**，已移除 MongoDB、Neo4j、Qdrant：

| 数据类型   | 存储方式            | 说明               |
| ---------- | ------------------- | ------------------ |
| 结构化数据 | PostgreSQL 表       | 用户、资源、笔记等 |
| 原始数据   | PostgreSQL JSONB    | API 响应、网页内容 |
| 知识图谱   | PostgreSQL 递归 CTE | 图关系查询         |
| 向量数据   | PostgreSQL pgvector | 嵌入向量存储       |
| 缓存数据   | Redis 7             | 会话、API 缓存     |

### 优势

- ✅ 运维成本降低 70-75%
- ✅ 单点数据管理，备份简化
- ✅ JSONB GIN 索引，查询性能优异
- ✅ 递归 CTE 实现图关系，无需 Neo4j
- ✅ 数据一致性保证

---

## PostgreSQL规范

### 1. 命名规范 🔴 MUST

```sql
-- ✅ 正确 - snake_case, 复数表名
CREATE TABLE users (
  id VARCHAR(30) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE learning_paths (  -- 复数形式
  id VARCHAR(30) PRIMARY KEY,
  user_id VARCHAR(30) NOT NULL REFERENCES users(id),
  title VARCHAR(500) NOT NULL
);

-- ❌ 错误
CREATE TABLE User (            -- 应该用小写
  ID varchar(30),              -- 应该用小写
  Email varchar(255),          -- 应该用小写
  createdAt timestamp          -- 应该用snake_case
);

CREATE TABLE LearningPath (   -- 应该用复数且snake_case
  ...
);
```

**规则**:

- 🔴 MUST: 表名使用snake_case复数形式
- 🔴 MUST: 列名使用snake_case
- 🔴 MUST: 主键命名为`id`
- 🔴 MUST: 外键命名为`{table}_id`（单数）
- 🔴 MUST: 布尔字段使用`is_`, `has_`, `can_`前缀
- 🔴 MUST: 时间戳字段使用`_at`后缀

### 2. 主键设计 🔴 MUST

```prisma
// ✅ 推荐 - 使用CUID（更好的性能和唯一性）
model Resource {
  id        String   @id @default(cuid())  // 推荐：cuid
  // ...
}

// ✅ 可接受 - 使用UUID
model User {
  id        String   @id @default(uuid())  // 可接受：uuid
  // ...
}

// ❌ 避免 - 自增整数（在分布式系统中有问题）
model Resource {
  id        Int      @id @default(autoincrement())
  // ...
}
```

**选择原则**:

- 🔴 MUST: 使用字符串类型的ID（CUID或UUID）
- 🟡 SHOULD: 优先选择CUID（性能更好，更短）
- 🟢 MAY: 内部关联表可以使用复合主键

### 3. 外键与关联 🔴 MUST

```prisma
// ✅ 正确 - 明确的关联关系
model User {
  id             String          @id @default(cuid())
  email          String          @unique

  // 一对多关系
  resources      Resource[]
  collections    Collection[]
  activities     UserActivity[]
  learningPaths  LearningPath[]

  @@map("users")
}

model Resource {
  id          String   @id @default(cuid())
  title       String   @db.VarChar(500)

  // 多对一关系
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  // 多对多关系
  collections ResourceCollection[]

  @@index([userId])
  @@map("resources")
}

model Collection {
  id          String   @id @default(cuid())
  name        String

  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  resources   ResourceCollection[]

  @@index([userId])
  @@map("collections")
}

// 多对多中间表
model ResourceCollection {
  id           String     @id @default(cuid())

  resourceId   String
  resource     Resource   @relation(fields: [resourceId], references: [id], onDelete: Cascade)

  collectionId String
  collection   Collection @relation(fields: [collectionId], references: [id], onDelete: Cascade)

  addedAt      DateTime   @default(now())

  @@unique([resourceId, collectionId])  // 防止重复
  @@index([resourceId])
  @@index([collectionId])
  @@map("resource_collections")
}
```

**级联删除规则** 🔴 MUST:

- `Cascade`: 主记录删除时，相关记录也删除（如用户删除时删除其资源）
- `SetNull`: 主记录删除时，外键设为NULL（较少使用）
- `Restrict`: 有相关记录时禁止删除（默认，最安全）

### 4. 索引设计 🔴 MUST

```prisma
model Resource {
  id          String   @id @default(cuid())
  title       String   @db.VarChar(500)
  type        ResourceType
  sourceUrl   String   @unique @db.VarChar(2048)  // 唯一索引
  userId      String
  createdAt   DateTime @default(now())

  // 单列索引
  @@index([userId])        // 外键必须有索引
  @@index([type])          // 频繁过滤的字段
  @@index([createdAt])     // 排序字段

  // 复合索引
  @@index([userId, createdAt])  // 同时过滤和排序
  @@index([type, createdAt])    // 按类型分类后排序
}
```

**索引原则**:

- 🔴 MUST: 所有外键必须有索引
- 🔴 MUST: 唯一约束字段自动有唯一索引
- 🟡 SHOULD: WHERE子句常用字段建立索引
- 🟡 SHOULD: ORDER BY常用字段建立索引
- 🟡 SHOULD: 复合查询考虑复合索引
- ⚠️ 注意: 索引越多，写入越慢，需要权衡

### 5. 数据类型 🔴 MUST

```prisma
model Resource {
  // 字符串
  id          String   @id @default(cuid())
  title       String   @db.VarChar(500)     // 限制长度
  description String?  @db.Text             // 长文本
  sourceUrl   String   @db.VarChar(2048)

  // 数字
  viewCount   Int      @default(0)
  rating      Float?   @db.DoublePrecision

  // 枚举
  type        ResourceType  // 使用enum而非string

  // 布尔
  isPublished Boolean  @default(false)

  // 日期时间
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  publishedAt DateTime?

  // JSON（需要验证）
  metadata    Json?

  @@map("resources")
}

enum ResourceType {
  ARTICLE
  VIDEO
  GITHUB_REPO
  ARXIV_PAPER
  DOCUMENTATION
}
```

**类型选择**:

- 🔴 MUST: 字符串指定最大长度（防止滥用）
  - 短文本: `@db.VarChar(n)` (n < 2000)
  - 长文本: `@db.Text`
- 🔴 MUST: 有限选项使用`enum`而非`string`
- 🔴 MUST: 时间戳使用`DateTime`类型
- 🟡 SHOULD: JSON字段配合Zod验证（见下文）

### 6. JSON字段验证 🔴 MUST

```typescript
// schemas/resource-metadata.schema.ts
import { z } from "zod";

export const ResourceMetadataSchema = z
  .object({
    // GitHub特有字段
    stars: z.number().int().nonnegative().optional(),
    forks: z.number().int().nonnegative().optional(),
    language: z.string().optional(),

    // arXiv特有字段
    citations: z.number().int().nonnegative().optional(),
    pdfUrl: z.string().url().optional(),

    // 通用字段
    topics: z.array(z.string()).max(10).optional(),
    lastUpdated: z.string().datetime().optional(),
  })
  .strict(); // 禁止额外字段

export type ResourceMetadata = z.infer<typeof ResourceMetadataSchema>;

// 使用
import { ResourceMetadataSchema } from "@/schemas/resource-metadata.schema";

async function createResource(data: CreateResourceDto) {
  // 验证JSON字段
  const metadata = ResourceMetadataSchema.parse(data.metadata);

  return prisma.resource.create({
    data: {
      ...data,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });
}
```

### 7. 软删除 🟡 SHOULD

```prisma
model Resource {
  id         String    @id @default(cuid())
  title      String

  // 软删除字段
  deletedAt  DateTime?

  @@index([deletedAt])  // 重要：查询时过滤
  @@map("resources")
}

// 使用中间件自动过滤已删除记录
// prisma/client-extensions.ts
export const prisma = new PrismaClient().$extends({
  query: {
    resource: {
      async findMany({ args, query }) {
        args.where = { ...args.where, deletedAt: null };
        return query(args);
      },
      async findFirst({ args, query }) {
        args.where = { ...args.where, deletedAt: null };
        return query(args);
      },
    },
  },
});
```

### 8. 审计字段 🔴 MUST

```prisma
model Resource {
  id         String   @id @default(cuid())
  title      String

  // 审计字段（所有表都应该有）
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  createdBy  String?  // 可选：创建者ID
  updatedBy  String?  // 可选：最后更新者ID

  @@map("resources")
}
```

---

## JSONB 原始数据存储

### 1. 模型设计 🔴 MUST

```prisma
// ✅ 正确 - 使用 JSONB 存储原始数据
model RawData {
  id          String   @id @default(cuid())
  resourceId  String   @map("resource_id")

  // 数据来源
  source      String   // arxiv, github, youtube 等
  sourceId    String   @map("source_id")  // 原始 ID

  // JSONB 存储原始数据
  data        Json     // 完整的 API 响应

  // 元数据
  fetchedAt   DateTime @default(now()) @map("fetched_at")
  apiVersion  String?  @map("api_version")

  // 关系
  resource    Resource @relation(fields: [resourceId], references: [id], onDelete: Cascade)

  // 索引
  @@index([resourceId])
  @@index([source, sourceId])  // 去重索引
  @@index([fetchedAt])
  @@map("raw_data")
}
```

### 2. JSONB 查询 🔴 MUST

```typescript
// ✅ 正确 - 使用 Prisma JSONB 查询
const papers = await prisma.rawData.findMany({
  where: {
    source: "arxiv",
    data: {
      path: ["categories"],
      array_contains: "cs.AI", // JSONB 数组包含查询
    },
  },
});

// ✅ JSONB 路径查询
const result = await prisma.$queryRaw`
  SELECT * FROM raw_data 
  WHERE data->'authors' @> '[{"name": "John"}]'
  AND source = 'github'
`;
```

### 3. 性能优化 🟡 SHOULD

```prisma
// GIN 索引加速 JSONB 查询
model RawData {
  // ...
  // 在 migration 中添加 GIN 索引
}

// migration.sql
CREATE INDEX idx_raw_data_data_gin ON raw_data USING gin(data jsonb_path_ops);
```

---

## Prisma最佳实践

### 1. Schema组织 🔴 MUST

```prisma
// schema.prisma

// 1. Generator配置
generator client {
  provider = "prisma-client-js"
}

// 2. 数据源
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// 3. Enums（按字母顺序）
enum ActivityType {
  VIEW
  BOOKMARK
  SHARE
  COMMENT
}

enum ResourceType {
  ARTICLE
  ARXIV_PAPER
  DOCUMENTATION
  GITHUB_REPO
  VIDEO
}

// 4. Models（按依赖关系排序：基础表 → 关联表）

// 基础表
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  // ... 关联关系

  @@map("users")
}

model Resource {
  id        String   @id @default(cuid())
  // ... 字段和关联

  @@map("resources")
}

// 关联表
model UserActivity {
  id           String       @id @default(cuid())
  userId       String
  user         User         @relation(...)
  resourceId   String
  resource     Resource     @relation(...)

  @@map("user_activities")
}
```

### 2. 查询最佳实践 🔴 MUST

```typescript
// ✅ 正确 - 使用select减少数据传输
const users = await prisma.user.findMany({
  select: {
    id: true,
    email: true,
    name: true,
    // 只选择需要的字段
  },
});

// ✅ 正确 - 使用include加载关联
const user = await prisma.user.findUnique({
  where: { id },
  include: {
    resources: {
      take: 10,
      orderBy: { createdAt: 'desc' },
    },
  },
});

// ✅ 正确 - 分页查询
const resources = await prisma.resource.findMany({
  where: { type: 'ARTICLE' },
  skip: (page - 1) * limit,
  take: limit,
  orderBy: { createdAt: 'desc' },
});

// 同时获取总数
const [resources, total] = await Promise.all([
  prisma.resource.findMany({ ... }),
  prisma.resource.count({ where: { type: 'ARTICLE' } }),
]);

// ❌ 错误 - N+1查询问题
const users = await prisma.user.findMany();
for (const user of users) {
  // ❌ 每个用户都发起一次查询
  const resources = await prisma.resource.findMany({
    where: { userId: user.id },
  });
}

// ✅ 正确 - 使用include一次性加载
const users = await prisma.user.findMany({
  include: { resources: true },
});
```

### 3. 事务处理 🔴 MUST

```typescript
// ✅ 正确 - 使用交互式事务
const result = await prisma.$transaction(async (tx) => {
  // 1. 创建资源
  const resource = await tx.resource.create({
    data: resourceData,
  });

  // 2. 创建活动记录
  await tx.userActivity.create({
    data: {
      userId,
      resourceId: resource.id,
      type: "CREATE",
    },
  });

  // 3. 更新用户统计
  await tx.user.update({
    where: { id: userId },
    data: {
      resourceCount: { increment: 1 },
    },
  });

  return resource;
});

// ✅ 正确 - 简单事务（批量操作）
await prisma.$transaction([
  prisma.resource.create({ data: resource1 }),
  prisma.resource.create({ data: resource2 }),
  prisma.resource.create({ data: resource3 }),
]);

// ❌ 错误 - 忘记使用事务
const resource = await prisma.resource.create({ data });
// 如果下面的操作失败，resource已经创建，数据不一致！
await prisma.userActivity.create({ data: activityData });
```

### 4. 连接池配置 🔴 MUST

```env
# .env
# connection_limit: 连接池大小
# pool_timeout: 获取连接超时时间（秒）
DATABASE_URL="postgresql://user:password@localhost:5432/dbname?connection_limit=10&pool_timeout=2"
```

**连接池大小建议**:

- 开发环境: 5-10
- 生产环境: `(核心数 * 2) + 磁盘数`
- 示例: 4核心 + 1磁盘 = 9-10连接

---

## 数据迁移

### 1. 迁移文件管理 🔴 MUST

```bash
# 创建迁移
npx prisma migrate dev --name add_thumbnail_url

# 迁移文件结构
prisma/migrations/
├── 20240101120000_init/
│   └── migration.sql
├── 20240115150000_add_thumbnail_url/
│   └── migration.sql
└── migration_lock.toml
```

**规则**:

- 🔴 MUST: 迁移名称使用snake_case且具有描述性
- 🔴 MUST: 所有迁移文件提交到Git
- 🔴 MUST: 生产环境使用`prisma migrate deploy`
- ❌ 绝不: 手动编辑已应用的迁移文件

### 2. 数据迁移脚本 🔴 MUST

```typescript
// src/scripts/migrate-data.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function migrateData() {
  console.log("Starting data migration...");

  try {
    // 使用事务确保原子性
    await prisma.$transaction(async (tx) => {
      // 1. 获取需要迁移的数据
      const resources = await tx.resource.findMany({
        where: { thumbnailUrl: null },
      });

      console.log(`Found ${resources.length} resources to migrate`);

      // 2. 批量更新
      for (const resource of resources) {
        await tx.resource.update({
          where: { id: resource.id },
          data: {
            thumbnailUrl: generateThumbnail(resource),
          },
        });
      }

      console.log("Migration completed successfully");
    });
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

migrateData();
```

---

## 性能优化

### 1. 查询优化 🔴 MUST

```typescript
// ✅ 正确 - 使用索引
const resources = await prisma.resource.findMany({
  where: {
    userId, // 有索引
    type: "ARTICLE", // 有索引
  },
  orderBy: {
    createdAt: "desc", // 有索引
  },
});

// ❌ 错误 - 全表扫描
const resources = await prisma.resource.findMany({
  where: {
    title: { contains: keyword }, // 无索引，全表扫描！
  },
});

// ✅ 正确 - 使用全文搜索
const resources = await prisma.$queryRaw`
  SELECT * FROM resources
  WHERE to_tsvector('english', title || ' ' || description)
  @@ plainto_tsquery('english', ${keyword})
`;
```

### 2. 批量操作 🔴 MUST

```typescript
// ✅ 正确 - 批量创建
await prisma.resource.createMany({
  data: resources,
  skipDuplicates: true, // 跳过重复项
});

// ❌ 错误 - 循环单个创建
for (const resource of resources) {
  await prisma.resource.create({ data: resource }); // 很慢！
}

// ✅ 正确 - 批量更新
await prisma.resource.updateMany({
  where: { type: "ARTICLE" },
  data: { isPublished: true },
});
```

### 3. 缓存策略 🟡 SHOULD

```typescript
import { Redis } from "ioredis";

const redis = new Redis(process.env.REDIS_URL);

async function getResourceWithCache(id: string) {
  // 1. 检查缓存
  const cached = await redis.get(`resource:${id}`);
  if (cached) {
    return JSON.parse(cached);
  }

  // 2. 查询数据库
  const resource = await prisma.resource.findUnique({
    where: { id },
  });

  // 3. 写入缓存（5分钟）
  await redis.setex(`resource:${id}`, 300, JSON.stringify(resource));

  return resource;
}
```

---

## 数据完整性检查脚本

```typescript
// src/scripts/verify-data-integrity.ts
import { PrismaClient } from "@prisma/client";
import { MongoClient } from "mongodb";

async function verifyDataIntegrity() {
  const prisma = new PrismaClient();
  const mongo = new MongoClient(process.env.MONGODB_URI);

  try {
    await mongo.connect();
    const db = mongo.db();

    // 检查1: PostgreSQL中的每个resource都应该有对应的MongoDB记录
    const resources = await prisma.resource.findMany({
      select: { id: true, rawDataId: true },
    });

    let missingRawData = 0;
    for (const resource of resources) {
      if (!resource.rawDataId) {
        console.warn(`Resource ${resource.id} missing rawDataId`);
        missingRawData++;
      }
    }

    // 检查2: MongoDB中的每个rawData都应该有resourceId
    const collections = ["arxiv_raw_data", "github_raw_data"];
    for (const collectionName of collections) {
      const count = await db.collection(collectionName).countDocuments({
        resourceId: { $exists: false },
      });

      if (count > 0) {
        console.warn(
          `${collectionName}: ${count} documents missing resourceId`,
        );
      }
    }

    // 检查3: 检查重复的sourceUrl
    const duplicates = await prisma.resource.groupBy({
      by: ["sourceUrl"],
      having: {
        sourceUrl: {
          _count: { gt: 1 },
        },
      },
    });

    if (duplicates.length > 0) {
      console.warn(`Found ${duplicates.length} duplicate sourceUrls`);
    }

    console.log("Data integrity check completed");
  } finally {
    await prisma.$disconnect();
    await mongo.close();
  }
}

verifyDataIntegrity();
```

---

## 参考资料

- [Prisma Best Practices](https://www.prisma.io/docs/guides/performance-and-optimization)
- [PostgreSQL Performance Tips](https://wiki.postgresql.org/wiki/Performance_Optimization)
- [MongoDB Schema Design Best Practices](https://www.mongodb.com/developer/products/mongodb/schema-design-anti-pattern-summary/)
