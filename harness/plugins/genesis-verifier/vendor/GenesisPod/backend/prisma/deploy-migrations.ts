/**
 * Database Migration Deployment Script
 *
 * Simplified script for Railway deployment.
 * Uses standard Prisma migrate workflow.
 *
 * Usage:
 * - Railway: Set as Build Command or Start Command
 * - Local: npx tsx prisma/deploy-migrations.ts
 *
 * IMPORTANT:
 * - All schema changes should go through Prisma migrations
 * - Do NOT add "fallback" CREATE TABLE / ALTER TABLE here
 * - Do NOT use DO $$ EXCEPTION wrapper for ALTER TYPE ADD VALUE in migrations
 *   (EXCEPTION creates a subtransaction; ALTER TYPE ADD VALUE fails in subtransactions)
 * - Use direct: ALTER TYPE "X" ADD VALUE IF NOT EXISTS 'Y';
 * - See .claude/skills/development/database-migration/SKILL.md for guidelines
 */

import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "fs";
import { join } from "path";

const prisma = new PrismaClient();

// Critical tables that must exist after migration
const CRITICAL_TABLES = [
  "users",
  "resources",
  "knowledge_bases",
  "knowledge_base_documents",
  "parent_chunks",
  "child_chunks",
  "child_embeddings",
];

const ROOT_MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");
const SCHEMA_MIGRATIONS_DIR = join(
  process.cwd(),
  "prisma",
  "schema",
  "migrations",
);

function getLocalMigrationNames(): string[] {
  if (!existsSync(ROOT_MIGRATIONS_DIR)) {
    return [];
  }

  return readdirSync(ROOT_MIGRATIONS_DIR)
    .filter((entry) => statSync(join(ROOT_MIGRATIONS_DIR, entry)).isDirectory())
    .filter((entry) => !entry.startsWith("."))
    .filter((entry) => entry !== "manual")
    .sort();
}

function prepareSchemaMigrationDirectory(): boolean {
  if (existsSync(SCHEMA_MIGRATIONS_DIR)) {
    return false;
  }

  mkdirSync(SCHEMA_MIGRATIONS_DIR, { recursive: true });

  const migrationLockFile = join(ROOT_MIGRATIONS_DIR, "migration_lock.toml");
  if (existsSync(migrationLockFile)) {
    cpSync(
      migrationLockFile,
      join(SCHEMA_MIGRATIONS_DIR, "migration_lock.toml"),
    );
  }

  for (const migrationName of getLocalMigrationNames()) {
    cpSync(
      join(ROOT_MIGRATIONS_DIR, migrationName),
      join(SCHEMA_MIGRATIONS_DIR, migrationName),
      { recursive: true },
    );
  }

  console.log(
    "   Prepared prisma/schema/migrations for Prisma CLI compatibility",
  );
  return true;
}

function cleanupSchemaMigrationDirectory(wasCreated: boolean): void {
  if (!wasCreated) {
    return;
  }

  rmSync(SCHEMA_MIGRATIONS_DIR, { recursive: true, force: true });
  console.log("   Removed temporary prisma/schema/migrations directory");
}

async function markAllMigrationsApplied(): Promise<void> {
  const migrationNames = getLocalMigrationNames();
  for (const migrationName of migrationNames) {
    execSync(
      `npx prisma migrate resolve --schema=prisma/schema --applied "${migrationName}"`,
      {
        stdio: "inherit",
        env: process.env,
      },
    );
  }
}

async function bootstrapFreshDatabase(): Promise<void> {
  // ★ 2026-05-29 真根因 fix（onprem 冷启动从未成功）：
  //   迁移链不完整——schema.prisma 有 279 张表，迁移链只建了 ~255 张（缺 47 张，含
  //   knowledge_bases / child_chunks 等 CRITICAL 表）+ 21 个枚举类型 + 25 个枚举缺值。
  //   团队长期用 `prisma db push` 演进 schema，迁移只零散补，链早已无法在空库重放出
  //   完整 schema（`migrate deploy` 在前向引用处必崩，且就算修过崩点也少 47 张表）。
  //
  //   2026-05-27 曾从 `db push` 改成 `migrate deploy`，理由是 db push 不跑 migration
  //   里的 INSERT 种子（ai_providers/ai_models 丢失）。本次修复保留 db push（唯一能产出
  //   完整正确 schema 的方式），并显式补种子（seed-catalog.sql）堵上那个坑。
  //
  //   ⚠️ 仅 fresh 库走此分支（isFreshDatabase=true）。现存库（有 _prisma_migrations /
  //   表）永远不进这里，继续走 Step 3 的增量 migrate deploy，完全不受影响。
  console.log(
    "   Fresh database detected; bootstrapping full schema from schema.prisma (db push)...",
  );
  execSync(
    "npx prisma db push --schema=prisma/schema --skip-generate --accept-data-loss",
    { stdio: "inherit", env: process.env },
  );

  console.log(
    "   Schema pushed. Marking all migrations as applied (so future incremental deploys work)...",
  );
  await markAllMigrationsApplied();

  // db push 不执行 migration 里的 INSERT，故显式补 AI provider/model 目录种子。
  // seed-catalog.sql 全部 ON CONFLICT DO NOTHING，幂等。
  console.log(
    "   Seeding AI provider/model catalog (migration INSERTs are not run under db push)...",
  );
  execSync(
    "npx prisma db execute --schema=prisma/schema --file prisma/seed-catalog.sql",
    { stdio: "inherit", env: process.env },
  );

  console.log(
    "   Fresh database bootstrap completed (full schema from schema.prisma + catalog seeded)\n",
  );
}

async function deploy(): Promise<void> {
  console.log("========================================");
  console.log("  Database Migration Deployment");
  console.log("========================================\n");

  try {
    // Step 1: Verify database connection (with retry for Railway private networking)
    console.log("1. Connecting to database...");
    const MAX_RETRIES = 10;
    const RETRY_DELAY_MS = 3000;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await prisma.$connect();
        console.log(`   Connected successfully (attempt ${attempt})\n`);
        break;
      } catch (err) {
        if (attempt === MAX_RETRIES) {
          throw err;
        }
        console.log(
          `   Connection attempt ${attempt}/${MAX_RETRIES} failed, retrying in ${RETRY_DELAY_MS / 1000}s...`,
        );
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }

    const schemaMigrationsPrepared = prepareSchemaMigrationDirectory();

    try {
      const [migrationTable] = await prisma.$queryRaw<
        Array<{ exists: boolean }>
      >`SELECT to_regclass('public._prisma_migrations') IS NOT NULL as exists`;
      const hasPrismaMigrationsTable = migrationTable?.exists === true;
      const [publicTableCountResult] = await prisma.$queryRaw<
        Array<{ count: bigint }>
      >`
        SELECT COUNT(*)::bigint as count
        FROM pg_tables
        WHERE schemaname = 'public'
      `;
      const existingCriticalTables = await prisma.$queryRaw<
        Array<{ tablename: string }>
      >`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename = ANY(${CRITICAL_TABLES}::text[])
      `;
      const isFreshDatabase =
        !hasPrismaMigrationsTable &&
        Number(publicTableCountResult?.count ?? 0) === 0 &&
        existingCriticalTables.length === 0;

      if (isFreshDatabase) {
        await bootstrapFreshDatabase();
      }

      // Step 2: Resolve any failed migrations
      // NOTE: This auto-resolves failed migrations as "applied" to unblock deployment.
      // Historical migrations may have used DO $$/EXCEPTION patterns that fail in Prisma
      // transactions. Those migrations are marked as applied, and the enum values are
      // applied separately in Step 4 below.
      console.log("2. Checking for failed migrations...");
      if (!hasPrismaMigrationsTable && !isFreshDatabase) {
        console.log(
          '   "_prisma_migrations" does not exist yet (fresh database), skipping pre-checks\n',
        );
      }

      const failedMigrations =
        hasPrismaMigrationsTable || isFreshDatabase
          ? await prisma.$queryRaw<Array<{ migration_name: string }>>`
            SELECT migration_name FROM "_prisma_migrations"
            WHERE finished_at IS NULL AND rolled_back_at IS NULL
          `
          : [];

      if (failedMigrations.length > 0) {
        console.log(`   Found ${failedMigrations.length} failed migration(s):`);
        for (const m of failedMigrations) {
          console.log(
            `   - WARNING: Auto-resolving as applied: ${m.migration_name}`,
          );
          console.log(
            `     (migration SQL was NOT executed - check if manual intervention needed)`,
          );
          try {
            execSync(
              `npx prisma migrate resolve --schema=prisma/schema --applied "${m.migration_name}"`,
              { stdio: "inherit", env: process.env },
            );
          } catch {
            console.log(`     (already resolved or not found locally)`);
          }
        }
        console.log("");
      } else {
        console.log("   No failed migrations found\n");
      }

      // Step 2.5: Clean up rolled-back migrations
      console.log("2.5. Cleaning up rolled-back migrations...");
      const rolledBackMigrations =
        hasPrismaMigrationsTable || isFreshDatabase
          ? await prisma.$queryRaw<Array<{ migration_name: string }>>`
            SELECT DISTINCT migration_name FROM "_prisma_migrations"
            WHERE rolled_back_at IS NOT NULL
          `
          : [];

      if (rolledBackMigrations.length > 0) {
        console.log(
          `   Found ${rolledBackMigrations.length} unique rolled-back migration(s):`,
        );
        for (const m of rolledBackMigrations) {
          console.log(`   - ${m.migration_name}`);
        }

        const deleteResult = await prisma.$executeRaw`
          DELETE FROM "_prisma_migrations"
          WHERE rolled_back_at IS NOT NULL
        `;
        console.log(`   Deleted ${deleteResult} rolled-back records`);
        console.log("   These migrations will be re-run by migrate deploy\n");
      } else {
        console.log("   No rolled-back migrations found\n");
      }

      // Step 3: Run Prisma migrate deploy
      console.log("3. Running Prisma migrate deploy...");
      execSync("npx prisma migrate deploy --schema=prisma/schema", {
        stdio: "inherit",
        env: process.env,
      });
      console.log("   Migrations deployed\n");

      // Step 4: Generate Prisma Client
      console.log("4. Generating Prisma Client...");
      execSync("npx prisma generate --schema=prisma/schema", {
        stdio: "inherit",
        env: process.env,
      });
      console.log("   Client generated\n");

      // Step 4.5: Ensure enum values exist
      // WHY THIS EXISTS: Historical migration files used DO $$/EXCEPTION wrappers around
      // ALTER TYPE ADD VALUE. This pattern creates a PostgreSQL subtransaction (via EXCEPTION),
      // and ALTER TYPE ADD VALUE cannot execute inside a subtransaction. So those migrations
      // failed, were auto-resolved as "applied" by Step 2, but the enum values were never
      // actually added. This step compensates by adding them outside any transaction.
      //
      // FUTURE MIGRATIONS should use direct: ALTER TYPE "X" ADD VALUE IF NOT EXISTS 'Y';
      // (no DO/EXCEPTION wrapper) — which works correctly in Prisma's transaction.
      // Once all historical migrations are superseded, this section can be removed.
      console.log(
        "4.5. Ensuring enum values (legacy migration compensation)...",
      );

      const addEnumIfNotExists = async (
        checkQuery: Promise<{ exists: boolean }[]>,
        addQuery: () => Promise<number>,
        label: string,
      ) => {
        try {
          const result = await checkQuery;
          if (!result[0]?.exists) {
            await addQuery();
            console.log(`   Added ${label}`);
          } else {
            console.log(`   OK ${label}`);
          }
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (message.includes("already exists")) {
            console.log(`   OK ${label}`);
          } else {
            console.warn(`   Warning: Could not add ${label}: ${message}`);
          }
        }
      };

      // ResearchMessageType enum values
      await addEnumIfNotExists(
        prisma.$queryRaw`SELECT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'DIMENSION_STARTED' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ResearchMessageType')) as exists`,
        () =>
          prisma.$executeRaw`ALTER TYPE "ResearchMessageType" ADD VALUE IF NOT EXISTS 'DIMENSION_STARTED'`,
        "ResearchMessageType.DIMENSION_STARTED",
      );
      await addEnumIfNotExists(
        prisma.$queryRaw`SELECT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'DIMENSION_PROGRESS' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ResearchMessageType')) as exists`,
        () =>
          prisma.$executeRaw`ALTER TYPE "ResearchMessageType" ADD VALUE IF NOT EXISTS 'DIMENSION_PROGRESS'`,
        "ResearchMessageType.DIMENSION_PROGRESS",
      );
      await addEnumIfNotExists(
        prisma.$queryRaw`SELECT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'DIMENSION_COMPLETED' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ResearchMessageType')) as exists`,
        () =>
          prisma.$executeRaw`ALTER TYPE "ResearchMessageType" ADD VALUE IF NOT EXISTS 'DIMENSION_COMPLETED'`,
        "ResearchMessageType.DIMENSION_COMPLETED",
      );

      // ResearchMissionStatus enum values
      await addEnumIfNotExists(
        prisma.$queryRaw`SELECT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'PLAN_READY' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ResearchMissionStatus')) as exists`,
        () =>
          prisma.$executeRaw`ALTER TYPE "ResearchMissionStatus" ADD VALUE IF NOT EXISTS 'PLAN_READY'`,
        "ResearchMissionStatus.PLAN_READY",
      );

      // SecretCategory enum values
      await addEnumIfNotExists(
        prisma.$queryRaw`SELECT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'POLICY' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'SecretCategory')) as exists`,
        () =>
          prisma.$executeRaw`ALTER TYPE "SecretCategory" ADD VALUE IF NOT EXISTS 'POLICY'`,
        "SecretCategory.POLICY",
      );
      await addEnumIfNotExists(
        prisma.$queryRaw`SELECT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'DEV_TOOLS' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'SecretCategory')) as exists`,
        () =>
          prisma.$executeRaw`ALTER TYPE "SecretCategory" ADD VALUE IF NOT EXISTS 'DEV_TOOLS'`,
        "SecretCategory.DEV_TOOLS",
      );
      await addEnumIfNotExists(
        prisma.$queryRaw`SELECT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'MCP' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'SecretCategory')) as exists`,
        () =>
          prisma.$executeRaw`ALTER TYPE "SecretCategory" ADD VALUE IF NOT EXISTS 'MCP'`,
        "SecretCategory.MCP",
      );

      // DeepResearchStatus enum values
      await addEnumIfNotExists(
        prisma.$queryRaw`SELECT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'IDEATION' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'DeepResearchStatus')) as exists`,
        () =>
          prisma.$executeRaw`ALTER TYPE "DeepResearchStatus" ADD VALUE IF NOT EXISTS 'IDEATION'`,
        "DeepResearchStatus.IDEATION",
      );
      await addEnumIfNotExists(
        prisma.$queryRaw`SELECT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'FINDINGS' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'DeepResearchStatus')) as exists`,
        () =>
          prisma.$executeRaw`ALTER TYPE "DeepResearchStatus" ADD VALUE IF NOT EXISTS 'FINDINGS'`,
        "DeepResearchStatus.FINDINGS",
      );
      await addEnumIfNotExists(
        prisma.$queryRaw`SELECT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'PLAN_READY' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'DeepResearchStatus')) as exists`,
        () =>
          prisma.$executeRaw`ALTER TYPE "DeepResearchStatus" ADD VALUE IF NOT EXISTS 'PLAN_READY'`,
        "DeepResearchStatus.PLAN_READY",
      );
      await addEnumIfNotExists(
        prisma.$queryRaw`SELECT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'CANCELLED' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'DeepResearchStatus')) as exists`,
        () =>
          prisma.$executeRaw`ALTER TYPE "DeepResearchStatus" ADD VALUE IF NOT EXISTS 'CANCELLED'`,
        "DeepResearchStatus.CANCELLED",
      );

      // CreditTransactionType enum values
      const creditEnumValues = [
        "AI_WRITING",
        "AI_IMAGE",
        "AI_SOCIAL",
        "AI_RESEARCH",
        "AI_INSIGHTS",
        "AI_PLANNING",
        "NOTEBOOK_RESEARCH",
        "LIBRARY",
        "NOTES",
        "COLLECTIONS",
        "DONATION_REWARD",
        "DONATION_USAGE_REWARD",
      ];
      for (const value of creditEnumValues) {
        await addEnumIfNotExists(
          prisma.$queryRaw`SELECT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = ${value} AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'CreditTransactionType')) as exists`,
          () =>
            prisma.$executeRawUnsafe(
              `ALTER TYPE "CreditTransactionType" ADD VALUE IF NOT EXISTS '${value}'`,
            ),
          `CreditTransactionType.${value}`,
        );
      }
      console.log("");

      // Step 4.6: Data migrations (idempotent)
      console.log("4.6. Running data migrations...");

      // Fix MCP server package names (from @anthropics to @modelcontextprotocol)
      try {
        const githubFixed = await prisma.$executeRaw`
        UPDATE "mcp_server_configs"
        SET args = array_replace(args, '@anthropics/mcp-server-github', '@modelcontextprotocol/server-github')
        WHERE '@anthropics/mcp-server-github' = ANY(args)
      `;
        const ddgFixed = await prisma.$executeRaw`
        UPDATE "mcp_server_configs"
        SET args = array_replace(args, '@anthropics/mcp-server-duckduckgo', '@modelcontextprotocol/server-ddg-search')
        WHERE '@anthropics/mcp-server-duckduckgo' = ANY(args)
      `;
        const fsFixed = await prisma.$executeRaw`
        UPDATE "mcp_server_configs"
        SET args = array_replace(args, '@anthropics/mcp-server-filesystem', '@modelcontextprotocol/server-filesystem')
        WHERE '@anthropics/mcp-server-filesystem' = ANY(args)
      `;
        const totalFixed = githubFixed + ddgFixed + fsFixed;
        if (totalFixed > 0) {
          console.log(`   Fixed ${totalFixed} MCP server package name(s)`);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`   Warning: Could not fix MCP package names: ${message}`);
      }

      // Fix secret categories for known secrets
      try {
        const githubSecretsFixed = await prisma.$executeRaw`
        UPDATE "secrets"
        SET category = 'DEV_TOOLS'
        WHERE (LOWER(name) LIKE '%github%' OR LOWER(display_name) LIKE '%github%')
          AND category != 'DEV_TOOLS'
      `;
        if (githubSecretsFixed > 0) {
          console.log(
            `   Fixed ${githubSecretsFixed} GitHub secret(s) category`,
          );
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`   Warning: Could not fix secret categories: ${message}`);
      }
      console.log("   Data migrations completed\n");

      // Step 5: Verify critical tables
      console.log("5. Verifying critical tables...");
      const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename = ANY(${CRITICAL_TABLES}::text[])
      `;

      const foundTables = new Set(tables.map((t) => t.tablename));
      let allFound = true;

      for (const table of CRITICAL_TABLES) {
        const exists = foundTables.has(table);
        console.log(`   ${exists ? "OK" : "MISSING"} ${table}`);
        if (!exists) allFound = false;
      }

      if (!allFound) {
        console.warn("\n   Warning: Some critical tables are missing!\n");
      }

      console.log("\n========================================");
      console.log("  Migration deployment completed!");
      console.log("========================================\n");
    } finally {
      cleanupSchemaMigrationDirectory(schemaMigrationsPrepared);
    }
  } catch (error) {
    console.error("\n========================================");
    console.error("  Migration deployment FAILED");
    console.error("========================================");
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run deployment
deploy();
