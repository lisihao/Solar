-- 雷达主题：多租户可见性字段（默认私有）
ALTER TABLE "radar_topics"
  ADD COLUMN IF NOT EXISTS "visibility" "ContentVisibility" NOT NULL DEFAULT 'PRIVATE';
