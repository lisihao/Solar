-- Migration: 20260607_add_company_missions
-- Company OS W3: CompanyMission 表（团队任务持久化记录）
-- Idempotent (IF NOT EXISTS); hand-written, never via prisma migrate dev.

CREATE TABLE IF NOT EXISTS "company_missions" (
  "id"         TEXT         NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "user_id"    TEXT         NOT NULL,
  "team_id"    TEXT         NOT NULL,
  "title"      TEXT         NOT NULL,
  "status"     TEXT         NOT NULL DEFAULT 'queued',
  "progress"   INTEGER      NOT NULL DEFAULT 0,
  "result"     JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_missions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "company_missions_user_id_idx"
  ON "company_missions" ("user_id");

CREATE INDEX IF NOT EXISTS "company_missions_team_id_idx"
  ON "company_missions" ("team_id");
