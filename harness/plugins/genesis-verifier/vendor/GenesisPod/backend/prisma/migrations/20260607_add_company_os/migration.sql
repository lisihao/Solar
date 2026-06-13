-- Migration: 20260607_add_company_os
-- Company OS（一人公司操作系统）— CompanyProfile / CompanyHiredAgent / CompanyTeam /
-- CompanyTeamMember / CompanyWorkflow 五张表。
-- Idempotent (IF NOT EXISTS); hand-written, never via prisma migrate dev.

-- ── company_profiles ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "company_profiles" (
  "id"                   TEXT        NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "user_id"              TEXT        NOT NULL,
  "name"                 TEXT        NOT NULL,
  "ceo_hired_agent_id"   TEXT,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "company_profiles_user_id_key" UNIQUE ("user_id")
);

-- ── company_hired_agents ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "company_hired_agents" (
  "id"            TEXT        NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "user_id"       TEXT        NOT NULL,
  "listing_id"    TEXT        NOT NULL,
  "name"          TEXT        NOT NULL,
  "role"          TEXT        NOT NULL,
  "models"        TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "auto_fallback" BOOLEAN     NOT NULL DEFAULT TRUE,
  "skill_ids"     TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "tool_ids"      TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_hired_agents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "company_hired_agents_user_id_idx"
  ON "company_hired_agents" ("user_id");

-- ── company_teams ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "company_teams" (
  "id"          TEXT        NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "user_id"     TEXT        NOT NULL,
  "name"        TEXT        NOT NULL,
  "leader_id"   TEXT,
  "workflow_id" TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_teams_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "company_teams_user_id_idx"
  ON "company_teams" ("user_id");

-- ── company_team_members ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "company_team_members" (
  "id"              TEXT        NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "team_id"         TEXT        NOT NULL,
  "hired_agent_id"  TEXT        NOT NULL,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_team_members_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "company_team_members_team_id_hired_agent_id_key" UNIQUE ("team_id", "hired_agent_id")
);

CREATE INDEX IF NOT EXISTS "company_team_members_team_id_idx"
  ON "company_team_members" ("team_id");

-- ── company_workflows ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "company_workflows" (
  "id"                TEXT        NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "user_id"           TEXT        NOT NULL,
  "name"              TEXT        NOT NULL,
  "category"          TEXT        NOT NULL,
  "stages"            TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "team_size"         INTEGER     NOT NULL DEFAULT 3,
  "roles"             TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "origin"            TEXT        NOT NULL,
  "source_listing_id" TEXT,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_workflows_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "company_workflows_user_id_idx"
  ON "company_workflows" ("user_id");

-- ── Foreign Key: company_team_members → company_teams (onDelete Cascade) ──────
DO $$ BEGIN
  ALTER TABLE "company_team_members" ADD CONSTRAINT "company_team_members_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "company_teams"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
