-- P3 commit 3 (2026-05-12 multi-pass-and-locale consensus, BLOCKER C3):
-- Swap WikiPage unique constraint from the legacy (knowledge_base_id, slug)
-- pair to the locale-aware triple (knowledge_base_id, slug, locale).
--
-- This relies on `wiki_pages_kb_slug_locale_uniq_idx` having been built
-- in P3 commit 2 (CONCURRENTLY). The `ALTER ... ADD CONSTRAINT ...
-- USING INDEX` form attaches the already-built index as the new
-- constraint without acquiring an AccessExclusiveLock for a fresh
-- index build — PostgreSQL only needs a brief ShareUpdateExclusiveLock
-- to rename the index and mark it as the constraint backing.
--
-- Forward-only and idempotent. The legacy `(kb, slug)` unique key is
-- dropped at the same time; once this migration is applied, the only
-- uniqueness invariant Prisma Client knows about is the triple.

-- Drop the legacy unique constraint (auto-named by Prisma when the
-- @@unique was first added in the initial wiki migration).
ALTER TABLE "wiki_pages"
  DROP CONSTRAINT IF EXISTS "wiki_pages_knowledge_base_id_slug_key";

-- Promote the CONCURRENTLY-built index to the new unique constraint.
-- The constraint name matches what Prisma will look for from the
-- @@unique([knowledgeBaseId, slug, locale]) annotation.
ALTER TABLE "wiki_pages"
  ADD CONSTRAINT "wiki_pages_knowledge_base_id_slug_locale_key"
  UNIQUE USING INDEX "wiki_pages_kb_slug_locale_uniq_idx";
