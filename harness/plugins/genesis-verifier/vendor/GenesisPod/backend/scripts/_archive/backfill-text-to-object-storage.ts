/**
 * 通用文本 off-load 脚本：扫指定表的指定字段，上传超阈值内容到对象存储。
 *
 * 预置三个目标，命令行参数选：
 *   npx tsx scripts/backfill-text-to-object-storage.ts topic-reports
 *   npx tsx scripts/backfill-text-to-object-storage.ts dimension-analyses
 *   npx tsx scripts/backfill-text-to-object-storage.ts topic-evidences
 *
 * 可选 --dry-run 只统计不实际上传。
 * 幂等：WHERE {uri} IS NULL 过滤已迁行。
 */
/* eslint-disable no-console */

import { PrismaClient, Prisma } from "@prisma/client";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

interface Target {
  name: string;
  keyPrefix: string; // 例如 "topic-reports"
  /** 查询、选字段、更新函数（闭包里直接用 prisma） */
  list: (
    prisma: PrismaClient,
    cursor: string | undefined,
    take: number,
  ) => Promise<Array<{ id: string; content: string; version?: number }>>;
  updateUri: (
    prisma: PrismaClient,
    id: string,
    uri: string,
    size: number,
  ) => Promise<void>;
  updateSize: (prisma: PrismaClient, id: string, size: number) => Promise<void>;
  keyFor: (id: string, version?: number) => string;
  ext: string; // 文件扩展
}

const TARGETS: Record<string, Target> = {
  "topic-reports": {
    name: "topic_reports.full_report",
    keyPrefix: "topic-reports",
    ext: "md",
    list: async (p, cursor, take) => {
      const rows = await p.topicReport.findMany({
        where: {
          fullReportUri: null,
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: { id: true, version: true, fullReport: true },
        orderBy: { id: "asc" },
        take,
      });
      return rows.map((r) => ({
        id: r.id,
        content: r.fullReport ?? "",
        version: r.version,
      }));
    },
    updateUri: async (p, id, uri, size) => {
      await p.topicReport.update({
        where: { id },
        data: { fullReportUri: uri, fullReportSize: size },
      });
    },
    updateSize: async (p, id, size) => {
      await p.topicReport.update({
        where: { id },
        data: { fullReportSize: size },
      });
    },
    keyFor: (id, version) => `topic-reports/${id}/v${version ?? 1}.md`,
  },
  "dimension-analyses": {
    name: "dimension_analyses.summary",
    keyPrefix: "dimension-analyses",
    ext: "md",
    list: async (p, cursor, take) => {
      const rows = await p.dimensionAnalysis.findMany({
        where: {
          summaryUri: null,
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: { id: true, summary: true },
        orderBy: { id: "asc" },
        take,
      });
      return rows.map((r) => ({ id: r.id, content: r.summary ?? "" }));
    },
    updateUri: async (p, id, uri, size) => {
      await p.dimensionAnalysis.update({
        where: { id },
        data: { summaryUri: uri, summarySize: size },
      });
    },
    updateSize: async (p, id, size) => {
      await p.dimensionAnalysis.update({
        where: { id },
        data: { summarySize: size },
      });
    },
    keyFor: (id) => `dimension-analyses/${id}/summary.md`,
  },
  "dimension-analyses-data-points": {
    name: "dimension_analyses.data_points (JSON)",
    keyPrefix: "dimension-analyses",
    ext: "json",
    list: async (p, cursor, take) => {
      const rows = await p.dimensionAnalysis.findMany({
        where: {
          dataPointsUri: null,
          dataPoints: { not: Prisma.JsonNull },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: { id: true, dataPoints: true },
        orderBy: { id: "asc" },
        take,
      });
      return rows.map((r) => ({
        id: r.id,
        content:
          r.dataPoints === null || r.dataPoints === undefined
            ? ""
            : JSON.stringify(r.dataPoints),
      }));
    },
    updateUri: async (p, id, uri, size) => {
      await p.dimensionAnalysis.update({
        where: { id },
        data: { dataPointsUri: uri, dataPointsSize: size },
      });
    },
    updateSize: async (p, id, size) => {
      await p.dimensionAnalysis.update({
        where: { id },
        data: { dataPointsSize: size },
      });
    },
    keyFor: (id) => `dimension-analyses/${id}/data_points.json`,
  },
  "research-tasks-result": {
    name: "research_tasks.result (JSON)",
    keyPrefix: "research-tasks",
    ext: "json",
    list: async (p, cursor, take) => {
      const rows = await p.researchTask.findMany({
        where: {
          resultUri: null,
          result: { not: Prisma.JsonNull },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: { id: true, result: true },
        orderBy: { id: "asc" },
        take,
      });
      return rows.map((r) => ({
        id: r.id,
        content:
          r.result === null || r.result === undefined
            ? ""
            : JSON.stringify(r.result),
      }));
    },
    updateUri: async (p, id, uri, size) => {
      await p.researchTask.update({
        where: { id },
        data: { resultUri: uri, resultSize: size },
      });
    },
    updateSize: async (p, id, size) => {
      await p.researchTask.update({
        where: { id },
        data: { resultSize: size },
      });
    },
    keyFor: (id) => `research-tasks/${id}/result.json`,
  },
  "topic-evidences": {
    name: "topic_evidences.snippet",
    keyPrefix: "topic-evidences",
    ext: "txt",
    list: async (p, cursor, take) => {
      const rows = await p.topicEvidence.findMany({
        where: {
          snippetUri: null,
          snippet: { not: null },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: { id: true, snippet: true },
        orderBy: { id: "asc" },
        take,
      });
      return rows.map((r) => ({ id: r.id, content: r.snippet ?? "" }));
    },
    updateUri: async (p, id, uri, size) => {
      await p.topicEvidence.update({
        where: { id },
        data: { snippetUri: uri, snippetSize: size },
      });
    },
    updateSize: async (p, id, size) => {
      await p.topicEvidence.update({
        where: { id },
        data: { snippetSize: size },
      });
    },
    keyFor: (id) => `topic-evidences/${id}/snippet.txt`,
  },
};

const BATCH_SIZE = 50;
const CONCURRENCY = 4; // R2 免费档下并发放低；UnknownError 多数是并发过高导致
const OFFLOAD_THRESHOLD = 2048;
const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_HEAD_CHECK = process.argv.includes("--skip-head"); // 走不幂等、但快的 PUT-only 模式

function buildS3Client(): { client: S3Client; bucket: string } | null {
  const r2AccountId = process.env.R2_ACCOUNT_ID;
  const r2AccessKey = process.env.R2_ACCESS_KEY_ID;
  const r2Secret = process.env.R2_SECRET_ACCESS_KEY;
  const r2Bucket = process.env.R2_BUCKET_NAME;
  if (!r2AccountId || !r2AccessKey || !r2Secret || !r2Bucket) return null;
  return {
    client: new S3Client({
      region: "auto",
      endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: r2AccessKey, secretAccessKey: r2Secret },
    }),
    bucket: r2Bucket,
  };
}

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
  const targetArg = process.argv
    .slice(2)
    .find((a) => !a.startsWith("--") && TARGETS[a]);
  if (!targetArg) {
    console.error(
      `[error] usage: backfill-text-to-object-storage.ts <target> [--dry-run]`,
    );
    console.error(`  targets: ${Object.keys(TARGETS).join(", ")}`);
    process.exit(1);
  }
  const target = TARGETS[targetArg];

  const storage = buildS3Client();
  if (!storage) {
    console.error(
      "[error] R2 credentials missing (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME).",
    );
    process.exit(1);
  }
  console.log(`[init] target=${target.name} bucket=${storage.bucket}`);
  if (DRY_RUN) console.log("[init] DRY RUN");

  const prisma = new PrismaClient();

  let cursor: string | undefined;
  let migrated = 0;
  let skippedSmall = 0;
  let skippedEmpty = 0;
  let uploadedBytes = 0;
  let failed = 0;
  const startTime = Date.now();

  while (true) {
    const rows = await target.list(prisma, cursor, BATCH_SIZE);
    if (rows.length === 0) break;

    await mapPool(rows, CONCURRENCY, async (r) => {
      const byteLen = Buffer.byteLength(r.content, "utf-8");
      if (byteLen === 0) {
        skippedEmpty++;
        return;
      }
      if (byteLen < OFFLOAD_THRESHOLD) {
        if (!DRY_RUN) await target.updateSize(prisma, r.id, byteLen);
        skippedSmall++;
        return;
      }
      const key = target.keyFor(r.id, r.version);
      try {
        if (!DRY_RUN) {
          // 默认跳过 HEAD 预检（R2 并发 HEAD+PUT 容易触发 UnknownError 反而更慢）
          // 直接 PUT，重复写入对象存储是幂等的，代价仅仅是少数重复字节传输
          let exists = false;
          if (!SKIP_HEAD_CHECK) {
            try {
              await storage.client.send(
                new HeadObjectCommand({ Bucket: storage.bucket, Key: key }),
              );
              exists = true;
            } catch (error) {
              const code = (error as { name?: string })?.name;
              if (code !== "NotFound" && code !== "NoSuchKey") throw error;
            }
          }
          if (!exists) {
            await storage.client.send(
              new PutObjectCommand({
                Bucket: storage.bucket,
                Key: key,
                Body: Buffer.from(r.content, "utf-8"),
                ContentType:
                  target.ext === "md"
                    ? "text/markdown; charset=utf-8"
                    : target.ext === "json"
                      ? "application/json; charset=utf-8"
                      : "text/plain; charset=utf-8",
                Metadata: {
                  "uploaded-at": new Date().toISOString(),
                  "original-size": byteLen.toString(),
                  source: "backfill",
                },
              }),
            );
          }
          await target.updateUri(prisma, r.id, key, byteLen);
        }
        migrated++;
        uploadedBytes += byteLen;
      } catch (error) {
        failed++;
        console.error(`[fail] ${r.id}: ${(error as Error).message}`);
      }
    });

    cursor = rows[rows.length - 1].id;
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const mb = Math.round(uploadedBytes / 1024 / 1024);
    console.log(
      `[progress] migrated=${migrated} small=${skippedSmall} empty=${skippedEmpty} failed=${failed} uploaded=${mb}MB elapsed=${elapsed}s cursor=${cursor.slice(0, 8)}`,
    );
  }

  console.log("");
  console.log("=".repeat(60));
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`${target.name} Done in ${elapsed}s.`);
  console.log(
    `  Migrated=${migrated}  Small-skipped=${skippedSmall}  Empty-skipped=${skippedEmpty}  Failed=${failed}`,
  );
  console.log(`  Uploaded: ${Math.round(uploadedBytes / 1024 / 1024)} MB`);
  console.log("=".repeat(60));

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[fatal]", error);
  process.exit(1);
});
