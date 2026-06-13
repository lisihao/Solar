-- 2026-05-12 §P2: multi-pass ingest config + ingest draft checkpoint table
--
-- Adds the WikiIngestPassMode enum, five new tunables on
-- wiki_knowledge_base_configs, and the wiki_ingest_drafts checkpoint table
-- that backs partial-progress recovery during the section-fill pass.
--
-- NOTE on `DO $$ ... EXCEPTION WHEN duplicate_object` wrapper around CREATE
-- TYPE: PostgreSQL does NOT support `CREATE TYPE ... IF NOT EXISTS`, so the
-- block below is the only safe re-runnable form. CLAUDE.md L566 only forbids
-- this pattern around `ALTER TYPE` (where it breaks `migrate deploy` because
-- ALTER TYPE ADD VALUE cannot run inside a subtransaction). CREATE TYPE has
-- no such restriction.

-- 1. WikiIngestPassMode enum
DO $$ BEGIN
  CREATE TYPE "WikiIngestPassMode" AS ENUM ('SINGLE', 'MULTI');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Five new tunables on wiki_knowledge_base_configs
--   - ingest_pass_mode: default SINGLE (back-compat); KB-create service will
--     opt new KBs into MULTI in a later commit.
--   - ingest_section_concurrency: section-fill pool size (default 3).
--   - ingest_section_failure_tolerance_ratio: 0.2 → 6 of 30 pages may fail.
--   - ingest_outline_max_pages: hard cap N for outline pass (default 30).
--   - auto_ingest_daily_chat_call_budget: separates chat-completion budget
--     from ingest budget (BLOCKER #4 — multi-pass ingest now issues N+2
--     LLM calls per cycle, so the two meters must not collide).
ALTER TABLE "wiki_knowledge_base_configs"
  ADD COLUMN IF NOT EXISTS "ingest_pass_mode" "WikiIngestPassMode" NOT NULL DEFAULT 'SINGLE',
  ADD COLUMN IF NOT EXISTS "ingest_section_concurrency" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "ingest_section_failure_tolerance_ratio" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
  ADD COLUMN IF NOT EXISTS "ingest_outline_max_pages" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "auto_ingest_daily_chat_call_budget" INTEGER NOT NULL DEFAULT 50;

-- 3. Section-fill partial-progress checkpoint table
--   - Upserted per successful page during section-fill so a crash mid-pass
--     (or a later cross-link failure) does not waste the pages already done.
--   - Unique (diff_session_id, page_slug, locale) prevents retry double-fill.
--   - 24h TTL cron reaps rows; FK cascade ensures KB delete sweeps drafts.
CREATE TABLE IF NOT EXISTS "wiki_ingest_drafts" (
  "id"                TEXT PRIMARY KEY,
  "knowledge_base_id" TEXT NOT NULL,
  "diff_session_id"   TEXT NOT NULL,
  "page_slug"         VARCHAR(200) NOT NULL,
  "locale"            VARCHAR(8) NOT NULL DEFAULT 'zh',
  "body"              JSONB NOT NULL,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wiki_ingest_drafts_knowledge_base_id_fkey"
    FOREIGN KEY ("knowledge_base_id")
    REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "wiki_ingest_drafts_session_slug_locale_unique"
  ON "wiki_ingest_drafts" ("diff_session_id", "page_slug", "locale");

CREATE INDEX IF NOT EXISTS "wiki_ingest_drafts_kb_created_idx"
  ON "wiki_ingest_drafts" ("knowledge_base_id", "created_at");
