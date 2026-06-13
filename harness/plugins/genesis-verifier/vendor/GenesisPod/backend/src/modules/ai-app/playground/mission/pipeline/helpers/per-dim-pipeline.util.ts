/**
 * Per-dimension chapter pipeline (TI-style)
 *
 * 每个 researcher 单 dim 跑完后的"扩写流水线"：outline → chapter 逐章 write+review
 * → integrate → 5-axis grade。在 thorough+ / standard 档位启用，minimal/quick 档位
 * 跳过（直接退化为 raw researcherOut）。
 *
 * 由 s3-researcher-dispatch.stage.ts 在每个 dim 完成后调用一次。
 *
 *   inputs:    per-dim args（missionId/userId/dim 信息 + researcherOut + billing + pool）
 *   returns:   增强后的 dim 结果（chapters[] + abstract + keyFindings + fullMarkdown + grade?）
 *   deps:      writer (planDimensionOutline), reviewer (judgeDimension),
 *              invoker (invoke for ChapterWriter/ChapterReviewer/DimensionIntegrator,
 *                       tickCost), emit, lifecycle
 *
 * PR-D-1 (god-class split): chapter loop helpers extracted to:
 *   chapter-pipeline.helper.ts       — single-chapter write+review loop + shared events
 *   chapter-batch-executor.helper.ts — concurrent chapter execution
 *   chapter-integrity.validator.ts   — validateWrittenChapters + text utilities
 */

import { DimensionIntegratorAgent } from "../../agents/writer/dimension-integrator.agent";
import type { MissionDeps } from "../../context/mission-deps";
import { groundDimensionGrade } from "../../artifacts/grade-grounding.util";
import type { BillingRuntimeEnvAdapter } from "@/modules/ai-harness/facade";
import type { MissionBudgetPool } from "@/modules/ai-harness/facade";
import { extractTokenSpend } from "@/modules/ai-harness/facade";
import { extractFailureMessage } from "@/modules/ai-harness/facade";
import { narrate } from "../../artifacts/narrative.util";
// ★ 2026-05-21 P2 Evidence Contract: 来源充分性的单一权威
import {
  computeEvidenceBudget,
  deriveMaxChapters,
} from "../../artifacts/evidence-budget";
// ★ 2026-05-22 契约单一源：章节数范围（与 outline agent schema 同源，杜绝漂移）
import {
  CHAPTER_COUNT_RANGE,
  clampChapterCount,
} from "../../../api/contracts/chapter-count.contract";
// ★ 2026-05-22 ③L/M 单一源：报告总字数 = depthBase × lengthProfile 倍率
import { resolveMissionTotalWords } from "../../../api/contracts/word-budget.contract";
import { loadPlaygroundRuntimeConfig } from "../../../runtime/playground-runtime.config";
import { stripChartJsonFromContent } from "@/modules/ai-engine/facade";

import {
  runChapterPipeline,
  emitChapterFailedDoneEvent,
  emitCacheHitChapters,
} from "./chapter-pipeline.helper";
import type { WrittenChapter } from "./chapter-pipeline.helper";
import { executeChapterBatch } from "./chapter-batch-executor.helper";
import { validateWrittenChapters } from "../../artifacts/chapter-integrity.validator";
export type { ChapterIntegrityResult } from "../../artifacts/chapter-integrity.validator";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface PerDimPipelineArgs {
  missionId: string;
  userId: string;
  dimensionIdx: number;
  dimensionName: string;
  topic: string;
  language: "zh-CN" | "en-US";
  depth: "quick" | "standard" | "deep";
  /** 章节字数规格（lengthProfile 决定每节字数 + 章节数） */
  lengthProfile?: "brief" | "standard" | "deep" | "extended" | "epic" | "mega";
  /** mission 总维度数 —— 让本 dim 按 missionTarget / dimCount 推算字数 */
  dimensionCount?: number;
  pool: MissionBudgetPool;
  researcherOut: {
    dimension: string;
    findings: { claim: string; evidence: string; source: string }[];
    summary: string;
    /**
     * ★ 2026-05-07 图文匹配：researcher 抽到的候选图列表。chapter-writer 收到后可
     * 在合适段落后内联引用 `![caption](#FIG-N)` 占位符。
     */
    figureCandidates?: {
      sourceUrl: string;
      imageUrl?: string;
      caption: string;
      sourcePageOrSection?: string;
      relevanceHint?: "high" | "medium" | "low";
    }[];
  };
  billing: BillingRuntimeEnvAdapter;
  budgetMultiplier: number;
  /**
   * ★ 2026-04-30 REDESIGN: retry 双路径 pipeline 索引。
   * undefined → 原始 pipeline；"leader-assess-retry" / "leader-assess-replace" → fresh-collect retry。
   */
  retryLabel?: string;
}

export interface PerDimPipelineResult {
  dimension: string;
  findings: { claim: string; evidence: string; source: string }[];
  summary: string;
  chapters?: {
    index: number;
    heading: string;
    body: string;
    wordCount: number;
    finalized?: boolean;
    qualified?: boolean;
    decision?: "passed" | "fallback-length" | "fallback-exhausted";
    finalScore?: number;
  }[];
  abstract?: string;
  keyFindings?: string[];
  fullMarkdown?: string;
  grade?: {
    overall: number;
    grade: string;
    axes: Record<string, { score: number; comment: string }>;
    summary: string;
  };
}

// ─── Main pipeline entry point ────────────────────────────────────────────────

export async function runPerDimPipeline(
  args: PerDimPipelineArgs,
  deps: MissionDeps,
): Promise<PerDimPipelineResult> {
  const {
    missionId,
    userId,
    dimensionIdx,
    dimensionName,
    topic,
    language,
    depth,
    pool,
    researcherOut,
    billing,
    budgetMultiplier,
  } = args;

  const lp = args.lengthProfile;
  const dimCount = Math.max(1, args.dimensionCount ?? 5);
  // ★ 2026-05-22 ③L/M 单一源：总字数 = depthBase × lengthProfile 密度倍率
  //   （resolveMissionTotalWords）。lengthProfile 终于生效(往长调)；deep 仍大体量,
  //   不会走马观花。替代原"按 depth 写死、无视 lengthProfile"的第二信源。
  const missionTarget = resolveMissionTotalWords(depth, lp ?? "standard");
  const dimTargetWords = Math.round(missionTarget / dimCount);
  const idealChapters = depth === "quick" ? 2 : depth === "deep" ? 7 : 4;
  // ★ 2026-05-22 质量保底章节数：供给偏少时也不让维度塌成 1 章（受 uniqueSources 夹逼，
  //   不会产生 0 来源空章；每章引用下限由 deriveCitationFloor 自适应）。
  const minChapters = depth === "quick" ? 2 : depth === "deep" ? 4 : 3;
  const naivePerChapter = Math.round(dimTargetWords / idealChapters);
  // 仅用于推导"按字数算的章节数上限"——非最终给 writer 的每章字数（见 targetWordsPerChapter）。
  const naiveWordsPerChapter = Math.max(400, Math.min(naivePerChapter, 8000));
  const wordBasedChapterCount = Math.max(
    3,
    Math.min(
      CHAPTER_COUNT_RANGE.max,
      Math.round(dimTargetWords / naiveWordsPerChapter),
    ),
  );
  // ★ 2026-05-21 P2 Evidence Contract（单一权威）：按采集到的真实来源供给给章节数
  //   封顶，保证每章能满足 reviewer 的引用下限 —— 治"采得少却开 N 章 → 审核结构性
  //   不可满足 → 重写循环 → 超时失败"。供给充足时不缩水（取 wordBasedChapterCount）。
  const evidenceBudget = computeEvidenceBudget(researcherOut.findings);
  // ★ 2026-05-22 契约单一源：clamp 到 CHAPTER_COUNT_RANGE（与 outline agent schema 同源）。
  //   不再手写 Math.max(1, Math.min(25,...)) 复写消费方边界。
  const targetChapterCount = clampChapterCount(
    Math.min(
      wordBasedChapterCount,
      deriveMaxChapters(evidenceBudget, idealChapters, minChapters),
    ),
  );
  // ★ 2026-05-22：每章字数目标按"实际章节数"算，而非 idealChapters。章节被证据封顶
  //   降到 N 章时，每章应分到 dimTargetWords/N 的字数,否则 writer 拿到偏小目标 → 全文偏薄。
  const targetWordsPerChapter = Math.max(
    400,
    Math.min(8000, Math.round(dimTargetWords / targetChapterCount)),
  );
  const dimAgentTag = `researcher#${dimensionIdx}`;

  // ★ 2026-05-01 INVARIANT: every dim must emit exactly one dimension:graded terminal event.
  const gradeAgentId = `quality-judge#${dimensionIdx}`;
  let terminalEmitted = false;
  const emitGraded = async (
    payload:
      | { ok: true; g: NonNullable<PerDimPipelineResult["grade"]> }
      | {
          ok: false;
          summary: string;
          failed: true;
          skipped?: boolean;
          phase?:
            | "no-findings"
            | "outline-failed"
            | "no-chapters"
            | "integrator-failed"
            | "integrator-exception"
            | "grade-failed"
            | "grade-exception"
            | "pipeline-exception"
            | "fallback-finally";
        },
  ): Promise<void> => {
    if (terminalEmitted) return;
    terminalEmitted = true;
    try {
      if (payload.ok) {
        const g = payload.g;
        await deps.emit({
          type: "playground.dimension:graded",
          missionId,
          userId,
          agentId: gradeAgentId,
          payload: {
            dimension: dimensionName,
            overall: g.overall,
            grade: g.grade,
            axes: g.axes,
            summary: g.summary,
            retryLabel: args.retryLabel,
          },
        });
        await narrate(deps.emit, missionId, userId, {
          stage: "s3-researchers",
          role: "reviewer",
          tag:
            g.overall >= 80 ? "success" : g.overall >= 60 ? "info" : "warning",
          text: `${dimensionName} · 5 轴评分出炉 ${g.overall}/100（${g.grade}）`,
          agentId: gradeAgentId,
          dimension: dimensionName,
        });
      } else {
        // ★ 2026-06-07 B2：5 轴评分阶段失败/异常，但已有落地章节时，用章节真实均分
        //   做兜底 overall（而非硬记 0），避免"写了内容却 0/100"。仍保留 failed:true，
        //   让 leader 重派/retry 逻辑不变；只让展示分反映已落地内容的真实质量。
        const scored = writtenChaptersResult.filter(
          (c) => typeof c.finalScore === "number" && c.finalScore > 0,
        );
        const partial =
          scored.length > 0
            ? Math.round(
                scored.reduce((s, c) => s + c.finalScore, 0) / scored.length,
              )
            : 0;
        const partialGrade =
          partial >= 80
            ? "A"
            : partial >= 70
              ? "B"
              : partial >= 60
                ? "C"
                : partial >= 50
                  ? "D"
                  : "F";
        await deps.emit({
          type: "playground.dimension:graded",
          missionId,
          userId,
          agentId: gradeAgentId,
          payload: {
            dimension: dimensionName,
            overall: partial,
            grade: partialGrade,
            axes: {},
            summary:
              partial > 0
                ? `${payload.summary} · 按 ${scored.length} 章落地均分兜底 ${partial}/100`
                : payload.summary,
            retryLabel: args.retryLabel,
            failed: true,
            degraded: partial > 0,
            skipped: payload.skipped ?? false,
            phase: payload.phase,
          },
        });
      }
    } catch (emitErr) {
      const msg = emitErr instanceof Error ? emitErr.message : String(emitErr);
      // eslint-disable-next-line no-console
      console.warn(
        `[per-dim-pipeline ${dimensionName}] emitGraded failed (event lost): ${msg}`,
      );
    }
  };

  let abstract: string | undefined;
  let keyFindings: string[] | undefined;
  let fullMarkdown: string | undefined;
  let grade: PerDimPipelineResult["grade"];
  let writtenChaptersResult: WrittenChapter[] = [];

  try {
    if (researcherOut.findings.length === 0) {
      await emitGraded({
        ok: false,
        failed: true,
        skipped: true,
        phase: "no-findings",
        summary: `${dimensionName} · researcher 未采集到 finding，跳过 chapter pipeline`,
      });
      return researcherOut;
    }

    // ★ 2026-05-21 P2 closed-loop（如实降级）：供给不足时如实告知"证据仅支撑 N 章"，
    //   而不是硬开 N 章后全部兜底落地。
    if (targetChapterCount < wordBasedChapterCount) {
      await narrate(deps.emit, missionId, userId, {
        stage: "s3-researchers",
        role: "reviewer",
        tag: "warning",
        text: `${dimensionName} · 证据供给有限（${evidenceBudget.uniqueSources} 个唯一来源 / ${evidenceBudget.uniqueDomains} 个域名），章节数由 ${wordBasedChapterCount} 降为 ${targetChapterCount}，以保证每章引用可满足`,
        agentId: dimAgentTag,
        dimension: dimensionName,
      });
    }

    // ── Cache hit (P0-D 2026-05-06) ──
    // 防御 deps.store 缺失（spec mock 简化场景）：缺失即跳过 cache 检查
    const cachedDrafts = deps.store?.loadQualifiedChapterDrafts
      ? await deps.store
          .loadQualifiedChapterDrafts(missionId)
          .catch(
            () =>
              [] as Awaited<
                ReturnType<typeof deps.store.loadQualifiedChapterDrafts>
              >,
          )
      : [];
    const dimCached = cachedDrafts.filter((d) => d.dimension === dimensionName);
    if (dimCached.length >= 1) {
      dimCached.sort((a, b) => a.chapterIndex - b.chapterIndex);
      const synthesizedChapters = dimCached.map((d) => ({
        index: d.chapterIndex,
        heading: d.heading,
        thesis: d.thesis,
        body: d.content,
        wordCount: d.wordCount ?? 0,
        finalized: true,
        qualified: true,
        decision: "passed" as const,
        finalScore: d.score ?? 80,
      }));
      // Emit synthetic state-machine events for each cached chapter
      await emitCacheHitChapters(
        deps.emit,
        missionId,
        userId,
        dimensionName,
        dimensionIdx,
        synthesizedChapters,
        deps.log,
      );
      const fullMarkdownFromCache = synthesizedChapters
        .map((c) => `### ${c.heading}\n\n${c.body}`)
        .join("\n\n");
      const totalWordCount = synthesizedChapters.reduce(
        (s, c) => s + c.wordCount,
        0,
      );
      await deps
        .emit({
          type: "playground.dimension:integrating:completed",
          missionId,
          userId,
          payload: {
            dimension: dimensionName,
            totalWordCount,
            fromCache: true,
          },
        })
        .catch((err: unknown) => {
          deps.log.warn(
            `[per-dim] emit dimension:integrating:completed (cache hit) failed for ${dimensionName}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      await emitGraded({
        ok: true,
        g: {
          overall: 80,
          grade: "B",
          axes: {},
          summary: `${dimensionName} · cache hit（${synthesizedChapters.length} 章复用），跳过 outline/writing/reviewer/integrator/grade`,
        },
      });
      void totalWordCount;
      return {
        ...researcherOut,
        chapters: synthesizedChapters,
        fullMarkdown: fullMarkdownFromCache,
        grade: {
          overall: 80,
          grade: "B",
          axes: {},
          summary: `cache hit（复用上次 mission 的 ${synthesizedChapters.length} 章）`,
        },
      };
    }

    // ── 1. Outline ──
    const outlineAgentId = `outline#${dimensionIdx}`;
    await deps.lifecycle(
      missionId,
      userId,
      outlineAgentId,
      "outline",
      "started",
      {
        dimension: dimensionName,
      },
    );
    const outlineRes = await deps.writer.planDimensionOutline(
      {
        topic,
        dimension: dimensionName,
        language,
        dimensionSummary: researcherOut.summary,
        findings: researcherOut.findings,
        targetChapterCount,
      },
      {
        missionId,
        userId,
        agentId: outlineAgentId,
        role: "outline",
        envAdapter: billing,
      },
    );
    await deps.invoker.tickCost(
      missionId,
      userId,
      "researchers",
      pool,
      extractTokenSpend(outlineRes.events),
      outlineRes.events,
    );
    await deps.lifecycle(
      missionId,
      userId,
      outlineAgentId,
      "outline",
      outlineRes.state === "completed" ? "completed" : "failed",
      {
        dimension: dimensionName,
        wallTimeMs: outlineRes.wallTimeMs,
        error: extractFailureMessage(
          outlineRes.events,
          outlineRes.state,
          !!outlineRes.output,
          {
            iterations: outlineRes.iterations,
            wallTimeMs: outlineRes.wallTimeMs,
          },
        ),
      },
    );
    // ★ degraded 也算"有产出"（reflexion verifier 评分略低于阈值但 outputSchema 合法）
    const outlineUsable =
      (outlineRes.state === "completed" || outlineRes.state === "degraded") &&
      !!outlineRes.output;
    if (!outlineUsable) {
      await emitGraded({
        ok: false,
        failed: true,
        skipped: true,
        phase: "outline-failed",
        summary: `${dimensionName} · outline 未产出（state=${outlineRes.state}），跳过 chapter pipeline`,
      });
      return researcherOut;
    }
    const outline = outlineRes.output as {
      chapters: {
        index: number;
        heading: string;
        thesis: string;
        keyPoints: string[];
        sourceIndices: number[];
      }[];
    };
    await deps
      .emit({
        type: "playground.dimension:outline:planned",
        missionId,
        userId,
        agentId: dimAgentTag,
        payload: {
          dimension: dimensionName,
          chapterCount: outline.chapters.length,
          chapters: outline.chapters.map((c) => ({
            index: c.index,
            heading: c.heading,
            thesis: c.thesis,
          })),
        },
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[${missionId}] emit dimension:outline:planned for "${dimensionName}" failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    // ★ sleep 2ms: prevent outline:planned / chapter:writing:started timestamp collision
    await new Promise<void>((resolve) => setTimeout(resolve, 2));

    // ── 2. 章节 write + review loop (并发 2 章) ──
    const CHAPTER_CONCURRENCY = 2;

    // ★ RTK dedup: pre-compute first-use finding set per chapter to avoid
    //   re-embedding the same finding evidence in multiple chapter prompts.
    const firstUseByChapter = new Map<number, Set<number>>();
    {
      const allSeen = new Set<number>();
      for (const chapter of [...outline.chapters].sort(
        (a, b) => a.index - b.index,
      )) {
        const firstUse = new Set<number>();
        for (const globalIdx of chapter.sourceIndices) {
          if (!allSeen.has(globalIdx)) {
            firstUse.add(globalIdx);
            allSeen.add(globalIdx);
          }
        }
        firstUseByChapter.set(chapter.index, firstUse);
      }
    }

    const headingsSnapshot: readonly string[] = [];
    const settledResults = await executeChapterBatch(
      outline.chapters,
      CHAPTER_CONCURRENCY,
      headingsSnapshot,
      (chapter, snapshot) =>
        runChapterPipeline(
          chapter,
          snapshot,
          {
            missionId,
            userId,
            dimensionIdx,
            dimensionName,
            topic,
            language,
            targetWordsPerChapter,
            lengthProfile: lp,
            billing,
            budgetMultiplier,
            pool,
            firstUseByChapter,
            findings: researcherOut.findings,
            figureCandidates: researcherOut.figureCandidates,
            emitChapterFailedDone: (
              failedAttempt,
              reason,
              wordCount,
              finalScore,
            ) =>
              emitChapterFailedDoneEvent(deps, {
                missionId,
                userId,
                dimensionIdx,
                dimensionName,
                chapterIndex: chapter.index,
                failedAttempt,
                reason,
                wordCount,
                targetWordCount: targetWordsPerChapter,
                finalScore,
              }),
            store: deps.store,
          },
          deps,
        ),
      (chapter, _err) =>
        emitChapterFailedDoneEvent(deps, {
          missionId,
          userId,
          dimensionIdx,
          dimensionName,
          chapterIndex: chapter.index,
          failedAttempt: 1,
          reason: `exception: ${(_err instanceof Error ? _err.message : String(_err)).slice(0, 120)}`,
          wordCount: 0,
          targetWordCount: targetWordsPerChapter,
        }),
      deps,
      { missionId, dimensionName },
      pool,
    );

    const producedChapters: WrittenChapter[] = settledResults
      .filter(
        (r): r is PromiseFulfilledResult<WrittenChapter> =>
          r.status === "fulfilled" && r.value !== null,
      )
      .map((r) => r.value)
      .sort((a, b) => a.index - b.index);

    if (producedChapters.length === 0) {
      await emitGraded({
        ok: false,
        failed: true,
        skipped: true,
        phase: "no-chapters",
        summary: `${dimensionName} · 0/${outline.chapters.length} 章节产出 — 全部 chapter writer 失败`,
      });
      throw new Error(
        `[chapter-integrity] ${dimensionName}: 0/${outline.chapters.length} chapters produced`,
      );
    }

    // ★ 2026-05-12 v1/v2: tolerance-based integrity check + filter bad chapters
    const integrityCheck = validateWrittenChapters({
      dimensionName,
      expectedCount: outline.chapters.length,
      chapters: producedChapters,
      tolerance: {
        maxMissingRatio: loadPlaygroundRuntimeConfig().chapterToleranceRatio,
      },
    });
    const writtenChapters: WrittenChapter[] = integrityCheck.validChapters;
    if (writtenChapters.length === 0) {
      await emitGraded({
        ok: false,
        failed: true,
        skipped: true,
        phase: "no-chapters",
        summary: `${dimensionName} · ${producedChapters.length} 章产出但全部 body 不达标 — 全部丢弃`,
      });
      throw new Error(
        `[chapter-integrity] ${dimensionName}: 0/${outline.chapters.length} valid chapters (all ${producedChapters.length} produced were dropped as too-short or outline-only)`,
      );
    }
    if (integrityCheck.missingCount > 0) {
      const droppedSummary = integrityCheck.droppedChapters
        .map((d) => `§${d.chapter.index} ${d.reason}`)
        .join("; ");
      await narrate(deps.emit, missionId, userId, {
        stage: "s3-researchers",
        role: "reviewer",
        tag: "warning",
        text: `${dimensionName} · 章节完整性降级：有效 ${writtenChapters.length}/${outline.chapters.length} 章（缺 ${integrityCheck.missingCount}，${(integrityCheck.missingRatio * 100).toFixed(1)}%${droppedSummary ? "；dropped: " + droppedSummary : ""}），按部分完成继续整合与评分`,
        agentId: `chapter-integrity#${dimensionIdx}`,
        dimension: dimensionName,
      });
    }
    writtenChaptersResult = writtenChapters;

    // ── 3. Integrate ──
    const integratorAgentId = `integrator#${dimensionIdx}`;
    await deps
      .emit({
        type: "playground.dimension:integrating:started",
        missionId,
        userId,
        agentId: integratorAgentId,
        payload: {
          dimension: dimensionName,
          chapterCount: writtenChapters.length,
        },
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[${missionId}] emit dimension:integrating:started for "${dimensionName}" failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    const integrateRes = await deps.invoker.invoke(
      DimensionIntegratorAgent,
      {
        topic,
        dimension: dimensionName,
        language,
        chapters: writtenChapters,
        dimensionSummary: researcherOut.summary,
      },
      {
        missionId,
        userId,
        agentId: integratorAgentId,
        role: "integrator",
        envAdapter: billing,
      },
    );
    await deps.invoker.tickCost(
      missionId,
      userId,
      "researchers",
      pool,
      extractTokenSpend(integrateRes.events),
      integrateRes.events,
    );

    // ★ 2026-05-02: fullMarkdown is deterministically stitched from chapter bodies;
    //   LLM only produces abstract + keyFindings (short, won't be truncated).
    const ensureChapterIntro = (body: string): string => {
      const trimmed = body.trimStart();
      // body starting with H3 sub-section gets a placeholder intro (2026-05-08 PR-9-B)
      if (/^###\s+/.test(trimmed)) {
        return `> **本章导读**：以下子小节展开论述本章主题。\n\n${trimmed}`;
      }
      return body;
    };
    const stitchedFullMarkdown = writtenChapters
      .flatMap((ch) => [
        `### ${ch.heading}`,
        "",
        ensureChapterIntro(stripChartJsonFromContent(ch.body)),
        "",
      ])
      .join("\n");
    const stitchedTotalWordCount = writtenChapters.reduce(
      (s, c) => s + (c.wordCount ?? 0),
      0,
    );

    const hasUsableOutput =
      (integrateRes.state === "completed" ||
        integrateRes.state === "degraded") &&
      integrateRes.output;
    if (hasUsableOutput) {
      const integrated = integrateRes.output as {
        abstract: string;
        keyFindings: string[];
        fullMarkdown: string;
        totalWordCount: number;
      };
      abstract = integrated.abstract;
      keyFindings = integrated.keyFindings;
      fullMarkdown = stitchedFullMarkdown; // always use code-stitched version
      await deps
        .emit({
          type: "playground.dimension:integrating:completed",
          missionId,
          userId,
          agentId: integratorAgentId,
          payload: {
            dimension: dimensionName,
            totalWordCount: stitchedTotalWordCount,
            chapterCount: writtenChapters.length,
            degraded: integrateRes.state === "degraded",
          },
        })
        .catch((err: unknown) => {
          deps.log.warn(
            `[${missionId}] emit dimension:integrating:completed for "${dimensionName}" failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    } else {
      // ★ 2026-05-02: integrator failure → code-stitch fallback, never lose chapter content
      fullMarkdown = stitchedFullMarkdown;
      abstract =
        writtenChapters[0]?.body
          ?.replace(/^#{1,6}\s+[^\n]+\n+/, "")
          .slice(0, 200) ?? `${dimensionName} · 整合失败兜底摘要`;
      keyFindings = writtenChapters
        .slice(0, 3)
        .map((ch) => ch.heading || `章节 ${ch.index}`);
      await deps
        .emit({
          type: "playground.dimension:integrating:completed",
          missionId,
          userId,
          agentId: integratorAgentId,
          payload: {
            dimension: dimensionName,
            totalWordCount: stitchedTotalWordCount,
            chapterCount: writtenChapters.length,
            degraded: true,
            fallback: "code-stitched-abstract",
          },
        })
        .catch((err: unknown) => {
          deps.log.warn(
            `[${missionId}] emit dimension:integrating:completed (fallback) for "${dimensionName}" failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }

    // ── 4. 5-axis grade ──
    if (fullMarkdown && abstract) {
      const sources = researcherOut.findings.map((f) => ({ url: f.source }));
      const gradeInput = {
        topic,
        dimension: dimensionName,
        language,
        abstract,
        fullMarkdown,
        totalWordCount: writtenChapters.reduce((s, c) => s + c.wordCount, 0),
        sources,
      };
      const gradeCtx = {
        missionId,
        userId,
        agentId: gradeAgentId,
        role: "quality-judge" as const,
        envAdapter: billing,
        budgetMultiplier,
      };
      let gradeRes = await deps.reviewer.judgeDimension(gradeInput, gradeCtx);
      await deps.invoker.tickCost(
        missionId,
        userId,
        "researchers",
        pool,
        extractTokenSpend(gradeRes.events),
        gradeRes.events,
      );
      // ★ 2026-06-11 grade 输出健壮性：结构化 5 轴评分偶发坏/空 JSON（deepseek 类
      //   模型 finish=stop content 空 / 非法 action）→ 单次即 state=failed。仅对
      //   failed（真错）补一次全新重试，吸收瞬时坏输出；cancelled（abort）/degraded
      //   不重试（尊重终止 / 已有部分产出，避免无谓烧 token）。
      if (gradeRes.state === "failed") {
        deps.log.warn(
          `[per-dim grade] dim "${dimensionName}" 首次评分 state=failed，容错重试一次`,
        );
        const retryRes = await deps.reviewer.judgeDimension(gradeInput, {
          ...gradeCtx,
          agentId: `${gradeAgentId}.retry`,
        });
        await deps.invoker.tickCost(
          missionId,
          userId,
          "researchers",
          pool,
          extractTokenSpend(retryRes.events),
          retryRes.events,
        );
        if (retryRes.state === "completed" && retryRes.output) {
          gradeRes = retryRes;
        }
      }
      if (gradeRes.state === "completed" && gradeRes.output) {
        const g = gradeRes.output as NonNullable<PerDimPipelineResult["grade"]>;
        // ★ 2026-05-23 review-fix #3：评分接地 + overall 重算（纯函数，见 grade-grounding.util）
        groundDimensionGrade(g, evidenceBudget.uniqueSources);
        grade = g;
        await emitGraded({ ok: true, g });
        // ★ sources_sufficiency warning (2026-05-06)
        const sourcesSufficiency = (
          g.axes as Record<string, { score: number; comment: string }>
        )["sources_sufficiency"];
        if (sourcesSufficiency && sourcesSufficiency.score < 60) {
          deps.log.warn(
            `[per-dim grade] dim "${dimensionName}" sources_sufficiency=${sourcesSufficiency.score} < 60: ${sourcesSufficiency.comment}`,
          );
          await narrate(deps.emit, missionId, userId, {
            stage: "s3-researchers",
            role: "reviewer",
            tag: "warning",
            text: `${dimensionName} · 来源充分性不足（sources_sufficiency=${sourcesSufficiency.score}/100）：${sourcesSufficiency.comment.slice(0, 100)}`,
            agentId: gradeAgentId,
            dimension: dimensionName,
          });
        }
      } else {
        // ★ 2026-06-11 观测性：surface grade agent 真实失败原因（failureCode/message），
        //   不再只写死 "state=failed"。真因来自 gradeRes.events（如 PROVIDER_SAFETY_REFUSAL
        //   内容护栏误拦、PROVIDER_API_ERROR、JSON parse 失败），让 UI/兜底 summary 自报，
        //   不必再翻后台日志定位。
        const reason = extractFailureMessage(
          gradeRes.events,
          gradeRes.state,
          !!gradeRes.output,
        );
        await emitGraded({
          ok: false,
          failed: true,
          phase: "grade-failed",
          summary: `${dimensionName} · grade 阶段失败（state=${gradeRes.state}），无 5 轴评分${
            reason ? `：${reason}` : ""
          }。`,
        });
      }
    } else {
      await emitGraded({
        ok: false,
        failed: true,
        skipped: true,
        phase: "integrator-failed",
        summary: `${dimensionName} · integrator 未产出 fullMarkdown/abstract，跳过 5 轴评分（chapter ${writtenChapters.length} 章已落地，但缺整合）。`,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await emitGraded({
      ok: false,
      failed: true,
      phase: "pipeline-exception",
      summary: `${dimensionName} · per-dim pipeline 异常终止: ${msg.slice(0, 200)}`,
    });
    throw err;
  } finally {
    // ★ INVARIANT fallback: guarantee at least one terminal graded event
    if (!terminalEmitted) {
      await emitGraded({
        ok: false,
        failed: true,
        phase: "fallback-finally",
        summary: `${dimensionName} · per-dim pipeline 未发评分事件即返回（chapter ${writtenChaptersResult.length} 章已落地）`,
      });
    }
  }

  return {
    ...researcherOut,
    chapters: writtenChaptersResult,
    abstract,
    keyFindings,
    fullMarkdown,
    grade,
  };
}
