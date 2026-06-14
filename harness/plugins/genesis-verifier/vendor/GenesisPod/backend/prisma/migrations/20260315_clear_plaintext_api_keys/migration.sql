-- Clear plaintext API keys from ai_models table
-- All models have been migrated to Secret Manager (secret_key column)
-- The api_key column contained stale/expired plaintext keys that should not be used
--
-- Safety: Only clears api_key where secret_key is already configured
-- This ensures no model loses API key access

UPDATE ai_models
SET api_key = NULL,
    updated_at = NOW()
WHERE api_key IS NOT NULL
  AND secret_key IS NOT NULL
  AND secret_key != '';
