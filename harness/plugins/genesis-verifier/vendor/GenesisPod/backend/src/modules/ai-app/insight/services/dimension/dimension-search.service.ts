/**
 * Dimension Search Service
 *
 * 负责维度研究的搜索阶段（Phase 1）
 *
 * 核心职责：
 * 1. 执行搜索并收集资料
 * 2. 数据增强和图表提取
 * 3. 生成证据摘要和时间上下文
 * 4. Leader 主动搜索补充上下文
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  DimensionStatus,
  type ResearchTopic,
  type TopicDimension,
} from "@prisma/client";
import { DataSourceRouterService } from "../data/data-source-router.service";
import { ResearchEventEmitterService } from "../core/research/research-event-emitter.service";
import {
  AgentActivityService,
  type ThinkingPhase,
} from "../monitoring/agent-activity.service";
import { type SearchResultsRecord } from "../../types/monitoring.types";
import { DataEnrichmentService } from "../data/data-enrichment.service";
import { LeaderToolService } from "../data/leader-tool.service";
import type { EnrichedEvidenceData } from "../../types/research.types";
import { AgentActivityType } from "@prisma/client";
import {
  getCurrentDateString,
  getFreshnessRequirementDescription,
} from "../../prompts/dimension-research.prompt";
import {
  createEvidenceSummary,
  buildFiguresSummary,
  type FigureRegistryEntry,
} from "./evidence-summary.utils";
import type { AICapabilityContext } from "@/modules/ai-harness/facade";
import type { TemporalContext } from "./section-writer.service";

/**
 * 搜索阶段结果（Phase 1）
 */
export interface SearchPhaseResult {
  dimensionId: string;
  dimensionName: string;
  enrichedResults: import("../../types/research.types").EnrichedResult[];
  evidenceData: EnrichedEvidenceData[];
  evidenceSummary: string;
  searchResultsRecord: SearchResultsRecord;
  temporalContext: TemporalContext;
  figuresSummary: string;
  /** 图表注册表：figureId → 完整元数据，用于系统回填 imageUrl 等字段 */
  figureRegistry: Map<string, FigureRegistryEntry>;
  leaderContextSummary: string;
  /** Phase 1 使用的模型、工具、技能（便于 Phase 3 调试） */
  modelId?: string;
  assignedTools?: string[];
  assignedSkills?: string[];
  /** V5: 验证上下文（注入到写作 prompt） */
  validationContext?: string;
}

@Injectable()
export class DimensionSearchService {
  private readonly logger = new Logger(DimensionSearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dataSourceRouter: DataSourceRouterService,
    private readonly eventEmitter: ResearchEventEmitterService,
    private readonly agentActivity: AgentActivityService,
    private readonly dataEnrichment: DataEnrichmentService,
    private readonly leaderTool: LeaderToolService,
  ) {}

  /**
   * 执行搜索阶段（Phase 1）
   *
   * 职责：
   * 1. 执行搜索并收集资料
   * 2. 数据增强和图表提取
   * 3. 生成证据摘要和时间上下文
   * 4. Leader 主动搜索补充上下文
   *
   * @param topic 研究专题
   * @param dimension 研究维度
   * @param missionId 任务ID（可选，用于持久化团队消息）
   * @param modelId Leader 分配的模型 ID
   * @param taskId 研究任务ID（可选，用于前端精确匹配进度更新）
   * @param assignedTools Leader 分配的工具
   * @param assignedSkills Leader 分配的技能
   * @param emitProgressFn 进度发送函数（可选，用于发送进度事件）
   * @returns 搜索阶段结果
   */
  async executeSearchPhase(
    topic: ResearchTopic,
    dimension: TopicDimension,
    missionId?: string,
    modelId?: string,
    taskId?: string,
    assignedTools?: string[],
    assignedSkills?: string[],
    emitProgressFn?: (
      topicId: string,
      dimensionName: string,
      progress: {
        stage: string;
        sectionsTotal: number;
        sectionsCompleted: number;
        message: string;
      },
      missionId?: string,
      stageProgress?: number,
      taskId?: string,
    ) => Promise<void>,
  ): Promise<SearchPhaseResult> {
    const dimId = dimension.id.slice(0, 8);
    const logPrefix = `[Dimension:${dimension.name}:${dimId}]`;

    this.logger.log(
      `${logPrefix} Starting search phase (topicId=${topic.id.slice(0, 8)})${modelId ? `, model: ${modelId}` : ""}`,
    );

    // Update dimension status to RESEARCHING
    await this.prisma.topicDimension.update({
      where: { id: dimension.id },
      data: { status: DimensionStatus.RESEARCHING },
    });

    const researcherAgentId = `researcher_${dimId}`;
    const researcherAgentName = "研究员";
    const effectiveMissionId = missionId || dimension.id;

    // Suppress unused variable warnings - these are used in the search phase
    void researcherAgentId;
    void researcherAgentName;

    // 1. 获取搜索结果
    if (emitProgressFn) {
      await emitProgressFn(
        topic.id,
        dimension.name,
        {
          stage: "planning",
          sectionsTotal: 0,
          sectionsCompleted: 0,
          message: "正在收集资料...",
        },
        missionId,
        5,
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
      activityType: AgentActivityType.RESEARCHING,
      phase: "searching",
      content: `正在为维度「${dimension.name}」收集资料...`,
      progress: 0,
      thinkingPhase: "searching" as ThinkingPhase,
      thinkingContent: `搜索关键词: ${Array.isArray(dimension.searchQueries) ? dimension.searchQueries.join(", ") : dimension.name}`,
    });

    // ★ RAG-Fusion: 当维度有多个搜索查询时自动启用多查询融合
    const searchQueryCount = Array.isArray(dimension.searchQueries)
      ? dimension.searchQueries.length
      : 0;

    const searchResult = await this.dataSourceRouter.fetchDataForDimension(
      dimension,
      topic,
      {
        assignedTools,
        assignedSkills,
        ragFusionConfig:
          searchQueryCount >= 1
            ? { enabled: true, maxVariants: Math.min(searchQueryCount + 2, 6) }
            : undefined,
      },
    );

    this.logger.log(
      `${logPrefix} Search completed: ${searchResult.items.length} sources found`,
    );

    // 2. 数据增强
    const topicConfig = topic.topicConfig as Record<string, unknown> | null;
    const enrichmentTopN = (topicConfig?.enrichmentTopN as number) || 15;
    const enrichmentMaxLength =
      (topicConfig?.enrichmentMaxLength as number) || 3000;
    const enableFigures = topicConfig?.enableFigures !== false;

    this.logger.log(
      `${logPrefix} Enriching search results (topN=${enrichmentTopN}, enableFigures=${enableFigures})...`,
    );
    const enrichedResults = await this.dataEnrichment.enrichSearchResults(
      searchResult.items,
      {
        topN: enrichmentTopN,
        maxContentLength: enrichmentMaxLength,
        enableFigures,
        topicTitle: topic.name,
        dimensionName: dimension.name,
      },
    );

    const enrichmentStats =
      this.dataEnrichment.getEnrichmentStats(enrichedResults);
    this.logger.log(
      `${logPrefix} Enrichment: ${enrichmentStats.fetched}/${enrichmentStats.total} fetched, ` +
        `${enrichmentStats.validUrls} valid URLs, avg ${enrichmentStats.avgContentLength} chars`,
    );

    if (enrichmentStats.invalidUrls > 0) {
      this.logger.warn(
        `${logPrefix} Found ${enrichmentStats.invalidUrls} invalid URLs (404/error pages)`,
      );
    }

    // 3. 计算时效性信息
    const publishedDates = enrichedResults
      .map((item) => {
        if (!item.publishedAt) return null;
        const d =
          item.publishedAt instanceof Date
            ? item.publishedAt
            : new Date(item.publishedAt);
        return !isNaN(d.getTime()) ? d : null;
      })
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime());

    const freshnessInfo =
      publishedDates.length > 0
        ? {
            newestDate: publishedDates[0]?.toISOString(),
            oldestDate:
              publishedDates[publishedDates.length - 1]?.toISOString(),
            avgAgeInDays: Math.round(
              publishedDates.reduce(
                (sum, d) =>
                  sum + (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24),
                0,
              ) / publishedDates.length,
            ),
          }
        : undefined;

    const usedSources = [
      ...new Set((searchResult.sources || []).map((s) => String(s))),
    ].join(", ");

    const knowledgeBaseResults = searchResult.items.filter(
      (item) =>
        String(item.sourceType).toLowerCase() === "local" ||
        (item.metadata as Record<string, unknown>)?.knowledgeBaseSource,
    );
    const knowledgeBaseIds = (topicConfig?.knowledgeBaseIds as string[]) || [];
    const knowledgeBaseInfo =
      knowledgeBaseIds.length > 0
        ? {
            enabled: true,
            knowledgeBaseIds,
            matchedCount: knowledgeBaseResults.length,
            avgSimilarity:
              knowledgeBaseResults.length > 0
                ? knowledgeBaseResults.reduce(
                    (sum, item) =>
                      sum +
                      (((item.metadata as Record<string, unknown>)
                        ?.similarity as number) || 0),
                    0,
                  ) / knowledgeBaseResults.length
                : undefined,
          }
        : undefined;

    if (knowledgeBaseInfo?.matchedCount && knowledgeBaseInfo.matchedCount > 0) {
      this.logger.log(
        `${logPrefix} ★ Knowledge base used! Matched ${knowledgeBaseInfo.matchedCount} results ` +
          `from ${knowledgeBaseIds.length} knowledge bases. Avg similarity: ${knowledgeBaseInfo.avgSimilarity?.toFixed(2) || "N/A"}`,
      );
    }

    const searchResultsRecord: SearchResultsRecord = {
      total: searchResult.items.length,
      filtered: enrichedResults.length,
      searchTool: usedSources || "web",
      query: searchResult.metadata?.searchQuery || dimension.name,
      searchedAt: new Date().toISOString(),
      freshnessInfo,
      knowledgeBaseInfo,
      sources: enrichedResults.slice(0, 20).map((item) => {
        let publishedDate: string | undefined;
        if (item.publishedAt) {
          try {
            const d =
              item.publishedAt instanceof Date
                ? item.publishedAt
                : new Date(item.publishedAt);
            if (!isNaN(d.getTime())) {
              publishedDate = d.toISOString();
            }
          } catch (error) {
            this.logger.debug(
              `[recordSearchActivity] Failed to parse publishedAt: ${error}`,
            );
          }
        }
        const metadata = item.metadata;
        const isKnowledgeBase =
          String(item.sourceType).toLowerCase() === "local" ||
          metadata?.knowledgeBaseSource === true;
        return {
          title: item.title || "未知标题",
          url: item.url || "",
          domain: item.domain,
          sourceType: String(item.sourceType),
          publishedDate,
          isKnowledgeBase,
          similarity: isKnowledgeBase
            ? (metadata?.similarity as number | undefined)
            : undefined,
          documentId: isKnowledgeBase
            ? (metadata?.documentId as string | undefined)
            : undefined,
        };
      }),
    };

    await this.agentActivity.endThinkingPhase(
      topic.id,
      researcherAgentId,
      "searching" as ThinkingPhase,
      {
        searchResults: searchResultsRecord,
        finalContent: `搜索完成，找到 ${searchResult.items.length} 条资料，${enrichmentStats.fetched} 条已增强完整内容`,
      },
    );

    await this.eventEmitter.emitAgentWorking(
      topic.id,
      {
        agentId: researcherAgentId,
        agentName: researcherAgentName,
        agentRole: "researcher",
        status: "working",
        taskDescription: `维度「${dimension.name}」搜索完成：${searchResultsRecord.searchTool || "网络"} 找到 ${searchResultsRecord.total} 条${searchResultsRecord.knowledgeBaseInfo?.matchedCount ? `，知识库匹配 ${searchResultsRecord.knowledgeBaseInfo.matchedCount} 条` : ""}`,
        dimensionId: dimension.id,
        dimensionName: dimension.name,
        progress: 10,
        modelId,
        searchResults: searchResultsRecord,
      },
      effectiveMissionId,
    );

    // 4. 生成时间上下文
    const searchTimeRange =
      (topicConfig?.searchTimeRange as string) || undefined;
    const temporalContext: TemporalContext = {
      currentDate: getCurrentDateString(),
      freshnessRequirement: getFreshnessRequirementDescription(searchTimeRange),
    };

    this.logger.log(
      `${logPrefix} Temporal context: ${temporalContext.currentDate}, ${searchTimeRange || "default"}`,
    );

    // 5. Leader 主动搜索获取额外上下文
    const leaderAgentId = "leader-" + dimId;
    const leaderCapabilityContext: AICapabilityContext = {
      agentId: leaderAgentId,
      domain: "research",
      roleId: "research-leader",
      userId: topic.userId || undefined,
    };

    let leaderContextSummary = "";
    try {
      const leaderContext =
        await this.leaderTool.generateEnhancedPlanningContext(
          {
            topicName: topic.name,
            topicDescription: topic.description || undefined,
            dimensionName: dimension.name,
            searchTimeRange,
          },
          leaderCapabilityContext,
        );
      leaderContextSummary = leaderContext.contextSummary;
      this.logger.log(
        `${logPrefix} Leader gathered additional context: ${leaderContextSummary.length} chars`,
      );
    } catch (error) {
      this.logger.warn(
        `${logPrefix} Leader context gathering failed (non-fatal): ${error}`,
      );
    }

    // 6. 准备证据数据
    const evidenceData = this.prepareEnrichedEvidenceData(enrichedResults);
    const evidenceSummary =
      createEvidenceSummary(evidenceData) +
      (leaderContextSummary ? `\n\n## 最新背景\n${leaderContextSummary}` : "");

    const { summary: figuresSummary, figureRegistry } = buildFiguresSummary(
      evidenceData,
      false,
    );
    if (figuresSummary) {
      this.logger.log(
        `${logPrefix} Figures summary for Leader: ${figureRegistry.size} figures available`,
      );
    }

    return {
      dimensionId: dimension.id,
      dimensionName: dimension.name,
      enrichedResults,
      evidenceData: evidenceData,
      evidenceSummary,
      searchResultsRecord,
      temporalContext,
      figuresSummary,
      figureRegistry,
      leaderContextSummary,
      modelId,
      assignedTools,
      assignedSkills,
    };
  }

  /**
   * 从 URL 中提取域名
   */
  private extractDomainFromUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      return parsed.hostname;
    } catch (error) {
      this.logger.debug(`[extractDomainFromUrl] Invalid URL: ${error}`);
      return null;
    }
  }

  /**
   * 准备增强后的证据数据
   * ★ 包含完整网页内容（fullContent）
   */
  private prepareEnrichedEvidenceData(
    enrichedItems: import("../../types/research.types").EnrichedResult[],
  ): EnrichedEvidenceData[] {
    return enrichedItems.map((item, index) => ({
      id: `temp-${index}-${Date.now()}`,
      title: item.title,
      url: item.url,
      domain: item.domain || this.extractDomainFromUrl(item.url),
      snippet: item.snippet || null,
      sourceType: item.sourceType,
      publishedAt: item.publishedAt || null,
      credibilityScore: null,
      // ★ 新增：完整内容和内容来源
      fullContent: item.fullContent,
      contentSource: item.contentSource,
      extractedFigures: item.extractedFigures,
    }));
  }
}
