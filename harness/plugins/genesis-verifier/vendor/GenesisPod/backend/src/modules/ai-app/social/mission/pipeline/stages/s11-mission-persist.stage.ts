/**
 * Stage S11 — Mission persist (final trajectory write)
 *
 *   reads  ctx: 全部 phase 产物
 *   writes ctx: trajectoryStored (row count written to DB)
 *
 *   2026-05-16 round-2-followup：从 mock `trajectoryStored=1` 升级到真写
 *   `social_missions.trajectory` JSON 字段（postmortem / detail 页 / cascade
 *   rerun 都靠这份）。trajectory shape 是 phase ctx 的浅拷贝，按 R2 off-load
 *   策略（trajectoryUri/trajectorySize）后续可扩展。
 */

import type { Prisma } from "@prisma/client";
import type {
  MissionInvariants,
  PlanPhaseCtx,
  TransformPhaseCtx,
  AssessPhaseCtx,
  CraftPhaseCtx,
  ComposePhaseCtx,
  PolishPhaseCtx,
  PublishPhaseCtx,
  VerifyPhaseCtx,
  SignoffPhaseCtx,
  PersistPhaseCtx,
} from "../../context/mission-context";
import type { CommonDeps } from "../../context/mission-deps";
import { narrate } from "../narrative.util";

export async function runMissionPersistStage(
  ctx: MissionInvariants &
    PlanPhaseCtx &
    TransformPhaseCtx &
    AssessPhaseCtx &
    CraftPhaseCtx &
    ComposePhaseCtx &
    PolishPhaseCtx &
    PublishPhaseCtx &
    VerifyPhaseCtx &
    SignoffPhaseCtx &
    PersistPhaseCtx,
  deps: CommonDeps,
): Promise<void> {
  const {
    missionId,
    userId,
    t0,
    leaderSignOff,
    published,
    verified,
    probeResults,
    platformVersions,
    leaderAssess,
    covers,
    composed,
    polished,
    leaderForeword,
    contentRaw,
  } = ctx;

  const finishedAt = Date.now();
  const wallTimeMs = finishedAt - t0;

  const publishedCount = published
    ? Object.values(published).filter(
        (p) => (p as { status: string }).status === "PUBLISHED",
      ).length
    : 0;
  const verifiedCount = verified ? Object.keys(verified).length : 0;
  const signed = leaderSignOff?.signoff === "signed";

  /**
   * trajectory payload —— 12-stage 产物的有损快照（不含 LLM raw thinking 等
   * 大块；前端 detail 页能据此重渲染 mission timeline + 各平台版本对比）。
   *
   * 同时持久化平台版本 / cover / composed 等业务产物，避免 mission 完成后
   * 用户回查时只剩 mission 表的 status / wallTime 等元信息。
   */
  const trajectory = {
    schemaVersion: 1,
    finalState: signed ? "signed" : published ? "concluded" : "incomplete",
    wallTimeMs,
    publishedCount,
    verifiedCount,
    probeResults: probeResults ?? null,
    platformVersions: platformVersions ?? null,
    leaderAssess: leaderAssess ?? null,
    covers: covers ?? null,
    composed: composed ?? null,
    polished: polished ?? null,
    published: published ?? null,
    verified: verified ?? null,
    leaderForeword: leaderForeword ?? null,
    leaderSignOff: leaderSignOff ?? null,
    // 原文快照 —— persistTaskVersions 的内容/封面兜底源（s3/s6 失败时报告不空）
    contentRaw: contentRaw ?? null,
  };

  try {
    // Phase ctx 是 typed structure（含 readonly 字段 / class-like 嵌套），Prisma
    // InputJsonValue 要求 plain JSON shape；走一次 round-trip 序列化把 TS
    // 类型剥成纯 JSON（同时丢掉 undefined / function / circular）。
    const jsonTrajectory = JSON.parse(
      JSON.stringify(trajectory),
    ) as Prisma.InputJsonValue;
    await deps.store.saveTrajectory(missionId, jsonTrajectory);
    (ctx as PersistPhaseCtx).trajectoryStored = 1;
  } catch (err) {
    deps.log.warn(
      `[s11] saveTrajectory failed for ${missionId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    await deps.markStageDegraded(
      missionId,
      userId,
      "s11-mission-persist",
      `trajectory 持久化失败（mission 仍 emit completed）：${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
    );
    (ctx as PersistPhaseCtx).trajectoryStored = 0;
  }

  await narrate(deps.emit, missionId, userId, {
    stage: "s11-mission-persist",
    role: "mission",
    tag: signed ? "success" : "warning",
    text: `Mission ${signed ? "signed" : "concluded"} · ${publishedCount} 平台 PUBLISHED / ${verifiedCount} 验证 · wall ${(wallTimeMs / 1000).toFixed(1)}s · trajectory ${ctx.trajectoryStored ? "saved" : "skipped"}`,
  });
}
