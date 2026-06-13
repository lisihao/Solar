/**
 * pgvector backend（v5.1 R0.5-E W2-B）
 */
import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import type {
  IVectorBackend,
  VectorSearchOptions,
  VectorSimilarityResult,
  VectorSearchSimpleResult,
} from "@/plugins/core/abstractions";

@Injectable()
export class PgvectorBackend implements IVectorBackend {
  readonly id = "pgvector";
  private readonly logger = new Logger(PgvectorBackend.name);
  private available = false;

  constructor(private readonly prisma: PrismaService) {}

  async init(): Promise<void> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{ exists: boolean }>
      >(
        "SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') AS exists",
      );
      if (rows?.[0]?.exists !== true) {
        this.available = false;
        this.logger.log("[init] pgvector extension not installed");
        return;
      }
      await this.prisma.$executeRawUnsafe(
        "CREATE EXTENSION IF NOT EXISTS vector",
      );
      this.available = true;
      this.logger.log("[init] pgvector ready");
    } catch (err) {
      this.available = false;
      this.logger.log(
        `[init] pgvector unavailable (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  async similaritySearch(
    queryEmbedding: ReadonlyArray<number>,
    options: VectorSearchOptions,
  ): Promise<VectorSimilarityResult[]> {
    const { limit = 10, threshold = 0.3, documentIds } = options;
    const vectorStr = `[${queryEmbedding.join(",")}]`;
    interface RawResult {
      child_chunk_id: string;
      parent_chunk_id: string;
      document_id: string;
      content: string;
      parent_content: string;
      score: unknown;
    }
    const docFilter = documentIds?.length
      ? Prisma.sql`AND cc.document_id = ANY(ARRAY[${Prisma.join([...documentIds])}]::text[])`
      : Prisma.sql``;
    const results = await this.prisma.$queryRaw<RawResult[]>(Prisma.sql`
      SELECT child_chunk_id, parent_chunk_id, document_id, content, parent_content, score
      FROM (
        SELECT
          ce.child_chunk_id,
          cc.parent_chunk_id,
          cc.document_id,
          cc.content,
          pc.content AS parent_content,
          1 - (ce.embedding <=> ${vectorStr}::vector) AS score
        FROM child_embeddings ce
        JOIN child_chunks cc ON ce.child_chunk_id = cc.id
        JOIN parent_chunks pc ON cc.parent_chunk_id = pc.id
        WHERE true ${docFilter}
        ORDER BY ce.embedding <=> ${vectorStr}::vector
        LIMIT ${limit}
      ) sub
      WHERE score >= ${threshold}
    `);
    return results.map((r) => ({
      childChunkId: r.child_chunk_id,
      parentChunkId: r.parent_chunk_id,
      documentId: r.document_id,
      content: r.content,
      parentContent: r.parent_content,
      similarity: Number(r.score),
    }));
  }

  async vectorSearch(
    queryEmbedding: ReadonlyArray<number>,
    options: VectorSearchOptions,
  ): Promise<VectorSearchSimpleResult[]> {
    const { limit = 10, threshold = 0.3, documentIds } = options;
    const vectorStr = `[${queryEmbedding.join(",")}]`;
    interface RawSimpleResult {
      child_chunk_id: string;
      content: string;
      score: unknown;
    }
    const docFilter = documentIds?.length
      ? Prisma.sql`AND cc.document_id = ANY(ARRAY[${Prisma.join([...documentIds])}]::text[])`
      : Prisma.sql``;
    const results = await this.prisma.$queryRaw<RawSimpleResult[]>(Prisma.sql`
      SELECT child_chunk_id, content, score
      FROM (
        SELECT
          ce.child_chunk_id,
          cc.content,
          1 - (ce.embedding <=> ${vectorStr}::vector) AS score
        FROM child_embeddings ce
        JOIN child_chunks cc ON ce.child_chunk_id = cc.id
        WHERE true ${docFilter}
        ORDER BY ce.embedding <=> ${vectorStr}::vector
        LIMIT ${limit}
      ) sub
      WHERE score >= ${threshold}
    `);
    return results.map((r) => ({
      chunkId: r.child_chunk_id,
      content: r.content,
      similarity: Number(r.score),
    }));
  }

  async storeEmbedding(
    childChunkId: string,
    embedding: ReadonlyArray<number>,
    model: string,
  ): Promise<void> {
    const vectorStr = `[${embedding.join(",")}]`;
    const dimensions = embedding.length;
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO child_embeddings (id, child_chunk_id, embedding, model, dimensions, created_at, updated_at)
      VALUES (gen_random_uuid(), ${childChunkId}, ${vectorStr}::vector, ${model}, ${dimensions}, NOW(), NOW())
      ON CONFLICT (child_chunk_id) DO UPDATE SET
        embedding = EXCLUDED.embedding,
        model = EXCLUDED.model,
        dimensions = EXCLUDED.dimensions,
        updated_at = NOW()
    `);
  }
}
