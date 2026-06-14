/**
 * AI Engine - Long Term Memory Service
 * 长期记忆服务 - 持久化存储（基于用户隔离）
 *
 * 使用 Prisma + PostgreSQL 持久化，重启不丢失
 */

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { Prisma } from "@prisma/client";

/**
 * 搜索选项
 */
interface SearchOptions {
  userId?: string;
  limit?: number;
  threshold?: number;
  tags?: string[];
  type?: string;
}

/**
 * 列表选项
 */
interface ListOptions {
  userId?: string;
  offset?: number;
  limit?: number;
  sortBy?: "createdAt" | "updatedAt" | "importance";
  sortOrder?: "asc" | "desc";
  tags?: string[];
  type?: string;
}

/**
 * 设置选项
 */
interface SetOptions {
  ttl?: number;
  type?: string;
  importance?: number;
  tags?: string[];
}

/**
 * 长期记忆服务
 * 基于 userId 隔离的持久存储（Prisma + PostgreSQL）
 */
@Injectable()
export class LongTermMemoryService implements OnModuleInit {
  private readonly logger = new Logger(LongTermMemoryService.name);
  private tableReady = false;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    this.tableReady = await this.checkTableExists("long_term_memories");
    if (!this.tableReady) {
      this.logger.warn(
        "Table 'long_term_memories' not found — LongTermMemoryService is disabled until the table is created",
      );
    }
  }

  /**
   * 检查表是否存在
   */
  private async checkTableExists(tableName: string): Promise<boolean> {
    try {
      const result = await this.prisma.$queryRaw<[{ exists: boolean }]>(
        Prisma.sql`SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=${tableName}) AS "exists"`,
      );
      return result[0]?.exists ?? false;
    } catch {
      return false;
    }
  }

  /**
   * 根据 TTL 计算过期时间
   */
  private getExpiresAt(ttl?: number): Date | undefined {
    if (!ttl || ttl <= 0) return undefined;
    return new Date(Date.now() + ttl * 1000);
  }

  /**
   * 设置值（带用户隔离）
   */
  async setWithUser(
    userId: string,
    key: string,
    value: unknown,
    options?: SetOptions,
  ): Promise<void> {
    if (!this.tableReady) return;

    const expiresAt = this.getExpiresAt(options?.ttl);

    await this.prisma.longTermMemory.upsert({
      where: { userId_key: { userId, key } },
      create: {
        userId,
        key,
        value: value as Prisma.InputJsonValue,
        type: options?.type,
        importance: options?.importance ?? 0.5,
        tags: options?.tags ?? [],
        expiresAt,
      },
      update: {
        value: value as Prisma.InputJsonValue,
        type: options?.type,
        importance: options?.importance ?? 0.5,
        tags: options?.tags ?? [],
        expiresAt,
      },
    });
  }

  /**
   * 获取值（带用户隔离）
   */
  async getWithUser(userId: string, key: string): Promise<unknown> {
    if (!this.tableReady) return null;

    const entry = await this.prisma.longTermMemory.findUnique({
      where: { userId_key: { userId, key } },
    });

    if (!entry) return undefined;

    // 过期检查
    if (entry.expiresAt && entry.expiresAt < new Date()) {
      await this.prisma.longTermMemory.delete({
        where: { id: entry.id },
      });
      return undefined;
    }

    return {
      value: entry.value,
      type: entry.type,
      importance: entry.importance,
      tags: entry.tags,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  /**
   * 语义搜索
   * TODO: 实际应使用向量数据库进行语义搜索
   * 当前使用关键词匹配作为过渡方案（DB 层 ILIKE 过滤，避免全表扫描）
   */
  async search(
    query: string,
    options?: SearchOptions,
  ): Promise<
    Array<{ key: string; value: unknown; score: number; metadata: unknown }>
  > {
    if (!this.tableReady) return [];

    // 转义 ILIKE 特殊字符，防止 SQL 注入
    const likePattern = `%${query.replace(/[%_\\]/g, "\\$&")}%`;
    const limit = options?.limit ?? 100;

    // 动态构建 WHERE 条件（全部参数化）
    const conditions: Prisma.Sql[] = [
      Prisma.sql`(expires_at IS NULL OR expires_at > NOW())`,
      Prisma.sql`(key ILIKE ${likePattern} OR CAST(value AS TEXT) ILIKE ${likePattern})`,
    ];

    if (options?.userId) {
      conditions.push(Prisma.sql`user_id = ${options.userId}`);
    }
    if (options?.type) {
      conditions.push(Prisma.sql`type = ${options.type}`);
    }
    if (options?.tags && options.tags.length > 0) {
      conditions.push(Prisma.sql`tags && ${options.tags}::text[]`);
    }

    const whereClause = Prisma.join(conditions, " AND ");

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        userId: string;
        key: string;
        value: unknown;
        type: string | null;
        importance: number | null;
        tags: string[];
        expiresAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
      }>
    >(
      Prisma.sql`
        SELECT id, user_id AS "userId", key, value, type, importance, tags,
               expires_at AS "expiresAt", created_at AS "createdAt", updated_at AS "updatedAt"
        FROM long_term_memories
        WHERE ${whereClause}
        ORDER BY COALESCE(importance, 0.5) DESC
        LIMIT ${limit}
      `,
    );

    const queryLower = query.toLowerCase();
    const results: Array<{
      key: string;
      value: unknown;
      score: number;
      metadata: unknown;
    }> = [];

    for (const row of rows) {
      const valueStr = JSON.stringify(row.value).toLowerCase();
      const keyLower = row.key.toLowerCase();
      const score = this.calculateSimpleScore(
        queryLower,
        valueStr,
        keyLower,
        row.importance,
      );

      if (!options?.threshold || score >= options.threshold) {
        results.push({
          key: row.key,
          value: row.value,
          score,
          metadata: {
            type: row.type,
            importance: row.importance,
            tags: row.tags,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
        });
      }
    }

    results.sort((a, b) => b.score - a.score);

    return results;
  }

  /**
   * 计算简单相似度分数
   */
  private calculateSimpleScore(
    query: string,
    valueStr: string,
    key: string,
    importance?: number | null,
  ): number {
    let score = 0;

    if (key === query) {
      score += 1.0;
    } else if (key.includes(query)) {
      score += 0.5;
    }

    if (valueStr.includes(query)) {
      score += 0.3;
    }

    if (importance) {
      score *= 1 + (importance / 10) * 0.5;
    }

    return Math.min(score, 1);
  }

  /**
   * 删除值（带用户隔离）
   */
  async deleteWithUser(userId: string, key: string): Promise<boolean> {
    if (!this.tableReady) return false;

    try {
      await this.prisma.longTermMemory.delete({
        where: { userId_key: { userId, key } },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 列出记忆
   */
  async list(options?: ListOptions): Promise<
    Array<{
      key: string;
      value: unknown;
      type?: string;
      importance?: number;
      tags?: string[];
    }>
  > {
    if (!this.tableReady) return [];

    const where: Prisma.LongTermMemoryWhereInput = {
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    };

    if (options?.userId) {
      where.userId = options.userId;
    }

    if (options?.type) {
      where.type = options.type;
    }

    if (options?.tags && options.tags.length > 0) {
      where.tags = { hasSome: options.tags };
    }

    const sortBy = options?.sortBy || "updatedAt";
    const sortOrder = options?.sortOrder || "desc";

    const entries = await this.prisma.longTermMemory.findMany({
      where,
      orderBy: { [sortBy]: sortOrder },
      skip: options?.offset,
      take: options?.limit,
    });

    return entries.map((entry) => ({
      key: entry.key,
      value: entry.value,
      type: entry.type ?? undefined,
      importance: entry.importance ?? undefined,
      tags: entry.tags,
    }));
  }

  /**
   * 更新元数据
   */
  async updateMetadata(
    key: string,
    metadata: { importance?: number; tags?: string[] },
    userId?: string,
  ): Promise<boolean> {
    if (!this.tableReady) return false;

    const data: Prisma.LongTermMemoryUpdateInput = {};

    if (metadata.importance !== undefined) {
      data.importance = metadata.importance;
    }
    if (metadata.tags !== undefined) {
      data.tags = metadata.tags;
    }

    if (userId) {
      try {
        await this.prisma.longTermMemory.update({
          where: { userId_key: { userId, key } },
          data,
        });
        return true;
      } catch {
        return false;
      }
    }

    // 没有 userId 时，更新所有匹配 key 的记录
    const result = await this.prisma.longTermMemory.updateMany({
      where: {
        key,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      data,
    });

    return result.count > 0;
  }

  /**
   * 清理过期数据
   */
  async cleanup(): Promise<number> {
    if (!this.tableReady) return 0;

    const result = await this.prisma.longTermMemory.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });

    return result.count;
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<{ totalEntries: number; userCount: number }> {
    if (!this.tableReady) return { totalEntries: 0, userCount: 0 };

    const [totalEntries, userCountResult] = await Promise.all([
      this.prisma.longTermMemory.count(),
      this.prisma.longTermMemory.groupBy({
        by: ["userId"],
      }),
    ]);

    return {
      totalEntries,
      userCount: userCountResult.length,
    };
  }
}
