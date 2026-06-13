import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { ToolRegistry } from "@/modules/ai-harness/facade";
import type { ToolContext } from "@/modules/ai-harness/facade";
import { SearchSourcesDto } from "./dto";
import { APP_CONFIG } from "@/common/config/app.config";

@Injectable()
export class SourceQueryService {
  private readonly logger = new Logger(SourceQueryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  /**
   * Get all sources for a project
   */
  async getSources(userId: string, projectId: string) {
    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    if (project.userId !== userId) {
      throw new ForbiddenException("Access denied");
    }

    return this.prisma.researchProjectSource.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Get a single source
   */
  async getSource(userId: string, projectId: string, sourceId: string) {
    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    if (project.userId !== userId) {
      throw new ForbiddenException("Access denied");
    }

    const source = await this.prisma.researchProjectSource.findUnique({
      where: { id: sourceId },
    });

    if (!source || source.projectId !== projectId) {
      throw new NotFoundException("Source not found");
    }

    return source;
  }

  /**
   * Remove a source from a project
   */
  async removeSource(userId: string, projectId: string, sourceId: string) {
    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    if (project.userId !== userId) {
      throw new ForbiddenException("Access denied");
    }

    const source = await this.prisma.researchProjectSource.findUnique({
      where: { id: sourceId },
    });

    if (!source || source.projectId !== projectId) {
      throw new NotFoundException("Source not found");
    }

    await this.prisma.researchProjectSource.delete({
      where: { id: sourceId },
    });

    await this.prisma.researchProject.update({
      where: { id: projectId },
      data: {
        sourceCount: { decrement: 1 },
      },
    });

    return { success: true };
  }

  /**
   * Search for sources (from local DB or internet).
   * Supports two modes:
   * - quick: Fast parallel search across selected sources
   * - deep: Multi-round iterative search with AI-guided refinement
   */
  async searchSources(_userId: string, dto: SearchSourcesDto) {
    const mode = dto.mode || "quick";
    const sourcesToSearch = dto.sources || ["local", "web", "arxiv", "github"];

    this.logger.log(
      `[${mode.toUpperCase()}] Searching sources: ${sourcesToSearch.join(", ")} for query: ${dto.query}`,
    );

    if (mode === "deep") {
      return this.deepResearch(dto.query, sourcesToSearch);
    }

    return this.quickSearch(dto.query, sourcesToSearch);
  }

  // ---------------------------------------------------------------------------
  // Private: tool context
  // ---------------------------------------------------------------------------

  private createToolContext(toolId: string): ToolContext {
    return {
      executionId: `${toolId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      toolId,
      createdAt: new Date(),
      callerType: "orchestrator",
    };
  }

  // ---------------------------------------------------------------------------
  // Private: search orchestration
  // ---------------------------------------------------------------------------

  private async quickSearch(query: string, sourcesToSearch: string[]) {
    const startTime = Date.now();
    const results: Array<Record<string, unknown>> = [];
    const searchPromises: Promise<Array<Record<string, unknown>>>[] = [];
    const errors: string[] = [];

    if (sourcesToSearch.includes("local")) {
      searchPromises.push(
        this.searchLocalDB(query, 10).catch((e: Error) => {
          errors.push(`local: ${e.message}`);
          return [];
        }),
      );
    }

    if (sourcesToSearch.includes("web")) {
      searchPromises.push(
        this.searchWeb(query, 10).catch((e: Error) => {
          errors.push(`web: ${e.message}`);
          return [];
        }),
      );
    }

    if (sourcesToSearch.includes("arxiv")) {
      searchPromises.push(
        this.searchArxivDirect(query, 10).catch((e: Error) => {
          errors.push(`arxiv: ${e.message}`);
          return [];
        }),
      );
    }

    if (sourcesToSearch.includes("github")) {
      searchPromises.push(
        this.searchGithubDirect(query, 10).catch((e: Error) => {
          errors.push(`github: ${e.message}`);
          return [];
        }),
      );
    }

    if (sourcesToSearch.includes("news")) {
      searchPromises.push(
        this.searchNews(query, 10).catch((e: Error) => {
          errors.push(`news: ${e.message}`);
          return [];
        }),
      );
    }

    if (sourcesToSearch.includes("scholar")) {
      searchPromises.push(
        this.searchScholar(query, 10).catch((e: Error) => {
          errors.push(`scholar: ${e.message}`);
          return [];
        }),
      );
    }

    if (sourcesToSearch.includes("blogs")) {
      searchPromises.push(
        this.searchLocalByCategory(query, "BLOG", 10).catch((e: Error) => {
          errors.push(`blogs: ${e.message}`);
          return [];
        }),
      );
    }

    if (sourcesToSearch.includes("reports")) {
      searchPromises.push(
        this.searchLocalByCategory(query, "REPORT", 10).catch((e: Error) => {
          errors.push(`reports: ${e.message}`);
          return [];
        }),
      );
    }

    if (sourcesToSearch.includes("policy")) {
      searchPromises.push(
        this.searchLocalByCategory(query, "POLICY", 10).catch((e: Error) => {
          errors.push(`policy: ${e.message}`);
          return [];
        }),
      );
    }

    const allResults = await Promise.all(searchPromises);
    allResults.forEach((r) => results.push(...r));

    const duration = Date.now() - startTime;
    this.logger.log(
      `Quick search completed in ${duration}ms with ${results.length} results`,
    );

    return {
      results,
      query,
      mode: "quick" as const,
      sourcesSearched: sourcesToSearch,
      stats: {
        totalResults: results.length,
        durationMs: duration,
        errors: errors.length > 0 ? errors : undefined,
      },
    };
  }

  /**
   * Deep Research: Multi-round iterative search with comprehensive coverage.
   *
   * Based on industry best practices (Perplexity, NotebookLM):
   * 1. Initial broad search across all sources
   * 2. Analyze results to identify key themes/subtopics
   * 3. Conduct follow-up searches for each subtopic
   * 4. Deduplicate and rank by relevance
   * 5. Return comprehensive results with metadata
   */
  private async deepResearch(query: string, sourcesToSearch: string[]) {
    const startTime = Date.now();
    const allResults: Array<Record<string, unknown>> = [];
    const searchHistory: string[] = [query];
    const errors: string[] = [];

    this.logger.log(`Starting deep research for: ${query}`);

    this.logger.log("Deep research round 1: Initial search");
    const round1Results = await this.quickSearch(query, sourcesToSearch);
    allResults.push(...round1Results.results);

    const relatedQueries = this.generateRelatedQueries(
      query,
      round1Results.results,
    );
    this.logger.log(
      `Deep research round 2: ${relatedQueries.length} related queries`,
    );

    for (const relatedQuery of relatedQueries.slice(0, 3)) {
      if (searchHistory.includes(relatedQuery)) continue;
      searchHistory.push(relatedQuery);

      try {
        const relatedResults = await this.quickSearch(
          relatedQuery,
          sourcesToSearch,
        );
        for (const result of relatedResults.results) {
          if (!this.isDuplicate(result, allResults)) {
            allResults.push({ ...result, relatedQuery });
          }
        }
      } catch (error: unknown) {
        errors.push(
          `related search "${relatedQuery}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (sourcesToSearch.includes("arxiv")) {
      this.logger.log("Deep research round 3: Academic deep dive");
      const academicQueries = this.generateAcademicQueries(query);

      for (const academicQuery of academicQueries.slice(0, 2)) {
        if (searchHistory.includes(academicQuery)) continue;
        searchHistory.push(academicQuery);

        try {
          const arxivResults = await this.searchArxivDirect(academicQuery, 15);
          for (const result of arxivResults) {
            if (!this.isDuplicate(result, allResults)) {
              allResults.push({ ...result, relatedQuery: academicQuery });
            }
          }
        } catch (error: unknown) {
          errors.push(
            `arxiv deep search: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    const deduplicatedResults = this.deduplicateResults(allResults);
    const rankedResults = this.rankByRelevance(deduplicatedResults, query);

    const duration = Date.now() - startTime;
    this.logger.log(
      `Deep research completed in ${duration}ms with ${rankedResults.length} unique results`,
    );

    return {
      results: rankedResults,
      query,
      mode: "deep" as const,
      sourcesSearched: sourcesToSearch,
      stats: {
        totalResults: rankedResults.length,
        searchRounds: searchHistory.length,
        queriesExecuted: searchHistory,
        durationMs: duration,
        errors: errors.length > 0 ? errors : undefined,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Private: source adapters
  // ---------------------------------------------------------------------------

  private async searchLocalDB(
    query: string,
    limit: number,
  ): Promise<Array<Record<string, unknown>>> {
    const results = await this.prisma.resource.findMany({
      where: {
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { abstract: { contains: query, mode: "insensitive" } },
        ],
      },
      take: limit,
      orderBy: { publishedAt: "desc" },
      select: {
        id: true,
        type: true,
        title: true,
        abstract: true,
        sourceUrl: true,
        publishedAt: true,
        authors: true,
        qualityScore: true,
        citationCount: true,
      },
    });

    this.logger.log(`Local search returned ${results.length} results`);
    return results.map((r) => ({
      ...r,
      source: "local",
      sourceType: (r.type || "unknown").toLowerCase(),
    }));
  }

  /**
   * Search web using Tavily/Serper via ToolRegistry.
   */
  private async searchWeb(
    query: string,
    limit: number,
  ): Promise<Array<Record<string, unknown>>> {
    const webSearchTool = this.toolRegistry.tryGet("web-search");
    if (!webSearchTool) {
      this.logger.warn("[searchWeb] web-search tool not registered");
      return [];
    }

    try {
      const toolResult = await webSearchTool.execute(
        { query, numResults: limit },
        this.createToolContext("web-search"),
      );

      if (!toolResult.success || !toolResult.data) {
        return [];
      }

      const searchData = toolResult.data as {
        results: Array<{
          title: string;
          url: string;
          content: string;
          score?: number;
        }>;
        success: boolean;
      };

      if (!searchData.success || !searchData.results?.length) {
        return [];
      }

      this.logger.log(
        `Web search returned ${searchData.results.length} results`,
      );
      return searchData.results.map((r) => ({
        id: null,
        title: r.title,
        abstract: r.content,
        sourceUrl: r.url,
        source: "web",
        sourceType: "web",
        score: r.score,
      }));
    } catch (error) {
      this.logger.error(`[searchWeb] Tool execution failed: ${error}`);
      return [];
    }
  }

  private async searchLocalByCategory(
    query: string,
    category: string,
    limit: number,
  ): Promise<Array<Record<string, unknown>>> {
    const results = await this.prisma.resource.findMany({
      where: {
        type: category as
          | "PAPER"
          | "BLOG"
          | "REPORT"
          | "POLICY"
          | "YOUTUBE_VIDEO"
          | "NEWS"
          | "PROJECT"
          | "EVENT"
          | "RSS",
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { abstract: { contains: query, mode: "insensitive" } },
          { content: { contains: query, mode: "insensitive" } },
        ],
      },
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        abstract: true,
        type: true,
        sourceUrl: true,
        authors: true,
        publishedAt: true,
        qualityScore: true,
      },
    });

    this.logger.log(
      `Local ${category} search returned ${results.length} results`,
    );

    return results.map((r) => ({
      ...r,
      source: (category || "unknown").toLowerCase(),
      sourceType: (r.type || "unknown").toLowerCase(),
    }));
  }

  /**
   * Search news sources using web search with news-focused keywords via ToolRegistry.
   */
  private async searchNews(
    query: string,
    limit: number,
  ): Promise<Array<Record<string, unknown>>> {
    const webSearchTool = this.toolRegistry.tryGet("web-search");
    if (!webSearchTool) {
      this.logger.warn("[searchNews] web-search tool not registered");
      return [];
    }

    const newsQuery = `${query} news latest update announcement`;

    try {
      const toolResult = await webSearchTool.execute(
        { query: newsQuery, numResults: limit },
        this.createToolContext("web-search"),
      );

      if (!toolResult.success || !toolResult.data) {
        return [];
      }

      const searchData = toolResult.data as {
        results: Array<{
          title: string;
          url: string;
          content: string;
          score?: number;
          publishedDate?: string;
        }>;
        success: boolean;
      };

      if (!searchData.success || !searchData.results?.length) {
        return [];
      }

      this.logger.log(
        `News search returned ${searchData.results.length} results`,
      );
      return searchData.results.map((r) => ({
        id: null,
        title: r.title,
        abstract: r.content,
        sourceUrl: r.url,
        source: "news",
        sourceType: "news",
        score: r.score,
        publishedDate: r.publishedDate,
      }));
    } catch (error) {
      this.logger.error(`[searchNews] Tool execution failed: ${error}`);
      return [];
    }
  }

  private async searchScholar(
    query: string,
    limit: number,
  ): Promise<Array<Record<string, unknown>>> {
    const axios = await import("axios");

    try {
      const response = await axios.default.get(
        "https://api.semanticscholar.org/graph/v1/paper/search",
        {
          params: {
            query,
            limit,
            fields:
              "paperId,title,abstract,authors,year,citationCount,url,openAccessPdf",
          },
          headers: {
            Accept: "application/json",
          },
          timeout: 15000,
        },
      );

      const papers = response.data.data || [];
      this.logger.log(`Scholar search returned ${papers.length} results`);

      return papers.map((paper: Record<string, unknown>) => ({
        id: null,
        title: paper.title,
        abstract: paper.abstract || "",
        sourceUrl:
          ((paper.openAccessPdf as Record<string, unknown> | undefined)?.url as
            | string
            | undefined) ||
          `https://www.semanticscholar.org/paper/${paper.paperId}`,
        authors: Array.isArray(paper.authors)
          ? paper.authors.map(
              (a: unknown) => (a as Record<string, unknown>).name as string,
            )
          : [],
        publishedAt: paper.year ? `${paper.year}-01-01` : null,
        source: "scholar",
        sourceType: "paper",
        metadata: {
          citationCount: paper.citationCount,
          paperId: paper.paperId,
        },
      }));
    } catch (error: unknown) {
      this.logger.warn(
        `Scholar search failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private async searchArxivDirect(
    query: string,
    maxResults: number,
  ): Promise<Array<Record<string, unknown>>> {
    const axios = await import("axios");
    const xml2js = await import("xml2js");

    const response = await axios.default.get(
      "http://export.arxiv.org/api/query",
      {
        params: {
          search_query: `all:${query}`,
          start: 0,
          max_results: maxResults,
          sortBy: "relevance",
          sortOrder: "descending",
        },
        timeout: 10000,
      },
    );

    const parser = new xml2js.Parser({ explicitArray: false });
    const result = await parser.parseStringPromise(response.data);

    if (!result.feed?.entry) {
      return [];
    }

    const entries = Array.isArray(result.feed.entry)
      ? result.feed.entry
      : [result.feed.entry];

    return entries.map((entry: Record<string, unknown>) => {
      const authors = entry.author
        ? Array.isArray(entry.author)
          ? entry.author.map((a: Record<string, unknown>) => a.name as string)
          : [(entry.author as Record<string, unknown>).name as string]
        : [];

      const entryLink = entry.link as
        | Record<string, unknown>
        | Array<Record<string, unknown>>
        | undefined;
      const pdfLink = entryLink
        ? Array.isArray(entryLink)
          ? entryLink.find(
              (l: Record<string, unknown>) =>
                (l.$ as Record<string, unknown>)?.title === "pdf",
            )
          : (entryLink.$ as Record<string, unknown> | undefined)?.title ===
              "pdf"
            ? entryLink
            : null
        : null;

      const entryCategory = entry.category as
        | Record<string, unknown>
        | Array<Record<string, unknown>>
        | undefined;
      return {
        id: null,
        title:
          typeof entry.title === "string"
            ? entry.title.replace(/\s+/g, " ").trim()
            : undefined,
        abstract:
          typeof entry.summary === "string"
            ? entry.summary.replace(/\s+/g, " ").trim()
            : undefined,
        sourceUrl: (pdfLink as Record<string, unknown> | undefined)?.$
          ? (((pdfLink as Record<string, unknown>).$ as Record<string, unknown>)
              .href as string)
          : (entry.id as string),
        authors,
        publishedAt: entry.published as string,
        source: "arxiv",
        sourceType: "paper",
        categories: entryCategory
          ? Array.isArray(entryCategory)
            ? entryCategory.map(
                (c: Record<string, unknown>) =>
                  (c.$ as Record<string, unknown>).term as string,
              )
            : [(entryCategory.$ as Record<string, unknown>).term as string]
          : [],
      };
    });
  }

  private async searchGithubDirect(
    query: string,
    maxResults: number,
  ): Promise<Array<Record<string, unknown>>> {
    const axios = await import("axios");

    const response = await axios.default.get(
      "https://api.github.com/search/repositories",
      {
        params: {
          q: query,
          sort: "stars",
          order: "desc",
          per_page: maxResults,
        },
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": APP_CONFIG.brand.userAgent,
        },
        timeout: 10000,
      },
    );

    return (response.data.items || []).map((repo: Record<string, unknown>) => ({
      id: null,
      title: repo.full_name,
      abstract: repo.description,
      sourceUrl: repo.html_url,
      source: "github",
      sourceType: "github",
      metadata: {
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        language: repo.language,
        topics: repo.topics,
      },
    }));
  }

  // ---------------------------------------------------------------------------
  // Private: dedup & ranking helpers
  // ---------------------------------------------------------------------------

  private generateRelatedQueries(
    query: string,
    results: Array<Record<string, unknown>>,
  ): string[] {
    if (!query) return [];
    const queries: string[] = [];
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);

    const termCounts = new Map<string, number>();
    for (const result of results.slice(0, 10)) {
      const text =
        `${result.title || ""} ${result.abstract || ""}`.toLowerCase();
      const resultWords = text.split(/\s+/).filter((w) => w.length > 4);
      for (const word of resultWords) {
        if (!words.includes(word) && /^[a-z]+$/i.test(word)) {
          termCounts.set(word, (termCounts.get(word) || 0) + 1);
        }
      }
    }

    const topTerms = [...termCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([term]) => term);

    for (const term of topTerms) {
      queries.push(`${query} ${term}`);
    }

    queries.push(`${query} latest research`);
    queries.push(`${query} comparison`);
    queries.push(`${query} implementation`);

    return queries;
  }

  private generateAcademicQueries(query: string): string[] {
    return [
      `${query} survey`,
      `${query} benchmark`,
      `${query} state of the art`,
      `${query} novel approach`,
    ];
  }

  private isDuplicate(
    result: Record<string, unknown>,
    existingResults: Array<Record<string, unknown>>,
  ): boolean {
    const url =
      typeof result.sourceUrl === "string"
        ? result.sourceUrl.toLowerCase()
        : undefined;
    const title =
      typeof result.title === "string" ? result.title.toLowerCase() : undefined;

    return existingResults.some((existing) => {
      const existingUrl =
        typeof existing.sourceUrl === "string"
          ? existing.sourceUrl.toLowerCase()
          : undefined;
      const existingTitle =
        typeof existing.title === "string"
          ? existing.title.toLowerCase()
          : undefined;
      if (url && existingUrl === url) return true;
      if (title && existingTitle === title) return true;
      return false;
    });
  }

  private deduplicateResults(
    results: Array<Record<string, unknown>>,
  ): Array<Record<string, unknown>> {
    const seen = new Set<string>();
    return results.filter((result) => {
      const sourceUrl =
        typeof result.sourceUrl === "string"
          ? result.sourceUrl.toLowerCase()
          : undefined;
      const title =
        typeof result.title === "string"
          ? result.title.toLowerCase()
          : undefined;
      const key = sourceUrl || title;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Comprehensive ranking algorithm for multi-source results.
   *
   * Factors with weights:
   * - Relevance (35%): Query term matching in title/content
   * - Quality (25%): Source authority, domain reputation
   * - Freshness (20%): Prefer recent content
   * - Diversity (10%): Bonus for unique sources
   * - Depth (10%): Content length and detail
   */
  private rankByRelevance(
    results: Array<Record<string, unknown>>,
    query: string,
  ): Array<Record<string, unknown>> {
    if (!query) return results;
    const queryTerms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);
    const seenDomains = new Set<string>();

    return results
      .map((result) => {
        const relevanceScore = this.calculateRelevance(result, queryTerms);
        const qualityScore = this.calculateQuality(result);
        const freshnessScore = this.calculateFreshness(result);

        const domain = this.extractDomain(
          typeof result.sourceUrl === "string" ? result.sourceUrl : undefined,
        );
        const diversityScore = seenDomains.has(domain) ? 30 : 100;
        seenDomains.add(domain);

        const depthScore = this.calculateDepth(result);

        const finalScore =
          relevanceScore * 0.35 +
          qualityScore * 0.25 +
          freshnessScore * 0.2 +
          diversityScore * 0.1 +
          depthScore * 0.1;

        return {
          ...result,
          relevanceScore: finalScore,
          _debug: {
            relevance: relevanceScore,
            quality: qualityScore,
            freshness: freshnessScore,
            diversity: diversityScore,
            depth: depthScore,
          },
        };
      })
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  private calculateRelevance(
    result: Record<string, unknown>,
    queryTerms: string[],
  ): number {
    let score = 0;
    const titleLower = (
      typeof result.title === "string" ? result.title : ""
    ).toLowerCase();
    const abstractLower = (
      typeof result.abstract === "string" ? result.abstract : ""
    ).toLowerCase();
    const text = `${titleLower} ${abstractLower}`;

    if (typeof result.score === "number") {
      score = result.score * 40;
    }

    for (const term of queryTerms) {
      if (titleLower.includes(term)) {
        score += 15;
        if (new RegExp(`\\b${term}\\b`).test(titleLower)) {
          score += 10;
        }
      }

      if (abstractLower.includes(term)) {
        score += 8;
      }
    }

    if (queryTerms.every((term) => titleLower.includes(term))) {
      score += 20;
    }

    if (queryTerms.every((term) => text.includes(term))) {
      score += 10;
    }

    return Math.min(score, 100);
  }

  private calculateQuality(result: Record<string, unknown>): number {
    let score = 50;

    const sourceType = result.source || result.sourceType;
    switch (sourceType) {
      case "arxiv":
      case "paper":
        score += 35;
        break;
      case "github": {
        score += 25;
        const metadata = result.metadata as Record<string, unknown> | undefined;
        if (
          metadata &&
          typeof metadata.stars === "number" &&
          metadata.stars > 1000
        )
          score += 15;
        if (
          metadata &&
          typeof metadata.stars === "number" &&
          metadata.stars > 10000
        )
          score += 10;
        break;
      }
      case "local":
        score += 20;
        if (typeof result.qualityScore === "number")
          score += result.qualityScore * 20;
        break;
      case "web":
      case "news":
        score += 10;
        break;
    }

    const domain = this.extractDomain(
      typeof result.sourceUrl === "string" ? result.sourceUrl : undefined,
    );
    if (this.isHighAuthorityDomain(domain)) {
      score += 25;
    } else if (this.isMediumAuthorityDomain(domain)) {
      score += 10;
    }

    if (typeof result.citationCount === "number") {
      if (result.citationCount > 100) score += 20;
      else if (result.citationCount > 50) score += 15;
      else if (result.citationCount > 10) score += 10;
    }

    return Math.min(score, 100);
  }

  private calculateFreshness(result: Record<string, unknown>): number {
    const publishedAt = result.publishedAt || result.publishedDate;
    if (!publishedAt) {
      return 50;
    }

    try {
      const pubDate = new Date(publishedAt as string | number | Date);
      const now = new Date();
      const daysDiff =
        (now.getTime() - pubDate.getTime()) / (1000 * 60 * 60 * 24);

      if (daysDiff <= 7) return 100;
      if (daysDiff <= 30) return 90;
      if (daysDiff <= 90) return 75;
      if (daysDiff <= 180) return 60;
      if (daysDiff <= 365) return 45;
      if (daysDiff <= 730) return 30;
      return 20;
    } catch {
      return 50;
    }
  }

  private calculateDepth(result: Record<string, unknown>): number {
    const abstract = typeof result.abstract === "string" ? result.abstract : "";
    const content = typeof result.content === "string" ? result.content : "";
    const contentLength = (abstract || content).length;

    if (contentLength >= 1000) return 100;
    if (contentLength >= 500) return 80;
    if (contentLength >= 300) return 60;
    if (contentLength >= 100) return 40;
    return 20;
  }

  private extractDomain(url: string | null | undefined): string {
    if (!url) return "unknown";
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace(/^www\./, "");
    } catch {
      return "unknown";
    }
  }

  private isHighAuthorityDomain(domain: string): boolean {
    const highAuthority = [
      // Academic & Research
      "arxiv.org",
      "nature.com",
      "science.org",
      "ieee.org",
      "acm.org",
      "researchgate.net",
      "pubmed.ncbi.nlm.nih.gov",
      "springer.com",
      "wiley.com",
      "elsevier.com",
      // Analysis & Reports
      "mckinsey.com",
      "bcg.com",
      "bain.com",
      "hbr.org",
      "gartner.com",
      "forrester.com",
      "statista.com",
      "idc.com",
      "cb-insights.com",
      // Major News (Global)
      "reuters.com",
      "bloomberg.com",
      "ft.com",
      "wsj.com",
      "nytimes.com",
      "theguardian.com",
      "bbc.com",
      "economist.com",
      // Tech
      "techcrunch.com",
      "wired.com",
      "arstechnica.com",
      "theverge.com",
      "venturebeat.com",
      // Official
      "github.com",
      "stackoverflow.com",
    ];
    return highAuthority.some((d) => domain.includes(d));
  }

  private isMediumAuthorityDomain(domain: string): boolean {
    const mediumAuthority = [
      "wikipedia.org",
      "medium.com",
      "dev.to",
      "forbes.com",
      "zdnet.com",
      "cnet.com",
      "linkedin.com",
      "reddit.com",
    ];
    return mediumAuthority.some((d) => domain.includes(d));
  }
}
