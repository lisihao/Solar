#!/usr/bin/env node
/**
 * 持续监听单个 mission 的 stage / error / mission:failed 事件，每条事件输出一行。
 * 用 jsonb operator 取字段，不再依赖 regex 解析转义后的 JSON 文本。
 *
 * Usage: MISSION_ID=xxx DATABASE_URL=... node scripts/monitor-mission-events.js
 */
const { PrismaClient } = require("@prisma/client");

const MISSION_ID = process.env.MISSION_ID;
if (!MISSION_ID) {
  console.error("MISSION_ID env var required");
  process.exit(1);
}

const TYPES = [
  "agent-playground.stage:started",
  "agent-playground.stage:completed",
  "agent-playground.agent:error",
  "agent-playground.mission:failed",
  "agent-playground.mission:completed",
  "agent-playground.dimension:degraded",
  "agent-playground.dimension:retrying",
];

const prisma = new PrismaClient();
let lastId = "";

async function poll() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id::text AS id,
            type,
            agent_id,
            ts::text AS ts_str,
            payload::jsonb->>'stage' AS stage,
            payload::jsonb->>'message' AS message,
            payload::jsonb->>'failureCode' AS failure_code,
            payload::jsonb->>'dimension' AS dim,
            payload::jsonb->>'innerFailureCode' AS inner_code,
            payload::jsonb->>'reason' AS reason,
            payload::jsonb->>'state' AS state
     FROM agent_playground_mission_events
     WHERE mission_id = $1
       AND type = ANY($2::text[])
       AND ($3 = '' OR id::text > $3)
     ORDER BY ts ASC, id ASC
     LIMIT 100`,
    MISSION_ID,
    TYPES,
    lastId,
  );
  for (const r of rows) {
    // ts is stored as bigint epoch ms; format to HH:MM:SS UTC
    const tsNum = Number(r.ts_str);
    const ts = Number.isFinite(tsNum)
      ? new Date(tsNum).toISOString().slice(11, 19)
      : "??:??:??";
    const tag = r.type.replace("agent-playground.", "");
    const aid = (r.agent_id || "-").padEnd(22);
    let detail = "";
    switch (r.type) {
      case "agent-playground.stage:started":
      case "agent-playground.stage:completed":
        detail = `stage=${r.stage || "?"}${r.state ? " state=" + r.state : ""}`;
        break;
      case "agent-playground.agent:error":
        detail = `[${r.failure_code || "?"}] ${(r.message || "").slice(0, 240).replace(/\s+/g, " ")}`;
        break;
      case "agent-playground.mission:failed":
        detail = `MISSION_FAILED :: ${(r.message || "").slice(0, 240).replace(/\s+/g, " ")}`;
        break;
      case "agent-playground.mission:completed":
        detail = `MISSION_COMPLETED`;
        break;
      case "agent-playground.dimension:degraded":
        detail = `dim="${r.dim || "?"}" innerCode=${r.inner_code || "?"} reason=${r.reason || "?"}`;
        break;
      case "agent-playground.dimension:retrying":
        detail = `dim="${r.dim || "?"}" reason=${r.reason || "?"}`;
        break;
    }
    console.log(`${ts} | ${tag.padEnd(22)} | ${aid} | ${detail}`);
    lastId = String(r.id);
  }
}

(async () => {
  while (true) {
    try {
      await poll();
    } catch (e) {
      console.error("poll error:", e.message);
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
})();
