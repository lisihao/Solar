-- 2026-05-16 AI Radar 模块初始化
-- 新建 5 个表 + 4 个 enum，幂等可重跑（IF NOT EXISTS）。
--
-- RadarTopic   : 用户创建的雷达主题（持续监控对象）
-- RadarSource  : 主题下的具体数据源（X / YouTube / RSS / Custom）
-- RadarItem    : 采集到的单条数据 + AI 评分 + AI 摘要 + entities
-- RadarInsight : 周期性洞察（信号 / 高亮 / 热门实体）
-- RadarRun     : 一次刷新运行记录（pending → running → completed/failed/cancelled）

-- ───────── enums ─────────
DO $$ BEGIN
    CREATE TYPE "RadarTopicStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "RadarSourceType" AS ENUM ('X', 'YOUTUBE', 'RSS', 'CUSTOM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "RadarSourceHealth" AS ENUM ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'FAILING');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "RadarRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "RadarRunTrigger" AS ENUM ('SCHEDULED', 'MANUAL', 'FIRST_RUN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───────── radar_topics ─────────
CREATE TABLE IF NOT EXISTS "radar_topics" (
    "id"           TEXT NOT NULL,
    "user_id"      TEXT NOT NULL,
    "name"         VARCHAR(160) NOT NULL,
    "description"  TEXT,
    "entity_type"  VARCHAR(40),
    "keywords"     JSONB NOT NULL,
    "refresh_cron" VARCHAR(60) NOT NULL DEFAULT '0 */6 * * *',
    "status"       "RadarTopicStatus" NOT NULL DEFAULT 'ACTIVE',
    "next_due_at"  TIMESTAMP(3),
    "last_run_at"  TIMESTAMP(3),
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "radar_topics_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "radar_topics_user_status_idx" ON "radar_topics" ("user_id", "status");
CREATE INDEX IF NOT EXISTS "radar_topics_status_next_due_idx" ON "radar_topics" ("status", "next_due_at");

DO $$ BEGIN
    ALTER TABLE "radar_topics"
        ADD CONSTRAINT "radar_topics_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───────── radar_sources ─────────
CREATE TABLE IF NOT EXISTS "radar_sources" (
    "id"                   TEXT NOT NULL,
    "topic_id"             TEXT NOT NULL,
    "type"                 "RadarSourceType" NOT NULL,
    "identifier"           VARCHAR(500) NOT NULL,
    "label"                VARCHAR(200),
    "config"               JSONB,
    "enabled"              BOOLEAN NOT NULL DEFAULT true,
    "is_ai_recommended"    BOOLEAN NOT NULL DEFAULT false,
    "health"               "RadarSourceHealth" NOT NULL DEFAULT 'UNKNOWN',
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "cooldown_until"       TIMESTAMP(3),
    "last_fetch_at"        TIMESTAMP(3),
    "last_error"           TEXT,
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMP(3) NOT NULL,

    CONSTRAINT "radar_sources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "radar_sources_topic_type_ident_uq"
    ON "radar_sources" ("topic_id", "type", "identifier");
CREATE INDEX IF NOT EXISTS "radar_sources_topic_enabled_idx"
    ON "radar_sources" ("topic_id", "enabled");

DO $$ BEGIN
    ALTER TABLE "radar_sources"
        ADD CONSTRAINT "radar_sources_topic_id_fkey"
        FOREIGN KEY ("topic_id") REFERENCES "radar_topics"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───────── radar_items ─────────
CREATE TABLE IF NOT EXISTS "radar_items" (
    "id"              TEXT NOT NULL,
    "topic_id"        TEXT NOT NULL,
    "source_id"       TEXT NOT NULL,
    "external_id"     VARCHAR(255) NOT NULL,
    "content_hash"    VARCHAR(64) NOT NULL,
    "title"           TEXT,
    "content"         TEXT,
    "author"          VARCHAR(200),
    "author_avatar"   VARCHAR(500),
    "url"             VARCHAR(1000),
    "published_at"    TIMESTAMP(3) NOT NULL,
    "fetched_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw"             JSONB NOT NULL,
    "relevance_score" INTEGER,
    "quality_score"   INTEGER,
    "ai_summary"      TEXT,
    "entities"        JSONB,
    "metrics"         JSONB,
    "accepted"        BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "radar_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "radar_items_topic_external_uq"
    ON "radar_items" ("topic_id", "external_id");
CREATE INDEX IF NOT EXISTS "radar_items_topic_published_idx"
    ON "radar_items" ("topic_id", "published_at" DESC);
CREATE INDEX IF NOT EXISTS "radar_items_topic_relevance_idx"
    ON "radar_items" ("topic_id", "relevance_score" DESC);
CREATE INDEX IF NOT EXISTS "radar_items_topic_accepted_pub_idx"
    ON "radar_items" ("topic_id", "accepted", "published_at" DESC);
CREATE INDEX IF NOT EXISTS "radar_items_content_hash_idx"
    ON "radar_items" ("content_hash");

DO $$ BEGIN
    ALTER TABLE "radar_items"
        ADD CONSTRAINT "radar_items_topic_id_fkey"
        FOREIGN KEY ("topic_id") REFERENCES "radar_topics"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "radar_items"
        ADD CONSTRAINT "radar_items_source_id_fkey"
        FOREIGN KEY ("source_id") REFERENCES "radar_sources"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───────── radar_insights ─────────
CREATE TABLE IF NOT EXISTS "radar_insights" (
    "id"           TEXT NOT NULL,
    "topic_id"     TEXT NOT NULL,
    "run_id"       VARCHAR(40),
    "period_from"  TIMESTAMP(3) NOT NULL,
    "period_to"    TIMESTAMP(3) NOT NULL,
    "summary"      TEXT NOT NULL,
    "highlights"   JSONB NOT NULL,
    "signals"      JSONB NOT NULL,
    "top_entities" JSONB NOT NULL,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "radar_insights_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "radar_insights_topic_period_idx"
    ON "radar_insights" ("topic_id", "period_to" DESC);

DO $$ BEGIN
    ALTER TABLE "radar_insights"
        ADD CONSTRAINT "radar_insights_topic_id_fkey"
        FOREIGN KEY ("topic_id") REFERENCES "radar_topics"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───────── radar_runs ─────────
CREATE TABLE IF NOT EXISTS "radar_runs" (
    "id"           TEXT NOT NULL,
    "topic_id"     TEXT NOT NULL,
    "status"       "RadarRunStatus" NOT NULL DEFAULT 'PENDING',
    "trigger"      "RadarRunTrigger" NOT NULL,
    "started_at"   TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "duration_ms"  INTEGER,
    "metrics"      JSONB,
    "error"        TEXT,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "radar_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "radar_runs_topic_started_idx"
    ON "radar_runs" ("topic_id", "started_at" DESC);
CREATE INDEX IF NOT EXISTS "radar_runs_status_started_idx"
    ON "radar_runs" ("status", "started_at");

DO $$ BEGIN
    ALTER TABLE "radar_runs"
        ADD CONSTRAINT "radar_runs_topic_id_fkey"
        FOREIGN KEY ("topic_id") REFERENCES "radar_topics"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
