/**
 * Stage S6 — Body HTML schema compose (parallel per platform)
 *
 *   reads  ctx: platformVersions, contextIds, leaderAssess
 *   writes ctx: composed (Record<platform, ComposerOutput>)
 */

import { ConcurrencyLimiter } from "@/modules/ai-harness/facade";
import type {
  MissionInvariants,
  TransformPhaseCtx,
  AssessPhaseCtx,
  ComposePhaseCtx,
} from "../../context/mission-context";
import type { CommonDeps } from "../../context/mission-deps";
import { narrate } from "../narrative.util";

export async function runBodyComposeStage(
  ctx: MissionInvariants & TransformPhaseCtx & AssessPhaseCtx & ComposePhaseCtx,
  deps: CommonDeps,
): Promise<void> {
  const {
    missionId,
    userId,
    platformVersions,
    contextIds,
    leaderAssess,
    pool,
    billing,
  } = ctx;
  if (!platformVersions) {
    throw new Error(`[s6] missing platformVersions for ${missionId}`);
  }

  const acceptedPlatforms = new Set(
    (leaderAssess?.perPlatform ?? [])
      .filter((p) => p.verdict !== "reject")
      .map((p) => p.platform),
  );
  // 2026-05-19: Leader 全 reject 时 fallback 处理所有平台（同 s5），避免 s8
  //   publish-execute 撞 missing composed throw
  const platformsToProcess =
    leaderAssess == null || acceptedPlatforms.size === 0
      ? Object.keys(platformVersions)
      : Object.keys(platformVersions).filter((p) => acceptedPlatforms.has(p));

  await narrate(deps.emit, missionId, userId, {
    stage: "s6-body-compose",
    role: "composer",
    tag: "writing",
    text: `为 ${platformsToProcess.length} 个平台编排正文 HTML schema`,
  });

  const limiter = new ConcurrencyLimiter(
    Math.min(4, platformsToProcess.length),
  );
  const composed: Record<string, unknown> = {};

  await Promise.all(
    platformsToProcess.map((platform) =>
      limiter.run(async () => {
        const r = await deps.composer.run({
          input: {
            platform,
            body: platformVersions[platform].body,
            contextId:
              contextIds[platform] ?? `social-${platform}-${missionId}`,
          },
          ctx: {
            missionId,
            userId,
            agentId: `composer-${platform}-${missionId}`,
            role: "composer",
            envAdapter: billing,
          },
          pool,
        });
        if (r.state !== "failed" && r.output) {
          composed[platform] = r.output;
        } else {
          await deps.markStageDegraded(
            missionId,
            userId,
            "s6-body-compose",
            `平台 ${platform} 正文 schema 注入失败`,
          );
        }
      }),
    ),
  );

  (ctx as ComposePhaseCtx).composed = composed as ComposePhaseCtx["composed"];

  await narrate(deps.emit, missionId, userId, {
    stage: "s6-body-compose",
    role: "composer",
    tag: "success",
    text: `正文 HTML 注入完成：${Object.keys(composed).length}/${platformsToProcess.length}`,
  });
}
