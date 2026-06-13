/**
 * Backfill topic_reports.full_report → Object Storage (B2 / R2)
 *
 * 两阶段迁移的 Phase 1：dual-write。
 * - 扫所有 full_report 长度 > 2KB 且 full_report_uri 未设置的行
 * - 上传 full_report 到对象存储，key = `topic-reports/{id}/v{version}.md`
 * - 更新行：full_report_uri = key, full_report_size = byte length
 * - **保留** full_report 字段不动，读路径不变，不破坏现有逻辑
 *
 * Phase 2（单独做）：
 * - 改 read path 从 URI hydrate
 * - 二次 backfill 清空 full_report 字段
 * - VACUUM FULL topic_reports
 *
 * 用法：
 *   cd backend
 *   DATABASE_URL="postgresql://..." \
 *     B2_KEY_ID=... B2_APP_KEY=... B2_ENDPOINT=... B2_BUCKET_NAME=... \
 *     npx tsx scripts/backfill-topic-reports-to-object-storage.ts [--dry-run]
 *
 * 幂等：WHERE full_report_uri IS NULL 过滤已迁的行；可反复跑。
 */
/* eslint-disable no-console */

import { PrismaClient } from "@prisma/client";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

// ========== 配置 ==========
const BATCH_SIZE = 50; // 每批拉 50 条
const CONCURRENCY = 8; // 每批 8 路并发上传
const OFFLOAD_THRESHOLD = 2048; // 小于 2KB 不迁（round-trip 不划算）

const DRY_RUN = process.argv.includes("--dry-run");

// ========== 对象存储客户端 ==========
function buildS3Client(): { client: S3Client; bucket: string } | null {
  const b2KeyId = process.env.B2_KEY_ID;
  const b2AppKey = process.env.B2_APP_KEY;
  const b2Endpoint = process.env.B2_ENDPOINT;
  const b2Bucket = process.env.B2_BUCKET_NAME;
  if (b2KeyId && b2AppKey && b2Endpoint && b2Bucket) {
    const regionMatch = b2Endpoint.match(/s3\.([^.]+)\.backblazeb2\.com/);
    const region = regionMatch ? regionMatch[1] : "us-west-004";
    return {
      client: new S3Client({
        region,
        endpoint: b2Endpoint,
        credentials: { accessKeyId: b2KeyId, secretAccessKey: b2AppKey },
      }),
      bucket: b2Bucket,
    };
  }

  const r2AccountId = process.env.R2_ACCOUNT_ID;
  const r2AccessKey = process.env.R2_ACCESS_KEY_ID;
  const r2Secret = process.env.R2_SECRET_ACCESS_KEY;
  const r2Bucket = process.env.R2_BUCKET_NAME;
  if (r2AccountId && r2AccessKey && r2Secret && r2Bucket) {
    return {
      client: new S3Client({
        region: "auto",
        endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: r2AccessKey, secretAccessKey: r2Secret },
      }),
      bucket: r2Bucket,
    };
  }
  return null;
}

async function headExists(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    const code = (error as { name?: string })?.name;
    if (code === "NotFound" || code === "NoSuchKey") return false;
    throw error;
  }
}

async function uploadOne(
  client: S3Client,
  bucket: string,
  key: string,
  content: string,
): Promise<number> {
  const buffer = Buffer.from(content, "utf-8");
  if (DRY_RUN) return buffer.length;
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: "text/markdown; charset=utf-8",
      Metadata: {
        "uploaded-at": new Date().toISOString(),
        "original-size": buffer.length.toString(),
        source: "backfill",
      },
    }),
  );
  return buffer.length;
}

// 简单并发控制：n 路池子轮转
async function mapPool<T, R>(
  items: T[],
  n: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from(
    { length: Math.min(n, items.length) },
    async () => {
      while (true) {
        const my = idx++;
        if (my >= items.length) return;
        results[my] = await fn(items[my]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function main() {
  const storage = buildS3Client();
  if (!storage) {
    console.error(
      "[error] No object storage credentials found. Set B2_* or R2_* env vars.",
    );
    process.exit(1);
  }
  console.log(`[init] storage ready, bucket=${storage.bucket}`);
  if (DRY_RUN)
    console.log("[init] DRY RUN mode — no actual uploads or DB writes");

  const prisma = new PrismaClient();

  // 先统计总量
  const totalCandidates = await prisma.topicReport.count({
    where: { fullReportUri: null },
  });
  console.log(`[init] candidates (fullReportUri IS NULL): ${totalCandidates}`);

  let cursor: string | undefined;
  let migrated = 0;
  let skippedSmall = 0;
  let skippedEmpty = 0;
  let uploadedBytes = 0;
  let uploadFailed = 0;
  const startTime = Date.now();

  while (true) {
    const rows = await prisma.topicReport.findMany({
      where: {
        fullReportUri: null,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: {
        id: true,
        version: true,
        fullReport: true,
      },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });
    if (rows.length === 0) break;

    await mapPool(rows, CONCURRENCY, async (r) => {
      const content = r.fullReport ?? "";
      const byteLen = Buffer.byteLength(content, "utf-8");

      if (byteLen === 0) {
        skippedEmpty++;
        return;
      }
      if (byteLen < OFFLOAD_THRESHOLD) {
        // 也打标记但 size 记录，避免每次扫描都考察它
        if (!DRY_RUN) {
          await prisma.topicReport.update({
            where: { id: r.id },
            data: { fullReportSize: byteLen },
          });
        }
        skippedSmall++;
        return;
      }

      const key = `topic-reports/${r.id}/v${r.version}.md`;
      try {
        // 已上传过（异常中断恢复时遇到）→ 只更新 DB
        const alreadyExists = DRY_RUN
          ? false
          : await headExists(storage.client, storage.bucket, key);
        if (!alreadyExists) {
          await uploadOne(storage.client, storage.bucket, key, content);
        }
        if (!DRY_RUN) {
          await prisma.topicReport.update({
            where: { id: r.id },
            data: { fullReportUri: key, fullReportSize: byteLen },
          });
        }
        migrated++;
        uploadedBytes += byteLen;
      } catch (error) {
        uploadFailed++;
        console.error(
          `[fail] ${r.id} v${r.version}: ${(error as Error).message}`,
        );
      }
    });

    cursor = rows[rows.length - 1].id;
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const mb = Math.round(uploadedBytes / 1024 / 1024);
    console.log(
      `[progress] migrated=${migrated} smallSkipped=${skippedSmall} emptySkipped=${skippedEmpty} failed=${uploadFailed} uploaded=${mb}MB elapsed=${elapsed}s cursor=${cursor.slice(0, 8)}`,
    );
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const mb = Math.round(uploadedBytes / 1024 / 1024);
  console.log("");
  console.log("=".repeat(60));
  console.log(`Done in ${elapsed}s.`);
  console.log(`  Migrated (URI 已设置): ${migrated}`);
  console.log(`  Skipped (too small)  : ${skippedSmall}`);
  console.log(`  Skipped (empty)      : ${skippedEmpty}`);
  console.log(`  Failed               : ${uploadFailed}`);
  console.log(`  Uploaded total       : ${mb} MB`);
  console.log("=".repeat(60));
  console.log("");
  console.log(
    "Phase 1 (dual-write) complete. DB 空间暂未减少——等 Phase 2 切换 read path 后做二次 backfill 清空 full_report 字段。",
  );

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[fatal]", error);
  process.exit(1);
});
