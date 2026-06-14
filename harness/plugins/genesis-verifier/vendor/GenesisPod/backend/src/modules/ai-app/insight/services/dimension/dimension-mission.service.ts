/**
 * Dimension Mission Service
 *
 * 维度研究的 Mission 协调器
 *
 * 核心职责：
 * 1. 调用 Leader 规划维度分析大纲
 * 2. 按照大纲创建章节任务
 * 3. 调用 Agent 写作各章节
 * 4. 调用 Leader 审核各章节（支持多轮修订）
 * 5. 调用 Leader 整合最终结果
 *
 * 解决的问题：
 * - 避免单次 LLM 调用生成超长内容导致截断
 * - 充分发挥 Leader-Agent 协作机制
 * - 支持多轮质量审核
 */

import { Injectable, Logger, Optional, Inject } from "@nestjs/common";
import { MissionContext } from "@/modules/ai-harness/facade";
import { SessionLatencyTrackerService } from "@/modules/ai-harness/facade";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import type { Cache } from "cache-manager";
import { PrismaService } from "@/common/prisma/prisma.service";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { DimensionProgressService } from "./dimension-progress.service";
import {
  DimensionStatus,
  type ResearchTopic,
  type TopicDimension,
} from "@prisma/client";
import { LeaderPlanningService } from "../core/leader/leader-planning.service";
import { LeaderReviewService } from "../core/leader/leader-review.service";
import { ResearchLeaderService } from "../core/research/research-leader.service";
import {
  SectionWriterService,
  type SectionWriteResult,
  type TemporalContext,
} from "./section-writer.service";
import { DataSourceRouterService } from "../data/data-source-router.service";
import { ResearchEventEmitterService } from "../core/research/research-event-emitter.service";
import {
  AgentActivityService,
  type ThinkingPhase,
} from "../monitoring/agent-activity.service";
import {
  type DimensionOutline,
  type SectionPlan,
  type IntegratedDimensionResult,
} from "../../types/leader.types";
import { type SearchResultsRecord } from "../../types/monitoring.types";
import { DataEnrichmentService } from "../data/data-enrichment.service";
import { LeaderToolService } from "../data/leader-tool.service";
import type {
  EvidenceData,
  DimensionAnalysisResult,
  EnrichedEvidenceData,
  GeneratedChart,
  FigureReference,
} from "../../types/research.types";
import {
  extractTrendsFromContent,
  extractChallengesFromContent,
  extractOpportunitiesFromContent,
  replaceEvidenceIds,
  validateDate,
} from "./content-analysis.utils";
import { assessCredibility } from "./credibility.utils";
import { AgentActivityType, AIModelType } from "@prisma/client";
import {
  getCurrentDateString,
  getFreshnessRequirementDescription,
  DIMENSION_RESEARCH_SYSTEM_PROMPT,
} from "../../prompts/dimension-research.prompt";
import {
  createEvidenceSummary,
  buildFiguresSummary,
  type FigureRegistryEntry,
} from "./evidence-summary.utils";
import { isValidFigureUrl } from "../../utils/sanitize-image-url.utils";
import { hintToWeightProfile } from "../../config/evidence-weight-profiles.config";
import type { EvidenceWeightProfile } from "../../types/evidence-weight-profile.types";
import {
  ContextCompressionService,
  ContextEvolutionService,
  PromptCacheCoordinatorService,
  TokenBudgetCalculatorService,
} from "@/modules/ai-harness/facade";
import {
  ChatFacade,
  ExecutionCheckpointService,
  SessionMemorySidecarService,
  type AICapabilityContext,
  type AiCallerFn,
  type EstablishedFact,
} from "@/modules/ai-harness/facade";
import { MissionObservabilityService } from "../core/mission/mission-observability.service";
import { ReportQualityGateService } from "../quality/report-quality-gate.service";
import { validateLatexDelimiters } from "@/common/utils/latex-delimiter-validator";

/**
 * 维度 Mission 执行结果
 */
export interface DimensionMissionResult {
  success: boolean;
  dimensionId: string;
  analysisResult?: DimensionAnalysisResult;
  evidenceIds: string[];
  outline?: DimensionOutline;
  sectionResults?: SectionWriteResult[];
  integratedResult?: IntegratedDimensionResult;
  error?: string;
  actualModelId?: string; // ★ 实际使用的模型
  /** V5: 提取的事实断言（用于后续验证） */
  extractedClaims?: import("../../types/research-depth.types").ExtractedClaim[];
  /** Batch 2: 跨维度事实（用于报告一致性） */
  extractedFacts?: EstablishedFact[];
  /** ★ 最终写入内容的图片数（来自 allFigureReferences） */
  figuresCount?: number;
}

export type { MissionProgress } from "./dimension-progress.service";

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
export class DimensionMissionService {
  private readonly logger = new Logger(DimensionMissionService.name);

  /**
   * ★ In-process fallback mutex（Redis 不可用时使用）
   * Key = reportId, value = pending-promise chain tail for that report.
   */
  private readonly saveEvidenceLocks = new Map<string, Promise<void>>();

  /**
   * Lazy-resolved raw ioredis client (null when Redis not configured or unavailable).
   * Accessed via `this.getRedisClient()`.
   */
  private _redisClient: unknown = undefined; // undefined = not yet resolved, null = unavailable

  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderPlanning: LeaderPlanningService,
    private readonly leaderReview: LeaderReviewService,
    private readonly leaderService: ResearchLeaderService,
    private readonly sectionWriter: SectionWriterService,
    private readonly dataSourceRouter: DataSourceRouterService,
    private readonly eventEmitter: ResearchEventEmitterService,
    private readonly agentActivity: AgentActivityService,
    private readonly dataEnrichment: DataEnrichmentService,
    private readonly leaderTool: LeaderToolService,
    // ★ Phase 2: 维度级别成本追踪（via observability）
    private readonly observability: MissionObservabilityService,
    // ★ v4: 质量门控
    private readonly qualityGate: ReportQualityGateService,
    private readonly progress: DimensionProgressService,
    // ★ Phase 5: 长研究上下文压缩
    @Optional() private readonly contextCompression?: ContextCompressionService,
    // ★ Batch 2: 跨维度事实提取
    @Optional() private readonly contextEvolution?: ContextEvolutionService,
    @Optional() private readonly chatFacade?: ChatFacade,
    // ★ Batch 3: Token 预算智能截断
    @Optional()
    private readonly tokenBudgetService?: TokenBudgetCalculatorService,
    // ★ Phase 5: Prompt cache coordinator for cache prefix sharing across dimension agents
    @Optional()
    private readonly promptCacheCoordinator?: PromptCacheCoordinatorService,
    // ★ Phase 4: Fine-grained checkpointing per section write
    @Optional()
    private readonly checkpoint?: ExecutionCheckpointService,
    // ★ Phase 7: Session memory sidecar for preserving findings across compaction
    @Optional()
    private readonly sidecar?: SessionMemorySidecarService,
    // ★ Redis 分布式锁（multi-instance 安全；Redis 不可用时自动降级到内存锁）
    @Optional()
    @Inject(CACHE_MANAGER)
    private readonly cacheManager?: Cache,
    @Optional()
    private readonly latencyTracker?: SessionLatencyTrackerService,
  ) {}

  /**
   * Minimal ioredis command interface needed for the distributed lock.
   * Avoids importing all of ioredis while keeping the call sites type-safe.
   */
  /** 时延跟踪：开始一个子 step 并返回 stepId */
  private stepStart(dimName: string, stepName: string): string | undefined {
    const ctx = MissionContext.get();
    if (!ctx?.latencySessionId || !this.latencyTracker) return undefined;
    return (
      this.latencyTracker.startStep(ctx.latencySessionId, {
        name: `${dimName}/${stepName}`,
        // 父 step = task-level step（从 MissionContext 继承）
        parentStepId: ctx.latencyPhaseId,
      }) || undefined
    );
  }

  /** 时延跟踪：用 stepId 精确结束（避免并行维度同名冲突） */
  private stepEndById(stepId: string | undefined): void {
    if (!stepId) return;
    const ctx = MissionContext.get();
    if (!ctx?.latencySessionId || !this.latencyTracker) return;
    this.latencyTracker.endStep(ctx.latencySessionId, stepId);
  }

  /**
   * 在指定 stepId 的 MissionContext 中执行异步函数
   * 确保该函数内的所有 LLM 调用归属到正确的 Step
   */
  private async runInStep<T>(
    stepId: string | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!stepId) return fn();
    const ctx = MissionContext.get();
    if (!ctx) return fn();
    return MissionContext.run({ ...ctx, latencyPhaseId: stepId }, fn);
  }

  private readonly LOCK_TTL_MS = 150_000; // must exceed Prisma tx timeout (120s)
  private readonly LOCK_RETRY_MS = 200;
  private readonly LOCK_MAX_WAIT_MS = 60_000;
  private readonly LOCK_LUA = `if redis.call("get",KEYS[1])==ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end`;

  /**
   * Returns the raw ioredis client if Redis is configured and the connection is live,
   * otherwise null. Lazily resolved on first call and cached.
   */
  private getRedisClient(): {
    set(
      key: string,
      value: string,
      nx: "NX",
      px: "PX",
      ttl: number,
    ): Promise<"OK" | null>;
    eval(
      script: string,
      numkeys: number,
      key: string,
      arg: string,
    ): Promise<unknown>;
  } | null {
    if (this._redisClient === undefined) {
      try {
        const cm = this.cacheManager as unknown as {
          stores?: Array<{ client?: unknown }>;
          store?: { client?: unknown };
        };
        const store = cm?.stores?.[0] ?? cm?.store;
        const client = (store as { client?: unknown } | undefined)?.client;
        type LockClient = ReturnType<typeof this.getRedisClient>;
        this._redisClient =
          client &&
          typeof (client as NonNullable<LockClient>).set === "function" &&
          typeof (client as NonNullable<LockClient>).eval === "function"
            ? (client as NonNullable<LockClient>)
            : null;
      } catch {
        this._redisClient = null;
      }
    }
    return this._redisClient as ReturnType<typeof this.getRedisClient>;
  }

  /**
   * Runs fn exclusively for reportId — serializes concurrent saveEvidence calls so
   * citationIndex is assigned without race conditions across parallel dimensions.
   *
   * Strategy:
   * - Redis available → distributed lock via SET NX PX (safe across multiple instances)
   * - Redis unavailable or error → in-process promise-chain mutex (safe within single instance)
   */
  private withReportLock<T>(
    reportId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const redis = this.getRedisClient();
    if (redis) {
      return this.withRedisLock(reportId, fn);
    }
    return this.withInProcessLock(reportId, fn);
  }

  /**
   * Redis distributed lock using SET NX PX.
   * TTL = 150s (> Prisma tx timeout 120s) to ensure the lock outlives fn().
   * Spins with 200ms intervals (max 60s wait) before fail-open.
   * Falls back to in-process lock on transient Redis errors.
   * Releases atomically via Lua to guard against TTL-expired token mismatch.
   */
  private async withRedisLock<T>(
    reportId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const redis = this.getRedisClient()!; // caller (withReportLock) already verified non-null
    const lockKey = `lock:citation-index:${reportId}`;
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const started = Date.now();

    // Spin-acquire
    while (true) {
      try {
        const acquired = await redis.set(
          lockKey,
          token,
          "NX",
          "PX",
          this.LOCK_TTL_MS,
        );
        if (acquired === "OK") break;
      } catch (err) {
        // Transient Redis error → fall back to in-process lock
        this.logger.warn(
          `[withRedisLock] Redis error during acquire for reportId=${reportId}, falling back to in-process lock: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
        return this.withInProcessLock(reportId, fn);
      }
      if (Date.now() - started > this.LOCK_MAX_WAIT_MS) {
        this.logger.warn(
          `[withRedisLock] Timeout waiting for lock on reportId=${reportId}, proceeding without lock (fail-open)`,
        );
        break;
      }
      await new Promise<void>((r) => setTimeout(r, this.LOCK_RETRY_MS));
    }

    try {
      return await fn();
    } finally {
      // Atomic release: only delete our own token
      try {
        await redis.eval(this.LOCK_LUA, 1, lockKey, token);
      } catch (err) {
        this.logger.warn(
          `[withRedisLock] Failed to release lock for reportId=${reportId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * In-process promise-chain mutex (fallback when Redis is unavailable).
   * Guarantees sequential execution within a single Node.js process.
   */
  private withInProcessLock<T>(
    reportId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const prev = this.saveEvidenceLocks.get(reportId) ?? Promise.resolve();
    let resolveCurrent!: () => void;
    const current = new Promise<void>((r) => (resolveCurrent = r));
    this.saveEvidenceLocks.set(reportId, current);
    const result = prev.then(fn).finally(resolveCurrent);
    void result.finally(() => {
      if (this.saveEvidenceLocks.get(reportId) === current) {
        this.saveEvidenceLocks.delete(reportId);
      }
    });
    return result;
  }

  /**
   * ★ v4: 清空全局 URL 抓取缓存（每次报告生成前调用）
   */
  clearEvidenceCache(): void {
    this.dataEnrichment.clearFetchCache();
  }

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
  ): Promise<SearchPhaseResult> {
    const dimId = dimension.id.slice(0, 8);
    const logPrefix = `[Dimension:${dimension.name}:${dimId}]`;

    this.logger.log(
      `${logPrefix} Starting search phase (topicId=${topic.id.slice(0, 8)})${modelId ? `, model: ${modelId}` : ""}`,
    );

    // Update dimension status to RESEARCHING
    await this.progress.updateDimensionStatus(
      dimension.id,
      DimensionStatus.RESEARCHING,
    );

    const researcherAgentId = `researcher_${dimId}`;
    const researcherAgentName = "研究员";
    const effectiveMissionId = missionId || dimension.id;

    // Suppress unused variable warnings - these are used in the search phase
    void researcherAgentId;
    void researcherAgentName;

    // 1. 获取搜索结果
    void this.progress.emitProgress(
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
      modelId,
    });

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

    // 2. 数据增强
    const topicConfig = topic.topicConfig as Record<string, unknown> | null;

    // ★ v4: 二轮迭代搜索 — 从第一轮结果提取关键术语，构造补充搜索
    // quick 模式跳过二轮搜索，standard/thorough 默认启用
    const depthMode = (topicConfig?.depthMode as string) || "standard";
    const enableSecondRound =
      topicConfig?.enableSecondRoundSearch !== false && depthMode !== "quick";
    if (enableSecondRound && searchResult.items.length > 0) {
      try {
        // 从第一轮结果提取关键实体/术语
        const extractedTerms = this.extractKeyTermsFromResults(
          searchResult.items.slice(0, 10),
          dimension.name,
        );

        if (extractedTerms.length > 0) {
          this.logger.log(
            `${logPrefix} [v4] Second-round search: extracted ${extractedTerms.length} key terms: ${extractedTerms.slice(0, 5).join(", ")}`,
          );

          // 构造补充搜索查询
          const supplementaryQueries = extractedTerms
            .slice(0, 3)
            .map((term) => `${dimension.name} ${term}`);

          // 执行第二轮搜索
          const secondRoundResult =
            await this.dataSourceRouter.fetchDataForDimension(
              {
                ...dimension,
                searchQueries: supplementaryQueries,
              } as typeof dimension,
              topic,
              { assignedTools, assignedSkills },
            );

          // 合并去重
          const existingUrls = new Set(
            searchResult.items.map((item) => item.url).filter(Boolean),
          );
          const newItems = secondRoundResult.items.filter(
            (item) => item.url && !existingUrls.has(item.url),
          );

          if (newItems.length > 0) {
            searchResult.items.push(...newItems);
            this.logger.log(
              `${logPrefix} [v4] Second-round added ${newItems.length} new sources (total: ${searchResult.items.length})`,
            );
          } else {
            this.logger.log(
              `${logPrefix} [v4] Second-round found no new sources`,
            );
          }
        }
      } catch (error) {
        this.logger.warn(
          `${logPrefix} [v4] Second-round search failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.logger.log(
      `${logPrefix} Search completed: ${searchResult.items.length} sources found`,
    );

    const enrichmentTopN = (topicConfig?.enrichmentTopN as number) || 20;
    const enrichmentMaxLength =
      (topicConfig?.enrichmentMaxLength as number) || 6000;
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
      sources: enrichedResults.slice(0, 30).map((item) => {
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

        // Look up scores from fusion scoredItems
        const scoredEntry = searchResult.scoredItems?.find(
          (s) => s.item.url === item.url,
        );

        return {
          title: item.title || "未知标题",
          url: item.url || "",
          domain: item.domain,
          sourceType: String(item.sourceType),
          publishedDate,
          credibilityScore: scoredEntry
            ? Math.round(scoredEntry.credibilityScore * 100)
            : undefined,
          relevanceScore: scoredEntry
            ? Math.round(scoredEntry.relevanceScore * 100)
            : undefined,
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

    // ★ EVENT 类型：将锚定文章作为一级证据注入（前置到最前面）
    if (
      topic.type === "EVENT" &&
      topic.topicConfig &&
      typeof topic.topicConfig === "object"
    ) {
      const topicConfig = topic.topicConfig as Record<string, unknown>;
      if (topicConfig.sourceContent || topicConfig.sourceUrl) {
        const { buildAnchorEvidence } =
          await import("../../utils/event-source-parser.utils");
        const anchorEvidence = buildAnchorEvidence(topicConfig);
        evidenceData.unshift(anchorEvidence as unknown as EnrichedEvidenceData);
        this.logger.log(
          `${logPrefix} [EVENT] Injected anchor evidence: "${anchorEvidence.title}" (${anchorEvidence.fullContent.length} chars)`,
        );
      }
    }

    // ★ 诊断：记录证据数据的实际大小
    const evidenceDataTotalChars = evidenceData.reduce((sum, e) => {
      return (
        sum +
        (e.title?.length || 0) +
        (e.fullContent?.length || 0) +
        (e.snippet?.length || 0) +
        (e.url?.length || 0)
      );
    }, 0);
    this.logger.log(
      `${logPrefix} Evidence data prepared: ${evidenceData.length} items, total ~${evidenceDataTotalChars} chars` +
        ` (largest: ${evidenceData.reduce((max, e) => Math.max(max, (e.fullContent?.length || 0) + (e.snippet?.length || 0)), 0)} chars)`,
    );

    let evidenceSummary =
      createEvidenceSummary(evidenceData) +
      (leaderContextSummary ? `\n\n## 最新背景\n${leaderContextSummary}` : "");

    // ★ 诊断：记录 evidenceSummary 初始大小（在压缩前）
    this.logger.log(
      `${logPrefix} Evidence summary initial size: ${evidenceSummary.length} chars (~${Math.ceil(evidenceSummary.length / 4)} tokens est.)`,
    );

    // ★ Phase 5: 长上下文压缩 — 超过 8000 字符时智能摘要
    if (this.contextCompression && evidenceSummary.length > 8000) {
      try {
        this.logger.log(
          `${logPrefix} Evidence summary too long (${evidenceSummary.length} chars), compressing to ~4000`,
        );
        const compressed = await this.contextCompression.compress(
          evidenceSummary,
          { targetSize: 4000, summaryStyle: "detailed" },
        );
        evidenceSummary = compressed.compressedContext;
        this.logger.log(
          `${logPrefix} Compressed evidence summary: ${compressed.stats.originalLength} → ${compressed.stats.compressedLength} chars`,
        );
      } catch (err) {
        this.logger.warn(
          `${logPrefix} Context compression failed (non-fatal), using original: ${err instanceof Error ? err.message : String(err)}`,
        );
        // fallback: 保持原始文本
      }
    } else if (!this.contextCompression && evidenceSummary.length > 8000) {
      this.logger.debug(
        "[Degraded] ContextCompressionService unavailable, skipping evidence compression",
      );
    }

    // ★ Batch 3: TokenBudgetCalculatorService — 当 ContextCompression 不可用时的后备截断
    if (this.tokenBudgetService && evidenceSummary.length > 8000) {
      try {
        evidenceSummary = this.tokenBudgetService.smartTruncate(
          evidenceSummary,
          Math.floor(8000 * 1.5), // token estimation
        );
        this.logger.log(
          `${logPrefix} TokenBudget truncated evidence summary to ${evidenceSummary.length} chars`,
        );
      } catch (e) {
        this.logger.debug(
          `TokenBudgetCalculatorService truncation failed: ${e}`,
        );
      }
    } else if (!this.tokenBudgetService && evidenceSummary.length > 8000) {
      this.logger.debug(
        "[Degraded] TokenBudgetCalculatorService unavailable, evidence summary may exceed token budget",
      );
    }

    // ★ 硬截断兜底：当 ContextCompression 和 TokenBudgetCalculatorService 都不可用时，
    // 必须强制截断，防止 916K+ token 的 prompt 发送给 LLM 导致截断/超时/费用爆炸
    const HARD_TRUNCATE_LIMIT = 12000;
    if (evidenceSummary.length > HARD_TRUNCATE_LIMIT) {
      this.logger.warn(
        `${logPrefix} Evidence summary still too long after compression pipeline (${evidenceSummary.length} chars), hard truncating to ${HARD_TRUNCATE_LIMIT}`,
      );
      evidenceSummary =
        evidenceSummary.slice(0, HARD_TRUNCATE_LIMIT) +
        "\n\n[... 内容已截断，完整证据请参考原始搜索结果 ...]";
    }

    // ★ 诊断：记录 evidenceSummary 最终大小（压缩/截断后）
    this.logger.log(
      `${logPrefix} Evidence summary final size: ${evidenceSummary.length} chars (~${Math.ceil(evidenceSummary.length / 4)} tokens est.)`,
    );

    const { summary: figuresSummary, figureRegistry } =
      buildFiguresSummary(evidenceData);
    if (figuresSummary) {
      this.logger.log(
        `${logPrefix} Figures summary for Leader: ${figureRegistry.size} figures available, ${figuresSummary.length} chars`,
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
   * 执行维度研究 Mission
   *
   * 完整流程：
   * 1. Leader 规划大纲
   * 2. Agent 写作各章节（可并行）
   * 3. Leader 审核各章节（多轮修订）
   * 4. Leader 整合最终结果
   *
   * @param topic 研究专题
   * @param dimension 研究维度
   * @param reportId 报告ID（可选，用于关联证据）
   * @param missionId 任务ID（可选，用于持久化团队消息）
   * @param modelId ★ Leader 分配给此维度研究员的模型 ID（实现多元化）
   * @param taskId ★ 研究任务ID（可选，用于前端精确匹配进度更新）
   * @returns Mission 执行结果
   */
  async executeDimensionMission(
    topic: ResearchTopic,
    dimension: TopicDimension,
    reportId?: string,
    missionId?: string,
    modelId?: string,
    taskId?: string,
    assignedTools?: string[], // ★ Leader 分配的工具
    assignedSkills?: string[], // ★ Leader 分配的技能
    maxRevisionRounds?: number, // V5: 最大修订轮次（来自 depthConfig）
  ): Promise<DimensionMissionResult> {
    // ★ 统一日志前缀，便于区分不同维度的 Agent
    const dimId = dimension.id.slice(0, 8);
    const logPrefix = `[Dimension:${dimension.name}:${dimId}]`;

    this.logger.log(
      `${logPrefix} Starting mission (topicId=${topic.id.slice(0, 8)}, reportId=${reportId || "NONE"})${modelId ? `, model: ${modelId}` : ""}`,
    );

    // ★ 更新维度状态为 RESEARCHING
    await this.progress.updateDimensionStatus(
      dimension.id,
      DimensionStatus.RESEARCHING,
    );

    const leaderAgentId = "leader-" + dimId;
    const leaderAgentName = "研究组长";
    const effectiveMissionId = missionId || dimension.id;

    // ★ Phase 5: Create frozen cache prefix once for this mission so all subagent LLM calls
    // share identical system-prompt bytes → Anthropic prompt cache hit rate ≥ 98%.
    if (
      this.promptCacheCoordinator &&
      !this.promptCacheCoordinator.hasPrefix(effectiveMissionId)
    ) {
      this.promptCacheCoordinator.createPrefix(
        effectiveMissionId,
        DIMENSION_RESEARCH_SYSTEM_PROMPT,
        [], // no function-calling tools at this layer
      );
    }

    try {
      // V5: Literature baseline scan (standard/thorough only)
      if (maxRevisionRounds !== undefined && maxRevisionRounds > 0) {
        try {
          this.logger.log(
            `${logPrefix} [V5] Running literature baseline scan before search`,
          );
          await this.dataSourceRouter.scanLiteratureBaseline(topic, dimension);
          this.logger.log(
            `${logPrefix} [V5] Literature baseline scan complete`,
          );
        } catch (error) {
          this.logger.warn(
            `${logPrefix} [V5] Literature baseline scan failed (non-fatal): ${error}`,
          );
        }
      }

      // Phase 1: 执行搜索阶段
      const searchStepId = this.stepStart(dimension.name, "搜索数据");
      const searchPhaseResult = await this.runInStep(searchStepId, () =>
        this.executeSearchPhase(
          topic,
          dimension,
          missionId,
          modelId,
          taskId,
          assignedTools,
          assignedSkills,
        ),
      );

      this.stepEndById(searchStepId);

      // Phase 2: Leader 本地规划大纲（非全局协调）
      const outlineStepId = this.stepStart(dimension.name, "大纲规划");
      // 发送 Leader 思考事件 - 理解阶段
      await this.eventEmitter.emitLeaderThinking(topic.id, {
        missionId: missionId || dimension.id,
        phase: "understanding",
        content: `正在理解研究主题「${topic.name}」的需求，分析维度「${dimension.name}」的研究范围...`,
        progress: 10,
      });

      void this.progress.emitProgress(
        topic.id,
        dimension.name,
        {
          stage: "planning",
          sectionsTotal: 0,
          sectionsCompleted: 0,
          message: "Leader 正在规划研究大纲...",
        },
        missionId,
        undefined,
        taskId,
      );

      await this.agentActivity.startThinkingPhase({
        topicId: topic.id,
        missionId: effectiveMissionId,
        dimensionId: dimension.id,
        dimensionName: dimension.name,
        agentId: leaderAgentId,
        agentName: leaderAgentName,
        agentRole: "leader",
        activityType: AgentActivityType.PLANNING,
        phase: "planning",
        content: `正在规划维度「${dimension.name}」的研究大纲...`,
        progress: 0,
        thinkingPhase: "understanding" as ThinkingPhase,
        thinkingContent: `分析研究主题：${topic.name}\n维度：${dimension.name}\n参考资料数量：${searchPhaseResult.evidenceSummary.split("\n").length} 条`,
      });

      // 查询当前 mission 的所有维度（含 NULL 模板）传给 Leader 避免跨维度重复
      // 限定 scope 防止读到旧 mission 的 dim 误判"已研究"
      const allDimensions = await this.prisma.topicDimension.findMany({
        where: {
          topicId: topic.id,
          OR: [{ missionId: dimension.missionId }, { missionId: null }],
        },
        select: { name: true, description: true },
      });

      const outline = await this.runInStep(outlineStepId, () =>
        this.leaderPlanning.planDimensionOutline(
          {
            name: topic.name,
            type: topic.type,
            description: topic.description,
            language: topic.language,
          },
          {
            name: dimension.name,
            description: dimension.description,
            searchQueries: dimension.searchQueries,
          },
          searchPhaseResult.evidenceSummary,
          searchPhaseResult.figuresSummary || undefined,
          allDimensions,
        ),
      );

      this.logger.log(
        `${logPrefix} Local outline planned: ${outline.sections.length} sections`,
      );

      this.stepEndById(outlineStepId);

      // Phase 3: 执行写作阶段
      const writingStepId = this.stepStart(dimension.name, "写作与审核");
      const writingResult = await this.runInStep(writingStepId, () =>
        this.executeWritingPhase(
          topic,
          dimension,
          searchPhaseResult,
          outline,
          reportId,
          missionId,
          modelId,
          taskId,
          assignedTools,
          assignedSkills,
          undefined, // validationContext
          maxRevisionRounds, // V5: 最大修订轮次
        ),
      );

      this.stepEndById(writingStepId);

      return writingResult;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        `${logPrefix} Mission FAILED: ${errorMessage}`,
        error instanceof Error ? error.stack : error,
      );

      // ★ 更新维度状态为 FAILED
      await this.progress.updateDimensionStatus(
        dimension.id,
        DimensionStatus.FAILED,
      );

      void this.progress.emitProgress(
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
        taskId, // ★ 传递 taskId
      );

      return {
        success: false,
        dimensionId: dimension.id,
        evidenceIds: [],
        error: errorMessage,
      };
    } finally {
      // ★ Phase 5: Release frozen cache prefix after mission completes (success or failure)
      this.promptCacheCoordinator?.releasePrefix(effectiveMissionId);
    }
  }

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
    _assignedTools?: string[], // Prefixed with _ to indicate intentionally unused
    assignedSkills?: string[], // ★ Leader 分配的技能（传递到 chatWithSkills）
    validationContext?: string, // V5: 验证上下文
    maxRevisionRounds?: number, // V5: 最大修订轮次（来自 depthConfig）
  ): Promise<DimensionMissionResult> {
    const dimId = dimension.id.slice(0, 8);
    const logPrefix = `[Dimension:${dimension.name}:${dimId}]`;

    this.logger.log(
      `${logPrefix} Starting writing phase with global outline (${outline.sections.length} sections)${assignedSkills?.length ? `, skills: [${assignedSkills.join(", ")}]` : ""}`,
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
      void this.progress.emitProgress(
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
        modelId,
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
        validationContext, // V5
        maxRevisionRounds, // V5
        topic.language, // Language setting
        assignedSkills, // ★ Leader 分配的技能
        topic.type, // ★ 类型感知质量检查
        searchPhaseResult.figureRegistry, // ★ 图表注册表
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
      void this.progress.emitProgress(
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
          topic.language,
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

      // ★ Calculate paragraph offset per section so figure positions become global
      // Uses the same paragraph boundary definition as injectChartsByPosition:
      // a non-empty line followed by a blank line (or end of text), excluding
      // code fences and table separator rows.
      const countParagraphBoundaries = (text: string): number => {
        const lines = text.split("\n");
        let count = 0;
        for (let i = 0; i < lines.length; i++) {
          const trimmed = lines[i].trim();
          if (!trimmed) continue;
          if (trimmed.startsWith("```")) continue;
          if (/^[\|\s\-:]+$/.test(trimmed) && trimmed.includes("-")) continue;
          const nextLine = lines[i + 1];
          if (nextLine === undefined || nextLine.trim() === "") count++;
        }
        return count;
      };
      const sectionParagraphCounts = sectionResults.map((r) =>
        countParagraphBoundaries(`### ${r.title}\n\n${r.content}`),
      );

      let paragraphOffset = 0;
      const allFigureReferencesRaw = sectionResults.flatMap((r, sectionIdx) => {
        const offset = paragraphOffset;
        paragraphOffset += sectionParagraphCounts[sectionIdx];

        return (r.figureReferences || []).map((fig) => ({
          ...fig,
          // ★ Prefix id with section index to avoid cross-section id collisions
          id:
            fig.id && String(fig.id).startsWith(`s${sectionIdx}-`)
              ? String(fig.id)
              : `s${sectionIdx}-${fig.id || "fig"}`,
          // ★ Convert section-local paragraph position to dimension-global
          position: (() => {
            const pos = fig.position ?? "";
            if (/after_paragraph_(\d+)/i.test(pos)) {
              return pos.replace(
                /after_paragraph_(\d+)/i,
                (_: string, n: string) =>
                  `after_paragraph_${parseInt(n, 10) + offset}`,
              );
            }
            if (/end_of_section/i.test(pos)) {
              // Convert to last paragraph of this section
              return `after_paragraph_${offset + sectionParagraphCounts[sectionIdx]}`;
            }
            return pos;
          })(),
        }));
      });
      // ★ Dedup by figureId (preferred) or imageUrl fallback — preserve one ref per figure
      const seenFigKeys = new Set<string>();
      const allFigureReferences = allFigureReferencesRaw.filter((fig) => {
        if (!fig.imageUrl) return false;
        // Use figureId as the dedup key when available, otherwise fall back to imageUrl
        const key = fig.figureId || fig.imageUrl;
        if (seenFigKeys.has(key)) return false;
        seenFigKeys.add(key);
        return true;
      });
      this.logger.log(
        `${logPrefix} Charts from sections: ${allFigureReferences.length} refs, ${allGeneratedCharts.length} generated`,
      );

      // 4.5 ★ 确定性填充 figureReference.source — 用 evidenceCitationIndex 回查证据标题
      // 必须在 saveEvidence/indexMapping 之前执行：此时 evidenceCitationIndex 仍是 promptIndex（1-based），
      // 与 evidenceData 数组下标一致（promptIndex - 1）。saveEvidence 后 index 会被重映射为 DB citationIndex。
      const evidenceData = searchPhaseResult.evidenceData;
      for (const ref of allFigureReferences) {
        if (ref.source) continue; // LLM 已输出 source 的不覆盖
        const promptIdx = ref.evidenceCitationIndex; // 1-based
        if (
          promptIdx !== undefined &&
          promptIdx >= 1 &&
          promptIdx <= evidenceData.length
        ) {
          const evidence = evidenceData[promptIdx - 1];
          if (evidence) {
            ref.source = evidence.title || evidence.domain || evidence.url;
          }
        }
      }

      // 5. 保存证据到数据库并替换临时ID
      let savedEvidenceIds: string[] = [];
      let finalIntegratedResult = integratedResult;
      this.logger.log(
        `${logPrefix} Saving evidence: ${searchPhaseResult.evidenceData.length} items, reportId=${reportId || "NONE"}`,
      );
      if (reportId) {
        // ★ Serialize per-reportId: prevents concurrent dimensions from racing on
        // citationIndex assignment (aggregate max → createMany has no atomicity guarantee
        // when multiple dimensions call saveEvidence in parallel for the same report).
        const { savedIds, indexMapping } = await this.withReportLock(
          reportId,
          () => this.saveEvidence(searchPhaseResult.evidenceData, reportId),
        );
        savedEvidenceIds = savedIds;
        this.logger.log(
          `${logPrefix} Evidence saved: ${savedIds.length} items`,
        );

        if (indexMapping.size > 0) {
          finalIntegratedResult = {
            ...integratedResult,
            content: replaceEvidenceIds(integratedResult.content, indexMapping),
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
      } else {
        // ★ 警告：没有 reportId，证据不会被保存到数据库
        // 这会导致参考文献标签为空！
        this.logger.warn(
          `${logPrefix} ⚠️ reportId is undefined! ${searchPhaseResult.evidenceData.length} evidences will NOT be saved. ` +
            `This will result in empty References tab. ` +
            `Ensure executeDimensionMission is called with reportId.`,
        );
      }

      // 6. 转换为标准结果格式
      const analysisResult = this.convertToAnalysisResult(
        dimension.id,
        finalIntegratedResult,
        savedEvidenceIds,
        allFigureReferences,
        allGeneratedCharts,
      );

      // 7. 更新维度状态为 COMPLETED
      await this.progress.updateDimensionStatus(
        dimension.id,
        DimensionStatus.COMPLETED,
        { lastResearchedAt: new Date() },
      );
      this.logger.log(`${logPrefix} Status updated to COMPLETED`);

      // 8. 完成
      void this.progress.emitProgress(
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

      // ★ Phase 4: Checkpoint after writing phase
      if (this.checkpoint && effectiveMissionId) {
        this.checkpoint.save({
          executionId: effectiveMissionId,
          iteration: sectionResults.length,
          messages: [],
          toolResults: sectionResults.map((r) => ({
            toolId: r.title ?? "section",
            result: r.content?.slice(0, 200),
          })),
          tokenUsage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            totalTokens: 0,
            callCount: sectionResults.length,
          },
          timestamp: new Date(),
        });
      }

      // ★ Phase 7: Record dimension findings in sidecar
      if (this.sidecar) {
        const sidecarId = effectiveMissionId ?? dimension?.id ?? "unknown";
        for (const sr of sectionResults) {
          if (sr.content && sr.content.length > 100) {
            this.sidecar.addEntry(sidecarId, {
              timestamp: new Date(),
              category: "finding",
              content: (sr.title ?? "") + ": " + sr.content.slice(0, 200),
              dimensionName: dimension?.name,
            });
          }
        }
      }

      // ★ 提取最后一个章节的实际模型ID
      const lastActualModel = sectionResults
        .map((r) => r.actualModelId)
        .filter(Boolean)
        .pop();

      // ★ Phase 2: CostAttribution — 维度级别成本追踪
      this.observability.recordResearchCost(
        topic.userId,
        dimension.name,
        lastActualModel || modelId || "",
        "",
        0,
        0,
        0,
      );

      // ★ Batch 2: 从维度研究结果中提取跨维度事实
      let extractedFacts: EstablishedFact[] | undefined;
      if (
        this.contextEvolution &&
        this.chatFacade &&
        analysisResult?.detailedContent
      ) {
        try {
          const aiCaller: AiCallerFn = async (_model, messages, options) => {
            const resp = await this.chatFacade!.chat({
              messages,
              modelType: AIModelType.CHAT,
              taskProfile: options?.taskProfile ?? {
                creativity: "deterministic",
                outputLength: "medium",
              },
            });
            return { content: resp.content, tokensUsed: resp.tokensUsed ?? 0 };
          };
          const factResult = await this.contextEvolution.extractFacts(
            {
              taskId: dimension.id,
              taskTitle: dimension.name,
              taskOutput: analysisResult.detailedContent.slice(0, 10000),
            },
            aiCaller,
          );
          extractedFacts = factResult.facts;
          this.logger.log(
            `${logPrefix} Extracted ${factResult.facts.length} cross-dimension facts`,
          );
        } catch (err) {
          this.logger.warn(
            `${logPrefix} Fact extraction failed (non-fatal): ${err instanceof Error ? err.message : err}`,
          );
        }
      } else if (!this.contextEvolution || !this.chatFacade) {
        this.logger.debug(
          `[Degraded] ${!this.contextEvolution ? "ContextEvolutionService" : "ChatFacade"} unavailable, skipping cross-dimension fact extraction`,
        );
      }

      return {
        success: true,
        dimensionId: dimension.id,
        analysisResult,
        evidenceIds: savedEvidenceIds,
        outline,
        sectionResults,
        integratedResult: finalIntegratedResult,
        actualModelId: lastActualModel, // ★ 记录实际使用的模型
        extractedClaims, // V5: 提取的事实断言
        extractedFacts, // Batch 2: 跨维度事实
        figuresCount: allFigureReferences.length, // ★ 最终写入内容的图片数
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        `${logPrefix} Writing phase FAILED: ${errorMessage}`,
        error instanceof Error ? error.stack : error,
      );

      await this.progress.updateDimensionStatus(
        dimension.id,
        DimensionStatus.FAILED,
      );

      void this.progress.emitProgress(
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
    modelId?: string, // ★ Leader 分配的模型
    temporalContext?: TemporalContext, // ★ 时间上下文
    taskId?: string, // ★ 研究任务ID（用于前端精确匹配进度更新）
    validationContext?: string, // V5: 验证上下文
    _maxRevisionRounds?: number, // V5: 最大修订轮次（v4 已替换为质量门控，保留参数向上兼容）
    topicLanguage?: string | null, // Language setting for review
    assignedSkills?: string[], // ★ Leader 分配的技能（注入到 chatWithSkills）
    topicType?: string, // ★ 类型感知质量检查
    figureRegistry?: Map<string, FigureRegistryEntry>, // ★ 图表注册表
  ): Promise<SectionWriteResult[]> {
    const sectionResults: SectionWriteResult[] = [];
    const sectionMap = new Map<string, SectionWriteResult>();

    // ★ 统一日志前缀
    const dimId = dimension.id.slice(0, 8);
    const logPrefix = `[Dimension:${dimension.name}:${dimId}]`;

    // ★ 动态证据权重：Leader evidenceWeightHint → 数值 profile
    const weightProfile = outline.evidenceWeightHint
      ? hintToWeightProfile(outline.evidenceWeightHint)
      : undefined;
    if (weightProfile) {
      this.logger.log(
        `${logPrefix} [EvidenceWeight] Applied: preferredSources=[${outline.evidenceWeightHint!.preferredSources.join(",")}] freshness=${outline.evidenceWeightHint!.freshnessSensitivity} reason="${outline.evidenceWeightHint!.reason}"`,
      );
    }

    // 按并行组执行
    for (const group of outline.executionPlan.parallelGroups) {
      this.logger.log(
        `${logPrefix} Writing group: ${group.join(", ")}${modelId ? ` with model: ${modelId}` : ""}`,
      );

      // 获取当前组的章节
      const groupSections = outline.sections.filter((s) =>
        group.includes(s.id),
      );

      // ★ v3.1: 跨 section 多样性分配 evidence
      // 先为所有 section 分配相关 evidence，然后补充未被选中的 evidence 到各 section
      const sectionEvidenceMap = this.distributeDiverseEvidence(
        groupSections,
        evidenceData,
        weightProfile,
      );

      // 并行写作
      const writeInputs = groupSections.map((section) => ({
        section,
        evidenceData:
          sectionEvidenceMap.get(section.id) ||
          this.filterEvidenceForSection(section, evidenceData, weightProfile),
        previousSections: this.getPreviousSections(
          section,
          sectionMap,
          outline,
        ),
        missionId, // ★ 传递 missionId
        modelId, // ★ 传递模型
        temporalContext, // ★ 传递时间上下文
        allocatedFigures: section.allocatedFigures, // ★ 传递 Leader 预分配的图表
        validationContext, // V5: inject validation context
        topicLanguage, // ★ 传递语言设置
        assignedSkills, // ★ Leader 分配的任务级技能
        figureRegistry, // ★ 图表注册表（用于 backfillFigureUrls）
      }));

      // ★ 发送研究员开始写作事件
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

        // ★ 后处理：清理 SectionWriter 输出中的结构问题
        if (result.content) {
          result = {
            ...result,
            content: this.cleanSectionOutput(result.content),
          };
          groupResults[i] = result;
        }

        // ★ 发送研究员章节完成事件
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
          topicLanguage || "zh",
          topicType,
        );

        if (qc.wasAutoFixed) {
          result = { ...result, content: qc.fixedContent };
          this.logger.log(
            `${logPrefix} [QualityGate] Auto-fixed section "${section.title}": ${qc.violations.map((v) => v.rule).join(", ")}`,
          );
        }

        // ★ 2026-04-17: LaTeX delimiter validation at LLM boundary.
        // Source-level check replaces the old downstream regex patch pipeline
        // (Phase -0.3 etc.). When malformed, append repair hint to the
        // rewriteGuidance so the existing single-retry flow fixes it.
        const latexCheck = validateLatexDelimiters(result.content);
        if (!latexCheck.valid) {
          this.logger.warn(
            `${logPrefix} [LatexValidator] Section "${section.title}" has ${latexCheck.issues.length} LaTeX issue(s): ${latexCheck.issues
              .slice(0, 3)
              .map((i) => i.kind)
              .join(", ")}${latexCheck.issues.length > 3 ? "..." : ""}`,
          );
          qc.passed = false;
          qc.rewriteGuidance.push(latexCheck.repairHint);
        }

        // ★ 记录质量门控结果到 Activity
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

        // 如果有需要 AI 重写的问题（如语言混杂、内容过短、LaTeX 定界错乱），发送 1 次修订请求
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
              topicLanguage,
              assignedSkills,
            });

            // 对修改后的内容再次运行质量门控（仅自动修复，不再重写）
            const qc2 = this.qualityGate.validateDimensionContent(
              rewrittenResult.content,
              topicLanguage || "zh",
              topicType,
            );
            result = {
              ...rewrittenResult,
              content: qc2.wasAutoFixed
                ? qc2.fixedContent
                : rewrittenResult.content,
            };

            // ★ LaTeX validator also runs after revise. If LLM still
            //   emits bad delimiters, at least we log it here — the
            //   content still ships (fallbacks: assembler post-process
            //   + frontend KaTeX graceful render).
            const latexCheck2 = validateLatexDelimiters(result.content);
            if (!latexCheck2.valid) {
              this.logger.warn(
                `${logPrefix} [LatexValidator] Section "${section.title}" STILL has ${latexCheck2.issues.length} LaTeX issue(s) after revise; shipping best effort.`,
              );
            }

            this.logger.log(
              `${logPrefix} [QualityGate] Section "${section.title}" rewritten, passed=${qc2.passed}, latex=${latexCheck2.valid ? "ok" : "partial"}`,
            );
          } catch (rewriteError) {
            this.logger.warn(
              `${logPrefix} [QualityGate] Rewrite failed for "${section.title}", keeping auto-fixed content: ${rewriteError instanceof Error ? rewriteError.message : String(rewriteError)}`,
            );
          }
        }

        // 保存结果
        sectionMap.set(section.id, result);
        sectionResults.push(result);

        // 发送进度
        void this.progress.emitProgress(
          topicId,
          dimension.name,
          {
            stage: "reviewing",
            sectionsTotal: outline.sections.length,
            sectionsCompleted: sectionResults.length,
            currentSection: section.title,
            message: `已完成章节: ${section.title}`,
          },
          missionId,
          undefined,
          taskId, // ★ 传递 taskId
        );
      }
    }

    return sectionResults;
  }

  /**
   * 清理 SectionWriter 输出中的结构问题
   * - 剥离 LLM 输出中的 ### 标题（section 内不应有 ### 标题）
   * - 合并独占加粗行到下一段（**标题** 单独一行 → 和下一段合并）
   * - 删除开头的 keyPoints 列表（≤5行短列表紧跟在开头）
   */
  private cleanSectionOutput(content: string): string {
    let result = content;

    // 1. 剥离 ### 和 #### 标题 — section 内不应有这些，标题由 integrateDimensionResults 统一添加
    result = result.replace(/^#{3,4}\s+.+$/gm, "");

    // 2. 删除开头的 keyPoints 列表（连续的短列表项，每行 < 80 字符）
    const lines = result.split("\n");
    let skipUntil = 0;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue; // 跳过空行
      if (/^[-*]\s/.test(trimmed) && trimmed.length < 80) {
        skipUntil = i + 1;
      } else {
        break; // 遇到非列表行，停止
      }
    }
    if (skipUntil > 0 && skipUntil <= 6) {
      // 只删开头的短列表（最多 6 行），保留后面的内容
      result = lines.slice(skipUntil).join("\n");
    }

    // 3. 合并独占加粗行到下一段
    const blocks = result.split(/\n\n+/);
    const merged: string[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i].trim();
      if (!block) continue;
      // 检测独占加粗行: 只有一行，且整行是 **xxx**
      if (/^\*\*[^*]+\*\*[：:.]?\s*$/.test(block) && !block.includes("\n")) {
        // 和下一个非空 block 合并
        if (i + 1 < blocks.length) {
          const nextBlock = blocks[i + 1].trim();
          if (nextBlock) {
            merged.push(block + " " + nextBlock);
            i++; // 跳过下一个 block（已合并）
            continue;
          }
        }
      }
      merged.push(block);
    }
    result = merged.join("\n\n");

    // 4. 清理多余空行
    result = result.replace(/\n{3,}/g, "\n\n").trim();

    return result;
  }

  /**
   * 跨 section 多样性分配 evidence
   *
   * 确保不同 section 使用不同的 evidence，提高整个维度的引用多样性。
   * 策略：
   * 1. 每个 section 先获取 top-3 最相关的 evidence（允许共享）
   * 2. 剩余 evidence 按轮转分配给各 section（不重复）
   * 3. 每个 section 最终获得 5-8 条 evidence
   */
  private distributeDiverseEvidence(
    sections: SectionPlan[],
    evidenceData: EvidenceData[],
    weightProfile?: EvidenceWeightProfile,
  ): Map<string, EvidenceData[]> {
    const result = new Map<string, EvidenceData[]>();
    if (evidenceData.length === 0 || sections.length === 0) return result;

    // 为每条 evidence 标记 promptIndex
    const indexedEvidence = evidenceData.map((e, i) => ({
      ...e,
      promptIndex: i + 1,
    }));

    // Step 1: 每个 section 获取 top-3 最相关的（允许跨 section 共享）
    const sectionCoreEvidence = new Map<string, EvidenceData[]>();
    for (const section of sections) {
      const scored = this.scoreEvidenceForSection(
        section,
        indexedEvidence,
        weightProfile,
      );
      const top3 = scored.slice(0, 3);
      sectionCoreEvidence.set(
        section.id,
        top3.map((s) => s.evidence),
      );
    }

    // Step 2: 收集已被选为 core 的 evidence indices
    const coreIndices = new Set<number>();
    for (const core of sectionCoreEvidence.values()) {
      for (const e of core) {
        if (e.promptIndex) coreIndices.add(e.promptIndex);
      }
    }

    // Step 3: 剩余 evidence 按轮转分配（每个 section 获得独占的 evidence）
    const remaining = indexedEvidence.filter(
      (e) => !coreIndices.has(e.promptIndex),
    );
    const sectionIds = sections.map((s) => s.id);
    const extraEvidence = new Map<string, EvidenceData[]>(
      sectionIds.map((id) => [id, []]),
    );
    for (let i = 0; i < remaining.length; i++) {
      const targetSection = sectionIds[i % sectionIds.length];
      const extras = extraEvidence.get(targetSection)!;
      if (extras.length < 5) {
        // 每个 section 最多补充 5 条独占 evidence
        extras.push(remaining[i]);
      }
    }

    // Step 4: 合并 core + extra
    for (const section of sections) {
      const core = sectionCoreEvidence.get(section.id) || [];
      const extra = extraEvidence.get(section.id) || [];
      result.set(section.id, [...core, ...extra]);
    }

    this.logger.log(
      `[distributeDiverseEvidence] ${sections.length} sections, ${evidenceData.length} evidence → ${coreIndices.size} shared + ${remaining.length} distributed`,
    );

    return result;
  }

  /**
   * 为 evidence 打分（按与 section 的相关度排序）
   * ★ 支持动态权重：weightProfile 由 Leader evidenceWeightHint 派生，
   *   对不同来源类型施加乘数，并调整时效性贡献权重。
   */
  private scoreEvidenceForSection(
    section: SectionPlan,
    evidenceData: EvidenceData[],
    weightProfile?: EvidenceWeightProfile,
  ): Array<{ evidence: EvidenceData; score: number }> {
    const keywords = this.extractKeywords(
      `${section.title} ${section.keyPoints.join(" ")} ${section.description || ""}`,
    );
    if (keywords.length === 0)
      return evidenceData.map((e) => ({ evidence: e, score: 0 }));

    const now = Date.now();
    const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;
    const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;

    return evidenceData
      .map((e) => {
        const text = `${e.title || ""} ${e.snippet || ""}`.toLowerCase();
        let relevanceScore = 0;
        for (const kw of keywords) {
          if (text.includes(kw)) relevanceScore++;
        }

        let score = relevanceScore;

        if (weightProfile) {
          // 来源类型乘数
          const sourceKey = (e.sourceType ?? "").toUpperCase();
          const multiplier =
            weightProfile.sourceTypeMultipliers[sourceKey] ?? 1.0;
          score *= multiplier;

          // 时效性加成
          const publishedAt = e.publishedAt
            ? new Date(e.publishedAt).getTime()
            : null;
          if (publishedAt) {
            const age = now - publishedAt;
            const freshnessBonus =
              age <= THREE_MONTHS_MS ? 2 : age <= SIX_MONTHS_MS ? 1 : 0;
            score += freshnessBonus * weightProfile.freshnessBoostFactor;
          }
        }

        return { evidence: e, score };
      })
      .sort((a, b) => b.score - a.score);
  }

  /**
   * 过滤与 section 相关的 evidence
   *
   * ★ v3.1: 返回的 evidence 保留 promptIndex（在全量 evidenceData 中的 1-based 位置），
   * 确保不同 section 引用同一来源时使用相同的编号，避免 citation index 冲突。
   */
  private filterEvidenceForSection(
    section: SectionPlan,
    evidenceData: EvidenceData[],
    weightProfile?: EvidenceWeightProfile,
  ): EvidenceData[] {
    if (evidenceData.length <= 5) {
      // 给每条 evidence 标记全局 promptIndex
      return evidenceData.map((e, i) => ({ ...e, promptIndex: i + 1 }));
    }

    // 提取 section 关键词：标题分词 + keyPoints
    const sectionKeywords = this.extractKeywords(
      `${section.title} ${section.keyPoints.join(" ")} ${section.description || ""}`,
    );

    if (sectionKeywords.length === 0) {
      return evidenceData.map((e, i) => ({ ...e, promptIndex: i + 1 }));
    }

    const now = Date.now();
    const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;
    const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;

    // 对每条 evidence 计算相关度分数，保留原始位置
    const scored = evidenceData.map((e, index) => {
      const evidenceText = `${e.title || ""} ${e.snippet || ""}`.toLowerCase();
      let score = 0;
      for (const kw of sectionKeywords) {
        if (evidenceText.includes(kw)) {
          score++;
        }
      }

      if (weightProfile) {
        const sourceKey = (e.sourceType ?? "").toUpperCase();
        const multiplier =
          weightProfile.sourceTypeMultipliers[sourceKey] ?? 1.0;
        score *= multiplier;

        const publishedAt = e.publishedAt
          ? new Date(e.publishedAt).getTime()
          : null;
        if (publishedAt) {
          const age = now - publishedAt;
          const freshnessBonus =
            age <= THREE_MONTHS_MS ? 2 : age <= SIX_MONTHS_MS ? 1 : 0;
          score += freshnessBonus * weightProfile.freshnessBoostFactor;
        }
      }

      return { evidence: e, score, originalIndex: index };
    });

    // 按加权得分排序
    scored.sort((a, b) => b.score - a.score);

    // 保留相关度 > 0 的 evidence
    let selected = scored.filter((s) => s.score > 0);
    if (selected.length < 5) {
      // 不足 5 条时补充到 5 条
      const remaining = scored.filter((s) => s.score === 0);
      selected = [...selected, ...remaining.slice(0, 5 - selected.length)];
    }

    // ★ 保留全局 promptIndex（1-based，与 evidenceData 数组位置一致）
    return selected.map((s) => ({
      ...s.evidence,
      promptIndex: s.originalIndex + 1,
    }));
  }

  /**
   * ★ v4: 从搜索结果中提取关键术语（用于二轮迭代搜索）
   * 使用简单文本分析，不需要 LLM 调用
   */
  private extractKeyTermsFromResults(
    items: Array<{ title?: string; snippet?: string; url?: string }>,
    dimensionName: string,
  ): string[] {
    const termFrequency = new Map<string, number>();
    const dimensionWords = new Set(
      dimensionName
        .toLowerCase()
        .split(/[\s,，、]+/)
        .filter((w) => w.length > 1),
    );

    for (const item of items) {
      const text = `${item.title || ""} ${item.snippet || ""}`;

      // 提取英文多词术语（2-3 个词的短语）
      const englishTerms =
        text.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}/g) || [];
      for (const term of englishTerms) {
        const lower = term.toLowerCase();
        if (!dimensionWords.has(lower) && lower.length > 3) {
          termFrequency.set(lower, (termFrequency.get(lower) || 0) + 1);
        }
      }

      // 提取中文关键词（2-4 字的高频词）
      const chineseTerms = text.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
      for (const term of chineseTerms) {
        if (!dimensionWords.has(term) && term.length >= 2) {
          termFrequency.set(term, (termFrequency.get(term) || 0) + 1);
        }
      }

      // 提取全大写缩写词（如 GPU, LLM, API）
      const acronyms = text.match(/\b[A-Z]{2,6}\b/g) || [];
      for (const acr of acronyms) {
        const lower = acr.toLowerCase();
        if (!dimensionWords.has(lower)) {
          termFrequency.set(acr, (termFrequency.get(acr) || 0) + 1);
        }
      }
    }

    // 按频率排序，取出现 >= 2 次的术语
    return [...termFrequency.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([term]) => term);
  }

  /**
   * 从文本中提取关键词（简单分词）
   */
  private extractKeywords(text: string): string[] {
    // 移除常见停用词，按空格和标点分词
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
      .filter((w, i, arr) => arr.indexOf(w) === i); // deduplicate
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

  /**
   * 校验并清理 Leader 分配的 allocatedFigures
   * - 通过 figureRegistry 查找并回填 imageUrl（不信任 LLM 输出的 URL）
   * - 过滤 figureId 不在注册表中的条目
   * - 过滤 imageUrl 无效的条目
   * - 全局去重：确保同一图表不被分配给多个 section
   * - 关键词相关性过滤：图表 caption 必须与 section 标题/描述有交集
   * - 记录分配结果日志
   */
  private validateAllocatedFigures(
    outline: DimensionOutline,
    figureRegistry: Map<string, FigureRegistryEntry>,
  ): void {
    const usedFigureIds = new Set<string>(); // 全局去重 by figureId
    const globalSeenUrls = new Set<string>(); // 全局去重 by imageUrl
    let totalAllocated = 0;

    for (const section of outline.sections) {
      if (!section.allocatedFigures || section.allocatedFigures.length === 0) {
        continue;
      }

      const valid: typeof section.allocatedFigures = [];
      for (const fig of section.allocatedFigures) {
        // 查找注册表
        const entry = figureRegistry.get(fig.figureId);
        if (!entry) {
          this.logger.warn(
            `[validateAllocatedFigures] Section "${section.title}": figureId "${fig.figureId}" not found in registry, skipping`,
          );
          continue;
        }

        // ★ CRITICAL: 始终从注册表回填 imageUrl，不信任 LLM 输出的 URL。
        // 注册表中的 URL 来自 FigureExtractor 的 GET+Range 验证，是可信的。
        fig.imageUrl = entry.imageUrl;
        fig.caption = fig.caption || entry.caption;

        // ★ 回填后统一校验 URL 有效性（拦截 base64/PDF/伪造 URL）
        if (!isValidFigureUrl(fig.imageUrl)) {
          this.logger.warn(
            `[validateAllocatedFigures] Section "${section.title}": invalid URL for ${fig.figureId}, skipping`,
          );
          continue;
        }

        // 全局去重 (by figureId)
        if (usedFigureIds.has(fig.figureId)) {
          this.logger.warn(
            `[validateAllocatedFigures] Section "${section.title}": duplicate ${fig.figureId}, skipping`,
          );
          continue;
        }
        usedFigureIds.add(fig.figureId);

        // 全局去重 (by imageUrl — prevents same image appearing in multiple sections)
        if (globalSeenUrls.has(fig.imageUrl)) {
          this.logger.warn(
            `[validateAllocatedFigures] Section "${section.title}": duplicate imageUrl for ${fig.figureId}, skipping`,
          );
          continue;
        }
        globalSeenUrls.add(fig.imageUrl);
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

        // ★ v6.0: caption 无关键词时放行（图片已通过 Vision LLM 语义审查）
        if (allKeywords.length === 0) {
          this.logger.debug(
            `[validateAllocatedFigures] Figure with empty/generic caption "${fig.caption}" from section "${section.title}" — accepting (already passed upstream filters)`,
          );
          return true;
        }

        // ★ v8: 相关性过滤 — Leader 已做语义判断，关键词匹配仅防明显错配
        const matchedKeywords = allKeywords.filter((kw) =>
          sectionText.includes(kw),
        );

        const isRelevant = matchedKeywords.length >= 1;

        if (!isRelevant) {
          this.logger.warn(
            `[validateAllocatedFigures] Removing irrelevant figure "${fig.figureId}" (caption: "${fig.caption}") from section "${section.title}" — matchCount=${matchedKeywords.length}/${allKeywords.length}`,
          );
        }
        return isRelevant;
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
   * promptIndex 是 LLM 在 prompt 中看到的序号 (1, 2, 3...)
   * actualCitationIndex 是证据在数据库中的实际引用编号
   *
   * ★ 使用事务保证原子性：aggregate + createMany + findMany 在同一事务内
   *   防止并发写入时 citationIndex 冲突
   */
  private async saveEvidence(
    evidenceData: EvidenceData[],
    reportId: string,
  ): Promise<{
    savedIds: string[];
    idMapping: Map<string, string>;
    indexMapping: Map<number, number>; // ★ 改为 promptIndex -> actualCitationIndex
  }> {
    if (evidenceData.length === 0) {
      return { savedIds: [], idMapping: new Map(), indexMapping: new Map() };
    }

    // 评估可信度
    const evidenceWithCredibility = evidenceData.map((e) => ({
      ...e,
      credibilityScore: assessCredibility(e),
    }));

    // ★ 使用 interactive transaction 保证原子性
    // 所有操作在同一事务内，防止并发竞态
    let created: { id: string; citationIndex: number | null }[];
    let startIndex = 0; // ★ A2: hoisted so fallback query can reference it
    try {
      created = await this.prisma.$transaction(
        async (tx) => {
          // 步骤1：获取当前最大 citationIndex
          const maxIndexResult = await tx.topicEvidence.aggregate({
            where: { reportId },
            _max: { citationIndex: true },
          });
          startIndex = (maxIndexResult._max.citationIndex || 0) + 1;

          // 步骤2：批量插入（createMany 比循环插入快得多）
          await tx.topicEvidence.createMany({
            data: evidenceWithCredibility.map((evidence, i) => ({
              title: evidence.title,
              url: evidence.url,
              domain: evidence.domain,
              snippet: evidence.snippet,
              sourceType: evidence.sourceType,
              publishedAt: validateDate(evidence.publishedAt),
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
    } catch (err) {
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === "P2003"
      ) {
        this.logger.warn(
          `[saveEvidence] FK constraint violation for reportId=${reportId}: report was deleted. Skipping evidence save.`,
        );
        return { savedIds: [], idMapping: new Map(), indexMapping: new Map() };
      }
      throw err;
    }

    // ★ A2: Fallback — 如果事务返回空但有证据数据，事务外重新查询
    if (created.length === 0 && evidenceWithCredibility.length > 0) {
      this.logger.warn(
        `[saveEvidence] Transaction returned empty created array for ${evidenceWithCredibility.length} evidences. Attempting fallback query.`,
      );
      try {
        const fallbackResults = await this.prisma.topicEvidence.findMany({
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
        if (fallbackResults.length > 0) {
          created = fallbackResults;
          this.logger.log(
            `[saveEvidence] Fallback query recovered ${created.length} evidences`,
          );
        }
      } catch (fallbackErr) {
        this.logger.warn(
          `[saveEvidence] Fallback query failed: ${fallbackErr}`,
        );
      }
    }

    // 构建 tempId -> actualId 映射
    const idMapping = new Map<string, string>();
    // ★ 构建 promptIndex -> actualCitationIndex 映射
    // promptIndex 是 LLM 看到的 [1], [2], [3]...
    // actualCitationIndex 是数据库中的实际编号
    const indexMapping = new Map<number, number>();
    evidenceData.forEach((e, index) => {
      if (created[index]) {
        idMapping.set(e.id, created[index].id);
        // promptIndex = index + 1 (从1开始)
        // actualCitationIndex = created[index].citationIndex
        indexMapping.set(index + 1, created[index].citationIndex!);
      }
    });

    return { savedIds: created.map((e) => e.id), idMapping, indexMapping };
  }

  // ★ Extracted: replaceEvidenceIds, validateDate → content-analysis.utils.ts
  // ★ Extracted: assessCredibility → credibility.utils.ts

  /**
   * 转换为标准分析结果格式
   */
  private convertToAnalysisResult(
    dimensionId: string,
    integratedResult: IntegratedDimensionResult,
    evidenceIds: string[],
    figureReferences: FigureReference[] = [],
    generatedCharts: GeneratedChart[] = [],
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
      trends: extractTrendsFromContent(content),
      challenges: extractChallengesFromContent(content),
      opportunities: extractOpportunitiesFromContent(content),
      evidenceUsed: evidenceIds.length,
      confidenceLevel: integratedResult.metadata.confidenceLevel,
      detailedContent: content,
      figureReferences,
      generatedCharts,
    };
  }

  // ★ Extracted: extractTrendsFromContent, extractChallengesFromContent,
  //   extractOpportunitiesFromContent, extractSectionItems, extractFromHeaders,
  //   extractFromBoldPatterns, extractFromSentences → content-analysis.utils.ts
}
