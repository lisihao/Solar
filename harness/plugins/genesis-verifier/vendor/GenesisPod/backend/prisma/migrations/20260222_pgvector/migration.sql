-- Migration: 20260222_pgvector
-- 将 ChildEmbedding 和 TopicMessageEmbedding 的 embedding 字段
-- 从 JSONB 迁移到 pgvector vector(1536) 类型，并创建 HNSW 余弦索引
-- NOTE: Safely skips if pgvector extension is not available (e.g. Railway PostgreSQL)

DO $$
BEGIN
  -- Only proceed if pgvector is available
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    CREATE EXTENSION IF NOT EXISTS vector;

    -- Migrate ChildEmbedding (JSONB -> vector)
    ALTER TABLE "child_embeddings"
      ALTER COLUMN "embedding" TYPE vector(1536)
      USING (embedding::text::vector(1536));

    -- Migrate TopicMessageEmbedding (JSONB -> vector)
    ALTER TABLE "topic_message_embeddings"
      ALTER COLUMN "embedding" TYPE vector(1536)
      USING (embedding::text::vector(1536));

    -- HNSW cosine similarity indexes
    CREATE INDEX IF NOT EXISTS child_embeddings_hnsw_idx
      ON "child_embeddings" USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);

    CREATE INDEX IF NOT EXISTS topic_msg_embeddings_hnsw_idx
      ON "topic_message_embeddings" USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);

    RAISE NOTICE 'pgvector migration applied successfully';
  ELSE
    RAISE NOTICE 'pgvector extension not available, skipping migration (embeddings remain JSONB)';
  END IF;
END $$;
