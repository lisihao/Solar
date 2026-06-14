-- Rename billing module_type literal "agent-playground" -> "playground".
--
-- Context: the agent-playground AI app dir / WS namespace / event namespace /
-- billing moduleType were unified to "playground" (MECE naming-compliance wave).
-- The DB tables themselves (agent_playground_missions etc.) are NOT renamed;
-- only the billing module_type string value recorded in credit ledgers / rules.
--
-- Two tables carry module_type:
--   credit_transactions.module_type (nullable, historical usage rows)
--   credit_rules.module_type        (seed/config rows)

UPDATE "credit_transactions"
SET "module_type" = 'playground'
WHERE "module_type" = 'agent-playground';

UPDATE "credit_rules"
SET "module_type" = 'playground'
WHERE "module_type" = 'agent-playground';
