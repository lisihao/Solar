-- Harness Vector Memory (PR-S)
-- Agent 长期语义记忆持久层；Mission 完成时自动 index。

CREATE TABLE IF NOT EXISTS "harness_vector_memory" (
  "id"                TEXT NOT NULL,
  "namespace"         VARCHAR(128) NOT NULL,
  "source"            VARCHAR(64),
  "entry_key"         VARCHAR(128) NOT NULL,
  "content"           TEXT NOT NULL,
  "embedding"         DOUBLE PRECISION[] NOT NULL,
  "confidence"        DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "tags"              TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "metadata"          JSONB,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_accessed_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "harness_vector_memory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "harness_vector_memory_ns_created_idx"
  ON "harness_vector_memory" ("namespace", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "harness_vector_memory_ns_lru_idx"
  ON "harness_vector_memory" ("namespace", "last_accessed_at" DESC);

CREATE INDEX IF NOT EXISTS "harness_vector_memory_source_idx"
  ON "harness_vector_memory" ("source");
