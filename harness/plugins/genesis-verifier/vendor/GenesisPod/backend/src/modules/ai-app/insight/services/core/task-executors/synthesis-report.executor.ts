import { Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ResearchTaskStatus } from "@prisma/client";
import { resolveResearchDepthConfig } from "../../../types/research-depth.types";
import { ResearchEventEmitterService } from "../research/research-event-emitter.service";
import { ReportSynthesisService } from "../../report/report-synthesis.service";
import { ResearchReviewerService } from "../../collaboration/research-reviewer.service";
import { AutoDreamSchedulerService } from "@/modules/ai-harness/facade";
import type { DimensionAnalysisResult } from "../../../types/research.types";
import type {
  ITaskExecutor,
  TaskExecutionContext,
  TaskExecutionResult,
} from "./task-executor.interface";

/** Shape of ResearchTask.result (Prisma Json field) for dimension_research tasks */
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
  trends?: DimensionAnalysisResult["trends"];
  challenges?: DimensionAnalysisResult["challenges"];
  opportunities?: DimensionAnalysisResult["opportunities"];
  evidenceUsed?: number;
  confidenceLevel?: string;
  detailedContent?: string;
  figureReferences?: DimensionAnalysisResult["figureReferences"];
  generatedCharts?: DimensionAnalysisResult["generatedCharts"];
  modelUsed?: string;
}

@Injectable()
export class SynthesisReportExecutor implements ITaskExecutor {
  private readonly logger = new Logger(SynthesisReportExecutor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reportSynthesisService: ReportSynthesisService,
    private readonly researchEventEmitter: ResearchEventEmitterService,
    private readonly reviewerService: ResearchReviewerService,
    @Optional()
    private readonly autoDreamScheduler?: AutoDreamSchedulerService,
  ) {}

  async execute(context: TaskExecutionContext): Promise<TaskExecutionResult> {
    const { topic, missionId, reportId } = context;

    // ★ 发送报告撰写开始事件（同时触发阶段转换）
    await this.researchEventEmitter.emitReportSynthesisStarted(
      topic.id,
      missionId,
    );

    // ★ 复用 startExecution 中创建的草稿报告，避免重复创建
    // reportId 已在 startExecution 中创建并传递到此处
    this.logger.log(
      `[SynthesisReportExecutor] Using existing draft report: ${reportId}`,
    );

    // ★ 收集所有维度研究结果并保存到 DimensionAnalysis 表
    const dimensionTasks = await this.prisma.researchTask.findMany({
      where: {
        missionId,
        taskType: "dimension_research",
        status: ResearchTaskStatus.COMPLETED,
      },
      orderBy: { createdAt: "asc" },
    });

    // ★ 查询维度的 sortOrder 用于正确的章节编号
    const dimensionSortOrders = new Map<string, number>();
    if (dimensionTasks.length > 0) {
      const dimIds = dimensionTasks
        .map((t) => t.dimensionId)
        .filter(Boolean) as string[];
      const dims = await this.prisma.topicDimension.findMany({
        where: { id: { in: dimIds } },
        select: { id: true, sortOrder: true },
      });
      dims.forEach((d) => dimensionSortOrders.set(d.id, d.sortOrder));
    }

    for (let di = 0; di < dimensionTasks.length; di++) {
      const dimTask = dimensionTasks[di];
      if (dimTask.result && dimTask.dimensionId) {
        const taskResult = dimTask.result as TaskResultJson;
        const chapterIndex =
          (dimensionSortOrders.get(dimTask.dimensionId) ?? di + 1) - 1;
        try {
          await this.reportSynthesisService.saveDimensionAnalysis(
            reportId, // ★ 使用已有的 reportId
            dimTask.dimensionId,
            {
              dimIndex: chapterIndex,
              summary: taskResult.summary || "无摘要",
              keyFindings: (taskResult.keyFindings ||
                []) as DimensionAnalysisResult["keyFindings"],
              trends: taskResult.trends || [],
              challenges: taskResult.challenges || [],
              opportunities: taskResult.opportunities || [],
              evidenceUsed: taskResult.evidenceUsed || 0,
              confidenceLevel: taskResult.confidenceLevel || "medium",
              detailedContent: taskResult.detailedContent || "",
              figureReferences: (taskResult.figureReferences ||
                []) as DimensionAnalysisResult["figureReferences"],
              generatedCharts: (taskResult.generatedCharts ||
                []) as DimensionAnalysisResult["generatedCharts"],
              modelUsed: taskResult.modelUsed || dimTask.modelId || undefined,
            },
          );
          this.logger.log(
            `[SynthesisReportExecutor] Saved dimension analysis for ${dimTask.dimensionName}`,
          );
        } catch (err) {
          this.logger.warn(
            `[SynthesisReportExecutor] Failed to save dimension analysis for ${dimTask.dimensionName}: ${err}`,
          );
        }
      }
    }

    // 合成最终报告
    const synthesisResult = (await this.reportSynthesisService.synthesizeReport(
      topic,
      reportId, // ★ 使用已有的 reportId
    )) as unknown as TaskExecutionResult;

    // V5: 深度门控后处理（fact-check for thorough mode）
    const depthConfig =
      context.depthConfig ?? resolveResearchDepthConfig("standard");

    if (depthConfig.factCheckEnabled) {
      this.logger.log(`[V5] Running fact-check (factCheckEnabled=true)`);
      try {
        const reportContent =
          ((synthesisResult as Record<string, unknown>)?.content as string) ||
          "";
        const evidenceForFactCheck = await this.prisma.topicEvidence.findMany({
          where: { reportId },
          select: { id: true, title: true, snippet: true },
          take: 50,
        });
        const factCheckResult = await this.reviewerService.factCheckReport(
          reportContent,
          evidenceForFactCheck,
        );
        this.logger.log(
          `[V5] Fact check: accuracy=${factCheckResult.accuracyScore}/100, issues=${factCheckResult.issues.length}`,
        );
      } catch (error) {
        this.logger.warn(`[V5] Fact check failed (non-fatal): ${error}`);
      }
    }

    // ★ 发送报告撰写完成事件（同时触发阶段完成）
    await this.researchEventEmitter.emitReportSynthesisCompleted(
      topic.id,
      synthesisResult?.chapters?.length || 0,
      JSON.stringify(synthesisResult).length,
      missionId,
    );

    // ★ Phase 9: Notify AutoDream that a research session completed
    this.autoDreamScheduler?.notifySessionCompleted(topic.id);

    // ★ 将 TopicReport 转换为前端 TodoResult 兼容格式
    const reportResult = synthesisResult as Record<string, unknown>;
    const fullReportText = (reportResult?.fullReport as string) || "";
    return {
      summary: (reportResult?.executiveSummary as string) || "报告已生成",
      wordCount: fullReportText.length,
      sourcesFound: (reportResult?.totalSources as number) || 0,
      keyFindings: Array.isArray(reportResult?.highlights)
        ? (reportResult.highlights as Array<{ title?: string }>).map(
            (h, i) => ({
              finding: h.title || `亮点 ${i + 1}`,
              significance: (i < 2 ? "high" : "medium") as
                | "high"
                | "medium"
                | "low",
              evidenceIds: [],
            }),
          )
        : [],
      reportId,
    };
  }
}
