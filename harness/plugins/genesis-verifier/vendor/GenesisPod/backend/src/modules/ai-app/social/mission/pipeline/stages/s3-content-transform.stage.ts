/**
 * Stage S3 — Cross-platform content transform (parallel per platform)
 *
 *   reads  ctx: input, probeResults, billing, pool
 *   writes ctx: platformVersions (Record<platform, ContentTransformerOutput>)
 *
 *   平台并发执行，单平台失败不阻断其他平台；至少 1 个成功才进 s4。
 *   实际 rawContent 由 dispatcher 在 buildCtx 时注入 contentRaw 字段（PR-4）。
 */

import { ConcurrencyLimiter } from "@/modules/ai-harness/facade";
import type {
  MissionInvariants,
  PlanPhaseCtx,
  TransformPhaseCtx,
} from "../../context/mission-context";
import type { CommonDeps } from "../../context/mission-deps";
import { narrate } from "../narrative.util";

export async function runContentTransformStage(
  ctx: MissionInvariants & PlanPhaseCtx & TransformPhaseCtx,
  deps: CommonDeps,
): Promise<void> {
  const { missionId, userId, input, probeResults, pool, billing, contentRaw } =
    ctx;
  if (!probeResults) {
    throw new Error(`[s3] missing probeResults for mission ${missionId}`);
  }

  await narrate(deps.emit, missionId, userId, {
    stage: "s3-content-transform",
    role: "content-transformer",
    tag: "thinking",
    text: `开始为 ${input.platforms.length} 个平台适配内容`,
  });

  const limiter = new ConcurrencyLimiter(Math.min(4, input.platforms.length));
  const probeByPlatform = new Map(
    probeResults.results.map((r) => [r.platform, r]),
  );
  const versions: Record<string, unknown> = {};

  await Promise.all(
    input.platforms.map((platform) =>
      limiter.run(async () => {
        const probe = probeByPlatform.get(platform);
        if (!probe) return;
        const r = await deps.contentTransformer.run({
          input: {
            platform,
            rawContent: contentRaw,
            probeResult: {
              requiredFields: [...probe.requiredFields],
              schemaVersion: probe.schemaVersion,
            },
            qualityBar: input.depth,
          },
          ctx: {
            missionId,
            userId,
            agentId: `content-transformer-${platform}-${missionId}`,
            role: "content-transformer",
            envAdapter: billing,
          },
          pool,
        });
        if (r.state !== "failed" && r.output) {
          versions[platform] = r.output;
        } else {
          await deps.markStageDegraded(
            missionId,
            userId,
            "s3-content-transform",
            `平台 ${platform} 内容适配失败`,
          );
        }
      }),
    ),
  );

  // 2026-05-19: 全平台 transformer 失败时不 throw（之前会让 mission 完全失败）。
  //   改成 fallback：用 contentRaw 给每个平台合成最小 platformVersion，下游
  //   s4/s5/s6/s7/s8 都能 fall back 用 contentRaw（s8 publish-execute 已经支持
  //   这种 fast-path）。markStageDegraded 让前端能看到"内容适配 fallback"提示。
  if (Object.keys(versions).length === 0) {
    await deps.markStageDegraded(
      missionId,
      userId,
      "s3-content-transform",
      `全部 ${input.platforms.length} 个平台 transformer 失败，回退到 contentRaw 直发`,
    );
    for (const platform of input.platforms) {
      versions[platform] = {
        platform,
        title: contentRaw.title.slice(0, 64),
        digest: contentRaw.digest ?? null,
        body: contentRaw.body,
        lengthMetrics: {
          titleChars: contentRaw.title.length,
          digestChars: contentRaw.digest?.length ?? 0,
          bodyChars: contentRaw.body.length,
        },
      };
    }
  }

  (ctx as TransformPhaseCtx).platformVersions =
    versions as TransformPhaseCtx["platformVersions"];

  await narrate(deps.emit, missionId, userId, {
    stage: "s3-content-transform",
    role: "content-transformer",
    tag: "success",
    text: `内容适配完成：${Object.keys(versions).length}/${input.platforms.length} 个平台`,
  });
}
