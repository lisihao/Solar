-- ==================== Report Changes (继承式更新标识) ====================

-- 变更类型枚举
CREATE TYPE "ChangeType" AS ENUM ('ADDED', 'MODIFIED', 'DELETED');

-- 注意: AnnotationType 和 AnnotationStatus 枚举已在之前的迁移中创建,这里不重复创建

-- 报告变更记录表
CREATE TABLE "report_changes" (
  "id" TEXT NOT NULL,
  "report_id" TEXT NOT NULL,
  "section_id" TEXT,
  "section_name" TEXT,
  "change_type" "ChangeType" NOT NULL,
  "previous_content" TEXT,
  "current_content" TEXT NOT NULL,
  "start_offset" INTEGER NOT NULL,
  "end_offset" INTEGER NOT NULL,
  "words_diff" INTEGER NOT NULL DEFAULT 0,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "checked_in_at" TIMESTAMP(3),
  "checked_in_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "report_changes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "report_changes_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "topic_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "report_changes_checked_in_by_id_fkey" FOREIGN KEY ("checked_in_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- 报告批注表
CREATE TABLE "report_annotations" (
  "id" TEXT NOT NULL,
  "report_id" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "type" "AnnotationType" NOT NULL,
  "status" "AnnotationStatus" NOT NULL DEFAULT 'OPEN',
  "selected_text" TEXT,
  "start_offset" INTEGER NOT NULL,
  "end_offset" INTEGER NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "resolved_at" TIMESTAMP(3),
  "resolved_by_id" TEXT,

  CONSTRAINT "report_annotations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "report_annotations_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "topic_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "report_annotations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "report_annotations_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- ==================== Indexes ====================

-- ReportChange indexes
CREATE INDEX "report_changes_report_id_idx" ON "report_changes"("report_id");
CREATE INDEX "report_changes_report_id_checked_in_at_idx" ON "report_changes"("report_id", "checked_in_at");

-- ReportAnnotation indexes
CREATE INDEX "report_annotations_report_id_idx" ON "report_annotations"("report_id");
CREATE INDEX "report_annotations_report_id_status_idx" ON "report_annotations"("report_id", "status");
CREATE INDEX "report_annotations_created_by_id_idx" ON "report_annotations"("created_by_id");
