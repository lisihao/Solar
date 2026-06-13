/**
 * Stage S8 — Mission persist (final artifact write)
 *
 *   reads  ctx: revisedChapters, qualityMetrics, extractedFacts
 *   writes ctx: writingArtifact, trajectoryStored
 *   deps:       writingPersistence.saveGeneratedContent, projector.project,
 *               store.markIntermediateState, lifecycle, emit
 *
 * Flow:
 *   1. lifecycle "started"
 *   2. projector.project(ctx) → single WritingArtifact{ sections[], metadata, quality }
 *   3. writingPersistence.saveGeneratedContent — mark FINAL chapters + update wordCount
 *   4. ctx.writingArtifact = artifact + markIntermediateState (checkpoint)
 *   5. ctx.trajectoryStored = count + markIntermediateState
 *   6. lifecycle "completed" (or "failed" on critical error)
 *   7. narrate summary
 *
 * Failure modes:
 *   - projector.project throws                      → throw (critical: no artifact)
 *   - saveGeneratedContent fails                     → markStageDegraded (soft fail;
 *                                                      artifact projection still valid)
 *   - markIntermediateState fails                    → log.warn, non-blocking
 */

import type {
  WritingMissionInvariants,
  EditPhaseCtx,
  ConsistencyPhaseCtx,
  QualityPhaseCtx,
  PersistPhaseCtx,
} from "../../context/mission-context";
import type { PersistDeps } from "../../context/mission-deps";
import { narrate } from "../narrative.util";

export async function runMissionPersistStage(
  ctx: WritingMissionInvariants &
    EditPhaseCtx &
    ConsistencyPhaseCtx &
    QualityPhaseCtx &
    PersistPhaseCtx,
  deps: PersistDeps,
): Promise<void> {
  const { missionId, userId, t0, input } = ctx;

  await deps.lifecycle(missionId, userId, "persist", "persist", "started");
  await narrate(deps.emit, missionId, userId, {
    stage: "s8-mission-persist",
    role: "persist",
    tag: "info",
    text: "开始投影 WritingArtifact 并落库最终产物",
  });

  // ── Step 1: 投影 WritingArtifact（关键路径，失败直接 throw）────────────
  let artifact: NonNullable<PersistPhaseCtx["writingArtifact"]>;
  try {
    artifact = deps.projector.project(ctx);
  } catch (err) {
    await deps.lifecycle(missionId, userId, "persist", "persist", "failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    throw new Error(
      `[s8] projector.project failed for mission ${missionId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── Step 2: 更新项目字数统计（软失败：degraded，不阻断 artifact 返回）───
  // 正文章节已在 s4（草稿）和 s6（修订）逐章落库；s8 只需刷新 project.currentWords
  // 汇总，使字数展示与最终修订章节同步。
  const revisedCount = ctx.revisedChapters?.length ?? 0;
  const totalWords = artifact.metadata.totalWords;

  try {
    await deps.writingPersistence.updateProjectWordCount(input.projectId);
  } catch (err) {
    deps.log.warn(
      `[${missionId}] s8 updateProjectWordCount failed (soft): ${err instanceof Error ? err.message : String(err)}`,
    );
    await deps.store.markStageDegraded(
      missionId,
      userId,
      "s8-mission-persist",
      `updateProjectWordCount 失败（artifact 投影仍有效）：${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
    );
  }

  // ── Step 3: 写 ctx + checkpoint（artifact）───────────────────────────
  ctx.writingArtifact = artifact;
  await deps.store
    .markIntermediateState(missionId, { writingArtifact: artifact }, userId)
    .catch((err: unknown) => {
      deps.log.warn(
        `[${missionId}] markIntermediateState(writingArtifact) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

  // ── Step 4: 写 ctx + checkpoint（trajectoryStored）───────────────────
  const wallTimeMs = Date.now() - t0;
  ctx.trajectoryStored = revisedCount;
  await deps.store
    .markIntermediateState(
      missionId,
      { trajectoryStored: revisedCount },
      userId,
    )
    .catch((err: unknown) => {
      deps.log.warn(
        `[${missionId}] markIntermediateState(trajectoryStored) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

  await deps.lifecycle(missionId, userId, "persist", "persist", "completed", {
    wallTimeMs,
    chapterCount: artifact.metadata.chapterCount,
    totalWords,
  });

  await narrate(deps.emit, missionId, userId, {
    stage: "s8-mission-persist",
    role: "persist",
    tag: "success",
    text: `Mission 产物落库完成 · ${artifact.metadata.chapterCount} 章 · ${totalWords} 字 · overall ${artifact.quality.overall.toFixed(2)} · wall ${(wallTimeMs / 1000).toFixed(1)}s`,
  });
}
