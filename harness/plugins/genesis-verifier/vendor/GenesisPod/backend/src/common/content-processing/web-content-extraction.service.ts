/**
 * Web Content Extraction Service
 *
 * 通用 Web 内容提取服务，集成多个外部 API：
 * - Jina AI Reader - 高质量 URL 转 Markdown（免费）
 * - Firecrawl - 复杂网站抓取（付费）
 * - Tavily - 搜索 + 深度研究（付费）
 *
 * 从 ai-teams/utils 迁移至 common 模块
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
// Import from credentials SOURCE, not the ai-engine/facade barrel: this service
// is injected into ContentFetchService, which the harness facade.providers wiring
// pulls into the facade barrel's transitive closure. Importing the barrel here
// closes a circular chain (facade → skills → harness → critique → facade.providers
// → content-fetch.service → web-content) that left WebContentExtractionService
// undefined at boot ("can't resolve ContentFetchService arg [1]"). (common/ is
// exempt from the ai-app facade-boundary rule.)
import {
  ToolKeyResolverService,
  NoToolKeyError,
} from "@/modules/platform/credentials/resolution/tool-key-resolver/tool-key-resolver.service";
import { RequestContext } from "@/common/context/request-context";

/**
 * 内容提取结果
 */
export interface WebExtractedContent {
  url: string;
  title?: string;
  description?: string;
  content: string; // 主要内容（Markdown 格式）
  contentLength: number;
  author?: string;
  publishedDate?: string;
  siteName?: string;
  favicon?: string;
  image?: string;
  links?: string[];
  source: "jina" | "firecrawl" | "fallback";
  error?: string;
}

/**
 * 深度研究结果
 */
export interface DeepResearchResult {
  query: string;
  sources: {
    url: string;
    title: string;
    content: string;
    relevance: number;
  }[];
  synthesis: string; // 综合分析
  keyPoints: string[];
  error?: string;
}

/**
 * Web 内容提取服务
 */
@Injectable()
export class WebContentExtractionService {
  private readonly logger = new Logger(WebContentExtractionService.name);

  // Jina AI Reader API (免费，有速率限制)
  private readonly JINA_READER_URL = "https://r.jina.ai/";

  // Firecrawl API (付费，更强大)
  private readonly FIRECRAWL_API_URL = "https://api.firecrawl.dev/v1";

  // Tavily API (付费，专业搜索)
  private readonly TAVILY_API_URL = "https://api.tavily.com";

  // API Keys 缓存（避免频繁查询数据库）
  private apiKeyCache: {
    jina?: string;
    firecrawl?: string;
    tavily?: string;
    cachedAt: number;
  } = { cachedAt: 0 };
  private readonly API_KEY_CACHE_TTL = 60000; // 1分钟

  /** provider → BYOK toolId（resolveToolKey 内部映射到 secret name）。 */
  private readonly PROVIDER_TOOL_ID: Record<
    "jina" | "firecrawl" | "tavily",
    string
  > = {
    jina: "jina",
    firecrawl: "firecrawl",
    tavily: "tavilyExtract",
  };

  // 内容缓存
  private contentCache = new Map<
    string,
    { data: WebExtractedContent; expiresAt: number }
  >();
  private readonly CACHE_TTL = 3600 * 1000; // 1小时

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly toolKeyResolver?: ToolKeyResolverService,
  ) {}

  /**
   * 获取抽取 API Key。
   * 2026-05-28 BYOK：有用户上下文时用户 Key 优先（不进共享 apiKeyCache，避免
   * 跨用户污染）；无 userId 的系统任务走 admin systemSetting + env（带缓存）。
   * STRICT 模式用户未配 Key → 返回 undefined（jina 免费仍可用，不静默借 admin）。
   */
  private async getApiKey(
    provider: "jina" | "firecrawl" | "tavily",
  ): Promise<string | undefined> {
    const userId = RequestContext.getUserId();
    if (userId && this.toolKeyResolver) {
      try {
        const resolved = await this.toolKeyResolver.resolveToolKey(
          this.PROVIDER_TOOL_ID[provider],
          userId,
        );
        return resolved?.value ?? undefined;
      } catch (error) {
        if (error instanceof NoToolKeyError) return undefined;
        throw error;
      }
    }

    const now = Date.now();

    // 检查缓存是否有效
    if (now - this.apiKeyCache.cachedAt < this.API_KEY_CACHE_TTL) {
      return this.apiKeyCache[provider];
    }

    // 从数据库加载所有 API Key
    try {
      const settings = await this.prisma.systemSetting.findMany({
        where: {
          key: {
            in: [
              "extraction.jina.apiKey",
              "extraction.firecrawl.apiKey",
              "extraction.tavily.apiKey",
            ],
          },
        },
      });

      this.apiKeyCache = {
        cachedAt: now,
      };

      for (const setting of settings) {
        try {
          if (!setting.value) continue;
          const value = JSON.parse(setting.value);
          if (setting.key === "extraction.jina.apiKey") {
            this.apiKeyCache.jina = value;
          } else if (setting.key === "extraction.firecrawl.apiKey") {
            this.apiKeyCache.firecrawl = value;
          } else if (setting.key === "extraction.tavily.apiKey") {
            this.apiKeyCache.tavily = value;
          }
        } catch {
          // 如果不是 JSON，直接使用值
          if (setting.key === "extraction.jina.apiKey") {
            this.apiKeyCache.jina = setting.value ?? undefined;
          } else if (setting.key === "extraction.firecrawl.apiKey") {
            this.apiKeyCache.firecrawl = setting.value ?? undefined;
          } else if (setting.key === "extraction.tavily.apiKey") {
            this.apiKeyCache.tavily = setting.value ?? undefined;
          }
        }
      }

      // 如果数据库没有配置，回退到环境变量
      if (!this.apiKeyCache.jina) {
        this.apiKeyCache.jina = process.env.JINA_API_KEY;
      }
      if (!this.apiKeyCache.firecrawl) {
        this.apiKeyCache.firecrawl = process.env.FIRECRAWL_API_KEY;
      }
      if (!this.apiKeyCache.tavily) {
        this.apiKeyCache.tavily = process.env.TAVILY_API_KEY;
      }

      return this.apiKeyCache[provider];
    } catch (error) {
      this.logger.error(`Failed to load API keys from database: ${error}`);
      // 回退到环境变量
      if (provider === "jina") return process.env.JINA_API_KEY;
      if (provider === "firecrawl") return process.env.FIRECRAWL_API_KEY;
      if (provider === "tavily") return process.env.TAVILY_API_KEY;
      return undefined;
    }
  }

  /**
   * 提取 URL 内容（智能选择最佳方式）
   */
  async extractContent(url: string): Promise<WebExtractedContent> {
    // 检查缓存
    const cached = this.getCache(url);
    if (cached) {
      this.logger.debug(`Cache hit for URL: ${url}`);
      return cached;
    }

    let result: WebExtractedContent;
    const firecrawlKey = await this.getApiKey("firecrawl");

    try {
      // 优先使用 Jina AI Reader（免费且高质量）
      result = await this.extractWithJina(url);

      // 如果 Jina 返回内容太短，尝试 Firecrawl
      if (result.contentLength < 500 && firecrawlKey && !result.error) {
        this.logger.log(`Jina content too short, trying Firecrawl for: ${url}`);
        const firecrawlResult = await this.extractWithFirecrawl(url);
        if (
          firecrawlResult.contentLength > result.contentLength &&
          !firecrawlResult.error
        ) {
          result = firecrawlResult;
        }
      }
    } catch (error) {
      this.logger.error(`Primary extraction failed for ${url}: ${error}`);

      // 回退到 Firecrawl
      if (firecrawlKey) {
        try {
          result = await this.extractWithFirecrawl(url);
        } catch (firecrawlError) {
          this.logger.error(`Firecrawl also failed: ${firecrawlError}`);
          result = this.createErrorResult(url, "All extraction methods failed");
        }
      } else {
        result = this.createErrorResult(
          url,
          error instanceof Error ? error.message : "Unknown error",
        );
      }
    }

    // 缓存结果
    this.setCache(url, result);

    return result;
  }

  /**
   * 使用 Jina AI Reader 提取内容
   */
  private async extractWithJina(url: string): Promise<WebExtractedContent> {
    const jinaUrl = `${this.JINA_READER_URL}${url}`;
    const jinaApiKey = await this.getApiKey("jina");

    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Return-Format": "markdown",
      "X-With-Links-Summary": "true",
      "X-With-Images-Summary": "true",
    };

    // 如果有 API Key，添加到请求头
    if (jinaApiKey) {
      headers["Authorization"] = `Bearer ${jinaApiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

    try {
      const response = await fetch(jinaUrl, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Jina Reader failed: HTTP ${response.status}`);
      }

      const data = await response.json();

      return {
        url,
        title: data.title || undefined,
        description: data.description || undefined,
        content: data.content || "",
        contentLength: (data.content || "").length,
        author: data.author || undefined,
        publishedDate: data.publishedTime || undefined,
        siteName: data.siteName || undefined,
        favicon: data.favicon || undefined,
        image: data.image || undefined,
        links: data.links || [],
        source: "jina",
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if ((error as Error).name === "AbortError") {
        throw new Error("Jina Reader timeout");
      }
      throw error;
    }
  }

  /**
   * 使用 Firecrawl 提取内容
   */
  private async extractWithFirecrawl(
    url: string,
  ): Promise<WebExtractedContent> {
    const firecrawlApiKey = await this.getApiKey("firecrawl");
    if (!firecrawlApiKey) {
      throw new Error("Firecrawl API key not configured");
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60秒超时

    try {
      const response = await fetch(`${this.FIRECRAWL_API_URL}/scrape`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${firecrawlApiKey}`,
        },
        body: JSON.stringify({
          url,
          formats: ["markdown", "links"],
          onlyMainContent: true,
          waitFor: 3000, // 等待 JS 渲染
          timeout: 30000,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Firecrawl failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const result = data.data || data;

      return {
        url,
        title: result.metadata?.title || undefined,
        description: result.metadata?.description || undefined,
        content: result.markdown || result.content || "",
        contentLength: (result.markdown || result.content || "").length,
        author: result.metadata?.author || undefined,
        publishedDate: result.metadata?.publishedTime || undefined,
        siteName: result.metadata?.siteName || undefined,
        favicon: result.metadata?.favicon || undefined,
        image: result.metadata?.ogImage || undefined,
        links: result.links || [],
        source: "firecrawl",
      };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * 批量提取多个 URL 的内容
   */
  async extractMultiple(
    urls: string[],
    maxConcurrent = 3,
  ): Promise<WebExtractedContent[]> {
    const results: WebExtractedContent[] = [];

    // 分批处理
    for (let i = 0; i < urls.length; i += maxConcurrent) {
      const batch = urls.slice(i, i + maxConcurrent);
      const batchResults = await Promise.all(
        batch.map((url) => this.extractContent(url)),
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * 深度研究（使用 Tavily）
   */
  async deepResearch(
    query: string,
    options?: {
      maxResults?: number;
      searchDepth?: "basic" | "advanced";
      includeRawContent?: boolean;
    },
  ): Promise<DeepResearchResult> {
    const tavilyApiKey = await this.getApiKey("tavily");
    if (!tavilyApiKey) {
      return {
        query,
        sources: [],
        synthesis: "",
        keyPoints: [],
        error: "Tavily API key not configured",
      };
    }

    const {
      maxResults = 10,
      searchDepth = "advanced",
      includeRawContent = true,
    } = options || {};

    try {
      // Step 1: 执行搜索
      const searchResponse = await fetch(`${this.TAVILY_API_URL}/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          api_key: tavilyApiKey,
          query,
          search_depth: searchDepth,
          max_results: maxResults,
          include_raw_content: includeRawContent,
          include_answer: true,
        }),
      });

      if (!searchResponse.ok) {
        throw new Error(`Tavily search failed: ${searchResponse.status}`);
      }

      const searchData = await searchResponse.json();

      // 解析搜索结果
      const sources = (searchData.results || []).map(
        (r: {
          url: string;
          title: string;
          content: string;
          raw_content?: string;
          score: number;
        }) => ({
          url: r.url,
          title: r.title,
          content: r.raw_content || r.content,
          relevance: r.score || 0,
        }),
      );

      // 提取关键点
      const keyPoints = this.extractKeyPoints(sources);

      return {
        query,
        sources,
        synthesis: searchData.answer || "",
        keyPoints,
      };
    } catch (error) {
      this.logger.error(`Deep research failed: ${error}`);
      return {
        query,
        sources: [],
        synthesis: "",
        keyPoints: [],
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * 从多个来源提取关键点
   */
  private extractKeyPoints(
    sources: { title: string; content: string }[],
  ): string[] {
    const keyPoints: string[] = [];

    for (const source of sources.slice(0, 5)) {
      // 提取标题作为关键点
      if (source.title && source.title.length < 100) {
        keyPoints.push(source.title);
      }

      // 提取内容中的关键句子（包含数字或关键词的句子）
      const sentences = source.content.split(/[.!?。！？]/);
      for (const sentence of sentences.slice(0, 3)) {
        const trimmed = sentence.trim();
        if (
          trimmed.length > 20 &&
          trimmed.length < 200 &&
          (trimmed.match(/\d+/) ||
            trimmed.includes("：") ||
            trimmed.includes(":"))
        ) {
          keyPoints.push(trimmed);
        }
      }
    }

    // 去重并限制数量
    return [...new Set(keyPoints)].slice(0, 10);
  }

  /**
   * 生成 AI 上下文（用于增强 AI 理解）
   */
  generateAIContext(contents: WebExtractedContent[]): string {
    if (contents.length === 0) return "";

    const sections: string[] = [];

    for (const content of contents) {
      if (content.error || !content.content) continue;

      let section = `\n---\n## 来源: ${content.title || content.url}\n`;

      if (content.siteName) {
        section += `**网站**: ${content.siteName}\n`;
      }

      if (content.author) {
        section += `**作者**: ${content.author}\n`;
      }

      if (content.publishedDate) {
        section += `**发布日期**: ${content.publishedDate}\n`;
      }

      section += `\n${content.content}\n`;

      sections.push(section);
    }

    if (sections.length === 0) return "";

    return `\n\n【参考资料】\n以下是从用户提供的链接中提取的内容，请基于这些内容进行分析和回答：\n${sections.join("\n")}`;
  }

  /**
   * 生成深度研究的 AI 上下文
   */
  generateResearchContext(research: DeepResearchResult): string {
    if (research.error || research.sources.length === 0) return "";

    let context = `\n\n【深度研究结果】\n查询: "${research.query}"\n`;

    if (research.synthesis) {
      context += `\n**综合分析**:\n${research.synthesis}\n`;
    }

    if (research.keyPoints.length > 0) {
      context += `\n**关键要点**:\n`;
      research.keyPoints.forEach((point, i) => {
        context += `${i + 1}. ${point}\n`;
      });
    }

    context += `\n**来源详情**:\n`;
    for (const source of research.sources.slice(0, 5)) {
      context += `\n### ${source.title}\n`;
      context += `URL: ${source.url}\n`;
      context += `相关度: ${(source.relevance * 100).toFixed(0)}%\n`;
      // 限制每个来源的内容长度
      const truncatedContent =
        source.content.length > 2000
          ? source.content.slice(0, 2000) + "..."
          : source.content;
      context += `\n${truncatedContent}\n`;
    }

    return context;
  }

  // ==================== 缓存方法 ====================

  private getCache(url: string): WebExtractedContent | null {
    const cached = this.contentCache.get(url);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
    this.contentCache.delete(url);
    return null;
  }

  private setCache(url: string, data: WebExtractedContent): void {
    this.contentCache.set(url, {
      data,
      expiresAt: Date.now() + this.CACHE_TTL,
    });
  }

  private createErrorResult(url: string, error: string): WebExtractedContent {
    return {
      url,
      content: "",
      contentLength: 0,
      source: "fallback",
      error,
    };
  }

  // ==================== 清理方法 ====================

  /**
   * 清理过期缓存
   */
  cleanupCache(): void {
    const now = Date.now();
    for (const [key, value] of this.contentCache.entries()) {
      if (value.expiresAt < now) {
        this.contentCache.delete(key);
      }
    }
  }
}
