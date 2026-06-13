/**
 * Stage S10 — Leader M6 foreword + M7 signoff
 *
 *   reads  ctx: platformVersions, published, verified
 *   writes ctx: leaderForeword, leaderSignOff
 */

import type {
  MissionInvariants,
  TransformPhaseCtx,
  PublishPhaseCtx,
  VerifyPhaseCtx,
  SignoffPhaseCtx,
} from "../../context/mission-context";
import type { CommonDeps } from "../../context/mission-deps";
import { narrate } from "../narrative.util";

export async function runLeaderSignoffStage(
  ctx: MissionInvariants &
    TransformPhaseCtx &
    PublishPhaseCtx &
    VerifyPhaseCtx &
    SignoffPhaseCtx,
  deps: CommonDeps,
): Promise<void> {
  const {
    missionId,
    userId,
    platformVersions,
    published,
    verified,
    pool,
    billing,
  } = ctx;
  if (!platformVersions) {
    throw new Error(`[s10] missing platformVersions for ${missionId}`);
  }

  // M6 foreword
  await narrate(deps.emit, missionId, userId, {
    stage: "s10-leader-signoff",
    role: "leader",
    tag: "writing",
    text: `Leader 撰写发布前总览（M6 foreword）`,
  });

  const versionsArr = Object.values(platformVersions).map((v) => ({
    platform: v.platform,
    title: v.title,
    digest: v.digest ?? undefined,
    body: v.body,
    lengthMetrics: v.lengthMetrics,
  }));

  const forewordResult = await deps.leader.run({
    input: { phase: "foreword", platformVersions: versionsArr, risks: [] },
    ctx: {
      missionId,
      userId,
      agentId: `leader-${missionId}`,
      role: "leader",
      envAdapter: billing,
    },
    pool,
  });
  if (
    forewordResult.state !== "failed" &&
    forewordResult.output?.phase === "foreword"
  ) {
    (ctx as SignoffPhaseCtx).leaderForeword = {
      ...forewordResult.output,
      generatedAt: new Date().toISOString(),
    };
  }

  // M7 signoff
  await narrate(deps.emit, missionId, userId, {
    stage: "s10-leader-signoff",
    role: "leader",
    tag: "signing",
    text: `Leader 签字交付（M7 signoff）`,
  });

  // 2026-05-19: status enum 加 'DRAFT' —— publish-executor 实际返 DRAFT（公众号
  //   发布到草稿箱），之前 inline type 漏了 DRAFT → Leader signoff input schema
  //   validation fail "Invalid enum value, received 'DRAFT'" → mission 终止。
  type PlatformStatus = "PUBLISHED" | "DRAFT" | "FAILED" | "DEGRADED";
  const platformResults: {
    platform: string;
    status: PlatformStatus;
    url: string | null;
    verifierDiff: number | null;
  }[] = [];
  for (const [platform] of Object.entries(platformVersions)) {
    const pub = published?.[platform];
    const ver = verified?.[platform];
    platformResults.push({
      platform,
      status: (pub as { status?: PlatformStatus })?.status ?? "FAILED",
      url: (pub as { draftUrl?: string | null })?.draftUrl ?? null,
      verifierDiff:
        ver != null ? (ver as { diffPercent: number }).diffPercent / 100 : null,
    });
  }

  const signoffResult = await deps.leader.run({
    input: { phase: "signoff", platformResults },
    ctx: {
      missionId,
      userId,
      agentId: `leader-${missionId}`,
      role: "leader",
      envAdapter: billing,
    },
    pool,
  });
  if (
    signoffResult.state !== "failed" &&
    signoffResult.output?.phase === "signoff"
  ) {
    (ctx as SignoffPhaseCtx).leaderSignOff = signoffResult.output;
    await narrate(deps.emit, missionId, userId, {
      stage: "s10-leader-signoff",
      role: "leader",
      tag: signoffResult.output.signoff === "signed" ? "success" : "warning",
      text: `Leader ${signoffResult.output.signoff} · score=${signoffResult.output.overallScore}`,
    });
  }
}
