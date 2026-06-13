-- dimension_analyses.data_points JSON off-load：avg 62KB、max 1.3MB、共 ~120MB。
-- 先前加的 summary_uri/summary_size 留着未用（summary 全部 <2KB 不迁）。
ALTER TABLE "dimension_analyses"
  ADD COLUMN IF NOT EXISTS "data_points_uri" TEXT,
  ADD COLUMN IF NOT EXISTS "data_points_size" INTEGER;
