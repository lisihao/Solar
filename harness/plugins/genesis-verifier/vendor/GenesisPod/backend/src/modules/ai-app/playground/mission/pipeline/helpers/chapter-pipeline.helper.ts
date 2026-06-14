/**
 * chapter-pipeline.helper.ts
 *
 * Single-chapter write + review loop (runChapterPipeline).
 * Extracted from per-dim-pipeline.util.ts (L709-1255) as part of PR-D-1 god-class split.
 *
 * All previously closed-over variables from runPerDimPipeline are now explicit
 * parameters in ChapterPipelineContext so the function is fully self-contained and
 * independently testable.
 */

import { ChapterWriterAgent } from "../../agents/writer/chapter-writer.agent";
import { ChapterReviewerAgent } from "../../agents/writer/chapter-reviewer.agent";
import type { MissionDeps } from "../../context/mission-deps";
import type { BillingRuntimeEnvAdapter } from "@/modules/ai-harness/facade";
import type { MissionBudgetPool } from "@/modules/ai-harness/facade";
import { agentUsageDetail } from "./agent-usage.util";
import {
  extractTokenSpend,
  REVIEW_PASS_THRESHOLD,
  REVIEW_REWRITE_FLOOR,
  CHAPTER_MAX_REVISION_ATTEMPTS,
  jaccardSimilarity,
  restoreGlobalIndices,
  scanContentDefects,
  sanitizeSectionOutput,
} from "@/modules/ai-harness/facade";
import { stripChartJsonFromContent } from "@/modules/ai-engine/facade";
import { narrate } from "../../artifacts/narrative.util";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shape of a single chapter entry from the outline LLM output. */
export interface OutlineChapter {
  index: number;
  heading: string;
  thesis: string;
  keyPoints: string[];
  sourceIndices: number[];
}

/** Full written-chapter result stored in writtenChapters[]. */
export interface WrittenChapter {
  index: number;
  heading: string;
  body: string;
  wordCount: number;
  finalized: boolean;
  qualified: boolean;
  decision: "passed" | "fallback-length" | "fallback-exhausted";
  finalScore: number;
  /**
   * ★ 2026-05-07 P1 figure references from LLM output.
   * reportAssembler uses this to associate figures to section ids.
   */
  figureReferences?: {
    figureId: string;
    anchorParagraph?: number;
    caption?: string;
  }[];
}

/**
 * All context values that were previously closed over inside runPerDimPipeline.
 * The batch executor passes these in so the helper has no hidden state.
 */
export interface ChapterPipelineContext {
  missionId: string;
  userId: string;
  dimensionIdx: number;
  dimensionName: string;
  topic: string;
  language: "zh-CN" | "en-US";
  targetWordsPerChapter: number;
  lengthProfile?: "brief" | "standard" | "deep" | "extended" | "epic" | "mega";
  billing: BillingRuntimeEnvAdapter;
  budgetMultiplier: number;
  pool: MissionBudgetPool;
  /**
   * Pre-computed map from chapterIndex → Set of globalIdx values that this
   * chapter is the *first* consumer of (RTK dedup).
   */
  firstUseByChapter: Map<number, Set<number>>;
  /** All findings for this dimension (indexed by sourceIndices). */
  findings: { claim: string; evidence: string; source: string }[];
  /** Optional figure candidates to pass to chapter-writer. */
  figureCandidates?: {
    sourceUrl: string;
    imageUrl?: string;
    caption: string;
    sourcePageOrSection?: string;
    relevanceHint?: "high" | "medium" | "low";
  }[];
  /** Callback to emit the terminal chapter:done(failed-finalized) event. */
  emitChapterFailedDone: (
    failedAttempt: number,
    reason: string,
    wordCount: number,
    finalScore?: number,
  ) => Promise<void>;
  /** Persistent store — optional (spec mocks may omit). */
  store: MissionDeps["store"];
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * runChapterPipeline — single-chapter write+review loop (can run concurrently).
 *
 * @param chapter                  - Outline chapter spec.
 * @param previousHeadingsSnapshot - Snapshot of prior chapter headings (read-only, shared across concurrent chapters).
 * @param ctx                      - All context values (previously closed over in runPerDimPipeline).
 * @param deps                     - Mission-level dependencies.
 * @returns WrittenChapter on success, null on failure (caller uses Promise.allSettled).
 */
export async function runChapterPipeline(
  chapter: OutlineChapter,
  previousHeadingsSnapshot: readonly string[],
  ctx: ChapterPipelineContext,
  deps: MissionDeps,
): Promise<WrittenChapter | null> {
  const {
    missionId,
    userId,
    dimensionIdx,
    dimensionName,
    topic,
    language,
    targetWordsPerChapter,
    billing,
    budgetMultiplier,
    pool,
    firstUseByChapter,
    findings,
    figureCandidates,
    emitChapterFailedDone,
    store,
  } = ctx;

  const MAX_REVISION_ATTEMPTS = CHAPTER_MAX_REVISION_ATTEMPTS;
  const PASS_THRESHOLD = REVIEW_PASS_THRESHOLD;
  // ★ L1-1: stuck-revision guard
  const STUCK_SIMILARITY_THRESHOLD = 0.9;
  const MAX_STUCK_COUNT = 2;

  // ★ RTK dedup: first use gets full finding, later uses get brief
  const chapterFirstUse =
    firstUseByChapter.get(chapter.index) ?? new Set<number>();
  const chapterSources = chapter.sourceIndices
    .map((globalIdx) => {
      const finding = findings[globalIdx];
      if (finding == null) return null;
      if (!chapterFirstUse.has(globalIdx)) {
        return {
          claim: finding.claim,
          source: finding.source,
          evidence: "",
          _deduplicated: true,
          _briefHint: `[已在前章节使用，引用编号 [${globalIdx + 1}]]`,
        };
      }
      return finding;
    })
    .filter((s): s is NonNullable<typeof s> => s != null);

  let attempt = 0;
  let lastDraft:
    | { body: string; wordCount: number; citationsUsed: string[] }
    | undefined;
  let lastCritique: string | undefined;
  // ★ 2026-06-07：记录最近一次 reviewer 评分。章节写了内容但卡在 60 门禁时（兜底落地），
  //   终态须上报这个真实分（如 55）而非硬编码 0，否则维度被单章拖成 0/100。
  let lastScore = 0;
  // ★ P1-R4-A (round 4): cap consecutive reviewer failures to avoid token explosion
  let consecutiveReviewerFailures = 0;
  const MAX_REVIEWER_FAILURES = 2;
  // ★ L1-1: stuck-revision tracking
  let stuckCount = 0;
  let prevDraftBody: string | undefined;

  type ReviewIssue = {
    severity: "must-fix" | "should-fix" | "nice-to-have";
    dimension:
      | "evidence"
      | "logic"
      | "structure"
      | "citation"
      | "length"
      | "style";
    pointer: string;
    issue: string;
    suggestion: string;
  };

  while (attempt < MAX_REVISION_ATTEMPTS + 1) {
    attempt += 1;
    const writerAgentId = `chapter-writer#${dimensionIdx}.${chapter.index}.${attempt}`;
    await deps
      .emit({
        type: "playground.chapter:writing:started",
        missionId,
        userId,
        agentId: writerAgentId,
        payload: {
          dimension: dimensionName,
          chapterIndex: chapter.index,
          heading: chapter.heading,
          attempt,
        },
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[${missionId}] emit chapter:writing:started for "${dimensionName}" §${chapter.index} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    const writerRes = await deps.invoker.invoke(
      ChapterWriterAgent,
      {
        topic,
        dimension: dimensionName,
        language,
        chapter: {
          index: chapter.index,
          heading: chapter.heading,
          thesis: chapter.thesis,
          keyPoints: chapter.keyPoints,
        },
        sources: chapterSources,
        targetWords: targetWordsPerChapter,
        lengthProfile: ctx.lengthProfile,
        previousChapterHeadings: previousHeadingsSnapshot,
        previousCritique: lastCritique,
        previousDraft: lastDraft?.body,
        // ★ 2026-05-07 figure matching: pass dim figureCandidates to chapter-writer
        availableFigures: (figureCandidates ?? []).map((f, i) => ({
          figureId: `FIG-${i + 1}`,
          caption: f.caption,
          sourceUrl: f.sourceUrl,
          relevanceHint: f.relevanceHint,
        })),
      },
      {
        missionId,
        userId,
        agentId: writerAgentId,
        role: "chapter-writer",
        envAdapter: billing,
        budgetMultiplier,
      },
    );
    await deps.invoker.tickCost(
      missionId,
      userId,
      "researchers",
      pool,
      extractTokenSpend(writerRes.events),
      writerRes.events,
    );
    // ★ degraded also counts as usable — body is intact, just verifier score is low
    const writerUsable =
      (writerRes.state === "completed" || writerRes.state === "degraded") &&
      !!writerRes.output;
    if (!writerUsable) {
      await deps
        .emit({
          type: "playground.chapter:writing:completed",
          missionId,
          userId,
          agentId: writerAgentId,
          payload: {
            dimension: dimensionName,
            chapterIndex: chapter.index,
            attempt,
            state: "failed",
          },
        })
        .catch((err: unknown) => {
          deps.log.warn(
            `[${missionId}] emit chapter:writing:completed (failed) for "${dimensionName}" §${chapter.index} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      // ★ 2026-05-12: must emit chapter:done(failed-finalized) to close frontend state machine
      await emitChapterFailedDone(attempt, "writer-failed", 0);
      return null;
    }
    const rawDraft = writerRes.output as {
      body: string;
      wordCount: number;
      citationsUsed: string[];
      figureReferences?: {
        figureId: string;
        anchorParagraph?: number;
        caption?: string;
      }[];
    };
    // ★ sanitizeSectionOutput: whitelist-clean LLM output (13 orthogonal fixes)
    const cleanedBody = sanitizeSectionOutput(rawDraft.body);
    const draft = { ...rawDraft, body: cleanedBody };
    // ★ L1-1: stuck-revision detection — Jaccard > 0.9 after revision = no progress
    if (attempt > 1 && prevDraftBody !== undefined) {
      const sim = jaccardSimilarity(prevDraftBody, draft.body);
      if (sim > STUCK_SIMILARITY_THRESHOLD) {
        stuckCount += 1;
      } else {
        stuckCount = 0;
      }
    }
    prevDraftBody = draft.body;
    lastDraft = draft;
    // ★ scanContentDefects: emit format defect metrics for frontend visibility
    const defects = scanContentDefects(draft.body);
    const totalDefects =
      defects.bareLatexCount +
      defects.brokenDollarNesting +
      defects.unwrappedEnvironments +
      defects.pseudoCodeLines +
      defects.leakedMetaNotes +
      defects.leakedFigureNotes +
      defects.longListItems +
      defects.trappedConclusions;
    await deps
      .emit({
        type: "playground.chapter:writing:completed",
        missionId,
        userId,
        agentId: writerAgentId,
        payload: {
          dimension: dimensionName,
          chapterIndex: chapter.index,
          heading: chapter.heading,
          wordCount: draft.wordCount,
          targetWords: targetWordsPerChapter,
          attempt,
          state: "completed",
          defectScan:
            totalDefects > 0 ? { total: totalDefects, ...defects } : undefined,
          // ★ 2026-05-29：per-agent 用量（Tokens / 成本 / 模型 / 工具列）
          ...agentUsageDetail(writerRes),
        },
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[${missionId}] emit chapter:writing:completed for "${dimensionName}" §${chapter.index} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    await narrate(deps.emit, missionId, userId, {
      stage: "s3-researchers",
      role: "writer",
      tag: "info",
      text: `${dimensionName} · §${chapter.index} ${chapter.heading.slice(0, 30)} 撰写完成（${draft.wordCount} 字${attempt > 1 ? `，第 ${attempt} 轮` : ""}）`,
      agentId: writerAgentId,
      dimension: dimensionName,
    });

    // ── review ──
    const reviewerAgentId = `chapter-reviewer#${dimensionIdx}.${chapter.index}.${attempt}`;
    await deps
      .emit({
        type: "playground.chapter:review:started",
        missionId,
        userId,
        agentId: reviewerAgentId,
        payload: {
          dimension: dimensionName,
          chapterIndex: chapter.index,
          attempt,
        },
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[${missionId}] emit chapter:review:started for "${dimensionName}" §${chapter.index} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    const reviewerRes = await deps.invoker.invoke(
      ChapterReviewerAgent,
      {
        topic,
        dimension: dimensionName,
        language,
        chapter: {
          index: chapter.index,
          heading: chapter.heading,
          thesis: chapter.thesis,
          body: draft.body,
          wordCount: draft.wordCount,
          targetWords: targetWordsPerChapter,
        },
        // ★ 2026-05-21 P2 Evidence Contract：本章实际分到的唯一来源数 →
        //   reviewer 的引用门槛 = min(2, N)，治"采得少却要求 ≥2 引用"的结构性死区。
        availableSourceCount: chapterSources.length,
      },
      {
        missionId,
        userId,
        agentId: reviewerAgentId,
        role: "chapter-reviewer",
        envAdapter: billing,
        budgetMultiplier,
      },
    );
    await deps.invoker.tickCost(
      missionId,
      userId,
      "researchers",
      pool,
      extractTokenSpend(reviewerRes.events),
      reviewerRes.events,
    );
    const verdict =
      reviewerRes.state === "completed" && reviewerRes.output
        ? (reviewerRes.output as {
            decision: "pass" | "revise";
            score: number;
            summary?: string;
            issues?: ReviewIssue[];
            critique?: string;
          })
        : {
            // ★ P0-R3-1 (round 3): reviewer failure must not fake a pass
            decision: "revise" as const,
            score: 40,
            summary: "(reviewer failed)",
            issues: [],
            critique: "(reviewer failed)",
          };
    lastScore = verdict.score;
    // ★ degraded also accepted — reviewer is simple-loop but accepted
    const isReviewerFallback =
      (reviewerRes.state !== "completed" && reviewerRes.state !== "degraded") ||
      !reviewerRes.output;
    // ★ P1-R4-A: cap consecutive reviewer failures
    if (isReviewerFallback) {
      consecutiveReviewerFailures += 1;
    } else {
      consecutiveReviewerFailures = 0;
    }
    const reviewerExhausted =
      consecutiveReviewerFailures >= MAX_REVIEWER_FAILURES;
    // Build issues array from verdict (backwards-compat with critique-only LLMs)
    const issues: ReviewIssue[] =
      verdict.issues && verdict.issues.length > 0
        ? verdict.issues
        : verdict.critique
          ? [
              {
                severity:
                  verdict.decision === "revise" ? "must-fix" : "nice-to-have",
                dimension: "structure",
                pointer: "整章",
                issue: verdict.critique.slice(0, 200),
                suggestion: "见 issue 描述",
              },
            ]
          : [];
    await deps
      .emit({
        type: "playground.chapter:review:completed",
        missionId,
        userId,
        agentId: reviewerAgentId,
        payload: {
          dimension: dimensionName,
          chapterIndex: chapter.index,
          attempt,
          decision: verdict.decision,
          score: verdict.score,
          summary: verdict.summary,
          issues,
          critique: verdict.critique ?? verdict.summary,
          // ★ 2026-05-29：reviewer per-agent 用量（trace 太薄不显示的真因，从 RunResult 带出）
          ...agentUsageDetail(reviewerRes),
        },
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[${missionId}] emit chapter:review:completed for "${dimensionName}" §${chapter.index} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    await narrate(deps.emit, missionId, userId, {
      stage: "s3-researchers",
      role: "reviewer",
      tag: isReviewerFallback
        ? "warning"
        : verdict.decision === "pass"
          ? "success"
          : verdict.score < 60
            ? "warning"
            : "info",
      text: isReviewerFallback
        ? `${dimensionName} · §${chapter.index} 复审失败，按 revise 处理`
        : `${dimensionName} · §${chapter.index} 复审 ${verdict.decision === "pass" ? "通过" : "需重写"}（${verdict.score}/100${attempt > 1 ? `，第 ${attempt} 轮` : ""}）`,
      agentId: reviewerAgentId,
      dimension: dimensionName,
    });

    // ★ Word count hard threshold (2026-05-01): relaxed to < 40% of target
    const isLengthFail =
      draft.wordCount < Math.round(targetWordsPerChapter * 0.4) &&
      attempt < MAX_REVISION_ATTEMPTS;
    // ★ L1-2: reviewer threshold decay — each attempt drops 10, floor 40
    //   attempt=1→60, attempt=2→50, attempt=3→40
    const dynamicThreshold = Math.max(
      REVIEW_REWRITE_FLOOR,
      PASS_THRESHOLD - (attempt - 1) * 10,
    );
    // ★ L1-1: consecutive stuck-revision guard
    const isStuckRevision = stuckCount >= MAX_STUCK_COUNT;

    if (
      !isLengthFail &&
      (verdict.decision === "pass" ||
        verdict.score >= dynamicThreshold ||
        attempt >= MAX_REVISION_ATTEMPTS + 1 ||
        reviewerExhausted ||
        isStuckRevision)
    ) {
      // ★ Remap local citation indices [1][2] → global dim indices
      const localToGlobal = new Map<number, number>();
      chapter.sourceIndices.forEach((globalIdx, localIdx) => {
        localToGlobal.set(localIdx + 1, globalIdx + 1);
      });
      const remappedBody = stripChartJsonFromContent(
        restoreGlobalIndices(draft.body, localToGlobal),
      );

      const chapterDecision:
        | "passed"
        | "fallback-length"
        | "fallback-exhausted" =
        verdict.decision === "pass" || verdict.score >= PASS_THRESHOLD
          ? "passed"
          : reviewerExhausted
            ? "fallback-exhausted"
            : "fallback-length";

      await deps
        .emit({
          type: "playground.chapter:done",
          missionId,
          userId,
          agentId: reviewerAgentId,
          payload: {
            dimension: dimensionName,
            chapterIndex: chapter.index,
            finalAttempt: attempt,
            decision: chapterDecision,
            finalScore: verdict.score,
            wordCount: draft.wordCount,
            targetWordCount: targetWordsPerChapter,
            finalized: true,
            qualified: chapterDecision === "passed",
          },
        })
        .catch((err: unknown) => {
          deps.log.warn(
            `[${missionId}] emit chapter:done for "${dimensionName}" §${chapter.index} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });

      // ★ P0-D (2026-05-06): persist chapter draft for rerun cache hit
      if (store?.saveChapterDraft) {
        await store
          .saveChapterDraft({
            missionId,
            dimension: dimensionName,
            chapterIndex: chapter.index,
            heading: chapter.heading,
            thesis: chapter.thesis,
            content: remappedBody,
            status:
              chapterDecision === "passed" ? "passed" : "failed-finalized",
            score: verdict.score,
            critique: verdict.critique,
            attempts: attempt,
            wordCount: draft.wordCount,
          })
          .catch((err: unknown) => {
            deps.log.warn(
              `[chapter-pipeline] saveChapterDraft failed (non-fatal) dim=${dimensionName} ch=${chapter.index}: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
      }

      if (chapterDecision !== "passed") {
        await narrate(deps.emit, missionId, userId, {
          stage: "s3-researchers",
          role: "reviewer",
          tag: "warning",
          text: `${dimensionName} · §${chapter.index} 因评审 ${
            chapterDecision === "fallback-exhausted"
              ? "故障耗尽"
              : "未通过且重试上限"
          }，按当前 draft 兜底落地（${draft.wordCount}/${targetWordsPerChapter} 字）`,
          agentId: reviewerAgentId,
          dimension: dimensionName,
        });
      }

      return {
        index: chapter.index,
        heading: chapter.heading,
        body: remappedBody,
        wordCount: draft.wordCount,
        finalized: true,
        qualified: chapterDecision === "passed",
        decision: chapterDecision,
        finalScore: verdict.score,
        figureReferences: draft.figureReferences,
      };
    }

    // Continue loop — build critique for next attempt
    const lengthCritiquePrefix = isLengthFail
      ? `[字数极度不足] 上轮仅 ${draft.wordCount} 字（目标 ${targetWordsPerChapter} 字，< 40%）。补充分析段落、案例数据、深化推理 —— 重点是质量内容（独立观点 / 具体证据 / 充分引用），不是单纯凑字数。目标 ${Math.round(targetWordsPerChapter * 0.6)} 字以上即可。\n\n`
      : "";
    const MAX_CRITIQUE_CHARS = 2000;
    lastCritique = (
      lengthCritiquePrefix + (verdict.critique ?? verdict.summary ?? "")
    ).slice(0, MAX_CRITIQUE_CHARS);
    await deps
      .emit({
        type: "playground.chapter:revision",
        missionId,
        userId,
        agentId: reviewerAgentId,
        payload: {
          dimension: dimensionName,
          chapterIndex: chapter.index,
          nextAttempt: attempt + 1,
          critique: verdict.critique,
        },
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[${missionId}] emit chapter:revision for "${dimensionName}" §${chapter.index} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  // while loop exhausted without returning (theoretically unreachable due to attempt cap)
  // ★ 2026-05-12: still emit terminal event to close frontend state machine
  await emitChapterFailedDone(
    attempt,
    "loop-exhausted",
    lastDraft?.wordCount ?? 0,
    lastScore, // 兜底落地章节的真实评分（非 0），避免维度被拖成 0/100
  );
  return null;
}

// ─── Shared event helpers ─────────────────────────────────────────────────────

/**
 * Emit chapter:done(failed-finalized) + a warning narrative.
 *
 * ★ 2026-05-12: every chapter failure path must call this so the frontend state
 *   machine can close (otherwise the chapter stays stuck in 'reviewing').
 *   Extracted here so it is shared between chapter-pipeline.helper and the batch
 *   executor wrapper in per-dim-pipeline.util.ts.
 */
export async function emitChapterFailedDoneEvent(
  deps: MissionDeps,
  ctx: {
    missionId: string;
    userId: string;
    dimensionIdx: number;
    dimensionName: string;
    chapterIndex: number;
    failedAttempt: number;
    reason: string;
    wordCount: number;
    targetWordCount: number;
    /** 章节兜底落地时的真实 reviewer 评分；缺省 0（如 writer 全无产出）。 */
    finalScore?: number;
  },
): Promise<void> {
  const agentId = `chapter-writer#${ctx.dimensionIdx}.${ctx.chapterIndex}.${ctx.failedAttempt}`;
  await deps
    .emit({
      type: "playground.chapter:done",
      missionId: ctx.missionId,
      userId: ctx.userId,
      agentId,
      payload: {
        dimension: ctx.dimensionName,
        chapterIndex: ctx.chapterIndex,
        finalAttempt: ctx.failedAttempt,
        decision: "fallback-exhausted",
        finalScore: ctx.finalScore ?? 0,
        wordCount: ctx.wordCount,
        targetWordCount: ctx.targetWordCount,
        finalized: true,
        qualified: false,
      },
    })
    .catch((err: unknown) => {
      deps.log.warn(
        `[${ctx.missionId}] emit chapter:done (failed-finalized: ${ctx.reason}) for "${ctx.dimensionName}" §${ctx.chapterIndex} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  await narrate(deps.emit, ctx.missionId, ctx.userId, {
    stage: "s3-researchers",
    role: "writer",
    tag: "warning",
    text: `${ctx.dimensionName} · §${ctx.chapterIndex} 章节落地失败（${ctx.reason}），按缺章处理`,
    agentId,
    dimension: ctx.dimensionName,
  });
}

/**
 * Emit synthetic chapter state-machine events for a cache-hit dim.
 *
 * ★ 2026-05-06 业务链修5: Each chapter is walked through the full
 *   writing → reviewing → passed → done sequence so the frontend derive.ts
 *   todo-ledger can advance without real LLM calls.
 */
export async function emitCacheHitChapters(
  emit: MissionDeps["emit"],
  missionId: string,
  userId: string,
  dimensionName: string,
  dimensionIdx: number,
  chapters: Array<{
    index: number;
    heading: string;
    thesis?: string;
    wordCount: number;
    finalScore: number;
  }>,
  log?: Pick<MissionDeps["log"], "warn">,
): Promise<void> {
  const SYNTH_EMIT_INTERVAL_MS = 80;
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  // emit dimension:outline:planned
  await emit({
    type: "playground.dimension:outline:planned",
    missionId,
    userId,
    payload: {
      dimension: dimensionName,
      chapters: chapters.map((d) => ({
        index: d.index,
        heading: d.heading,
        thesis: d.thesis,
      })),
      fromCache: true,
    },
  }).catch((err: unknown) => {
    log?.warn(
      `[cache-hit] emit outline:planned failed for ${dimensionName}: ${err instanceof Error ? err.message : String(err)}`,
    );
  });
  await sleep(SYNTH_EMIT_INTERVAL_MS);

  for (const c of chapters) {
    await emit({
      type: "playground.chapter:writing:started",
      missionId,
      userId,
      payload: {
        dimension: dimensionName,
        chapterIndex: c.index,
        attempt: 1,
        fromCache: true,
      },
    }).catch((err: unknown) => {
      log?.warn(
        `[cache-hit] emit chapter:writing:started failed for ${dimensionName} ch=${c.index}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    await sleep(SYNTH_EMIT_INTERVAL_MS);
    await emit({
      type: "playground.chapter:writing:completed",
      missionId,
      userId,
      payload: {
        dimension: dimensionName,
        chapterIndex: c.index,
        wordCount: c.wordCount,
        fromCache: true,
      },
    }).catch((err: unknown) => {
      log?.warn(
        `[cache-hit] emit chapter:writing:completed failed for ${dimensionName} ch=${c.index}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    await sleep(SYNTH_EMIT_INTERVAL_MS);
    await emit({
      type: "playground.chapter:review:completed",
      missionId,
      userId,
      payload: {
        dimension: dimensionName,
        chapterIndex: c.index,
        decision: "pass",
        score: c.finalScore,
        fromCache: true,
      },
    }).catch((err: unknown) => {
      log?.warn(
        `[cache-hit] emit chapter:review:completed failed for ${dimensionName} ch=${c.index}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    await sleep(SYNTH_EMIT_INTERVAL_MS);
    await emit({
      type: "playground.chapter:done",
      missionId,
      userId,
      payload: {
        dimension: dimensionName,
        chapterIndex: c.index,
        finalAttempt: 1,
        decision: "passed",
        finalScore: c.finalScore,
        wordCount: c.wordCount,
        finalized: true,
        qualified: true,
        fromCache: true,
      },
    }).catch((err: unknown) => {
      log?.warn(
        `[cache-hit] emit chapter:done failed for ${dimensionName} ch=${c.index}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    await sleep(SYNTH_EMIT_INTERVAL_MS);
  }

  await narrate(emit, missionId, userId, {
    stage: "s3-researchers",
    role: "writer",
    tag: "success",
    text: `${dimensionName} · 复用上次 mission 的 ${chapters.length} 个章节（cache hit），跳过 outline + writing + reviewer`,
    agentId: `chapter-cache#${dimensionIdx}`,
    dimension: dimensionName,
  });
}
