-- P3 follow-up (2026-05-12 multi-pass-and-locale consensus, BLOCKER C2):
-- Rename WikiDiff.affected_slugs (raw slug list) → affected_keys (composite
-- `slug:locale` list). The cross-locale concurrent-apply freedom that BLOCKER
-- C2 demands cannot be achieved without re-keying this column: pure-slug
-- collision sets either over-block (false-positive lock on the en locale when
-- only zh is changing) or under-detect (false-negative miss of a real same-
-- (slug, locale) collision). The new shape `<slug>:<locale>` carries enough
-- information for the service layer to do both correctly.
--
-- Forward-only, idempotent, and backward-compatible with PENDING rows from
-- before P3 (which had no locale concept — those slugs are mapped to ':zh',
-- the DEFAULT_WIKI_LOCALE that P3 commit 3 established).
--
-- Steps (split to keep each statement atomic):
--   a) ADD COLUMN affected_keys (nullable so backfill can run);
--   b) Backfill from affected_slugs, suffixing every entry with ':zh'
--      (matches the WikiPage.locale @default('zh') invariant and the
--      DEFAULT_WIKI_LOCALE constant used by wiki-page.service.ts);
--   c) Promote to NOT NULL — at this point every row has a non-null value;
--   d) Drop the legacy affected_slugs column.
--
-- Step (b) only touches `affected_keys IS NULL` rows so a partial replay
-- (a → crash → a) does not double-suffix.

-- a) Add the new column nullable so we can backfill before constraining it.
ALTER TABLE "wiki_diffs"
  ADD COLUMN IF NOT EXISTS "affected_keys" TEXT[];

-- b) Backfill every existing row's affected_slugs values into the new column
--    with the ':zh' suffix. Rows already populated (re-run safety) are
--    skipped. Empty arrays remain empty arrays (PostgreSQL ARRAY() on an
--    empty subquery yields '{}', which is what we want for diffs that
--    persisted with affected_slugs = '{}').
UPDATE "wiki_diffs"
SET "affected_keys" = ARRAY(
  SELECT s || ':zh' FROM unnest("affected_slugs") AS s
)
WHERE "affected_keys" IS NULL;

-- c) All rows now have a non-null affected_keys; lock the invariant.
ALTER TABLE "wiki_diffs"
  ALTER COLUMN "affected_keys" SET NOT NULL;

-- d) Drop the legacy column. Once this migration is applied, Prisma Client
--    no longer knows about affected_slugs and the only collision-detection
--    key the service layer can read is affected_keys.
ALTER TABLE "wiki_diffs"
  DROP COLUMN IF EXISTS "affected_slugs";
