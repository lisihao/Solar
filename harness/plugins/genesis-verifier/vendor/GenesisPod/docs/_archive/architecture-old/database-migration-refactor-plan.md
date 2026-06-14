# 数据库迁移系统重构方案

> **版本**: 3.1
> **日期**: 2025-12-27
> **状态**: 已实施完成
> **优先级**: P0
> **方案**: JSONB 向量存储（兼容现有 Railway PostgreSQL）

---

## 1. 问题概述

### 1.1 当前状态

| 指标                      | 当前值                       | 健康值   |
| ------------------------- | ---------------------------- | -------- |
| 迁移文件数量              | **60+ 个**                   | < 20 个  |
| deploy-migrations.ts 行数 | **1700+ 行**                 | < 100 行 |
| 紧急修复步骤              | **14 个** (Step 0 - Step 14) | 0 个     |
| 手动维护的迁移列表        | **32 个**                    | 0 个     |
| "force"/"emergency" 迁移  | **12+ 个**                   | 0 个     |

### 1.2 核心问题

1. **pgvector 扩展不可用**
   - Railway 默认 PostgreSQL 17 没有预装 pgvector
   - Railway 自定义 Docker 镜像（pgvector/pgvector）无法持久化数据
   - 导致 `20251226_add_rag_knowledge_base` 迁移失败

2. **UUID vs TEXT 类型不匹配**
   - Prisma schema 定义 `String @id @default(uuid())` → 期望 TEXT 类型
   - 某些表实际使用 UUID 类型
   - 导致: `operator does not exist: uuid = text`

3. **迁移策略混乱**
   - Prisma migrate + 自定义 SQL + 紧急修复混合使用
   - deploy-migrations.ts 承担过多职责
   - 每次出问题就添加 "emergency fix"，恶性循环

---

## 2. 解决方案：JSONB 向量存储

### 2.1 方案选型

| 方案                          | pgvector 支持 | 数据丢失风险 | 实施复杂度 | 推荐度        |
| ----------------------------- | ------------- | ------------ | ---------- | ------------- |
| Railway pgvector 模板         | ❌ 无法持久化 | 高           | 高         | ❌ 不可用     |
| **JSONB 兼容方案**            | ✅ 应用层实现 | 零           | 低         | ⭐⭐⭐⭐⭐    |
| 外部 pgvector (Supabase/Neon) | ✅ 原生支持   | 低           | 中         | ⭐⭐⭐ (备选) |

**选择 JSONB 方案的理由：**

- 继续使用现有 Railway PostgreSQL，无需更换
- 数据已经稳定，零迁移风险
- 在数据量较小时性能足够
- 未来可平滑升级到 pgvector

### 2.2 Railway pgvector 失败原因

经过实际测试，Railway 自定义 Docker 镜像方案失败：

```
问题：使用 pgvector/pgvector:pg17 镜像
- 服务启动正常
- 数据恢复成功（99 表，10675 行）
- 重启后数据完全丢失
- 原因：卷挂载配置问题，数据无法持久化
```

### 2.3 性能评估

| 数据规模      | JSONB + 应用层 | 预期响应时间 | 是否可接受    |
| ------------- | -------------- | ------------ | ------------- |
| < 1K 向量     | ~50ms          | 快           | ✅ 完全可接受 |
| 1K-10K 向量   | ~200ms         | 中           | ✅ 可接受     |
| 10K-100K 向量 | ~1-2s          | 慢           | ⚠️ 需优化     |
| > 100K 向量   | 5s+            | 很慢         | ❌ 需升级方案 |

**当前数据规模**：~10K 记录，JSONB 方案完全足够。

---

## 3. JSONB 向量存储实现

### 3.1 数据库 Schema

```prisma
// 向量嵌入表 - 使用 JSONB 存储
model Embedding {
  id           String   @id @default(uuid())
  resourceId   String   @map("resource_id")
  resource     Resource @relation(fields: [resourceId], references: [id])

  // JSONB 存储向量数据
  embedding    Json     @db.JsonB  // float[] 序列化为 JSON 数组
  model        String   @default("text-embedding-3-small")
  dimensions   Int      @default(1536)

  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@index([resourceId])
  @@map("embeddings")
}
```

### 3.2 向量操作服务

```typescript
// backend/src/modules/ai/vector/vector.service.ts

import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";

@Injectable()
export class VectorService {
  constructor(private prisma: PrismaService) {}

  /**
   * 计算余弦相似度
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * 向量相似度搜索
   */
  async similaritySearch(
    queryVector: number[],
    options: {
      limit?: number;
      threshold?: number;
      filter?: { resourceType?: string };
    } = {},
  ): Promise<Array<{ resourceId: string; similarity: number }>> {
    const { limit = 10, threshold = 0.7, filter } = options;

    // 获取所有嵌入（小数据量时可行）
    const embeddings = await this.prisma.embedding.findMany({
      where: filter?.resourceType
        ? {
            resource: { type: filter.resourceType },
          }
        : undefined,
      select: {
        resourceId: true,
        embedding: true,
      },
    });

    // 计算相似度并排序
    const results = embeddings
      .map((e) => ({
        resourceId: e.resourceId,
        similarity: this.cosineSimilarity(queryVector, e.embedding as number[]),
      }))
      .filter((r) => r.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return results;
  }

  /**
   * 存储向量嵌入
   */
  async storeEmbedding(
    resourceId: string,
    embedding: number[],
    model: string = "text-embedding-3-small",
  ): Promise<void> {
    await this.prisma.embedding.upsert({
      where: { resourceId },
      create: {
        resourceId,
        embedding,
        model,
        dimensions: embedding.length,
      },
      update: {
        embedding,
        model,
        dimensions: embedding.length,
      },
    });
  }
}
```

### 3.3 性能优化策略

对于大数据量场景，可采用以下优化：

1. **批量处理**

   ```typescript
   // 分批加载嵌入，避免内存溢出
   async similaritySearchBatched(queryVector: number[], batchSize = 1000) {
     let offset = 0;
     const results = [];

     while (true) {
       const batch = await this.prisma.embedding.findMany({
         skip: offset,
         take: batchSize,
       });
       if (batch.length === 0) break;

       // 处理批次...
       offset += batchSize;
     }
   }
   ```

2. **缓存热点数据**

   ```typescript
   // Redis 缓存常用查询结果
   const cacheKey = `search:${hashVector(queryVector)}`;
   const cached = await redis.get(cacheKey);
   if (cached) return JSON.parse(cached);
   ```

3. **预计算索引**
   ```typescript
   // 定期预计算常用查询的结果
   @Cron('0 0 * * *')
   async rebuildSearchIndex() {
     // 预计算并缓存
   }
   ```

---

## 4. 迁移清理

### 4.1 删除无用的迁移文件

以下迁移文件可以删除（已合并到基准迁移）：

```
backend/prisma/migrations/
├── 20251222_fix_missing_columns/       # 删除
├── 20251222_force_fix_columns/         # 删除
├── 20251223_force_add_deep_research_sessions/  # 删除
├── 20251226_add_rag_knowledge_base/    # 删除 (pgvector 依赖)
├── 20251226_add_kb_members/            # 删除
├── 20251226_extend_knowledge_base_system/      # 删除
├── 20251226_fix_google_drive_schema/   # 删除
├── 20251226_force_add_google_drive/    # 删除
├── 20251226_force_fix_knowledge_bases/ # 删除
├── 20251227_add_kb_source_types/       # 删除
├── 20251227_emergency_fix_columns/     # 删除
├── 20251227_fix_aimodel_enum/          # 删除
├── 20251227_fix_uuid_text_mismatch/    # 删除
└── 20251227_force_convert_all_uuid_to_text/    # 删除
```

### 4.2 简化 deploy-migrations.ts

```typescript
/**
 * 简化的数据库迁移部署脚本
 */
import { execSync } from "child_process";

async function deploy() {
  console.log("Starting database migration...\n");

  try {
    // Step 1: 运行 Prisma 迁移
    console.log("Running Prisma migrate deploy...");
    execSync("npx prisma migrate deploy", {
      stdio: "inherit",
      env: process.env,
    });

    // Step 2: 生成 Prisma Client
    console.log("Generating Prisma Client...");
    execSync("npx prisma generate", {
      stdio: "inherit",
      env: process.env,
    });

    console.log("\n✅ Database migration completed!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

deploy();
```

---

## 5. 未来升级路径

当数据量增长到需要原生向量搜索时：

### 5.1 选项 A: 外部 pgvector 服务

推荐服务：

- **Supabase**: 免费层支持 pgvector
- **Neon**: 免费层支持 pgvector
- **AWS RDS**: 付费，企业级

### 5.2 选项 B: 专用向量数据库

- **Pinecone**: 托管向量数据库
- **Weaviate**: 开源，可自托管
- **Qdrant**: 开源，高性能

### 5.3 迁移步骤

```typescript
// 1. 导出现有 JSONB 向量
const embeddings = await prisma.embedding.findMany();

// 2. 批量导入到新向量数据库
for (const e of embeddings) {
  await vectorDb.upsert({
    id: e.resourceId,
    vector: e.embedding,
    metadata: { model: e.model },
  });
}

// 3. 更新服务层使用新数据库
```

---

## 6. 验收标准

- [x] 现有 Railway PostgreSQL 继续使用
- [x] 删除无用的 pgvector-db 和 Postgres-Vector 服务
- [x] 清理无用的迁移文件（15个 force/emergency 迁移已删除）
- [x] 简化 deploy-migrations.ts（1700+ 行 → 96 行）
- [x] 向量存储使用 JSONB 实现（VectorService）
- [x] 创建迁移工作流文档（migration-workflow.md）

---

## 7. 总结

**最终决策**：使用 JSONB 存储向量数据

**原因**：

1. Railway 自定义 Docker 镜像无法持久化数据库（经实测确认）
2. 当前数据规模（~10K 记录）JSONB 性能足够
3. 零迁移风险，保持现有稳定性
4. 未来可按需升级到专用向量数据库

---

**文档维护者**: Claude Code
**最后更新**: 2025-12-27
**版本**: 3.0
