/**
 * Wiki Page Read Tool — slug-based wiki page fetch (W4 v2.0 rebuild)
 *
 * 2026-05-12 W4: complements `rag-search` (semantic) with explicit slug-
 * based read so agents can follow [[slug]] cross-links and traverse the
 * wiki graph. Karpathy LLM Wiki blueprint: the wiki is the primary
 * artifact, queries should be able to walk the [[slug]] graph rather
 * than always re-running semantic search.
 *
 * Layer rule: engine cannot import ai-app, so the actual page read goes
 * through the `KB_QUERY_AUGMENTOR` Dependency Inversion port (same
 * pattern as `rag-search` augmentation). `KbQueryService` (ai-app/library/
 * kb-query) implements `IKbQueryAugmentor.getWikiPage` and is bound to
 * the port at module init.
 *
 * Behavior:
 *  • augmentor port not bound (wiki not loaded) → success:true, page:null
 *    so the agent can fall back to rag-search without raising an error
 *  • page missing / kb access denied → success:true, page:null + note
 *  • happy path → returns body + outbound/backlinks
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
  type WikiPageRead,
} from "@/modules/ai-engine/rag/abstractions/kb-query-augmentor.interface";

export interface WikiPageReadInput {
  knowledgeBaseId: string;
  slug: string;
  locale?: "zh" | "en";
}

export interface WikiPageReadOutput {
  success: boolean;
  page: WikiPageRead | null;
  note?: string;
  error?: string;
}

@Injectable()
export class WikiPageReadTool extends BaseTool<
  WikiPageReadInput,
  WikiPageReadOutput
> {
  private readonly logger = new Logger(WikiPageReadTool.name);
  readonly id = "wiki-page-read";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "information";
  readonly tags = ["knowledge", "wiki", "internal", "graph", "cross-link"];
  readonly name = "Wiki 页面读取";
  readonly description =
    "按 slug 直接读取 KB 的 Wiki 页面，返回正文 + outbound/backlinks（用于沿 [[slug]] 交叉引用走深度遍历）。先用 rag-search 拿到候选 slug，再用本工具按图谱深挖。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      knowledgeBaseId: {
        type: "string",
        description: "目标 KB ID（从 mission 上下文获取）",
      },
      slug: {
        type: "string",
        description:
          "Wiki 页面 slug（kebab-case，从 rag-search 或前一次 page 的 outboundLinks 拿）",
      },
      locale: {
        type: "string",
        enum: ["zh", "en"],
        description: "页面语种，KB 启用双语时区分。默认 'zh'",
      },
    },
    required: ["knowledgeBaseId", "slug"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      success: { type: "boolean" },
      page: {
        type: ["object", "null"],
        description: "页面正文 + 链接图谱；null 表示未找到或无权访问",
      },
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

  validateInput(input: WikiPageReadInput) {
    if (!input.knowledgeBaseId || typeof input.knowledgeBaseId !== "string") {
      return false;
    }
    if (!input.slug || typeof input.slug !== "string") {
      return false;
    }
    if (input.slug.length > 200) return false;
    if (
      input.locale !== undefined &&
      input.locale !== "zh" &&
      input.locale !== "en"
    ) {
      return false;
    }
    return true;
  }

  protected async doExecute(
    input: WikiPageReadInput,
    context: ToolContext,
  ): Promise<WikiPageReadOutput> {
    if (
      !this.kbAugmentor ||
      typeof this.kbAugmentor.getWikiPage !== "function"
    ) {
      return {
        success: true,
        page: null,
        note: "wiki integration not bound — caller should fall back to rag-search",
      };
    }
    const userId = context.userId;
    if (!userId) {
      return {
        success: false,
        page: null,
        error:
          "userId missing in tool context — wiki access requires authenticated user",
      };
    }

    try {
      const page = await this.kbAugmentor.getWikiPage(
        userId,
        input.knowledgeBaseId,
        input.slug,
        input.locale ?? "zh",
      );
      if (!page) {
        return {
          success: true,
          page: null,
          note: `no wiki page kb=${input.knowledgeBaseId} slug=${input.slug} (wiki disabled / page missing / access denied)`,
        };
      }
      this.logger.debug(
        `[wiki-page-read] kb=${input.knowledgeBaseId} slug=${input.slug} → ${page.outboundLinks.length} outbound, ${page.backlinks.length} backlinks`,
      );
      return { success: true, page };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[wiki-page-read] failed: ${message}`);
      return {
        success: false,
        page: null,
        error: message,
      };
    }
  }
}
