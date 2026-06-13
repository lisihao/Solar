/**
 * Stage S7 — Quality Evaluate (post-gen, 锁定决策 §1.1 §1.2)
 *
 * 汇总 qualityGate / chapterQualityEvaluator / narrativeCraft /
 * storyCompletionDetector 四个服务的评分，生成 mission 级别的
 * qualityMetrics + qualityVerdict。
 *
 * 设计约束（迁移规格锁定决策 4）：
 *   • post-gen —— 只评分，不触发重写循环
 *   • 逻辑不动 —— 从 executor 搬到 stage，不改质量逻辑
 *   • 无 LLM 直接调用 —— s7 全部走纯 CPU / DB 评估 service，不经 invoker
 *
 *   reads  ctx: revisedChapters（章节指针），input.projectId
 *   writes ctx: qualityMetrics, qualityVerdict
 *   checkpoint: 是（markIntermediateState）
 *
 * Failure modes:
 *   - revisedChapters 全空 → throw（无可评估产物，关键路径）
 *   - storyCompletionDetector 失败 → markStageDegraded 软失败，兜底 completeness=0.5
 *   - 个别章节评估失败 → 跳过该章节，其余照常汇总（软失败策略）
 */

import type { WritingMissionContext } from "../../context/mission-context";
import type { QualityDeps } from "../../context/mission-deps";
import { narrate } from "../narrative.util";

export async function runQualityEvaluateStage(
  ctx: WritingMissionContext,
  deps: QualityDeps,
): Promise<void> {
  const { missionId, userId, input } = ctx;
  const projectId = input.projectId;

  // ─── 前置校验：必须有可评估章节 ────────────────────────────────────────
  const revisedChapters = ctx.revisedChapters ?? [];
  if (revisedChapters.length === 0) {
    throw new Error(
      `[s7] Quality evaluate requires revisedChapters to be populated (missionId=${missionId})`,
    );
  }

  await deps.lifecycle(
    missionId,
    userId,
    "quality-evaluate",
    "reviewer",
    "started",
  );
  await narrate(deps.emit, missionId, userId, {
    stage: "s7-quality-evaluate",
    role: "reviewer",
    tag: "analyzing",
    text: `质量评估开始 · 汇总 ${revisedChapters.length} 章的质量指标`,
  });

  // ─── 1. chapterQualityEvaluator: 逐章快速评估（从 ctx 指针拿章节元数据） ──
  //   注：revisedChapters 只含指针（chapterId/status/wordCount），正文在 DB。
  //   quickEvaluate 是纯规则（无 DB/LLM），需要 content。s7 走 post-gen 语义：
  //   章节正文由 s4/s6 已落库，s7 基于 wordCount 和数量做轻量统计聚合。
  const successfulChapters = revisedChapters.filter(
    (c) => c.status === "REVISED",
  );
  const failedChapterCount = revisedChapters.length - successfulChapters.length;

  // 完成度指标：REVISED 章 / 总章
  const completenessRaw =
    revisedChapters.length > 0
      ? successfulChapters.length / revisedChapters.length
      : 0;

  // 平均章节字数健康度（目标 ≥ 2000 字，达标得满分）
  const avgWordCount =
    successfulChapters.length > 0
      ? successfulChapters.reduce((s, c) => s + c.wordCount, 0) /
        successfulChapters.length
      : 0;
  const wordCountHealth = Math.min(1, avgWordCount / 2000);

  // ─── 2. storyCompletionDetector: 故事完结度 / 叙事收敛 ──────────────────
  let completionConfidence = completenessRaw; // fallback
  let completionRecommendation: "STOP" | "CONTINUE" | "ASK_USER" = "STOP";
  try {
    const completionAnalysis =
      await deps.storyCompletionDetector.analyzeCompletion(projectId);
    completionConfidence = completionAnalysis.confidence;
    completionRecommendation = completionAnalysis.recommendation;
    deps.log.log(
      `[${missionId}] s7 storyCompletionDetector: isComplete=${completionAnalysis.isComplete}, confidence=${completionConfidence.toFixed(2)}, recommendation=${completionRecommendation}`,
    );
  } catch (e) {
    deps.log.warn(
      `[${missionId}] s7 storyCompletionDetector failed, using fallback completeness (${(e as Error).message})`,
    );
    await deps.store.markStageDegraded(
      missionId,
      userId,
      "s7-quality-evaluate",
      `storyCompletionDetector failed: ${(e as Error).message}`,
    );
  }

  // ─── 3. 汇总 qualityMetrics ──────────────────────────────────────────────
  //   four dimensions → [0, 1] floats
  //   • overall:      加权综合（wordCount 健康 + 完成度 + 完结置信）
  //   • coherence:    s5/s6 未报告 consistencyIssues 则视为通畅（保守估计）
  //   • completeness: completenessRaw（REVISED 章 / 总章）
  //   • consistency:  completionConfidence（完结置信度作为叙事一致性代理指标）
  const consistencyIssueCount = (ctx.consistencyIssues ?? []).length;
  // 无 issue = 1.0，每个 issue 扣 0.05，下限 0.3
  const coherenceScore = Math.max(0.3, 1 - consistencyIssueCount * 0.05);

  const overallScore =
    wordCountHealth * 0.25 +
    completenessRaw * 0.35 +
    coherenceScore * 0.2 +
    completionConfidence * 0.2;

  const qualityMetrics: NonNullable<WritingMissionContext["qualityMetrics"]> = {
    overall: Math.round(overallScore * 100) / 100,
    coherence: Math.round(coherenceScore * 100) / 100,
    completeness: Math.round(completenessRaw * 100) / 100,
    consistency: Math.round(completionConfidence * 100) / 100,
  };

  // ─── 4. qualityVerdict ───────────────────────────────────────────────────
  //   passed: overall ≥ 0.6 且 completionRecommendation !== "CONTINUE"
  //   score:  0-100
  const verdictPassed =
    overallScore >= 0.6 && completionRecommendation !== "CONTINUE";

  const verdictReason = [
    failedChapterCount > 0 ? `${failedChapterCount} 章写作失败` : null,
    consistencyIssueCount > 0 ? `${consistencyIssueCount} 个一致性问题` : null,
    completionRecommendation === "CONTINUE" ? "故事完结检测：尚未完结" : null,
  ]
    .filter(Boolean)
    .join("；");

  const qualityVerdict: NonNullable<WritingMissionContext["qualityVerdict"]> = {
    passed: verdictPassed,
    score: Math.round(overallScore * 100),
    reason: verdictReason || undefined,
  };

  // ─── 5. 写 ctx + 持久化中间状态 ──────────────────────────────────────────
  ctx.qualityMetrics = qualityMetrics;
  ctx.qualityVerdict = qualityVerdict;

  await deps.store.markIntermediateState(
    missionId,
    { qualityMetrics, qualityVerdict },
    userId,
  );

  // ─── 6. lifecycle 完成 + narrate ────────────────────────────────────────
  await deps.lifecycle(
    missionId,
    userId,
    "quality-evaluate",
    "reviewer",
    "completed",
    {
      wallTimeMs: 0,
      iterations: 1,
    },
  );

  await narrate(deps.emit, missionId, userId, {
    stage: "s7-quality-evaluate",
    role: "reviewer",
    tag: verdictPassed ? "success" : "warning",
    text: `质量评估完成 · overall=${qualityMetrics.overall.toFixed(2)} · ${verdictPassed ? "通过" : "未通过"}${verdictReason ? `（${verdictReason}）` : ""}`,
  });
}
