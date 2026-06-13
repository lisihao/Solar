/**
 * Stage S8 — Publish execute (real side-effect, parallel per platform)
 *
 *   reads  ctx: platformVersions, composed, covers, polished, contextIds, input
 *          (在 fast-pipeline / depth=quick 模式下，platformVersions/composed/
 *           covers 均缺省 —— s2~s7 跳过；此时从 ctx.contentRaw 合成最小集，
 *           走 "publish-as-is" 流：标题 / 正文 HTML / 封面图 = 原内容)
 *   writes ctx: published (Record<platform, PublishExecutorOutput>)
 *
 *   ★ 唯一产生平台副作用的 stage —— 失败时上报 FailureLearner 让 S8b retry
 *     按 ret code 决定策略。
 */

import { ConcurrencyLimiter } from "@/modules/ai-harness/facade";
import type {
  MissionInvariants,
  TransformPhaseCtx,
  ComposePhaseCtx,
  CraftPhaseCtx,
  PolishPhaseCtx,
  PublishPhaseCtx,
} from "../../context/mission-context";
import type { CommonDeps } from "../../context/mission-deps";
import { narrate } from "../narrative.util";

export async function runPublishExecuteStage(
  ctx: MissionInvariants &
    TransformPhaseCtx &
    ComposePhaseCtx &
    CraftPhaseCtx &
    PolishPhaseCtx &
    PublishPhaseCtx,
  deps: CommonDeps,
): Promise<void> {
  const {
    missionId,
    userId,
    input,
    platformVersions,
    composed,
    covers,
    contextIds,
    contentRaw,
    pool,
    billing,
  } = ctx;

  // Fast-pipeline (depth=quick) skips s2-s7，所有 transform/compose/craft 输出
  // 都缺省。dispatcher 一定在 mission 启动时 hydrate contentRaw，因此可以从
  // contentRaw 直接合成 publish 入参。standard / deep 走旧路径，要求三件全到。
  const isFastPath = !platformVersions && !composed && !covers;
  if (!isFastPath && (!platformVersions || !composed || !covers)) {
    throw new Error(`[s8] missing prior phase outputs for ${missionId}`);
  }

  const platforms = isFastPath ? [...input.platforms] : Object.keys(composed!);
  await narrate(deps.emit, missionId, userId, {
    stage: "s8-publish-execute",
    role: "publish-executor",
    tag: "publishing",
    text: `开始真发 ${platforms.length} 个平台${isFastPath ? "（fast）" : ""}`,
  });

  const limiter = new ConcurrencyLimiter(Math.min(2, platforms.length));
  const published: Record<string, unknown> = {};

  await Promise.all(
    platforms.map((platform) =>
      limiter.run(async () => {
        const version = platformVersions?.[platform];
        const composedOut = composed?.[platform];
        const cover = covers?.[platform];

        // fast-path: 全部从 contentRaw 合成；standard/deep: 三件齐
        const title = version?.title ?? contentRaw.title;
        const digest = version?.digest ?? contentRaw.digest ?? null;
        const bodyHtml = composedOut?.bodyHtml ?? contentRaw.body;
        const coverUrl = cover?.coverUrl ?? contentRaw.coverImageUrl ?? "";
        const thumbMediaId = cover?.thumbMediaId ?? null;
        const cropMultiList = cover?.cropMultiList ?? [];

        if (!isFastPath && (!version || !composedOut || !cover)) return;

        // 未连接公众号/登录过期 → 不把空 connectionId 丢给适配器（只会撞模糊错误），
        // 明确告知「已生成草稿、未发布、请先连接」。草稿内容仍由 persistTaskVersions 落库。
        const connectionId = input.connectionIds[platform] ?? "";
        if (!connectionId) {
          await narrate(deps.emit, missionId, userId, {
            stage: "s8-publish-execute",
            role: "publish-executor",
            tag: "warning",
            text: `平台 ${platform} 未连接，已生成草稿但未发布——请到「连接管理」登录后在详情页发布`,
          });
          await deps.store.recordPublishLog({
            contentId: input.contentId,
            action: "PUBLISH",
            status: "FAILED",
            details: { missionId, platform, reason: "no-connection" },
            errorMessage: "平台未连接或登录已过期",
          });
          return;
        }

        const r = await deps.publishExecutor.run({
          input: {
            platform,
            contextId:
              contextIds?.[platform] ?? `social-${platform}-${missionId}`,
            platformVersion: {
              title,
              digest,
              bodyHtml,
              coverUrl,
              thumbMediaId,
              cropMultiList,
            },
            connectionId,
          },
          ctx: {
            missionId,
            userId,
            agentId: `publish-executor-${platform}-${missionId}`,
            role: "publish-executor",
            envAdapter: billing,
          },
          pool,
        });
        if (r.state !== "failed" && r.output) published[platform] = r.output;

        // PR-6 admin 历史日志兼容：W4 mission 接管后老 publish-executor.execute()
        // 路径里的 socialPublishLog.create 不再触发，必须由 s8 stage 补写一行。
        // 每个平台一次 PUBLISH 日志（SUCCESS / FAILED 两种结果）。
        const platformStatus = r.output?.status;
        const isSuccess = platformStatus === "PUBLISHED";
        await deps.store.recordPublishLog({
          contentId: input.contentId,
          action: "PUBLISH",
          status: isSuccess ? "SUCCESS" : "FAILED",
          details: {
            missionId,
            platform,
            runnerState: r.state,
            platformStatus: platformStatus ?? null,
            draftUrl: r.output?.draftUrl ?? null,
            retriedTimes: r.output?.retriedTimes ?? 0,
            wallTimeMs: r.wallTimeMs,
            iterations: r.iterations,
          },
          errorMessage: isSuccess
            ? undefined
            : `runner=${r.state}${platformStatus ? ` platform=${platformStatus}` : ""}`,
        });
      }),
    ),
  );

  (ctx as PublishPhaseCtx).published =
    published as PublishPhaseCtx["published"];

  const succeeded = Object.values(published).filter(
    (p) => (p as { status: string }).status === "PUBLISHED",
  ).length;
  await narrate(deps.emit, missionId, userId, {
    stage: "s8-publish-execute",
    role: "publish-executor",
    tag: "success",
    text: `真发完成：${succeeded}/${platforms.length} 个平台 PUBLISHED`,
  });
}
