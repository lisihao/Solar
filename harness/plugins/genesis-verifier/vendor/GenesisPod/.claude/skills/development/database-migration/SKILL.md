---
name: Database Migration
description: |
  Database migration patterns for GenesisPod (hand-written SQL + Prisma).
  Trigger keywords: migration, schema change, alter table, add column, enum, prisma migrate
  Not for: Schema design (-> schema-architect), Data seeding (-> database-manager)
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob]
tags: [database, migration, prisma, postgresql, schema]
boundaries:
  includes:
    - Writing hand-written migration SQL
    - Enum value additions
    - Table/column creation
    - Index creation
    - Migration troubleshooting
  excludes:
    - Schema design decisions
    - Data seeding
  handoff:
    - skill: schema-architect
      when: Schema design decisions needed
    - skill: secret-tool-integration
      when: Adding secrets or tool configs
---

# Database Migration

> GenesisPod uses **hand-written SQL migrations**, not `npx prisma migrate dev`.

## Critical Rule: No DO/EXCEPTION Wrapper for ALTER TYPE

```sql
-- WRONG: EXCEPTION creates a PostgreSQL subtransaction.
-- ALTER TYPE ADD VALUE cannot execute inside a subtransaction.
-- prisma migrate deploy wraps each migration in a transaction.
-- Result: migration ALWAYS fails, gets auto-resolved as applied, SQL never executes.
DO $$
BEGIN
    ALTER TYPE "MyEnum" ADD VALUE IF NOT EXISTS 'NEW_VALUE';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CORRECT: IF NOT EXISTS handles duplicates without subtransaction.
ALTER TYPE "MyEnum" ADD VALUE IF NOT EXISTS 'NEW_VALUE';
```

**Why**: `EXCEPTION` clause = PostgreSQL savepoint (subtransaction). `ALTER TYPE ADD VALUE`
cannot run inside a subtransaction even in PG 12+. Since `prisma migrate deploy` wraps
each migration file in a transaction, the `DO $$/EXCEPTION` pattern creates a nested
subtransaction that is guaranteed to fail.

## Migration Workflow

```bash
1. backend/prisma/schema/models.prisma          # Modify schema
2. backend/prisma/migrations/YYYYMMDD_desc/migration.sql  # Write SQL
3. npx prisma generate                          # Update Prisma Client types
```

## SQL Templates

### Add enum value

```sql
ALTER TYPE "MyEnum" ADD VALUE IF NOT EXISTS 'NEW_VALUE';
```

### Create new enum type

```sql
-- For CREATE TYPE, DO/EXCEPTION is OK (no ALTER TYPE involved)
DO $$ BEGIN
    CREATE TYPE "MyStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
```

### Create table

```sql
CREATE TABLE IF NOT EXISTS "my_table" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "status" "MyStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "my_table_pkey" PRIMARY KEY ("id")
);
```

### Add column

```sql
ALTER TABLE "my_table" ADD COLUMN IF NOT EXISTS "new_col" VARCHAR(100);
ALTER TABLE "my_table" ADD COLUMN IF NOT EXISTS "count" INTEGER NOT NULL DEFAULT 0;
```

### Create index

```sql
CREATE INDEX IF NOT EXISTS "my_table_name_idx" ON "my_table"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "my_table_a_b_key" ON "my_table"("a", "b");
```

### Add foreign key

```sql
-- Foreign keys don't have IF NOT EXISTS, use DO/EXCEPTION
DO $$ BEGIN
    ALTER TABLE "my_table"
    ADD CONSTRAINT "my_table_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "parent_table"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
```

## DO/EXCEPTION Decision Rule

| SQL Statement                          | DO/EXCEPTION OK? | Why                           |
| -------------------------------------- | ---------------- | ----------------------------- |
| `CREATE TYPE ... AS ENUM`              | YES              | CREATE TYPE is not ALTER TYPE |
| `ALTER TYPE ADD VALUE`                 | **NO**           | Cannot run in subtransaction  |
| `ALTER TABLE ADD CONSTRAINT`           | YES              | No subtransaction restriction |
| `CREATE TABLE IF NOT EXISTS`           | Not needed       | IF NOT EXISTS handles it      |
| `ALTER TABLE ADD COLUMN IF NOT EXISTS` | Not needed       | IF NOT EXISTS handles it      |
| `CREATE INDEX IF NOT EXISTS`           | Not needed       | IF NOT EXISTS handles it      |
| `CREATE INDEX CONCURRENTLY`            | **NO**           | Cannot run in any transaction |

## Naming Convention

| Prefix      | Purpose               | Example                               |
| ----------- | --------------------- | ------------------------------------- |
| `add_`      | New table/column/enum | `20260313_add_image_search_category`  |
| `update_`   | Modify existing       | `20260313_update_user_preferences`    |
| `fix_`      | Fix schema issue      | `20260313_fix_foreign_key`            |
| `remove_`   | Drop deprecated items | `20260313_remove_legacy_columns`      |
| `optimize_` | Add indexes           | `20260313_optimize_query_performance` |
| `create_`   | Create new tables     | `20260313_create_memories_table`      |

## Prisma Type Mapping

| Prisma                  | PostgreSQL         | SQL Example                             |
| ----------------------- | ------------------ | --------------------------------------- |
| `String`                | `TEXT`             | `"id" TEXT NOT NULL`                    |
| `String @db.VarChar(n)` | `VARCHAR(n)`       | `"name" VARCHAR(100)`                   |
| `Int`                   | `INTEGER`          | `"count" INTEGER`                       |
| `Boolean`               | `BOOLEAN`          | `"active" BOOLEAN DEFAULT false`        |
| `DateTime`              | `TIMESTAMP(3)`     | `"created_at" TIMESTAMP(3)`             |
| `Json`                  | `JSONB`            | `"data" JSONB`                          |
| `String[]`              | `TEXT[]`           | `"tags" TEXT[] DEFAULT ARRAY[]::TEXT[]` |
| `Float`                 | `DOUBLE PRECISION` | `"score" DOUBLE PRECISION`              |

## Deployment Flow (Railway)

```
railway.toml startCommand
  → npm run deploy
    → tsx prisma/deploy-migrations.ts
      → Step 1: Connect to database
      → Step 2: Resolve failed migrations
      → Step 3: npx prisma migrate deploy (runs pending migration.sql files)
      → Step 4: npx prisma generate
      → Step 5: Verify critical tables
    → npm run prisma:seed
  → node dist/main
```

## Troubleshooting

### Migration marked as failed

```sql
-- Check status
SELECT migration_name, finished_at, rolled_back_at, logs
FROM "_prisma_migrations"
WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;
```

### CREATE INDEX CONCURRENTLY fails

`CONCURRENTLY` cannot run inside a transaction. Use regular `CREATE INDEX IF NOT EXISTS`
in migration files. Only use `CONCURRENTLY` when running SQL manually against the database.

## Prohibited

- `npx prisma migrate dev` (conflicts with hand-written migrations)
- `DO $$ EXCEPTION` around `ALTER TYPE ADD VALUE` (subtransaction failure)
- `CREATE INDEX CONCURRENTLY` in migration files (transaction limitation)
- Non-idempotent SQL (must use IF NOT EXISTS / IF EXISTS patterns)

---

**Last updated**: 2026-03-13
**Maintainer**: Claude Code
