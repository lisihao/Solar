/**
 * Phase 2b: 清空已 off-load 的 topic_reports.full_report DB 字段 + VACUUM FULL。
 *
 * **前置条件（必须确认）：**
 * 1. Phase 1 完成：full_report_uri 字段已填充（scripts/backfill-topic-reports-to-object-storage.ts）
 * 2. Phase 2a 部署：PrismaService hydrate middleware 已上线
 *    （日志有 "[Prisma] TopicReport fullReport hydration installed"）
 * 3. Smoke test 通过：抽样 API 调用 GET /reports/latest 能正常返回 fullReport 正文
 *
 * 执行内容：
 *   UPDATE topic_reports SET full_report = ''
 *   WHERE full_report_uri IS NOT NULL AND char_length(full_report) > 0;
 *
 *   VACUUM FULL topic_reports;
 *
 * VACUUM FULL 会短暂锁表（exclusive lock），生产请避开高峰期。
 * topic_reports 只有 ~300 行，VACUUM FULL 实际执行几秒钟。
 *
 * 用法：
 *   cd backend
 *   DATABASE_URL="postgresql://..." \
 *     npx tsx scripts/backfill-topic-reports-clear-db-content.ts [--dry-run]
 */
/* eslint-disable no-console */

import { PrismaClient } from "@prisma/client";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const prisma = new PrismaClient();
  console.log(DRY_RUN ? "[mode] DRY RUN" : "[mode] LIVE");

  // 1. 状态检查：多少行 URI 有值
  const withUri = await prisma.topicReport.count({
    where: { fullReportUri: { not: null } },
  });
  const stillHasContent = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*)::bigint as count FROM topic_reports
     WHERE full_report_uri IS NOT NULL AND char_length(full_report) > 0`,
  );
  const nRowsToClear = Number(stillHasContent[0].count);

  console.log(`[stats] rows with URI                  : ${withUri}`);
  console.log(`[stats] rows URI set + DB still full   : ${nRowsToClear}`);
  console.log("");

  // 2. DB 尺寸 before
  const sizeBefore = await prisma.$queryRawUnsafe<{ size: string }[]>(
    `SELECT pg_size_pretty(pg_total_relation_size('topic_reports')) as size`,
  );
  console.log(`[size] topic_reports before: ${sizeBefore[0].size}`);

  if (nRowsToClear === 0) {
    console.log("Nothing to clear. Exiting.");
    await prisma.$disconnect();
    return;
  }

  if (DRY_RUN) {
    console.log(`[dry-run] would clear ${nRowsToClear} rows then VACUUM FULL`);
    await prisma.$disconnect();
    return;
  }

  // 3. 清空（仅限 URI 有值且还有内容的行）
  const updated = await prisma.$executeRawUnsafe(
    `UPDATE topic_reports SET full_report = ''
     WHERE full_report_uri IS NOT NULL AND char_length(full_report) > 0`,
  );
  console.log(`[done] UPDATE affected ${updated} rows`);

  // 4. VACUUM FULL 回收 TOAST 空间
  console.log(
    "[vacuum] running VACUUM FULL topic_reports (this locks table briefly)...",
  );
  const t0 = Date.now();
  await prisma.$executeRawUnsafe("VACUUM FULL topic_reports");
  console.log(`[vacuum] done in ${Date.now() - t0}ms`);

  // 5. DB 尺寸 after
  const sizeAfter = await prisma.$queryRawUnsafe<{ size: string }[]>(
    `SELECT pg_size_pretty(pg_total_relation_size('topic_reports')) as size`,
  );
  console.log(`[size] topic_reports after : ${sizeAfter[0].size}`);
  console.log("");
  console.log("Phase 2b complete. DB 空间已回收。");

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[fatal]", error);
  process.exit(1);
});
