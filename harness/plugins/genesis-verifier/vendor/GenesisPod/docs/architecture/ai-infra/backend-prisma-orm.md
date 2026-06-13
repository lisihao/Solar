# Prisma ORM 核心原理

## 概述

Prisma 是下一代 Node.js 和 TypeScript ORM，提供类型安全的数据库访问、自动迁移和直观的数据建模。

## 核心组件

```
┌─────────────────────────────────────────────────────────┐
│                    Prisma 架构                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────┐                                   │
│  │  Prisma Schema  │  数据模型定义 (schema.prisma)     │
│  └─────────────────┘                                   │
│           │                                             │
│           ▼                                             │
│  ┌─────────────────┐                                   │
│  │ Prisma Migrate  │  数据库迁移管理                   │
│  └─────────────────┘                                   │
│           │                                             │
│           ▼                                             │
│  ┌─────────────────┐                                   │
│  │ Prisma Client   │  类型安全的数据库客户端           │
│  └─────────────────┘                                   │
│           │                                             │
│           ▼                                             │
│  ┌─────────────────┐                                   │
│  │  PostgreSQL     │  数据库                           │
│  └─────────────────┘                                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Schema 定义

### 1. 基础模型

```prisma
// schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  name      String?
  password  String
  role      Role     @default(USER)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // 关系
  resources Resource[]
  comments  Comment[]

  @@index([email])
  @@map("users")  // 表名映射
}

enum Role {
  USER
  ADMIN
}
```

### 2. 关系定义

```prisma
// 一对多关系
model Resource {
  id          String   @id @default(uuid())
  title       String
  description String?
  url         String
  type        String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // 外键关系
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  // 一对多
  comments    Comment[]

  // 多对多（通过中间表）
  tags        Tag[]    @relation("ResourceTags")

  @@index([userId])
  @@index([type])
  @@map("resources")
}

// 多对多关系
model Tag {
  id        String     @id @default(uuid())
  name      String     @unique
  resources Resource[] @relation("ResourceTags")

  @@map("tags")
}

// 自引用关系（层级结构）
model Category {
  id        String     @id @default(uuid())
  name      String
  parentId  String?
  parent    Category?  @relation("CategoryTree", fields: [parentId], references: [id])
  children  Category[] @relation("CategoryTree")

  @@map("categories")
}
```

### 3. JSONB 字段

```prisma
model Resource {
  id       String @id @default(uuid())
  title    String

  // JSONB 字段存储非结构化数据
  metadata Json?  // { tags: [], source: {}, analytics: {} }
  content  Json?  // 富文本内容

  @@map("resources")
}
```

## Prisma Client 使用

### 1. 基础 CRUD

```typescript
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Create
const user = await prisma.user.create({
  data: {
    email: "user@example.com",
    name: "John Doe",
    password: hashedPassword,
  },
});

// Read
const user = await prisma.user.findUnique({
  where: { id: userId },
});

const users = await prisma.user.findMany({
  where: { role: "ADMIN" },
  orderBy: { createdAt: "desc" },
  take: 10,
  skip: 0,
});

// Update
const updated = await prisma.user.update({
  where: { id: userId },
  data: { name: "New Name" },
});

// Delete
await prisma.user.delete({
  where: { id: userId },
});
```

### 2. 关系查询

```typescript
// 包含关系数据
const userWithResources = await prisma.user.findUnique({
  where: { id: userId },
  include: {
    resources: true,
    comments: {
      include: {
        resource: true,
      },
    },
  },
});

// 选择特定字段
const userPartial = await prisma.user.findUnique({
  where: { id: userId },
  select: {
    id: true,
    name: true,
    resources: {
      select: {
        id: true,
        title: true,
      },
    },
  },
});

// 嵌套创建
const resourceWithComments = await prisma.resource.create({
  data: {
    title: "New Resource",
    url: "https://example.com",
    type: "article",
    user: {
      connect: { id: userId }, // 连接现有用户
    },
    comments: {
      create: [{ content: "Great resource!", userId: commenterId }],
    },
    tags: {
      connectOrCreate: [
        {
          where: { name: "javascript" },
          create: { name: "javascript" },
        },
      ],
    },
  },
  include: {
    comments: true,
    tags: true,
  },
});
```

### 3. 复杂查询

```typescript
// 条件查询
const resources = await prisma.resource.findMany({
  where: {
    AND: [{ type: "article" }, { createdAt: { gte: new Date("2024-01-01") } }],
    OR: [
      { title: { contains: "typescript", mode: "insensitive" } },
      { description: { contains: "typescript", mode: "insensitive" } },
    ],
    NOT: {
      userId: excludedUserId,
    },
  },
});

// JSONB 查询
const resourcesWithTag = await prisma.resource.findMany({
  where: {
    metadata: {
      path: ["tags"],
      array_contains: "important",
    },
  },
});

// 聚合查询
const stats = await prisma.resource.aggregate({
  _count: { id: true },
  _avg: { viewCount: true },
  where: { type: "article" },
});

// 分组查询
const byType = await prisma.resource.groupBy({
  by: ["type"],
  _count: { id: true },
  orderBy: { _count: { id: "desc" } },
});
```

### 4. 原始 SQL

```typescript
// 原始查询
const users = await prisma.$queryRaw`
  SELECT * FROM users WHERE email LIKE ${`%${searchTerm}%`}
`;

// 原始执行
await prisma.$executeRaw`
  UPDATE resources SET view_count = view_count + 1 WHERE id = ${resourceId}
`;

// 递归 CTE（知识图谱）
const relatedResources = await prisma.$queryRaw`
  WITH RECURSIVE related AS (
    -- 基础查询
    SELECT r.id, r.title, 1 as depth
    FROM resources r
    WHERE r.id = ${resourceId}

    UNION ALL

    -- 递归查询
    SELECT r.id, r.title, rel.depth + 1
    FROM resources r
    JOIN resource_relations rr ON r.id = rr.target_id
    JOIN related rel ON rr.source_id = rel.id
    WHERE rel.depth < 3
  )
  SELECT DISTINCT * FROM related;
`;
```

### 5. 事务

```typescript
// 交互式事务
const result = await prisma.$transaction(async (tx) => {
  // 创建资源
  const resource = await tx.resource.create({
    data: { title: "New Resource", url: "...", type: "article", userId },
  });

  // 更新用户统计
  await tx.user.update({
    where: { id: userId },
    data: { resourceCount: { increment: 1 } },
  });

  // 创建活动日志
  await tx.activityLog.create({
    data: {
      type: "RESOURCE_CREATED",
      userId,
      resourceId: resource.id,
    },
  });

  return resource;
});

// 批量操作事务
const [deletedComments, deletedResource] = await prisma.$transaction([
  prisma.comment.deleteMany({ where: { resourceId } }),
  prisma.resource.delete({ where: { id: resourceId } }),
]);
```

## NestJS 集成

### 1. Prisma 服务

```typescript
// prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  // 清理方法（用于测试）
  async cleanDatabase() {
    if (process.env.NODE_ENV !== "production") {
      await this.$transaction([
        this.comment.deleteMany(),
        this.resource.deleteMany(),
        this.user.deleteMany(),
      ]);
    }
  }
}
```

### 2. Prisma 模块

```typescript
// prisma.module.ts
import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Global()
export class PrismaModule {}

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### 3. 在服务中使用

```typescript
// resources.service.ts
@Injectable()
export class ResourcesService {
  constructor(private prisma: PrismaService) {}

  async findAll(params: FindAllParams) {
    const { page = 1, limit = 10, type, search } = params;

    const where: Prisma.ResourceWhereInput = {};

    if (type) {
      where.type = type;
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.resource.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, name: true } },
          _count: { select: { comments: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.resource.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }
}
```

## 数据库迁移

### 1. 创建迁移

```bash
# 开发环境：创建并应用迁移
npx prisma migrate dev --name add_resources_table

# 生产环境：只应用迁移
npx prisma migrate deploy

# 重置数据库（开发环境）
npx prisma migrate reset
```

### 2. 迁移文件示例

```sql
-- migrations/20240101000000_add_resources_table/migration.sql

CREATE TABLE "resources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "metadata" JSONB,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "resources_user_id_idx" ON "resources"("user_id");
CREATE INDEX "resources_type_idx" ON "resources"("type");
CREATE INDEX "resources_metadata_idx" ON "resources" USING GIN ("metadata");

ALTER TABLE "resources"
ADD CONSTRAINT "resources_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
```

## 性能优化

### 1. 索引策略

```prisma
model Resource {
  id          String   @id
  title       String
  type        String
  userId      String
  createdAt   DateTime @default(now())
  metadata    Json?

  // 单列索引
  @@index([type])
  @@index([userId])
  @@index([createdAt])

  // 复合索引
  @@index([userId, type])
  @@index([type, createdAt])
}
```

### 2. 查询优化

```typescript
// ❌ N+1 问题
const resources = await prisma.resource.findMany();
for (const resource of resources) {
  const comments = await prisma.comment.findMany({
    where: { resourceId: resource.id },
  });
}

// ✅ 使用 include
const resources = await prisma.resource.findMany({
  include: {
    comments: true,
  },
});

// ✅ 使用 select 减少数据传输
const resources = await prisma.resource.findMany({
  select: {
    id: true,
    title: true,
    _count: { select: { comments: true } },
  },
});
```

### 3. 连接池配置

```
# .env
DATABASE_URL="postgresql://user:pass@host:5432/db?connection_limit=10&pool_timeout=20"
```

## Prisma Studio

```bash
# 启动可视化数据库管理界面
npx prisma studio
```

## 参考资源

- [Prisma 官方文档](https://www.prisma.io/docs)
- [Prisma Client API](https://www.prisma.io/docs/reference/api-reference/prisma-client-reference)
- [Prisma 迁移指南](https://www.prisma.io/docs/concepts/components/prisma-migrate)
