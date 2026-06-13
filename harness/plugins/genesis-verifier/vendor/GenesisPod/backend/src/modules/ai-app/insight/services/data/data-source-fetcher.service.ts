import { Injectable, Logger } from "@nestjs/common";
import {
  ToolRegistry,
  FederalRegisterTool,
  CongressGovTool,
  WhiteHouseNewsTool,
} from "@/modules/ai-harness/facade";
import { ChatFacade, RAGFacade } from "@/modules/ai-harness/facade";
import {
  DataSourceType,
  DataSourceResult,
} from "../../types/data-source.types";
import { ResearchTopic } from "@prisma/client";

/**
 * Data Source Fetcher Service
 *
 * 负责从各种数据源获取实际数据：
 * - Web 搜索
 * - 学术论文 (arXiv)
 * - GitHub 仓库
 * - HackerNews
 * - 本地知识库 (RAG)
 * - 政策数据源 (Federal Register, Congress, WhiteHouse)
 * - 社交媒体 (X/Twitter via Grok)
 */
@Injectable()
export class DataSourceFetcherService {
  private readonly logger = new Logger(DataSourceFetcherService.name);

  /** 当前搜索的 topic（用于 LOCAL 数据源获取 knowledgeBaseIds） */
  private currentTopic: ResearchTopic | null = null;

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly federalRegisterTool: FederalRegisterTool,
    private readonly congressGovTool: CongressGovTool,
    private readonly whiteHouseNewsTool: WhiteHouseNewsTool,
    private readonly chatFacade: ChatFacade,
    private readonly ragFacade: RAGFacade,
  ) {}

  /**
   * 设置当前 topic（用于 LOCAL 数据源）
   */
  setCurrentTopic(topic: ResearchTopic | null): void {
    this.currentTopic = topic;
  }

  /**
   * 执行具体的搜索操作
   */
  async executeSearch(
    source: DataSourceType,
    query: string,
    maxResults: number,
    since?: Date,
  ): Promise<DataSourceResult[]> {
    switch (source) {
      case DataSourceType.WEB:
        return this.searchWeb(query, maxResults, since);

      case DataSourceType.ACADEMIC:
        return this.searchAcademic(query, maxResults);

      case DataSourceType.GITHUB:
        return this.searchGithub(query, maxResults);

      case DataSourceType.HACKERNEWS:
        return this.searchHackerNews(query, maxResults);

      case DataSourceType.RSS:
        this.logger.warn("RSS search not implemented yet");
        return [];

      case DataSourceType.LOCAL:
        return this.searchLocal(query, maxResults);

      case DataSourceType.FEDERAL_REGISTER:
        return this.searchFederalRegister(query, maxResults);

      case DataSourceType.CONGRESS:
        return this.searchCongress(query, maxResults);

      case DataSourceType.WHITEHOUSE:
        return this.searchWhiteHouse(query, maxResults);

      case DataSourceType.SOCIAL_X:
        return this.searchSocialX(query, maxResults);

      default:
        this.logger.warn(`Unknown data source type: ${source}`);
        return [];
    }
  }

  // ============================================================================
  // Web Search
  // ============================================================================

  /**
   * Web 搜索
   * 通过 ToolRegistry 调用 web-search 工具
   */
  private async searchWeb(
    query: string,
    maxResults: number,
    since?: Date,
  ): Promise<DataSourceResult[]> {
    this.logger.log(
      `[searchWeb] Calling web-search tool via ToolRegistry with query="${query}", maxResults=${maxResults}, since=${since?.toISOString() || "none"}`,
    );

    const webSearchTool = this.toolRegistry.tryGet("web-search");
    if (!webSearchTool) {
      this.logger.error(
        "[searchWeb] web-search tool not registered in ToolRegistry",
      );
      return [];
    }

    try {
      const toolResult = await webSearchTool.execute(
        {
          query,
          numResults: maxResults,
        },
        this.createToolContext("web-search"),
      );

      if (!toolResult.success || !toolResult.data) {
        this.logger.warn(
          `[searchWeb] Search failed or no results: ${toolResult.error?.message || "unknown error"}`,
        );
        return [];
      }

      const searchData = toolResult.data as {
        results: Array<{
          title: string;
          url: string;
          content: string;
          publishedDate?: string;
          domain?: string;
          score?: number;
          rawScore?: number;
        }>;
        success: boolean;
        provider?: string;
      };

      this.logger.log(
        `[searchWeb] Tool response: success=${searchData.success}, provider=${searchData.provider || "unknown"}, results=${searchData.results?.length || 0}`,
      );

      if (!searchData.success || !searchData.results) {
        this.logger.warn("[searchWeb] Tool returned unsuccessful result");
        return [];
      }

      return searchData.results.map((result) => ({
        sourceType: DataSourceType.WEB,
        title: result.title,
        url: result.url,
        snippet: result.content,
        domain: result.domain,
        publishedAt: result.publishedDate
          ? new Date(result.publishedDate)
          : undefined,
        metadata: {
          score: result.score,
          rawScore: result.rawScore,
        },
      }));
    } catch (error) {
      this.logger.error(
        `[searchWeb] Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  // ============================================================================
  // Academic Search
  // ============================================================================

  /**
   * 学术搜索 (OpenAlex 优先，失败自动 fallback 到 Semantic Scholar → ArXiv → PubMed)
   * OpenAlex: 2.5 亿论文、不限流（polite pool）、覆盖全学科
   */
  private async searchAcademic(
    query: string,
    maxResults: number,
  ): Promise<DataSourceResult[]> {
    // 按优先级尝试: OpenAlex → Semantic Scholar
    const primarySources = ["openalex-search", "semantic-scholar"];
    for (const toolId of primarySources) {
      this.logger.log(`[searchAcademic] Trying ${toolId}: "${query}"`);
      const results = await this.searchViaFallbackTool(
        toolId,
        query,
        maxResults,
      );
      if (results.length > 0) {
        this.logger.log(
          `[searchAcademic] ${toolId} returned ${results.length} results`,
        );
        return results;
      }
    }

    // Fallback: ArXiv（有限流风险）
    const arxivResults = await this.searchArxiv(query, maxResults);
    if (arxivResults.length > 0) {
      return arxivResults;
    }

    // 最后 fallback: PubMed
    const pubmedResults = await this.searchViaFallbackTool(
      "pubmed",
      query,
      maxResults,
    );
    if (pubmedResults.length > 0) {
      return pubmedResults;
    }

    this.logger.warn(
      "[searchAcademic] All academic sources exhausted, no results",
    );
    return [];
  }

  /**
   * ArXiv 搜索（内部方法）
   */
  private async searchArxiv(
    query: string,
    maxResults: number,
  ): Promise<DataSourceResult[]> {
    try {
      this.logger.log(`[searchArxiv] Searching arXiv: "${query}"`);

      const arxivTool = this.toolRegistry.tryGet("arxiv-search");
      if (!arxivTool) {
        this.logger.error(
          "[searchArxiv] arxiv-search tool not registered in ToolRegistry",
        );
        return [];
      }

      const result = await arxivTool.execute(
        {
          query,
          maxResults,
          sortBy: "relevance",
        },
        this.createToolContext("arxiv-search"),
      );

      if (!result.success || !result.data) {
        this.logger.warn(
          `[searchArxiv] No results or error: ${result.error?.message}`,
        );
        return [];
      }

      const arxivData = result.data as {
        success: boolean;
        papers: Array<{
          id: string;
          title: string;
          summary: string;
          authors: string[];
          published: string;
          updated: string;
          categories: string[];
          pdfUrl: string;
          absUrl: string;
        }>;
        totalResults: number;
        query: string;
      };

      if (!arxivData.papers || arxivData.papers.length === 0) {
        this.logger.warn("[searchArxiv] No papers in response");
        return [];
      }

      return arxivData.papers.map((paper) => ({
        sourceType: DataSourceType.ACADEMIC,
        title: paper.title,
        url: paper.absUrl,
        snippet: paper.summary?.slice(0, 500) || "",
        publishedAt: paper.published ? new Date(paper.published) : undefined,
        domain: "arxiv.org",
        metadata: {
          arxivId: paper.id,
          authors: paper.authors,
          categories: paper.categories,
          pdfUrl: paper.pdfUrl,
          updated: paper.updated,
        },
      }));
    } catch (error) {
      this.logger.error(
        `[searchArxiv] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * 通用工具 fallback 搜索
   */
  private async searchViaFallbackTool(
    toolId: string,
    query: string,
    maxResults: number,
  ): Promise<DataSourceResult[]> {
    try {
      const tool = this.toolRegistry.tryGet(toolId);
      if (!tool) {
        return [];
      }

      const result = await tool.execute(
        { query, maxResults },
        this.createToolContext(toolId),
      );

      if (!result.success || !result.data) {
        return [];
      }

      // 统一转换结果格式
      const data = result.data as Record<string, unknown>;
      const items =
        (data.papers as Array<Record<string, unknown>>) ||
        (data.results as Array<Record<string, unknown>>) ||
        (data.works as Array<Record<string, unknown>>) ||
        [];

      return items.map((item) => ({
        sourceType: DataSourceType.ACADEMIC,
        title: String(item.title || ""),
        url: String(item.url || item.absUrl || item.doi || ""),
        snippet: String(item.summary || item.abstract || "").slice(0, 500),
        publishedAt:
          item.published || item.publishedDate
            ? new Date(String(item.published || item.publishedDate))
            : undefined,
        domain: toolId.replace("-search", ""),
        metadata: { source: toolId },
      }));
    } catch {
      return [];
    }
  }

  // ============================================================================
  // GitHub Search
  // ============================================================================

  /**
   * GitHub 搜索 (使用 GithubSearchTool)
   */
  private async searchGithub(
    query: string,
    maxResults: number,
  ): Promise<DataSourceResult[]> {
    try {
      this.logger.log(`[searchGithub] Searching GitHub: "${query}"`);

      const githubTool = this.toolRegistry.tryGet("github-search");
      if (!githubTool) {
        this.logger.error(
          "[searchGithub] github-search tool not registered in ToolRegistry",
        );
        return [];
      }

      const result = await githubTool.execute(
        {
          query,
          maxResults,
          sort: "stars",
        },
        this.createToolContext("github-search"),
      );

      if (!result.success || !result.data) {
        this.logger.warn(
          `[searchGithub] No results or error: ${result.error?.message}`,
        );
        return [];
      }

      const githubData = result.data as {
        success: boolean;
        repositories: Array<{
          fullName: string;
          description: string | null;
          htmlUrl: string;
          language: string | null;
          stargazersCount: number;
          forksCount: number;
          openIssuesCount: number;
          topics: string[];
          createdAt: string;
          updatedAt: string;
          pushedAt: string;
          owner: {
            login: string;
            avatarUrl: string;
            type: string;
          };
        }>;
        totalCount: number;
        query: string;
      };

      if (!githubData.repositories || githubData.repositories.length === 0) {
        this.logger.warn("[searchGithub] No repositories in response");
        return [];
      }

      return githubData.repositories.map((repo) => ({
        sourceType: DataSourceType.GITHUB,
        title: repo.fullName,
        url: repo.htmlUrl,
        snippet:
          repo.description ||
          `${repo.language || "Unknown language"} repository with ${repo.stargazersCount} stars`,
        publishedAt: repo.createdAt ? new Date(repo.createdAt) : undefined,
        domain: "github.com",
        metadata: {
          language: repo.language,
          stars: repo.stargazersCount,
          forks: repo.forksCount,
          openIssues: repo.openIssuesCount,
          topics: repo.topics,
          owner: repo.owner.login,
          ownerType: repo.owner.type,
          updatedAt: repo.updatedAt,
          pushedAt: repo.pushedAt,
        },
      }));
    } catch (error) {
      this.logger.error(
        `[searchGithub] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  // ============================================================================
  // HackerNews Search
  // ============================================================================

  /**
   * HackerNews 搜索
   */
  private async searchHackerNews(
    query: string,
    maxResults: number,
  ): Promise<DataSourceResult[]> {
    try {
      this.logger.log(`[searchHackerNews] Searching: "${query}"`);

      const hackerNewsTool = this.toolRegistry.tryGet("hackernews-search");
      if (!hackerNewsTool) {
        this.logger.error(
          "[searchHackerNews] hackernews-search tool not registered in ToolRegistry",
        );
        return [];
      }

      const result = await hackerNewsTool.execute(
        {
          query,
          maxResults,
          tags: "story",
        },
        this.createToolContext("hackernews-search"),
      );

      if (!result.success || !result.data) {
        this.logger.warn(
          `[searchHackerNews] No results or error: ${result.error?.message}`,
        );
        return [];
      }

      const hnData = result.data as {
        success: boolean;
        hits: Array<{
          title: string;
          url: string | null;
          hnUrl: string;
          author: string;
          points: number;
          numComments: number;
          createdAt: string;
          storyText: string | null;
        }>;
        totalHits: number;
        query: string;
      };

      if (!hnData.hits || hnData.hits.length === 0) {
        this.logger.warn("[searchHackerNews] No hits in response");
        return [];
      }

      return hnData.hits.map((hit) => ({
        sourceType: DataSourceType.HACKERNEWS,
        title: hit.title,
        url: hit.url || hit.hnUrl,
        snippet:
          hit.storyText ||
          `${hit.points} points | ${hit.numComments} comments by ${hit.author}`,
        publishedAt: hit.createdAt ? new Date(hit.createdAt) : undefined,
        domain: "news.ycombinator.com",
        metadata: {
          author: hit.author,
          points: hit.points,
          comments: hit.numComments,
          hnUrl: hit.hnUrl,
        },
      }));
    } catch (error) {
      this.logger.error(
        `[searchHackerNews] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  // ============================================================================
  // Local Knowledge Base (RAG) Search
  // ============================================================================

  /**
   * 本地知识库搜索 (使用 RAG 向量检索)
   */
  private async searchLocal(
    query: string,
    maxResults: number,
  ): Promise<DataSourceResult[]> {
    try {
      const topicConfig = this.currentTopic?.topicConfig as Record<
        string,
        unknown
      > | null;
      const knowledgeBaseIds = topicConfig?.knowledgeBaseIds as
        | string[]
        | undefined;

      if (!knowledgeBaseIds || knowledgeBaseIds.length === 0) {
        this.logger.debug(
          "[searchLocal] No knowledge bases configured for this topic",
        );
        return [];
      }

      this.logger.log(
        `[searchLocal] Searching ${knowledgeBaseIds.length} knowledge bases: "${query}"`,
      );

      const queryEmbedding = await this.ragFacade.embeddingGenerate(query);
      if (!queryEmbedding) {
        this.logger.warn(
          "[searchLocal] Failed to generate embedding for query",
        );
        return [];
      }

      const searchResults = await this.ragFacade.vectorSimilaritySearch(
        queryEmbedding.embedding,
        {
          limit: maxResults,
          threshold: 0.3,
          knowledgeBaseIds,
        },
      );

      this.logger.log(
        `[searchLocal] Found ${searchResults.length} results from knowledge bases`,
      );

      if (searchResults.length > 0) {
        this.logger.log(
          `[searchLocal] ★ Knowledge base matched! Topic: ${this.currentTopic?.name}, ` +
            `Query: "${query}", Results: ${searchResults.length}, ` +
            `KBs: [${knowledgeBaseIds.join(", ")}]`,
        );
      }

      return searchResults.map((result) => ({
        sourceType: DataSourceType.LOCAL,
        title: this.extractTitle(result.parentContent || result.content),
        url: `kb://${result.documentId}#${result.childChunkId}`,
        snippet: result.content?.slice(0, 500) || "",
        domain: "knowledge-base",
        metadata: {
          similarity: result.similarity,
          documentId: result.documentId,
          chunkId: result.childChunkId,
          parentChunkId: result.parentChunkId,
          knowledgeBaseSource: true,
        },
      }));
    } catch (error) {
      this.logger.error(
        `[searchLocal] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * 从内容中提取标题
   */
  private extractTitle(content: string): string {
    if (!content) return "Knowledge Base Entry";

    const markdownTitleMatch = content.match(/^#+\s+(.+)$/m);
    if (markdownTitleMatch) {
      return markdownTitleMatch[1].slice(0, 100);
    }

    const firstLine = content.split("\n")[0].trim();
    return firstLine.slice(0, 100) || "Knowledge Base Entry";
  }

  // ============================================================================
  // Policy Research Data Sources
  // ============================================================================

  /**
   * 联邦公报搜索 (Federal Register)
   */
  private async searchFederalRegister(
    query: string,
    maxResults: number,
  ): Promise<DataSourceResult[]> {
    try {
      this.logger.log(`[searchFederalRegister] Searching: "${query}"`);

      const result = await this.federalRegisterTool.execute(
        {
          query,
          maxResults,
        },
        this.createToolContext("federal-register"),
      );

      if (!result.success || !result.data?.documents) {
        this.logger.warn(
          `[searchFederalRegister] No results or error: ${result.error?.message}`,
        );
        return [];
      }

      return result.data.documents.map((doc) => ({
        sourceType: DataSourceType.FEDERAL_REGISTER,
        title: doc.title,
        url: doc.htmlUrl,
        snippet: doc.abstract || doc.title,
        publishedAt: doc.publicationDate
          ? new Date(doc.publicationDate)
          : undefined,
        domain: "federalregister.gov",
        metadata: {
          documentType: doc.type,
          agencies: doc.agencies,
          documentNumber: doc.documentNumber,
        },
      }));
    } catch (error) {
      this.logger.error(
        `[searchFederalRegister] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * 国会立法搜索 (Congress.gov)
   */
  private async searchCongress(
    query: string,
    maxResults: number,
  ): Promise<DataSourceResult[]> {
    try {
      this.logger.log(`[searchCongress] Searching: "${query}"`);

      const result = await this.congressGovTool.execute(
        {
          query,
          limit: maxResults,
          congress: this.getCurrentCongress(),
        },
        this.createToolContext("congress-gov"),
      );

      if (!result.success || !result.data?.bills) {
        this.logger.warn(
          `[searchCongress] No results or error: ${result.error?.message}`,
        );
        return [];
      }

      return result.data.bills.map((bill) => ({
        sourceType: DataSourceType.CONGRESS,
        title: bill.shortTitle || bill.title,
        url: bill.url,
        snippet: `${bill.number} - ${bill.title}${bill.latestAction ? ` | Latest: ${bill.latestAction.text}` : ""}`,
        publishedAt: bill.introducedDate
          ? new Date(bill.introducedDate)
          : undefined,
        domain: "congress.gov",
        metadata: {
          billNumber: bill.number,
          billType: bill.type,
          congress: bill.congress,
          sponsors: bill.sponsors,
          policyArea: bill.policyArea,
          latestAction: bill.latestAction,
        },
      }));
    } catch (error) {
      this.logger.error(
        `[searchCongress] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * 白宫新闻搜索 (White House)
   */
  private async searchWhiteHouse(
    query: string,
    maxResults: number,
  ): Promise<DataSourceResult[]> {
    try {
      this.logger.log(`[searchWhiteHouse] Searching: "${query}"`);

      const result = await this.whiteHouseNewsTool.execute(
        {
          query,
          limit: maxResults,
        },
        this.createToolContext("whitehouse-news"),
      );

      if (!result.success || !result.data?.items) {
        this.logger.warn(
          `[searchWhiteHouse] No results or error: ${result.error?.message}`,
        );
        return [];
      }

      return result.data.items.map((item) => ({
        sourceType: DataSourceType.WHITEHOUSE,
        title: item.title,
        url: item.url,
        snippet: item.summary || item.title,
        publishedAt: item.date ? new Date(item.date) : undefined,
        domain: "whitehouse.gov",
        metadata: {
          contentType: item.type,
        },
      }));
    } catch (error) {
      this.logger.error(
        `[searchWhiteHouse] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  // ============================================================================
  // Social Media Search
  // ============================================================================

  /**
   * X/Twitter 社媒搜索
   * 主方案：使用 Grok Live Search
   * 降级方案：使用 Web Search + site:x.com
   */
  async searchSocialX(
    query: string,
    maxResults: number,
  ): Promise<DataSourceResult[]> {
    this.logger.log(`[searchSocialX] Searching: "${query}"`);

    try {
      const results = await this.searchSocialXViaGrok(query, maxResults);
      if (results.length > 0) {
        this.logger.log(
          `[searchSocialX] Grok Live Search returned ${results.length} results`,
        );
        return results;
      }
    } catch (error) {
      this.logger.warn(
        `[searchSocialX] Grok Live Search failed, falling back to web search: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return this.searchSocialXViaWebSearch(query, maxResults);
  }

  /**
   * 通过 Grok Live Search 获取 X/Twitter 内容
   */
  private async searchSocialXViaGrok(
    query: string,
    maxResults: number,
    retries = 2,
  ): Promise<DataSourceResult[]> {
    const aiModels = await this.chatFacade.getAvailableModels();
    const grokModel = aiModels.find(
      (m: { id: string; provider: string }) => m.provider === "xai",
    );

    if (!grokModel) {
      this.logger.warn(
        "[searchSocialXViaGrok] No xAI/Grok model available, skipping",
      );
      return [];
    }

    const systemPrompt = `You are a social media analyst. Search X/Twitter for recent discussions about the given topic.
Return results in JSON format:
{
  "trends": [
    {
      "title": "Brief title describing the discussion point",
      "url": "https://x.com/username/status/xxx",
      "author": "@username",
      "content": "Key quote or summary of the post",
      "engagement": { "likes": 0, "retweets": 0, "replies": 0 },
      "sentiment": "positive|negative|neutral",
      "publishedAt": "2026-01-26"
    }
  ],
  "summary": "Brief overview of the social media discourse",
  "dominantSentiment": "positive|negative|neutral|mixed"
}
Focus on high-engagement posts from credible accounts. Provide ${maxResults} most relevant posts.`;

    const userPrompt = `Search X/Twitter for recent discussions about: "${query}"

Return the ${maxResults} most relevant and high-engagement posts in the specified JSON format.`;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await this.chatFacade.chat({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          operationName: "证据增强",
          model: grokModel.id,
          skipGuardrails: true, // 内部系统调用，搜索查询
          taskProfile: { creativity: "low", outputLength: "long" },
        });

        const results = this.parseSocialSearchResponse(response.content, query);
        if (results.length > 0) {
          return results;
        }

        this.logger.warn(
          `[searchSocialXViaGrok] Attempt ${attempt + 1}: No results parsed`,
        );
      } catch (error) {
        this.logger.warn(
          `[searchSocialXViaGrok] Attempt ${attempt + 1} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        if (attempt === retries) throw error;
      }
    }
    return [];
  }

  /**
   * 解析 Grok 社媒搜索响应
   */
  private parseSocialSearchResponse(
    content: string,
    originalQuery: string,
  ): DataSourceResult[] {
    const extractJson = (text: string): string | null => {
      const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonBlockMatch) return jsonBlockMatch[1];

      const codeBlockMatch = text.match(/```\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) return codeBlockMatch[1];

      const jsonObjectMatch = text.match(/\{[\s\S]*"trends"[\s\S]*\}/);
      if (jsonObjectMatch) return jsonObjectMatch[0];

      return null;
    };

    try {
      const jsonStr = extractJson(content);
      if (!jsonStr) {
        this.logger.warn(
          "[parseSocialSearchResponse] No JSON found in response",
        );
        return this.extractFallbackSocialResults(content, originalQuery);
      }

      const parsed = JSON.parse(jsonStr) as {
        trends?: Array<{
          title?: string;
          url?: string;
          author?: string;
          content?: string;
          engagement?: { likes?: number; retweets?: number; replies?: number };
          sentiment?: string;
          publishedAt?: string;
        }>;
      };

      if (!parsed.trends || !Array.isArray(parsed.trends)) {
        this.logger.warn(
          "[parseSocialSearchResponse] Invalid trends structure",
        );
        return this.extractFallbackSocialResults(content, originalQuery);
      }

      return parsed.trends.map((trend) => ({
        sourceType: DataSourceType.SOCIAL_X,
        title: trend.title || `X 讨论: ${originalQuery}`,
        url: trend.url || "https://x.com",
        snippet: trend.content || "",
        publishedAt: trend.publishedAt
          ? new Date(trend.publishedAt)
          : undefined,
        domain: "x.com",
        metadata: {
          author: trend.author,
          engagement: trend.engagement,
          sentiment: trend.sentiment,
          fetchedVia: "grok-live-search",
        },
      }));
    } catch (error) {
      this.logger.error(
        `[parseSocialSearchResponse] Parse failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.extractFallbackSocialResults(content, originalQuery);
    }
  }

  /**
   * JSON 解析失败时的降级提取
   */
  private extractFallbackSocialResults(
    content: string,
    originalQuery: string,
  ): DataSourceResult[] {
    const urlMatches =
      content.match(/https?:\/\/(?:x\.com|twitter\.com)\/\S+/g) || [];

    return urlMatches.slice(0, 5).map((url, index) => ({
      sourceType: DataSourceType.SOCIAL_X,
      title: `X/Twitter 讨论 #${index + 1}`,
      url,
      snippet: `关于「${originalQuery}」的社媒讨论`,
      domain: "x.com",
      metadata: {
        fetchedVia: "grok-live-search-fallback",
        parseMethod: "url-extraction",
      },
    }));
  }

  /**
   * 降级方案：通过 Web Search 获取 X 内容
   */
  private async searchSocialXViaWebSearch(
    query: string,
    maxResults: number,
  ): Promise<DataSourceResult[]> {
    this.logger.log(
      `[searchSocialXViaWebSearch] Fallback searching: "${query}"`,
    );

    try {
      const socialQuery = `${query} site:x.com OR site:twitter.com`;
      const webResults = await this.searchWeb(socialQuery, maxResults);

      return webResults.map((result) => ({
        ...result,
        sourceType: DataSourceType.SOCIAL_X,
        domain: "x.com",
        metadata: {
          ...result.metadata,
          fetchedVia: "web-search-fallback",
          sentiment: null,
        },
      }));
    } catch (error) {
      this.logger.error(
        `[searchSocialXViaWebSearch] Failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * 创建工具执行上下文
   */
  private createToolContext(
    toolId: string,
  ): import("@/modules/ai-harness/facade").ToolContext {
    return {
      executionId: `${toolId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      toolId,
      createdAt: new Date(),
      callerType: "orchestrator",
    };
  }

  /**
   * 计算当前国会届次
   */
  private getCurrentCongress(): number {
    const year = new Date().getFullYear();
    return Math.floor((year - 1789) / 2) + 1;
  }
}
