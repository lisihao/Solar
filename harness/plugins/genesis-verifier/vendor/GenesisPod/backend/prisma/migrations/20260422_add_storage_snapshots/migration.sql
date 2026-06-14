-- storage_snapshots: DB 体积 + R2 体积时间序列
-- 每天凌晨 cron 采样一次，用于前端趋势图
CREATE TABLE IF NOT EXISTS "storage_snapshots" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "db_total_bytes" BIGINT NOT NULL,
  "r2_total_bytes" BIGINT NOT NULL DEFAULT 0,
  "r2_total_objects" INTEGER NOT NULL DEFAULT 0,
  "offload_fields" JSONB,
  "db_top_tables" JSONB,
  CONSTRAINT "storage_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "storage_snapshots_created_at_idx"
  ON "storage_snapshots"("created_at" DESC);
