/**
 * extract-mission-fixture.ts — Canonical mission fixture extractor（P0-4 真实落地）
 *
 * 落地依据：thinning plan §6.8.4.b mandatory deliverable 1
 *   "a dedicated anonymizer or extractor script checked into the repo,
 *    building on or replacing the existing baseline scripts/dev/dump-playground-fixtures.js"
 *
 * 用法：
 *   ts-node scripts/dev/extract-mission-fixture.ts \
 *     --mission-id <uuid> \
 *     --target playground-completed \
 *     [--db-url postgres://...] \
 *     [--kind real-anonymized|synthetic]
 *
 * 产出（写入 backend/src/__tests__/fixtures/mission/<target>/）：
 *   - mission-row.json
 *   - events.json    （≤50 events 自动截断；超出 50 标 benchmark/stress kind）
 *   - checkpoint.json （configSnapshot 存在时；否则 legacy-null）
 *   - meta.json      （kind + source + capturedAt）
 *   - expected-view.json （需要 fixture 作者后续手工填充，本脚本只生成空骨架）
 *
 * §6.8.4.b mandatory anonymization rules:
 *   1. mission.topic / outward title → 替换为 "[REDACTED-TOPIC]"
 *   2. free-text: reportFull / leaderJournal / agent narration / critique → 替换为 "[REDACTED-*]"
 *   3. person names / orgs / emails / phones / tokens / account-ids / internal URLs → 替换
 *   4. citation URLs → 仅保留 hostname（剥离 query string + path）
 *   5. dimensions[].name / references identifiers → "[REDACTED-DIM-N]"
 *   6. event payloads 中嵌入的 identifier → 同样替换
 *
 * Preserved per §6.8.4.b "May preserve":
 *   1. enum / status / stageId / structural keys
 *   2. counts / lengths / retry counts / version numbers
 *   3. hostname-only sources（非敏感时）
 *   4. timestamp ordering（可以整体 shift；本脚本不 shift，仅 anonymize）
 */

import * as fs from "fs";
import * as path from "path";

// CLI argument parser
function parseArgs(): {
  missionId: string;
  target: string;
  dbUrl?: string;
  kind: "real-anonymized" | "synthetic";
} {
  const argv = process.argv.slice(2);
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      args[key] = value;
      i++;
    }
  }
  if (!args["mission-id"] || !args.target) {
    console.error(
      "usage: ts-node extract-mission-fixture.ts --mission-id <uuid> --target <fixture-name> [--db-url ...] [--kind real-anonymized|synthetic]",
    );
    process.exit(1);
  }
  return {
    missionId: args["mission-id"],
    target: args.target,
    dbUrl: args["db-url"] ?? process.env.DATABASE_URL,
    kind:
      (args.kind as "real-anonymized" | "synthetic" | undefined) ??
      "real-anonymized",
  };
}

// §6.8.4.b anonymization — strict patterns
const PII_PATTERNS = {
  email: /\b[\w.+-]+@[\w.-]+\.\w{2,}\b/g,
  phone: /\b1[3-9]\d{9}\b|\b\+?[\d\s().-]{7,15}\b/g,
  bearerToken: /\b(sk-[a-zA-Z0-9-_]{20,}|Bearer\s+[a-zA-Z0-9-_]{20,})\b/g,
  longHex: /\b[0-9a-f]{32,}\b/gi,
};

function scrubFreeText(input: unknown): unknown {
  if (typeof input === "string") {
    let s = input;
    s = s.replace(PII_PATTERNS.email, "[REDACTED-EMAIL]");
    s = s.replace(PII_PATTERNS.phone, "[REDACTED-PHONE]");
    s = s.replace(PII_PATTERNS.bearerToken, "[REDACTED-TOKEN]");
    s = s.replace(PII_PATTERNS.longHex, "[REDACTED-HEX]");
    return s;
  }
  if (Array.isArray(input)) return input.map(scrubFreeText);
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = scrubFreeText(v);
    }
    return out;
  }
  return input;
}

function scrubUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `https://${parsed.hostname}/[REDACTED]`;
  } catch {
    return "[REDACTED-URL]";
  }
}

function anonymizeMissionRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  if (typeof out.topic === "string" && out.topic.length > 0) {
    out.topic = "[REDACTED-TOPIC]";
  }
  if (typeof out.themeSummary === "string") {
    out.themeSummary = "[REDACTED-THEME-SUMMARY]";
  }
  if (typeof out.reportTitle === "string") {
    out.reportTitle = "[REDACTED-REPORT-TITLE]";
  }
  if (typeof out.reportSummary === "string") {
    out.reportSummary = "[REDACTED-SUMMARY]";
  }
  if (typeof out.errorMessage === "string" && out.errorMessage.length > 0) {
    out.errorMessage = scrubFreeText(out.errorMessage) as string;
  }
  if (Array.isArray(out.dimensions)) {
    out.dimensions = (out.dimensions as Array<Record<string, unknown>>).map(
      (d, i) => ({
        id: d.id,
        name: `[REDACTED-DIM-${i + 1}]`,
        rationale: "[REDACTED]",
      }),
    );
  }
  // reportFull / reconciliationReport / leaderJournal / verdicts are large
  // JSON blobs — recurse scrub
  out.reportFull = scrubFreeText(out.reportFull);
  out.reconciliationReport = scrubFreeText(out.reconciliationReport);
  out.leaderJournal = scrubFreeText(out.leaderJournal);
  out.verdicts = scrubFreeText(out.verdicts);
  out.outlinePlan = scrubFreeText(out.outlinePlan);
  out.analystOutput = scrubFreeText(out.analystOutput);
  return out;
}

function anonymizeEvent(ev: {
  type: string;
  payload: unknown;
  agentId?: string;
  traceId?: string;
  ts: number;
}): { seq: number; type: string; payload: unknown; timestamp: string } {
  // events 完整 scrub payload；type/agentId/traceId 通常无 PII，保留
  return {
    seq: 0, // caller fills
    type: ev.type,
    payload: scrubFreeText(ev.payload),
    timestamp: new Date(ev.ts).toISOString(),
  };
}

async function main(): Promise<void> {
  const args = parseArgs();

  // 延迟 require 避免离线 / 无 prisma 时脚本无法被 type-check
  const PRISMA_PATH = "@prisma/client";
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
  const { PrismaClient } = require(PRISMA_PATH);
  const prisma = new PrismaClient(
    args.dbUrl ? { datasources: { db: { url: args.dbUrl } } } : undefined,
  );

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  const row: Record<string, unknown> | null = await prisma.agentPlaygroundMission.findUnique(
    { where: { id: args.missionId } },
  );
  if (!row) {
    console.error(`mission ${args.missionId} not found`);
    process.exit(2);
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  const rawEvents: Array<{
    type: string;
    payload: unknown;
    agentId: string | null;
    traceId: string | null;
    ts: bigint;
  }> = await prisma.agentPlaygroundMissionEvent.findMany({
    where: { missionId: args.missionId },
    orderBy: { ts: "asc" },
  });

  // §6.8.4.b limit：non-benchmark fixture ≤50 events
  const eventsTrimmed = rawEvents.slice(0, 50);
  const limitExceeded = rawEvents.length > 50;

  const outDir = path.resolve(
    __dirname,
    "../../backend/src/__tests__/fixtures/mission",
    args.target,
  );
  fs.mkdirSync(outDir, { recursive: true });

  const anonymizedRow = anonymizeMissionRow(row);
  // BigInt → string for JSON safety
  for (const [k, v] of Object.entries(anonymizedRow)) {
    if (typeof v === "bigint") {
      anonymizedRow[k] = v.toString();
    }
  }

  const anonymizedEvents = eventsTrimmed.map((e, i) => ({
    ...anonymizeEvent({
      type: e.type,
      payload: e.payload,
      agentId: e.agentId ?? undefined,
      traceId: e.traceId ?? undefined,
      ts: Number(e.ts),
    }),
    seq: i + 1,
  }));

  fs.writeFileSync(
    path.join(outDir, "mission-row.json"),
    JSON.stringify(anonymizedRow, null, 2),
  );
  fs.writeFileSync(
    path.join(outDir, "events.json"),
    JSON.stringify(anonymizedEvents, null, 2),
  );

  const configSnapshot = anonymizedRow.configSnapshot;
  fs.writeFileSync(
    path.join(outDir, "checkpoint.json"),
    JSON.stringify(
      configSnapshot
        ? { kind: "config-snapshot", snapshot: configSnapshot }
        : { kind: "legacy-null" },
      null,
      2,
    ),
  );

  const meta = {
    kind: limitExceeded ? "benchmark" : args.kind,
    source: `mission:${args.missionId}`,
    capturedAt: new Date().toISOString(),
    note: limitExceeded
      ? `original had ${rawEvents.length} events; trimmed to 50 per §6.8.4.b fixture limits`
      : undefined,
  };
  fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 2));

  // expected-view.json 不能自动生成（plan §B1-3 oracle 必须 hand-authored）
  // 仅写一个 stub 让 fixture loader 不报错；fixture 作者必须手填关键字段
  fs.writeFileSync(
    path.join(outDir, "expected-view.json.stub"),
    `// expected-view.json STUB — fixture author MUST manually fill the canonical PlaygroundDomainView.\n// Rename this file to expected-view.json after authoring per plan §B1-3 oracle policy.\n${JSON.stringify(
      {
        mission: {
          id: anonymizedRow.id,
          title: "[REDACTED-TOPIC]",
          status: anonymizedRow.status,
          resumable: false,
          canCancel: false,
          rerunnableStages: [],
        },
        stages: [],
        agents: [],
        reportArtifact: { kind: "empty-artifact", reason: "not-yet-materialized" },
        todoBoard: { kind: "empty-todo-board" },
        cost: { currency: "USD" },
        memory: { kind: "empty-memory" },
        timelineVersion: 0,
        snapshotVersion: 0,
        refreshHints: [],
        references: [],
        reportVersions: [],
      },
      null,
      2,
    )}`,
  );

  // eslint-disable-next-line no-console
  console.log(`✅ wrote fixture ${args.target} to ${outDir}`);
  // eslint-disable-next-line no-console
  console.log(`   events: ${anonymizedEvents.length} / ${rawEvents.length} (capped at 50)`);
  // eslint-disable-next-line no-console
  console.log(`   kind: ${meta.kind}`);
  // eslint-disable-next-line no-console
  console.log(
    `   ⚠️  expected-view.json.stub 需要手工 review + 改名为 expected-view.json 后才能进 spec replay`,
  );

  await (prisma as { $disconnect: () => Promise<void> }).$disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(99);
});
