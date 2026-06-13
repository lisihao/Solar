-- create-vector-indexes.sql
-- 在 pgvector 迁移完成后，单独执行此脚本以零停机方式创建 HNSW 索引。
-- CONCURRENTLY 不允许在事务块中运行，需要在 psql 命令行中单独执行：
--
--   psql $DATABASE_URL -f prisma/scripts/create-vector-indexes.sql
--
-- 此操作不阻塞表读写，但耗时较长（取决于数据量）。

CREATE INDEX CONCURRENTLY IF NOT EXISTS child_embeddings_hnsw_idx
  ON "child_embeddings" USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX CONCURRENTLY IF NOT EXISTS topic_msg_embeddings_hnsw_idx
  ON "topic_message_embeddings" USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
