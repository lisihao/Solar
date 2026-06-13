-- 2026-05-17 hotfix: ensure social_missions 表存在（W4 SocialMission pipeline）
--
-- 真根因：原 `20260522_social_mission/migration.sql` SQL 写错引用表名
--   `REFERENCES "User"("id")` —— prod DB 实际表名是 `users`（小写复数，
--   Prisma model `User @@map("users")`）。执行时 PostgreSQL 报
--   `relation "User" does not exist`，migration 留在 `_prisma_migrations.
--   finished_at IS NULL` 状态。
--
-- 二次伤害：下一次 deploy 的 `deploy-migrations.ts` Step 2 把它当 "failed
-- migration" 自动 `prisma migrate resolve --applied`，只标记不执行 → 表
-- 永远不会被创建。用户在生产 /ai-social 深度发布报 `table public.
-- social_missions does not exist` 即此根因。
--
-- 本 migration 用 `IF NOT EXISTS` 幂等创建 + 引用正确表名 `users`：
--   - 表已存在 → 全部 no-op，安全跳过
--   - 表不存在 → 创建 + 索引 + FK，FK 引用 `users`（小写）
--
-- 配套修：原 `20260522_social_mission/migration.sql` 的 inline FK 引用也
-- 已改为 `users`，未来 fresh DB 跑迁移不再撞同样的坑。

CREATE TABLE IF NOT EXISTS "social_missions" (
  "id"                   TEXT NOT NULL PRIMARY KEY,
  "user_id"              TEXT NOT NULL,
  "workspace_id"         TEXT,

  -- 输入
  "content_id"           TEXT NOT NULL,
  "platforms"            TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "connection_ids"       JSONB NOT NULL DEFAULT '{}'::JSONB,
  "depth"                VARCHAR(20) NOT NULL,
  "budget_profile"       VARCHAR(20) NOT NULL,
  "language"             VARCHAR(20) NOT NULL,
  "max_credits"          INTEGER NOT NULL DEFAULT 20,

  -- 状态
  "status"               VARCHAR(20) NOT NULL,
  "started_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at"         TIMESTAMP(3),
  -- ★ C4/G11:建表分支也只产 canonical 新列,杜绝单路径切换后从建表路径重新引入旧语义列。
  "elapsed_wall_time_ms" INTEGER,

  -- 完成时填充
  "tokens_used"          BIGINT,
  "cost_usd"             DOUBLE PRECISION,
  "error_message"        TEXT,

  -- trajectory（off-load 友好）
  "trajectory"           JSONB,
  "trajectory_uri"       TEXT,
  "trajectory_size"      INTEGER,

  -- pod-aware lifecycle
  "last_completed_stage" INTEGER,
  "pod_id"               VARCHAR(120),
  "heartbeat_at"         TIMESTAMP(3)
);

-- FK：补加（PostgreSQL 没有 ADD CONSTRAINT IF NOT EXISTS，用 DO 块判存在性）
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_missions_user_id_fkey'
  ) THEN
    ALTER TABLE "social_missions"
      ADD CONSTRAINT "social_missions_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_missions_content_id_fkey'
  ) THEN
    ALTER TABLE "social_missions"
      ADD CONSTRAINT "social_missions_content_id_fkey"
      FOREIGN KEY ("content_id") REFERENCES "social_contents"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "social_missions_user_id_started_at_idx"
  ON "social_missions"("user_id", "started_at" DESC);

CREATE INDEX IF NOT EXISTS "social_missions_status_idx"
  ON "social_missions"("status");

CREATE INDEX IF NOT EXISTS "social_missions_status_heartbeat_at_idx"
  ON "social_missions"("status", "heartbeat_at");

CREATE INDEX IF NOT EXISTS "social_missions_content_id_idx"
  ON "social_missions"("content_id");
