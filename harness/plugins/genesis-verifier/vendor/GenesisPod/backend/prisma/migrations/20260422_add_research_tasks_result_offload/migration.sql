-- research_tasks.result JSON off-load: avg 26KB/行, 1327 rows → 110MB 候选。
ALTER TABLE "research_tasks"
  ADD COLUMN IF NOT EXISTS "result_uri" TEXT,
  ADD COLUMN IF NOT EXISTS "result_size" INTEGER;
