# Database migration runbook

This project uses **hand-written SQL migrations** under
`backend/prisma/migrations/`. Auto-generated migrations from
`npx prisma migrate dev` conflict with the hand-written stream — don't
run that command in this repo.

The deploy pipeline that consumes the migrations lives in
`backend/prisma/deploy-migrations.ts` and runs as part of the container
entrypoint (`backend/scripts/entrypoint.sh` → `npm run deploy`).

---

## Adding a migration

1. Edit `backend/prisma/schema/*.prisma` to reflect the desired schema.

2. Create the migration directory:

   ```bash
   mkdir backend/prisma/migrations/$(date +%Y%m%d_%H%M%S)_<short_description>
   ```

3. Write the SQL by hand in `migration.sql` inside that directory.
   Reference the schema file you just edited.

   **Patterns that work:**

   ```sql
   -- adding an enum value
   ALTER TYPE "MyEnum" ADD VALUE IF NOT EXISTS 'NEW_VALUE';

   -- adding a column
   ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "favorite_color" TEXT;
   ```

   **Patterns that DO NOT work:**

   ```sql
   -- DO NOT wrap ALTER TYPE ADD VALUE in DO $$ ... EXCEPTION ... $$.
   -- EXCEPTION creates a subtransaction; ALTER TYPE ADD VALUE cannot run
   -- inside a subtransaction → migration silently fails, gets auto-resolved
   -- as "applied" by deploy-migrations.ts step 2, schema diverges. Use the
   -- bare ADD VALUE IF NOT EXISTS form above.
   ```

4. Regenerate the Prisma client locally:

   ```bash
   cd backend && npx prisma generate
   ```

5. Smoke-test against the public proxy DB BEFORE merging:

   ```bash
   ./infra/railway/scripts/studio.sh   # browse data
   ./infra/railway/scripts/db-shell.sh # run ad-hoc SELECTs
   ```

6. Commit and push. Railway will run `npm run deploy` automatically;
   that script applies the migration, then seeds, then the app boots.

---

## What `deploy-migrations.ts` actually does

The 405-line script is intentionally thicker than `prisma migrate deploy`
because production accumulated three classes of fragility:

1. **Failed-migration auto-resolve.** Historical migrations that used the
   `DO $$ EXCEPTION` pattern (see "DO NOT" above) are auto-marked as
   applied. The actual SQL is then re-applied below in step 4.5.

2. **Rolled-back cleanup.** If a deploy hit `prisma migrate resolve
--rolled-back`, those rows linger in `_prisma_migrations`. We delete
   them so the next deploy reruns the migration cleanly.

3. **Idempotent compensation.** Step 4.5 / 4.6 contain the enum values
   and one-off data migrations (AI_STUDIO → AI_RESEARCH rename,
   `@anthropics/mcp-server-*` package fixups) that should have happened
   inside migrations but ended up here for backward-compat reasons.

When new migrations are clean (no `DO $$ EXCEPTION` patterns and no
column-rename gotchas), this compensation block can shrink. **Don't add
new compensation here** — write a real migration instead.

---

## Failure modes

- `Could not find migration` — the migration dir name on Railway and
  locally don't match. Did you rename the dir after pushing?

- `Migration already applied (different checksum)` — someone edited
  `migration.sql` after it deployed. The fix is a NEW migration that
  brings the schema to the desired state; never edit a deployed
  migration.

- `relation "X" does not exist` post-deploy — the migration ran but
  didn't create what the code expects. Likely a `DO $$ EXCEPTION`
  silent failure. Check `_prisma_migrations` for `finished_at IS NULL
AND rolled_back_at IS NULL` rows; those are the silent failures.
