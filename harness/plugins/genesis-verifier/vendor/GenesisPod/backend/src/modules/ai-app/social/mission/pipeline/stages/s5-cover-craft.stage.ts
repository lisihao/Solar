/**
 * Stage S5 — Cover craft (parallel per platform)
 *
 *   reads  ctx: platformVersions, leaderAssess（reject 平台跳过）, input
 *   writes ctx: covers (Record<platform, CoverArtistOutput>)
 */

import { ConcurrencyLimiter } from "@/modules/ai-harness/facade";
import type {
  MissionInvariants,
  TransformPhaseCtx,
  AssessPhaseCtx,
  CraftPhaseCtx,
} from "../../context/mission-context";
import type { CommonDeps } from "../../context/mission-deps";
import { narrate } from "../narrative.util";

export async function runCoverCraftStage(
  ctx: MissionInvariants & TransformPhaseCtx & AssessPhaseCtx & CraftPhaseCtx,
  deps: CommonDeps,
): Promise<void> {
  const {
    missionId,
    userId,
    input,
    platformVersions,
    leaderAssess,
    contentRaw,
    pool,
    billing,
  } = ctx;
  if (!platformVersions) {
    throw new Error(`[s5] missing platformVersions for ${missionId}`);
  }

  const acceptedPlatforms = new Set(
    (leaderAssess?.perPlatform ?? [])
      .filter((p) => p.verdict !== "reject")
      .map((p) => p.platform),
  );
  // 2026-05-19: Leader 全 reject 时（acceptedPlatforms 为空集），不跳过整个
  //   stage —— 否则 covers 全空 → s8 publish-execute 撞 "missing covers" throw。
  //   退化到"处理所有 platformVersions"让 mission 能跑到底，最终发布把关交 s10
  //   foreword/signoff。
  const platformsToProcess =
    leaderAssess == null || acceptedPlatforms.size === 0
      ? Object.keys(platformVersions)
      : Object.keys(platformVersions).filter((p) => acceptedPlatforms.has(p));

  if (platformsToProcess.length === 0) {
    deps.log.warn(`[s5] no platforms to process for ${missionId}`);
    return;
  }

  await narrate(deps.emit, missionId, userId, {
    stage: "s5-cover-craft",
    role: "cover-artist",
    tag: "writing",
    text: `为 ${platformsToProcess.length} 个平台生成封面`,
  });

  const firstBodyImg =
    contentRaw.body.match(/<img[^>]+src="([^"]+)"/)?.[1] ?? null;
  const limiter = new ConcurrencyLimiter(
    Math.min(4, platformsToProcess.length),
  );
  const covers: Record<string, unknown> = {};

  await Promise.all(
    platformsToProcess.map((platform) =>
      limiter.run(async () => {
        const r = await deps.coverArtist.run({
          input: {
            platform,
            title: platformVersions[platform].title,
            contentId: input.contentId,
            userProvidedCoverUrl: contentRaw.coverImageUrl,
            bodyFirstImgUrl: firstBodyImg,
            imageGenerationAllowed: input.budgetProfile === "rich",
          },
          ctx: {
            missionId,
            userId,
            agentId: `cover-artist-${platform}-${missionId}`,
            role: "cover-artist",
            envAdapter: billing,
          },
          pool,
        });
        if (r.state !== "failed" && r.output) {
          covers[platform] = r.output;
        } else {
          await deps.markStageDegraded(
            missionId,
            userId,
            "s5-cover-craft",
            `平台 ${platform} 封面生成失败`,
          );
        }
      }),
    ),
  );

  (ctx as CraftPhaseCtx).covers = covers as CraftPhaseCtx["covers"];

  await narrate(deps.emit, missionId, userId, {
    stage: "s5-cover-craft",
    role: "cover-artist",
    tag: "success",
    text: `封面生成完成：${Object.keys(covers).length}/${platformsToProcess.length}`,
  });
}
