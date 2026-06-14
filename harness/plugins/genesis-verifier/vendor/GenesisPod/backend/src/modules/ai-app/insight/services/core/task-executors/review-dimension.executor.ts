import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ResearchTaskStatus } from "@prisma/client";
import { ResearchEventEmitterService } from "../research/research-event-emitter.service";
import { ResearchReviewerService } from "../../collaboration/research-reviewer.service";
import { AgentActivityService } from "../../monitoring/agent-activity.service";
import { DataSourceFetcherService } from "../../data/data-source-fetcher.service";
import { DataSourceType } from "../../../types/data-source.types";
import type { DimensionAnalysisResult } from "../../../types/research.types";
import type {
  DimensionReviewResult,
  ReviewIssue,
} from "../../../types/collaboration.types";
import { ReviewQualityLevel } from "../../../types/collaboration.types";
import type {
  ITaskExecutor,
  TaskExecutionContext,
  TaskExecutionResult,
} from "./task-executor.interface";

/** Shape of task result json for quality_review */
interface TaskResultJson {
  summary?: string;
  keyFindings?: Array<
    | string
    | {
        finding: string;
        title?: string;
        significance?: string;
        evidenceIds?: string[];
      }
  >;
  analysisResult?: {
    summary?: string;
    keyFindings?: Array<
      string | { finding: string; title?: string; significance?: string }
    >;
  };
  detailedContent?: string;
  evidenceUsed?: number;
  confidenceLevel?: string;
  trends?: unknown;
  challenges?: unknown;
  opportunities?: unknown;
  actualModelId?: string;
}

@Injectable()
export class ReviewDimensionExecutor implements ITaskExecutor {
  private readonly logger = new Logger(ReviewDimensionExecutor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly researchEventEmitter: ResearchEventEmitterService,
    private readonly reviewerService: ResearchReviewerService,
    private readonly agentActivity: AgentActivityService,
    private readonly dataSourceFetcher: DataSourceFetcherService,
  ) {}

  async execute(context: TaskExecutionContext): Promise<TaskExecutionResult> {
    const { task, topic, missionId, depthConfig, assignedModelId } = context;

    // ★ 发送审核开始提示（传递 missionId 以便持久化）
    await this.researchEventEmitter.emitAgentWorking(
      topic.id,
      {
        agentId: task.assignedAgent,
        agentName: "质量审核员",
        agentRole: "reviewer",
        status: "working",
        taskDescription: "正在审核所有维度研究结果的质量...",
        progress: 10,
        modelId: assignedModelId, // ★ 传递模型 ID
      },
      missionId,
    );

    // ★ 获取所有已完成的维度研究结果及其维度信息
    const completedTasks = await this.prisma.researchTask.findMany({
      where: {
        missionId,
        taskType: "dimension_research",
        status: ResearchTaskStatus.COMPLETED,
      },
      include: {
        mission: {
          include: {
            topic: {
              include: {
                dimensions: true,
              },
            },
          },
        },
      },
    });

    if (completedTasks.length === 0) {
      return {
        reviewedTasks: 0,
        status: "skipped",
        feedback: "没有已完成的维度研究任务需要审核",
      };
    }

    // ★ 读取 enableAiQualityReview 标志（默认关闭，使用确定性检查）
    const topicConfig = (topic as { topicConfig?: Record<string, unknown> })
      .topicConfig;
    const enableAiQualityReview = topicConfig?.enableAiQualityReview === true;

    this.logger.log(
      `[ReviewDimensionExecutor] enableAiQualityReview=${enableAiQualityReview}`,
    );

    // ============ V5: 认知循环 (Claim → Verify → Gap Search → Re-verify) ============
    // 仅在启用 AI 质量审核时运行
    if (
      enableAiQualityReview &&
      depthConfig &&
      depthConfig.maxCognitiveLoops > 0
    ) {
      this.logger.log(
        `[V5] Running cognitive loop before quality review (maxLoops=${depthConfig.maxCognitiveLoops})`,
      );

      try {
        // 收集所有维度研究的摘要作为证据
        let evidenceSummary = completedTasks
          .map((t) => {
            const taskResult = t.result as TaskResultJson;
            return (
              taskResult?.summary || taskResult?.analysisResult?.summary || ""
            );
          })
          .filter(Boolean)
          .join("\n\n")
          .substring(0, 8000);

        // 从结果中提取 claims（key findings 作为 claims）
        const allClaims: import("../../../types/research-depth.types").ExtractedClaim[] =
          [];
        for (const t of completedTasks) {
          const taskResult = t.result as TaskResultJson;
          const findings =
            taskResult?.keyFindings ||
            taskResult?.analysisResult?.keyFindings ||
            [];
          for (let i = 0; i < findings.length; i++) {
            const f = findings[i];
            allClaims.push({
              id: `${t.id}-claim-${i}`,
              statement:
                typeof f === "string"
                  ? f
                  : f.finding || f.title || JSON.stringify(f),
              sectionId: t.dimensionId || t.id,
              sourceEvidenceIndices: [],
              importance: (() => {
                const sig = typeof f === "object" && f.significance;
                return sig === "high" || sig === "low" ? sig : "medium";
              })(),
            });
          }
        }

        if (allClaims.length === 0 || evidenceSummary.length === 0) {
          this.logger.log(
            `[V5] No claims or evidence to validate, skipping cognitive loop`,
          );
        } else {
          // ★ Iterative cognitive loop: verify → find gaps → search → re-verify
          for (
            let loopIdx = 0;
            loopIdx < depthConfig.maxCognitiveLoops;
            loopIdx++
          ) {
            const loopNum = loopIdx + 1;

            await this.researchEventEmitter.emitAgentWorking(
              topic.id,
              {
                agentId: task.assignedAgent,
                agentName: "质量审核员",
                agentRole: "reviewer",
                status: "working",
                taskDescription: `V5: 认知循环 ${loopNum}/${depthConfig.maxCognitiveLoops} - 验证断言...`,
                progress: 5 + loopIdx * 3,
                modelId: assignedModelId,
              },
              missionId,
            );

            // Step 1: Validate claims against current evidence
            const validation = await this.reviewerService.validateClaims(
              allClaims,
              evidenceSummary,
            );

            this.logger.log(
              `[V5] Loop ${loopNum}: ${validation.stats.verified} verified, ${validation.stats.disputed} disputed, ${validation.stats.unverified} unverified`,
            );

            // Step 2: Identify high-importance gaps (disputed + unverified)
            const gapClaims = validation.results.filter(
              (r) =>
                r.status !== "verified" &&
                allClaims.find(
                  (c) => c.id === r.claimId && c.importance !== "low",
                ),
            );

            if (gapClaims.length === 0) {
              this.logger.log(
                `[V5] Loop ${loopNum}: All important claims verified, exiting cognitive loop`,
              );

              await this.researchEventEmitter.emitAgentWorking(
                topic.id,
                {
                  agentId: task.assignedAgent,
                  agentName: "质量审核员",
                  agentRole: "reviewer",
                  status: "working",
                  taskDescription: `V5: 断言验证完成 - ${validation.stats.verified}个已验证, 无重要缺口`,
                  progress: 8,
                  modelId: assignedModelId,
                },
                missionId,
              );
              break;
            }

            // Last loop iteration — don't search, just log results
            if (loopIdx === depthConfig.maxCognitiveLoops - 1) {
              this.logger.log(
                `[V5] Loop ${loopNum}: Max loops reached, ${gapClaims.length} gaps remain`,
              );

              await this.researchEventEmitter.emitAgentWorking(
                topic.id,
                {
                  agentId: task.assignedAgent,
                  agentName: "质量审核员",
                  agentRole: "reviewer",
                  status: "working",
                  taskDescription: `V5: 认知循环完成 - ${validation.stats.verified}个已验证, ${gapClaims.length}个缺口待补充`,
                  progress: 8,
                  modelId: assignedModelId,
                },
                missionId,
              );
              break;
            }

            // Step 3: Generate targeted search queries for gaps
            const gapQueries =
              await this.reviewerService.generateGapSearchQueries(
                gapClaims,
                evidenceSummary,
              );

            if (gapQueries.length === 0) {
              this.logger.log(
                `[V5] Loop ${loopNum}: No gap queries generated, exiting`,
              );
              break;
            }

            await this.researchEventEmitter.emitAgentWorking(
              topic.id,
              {
                agentId: task.assignedAgent,
                agentName: "质量审核员",
                agentRole: "reviewer",
                status: "working",
                taskDescription: `V5: 发现 ${gapClaims.length} 个知识缺口，补充搜索 ${gapQueries.length} 条查询...`,
                progress: 6 + loopIdx * 3,
                modelId: assignedModelId,
              },
              missionId,
            );

            // Step 4: Execute supplementary searches
            const newEvidenceParts: string[] = [];
            for (const gq of gapQueries) {
              try {
                const results = await this.dataSourceFetcher.executeSearch(
                  gq.searchType === "academic"
                    ? DataSourceType.ACADEMIC
                    : DataSourceType.WEB,
                  gq.query,
                  3, // Light search: max 3 results per query
                );

                for (const r of results) {
                  if (r.snippet || r.title) {
                    newEvidenceParts.push(
                      `[补充证据] ${r.title || ""}: ${(r.snippet || "").substring(0, 500)}`,
                    );
                  }
                }
              } catch (searchError) {
                this.logger.warn(
                  `[V5] Gap search failed for "${gq.query}": ${searchError}`,
                );
              }
            }

            if (newEvidenceParts.length === 0) {
              this.logger.log(
                `[V5] Loop ${loopNum}: Supplementary search returned no results, exiting`,
              );
              break;
            }

            // Step 5: Append new evidence and continue loop for re-validation
            this.logger.log(
              `[V5] Loop ${loopNum}: Found ${newEvidenceParts.length} supplementary evidence items, re-validating...`,
            );
            evidenceSummary = (
              evidenceSummary +
              "\n\n--- 补充搜索证据 ---\n" +
              newEvidenceParts.join("\n")
            ).substring(0, 12000); // Expand evidence budget for re-validation
          }
        }
      } catch (error) {
        this.logger.warn(`[V5] Cognitive loop failed (non-fatal): ${error}`);
      }
    }

    // ★ 执行质量审核（AI 模式 or 确定性模式）
    const dimensionReviews: DimensionReviewResult[] = [];
    const dimensions = topic.dimensions || [];

    if (enableAiQualityReview) {
      // === AI 质量审核模式（含 LLM 调用）===
      for (let i = 0; i < completedTasks.length; i++) {
        const completedTask = completedTasks[i];
        const dimension = dimensions.find(
          (d: { id: string }) => d.id === completedTask.dimensionId,
        );

        if (!dimension) continue;

        // 更新进度
        const reviewProgress = Math.round(
          10 + ((i + 1) / completedTasks.length) * 70,
        );
        await this.researchEventEmitter.emitAgentWorking(
          topic.id,
          {
            agentId: task.assignedAgent,
            agentName: "质量审核员",
            agentRole: "reviewer",
            status: "working",
            taskDescription: `正在审核维度「${dimension.name}」...`,
            progress: reviewProgress,
            modelId: assignedModelId,
          },
          missionId,
        );

        // 从任务结果中提取分析数据
        // ★ task.result 直接存储的是 DimensionAnalysisResult（见 executeTask line 389）
        // 而不是 DimensionMissionResult 的嵌套结构
        const taskResult = completedTask.result as Record<
          string,
          unknown
        > | null;
        const analysisResult = (
          taskResult?.analysisResult
            ? taskResult.analysisResult
            : taskResult?.summary || taskResult?.keyFindings
              ? taskResult
              : null
        ) as DimensionAnalysisResult | null;

        // 如果没有分析结果，跳过审核
        if (!analysisResult) {
          this.logger.warn(
            `No analysis result found for dimension ${dimension.name}, skipping review`,
          );
          continue;
        }

        // 调用审核服务
        try {
          const review = await this.reviewerService.reviewDimension(
            topic,
            dimension,
            analysisResult,
            analysisResult.evidenceUsed || 0,
          );
          dimensionReviews.push(review);

          // ★ 记录维度审核结果到活动记录（供前端展示详细审核数据）
          await this.agentActivity.recordDimensionReview(
            topic.id,
            missionId,
            dimension.id,
            dimension.name,
            review,
          );

          // ★ 发送维度审核结果事件（包含评分和结论）
          const dimQualityLevelCn = this.getQualityLevelCn(review.qualityLevel);
          const dimTopIssue = review.issues[0]?.description ?? null;
          const dimScoreRounded = Math.round(review.overallScore);
          const dimTaskDescription = dimTopIssue
            ? `「${dimension.name}」审核完成：${dimQualityLevelCn}（${dimScoreRounded}分）— ${dimTopIssue.length > 50 ? dimTopIssue.substring(0, 50) + "…" : dimTopIssue}`
            : `「${dimension.name}」审核完成：${dimQualityLevelCn}（${dimScoreRounded}分）`;
          await this.researchEventEmitter.emitAgentWorking(
            topic.id,
            {
              agentId: task.assignedAgent,
              agentName: "质量审核员",
              agentRole: "reviewer",
              status: "working",
              taskDescription: dimTaskDescription,
              progress: reviewProgress,
              modelId: assignedModelId,
              dimensionId: dimension.id,
              dimensionName: dimension.name,
              reviewResult: {
                qualityLevel: review.qualityLevel,
                overallScore: review.overallScore,
                scores: review.scores,
                issueCount: review.issues.length,
                suggestions: review.suggestions.slice(0, 3),
                needsReresearch: review.needsReresearch,
              },
            },
            missionId,
          );
        } catch (error) {
          this.logger.warn(
            `Failed to review dimension ${dimension.name}: ${error}`,
          );
        }
      }
    } else {
      // === 确定性质量审核模式（无 LLM 调用）===
      for (let i = 0; i < completedTasks.length; i++) {
        const completedTask = completedTasks[i];
        const dimension = dimensions.find(
          (d: { id: string }) => d.id === completedTask.dimensionId,
        );
        if (!dimension) continue;

        const taskResult = completedTask.result as Record<
          string,
          unknown
        > | null;
        const analysisResult = (
          taskResult?.analysisResult
            ? taskResult.analysisResult
            : taskResult?.summary || taskResult?.keyFindings
              ? taskResult
              : null
        ) as DimensionAnalysisResult | null;

        if (!analysisResult) continue;

        // 确定性评分（基于启发式规则，无 LLM）
        const contentLength =
          (analysisResult.detailedContent as string | undefined)?.length || 0;
        const findingsCount =
          (analysisResult.keyFindings as unknown[])?.length || 0;
        const trendsCount = (analysisResult.trends as unknown[])?.length || 0;
        const challengesCount =
          (analysisResult.challenges as unknown[])?.length || 0;
        const opportunitiesCount =
          (analysisResult.opportunities as unknown[])?.length || 0;
        const evidenceUsed = analysisResult.evidenceUsed || 0;

        const breadthScore = Math.min(
          100,
          (findingsCount >= 5 ? 40 : findingsCount * 8) +
            (trendsCount >= 3 ? 20 : trendsCount * 7) +
            (challengesCount >= 2 ? 20 : challengesCount * 10) +
            (opportunitiesCount >= 2 ? 20 : opportunitiesCount * 10),
        );

        const depthScore = Math.min(
          100,
          (contentLength >= 3000 ? 50 : Math.round(contentLength / 60)) +
            (findingsCount >= 3 ? 30 : findingsCount * 10) +
            (evidenceUsed >= 5 ? 20 : evidenceUsed * 4),
        );

        const evidenceScore = Math.min(
          100,
          evidenceUsed >= 10
            ? 90
            : evidenceUsed >= 5
              ? 70
              : evidenceUsed >= 3
                ? 50
                : evidenceUsed * 15,
        );

        const coherenceScore = Math.min(
          100,
          ((analysisResult.summary as string | undefined) ? 30 : 0) +
            (findingsCount > 0 ? 30 : 0) +
            (contentLength >= 500 ? 20 : 0) +
            ((analysisResult.confidenceLevel as string | undefined) ? 20 : 0),
        );

        const currencyScore = 75; // 无 LLM 时默认合理分值

        const overallScore = Math.round(
          breadthScore * 0.25 +
            depthScore * 0.25 +
            evidenceScore * 0.25 +
            coherenceScore * 0.15 +
            currencyScore * 0.1,
        );

        // 基于启发式规则生成问题列表
        const issues: ReviewIssue[] = [];
        if (contentLength < 500) {
          issues.push({
            type: "shallow_analysis",
            severity: "major",
            description: `内容较短（${contentLength} 字符），建议充实分析内容`,
          });
        }
        if (findingsCount < 3) {
          issues.push({
            type: "missing_coverage",
            severity: "major",
            description: `关键发现较少（${findingsCount} 条），建议覆盖更多方面`,
          });
        }
        if (evidenceUsed < 3) {
          issues.push({
            type: "weak_evidence",
            severity: "major",
            description: `证据支撑不足（${evidenceUsed} 条），建议增加数据来源`,
          });
        }

        const qualityLevel: ReviewQualityLevel =
          overallScore >= 90
            ? ReviewQualityLevel.EXCELLENT
            : overallScore >= 75
              ? ReviewQualityLevel.GOOD
              : overallScore >= 60
                ? ReviewQualityLevel.ACCEPTABLE
                : overallScore >= 40
                  ? ReviewQualityLevel.NEEDS_REVISION
                  : ReviewQualityLevel.REJECTED;

        const review: DimensionReviewResult = {
          dimensionId: dimension.id,
          dimensionName: dimension.name,
          qualityLevel,
          overallScore,
          scores: {
            breadth: breadthScore,
            depth: depthScore,
            evidence: evidenceScore,
            coherence: coherenceScore,
            currency: currencyScore,
          },
          issues,
          suggestions: issues.map((iss) => iss.description),
          needsReresearch: overallScore < 60,
          reresearchFocus: overallScore < 60 ? ["全部内容"] : [],
        };

        dimensionReviews.push(review);

        // ★ 记录维度审核结果到活动记录
        await this.agentActivity.recordDimensionReview(
          topic.id,
          missionId,
          dimension.id,
          dimension.name,
          review,
        );

        // ★ 发送进度事件
        const reviewProgress = Math.round(
          10 + ((i + 1) / completedTasks.length) * 70,
        );
        const dimQualityLevelCn = this.getQualityLevelCn(review.qualityLevel);
        await this.researchEventEmitter.emitAgentWorking(
          topic.id,
          {
            agentId: task.assignedAgent,
            agentName: "质量审核员",
            agentRole: "reviewer",
            status: "working",
            taskDescription: `「${dimension.name}」快速检查完成：${dimQualityLevelCn}（${overallScore}分）`,
            progress: reviewProgress,
            modelId: assignedModelId,
            dimensionId: dimension.id,
            dimensionName: dimension.name,
            reviewResult: {
              qualityLevel: review.qualityLevel,
              overallScore: review.overallScore,
              scores: review.scores,
              issueCount: review.issues.length,
              suggestions: review.suggestions.slice(0, 3),
              needsReresearch: review.needsReresearch,
            },
          },
          missionId,
        );
      }
    }

    // ★ 执行全局审核
    let overallReview = null;
    if (dimensionReviews.length > 0) {
      try {
        overallReview = await this.reviewerService.reviewOverall(
          topic,
          dimensions,
          dimensionReviews,
        );

        // ★ 记录整体审核结果到活动记录
        if (overallReview) {
          await this.agentActivity.recordOverallReview(
            topic.id,
            missionId,
            overallReview,
          );

          // ★ 发送整体审核结果事件
          const overallQualityLevelCn = this.getQualityLevelCn(
            overallReview.qualityLevel,
          );
          const overallScoreRounded = Math.round(overallReview.overallScore);
          const passedCount = dimensionReviews.filter(
            (r) => r.overallScore >= 60,
          ).length;
          const failedCount = dimensionReviews.length - passedCount;
          const topRecommendation = overallReview.recommendations[0] ?? null;
          let overallTaskDescription = `整体质量审核完成：${overallScoreRounded}分/${overallQualityLevelCn}，${passedCount}个维度通过`;
          if (failedCount > 0)
            overallTaskDescription += `，${failedCount}个需补充研究`;
          if (topRecommendation) {
            const truncated =
              topRecommendation.length > 50
                ? topRecommendation.substring(0, 50) + "…"
                : topRecommendation;
            overallTaskDescription += `。主要建议：${truncated}`;
          }
          await this.researchEventEmitter.emitAgentWorking(
            topic.id,
            {
              agentId: task.assignedAgent,
              agentName: "质量审核员",
              agentRole: "reviewer",
              status: "completed",
              taskDescription: overallTaskDescription,
              progress: 100,
              modelId: assignedModelId,
              reviewResult: {
                type: "overall",
                qualityLevel: overallReview.qualityLevel,
                overallScore: overallReview.overallScore,
                dimensionCount: dimensionReviews.length,
                recommendations: overallReview.recommendations.slice(0, 5),
                needsReresearch: overallReview.needsReresearch,
                dimensionsToReresearch: overallReview.dimensionsToReresearch,
              },
            },
            missionId,
          );
        }
      } catch (error) {
        this.logger.warn(`Failed to perform overall review: ${error}`);
      }
    }

    // ★ 提取最后一个审核结果的实际模型ID
    const lastReviewModel = dimensionReviews
      .map((r) => r.actualModelId)
      .filter(Boolean)
      .pop();

    // ★ 确定修订轮次（从 task.description 中读取，默认 round=1）
    const currentRound = this.parseRevisionRound(task.description);

    // ★ 决定是否需要修订
    const revisionDecision = this.determineRevisionTargets(
      dimensionReviews,
      completedTasks,
      currentRound,
    );

    if (revisionDecision.needsRevision) {
      this.logger.log(
        `[ReviewDimensionExecutor] Round ${currentRound}: ${revisionDecision.targets.length} dimension(s) need revision`,
      );
    }

    return {
      reviewedTasks: completedTasks.length,
      dimensionReviews: dimensionReviews.map((r) => ({
        dimensionName: r.dimensionName,
        qualityLevel: r.qualityLevel,
        score: r.overallScore,
        issues: r.issues.length,
        suggestions: r.suggestions.slice(0, 3),
      })),
      overallReview: overallReview
        ? {
            qualityLevel: overallReview.qualityLevel,
            score: overallReview.overallScore,
            recommendations: overallReview.recommendations.slice(0, 5),
            needsReresearch: overallReview.needsReresearch,
          }
        : null,
      status: overallReview?.qualityLevel || "approved",
      feedback:
        overallReview?.recommendations?.join("; ") ||
        `已审核 ${completedTasks.length} 个维度研究结果`,
      actualModelId: lastReviewModel, // ★ 记录实际使用的模型
      // ★ 修订决策信息（供 MissionExecutionService 消费）
      revisionTargets: revisionDecision.targets,
      revisionRound: currentRound,
    };
  }

  /**
   * 从任务描述中解析当前修订轮次
   * 格式：描述末尾追加 " [revision:N]"
   */
  private parseRevisionRound(description: string): number {
    const match = /\[revision:(\d+)\]/.exec(description);
    return match ? parseInt(match[1], 10) : 1;
  }

  /**
   * 确定哪些维度需要修订
   *
   * 触发条件：
   * - overallScore < 60，或
   * - evidence < 40，depth < 35，breadth < 35，coherence < 30（硬底线）
   *
   * 限制：最大修订 2 轮（currentRound >= 2 时不再触发）
   */
  private determineRevisionTargets(
    dimensionReviews: DimensionReviewResult[],
    completedTasks: Array<{ id: string; dimensionId: string | null }>,
    currentRound: number,
  ): {
    needsRevision: boolean;
    targets: Array<{
      taskId: string;
      dimensionId: string;
      dimensionName: string;
      score: number;
      feedback: string;
    }>;
  } {
    // 硬上限：已经是第 2 轮审核，不再修订（降级通过）
    if (currentRound >= 2) {
      return { needsRevision: false, targets: [] };
    }

    const targets: Array<{
      taskId: string;
      dimensionId: string;
      dimensionName: string;
      score: number;
      feedback: string;
    }> = [];

    for (const review of dimensionReviews) {
      const failsOverall = review.overallScore < 60;
      const failsEvidence = review.scores.evidence < 40;
      const failsDepth = review.scores.depth < 35;
      const failsBreadth = review.scores.breadth < 35;
      const failsCoherence = review.scores.coherence < 30;

      const needsRevision =
        failsOverall ||
        failsEvidence ||
        failsDepth ||
        failsBreadth ||
        failsCoherence;

      if (!needsRevision) continue;

      // 找到对应的 dimension_research task
      const matchingTask = completedTasks.find(
        (t) => t.dimensionId === review.dimensionId,
      );
      if (!matchingTask) {
        this.logger.warn(
          `[determineRevisionTargets] No task found for dimensionId=${review.dimensionId}, skipping`,
        );
        continue;
      }

      // 组建反馈说明
      const failureReasons: string[] = [];
      if (failsOverall) failureReasons.push(`总分 ${review.overallScore} < 60`);
      if (failsEvidence)
        failureReasons.push(`证据分 ${review.scores.evidence} < 40`);
      if (failsDepth) failureReasons.push(`深度分 ${review.scores.depth} < 35`);
      if (failsBreadth)
        failureReasons.push(`广度分 ${review.scores.breadth} < 35`);
      if (failsCoherence)
        failureReasons.push(`连贯分 ${review.scores.coherence} < 30`);

      const topSuggestions = review.suggestions.slice(0, 3).join("；");
      const feedback = `质量不达标（${failureReasons.join("，")}）。改进建议：${topSuggestions || "请补充证据和深度分析"}`;

      targets.push({
        taskId: matchingTask.id,
        dimensionId: review.dimensionId,
        dimensionName: review.dimensionName,
        score: review.overallScore,
        feedback,
      });
    }

    return {
      needsRevision: targets.length > 0,
      targets,
    };
  }

  private getQualityLevelCn(qualityLevel: string): string {
    switch (qualityLevel) {
      case "excellent":
        return "优秀";
      case "good":
        return "良好";
      case "acceptable":
        return "可接受";
      case "needs_revision":
        return "需修订";
      case "rejected":
        return "不合格";
      default:
        return qualityLevel;
    }
  }
}
