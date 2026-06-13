/**
 * vector-jsonb backend manifest（v5.1 R0.5-E W2-B）
 *
 * 应用层余弦相似度（JSONB 存储），pgvector 不可用时降级。
 */
export const VECTOR_JSONB_MANIFEST = {
  id: "storage/vector-jsonb",
  version: "1.0.0",
  description:
    "Vector storage with JSONB column + app-level cosine similarity (fallback when pgvector unavailable)",
  category: "storage",
  type: "backend" as const,
  port: "IVectorBackend",
  alternatives: ["storage/vector-pgvector"],
  tags: ["fallback"],
  homepage: "https://github.com/anthropics/genesis-agent-teams",
} as const;
