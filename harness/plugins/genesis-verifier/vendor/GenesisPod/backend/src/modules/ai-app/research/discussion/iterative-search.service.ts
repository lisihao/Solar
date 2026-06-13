import { Injectable, Logger, Optional } from "@nestjs/common";
// ★ 架构重构：通过 ToolRegistry 调用工具，不再直接调用 SearchService
import { ToolRegistry } from "@/modules/ai-harness/facade";
import type { ToolContext } from "@/modules/ai-harness/facade";
import {
  ResearchPlan,
  ResearchPlanStep,
  SearchRound,
  SearchSource,
} from "./types";
import { ResearchToolRouterService } from "../search/research-tool-router.service";
import type { ToolResolution } from "../search/research-tool-router.types";

/**
 * 迭代搜索服务
 * 执行研究计划中的搜索步骤，支持流式进度反馈
 *
 * ★ 升级：支持多工具并行搜索 (通过 ToolResolution)
 */
@Injectable()
export class IterativeSearchService {
  private readonly logger = new Logger(IterativeSearchService.name);

  constructor(
    private readonly toolRegistry: ToolRegistry,
    @Optional() private readonly toolRouter?: ResearchToolRouterService,
  ) {}

  /**
   * 创建工具执行上下文
   */
  private createToolContext(toolId: string): ToolContext {
    return {
      executionId: `${toolId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      toolId,
      createdAt: new Date(),
      callerType: "orchestrator",
    };
  }

  /**
   * 执行单个搜索步骤
   * ★ 升级：支持 ToolResolution 多工具并行搜索
   *
   * @param step 研究计划步骤
   * @param round 搜索轮次编号
   * @param toolResolution 可选的工具解析策略；为 undefined 时 fallback 到 web-search
   */
  async executeStep(
    step: ResearchPlanStep,
    round: number,
    toolResolution?: ToolResolution,
  ): Promise<SearchRound> {
    this.logger.debug(`Executing search step ${step.id}: ${step.query}`);

    const startTime = Date.now();

    // 有 ToolResolution → 多工具并行；否则 fallback 到原来的 web-search 单工具
    if (toolResolution && toolResolution.tools.length > 0) {
      return this.executeMultiToolStep(step, round, toolResolution, startTime);
    }

    return this.executeSingleToolStep(step, round, startTime);
  }

  /**
   * 多工具并行搜索
   */
  private async executeMultiToolStep(
    step: ResearchPlanStep,
    round: number,
    resolution: ToolResolution,
    startTime: number,
  ): Promise<SearchRound> {
    const allSources: SearchSource[] = [];

    // 按 priority 排序
    const sortedTools = [...resolution.tools].sort(
      (a, b) => a.priority - b.priority,
    );

    // 并行模式：所有工具同时执行
    if (resolution.mode === "parallel") {
      const promises = sortedTools.map(async (assignment) => {
        const tool = this.toolRegistry.tryGet(assignment.toolId);
        if (!tool) {
          this.logger.warn(
            `[multiTool] Tool "${assignment.toolId}" not available, skipping`,
          );
          return [];
        }

        const query = this.toolRouter
          ? this.toolRouter.transformQueryForTool(
              step.query,
              assignment.queryTransform,
            )
          : this.enhanceQuery(step.query, step.type);

        try {
          const result = await tool.execute(
            { query, numResults: assignment.maxResults },
            this.createToolContext(assignment.toolId),
          );
          return this.extractSourcesFromResult(
            result,
            round,
            assignment.toolId,
          );
        } catch (err) {
          if (assignment.required) {
            this.logger.error(
              `[multiTool] Required tool "${assignment.toolId}" failed: ${err}`,
            );
          } else {
            this.logger.warn(
              `[multiTool] Optional tool "${assignment.toolId}" failed: ${err}`,
            );
          }
          return [];
        }
      });

      const results = await Promise.allSettled(promises);
      for (const result of results) {
        if (result.status === "fulfilled") {
          allSources.push(...result.value);
        }
      }
    } else {
      // primary-with-fallback / sequential: 按优先级依次尝试
      for (const assignment of sortedTools) {
        const tool = this.toolRegistry.tryGet(assignment.toolId);
        if (!tool) continue;

        const query = this.toolRouter
          ? this.toolRouter.transformQueryForTool(
              step.query,
              assignment.queryTransform,
            )
          : this.enhanceQuery(step.query, step.type);

        try {
          const result = await tool.execute(
            { query, numResults: assignment.maxResults },
            this.createToolContext(assignment.toolId),
          );
          const sources = this.extractSourcesFromResult(
            result,
            round,
            assignment.toolId,
          );
          allSources.push(...sources);

          // primary-with-fallback: 第一个成功就够了
          if (
            resolution.mode === "primary-with-fallback" &&
            sources.length > 0
          ) {
            break;
          }
        } catch (err) {
          this.logger.warn(
            `[multiTool] Tool "${assignment.toolId}" failed: ${err}`,
          );
        }
      }
    }

    // 去重并截断
    const dedupedSources = this.deduplicateSources(allSources).slice(
      0,
      resolution.maxTotalResults,
    );

    const duration = Date.now() - startTime;
    this.logger.debug(
      `Step ${step.id} completed (multi-tool): ${dedupedSources.length} results from ${sortedTools.map((t) => t.toolId).join(",")} in ${duration}ms`,
    );

    return {
      round,
      stepId: step.id,
      query: step.query,
      resultsCount: dedupedSources.length,
      sources: dedupedSources,
      timestamp: new Date(),
    };
  }

  /**
   * 原始单工具搜索 (web-search fallback)
   */
  private async executeSingleToolStep(
    step: ResearchPlanStep,
    round: number,
    startTime: number,
  ): Promise<SearchRound> {
    const maxResults = step.type === "academic" ? 10 : 15;
    const searchQuery = this.enhanceQuery(step.query, step.type);

    const webSearchTool = this.toolRegistry.tryGet("web-search");
    if (!webSearchTool) {
      this.logger.error(
        `[executeStep] web-search tool not registered in ToolRegistry`,
      );
      return {
        round,
        stepId: step.id,
        query: step.query,
        resultsCount: 0,
        sources: [],
        timestamp: new Date(),
      };
    }

    try {
      const toolResult = await webSearchTool.execute(
        { query: searchQuery, numResults: maxResults },
        this.createToolContext("web-search"),
      );

      const sources = this.extractSourcesFromResult(
        toolResult,
        round,
        "web-search",
      );

      const duration = Date.now() - startTime;
      this.logger.debug(
        `Step ${step.id} completed: ${sources.length} results in ${duration}ms`,
      );

      return {
        round,
        stepId: step.id,
        query: step.query,
        resultsCount: sources.length,
        sources,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(`Search step ${step.id} failed: ${error}`);
      return {
        round,
        stepId: step.id,
        query: step.query,
        resultsCount: 0,
        sources: [],
        timestamp: new Date(),
      };
    }
  }

  /**
   * 从工具执行结果中提取 SearchSource[]
   */
  private extractSourcesFromResult(
    toolResult: {
      success: boolean;
      data?: unknown;
      error?: { message?: string };
    },
    round: number,
    toolId: string,
  ): SearchSource[] {
    if (!toolResult.success || !toolResult.data) {
      this.logger.warn(
        `[extractSources] ${toolId} returned no data: ${toolResult.error?.message || "unknown"}`,
      );
      return [];
    }

    const searchData = toolResult.data as {
      results?: Array<{
        title: string;
        url: string;
        content: string;
        domain?: string;
        publishedDate?: string;
        score?: number;
      }>;
      success?: boolean;
    };

    if (!searchData.results) return [];

    return searchData.results.map((result, index) => ({
      id: `source_${round}_${toolId}_${index}`,
      title: result.title,
      url: result.url,
      snippet: result.content,
      domain: result.domain || this.extractDomain(result.url),
      publishedDate: result.publishedDate,
      relevanceScore: result.score || 0.5,
    }));
  }

  /**
   * 按 URL 去重 sources
   */
  private deduplicateSources(sources: SearchSource[]): SearchSource[] {
    const seen = new Set<string>();
    return sources.filter((s) => {
      const key = this.normalizeUrl(s.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * 执行完整的研究计划
   * 返回生成器以支持流式进度反馈
   */
  async *executeplan(
    plan: ResearchPlan,
    onProgress?: (round: number, total: number, message: string) => void,
  ): AsyncGenerator<SearchRound> {
    const totalSteps = plan.steps.length;

    for (let i = 0; i < totalSteps; i++) {
      const step = plan.steps[i];
      const round = i + 1;

      onProgress?.(
        round,
        totalSteps,
        `正在搜索: ${step.query.slice(0, 50)}...`,
      );

      const searchRound = await this.executeStep(step, round);
      yield searchRound;

      // 避免 API 限速
      if (i < totalSteps - 1) {
        await this.delay(500);
      }
    }
  }

  /**
   * 批量执行搜索计划（非流式）
   */
  async executePlanBatch(plan: ResearchPlan): Promise<SearchRound[]> {
    const rounds: SearchRound[] = [];

    for await (const round of this.executeplan(plan)) {
      rounds.push(round);
    }

    return rounds;
  }

  /**
   * 合并并去重搜索结果
   */
  mergeAndDeduplicate(rounds: SearchRound[]): SearchSource[] {
    const urlSet = new Set<string>();
    const mergedSources: SearchSource[] = [];

    for (const round of rounds) {
      for (const source of round.sources) {
        // 使用 URL 去重
        const normalizedUrl = this.normalizeUrl(source.url);
        if (!urlSet.has(normalizedUrl)) {
          urlSet.add(normalizedUrl);
          mergedSources.push(source);
        }
      }
    }

    // 按相关性排序
    mergedSources.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return mergedSources;
  }

  /**
   * 根据搜索类型增强查询
   */
  private enhanceQuery(query: string, stepType: string): string {
    if (!query) return query;
    switch (stepType) {
      case "academic":
        // 添加学术搜索关键词
        if (
          !query.toLowerCase().includes("research") &&
          !query.toLowerCase().includes("study") &&
          !query.toLowerCase().includes("paper")
        ) {
          return `${query} research paper academic study`;
        }
        return query;

      case "comparison":
        if (
          !query.includes("比较") &&
          !query.includes("comparison") &&
          !query.includes("vs")
        ) {
          return `${query} comparison analysis pros cons`;
        }
        return query;

      case "verification":
        // 添加最新/权威来源
        return `${query} official source ${new Date().getFullYear()}`;

      default:
        return query;
    }
  }

  /**
   * 从 URL 提取域名
   */
  private extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace("www.", "");
    } catch {
      return "";
    }
  }

  /**
   * 标准化 URL（去除协议、www、尾部斜杠等）
   */
  private normalizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      return (
        urlObj.hostname.replace("www.", "") + urlObj.pathname.replace(/\/$/, "")
      );
    } catch {
      return url;
    }
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
