/**
 * RAGFacade — Domain Facade for Search, Memory, Embeddings, and Vector Operations
 *
 * Responsibilities:
 * - Web search via ToolRegistry
 * - Context building from multiple sources
 * - Short-term and long-term memory operations
 * - Embedding generation and vector similarity search
 *
 * @Injectable — registered as a NestJS provider in facade.providers.ts
 */

import { Injectable, Logger, Optional, Inject } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { MemorySubFacade } from "../sub-facades/memory.sub-facade";
import type {
  MemoryFeature,
  KnowledgeFeature,
  ContentFeature,
  ToolFeature,
} from "../facade.providers";
import {
  MEMORY_FEATURE,
  KNOWLEDGE_FEATURE,
  CONTENT_FEATURE,
  TOOL_FEATURE,
} from "../facade.providers";
import type {
  SearchRequest,
  SearchResponse,
  SearchResultItem,
  BuildContextRequest,
  StoreMemoryRequest,
  RetrieveMemoryRequest,
  MemoryItem,
} from "../types";
import type { EmbeddingService } from "@/modules/ai-engine/rag/embedding";
import type { EmbeddingResult } from "@/modules/ai-engine/rag/embedding";
import type {
  VectorService,
  SimilaritySearchOptions,
  SimilarityResult,
} from "@/modules/ai-engine/rag/vector/vector.service";
import type { ContentFetchService } from "../../../ai-engine/content/fetch/content-fetch.service";
import type { ToolContext } from "../../../ai-engine/tools/abstractions/tool.interface";

@Injectable()
export class RAGFacade {
  private readonly logger = new Logger(RAGFacade.name);

  private readonly memorySub: MemorySubFacade;

  constructor(
    @Optional()
    @Inject(MEMORY_FEATURE)
    private readonly memory?: MemoryFeature,
    @Optional()
    @Inject(KNOWLEDGE_FEATURE)
    private readonly knowledge?: KnowledgeFeature,
    @Optional()
    @Inject(CONTENT_FEATURE)
    private readonly content?: ContentFeature,
    @Optional()
    @Inject(TOOL_FEATURE)
    private readonly tools?: ToolFeature,
    @Optional() private readonly prisma?: PrismaService,
  ) {
    this.memorySub = new MemorySubFacade(memory);
  }

  // ==================== Search ====================

  async search(request: SearchRequest): Promise<SearchResponse> {
    this.logger.debug(
      `[search] query="${request.query}", maxResults=${request.maxResults}`,
    );

    const webSearchTool = this.tools?.registry?.tryGet("web-search");
    if (webSearchTool) {
      try {
        const toolResult = await webSearchTool.execute(
          { query: request.query, numResults: request.maxResults || 5 },
          this.createToolContext("web-search"),
        );

        if (toolResult.success && toolResult.data) {
          const searchData = toolResult.data as {
            results: Array<{
              title: string;
              url: string;
              content: string;
              score?: number;
              publishedDate?: string;
              domain?: string;
            }>;
            success: boolean;
            error?: string;
          };

          const items: SearchResultItem[] = (searchData.results || []).map(
            (r) => ({
              title: r.title,
              url: r.url,
              content: r.content,
              score: r.score,
              publishedDate: r.publishedDate,
              domain: r.domain,
            }),
          );

          return {
            success: searchData.success,
            results: items,
            error: searchData.error,
          };
        }
      } catch (error) {
        this.logger.warn(`[search] ToolRegistry search failed: ${error}`);
      }
    }

    return {
      success: false,
      results: [],
      error: "Search tool not available via ToolRegistry",
    };
  }

  formatSearchResultsForContext(results: SearchResultItem[]): string {
    return results
      .map(
        (r, i) => `[${i + 1}] **${r.title}**\n${r.content}\nSource: ${r.url}`,
      )
      .join("\n\n");
  }

  // ==================== Context Building ====================

  async buildContext(request: BuildContextRequest): Promise<string> {
    this.logger.debug(
      `[buildContext] sources=${request.sources.length}, maxTokens=${request.maxTokens}`,
    );

    const parts: string[] = [];

    for (const source of request.sources) {
      switch (source.type) {
        case "custom":
          if (source.content) {
            parts.push(source.content);
          }
          break;

        case "memory":
          if (source.id && this.memory?.shortTerm) {
            const memory = await this.memory.shortTerm.getWithSession(
              source.id,
              "context",
            );
            if (memory && typeof memory === "string") {
              parts.push(`## Recent Memory\n${memory}`);
            }
          }
          break;

        case "search":
          if (source.content) {
            const searchResult = await this.search({
              query: source.content,
              maxResults: 5,
            });
            if (searchResult.success && searchResult.results.length > 0) {
              parts.push(
                this.formatSearchResultsForContext(searchResult.results),
              );
            }
          }
          break;

        case "topic":
          if (source.data) {
            const topic = source.data as {
              name: string;
              type: string;
              description?: string;
              dimensions?: Array<{ name: string; description?: string }>;
            };
            let topicContext = `## Research Topic: ${topic.name}\n`;
            topicContext += `Type: ${topic.type}\n`;
            if (topic.description) {
              topicContext += `Description: ${topic.description}\n`;
            }
            if (topic.dimensions && topic.dimensions.length > 0) {
              topicContext += `\nDimensions:\n`;
              for (const dim of topic.dimensions) {
                topicContext += `- ${dim.name}: ${dim.description || "No description"}\n`;
              }
            }
            parts.push(topicContext);
          } else if (source.id && this.prisma) {
            this.logger.warn(
              `[buildContext] Deprecated: type="topic" with id="${source.id}" should pass data via source.data instead of direct Prisma query`,
            );
            const topic = await this.prisma.researchTopic.findUnique({
              where: { id: source.id },
              include: { dimensions: true },
            });
            if (topic) {
              let topicContext = `## Research Topic: ${topic.name}\n`;
              topicContext += `Type: ${topic.type}\n`;
              if (topic.description) {
                topicContext += `Description: ${topic.description}\n`;
              }
              if (topic.dimensions && topic.dimensions.length > 0) {
                topicContext += `\nDimensions:\n`;
                for (const dim of topic.dimensions) {
                  topicContext += `- ${dim.name}: ${dim.description || "No description"}\n`;
                }
              }
              parts.push(topicContext);
            }
          }
          break;

        case "resource":
          if (source.data) {
            const resource = source.data as {
              title: string;
              aiSummary?: string;
              content?: string;
            };
            let resourceContext = `## Resource: ${resource.title}\n`;
            if (resource.aiSummary) {
              resourceContext += `Summary: ${resource.aiSummary}\n`;
            }
            if (resource.content) {
              const text =
                resource.content.length > 2000
                  ? resource.content.substring(0, 2000) + "..."
                  : resource.content;
              resourceContext += `\nContent:\n${text}`;
            }
            parts.push(resourceContext);
          } else if (source.id && this.prisma) {
            this.logger.warn(
              `[buildContext] Deprecated: type="resource" with id="${source.id}" should pass data via source.data instead of direct Prisma query`,
            );
            const resource = await this.prisma.resource.findUnique({
              where: { id: source.id },
            });
            if (resource) {
              let resourceContext = `## Resource: ${resource.title}\n`;
              if (resource.aiSummary) {
                resourceContext += `Summary: ${resource.aiSummary}\n`;
              }
              if (resource.content) {
                const text =
                  resource.content.length > 2000
                    ? resource.content.substring(0, 2000) + "..."
                    : resource.content;
                resourceContext += `\nContent:\n${text}`;
              }
              parts.push(resourceContext);
            }
          }
          break;

        default:
          if (source.content) {
            parts.push(source.content);
          }
      }
    }

    let context = parts.join("\n\n---\n\n");

    if (request.maxTokens && request.compress) {
      const estimatedTokens = this.estimateTokens(context);
      if (estimatedTokens > request.maxTokens) {
        context = this.compressContext(context, request.maxTokens);
      }
    }

    return context;
  }

  private estimateTokens(text: string): number {
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars * 2 + otherChars / 4);
  }

  private compressContext(context: string, maxTokens: number): string {
    const currentTokens = this.estimateTokens(context);
    if (currentTokens <= maxTokens) {
      return context;
    }

    const ratio = maxTokens / currentTokens;
    const targetLength = Math.floor(context.length * ratio * 0.9);

    const headLength = Math.floor(targetLength * 0.6);
    const tailLength = Math.floor(targetLength * 0.3);

    const head = context.substring(0, headLength);
    const tail = context.substring(context.length - tailLength);

    return `${head}\n\n[... content compressed ...]\n\n${tail}`;
  }

  // ==================== Memory ====================

  async storeMemory(request: StoreMemoryRequest): Promise<void> {
    return this.memorySub.storeMemory(request);
  }

  async retrieveMemory(request: RetrieveMemoryRequest): Promise<MemoryItem[]> {
    return this.memorySub.retrieveMemory(request);
  }

  async clearMemory(sessionId: string): Promise<void> {
    return this.memorySub.clearMemory(sessionId);
  }

  async sessionMemoryGet(sessionId: string, key: string): Promise<unknown> {
    return this.memorySub.sessionMemoryGet(sessionId, key);
  }

  async sessionMemorySet(
    sessionId: string,
    key: string,
    value: unknown,
    ttl?: number,
  ): Promise<void> {
    return this.memorySub.sessionMemorySet(sessionId, key, value, ttl);
  }

  async sessionMemoryClear(sessionId: string): Promise<void> {
    return this.memorySub.sessionMemoryClear(sessionId);
  }

  // ==================== Embeddings ====================

  /**
   * @deprecated [task #24] 优先用 embeddingGenerateBatch（即使单条也用 batch
   * API 单调用：1 次 HTTP，401 时只触发 1 次 ERROR + auth-circuit-break）。
   * 本方法保留作向后兼容，新代码不应使用。后续 PR 把全部 caller 迁完后删除。
   */
  async embeddingGenerate(text: string): Promise<EmbeddingResult | null> {
    return (await this.knowledge?.embedding?.generateEmbedding(text)) ?? null;
  }

  /**
   * ★ 2026-05-05: batch embedding —— 单次调用拿一组 text 的 embedding。
   * 底层 EmbeddingService.generateEmbeddings 自动按 provider 分批
   * (OpenAI 100, Cohere 96)，1 次调用替代 N 次单调用 → 减少 N-1 次 HTTP roundtrip
   * + 401 时只触发 1 次 ERROR + circuit-break。figure-relevance 等场景受益。
   */
  async embeddingGenerateBatch(
    texts: string[],
  ): Promise<{ texts: string[]; embeddings: number[][]; totalTokens: number } | null> {
    if (!this.knowledge?.embedding) return null;
    if (texts.length === 0) {
      return { texts: [], embeddings: [], totalTokens: 0 };
    }
    return this.knowledge.embedding.generateEmbeddings(texts);
  }

  async embeddingGetModel(): Promise<string | null> {
    return (await this.knowledge?.embedding?.getModel()) ?? null;
  }

  // ==================== Vector Search ====================

  async vectorSimilaritySearch(
    queryEmbedding: number[],
    options?: SimilaritySearchOptions,
  ): Promise<SimilarityResult[]> {
    if (!this.knowledge?.vector) {
      this.logger.warn(
        "[vectorSimilaritySearch] VectorService unavailable (DI not wired). Returning empty array.",
      );
      return [];
    }
    return (
      (await this.knowledge.vector.similaritySearch(queryEmbedding, options)) ??
      []
    );
  }

  // ==================== Service Getters ====================

  /** Raw EmbeddingService instance (for direct operations like getConfigInfo) */
  get embedding(): EmbeddingService | undefined {
    return this.knowledge?.embedding;
  }

  /** Raw VectorService instance (for advanced vector operations) */
  get vector(): VectorService | undefined {
    return this.knowledge?.vector;
  }

  /** ContentFetchService for URL/YouTube content fetching */
  get contentFetch(): ContentFetchService | undefined {
    return this.content?.contentFetch;
  }

  // ==================== Helpers ====================

  private createToolContext(toolId: string): ToolContext {
    return {
      executionId: `${toolId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      toolId,
      createdAt: new Date(),
      callerType: "orchestrator",
    };
  }
}
