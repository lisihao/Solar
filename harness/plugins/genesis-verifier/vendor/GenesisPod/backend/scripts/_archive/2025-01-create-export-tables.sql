-- Complete SQL to create all export-related tables and enums
-- Run this directly against the production database

-- 1. Create ExportSourceType enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExportSourceType') THEN
        CREATE TYPE "ExportSourceType" AS ENUM ('DOCUMENT', 'RESEARCH', 'REPORT', 'RAW', 'MISSION');
    ELSE
        -- Add MISSION value if not exists
        BEGIN
            ALTER TYPE "ExportSourceType" ADD VALUE IF NOT EXISTS 'MISSION';
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END;
    END IF;
END
$$;

-- 2. Create ExportFormat enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExportFormat') THEN
        CREATE TYPE "ExportFormat" AS ENUM ('PDF', 'DOCX', 'PPTX', 'XLSX', 'MARKDOWN', 'HTML');
    END IF;
END
$$;

-- 3. Create ExportJobStatus enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExportJobStatus') THEN
        CREATE TYPE "ExportJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');
    END IF;
END
$$;

-- 4. Create ExportTemplateCategory enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExportTemplateCategory') THEN
        CREATE TYPE "ExportTemplateCategory" AS ENUM ('REPORT', 'PPT', 'DOCUMENT', 'ACADEMIC', 'BUSINESS');
    END IF;
END
$$;

-- 5. Create export_templates table
CREATE TABLE IF NOT EXISTS "export_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "ExportTemplateCategory" NOT NULL,
    "theme_config" JSONB NOT NULL,
    "layout_config" JSONB NOT NULL,
    "style_config" JSONB,
    "supported_formats" "ExportFormat"[],
    "supported_sources" "ExportSourceType"[],
    "is_built_in" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "preview_image" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "user_id" TEXT,
    "workspace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "export_templates_pkey" PRIMARY KEY ("id")
);

-- 6. Create export_jobs table
CREATE TABLE IF NOT EXISTS "export_jobs" (
    "id" TEXT NOT NULL,
    "source_type" "ExportSourceType" NOT NULL,
    "source_id" TEXT,
    "source_data" JSONB,
    "format" "ExportFormat" NOT NULL,
    "template_id" TEXT,
    "options" JSONB NOT NULL DEFAULT '{}',
    "status" "ExportJobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "file_name" TEXT,
    "file_size" INTEGER,
    "file_path" TEXT,
    "download_url" TEXT,
    "expires_at" TIMESTAMP(3),
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- 7. Create indexes
CREATE INDEX IF NOT EXISTS "export_templates_category_is_built_in_idx" ON "export_templates"("category", "is_built_in");
CREATE INDEX IF NOT EXISTS "export_templates_user_id_idx" ON "export_templates"("user_id");
CREATE INDEX IF NOT EXISTS "export_jobs_user_id_status_idx" ON "export_jobs"("user_id", "status");
CREATE INDEX IF NOT EXISTS "export_jobs_status_created_at_idx" ON "export_jobs"("status", "created_at");

-- 8. Add foreign keys
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'export_templates_user_id_fkey'
    ) THEN
        ALTER TABLE "export_templates" ADD CONSTRAINT "export_templates_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'export_jobs_user_id_fkey'
    ) THEN
        ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'export_jobs_template_id_fkey'
    ) THEN
        ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_template_id_fkey"
        FOREIGN KEY ("template_id") REFERENCES "export_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$$;

-- Done
SELECT 'Export tables created successfully!' as status;
