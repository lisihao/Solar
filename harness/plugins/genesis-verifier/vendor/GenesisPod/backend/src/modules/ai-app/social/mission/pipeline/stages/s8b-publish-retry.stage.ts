/**
 * Stage S8b — Publish retry (failed platforms only)
 *
 *   reads  ctx: published, retryRound
 *   writes ctx: published (overwrite failed platform results), retryRound++
 *
 *   策略：S8 失败平台 ≤ 2 次重试，按 PublishExecutor 的 retry matrix 决策
 *   （ret=2 session-expired 不重试；ret=444002/200002/64020 重试）。
 */

import { ConcurrencyLimiter } from "@/modules/ai-harness/facade";
import type {
  MissionInvariants,
  TransformPhaseCtx,
  ComposePhaseCtx,
  CraftPhaseCtx,
  PublishPhaseCtx,
} from "../../context/mission-context";
import type { CommonDeps } from "../../context/mission-deps";
import { narrate } from "../narrative.util";

const MAX_RETRY_ROUNDS = 2;

export async function runPublishRetryStage(
  ctx: MissionInvariants &
    TransformPhaseCtx &
    ComposePhaseCtx &
    CraftPhaseCtx &
    PublishPhaseCtx,
  deps: CommonDeps,
): Promise<void> {
  const {
    missionId,
    userId,
    input,
    published,
    platformVersions,
    composed,
    covers,
    retryRound,
    pool,
    billing,
  } = ctx;
  if (!published) return;

  const failedPlatforms = Object.entries(published)
    .filter(([, r]) => (r as { status: string }).status === "FAILED")
    .map(([platform]) => platform);

  if (failedPlatforms.length === 0) return;

  const currentRound = retryRound ?? {};
  const retriable = failedPlatforms.filter(
    (p) => (currentRound[p] ?? 0) < MAX_RETRY_ROUNDS,
  );
  if (retriable.length === 0) {
    await narrate(deps.emit, missionId, userId, {
      stage: "s8b-publish-retry",
      role: "publish-executor",
      tag: "warning",
      text: `${failedPlatforms.length} 个平台失败但已耗尽重试次数`,
    });
    return;
  }

  await narrate(deps.emit, missionId, userId, {
    stage: "s8b-publish-retry",
    role: "publish-executor",
    tag: "publishing",
    text: `重试 ${retriable.length} 个失败平台（max ${MAX_RETRY_ROUNDS} 轮）`,
  });

  const limiter = new ConcurrencyLimiter(Math.min(2, retriable.length));
  await Promise.all(
    retriable.map((platform) =>
      limiter.run(async () => {
        const version = platformVersions?.[platform];
        const composedOut = composed?.[platform];
        const cover = covers?.[platform];
        if (!version || !composedOut || !cover) return;
        const r = await deps.publishExecutor.run({
          input: {
            platform,
            contextId:
              ctx.contextIds[platform] ?? `social-${platform}-${missionId}`,
            platformVersion: {
              title: version.title,
              digest: version.digest ?? null,
              bodyHtml: composedOut.bodyHtml,
              coverUrl: cover.coverUrl,
              thumbMediaId: cover.thumbMediaId ?? null,
              cropMultiList: cover.cropMultiList ?? [],
            },
            connectionId: input.connectionIds[platform] ?? "",
          },
          ctx: {
            missionId,
            userId,
            agentId: `publish-executor-retry-${platform}-${missionId}`,
            role: "publish-executor",
            envAdapter: billing,
          },
          pool,
        });
        if (r.state !== "failed" && r.output) {
          (published as Record<string, unknown>)[platform] = r.output;
        }
        currentRound[platform] = (currentRound[platform] ?? 0) + 1;
      }),
    ),
  );

  (ctx as PublishPhaseCtx).retryRound = currentRound;
}
