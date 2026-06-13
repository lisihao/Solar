/**
 * Data Enrichment Service
 *
 * 数据增强服务：通过抓取完整网页内容来增强搜索结果
 *
 * 核心功能:
 * 1. 抓取搜索结果 Top N 条的完整网页内容
 * 2. 将 snippet (100-300字) 增强为完整内容 (3000字)
 * 3. 并行抓取 + 超时控制 + 降级处理
 *
 * 解决的问题:
 * - 原本 LLM 只能看到 snippet，被迫使用训练数据"编造"内容
 * - 增强后 LLM 可以基于实际网页内容生成报告
 */

import { Injectable, Logger } from "@nestjs/common";
// ★ 架构重构：通过 ToolRegistry 调用工具，不再直接调用 SearchService
import { ToolRegistry } from "@/modules/ai-harness/facade";
import type {
  ToolContext,
  ImageSearchOutput,
  ImageSearchResult,
} from "@/modules/ai-harness/facade";
import { withTimeoutFallback } from "@/common/utils/timeout.utils";
import type { DataSourceResult } from "../../types/data-source.types";
import type {
  EnrichedResult,
  ExtractedFigure,
} from "../../types/research.types";
import { FigureExtractorService } from "../report/figure-extractor.service";
import { FigureRelevanceService } from "../report/figure-relevance.service";
import { assessCredibility } from "../dimension/credibility.utils";
import { LruMap } from "@/common/utils/lru-map";

/**
 * ★ 图片搜索补充：当网页提取的图片数量不足时，自动搜图补充
 * - 触发阈值：总 extractedFigures < MIN_FIGURES_THRESHOLD
 * - 每次最多补充 MAX_SEARCH_SUPPLEMENT_FIGURES 张
 * - 搜图结果同样经过 validateAndUpgradeFigures + filterRelevantFigures 质量关卡
 *
 * ★ v7: 大幅降低补充量 — 搜索引擎图片质量低（营销图/博客头图居多），
 *   宁可少图也不引入垃圾图。仅在完全无图时少量补充。
 */
const MIN_FIGURES_THRESHOLD = 3;
const MAX_SEARCH_SUPPLEMENT_FIGURES = 5;
const IMAGE_SEARCH_TIMEOUT = 15000;

/**
 * URL 验证结果
 */
export interface UrlValidationResult {
  url: string;
  isValid: boolean;
  statusCode?: number;
  errorReason?: string;
  /** 内容是否有意义（非错误页面） */
  hasContent: boolean;
}

/**
 * 数据增强选项
 */
export interface DataEnrichmentOptions {
  /** 要增强的 Top N 条结果，默认 5 */
  topN?: number;
  /** 每条内容的最大长度，默认 3000 */
  maxContentLength?: number;
  /** 单个 URL 抓取超时（毫秒），默认 10000 */
  fetchTimeout?: number;
  /** 是否并行抓取，默认 true */
  parallel?: boolean;
  /** ★ 是否提取图表，默认 true */
  enableFigures?: boolean;
  /** ★ v4.6: 研究主题标题，用于图片相关性审查（Vision LLM） */
  topicTitle?: string;
  /** ★ v6.0: 维度名称，与 topicTitle 组合提供更精准的语义上下文 */
  dimensionName?: string;
}

/**
 * Cached fetch result for cross-dimension URL deduplication
 */
interface CachedFetchResult {
  fullContent: string | null;
  contentSource: "fetched" | "snippet";
  urlValid: boolean;
  extractedFigures: ExtractedFigure[];
}

@Injectable()
export class DataEnrichmentService {
  private readonly logger = new Logger(DataEnrichmentService.name);

  /**
   * ★ v4: 全局证据池 — 跨维度 URL 去重缓存
   * Key: normalized URL, Value: fetched content + figures
   * 同一报告生成过程中，同一 URL 只抓取一次
   * 通过 clearFetchCache() 在报告生成开始时清空
   * 使用 LruMap 防止异常路径下内存无限增长
   */
  private readonly fetchCache = new LruMap<string, CachedFetchResult>(500);

  // ★ 架构重构：通过 ToolRegistry 调用工具，不再直接依赖 SearchService
  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly figureExtractor: FigureExtractorService,
    private readonly figureRelevance: FigureRelevanceService,
  ) {}

  /**
   * ★ v4: 清空 URL 抓取缓存（每次报告生成前调用）
   */
  clearFetchCache(): void {
    const size = this.fetchCache.size;
    this.fetchCache.clear();
    if (size > 0) {
      this.logger.log(
        `[GlobalEvidencePool] Cleared fetch cache (${size} entries)`,
      );
    }
  }

  /**
   * ★ v4: 获取缓存统计
   */
  getFetchCacheStats(): { size: number; urls: string[] } {
    return {
      size: this.fetchCache.size,
      urls: [...this.fetchCache.keys()],
    };
  }

  /**
   * ★ v4: URL 规范化（用于缓存 key）
   */
  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Remove trailing slash, fragment, common tracking params
      parsed.hash = "";
      for (const param of [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_content",
        "utm_term",
        "ref",
        "source",
      ]) {
        parsed.searchParams.delete(param);
      }
      return parsed.toString().replace(/\/+$/, "");
    } catch {
      return url.trim().replace(/\/+$/, "");
    }
  }

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
   * 增强搜索结果：抓取 Top N 条结果的完整网页内容
   *
   * @param results 原始搜索结果
   * @param options 增强选项
   * @returns 增强后的结果列表（保持原有顺序）
   */
  async enrichSearchResults(
    results: DataSourceResult[],
    options: DataEnrichmentOptions = {},
  ): Promise<EnrichedResult[]> {
    const {
      topN = 5,
      maxContentLength = 3000,
      fetchTimeout = 10000,
      parallel = true,
      enableFigures = true, // ★ 默认开启图表提取
    } = options;

    if (results.length === 0) {
      return [];
    }

    this.logger.log(
      `Enriching ${Math.min(topN, results.length)} of ${results.length} search results`,
    );

    const startTime = Date.now();

    // ★ v7: 双通道选取 — 保相关性 + 保质量
    // 第一组：搜索排名前 topN（保持搜索引擎的相关性信号）
    // 第二组：剩余结果中高可信度来源（确保权威来源的图表被提取）
    // 使用 assessCredibility() 统一评分，不硬编码域名列表
    const HIGH_CREDIBILITY_THRESHOLD = 55; // domain 40 + sourceType 15+ = 55+
    const MAX_EXTRA_HIGH_CRED = 10; // 额外抓取的高可信度来源上限

    const topNSet = new Set(results.slice(0, topN).map((r) => r.url));
    const extraHighCred = results
      .slice(topN)
      .filter((r) => {
        const preScore = assessCredibility(r);
        return preScore >= HIGH_CREDIBILITY_THRESHOLD;
      })
      .slice(0, MAX_EXTRA_HIGH_CRED);

    if (extraHighCred.length > 0) {
      this.logger.log(
        `[Enrichment] Adding ${extraHighCred.length} high-credibility sources beyond topN (domains: ${extraHighCred.map((r) => r.domain).join(", ")})`,
      );
    }

    // 合并去重
    const toEnrich = [
      ...results.slice(0, topN),
      ...extraHighCred.filter((r) => !topNSet.has(r.url)),
    ];
    const enrichedUrls = new Set(toEnrich.map((r) => r.url));
    const remaining = results.filter((r) => !enrichedUrls.has(r.url));

    // 抓取完整内容
    let enrichedTop: EnrichedResult[];
    // ★ v6.0: 组合主题+维度名作为 Vision LLM 语义上下文
    const figureContext = options.dimensionName
      ? `${options.topicTitle} - ${options.dimensionName}`
      : options.topicTitle;

    if (parallel) {
      enrichedTop = await this.enrichParallel(
        toEnrich,
        maxContentLength,
        fetchTimeout,
        enableFigures,
        figureContext,
      );
    } else {
      enrichedTop = await this.enrichSequential(
        toEnrich,
        maxContentLength,
        fetchTimeout,
        enableFigures,
        figureContext,
      );
    }

    // 转换剩余的结果（不抓取完整内容）
    const enrichedRemaining: EnrichedResult[] = remaining.map((item) => ({
      ...item,
      fullContent: null,
      contentSource: "snippet" as const,
      urlValid: true, // 假设未验证的 URL 有效（来自搜索引擎）
    }));

    const executionTime = Date.now() - startTime;
    const successCount = enrichedTop.filter(
      (r) => r.contentSource === "fetched",
    ).length;

    this.logger.log(
      `Enrichment completed: ${successCount}/${toEnrich.length} URLs fetched successfully in ${executionTime}ms`,
    );

    const allResults = [...enrichedTop, ...enrichedRemaining];

    // ★ 图片不足时自动搜图补充
    if (enableFigures && figureContext) {
      const totalFigures = allResults.reduce(
        (sum, r) => sum + (r.extractedFigures?.length || 0),
        0,
      );

      if (totalFigures < MIN_FIGURES_THRESHOLD) {
        this.logger.log(
          `[ImageSearchSupplement] Only ${totalFigures} figures extracted (threshold: ${MIN_FIGURES_THRESHOLD}), triggering image search for "${figureContext}"`,
        );
        const supplementFigures = await this.supplementFiguresViaImageSearch(
          figureContext,
          MAX_SEARCH_SUPPLEMENT_FIGURES - totalFigures,
        );

        if (supplementFigures.length > 0) {
          // 将搜图结果附加到第一个有效的 enriched result 上
          const targetResult = allResults.find(
            (r) => r.contentSource === "fetched" && r.urlValid,
          );
          if (targetResult) {
            targetResult.extractedFigures = [
              ...(targetResult.extractedFigures || []),
              ...supplementFigures,
            ];
          } else if (allResults.length > 0) {
            // 所有结果都是 snippet fallback，附加到第一个
            allResults[0].extractedFigures = [
              ...(allResults[0].extractedFigures || []),
              ...supplementFigures,
            ];
          }
          this.logger.log(
            `[ImageSearchSupplement] Added ${supplementFigures.length} figures from image search`,
          );
        }
      }
    }

    return allResults.filter((r) => r.urlValid !== false);
  }

  /**
   * 并行抓取完整内容
   */
  private async enrichParallel(
    results: DataSourceResult[],
    maxContentLength: number,
    fetchTimeout: number,
    enableFigures: boolean,
    topicTitle?: string,
  ): Promise<EnrichedResult[]> {
    const enrichPromises = results.map((result) =>
      this.enrichSingleResult(
        result,
        maxContentLength,
        fetchTimeout,
        enableFigures,
        topicTitle,
      ),
    );

    return Promise.all(enrichPromises);
  }

  /**
   * 顺序抓取完整内容（用于调试或避免 IP 限制）
   */
  private async enrichSequential(
    results: DataSourceResult[],
    maxContentLength: number,
    fetchTimeout: number,
    enableFigures: boolean,
    topicTitle?: string,
  ): Promise<EnrichedResult[]> {
    const enrichedResults: EnrichedResult[] = [];

    for (const result of results) {
      const enriched = await this.enrichSingleResult(
        result,
        maxContentLength,
        fetchTimeout,
        enableFigures,
        topicTitle,
      );
      enrichedResults.push(enriched);
    }

    return enrichedResults;
  }

  /**
   * 增强单个搜索结果
   * ★ 架构重构：通过 ToolRegistry 调用 web-scraper 工具
   * @param enableFigures 是否提取图表（来自 topicConfig）
   */
  private async enrichSingleResult(
    result: DataSourceResult,
    maxContentLength: number,
    fetchTimeout: number,
    enableFigures: boolean = true,
    topicTitle?: string,
  ): Promise<EnrichedResult> {
    // ★ v4: 检查全局缓存（跨维度 URL 去重）
    const cacheKey = this.normalizeUrl(result.url);
    const cached = this.fetchCache.get(cacheKey);
    if (cached) {
      this.logger.debug(
        `[GlobalEvidencePool] Cache hit for ${result.domain || result.url} (${cached.fullContent?.length || 0} chars, ${cached.extractedFigures.length} figures)`,
      );
      return {
        ...result,
        fullContent: cached.fullContent,
        contentSource: cached.contentSource,
        urlValid: cached.urlValid,
        extractedFigures: cached.extractedFigures,
      };
    }

    // ★ 通过 ToolRegistry 获取 web-scraper 工具
    const webScraperTool = this.toolRegistry.tryGet("web-scraper");
    if (!webScraperTool) {
      this.logger.warn(
        "[enrichSingleResult] web-scraper tool not registered, falling back to snippet",
      );
      return {
        ...result,
        fullContent: result.snippet || null,
        contentSource: "snippet",
        urlValid: false,
      };
    }

    try {
      // 超时控制：超时后降级为 snippet
      const toolResult = await withTimeoutFallback(
        webScraperTool.execute(
          {
            url: result.url,
            maxLength: maxContentLength,
          },
          this.createToolContext("web-scraper"),
        ),
        fetchTimeout,
        {
          success: false,
          error: { code: "TIMEOUT", message: "Fetch timeout" },
        } as Awaited<ReturnType<typeof webScraperTool.execute>>,
      );

      if (toolResult.success && toolResult.data) {
        const scraperData = toolResult.data as {
          content: string;
          html?: string;
          title?: string;
          success: boolean;
        };

        if (scraperData.success && scraperData.content) {
          // 成功抓取到内容
          const truncatedContent = scraperData.content.slice(
            0,
            maxContentLength,
          );
          // ★ 检查内容是否有意义（非错误页面）
          const isValid = this.isContentMeaningful(truncatedContent);

          // ★ 提取图表：使用 HTML 内容（如果可用）
          // ★ 仅当 enableFigures=true 时提取图表
          let extractedFigures: ExtractedFigure[] = [];
          if (enableFigures) {
            // ★ arXiv 修复：/abs/ 页面不含图片，改爬 /html/ 版本来提取图表
            let figureHtmlContent = scraperData.html || scraperData.content;
            // ★ arxiv HTML URL 尾部斜杠修复：arxiv HTML 页面中图片使用相对路径，
            // 若 baseUrl 无尾部斜杠，new URL("img.png", baseUrl) 会解析到父目录（404）
            // 直接访问 /html/{id} 时同样需要补斜杠
            let figureSourceUrl = /arxiv\.org\/html\/[\w.]+$/.test(result.url)
              ? result.url + "/"
              : result.url;
            const arxivAbsMatch = result.url.match(/arxiv\.org\/abs\/([\w.]+)/);
            if (arxivAbsMatch && webScraperTool) {
              const arxivHtmlUrl = `https://arxiv.org/html/${arxivAbsMatch[1]}`;
              try {
                const htmlResult = await withTimeoutFallback(
                  webScraperTool.execute(
                    { url: arxivHtmlUrl, maxLength: 500_000 },
                    this.createToolContext("web-scraper"),
                  ),
                  15_000,
                  {
                    success: false,
                    error: { code: "TIMEOUT", message: "arXiv HTML timeout" },
                  } as Awaited<ReturnType<typeof webScraperTool.execute>>,
                );
                if (htmlResult.success && htmlResult.data) {
                  const d = htmlResult.data as {
                    html?: string;
                    content?: string;
                    success: boolean;
                  };
                  if (d.success && (d.html || d.content)) {
                    figureHtmlContent =
                      d.html || d.content || figureHtmlContent;
                    // ★ 必须加尾部斜杠：arxiv HTML 中图片用相对路径（如 "Figure1.png"），
                    // new URL("Figure1.png", "https://arxiv.org/html/2601.13671v1") 会错误解析到
                    // /html/Figure1.png（父目录）而非 /html/2601.13671v1/Figure1.png（正确路径）
                    figureSourceUrl = arxivHtmlUrl.endsWith("/")
                      ? arxivHtmlUrl
                      : arxivHtmlUrl + "/";
                    this.logger.log(
                      `[enrichSingleResult] arXiv HTML fetched for figures: ${figureSourceUrl}`,
                    );
                  }
                }
              } catch {
                // Fallback to abstract page if HTML version unavailable
              }
            }
            if (figureHtmlContent) {
              extractedFigures = this.figureExtractor.extractFigures(
                figureSourceUrl,
                figureHtmlContent,
              );
              // ★ 过滤掉没有有效 imageUrl 的图表
              const beforeFilter = extractedFigures.length;
              extractedFigures = extractedFigures.filter(
                (f) => f.imageUrl && f.imageUrl.trim(),
              );

              // ★ v4.5→v7: GET+Range 校验图片可访问性 + magic bytes 验证
              // 验证失败/网络错误 → 丢弃（质量第一）
              if (extractedFigures.length > 0) {
                extractedFigures =
                  await this.figureExtractor.validateAndUpgradeFigures(
                    extractedFigures,
                  );
              }

              // ★ v4.6: 多模态 LLM 图片相关性审查（宁缺毋滥）
              // 发送图片 URL 给 Vision 模型，判断是否为有价值且相关的信息图
              if (extractedFigures.length > 0 && topicTitle) {
                extractedFigures =
                  await this.figureRelevance.filterRelevantFigures(
                    extractedFigures,
                    topicTitle,
                  );
              }

              if (beforeFilter > 0) {
                this.logger.debug(
                  `Extracted ${beforeFilter} figures from ${result.domain || result.url}, ` +
                    `${beforeFilter - extractedFigures.length} filtered, ${extractedFigures.length} validated`,
                );
              }
            }
          }

          this.logger.debug(
            `Fetched ${truncatedContent.length} chars from ${result.domain || result.url}, valid: ${isValid}, figures: ${extractedFigures.length}`,
          );

          // ★ v4: 写入全局缓存
          this.fetchCache.set(cacheKey, {
            fullContent: truncatedContent,
            contentSource: "fetched",
            urlValid: isValid,
            extractedFigures,
          });

          return {
            ...result,
            fullContent: truncatedContent,
            contentSource: "fetched",
            urlValid: isValid,
            extractedFigures,
          };
        }
      }

      // 抓取失败，降级到 snippet
      this.logger.debug(
        `Failed to fetch ${result.url}: ${toolResult.error?.message || "unknown error"}, falling back to snippet`,
      );

      // ★ v4: 缓存失败结果，避免其他维度重复尝试同一 URL
      this.fetchCache.set(cacheKey, {
        fullContent: result.snippet || null,
        contentSource: "snippet",
        urlValid: false,
        extractedFigures: [],
      });

      return {
        ...result,
        fullContent: result.snippet || null,
        contentSource: "snippet",
        urlValid: false, // 抓取失败，标记为无效
      };
    } catch (error) {
      // 异常情况，降级到 snippet
      this.logger.warn(
        `Error enriching ${result.url}: ${error instanceof Error ? error.message : String(error)}`,
      );

      return {
        ...result,
        fullContent: result.snippet || null,
        contentSource: "snippet",
        urlValid: false, // 异常情况，标记为无效
      };
    }
  }

  /**
   * 获取增强统计信息
   */
  getEnrichmentStats(results: EnrichedResult[]): {
    total: number;
    fetched: number;
    snippetOnly: number;
    avgContentLength: number;
    validUrls: number;
    invalidUrls: number;
  } {
    const fetched = results.filter((r) => r.contentSource === "fetched").length;
    const snippetOnly = results.filter(
      (r) => r.contentSource === "snippet",
    ).length;
    // ★ 统计有效和无效 URL
    const validUrls = results.filter((r) => r.urlValid).length;
    const invalidUrls = results.filter((r) => !r.urlValid).length;

    const totalContentLength = results.reduce(
      (sum, r) => sum + (r.fullContent?.length || 0),
      0,
    );
    const avgContentLength =
      results.length > 0 ? Math.round(totalContentLength / results.length) : 0;

    return {
      total: results.length,
      fetched,
      snippetOnly,
      avgContentLength,
      validUrls,
      invalidUrls,
    };
  }

  /**
   * 批量验证 URL 有效性
   * ★ 确保引用链接真实可访问
   *
   * @param urls URL 列表
   * @param timeout 单个 URL 验证超时（毫秒）
   * @returns 验证结果列表
   */
  async validateUrls(
    urls: string[],
    timeout: number = 5000,
  ): Promise<UrlValidationResult[]> {
    this.logger.log(`Validating ${urls.length} URLs`);

    const validationPromises = urls.map((url) =>
      this.validateSingleUrl(url, timeout),
    );

    const results = await Promise.all(validationPromises);

    const validCount = results.filter((r) => r.isValid).length;
    this.logger.log(`URL validation: ${validCount}/${urls.length} valid`);

    return results;
  }

  /**
   * 验证单个 URL
   * ★ 架构重构：通过 ToolRegistry 调用 web-scraper 工具
   */
  private async validateSingleUrl(
    url: string,
    timeout: number,
  ): Promise<UrlValidationResult> {
    // ★ 通过 ToolRegistry 获取 web-scraper 工具
    const webScraperTool = this.toolRegistry.tryGet("web-scraper");
    if (!webScraperTool) {
      return {
        url,
        isValid: false,
        hasContent: false,
        errorReason: "web-scraper tool not available",
      };
    }

    try {
      // 使用 web-scraper 工具来验证 URL
      const fetchPromise = webScraperTool.execute(
        { url, maxLength: 1000 }, // 验证时只需少量内容
        this.createToolContext("web-scraper"),
      );
      const timeoutPromise = new Promise<{
        success: false;
        error: { message: string };
      }>((resolve) =>
        setTimeout(
          () =>
            resolve({
              success: false,
              error: { message: "Validation timeout" },
            }),
          timeout,
        ),
      );

      const toolResult = await Promise.race([fetchPromise, timeoutPromise]);

      if (toolResult.success && toolResult.data) {
        const scraperData = toolResult.data as {
          content: string;
          success: boolean;
        };

        if (scraperData.success && scraperData.content) {
          // 检查内容是否有意义（不是错误页面）
          const hasContent = this.isContentMeaningful(scraperData.content);

          return {
            url,
            isValid: true,
            hasContent,
            statusCode: 200,
          };
        }
      }

      return {
        url,
        isValid: false,
        hasContent: false,
        errorReason: toolResult.error?.message || "Failed to fetch content",
      };
    } catch (error) {
      return {
        url,
        isValid: false,
        hasContent: false,
        errorReason: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * ★ 图片不足时，通过 image-search 工具搜索补充图片
   *
   * 流程：
   * 1. 通过 ToolRegistry 获取 image-search 工具
   * 2. 构造搜索查询（topicTitle + dimensionName）
   * 3. 将 ImageSearchResult → ExtractedFigure
   * 4. 经过 validateAndUpgradeFigures + filterRelevantFigures 质量关卡
   *
   * @param searchContext 搜索上下文（topic + dimension 名称）
   * @param maxCount 最多补充图片数
   * @returns 通过质量关卡的 ExtractedFigure 列表
   */
  private async supplementFiguresViaImageSearch(
    searchContext: string,
    maxCount: number,
  ): Promise<ExtractedFigure[]> {
    const imageSearchTool = this.toolRegistry.tryGet("image-search");
    if (!imageSearchTool) {
      this.logger.debug(
        "[ImageSearchSupplement] image-search tool not registered, skipping",
      );
      return [];
    }

    try {
      // ★ 搜索查询：使用主题+维度名称，偏好图表/信息图
      const query = `${searchContext} chart infographic data`;
      const toolResult = await withTimeoutFallback(
        imageSearchTool.execute(
          {
            query,
            numResults: maxCount * 2, // 搜多一些，质量关卡会淘汰部分
            size: "large",
            imageType: "any",
          },
          this.createToolContext("image-search"),
        ),
        IMAGE_SEARCH_TIMEOUT,
        {
          success: false,
          error: { code: "TIMEOUT", message: "Image search timeout" },
        } as Awaited<ReturnType<typeof imageSearchTool.execute>>,
      );

      if (!toolResult.success || !toolResult.data) {
        this.logger.warn(
          `[ImageSearchSupplement] Image search failed: ${toolResult.error?.message || "unknown"}`,
        );
        return [];
      }

      const searchOutput = toolResult.data as ImageSearchOutput;
      if (!searchOutput.results || searchOutput.results.length === 0) {
        this.logger.debug(
          "[ImageSearchSupplement] Image search returned 0 results",
        );
        return [];
      }

      this.logger.log(
        `[ImageSearchSupplement] Got ${searchOutput.results.length} candidates from ${searchOutput.provider}`,
      );

      // ★ 转换 ImageSearchResult → ExtractedFigure
      // isImageSearchSupplement=true 标记此图片来自图片搜索，不得继承文本证据的 citationIndex
      let candidates: ExtractedFigure[] = searchOutput.results
        .filter(
          (r: ImageSearchResult) => r.imageUrl && r.imageUrl.startsWith("http"),
        )
        .map((r: ImageSearchResult) => ({
          imageUrl: r.imageUrl,
          caption: r.title || r.description || "",
          type: this.inferFigureType(r),
          alt: r.title || "",
          width: r.width,
          height: r.height,
          isImageSearchSupplement: true as const,
        }));

      // ★ 质量关卡 1：URL 可访问性 + magic bytes 验证
      if (candidates.length > 0) {
        candidates =
          await this.figureExtractor.validateAndUpgradeFigures(candidates);
      }

      // ★ 质量关卡 2：多模态 LLM 相关性审查
      if (candidates.length > 0) {
        candidates = await this.figureRelevance.filterRelevantFigures(
          candidates,
          searchContext,
        );
      }

      // 限制最终数量
      const finalFigures = candidates.slice(0, maxCount);

      this.logger.log(
        `[ImageSearchSupplement] ${searchOutput.results.length} searched → ${finalFigures.length} passed quality gates`,
      );

      return finalFigures;
    } catch (error) {
      this.logger.warn(
        `[ImageSearchSupplement] Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * 根据搜索结果推断图片类型
   */
  private inferFigureType(result: ImageSearchResult): ExtractedFigure["type"] {
    const text =
      `${result.title || ""} ${result.description || ""}`.toLowerCase();
    if (/chart|graph|数据|统计|趋势|trend|plot/.test(text)) return "chart";
    if (/diagram|架构|流程|flow|architecture/.test(text)) return "diagram";
    if (/table|表格|对比|comparison/.test(text)) return "table";
    return "photo";
  }

  /**
   * 检查内容是否有意义（非错误页面、非空内容）
   */
  private isContentMeaningful(content: string): boolean {
    if (!content || content.length < 100) {
      return false;
    }

    // 检查是否为常见错误页面
    const errorPatterns = [
      /404\s*(not\s*found|page\s*not\s*found|error)/i,
      /403\s*(forbidden|access\s*denied)/i,
      /500\s*(internal\s*server\s*error)/i,
      /page\s*(not\s*found|does\s*not\s*exist)/i,
      /access\s*denied/i,
      /error\s*occurred/i,
      /this\s*page\s*(is\s*)?unavailable/i,
    ];

    for (const pattern of errorPatterns) {
      if (pattern.test(content.substring(0, 500))) {
        return false;
      }
    }

    return true;
  }

  /**
   * 过滤无效 URL 的搜索结果
   * ★ 确保只使用有效的、可访问的来源
   *
   * @param results 原始搜索结果
   * @returns 过滤后只包含有效 URL 的结果
   */
  async filterValidResults(
    results: DataSourceResult[],
  ): Promise<DataSourceResult[]> {
    const urls = results.map((r) => r.url);
    const validationResults = await this.validateUrls(urls);

    // 创建 URL -> 有效性 映射
    const validityMap = new Map<string, boolean>();
    validationResults.forEach((v) => {
      validityMap.set(v.url, v.isValid && v.hasContent);
    });

    // 过滤出有效的结果
    const validResults = results.filter((r) => validityMap.get(r.url) === true);

    this.logger.log(
      `Filtered results: ${validResults.length}/${results.length} have valid URLs`,
    );

    return validResults;
  }
}
