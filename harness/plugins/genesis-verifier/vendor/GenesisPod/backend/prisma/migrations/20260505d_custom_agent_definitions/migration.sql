-- E R4 Phase 2 骨架（PR-E1，2026-05-05）：用户自定义 Agent 定义表
--
-- 5 步向导各步骤数据存 config JSONB；status 状态机 DRAFT/PUBLISHED/ARCHIVED；
-- 控制器 + 前端向导增量在 PR-E2 / PR-E3 补全。

CREATE TABLE IF NOT EXISTS "custom_agent_definitions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "workspace_id" TEXT,
  "slug" VARCHAR(64) NOT NULL,
  "display_name" VARCHAR(128) NOT NULL,
  "description" TEXT,
  "config" JSONB NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "is_enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "custom_agent_definitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "custom_agent_definitions_user_id_slug_key"
  ON "custom_agent_definitions" ("user_id", "slug");

CREATE INDEX IF NOT EXISTS "custom_agent_definitions_user_status_enabled_idx"
  ON "custom_agent_definitions" ("user_id", "status", "is_enabled");

ALTER TABLE "custom_agent_definitions"
  ADD CONSTRAINT "custom_agent_definitions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
