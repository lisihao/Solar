-- CreateEnum: RevisionChangeType
DO $$ BEGIN
    CREATE TYPE "RevisionChangeType" AS ENUM ('MANUAL_EDIT', 'AI_REWRITE', 'AI_POLISH', 'AI_EXPAND', 'AI_CONDENSE', 'AI_STYLE_FIX', 'IMPORTED', 'ROLLBACK');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: AnnotationType
DO $$ BEGIN
    CREATE TYPE "AnnotationType" AS ENUM ('COMMENT', 'SUGGESTION', 'ISSUE', 'REFERENCE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: AnnotationStatus
DO $$ BEGIN
    CREATE TYPE "AnnotationStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: ImportSource
DO $$ BEGIN
    CREATE TYPE "ImportSource" AS ENUM ('PASTE', 'FILE_TXT', 'FILE_DOCX', 'FILE_EPUB', 'FILE_MD', 'URL_QIDIAN', 'URL_JJWXC', 'URL_FANQIE', 'URL_OTHER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: ImportStatus
DO $$ BEGIN
    CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'PARSING', 'PREVIEWING', 'IMPORTING', 'POST_PROCESSING', 'COMPLETED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable: chapter_revisions (版本历史)
CREATE TABLE IF NOT EXISTS "chapter_revisions" (
    "id" TEXT NOT NULL,
    "chapter_id" TEXT NOT NULL,

    -- 版本信息
    "version_number" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "word_count" INTEGER NOT NULL DEFAULT 0,
    "change_type" "RevisionChangeType" NOT NULL,
    "change_summary" VARCHAR(500),
    "changed_by" VARCHAR(50) NOT NULL,

    -- AI 修改时的元数据
    "ai_params" JSONB,

    -- 时间戳
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chapter_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for chapter_revisions
CREATE UNIQUE INDEX IF NOT EXISTS "chapter_revisions_chapter_id_version_number_key" ON "chapter_revisions"("chapter_id", "version_number");
CREATE INDEX IF NOT EXISTS "chapter_revisions_chapter_id_idx" ON "chapter_revisions"("chapter_id");
CREATE INDEX IF NOT EXISTS "chapter_revisions_change_type_idx" ON "chapter_revisions"("change_type");

-- AddForeignKey for chapter_revisions
DO $$ BEGIN
    ALTER TABLE "chapter_revisions" ADD CONSTRAINT "chapter_revisions_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "writing_chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable: chapter_annotations (批注)
CREATE TABLE IF NOT EXISTS "chapter_annotations" (
    "id" TEXT NOT NULL,
    "chapter_id" TEXT NOT NULL,

    -- 批注位置
    "start_offset" INTEGER NOT NULL,
    "end_offset" INTEGER NOT NULL,

    -- 批注内容
    "content" TEXT NOT NULL,
    "type" "AnnotationType" NOT NULL DEFAULT 'COMMENT',
    "status" "AnnotationStatus" NOT NULL DEFAULT 'OPEN',
    "selected_text" TEXT,

    -- 时间戳
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "chapter_annotations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for chapter_annotations
CREATE INDEX IF NOT EXISTS "chapter_annotations_chapter_id_idx" ON "chapter_annotations"("chapter_id");
CREATE INDEX IF NOT EXISTS "chapter_annotations_status_idx" ON "chapter_annotations"("status");

-- AddForeignKey for chapter_annotations
DO $$ BEGIN
    ALTER TABLE "chapter_annotations" ADD CONSTRAINT "chapter_annotations_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "writing_chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable: chapter_imports (导入记录)
CREATE TABLE IF NOT EXISTS "chapter_imports" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,

    -- 导入来源
    "source" "ImportSource" NOT NULL,
    "source_url" VARCHAR(500),
    "file_name" VARCHAR(255),

    -- 导入统计
    "total_chapters" INTEGER NOT NULL DEFAULT 0,
    "total_words" INTEGER NOT NULL DEFAULT 0,

    -- 状态
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',

    -- 解析结果（预览数据）
    "parsed_chapters" JSONB,

    -- 导入结果
    "imported_chapter_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "errors" JSONB[] DEFAULT ARRAY[]::JSONB[],

    -- 后处理任务ID
    "consistency_check_mission_id" TEXT,
    "bible_extraction_mission_id" TEXT,

    -- 时间戳
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "chapter_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for chapter_imports
CREATE INDEX IF NOT EXISTS "chapter_imports_project_id_idx" ON "chapter_imports"("project_id");
CREATE INDEX IF NOT EXISTS "chapter_imports_status_idx" ON "chapter_imports"("status");

-- AddForeignKey for chapter_imports
DO $$ BEGIN
    ALTER TABLE "chapter_imports" ADD CONSTRAINT "chapter_imports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "writing_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
