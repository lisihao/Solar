/**
 * MemoryCoordinatorService
 *
 * 支柱三：统一记忆架构（Memory OS）— 协调器
 *
 * 统一的跨层记忆读写接口，并行聚合 4 层记忆数据：
 *
 *   Layer 1: 对话记忆 (ShortTermMemoryService) — 当前 session 上下文
 *   Layer 2: 工作记忆 (ShortTermMemoryService，键前缀 work:) — Agent 任务活跃状态
 *   Layer 3: 长期记忆 (LongTermMemoryService) — 用户偏好、领域知识
 *   Layer 4: 知识图谱 (保留接口，待 KnowledgeGraphTool 成熟后接入)
 *
 * 架构原则：
 *   - recall() 并行读取所有可用层，以 relevanceScore 排序后返回
 *   - store() 根据 MemoryEventType 路由到对应层，写入失败不影响主流程
 *   - Layer 4 通过 @Optional() 接入，未接入时降级运行
 *
 * 使用场景：
 *   - GenesisAgent 执行前：recall() 丰富 Agent 上下文
 *   - GenesisAgent 执行后：store() 沉淀执行结果到长期记忆
 *   - Ask / Research 对话中：recall() 注入历史知识
 */

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ShortTermMemoryService } from "../stores/short-term-memory.service";
import { LongTermMemoryService } from "../stores/long-term-memory.service";
import { KnowledgeGraphTool } from "../../../ai-engine/tools/categories/information/knowledge/knowledge-graph.tool";
import { PrismaVectorStore } from "../vector/prisma-vector-store";
import type { IEmbeddingProvider } from "../vector/embedding-provider";

/**
 * G2: DI token for the Layer-3 semantic embedder. `IEmbeddingProvider` is a TS
 * interface (erased at runtime), so it MUST be injected via this token — a module
 * enabling semantic memory provides `{ provide: MEMORY_EMBEDDER, useClass/useValue }`
 * plus `PrismaVectorStore`. Absent either (or flag off) → exact-key recall only.
 */
export const MEMORY_EMBEDDER = Symbol("MEMORY_EMBEDDER");

// ─────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────

/** 记忆事件类型 */
export type MemoryEventType =
  | "conversation" // Layer 1: 对话消息
  | "working" // Layer 2: 任务工作状态
  | "preference" // Layer 3: 用户偏好
  | "knowledge" // Layer 3: 领域知识
  | "summary"; // Layer 3: 执行结果摘要

/** 单条记忆片段（跨层归一化） */
export interface MemoryFragment {
  /** 数据来源层 */
  layer: 1 | 2 | 3 | 4;
  /** 内容键（layer 1/2 为 session+key，layer 3 为 userId+key） */
  key: string;
  /** 内容值（文本或对象） */
  value: unknown;
  /** 相关性分数（0-1，越高越相关，用于排序） */
  relevanceScore: number;
  /** 内存类型标签 */
  type: MemoryEventType;
}

/** recall() 输入：记忆查询 */
export interface MemoryQuery {
  /** 查询关键词（用于文本匹配） */
  query: string;
  /** 要查询的记忆层（不传 = 全部层） */
  layers?: Array<1 | 2 | 3 | 4>;
  /** 最大返回条数（默认 10） */
  limit?: number;
}

/** recall() 输出：跨层记忆上下文 */
export interface MemoryContext {
  /** 按相关性排序的记忆片段列表 */
  fragments: MemoryFragment[];
  /** 各层命中数统计 */
  layerHits: Record<1 | 2 | 3 | 4, number>;
}

/** store() 输入：记忆事件 */
export interface MemoryEvent {
  /** 事件类型（决定路由到哪一层） */
  type: MemoryEventType;
  /** 存储键 */
  key: string;
  /** 存储值 */
  value: unknown;
  /** TTL（秒，Layer 2 默认 86400 = 24h，Layer 3 可不传 = 永久） */
  ttl?: number;
  /** 重要性分数（0-1，Layer 3 用于排序） */
  importance?: number;
  /** 标签（Layer 3 用于过滤） */
  tags?: string[];
}

// ─────────────────────────────────────────────────────────
// Internal constants
// ─────────────────────────────────────────────────────────

/** Layer 2 工作记忆 key 前缀 */
const WORKING_MEMORY_PREFIX = "work:";

/** Layer 2 TTL 默认 24 小时 */
const WORKING_MEMORY_TTL = 86_400;

// ─────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────

@Injectable()
export class MemoryCoordinatorService {
  private readonly logger = new Logger(MemoryCoordinatorService.name);

  constructor(
    private readonly shortTermMemory: ShortTermMemoryService,
    private readonly longTermMemory: LongTermMemoryService,
    // Layer 4: KnowledgeGraphTool — @Optional() 降级兼容（无 Prisma 时跳过）
    @Optional() private readonly knowledgeGraph?: KnowledgeGraphTool,
    // G2 语义记忆（可选）：向量库 + 嵌入器同时注入且 flag on 才启用，
    // 否则 Layer 3 退化为纯精确 key 查找（现网默认行为不变）。
    @Optional() private readonly vectorStore?: PrismaVectorStore,
    @Optional()
    @Inject(MEMORY_EMBEDDER)
    private readonly embedder?: IEmbeddingProvider,
  ) {}

  /** G2: 语义记忆需 flag on + 向量库 + 嵌入器三者齐备。 */
  private semanticEnabled(): boolean {
    return (
      process.env.HARNESS_SEMANTIC_MEMORY === "true" &&
      !!this.vectorStore &&
      !!this.embedder
    );
  }

  /** Layer 3 向量 namespace（按 user 隔离）。 */
  private ltmNamespace(userId: string): string {
    return `ltm:${userId}`;
  }

  private serializeValue(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  // ─── Public API ─────────────────────────────────────────

  /**
   * 并行召回跨层记忆，返回按相关性排序的 MemoryContext
   */
  async recall(
    query: MemoryQuery,
    userId: string,
    sessionId?: string,
  ): Promise<MemoryContext> {
    const layers = query.layers ?? [1, 2, 3, 4];
    const limit = query.limit ?? 10;

    const [l1, l2, l3, l4] = await Promise.all([
      layers.includes(1) && sessionId
        ? this.recallLayer1(query, sessionId).catch((err) => {
            this.logger.warn(
              `[recall] Layer 1 failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            return [];
          })
        : Promise.resolve([] as MemoryFragment[]),
      layers.includes(2) && sessionId
        ? this.recallLayer2(query, sessionId).catch((err) => {
            this.logger.warn(
              `[recall] Layer 2 failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            return [];
          })
        : Promise.resolve([] as MemoryFragment[]),
      layers.includes(3)
        ? this.recallLayer3(query, userId).catch((err) => {
            this.logger.warn(
              `[recall] Layer 3 failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            return [];
          })
        : Promise.resolve([] as MemoryFragment[]),
      layers.includes(4) && this.knowledgeGraph
        ? this.recallLayer4(query, userId).catch((err) => {
            this.logger.warn(
              `[recall] Layer 4 failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            return [];
          })
        : Promise.resolve([] as MemoryFragment[]),
    ]);

    const all = [...l1, ...l2, ...l3, ...l4]
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);

    const layerHits: Record<1 | 2 | 3 | 4, number> = {
      1: l1.length,
      2: l2.length,
      3: l3.length,
      4: l4.length,
    };

    this.logger.debug(
      `[recall] userId=${userId} query="${query.query.slice(0, 40)}" hits=${all.length} layers=${JSON.stringify(layerHits)}`,
    );

    return { fragments: all, layerHits };
  }

  /**
   * 根据事件类型路由写入对应记忆层（fire-and-forget 不阻塞主流程）
   */
  async store(
    event: MemoryEvent,
    userId: string,
    sessionId?: string,
  ): Promise<void> {
    try {
      switch (event.type) {
        case "conversation":
          // Layer 1: 短期会话记忆
          if (sessionId) {
            await this.shortTermMemory.setWithSession(
              sessionId,
              event.key,
              event.value,
              event.ttl,
            );
          }
          break;

        case "working":
          // Layer 2: 工作记忆（24h TTL）
          if (sessionId) {
            await this.shortTermMemory.setWithSession(
              sessionId,
              `${WORKING_MEMORY_PREFIX}${event.key}`,
              event.value,
              event.ttl ?? WORKING_MEMORY_TTL,
            );
          }
          break;

        case "preference":
        case "knowledge":
        case "summary":
          // Layer 3: 长期记忆
          await this.longTermMemory.setWithUser(
            userId,
            event.key,
            event.value,
            {
              type: event.type,
              importance: event.importance ?? 0.5,
              tags: event.tags,
              ttl: event.ttl,
            },
          );
          // G2: 同步把该条索引进向量库（fire-and-forget，失败不影响 LTM 写入）
          void this.indexToVector(userId, event).catch((err) => {
            this.logger.warn(
              `[store] vector index failed (key=${event.key}): ${err instanceof Error ? err.message : String(err)}`,
            );
          });
          break;
      }

      this.logger.debug(
        `[store] type=${event.type} key=${event.key} userId=${userId}`,
      );
    } catch (err) {
      this.logger.warn(
        `[store] Failed to store memory (type=${event.type} key=${event.key}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ─── Private: Layer recall ───────────────────────────────

  /** Layer 1: 从 session 短期记忆中查找匹配条目 */
  private async recallLayer1(
    query: MemoryQuery,
    sessionId: string,
  ): Promise<MemoryFragment[]> {
    const value = await this.shortTermMemory.getWithSession(
      sessionId,
      query.query,
    );
    if (value === undefined) return [];

    return [
      {
        layer: 1,
        key: query.query,
        value,
        relevanceScore: 0.9, // 精确 key 匹配，高相关性
        type: "conversation",
      },
    ];
  }

  /** Layer 2: 从工作记忆中查找匹配条目 */
  private async recallLayer2(
    query: MemoryQuery,
    sessionId: string,
  ): Promise<MemoryFragment[]> {
    const workKey = `${WORKING_MEMORY_PREFIX}${query.query}`;
    const value = await this.shortTermMemory.getWithSession(sessionId, workKey);
    if (value === undefined) return [];

    return [
      {
        layer: 2,
        key: workKey,
        value,
        relevanceScore: 0.85,
        type: "working",
      },
    ];
  }

  /**
   * Layer 3: 长期记忆召回。混合策略 —
   *   - 精确 key 查找（词法信号，高置信）
   *   - G2: 若语义记忆启用，再做向量 KNN（自然语言查询命中语义相近条目）
   * 两路结果按 key 去重合并。
   */
  private async recallLayer3(
    query: MemoryQuery,
    userId: string,
  ): Promise<MemoryFragment[]> {
    const fragments: MemoryFragment[] = [];

    // 1. 精确 key 查找
    const exact = await this.longTermMemory.getWithUser(userId, query.query);
    if (exact) {
      const record = exact as {
        value: unknown;
        type?: string;
        importance?: number;
      };
      fragments.push({
        layer: 3,
        key: query.query,
        value: record.value,
        relevanceScore: record.importance ?? 0.5,
        type: (record.type as MemoryEventType) ?? "knowledge",
      });
    }

    // 2. G2 语义向量召回（启用时），去重后合并
    if (this.semanticEnabled()) {
      const semantic = await this.recallLayer3Semantic(query, userId);
      for (const f of semantic) {
        if (!fragments.some((e) => e.key === f.key)) fragments.push(f);
      }
    }

    return fragments;
  }

  /** G2: 向量 KNN 召回（embed query → PrismaVectorStore.recall）。 */
  private async recallLayer3Semantic(
    query: MemoryQuery,
    userId: string,
  ): Promise<MemoryFragment[]> {
    if (!this.vectorStore || !this.embedder) return [];
    const queryEmbedding = await this.embedder.embed(query.query);
    const hits = await this.vectorStore.recall(queryEmbedding, {
      namespace: this.ltmNamespace(userId),
      k: query.limit ?? 10,
      minSimilarity: 0.3,
    });
    return hits.map((h) => ({
      layer: 3 as const,
      key: h.entry.entryKey,
      value: h.entry.content,
      relevanceScore: h.similarity,
      type:
        (h.entry.metadata?.["type"] as MemoryEventType | undefined) ??
        "knowledge",
    }));
  }

  /** G2: 把一条长期记忆事件嵌入并写入向量库（启用时）。 */
  private async indexToVector(
    userId: string,
    event: MemoryEvent,
  ): Promise<void> {
    if (!this.semanticEnabled() || !this.vectorStore || !this.embedder) return;
    const content = this.serializeValue(event.value);
    const embedding = await this.embedder.embed(content);
    await this.vectorStore.add({
      namespace: this.ltmNamespace(userId),
      source: "ltm",
      entryKey: event.key,
      content,
      embedding,
      confidence: event.importance ?? 0.5,
      tags: event.tags ?? [],
      metadata: { type: event.type },
    });
  }

  /**
   * Layer 4: 从知识图谱中查找与查询关键词相关的实体（实体名称模糊匹配）
   * 使用 find_entity queryType，将匹配到的图节点转为 MemoryFragment
   */
  private async recallLayer4(
    query: MemoryQuery,
    userId: string,
  ): Promise<MemoryFragment[]> {
    if (!this.knowledgeGraph) return [];

    const result = await this.knowledgeGraph.execute(
      {
        queryType: "find_entity",
        entityName: query.query,
        limit: 8,
      },
      {
        executionId: `memory-recall-${Date.now()}`,
        toolId: "knowledge-graph",
        userId,
        createdAt: new Date(),
      },
    );

    if (!result.success || !result.data?.nodes?.length) return [];

    // 每个匹配节点 → 一条 MemoryFragment，relevanceScore 固定 0.7（图谱命中）
    return result.data.nodes.map((node) => ({
      layer: 4 as const,
      key: `graph:${node.id}`,
      value: {
        entity: node.name,
        type: node.type,
        properties: node.properties,
        resourceId: node.resourceId,
      },
      relevanceScore: 0.7,
      type: "knowledge" as MemoryEventType,
    }));
  }
}
