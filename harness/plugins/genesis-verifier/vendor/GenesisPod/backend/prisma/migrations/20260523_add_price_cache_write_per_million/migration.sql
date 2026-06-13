-- Add price_cache_write_per_million column to ai_models table
-- Required for accurate Anthropic prompt-cache WRITE token cost accounting.
-- Anthropic charges ~3.75x input price per 1M cache-write tokens (cache creation fee).
-- Admins should populate this column for all Anthropic models.
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "price_cache_write_per_million" DECIMAL(10, 4);
