#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Poll mission state every 20s. Output structured snapshots so monitoring
 * loop can reason about progress.
 */
const { PrismaClient } = require("@prisma/client");

const MISSION_ID = process.argv[2];
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 20000);
const MAX_MIN = Number(process.env.MAX_MIN || 35);

if (!MISSION_ID) {
  console.error("usage: monitor-mission.js <missionId>");
  process.exit(1);
}

const prisma = new PrismaClient();
const t0 = Date.now();
let lastEventCount = 0;
let lastStatus = null;

async function snapshot() {
  const mission = await prisma.$queryRawUnsafe(
    `SELECT id, status, last_completed_stage, error_message, leader_signed,
            leader_overall_score, leader_verdict, max_credits, started_at,
            completed_at, heartbeat_at, tokens_used, cost_usd,
            (SELECT COUNT(*)::int FROM agent_playground_mission_events WHERE mission_id=$1) AS event_count
       FROM agent_playground_missions WHERE id=$1`,
    MISSION_ID,
  );
  if (mission.length === 0) {
    console.log(`[${elapsed()}] mission not found yet`);
    return false;
  }
  const m = mission[0];
  const recent = await prisma.$queryRawUnsafe(
    `SELECT type, agent_id, created_at FROM agent_playground_mission_events
       WHERE mission_id=$1 ORDER BY created_at DESC LIMIT 6`,
    MISSION_ID,
  );
  const dimGraded = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM agent_playground_mission_events
       WHERE mission_id=$1 AND type='agent-playground.dimension:graded'`,
    MISSION_ID,
  );
  const errors = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM agent_playground_mission_events
       WHERE mission_id=$1 AND (type LIKE '%error%' OR type LIKE '%failed%' OR type LIKE '%aborted%' OR type LIKE '%degraded%' OR type LIKE '%rejected%')`,
    MISSION_ID,
  );

  const heartbeatAge = m.heartbeat_at
    ? Math.round((Date.now() - new Date(m.heartbeat_at).getTime()) / 1000)
    : null;
  const evDelta = m.event_count - lastEventCount;
  const statusChanged = m.status !== lastStatus;
  console.log(
    `[${elapsed()}] status=${m.status}${statusChanged ? "*" : ""} lastStage=${m.last_completed_stage ?? "-"} ` +
      `events=${m.event_count}(+${evDelta}) dimGraded=${dimGraded[0].n} errs=${errors[0].n} ` +
      `hb=${heartbeatAge ?? "?"}s tokens=${m.tokens_used ?? 0} cost=$${(m.cost_usd ?? 0).toFixed?.(4) ?? m.cost_usd} ` +
      `leaderSigned=${m.leader_signed ?? "-"}/${m.leader_overall_score ?? "-"} verdict=${m.leader_verdict ?? "-"}`,
  );
  if (recent.length > 0) {
    console.log(
      `   recent: ${recent.map((r) => r.type.replace("agent-playground.", "")).join(" → ")}`,
    );
  }
  if (m.error_message) {
    console.log(`   ERR: ${m.error_message}`);
  }
  lastEventCount = m.event_count;
  lastStatus = m.status;

  // terminal status
  if (
    ["completed", "failed", "cancelled", "quality-failed"].includes(m.status)
  ) {
    console.log(`\n=== MISSION TERMINATED status=${m.status} ===`);
    return true;
  }
  return false;
}

function elapsed() {
  const sec = Math.round((Date.now() - t0) / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

(async () => {
  console.log(`monitoring mission ${MISSION_ID}`);
  while ((Date.now() - t0) / 60000 < MAX_MIN) {
    try {
      const done = await snapshot();
      if (done) break;
    } catch (e) {
      console.log(`[${elapsed()}] poll err: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  await prisma.$disconnect();
  console.log(`\n=== monitor stopped after ${elapsed()} ===`);
})();
