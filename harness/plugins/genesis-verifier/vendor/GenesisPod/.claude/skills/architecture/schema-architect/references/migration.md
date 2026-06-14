# Migration Strategy

## Prisma Migration Workflow

```typescript
// 1. Modify schema.prisma
// 2. Generate migration
// 3. Review SQL
// 4. Apply migration

// Example: Adding new field
// schema.prisma
model Resource {
  id        String   @id @default(uuid())
  title     String
  // NEW FIELD
  priority  Int      @default(0)  // Add with default for existing rows
}

// Migration commands
// npx prisma migrate dev --name add_resource_priority
// npx prisma generate
```

## Breaking Change Protocol

1. **Announce**: Document in ADR
2. **Deprecate**: Add @deprecated annotation
3. **Migrate**: Provide migration script
4. **Remove**: After deprecation period

```typescript
// Deprecation pattern
interface ResourceV1 {
  /** @deprecated Use metadata.tags instead */
  tags?: string[];

  metadata: {
    tags: string[]; // New location
  };
}
```

## Migration Best Practices

### Safe Migrations

```sql
-- Adding nullable column (safe)
ALTER TABLE resources ADD COLUMN priority INTEGER;

-- Adding column with default (safe for small tables)
ALTER TABLE resources ADD COLUMN priority INTEGER DEFAULT 0;

-- Adding index concurrently (safe, PostgreSQL)
CREATE INDEX CONCURRENTLY idx_resources_priority ON resources(priority);
```

### Risky Migrations

```sql
-- Renaming column (requires app code update)
ALTER TABLE resources RENAME COLUMN old_name TO new_name;

-- Changing column type (may lose data)
ALTER TABLE resources ALTER COLUMN priority TYPE BIGINT;

-- Removing column (ensure no code references)
ALTER TABLE resources DROP COLUMN deprecated_field;
```

## Rollback Planning

Every migration should have a rollback plan:

```typescript
// migration.ts
export async function up(prisma: PrismaClient) {
  await prisma.$executeRaw`
    ALTER TABLE resources ADD COLUMN priority INTEGER DEFAULT 0
  `;
}

export async function down(prisma: PrismaClient) {
  await prisma.$executeRaw`
    ALTER TABLE resources DROP COLUMN priority
  `;
}
```

## Command Reference

```bash
# Schema operations
npx prisma format          # Format schema.prisma
npx prisma validate        # Validate schema
npx prisma migrate dev     # Create and apply migration (dev)
npx prisma migrate deploy  # Apply pending migrations (prod)
npx prisma db push         # Push schema (dev only, no migration)
npx prisma studio          # Visual database browser

# Migration management
npx prisma migrate reset   # Reset database and apply all migrations
npx prisma migrate status  # Check migration status
```
