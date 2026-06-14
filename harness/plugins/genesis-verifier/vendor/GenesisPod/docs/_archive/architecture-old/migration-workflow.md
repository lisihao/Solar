# Database Migration Workflow

> **Version**: 1.0
> **Date**: 2025-12-27
> **Status**: Active

---

## Overview

This document defines the standard workflow for database migrations in GenesisPod. All team members must follow these guidelines to ensure database stability and consistency.

---

## Migration Naming Convention

### Format

```
YYYYMMDD_description
```

### Allowed Prefixes

| Prefix    | Usage                         | Example                            |
| --------- | ----------------------------- | ---------------------------------- |
| `add_`    | Adding new tables/columns     | `20251228_add_vector_cache`        |
| `update_` | Modifying existing structures | `20251228_update_user_preferences` |
| `remove_` | Removing deprecated items     | `20251228_remove_legacy_columns`   |
| `fix_`    | Fixing schema issues          | `20251228_fix_foreign_key`         |
| `seed_`   | Data seeding (rare)           | `20251228_seed_initial_data`       |

### Prohibited Prefixes

**NEVER use these prefixes:**

- `force_` - Indicates bypassing normal workflow
- `emergency_` - Indicates panic-driven changes
- `hotfix_` - Use proper `fix_` prefix instead

---

## Standard Workflow

### 1. Modify Schema

Edit `backend/prisma/schema.prisma`:

```prisma
// Example: Adding a new field
model User {
  // ... existing fields
  preferences  Json?  @map("preferences")  // NEW
}
```

### 2. Generate Migration

```bash
cd backend
npx prisma migrate dev --name add_user_preferences
```

This will:

- Create migration SQL in `prisma/migrations/<timestamp>_add_user_preferences/`
- Apply the migration to your local database
- Regenerate Prisma Client

### 3. Review Generated SQL

**Always review the generated migration before committing:**

```bash
# Check the generated SQL
cat prisma/migrations/<timestamp>_add_user_preferences/migration.sql
```

Verify:

- No destructive operations (DROP without backup)
- Correct data types
- Proper indexes
- Foreign key constraints

### 4. Test Locally

```bash
# Reset and reapply all migrations
npx prisma migrate reset

# Start the application
npm run start:dev

# Run tests
npm test
```

### 5. Commit and Push

```bash
git add backend/prisma/
git commit -m "feat(db): add user preferences field"
git push
```

---

## Deployment

Railway automatically runs `deploy-migrations.ts` which:

1. Connects to database
2. Runs `prisma migrate deploy`
3. Generates Prisma Client
4. Verifies critical tables

**No manual intervention required.**

---

## Rules and Best Practices

### DO

- Use Prisma schema as single source of truth
- Run `prisma migrate dev` for all changes
- Test migrations locally before deploying
- Write idempotent SQL (IF NOT EXISTS, ON CONFLICT DO NOTHING)
- Review generated SQL before committing
- Backup data before major migrations
- Use TEXT type for IDs (not UUID) for consistency

### DO NOT

- Add manual SQL files outside Prisma workflow
- Use force/emergency prefixes
- Modify deploy-migrations.ts without team review
- Create UUID/TEXT type mismatches
- Use pgvector or extensions not supported by Railway
- Add Steps/Emergency fixes to deploy script

---

## Code Review Checklist

Before approving a PR with migrations:

- [ ] Migration created via `prisma migrate dev`
- [ ] No force/emergency naming
- [ ] No raw SQL modifying table types
- [ ] Foreign key types match
- [ ] Index names are descriptive
- [ ] Rollback strategy documented (if needed)
- [ ] No pgvector dependencies (Railway limitation)

---

## Troubleshooting

### Migration Failed

1. Check Railway logs for error message
2. **DO NOT** add emergency fix
3. Fix the schema.prisma and create proper migration
4. If needed, manually fix via Prisma Studio

### Type Mismatch Errors

- Always use `String @id @default(uuid())` (generates TEXT)
- Never mix UUID and TEXT types
- Foreign keys must match primary key types

### Extension Not Available

Railway PostgreSQL does not support:

- pgvector (use JSONB instead)
- PostGIS
- Other non-standard extensions

Use application-layer alternatives.

---

## Vector Storage

DeepDive uses JSONB for vector storage instead of pgvector:

```prisma
model ChildEmbedding {
  embedding  Json  @default("[]")  // Float array as JSON
}
```

Similarity search is computed in application layer via `VectorService`.

See `backend/src/modules/ai/rag/services/vector.service.ts`.

---

## History

| Date       | Change                                |
| ---------- | ------------------------------------- |
| 2025-12-27 | Initial version - Simplified workflow |

---

**Maintainer**: Claude Code
**Last Updated**: 2025-12-27
