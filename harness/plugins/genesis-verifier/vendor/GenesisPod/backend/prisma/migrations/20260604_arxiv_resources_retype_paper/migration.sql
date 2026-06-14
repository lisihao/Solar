-- Backfill: arXiv preprints ingested via POLICY/BLOG RSS feeds were stamped with
-- the source's category instead of PAPER (rss.service extractResourceData). Re-type
-- any resource whose source_url is an arXiv abstract but isn't already PAPER, so they
-- surface under the 论文/PAPER tab instead of 政策/POLICY etc.
UPDATE "resources"
SET "type" = 'PAPER'
WHERE "source_url" LIKE '%arxiv.org/abs/%'
  AND "type" <> 'PAPER';
