/**
 * Phase 2b 通用清空脚本：已 off-load 的行清空 DB 字段 + VACUUM FULL。
 *
 * 前置：
 * 1. Phase 1 完成（_uri 字段已填充）
 * 2. PrismaService hydrate middleware 对应表已部署生效
 * 3. 关键路径 canary 已验证 hydrate 正常工作
 *
 * 用法：
 *   npx tsx scripts/backfill-clear-db-content.ts <target> [--dry-run]
 *   targets: topic-reports | dimension-analyses-data-points
 */
/* eslint-disable no-console */

import { PrismaClient } from "@prisma/client";

interface Target {
  table: string;
  clearSql: string;
  countSql: string;
  uriField: string;
}

const TARGETS: Record<string, Target> = {
  "topic-reports": {
    table: "topic_reports",
    clearSql: `UPDATE topic_reports SET full_report = '' WHERE full_report_uri IS NOT NULL AND char_length(full_report) > 0`,
    countSql: `SELECT COUNT(*)::bigint AS count FROM topic_reports WHERE full_report_uri IS NOT NULL AND char_length(full_report) > 0`,
    uriField: "full_report_uri",
  },
  "dimension-analyses-data-points": {
    table: "dimension_analyses",
    clearSql: `UPDATE dimension_analyses SET data_points = NULL WHERE data_points_uri IS NOT NULL AND data_points IS NOT NULL`,
    countSql: `SELECT COUNT(*)::bigint AS count FROM dimension_analyses WHERE data_points_uri IS NOT NULL AND data_points IS NOT NULL`,
    uriField: "data_points_uri",
  },
  "research-tasks-result": {
    table: "research_tasks",
    clearSql: `UPDATE research_tasks SET result = NULL WHERE result_uri IS NOT NULL AND result IS NOT NULL`,
    countSql: `SELECT COUNT(*)::bigint AS count FROM research_tasks WHERE result_uri IS NOT NULL AND result IS NOT NULL`,
    uriField: "result_uri",
  },
};

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const targetArg = process.argv
    .slice(2)
    .find((a) => !a.startsWith("--") && TARGETS[a]);
  if (!targetArg) {
    console.error(`usage: <target> [--dry-run]`);
    console.error(`targets: ${Object.keys(TARGETS).join(", ")}`);
    process.exit(1);
  }
  const target = TARGETS[targetArg];

  const prisma = new PrismaClient();
  console.log(
    `[mode] ${DRY_RUN ? "DRY RUN" : "LIVE"}  target=${target.table}.${target.uriField}`,
  );

  const countRes = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    target.countSql,
  );
  const n = Number(countRes[0].count);
  console.log(`[stats] rows to clear: ${n}`);

  const sizeBefore = await prisma.$queryRawUnsafe<{ size: string }[]>(
    `SELECT pg_size_pretty(pg_total_relation_size('${target.table}')) AS size`,
  );
  console.log(`[size] ${target.table} before: ${sizeBefore[0].size}`);

  if (n === 0) {
    console.log("Nothing to clear.");
    await prisma.$disconnect();
    return;
  }

  if (DRY_RUN) {
    console.log(`[dry-run] would clear ${n} rows then VACUUM FULL`);
    await prisma.$disconnect();
    return;
  }

  const updated = await prisma.$executeRawUnsafe(target.clearSql);
  console.log(`[done] UPDATE affected ${updated} rows`);

  console.log(`[vacuum] VACUUM FULL ${target.table} ...`);
  const t0 = Date.now();
  await prisma.$executeRawUnsafe(`VACUUM FULL ${target.table}`);
  console.log(`[vacuum] done in ${Date.now() - t0}ms`);

  const sizeAfter = await prisma.$queryRawUnsafe<{ size: string }[]>(
    `SELECT pg_size_pretty(pg_total_relation_size('${target.table}')) AS size`,
  );
  console.log(`[size] ${target.table} after : ${sizeAfter[0].size}`);
  console.log("Phase 2b complete.");

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[fatal]", error);
  process.exit(1);
});
