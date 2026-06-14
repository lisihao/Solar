/**
 * IVectorBackend — 向量数据库端口（v5.1 R0.5-E W2-B）
 *
 * 部署平台差异驱动的真 plugin（满足 §〇.1 三条充要条件）：
 *   - pgvector（Postgres 扩展，本机部署，Railway 不支持）
 *   - JSONB fallback（pgvector 不可用时降级，应用层余弦）
 *   - Qdrant（self-hosted / Qdrant Cloud）
 *   - Pinecone（managed SaaS）
 *   - Weaviate（self-hosted / Weaviate Cloud）
 *   - Milvus（self-hosted）
 *   - 未来 Chroma / LanceDB 等
 *
 * 由 plugins/storage/vector-backends.module 通过 VECTOR_BACKENDS_TOKEN 注入。
 * VectorService（ai-engine/rag/vector）按 isAvailable() 选 backend。
 */

export interface VectorSearchOptions {
  readonly limit?: number;
  readonly threshold?: number;
  /** pre-resolved document ids（service 层已把 knowledgeBaseIds 解析过）*/
  readonly documentIds?: ReadonlyArray<string>;
}

export interface VectorSimilarityResult {
  readonly childChunkId: string;
  readonly parentChunkId: string;
  readonly documentId: string;
  readonly content: string;
  readonly parentContent: string;
  readonly similarity: number;
}

export interface VectorSearchSimpleResult {
  readonly chunkId: string;
  readonly content: string;
  readonly similarity: number;
}

export interface IVectorBackend {
  /** Backend 唯一标识（"pgvector" / "jsonb" / "qdrant" / "pinecone" 等） */
  readonly id: string;

  /** 启动期初始化（如 pgvector CREATE EXTENSION / qdrant connect） */
  init?(): Promise<void>;

  /** 此 backend 是否可用 */
  isAvailable(): boolean;

  /** 全字段搜索（含 parent chunk 内容） */
  similaritySearch(
    queryEmbedding: ReadonlyArray<number>,
    options: VectorSearchOptions,
  ): Promise<VectorSimilarityResult[]>;

  /** 简单搜索（不展开 parent） */
  vectorSearch(
    queryEmbedding: ReadonlyArray<number>,
    options: VectorSearchOptions,
  ): Promise<VectorSearchSimpleResult[]>;

  /** 存储 embedding */
  storeEmbedding(
    childChunkId: string,
    embedding: ReadonlyArray<number>,
    model: string,
  ): Promise<void>;
}

/** DI token：注入 ReadonlyArray<IVectorBackend>，按优先级排序（pgvector > jsonb） */
export const VECTOR_BACKENDS_TOKEN = "VECTOR_BACKENDS_TOKEN";
