-- 2026-05-10 §1: PR-1 auto-ingest after raw refresh
--
-- Three new fields on wiki_knowledge_base_configs to drive the Karpathy
-- "compounding" loop. Defaults chosen so existing rows (and rows lazily
-- created on toggleWikiEnabled) opt in automatically:
--
--   auto_ingest_enabled          = true
--   auto_ingest_daily_budget_calls = 20  (per-KB ingest LLM calls per day)
--   auto_ingest_debounce_seconds = 300   (5-min coalescing window)
--
-- The auto-ingest scheduler still produces a PENDING WikiDiff (governance
-- preserved). Auto-apply is intentionally NOT done — multi-tenant SaaS keeps
-- the user in the review loop.

ALTER TABLE "wiki_knowledge_base_configs"
  ADD COLUMN IF NOT EXISTS "auto_ingest_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "auto_ingest_daily_budget_calls" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS "auto_ingest_debounce_seconds" INTEGER NOT NULL DEFAULT 300;
