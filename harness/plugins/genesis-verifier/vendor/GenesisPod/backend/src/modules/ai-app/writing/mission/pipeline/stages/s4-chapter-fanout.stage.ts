/**
 * Stage S4 — Chapter Fan-out (逐章并行写作)
 *
 * 本迁移最高风险 stage（设计文档 §1.4 / §4.1）。
 *
 * 三件核心事：
 * 1) 逐章 fan-out：ChapterDependencyService.analyze(chapterPlan) → 依赖图
 *    → ParallelOrchestratorService.generateExecutionPlan(graph, maxParallel) 分轮
 *    → 每轮 Promise.all 并发写作。
 *
 * 2) 竞态安全：每轮 Promise.all 收集完所有章节结果后**统一**写回 ctx.chapterDrafts /
 *    ctx.chapterFailures，不允许每章各自写 ctx 数组（防数组竞态，设计文档 §4.1）。
 *
 * 3) abort + 软失败 + 逐章 checkpoint：
 *    - 每轮开头检查 ctx.signal?.aborted → 抛 StageAbortError 立即终止。
 *    - 单章失败 push 到 chapterFailures（软失败），调用 markStageDegraded，
 *      不阻断后续章（对齐 playground 「provider 层 fail-loud，LLM 内部空产物兜底」）。
 *    - 每章完成后 markIntermediateState 追加 {chapterId, status, wordCount} 指针。
 *
 * 4) Writer 12 类质量约束：通过 contextService.generateQualityConstraints +
 *    expressionMemory.generateAvoidancePrompt + narrativeCraft.generateNarrativeCraftConstraints
 *    + openingHook.generateOpeningConstraints 在调 writer 前注入 chapterContext。
 *
 *   reads  ctx: outlinePlan, chapterPlan, bibleSnapshot
 *   writes ctx: chapterDrafts[], chapterFailures[]
 *   checkpoint: 是（逐章 append）
 *
 * Failure modes:
 *   - ctx.signal aborted → StageAbortError（不写 ctx）
 *   - 无合法 chapterPlan   → throw（关键路径）
 *   - 单章写作失败         → markStageDegraded + push chapterFailures（软失败，不 throw）
 *   - 全部章节均失败       → throw（无产物，下游无法继续）
 */

import type {
  WritingMissionContext,
  WritingMissionInvariants,
  OutlinePhaseCtx,
  WorldPhaseCtx,
  DraftPhaseCtx,
} from "../../context/mission-context";
import type { DraftDeps } from "../../context/mission-deps";
import { StageAbortError } from "@/modules/ai-harness/facade";
import { narrate as harnessNarrate } from "@/modules/ai-harness/facade";
import { createWritingContextPackage } from "../../../interfaces/writing-context.interface";
import type {
  ChapterWritingContext,
  StoryBibleExtensions,
} from "../../../interfaces/writing-context.interface";

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Narrate adapter: writing module will create its own narrative.util.ts in B3;
 *  until then, call harness narrate directly with the writing event type. */
async function narrate(
  emit: DraftDeps["emit"],
  missionId: string,
  userId: string,
  ev: Parameters<typeof harnessNarrate>[4],
): Promise<void> {
  return harnessNarrate(emit, missionId, userId, "writing.agent:narrative", ev);
}

/** Maximum parallel writers per round (configurable via design doc §1.2). */
const DEFAULT_MAX_PARALLEL = 3;

// ─── stage entry point ───────────────────────────────────────────────────────

export async function runChapterFanoutStage(
  ctx: WritingMissionContext,
  deps: DraftDeps,
): Promise<void> {
  const { missionId, userId, billing, budgetMultiplier, input } = ctx;

  // ── pre-condition guard ──────────────────────────────────────────────────
  if (!ctx.chapterPlan?.length) {
    throw new Error(
      `[s4] chapterPlan is empty or missing — cannot run chapter fan-out for mission ${missionId}`,
    );
  }

  // ── lifecycle: started ───────────────────────────────────────────────────
  await deps.lifecycle(
    missionId,
    userId,
    "s4-chapter-fanout",
    "writer",
    "started",
  );
  await narrate(deps.emit, missionId, userId, {
    stage: "s4-chapter-fanout",
    role: "writer",
    tag: "analyzing",
    text: `逐章写作开始 · 共 ${ctx.chapterPlan.length} 章 · 构建依赖图并分轮调度`,
  });

  // ── Step 1: 构建依赖图 ───────────────────────────────────────────────────
  const dependencyGraph = await deps.chapterDependency.analyze(ctx.chapterPlan);

  // ── Step 2: 分轮执行计划 ─────────────────────────────────────────────────
  const executionPlan = deps.parallelOrchestrator.generateExecutionPlan(
    dependencyGraph,
    DEFAULT_MAX_PARALLEL,
  );

  deps.log.log(
    `[${missionId}] s4: execution plan = ${executionPlan.length} round(s), chapters = ${ctx.chapterPlan.length}`,
  );

  // ── Step 3: 初始化 ctx 产物字段（不覆盖已有，支持 cascade-rerun 续跑）─
  if (!ctx.chapterDrafts) ctx.chapterDrafts = [];
  if (!ctx.chapterFailures) ctx.chapterFailures = [];

  // Track already-drafted chapters (from cascade-rerun resume)
  const draftedChapterIds = new Set(ctx.chapterDrafts.map((d) => d.chapterId));

  // ── Step 4: 逐轮写作 ─────────────────────────────────────────────────────
  for (const round of executionPlan) {
    // abort 检查（每轮入口）
    if (
      (ctx as WritingMissionContext & { signal?: AbortSignal }).signal?.aborted
    ) {
      deps.log.warn(
        `[${missionId}] s4: abort signal detected before round ${round.round} — throwing StageAbortError`,
      );
      throw new StageAbortError(
        "s4-chapter-fanout",
        `aborted at round ${round.round}`,
      );
    }

    // Filter out already-drafted chapters (cascade-rerun safety)
    const pendingChapterIds = round.chapters.filter(
      (id) => !draftedChapterIds.has(id),
    );

    if (pendingChapterIds.length === 0) {
      deps.log.log(
        `[${missionId}] s4: round ${round.round} skipped (all chapters already drafted)`,
      );
      continue;
    }

    await narrate(deps.emit, missionId, userId, {
      stage: "s4-chapter-fanout",
      role: "writer",
      tag: "writing",
      text: `第 ${round.round + 1} 轮写作 · ${pendingChapterIds.length} 章并行 (ids: ${pendingChapterIds.join(", ")})`,
    });

    // ── 每章并发写作（Promise.all 收集，统一写回 ctx，防竞态）──────────────
    const roundResults = await Promise.all(
      pendingChapterIds.map((chapterId) =>
        writeSingleChapter(
          ctx,
          deps,
          chapterId,
          billing,
          budgetMultiplier,
          input,
        ),
      ),
    );

    // ── 统一写回 ctx（竞态安全）──────────────────────────────────────────
    const roundDrafts: NonNullable<DraftPhaseCtx["chapterDrafts"]> = [];
    const roundFailures: NonNullable<DraftPhaseCtx["chapterFailures"]> = [];

    for (const result of roundResults) {
      if (result.ok) {
        roundDrafts.push({
          chapterId: result.chapterId,
          status: "DRAFTED",
          wordCount: result.wordCount,
        });
        draftedChapterIds.add(result.chapterId);
      } else {
        roundFailures.push({
          chapterId: result.chapterId,
          reason: result.reason,
          occurredAt: Date.now(),
        });
        deps.log.warn(
          `[${missionId}] s4: chapter ${result.chapterId} failed (soft) — ${result.reason}`,
        );
        await deps.store.markStageDegraded(
          missionId,
          userId,
          "s4-chapter-fanout",
          `chapter ${result.chapterId}: ${result.reason}`,
        );
      }
    }

    // Push batched results onto ctx (one atomic append per round)
    ctx.chapterDrafts = [...(ctx.chapterDrafts ?? []), ...roundDrafts];
    ctx.chapterFailures = [...(ctx.chapterFailures ?? []), ...roundFailures];

    // ── 逐章 checkpoint（正文落 writingChapter，指针进 ctx）────────────────
    if (roundDrafts.length > 0 || roundFailures.length > 0) {
      await deps.store.markIntermediateState(
        missionId,
        {
          chapterDrafts: ctx.chapterDrafts,
          chapterFailures: ctx.chapterFailures,
        },
        userId,
      );
    }

    await narrate(deps.emit, missionId, userId, {
      stage: "s4-chapter-fanout",
      role: "writer",
      tag: roundFailures.length > 0 ? "warning" : "success",
      text: `第 ${round.round + 1} 轮完成 · 成功 ${roundDrafts.length} 章${roundFailures.length > 0 ? ` · 失败 ${roundFailures.length} 章` : ""}`,
    });
  }

  // ── Step 5: 全部章节均失败 → fail-loud ──────────────────────────────────
  const successCount =
    ctx.chapterDrafts?.filter((d) => d.status === "DRAFTED").length ?? 0;
  if (successCount === 0 && (ctx.chapterPlan?.length ?? 0) > 0) {
    const failureReasons =
      ctx.chapterFailures
        ?.map((f) => f.reason)
        .slice(0, 3)
        .join("; ") ?? "unknown";
    throw new Error(
      `[s4] All ${ctx.chapterPlan?.length ?? 0} chapters failed to draft — cannot proceed. Reasons: ${failureReasons}`,
    );
  }

  // ── lifecycle: completed ─────────────────────────────────────────────────
  await deps.lifecycle(
    missionId,
    userId,
    "s4-chapter-fanout",
    "writer",
    "completed",
    {
      successCount,
      failureCount: ctx.chapterFailures?.length ?? 0,
      totalChapters: ctx.chapterPlan?.length ?? 0,
    },
  );

  await narrate(deps.emit, missionId, userId, {
    stage: "s4-chapter-fanout",
    role: "writer",
    tag: "success",
    text: `章节写作完成 · ${successCount}/${ctx.chapterPlan?.length ?? 0} 章成功${(ctx.chapterFailures?.length ?? 0) > 0 ? ` · ${ctx.chapterFailures?.length} 章失败（软失败，不阻断流程）` : ""}`,
  });
}

// ─── single chapter writer (pure function, no direct ctx mutation) ────────────

/**
 * 写作单章：生成 12 类质量约束 → 调 WriterService.writeChapter →
 * 逐步校验（narrativeCraft 分析 + 字数不足续写，≤2 次）。
 * 返回 ChapterResult，不直接操作 ctx（调用方统一写回）。
 */
async function writeSingleChapter(
  ctx: WritingMissionInvariants &
    OutlinePhaseCtx &
    WorldPhaseCtx &
    DraftPhaseCtx,
  deps: DraftDeps,
  chapterId: string,
  billing: WritingMissionInvariants["billing"],
  budgetMultiplier: number,
  input: WritingMissionInvariants["input"],
): Promise<
  | { ok: true; chapterId: string; wordCount: number }
  | { ok: false; chapterId: string; reason: string }
> {
  // Find chapter plan entry
  const chapterEntry = ctx.chapterPlan?.find(
    (c) =>
      (c as Record<string, unknown>)["chapterId"] === chapterId ||
      (c as Record<string, unknown>)["id"] === chapterId,
  ) as Record<string, unknown> | undefined;

  if (!chapterEntry) {
    return {
      ok: false,
      chapterId,
      reason: `chapterEntry not found for id ${chapterId}`,
    };
  }

  const chapterNumber =
    (chapterEntry["chapterNumber"] as number | undefined) ?? 0;
  const chapterTitle = (chapterEntry["title"] as string | undefined) ?? "";
  const chapterOutline = (chapterEntry["outline"] as string | undefined) ?? "";

  // ── emit chapter:started ───────────────────────────────────────────────
  void deps
    .emit({
      type: "writing.chapter:started",
      missionId: ctx.missionId,
      userId: ctx.userId,
      payload: { chapterNumber, title: chapterTitle },
    })
    .catch((err: unknown) => {
      deps.log.warn(
        `[s4] emit writing.chapter:started failed for ch ${chapterId}: ${(err as Error).message}`,
      );
    });

  // Acquire writer pool slot
  const writer = await deps.writerPool.acquire();
  deps.writerPool.setCurrentChapter(writer.id, chapterId);

  try {
    // ── 质量约束生成（12 类，设计文档 §4.7 清单）────────────────────────

    // 1. contextService.generateQualityConstraints（叙事工艺 + 开篇钩子 + 五感 + 专业声音 + 节奏等）
    const qualityConstraintsText = await deps.context
      .generateQualityConstraints(
        chapterNumber,
        chapterOutline,
        undefined, // characters array from context package — not in ctx directly
        input.projectId,
      )
      .catch((err: unknown) => {
        deps.log.warn(
          `[s4] generateQualityConstraints failed for ch ${chapterId}: ${(err as Error).message}`,
        );
        return "";
      });

    // 2. expressionMemory.generateAvoidancePrompt（表达冷却期禁用列表）
    const avoidancePrompt = await deps.expressionMemory
      .generateAvoidancePrompt(input.projectId, chapterNumber)
      .catch((err: unknown) => {
        deps.log.warn(
          `[s4] generateAvoidancePrompt failed for ch ${chapterId}: ${(err as Error).message}`,
        );
        return "";
      });

    // 3. openingHook.generateOpeningConstraints（开篇钩子，按章节类型）
    const openingConstraints = deps.openingHook.generateOpeningConstraints(
      chapterNumber,
      chapterOutline,
    );

    // 4. narrativeCraft.generateNarrativeCraftConstraints（叙事工艺总约束）
    const narrativeCraftConstraints =
      deps.narrativeCraft.generateNarrativeCraftConstraints();

    // Assemble additionalInstructions from all constraint sources
    const allConstraints = [
      qualityConstraintsText,
      avoidancePrompt,
      openingConstraints,
      narrativeCraftConstraints,
    ]
      .filter(Boolean)
      .join("\n\n---\n\n");

    // ── previousContext：取最近 3 章摘要（软失败兜底空数组）────────────────
    const { previousChapters } = await deps.context
      .extractChapterContext(input.projectId, chapterNumber, 3)
      .catch((err: unknown) => {
        deps.log.warn(
          `[s4] extractChapterContext failed for ch ${chapterId}: ${(err as Error).message}`,
        );
        return {
          previousChapters: [] as Array<{
            number: number;
            title: string;
            summary: string;
          }>,
          recentSummary: "",
        };
      });

    // ── involvedCharacters：从 bibleSnapshot.characters 取全量（agent 自行筛选）
    const bibleSnapshot = ctx.bibleSnapshot;
    const involvedCharacters = bibleSnapshot?.characters ?? [];

    // ── relevantWorldSettings：从 ctx.worldSettings（s2 落库后回填）or bibleSnapshot ──
    // Both have shape { category, name, description, rules? } — structurally compatible.
    const relevantWorldSettings = (ctx.worldSettings ??
      bibleSnapshot?.worldSettings ??
      []) as NonNullable<typeof bibleSnapshot>["worldSettings"];

    // ── 构建 ChapterWritingContext ────────────────────────────────────────
    const chapterContext: ChapterWritingContext = {
      chapter: {
        id: chapterId,
        chapterNumber,
        title: chapterTitle,
        outline: chapterOutline,
        volumeId: (chapterEntry["volumeId"] as string | undefined) ?? "",
        volumeTitle:
          (chapterEntry["volumeTitle"] as string | undefined) ?? undefined,
      },
      previousContext: previousChapters.map((c) => ({
        chapterNumber: c.number,
        title: c.title,
        summary: c.summary,
      })),
      involvedCharacters,
      relevantWorldSettings,
      relevantTerminology: bibleSnapshot?.terminologies ?? [],
      timelineContext: bibleSnapshot?.timelineEvents ?? [],
      writingInstructions: {
        targetWordCount:
          (chapterEntry["targetWordCount"] as number | undefined) ?? 3000,
        additionalInstructions: allConstraints || undefined,
        focusPoints:
          (chapterEntry["focusPoints"] as string[] | undefined) ?? undefined,
      },
    };

    // Build WritingContextPackage from bibleSnapshot (assembled in s2 from DB)
    const storyBible: StoryBibleExtensions = bibleSnapshot ?? {
      projectId: input.projectId,
      bibleId: "",
      bibleVersion: 1,
      snapshotAt: new Date().toISOString(),
      premise: "",
      characters: [],
      worldSettings: [],
      terminologies: [],
      timelineEvents: [],
      factions: [],
    };
    const contextPackage = createWritingContextPackage(
      ctx.userId,
      input.projectId,
      storyBible,
      chapterContext,
    );

    // ── 调 WriterService.writeChapter ─────────────────────────────────────
    const result = await deps.writer.writeChapter({
      input: {
        chapterId,
        contextPackage,
        chapterContext,
        writerInstanceId: writer.id,
      },
      ctx: {
        missionId: ctx.missionId,
        userId: ctx.userId,
        agentId: `writer-${chapterId}`,
        role: "writer",
        envAdapter: billing,
        budgetMultiplier,
      },
      pool: ctx.pool,
    });

    const writerOutput = result.output;

    const isUsable =
      (result.state === "completed" || result.state === "degraded") &&
      writerOutput?.content;

    if (!isUsable || !writerOutput?.content) {
      return {
        ok: false,
        chapterId,
        reason: `writer agent returned no content (state=${result.state})`,
      };
    }

    let finalContent: string = writerOutput.content;
    let finalWordCount: number =
      writerOutput.wordCount ?? deps.textProcessor.countWords(finalContent);

    // ── 字数不足续写（≤2 次，设计文档 §2 迁移要点）─────────────────────
    const targetWordCount =
      (chapterEntry["targetWordCount"] as number | undefined) ?? 3000;
    const minWordCount = Math.floor(targetWordCount * 0.9);
    let retryCount = 0;
    while (finalWordCount < minWordCount && retryCount < 2) {
      retryCount++;
      deps.log.warn(
        `[s4] chapter ${chapterId} word count ${finalWordCount} < min ${minWordCount}, retry ${retryCount}/2`,
      );
      const retryResult = await deps.writer.writeChapter({
        input: {
          chapterId,
          contextPackage,
          chapterContext: {
            ...chapterContext,
            writingInstructions: {
              ...chapterContext.writingInstructions,
              additionalInstructions: `${allConstraints || ""}\n\n【续写指令】当前内容 ${finalWordCount} 字，不足目标 ${targetWordCount} 字，请补充细节、对话和心理活动。\n\n已有内容：\n${finalContent}`,
            },
          },
          writerInstanceId: writer.id,
        },
        ctx: {
          missionId: ctx.missionId,
          userId: ctx.userId,
          agentId: `writer-${chapterId}-retry${retryCount}`,
          role: "writer",
          envAdapter: billing,
          budgetMultiplier,
        },
        pool: ctx.pool,
      });
      const retryOutput = retryResult.output;
      if (
        (retryResult.state === "completed" ||
          retryResult.state === "degraded") &&
        retryOutput?.content
      ) {
        finalContent = retryOutput.content;
        finalWordCount =
          retryOutput.wordCount ?? deps.textProcessor.countWords(finalContent);
      } else {
        // retry failed, keep what we have
        break;
      }
    }

    // ── 叙事工艺后置检查 + 重写（设计文档 §1.4 / §4.7）────────────────────
    try {
      const craftReport = deps.narrativeCraft.analyzeContent(finalContent);
      if (!craftReport.passed) {
        deps.log.warn(
          `[s4] chapter ${chapterId} failed narrative craft check (score=${craftReport.score}) — attempting rewrite`,
        );
        const rewritten = await deps.narrativeCraft.rewriteEnding(
          finalContent,
          craftReport.issues,
        );
        if (rewritten && rewritten !== finalContent) {
          finalContent = rewritten;
          finalWordCount = deps.textProcessor.countWords(finalContent);
          deps.log.log(`[s4] chapter ${chapterId} rewritten successfully`);
        }
      }
    } catch (craftErr: unknown) {
      // Narrative craft rewrite is best-effort — log but don't fail the chapter
      deps.log.warn(
        `[s4] narrative craft rewrite failed for chapter ${chapterId} (non-fatal): ${(craftErr as Error).message}`,
      );
    }

    // ── emit chapter:content（最终定稿内容，含 retry + narrativeCraft 后）────
    void deps
      .emit({
        type: "writing.chapter:content",
        missionId: ctx.missionId,
        userId: ctx.userId,
        payload: {
          chapterNumber,
          title: chapterTitle,
          content: finalContent,
          wordCount: finalWordCount,
          volumeIndex: (chapterEntry["volumeIndex"] as number | undefined) ?? 0,
        },
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[s4] emit writing.chapter:content failed for ch ${chapterId}: ${(err as Error).message}`,
        );
      });

    // ── emit chapter:completed ─────────────────────────────────────────────
    void deps
      .emit({
        type: "writing.chapter:completed",
        missionId: ctx.missionId,
        userId: ctx.userId,
        payload: { chapterNumber, wordCount: finalWordCount },
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[s4] emit writing.chapter:completed failed for ch ${chapterId}: ${(err as Error).message}`,
        );
      });

    return { ok: true, chapterId, wordCount: finalWordCount };
  } catch (err: unknown) {
    return {
      ok: false,
      chapterId,
      reason: (err as Error).message ?? String(err),
    };
  } finally {
    await deps.writerPool.release(writer);
  }
}
