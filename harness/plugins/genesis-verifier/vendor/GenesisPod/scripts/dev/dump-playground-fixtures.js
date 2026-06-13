/**
 * dump-playground-fixtures.js
 *
 * Fetches real mission events from prod Railway DB and writes them as fixture
 * JSON files to frontend/__tests__/__fixtures__/playground/.
 *
 * Usage:
 *   node scripts/dump-playground-fixtures.js
 *
 * Each fixture file: {status}-{shortId}.json
 *   { mission: {...}, events: [{type, payload, agentId, traceId, timestamp}] }
 *
 * ts (BigInt) is serialised to Number (safe: mission durations << 2^53 ms).
 * payload (Json) is passed through as-is (already a JS object from Prisma).
 */

'use strict';

const path = require('path');
const fs = require('fs');

// Resolve Prisma client — lives in root node_modules (monorepo)
const { PrismaClient } = require('@prisma/client');

const DB_URL =
  'postgresql://postgres:kGEdCxDTJjobGluClMSkkAmImaXusiOI@tramway.proxy.rlwy.net:20087/railway';

const OUT_DIR = path.resolve(
  __dirname,
  '../frontend/__tests__/__fixtures__/playground'
);

// Chosen mission IDs (one per status, last-7-days, confirmed above)
const MISSIONS = [
  {
    id: 'fe9f5011-1bf9-44fc-9f3e-8e3edce1760f',
    expectedStatus: 'cancelled',
  },
  {
    id: 'af8e1b38-5ed9-4670-bbed-381f5c21e8aa',
    expectedStatus: 'failed',
  },
  {
    id: '29753565-2bcf-4c1d-9e07-d9300d6943d9',
    expectedStatus: 'completed',
  },
  {
    id: 'da6e2af7-27d6-4fdc-88ee-1177e1173808',
    expectedStatus: 'quality-failed',
  },
];

// Replacer that converts BigInt → Number for JSON.stringify
function replacer(_key, value) {
  if (typeof value === 'bigint') return Number(value);
  return value;
}

async function dumpMission(prisma, { id, expectedStatus }) {
  // Fetch mission row
  const missions = await prisma.$queryRaw`
    SELECT
      id, status, topic, depth, language,
      started_at, completed_at, wall_time_ms,
      final_score, tokens_used, cost_usd,
      theme_summary, dimensions, error_message,
      leader_signed, leader_verdict, leader_overall_score,
      report_artifact_version
    FROM agent_playground_missions
    WHERE id = ${id}
  `;

  if (!missions || missions.length === 0) {
    console.warn(`  [WARN] Mission ${id} not found — skipping`);
    return null;
  }

  const mission = missions[0];
  const status = mission.status;

  if (status !== expectedStatus) {
    console.warn(
      `  [WARN] Mission ${id} has status ${status} (expected ${expectedStatus})`
    );
  }

  // Fetch events — capped at 2500 to keep fixture files manageable
  const rows = await prisma.$queryRaw`
    SELECT
      type,
      agent_id   AS "agentId",
      trace_id   AS "traceId",
      payload,
      ts
    FROM agent_playground_mission_events
    WHERE mission_id = ${id}
    ORDER BY ts ASC
    LIMIT 2500
  `;

  const events = rows.map((r) => ({
    type: r.type,
    payload: r.payload,
    agentId: r.agentId ?? undefined,
    traceId: r.traceId ?? undefined,
    // ts is BigInt from Postgres; cast to Number (safe for epoch ms)
    timestamp: Number(r.ts),
  }));

  const fixture = { mission, events };

  const shortId = id.slice(0, 8);
  const filename = `${status}-${shortId}.json`;
  const outPath = path.join(OUT_DIR, filename);

  fs.writeFileSync(outPath, JSON.stringify(fixture, replacer, 2), 'utf8');

  console.log(
    `  [OK] ${filename}  (${events.length} events, status=${status})`
  );

  return { filename, status, eventCount: events.length, missionId: id };
}

async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: DB_URL } },
  });

  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    console.log(`Dumping fixtures to ${OUT_DIR}\n`);

    const results = [];
    for (const spec of MISSIONS) {
      const result = await dumpMission(prisma, spec);
      if (result) results.push(result);
    }

    console.log('\nSummary:');
    for (const r of results) {
      console.log(
        `  ${r.filename}  missionId=${r.missionId}  events=${r.eventCount}`
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
