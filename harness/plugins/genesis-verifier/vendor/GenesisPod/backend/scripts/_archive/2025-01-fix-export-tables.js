/**
 * Fix export tables - creates them if they don't exist
 * This runs before Prisma migrations to handle edge cases
 * Version: 2 - Force rebuild
 */

const { PrismaClient } = require("@prisma/client");

async function main() {
  console.log("=== fix-export-tables.js starting ===");
  const prisma = new PrismaClient();

  try {
    console.log("🔧 Checking and creating export tables...");

    // Check if export_jobs table exists
    const tableExists = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'export_jobs'
      );
    `;

    console.log("Table check result:", JSON.stringify(tableExists));

    // Handle both boolean and string returns from PostgreSQL
    const exists =
      tableExists[0]?.exists === true || tableExists[0]?.exists === "t";

    if (!exists) {
      console.log("📦 Creating export tables...");

      // Create enums if they don't exist
      await prisma.$executeRawUnsafe(`
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExportFormat') THEN
                CREATE TYPE "ExportFormat" AS ENUM ('PDF', 'DOCX', 'PPTX', 'XLSX', 'MARKDOWN', 'HTML');
            END IF;
        END
        $$;
      `);

      await prisma.$executeRawUnsafe(`
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExportJobStatus') THEN
                CREATE TYPE "ExportJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');
            END IF;
        END
        $$;
      `);

      await prisma.$executeRawUnsafe(`
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExportTemplateCategory') THEN
                CREATE TYPE "ExportTemplateCategory" AS ENUM ('REPORT', 'PPT', 'DOCUMENT', 'ACADEMIC', 'BUSINESS');
            END IF;
        END
        $$;
      `);

      // Create export_templates table
      await prisma.$executeRawUnsafe(`
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
      `);

      // Create export_jobs table
      await prisma.$executeRawUnsafe(`
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
      `);

      // Create indexes
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "export_templates_category_is_built_in_idx" ON "export_templates"("category", "is_built_in");
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "export_templates_user_id_idx" ON "export_templates"("user_id");
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "export_jobs_user_id_status_idx" ON "export_jobs"("user_id", "status");
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "export_jobs_status_created_at_idx" ON "export_jobs"("status", "created_at");
      `);

      // Add foreign keys
      await prisma.$executeRawUnsafe(`
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
      `);

      await prisma.$executeRawUnsafe(`
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
      `);

      await prisma.$executeRawUnsafe(`
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
      `);

      console.log("✅ Export tables created successfully!");
    } else {
      console.log("✅ Export tables already exist.");
    }
  } catch (error) {
    console.error("❌ Error creating export tables:", error.message);
    // Don't throw - let the app continue and fail later with more context if needed
  } finally {
    await prisma.$disconnect();
  }
}

main();
