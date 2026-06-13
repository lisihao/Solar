/**
 * Stage S12 — Self evolution (fire-and-forget postlude)
 *
 *   reads  ctx: 全部 phase 产物 + 失败列表
 *   writes ctx: (none — postmortem 落 FailureLearner DB)
 *
 *   非 pipeline.steps 一员；dispatcher 在 mission terminal 后 fire-and-forget
 *   触发，不阻塞用户响应。
 */

import type {
  MissionInvariants,
  PublishPhaseCtx,
  VerifyPhaseCtx,
  SignoffPhaseCtx,
} from "../../context/mission-context";
import type { CommonDeps } from "../../context/mission-deps";

export async function runSelfEvolutionStage(
  ctx: MissionInvariants & PublishPhaseCtx & VerifyPhaseCtx & SignoffPhaseCtx,
  deps: CommonDeps,
): Promise<void> {
  const { missionId, userId, published, verified, leaderSignOff } = ctx;

  // 收集 failure 给 FailureLearner
  const failures: {
    platform: string;
    reason: string;
    response: unknown;
  }[] = [];
  if (published) {
    for (const [platform, p] of Object.entries(published)) {
      const status = (p as { status: string }).status;
      if (status === "FAILED") {
        failures.push({
          platform,
          reason: "publish-failed",
          response: (p as { platformResponse: unknown }).platformResponse,
        });
      }
    }
  }

  // emit postlude 事件（schema 要求 stage:string —— 缺会被 EventBus drop）
  await deps
    .emit({
      type: "social.mission:postlude:started",
      missionId,
      userId,
      payload: {
        stage: "s12-self-evolution",
        startedAt: Date.now(),
        failureCount: failures.length,
        signed: leaderSignOff?.signoff === "signed",
        verifierGapsCount: verified
          ? Object.values(verified).filter(
              (v) => !(v as { verified: boolean }).verified,
            ).length
          : 0,
      },
    })
    .catch(() => {});

  // Fire-and-forget FailureLearner.recordFailure for each failure.
  // agentSpecId 用 "social.publish-executor" + failureCode 用 ret code label，
  // 让重复 fail 在 DB 计数，PR-5 publish-executor 接 FailurePatternKey lookup。
  for (const f of failures) {
    const ret = (f.response as { ret?: number })?.ret;
    const retLabel = typeof ret === "number" ? `ret-${ret}` : "unknown";
    void deps.failureLearner
      .recordFailure({
        key: {
          agentSpecId: "social.publish-executor",
          modelId: "*",
          systemPrompt: `publish-to-${f.platform}`,
          failureCode: retLabel,
        },
        missionId,
        userId,
        diagnostic: {
          platform: f.platform,
          response: f.response,
        },
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[${missionId}] postlude failureLearner.recordFailure threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }
}
