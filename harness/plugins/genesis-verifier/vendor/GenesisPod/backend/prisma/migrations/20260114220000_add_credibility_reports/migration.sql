-- CreateTable: credibility_reports (Phase 2.1)
-- 存储报告的可信度评估结果

CREATE TABLE IF NOT EXISTS "credibility_reports" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "overall_score" DOUBLE PRECISION NOT NULL,
    "source_diversity" DOUBLE PRECISION,
    "evidence_strength" DOUBLE PRECISION,
    "recency_score" DOUBLE PRECISION,
    "bias_assessment" DOUBLE PRECISION,
    "methodology_score" DOUBLE PRECISION,
    "report_text" TEXT,
    "recommendations" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credibility_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "credibility_reports_report_id_key" ON "credibility_reports"("report_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "credibility_reports_report_id_idx" ON "credibility_reports"("report_id");

-- AddForeignKey (only if not exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'credibility_reports_report_id_fkey'
    ) THEN
        ALTER TABLE "credibility_reports" ADD CONSTRAINT "credibility_reports_report_id_fkey"
        FOREIGN KEY ("report_id") REFERENCES "topic_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
