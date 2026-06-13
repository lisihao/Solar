-- P3 commit 2 (2026-05-12 multi-pass-and-locale consensus, BLOCKER C3):
-- Build the locale-aware unique index CONCURRENTLY so that production
-- traffic continues to run while the index is built. The actual swap
-- of the unique constraint (DROP old + ALTER ... ADD CONSTRAINT ...
-- USING INDEX) lands in P3 commit 3.
--
-- IMPORTANT: This file MUST contain exactly one statement. PostgreSQL
-- forbids CREATE INDEX CONCURRENTLY inside a transaction block, and
-- `prisma migrate deploy` issues each migration file as its own
-- statement batch — putting any other statement here would force the
-- runner to wrap them together in BEGIN/COMMIT and trigger:
--   ERROR: CREATE INDEX CONCURRENTLY cannot run inside a transaction block
-- See backend/prisma/migrations/20260310_optimize_research_mission_index/
-- and 20260508d_add_ask_room_tables/ for the same pattern.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "wiki_pages_kb_slug_locale_uniq_idx"
  ON "wiki_pages" ("knowledge_base_id", "slug", "locale");
