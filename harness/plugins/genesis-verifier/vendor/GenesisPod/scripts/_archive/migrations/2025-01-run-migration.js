/**
 * Railway Database Migration Script
 * Run with: railway run node scripts/run-migration.js
 */

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function runMigration() {
  console.log("🚀 Starting AI Writing V2 Migration...\n");

  try {
    // 1. Create StoryBibleChangeType enum
    console.log("1. Creating StoryBibleChangeType enum...");
    try {
      await prisma.$executeRawUnsafe(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StoryBibleChangeType') THEN
            CREATE TYPE "StoryBibleChangeType" AS ENUM ('CREATE', 'UPDATE', 'DELETE');
            RAISE NOTICE 'Created enum StoryBibleChangeType';
          END IF;
        END $$;
      `);
      console.log("   ✅ StoryBibleChangeType enum ready");
    } catch (e) {
      console.log("   ⚠️ StoryBibleChangeType:", e.message);
    }

    // 2. Create StoryBibleEntityType enum
    console.log("2. Creating StoryBibleEntityType enum...");
    try {
      await prisma.$executeRawUnsafe(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StoryBibleEntityType') THEN
            CREATE TYPE "StoryBibleEntityType" AS ENUM (
              'BIBLE', 'CHARACTER', 'WORLD_SETTING', 'TIMELINE', 'TERMINOLOGY', 'FACTION'
            );
            RAISE NOTICE 'Created enum StoryBibleEntityType';
          END IF;
        END $$;
      `);
      console.log("   ✅ StoryBibleEntityType enum ready");
    } catch (e) {
      console.log("   ⚠️ StoryBibleEntityType:", e.message);
    }

    // 3. Create story_bible_audit_logs table
    console.log("3. Creating story_bible_audit_logs table...");
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "story_bible_audit_logs" (
          "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          "bible_id" UUID NOT NULL,
          "version" INTEGER NOT NULL DEFAULT 1,
          "change_type" "StoryBibleChangeType" NOT NULL,
          "entity_type" "StoryBibleEntityType" NOT NULL,
          "entity_id" UUID,
          "field" VARCHAR(100) NOT NULL,
          "old_value" JSONB,
          "new_value" JSONB,
          "changed_by" VARCHAR(100) NOT NULL,
          "reason" TEXT,
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT "fk_story_bible_audit_bible"
            FOREIGN KEY ("bible_id")
            REFERENCES "story_bibles"("id")
            ON DELETE CASCADE
        );
      `);
      console.log("   ✅ story_bible_audit_logs table ready");
    } catch (e) {
      console.log("   ⚠️ story_bible_audit_logs:", e.message);
    }

    // 4. Create indexes
    console.log("4. Creating indexes...");
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "idx_audit_bible_version"
          ON "story_bible_audit_logs"("bible_id", "version");
        CREATE INDEX IF NOT EXISTS "idx_audit_bible_entity"
          ON "story_bible_audit_logs"("bible_id", "entity_type", "entity_id");
        CREATE INDEX IF NOT EXISTS "idx_audit_bible_created"
          ON "story_bible_audit_logs"("bible_id", "created_at" DESC);
      `);
      console.log("   ✅ Indexes created");
    } catch (e) {
      console.log("   ⚠️ Indexes:", e.message);
    }

    // 5. Add metadata column to writing_chapters (CRITICAL FIX)
    console.log("5. Adding metadata column to writing_chapters...");
    try {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "writing_chapters"
        ADD COLUMN IF NOT EXISTS "metadata" JSONB DEFAULT '{}';
      `);
      console.log("   ✅ metadata column added");
    } catch (e) {
      if (e.message.includes("already exists")) {
        console.log("   ✅ metadata column already exists");
      } else {
        console.log("   ⚠️ metadata column:", e.message);
      }
    }

    // 6. Verify migration
    console.log("\n📊 Verifying migration...");

    const chapterCount = await prisma.$queryRaw`
      SELECT COUNT(*) as count FROM writing_chapters
    `;
    console.log(`   - writing_chapters: ${chapterCount[0].count} rows`);

    const hasMetadata = await prisma.$queryRaw`
      SELECT COUNT(*) as count FROM information_schema.columns
      WHERE table_name = 'writing_chapters' AND column_name = 'metadata'
    `;
    console.log(
      `   - metadata column exists: ${hasMetadata[0].count > 0 ? "✅ YES" : "❌ NO"}`,
    );

    const auditTableExists = await prisma.$queryRaw`
      SELECT COUNT(*) as count FROM information_schema.tables
      WHERE table_name = 'story_bible_audit_logs'
    `;
    console.log(
      `   - story_bible_audit_logs table exists: ${auditTableExists[0].count > 0 ? "✅ YES" : "❌ NO"}`,
    );

    console.log("\n✅ Migration completed successfully!");
    console.log(
      "🔄 Please restart the backend service for changes to take effect.",
    );
  } catch (error) {
    console.error("\n❌ Migration failed:", error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runMigration();
