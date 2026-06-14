-- Radar mission lifecycle 改造（彻底重构为 ai-harness mission pipeline 框架后）
-- 2026-05-16
--
-- 改动：
--   1) radar_runs.status: enum RadarRunStatus → VarChar(20)
--      新值域: running / completed / failed / cancelled / rejected
--      老值映射: PENDING→running, RUNNING→running, COMPLETED→completed,
--                FAILED→failed, CANCELLED→cancelled
--   2) 新增字段供 mission runtime shell 框架使用:
--      user_id (NOT NULL backfill from topic.userId)
--      workspace_id (NULL)
--      heartbeat_at / pod_id / last_completed_stage (mission resume / liveness)
--      wall_time_ms / max_credits / payload
--   3) 索引: (status, heartbeat_at) for liveness-guard sweep
--
-- 幂等可重跑：CREATE INDEX IF NOT EXISTS / ADD COLUMN IF NOT EXISTS。
-- status 字段类型改 VarChar 用条件判断：判 information_schema 当前是 USER-DEFINED 才改。

BEGIN;

-- 1) 字段加列（幂等）
ALTER TABLE "radar_runs" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
ALTER TABLE "radar_runs" ADD COLUMN IF NOT EXISTS "workspace_id" TEXT;
ALTER TABLE "radar_runs" ADD COLUMN IF NOT EXISTS "heartbeat_at" TIMESTAMP(3);
ALTER TABLE "radar_runs" ADD COLUMN IF NOT EXISTS "pod_id" VARCHAR(64);
ALTER TABLE "radar_runs" ADD COLUMN IF NOT EXISTS "last_completed_stage" INTEGER;
-- C4/G5 修正(2026-05-22):此列原名 wall_time_ms,C4 已改名 wall_time_cap_ms(配置上限)。
-- fresh replay 顺序重放时本迁移先于消费方,直接 ensure 新列名,杜绝重新制造旧语义列。
ALTER TABLE "radar_runs" ADD COLUMN IF NOT EXISTS "wall_time_cap_ms" INTEGER;
ALTER TABLE "radar_runs" ADD COLUMN IF NOT EXISTS "max_credits" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "radar_runs" ADD COLUMN IF NOT EXISTS "payload" JSONB;

-- 2) 回填 user_id（从 radar_topics 关联）后置 NOT NULL
UPDATE "radar_runs" r
SET "user_id" = t."user_id"
FROM "radar_topics" t
WHERE r."topic_id" = t."id" AND r."user_id" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'radar_runs' AND column_name = 'user_id' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE "radar_runs" ALTER COLUMN "user_id" SET NOT NULL;
  END IF;
END $$;

-- 3) status 字段类型从 enum 改 VarChar(20)
DO $$
DECLARE
  current_type TEXT;
BEGIN
  SELECT data_type INTO current_type
  FROM information_schema.columns
  WHERE table_name = 'radar_runs' AND column_name = 'status';

  IF current_type = 'USER-DEFINED' THEN
    -- 先去默认值（旧默认是 PENDING enum 字面量）
    ALTER TABLE "radar_runs" ALTER COLUMN "status" DROP DEFAULT;
    -- 改类型 + 映射
    ALTER TABLE "radar_runs"
      ALTER COLUMN "status" TYPE VARCHAR(20)
      USING CASE "status"::TEXT
        WHEN 'PENDING'   THEN 'running'
        WHEN 'RUNNING'   THEN 'running'
        WHEN 'COMPLETED' THEN 'completed'
        WHEN 'FAILED'    THEN 'failed'
        WHEN 'CANCELLED' THEN 'cancelled'
        ELSE 'failed'
      END;
  END IF;
END $$;

-- 4) liveness guard 扫描索引
CREATE INDEX IF NOT EXISTS "radar_runs_status_heartbeat_at_idx"
  ON "radar_runs" ("status", "heartbeat_at");

COMMIT;
