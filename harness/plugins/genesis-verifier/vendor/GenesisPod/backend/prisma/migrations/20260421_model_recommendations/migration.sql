-- ============================================================
-- 一键 AI 配置推荐矩阵（long-term 可编辑）
-- provider × modelType -> regex patterns[] 按优先级排序
-- 首次启动由后端 seed 默认值；管理员可后续编辑
-- ============================================================

CREATE TABLE IF NOT EXISTS "model_recommendations" (
  "id" TEXT NOT NULL,
  "provider" VARCHAR(50) NOT NULL,
  "model_type" "AIModelType" NOT NULL,
  "patterns" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "priority" INTEGER NOT NULL DEFAULT 50,
  "note" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "model_recommendations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "model_recommendations_provider_model_type_key"
  ON "model_recommendations"("provider", "model_type");

CREATE INDEX IF NOT EXISTS "model_recommendations_provider_idx"
  ON "model_recommendations"("provider");
