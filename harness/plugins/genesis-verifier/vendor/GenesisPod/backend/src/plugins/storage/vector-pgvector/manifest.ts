/**
 * vector-pgvector backend manifest（v5.1 R0.5-E W2-B）
 *
 * Postgres pgvector 扩展，DB 级余弦距离运算（<=> 运算符 + HNSW 索引）。
 * 推荐生产部署。Railway PostgreSQL 不支持 pgvector → 降级 vector-jsonb。
 */
export const VECTOR_PGVECTOR_MANIFEST = {
  id: "storage/vector-pgvector",
  version: "1.0.0",
  description:
    "Vector storage with Postgres pgvector extension (DB-level <=> operator + HNSW index)",
  category: "storage",
  type: "backend" as const,
  port: "IVectorBackend",
  alternatives: [
    "storage/vector-jsonb",
    "storage/vector-qdrant", // future
    "storage/vector-pinecone",
    "storage/vector-weaviate",
    "storage/vector-milvus",
  ],
  homepage: "https://github.com/anthropics/genesis-agent-teams",
} as const;
