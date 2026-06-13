/**
 * B2/S3 Bucket 搬家：从 SRC_BUCKET 服务端拷贝所有 object 到 DST_BUCKET。
 *
 * 用 S3 CopyObject API（服务端拷贝，不下载不上传，零 egress）。
 * 适用于同账号 / 同 endpoint 下改 bucket 名场景。
 *
 * 幂等：HeadObject 检查目标已存在则跳过；ETag 不一致时重拷贝。
 *
 * 用法：
 *   cd backend
 *   B2_KEY_ID=... B2_APP_KEY=... B2_ENDPOINT=... \
 *     SRC_BUCKET=deepdive-engine-images DST_BUCKET=genesis-storage \
 *     npx tsx scripts/copy-b2-bucket.ts [--dry-run]
 */
/* eslint-disable no-console */

import {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

const DRY_RUN = process.argv.includes("--dry-run");

const SRC_BUCKET = process.env.SRC_BUCKET;
const DST_BUCKET = process.env.DST_BUCKET;
const B2_KEY_ID = process.env.B2_KEY_ID;
const B2_APP_KEY = process.env.B2_APP_KEY;
const B2_ENDPOINT = process.env.B2_ENDPOINT;

const CONCURRENCY = 20;

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
  if (!SRC_BUCKET || !DST_BUCKET || !B2_KEY_ID || !B2_APP_KEY || !B2_ENDPOINT) {
    console.error(
      "[error] Missing env: SRC_BUCKET, DST_BUCKET, B2_KEY_ID, B2_APP_KEY, B2_ENDPOINT",
    );
    process.exit(1);
  }
  if (SRC_BUCKET === DST_BUCKET) {
    console.error("[error] SRC_BUCKET === DST_BUCKET, nothing to do");
    process.exit(1);
  }

  const regionMatch = B2_ENDPOINT.match(/s3\.([^.]+)\.backblazeb2\.com/);
  const region = regionMatch ? regionMatch[1] : "us-east-005";

  const client = new S3Client({
    region,
    endpoint: B2_ENDPOINT,
    credentials: { accessKeyId: B2_KEY_ID, secretAccessKey: B2_APP_KEY },
  });

  console.log(`[init] ${SRC_BUCKET} → ${DST_BUCKET} (region ${region})`);
  console.log(DRY_RUN ? "[init] DRY RUN — no actual copies" : "[init] LIVE");

  // 1. 枚举所有 source objects（分页）
  const allKeys: Array<{ key: string; size: number; etag: string }> = [];
  let continuationToken: string | undefined;
  while (true) {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: SRC_BUCKET,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) {
        allKeys.push({
          key: obj.Key,
          size: obj.Size ?? 0,
          etag: (obj.ETag ?? "").replace(/"/g, ""),
        });
      }
    }
    if (!res.IsTruncated) break;
    continuationToken = res.NextContinuationToken;
  }

  const totalBytes = allKeys.reduce((sum, k) => sum + k.size, 0);
  console.log(
    `[init] source has ${allKeys.length} objects, ${Math.round(totalBytes / 1024 / 1024)} MB total`,
  );

  if (DRY_RUN) {
    console.log("[dry-run] sample (first 5):");
    allKeys
      .slice(0, 5)
      .forEach((k) => console.log(`  ${k.key}  (${k.size} bytes)`));
    return;
  }

  // 2. 并发拷贝（幂等：目标 ETag 一致就跳过）
  let copied = 0;
  let skipped = 0;
  let failed = 0;
  const startTime = Date.now();

  await mapPool(allKeys, CONCURRENCY, async (item) => {
    try {
      // 检查目标是否已存在且 ETag 一致
      let exists = false;
      try {
        const head = await client.send(
          new HeadObjectCommand({ Bucket: DST_BUCKET, Key: item.key }),
        );
        const dstEtag = (head.ETag ?? "").replace(/"/g, "");
        if (dstEtag === item.etag) {
          exists = true;
        }
      } catch (error) {
        const code = (error as { name?: string })?.name;
        if (code !== "NotFound" && code !== "NoSuchKey") throw error;
      }

      if (exists) {
        skipped++;
        return;
      }

      // CopyObject: x-amz-copy-source 指定源 bucket/key（URI encoded）
      await client.send(
        new CopyObjectCommand({
          Bucket: DST_BUCKET,
          Key: item.key,
          CopySource: encodeURIComponent(`${SRC_BUCKET}/${item.key}`),
          MetadataDirective: "COPY",
        }),
      );
      copied++;
    } catch (error) {
      failed++;
      console.error(`[fail] ${item.key}: ${(error as Error).message}`);
    }
    if ((copied + skipped + failed) % 50 === 0) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(
        `[progress] copied=${copied} skipped=${skipped} failed=${failed} elapsed=${elapsed}s`,
      );
    }
  });

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log("");
  console.log("=".repeat(50));
  console.log(`Done in ${elapsed}s.`);
  console.log(`  Copied  (new)       : ${copied}`);
  console.log(`  Skipped (same ETag) : ${skipped}`);
  console.log(`  Failed              : ${failed}`);
  console.log("=".repeat(50));

  if (failed === 0) {
    console.log("");
    console.log("Next steps:");
    console.log(
      `  1. railway variables -s backend --set "B2_BUCKET_NAME=${DST_BUCKET}"`,
    );
    console.log("  2. Wait for redeploy, verify app reads from new bucket");
    console.log(
      `  3. B2 UI → delete bucket ${SRC_BUCKET} (only after verification)`,
    );
  }
}

main().catch((error) => {
  console.error("[fatal]", error);
  process.exit(1);
});
