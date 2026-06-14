# Rollback runbook

When production goes wrong because of code (not infra), pick the fastest
honest path. The two scenarios below cover almost every incident; if your
situation doesn't match, escalate before improvising.

---

## Scenario A — bad commit on `main` only

Symptom: most recent push made `https://api.gens.team/api/v1/health` start
returning errors, or a feature visibly broke. Database schema is fine.

1. Identify the last good commit:

   ```bash
   git log --oneline origin/main | head -10
   ```

   Usually the one immediately before the suspect deploy.

2. Trigger a redeploy of that commit on Railway (no force-push):
   - **Preferred (no rewrite):** Railway dashboard → backend service →
     Deployments → find the row for the last good commit → "Redeploy".
     Repeat for `frontend` (and `ai-service` if relevant).

   - **CLI:** `railway redeploy --service backend --commit <SHA>` — only
     if the dashboard isn't accessible.

3. Watch healthcheck come back green:

   ```bash
   ./infra/railway/scripts/monitor.sh
   ```

   Expect `buildSha` to flip to the rolled-back SHA on `/api/v1/health`.

4. Land the _real_ fix as a new commit on `main` — DO NOT force-push to
   undo the bad commit. The bad commit stays in history with a clear
   "revert in <SHA>" reference.

## Scenario B — bad migration

Symptom: deploy `entrypoint.sh` step 2 (`npm run deploy`) fails, or
queries error after deploy with column/enum/table errors.

1. **Stop redeploys** of `main` until you decide. Each deploy re-runs
   `prisma migrate deploy`.

2. Read `backend/prisma/deploy-migrations.ts` — it auto-resolves _failed_
   migrations as "applied" (step 2). If your migration showed up there
   it's been silently marked done; your schema may not match the model.

3. Decide:
   - **Forward fix** (preferred): write a new migration that brings the
     schema to where the model expects, push, redeploy. Same migration
     stream, no rewriting.
   - **Backward fix**: only if forward is impossible. Restore the most
     recent automated Postgres snapshot from Railway dashboard
     (Postgres service → Backups), then revert the bad commit per
     Scenario A.

4. Forensics: dump `_prisma_migrations` rows touched in the last hour:
   ```bash
   ./infra/railway/scripts/db-shell.sh -- -c "
     SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count
     FROM _prisma_migrations
     WHERE started_at > now() - interval '1 hour'
     ORDER BY started_at DESC;"
   ```
   Attach to the post-mortem.

---

## Things that are NOT rollbacks

- **`git push --force` to `main`** — pre-push hooks block this; if you
  bypass them you break everyone else's history. Don't.
- **Deleting a Railway deployment** — Railway keeps a deployment ledger
  for redeploy; deleting one removes a known-good rollback target. Leave
  the row, redeploy from it instead.
- **Editing migrations after they ran** — `_prisma_migrations` records
  the checksum. Editing the SQL after deploy makes future deploys think
  the migration changed and they will refuse to advance.
