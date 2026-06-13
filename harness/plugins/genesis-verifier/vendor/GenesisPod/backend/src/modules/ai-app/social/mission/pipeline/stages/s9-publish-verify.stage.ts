/**
 * Stage S9 — Publish verify (per PUBLISHED platform)
 *
 *   reads  ctx: published, platformVersions, composed, contextIds
 *   writes ctx: verified (Record<platform, PublishVerifierOutput>)
 */

import { ConcurrencyLimiter } from "@/modules/ai-harness/facade";
import type {
  MissionInvariants,
  TransformPhaseCtx,
  ComposePhaseCtx,
  PublishPhaseCtx,
  VerifyPhaseCtx,
} from "../../context/mission-context";
import type { CommonDeps } from "../../context/mission-deps";
import { narrate } from "../narrative.util";

export async function runPublishVerifyStage(
  ctx: MissionInvariants &
    TransformPhaseCtx &
    ComposePhaseCtx &
    PublishPhaseCtx &
    VerifyPhaseCtx,
  deps: CommonDeps,
): Promise<void> {
  const {
    missionId,
    userId,
    published,
    platformVersions,
    composed,
    contextIds,
    pool,
    billing,
  } = ctx;
  if (!published) return;

  const publishedPlatforms = Object.entries(published)
    .filter(
      ([, p]) =>
        (p as { status: string }).status === "PUBLISHED" &&
        (p as { draftUrl: string | null }).draftUrl != null,
    )
    .map(([platform]) => platform);

  if (publishedPlatforms.length === 0) {
    await narrate(deps.emit, missionId, userId, {
      stage: "s9-publish-verify",
      role: "publish-verifier",
      tag: "warning",
      text: `无 PUBLISHED 平台可验证`,
    });
    return;
  }

  await narrate(deps.emit, missionId, userId, {
    stage: "s9-publish-verify",
    role: "publish-verifier",
    tag: "verifying",
    text: `回读校验 ${publishedPlatforms.length} 个平台`,
  });

  const limiter = new ConcurrencyLimiter(
    Math.min(4, publishedPlatforms.length),
  );
  const verified: Record<string, unknown> = {};

  await Promise.all(
    publishedPlatforms.map((platform) =>
      limiter.run(async () => {
        const pubRow = published[platform];
        const url = (pubRow as { draftUrl: string | null }).draftUrl;
        if (!url) return;
        const version = platformVersions?.[platform];
        const composedOut = composed?.[platform];
        if (!version || !composedOut) return;
        const r = await deps.publishVerifier.run({
          input: {
            platform,
            publishedUrl: url,
            sentTitle: version.title,
            sentBodyText: composedOut.bodyHtml,
            contextId:
              contextIds[platform] ?? `social-${platform}-${missionId}`,
          },
          ctx: {
            missionId,
            userId,
            agentId: `publish-verifier-${platform}-${missionId}`,
            role: "publish-verifier",
            envAdapter: billing,
          },
          pool,
        });
        if (r.state !== "failed" && r.output) verified[platform] = r.output;
      }),
    ),
  );

  (ctx as VerifyPhaseCtx).verified = verified as VerifyPhaseCtx["verified"];

  await narrate(deps.emit, missionId, userId, {
    stage: "s9-publish-verify",
    role: "publish-verifier",
    tag: "success",
    text: `回读校验完成：${Object.keys(verified).length}/${publishedPlatforms.length}`,
  });
}
