# Incident response runbook

If `https://api.gens.team` is down or visibly broken, work this list
top-to-bottom. The goal is to get a short, honest status reported in
under 5 minutes, then to mitigation.

---

## 0. Snapshot (60 seconds)

```bash
./infra/railway/scripts/monitor.sh
```

Capture:

- per-service deployment `status` (BUILDING / DEPLOYING / SUCCESS / FAILED / CRASHED)
- the commit each service is running
- raw response from each healthcheck endpoint

Paste this snapshot into your incident channel before doing anything
else. Future-you will need it.

## 1. Classify

| Snapshot says                                      | Likely class        | First move                                                                                  |
| -------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| All services FAILED at the same commit             | bad commit          | go to `rollback.md` Scenario A                                                              |
| Backend FAILED + entrypoint logs show prisma error | bad migration       | go to `rollback.md` Scenario B                                                              |
| Backend SUCCESS but `/health` returns DB unhealthy | DB connectivity     | check Postgres service status; failover snapshot if down                                    |
| Backend CRASHED in a loop                          | runtime crash       | tail logs (`logs.sh backend`); look for the panic; usually requires forward fix or rollback |
| Frontend SUCCESS but page errors                   | frontend bundle bug | rollback frontend service to last good commit; backend may stay current                     |
| Healthcheck timing out, no logs                    | network / CDN issue | check `https://railway-status.up.railway.app/`; if Railway is degraded, wait                |

## 2. Logs

```bash
./infra/railway/scripts/logs.sh backend          # runtime
./infra/railway/scripts/logs.sh backend --build  # last build (if FAILED)
./infra/railway/scripts/logs.sh ai-service
./infra/railway/scripts/logs.sh frontend
```

For runtime crash loops, scroll past the latest panic to find the FIRST
panic — restarts can chain unrelated errors.

## 3. Mitigate

- **Code regression** → rollback per `rollback.md` Scenario A.
- **Migration broke the DB** → `rollback.md` Scenario B.
- **External dep down** (OpenAI / GitHub / Notion etc) → flip the
  feature flag in Railway Variables (e.g. `TOPIC_INSIGHTS_USE_HARNESS=0`),
  redeploy. Don't wait on the upstream provider.
- **Database overloaded** → check connection count via `db-shell.sh`:
  ```sql
  SELECT count(*), state FROM pg_stat_activity GROUP BY state;
  ```
  If saturated, restart the backend service (drops idle connections).

## 4. Verify

After mitigation re-run the snapshot from step 0 and post the diff. The
commit / status columns should show what changed; the healthcheck body
should now be 200/healthy.

## 5. Post-mortem

Within 48 hours, write the post-mortem in `docs/incidents/YYYY-MM-DD-<slug>.md`:

- Timeline (snapshot timestamps from steps 0 / 4)
- Root cause (one sentence)
- Why automation didn't catch it (pre-push, CI, healthcheck retries)
- One concrete change that would have prevented it

Don't blame humans; blame the missing safety net.

---

## Escalation

If after 15 minutes you can't classify the incident, ping the team and
state explicitly: "I cannot classify, snapshot is …, last user-visible
change was … at …". Asking earlier is always cheaper than asking later.
