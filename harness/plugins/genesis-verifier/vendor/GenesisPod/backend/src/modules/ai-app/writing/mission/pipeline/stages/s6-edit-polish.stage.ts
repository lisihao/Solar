/**
 * Stage S6 — Edit & Polish
 *
 *   reads  ctx: chapterDrafts, consistencyIssues, contextPackage (NEEDS_CTX)
 *   writes ctx: revisedChapters[], editStats
 *   deps:       editor (EditorService), qualityGate.checkQualityGate,
 *               chapterQualityEvaluator.quickEvaluate,
 *               writingPersistence.updateChapterContent (NEEDS_DEP),
 *               store.markIntermediateState / markStageDegraded,
 *               lifecycle, emit, log
 *
 * Flow (per drafted chapter):
 *   1. lifecycle "started"
 *   2. Fetch chapter content via writingPersistence (NEEDS_DEP)
 *   3. qualityGate.checkQualityGate → quality issues for the chapter
 *   4. editor.run(fix_issues | polish) with consistency + quality issues
 *   5. chapterQualityEvaluator.quickEvaluate → post-edit quality signal (rule-based, free)
 *   6. writingPersistence.updateChapterContent → persist revised content
 *   7. Accumulate revisedChapters[] pointer + aggregate editStats
 *   8. markIntermediateState checkpoint
 *   9. lifecycle "completed"
 *   10. narrate summary
 *
 * Failure modes:
 *   - No chapterDrafts (all s4 chapters failed)       → throw (关键路径)
 *   - Chapter content fetch fails                     → markStageDegraded (soft, skip chapter)
 *   - editor.run state=failed                        → markStageDegraded (soft, keep draft)
 *   - writingPersistence.updateChapterContent fails   → markStageDegraded (soft, in-memory only)
 */

import type {
  WritingMissionInvariants,
  DraftPhaseCtx,
  ConsistencyPhaseCtx,
  EditPhaseCtx,
} from "../../context/mission-context";
import type { EditDeps } from "../../context/mission-deps";
import type { EditorOutput } from "../../agents/editor.agent";
import type { WritingContextPackage } from "../../../interfaces/writing-context.interface";
import { narrate } from "../narrative.util";

export async function runEditPolishStage(
  ctx: WritingMissionInvariants &
    DraftPhaseCtx &
    ConsistencyPhaseCtx &
    EditPhaseCtx &
    // NEEDS_CTX: contextPackage:WritingContextPackage — built at s2 from bibleSnapshot,
    // required by EditorAgent.buildSystemPrompt (characters / hardConstraints / writingStyle).
    // Integrator: add to WritingMissionContext (e.g. WorldPhaseCtx or a dedicated InvariantsCtx).
    { contextPackage?: WritingContextPackage },
  // EditDeps.editor is now typed as EditorService (real class).
  // NEEDS_DEP: EditDeps.writingPersistence:WritingPersistence — required for
  //   updateChapterContent(chapterId, content, wordCount) and findChapterById.
  //   Integrator: add writingPersistence to EditDeps in mission-deps.ts.
  deps: EditDeps & {
    writingPersistence?: {
      updateChapterContent(
        chapterId: string,
        content: string,
        wordCount: number,
      ): Promise<void>;
      findChapterById?(
        chapterId: string,
      ): Promise<{ content: string; chapterNumber: number } | null>;
    };
  },
): Promise<void> {
  const { missionId, userId, billing, budgetMultiplier, pool } = ctx;

  await deps.lifecycle(
    missionId,
    userId,
    "s6-edit-polish",
    "editor",
    "started",
  );
  await narrate(deps.emit, missionId, userId, {
    stage: "s6-edit-polish",
    role: "editor",
    tag: "info",
    text: "Editor 开始修订润色阶段",
  });

  const draftedChapters = (ctx.chapterDrafts ?? []).filter(
    (d) => d.status === "DRAFTED",
  );

  if (draftedChapters.length === 0) {
    await deps.lifecycle(
      missionId,
      userId,
      "s6-edit-polish",
      "editor",
      "failed",
      {
        error:
          "No drafted chapters available for editing (all s4 chapters failed)",
      },
    );
    throw new Error(
      `[s6] No drafted chapters to edit for mission ${missionId}`,
    );
  }

  await narrate(deps.emit, missionId, userId, {
    stage: "s6-edit-polish",
    role: "editor",
    tag: "info",
    text: `Editor 将处理 ${draftedChapters.length} 章`,
  });

  const revisedChapters: NonNullable<EditPhaseCtx["revisedChapters"]> = [];

  // Aggregate stats across all chapters
  let totalChanges = 0;
  let fixedIssues = 0;
  let wordCountBefore = 0;
  let wordCountAfter = 0;

  const consistencyIssues = ctx.consistencyIssues ?? [];

  // Build a minimal contextPackage stub if not available yet (NEEDS_CTX).
  // EditorAgent.buildSystemPrompt reads: bible.characters, bible.worldType,
  // bible.writingStyle, hardConstraints. Without contextPackage the agent
  // falls back to empty arrays (safe, just lower quality prompts).
  const contextPackage: WritingContextPackage =
    ctx.contextPackage ??
    ({
      projectId: ctx.input.projectId,
      establishedFacts: [],
      hardConstraints: [],
      entities: [],
      extensions: {
        storyBible: {
          projectId: ctx.input.projectId,
          characters: [],
          worldType: "",
          locations: [],
          terminology: [],
          writingStyle: {},
          timeline: [],
        },
      },
    } as unknown as WritingContextPackage);

  for (const draft of draftedChapters) {
    const { chapterId } = draft;

    // ── Fetch chapter content ─────────────────────────────────────────────
    let chapterContent: string;
    let chapterNumber = 0;

    try {
      if (!deps.writingPersistence?.findChapterById) {
        // NEEDS_DEP not yet wired — log and proceed with empty content as degraded
        throw new Error(
          "writingPersistence.findChapterById not available (NEEDS_DEP not yet wired)",
        );
      }
      const chapter = await deps.writingPersistence.findChapterById(chapterId);
      if (!chapter?.content) {
        throw new Error(`Chapter ${chapterId} has no content in DB`);
      }
      chapterContent = chapter.content;
      chapterNumber = chapter.chapterNumber;
    } catch (err) {
      deps.log.warn(
        `[${missionId}] s6 fetch chapter ${chapterId} failed (soft): ${err instanceof Error ? err.message : String(err)}`,
      );
      await deps.store.markStageDegraded(
        missionId,
        userId,
        "s6-edit-polish",
        `Chapter ${chapterId} content fetch failed: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
      );
      revisedChapters.push({
        chapterId,
        chapterNumber, // 0（fetch 未成功）—— 仅占位，FAILED 章不进 sections
        status: "FAILED",
        wordCount: 0,
      });
      continue;
    }

    // ── Quality gate evaluation → quality issues to fix ──────────────────
    let mappedQualityIssues: Array<{
      type: "CHARACTER" | "TIMELINE" | "WORLD" | "TERMINOLOGY" | "PLOT";
      severity: "CRITICAL" | "WARNING" | "INFO";
      location: string;
      description: string;
      suggestion?: string;
    }> = [];
    try {
      const gateResult = await deps.qualityGate.checkQualityGate(
        ctx.input.projectId,
        chapterId,
        chapterNumber,
        chapterContent,
        0,
      );
      mappedQualityIssues = gateResult.issues
        .filter((qi) => qi.severity === "error" || qi.severity === "warning")
        .map((qi) => ({
          type: "PLOT" as const,
          severity: (qi.severity === "error" ? "CRITICAL" : "WARNING") as
            | "CRITICAL"
            | "WARNING"
            | "INFO",
          location: qi.location ?? "未知位置",
          description: qi.description,
          suggestion: qi.suggestion,
        }));
    } catch (err) {
      deps.log.warn(
        `[${missionId}] s6 qualityGate for chapter ${chapterId} failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Combine quality issues + consistency issues for this chapter.
    // ConsistencyCheckerOutput.issues don't carry chapterId, so include all.
    const allIssues = [...mappedQualityIssues, ...consistencyIssues];

    // ── EditorAgent invocation via EditorService ─────────────────────────
    const operation =
      allIssues.length > 0 ? ("fix_issues" as const) : ("polish" as const);

    const editorResult = await deps.editor.run({
      input: {
        operation,
        chapterId,
        content: chapterContent,
        contextPackage,
        params: {
          issues: allIssues.length > 0 ? allIssues : undefined,
          polishLevel: "moderate",
        },
      },
      ctx: {
        missionId,
        userId,
        agentId: `editor-${chapterId}`,
        role: "editor",
        envAdapter: billing,
        budgetMultiplier,
      },
      pool,
    });

    const editorUsable =
      (editorResult.state === "completed" ||
        editorResult.state === "degraded") &&
      !!editorResult.output;

    if (!editorUsable) {
      deps.log.warn(
        `[${missionId}] s6 editor failed for chapter ${chapterId} (state=${editorResult.state}), keeping draft`,
      );
      await deps.store.markStageDegraded(
        missionId,
        userId,
        "s6-edit-polish",
        `Editor failed for chapter ${chapterId} (state=${editorResult.state}): keeping original draft`,
      );
      revisedChapters.push({
        chapterId,
        chapterNumber,
        status: "FAILED",
        wordCount: draft.wordCount,
      });
      continue;
    }

    const editorOut = editorResult.output as EditorOutput;
    const revisedContent = editorOut.revisedContent;
    const finalWordCount = editorOut.stats.wordCountAfter;

    // ── emit consistency:fix_completed when issues were fixed ─────────────
    if (allIssues.length > 0 && editorOut.stats.fixedIssues > 0) {
      void deps
        .emit({
          type: "writing.consistency:fix_completed",
          missionId,
          userId,
          payload: {
            chapterNumber,
            fixedIssues: editorOut.stats.fixedIssues,
          },
        })
        .catch((err: unknown) => {
          deps.log.warn(
            `[${missionId}] emit writing.consistency:fix_completed ch${chapterNumber} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }

    // ── Quick quality signal (rule-based, zero LLM cost) ─────────────────
    try {
      const quickReport = deps.chapterQualityEvaluator.quickEvaluate(
        revisedContent,
        chapterNumber,
      );
      if (typeof quickReport.overallScore === "number") {
        deps.log.log(
          `[${missionId}] s6 chapter ${chapterId} post-edit quickScore=${quickReport.overallScore.toFixed(1)}`,
        );
      }
    } catch (err) {
      deps.log.warn(
        `[${missionId}] s6 quickEvaluate for chapter ${chapterId} failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // ── Persist revised content to writingChapter ─────────────────────────
    try {
      if (!deps.writingPersistence?.updateChapterContent) {
        throw new Error(
          "writingPersistence.updateChapterContent not available (NEEDS_DEP not yet wired)",
        );
      }
      await deps.writingPersistence.updateChapterContent(
        chapterId,
        revisedContent,
        finalWordCount,
      );
    } catch (err) {
      deps.log.warn(
        `[${missionId}] s6 persist chapter ${chapterId} failed (soft): revised content in-memory only`,
      );
      await deps.store.markStageDegraded(
        missionId,
        userId,
        "s6-edit-polish",
        `Chapter ${chapterId} revised content persist failed: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
      );
    }

    // ── Accumulate stats ──────────────────────────────────────────────────
    totalChanges += editorOut.stats.totalChanges;
    fixedIssues += editorOut.stats.fixedIssues;
    wordCountBefore += editorOut.stats.wordCountBefore;
    wordCountAfter += editorOut.stats.wordCountAfter;

    revisedChapters.push({
      chapterId,
      chapterNumber,
      status: "REVISED",
      wordCount: finalWordCount,
    });
  }

  // ── Write ctx outputs ─────────────────────────────────────────────────
  const editStats: NonNullable<EditPhaseCtx["editStats"]> = {
    totalChanges,
    fixedIssues,
    wordCountBefore,
    wordCountAfter,
  };

  ctx.revisedChapters = revisedChapters;
  ctx.editStats = editStats;

  await deps.store
    .markIntermediateState(missionId, { revisedChapters, editStats }, userId)
    .catch((err: unknown) => {
      deps.log.warn(
        `[${missionId}] s6 markIntermediateState failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

  const revisedCount = revisedChapters.filter(
    (r) => r.status === "REVISED",
  ).length;
  const failedCount = revisedChapters.filter(
    (r) => r.status === "FAILED",
  ).length;
  const wallTimeMs = Date.now() - ctx.t0;

  await deps.lifecycle(
    missionId,
    userId,
    "s6-edit-polish",
    "editor",
    "completed",
    {
      wallTimeMs,
      revisedCount,
      failedCount,
      totalChanges,
      fixedIssues,
      wordCountBefore,
      wordCountAfter,
    },
  );

  await narrate(deps.emit, missionId, userId, {
    stage: "s6-edit-polish",
    role: "editor",
    tag: revisedCount > 0 ? "success" : "warning",
    text: `Edit & Polish 完成 · 修订 ${revisedCount} 章${failedCount > 0 ? ` · ${failedCount} 章失败` : ""} · 修改 ${totalChanges} 处 · 修复 ${fixedIssues} 个问题 · 字数 ${wordCountBefore} → ${wordCountAfter}`,
  });
}
