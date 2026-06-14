-- Industry Chain Analysis tables（产业链分析）
-- AI 动态编排（SEC + web）抽取的产业链实体/关系结构化存储，供图谱可视化 + 增量刷新。
-- Idempotent (IF NOT EXISTS)；hand-written，never via prisma migrate dev。
-- 详见 docs/features/industry-chain/implementation-plan.md

-- ── industry_chains ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "industry_chains" (
    "id"         TEXT NOT NULL,
    "topic"      VARCHAR(300) NOT NULL,
    "status"     VARCHAR(20) NOT NULL DEFAULT 'PLANNING',
    "owner_id"   TEXT NOT NULL,
    "mission_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "industry_chains_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "industry_chains_owner_id_idx" ON "industry_chains" ("owner_id");
CREATE INDEX IF NOT EXISTS "industry_chains_status_idx" ON "industry_chains" ("status");

-- ── industry_entities ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "industry_entities" (
    "id"                 TEXT NOT NULL,
    "chain_id"           TEXT NOT NULL,
    "name"               VARCHAR(300) NOT NULL,
    "type"               VARCHAR(20) NOT NULL,
    "cik"                VARCHAR(10),
    "segment"            VARCHAR(200),
    "description"        TEXT,
    "source_refs"        JSONB,
    "source_fingerprint" VARCHAR(128),
    "version"            INTEGER NOT NULL DEFAULT 1,
    "last_refreshed_at"  TIMESTAMP(3),
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "industry_entities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "industry_entities_chain_id_idx" ON "industry_entities" ("chain_id");
CREATE INDEX IF NOT EXISTS "industry_entities_cik_idx" ON "industry_entities" ("cik");

-- ── industry_relations ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "industry_relations" (
    "id"            TEXT NOT NULL,
    "chain_id"      TEXT NOT NULL,
    "source_id"     TEXT NOT NULL,
    "target_id"     TEXT NOT NULL,
    "relation_type" VARCHAR(30) NOT NULL,
    "weight"        DOUBLE PRECISION,
    "evidence"      TEXT,
    "valid_from"    TIMESTAMP(3),
    "valid_to"      TIMESTAMP(3),
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "industry_relations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "industry_relations_chain_id_idx" ON "industry_relations" ("chain_id");
CREATE INDEX IF NOT EXISTS "industry_relations_source_id_idx" ON "industry_relations" ("source_id");
CREATE INDEX IF NOT EXISTS "industry_relations_target_id_idx" ON "industry_relations" ("target_id");
-- M8：防增量刷新产生重复边
CREATE UNIQUE INDEX IF NOT EXISTS "industry_relations_chain_src_tgt_type_key"
    ON "industry_relations" ("chain_id", "source_id", "target_id", "relation_type");

-- ── Foreign Keys（DO 块 + 异常吞没：仅 FK 幂等，非 ALTER TYPE，安全）─────────
DO $$ BEGIN
    ALTER TABLE "industry_entities" ADD CONSTRAINT "industry_entities_chain_id_fkey"
        FOREIGN KEY ("chain_id") REFERENCES "industry_chains"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "industry_relations" ADD CONSTRAINT "industry_relations_chain_id_fkey"
        FOREIGN KEY ("chain_id") REFERENCES "industry_chains"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "industry_relations" ADD CONSTRAINT "industry_relations_source_id_fkey"
        FOREIGN KEY ("source_id") REFERENCES "industry_entities"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "industry_relations" ADD CONSTRAINT "industry_relations_target_id_fkey"
        FOREIGN KEY ("target_id") REFERENCES "industry_entities"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
