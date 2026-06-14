-- AI 前瞻多主题化：新增 foresight_topics，全域挂 topic_id
-- 回填策略：已有卡片的用户自动获得「下一代算力底座」主题（P0 种子数据归属）

CREATE TABLE IF NOT EXISTS "foresight_topics" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" TEXT,
  "layers" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "foresight_topics_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "foresight_topics_user_id_idx" ON "foresight_topics"("user_id");

-- 1) 加可空列
ALTER TABLE "foresight_cards"       ADD COLUMN IF NOT EXISTS "topic_id" TEXT;
ALTER TABLE "foresight_edges"       ADD COLUMN IF NOT EXISTS "topic_id" TEXT;
ALTER TABLE "foresight_signals"     ADD COLUMN IF NOT EXISTS "topic_id" TEXT;
ALTER TABLE "foresight_conclusions" ADD COLUMN IF NOT EXISTS "topic_id" TEXT;

-- 2) 回填：为每个已有卡片的用户建默认主题（算力底座六层栈本体）
INSERT INTO "foresight_topics" ("id", "user_id", "name", "description", "layers", "updated_at")
SELECT
  gen_random_uuid()::text,
  u.user_id,
  '下一代算力底座',
  '2028–2030 算力底座判断资产（P0 种子）',
  '[{"id":"L0","name":"业务负载","en":"WORKLOAD"},{"id":"L1","name":"模型架构","en":"MODEL ARCH"},{"id":"L2","name":"系统软件","en":"SYSTEM SW"},{"id":"L3","name":"系统级硬件","en":"SYSTEMS"},{"id":"L4","name":"芯片","en":"SILICON"},{"id":"L5","name":"物理底座","en":"PHYSICAL"}]'::jsonb,
  CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "user_id" FROM "foresight_cards" WHERE "topic_id" IS NULL) u;

UPDATE "foresight_cards" c SET "topic_id" = t."id"
  FROM "foresight_topics" t
  WHERE c."topic_id" IS NULL AND t."user_id" = c."user_id" AND t."name" = '下一代算力底座';
UPDATE "foresight_edges" e SET "topic_id" = t."id"
  FROM "foresight_topics" t
  WHERE e."topic_id" IS NULL AND t."user_id" = e."user_id" AND t."name" = '下一代算力底座';
UPDATE "foresight_signals" s SET "topic_id" = t."id"
  FROM "foresight_topics" t
  WHERE s."topic_id" IS NULL AND t."user_id" = s."user_id" AND t."name" = '下一代算力底座';
UPDATE "foresight_conclusions" cc SET "topic_id" = t."id"
  FROM "foresight_topics" t
  WHERE cc."topic_id" IS NULL AND t."user_id" = cc."user_id" AND t."name" = '下一代算力底座';

-- 3) 收紧为 NOT NULL + 外键 + 约束迁移
ALTER TABLE "foresight_cards"       ALTER COLUMN "topic_id" SET NOT NULL;
ALTER TABLE "foresight_edges"       ALTER COLUMN "topic_id" SET NOT NULL;
ALTER TABLE "foresight_signals"     ALTER COLUMN "topic_id" SET NOT NULL;
ALTER TABLE "foresight_conclusions" ALTER COLUMN "topic_id" SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE "foresight_cards" ADD CONSTRAINT "foresight_cards_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "foresight_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "foresight_edges" ADD CONSTRAINT "foresight_edges_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "foresight_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "foresight_signals" ADD CONSTRAINT "foresight_signals_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "foresight_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "foresight_conclusions" ADD CONSTRAINT "foresight_conclusions_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "foresight_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 唯一性从 user 级迁到 topic 级（cardKey / conclKey 主题内唯一）
DROP INDEX IF EXISTS "foresight_cards_user_id_card_key_key";
CREATE UNIQUE INDEX IF NOT EXISTS "foresight_cards_topic_id_card_key_key" ON "foresight_cards"("topic_id", "card_key");
DROP INDEX IF EXISTS "foresight_conclusions_user_id_concl_key_key";
CREATE UNIQUE INDEX IF NOT EXISTS "foresight_conclusions_topic_id_concl_key_key" ON "foresight_conclusions"("topic_id", "concl_key");

CREATE INDEX IF NOT EXISTS "foresight_cards_topic_id_idx" ON "foresight_cards"("topic_id");
CREATE INDEX IF NOT EXISTS "foresight_edges_topic_id_idx" ON "foresight_edges"("topic_id");
CREATE INDEX IF NOT EXISTS "foresight_signals_topic_id_status_idx" ON "foresight_signals"("topic_id", "status");
CREATE INDEX IF NOT EXISTS "foresight_conclusions_topic_id_idx" ON "foresight_conclusions"("topic_id");
