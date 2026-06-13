import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { SystemSettingService } from "../settings/system-setting.service";

/**
 * 结构化数据项
 */
export interface StructuredDataItem {
  name: string;
  value: string | number;
  unit?: string;
  comparison?: string;
  trend?: "up" | "down" | "stable";
}

/**
 * 获取的数据结果
 */
export interface FetchedDataResult {
  title: string;
  items: StructuredDataItem[];
  source?: string;
  fetchedAt: string;
}

/**
 * 数据获取结果
 */
export interface DataFetchingResult {
  needsFetching: boolean;
  detectedIntent?: string;
  queries: string[];
  fetchedData: FetchedDataResult[];
  enrichedContent: string;
  error?: string;
}

/**
 * 数据获取服务
 *
 * 负责检测用户请求是否需要联网获取真实数据，
 * 并调用搜索 API 获取结构化数据。
 *
 * 支持的场景：
 * - "获取北美 TOP 10 科技企业财务数据"
 * - "查询最新 AI 发展趋势"
 * - "搜索 2024 年市场报告"
 */
/**
 * 缓存条目
 */
interface CacheEntry {
  data: FetchedDataResult;
  timestamp: number;
}

@Injectable()
export class DataFetchingService {
  private readonly logger = new Logger(DataFetchingService.name);

  // 简单内存缓存：query -> { data, timestamp }
  // 缓存有效期 15 分钟
  private readonly cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

  constructor(
    private readonly httpService: HttpService,
    private readonly systemSettingService: SystemSettingService,
  ) {}

  /**
   * 从缓存获取数据
   */
  private getFromCache(query: string): FetchedDataResult | null {
    const entry = this.cache.get(query);
    if (!entry) return null;

    // 检查是否过期
    if (Date.now() - entry.timestamp > this.CACHE_TTL_MS) {
      this.cache.delete(query);
      return null;
    }

    this.logger.log(`[Cache] Hit for query: ${query.slice(0, 50)}...`);
    return entry.data;
  }

  /**
   * 保存到缓存
   */
  private saveToCache(query: string, data: FetchedDataResult): void {
    // 限制缓存大小（最多 100 个条目）
    if (this.cache.size >= 100) {
      // 删除最旧的条目
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(query, {
      data,
      timestamp: Date.now(),
    });
    this.logger.log(`[Cache] Saved for query: ${query.slice(0, 50)}...`);
  }

  /**
   * 检测是否需要数据获取
   *
   * 检测条件：
   * 1. 包含数据获取指令词（获取、查询、搜索等）
   * 2. 包含数据类型关键词（数据、统计、排名等）
   * 3. 包含实时性关键词（最新、当前、今日等）
   */
  detectDataFetchingNeed(content: string): {
    needsFetching: boolean;
    intent?: string;
    queries: string[];
  } {
    // 数据获取指令词
    const actionIndicators = [
      /获取|查询|搜索|查找|找出|分析|对比|比较|横评/,
      /fetch|search|find|query|get|compare|analyze/i,
    ];

    // 实时性关键词
    const timeIndicators = [
      /最新|实时|当前|今日|本周|本月|本年|近期|\d{4}年/,
      /latest|current|recent|today|this\s+(week|month|year)|\d{4}/i,
    ];

    // 数据类型关键词
    const dataIndicators = [
      /数据|统计|指标|增长率|排名|排行|TOP\s*\d+|前\d+|市值|营收|利润|销量/,
      /data|statistics|metrics|growth|ranking|top\s*\d+|revenue|profit|sales/i,
    ];

    // 需要外部数据的实体类型
    const entityIndicators = [
      /企业|公司|品牌|产品|股票|基金|市场|行业|国家|城市/,
      /company|companies|brand|product|stock|market|industry|country/i,
    ];

    const hasAction = actionIndicators.some((pattern) => pattern.test(content));
    const hasTime = timeIndicators.some((pattern) => pattern.test(content));
    const hasData = dataIndicators.some((pattern) => pattern.test(content));
    const hasEntity = entityIndicators.some((pattern) => pattern.test(content));

    // TOP N / 排行榜类型的查询始终需要实时数据
    const isTopNQuery =
      /TOP\s*\d+|前\s*\d+|\d+\s*大|\d+\s*强|排行榜|排名/i.test(content);

    // 需要满足以下任一条件：
    // 1. (动作词 + 数据词)
    // 2. (实时词 + 实体词)
    // 3. (TOP N查询 + 实体词) - 新增：排行榜类查询必须用实时数据
    const needsFetching =
      (hasAction && hasData) ||
      (hasTime && hasEntity) ||
      (isTopNQuery && hasEntity);

    if (!needsFetching) {
      return { needsFetching: false, queries: [] };
    }

    this.logger.log(
      `[detectDataFetchingNeed] Detection result: action=${hasAction}, time=${hasTime}, data=${hasData}, entity=${hasEntity}, topN=${isTopNQuery}`,
    );

    // 提取查询意图
    const intent = this.extractIntent(content);
    const queries = this.generateQueries(content, intent);

    this.logger.log(
      `[detectDataFetchingNeed] Detected intent: ${intent}, queries: ${queries.join(", ")}`,
    );

    return { needsFetching, intent, queries };
  }

  /**
   * 提取查询意图
   */
  private extractIntent(content: string): string {
    // 提取 TOP N 模式
    const topNMatch = content.match(/TOP\s*(\d+)|前(\d+)|(\d+)\s*强/i);
    if (topNMatch) {
      const n = topNMatch[1] || topNMatch[2] || topNMatch[3];
      return `top_${n}_ranking`;
    }

    // 提取对比/比较模式
    if (/对比|比较|横评|vs|versus/i.test(content)) {
      return "comparison";
    }

    // 提取趋势/变化模式
    if (/趋势|变化|增长|下降|走势/i.test(content)) {
      return "trend_analysis";
    }

    // 提取数据查询模式
    if (/数据|统计|指标/i.test(content)) {
      return "data_query";
    }

    return "general_search";
  }

  /**
   * 生成搜索查询
   */
  private generateQueries(content: string, intent: string): string[] {
    const queries: string[] = [];
    const currentYear = new Date().getFullYear();

    // 清理内容，提取核心查询词
    const cleanContent = content
      .replace(/请|帮我|生成|制作|信息图|图片|图表/g, "")
      .replace(/\s+/g, " ")
      .trim();

    // 提取行业/领域关键词
    const industryMatch = content.match(
      /科技|金融|医疗|互联网|电商|汽车|能源|制造|tech|finance|healthcare/i,
    );
    const regionMatch = content.match(
      /北美|中国|全球|美国|欧洲|亚洲|日本|韩国|US|America|China|Global/i,
    );

    // 根据意图添加额外查询
    if (intent === "top_ranking" || intent.startsWith("top_")) {
      // TOP N 查询：优先使用精确的英文查询获取最新数据
      const topNMatch = content.match(/TOP\s*(\d+)|前\s*(\d+)|(\d+)\s*大/i);
      const n = topNMatch ? topNMatch[1] || topNMatch[2] || topNMatch[3] : "10";

      if (industryMatch) {
        const industry =
          industryMatch[0] === "科技" ? "technology" : industryMatch[0];
        const region = regionMatch
          ? regionMatch[0] === "北美"
            ? "US"
            : regionMatch[0] === "中国"
              ? "China"
              : regionMatch[0]
          : "global";

        // 优先英文查询获取更准确的数据
        queries.push(
          `top ${n} ${region} ${industry} companies by market cap ${currentYear}`,
        );
        queries.push(
          `largest ${industry} companies ${region} market capitalization ${currentYear}`,
        );
      } else {
        queries.push(`${cleanContent} ${currentYear} 最新排名`);
      }
    } else {
      // 基础查询 + 年份
      queries.push(`${cleanContent} ${currentYear}`);
    }

    if (intent === "comparison") {
      queries.push(`${cleanContent} 数据对比 ${currentYear}`);
    }

    if (intent === "trend_analysis") {
      queries.push(`${cleanContent} 趋势分析 2024`);
    }

    return queries.slice(0, 3); // 最多 3 个查询
  }

  /**
   * 从外部 API 获取数据
   *
   * 优先使用 Perplexity API，回退到其他搜索 API
   */
  async fetchData(queries: string[]): Promise<FetchedDataResult[]> {
    const results: FetchedDataResult[] = [];

    // 获取配置的搜索 API
    const searchConfig = await this.getSearchApiConfig();

    if (!searchConfig) {
      this.logger.warn("[fetchData] No search API configured");
      return results;
    }

    for (const query of queries) {
      try {
        // 先检查缓存
        const cached = this.getFromCache(query);
        if (cached) {
          results.push(cached);
          continue;
        }

        // 缓存未命中，调用 API
        const result = await this.callSearchApi(searchConfig, query);
        if (result) {
          // 保存到缓存
          this.saveToCache(query, result);
          results.push(result);
        }
      } catch (error) {
        this.logger.error(
          `[fetchData] Error fetching query "${query}":`,
          error,
        );
      }
    }

    return results;
  }

  /**
   * 获取搜索 API 配置
   *
   * 优先级：
   * 1. 数据库配置（通过 Admin 面板设置）
   * 2. 环境变量（作为回退）
   *
   * 支持的 Provider：
   * - perplexity: Perplexity AI 搜索（最佳选择，AI 驱动）
   * - tavily: Tavily 搜索（专为 AI Agent 设计）
   * - serper: Serper Google 搜索
   */
  private async getSearchApiConfig(): Promise<{
    provider: string;
    apiKey: string;
    endpoint?: string;
  } | null> {
    // 环境变量 API Keys
    const envKeys = {
      perplexity: process.env.PERPLEXITY_API_KEY,
      tavily: process.env.TAVILY_API_KEY,
      serper: process.env.SERPER_API_KEY,
    };

    let configuredProvider: string = "tavily"; // 默认值

    try {
      // 1. 首先尝试从数据库读取配置
      const dbConfig = await this.systemSettingService.getSearchConfig();

      // 检查是否启用搜索
      if (dbConfig.enabled === false) {
        this.logger.log("[getSearchApiConfig] Search is disabled in config");
        return null;
      }

      // 获取用户配置的默认 provider
      configuredProvider = dbConfig.provider || "tavily";

      // 2. 优先使用用户配置的 provider
      // 先检查 DB 中的 API key，再检查环境变量
      const dbApiKey =
        await this.systemSettingService.getSearchApiKey(configuredProvider);
      const envApiKey =
        envKeys[configuredProvider as keyof typeof envKeys] || null;

      if (dbApiKey) {
        this.logger.log(
          `[getSearchApiConfig] Using ${configuredProvider} from database (user's default)`,
        );
        return { provider: configuredProvider, apiKey: dbApiKey };
      }

      if (envApiKey) {
        this.logger.log(
          `[getSearchApiConfig] Using ${configuredProvider} from env var (user's default)`,
        );
        return { provider: configuredProvider, apiKey: envApiKey };
      }

      // 3. 配置的 provider 没有 API key，尝试其他可用的（数据库优先）
      const fallbackOrder = ["perplexity", "tavily", "serper"].filter(
        (p) => p !== configuredProvider,
      );

      for (const provider of fallbackOrder) {
        const fallbackDbKey =
          await this.systemSettingService.getSearchApiKey(provider);
        if (fallbackDbKey) {
          this.logger.warn(
            `[getSearchApiConfig] ${configuredProvider} has no API key, falling back to ${provider} (from DB)`,
          );
          return { provider, apiKey: fallbackDbKey };
        }
        const fallbackEnvKey = envKeys[provider as keyof typeof envKeys];
        if (fallbackEnvKey) {
          this.logger.warn(
            `[getSearchApiConfig] ${configuredProvider} has no API key, falling back to ${provider} (from env)`,
          );
          return { provider, apiKey: fallbackEnvKey };
        }
      }
    } catch (error) {
      this.logger.warn(
        "[getSearchApiConfig] Failed to read from database, falling back to env vars:",
        error,
      );
    }

    // 4. 数据库访问失败时，使用环境变量（按用户配置的顺序）
    const fallbackProviders = [
      configuredProvider,
      "perplexity",
      "tavily",
      "serper",
    ];
    const uniqueProviders = [...new Set(fallbackProviders)];

    for (const provider of uniqueProviders) {
      const envKey = envKeys[provider as keyof typeof envKeys];
      if (envKey) {
        this.logger.log(
          `[getSearchApiConfig] Using ${provider} from env var (fallback)`,
        );
        return { provider, apiKey: envKey };
      }
    }

    this.logger.warn("[getSearchApiConfig] No search API configured");
    return null;
  }

  /**
   * 调用搜索 API
   */
  private async callSearchApi(
    config: { provider: string; apiKey: string; endpoint?: string },
    query: string,
  ): Promise<FetchedDataResult | null> {
    this.logger.log(
      `[callSearchApi] Calling ${config.provider} with query: ${query}`,
    );

    try {
      if (config.provider === "perplexity") {
        return await this.callPerplexityApi(config.apiKey, query);
      } else if (config.provider === "tavily") {
        return await this.callTavilyApi(config.apiKey, query);
      } else if (config.provider === "serper") {
        return await this.callSerperApi(config.apiKey, query);
      }

      this.logger.warn(`[callSearchApi] Unknown provider: ${config.provider}`);
      return null;
    } catch (error) {
      this.logger.error(`[callSearchApi] Error:`, error);
      return null;
    }
  }

  /**
   * 调用 Perplexity API
   */
  private async callPerplexityApi(
    apiKey: string,
    query: string,
  ): Promise<FetchedDataResult | null> {
    const response = await firstValueFrom(
      this.httpService.post(
        "https://api.perplexity.ai/chat/completions",
        {
          model: "llama-3.1-sonar-small-128k-online",
          messages: [
            {
              role: "system",
              content: `You are a data research assistant. Extract factual data and statistics from your search results.
              Return the data in a structured format with specific numbers and sources.
              Focus on recent data (2023-2024) when available.
              If asking about rankings or TOP N, provide specific company/entity names with their metrics.`,
            },
            {
              role: "user",
              content: query,
            },
          ],
          temperature: 0.1, // Direct Perplexity API call, not using AiChatService
          max_tokens: 1000,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        },
      ),
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (!content) {
      return null;
    }

    // 解析返回的内容为结构化数据
    return this.parseSearchResult(query, content);
  }

  /**
   * 调用 Serper API
   */
  private async callSerperApi(
    apiKey: string,
    query: string,
  ): Promise<FetchedDataResult | null> {
    const response = await firstValueFrom(
      this.httpService.post(
        "https://google.serper.dev/search",
        {
          q: query,
          num: 10,
        },
        {
          headers: {
            "X-API-KEY": apiKey,
            "Content-Type": "application/json",
          },
        },
      ),
    );

    const organic = response.data?.organic;
    if (!organic || organic.length === 0) {
      return null;
    }

    // 从搜索结果中提取数据
    const snippets = (organic as Array<{ snippet: string }>)
      .slice(0, 5)
      .map((r) => r.snippet)
      .join("\n");

    return this.parseSearchResult(query, snippets);
  }

  /**
   * 调用 Tavily API
   * Tavily 是专为 AI Agent 设计的搜索 API
   */
  private async callTavilyApi(
    apiKey: string,
    query: string,
  ): Promise<FetchedDataResult | null> {
    const response = await firstValueFrom(
      this.httpService.post(
        "https://api.tavily.com/search",
        {
          api_key: apiKey,
          query: query,
          search_depth: "advanced",
          include_answer: true,
          include_raw_content: false,
          max_results: 5,
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    // Tavily 返回格式: { answer: string, results: Array<{title, content, url}> }
    const answer = response.data?.answer;
    const results = response.data?.results;

    if (!answer && (!results || results.length === 0)) {
      return null;
    }

    // 优先使用 answer，辅以 results 内容
    let content = answer || "";
    if (results && results.length > 0) {
      const snippets = (results as Array<{ content?: string; title?: string }>)
        .slice(0, 3)
        .map((r) => r.content || r.title)
        .join("\n");
      content = content ? `${content}\n\n${snippets}` : snippets;
    }

    return this.parseSearchResult(query, content);
  }

  /**
   * 解析搜索结果为结构化数据
   */
  private parseSearchResult(query: string, content: string): FetchedDataResult {
    const items: StructuredDataItem[] = [];

    // 提取数字和百分比
    const percentages = content.match(/(\d+(?:\.\d+)?)\s*%/g);
    const amounts = content.match(
      /\$?\d+(?:,\d{3})*(?:\.\d+)?\s*(billion|million|trillion|亿|万亿|B|M|T)?/gi,
    );

    // 提取公司名称
    const companies = content.match(
      /(Apple|Microsoft|Google|Amazon|Meta|Tesla|NVIDIA|IBM|Oracle|Cisco|苹果|微软|谷歌|亚马逊|特斯拉|英伟达)/gi,
    );

    // 构建数据项
    if (companies && amounts) {
      const uniqueCompanies = [...new Set(companies)];
      uniqueCompanies.forEach((company, index) => {
        if (amounts[index]) {
          items.push({
            name: company,
            value: amounts[index],
            comparison: percentages?.[index] || undefined,
          });
        }
      });
    }

    // 如果没有提取到结构化数据，至少返回原始内容摘要
    if (items.length === 0) {
      // 将内容分割为要点
      const sentences = content
        .split(/[。.!?！？\n]+/)
        .filter((s) => s.trim().length > 10)
        .slice(0, 5);

      sentences.forEach((sentence, index) => {
        items.push({
          name: `数据点 ${index + 1}`,
          value: sentence.trim().slice(0, 100),
        });
      });
    }

    return {
      title: query,
      items,
      source: "Search API",
      fetchedAt: new Date().toISOString(),
    };
  }

  /**
   * 将获取的数据整合到原始内容中
   */
  enrichContent(
    originalContent: string,
    fetchedData: FetchedDataResult[],
  ): string {
    if (fetchedData.length === 0) {
      return originalContent;
    }

    const dataSection = fetchedData
      .map((result) => {
        const itemsText = result.items
          .map((item) => {
            let line = `- ${item.name}: ${item.value}`;
            if (item.unit) line += ` ${item.unit}`;
            if (item.comparison) line += ` (${item.comparison})`;
            if (item.trend) {
              const trendEmoji =
                item.trend === "up" ? "↑" : item.trend === "down" ? "↓" : "→";
              line += ` ${trendEmoji}`;
            }
            return line;
          })
          .join("\n");

        return `\n## ${result.title}\n${itemsText}\n(数据来源: ${result.source}, 获取时间: ${result.fetchedAt})`;
      })
      .join("\n");

    return `${originalContent}\n\n--- 以下是获取的真实数据 ---\n${dataSection}`;
  }

  /**
   * 完整的数据获取流程
   */
  async processDataFetching(content: string): Promise<DataFetchingResult> {
    // 1. 检测是否需要数据获取
    const detection = this.detectDataFetchingNeed(content);

    if (!detection.needsFetching) {
      return {
        needsFetching: false,
        queries: [],
        fetchedData: [],
        enrichedContent: content,
      };
    }

    this.logger.log(
      `[processDataFetching] Data fetching needed. Intent: ${detection.intent}, Queries: ${detection.queries.join(", ")}`,
    );

    // 2. 获取数据
    const fetchedData = await this.fetchData(detection.queries);

    // 3. 整合数据到内容
    const enrichedContent = this.enrichContent(content, fetchedData);

    return {
      needsFetching: true,
      detectedIntent: detection.intent,
      queries: detection.queries,
      fetchedData,
      enrichedContent,
    };
  }
}
