/**
 * Stage S3 — Outline Plan (故事大纲规划)
 *
 * story-architect 角色经 StoryArchitectService 产生：
 *   • storyOutline （premise / theme / structure）
 *   • chapterBreakdown（逐章标题 / 大纲 / 依赖关系）
 *
 * 落库路径（两步）：
 *   1. plan_story  → storyOutline（全局架构）
 *   2. plan_volume → chapterBreakdown（卷章细化）
 * 落库走 deps.outline（OutlineService.saveOutlineToDatabase），需 prisma。
 * 当前 OutlineDeps 未含 outline/prisma，见末尾 NEEDS_DEP 上报。
 *
 *   reads  ctx: worldSettings, bibleSnapshot, input
 *   writes ctx: outlinePlan, chapterPlan
 *   checkpoint:  deps.store.markIntermediateState（双产物均落账）
 *
 * Failure modes:
 *   - StoryArchitectService.run (plan_story) state=failed   → throw（关键路径，无大纲无法写章）
 *   - StoryArchitectService.run (plan_volume) state=failed  → throw（关键路径，无章节分解无法 fanout）
 *   - output.result.storyOutline / chapterBreakdown 为空    → throw（lying-success 防护）
 *   - 落库失败（outline upsert）                            → markStageDegraded（软失败，ctx 仍有产物）
 */

import type {
  WritingMissionInvariants,
  WorldPhaseCtx,
  OutlinePhaseCtx,
} from "../../context/mission-context";
import type { OutlineDeps } from "../../context/mission-deps";
import { narrate } from "../narrative.util";
import type { InvocationContext } from "../../roles/agent-invoker.service";
import type { StoryArchitectInput } from "../../agents/story-architect.agent";
import { createWritingContextPackage } from "../../../interfaces/writing-context.interface";
import type { WritingContextPackage } from "../../../interfaces/writing-context.interface";

// ─── typing helper ──────────────────────────────────────────────────────────
type Ctx = WritingMissionInvariants & WorldPhaseCtx & OutlinePhaseCtx;

// ─── helpers ────────────────────────────────────────────────────────────────

/** bibleSnapshot → minimal WritingContextPackage（agent 只读 extensions.storyBible） */
function buildContextPackageFromSnapshot(
  snapshot: WorldPhaseCtx["bibleSnapshot"],
  projectId: string,
): WritingContextPackage {
  if (snapshot) {
    return createWritingContextPackage("story-architect", projectId, snapshot);
  }
  // bibleSnapshot 未就绪时构造最小合法包（s2 软失败兜底）
  return createWritingContextPackage("story-architect", projectId, {
    projectId,
    bibleId: "",
    bibleVersion: 0,
    snapshotAt: new Date().toISOString(),
    premise: "",
    theme: "",
    tone: "",
    worldType: "",
    characters: [],
    factions: [],
    worldSettings: [],
    terminologies: [],
    timelineEvents: [],
  });
}

// ─── stage 主函数 ────────────────────────────────────────────────────────────

export async function runOutlinePlanStage(
  ctx: Ctx,
  deps: OutlineDeps,
): Promise<void> {
  const { missionId, userId, input, pool, billing, budgetMultiplier } = ctx;
  const projectId = input.projectId;

  // deps.storyArchitect is now typed as StoryArchitectService (real class, no cast needed)
  const architect = deps.storyArchitect;

  const t0 = Date.now();

  // ─── 四件套 step 1: lifecycle started ──────────────────────────────────
  await deps.lifecycle(
    missionId,
    userId,
    "outline-plan",
    "story-architect",
    "started",
  );

  // ─── 四件套 step 2: narrate ─────────────────────────────────────────────
  await narrate(deps.emit, missionId, userId, {
    stage: "s3-outline-plan",
    role: "story-architect",
    tag: "info",
    text: `故事架构师开始规划大纲 · 项目 ${projectId}`,
  });

  // ─── 装配 contextPackage（从 bibleSnapshot 构建）──────────────────────
  const contextPackage = buildContextPackageFromSnapshot(
    ctx.bibleSnapshot,
    projectId,
  );

  const baseCtx: InvocationContext = {
    missionId,
    userId,
    agentId: "story-architect",
    role: "story-architect",
    envAdapter: billing,
    budgetMultiplier,
  };

  // ════════════════════════════════════════════════════════════════════════
  // Step A: plan_story → storyOutline
  // ════════════════════════════════════════════════════════════════════════
  const planStoryInput: StoryArchitectInput = {
    taskType: "plan_story",
    projectId,
    contextPackage,
    payload: {
      userRequirements: input.userPrompt,
    },
  };

  // pool 传给 run()，StoryArchitectService 内部调用 invoker.tickCost（无需在 stage 重复计费）
  const planStoryRes = await architect.run({
    input: planStoryInput,
    ctx: { ...baseCtx, agentId: "story-architect.plan-story" },
    pool,
  });

  const planStoryOk =
    (planStoryRes.state === "completed" || planStoryRes.state === "degraded") &&
    !!planStoryRes.output?.result?.storyOutline;

  if (!planStoryOk) {
    await deps.lifecycle(
      missionId,
      userId,
      "outline-plan",
      "story-architect",
      "failed",
      {
        wallTimeMs: Date.now() - t0,
        error: `plan_story failed or produced no storyOutline (state=${planStoryRes.state})`,
      },
    );
    throw new Error(
      `[s3] story-architect plan_story failed for mission ${missionId} (state=${planStoryRes.state})`,
    );
  }

  const storyOutline = planStoryRes.output!.result.storyOutline!;

  await narrate(deps.emit, missionId, userId, {
    stage: "s3-outline-plan",
    role: "story-architect",
    tag: "info",
    text: `故事整体架构完成 · 主题：${storyOutline.theme || "待定"} · 共 ${storyOutline.structure.length} 卷`,
  });

  // ════════════════════════════════════════════════════════════════════════
  // Step B: plan_volume → chapterBreakdown（对每卷逐一规划，首卷或单卷）
  // ════════════════════════════════════════════════════════════════════════
  // 当前实现：针对 storyOutline.structure 中第一卷（或单卷 full_story）规划章节，
  // 多卷完整支持留待 s4 fanout 阶段按需补规划（避免 s3 过重）。
  const firstVolume = storyOutline.structure[0];
  const planVolumeInput: StoryArchitectInput = {
    taskType: "plan_volume",
    projectId,
    contextPackage,
    payload: {
      volumeInfo: {
        volumeNumber: firstVolume?.volumeNumber ?? 1,
        synopsis: firstVolume?.synopsis,
        // targetChapters omitted — let architect decide based on story structure
      },
    },
  };

  // pool 传给 run()，StoryArchitectService 内部调用 invoker.tickCost（无需在 stage 重复计费）
  const planVolumeRes = await architect.run({
    input: planVolumeInput,
    ctx: { ...baseCtx, agentId: "story-architect.plan-volume" },
    pool,
  });

  const planVolumeOk =
    (planVolumeRes.state === "completed" ||
      planVolumeRes.state === "degraded") &&
    !!planVolumeRes.output?.result?.chapterBreakdown?.length;

  if (!planVolumeOk) {
    await deps.lifecycle(
      missionId,
      userId,
      "outline-plan",
      "story-architect",
      "failed",
      {
        wallTimeMs: Date.now() - t0,
        error: `plan_volume failed or produced no chapterBreakdown (state=${planVolumeRes.state})`,
      },
    );
    throw new Error(
      `[s3] story-architect plan_volume failed for mission ${missionId} (state=${planVolumeRes.state})`,
    );
  }

  const chapterBreakdown = planVolumeRes.output!.result.chapterBreakdown!;

  // ─── textProcessor 规整（章节标题清理）──────────────────────────────────
  // 去掉多余章号前缀（与 full-story.executor createOutlineStructure 一致）。
  const normalizedChapters = chapterBreakdown.map((ch) => {
    const cleaned = String(ch.title)
      .replace(/^第[一二三四五六七八九十百千\d]+[章回][：:\s]*/i, "")
      .replace(/^#{1,6}\s*/, "")
      .trim();
    return { ...ch, title: cleaned || ch.title };
  });

  // ─── 产物写 ctx ─────────────────────────────────────────────────────────
  ctx.outlinePlan = storyOutline;
  ctx.chapterPlan = normalizedChapters;

  // ─── checkpoint：持久化 outlinePlan + chapterPlan（双产物，关键路径）──
  await deps.store.markIntermediateState(
    missionId,
    { outlinePlan: storyOutline, chapterPlan: normalizedChapters },
    userId,
  );

  // ─── 落库 writingVolume / writingChapter（软失败）───────────────────────
  // deps.writingPersistence.createOutlineStructure upserts volumes + empty chapters
  // so that s4 fan-out can later fill in chapter content.
  try {
    // Map storyOutline.structure to volumes and normalizedChapters to chapters.
    // createOutlineStructure expects { core, volumes[], chapters[] }.
    const structureVolumes = storyOutline.structure.map((vol) => ({
      title: vol.title ?? `第${vol.volumeNumber}卷`,
      conflict: vol.synopsis ?? "",
      plot: vol.synopsis ?? "",
      emotion: "",
    }));

    // Assign each chapter a volumeIndex based on storyOutline.structure order.
    // chapterBreakdown items may carry a volumeNumber; fall back to volume 0.
    const volumeNumberToIndex = new Map(
      storyOutline.structure.map((v, idx) => [v.volumeNumber, idx]),
    );

    const structureChapters = normalizedChapters.map((ch) => {
      const chVolumeNumber = (ch as Record<string, unknown>)["volumeNumber"] as
        | number
        | undefined;
      const volumeIndex =
        (chVolumeNumber != null
          ? volumeNumberToIndex.get(chVolumeNumber)
          : undefined) ?? 0;
      return {
        volumeIndex,
        title: ch.title,
        plot: ch.outline ?? "",
        keyPoint: ((ch as Record<string, unknown>)["keyPoint"] as string) ?? "",
      };
    });

    await deps.writingPersistence.createOutlineStructure(projectId, {
      core: {
        summary: storyOutline.premise ?? "",
        genre: "",
        theme: storyOutline.theme ?? "",
      },
      volumes: structureVolumes,
      chapters: structureChapters,
    });

    deps.log.log(
      `[${missionId}] s3: outline persisted — ${structureVolumes.length} volumes, ${structureChapters.length} chapters`,
    );
  } catch (persistErr: unknown) {
    const reason =
      persistErr instanceof Error ? persistErr.message : String(persistErr);
    deps.log.warn(
      `[${missionId}] s3: createOutlineStructure failed (soft) — ${reason.slice(0, 300)}`,
    );
    await deps.store
      .markStageDegraded(
        missionId,
        userId,
        "s3-outline-plan",
        `outline DB persist failed: ${reason.slice(0, 200)}`,
      )
      .catch((e: unknown) => {
        deps.log.warn(
          `[${missionId}] s3 markStageDegraded failed: ${(e as Error).message}`,
        );
      });
  }

  // ─── 四件套 step 4: lifecycle completed + narrate ───────────────────────
  const wallTimeMs = Date.now() - t0;
  await deps.lifecycle(
    missionId,
    userId,
    "outline-plan",
    "story-architect",
    "completed",
    {
      wallTimeMs,
      chapterCount: normalizedChapters.length,
      volumeCount: storyOutline.structure.length,
    },
  );

  await narrate(deps.emit, missionId, userId, {
    stage: "s3-outline-plan",
    role: "story-architect",
    tag: "success",
    text: `大纲规划完成 · ${storyOutline.structure.length} 卷 · ${normalizedChapters.length} 章 · wall ${(wallTimeMs / 1000).toFixed(1)}s`,
  });
}
