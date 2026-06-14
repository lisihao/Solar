-- Migration: 20260607_playground_mission_graph
-- Creates the playground_mission_graphs table for mission knowledge-graph artifacts.
-- One row per mission (UNIQUE on mission_id). Status, graph JSON, analyses JSON, timestamps.

CREATE TABLE IF NOT EXISTS "playground_mission_graphs" (
  "id"           TEXT        NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "mission_id"   TEXT        NOT NULL,
  "owner_id"     TEXT        NOT NULL,
  "status"       VARCHAR(20) NOT NULL DEFAULT 'NONE',
  "graph"        JSONB       NOT NULL DEFAULT '{}',
  "analyses"     JSONB       NOT NULL DEFAULT '{}',
  "generated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "playground_mission_graphs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "playground_mission_graphs_mission_id_key" UNIQUE ("mission_id")
);

CREATE INDEX IF NOT EXISTS "playground_mission_graphs_mission_id_idx"
  ON "playground_mission_graphs" ("mission_id");

CREATE INDEX IF NOT EXISTS "playground_mission_graphs_owner_id_idx"
  ON "playground_mission_graphs" ("owner_id");
