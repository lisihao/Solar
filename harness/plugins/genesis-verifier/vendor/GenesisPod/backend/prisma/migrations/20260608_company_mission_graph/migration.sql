-- Migration: 20260608_company_mission_graph
-- Creates the company_mission_graphs table for company mission knowledge-graph artifacts.
-- Mirrors playground_mission_graphs: one row per mission (UNIQUE on mission_id),
-- status + graph JSON + analyses JSON + timestamps. Built by the shared
-- MissionGraphBuilderService from a company mission's report text.

CREATE TABLE IF NOT EXISTS "company_mission_graphs" (
  "id"           TEXT        NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "mission_id"   TEXT        NOT NULL,
  "owner_id"     TEXT        NOT NULL,
  "status"       VARCHAR(20) NOT NULL DEFAULT 'NONE',
  "graph"        JSONB       NOT NULL DEFAULT '{}',
  "analyses"     JSONB       NOT NULL DEFAULT '{}',
  "generated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "company_mission_graphs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "company_mission_graphs_mission_id_key" UNIQUE ("mission_id")
);

CREATE INDEX IF NOT EXISTS "company_mission_graphs_mission_id_idx"
  ON "company_mission_graphs" ("mission_id");

CREATE INDEX IF NOT EXISTS "company_mission_graphs_owner_id_idx"
  ON "company_mission_graphs" ("owner_id");
