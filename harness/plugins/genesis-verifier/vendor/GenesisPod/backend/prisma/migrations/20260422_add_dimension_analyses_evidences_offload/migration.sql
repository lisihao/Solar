-- dimension_analyses.summary (121 MB) 和 topic_evidences.snippet (78 MB) off-load 外链列。
-- 与 topic_reports 同模式：URI + size。幂等。

ALTER TABLE "dimension_analyses"
  ADD COLUMN IF NOT EXISTS "summary_uri" TEXT,
  ADD COLUMN IF NOT EXISTS "summary_size" INTEGER;

ALTER TABLE "topic_evidences"
  ADD COLUMN IF NOT EXISTS "snippet_uri" TEXT,
  ADD COLUMN IF NOT EXISTS "snippet_size" INTEGER;
