/**
 * One-shot cleanup script for stale YouTube resources.
 *
 * Strategy: trust YouTube's oEmbed endpoint only.
 *
 *   GET https://www.youtube.com/oembed?url=<watch-url>&format=json
 *     200 → video exists, embeddable as far as oEmbed cares           → healthy
 *     400 → malformed video ID (e.g. lowercased — see history note)   → dead
 *     401 → video set private                                          → dead
 *     404 → video deleted / never existed                              → dead
 *     5xx / timeout / network error                                    → ambiguous (skip)
 *
 *   What this DOES NOT catch (oEmbed lies — returns 200 even when):
 *     - region-blocked
 *     - embedding disabled
 *     - age-restricted
 *     - copyright takedown still showing 200 oEmbed
 *
 *   Why we don't HTML-scrape playabilityStatus or use Innertube here:
 *     YouTube aggressively rate-limits non-residential IPs (Railway, my dev
 *     machine, AWS) — it serves a 429/anti-bot page, and Innertube replies
 *     with "Sign in to confirm you're not a bot". That makes server-side
 *     status checks return false-positive "dead" verdicts on healthy videos.
 *     Tested 2026-04-29 — even the Rickroll classic comes back UNPLAYABLE.
 *     If you need region/embed/age detection later, wire YouTube Data API v3
 *     (one key, free tier 10K calls/day) — that's the deterministic path.
 *
 *   Why oembed-400 is treated as dead (history note):
 *     Resources stored with lowercased video IDs (e.g. "kotam_vvnmy" instead
 *     of the case-sensitive original) — caused by deduplication.service.ts
 *     calling .toLowerCase() on the entire URL during RSS ingestion. YouTube
 *     IDs are case-sensitive, so lowercasing destroys them and oEmbed returns
 *     400. These can't be recovered (we don't know the original casing); they
 *     show "Video unavailable" in the iframe. Safe to delete.
 *
 *   Sweep scope: every Resource whose sourceUrl is on youtube.com or youtu.be
 *   (any type, not just YOUTUBE_VIDEO — BLOG/NEWS resources sometimes have
 *   YouTube canonical URLs).
 *
 *   Disposal:
 *     dead + no notes/comments  → physically delete
 *     dead + with attachments   → flip to ARCHIVED (still hidden by filter)
 *
 * Usage:
 *   railway run npx ts-node scripts/cleanup-youtube-broken.ts
 *   railway run npx ts-node scripts/cleanup-youtube-broken.ts --dry-run
 *   DATABASE_URL=postgresql://... npx ts-node scripts/cleanup-youtube-broken.ts
 *
 * Flags:
 *   --dry-run            don't write to DB, only print what would change
 *   --batch-size=200     how many resources to fetch per page (default 200)
 *   --concurrency=4      parallel oEmbed requests (default 4)
 *   --delay-ms=200       inter-batch sleep (default 200ms)
 */

import * as dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "@prisma/client";
import axios from "axios";

const prisma = new PrismaClient();

interface Args {
  dryRun: boolean;
  batchSize: number;
  concurrency: number;
  delayMs: number;
}

type Verdict = "healthy" | "dead" | "ambiguous";

interface CheckOutcome {
  verdict: Verdict;
  reason: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (key: string, def: number) => {
    const m = argv.find((a) => a.startsWith(`--${key}=`));
    return m ? Number(m.split("=")[1]) : def;
  };
  return {
    dryRun: argv.includes("--dry-run"),
    batchSize: get("batch-size", 200),
    concurrency: get("concurrency", 4),
    delayMs: get("delay-ms", 200),
  };
}

async function checkOEmbed(url: string): Promise<CheckOutcome> {
  try {
    const res = await axios.get(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { timeout: 10_000, validateStatus: () => true },
    );
    if (res.status === 200) return { verdict: "healthy", reason: "oembed-200" };
    if (res.status === 400)
      return { verdict: "dead", reason: "oembed-400-malformed-id" };
    if (res.status === 401)
      return { verdict: "dead", reason: "oembed-401-private" };
    if (res.status === 404)
      return { verdict: "dead", reason: "oembed-404-deleted" };
    return { verdict: "ambiguous", reason: `oembed-${res.status}` };
  } catch (e) {
    return {
      verdict: "ambiguous",
      reason: `oembed-err:${(e as Error).message.slice(0, 40)}`,
    };
  }
}

async function checkBatch(
  urls: Array<{ id: string; sourceUrl: string }>,
  concurrency: number,
): Promise<Map<string, CheckOutcome>> {
  const result = new Map<string, CheckOutcome>();
  for (let i = 0; i < urls.length; i += concurrency) {
    const slice = urls.slice(i, i + concurrency);
    const verdicts = await Promise.all(
      slice.map((u) => checkOEmbed(u.sourceUrl)),
    );
    slice.forEach((u, idx) => result.set(u.id, verdicts[idx]));
  }
  return result;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = parseArgs();
  console.log("=== YouTube Resource Cleanup ===");
  console.log(JSON.stringify(args, null, 2));

  // Sweep ANY Resource whose sourceUrl is on YouTube — not just type=YOUTUBE_VIDEO.
  // Some BLOG / NEWS resources have YouTube canonical URLs and they go dead too.
  // BROKEN/ARCHIVED already filtered by EXCLUDE_DEAD_LINKS — re-check them separately
  // to recover any false positives + to clean storage.
  const liveWhere = {
    OR: [
      { sourceUrl: { contains: "youtube.com" } },
      { sourceUrl: { contains: "youtu.be" } },
    ],
    AND: {
      OR: [
        { linkHealth: { in: ["HEALTHY", "UNKNOWN"] } },
        { linkHealth: null },
      ],
    },
  };
  const total = await prisma.resource.count({ where: liveWhere });
  console.log(`Found ${total} live YouTube resources to verify`);

  let cursor: string | undefined;
  let processed = 0;
  let markedBroken = 0;
  let confirmedHealthy = 0;
  let ambiguous = 0;
  const reasonCounts = new Map<string, number>();

  while (true) {
    const page = await prisma.resource.findMany({
      where: liveWhere,
      select: {
        id: true,
        sourceUrl: true,
        linkHealth: true,
        linkCheckFailCount: true,
      },
      take: args.batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });

    if (page.length === 0) break;

    const pageWithMeta = await prisma.resource.findMany({
      where: { id: { in: page.map((p) => p.id) } },
      select: { id: true, title: true, type: true },
    });
    const metaById = new Map(pageWithMeta.map((m) => [m.id, m]));

    const checkable = page.filter(
      (r): r is typeof r & { sourceUrl: string } => !!r.sourceUrl,
    );
    const verdicts = await checkBatch(
      checkable.map((r) => ({ id: r.id, sourceUrl: r.sourceUrl })),
      args.concurrency,
    );

    for (const r of checkable) {
      const out = verdicts.get(r.id);
      if (!out) continue;
      reasonCounts.set(out.reason, (reasonCounts.get(out.reason) || 0) + 1);
      const meta = metaById.get(r.id);
      if (out.verdict === "dead") {
        markedBroken++;
        if (!args.dryRun) {
          await prisma.resource.update({
            where: { id: r.id },
            data: {
              linkHealth: "BROKEN",
              lastHealthCheckAt: new Date(),
              linkCheckFailCount: r.linkCheckFailCount + 1,
            },
          });
          // 审计：记录 BROKEN 转换原因（即使后续被物理删除也保留）
          await prisma.resourceLifecycleEvent.create({
            data: {
              resourceId: r.id,
              action: "HEALTH_CHECK_BROKEN",
              reason: out.reason.slice(0, 80),
              actor: "MANUAL_SCRIPT",
              sourceUrl: r.sourceUrl,
              title: meta?.title?.slice(0, 1000) ?? null,
              type: meta?.type ?? null,
              metadata: {
                previousLinkHealth: r.linkHealth,
                failCount: r.linkCheckFailCount + 1,
              },
            },
          });
        }
      } else if (out.verdict === "healthy") {
        confirmedHealthy++;
        if (!args.dryRun && r.linkHealth !== "HEALTHY") {
          const wasRecovered = r.linkHealth === "BROKEN";
          await prisma.resource.update({
            where: { id: r.id },
            data: {
              linkHealth: "HEALTHY",
              lastHealthCheckAt: new Date(),
              linkCheckFailCount: 0,
            },
          });
          if (wasRecovered) {
            await prisma.resourceLifecycleEvent.create({
              data: {
                resourceId: r.id,
                action: "RECOVERED",
                reason: out.reason.slice(0, 80),
                actor: "MANUAL_SCRIPT",
                sourceUrl: r.sourceUrl,
                title: meta?.title?.slice(0, 1000) ?? null,
                type: meta?.type ?? null,
              },
            });
          }
        }
      } else {
        ambiguous++;
      }
    }

    processed += page.length;
    cursor = page[page.length - 1].id;
    console.log(
      `  ...progress ${processed}/${total} (broken=${markedBroken} healthy=${confirmedHealthy} ambiguous=${ambiguous})`,
    );
    await sleep(args.delayMs);
  }

  console.log("\n=== Verdict reasons ===");
  for (const [reason, count] of Array.from(reasonCounts.entries()).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  ${reason}: ${count}`);
  }

  // Sweep BROKEN pool (existing + just-marked) and split.
  const brokenAll = await prisma.resource.findMany({
    where: {
      OR: [
        { sourceUrl: { contains: "youtube.com" } },
        { sourceUrl: { contains: "youtu.be" } },
      ],
      linkHealth: "BROKEN",
    },
    select: {
      id: true,
      sourceUrl: true,
      title: true,
      type: true,
      _count: { select: { notes: true, comments: true } },
    },
  });

  const deletable = brokenAll.filter(
    (r) => r._count.notes === 0 && r._count.comments === 0,
  );
  const archivable = brokenAll.filter(
    (r) => r._count.notes > 0 || r._count.comments > 0,
  );

  console.log("\n=== Disposal plan ===");
  console.log(`  delete (BROKEN, no notes/comments): ${deletable.length}`);
  console.log(`  archive (BROKEN with attachments):  ${archivable.length}`);

  if (!args.dryRun) {
    // 先写审计事件（resource 物理删除后 lifecycle 行仍保留快照），再 deleteMany
    if (deletable.length > 0) {
      await prisma.resourceLifecycleEvent.createMany({
        data: deletable.map((r) => ({
          resourceId: r.id,
          action: "HARD_DELETED",
          reason: "orphaned-broken-no-attachments",
          actor: "MANUAL_SCRIPT",
          sourceUrl: r.sourceUrl,
          title: r.title?.slice(0, 1000) ?? null,
          type: r.type ?? null,
        })),
      });
      const del = await prisma.resource.deleteMany({
        where: { id: { in: deletable.map((r) => r.id) } },
      });
      console.log(`  deleted ${del.count} resources (lifecycle audit written)`);
    }
    if (archivable.length > 0) {
      await prisma.resourceLifecycleEvent.createMany({
        data: archivable.map((r) => ({
          resourceId: r.id,
          action: "ARCHIVED",
          reason: "broken-with-attachments-archived",
          actor: "MANUAL_SCRIPT",
          sourceUrl: r.sourceUrl,
          title: r.title?.slice(0, 1000) ?? null,
          type: r.type ?? null,
        })),
      });
      const arch = await prisma.resource.updateMany({
        where: { id: { in: archivable.map((r) => r.id) } },
        data: { linkHealth: "ARCHIVED" },
      });
      console.log(
        `  archived ${arch.count} resources (lifecycle audit written)`,
      );
    }
  } else {
    console.log("  [dry-run] no DB writes performed");
  }

  console.log("\n=== Done ===");
  console.log(
    `  processed=${processed} broken=${markedBroken} healthy=${confirmedHealthy} ambiguous=${ambiguous}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
