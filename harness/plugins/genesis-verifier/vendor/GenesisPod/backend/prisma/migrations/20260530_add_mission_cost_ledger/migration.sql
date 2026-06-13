-- 2026-05-30 P0 remediation: Agent Playground mission 成本台账（逐 step LLM 用量留痕）
-- AgentPlaygroundMissionCostLedger -> agent_playground_mission_cost_ledger

CREATE TABLE IF NOT EXISTS "agent_playground_mission_cost_ledger" (
  "id"                TEXT NOT NULL,
  "mission_id"        TEXT NOT NULL,
  "user_id"           TEXT NOT NULL,
  "step_id"           VARCHAR(120),
  "role"              VARCHAR(80),
  "model"             VARCHAR(120),
  "prompt_tokens"     INTEGER NOT NULL DEFAULT 0,
  "completion_tokens" INTEGER NOT NULL DEFAULT 0,
  "cost_usd"          DOUBLE PRECISION NOT NULL DEFAULT 0,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_playground_mission_cost_ledger_pkey" PRIMARY KEY ("id")
);

-- FK: mission_id -> agent_playground_missions.id (onDelete: Cascade)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_playground_mission_cost_ledger_mission_id_fkey'
  ) THEN
    ALTER TABLE "agent_playground_mission_cost_ledger"
      ADD CONSTRAINT "agent_playground_mission_cost_ledger_mission_id_fkey"
      FOREIGN KEY ("mission_id") REFERENCES "agent_playground_missions"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "agent_playground_mission_cost_ledger_mission_id_idx" ON "agent_playground_mission_cost_ledger"("mission_id");
CREATE INDEX IF NOT EXISTS "agent_playground_mission_cost_ledger_user_id_idx" ON "agent_playground_mission_cost_ledger"("user_id");
CREATE INDEX IF NOT EXISTS "agent_playground_mission_cost_ledger_created_at_idx" ON "agent_playground_mission_cost_ledger"("created_at" DESC);
