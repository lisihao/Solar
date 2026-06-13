/**
 * Stage S5 — Consistency check (post-draft, per-chapter)
 *
 * Runs ConsistencyCheckerAgent on every drafted chapter to surface
 * character / timeline / world / terminology / plot issues, and
 * extracts new facts consumed by s6 (editor) and s8 (persist).
 *
 *   reads  ctx: chapterDrafts, bibleSnapshot
 *   writes ctx: consistencyIssues[], extractedFacts[]
 *   deps:       consistencyChecker (role) → ConsistencyService.checkChapter
 *               semanticConsistency, factExtractor, consistencyEngine (auxiliary)
 *               store.markIntermediateState (checkpoint)
 *               lifecycle, emit, log
 *
 * Design notes (spec §1.2 s5 row + §4.2):
 *   - ctx.chapterDrafts are pointers only (chapterId + status + wordCount);
 *     actual chapter text lives in writingChapter.content (DB). Reading it
 *     requires a persistence accessor — see NEEDS_DEP at the bottom of this file.
 *   - ctx.bibleSnapshot (from s2 WorldPhaseCtx) is used to assemble the
 *     WritingContextPackage fed to ConsistencyCheckerAgent (same pattern as s3).
 *   - Chapters processed sequentially to avoid ctx write races.
 *   - Per-chapter soft failures: markStageDegraded, continue to next chapter.
 *   - Abort check before each iteration (spec §4.1 long-loop self-check).
 *   - All ctx writes happen once at stage end to avoid partial state on abort.
 *
 * Failure modes:
 *   - chapterDrafts empty / missing                     → skip (no-op, log, empty output)
 *   - chapter content unavailable (writingPersistence)  → soft fail, markStageDegraded
 *   - ConsistencyService.checkChapter throws            → soft fail, markStageDegraded
 *   - ConsistencyService.checkChapter state=failed      → soft fail, markStageDegraded
 *   - ctx.signal aborted mid-loop                       → throw (abort propagated)
 *
 * NEEDS_DEP (reported for integrator):
 *   ConsistencyDeps needs a way to read chapter content from DB.
 *   Options:
 *     A) Add deps.writingPersistence.findChapterById(chapterId):
 *           Promise<{content: string; chapterNumber: number} | null>
 *        (PersistDeps already has writingPersistence — ConsistencyDeps would need it too)
 *     B) Extend ConsistencyEngineService.buildWritingContext return to include
 *        chapter.content (minimal addition in ContextBuilderService.buildWritingContext).
 *   This stage uses option B (calls buildWritingContext and reads content via
 *   loose typing) with an optional fallback accessor inline type.
 *   Integrator: choose A or B and update ConsistencyDeps / ContextBuilderService.
 */

import type {
  WritingMissionInvariants,
  WorldPhaseCtx,
  DraftPhaseCtx,
  ConsistencyPhaseCtx,
} from "../../context/mission-context";
import type { ConsistencyDeps } from "../../context/mission-deps";
import type { ConsistencyService } from "../../roles/consistency.service";
import type {
  ConsistencyIssue,
  ConsistencyCheckerOutput,
} from "../../agents/consistency-checker.agent";
import {
  createWritingContextPackage,
  type WritingContextPackage,
} from "../../../interfaces/writing-context.interface";
import { narrate } from "../narrative.util";

/** Re-exported so s6-edit-polish can reference ConsistencyIssue without reaching into agents/. */
export type { ConsistencyIssue };

type StageCtx = WritingMissionInvariants &
  WorldPhaseCtx &
  DraftPhaseCtx &
  ConsistencyPhaseCtx & {
    /** Injected by dispatcher / framework — checked in long loop (spec §4.1). */
    signal?: AbortSignal;
  };

/** Minimal content accessor expected on deps (option A of NEEDS_DEP above). */
interface ChapterContentAccessor {
  findChapterById?(
    chapterId: string,
  ): Promise<{ content: string; chapterNumber: number } | null>;
}

export async function runConsistencyCheckStage(
  ctx: StageCtx,
  deps: ConsistencyDeps & ChapterContentAccessor,
): Promise<void> {
  const { missionId, userId, pool, billing, budgetMultiplier, input } = ctx;

  await deps.lifecycle(
    missionId,
    userId,
    "consistency-checker",
    "consistency-checker",
    "started",
  );
  await narrate(deps.emit, missionId, userId, {
    stage: "s5-consistency-check",
    role: "consistency-checker",
    tag: "info",
    text: "开始逐章一致性检查：角色 / 时间线 / 世界观 / 术语 / 剧情五维核验",
  });

  const drafts = ctx.chapterDrafts ?? [];

  if (drafts.length === 0) {
    deps.log.warn(
      `[${missionId}] s5: no chapterDrafts — consistency check skipped`,
    );
    ctx.consistencyIssues = [];
    ctx.extractedFacts = [];
    await deps.lifecycle(
      missionId,
      userId,
      "consistency-checker",
      "consistency-checker",
      "completed",
      { wallTimeMs: 0, chapterCount: 0, issuesTotal: 0 },
    );
    return;
  }

  // Build the WritingContextPackage once for all chapters from ctx.bibleSnapshot.
  // bibleSnapshot was written by s2 (WorldPhaseCtx); falls back to empty bible if absent.
  const contextPackage: WritingContextPackage = buildContextPackageFromSnapshot(
    ctx.bibleSnapshot,
    input.projectId,
  );

  const stageStart = Date.now();
  const allIssues: ConsistencyIssue[] = [];
  const allFacts: NonNullable<ConsistencyCheckerOutput["extractedFacts"]> = [];
  let degradedCount = 0;
  let draftedIndex = 0;

  for (const draft of drafts) {
    // Abort check before each chapter (spec §4.1 — long loop self-check).
    if (ctx.signal?.aborted) {
      throw new Error(
        `[s5] Mission ${missionId} aborted during consistency check`,
      );
    }

    // Only process successfully drafted chapters.
    if (draft.status !== "DRAFTED") {
      deps.log.warn(
        `[${missionId}] s5: chapter ${draft.chapterId} has status=${draft.status} — skipping`,
      );
      continue;
    }

    draftedIndex++;
    const chapterNumber = draftedIndex;

    // emit: consistency check starting for this chapter
    void deps
      .emit({
        type: "writing.consistency:check_started",
        missionId,
        userId,
        payload: { chapterNumber },
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[${missionId}] s5: emit consistency:check_started failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    // ── Step 1: Fetch chapter content from DB ────────────────────────────────
    let chapterContent: string;
    try {
      chapterContent = await fetchChapterContent(
        deps,
        draft.chapterId,
        missionId,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.log.warn(
        `[${missionId}] s5: cannot fetch content for chapter ${draft.chapterId}: ${msg}`,
      );
      await deps.store.markStageDegraded(
        missionId,
        userId,
        "s5-consistency-check",
        `content fetch 失败 (chapter ${draft.chapterId}): ${msg.slice(0, 200)}`,
      );
      degradedCount++;
      continue;
    }

    if (!chapterContent) {
      deps.log.warn(
        `[${missionId}] s5: chapter ${draft.chapterId} has no content — skipping`,
      );
      continue;
    }

    // ── Step 2: Invoke ConsistencyCheckerAgent via ConsistencyService ─────────
    let result: Awaited<ReturnType<ConsistencyService["checkChapter"]>>;
    try {
      result = await deps.consistencyChecker.checkChapter({
        input: {
          chapterId: draft.chapterId,
          content: chapterContent,
          contextPackage,
        },
        ctx: {
          missionId,
          userId,
          agentId: `consistency-${draft.chapterId}`,
          role: "consistency-checker",
          envAdapter: billing,
          budgetMultiplier,
        },
        pool,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.log.warn(
        `[${missionId}] s5: checkChapter threw for chapter ${draft.chapterId}: ${msg}`,
      );
      await deps.store.markStageDegraded(
        missionId,
        userId,
        "s5-consistency-check",
        `checkChapter 失败 (chapter ${draft.chapterId}): ${msg.slice(0, 200)}`,
      );
      degradedCount++;
      continue;
    }

    // state=failed or cancelled → soft fail, not a throw (non-provider failure).
    if (result.state === "failed" || result.state === "cancelled") {
      deps.log.warn(
        `[${missionId}] s5: checkChapter state=${result.state} for chapter ${draft.chapterId}`,
      );
      await deps.store.markStageDegraded(
        missionId,
        userId,
        "s5-consistency-check",
        `ConsistencyCheckerAgent ${result.state} (chapter ${draft.chapterId})`,
      );
      degradedCount++;
      continue;
    }

    // Accumulate results from completed or degraded run (degraded still has output).
    const output = result.output;
    if (output) {
      allIssues.push(...output.issues);
      if (output.extractedFacts?.length) {
        allFacts.push(...output.extractedFacts);
      }

      // emit: issues found for this chapter (only when there are issues)
      if (output.issues.length > 0) {
        void deps
          .emit({
            type: "writing.consistency:issues_found",
            missionId,
            userId,
            payload: {
              chapterNumber,
              issues: output.issues.map((issue) => ({
                type: issue.type,
                severity: issue.severity,
                description: issue.description,
                suggestion: issue.suggestion,
              })),
            },
          })
          .catch((err: unknown) => {
            deps.log.warn(
              `[${missionId}] s5: emit consistency:issues_found failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
      }

      await narrate(deps.emit, missionId, userId, {
        stage: "s5-consistency-check",
        role: "consistency-checker",
        tag: output.status === "PASSED" ? "success" : "warning",
        text:
          output.status === "PASSED"
            ? `章节 ${draft.chapterId} 一致性通过`
            : `章节 ${draft.chapterId} 发现 ${output.summary.total} 个问题`,
      });
    }
  }

  // ── Step 3: Write ctx + checkpoint (single write at end avoids partial state) ─
  ctx.consistencyIssues = allIssues;
  ctx.extractedFacts = allFacts;

  await deps.store
    .markIntermediateState(
      missionId,
      { consistencyIssues: allIssues, extractedFacts: allFacts },
      userId,
    )
    .catch((err: unknown) => {
      deps.log.warn(
        `[${missionId}] s5 markIntermediateState failed (non-fatal): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });

  // ── Step 4: lifecycle completed + narrate summary ─────────────────────────
  const wallTimeMs = Date.now() - stageStart;
  const criticalCount = allIssues.filter(
    (i) => i.severity === "CRITICAL",
  ).length;
  const processedCount = drafts.filter((d) => d.status === "DRAFTED").length;

  await deps.lifecycle(
    missionId,
    userId,
    "consistency-checker",
    "consistency-checker",
    "completed",
    {
      wallTimeMs,
      chapterCount: processedCount,
      issuesTotal: allIssues.length,
      criticalIssues: criticalCount,
      factsExtracted: allFacts.length,
      degradedChapters: degradedCount,
    },
  );

  await narrate(deps.emit, missionId, userId, {
    stage: "s5-consistency-check",
    role: "consistency-checker",
    tag: criticalCount > 0 ? "warning" : "success",
    text: [
      `一致性检查完成 · ${processedCount} 章`,
      `· 问题 ${allIssues.length} 个${criticalCount > 0 ? `（${criticalCount} 严重）` : ""}`,
      `· 提取新事实 ${allFacts.length} 条`,
      degradedCount > 0 ? `· ${degradedCount} 章降级` : "",
    ]
      .filter(Boolean)
      .join(" "),
  });
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Build WritingContextPackage from ctx.bibleSnapshot.
 * Same pattern as s3-outline-plan.stage.ts buildContextPackageFromSnapshot.
 * Agent reads extensions.storyBible; base MissionContextPackage fields are minimal.
 */
function buildContextPackageFromSnapshot(
  bibleSnapshot: WorldPhaseCtx["bibleSnapshot"],
  projectId: string,
): WritingContextPackage {
  if (bibleSnapshot) {
    return createWritingContextPackage(
      "consistency-checker",
      projectId,
      bibleSnapshot,
    );
  }
  // Fallback when s2 soft-failed (bibleSnapshot missing).
  return createWritingContextPackage("consistency-checker", projectId, {
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

/**
 * Fetch chapter content from DB.
 * Tries deps.findChapterById first (NEEDS_DEP option A), then falls back to
 * deps.consistencyEngine.buildWritingContext (option B via loose typing).
 * Throws if neither path can return content.
 */
async function fetchChapterContent(
  deps: ConsistencyDeps & ChapterContentAccessor,
  chapterId: string,
  missionId: string,
): Promise<string> {
  // Option A: direct accessor (preferred, needs integrator to add to ConsistencyDeps).
  if (deps.findChapterById) {
    const row = await deps.findChapterById(chapterId);
    if (row?.content) return row.content;
  }

  // Option B: buildWritingContext returns chapter row from DB; content may be included
  // after integrator extends ContextBuilderService return (see NEEDS_DEP in file header).
  const writingCtx = (await deps.consistencyEngine.buildWritingContext(
    chapterId,
  )) as {
    chapter?: { content?: string | null };
  };
  const content = writingCtx.chapter?.content ?? "";

  if (!content) {
    deps.log.warn(
      `[${missionId}] s5: fetchChapterContent: chapter ${chapterId} returned no content via buildWritingContext; integrator should add chapter.content to ContextBuilderService return or provide deps.findChapterById`,
    );
  }

  return content;
}
