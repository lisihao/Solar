/**
 * AI Engine - Vector Service（v5.1 R0.5-E W2-B vector plugin orchestrator）
 *
 * 注入 plugins/storage/vector-* 的 IVectorBackend 数组（VECTOR_BACKENDS_TOKEN
 * 由 @Global VectorBackendsModule 提供）。onModuleInit 选第一个 isAvailable()
 * 的 backend，所有操作委托给它。
 *
 * 当前 backend：
 *   - storage/vector-pgvector  Postgres pgvector（推荐生产）
 *   - storage/vector-jsonb     JSONB 应用层余弦（pgvector 不可用时降级）
 *
 * 未来 backend（按 §〇.3 反应式触发）：
 *   - storage/vector-qdrant / vector-pinecone / vector-weaviate / vector-milvus
 */

import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  VECTOR_BACKENDS_TOKEN,
  type IVectorBackend,
} from "@/plugins/core/abstractions";

/**
 * 相似度搜索选项
 */
export interface SimilaritySearchOptions {
  limit?: number;
  threshold?: number;
  knowledgeBaseIds?: string[];
}

/**
 * 相似度搜索结果（兼容 legacy 公共 API）
 */
export interface SimilarityResult {
  childChunkId: string;
  parentChunkId: string;
  documentId: string;
  content: string;
  parentContent: string;
  similarity: number;
}

/**
 * 向量搜索结果（简化版）
 */
export interface VectorSearchResult {
  chunkId: string;
  content: string;
  similarity: number;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class VectorService implements OnModuleInit {
  private readonly logger = new Logger(VectorService.name);
  private backend!: IVectorBackend;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(VECTOR_BACKENDS_TOKEN)
    private readonly backends: ReadonlyArray<IVectorBackend>,
    /** B (2026-05-05): VECTOR_QUERY hook seam — plugin 可拦截/缓存查询 */
    @Optional()
    private readonly hookBus?: import("@/plugins/core/hook-bus").HookBus,
  ) {}

  async onModuleInit() {
    for (const b of this.backends) {
      try {
        await b.init?.();
      } catch (err) {
        this.logger.warn(
          `[onModuleInit] backend ${b.id} init failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    const chosen = this.backends.find((b) => b.isAvailable());
    if (!chosen) {
      throw new Error(
        "No vector backend available; check VectorBackendsModule wiring",
      );
    }
    this.backend = chosen;
    this.logger.log(`[onModuleInit] selected vector backend = ${chosen.id}`);
  }

  /** 测试或运行期切换 backend（spec 用） */
  setBackend(backend: IVectorBackend): void {
    this.backend = backend;
  }

  isPgvectorAvailable(): boolean {
    return this.backend?.id === "pgvector";
  }

  // ── 解析 knowledgeBaseIds → documentIds ──

  private async resolveDocumentIds(
    knowledgeBaseIds: string[] | undefined,
  ): Promise<string[] | undefined> {
    if (!knowledgeBaseIds?.length) return undefined;
    const docs = await this.prisma.knowledgeBaseDocument.findMany({
      where: { knowledgeBaseId: { in: knowledgeBaseIds } },
      select: { id: true },
    });
    return docs.map((d) => d.id);
  }

  // ── 相似度搜索（含 parent chunk） ──

  async similaritySearch(
    queryEmbedding: number[],
    options: SimilaritySearchOptions = {},
  ): Promise<SimilarityResult[]> {
    const { knowledgeBaseIds } = options;
    const documentIds = await this.resolveDocumentIds(knowledgeBaseIds);
    if (knowledgeBaseIds?.length && documentIds?.length === 0) {
      return [];
    }

    const terminal = () =>
      this.backend.similaritySearch(queryEmbedding, {
        ...options,
        documentIds,
      }) as Promise<SimilarityResult[]>;

    // B (2026-05-05): VECTOR_QUERY hook — plugin 可缓存命中 / 切 backend
    if (this.hookBus) {
      const payload = {
        queryEmbedding,
        topK: options.limit ?? 5,
        filter: undefined as Record<string, unknown> | undefined,
        knowledgeBaseIds,
      };
      try {
        return await this.hookBus.fire(
          "engine.vector.query",
          payload,
          terminal,
        );
      } catch (err) {
        const abortPayload = (err as { abortPayload?: SimilarityResult[] })
          ?.abortPayload;
        if (Array.isArray(abortPayload)) return abortPayload;
        throw err;
      }
    }
    return terminal();
  }

  // ── 简单搜索 ──

  async vectorSearch(
    queryEmbedding: number[],
    options: SimilaritySearchOptions = {},
  ): Promise<VectorSearchResult[]> {
    const { knowledgeBaseIds } = options;
    const documentIds = await this.resolveDocumentIds(knowledgeBaseIds);
    if (knowledgeBaseIds?.length && documentIds?.length === 0) {
      return [];
    }
    return this.backend.vectorSearch(queryEmbedding, {
      ...options,
      documentIds,
    }) as Promise<VectorSearchResult[]>;
  }

  // ── 存储 / 删除 ──

  async storeEmbedding(
    childChunkId: string,
    embedding: number[],
    model: string,
  ): Promise<void> {
    await this.backend.storeEmbedding(childChunkId, embedding, model);
    this.logger.debug(
      `Stored embedding for ${childChunkId}: ${embedding.length} dims (${this.backend.id})`,
    );
  }

  async batchStoreEmbeddings(
    items: Array<{ childChunkId: string; embedding: number[] }>,
    model: string,
  ): Promise<number> {
    let stored = 0;
    for (const item of items) {
      try {
        await this.storeEmbedding(item.childChunkId, item.embedding, model);
        stored++;
      } catch (error) {
        this.logger.error(
          `Failed to store embedding for chunk ${item.childChunkId}:`,
          error,
        );
      }
    }
    this.logger.log(`Batch stored ${stored}/${items.length} embeddings`);
    return stored;
  }

  async deleteEmbedding(childChunkId: string): Promise<void> {
    await this.prisma.childEmbedding.delete({ where: { childChunkId } });
  }

  async hasEmbedding(childChunkId: string): Promise<boolean> {
    const count = await this.prisma.childEmbedding.count({
      where: { childChunkId },
    });
    return count > 0;
  }

  async getEmbeddingCount(knowledgeBaseId: string): Promise<number> {
    return this.prisma.childEmbedding.count({
      where: {
        childChunk: {
          parentChunk: { document: { knowledgeBaseId } },
        },
      },
    });
  }
}
