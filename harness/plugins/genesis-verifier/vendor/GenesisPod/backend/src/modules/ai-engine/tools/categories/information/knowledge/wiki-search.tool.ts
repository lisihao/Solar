/**
 * Wiki Search Tool — semantic search restricted to wiki pages.
 *
 * 2026-05-12 gap #3: complements `rag-search` (which is wiki-aware but goes
 * through the chunk-RAG fallback when wiki confidence is low). When an
 * agent KNOWS it wants wiki — e.g. it has a slug from a previous call and
 * wants to find more related pages — this tool guarantees the result set is
 * wiki-only, no chunk fallback.
 *
 * Layer rule: engine cannot import ai-app, so the actual search goes
 * through the `KB_QUERY_AUGMENTOR` Dependency Inversion port. The
 * augmentor's `simpleQuery` already routes wiki-first when confident, but
 * here we keep the returned `metadata.source === 'wiki'` items only — if
 * the augmentor falls through to chunk RAG, this tool returns 0 results
 * (rather than silently surfacing chunk RAG).
 */

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { BaseTool } from "../../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../../abstractions/tool.interface";
import {
  KB_QUERY_AUGMENTOR,
  type IKbQueryAugmentor,
} from "@/modules/ai-engine/rag/abstractions/kb-query-augmentor.interface";

export interface WikiSearchInput {
  query: string;
  knowledgeBaseIds: string[];
  topK?: number;
}

export interface WikiSearchHit {
  slug: string;
  kbId: string;
  title?: string;
  oneLiner?: string;
  category?: string;
  score: number;
  excerpt: string;
}

export interface WikiSearchOutput {
  success: boolean;
  results: WikiSearchHit[];
  totalResults: number;
  note?: string;
  error?: string;
}

@Injectable()
export class WikiSearchTool extends BaseTool<
  WikiSearchInput,
  WikiSearchOutput
> {
  private readonly logger = new Logger(WikiSearchTool.name);
  readonly id = "wiki-search";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "information";
  readonly tags = ["knowledge", "wiki", "internal", "semantic"];
  readonly name = "Wiki 语义搜索";
  readonly description =
    "在 KB 的 Wiki 页面里做语义召回（只返回 wiki page；如果 KB 未启用 wiki / 召回低置信度，返回空，不退回 chunk RAG）。先用本工具拿 slug 候选，再用 wiki-page-read 按 [[slug]] 走深度遍历。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "搜索查询文本（自然语言）",
      },
      knowledgeBaseIds: {
        type: "array",
        description: "限定召回范围的 KB ID 列表（从 mission 上下文取）",
        items: { type: "string" },
      },
      topK: {
        type: "number",
        description: "返回结果数量，默认 5，最大 20",
        default: 5,
      },
    },
    required: ["query", "knowledgeBaseIds"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      success: { type: "boolean" },
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            slug: { type: "string" },
            kbId: { type: "string" },
            title: { type: "string" },
            oneLiner: { type: "string" },
            category: { type: "string" },
            score: { type: "number" },
            excerpt: { type: "string" },
          },
        },
      },
      totalResults: { type: "number" },
      note: { type: "string" },
      error: { type: "string" },
    },
  };

  constructor(
    @Optional()
    @Inject(KB_QUERY_AUGMENTOR)
    private readonly kbAugmentor?: IKbQueryAugmentor,
  ) {
    super();
  }

  validateInput(input: WikiSearchInput) {
    if (!input.query || typeof input.query !== "string") return false;
    if (input.query.trim().length === 0 || input.query.length > 2000) {
      return false;
    }
    if (!Array.isArray(input.knowledgeBaseIds)) return false;
    if (input.knowledgeBaseIds.length === 0) return false;
    if (input.knowledgeBaseIds.length > 10) return false;
    if (input.topK !== undefined) {
      if (typeof input.topK !== "number" || input.topK < 1 || input.topK > 20) {
        return false;
      }
    }
    return true;
  }

  protected async doExecute(
    input: WikiSearchInput,
    _context: ToolContext,
  ): Promise<WikiSearchOutput> {
    if (!this.kbAugmentor) {
      return {
        success: true,
        results: [],
        totalResults: 0,
        note: "wiki integration not bound — caller should fall back to rag-search",
      };
    }

    const { query, knowledgeBaseIds, topK = 5 } = input;

    try {
      const raw = await this.kbAugmentor.simpleQuery(
        query,
        knowledgeBaseIds,
        topK,
      );
      // gap #3 (2026-05-12): hard-filter to wiki-only results. The
      // augmentor returns mixed chunk + wiki entries when wiki confidence
      // is below threshold; this tool's contract is "wiki only", so we
      // surface 0 results in that case rather than blur with chunk hits.
      const wikiHits = raw.filter(
        (r) =>
          r.metadata &&
          typeof r.metadata === "object" &&
          r.metadata.source === "wiki",
      );
      const results: WikiSearchHit[] = wikiHits.map((r) => {
        const md = r.metadata ?? {};
        return {
          slug: typeof md.slug === "string" ? md.slug : "",
          kbId: typeof md.kbId === "string" ? md.kbId : "",
          title: typeof md.title === "string" ? md.title : undefined,
          oneLiner: typeof md.oneLiner === "string" ? md.oneLiner : undefined,
          category: typeof md.category === "string" ? md.category : undefined,
          score: r.score,
          excerpt:
            r.content.length > 600 ? r.content.slice(0, 600) + "…" : r.content,
        };
      });
      this.logger.debug(
        `[wiki-search] kbs=${knowledgeBaseIds.length} → ${results.length}/${raw.length} wiki hits (chunk drops=${
          raw.length - wikiHits.length
        })`,
      );
      if (results.length === 0) {
        return {
          success: true,
          results: [],
          totalResults: 0,
          note: "no wiki hits — KB may not have wikiEnabled, or wiki has no related pages; fall back to rag-search if needed",
        };
      }
      return { success: true, results, totalResults: results.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[wiki-search] failed: ${message}`);
      return {
        success: false,
        results: [],
        totalResults: 0,
        error: message,
      };
    }
  }
}
