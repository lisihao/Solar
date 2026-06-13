-- Fix 1: retryLabel NULL → empty string (UNIQUE index ambiguity fix)
-- Multiple NULL values are allowed in a UNIQUE index in PostgreSQL,
-- so (missionId, dimension, NULL) could produce duplicate rows.
-- Migrating all NULLs to '' and setting NOT NULL + DEFAULT '' resolves this.
UPDATE agent_playground_research_results
SET retry_label = ''
WHERE retry_label IS NULL;

ALTER TABLE agent_playground_research_results
  ALTER COLUMN retry_label SET DEFAULT '',
  ALTER COLUMN retry_label SET NOT NULL;

-- Fix 2 (P1): tokensUsed Int → BigInt on agent_playground_missions
-- Large missions can exceed 2^31 - 1 tokens, causing silent overflow.
ALTER TABLE agent_playground_missions
  ALTER COLUMN tokens_used TYPE bigint;
