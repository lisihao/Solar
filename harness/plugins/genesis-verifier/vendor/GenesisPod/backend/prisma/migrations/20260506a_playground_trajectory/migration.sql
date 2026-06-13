-- ★ P0-D 完整版 (2026-05-06): playground trajectory 持久化
--
-- 目的：rerun incremental 模式下让 dispatcher 能从 DB 复用 researcher findings + chapter drafts，
-- 跳过 S3-S8 重做（之前事件流只存 findingsCount + summary 不存完整 findings 数组）。
--
-- 两张新表：
--   agent_playground_research_results — per-(mission, dim, retryLabel) researcher 完整产物
--   agent_playground_chapter_drafts   — per-(mission, dim, chapterIndex) chapter 完整产物 + grade
--
-- 复合 unique 索引保证 upsert 幂等；mission delete cascade 自动清理。

CREATE TABLE IF NOT EXISTS "agent_playground_research_results" (
    "id"           TEXT NOT NULL DEFAULT gen_random_uuid(),
    "mission_id"   TEXT NOT NULL,
    "dimension"    VARCHAR(200) NOT NULL,
    "retry_label"  VARCHAR(60),
    "findings"     JSONB NOT NULL,
    "summary"      TEXT NOT NULL,
    "state"        VARCHAR(20) NOT NULL,
    "iterations"   INTEGER,
    "wall_time_ms" INTEGER,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "agent_playground_research_results_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "agent_playground_research_results_mission_id_idx"
    ON "agent_playground_research_results" ("mission_id");

CREATE UNIQUE INDEX IF NOT EXISTS "agent_playground_research_results_mid_dim_retry_uniq"
    ON "agent_playground_research_results" ("mission_id", "dimension", "retry_label");

-- ★ 修 (2026-05-06): PostgreSQL < 16 不支持 ADD CONSTRAINT IF NOT EXISTS，
--   改用 DO block 通过 pg_constraint 查询去重（兼容 PG 9.6+，避免 prisma migrate
--   deploy 静默 applied_steps_count=0）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_playground_research_results_mission_id_fkey'
    ) THEN
        ALTER TABLE "agent_playground_research_results"
            ADD CONSTRAINT "agent_playground_research_results_mission_id_fkey"
            FOREIGN KEY ("mission_id") REFERENCES "agent_playground_missions"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "agent_playground_chapter_drafts" (
    "id"            TEXT NOT NULL DEFAULT gen_random_uuid(),
    "mission_id"    TEXT NOT NULL,
    "dimension"     VARCHAR(200) NOT NULL,
    "chapter_index" INTEGER NOT NULL,
    "heading"       VARCHAR(500) NOT NULL,
    "thesis"        TEXT,
    "content"       TEXT NOT NULL,
    "status"        VARCHAR(30) NOT NULL,
    "score"         INTEGER,
    "critique"      TEXT,
    "attempts"      INTEGER NOT NULL DEFAULT 1,
    "word_count"    INTEGER,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "agent_playground_chapter_drafts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "agent_playground_chapter_drafts_mission_id_idx"
    ON "agent_playground_chapter_drafts" ("mission_id");

CREATE UNIQUE INDEX IF NOT EXISTS "agent_playground_chapter_drafts_mid_dim_idx_uniq"
    ON "agent_playground_chapter_drafts" ("mission_id", "dimension", "chapter_index");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_playground_chapter_drafts_mission_id_fkey'
    ) THEN
        ALTER TABLE "agent_playground_chapter_drafts"
            ADD CONSTRAINT "agent_playground_chapter_drafts_mission_id_fkey"
            FOREIGN KEY ("mission_id") REFERENCES "agent_playground_missions"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
