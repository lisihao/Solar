/**
 * RAG Pipeline Service
 * Implements the 5-stage RAG retrieval pipeline
 *
 * Pipeline Stages:
 * 1. HyDE (Hypothetical Document Embeddings) - Query enhancement
 * 2. Hybrid Search - Vector + Keyword search with RRF
 * 3. Rerank - Cohere cross-encoder reranking
 * 4. Parent Retrieval - Expand child results to parent chunks
 * 5. Context Building - Assemble final context for LLM
 *
 * Note: Vector search uses JSONB storage with application-layer similarity
 * computation via VectorService (Railway PostgreSQL compatible).
 *
 * Migrated from ai-app/rag/ to ai-engine/rag/pipeline/ for cross-module reuse.
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@/common/prisma/prisma.service";
import { RequestContext } from "@/common/context/request-context";
import { KeyExecutorService } from "@/modules/platform/credentials/resolution/executor";
import { EmbeddingService } from "../embedding";
import { VectorService } from "../vector";
import { AiChatService } from "@/modules/ai-engine/llm/chat/ai-chat.service";
import { AIModelType } from "@prisma/client";
import {
  RAGQuery,
  RAGResponse,
  RAGQuality,
  RAGContext,
  SearchResult,
  ContextSource,
  HybridSearchParams,
} from "./rag-pipeline.interface";

const DEFAULT_TOP_K = 10;
const DEFAULT_HYBRID_ALPHA = 0.5; // Balance between vector and keyword
const MAX_CONTEXT_TOKENS = 8000;
const RERANK_MODEL = "rerank-v3.5";

@Injectable()
export class RAGPipelineService {
  private readonly logger = new Logger(RAGPipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
    private readonly vectorService: VectorService,
    private readonly aiChatService: AiChatService,
    private readonly configService: ConfigService,
    @Optional() private readonly keyExecutor?: KeyExecutorService,
  ) {}

  /**
   * Execute the full RAG pipeline
   */
  async query(request: RAGQuery): Promise<RAGResponse> {
    const startTime = Date.now();
    const options = {
      topK: request.options?.topK ?? DEFAULT_TOP_K,
      useHyde: request.options?.useHyde ?? true,
      useRerank: request.options?.useRerank ?? true,
      hybridAlpha: request.options?.hybridAlpha ?? DEFAULT_HYBRID_ALPHA,
      minScore: request.options?.minScore ?? 0.3,
      includeMetadata: request.options?.includeMetadata ?? true,
    };

    let hydeQuery: string | undefined;
    let hydeTime: number | undefined;

    // Stage 1: HyDE - Generate hypothetical document
    if (options.useHyde) {
      const hydeStart = Date.now();
      hydeQuery = await this.generateHypotheticalDocument(request.query);
      hydeTime = Date.now() - hydeStart;
      this.logger.debug(`HyDE generated in ${hydeTime}ms`);
    }

    // Stage 2: Hybrid Search
    const searchStart = Date.now();
    const queryForSearch = hydeQuery || request.query;
    // ★ 2026-05-12: taskType:"query" 让 Cohere/Google/Voyage 用 query 编码空间
    //   （与存储侧 "document" 区分）。不区分会让召回率掉 5-15%。
    const queryEmbedding = await this.embeddingService.generateEmbedding(
      queryForSearch,
      { taskType: "query" },
    );

    // ★ 全覆盖审计修 (2026-05-06): hybridSearch 现在返回 quality 信号
    const {
      results: searchResults,
      quality: searchQuality,
      degradedReason,
    } = await this.hybridSearch({
      queryEmbedding: queryEmbedding.embedding,
      queryText: request.query, // Use original query for keyword search
      knowledgeBaseIds: request.knowledgeBaseIds,
      topK: options.topK * 3, // Get more results for reranking
      alpha: options.hybridAlpha,
    });
    const searchTime = Date.now() - searchStart;
    this.logger.debug(`Hybrid search completed in ${searchTime}ms`);

    // Debug: Log search results details
    this.logger.log(
      `[RAG] Search results: ${searchResults.length} found, top scores: ${searchResults
        .slice(0, 3)
        .map((r) => r.score?.toFixed(4))
        .join(", ")}`,
    );

    // Stage 3: Rerank
    let rerankTime: number | undefined;
    let rankedResults = searchResults;

    // Track whether rerank was actually applied (affects quality signal)
    let rerankApplied = false;
    if (options.useRerank && searchResults.length > 0) {
      const rerankStart = Date.now();
      try {
        rankedResults = await this.rerankResults(
          request.query,
          searchResults,
          options.topK,
        );
        rerankTime = Date.now() - rerankStart;
        rerankApplied = true;
        this.logger.debug(`Reranking completed in ${rerankTime}ms`);
      } catch (error) {
        this.logger.warn(`Reranking failed, using search scores: ${error}`);
        rankedResults = searchResults.slice(0, options.topK);
      }
    } else {
      rankedResults = searchResults.slice(0, options.topK);
    }

    // Log ranked results before building context
    this.logger.log(
      `[RAG] Ranked results before buildContext: count=${rankedResults.length}, minScore=${options.minScore}, topScores=[${rankedResults
        .slice(0, 3)
        .map((r) => r.score?.toFixed(4))
        .join(", ")}]`,
    );

    // Stage 4 & 5: Parent Retrieval and Context Building
    const context = await this.buildContext(rankedResults, options.minScore);

    const totalTime = Date.now() - startTime;
    this.logger.log(
      `RAG pipeline completed in ${totalTime}ms (hyde: ${hydeTime || 0}ms, search: ${searchTime}ms, rerank: ${rerankTime || 0}ms)`,
    );

    // ★ P2 fix: when rerank was skipped (no key / failover failed / disabled), quality
    // is "degraded" regardless of the hybrid-search quality. Rerank is the primary
    // quality differentiator of the full pipeline; without it results are hybrid-only.
    const finalQuality: RAGQuality =
      searchQuality === "degraded" || !rerankApplied ? "degraded" : "full";
    const finalDegradedReason =
      searchQuality === "degraded"
        ? degradedReason
        : !rerankApplied
          ? "rerank not applied (no key or disabled)"
          : undefined;

    return {
      context,
      hydeQuery,
      searchResults: rankedResults,
      processingTime: {
        hyde: hydeTime,
        search: searchTime,
        rerank: rerankTime,
        total: totalTime,
      },
      quality: finalQuality,
      degradedReason: finalDegradedReason,
    };
  }

  /**
   * Stage 1: Generate hypothetical document using HyDE
   * Uses AiChatService.chat() directly to avoid circular dependency with AIFacade
   */
  private async generateHypotheticalDocument(query: string): Promise<string> {
    const systemPrompt = `You are a helpful assistant that generates a hypothetical document passage that would perfectly answer the given query.
Generate a detailed, factual-sounding passage (2-3 paragraphs) that would contain the answer to the query.
Do not mention that this is hypothetical. Write as if this is actual content from a document.
Focus on being specific and informative.`;

    const response = await this.aiChatService.chat({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Query: ${query}` },
      ],
      modelType: AIModelType.CHAT_FAST,
      taskProfile: {
        creativity: "low",
        outputLength: "short",
      },
    });

    return response.content || query;
  }

  /**
   * Stage 2: Hybrid search combining vector similarity and keyword matching
   * Uses JSONB vector storage with application-layer similarity computation
   *
   * ★ 全覆盖审计修 (2026-05-06): 返回 quality 信号，vector search 失败时 quality='degraded'
   */
  private async hybridSearch(params: HybridSearchParams): Promise<{
    results: SearchResult[];
    quality: RAGQuality;
    degradedReason?: string;
  }> {
    const { queryEmbedding, queryText, knowledgeBaseIds, topK, alpha } = params;

    // Get vector search results using VectorService (graceful degradation)
    let vectorResults: Awaited<
      ReturnType<typeof this.vectorService.similaritySearch>
    > = [];
    // ★ 全覆盖审计修 (2026-05-06): 记录 vector search 是否降级
    let vectorFailed = false;
    let vectorFailReason: string | undefined;
    try {
      vectorResults = await this.vectorService.similaritySearch(
        queryEmbedding,
        {
          knowledgeBaseIds,
          limit: topK * 2, // Get more for fusion
          threshold: 0.2,
        },
      );
    } catch (error) {
      vectorFailed = true;
      vectorFailReason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[hybridSearch] Vector search failed, using keyword-only: ${error}`,
      );
    }

    this.logger.log(
      `[hybridSearch] Vector search returned ${vectorResults.length} results, top similarity: ${vectorResults[0]?.similarity?.toFixed(4) || "N/A"}`,
    );

    // Get keyword search results using PostgreSQL full-text search
    const keywordResults = await this.keywordSearch(
      queryText,
      knowledgeBaseIds,
      topK * 2,
    );

    this.logger.log(
      `[hybridSearch] Keyword search returned ${keywordResults.length} results`,
    );

    // Perform RRF (Reciprocal Rank Fusion) to combine results
    // IMPORTANT: RRF scores are very small (max ~0.016), so we preserve original vectorScore
    const mappedVectorResults = vectorResults.map((r) => ({
      childChunkId: r.childChunkId,
      parentChunkId: r.parentChunkId,
      documentId: r.documentId,
      content: r.content,
      parentContent: r.parentContent,
      score: r.similarity,
      vectorScore: r.similarity,
    }));

    const rrfResults = this.reciprocalRankFusion(
      mappedVectorResults,
      keywordResults,
      alpha,
    );

    // Debug: Log RRF results with vectorScore preservation
    if (rrfResults.length > 0) {
      this.logger.log(
        `[hybridSearch] RRF top result: rrfScore=${rrfResults[0]?.score?.toFixed(6)}, vectorScore=${rrfResults[0]?.vectorScore?.toFixed(6) || "N/A"}`,
      );
    }

    // Use the original vectorScore for filtering if available, otherwise use RRF score
    // This prevents good vector matches from being filtered out due to low RRF scores
    const resultsWithPreservedScores = rrfResults.map((r) => ({
      ...r,
      // Keep the higher score between vectorScore and RRF score for filtering purposes
      score: Math.max(r.vectorScore || 0, r.score || 0),
    }));

    this.logger.log(
      `[hybridSearch] After score preservation: ${resultsWithPreservedScores.length} results, top score: ${resultsWithPreservedScores[0]?.score?.toFixed(4) || "N/A"}, preservedVectorScore: ${resultsWithPreservedScores[0]?.vectorScore?.toFixed(4) || "N/A"}`,
    );

    // ★ 全覆盖审计修 (2026-05-06): 返回 quality 信号供调用方透传给上游业务事件
    return {
      results: resultsWithPreservedScores.slice(0, topK),
      quality: vectorFailed ? "degraded" : "full",
      degradedReason: vectorFailed
        ? `Vector search unavailable: ${vectorFailReason}`
        : undefined,
    };
  }

  /**
   * Keyword search using PostgreSQL full-text search
   */
  private async keywordSearch(
    queryText: string,
    knowledgeBaseIds: string[],
    limit: number,
  ): Promise<SearchResult[]> {
    try {
      const results = await this.prisma.$queryRaw<
        Array<{
          child_chunk_id: string;
          parent_chunk_id: string;
          document_id: string;
          child_content: string;
          parent_content: string;
          rank: number;
        }>
      >`
        SELECT
          cc.id as child_chunk_id,
          cc.parent_chunk_id,
          pc.document_id,
          cc.content as child_content,
          pc.content as parent_content,
          ts_rank(to_tsvector('english', cc.content), plainto_tsquery('english', ${queryText})) as rank
        FROM child_chunks cc
        JOIN parent_chunks pc ON cc.parent_chunk_id = pc.id
        JOIN knowledge_base_documents d ON pc.document_id = d.id
        WHERE d.knowledge_base_id = ANY(${knowledgeBaseIds}::text[])
          AND to_tsvector('english', cc.content) @@ plainto_tsquery('english', ${queryText})
        ORDER BY rank DESC
        LIMIT ${limit}
      `;

      return results.map((r) => ({
        childChunkId: r.child_chunk_id,
        parentChunkId: r.parent_chunk_id,
        documentId: r.document_id,
        content: r.child_content,
        parentContent: r.parent_content,
        score: r.rank,
        keywordScore: r.rank,
      }));
    } catch (error) {
      this.logger.warn(`Keyword search failed: ${error}`);
      return [];
    }
  }

  /**
   * Reciprocal Rank Fusion to combine vector and keyword results
   */
  private reciprocalRankFusion(
    vectorResults: SearchResult[],
    keywordResults: SearchResult[],
    alpha: number,
    k: number = 60, // RRF constant
  ): SearchResult[] {
    const scoreMap = new Map<
      string,
      SearchResult & {
        rrfScore: number;
        vectorRank?: number;
        keywordRank?: number;
      }
    >();

    // Process vector results
    vectorResults.forEach((result, index) => {
      const existing = scoreMap.get(result.childChunkId);
      const vectorRank = index + 1;
      const vectorRrfScore = alpha / (k + vectorRank);

      if (existing) {
        existing.rrfScore += vectorRrfScore;
        existing.vectorRank = vectorRank;
        existing.vectorScore = result.vectorScore;
      } else {
        scoreMap.set(result.childChunkId, {
          ...result,
          rrfScore: vectorRrfScore,
          vectorRank,
        });
      }
    });

    // Process keyword results
    keywordResults.forEach((result, index) => {
      const existing = scoreMap.get(result.childChunkId);
      const keywordRank = index + 1;
      const keywordRrfScore = (1 - alpha) / (k + keywordRank);

      if (existing) {
        existing.rrfScore += keywordRrfScore;
        existing.keywordRank = keywordRank;
        existing.keywordScore = result.keywordScore;
      } else {
        scoreMap.set(result.childChunkId, {
          ...result,
          rrfScore: keywordRrfScore,
          keywordRank,
        });
      }
    });

    // Sort by RRF score and return
    return Array.from(scoreMap.values())
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .map((r) => ({
        ...r,
        score: r.rrfScore,
      }));
  }

  /**
   * Fallback: Pure vector search using VectorService
   */
  private async vectorSearch(
    queryEmbedding: number[],
    knowledgeBaseIds: string[],
    topK: number,
  ): Promise<SearchResult[]> {
    try {
      const results = await this.vectorService.similaritySearch(
        queryEmbedding,
        {
          knowledgeBaseIds,
          limit: topK,
          threshold: 0.2,
        },
      );

      return results.map((r) => ({
        childChunkId: r.childChunkId,
        parentChunkId: r.parentChunkId,
        documentId: r.documentId,
        content: r.content,
        parentContent: r.parentContent,
        score: r.similarity,
        vectorScore: r.similarity,
      }));
    } catch (error) {
      this.logger.warn(`[vectorSearch] Vector search failed: ${error}`);
      return [];
    }
  }

  /**
   * Stage 3: Rerank results using Cohere
   * Gets API key from system settings or environment variable
   */
  private async rerankResults(
    query: string,
    results: SearchResult[],
    topK: number,
  ): Promise<SearchResult[]> {
    const userId = RequestContext.getUserId();

    // PR-5 (2026-05-05) BYOK failover: 用户上下文 + KeyExecutor 可用时走 failover 链路
    if (userId && this.keyExecutor) {
      try {
        return await this.keyExecutor.execute(userId, "cohere", async (key) =>
          this.callCohereRerank(query, results, topK, key.apiKey),
        );
      } catch (error) {
        // 用户没配 cohere / 全部 key 都失败 → skip rerank（行为同旧逻辑）
        this.logger.warn(
          `[rerank] cohere failover failed, skipping rerank: ${
            error instanceof Error ? error.message : error
          }`,
        );
        return results.slice(0, topK);
      }
    }

    // 系统路径（无用户上下文 / KeyExecutor 不可用）：admin 系统级 cohere key 单 key 调用
    const systemKey = await this.getCohereSystemKey();
    if (!systemKey) {
      this.logger.warn("Cohere API key not configured, skipping rerank");
      return results.slice(0, topK);
    }
    return await this.callCohereRerank(query, results, topK, systemKey);
  }

  private async callCohereRerank(
    query: string,
    results: SearchResult[],
    topK: number,
    apiKey: string,
  ): Promise<SearchResult[]> {
    const response = await fetch("https://api.cohere.com/v2/rerank", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: RERANK_MODEL,
        query,
        documents: results.map((r) => r.content),
        top_n: topK,
        return_documents: false,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      // 把 status 包进 error 让 KeyErrorClassifier 能识别（401 → DEAD，429 → COOLDOWN）
      const err = new Error(`Cohere rerank failed: ${errBody}`) as Error & {
        status?: number;
      };
      err.status = response.status;
      throw err;
    }

    const data = await response.json();

    return data.results.map(
      (r: { index: number; relevance_score: number }) => ({
        ...results[r.index],
        rerankScore: r.relevance_score,
        score: r.relevance_score,
      }),
    );
  }

  /** 仅 admin / system job 用的系统级 cohere key 解析（与 BYOK 链路独立） */
  private async getCohereSystemKey(): Promise<string | null> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: "cohere.apiKey" },
    });
    if (setting?.value) return setting.value;
    return this.configService.get<string>("COHERE_API_KEY") || null;
  }

  /**
   * Stage 4 & 5: Build context from parent chunks
   */
  private async buildContext(
    results: SearchResult[],
    minScore: number,
  ): Promise<RAGContext> {
    // Filter by minimum score
    const filteredResults = results.filter((r) => r.score >= minScore);

    // Debug: Log filtering results
    this.logger.log(
      `[RAG buildContext] Input: ${results.length} results, minScore: ${minScore}, after filter: ${filteredResults.length}`,
    );
    if (results.length > 0 && filteredResults.length === 0) {
      this.logger.warn(
        `[RAG buildContext] All results filtered out! Top scores were: ${results
          .slice(0, 5)
          .map((r) => r.score?.toFixed(6))
          .join(", ")}`,
      );
    }

    if (filteredResults.length === 0) {
      return {
        text: "",
        sources: [],
        totalTokens: 0,
      };
    }

    // Get unique parent chunks
    const parentChunkIds = [
      ...new Set(filteredResults.map((r) => r.parentChunkId)),
    ];

    // Fetch parent chunks with document info
    const parentChunks = await this.prisma.parentChunk.findMany({
      where: {
        id: { in: parentChunkIds },
      },
      include: {
        document: {
          select: {
            id: true,
            title: true,
            sourceUrl: true,
            metadata: true,
          },
        },
      },
    });

    // Build context text and sources
    const sources: ContextSource[] = [];
    const contextParts: string[] = [];
    let totalTokens = 0;

    // Sort by score and add to context until token limit
    const sortedParents = parentChunks.sort((a, b) => {
      const scoreA =
        filteredResults.find((r) => r.parentChunkId === a.id)?.score ?? 0;
      const scoreB =
        filteredResults.find((r) => r.parentChunkId === b.id)?.score ?? 0;
      return scoreB - scoreA;
    });

    for (const parent of sortedParents) {
      const estimatedTokens = parent.tokenCount || parent.content.length / 4;

      if (totalTokens + estimatedTokens > MAX_CONTEXT_TOKENS) {
        break;
      }

      // Build location string for source citation
      const locationParts: string[] = [];
      if (parent.pageStart) {
        locationParts.push(
          parent.pageEnd && parent.pageEnd !== parent.pageStart
            ? `Page ${parent.pageStart}-${parent.pageEnd}`
            : `Page ${parent.pageStart}`,
        );
      }
      if (parent.sectionTitle) {
        locationParts.push(parent.sectionTitle);
      }
      const locationStr =
        locationParts.length > 0 ? ` (${locationParts.join(", ")})` : "";

      contextParts.push(
        `[${sources.length + 1}] ${parent.document.title}${locationStr}\n${parent.content}`,
      );
      totalTokens += estimatedTokens;

      const matchingResult = filteredResults.find(
        (r) => r.parentChunkId === parent.id,
      );

      sources.push({
        documentId: parent.document.id,
        documentTitle: parent.document.title,
        chunkId: parent.id,
        excerpt: parent.content.substring(0, 200) + "...",
        score: matchingResult?.score || 0,
        pageStart: parent.pageStart || undefined,
        pageEnd: parent.pageEnd || undefined,
        sectionTitle: parent.sectionTitle || undefined,
        metadata: parent.document.metadata as Record<string, unknown>,
      });
    }

    return {
      text: contextParts.join("\n\n---\n\n"),
      sources,
      totalTokens,
    };
  }

  /**
   * Simple query without the full pipeline (for testing)
   */
  async simpleQuery(
    query: string,
    knowledgeBaseIds: string[],
    topK: number = 5,
  ): Promise<SearchResult[]> {
    const embedding = await this.embeddingService.generateEmbedding(query, {
      taskType: "query",
    });
    return this.vectorSearch(embedding.embedding, knowledgeBaseIds, topK);
  }
}
