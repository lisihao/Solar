import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { sanitizeMarkdownContent } from "../../../common/utils/sanitize-content.utils";
import { sanitize } from "./utils/prompt-sanitizer";
import { preprocessDimensionContent } from "../contracts/report-template";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { RESEARCH_INTERNAL_EVENTS } from "./services/core/research/research-event-emitter.service";
import { Observable, Subject, filter, map } from "rxjs";
import { MessageEvent } from "@nestjs/common";
import {
  CreateTopicDto,
  UpdateTopicDto,
  ListTopicsDto,
  TriggerRefreshDto,
  CancelRefreshDto,
  RefreshDimensionDto,
  AddDimensionDto,
  UpdateDimensionDto,
  ReorderDimensionsDto,
  ListReportsDto,
  ExportReportDto,
  CompareReportsDto,
  ListEvidenceDto,
  GetTemplatesDto,
  CreateFromTemplateDto,
  UpdateScheduleDto,
  ListLogsDto,
} from "./dto";
import { AIModelType, AnnotationStatus, AnnotationType } from "@prisma/client";
import type { RefreshProgressEvent } from "./services/core/topic/topic-team-orchestrator.service";
import {
  TopicTeamOrchestratorService,
  ReportSynthesisService,
  EvidenceManagementService,
  ReportChangeService,
  ReportAnnotationService,
  ResearchStrategyService,
  AgentActivityService,
  CredibilityReportService,
  TopicCrudService,
  TopicDimensionService,
  TopicExportService,
  TopicScheduleService,
  ReportQualityTraceService,
  ReportDataService,
  LatexRepairService,
} from "./services";
import { ChatFacade } from "@/modules/ai-harness/facade";
import {
  SessionLatencyTrackerService,
  type LatencySessionSummary,
} from "@/modules/ai-harness/facade";
import {
  REPORT_EDITING_SYSTEM_PROMPT,
  buildEditPrompt,
  buildEnhancedEditPrompt,
} from "./prompts";
import { BillingContext } from "../../platform/facade";
import type { ResearchDepth } from "./types";

// 维度模板已外置到 config/dimension-templates.config.ts
/**
 * 清理AI生成内容中的HTML标签
 * 主要处理 <br> 标签转换为换行，其他标签移除
 * @param content 原始内容
 * @returns 清理后的内容
 */
function cleanHtmlTagsFromContent(
  content: string | null | undefined,
): string | null {
  if (!content) return content as null;

  let cleaned = content;

  // 1. 将 <br>, <br/>, <br /> 转换为换行符
  cleaned = cleaned.replace(/<br\s*\/?>/gi, "\n");

  // 2. 将 </p><p> 转换为双换行（段落分隔）
  cleaned = cleaned.replace(/<\/p>\s*<p>/gi, "\n\n");

  // 3. 将 <p> 和 </p> 单独出现时转换为换行
  cleaned = cleaned.replace(/<\/?p>/gi, "\n");

  // 4. 移除其他常见HTML标签但保留内容
  cleaned = cleaned.replace(
    /<\/?(?:div|span|strong|em|b|i|u|a|ul|ol|li|h[1-6])[^>]*>/gi,
    "",
  );

  // 5. 清理多余的连续换行（超过2个变成2个）
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

  // 6. 清理行首行尾的空白
  cleaned = cleaned.trim();

  return cleaned;
}

/**
 * TopicInsightsService (Facade)
 *
 * ★ Facade Pattern: 将原有 2571 行服务拆分为 4 个子服务
 * - TopicCrudService: CRUD, list, stats, history, logs
 * - TopicDimensionService: dimension add/remove/reorder/refresh/config
 * - TopicExportService: export, template, share
 * - TopicScheduleService: scheduled refresh, smart-start, strategy
 *
 * Facade 保留复杂的编排逻辑：
 * - Refresh operations (triggerRefresh, smartStartResearch, etc.)
 * - Report operations (listReports, getReport, aiEditReport, etc.)
 * - Evidence operations
 * - Annotations & Changes
 * - Agent & Credibility
 */
@Injectable()
export class TopicInsightsService {
  private readonly logger = new Logger(TopicInsightsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly orchestrator: TopicTeamOrchestratorService,
    private readonly reportService: ReportSynthesisService,
    private readonly evidenceService: EvidenceManagementService,
    private readonly chatFacade: ChatFacade,
    private readonly reportChangeService: ReportChangeService,
    private readonly reportAnnotationService: ReportAnnotationService,
    private readonly researchStrategyService: ResearchStrategyService,
    private readonly agentActivityService: AgentActivityService,
    private readonly credibilityReportService: CredibilityReportService,
    // ★ 4 个子服务（Facade pattern）
    private readonly crudService: TopicCrudService,
    private readonly dimensionService: TopicDimensionService,
    private readonly exportService: TopicExportService,
    private readonly scheduleService: TopicScheduleService,
    private readonly qualityTraceService: ReportQualityTraceService,
    private readonly reportDataService: ReportDataService,
    private readonly latexRepairService: LatexRepairService,
    @Optional()
    private readonly latencyTracker?: SessionLatencyTrackerService,
  ) {}

  /**
   * ★ LaTeX-only repair for already-stored reports (no content rewrite).
   * Runs `validateLatexDelimiters`; if issues found, asks LLM to add/fix
   * math delimiters while keeping all prose identical. Writes back to DB.
   */
  async repairReportLatex(userId: string, reportId: string) {
    const report = await this.prisma.topicReport.findUnique({
      where: { id: reportId },
      include: { topic: true },
    });
    if (!report || report.topic.userId !== userId) {
      throw new NotFoundException("Report not found");
    }

    const result = await this.latexRepairService.repairMarkdown(
      report.fullReport,
    );

    if (!result.changed) {
      return {
        success: true,
        changed: false,
        issuesBefore: result.before?.issues.length ?? 0,
        failureReason: result.failureReason,
      };
    }

    await this.prisma.topicReport.update({
      where: { id: reportId },
      data: { fullReport: result.repaired },
    });

    this.eventEmitter.emit("topic-insights.report.refreshed", {
      topicId: report.topic.id,
      reportId,
      refreshedAt: new Date(),
    });

    return {
      success: true,
      changed: true,
      issuesBefore: result.before?.issues.length ?? 0,
      issuesAfter: result.after?.issues.length ?? 0,
    };
  }

  /**
   * ★ Batch LaTeX repair — scan every report of every topic owned by the
   * caller, validate delimiters, repair ones with issues via LatexRepairService.
   *
   * Sequential (not parallel) to keep LLM cost under control and avoid
   * overrunning rate limits. Streams per-report result into an array so the
   * caller sees exactly which reports were touched.
   */
  async repairAllReportsLatex(
    userId: string,
    options: { dryRun?: boolean } = {},
  ) {
    const topics = await this.prisma.researchTopic.findMany({
      where: { userId },
      select: { id: true, name: true },
    });
    const reports = await this.prisma.topicReport.findMany({
      where: { topic: { userId } },
      select: {
        id: true,
        topicId: true,
        fullReport: true,
        version: true,
        generatedAt: true,
      },
      orderBy: { generatedAt: "desc" },
    });

    const results: Array<{
      reportId: string;
      topicId: string;
      topicName: string;
      version: number;
      changed: boolean;
      issuesBefore: number;
      issuesAfter?: number;
      failureReason?: string;
    }> = [];

    const topicNameById = new Map(topics.map((t) => [t.id, t.name]));

    let repaired = 0;
    let skipped = 0;
    let failed = 0;

    for (const r of reports) {
      if (!r.fullReport) {
        skipped++;
        continue;
      }
      try {
        const result = await this.latexRepairService.repairMarkdown(
          r.fullReport,
        );
        if (!result.changed) {
          if (result.before?.issues.length === 0) {
            skipped++;
            continue;
          }
          failed++;
          results.push({
            reportId: r.id,
            topicId: r.topicId,
            topicName: topicNameById.get(r.topicId) ?? "unknown",
            version: r.version,
            changed: false,
            issuesBefore: result.before?.issues.length ?? 0,
            failureReason: result.failureReason,
          });
          continue;
        }
        if (!options.dryRun) {
          await this.prisma.topicReport.update({
            where: { id: r.id },
            data: { fullReport: result.repaired },
          });
          this.eventEmitter.emit("topic-insights.report.refreshed", {
            topicId: r.topicId,
            reportId: r.id,
            refreshedAt: new Date(),
          });
        }
        repaired++;
        results.push({
          reportId: r.id,
          topicId: r.topicId,
          topicName: topicNameById.get(r.topicId) ?? "unknown",
          version: r.version,
          changed: true,
          issuesBefore: result.before?.issues.length ?? 0,
          issuesAfter: result.after?.issues.length ?? 0,
        });
      } catch (err) {
        failed++;
        this.logger.error(
          `[repairAllReportsLatex] Report ${r.id} failed: ${(err as Error).message}`,
        );
      }
    }

    return {
      totalReports: reports.length,
      repaired,
      skipped,
      failed,
      dryRun: !!options.dryRun,
      details: results,
    };
  }

  // ==================== Topics CRUD (delegated to TopicCrudService) ====================

  async createTopic(userId: string, dto: CreateTopicDto) {
    return this.crudService.createTopic(userId, dto);
  }

  async listTopics(userId: string, query: ListTopicsDto) {
    return this.crudService.listTopics(userId, query);
  }

  async getTopic(userId: string, topicId: string) {
    return this.crudService.getTopic(userId, topicId);
  }

  async updateTopic(userId: string, topicId: string, dto: UpdateTopicDto) {
    return this.crudService.updateTopic(userId, topicId, dto);
  }

  async deleteTopic(userId: string, topicId: string) {
    return this.crudService.deleteTopic(userId, topicId);
  }

  async getResearchHistory(userId: string, topicId: string, limit?: number) {
    return this.crudService.getResearchHistory(userId, topicId, limit);
  }

  async getLogs(userId: string, topicId: string, query: ListLogsDto) {
    return this.crudService.getLogs(userId, topicId, query);
  }

  async getStats(userId: string, topicId: string) {
    return this.crudService.getStats(userId, topicId);
  }

  async recalculateTopicStats(userId: string, topicId: string) {
    return this.crudService.recalculateTopicStats(userId, topicId);
  }

  // ==================== Dimensions (delegated to TopicDimensionService) ====================

  async listDimensions(userId: string, topicId: string) {
    return this.dimensionService.listDimensions(userId, topicId);
  }

  async addDimension(userId: string, topicId: string, dto: AddDimensionDto) {
    return this.dimensionService.addDimension(userId, topicId, dto);
  }

  async updateDimension(
    userId: string,
    topicId: string,
    dimensionId: string,
    dto: UpdateDimensionDto,
  ) {
    return this.dimensionService.updateDimension(
      userId,
      topicId,
      dimensionId,
      dto,
    );
  }

  async deleteDimension(userId: string, topicId: string, dimensionId: string) {
    return this.dimensionService.deleteDimension(userId, topicId, dimensionId);
  }

  async refreshDimension(
    userId: string,
    topicId: string,
    dimensionId: string,
    dto: RefreshDimensionDto,
  ) {
    return this.dimensionService.refreshDimension(
      userId,
      topicId,
      dimensionId,
      dto,
    );
  }

  async reorderDimensions(
    userId: string,
    topicId: string,
    dto: ReorderDimensionsDto,
  ) {
    return this.dimensionService.reorderDimensions(userId, topicId, dto);
  }

  async getTemplates(query: GetTemplatesDto) {
    return this.dimensionService.getTemplates(query);
  }

  async createFromTemplate(userId: string, dto: CreateFromTemplateDto) {
    return this.dimensionService.createFromTemplate(userId, dto);
  }

  // ==================== Export & Sharing (delegated to TopicExportService) ====================

  async exportReport(
    userId: string,
    topicId: string,
    reportId: string,
    dto: ExportReportDto,
  ) {
    return this.exportService.exportReport(userId, topicId, reportId, dto);
  }

  async updateVisibility(userId: string, topicId: string, visibility: string) {
    return this.exportService.updateVisibility(userId, topicId, visibility);
  }

  async getSharingSettings(userId: string, topicId: string) {
    return this.exportService.getSharingSettings(userId, topicId);
  }

  async getSharedTopic(topicId: string) {
    return this.exportService.getSharedTopic(topicId);
  }

  async getSharedTopicLatestReport(topicId: string) {
    return this.exportService.getSharedTopicLatestReport(topicId);
  }

  // ==================== Schedule (delegated to TopicScheduleService) ====================

  async getSchedule(userId: string, topicId: string) {
    return this.scheduleService.getSchedule(userId, topicId);
  }

  async updateSchedule(
    userId: string,
    topicId: string,
    dto: UpdateScheduleDto,
  ) {
    return this.scheduleService.updateSchedule(userId, topicId, dto);
  }

  // ==================== Refresh Operations (kept in Facade) ====================

  /**
   * 触发刷新
   */
  async triggerRefresh(
    userId: string,
    topicId: string,
    dto: TriggerRefreshDto,
  ) {
    return BillingContext.run(
      {
        userId,
        moduleType: "topic-insights",
        operationType: "refresh",
        referenceId: topicId,
      },
      async () => {
        // 验证专题所有权
        const topic = await this.crudService.getTopic(userId, topicId);

        // 根据刷新类型决定是否增量刷新
        const isIncremental = dto.type === "INCREMENTAL";

        // 执行刷新
        const report = await this.orchestrator.executeRefresh(topic, {
          forceRefresh: dto.type === "FULL",
          dimensionIds: dto.dimensionIds,
          incremental: isIncremental,
          researchDepth: dto.researchDepth as ResearchDepth,
        });

        return {
          success: true,
          reportId: report.id,
          message: "刷新完成",
        };
      },
    );
  }

  /**
   * 获取研究策略建议
   */
  async getResearchStrategy(userId: string, topicId: string) {
    // 验证专题所有权
    await this.verifyTopicOwnership(userId, topicId);

    return this.researchStrategyService.analyzeAndRecommend(topicId);
  }

  /**
   * 快速检查研究状态（用于前端按钮显示）
   */
  async quickCheckResearchStatus(userId: string, topicId: string) {
    // 验证专题所有权
    await this.verifyTopicOwnership(userId, topicId);

    return this.researchStrategyService.quickCheck(topicId);
  }

  /**
   * 智能开始研究
   */
  async smartStartResearch(userId: string, topicId: string) {
    return BillingContext.run(
      {
        userId,
        moduleType: "topic-insights",
        operationType: "refresh",
        referenceId: topicId,
      },
      async () => {
        // 验证专题所有权
        const topic = await this.crudService.getTopic(userId, topicId);

        // 获取智能策略
        const smartOptions =
          await this.researchStrategyService.getSmartRefreshOptions(topicId);

        this.logger.log(
          `Smart research for topic ${topicId}: ${smartOptions.strategy} - ${smartOptions.message}`,
        );

        // 执行研究
        const report = await this.orchestrator.executeRefresh(topic, {
          forceRefresh: smartOptions.forceRefresh,
          dimensionIds: smartOptions.dimensionIds,
          incremental: smartOptions.incremental,
        });

        return {
          success: true,
          reportId: report.id,
          strategy: smartOptions.strategy,
          message: smartOptions.message,
        };
      },
    );
  }

  /**
   * 获取 Agent 活动记录（按维度分组）
   */
  async getAgentActivities(
    userId: string,
    topicId: string,
    missionId?: string,
  ) {
    // 验证专题所有权
    await this.verifyTopicOwnership(userId, topicId);

    return this.agentActivityService.getActivitiesByDimension(
      topicId,
      missionId,
    );
  }

  /**
   * 获取 Agent 活动统计
   */
  async getAgentActivityStats(
    userId: string,
    topicId: string,
    missionId?: string,
  ) {
    // 验证专题所有权
    await this.verifyTopicOwnership(userId, topicId);

    return this.agentActivityService.getActivityStats(topicId, missionId);
  }

  /**
   * 获取报告的可信度评估
   */
  async getCredibilityReport(userId: string, reportId: string) {
    // 获取报告及其专题信息
    const report = await this.prisma.topicReport.findUnique({
      where: { id: reportId },
      include: { topic: { select: { id: true, userId: true } } },
    });

    if (!report) {
      throw new NotFoundException("Report not found");
    }

    // 验证专题读取权限（支持公开专题访问）
    await this.verifyTopicReadAccess(userId, report.topic.id);

    return this.credibilityReportService.getOrGenerateCredibilityReport(
      reportId,
    );
  }

  /**
   * 重新生成可信度报告
   */
  async regenerateCredibilityReport(userId: string, reportId: string) {
    // 验证报告所有权
    const report = await this.prisma.topicReport.findUnique({
      where: { id: reportId },
      include: { topic: { select: { userId: true } } },
    });

    if (!report || report.topic.userId !== userId) {
      throw new NotFoundException("Report not found");
    }

    return this.credibilityReportService.generateCredibilityReport(reportId);
  }

  /**
   * ★ 重新合成报告内容
   */
  async regenerateReportContent(
    userId: string,
    reportId: string,
    feedback?: string,
  ) {
    // 验证报告所有权
    const report = await this.prisma.topicReport.findUnique({
      where: { id: reportId },
      include: { topic: true },
    });

    if (!report || report.topic.userId !== userId) {
      throw new NotFoundException("Report not found");
    }

    // 调用报告合成服务重新生成内容
    const updatedReport = await this.reportService.synthesizeReport(
      report.topic,
      reportId,
      feedback,
    );

    this.logger.log(
      `[regenerateReportContent] Report ${reportId} regenerated successfully`,
    );

    // 通知订阅了此专题的 PPT 来源已刷新
    const topicId = report.topic.id;
    this.eventEmitter.emit("topic-insights.report.refreshed", {
      topicId,
      reportId,
      refreshedAt: new Date(),
    });

    return {
      success: true,
      report: updatedReport,
    };
  }

  /**
   * ★ 轻量级报告重新处理（不调用 LLM）
   * 只对已存储的 fullReport 重新跑最新的后处理管道
   */
  async reprocessReportFormatting(userId: string, reportId: string) {
    const report = await this.prisma.topicReport.findUnique({
      where: { id: reportId },
      include: { topic: true },
    });

    if (!report || report.topic.userId !== userId) {
      throw new NotFoundException("Report not found");
    }

    const updated = await this.reportService.reprocessExistingReport(reportId);

    this.eventEmitter.emit("topic-insights.report.refreshed", {
      topicId: report.topic.id,
      reportId,
      refreshedAt: new Date(),
    });

    return { success: true, report: updated };
  }

  /**
   * ★ v5: 获取报告质量追踪数据
   */
  async getReportQualityTrace(
    userId: string,
    topicId: string,
    reportId: string,
  ) {
    await this.verifyTopicReadAccess(userId, topicId);
    await this.verifyReportBelongsToTopic(reportId, topicId);
    return this.qualityTraceService.getQualityTrace(reportId);
  }

  /**
   * ★ v5: 获取报告质量概览
   */
  async getReportQualitySummary(
    userId: string,
    topicId: string,
    reportId: string,
  ) {
    await this.verifyTopicReadAccess(userId, topicId);
    await this.verifyReportBelongsToTopic(reportId, topicId);
    return this.qualityTraceService.getQualitySummary(reportId);
  }

  /**
   * ★ v5.1: 获取报告质量缺陷详情（按需扫描）
   */
  async getReportQualityDetails(
    userId: string,
    topicId: string,
    reportId: string,
    rule?: string,
  ) {
    await this.verifyTopicReadAccess(userId, topicId);
    await this.verifyReportBelongsToTopic(reportId, topicId);
    return this.qualityTraceService.getQualityDetails(reportId, rule);
  }

  /**
   * ★ 重新计算证据可信度评分
   */
  async recalculateEvidenceCredibility(
    userId: string,
    topicId: string,
    reportId: string,
  ) {
    await this.verifyTopicReadAccess(userId, topicId);
    await this.verifyReportBelongsToTopic(reportId, topicId);
    return this.evidenceService.recalculateCredibilityScores(reportId);
  }

  /**
   * 获取刷新状态
   */
  async getRefreshStatus(userId: string, topicId: string) {
    // 验证专题读取权限（支持公开专题访问）
    await this.verifyTopicReadAccess(userId, topicId);

    const status = this.orchestrator.getRefreshStatus(topicId);

    // 获取最近的刷新日志
    const latestLog = await this.prisma.topicRefreshLog.findFirst({
      where: { topicId },
      orderBy: { startedAt: "desc" },
    });

    return {
      isRunning: status.isRunning,
      startedAt: status.startedAt,
      latestLog,
    };
  }

  /**
   * 监听刷新进度 (SSE)
   * ★ 修复内存泄漏：添加超时自动清理机制
   */
  streamRefreshProgress(
    _userId: string,
    topicId: string,
  ): Observable<MessageEvent> {
    // 创建一个 Subject 来发送事件
    const subject = new Subject<RefreshProgressEvent>();

    // 监听事件
    const listener = (event: RefreshProgressEvent) => {
      if (event.topicId === topicId) {
        subject.next(event);
      }
    };

    // ★ 清理函数
    const cleanup = () => {
      this.eventEmitter.off(
        RESEARCH_INTERNAL_EVENTS.TOPIC_RESEARCH_PROGRESS,
        listener,
      );
    };

    this.eventEmitter.on(
      RESEARCH_INTERNAL_EVENTS.TOPIC_RESEARCH_PROGRESS,
      listener,
    );

    // 当客户端断开连接时清理
    subject.subscribe({
      complete: cleanup,
      error: cleanup,
    });

    // ★ 修复内存泄漏：45分钟超时自动清理（防止客户端异常断开未触发 complete）
    // 注意：报告综合（synthesis）可能需要 7-15 分钟，必须大于此值
    const SSE_TIMEOUT_MS = 45 * 60 * 1000;
    const timeoutId = setTimeout(() => {
      cleanup();
      subject.complete();
    }, SSE_TIMEOUT_MS);

    // 正常完成时清除超时定时器
    subject.subscribe({
      complete: () => clearTimeout(timeoutId),
      error: () => clearTimeout(timeoutId),
    });

    // 转换为 MessageEvent
    return subject.pipe(
      filter(
        (event): event is RefreshProgressEvent => event.topicId === topicId,
      ),
      map(
        (event) =>
          ({
            data: JSON.stringify(event),
          }) as MessageEvent,
      ),
    );
  }

  /**
   * 取消刷新
   */
  async cancelRefresh(userId: string, topicId: string, _dto: CancelRefreshDto) {
    // 验证专题所有权
    await this.verifyTopicOwnership(userId, topicId);

    const cancelled = await this.orchestrator.cancelRefresh(topicId);

    return {
      success: cancelled,
      message: cancelled ? "刷新已取消" : "没有正在进行的刷新",
    };
  }

  // ==================== Reports (kept in Facade) ====================

  /**
   * 获取报告列表
   */
  async listReports(userId: string, topicId: string, query: ListReportsDto) {
    // 验证专题读取权限（支持公开专题访问）
    await this.verifyTopicReadAccess(userId, topicId);

    return this.reportService.listReports(topicId, {
      skip: 0,
      take: query.limit || 10,
    });
  }

  /**
   * 获取最新报告
   */
  async getLatestReport(userId: string, topicId: string) {
    // 验证专题读取权限（支持公开专题访问）
    await this.verifyTopicReadAccess(userId, topicId);

    const report = await this.reportService.getLatestReport(topicId);

    if (!report) {
      throw new NotFoundException("No reports found for this topic");
    }

    // 转换报告数据，提取 dataPoints 中的字段到顶层
    return this.transformReportForFrontend(report);
  }

  /**
   * 获取指定版本报告
   */
  async getReport(userId: string, topicId: string, reportId: string) {
    // 验证专题读取权限（支持公开专题访问）
    await this.verifyTopicReadAccess(userId, topicId);

    const report = await this.reportService.getReport(reportId);

    if (!report || report.topicId !== topicId) {
      throw new NotFoundException("Report not found");
    }

    // 转换报告数据，提取 dataPoints 中的字段到顶层
    return this.transformReportForFrontend(report);
  }

  /**
   * 删除报告（仅管理员/所有者）
   */
  async deleteReport(userId: string, topicId: string, reportId: string) {
    await this.verifyTopicOwnership(userId, topicId);

    const report = await this.reportService.getReport(reportId);
    if (!report || report.topicId !== topicId) {
      throw new NotFoundException("Report not found");
    }

    await this.reportDataService.deleteReportCascade(reportId);

    this.logger.log(
      `[deleteReport] Report ${reportId} deleted by user ${userId}`,
    );
    return { success: true, message: "Report deleted successfully" };
  }

  /**
   * 转换报告数据以适配前端接口
   * ★ 同时清理AI生成内容中的HTML标签和Markdown格式问题
   */
  private transformReportForFrontend(report: Record<string, unknown> | null) {
    if (!report) return report;

    // ★ 清理报告级别的内容字段（HTML标签 + 下划线等格式问题）
    if (report.executiveSummary) {
      report.executiveSummary = sanitizeMarkdownContent(
        cleanHtmlTagsFromContent(report.executiveSummary as string) || "",
      );
    }
    if (report.fullReport) {
      report.fullReport = sanitizeMarkdownContent(
        cleanHtmlTagsFromContent(report.fullReport as string) || "",
      );
    }

    // 转换维度分析数据
    if (report.dimensionAnalyses) {
      // ★ 辅助函数：清理HTML + 下划线等格式问题
      const cleanAndSanitize = (content: string | undefined | null): string => {
        if (!content) return "";
        return sanitizeMarkdownContent(cleanHtmlTagsFromContent(content) || "");
      };

      interface DataPointsShape {
        trends?: Record<string, unknown>[];
        challenges?: Record<string, unknown>[];
        opportunities?: Record<string, unknown>[];
        confidenceLevel?: string;
        detailedContent?: string;
      }

      interface KeyFindingShape {
        finding?: string;
        implication?: string;
        [key: string]: unknown;
      }

      interface AnalysisShape {
        analysis?: string;
        summary?: string;
        dataPoints?: DataPointsShape | null;
        keyFindings?: KeyFindingShape[];
        [key: string]: unknown;
      }

      report.dimensionAnalyses = (
        report.dimensionAnalyses as AnalysisShape[]
      ).map((analysis: AnalysisShape) => {
        const dataPoints = analysis.dataPoints as DataPointsShape | null;

        // ★ 清理维度分析中的文本内容（HTML标签 + 下划线等格式问题）
        const cleanedAnalysis = cleanAndSanitize(analysis.analysis);
        const cleanedSummary = cleanAndSanitize(analysis.summary);
        const cleanedDetailedContent = cleanAndSanitize(
          dataPoints?.detailedContent,
        );

        // ★ 清理 keyFindings 中的文本
        const cleanedKeyFindings =
          analysis.keyFindings?.map((kf: KeyFindingShape) => ({
            ...kf,
            finding: cleanAndSanitize(kf.finding),
            implication: cleanAndSanitize(kf.implication),
          })) || [];

        // ★ 清理趋势、挑战、机会中的文本
        const cleanedTrends = (dataPoints?.trends || []).map(
          (t: Record<string, unknown>) => ({
            ...t,
            trend: cleanAndSanitize(t.trend as string),
            drivers: cleanAndSanitize(t.drivers as string),
            prediction: cleanAndSanitize(t.prediction as string),
          }),
        );

        const cleanedChallenges = (dataPoints?.challenges || []).map(
          (c: Record<string, unknown>) => ({
            ...c,
            challenge: cleanAndSanitize(c.challenge as string),
            rootCause: cleanAndSanitize(c.rootCause as string),
            impact: cleanAndSanitize(c.impact as string),
            potentialSolutions: cleanAndSanitize(
              c.potentialSolutions as string,
            ),
          }),
        );

        const cleanedOpportunities = (dataPoints?.opportunities || []).map(
          (o: Record<string, unknown>) => ({
            ...o,
            opportunity: cleanAndSanitize(o.opportunity as string),
            potential: cleanAndSanitize(o.potential as string),
            requirements: cleanAndSanitize(o.requirements as string),
          }),
        );

        return {
          ...analysis,
          analysis: cleanedAnalysis,
          summary: cleanedSummary,
          keyFindings: cleanedKeyFindings,
          // 从 dataPoints 提取到顶层（已清理）
          trends: cleanedTrends,
          challenges: cleanedChallenges,
          opportunities: cleanedOpportunities,
          confidenceLevel: dataPoints?.confidenceLevel || null,
          // ★ Apply preprocessing pipeline for historical data that was stored
          // before the save-time preprocessing was added (Root Cause 1 fix).
          // All transforms are idempotent so double-processing is safe.
          detailedContent: cleanedDetailedContent
            ? preprocessDimensionContent(cleanedDetailedContent)
            : cleanedDetailedContent,
        };
      });
    }

    return report;
  }

  /**
   * 更新报告内容
   */
  async updateReportContent(
    userId: string,
    topicId: string,
    reportId: string,
    dto: {
      executiveSummary?: string;
      fullReport?: string;
      changeDescription?: string;
    },
  ) {
    await this.verifyTopicOwnership(userId, topicId);

    const report = await this.reportService.getReport(reportId);
    if (!report || report.topicId !== topicId) {
      throw new NotFoundException("Report not found");
    }

    return this.reportDataService.updateReportContent(reportId, dto);
  }

  /**
   * AI 编辑报告
   */
  async aiEditReport(
    userId: string,
    topicId: string,
    reportId: string,
    dto: {
      operation: "rewrite" | "polish" | "expand" | "compress" | "style";
      selectedText?: string;
      context?: string;
      fullContent?: string;
      styleGuide?: string;
      selectorPrefix?: string;
      selectorSuffix?: string;
      selection?: string;
      customInstruction?: string;
      targetStyle?: "academic" | "business" | "casual" | "technical";
    },
  ) {
    // 验证专题所有权
    await this.verifyTopicOwnership(userId, topicId);

    const report = await this.reportService.getReport(reportId);
    if (!report || report.topicId !== topicId) {
      throw new NotFoundException("Report not found");
    }

    // 确定使用新模式还是旧模式
    const useNewMode = Boolean(dto.selectedText);

    // 获取待编辑的文本（兼容两种模式）
    const textToEdit = dto.selectedText || dto.selection || report.fullReport;

    // 构建 AI 编辑 prompt
    let prompt: string;
    if (useNewMode) {
      // 新模式：使用增强提示词
      prompt = buildEnhancedEditPrompt(dto.operation, textToEdit, {
        userInstruction: dto.context ? sanitize(dto.context) : undefined,
        fullContent: dto.fullContent,
        styleGuide: dto.styleGuide,
        targetStyle: dto.targetStyle,
      });
    } else {
      // 旧模式：使用简单提示词（向后兼容）
      prompt = buildEditPrompt(dto.operation, textToEdit, {
        targetStyle: dto.targetStyle,
        customInstruction: dto.customInstruction
          ? sanitize(dto.customInstruction)
          : undefined,
      });
    }

    // 调用 AI 服务进行编辑（带自动积分扣除）
    // NOTE: report-editing skill 已注册但此处需 billing 字段，chatWithSkills 不支持
    const aiResponse = await this.chatFacade.chat({
      operationName: "报告编辑",
      messages: [
        {
          role: "system",
          content: REPORT_EDITING_SYSTEM_PROMPT,
        },
        { role: "user", content: prompt },
      ],
      modelType: AIModelType.CHAT,
      // ★ Security: 不再 skipGuardrails —— 外部内容已通过 <external_source>
      // 标签在 prompt builder 中结构化隔离，守卫层现在可以安全扫描用户指令段。
      taskProfile: {
        creativity: dto.operation === "rewrite" ? "high" : "medium",
        outputLength: dto.operation === "compress" ? "short" : "medium",
      },
      // ★ 自动积分扣除：基于实际 token 消耗
      billing: {
        userId,
        moduleType: "topic-insights",
        operationType: "ai-edit",
        referenceId: reportId,
        description: `AI 编辑报告 (${dto.operation})`,
      },
    });

    const editedContent = aiResponse.content || "";

    // 计算新报告内容
    const selectionToReplace = dto.selectedText || dto.selection;
    let newFullReport = report.fullReport;

    if (selectionToReplace) {
      // 使用上下文定位进行精确替换
      let selectionIndex = -1;

      // 方法1：使用 selectorPrefix 和 selectorSuffix 进行上下文匹配
      if (dto.selectorPrefix || dto.selectorSuffix) {
        const prefix = dto.selectorPrefix || "";
        const suffix = dto.selectorSuffix || "";
        const contextPattern = prefix + selectionToReplace + suffix;
        const contextIndex = report.fullReport.indexOf(contextPattern);

        if (contextIndex !== -1) {
          // 找到上下文匹配，计算实际选中文本的位置
          selectionIndex = contextIndex + prefix.length;
          this.logger.debug(
            `Context-based match found at index ${selectionIndex}`,
          );
        } else {
          this.logger.warn(`Context pattern not found, falling back`);
        }
      }

      // 方法2：退回到简单的 indexOf 匹配
      if (selectionIndex === -1) {
        selectionIndex = report.fullReport.indexOf(selectionToReplace);
      }

      if (selectionIndex !== -1) {
        newFullReport =
          report.fullReport.substring(0, selectionIndex) +
          editedContent +
          report.fullReport.substring(
            selectionIndex + selectionToReplace.length,
          );
      } else {
        this.logger.warn(`Selection not found in report ${reportId}`);
      }
    } else {
      // 替换整个报告
      newFullReport = editedContent;
    }

    // 保存修订历史并更新报告（事务）
    const changeDescription = dto.context
      ? `AI ${dto.operation}: ${dto.context.slice(0, 50)}`
      : `AI ${dto.operation} 操作`;
    const updatedReport = await this.reportDataService.saveAiEditRevision(
      reportId,
      report.fullReport,
      newFullReport,
      changeDescription,
      dto.operation,
    );

    return {
      report: updatedReport,
      editedContent,
      operation: dto.operation,
    };
  }

  /**
   * 获取报告修订历史
   */
  async getReportRevisions(userId: string, topicId: string, reportId: string) {
    await this.verifyTopicReadAccess(userId, topicId);

    const report = await this.reportService.getReport(reportId);
    if (!report || report.topicId !== topicId) {
      throw new NotFoundException("Report not found");
    }

    return this.reportDataService.getReportRevisions(reportId);
  }

  /**
   * 回滚报告到指定版本
   */
  async rollbackReport(
    userId: string,
    topicId: string,
    reportId: string,
    revisionNumber: number,
  ) {
    await this.verifyTopicOwnership(userId, topicId);

    const report = await this.reportService.getReport(reportId);
    if (!report || report.topicId !== topicId) {
      throw new NotFoundException("Report not found");
    }

    return this.reportDataService.rollbackToRevision(
      reportId,
      revisionNumber,
      report.fullReport,
    );
  }

  /**
   * 比较报告版本
   */
  async compareReports(
    userId: string,
    topicId: string,
    dto: CompareReportsDto,
  ) {
    // 验证专题所有权
    await this.verifyTopicOwnership(userId, topicId);

    // 通过版本号获取报告 ID
    const [fromReport, toReport] = await Promise.all([
      this.prisma.topicReport.findFirst({
        where: { topicId, version: dto.from },
        select: { id: true },
      }),
      this.prisma.topicReport.findFirst({
        where: { topicId, version: dto.to },
        select: { id: true },
      }),
    ]);

    if (!fromReport || !toReport) {
      throw new NotFoundException("One or both report versions not found");
    }

    return this.reportService.compareReports(
      topicId,
      fromReport.id,
      toReport.id,
    );
  }

  // ==================== Evidence (kept in Facade) ====================

  /**
   * 获取证据列表
   */
  async listEvidence(
    userId: string,
    topicId: string,
    reportId: string,
    query: ListEvidenceDto,
  ) {
    // 验证专题读取权限（支持公开专题访问）
    await this.verifyTopicReadAccess(userId, topicId);

    // 验证报告属于该专题
    const report = await this.reportService.getReport(reportId);
    if (!report || report.topicId !== topicId) {
      throw new NotFoundException("Report not found");
    }

    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const result = await this.evidenceService.listEvidence(reportId, {
      skip: (page - 1) * pageSize,
      take: pageSize,
      sourceType: query.sourceType as string | undefined,
      minCredibility: query.minCredibility,
    });

    // 转换为前端期望的格式
    return {
      evidence: result.evidences,
      total: result.total,
      hasMore: (page - 1) * pageSize + result.evidences.length < result.total,
    };
  }

  /**
   * 获取证据详情
   */
  async getEvidence(
    userId: string,
    topicId: string,
    reportId: string,
    evidenceId: string,
  ) {
    // 验证专题读取权限（支持公开专题访问）
    await this.verifyTopicReadAccess(userId, topicId);

    // 验证报告属于该专题
    const report = await this.reportService.getReport(reportId);
    if (!report || report.topicId !== topicId) {
      throw new NotFoundException("Report not found");
    }

    const evidence = await this.evidenceService.getEvidence(evidenceId);

    if (!evidence || evidence.reportId !== reportId) {
      throw new NotFoundException("Evidence not found");
    }

    return evidence;
  }

  // ==================== Report Editing (kept in Facade) ====================

  async getReportChanges(userId: string, topicId: string, reportId: string) {
    // 验证专题读取权限（支持公开专题访问）
    await this.verifyTopicReadAccess(userId, topicId);

    // 验证报告属于该专题
    const report = await this.reportService.getReport(reportId);
    if (!report || report.topicId !== topicId) {
      throw new NotFoundException("Report not found");
    }

    return this.reportChangeService.getChanges(reportId);
  }

  async checkinChange(
    userId: string,
    topicId: string,
    reportId: string,
    changeId: string,
  ) {
    // 验证专题所有权
    await this.verifyTopicOwnership(userId, topicId);

    // 验证报告属于该专题
    const report = await this.reportService.getReport(reportId);
    if (!report || report.topicId !== topicId) {
      throw new NotFoundException("Report not found");
    }

    await this.reportChangeService.checkinChange(changeId, userId);
    return { success: true };
  }

  async checkinAllChanges(
    userId: string,
    topicId: string,
    reportId: string,
    changeIds?: string[],
  ) {
    // 验证专题所有权
    await this.verifyTopicOwnership(userId, topicId);

    // 验证报告属于该专题
    const report = await this.reportService.getReport(reportId);
    if (!report || report.topicId !== topicId) {
      throw new NotFoundException("Report not found");
    }

    const count = await this.reportChangeService.checkinAllChanges(
      reportId,
      userId,
      changeIds,
    );
    return { count };
  }

  async getReportAnnotations(
    userId: string,
    topicId: string,
    reportId: string,
    status?: string,
  ) {
    // 验证专题读取权限（支持公开专题访问）
    await this.verifyTopicReadAccess(userId, topicId);

    // 验证报告属于该专题
    const report = await this.reportService.getReport(reportId);
    if (!report || report.topicId !== topicId) {
      throw new NotFoundException("Report not found");
    }

    return this.reportAnnotationService.getAnnotations(
      reportId,
      status as AnnotationStatus | undefined,
    );
  }

  async createAnnotation(
    userId: string,
    topicId: string,
    reportId: string,
    dto: {
      content: string;
      type: AnnotationType;
      selectedText?: string;
      startOffset: number;
      endOffset: number;
      selectorPrefix?: string;
      selectorSuffix?: string;
      color?: string;
    },
  ) {
    // 验证专题读取权限（公开专题的所有登录用户都可以创建批注）
    await this.verifyTopicReadAccess(userId, topicId);

    // 验证报告属于该专题
    const report = await this.reportService.getReport(reportId);
    if (!report || report.topicId !== topicId) {
      throw new NotFoundException("Report not found");
    }

    return this.reportAnnotationService.createAnnotation(reportId, userId, dto);
  }

  async updateAnnotation(
    userId: string,
    topicId: string,
    reportId: string,
    annotationId: string,
    dto: { content?: string; status?: AnnotationStatus },
  ) {
    // 验证专题读取权限
    await this.verifyTopicReadAccess(userId, topicId);

    // 验证报告属于该专题
    const report = await this.reportService.getReport(reportId);
    if (!report || report.topicId !== topicId) {
      throw new NotFoundException("Report not found");
    }

    // 验证批注所有权（只有批注创建者可以更新自己的批注）
    const annotation = await this.prisma.reportAnnotation.findUnique({
      where: { id: annotationId },
      select: { createdById: true },
    });
    if (!annotation) {
      throw new NotFoundException("Annotation not found");
    }
    if (annotation.createdById !== userId) {
      throw new ForbiddenException("You can only update your own annotations");
    }

    return this.reportAnnotationService.updateAnnotation(annotationId, dto);
  }

  async deleteAnnotation(
    userId: string,
    topicId: string,
    reportId: string,
    annotationId: string,
  ) {
    // 获取专题信息
    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
      select: { userId: true },
    });
    if (!topic) {
      throw new NotFoundException("Topic not found");
    }

    // 验证专题读取权限
    await this.verifyTopicReadAccess(userId, topicId);

    // 验证报告属于该专题
    const report = await this.reportService.getReport(reportId);
    if (!report || report.topicId !== topicId) {
      throw new NotFoundException("Report not found");
    }

    // 验证删除权限（批注创建者或专题创建者可删除）
    const annotation = await this.prisma.reportAnnotation.findUnique({
      where: { id: annotationId },
      select: { createdById: true },
    });
    if (!annotation) {
      throw new NotFoundException("Annotation not found");
    }
    const isAnnotationOwner = annotation.createdById === userId;
    const isTopicOwner = topic.userId === userId;
    if (!isAnnotationOwner && !isTopicOwner) {
      throw new ForbiddenException(
        "Only the annotation creator or topic owner can delete this annotation",
      );
    }

    return this.reportAnnotationService.deleteAnnotation(annotationId);
  }

  async resolveAnnotation(
    userId: string,
    topicId: string,
    reportId: string,
    annotationId: string,
  ) {
    // 获取专题信息
    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
      select: { userId: true },
    });
    if (!topic) {
      throw new NotFoundException("Topic not found");
    }

    // 验证专题读取权限
    await this.verifyTopicReadAccess(userId, topicId);

    // 验证报告属于该专题
    const report = await this.reportService.getReport(reportId);
    if (!report || report.topicId !== topicId) {
      throw new NotFoundException("Report not found");
    }

    // 验证解决权限（批注创建者或专题创建者可解决）
    const annotation = await this.prisma.reportAnnotation.findUnique({
      where: { id: annotationId },
      select: { createdById: true },
    });
    if (!annotation) {
      throw new NotFoundException("Annotation not found");
    }
    const isAnnotationOwner = annotation.createdById === userId;
    const isTopicOwner = topic.userId === userId;
    if (!isAnnotationOwner && !isTopicOwner) {
      throw new ForbiddenException(
        "Only the annotation creator or topic owner can resolve this annotation",
      );
    }

    return this.reportAnnotationService.resolveAnnotation(annotationId, userId);
  }

  async resolveAllAnnotations(
    userId: string,
    topicId: string,
    reportId: string,
    annotationIds?: string[],
  ) {
    // 验证专题所有权
    await this.verifyTopicOwnership(userId, topicId);

    // 验证报告属于该专题
    const report = await this.reportService.getReport(reportId);
    if (!report || report.topicId !== topicId) {
      throw new NotFoundException("Report not found");
    }

    const count = await this.reportAnnotationService.resolveAllAnnotations(
      reportId,
      userId,
      annotationIds,
    );
    return { count };
  }

  // ==================== Helper Methods ====================

  /**
   * 验证专题所有权（仅创建者可访问，用于写入操作）
   */
  private async verifyTopicOwnership(
    userId: string,
    topicId: string,
  ): Promise<void> {
    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
      select: { userId: true },
    });

    if (!topic) {
      throw new NotFoundException(`Topic ${topicId} not found`);
    }

    if (topic.userId !== userId) {
      throw new ForbiddenException(
        "You do not have permission to access this topic",
      );
    }
  }

  /**
   * 验证专题读取权限（支持公开专题访问，用于只读操作）
   */
  private async verifyTopicReadAccess(
    userId: string,
    topicId: string,
  ): Promise<void> {
    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
      select: { userId: true },
    });

    if (!topic) {
      throw new NotFoundException(`Topic ${topicId} not found`);
    }

    // 创建者始终有权限
    if (topic.userId === userId) {
      return;
    }

    // 检查 visibility 和协作者状态
    const hasAccess = await this.checkTopicAccess(
      userId,
      topicId,
      topic.userId,
    );
    if (!hasAccess) {
      throw new ForbiddenException(
        "You do not have permission to access this topic",
      );
    }
  }

  /**
   * 验证报告属于指定专题
   */
  private async verifyReportBelongsToTopic(
    reportId: string,
    topicId: string,
  ): Promise<void> {
    const report = await this.prisma.topicReport.findUnique({
      where: { id: reportId },
      select: { topicId: true },
    });

    if (!report || report.topicId !== topicId) {
      throw new NotFoundException("Report not found");
    }
  }

  // ==================== Compute Usage ====================

  /**
   * 获取专题算力消耗数据
   */
  async getComputeUsage(
    userId: string,
    topicId: string,
    missionId?: string,
  ): Promise<{
    summary: {
      totalTokens: number;
      inputTokens: number;
      outputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      totalCreditsConsumed: number;
      estimatedCostUsd: number;
      totalLlmCalls: number;
      totalDimensions: number;
      researchDurationMs: number;
      reportGenerationMs: number;
    };
    dimensions: Array<{
      dimensionName: string;
      modelUsed: string | null;
      tokensUsed: number | null;
      sourcesUsed: number;
    }>;
    modelDistribution: Array<{
      modelId: string;
      callCount: number;
      totalTokens: number;
      inputTokens: number;
      outputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      estimatedCost: number;
      percentage: number;
    }>;
    creditHistory: Array<{
      operationType: string;
      amount: number;
      tokenCount: number | null;
      inputTokens: number | null;
      outputTokens: number | null;
      cacheCreationTokens: number | null;
      cacheReadTokens: number | null;
      modelName: string | null;
      createdAt: string;
    }>;
    mission: {
      leaderModel: string;
      researchDepth: string;
      startedAt: string | null;
      completedAt: string | null;
      totalTasks: number;
      completedTasks: number;
    } | null;
    latency: LatencySessionSummary | null;
    latencySteps: Array<{
      name: string;
      durationMs: number;
      parentStepId?: string;
      actions: Array<{
        name: string;
        type: string;
        model: string;
        totalDurationMs: number;
        ttftMs?: number;
        ttltMs: number;
        inputTokens: number;
        outputTokens: number;
      }>;
    }>;
    /** 该 Topic 的所有 Mission 列表（用于前端选择器） */
    missions: Array<{
      id: string;
      status: string;
      researchDepth: string | null;
      startedAt: string | null;
      completedAt: string | null;
      createdAt: string;
    }>;
    /** 当前选中的 Mission ID */
    currentMissionId: string | null;
  }> {
    await this.verifyTopicReadAccess(userId, topicId);

    this.logger.log(
      `[getComputeUsage] topicId=${topicId} missionId=${missionId ?? "latest"}`,
    );

    // 0. 解析目标 Mission 和时间窗口
    const targetMission = missionId
      ? await this.prisma.researchMission.findFirst({
          where: { id: missionId, topicId },
          select: {
            id: true,
            topicId: true,
            leaderModelId: true,
            leaderModelName: true,
            researchDepth: true,
            startedAt: true,
            completedAt: true,
            createdAt: true,
            totalTasks: true,
            completedTasks: true,
          },
        })
      : await this.prisma.researchMission.findFirst({
          where: { topicId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            topicId: true,
            leaderModelId: true,
            leaderModelName: true,
            researchDepth: true,
            startedAt: true,
            completedAt: true,
            createdAt: true,
            totalTasks: true,
            completedTasks: true,
          },
        });

    // 验证 missionId 有效性
    if (missionId && !targetMission) {
      throw new NotFoundException(
        `Mission ${missionId} not found for topic ${topicId}`,
      );
    }

    // 时间窗口：mission 的 startedAt → completedAt（或 now）
    const windowStart = targetMission?.startedAt ?? targetMission?.createdAt;
    const windowEnd = targetMission?.completedAt ?? new Date();

    // 1. 获取该 Mission 时间窗口内的报告
    const latestReport = await this.prisma.topicReport.findFirst({
      where: {
        topicId,
        ...(windowStart
          ? { generatedAt: { gte: windowStart, lte: windowEnd } }
          : {}),
      },
      orderBy: { generatedAt: "desc" },
      select: {
        id: true,
        totalTokens: true,
        generationTimeMs: true,
        totalDimensions: true,
      },
    });

    // 2. 获取该报告的维度分析（复用 latestReport.id，不重新查询）
    const dimensionAnalyses = await this.prisma.dimensionAnalysis.findMany({
      where: {
        reportId: {
          in: latestReport ? [latestReport.id] : [],
        },
      },
      select: {
        tokensUsed: true,
        modelUsed: true,
        sourcesUsed: true,
        dimension: {
          select: { name: true },
        },
      },
    });

    // 3. Mission 已在步骤 0 获取（targetMission）
    const latestMission = targetMission;

    // 4. 按 modelName 聚合 CreditTransaction（ai_engine_metrics 的 missionId 大多为 null，不可靠）
    type CreditAggRow = {
      model_name: string | null;
      call_count: bigint;
      total_tokens: bigint | null;
      total_input_tokens: bigint | null;
      total_output_tokens: bigint | null;
      total_cache_creation_tokens: bigint | null;
      total_cache_read_tokens: bigint | null;
    };

    const creditAggGroups: CreditAggRow[] = await this.prisma.$queryRaw<
      CreditAggRow[]
    >`
        SELECT
          model_name,
          COUNT(*) AS call_count,
          SUM(COALESCE(token_count, 0)) AS total_tokens,
          SUM(COALESCE(input_tokens, 0)) AS total_input_tokens,
          SUM(COALESCE(output_tokens, 0)) AS total_output_tokens,
          SUM(COALESCE(cache_creation_tokens, 0)) AS total_cache_creation_tokens,
          SUM(COALESCE(cache_read_tokens, 0)) AS total_cache_read_tokens
        FROM credit_transactions
        WHERE reference_id = ${topicId}
          AND amount < 0
          AND created_at >= ${windowStart ?? new Date("2020-01-01")}
          AND created_at <= ${windowEnd}
        GROUP BY model_name
        ORDER BY call_count DESC
      `;

    // 5. 查询 CreditTransaction（referenceId = topicId，按 Mission 时间窗口）
    const creditTransactions = await this.prisma.creditTransaction.findMany({
      where: {
        referenceId: topicId,
        ...(windowStart
          ? { createdAt: { gte: windowStart, lte: windowEnd } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        operationType: true,
        amount: true,
        tokenCount: true,
        inputTokens: true,
        outputTokens: true,
        cacheCreationTokens: true,
        cacheReadTokens: true,
        modelName: true,
        createdAt: true,
      },
    });

    // ---- 汇总计算 ----

    // totalCreditsConsumed: 所有 credit 交易中负数部分的绝对值之和
    const totalCreditsConsumed = creditTransactions
      .filter((t) => t.amount < 0)
      .reduce((acc, t) => acc + Math.abs(t.amount), 0);

    // totalLlmCalls / totalTokens from credit aggregation
    let totalLlmCalls = 0;
    let creditTotalTokens = 0;
    let creditInputTokens = 0;
    let creditOutputTokens = 0;
    let creditCacheCreationTokens = 0;
    let creditCacheReadTokens = 0;

    for (const g of creditAggGroups) {
      totalLlmCalls += Number(g.call_count);
      creditTotalTokens += Number(g.total_tokens ?? 0);
      creditInputTokens += Number(g.total_input_tokens ?? 0);
      creditOutputTokens += Number(g.total_output_tokens ?? 0);
      creditCacheCreationTokens += Number(g.total_cache_creation_tokens ?? 0);
      creditCacheReadTokens += Number(g.total_cache_read_tokens ?? 0);
    }

    // 优先使用 CreditTransaction 的 token 汇总（最可靠），fallback 到 TopicReport.totalTokens
    const reportTotalTokens = latestReport?.totalTokens ?? 0;
    const finalTotalTokens =
      creditTotalTokens > 0 ? creditTotalTokens : reportTotalTokens;
    // 预估 USD（基于 token 总量和平均 $2/1M token 估算）
    const estimatedCostUsd =
      finalTotalTokens > 0 ? (finalTotalTokens * 2) / 1_000_000 : 0;

    // researchDurationMs: mission.startedAt → completedAt
    let researchDurationMs = 0;
    if (latestMission?.startedAt && latestMission?.completedAt) {
      researchDurationMs =
        new Date(latestMission.completedAt).getTime() -
        new Date(latestMission.startedAt).getTime();
    }

    // modelDistribution from credit aggregation
    const modelDistribution = creditAggGroups
      .filter((g) => g.model_name !== null)
      .map((g) => {
        const tokens = Number(g.total_tokens ?? 0);
        return {
          modelId: g.model_name as string,
          callCount: Number(g.call_count),
          totalTokens: tokens,
          inputTokens: Number(g.total_input_tokens ?? 0),
          outputTokens: Number(g.total_output_tokens ?? 0),
          cacheCreationTokens: Number(g.total_cache_creation_tokens ?? 0),
          cacheReadTokens: Number(g.total_cache_read_tokens ?? 0),
          estimatedCost: tokens > 0 ? (tokens * 2) / 1_000_000 : 0,
          percentage:
            totalLlmCalls > 0
              ? Math.round((Number(g.call_count) / totalLlmCalls) * 100)
              : 0,
        };
      })
      .sort((a, b) => b.callCount - a.callCount);

    // 6. 获取该 Topic 的所有 Mission 列表（用于前端选择器）
    const allMissions = await this.prisma.researchMission.findMany({
      where: { topicId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        researchDepth: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
      },
    });

    // 7. 获取最新的时延跟踪数据（summary + steps 树形明细）
    type StepWithActions = {
      name: string;
      durationMs: number;
      actions: Array<{
        name: string;
        type: string;
        model: string;
        totalDurationMs: number;
        ttftMs?: number;
        ttltMs: number;
        inputTokens: number;
        outputTokens: number;
      }>;
    };
    let latencySummary: LatencySessionSummary | undefined;
    let latencySteps: StepWithActions[] = [];
    if (this.latencyTracker) {
      // 优先从 DB 查已完成的 session（phases 列存储 Step[]，含 actions）
      try {
        const dbSession = await this.prisma.latencySession.findFirst({
          where: {
            entityId: topicId,
            type: "topic_insights_refresh",
            ...(windowStart
              ? { startTime: { gte: windowStart, lte: windowEnd } }
              : {}),
          },
          orderBy: { createdAt: "desc" },
          select: { summary: true, phases: true },
        });
        if (dbSession?.summary) {
          latencySummary =
            dbSession.summary as unknown as LatencySessionSummary;
          // phases 列实际存储的是 LatencyStep[]（含 actions[]）
          const rawSteps = (dbSession.phases ?? []) as unknown as Array<{
            id?: string;
            name: string;
            parentStepId?: string;
            durationMs?: number;
            startTime?: number;
            endTime?: number;
            actions?: Array<{
              name: string;
              type?: string;
              model: string;
              totalDurationMs: number;
              ttftMs?: number;
              ttltMs: number;
              inputTokens: number;
              outputTokens: number;
            }>;
          }>;
          latencySteps = rawSteps.map((s) => ({
            name: s.name,
            parentStepId: s.parentStepId,
            durationMs:
              s.durationMs ??
              (s.startTime && s.endTime ? s.endTime - s.startTime : 0),
            actions: (s.actions ?? []).map((a) => ({
              name: a.name,
              type: a.type ?? "llm_call",
              model: a.model,
              totalDurationMs: a.totalDurationMs,
              ttftMs: a.ttftMs,
              ttltMs: a.ttltMs,
              inputTokens: a.inputTokens,
              outputTokens: a.outputTokens,
            })),
          }));
        }
      } catch {
        /* non-fatal */
      }
      // fallback 到内存中活跃的 session（实时数据）
      if (!latencySummary) {
        const activeSession = this.latencyTracker.getActiveSession(
          topicId,
          "topic_insights_refresh",
        );
        if (activeSession) {
          latencySummary = this.latencyTracker.getActiveSessionSummary(
            topicId,
            "topic_insights_refresh",
          );
          // 从内存 session 提取 steps+actions 树
          latencySteps = activeSession.steps.map((s) => ({
            name: s.name,
            parentStepId: s.parentStepId,
            durationMs:
              s.durationMs ??
              (s.endTime ? s.endTime - s.startTime : Date.now() - s.startTime),
            actions: s.actions.map((a) => ({
              name: a.name,
              type: a.type ?? "llm_call",
              model: a.model,
              totalDurationMs: a.totalDurationMs,
              ttftMs: a.ttftMs,
              ttltMs: a.ttltMs,
              inputTokens: a.inputTokens,
              outputTokens: a.outputTokens,
            })),
          }));
        }
      }
    }

    return {
      summary: {
        totalTokens: finalTotalTokens,
        inputTokens: creditInputTokens,
        outputTokens: creditOutputTokens,
        cacheCreationTokens: creditCacheCreationTokens,
        cacheReadTokens: creditCacheReadTokens,
        totalCreditsConsumed,
        estimatedCostUsd,
        totalLlmCalls,
        totalDimensions: latestReport?.totalDimensions ?? 0,
        researchDurationMs,
        reportGenerationMs: latestReport?.generationTimeMs ?? 0,
      },
      dimensions: dimensionAnalyses.map((da) => ({
        dimensionName: da.dimension.name,
        modelUsed: da.modelUsed,
        tokensUsed: da.tokensUsed,
        sourcesUsed: da.sourcesUsed,
      })),
      modelDistribution,
      creditHistory: creditTransactions.map((t) => ({
        operationType: t.operationType ?? "",
        amount: t.amount,
        tokenCount: t.tokenCount,
        inputTokens: t.inputTokens,
        outputTokens: t.outputTokens,
        cacheCreationTokens: t.cacheCreationTokens,
        cacheReadTokens: t.cacheReadTokens,
        modelName: t.modelName,
        createdAt: t.createdAt.toISOString(),
      })),
      mission: latestMission
        ? {
            leaderModel:
              latestMission.leaderModelName ??
              latestMission.leaderModelId ??
              "",
            researchDepth: latestMission.researchDepth ?? "",
            startedAt: latestMission.startedAt?.toISOString() ?? null,
            completedAt: latestMission.completedAt?.toISOString() ?? null,
            totalTasks: latestMission.totalTasks,
            completedTasks: latestMission.completedTasks,
          }
        : null,
      latency: latencySummary ?? null,
      latencySteps,
      missions: allMissions.map((m) => ({
        id: m.id,
        status: m.status,
        researchDepth: m.researchDepth,
        startedAt: m.startedAt?.toISOString() ?? null,
        completedAt: m.completedAt?.toISOString() ?? null,
        createdAt: m.createdAt.toISOString(),
      })),
      currentMissionId: targetMission?.id ?? null,
    };
  }

  /**
   * 检查用户是否有权访问专题
   */
  private async checkTopicAccess(
    userId: string,
    topicId: string,
    ownerId: string,
  ): Promise<boolean> {
    // 1. 创建者始终有权限
    if (userId === ownerId) {
      return true;
    }

    // 2. 检查visibility和协作者状态
    const result = await this.prisma.$queryRaw<
      { visibility: string; is_collaborator: boolean }[]
    >`
      SELECT
        rt.visibility,
        EXISTS(
          SELECT 1 FROM research_topic_collaborators tc
          WHERE tc."topic_id" = rt.id
            AND tc."user_id" = ${userId}
            AND tc."is_active" = true
        ) as is_collaborator
      FROM research_topics rt
      WHERE rt.id = ${topicId}
    `;

    if (!result.length) {
      return false;
    }

    const { visibility, is_collaborator } = result[0];

    // PUBLIC: 所有登录用户可见
    if (visibility === "PUBLIC") {
      return true;
    }

    // SHARED: 协作者可见
    if (visibility === "SHARED" && is_collaborator) {
      return true;
    }

    // PRIVATE: 只有创建者可见（已在上面检查过）
    return false;
  }
}
