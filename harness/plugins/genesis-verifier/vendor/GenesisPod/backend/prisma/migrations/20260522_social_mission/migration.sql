-- AI Social Publish Mission（W4 Agent Team）
--
-- 创建 social_missions 表，承载 SocialPublishMission 12-stage pipeline 的
-- mission lifecycle / trajectory 持久化（替代 SocialMissionStore in-memory
-- map），让 mission 跨 pod restart 不丢、trajectory 可查、retry/cascade rerun
-- 有真实数据基础。
--
-- 不引入新 enum：status / depth / budgetProfile / language 用 VARCHAR 存常量
-- 字符串，与 AgentPlaygroundMission 同模式（避免 enum 改值需迁移）。

CREATE TABLE "social_missions" (
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
  -- ★ C4/G11:social 实测耗时,直接建 canonical 新列名(原 wall_time_ms 二义)。
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
  "heartbeat_at"         TIMESTAMP(3),

  -- 2026-05-17 hotfix: 原写 REFERENCES "User"("id") 错误（Prisma model User
  -- 配 @@map("users")，真实表名是 `users`），prod 跑 migration 报
  -- `relation "User" does not exist` 失败 → 被 deploy-migrations.ts
  -- 自动 resolve-as-applied 吞掉。20260524_ensure_social_missions_table
  -- 用 IF NOT EXISTS 幂等补救。
  CONSTRAINT "social_missions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- Round-3 Reviewer A P1: content_id 引用 social_contents.id，删 content 级联清 mission
  CONSTRAINT "social_missions_content_id_fkey"
    FOREIGN KEY ("content_id") REFERENCES "social_contents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "social_missions_user_id_started_at_idx"
  ON "social_missions"("user_id", "started_at" DESC);

CREATE INDEX "social_missions_status_idx"
  ON "social_missions"("status");

CREATE INDEX "social_missions_status_heartbeat_at_idx"
  ON "social_missions"("status", "heartbeat_at");

CREATE INDEX "social_missions_content_id_idx"
  ON "social_missions"("content_id");
