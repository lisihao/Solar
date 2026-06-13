-- P3 commit 1 (2026-05-12 multi-pass-and-locale consensus, BLOCKER C3):
-- WikiPage gains `locale` (default 'zh') + `translation_group_id` (nullable);
-- WikiPageLink gains `to_locale` and rebuilds its PK to include it.
--
-- This migration is forward-only and idempotent. It does NOT swap the
-- WikiPage unique constraint (still ([knowledge_base_id, slug])) — that
-- happens in P3 commit 3 after CONCURRENTLY building the replacement
-- index in P3 commit 2.
--
-- WikiPageLink.to_locale is NOT NULL DEFAULT 'zh':
--   PostgreSQL composite PK with a NULL column treats NULL ≠ NULL for
--   uniqueness, so allowing nulls breaks the (fromPage, toSlug, toLocale)
--   uniqueness invariant. "Any-locale" link semantics will use an
--   application-layer sentinel (e.g. '*') in a follow-up, not NULL.

-- ── WikiPage: new columns + supporting index ─────────────────────────────
ALTER TABLE "wiki_pages"
  ADD COLUMN IF NOT EXISTS "locale" VARCHAR(8) NOT NULL DEFAULT 'zh';

ALTER TABLE "wiki_pages"
  ADD COLUMN IF NOT EXISTS "translation_group_id" TEXT;

CREATE INDEX IF NOT EXISTS "wiki_pages_kb_translation_group_idx"
  ON "wiki_pages" ("knowledge_base_id", "translation_group_id");

-- ── WikiPageLink: PK rebuild (add column → backfill → set NOT NULL → swap PK)
ALTER TABLE "wiki_page_links"
  ADD COLUMN IF NOT EXISTS "to_locale" VARCHAR(8);

UPDATE "wiki_page_links"
   SET "to_locale" = 'zh'
 WHERE "to_locale" IS NULL;

ALTER TABLE "wiki_page_links"
  ALTER COLUMN "to_locale" SET NOT NULL;

ALTER TABLE "wiki_page_links"
  ALTER COLUMN "to_locale" SET DEFAULT 'zh';

ALTER TABLE "wiki_page_links"
  DROP CONSTRAINT IF EXISTS "wiki_page_links_pkey";

ALTER TABLE "wiki_page_links"
  ADD CONSTRAINT "wiki_page_links_pkey"
  PRIMARY KEY ("from_page_id", "to_slug", "to_locale");
