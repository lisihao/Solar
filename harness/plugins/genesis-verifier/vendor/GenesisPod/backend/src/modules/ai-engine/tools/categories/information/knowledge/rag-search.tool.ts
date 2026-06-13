/**
 * RAG Search Tool —— 本地知识库语义检索
 *
 * ★ 2026-04-30 重构（origin: {app} RAG unavailable 问题）：
 *   原实现走老的 chunks/embeddings 表（pgvector 路径），Railway PostgreSQL 不
 *   支持 pgvector，相关表从未创建，导致 mission 中 rag-search 永远返回
 *   "RAG unavailable: chunks/embeddings tables not found"。
 *
 *   新实现委托 RAGPipelineService.simpleQuery，走当前 work 的数据模型：
 *     KnowledgeBase → KnowledgeBaseDocument → ParentChunk → ChildChunk →
 *     ChildEmbedding(JSONB) + 应用层余弦相似度
 *   该路径已被 ai-app/library/rag、ai-ask、open-api/ai 共用且 work，
 *   consumer 的 researcher / writing 等消费方自动受益。
 *
 * 行为：
 *   • 入参未传 knowledgeBaseIds（或为空）→ 直接返回 success:true + results:[] +
 *     note，让 LLM 自然走 web-search，不再发"假 error"。
 *   • 传了 knowledgeBaseIds → 走 RAGPipelineService.simpleQuery 做语义召回。
 */

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { BaseTool } from "../../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../../abstractions/tool.interface";
import { RAGPipelineService } from "@/modules/ai-engine/rag/pipeline";
import {
  KB_QUERY_AUGMENTOR,
  type IKbQueryAugmentor,
} from "@/modules/ai-engine/rag/abstractions/kb-query-augmentor.interface";

// ============================================================================
// Types
// ============================================================================

/**
 * RAG 搜索输入参数
 */
export interface RAGSearchInput {
  /**
   * 搜索查询文本
   */
  query: string;

  /**
   * 本地知识库 ID 列表（必填语义）—— 限定召回范围。
   * 不传 / 空数组 → 工具直接返回空结果（不报错），调用方走其他 tool。
   */
  knowledgeBaseIds?: string[];

  /**
   * 返回结果数量，默认 5，最大 20
   */
  topK?: number;

  /**
   * 相似度阈值（0-1），低于此值的结果将被过滤
   */
  threshold?: number;
}

/**
 * RAG 搜索结果项
 */
export interface RAGSearchResultItem {
  /** ChildChunk ID */
  chunkId: string;

  /** 关联的 KnowledgeBaseDocument ID */
  documentId: string;

  /** 文本内容 */
  content: string;

  /** 相似度分数（0-1） */
  score: number;

  /** 元数据（来自 ChildChunk.metadata） */
  metadata: {
    parentChunkId?: string;
    parentContent?: string;
    [key: string]: unknown;
  };
}

/**
 * RAG 搜索输出结果
 */
export interface RAGSearchOutput {
  /** 搜索结果列表 */
  results: RAGSearchResultItem[];

  /** 搜索是否成功 */
  success: boolean;

  /** 结果总数 */
  totalResults: number;

  /** 当 success=true 但 results=[] 时的说明（如 "no knowledgeBaseIds provided"） */
  note?: string;

  /** 失败时的明细原因（success=false 时） */
  error?: string;
}

// ============================================================================
// Tool Implementation
// ============================================================================

/**
 * RAG 向量检索工具
 *
 * 状态：READY（2026-04-30 起走 RAGPipelineService）
 *
 * 功能：
 * - 委托 RAGPipelineService.simpleQuery 做查询向量化 + 余弦相似度搜索
 * - 限定在用户传入的 knowledgeBaseIds 内召回
 * - 不依赖 pgvector，走 ChildEmbedding(JSONB) + 应用层计算
 */
@Injectable()
export class RAGSearchTool extends BaseTool<RAGSearchInput, RAGSearchOutput> {
  private readonly logger = new Logger(RAGSearchTool.name);
  readonly id = "rag-search";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "information";
  readonly tags = ["knowledge", "rag", "vector", "internal", "embedding"];
  readonly name = "向量检索";
  readonly description =
    "在用户的本地知识库中做语义召回。必须传 knowledgeBaseIds（mission 上下文已注入），否则返回空。返回与 query 最相关的文档片段，适合先看本地知识够不够、再补 web-search 的研究流程。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "搜索查询文本，描述你想要查找的信息",
      },
      knowledgeBaseIds: {
        type: "array",
        description:
          "限定召回范围的知识库 ID 列表。从 mission 上下文中拿（system prompt 里给出）。空 → 直接返回空。",
        items: { type: "string" },
      },
      topK: {
        type: "number",
        description: "返回结果数量，默认 5，最大 20",
        default: 5,
      },
      threshold: {
        type: "number",
        description: "相似度阈值（0-1），低于此值的结果将被过滤，默认 0.5",
        default: 0.5,
      },
    },
    required: ["query"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      results: {
        type: "array",
        description: "搜索结果列表",
        items: {
          type: "object",
          properties: {
            chunkId: { type: "string" },
            documentId: { type: "string" },
            content: { type: "string" },
            score: { type: "number" },
            metadata: { type: "object" },
          },
        },
      },
      success: { type: "boolean", description: "搜索是否成功" },
      totalResults: { type: "number", description: "返回的结果数量" },
      note: { type: "string", description: "可选说明（成功但无结果时）" },
      error: { type: "string", description: "失败原因" },
    },
  };

  constructor(
    private readonly ragPipeline: RAGPipelineService,
    /**
     * Optional Dependency-Inversion port (PR-Wiki-Aug 2026-05-10).
     * When `KbQueryModule` is loaded (i.e. anywhere in the app graph),
     * `KbQueryService` registers itself against `KB_QUERY_AUGMENTOR` and
     * `simpleQuery` here gets routed through wiki-first → chunk-RAG
     * fallback transparently. When the port is not bound, behavior is
     * identical to the legacy chunk-only path.
     */
    @Optional()
    @Inject(KB_QUERY_AUGMENTOR)
    private readonly kbAugmentor?: IKbQueryAugmentor,
  ) {
    super();
  }

  validateInput(input: RAGSearchInput) {
    if (!input.query || typeof input.query !== "string") {
      this.logger.error("Invalid query: must be a non-empty string");
      return false;
    }
    if (input.query.trim().length === 0) {
      this.logger.error("Invalid query: query is empty");
      return false;
    }
    if (input.query.length > 2000) {
      this.logger.error("Invalid query: query too long (max 2000 characters)");
      return false;
    }
    if (input.topK !== undefined) {
      if (typeof input.topK !== "number" || input.topK < 1 || input.topK > 20) {
        this.logger.error("Invalid topK: must be between 1 and 20");
        return false;
      }
    }
    if (input.threshold !== undefined) {
      if (
        typeof input.threshold !== "number" ||
        input.threshold < 0 ||
        input.threshold > 1
      ) {
        this.logger.error("Invalid threshold: must be between 0 and 1");
        return false;
      }
    }
    if (input.knowledgeBaseIds !== undefined) {
      if (!Array.isArray(input.knowledgeBaseIds)) {
        this.logger.error("Invalid knowledgeBaseIds: must be an array");
        return false;
      }
      if (input.knowledgeBaseIds.length > 10) {
        this.logger.error("Invalid knowledgeBaseIds: too many KBs (max 10)");
        return false;
      }
    }
    return true;
  }

  protected async doExecute(
    input: RAGSearchInput,
    _context: ToolContext,
  ): Promise<RAGSearchOutput> {
    const { query, knowledgeBaseIds, topK = 5, threshold = 0.5 } = input;

    if (!knowledgeBaseIds || knowledgeBaseIds.length === 0) {
      this.logger.debug(
        "rag-search called without knowledgeBaseIds; returning empty results",
      );
      return {
        results: [],
        success: true,
        totalResults: 0,
        note: "no knowledgeBaseIds provided — caller should fall back to web-search",
      };
    }

    this.logger.log(
      `RAG search: query="${query.substring(0, 100)}..." kbs=${knowledgeBaseIds.length} topK=${topK}`,
    );

    try {
      // Prefer the KB augmentor (wiki-first) when bound — it decides wiki vs
      // chunk RAG itself. Without an augmentor, run the FULL RAG pipeline
      // (R2-#41): HyDE → hybrid(vector+keyword RRF) → Cohere rerank → parent
      // retrieval — instead of the test-grade simpleQuery (embedding+vectorSearch
      // only) that production was wired to. simpleQuery under-retrieves → starves
      // grounding → review scores stay low. Rerank degrades gracefully without a
      // Cohere key (falls back to hybrid scores), so no hard new dependency.
      // When using the KB augmentor (wiki-first path), results come from a cosine-space
      // scorer and the caller threshold (default 0.5) is meaningful — apply it.
      //
      // When using the full RAG pipeline (HyDE → hybrid RRF → Cohere rerank → parent),
      // do NOT re-apply the cosine-calibrated threshold: after Cohere rerank the score is
      // relevance_score (~0.3 median, different distribution). Re-filtering here defeats
      // the pipeline entirely — the pipeline already applied minScore + topK internally.
      // Return its searchResults as-is (already relevance-ordered).
      let raw: import("@/modules/ai-engine/rag/pipeline/rag-pipeline.interface").SearchResult[];
      if (this.kbAugmentor) {
        const augmentorResults = await this.kbAugmentor.simpleQuery(
          query,
          knowledgeBaseIds,
          topK,
        );
        raw = augmentorResults.filter((r) => r.score >= threshold);
      } else {
        // Enable HyDE only for elaborated natural-language queries (>40 chars /
        // ~8+ tokens). Short keyword queries gain little from the extra LLM call.
        const useHyde = query.trim().length > 40;
        const pipelineResponse = await this.ragPipeline.query({
          query,
          knowledgeBaseIds,
          options: { topK, useHyde },
        });
        // Full pipeline already did minScore + rerank + topK; skip cosine threshold here.
        raw = pipelineResponse.searchResults;
      }
      const results: RAGSearchResultItem[] = raw.map((r) => ({
        chunkId: r.childChunkId,
        documentId: r.documentId,
        content: r.content,
        score: r.score,
        metadata: {
          parentChunkId: r.parentChunkId,
          parentContent: r.parentContent,
          ...(r.metadata ?? {}),
        },
      }));
      this.logger.log(`RAG search returned ${results.length} results`);
      return {
        results,
        success: true,
        totalResults: results.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // ★ 2026-05-04 修：RAG 失败分类 —— 上游 embedding 限流时给 ReAct loop
      //   清晰错误信息 + 降日志级别（429 不是 critical）
      const isRateLimit =
        /429|rate.?limit|too many requests|circuit.?open/i.test(message);
      const isUpstreamUnavailable =
        /service.?unavailable|503|ECONN|ETIMEDOUT/i.test(message);
      const friendlyMessage = isRateLimit
        ? "上游 embedding 服务暂时限流（rate-limit），无法生成查询向量。建议改用其他检索工具（web-search / academic-search）或稍后重试本工具。"
        : isUpstreamUnavailable
          ? "Embedding 服务暂时不可用，建议改用其他检索工具或稍后重试。"
          : message;
      if (isRateLimit) {
        this.logger.warn(`[rag-search] upstream rate-limited: ${message}`);
      } else {
        this.logger.error(`RAG search failed: ${message}`);
      }
      return {
        results: [],
        success: false,
        totalResults: 0,
        error: friendlyMessage,
      };
    }
  }
}
