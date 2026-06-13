/**
 * jsonb vector backend（v5.1 R0.5-E W2-B）
 *
 * pgvector 不可用时降级使用，应用层计算余弦相似度。
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
export class JsonbBackend implements IVectorBackend {
  readonly id = "jsonb";
  private readonly logger = new Logger(JsonbBackend.name);

  constructor(private readonly prisma: PrismaService) {}

  isAvailable(): boolean {
    return true; // postgres bedrock，永远可用
  }

  private cosineSimilarity(a: ReadonlyArray<number>, b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  async similaritySearch(
    queryEmbedding: ReadonlyArray<number>,
    options: VectorSearchOptions,
  ): Promise<VectorSimilarityResult[]> {
    const { limit = 10, threshold = 0.3, documentIds } = options;
    interface RawJsonbResult {
      child_chunk_id: string;
      parent_chunk_id: string;
      document_id: string;
      content: string;
      parent_content: string;
      embedding: number[];
    }
    const docFilter = documentIds?.length
      ? Prisma.sql`AND cc.document_id = ANY(ARRAY[${Prisma.join([...documentIds])}]::text[])`
      : Prisma.sql``;
    const rows = await this.prisma.$queryRaw<RawJsonbResult[]>(Prisma.sql`
      SELECT
        ce.child_chunk_id,
        cc.parent_chunk_id,
        cc.document_id,
        cc.content,
        pc.content AS parent_content,
        ce.embedding
      FROM child_embeddings ce
      JOIN child_chunks cc ON ce.child_chunk_id = cc.id
      JOIN parent_chunks pc ON cc.parent_chunk_id = pc.id
      WHERE ce.embedding IS NOT NULL ${docFilter}
    `);
    this.logger.debug(
      `JSONB similaritySearch: ${rows.length} candidates → cosine compute`,
    );
    return rows
      .map((r) => ({
        childChunkId: r.child_chunk_id,
        parentChunkId: r.parent_chunk_id,
        documentId: r.document_id,
        content: r.content,
        parentContent: r.parent_content,
        similarity: this.cosineSimilarity(queryEmbedding, r.embedding),
      }))
      .filter((r) => r.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  async vectorSearch(
    queryEmbedding: ReadonlyArray<number>,
    options: VectorSearchOptions,
  ): Promise<VectorSearchSimpleResult[]> {
    const { limit = 10, threshold = 0.3, documentIds } = options;
    interface RawJsonbSimple {
      child_chunk_id: string;
      content: string;
      embedding: number[];
    }
    const docFilter = documentIds?.length
      ? Prisma.sql`AND cc.document_id = ANY(ARRAY[${Prisma.join([...documentIds])}]::text[])`
      : Prisma.sql``;
    const rows = await this.prisma.$queryRaw<RawJsonbSimple[]>(Prisma.sql`
      SELECT
        ce.child_chunk_id,
        cc.content,
        ce.embedding
      FROM child_embeddings ce
      JOIN child_chunks cc ON ce.child_chunk_id = cc.id
      WHERE ce.embedding IS NOT NULL ${docFilter}
    `);
    return rows
      .map((r) => ({
        chunkId: r.child_chunk_id,
        content: r.content,
        similarity: this.cosineSimilarity(queryEmbedding, r.embedding),
      }))
      .filter((r) => r.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  async storeEmbedding(
    childChunkId: string,
    embedding: ReadonlyArray<number>,
    model: string,
  ): Promise<void> {
    const jsonStr = JSON.stringify([...embedding]);
    const dimensions = embedding.length;
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO child_embeddings (id, child_chunk_id, embedding, model, dimensions, created_at, updated_at)
      VALUES (gen_random_uuid(), ${childChunkId}, ${jsonStr}::jsonb, ${model}, ${dimensions}, NOW(), NOW())
      ON CONFLICT (child_chunk_id) DO UPDATE SET
        embedding = EXCLUDED.embedding,
        model = EXCLUDED.model,
        dimensions = EXCLUDED.dimensions,
        updated_at = NOW()
    `);
  }
}
