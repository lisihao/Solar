/**
 * writing-artifact.projector.ts — WritingArtifact composer（B4 projector）
 *
 * 落地依据：writing-pipeline-migration.md §5（产物与 projector）+ 锁定决策 5。
 *
 * 设计：
 *   - @Injectable class（NestJS DI）。
 *   - project(ctx) → 单个 WritingArtifact{ sections[], metadata, quality }。
 *   - 实现 WritingArtifactProjector 接口（mission-deps.ts 的 B4 占位）。
 *   - 三个多视图方法（对齐决策 5）：
 *       toChapterList(artifact)  — 仅章节清单（大纲视图）
 *       toFullText(artifact)     — 纯文本摘要（全文视图）
 *       toQualityReport(artifact)— 质量报告视图
 *
 * 数据来源（§5）：
 *   ctx.revisedChapters[]  — 章节指针（chapterId / status / wordCount）
 *   ctx.qualityMetrics     — {overall / coherence / completeness / consistency}
 *   ctx.qualityVerdict     — {passed / score / reason}
 *   ctx.outlinePlan        — 故事大纲（含 premise / theme / structure[]{title?}）
 *   ctx.extractedFacts     — 提取的新事实（计入 metadata）
 *
 * 注意（§4.2）：
 *   revisedChapters 只存指针，正文已落 writingChapter。projector 不读 DB，
 *   section.content 留空（由调用方/前端按需回填）。s8 stage 调 project() 后
 *   再由 s8 stage 调 writingPersistence 落库。
 */

import type {
  WritingMissionContext,
  PersistPhaseCtx,
} from "../context/mission-context";

// ──────────────────────────────────────────────────────────────────────────────
// WritingArtifact 类型（ctx 中 PersistPhaseCtx.writingArtifact 的精确形态）
// 复用 mission-context 中 PersistPhaseCtx 里的内联类型，在此 export 供外部消费。
// ──────────────────────────────────────────────────────────────────────────────
export type WritingArtifact = NonNullable<PersistPhaseCtx["writingArtifact"]>;

// ──────────────────────────────────────────────────────────────────────────────
// 多视图类型
// ──────────────────────────────────────────────────────────────────────────────

/** 大纲视图：章节清单（无正文，适合侧栏导航） */
export interface WritingChapterListView {
  chapterCount: number;
  chapters: Array<{
    chapterId: string;
    chapterNumber: number;
    title: string;
    wordCount: number;
    quality?: number;
  }>;
  totalWords: number;
}

/** 全文视图：摘要文本（topic + premise + theme + 章节标题拼接） */
export interface WritingFullTextView {
  topic: string;
  premise?: string;
  theme?: string;
  chapterTitles: string[];
  totalWords: number;
  qualityScore: number;
}

/** 质量报告视图 */
export interface WritingQualityReportView {
  overall: number;
  score: number;
  passed: boolean;
  dimensions: {
    coherence: number;
    completeness: number;
    consistency: number;
  };
  chapterCount: number;
  revisedCount: number;
  reason?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Projector
// ──────────────────────────────────────────────────────────────────────────────

export class WritingArtifactProjector {
  /**
   * 从 WritingMissionContext 投影单个 WritingArtifact。
   *
   * - 读 ctx.revisedChapters（REVISED 章节指针）组装 sections[]
   * - 读 ctx.outlinePlan（大纲）补充 topic / premise / theme
   * - 读 ctx.qualityMetrics + qualityVerdict 填充 quality 字段
   * - 读 ctx.extractedFacts 计入 metadata
   *
   * @throws 若无任何 revisedChapters（关键路径，s8 会 catch 并转 lifecycle.failed）
   */
  project(ctx: WritingMissionContext): WritingArtifact {
    const { missionId, input } = ctx;

    const revisedChapters = (ctx.revisedChapters ?? []).filter(
      (c) => c.status === "REVISED",
    );

    if (revisedChapters.length === 0) {
      throw new Error(
        `[WritingArtifactProjector] No REVISED chapters to project for mission ${missionId}`,
      );
    }

    const chapterPlan = ctx.chapterPlan;
    const qualityMetrics = ctx.qualityMetrics;

    // ── sections[]（逐章指针，section.content 留空由调用方回填）────────────
    const sections = this.buildSections(revisedChapters, chapterPlan);

    // ── metadata ────────────────────────────────────────────────────────────
    const totalWords = revisedChapters.reduce((sum, c) => sum + c.wordCount, 0);

    const metadata: WritingArtifact["metadata"] = {
      totalWords,
      chapterCount: revisedChapters.length,
    };

    // ── quality ──────────────────────────────────────────────────────────────
    const quality: WritingArtifact["quality"] = {
      overall: qualityMetrics?.overall ?? 0,
      consistency: qualityMetrics?.consistency ?? 0,
      completeness: qualityMetrics?.completeness ?? 0,
    };

    return {
      id: missionId,
      projectId: input.projectId,
      sections,
      metadata,
      quality,
    };
  }

  // ── 多视图 ────────────────────────────────────────────────────────────────

  /**
   * 大纲视图：章节清单（适合侧栏导航，不含正文）。
   */
  toChapterList(artifact: WritingArtifact): WritingChapterListView {
    return {
      chapterCount: artifact.metadata.chapterCount,
      chapters: artifact.sections.map((s) => ({
        chapterId: s.chapterId,
        chapterNumber: s.chapterNumber,
        title: s.title,
        wordCount: s.wordCount,
        quality: s.quality,
      })),
      totalWords: artifact.metadata.totalWords,
    };
  }

  /**
   * 全文视图：主题 + 前提 + 主题 + 章节标题列表（用于摘要展示）。
   */
  toFullText(
    artifact: WritingArtifact,
    ctx?: Pick<WritingMissionContext, "outlinePlan" | "qualityVerdict">,
  ): WritingFullTextView {
    const outlinePlan = ctx?.outlinePlan;
    const premise = outlinePlan?.premise;
    const theme = outlinePlan?.theme;
    return {
      topic: premise ?? `项目 ${artifact.projectId}`,
      premise,
      theme,
      chapterTitles: artifact.sections.map(
        (s) => `第 ${s.chapterNumber} 章：${s.title}`,
      ),
      totalWords: artifact.metadata.totalWords,
      qualityScore: artifact.quality.overall,
    };
  }

  /**
   * 质量报告视图：质量评分 + 各维度 + 章节通过率。
   */
  toQualityReport(
    artifact: WritingArtifact,
    ctx?: Pick<
      WritingMissionContext,
      "qualityMetrics" | "qualityVerdict" | "revisedChapters"
    >,
  ): WritingQualityReportView {
    const revisedCount = (ctx?.revisedChapters ?? []).filter(
      (c) => c.status === "REVISED",
    ).length;

    return {
      overall: artifact.quality.overall,
      score:
        ctx?.qualityVerdict?.score ??
        Math.round(artifact.quality.overall * 100),
      passed: ctx?.qualityVerdict?.passed ?? artifact.quality.overall >= 0.6,
      dimensions: {
        coherence: ctx?.qualityMetrics?.coherence ?? 0,
        completeness: artifact.quality.completeness,
        consistency: artifact.quality.consistency,
      },
      chapterCount: artifact.metadata.chapterCount,
      revisedCount,
      reason: ctx?.qualityVerdict?.reason,
    };
  }

  // ── private helpers ───────────────────────────────────────────────────────

  private buildSections(
    revisedChapters: Array<{
      chapterId: string;
      chapterNumber: number;
      status: string;
      wordCount: number;
    }>,
    chapterPlan: WritingMissionContext["chapterPlan"],
  ): WritingArtifact["sections"] {
    // chapterPlan 是 StoryArchitectOutput["result"]["chapterBreakdown"]，
    // 每项有 chapterNumber + title。以 chapterNumber 建索引供标题查找。
    const titleByNumber = new Map<number, string>();
    if (Array.isArray(chapterPlan)) {
      for (const item of chapterPlan) {
        if (item && typeof item.chapterNumber === "number") {
          titleByNumber.set(item.chapterNumber, item.title);
        }
      }
    }

    return revisedChapters.map((chapter, idx) => {
      // M5 fix：用真实章号（不再 idx+1）。过滤掉中间 FAILED 章后，下标会塌缩，
      // idx+1 会把幸存章的章号/标题整体前移串位。fallback idx+1 仅防御缺值。
      const chapterNumber = chapter.chapterNumber ?? idx + 1;
      const title =
        titleByNumber.get(chapterNumber) ?? `第 ${chapterNumber} 章`;
      return {
        chapterId: chapter.chapterId,
        chapterNumber,
        title,
        wordCount: chapter.wordCount,
        // quality 字段 optional，留给外部评估后回填
      };
    });
  }
}
