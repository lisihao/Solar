/**
 * PrismaVectorStore —— PR-S 持久化版（替代 InMemoryVectorStore for 生产）
 *
 * 设计：
 *   - cosine similarity 在 Node 内算（小规模 N < 100K 完全够；大规模换 pgvector 扩展）
 *   - LRU 淘汰：每个 namespace 容量上限 5000；超出按 lastAccessedAt 删
 *   - 召回时更新 lastAccessedAt（提升 LRU 留存）
 *
 * 与 InMemoryVectorStore 的关系：测试 / 本地用 InMemory；
 * 生产环境通过 env HARNESS_VECTOR_PERSIST=1 切到 Prisma。
 */

import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";

export interface PrismaVectorEntry {
  readonly id: string;
  readonly namespace: string;
  readonly source?: string;
  readonly entryKey: string;
  readonly content: string;
  readonly embedding: readonly number[];
  readonly confidence: number;
  readonly tags: readonly string[];
  readonly metadata?: Record<string, unknown>;
  readonly createdAt: Date;
  readonly lastAccessedAt: Date;
}

export interface PrismaRecallHit {
  readonly entry: PrismaVectorEntry;
  readonly similarity: number;
}

function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

@Injectable()
export class PrismaVectorStore {
  private readonly log = new Logger(PrismaVectorStore.name);
  /** 每 namespace 容量上限（超出按 LRU 淘汰） */
  private readonly perNamespaceCapacity = 5000;

  constructor(private readonly prisma: PrismaService) {}

  async add(
    entry: Omit<PrismaVectorEntry, "id" | "createdAt" | "lastAccessedAt"> & {
      id?: string;
    },
  ): Promise<PrismaVectorEntry> {
    const created = await this.prisma.harnessVectorMemory.create({
      data: {
        namespace: entry.namespace,
        source: entry.source,
        entryKey: entry.entryKey,
        content: entry.content,
        embedding: [...entry.embedding],
        confidence: entry.confidence,
        tags: [...entry.tags],
        metadata: entry.metadata
          ? (entry.metadata as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });
    // LRU evict 异步执行（不阻塞 add）
    void this.evictIfNeeded(entry.namespace).catch(() => {
      /* */
    });
    return this.toEntry(created);
  }

  async addBatch(
    entries: ReadonlyArray<
      Omit<PrismaVectorEntry, "id" | "createdAt" | "lastAccessedAt">
    >,
  ): Promise<number> {
    if (entries.length === 0) return 0;
    const data = entries.map((e) => ({
      namespace: e.namespace,
      source: e.source,
      entryKey: e.entryKey,
      content: e.content,
      embedding: [...e.embedding],
      confidence: e.confidence,
      tags: [...e.tags],
      metadata: e.metadata
        ? (e.metadata as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    }));
    const res = await this.prisma.harnessVectorMemory.createMany({ data });
    // 假设 batch 同 namespace（常见场景）
    void this.evictIfNeeded(entries[0].namespace).catch(() => {
      /* */
    });
    return res.count;
  }

  /**
   * K-NN 召回；在 Node 内 cosine 排序。
   * 假设 namespace 内 N < 5000 行（受 perNamespaceCapacity 保护），扫描可接受。
   */
  async recall(
    queryEmbedding: readonly number[],
    options: {
      namespace: string;
      k?: number;
      minSimilarity?: number;
      tags?: readonly string[];
    },
  ): Promise<readonly PrismaRecallHit[]> {
    const k = options.k ?? 5;
    const minSim = options.minSimilarity ?? 0.5;
    const candidates = await this.prisma.harnessVectorMemory.findMany({
      where: {
        namespace: options.namespace,
        ...(options.tags && options.tags.length > 0
          ? { tags: { hasEvery: [...options.tags] } }
          : {}),
      },
      // 不取太多，5000 上限内全 scan
      take: 5000,
    });
    const scored = candidates
      .map((row) => ({
        entry: this.toEntry(row),
        similarity: cosine(queryEmbedding, row.embedding),
      }))
      .filter((h) => h.similarity >= minSim)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);

    // 异步更新 lastAccessedAt（不阻塞）
    if (scored.length > 0) {
      const ids = scored.map((s) => s.entry.id);
      void this.prisma.harnessVectorMemory
        .updateMany({
          where: { id: { in: ids } },
          data: { lastAccessedAt: new Date() },
        })
        .catch(() => {
          /* */
        });
    }
    return scored;
  }

  async clearNamespace(namespace: string): Promise<number> {
    const res = await this.prisma.harnessVectorMemory.deleteMany({
      where: { namespace },
    });
    return res.count;
  }

  async size(namespace?: string): Promise<number> {
    return this.prisma.harnessVectorMemory.count({
      where: namespace ? { namespace } : undefined,
    });
  }

  // ── helpers ──────────────────────────────────────────

  private async evictIfNeeded(namespace: string): Promise<void> {
    const count = await this.size(namespace);
    if (count <= this.perNamespaceCapacity) return;
    const overflow = count - this.perNamespaceCapacity;
    const oldest = await this.prisma.harnessVectorMemory.findMany({
      where: { namespace },
      orderBy: { lastAccessedAt: "asc" },
      take: overflow,
      select: { id: true },
    });
    if (oldest.length === 0) return;
    await this.prisma.harnessVectorMemory.deleteMany({
      where: { id: { in: oldest.map((o) => o.id) } },
    });
    this.log.debug(
      `[evict] ns=${namespace} removed ${oldest.length} oldest entries`,
    );
  }

  private toEntry(row: {
    id: string;
    namespace: string;
    source: string | null;
    entryKey: string;
    content: string;
    embedding: number[];
    confidence: number;
    tags: string[];
    metadata: unknown;
    createdAt: Date;
    lastAccessedAt: Date;
  }): PrismaVectorEntry {
    return {
      id: row.id,
      namespace: row.namespace,
      source: row.source ?? undefined,
      entryKey: row.entryKey,
      content: row.content,
      embedding: row.embedding,
      confidence: row.confidence,
      tags: row.tags,
      metadata: (row.metadata as Record<string, unknown>) ?? undefined,
      createdAt: row.createdAt,
      lastAccessedAt: row.lastAccessedAt,
    };
  }
}
