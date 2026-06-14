/**
 * Dimension Writing Service
 *
 * 负责维度研究的写作和整合阶段（Phase 2 & 3）
 *
 * 核心职责：
 * 1. Agent 写作各章节（按依赖关系并行执行）
 * 2. Leader 审核各章节（多轮修订）
 * 3. Leader 整合最终结果
 * 4. 保存证据和生成分析结果
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  DimensionStatus,
  type ResearchTopic,
  type TopicDimension,
} from "@prisma/client";
import { LeaderReviewService } from "../core/leader/leader-review.service";
import { ResearchLeaderService } from "../core/research/research-leader.service";
import {
  SectionWriterService,
  type SectionWriteResult,
  type TemporalContext,
} from "./section-writer.service";
import { ResearchEventEmitterService } from "../core/research/research-event-emitter.service";
import { AgentActivityService } from "../monitoring/agent-activity.service";
import type { ThinkingPhase } from "../monitoring/agent-activity.service";
import {
  type DimensionOutline,
  type SectionPlan,
  type IntegratedDimensionResult,
} from "../../types/leader.types";
import type {
  EvidenceData,
  DimensionAnalysisResult,
  GeneratedChart,
  FigureReference,
  Trend,
  Challenge,
  Opportunity,
} from "../../types/research.types";
import { AgentActivityType } from "@prisma/client";
import type { SearchPhaseResult } from "./dimension-search.service";
import { ReportQualityGateService } from "../quality/report-quality-gate.service";
import { SectionSelfEvalService } from "../quality/section-self-eval.service";
import { SectionRemediationService } from "../quality/section-remediation.service";
import type { RemediationTrace } from "../../types/quality.types";
import { getPromptMetadata } from "../../prompts/prompt-version";
import { isValidFigureUrl } from "../../utils/sanitize-image-url.utils";

/**
 * 维度写作阶段执行结果
 */
export interface DimensionWritingResult {
  success: boolean;
  dimensionId: string;
  analysisResult?: DimensionAnalysisResult;
  evidenceIds: string[];
  outline?: DimensionOutline;
  sectionResults?: SectionWriteResult[];
  integratedResult?: IntegratedDimensionResult;
  error?: string;
  actualModelId?: string;
  extractedClaims?: import("../../types/research-depth.types").ExtractedClaim[];
}

@Injectable()
export class DimensionWritingService {
  private readonly logger = new Logger(DimensionWritingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderReview: LeaderReviewService,
    private readonly leaderService: ResearchLeaderService,
    private readonly sectionWriter: SectionWriterService,
    private readonly eventEmitter: ResearchEventEmitterService,
    private readonly agentActivity: AgentActivityService,
    private readonly qualityGate: ReportQualityGateService,
    private readonly selfEval: SectionSelfEvalService,
    private readonly remediation: SectionRemediationService,
  ) {}

  /**
   * 执行写作阶段（Phase 3）
   *
   * 职责：
   * 1. 使用全局协调的 outline 进行写作（而非本地规划）
   * 2. Agent 写作各章节
   * 3. Leader 审核各章节
   * 4. Leader 整合最终结果
   * 5. 保存证据和生成分析结果
   *
   * @param topic 研究专题
   * @param dimension 研究维度
   * @param searchPhaseResult 搜索阶段结果
   * @param outline 全局协调的维度大纲
   * @param reportId 报告ID
   * @param missionId 任务ID
   * @param modelId Leader 分配的模型 ID
   * @param taskId 研究任务ID
   * @param assignedTools Leader 分配的工具
   * @param assignedSkills Leader 分配的技能
   * @param validationContext V5: 验证上下文
   * @param maxRevisionRounds V5: 最大修订轮次
   * @param emitProgressFn 进度发送函数（可选）
   * @returns Mission 执行结果
   */
  async executeWritingPhase(
    topic: ResearchTopic,
    dimension: TopicDimension,
    searchPhaseResult: SearchPhaseResult,
    outline: DimensionOutline,
    reportId?: string,
    missionId?: string,
    modelId?: string,
    taskId?: string,
    _assignedTools?: string[],
    assignedSkills?: string[],
    validationContext?: string,
    maxRevisionRounds?: number,
    emitProgressFn?: (
      topicId: string,
      dimensionName: string,
      progress: {
        stage: string;
        sectionsTotal: number;
        sectionsCompleted: number;
        currentSection?: string;
        message: string;
      },
      missionId?: string,
      stageProgress?: number,
      taskId?: string,
    ) => Promise<void>,
  ): Promise<DimensionWritingResult> {
    const dimId = dimension.id.slice(0, 8);
    const logPrefix = `[Dimension:${dimension.name}:${dimId}]`;

    this.logger.log(
      `${logPrefix} Starting writing phase with global outline (${outline.sections.length} sections)`,
    );

    const leaderAgentId = "leader-" + dimId;
    const leaderAgentName = "研究组长";
    const researcherAgentId = `researcher_${dimId}`;
    const researcherAgentName = "研究员";
    const effectiveMissionId = missionId || dimension.id;

    try {
      // 1. 校验并清理 Leader 分配的图表
      this.validateAllocatedFigures(outline, searchPhaseResult.figureRegistry);

      this.logger.log(
        `${logPrefix} Outline validated: ${outline.sections.length} sections`,
      );

      // 记录规划完成
      const understanding = outline.intentUnderstanding;
      await this.agentActivity.endThinkingPhase(
        topic.id,
        leaderAgentId,
        "understanding" as ThinkingPhase,
        {
          actionResult: {
            sectionsCount: outline.sections.length,
            coreQuestion: understanding.coreQuestion,
            scope: understanding.scope.included,
            expectedDepth: understanding.expectedDepth,
            sections: outline.sections.map((s) => s.title),
          },
          finalContent: `规划完成：${outline.sections.length} 个章节\n核心问题: ${understanding.coreQuestion}\n研究范围: ${understanding.scope.included.join(", ")}`,
        },
      );

      // 发送 Leader 规划完成事件
      await this.eventEmitter.emitLeaderPlanReady(
        topic.id,
        dimension.id,
        outline.sections.length,
        outline.sections.length,
      );

      await this.eventEmitter.emitLeaderThinking(topic.id, {
        missionId: missionId || dimension.id,
        phase: "analyzing",
        content: `核心问题: ${understanding.coreQuestion}\n研究范围: ${understanding.scope.included.join(", ")}\n期望深度: ${understanding.expectedDepth}`,
        progress: 20,
      });

      // 2. Agent 写作各章节
      if (emitProgressFn) {
        await emitProgressFn(
          topic.id,
          dimension.name,
          {
            stage: "writing",
            sectionsTotal: outline.sections.length,
            sectionsCompleted: 0,
            message: "Agent 正在撰写章节...",
          },
          missionId,
          undefined,
          taskId,
        );
      }

      await this.agentActivity.startThinkingPhase({
        topicId: topic.id,
        missionId: effectiveMissionId,
        dimensionId: dimension.id,
        dimensionName: dimension.name,
        agentId: researcherAgentId,
        agentName: researcherAgentName,
        agentRole: "researcher",
        activityType: AgentActivityType.WRITING,
        phase: "writing",
        content: `开始撰写 ${outline.sections.length} 个章节...`,
        progress: 0,
        thinkingPhase: "writing" as ThinkingPhase,
        thinkingContent: `章节列表：${outline.sections.map((s) => s.title).join("、")}`,
      });

      const sectionResults = await this.writeSectionsWithReview(
        topic.id,
        dimension,
        outline,
        searchPhaseResult.evidenceData,
        missionId,
        modelId,
        searchPhaseResult.temporalContext,
        taskId,
        validationContext,
        maxRevisionRounds,
        emitProgressFn,
        assignedSkills,
        searchPhaseResult.figureRegistry,
      );

      // 记录写作完成
      const totalWordCount = sectionResults.reduce(
        (sum, r) => sum + (r.content?.length || 0),
        0,
      );
      await this.agentActivity.endThinkingPhase(
        topic.id,
        researcherAgentId,
        "writing" as ThinkingPhase,
        {
          writingProgress: {
            sections: sectionResults.map((r) => ({
              id: r.sectionId,
              title: r.title,
              status: "completed" as const,
              wordCount: r.content?.length || 0,
            })),
            totalWordCount,
            completedSections: sectionResults.length,
            totalSections: outline.sections.length,
          },
          finalContent: `写作完成：${sectionResults.length} 个章节，共 ${totalWordCount} 字`,
        },
      );

      // V5: Extract claims from all sections
      const allSectionContents = sectionResults.map((r) => ({
        sectionId: r.sectionId,
        content: r.content,
      }));

      let extractedClaims: import("../../types/research-depth.types").ExtractedClaim[] =
        [];
      try {
        const claimPromises = allSectionContents.map((sc) =>
          this.leaderReview.extractClaims(sc.sectionId, sc.content),
        );
        const claimResults = await Promise.all(claimPromises);
        extractedClaims = claimResults.flat();
        this.logger.log(
          `${logPrefix} V5: Extracted ${extractedClaims.length} claims from ${allSectionContents.length} sections`,
        );
      } catch (error) {
        this.logger.warn(
          `${logPrefix} V5: Claim extraction failed (non-fatal): ${error}`,
        );
      }

      // 3. Leader 整合结果
      if (emitProgressFn) {
        await emitProgressFn(
          topic.id,
          dimension.name,
          {
            stage: "integrating",
            sectionsTotal: outline.sections.length,
            sectionsCompleted: outline.sections.length,
            message: "Leader 正在整合最终报告...",
          },
          missionId,
          undefined,
          taskId,
        );
      }

      await this.agentActivity.startThinkingPhase({
        topicId: topic.id,
        missionId: effectiveMissionId,
        dimensionId: dimension.id,
        dimensionName: dimension.name,
        agentId: leaderAgentId,
        agentName: leaderAgentName,
        agentRole: "leader",
        activityType: AgentActivityType.REVIEWING,
        phase: "integrating",
        content: `正在整合 ${sectionResults.length} 个章节的研究结果...`,
        progress: 0,
        thinkingPhase: "integrating" as ThinkingPhase,
        thinkingContent: `整合章节：${sectionResults.map((s) => s.title).join("、")}`,
      });

      const integratedResult =
        await this.leaderService.integrateDimensionResults(
          { name: dimension.name, description: dimension.description },
          sectionResults.map((r) => ({ title: r.title, content: r.content })),
        );

      await this.agentActivity.endThinkingPhase(
        topic.id,
        leaderAgentId,
        "integrating" as ThinkingPhase,
        {
          actionResult: {
            summary: integratedResult.metadata?.summary?.substring(0, 200),
            keyFindings: integratedResult.metadata?.keyFindings?.length || 0,
            contentLength: integratedResult.content?.length || 0,
          },
          finalContent: `整合完成：摘要 ${integratedResult.metadata?.summary?.length || 0} 字，关键发现 ${integratedResult.metadata?.keyFindings?.length || 0} 条`,
        },
      );

      // 4. 汇总所有章节的图表（去重）
      const allGeneratedChartsRaw = sectionResults.flatMap(
        (r) => r.generatedCharts || [],
      );
      const seenChartTitles = new Set<string>();
      const allGeneratedCharts = allGeneratedChartsRaw.filter((chart) => {
        const key = chart.title?.trim().toLowerCase();
        if (!key) return true;
        if (seenChartTitles.has(key)) return false;
        seenChartTitles.add(key);
        return true;
      });

      const allFigureReferencesRaw = sectionResults.flatMap((r, sectionIdx) =>
        (r.figureReferences || []).map((fig) => ({
          ...fig,
          id:
            fig.id && String(fig.id).startsWith(`s${sectionIdx}-`)
              ? String(fig.id)
              : `s${sectionIdx}-${fig.id || "fig"}`,
        })),
      );
      const seenFigKeys = new Set<string>();
      const allFigureReferences = allFigureReferencesRaw.filter((fig) => {
        if (!fig.imageUrl) return false;
        const key = fig.figureId || fig.imageUrl;
        if (seenFigKeys.has(key)) return false;
        seenFigKeys.add(key);
        return true;
      });
      this.logger.log(
        `${logPrefix} Charts from sections: ${allFigureReferences.length} refs, ${allGeneratedCharts.length} generated`,
      );

      // 5. 保存证据到数据库并替换临时ID
      let savedEvidenceIds: string[] = [];
      let finalIntegratedResult = integratedResult;
      this.logger.log(
        `${logPrefix} Saving evidence: ${searchPhaseResult.evidenceData.length} items, reportId=${reportId || "NONE"}`,
      );
      if (reportId) {
        const { savedIds, indexMapping } = await this.saveEvidence(
          searchPhaseResult.evidenceData,
          reportId,
        );
        savedEvidenceIds = savedIds;
        this.logger.log(
          `${logPrefix} Evidence saved: ${savedIds.length} items`,
        );

        if (indexMapping.size > 0) {
          finalIntegratedResult = {
            ...integratedResult,
            content: this.replaceEvidenceIds(
              integratedResult.content,
              indexMapping,
            ),
          };
        }

        if (indexMapping.size > 0) {
          for (const ref of allFigureReferences) {
            if (ref.evidenceCitationIndex !== undefined) {
              const mapped = indexMapping.get(ref.evidenceCitationIndex);
              if (mapped !== undefined) {
                ref.evidenceCitationIndex = mapped;
              }
            }
          }
        }
      }

      // ★ 提取最后一个章节的实际模型ID（在 convertToAnalysisResult 前提取，以便写入结果）
      const lastActualModel = sectionResults
        .map((r) => r.actualModelId)
        .filter(Boolean)
        .pop();

      // ★ 收集补救追踪记录
      const remediationTraces = sectionResults
        .map((r) => r.remediationTrace)
        .filter((t): t is RemediationTrace => t !== undefined);

      // 6. 转换为标准结果格式
      const analysisResult = this.convertToAnalysisResult(
        dimension.id,
        finalIntegratedResult,
        savedEvidenceIds,
        allFigureReferences,
        allGeneratedCharts,
        lastActualModel,
        remediationTraces.length > 0 ? remediationTraces : undefined,
      );

      // 7. 更新维度状态为 COMPLETED
      await this.prisma.topicDimension.update({
        where: { id: dimension.id },
        data: {
          status: DimensionStatus.COMPLETED,
          lastResearchedAt: new Date(),
        },
      });
      this.logger.log(`${logPrefix} Status updated to COMPLETED`);

      // 8. 完成
      if (emitProgressFn) {
        await emitProgressFn(
          topic.id,
          dimension.name,
          {
            stage: "completed",
            sectionsTotal: outline.sections.length,
            sectionsCompleted: outline.sections.length,
            message: "维度研究完成",
          },
          missionId,
          undefined,
          taskId,
        );
      }

      const researcherTotalWords = sectionResults.reduce(
        (sum, r) => sum + (r.content?.length || 0),
        0,
      );
      await this.eventEmitter.emitAgentWorking(
        topic.id,
        {
          agentId: `researcher_${dimId}`,
          agentName: "研究员",
          agentRole: "researcher",
          status: "completed",
          taskDescription: `维度「${dimension.name}」研究完成：${sectionResults.length} 个章节，共 ${researcherTotalWords} 字`,
          dimensionId: dimension.id,
          dimensionName: dimension.name,
          progress: 100,
          modelId,
        },
        effectiveMissionId,
      );

      this.logger.log(`${logPrefix} Writing phase completed successfully`);

      return {
        success: true,
        dimensionId: dimension.id,
        analysisResult,
        evidenceIds: savedEvidenceIds,
        outline,
        sectionResults,
        integratedResult: finalIntegratedResult,
        actualModelId: lastActualModel,
        extractedClaims,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        `${logPrefix} Writing phase FAILED: ${errorMessage}`,
        error instanceof Error ? error.stack : error,
      );

      await this.prisma.topicDimension.update({
        where: { id: dimension.id },
        data: { status: DimensionStatus.FAILED },
      });

      if (emitProgressFn) {
        await emitProgressFn(
          topic.id,
          dimension.name,
          {
            stage: "failed",
            sectionsTotal: 0,
            sectionsCompleted: 0,
            message: `研究失败: ${errorMessage}`,
          },
          missionId,
          undefined,
          taskId,
        );
      }

      return {
        success: false,
        dimensionId: dimension.id,
        evidenceIds: [],
        error: errorMessage,
      };
    }
  }

  /**
   * 写作所有章节并进行审核
   *
   * 支持：
   * - 按依赖关系分组执行
   * - 同组内并行写作
   * - 每个章节审核 + 修订循环
   */
  private async writeSectionsWithReview(
    topicId: string,
    dimension: TopicDimension,
    outline: DimensionOutline,
    evidenceData: EvidenceData[],
    missionId?: string,
    modelId?: string,
    temporalContext?: TemporalContext,
    taskId?: string,
    validationContext?: string,
    _maxRevisionRounds?: number, // v4 已替换为质量门控，保留参数向上兼容
    emitProgressFn?: (
      topicId: string,
      dimensionName: string,
      progress: {
        stage: string;
        sectionsTotal: number;
        sectionsCompleted: number;
        currentSection?: string;
        message: string;
      },
      missionId?: string,
      stageProgress?: number,
      taskId?: string,
    ) => Promise<void>,
    assignedSkills?: string[], // ★ Leader 分配的技能（注入到 chatWithSkills）
    figureRegistry?: Map<
      string,
      import("./evidence-summary.utils").FigureRegistryEntry
    >,
  ): Promise<SectionWriteResult[]> {
    const sectionResults: SectionWriteResult[] = [];
    const sectionMap = new Map<string, SectionWriteResult>();

    const dimId = dimension.id.slice(0, 8);
    const logPrefix = `[Dimension:${dimension.name}:${dimId}]`;

    // Fetch topic for language + type setting
    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
      select: { language: true, type: true },
    });

    // 按并行组执行
    for (const [
      groupIndex,
      group,
    ] of outline.executionPlan.parallelGroups.entries()) {
      this.logger.log(
        `${logPrefix} Writing group: ${group.join(", ")}${modelId ? ` with model: ${modelId}` : ""}`,
      );

      // 获取当前组的章节
      const groupSections = outline.sections.filter((s) =>
        group.includes(s.id),
      );

      // 并行写作
      const writeInputs = groupSections.map((section, sectionIndex) => ({
        section,
        evidenceData: this.filterEvidenceForSection(section, evidenceData),
        previousSections: this.getPreviousSections(
          section,
          sectionMap,
          outline,
        ),
        missionId, // ★ 传递 missionId
        modelId,
        temporalContext,
        allocatedFigures: section.allocatedFigures,
        validationContext,
        topicLanguage: topic?.language, // ★ 传递语言设置
        assignedSkills, // ★ Leader 分配的任务级技能
        figureRegistry, // ★ 图表注册表用于 figureId 回填
        // Direction B: 只有第一并行组的第一个章节才是维度绝对第一节
        isFirstDimensionSection: groupIndex === 0 && sectionIndex === 0,
      }));

      // 发送研究员开始写作事件
      // 进度 = 已完成章节比例映射到 [15, 75] 区间（与 DimensionProgressService writing 阶段一致）
      const researcherAgentId = `researcher_${dimId}`;
      const groupStartProgress =
        15 + Math.round((sectionResults.length / outline.sections.length) * 60);
      await this.eventEmitter.emitAgentWorking(
        topicId,
        {
          agentId: researcherAgentId,
          agentName: "研究员",
          agentRole: "researcher",
          status: "working",
          taskDescription: `正在撰写章节：${groupSections.map((s) => s.title).join("、")}`,
          dimensionId: dimension.id,
          dimensionName: dimension.name,
          progress: groupStartProgress,
          modelId,
        },
        missionId,
      );

      const groupResults =
        await this.sectionWriter.writeSectionsParallel(writeInputs);

      // 逐个审核和修订
      for (let i = 0; i < groupResults.length; i++) {
        const section = groupSections[i];
        let result = groupResults[i];

        // 发送研究员章节完成事件
        const progressPercent =
          15 +
          Math.round((sectionResults.length / outline.sections.length) * 60);
        await this.eventEmitter.emitAgentWorking(
          topicId,
          {
            agentId: researcherAgentId,
            agentName: "研究员",
            agentRole: "researcher",
            status: "working",
            taskDescription: `章节「${section.title}」撰写完成（${result.content?.length || 0} 字），等待审核`,
            dimensionId: dimension.id,
            dimensionName: dimension.name,
            progress: progressPercent,
            modelId,
          },
          missionId,
        );

        // ★ v4: 质量门控替代 LLM 审阅循环
        const qc = this.qualityGate.validateDimensionContent(
          result.content,
          topic?.language || "zh",
          topic?.type,
        );

        if (qc.wasAutoFixed) {
          result = { ...result, content: qc.fixedContent };
          this.logger.log(
            `${logPrefix} [QualityGate] Auto-fixed section "${section.title}": ${qc.violations.map((v) => v.rule).join(", ")}`,
          );
        }

        // 记录质量门控结果到 Activity
        await this.agentActivity.recordReviewActivity(
          topicId,
          missionId || dimension.id,
          dimension.id,
          dimension.name,
          qc.passed
            ? `章节「${section.title}」质量门控通过`
            : `章节「${section.title}」质量门控：${qc.violations.map((v) => `${v.rule}(${v.severity})`).join(", ")}`,
          qc.passed,
        );

        // 如果有需要 AI 重写的问题（如语言混杂、内容过短），发送 1 次修订请求
        if (!qc.passed && qc.rewriteGuidance.length > 0) {
          this.logger.log(
            `${logPrefix} [QualityGate] Section "${section.title}" needs AI rewrite: ${qc.rewriteGuidance.join("; ")}`,
          );

          // ★ 发送修订进度事件（通知前端）
          await this.eventEmitter.emitAgentWorking(
            topicId,
            {
              agentId: researcherAgentId,
              agentName: "研究员",
              agentRole: "researcher",
              status: "working",
              taskDescription: `章节「${section.title}」质量门控未通过，正在修订：${qc.violations.map((v) => v.rule).join(", ")}`,
              dimensionId: dimension.id,
              dimensionName: dimension.name,
              progress: progressPercent + 5,
              modelId,
            },
            missionId,
          );

          try {
            const rewrittenResult = await this.sectionWriter.reviseSection({
              section,
              originalContent: result.content,
              reviewFeedback: qc.rewriteGuidance.join("\n"),
              revisionInstructions:
                "请根据以上质量问题修改内容。这是最后一次修改机会，请认真处理所有问题。",
              evidenceData,
              modelId,
              topicLanguage: topic?.language,
              assignedSkills,
            });

            // 对修改后的内容再次运行质量门控（仅自动修复，不再重写）
            const qc2 = this.qualityGate.validateDimensionContent(
              rewrittenResult.content,
              topic?.language || "zh",
              topic?.type,
            );
            result = {
              ...rewrittenResult,
              content: qc2.wasAutoFixed
                ? qc2.fixedContent
                : rewrittenResult.content,
            };

            this.logger.log(
              `${logPrefix} [QualityGate] Section "${section.title}" rewritten, passed=${qc2.passed}`,
            );
          } catch (rewriteError) {
            this.logger.warn(
              `${logPrefix} [QualityGate] Rewrite failed for "${section.title}", keeping auto-fixed content: ${rewriteError instanceof Error ? rewriteError.message : String(rewriteError)}`,
            );
          }
        }

        // ★ Direction B: 自评 + 补救（仅当 QG 有 violation 时触发，节省成本）
        if (!qc.passed) {
          try {
            const evalResult = await this.selfEval.evaluateSection({
              content: result.content,
              sectionTitle: section.title,
              topicName: dimension.name,
              language: topic?.language ?? "zh",
            });

            const writerPromptMeta = getPromptMetadata("SECTION_WRITING");
            const trace: RemediationTrace = {
              sectionTitle: section.title,
              originalModel: modelId ?? "unknown",
              selfEvalScores: { ...evalResult.scores },
              actions: [],
              wasRemediated: false,
              promptVersion: writerPromptMeta.version,
              promptHash: writerPromptMeta.hash,
            };

            if (!evalResult.overallOk) {
              const actions = this.selfEval.determineRemediationActions(
                evalResult,
                7,
                topic?.language ?? "zh",
              );

              if (actions.length > 0) {
                const remediationModelId =
                  await this.remediation.getRemediationModelId(modelId ?? "");
                trace.remediationModel = remediationModelId || undefined;
                trace.actions = actions.map((a) => ({
                  type: a.type,
                  dimension: a.dimension,
                  scoreBefore: a.score,
                  guidance: a.guidance,
                }));

                const remResult = await this.remediation.remediate({
                  content: result.content,
                  sectionTitle: section.title,
                  actions,
                  originalModelId: modelId,
                  resolvedRemediationModelId: remediationModelId,
                  language: topic?.language ?? "zh",
                });

                if (!remResult.skipped) {
                  // 补救后再跑一次 QG auto-fix
                  const qcFinal = this.qualityGate.validateDimensionContent(
                    remResult.content,
                    topic?.language || "zh",
                    topic?.type,
                  );
                  const finalContent = qcFinal.wasAutoFixed
                    ? qcFinal.fixedContent
                    : remResult.content;
                  result = { ...result, content: finalContent };
                  trace.wasRemediated = true;

                  // ★ 补救后强制重评，闭合评估环路。
                  // 非阻断：重评失败不影响补救结果，只是缺少 after 分数。
                  try {
                    const reEvalResult = await this.selfEval.evaluateSection({
                      content: finalContent,
                      sectionTitle: section.title,
                      topicName: dimension.name,
                      language: topic?.language ?? "zh",
                    });
                    trace.selfEvalScoresAfter = { ...reEvalResult.scores };
                    const beforeVals = Object.values(trace.selfEvalScores);
                    const afterVals = Object.values(reEvalResult.scores);
                    const avgBefore = beforeVals.length
                      ? beforeVals.reduce((a, b) => a + b, 0) /
                        beforeVals.length
                      : 0;
                    const avgAfter = afterVals.length
                      ? afterVals.reduce((a, b) => a + b, 0) / afterVals.length
                      : 0;
                    trace.scoreDelta = Number(
                      (avgAfter - avgBefore).toFixed(2),
                    );
                    trace.weakAreasResolved =
                      reEvalResult.weakAreas.length === 0;
                    // 回填 per-action scoreAfter
                    trace.actions = trace.actions.map((a) => ({
                      ...a,
                      scoreAfter:
                        reEvalResult.scores[
                          a.dimension as keyof typeof reEvalResult.scores
                        ] ?? undefined,
                    }));

                    this.logger.log(
                      `${logPrefix} [Remediation] Section "${section.title}" remediated + re-evaluated: ` +
                        `delta=${trace.scoreDelta >= 0 ? "+" : ""}${trace.scoreDelta}, ` +
                        `resolved=${trace.weakAreasResolved}`,
                    );
                  } catch (reEvalError) {
                    this.logger.warn(
                      `${logPrefix} [Remediation] Post-remediation re-eval failed for "${section.title}" (non-fatal): ` +
                        `${reEvalError instanceof Error ? reEvalError.message : String(reEvalError)}`,
                    );
                    this.logger.log(
                      `${logPrefix} [Remediation] Section "${section.title}" remediated (no re-eval data): ${actions.map((a) => a.type).join(", ")}`,
                    );
                  }
                } else {
                  trace.skippedReason = remResult.skipReason;
                }
              }
            } else {
              trace.skippedReason = "all_scores_above_threshold";
            }

            result = { ...result, remediationTrace: trace };
          } catch (evalError) {
            this.logger.warn(
              `${logPrefix} [Remediation] Self-eval/remediation failed for "${section.title}", keeping content: ${evalError instanceof Error ? evalError.message : String(evalError)}`,
            );
          }
        }

        // 保存结果
        sectionMap.set(section.id, result);
        sectionResults.push(result);

        // 发送进度
        if (emitProgressFn) {
          await emitProgressFn(
            topicId,
            dimension.name,
            {
              stage: "writing",
              sectionsTotal: outline.sections.length,
              sectionsCompleted: sectionResults.length,
              currentSection: section.title,
              message: `已完成章节: ${section.title}`,
            },
            missionId,
            undefined,
            taskId,
          );
        }
      }
    }

    return sectionResults;
  }

  /**
   * 根据 section 标题/关键词过滤相关 evidence
   * 使用简单关键词匹配，不需要 LLM 调用
   */
  private filterEvidenceForSection(
    section: SectionPlan,
    evidenceData: EvidenceData[],
  ): EvidenceData[] {
    if (evidenceData.length <= 5) {
      return evidenceData;
    }

    // 提取 section 关键词：标题分词 + keyPoints
    const sectionKeywords = this.extractKeywords(
      `${section.title} ${section.keyPoints.join(" ")} ${section.description || ""}`,
    );

    if (sectionKeywords.length === 0) {
      return evidenceData;
    }

    // 对每条 evidence 计算相关度分数
    const scored = evidenceData.map((e, index) => {
      const evidenceText = `${e.title || ""} ${e.snippet || ""}`.toLowerCase();
      let score = 0;
      for (const kw of sectionKeywords) {
        if (evidenceText.includes(kw)) {
          score++;
        }
      }
      return { evidence: e, score, originalIndex: index };
    });

    // 按相关度排序
    scored.sort((a, b) => b.score - a.score);

    // 保留相关度 > 0 的 evidence，但至少保留 5 条
    const relevant = scored.filter((s) => s.score > 0);
    if (relevant.length >= 5) {
      return relevant.map((s) => s.evidence);
    }

    // 不足 5 条时，补充前 N 条（按原始顺序）
    return scored.slice(0, Math.max(5, relevant.length)).map((s) => s.evidence);
  }

  /**
   * 从文本中提取关键词（简单分词）
   */
  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      "the",
      "a",
      "an",
      "is",
      "are",
      "was",
      "were",
      "of",
      "in",
      "to",
      "for",
      "and",
      "or",
      "on",
      "at",
      "by",
      "with",
      "from",
      "as",
      "it",
      "that",
      "this",
      "have",
      "been",
      "will",
      "would",
      "could",
      "should",
      "about",
      "into",
      "more",
      "some",
      "than",
      "them",
      "then",
      "these",
      "those",
      "what",
      "when",
      "where",
      "which",
      "while",
      "also",
      "each",
      "only",
      "such",
      "very",
      "just",
      "over",
      "after",
      "before",
      "between",
      "under",
      "through",
      "during",
      "most",
      "other",
      "being",
      "both",
      "does",
      "done",
      "made",
      "make",
      "many",
      "much",
      "must",
      "need",
      "next",
      "like",
      "well",
      "back",
      "even",
      "still",
      "way",
      "的",
      "了",
      "在",
      "是",
      "我",
      "有",
      "和",
      "就",
      "不",
      "人",
      "都",
      "一",
      "一个",
      "上",
      "也",
      "很",
      "到",
      "说",
      "要",
      "去",
      "你",
      "会",
      "着",
      "没有",
      "看",
      "好",
      "自己",
      "这",
      "他",
      "她",
      "它",
      "们",
      "那",
      "对",
      "与",
      "及",
      "其",
      "或",
      "但",
      "而",
      "如",
      "中",
      "以",
      "为",
      "等",
      "所",
      "被",
      "把",
      "从",
      "并",
    ]);

    return text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w))
      .filter((w, i, arr) => arr.indexOf(w) === i);
  }

  /**
   * 获取前置章节（用于保持连贯性）
   */
  private getPreviousSections(
    section: SectionPlan,
    sectionMap: Map<string, SectionWriteResult>,
    _outline: DimensionOutline,
  ): Array<{ title: string; content: string }> {
    if (!section.dependsOn || section.dependsOn.length === 0) {
      return [];
    }

    const previousSections: Array<{ title: string; content: string }> = [];
    for (const depId of section.dependsOn) {
      const depResult = sectionMap.get(depId);
      if (depResult) {
        previousSections.push({
          title: depResult.title,
          content: depResult.content,
        });
      }
    }

    return previousSections;
  }

  /**
   * 校验并清理 Leader 分配的 allocatedFigures
   * - 通过 figureRegistry 回填 imageUrl（唯一可信源）
   * - 过滤 registry 中不存在的 figureId
   * - 过滤 imageUrl 无效的条目
   * - 全局去重：确保同一图表不被分配给多个 section
   */
  private validateAllocatedFigures(
    outline: DimensionOutline,
    figureRegistry:
      | Map<string, import("./evidence-summary.utils").FigureRegistryEntry>
      | undefined,
  ): void {
    const globalSeen = new Set<string>();
    let totalAllocated = 0;

    for (const section of outline.sections) {
      if (!section.allocatedFigures || section.allocatedFigures.length === 0) {
        continue;
      }

      const valid: typeof section.allocatedFigures = [];
      for (const fig of section.allocatedFigures) {
        // 从 registry 回填 imageUrl（唯一可信源）
        const entry = figureRegistry?.get(fig.figureId);
        if (entry) {
          fig.imageUrl = entry.imageUrl;
          fig.caption = fig.caption || entry.caption;
        } else {
          this.logger.warn(
            `[validateAllocatedFigures] Section "${section.title}": figureId "${fig.figureId}" not found in registry, skipping`,
          );
          continue;
        }
        // 校验 imageUrl 有效性
        if (!isValidFigureUrl(fig.imageUrl)) {
          this.logger.warn(
            `[validateAllocatedFigures] Section "${section.title}": invalid imageUrl for ${fig.figureId}, skipping`,
          );
          continue;
        }
        // 全局去重 by figureId
        if (globalSeen.has(fig.figureId)) {
          this.logger.warn(
            `[validateAllocatedFigures] Section "${section.title}": duplicate figure ${fig.figureId}, skipping`,
          );
          continue;
        }
        globalSeen.add(fig.figureId);
        valid.push(fig);
      }

      // ★ 关键词相关性过滤：图表 caption 必须与 section 标题/描述有交集
      const relevant = valid.filter((fig) => {
        const captionLower = (fig.caption || "").toLowerCase();
        const sectionTitle = (section.title || "").toLowerCase();
        const sectionDesc = (section.description || "").toLowerCase();
        const sectionKeyPoints = (section.keyPoints || [])
          .map((kp: string) => kp.toLowerCase())
          .join(" ");
        const sectionText = `${sectionTitle} ${sectionDesc} ${sectionKeyPoints}`;

        // Extract Chinese bigrams and Latin words from caption for matching
        const chineseChars = captionLower.replace(/[^\u4e00-\u9fff]/g, "");
        const latinWords = captionLower
          .replace(/[\u4e00-\u9fff]+/g, " ")
          .split(/[\s\W]+/)
          .filter((w) => w.length >= 3);

        // Build bigrams from Chinese characters (sliding window of 2)
        const bigrams: string[] = [];
        for (let bi = 0; bi < chineseChars.length - 1; bi++) {
          bigrams.push(chineseChars.substring(bi, bi + 2));
        }
        const allKeywords = [...bigrams, ...latinWords];

        // ★ v6.0: caption 无关键词时放行（图片已通过上游 Vision LLM 审查）
        if (allKeywords.length === 0) {
          this.logger.debug(
            `[validateAllocatedFigures] Figure with empty/generic caption "${fig.caption}" from section "${section.title}" — accepting (already passed upstream filters)`,
          );
          return true;
        }

        // At least one keyword must appear in section context
        const hasOverlap = allKeywords.some((kw) => sectionText.includes(kw));
        if (!hasOverlap) {
          this.logger.warn(
            `[validateAllocatedFigures] Removing irrelevant figure "${fig.caption}" from section "${section.title}" — no keyword overlap`,
          );
        }
        return hasOverlap;
      });
      section.allocatedFigures = relevant;
      totalAllocated += relevant.length;
    }

    this.logger.log(
      `[validateAllocatedFigures] Total allocated: ${totalAllocated} figures across ${outline.sections.length} sections`,
    );
  }

  /**
   * 保存证据到数据库
   * ★ 返回 promptIndex -> actualCitationIndex 映射
   * ★ 使用事务保证原子性：aggregate + createMany + findMany 在同一事务内
   *   防止并发写入时 citationIndex 冲突
   */
  private async saveEvidence(
    evidenceData: EvidenceData[],
    reportId: string,
  ): Promise<{
    savedIds: string[];
    idMapping: Map<string, string>;
    indexMapping: Map<number, number>;
  }> {
    if (evidenceData.length === 0) {
      return { savedIds: [], idMapping: new Map(), indexMapping: new Map() };
    }

    // 评估可信度
    const evidenceWithCredibility = evidenceData.map((e) => ({
      ...e,
      credibilityScore: this.assessCredibility(e),
    }));

    // ★ 使用 interactive transaction 保证原子性
    // 所有操作在同一事务内，防止并发竞态
    const created = await this.prisma.$transaction(
      async (tx) => {
        // 步骤1：获取当前最大 citationIndex
        const maxIndexResult = await tx.topicEvidence.aggregate({
          where: { reportId },
          _max: { citationIndex: true },
        });
        const startIndex = (maxIndexResult._max.citationIndex || 0) + 1;

        // 步骤2：批量插入（createMany 比循环插入快得多）
        await tx.topicEvidence.createMany({
          data: evidenceWithCredibility.map((evidence, i) => ({
            title: evidence.title,
            url: evidence.url,
            domain: evidence.domain,
            snippet: evidence.snippet,
            sourceType: evidence.sourceType,
            publishedAt: this.validateDate(evidence.publishedAt),
            credibilityScore: evidence.credibilityScore,
            citationIndex: startIndex + i,
            reportId,
          })),
        });

        // 步骤3：查询刚插入的记录以获取 ID
        // 因为在同一事务内，citationIndex 范围是确定的
        return await tx.topicEvidence.findMany({
          where: {
            reportId,
            citationIndex: {
              gte: startIndex,
              lt: startIndex + evidenceWithCredibility.length,
            },
          },
          orderBy: { citationIndex: "asc" },
          select: { id: true, citationIndex: true },
        });
      },
      { timeout: 120000 },
    );

    // 构建映射
    const idMapping = new Map<string, string>();
    const indexMapping = new Map<number, number>();
    evidenceData.forEach((e, index) => {
      if (created[index]) {
        idMapping.set(e.id, created[index].id);
        indexMapping.set(index + 1, created[index].citationIndex!);
      }
    });

    return { savedIds: created.map((e) => e.id), idMapping, indexMapping };
  }

  /**
   * 替换内容中的 prompt 引用为实际的 citationIndex
   */
  private replaceEvidenceIds(
    content: string,
    indexMapping: Map<number, number>,
  ): string {
    let result = content;
    const sortedEntries = Array.from(indexMapping.entries()).sort(
      (a, b) => b[0] - a[0],
    );
    for (const [promptIndex, actualCitationIndex] of sortedEntries) {
      if (promptIndex !== actualCitationIndex) {
        // Replace citation references [N]
        const pattern = new RegExp(`\\[${promptIndex}\\]`, "g");
        result = result.replace(pattern, `[${actualCitationIndex}]`);
        // Replace figure placeholders <!-- figure:N:M -->
        const figPattern = new RegExp(
          `(<!--\\s*figure:)${promptIndex}(:)`,
          "g",
        );
        result = result.replace(figPattern, `$1${actualCitationIndex}$2`);
      }
    }
    return result;
  }

  /**
   * 验证日期有效性
   */
  private validateDate(date: Date | string | null | undefined): Date | null {
    if (!date) {
      return null;
    }
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) {
      return null;
    }
    return d;
  }

  /**
   * 评估证据可信度
   */
  private assessCredibility(evidence: EvidenceData): number {
    let score = 0;

    // 1. 域名权威性评分 (最高 40 分)
    if (evidence.domain) {
      const domain = evidence.domain.toLowerCase();

      const topAuthority = [
        ".gov",
        ".edu",
        ".ac.",
        "nature.com",
        "science.org",
        "sciencedirect.com",
        "springer.com",
        "wiley.com",
        "arxiv.org",
        "pubmed.ncbi",
        "ieee.org",
        "acm.org",
        "who.int",
        "un.org",
        "worldbank.org",
        "imf.org",
        "oecd.org",
      ];

      const highAuthority = [
        "reuters.com",
        "bloomberg.com",
        "wsj.com",
        "nytimes.com",
        "washingtonpost.com",
        "bbc.com",
        "economist.com",
        "ft.com",
        "theguardian.com",
        "apnews.com",
        "stanford.edu",
        "mit.edu",
        "harvard.edu",
        "brookings.edu",
        "rand.org",
        "mckinsey.com",
        "gartner.com",
        "forrester.com",
        "statista.com",
      ];

      const mediumAuthority = [
        "techcrunch.com",
        "wired.com",
        "arstechnica.com",
        "theverge.com",
        "venturebeat.com",
        "forbes.com",
        "businessinsider.com",
        "cnbc.com",
        "cnn.com",
        "medium.com",
        "substack.com",
        "hbr.org",
      ];

      if (topAuthority.some((auth) => domain.includes(auth))) {
        score += 40;
      } else if (highAuthority.some((auth) => domain.includes(auth))) {
        score += 30;
      } else if (mediumAuthority.some((auth) => domain.includes(auth))) {
        score += 20;
      } else {
        score += 20;
      }
    } else {
      score += 15;
    }

    // 2. 来源类型评分 (最高 30 分)
    const sourceTypeLower = (evidence.sourceType || "").toLowerCase();
    switch (sourceTypeLower) {
      case "academic":
        score += 30;
        break;
      case "official":
        score += 25;
        break;
      case "news":
        score += 20;
        break;
      case "report":
        score += 18;
        break;
      case "web":
        score += 18;
        break;
      default:
        score += 15;
        break;
    }

    // 3. 内容深度评分 (最高 15 分)
    const snippetLength = evidence.snippet?.length || 0;
    if (snippetLength > 500) {
      score += 15;
    } else if (snippetLength > 200) {
      score += 10;
    } else if (snippetLength > 50) {
      score += 5;
    }

    // 4. 时效性评分 (最高 15 分)
    if (evidence.publishedAt) {
      const ageInDays = Math.floor(
        (Date.now() - new Date(evidence.publishedAt).getTime()) /
          (1000 * 60 * 60 * 24),
      );
      if (ageInDays <= 30) {
        score += 15;
      } else if (ageInDays <= 180) {
        score += 12;
      } else if (ageInDays <= 365) {
        score += 8;
      } else if (ageInDays <= 730) {
        score += 5;
      }
    }

    return Math.max(15, Math.min(100, score));
  }

  /**
   * 转换为标准分析结果格式
   */
  private convertToAnalysisResult(
    dimensionId: string,
    integratedResult: IntegratedDimensionResult,
    evidenceIds: string[],
    figureReferences: FigureReference[] = [],
    generatedCharts: GeneratedChart[] = [],
    modelUsed?: string,
    remediationTraces?: RemediationTrace[],
  ): DimensionAnalysisResult {
    const content = integratedResult.content || "";

    return {
      dimensionId,
      summary: integratedResult.metadata.summary,
      keyFindings: integratedResult.metadata.keyFindings.map(
        (finding, index) => ({
          finding,
          significance: (index < 2 ? "high" : index < 4 ? "medium" : "low") as
            | "high"
            | "medium"
            | "low",
          implication: "",
          evidenceIds: [],
        }),
      ),
      trends: this.extractTrendsFromContent(content),
      challenges: this.extractChallengesFromContent(content),
      opportunities: this.extractOpportunitiesFromContent(content),
      evidenceUsed: evidenceIds.length,
      confidenceLevel: integratedResult.metadata.confidenceLevel,
      detailedContent: content,
      figureReferences,
      generatedCharts,
      modelUsed,
      remediationTraces,
    };
  }

  /**
   * 从 Markdown 内容中提取趋势项
   */
  private extractTrendsFromContent(content: string): Trend[] {
    return this.extractSectionItems(content, [
      "趋势",
      "trend",
      "发展趋势",
      "未来趋势",
    ]).map((item) => ({
      trend: item,
      direction: "emerging" as const,
      timeframe: "近期",
      evidenceIds: [],
    }));
  }

  /**
   * 从 Markdown 内容中提取挑战项
   */
  private extractChallengesFromContent(content: string): Challenge[] {
    return this.extractSectionItems(content, [
      "挑战",
      "challenge",
      "风险",
      "问题",
      "障碍",
    ]).map((item) => ({
      challenge: item,
      impact: "",
      evidenceIds: [],
    }));
  }

  /**
   * 从 Markdown 内容中提取机遇项
   */
  private extractOpportunitiesFromContent(content: string): Opportunity[] {
    return this.extractSectionItems(content, [
      "机遇",
      "机会",
      "opportunity",
      "发展机遇",
    ]).map((item) => ({
      opportunity: item,
      potential: "",
      evidenceIds: [],
    }));
  }

  /**
   * 多策略从 Markdown 提取指定主题的列表项
   */
  private extractSectionItems(
    content: string,
    sectionKeywords: string[],
  ): string[] {
    const fromHeaders = this.extractFromHeaders(content, sectionKeywords);
    if (fromHeaders.length > 0) return fromHeaders;

    const fromBold = this.extractFromBoldPatterns(content, sectionKeywords);
    if (fromBold.length > 0) return fromBold;

    return this.extractFromSentences(content, sectionKeywords);
  }

  private extractFromHeaders(
    content: string,
    sectionKeywords: string[],
  ): string[] {
    const items: string[] = [];
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const isHeader = /^#{2,4}\s+/.test(line);
      if (!isHeader) continue;

      const headerText = line.replace(/^#{2,4}\s+/, "").toLowerCase();
      const matched = sectionKeywords.some((kw) =>
        headerText.includes(kw.toLowerCase()),
      );
      if (!matched) continue;

      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j].trim();
        if (/^#{2,4}\s+/.test(nextLine)) break;
        const bulletMatch = nextLine.match(/^[-*]\s+\*\*(.+?)\*\*/);
        if (bulletMatch) {
          items.push(bulletMatch[1].replace(/:$/, "").trim());
        } else {
          const simpleBullet = nextLine.match(/^[-*]\s+(.{15,})/);
          if (simpleBullet) {
            const text = simpleBullet[1].replace(/\*\*/g, "").trim();
            const sentence = text.split(/[。；;]/)[0];
            if (sentence.length >= 10) {
              items.push(
                sentence.length > 120
                  ? sentence.substring(0, 120) + "..."
                  : sentence,
              );
            }
          }
        }
        if (items.length >= 5) break;
      }
      break;
    }

    return items;
  }

  private extractFromBoldPatterns(
    content: string,
    sectionKeywords: string[],
  ): string[] {
    const items: string[] = [];
    const regex = /\*\*(.+?)\*\*[:：]\s*(.+)/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const label = match[1].trim().toLowerCase();
      const value = match[2].trim();
      if (
        sectionKeywords.some((kw) => label.includes(kw.toLowerCase())) &&
        value.length >= 10
      ) {
        items.push(
          value.length > 120 ? value.substring(0, 120) + "..." : value,
        );
        if (items.length >= 5) break;
      }
    }
    return items;
  }

  private extractFromSentences(
    content: string,
    sectionKeywords: string[],
  ): string[] {
    const sentences = content.match(/[^。！？\n]+[。！？]/g) || [];
    return sentences
      .filter(
        (s) =>
          s.length >= 15 &&
          sectionKeywords.some((kw) =>
            s.toLowerCase().includes(kw.toLowerCase()),
          ),
      )
      .slice(0, 5)
      .map((s) => {
        const trimmed = s.replace(/^[，、：:;\s]+/, "").trim();
        return trimmed.length > 120
          ? trimmed.substring(0, 120) + "..."
          : trimmed;
      });
  }
}
