import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

/**
 * 启动时自动执行数据库迁移
 * 用于添加新的列或表，无需手动执行 SQL
 */
@Injectable()
export class StartupMigrationService implements OnModuleInit {
  private readonly logger = new Logger(StartupMigrationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.runMigrations();
  }

  private async runMigrations() {
    this.logger.log("[Migration] Running startup migrations...");

    try {
      // Migration 1: Add metadata column to writing_chapters
      await this.addWritingChapterMetadata();

      // Migration 2: Create story_bible_audit_logs table and enums
      await this.createStoryBibleAuditLogs();

      // Migration 3: Create harness_run_metrics table (Topic Insights harness)
      await this.ensureHarnessRunMetricsTable();

      // Migration 4: Create pipeline_run_checkpoints table (H2 resume primitive)
      await this.ensurePipelineRunCheckpointsTable();

      this.logger.log("[Migration] Startup migrations completed");
    } catch (error) {
      this.logger.error("[Migration] Startup migration failed:", error);
      // 不阻止应用启动，只记录错误
    }
  }

  /**
   * 兜底创建 harness_run_metrics 表。
   *
   * Background: docs/design/topic-insights-harness-redesign/11-capability-discovery.md
   * 设计文件迁移 `20260423_add_harness_run_metrics/migration.sql` 由 `prisma migrate deploy`
   * 在部署期执行，但若 Railway 的 startCommand 未走标准 deploy 流程或迁移卡住，
   * HarnessRolloutService.persistToDb 就会因为表不存在每次 mission 都 warn。
   *
   * 这里做幂等 CREATE IF NOT EXISTS 兜底 —— 与 writing_chapters / story_bible_audit_logs
   * 同一个模式，属于"运行时 schema self-heal"能力。
   */
  private async ensureHarnessRunMetricsTable() {
    try {
      const exists = await this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count FROM information_schema.tables
        WHERE table_name = 'harness_run_metrics'
      `;

      if (Number(exists[0].count) > 0) {
        this.logger.debug("[Migration] harness_run_metrics already exists");
        return;
      }

      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE "harness_run_metrics" (
          "id"            TEXT NOT NULL,
          "mission_id"    VARCHAR(100) NOT NULL,
          "user_id"       VARCHAR(100) NOT NULL,
          "success"       BOOLEAN NOT NULL,
          "duration_ms"   INTEGER NOT NULL,
          "quality_score" INTEGER,
          "tokens_used"   INTEGER NOT NULL DEFAULT 0,
          "cost_usd"      DECIMAL(10, 4) NOT NULL DEFAULT 0,
          "error_message" VARCHAR(500),
          "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "harness_run_metrics_pkey" PRIMARY KEY ("id")
        )
      `);
      await this.prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "harness_run_metrics_created_at_idx"
          ON "harness_run_metrics" ("created_at" DESC)
      `);
      await this.prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "harness_run_metrics_user_id_created_at_idx"
          ON "harness_run_metrics" ("user_id", "created_at" DESC)
      `);
      await this.prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "harness_run_metrics_success_created_at_idx"
          ON "harness_run_metrics" ("success", "created_at" DESC)
      `);

      this.logger.log(
        "[Migration] Created harness_run_metrics table with 3 indexes",
      );
    } catch (error) {
      this.logger.warn(
        "[Migration] Failed to ensure harness_run_metrics table:",
        error,
      );
    }
  }

  /**
   * 兜底创建 pipeline_run_checkpoints 表。
   * H2 primitive：harness pipeline 每个 stage.persist 后写入 checkpoint，
   * resume 时从最后一个 completed stage 继续。与 ensureHarnessRunMetricsTable
   * 同一 self-heal 模式。
   */
  private async ensurePipelineRunCheckpointsTable() {
    try {
      const exists = await this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count FROM information_schema.tables
        WHERE table_name = 'pipeline_run_checkpoints'
      `;
      if (Number(exists[0].count) > 0) {
        this.logger.debug(
          "[Migration] pipeline_run_checkpoints already exists",
        );
        return;
      }

      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE "pipeline_run_checkpoints" (
          "id"                TEXT NOT NULL,
          "mission_id"        VARCHAR(100) NOT NULL,
          "completed_stages"  JSONB NOT NULL,
          "stage_results"     JSONB NOT NULL,
          "budget_snapshot"   JSONB NOT NULL,
          "identity_snapshot" JSONB NOT NULL,
          "last_stage_id"     VARCHAR(50),
          "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "pipeline_run_checkpoints_pkey" PRIMARY KEY ("id")
        )
      `);
      await this.prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS "pipeline_run_checkpoints_mission_id_key"
          ON "pipeline_run_checkpoints" ("mission_id")
      `);
      await this.prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "pipeline_run_checkpoints_updated_at_idx"
          ON "pipeline_run_checkpoints" ("updated_at" DESC)
      `);
      this.logger.log(
        "[Migration] Created pipeline_run_checkpoints table with indexes",
      );
    } catch (error) {
      this.logger.warn(
        "[Migration] Failed to ensure pipeline_run_checkpoints table:",
        error,
      );
    }
  }

  private async addWritingChapterMetadata() {
    try {
      // 检查列是否存在
      const columnExists = await this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count FROM information_schema.columns
        WHERE table_name = 'writing_chapters' AND column_name = 'metadata'
      `;

      if (Number(columnExists[0].count) === 0) {
        await this.prisma.$executeRawUnsafe(`
          ALTER TABLE "writing_chapters"
          ADD COLUMN "metadata" JSONB DEFAULT '{}'
        `);
        this.logger.log(
          "[Migration] Added metadata column to writing_chapters",
        );
      } else {
        this.logger.debug("[Migration] metadata column already exists");
      }
    } catch (error) {
      this.logger.warn("[Migration] Failed to add metadata column:", error);
    }
  }

  private async createStoryBibleAuditLogs() {
    try {
      // 检查枚举是否存在
      const enumExists = await this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count FROM pg_type WHERE typname = 'StoryBibleChangeType'
      `;

      if (Number(enumExists[0].count) === 0) {
        // 创建枚举类型
        await this.prisma.$executeRawUnsafe(`
          CREATE TYPE "StoryBibleChangeType" AS ENUM ('CREATE', 'UPDATE', 'DELETE')
        `);
        this.logger.log("[Migration] Created StoryBibleChangeType enum");
      }

      const entityEnumExists = await this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count FROM pg_type WHERE typname = 'StoryBibleEntityType'
      `;

      if (Number(entityEnumExists[0].count) === 0) {
        await this.prisma.$executeRawUnsafe(`
          CREATE TYPE "StoryBibleEntityType" AS ENUM (
            'BIBLE', 'CHARACTER', 'WORLD_SETTING', 'TIMELINE', 'TERMINOLOGY', 'FACTION'
          )
        `);
        this.logger.log("[Migration] Created StoryBibleEntityType enum");
      }

      // 检查表是否存在
      const tableExists = await this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count FROM information_schema.tables
        WHERE table_name = 'story_bible_audit_logs'
      `;

      if (Number(tableExists[0].count) === 0) {
        // Note: Prisma String @id @default(uuid()) creates TEXT columns, not UUID
        // So we must use TEXT type here to match the story_bibles.id column
        await this.prisma.$executeRawUnsafe(`
          CREATE TABLE "story_bible_audit_logs" (
            "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
            "bible_id" TEXT NOT NULL,
            "version" INTEGER NOT NULL DEFAULT 1,
            "change_type" "StoryBibleChangeType" NOT NULL,
            "entity_type" "StoryBibleEntityType" NOT NULL,
            "entity_id" TEXT,
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
          )
        `);

        // 创建索引
        await this.prisma.$executeRawUnsafe(`
          CREATE INDEX IF NOT EXISTS "idx_audit_bible_version"
            ON "story_bible_audit_logs"("bible_id", "version")
        `);
        await this.prisma.$executeRawUnsafe(`
          CREATE INDEX IF NOT EXISTS "idx_audit_bible_entity"
            ON "story_bible_audit_logs"("bible_id", "entity_type", "entity_id")
        `);
        await this.prisma.$executeRawUnsafe(`
          CREATE INDEX IF NOT EXISTS "idx_audit_bible_created"
            ON "story_bible_audit_logs"("bible_id", "created_at" DESC)
        `);

        this.logger.log(
          "[Migration] Created story_bible_audit_logs table with indexes",
        );
      } else {
        this.logger.debug(
          "[Migration] story_bible_audit_logs table already exists",
        );
      }
    } catch (error) {
      this.logger.warn("[Migration] Failed to create audit logs:", error);
    }
  }
}
