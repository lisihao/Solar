-- Knowledge Graph 基础表
-- KnowledgeGraphTool (ai-engine/tools/categories/information/knowledge/knowledge-graph.tool.ts)
-- 期望存在 entities + relationships 两张表，但生产 schema 从未创建。
-- 任何 mission 调 KG 查询时都会撞 prisma 42P01 (relation does not exist)，
-- 即使 tool 内部 .catch return [] 不阻塞 mission，也持续污染日志 + 工具失效。

CREATE TABLE IF NOT EXISTS "entities" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "type"        VARCHAR(64) NOT NULL,
  "properties"  JSONB NOT NULL DEFAULT '{}',
  "resource_id" TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "entities_name_idx" ON "entities" ("name");
CREATE INDEX IF NOT EXISTS "entities_type_idx" ON "entities" ("type");
CREATE INDEX IF NOT EXISTS "entities_resource_id_idx" ON "entities" ("resource_id");

CREATE TABLE IF NOT EXISTS "relationships" (
  "id"          TEXT NOT NULL,
  "source_id"   TEXT NOT NULL,
  "target_id"   TEXT NOT NULL,
  "type"        VARCHAR(64) NOT NULL,
  "weight"      DOUBLE PRECISION,
  "properties"  JSONB NOT NULL DEFAULT '{}',
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "relationships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "relationships_source_fkey"
    FOREIGN KEY ("source_id") REFERENCES "entities"("id") ON DELETE CASCADE,
  CONSTRAINT "relationships_target_fkey"
    FOREIGN KEY ("target_id") REFERENCES "entities"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "relationships_source_id_idx" ON "relationships" ("source_id");
CREATE INDEX IF NOT EXISTS "relationships_target_id_idx" ON "relationships" ("target_id");
CREATE INDEX IF NOT EXISTS "relationships_type_idx" ON "relationships" ("type");
