import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import {
  RAGPipelineService,
  type RAGQuery,
  type RAGResponse,
  type RAGContext,
  type ContextSource,
  type SearchResult,
  type WikiPageRead,
} from "../../../ai-engine/facade";
import {
  WikiSourceProvider,
  type WikiSourceHit,
} from "../wiki/wiki-source-provider.service";
import { WikiPageService } from "../wiki/wiki-page.service";

/**
 * KbQueryService — unified KB query facade for all AI apps.
 *
 * The architectural shape consumers should adopt:
 *
 *   ai-app (ai-ask, topic-insights, teams, research, ...) →
 *     KbQueryService.query(RAGQuery)  ← THIS
 *       │
 *       ├─ WikiSourceProvider (wiki BM25, if KB has wikiEnabled)
 *       └─ RAGPipelineService (chunk RAG, fallback or augment)
 *
 * Wiki and chunk-RAG are both internal implementations — the consumer
 * sees a single "ask the knowledge base" surface. This is the Karpathy
 * "wiki is the primary artifact, query the wiki" idea wired to the
 * existing app contract: when wiki has confident hits we feed those to
 * the LLM (higher signal density than chunk RAG); when wiki misses we
 * fall through to chunk RAG so coverage is never reduced.
 *
 * Why a NEW service rather than monkey-patch RAGPipelineService:
 *   - layer rule: ai-engine cannot import ai-app modules
 *     (`backend/.eslintrc.js` `no-restricted-imports`). Wiki lives in
 *     ai-app, so the wiki-aware composition has to be at L3.
 *   - clean swap: ai-ask migrates one constructor parameter; everything
 *     else (request shape, response shape, options) stays identical.
 *
 * Confidence threshold: a wiki hit needs `score >= WIKI_MIN_SCORE` AND
 * the top-K cumulative score >= `WIKI_CUMULATIVE_THRESHOLD` to short-
 * circuit the chunk-RAG path. Both knobs tuned conservatively so wiki
 * never silently shadows a strong RAG match.
 */
@Injectable()
export class KbQueryService {
  private readonly logger = new Logger(KbQueryService.name);

  /** Minimum BM25 score for a single wiki hit to count. */
  private static readonly WIKI_MIN_SCORE = 0.5;
  /** Top-K cumulative wiki score required to short-circuit chunk RAG. */
  private static readonly WIKI_CUMULATIVE_THRESHOLD = 1.5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly wikiSourceProvider: WikiSourceProvider,
    private readonly ragPipeline: RAGPipelineService,
    private readonly wikiPageService: WikiPageService,
  ) {}

  /**
   * SearchResult-shaped facade for tool consumers (`rag-search` etc.) that
   * historically called `RAGPipelineService.simpleQuery`. Wiki-first when
   * the KB has wikiEnabled and BM25 is confident; otherwise delegates to
   * the chunk-RAG simple path. Implements `IKbQueryAugmentor` (port in
   * ai-engine/rag/abstractions/kb-query-augmentor.interface.ts).
   */
  async simpleQuery(
    query: string,
    knowledgeBaseIds: string[],
    topK = 5,
  ): Promise<SearchResult[]> {
    const wikiEnabledKbIds = await this.filterWikiEnabledKbs(knowledgeBaseIds);

    if (wikiEnabledKbIds.length > 0) {
      const wikiHits = await this.searchWikiAcrossKbs(
        wikiEnabledKbIds,
        query,
        topK,
      );

      const cumulativeScore = wikiHits.reduce((s, h) => s + h.score, 0);
      const topScore = wikiHits[0]?.score ?? 0;
      const wikiConfident =
        topScore >= KbQueryService.WIKI_MIN_SCORE &&
        cumulativeScore >= KbQueryService.WIKI_CUMULATIVE_THRESHOLD;

      if (wikiConfident) {
        this.logger.log(
          `[kb-query.simpleQuery] wiki short-circuit: ${wikiHits.length} hits, top=${topScore.toFixed(2)}, cum=${cumulativeScore.toFixed(2)}`,
        );
        return wikiHits.map((h) => ({
          childChunkId: `wiki-page:${h.pageId}`,
          parentChunkId: `wiki-page:${h.pageId}`,
          documentId: h.sources[0]?.documentId ?? `wiki-page:${h.pageId}`,
          content: h.body,
          parentContent: h.body,
          score: h.score,
          metadata: {
            source: "wiki",
            kbId: h.knowledgeBaseId,
            slug: h.slug,
            title: h.title,
            oneLiner: h.oneLiner,
            category: h.category,
          },
        }));
      }

      this.logger.debug(
        `[kb-query.simpleQuery] wiki low confidence (top=${topScore.toFixed(2)}, cum=${cumulativeScore.toFixed(2)}) — falling through to chunk RAG`,
      );
    }

    return this.ragPipeline.simpleQuery(query, knowledgeBaseIds, topK);
  }

  async query(request: RAGQuery): Promise<RAGResponse> {
    const startTime = Date.now();
    const topK = request.options?.topK ?? 5;

    const wikiEnabledKbIds = await this.filterWikiEnabledKbs(
      request.knowledgeBaseIds,
    );

    if (wikiEnabledKbIds.length > 0) {
      const wikiHits = await this.searchWikiAcrossKbs(
        wikiEnabledKbIds,
        request.query,
        topK,
      );

      const cumulativeScore = wikiHits.reduce((s, h) => s + h.score, 0);
      const topScore = wikiHits[0]?.score ?? 0;

      const wikiConfident =
        topScore >= KbQueryService.WIKI_MIN_SCORE &&
        cumulativeScore >= KbQueryService.WIKI_CUMULATIVE_THRESHOLD;

      if (wikiConfident) {
        this.logger.log(
          `[kb-query] wiki short-circuit: ${wikiHits.length} hits, top=${topScore.toFixed(2)}, cum=${cumulativeScore.toFixed(2)}`,
        );
        return this.buildResponseFromWiki(wikiHits, Date.now() - startTime);
      }

      this.logger.debug(
        `[kb-query] wiki low confidence (top=${topScore.toFixed(2)}, cum=${cumulativeScore.toFixed(2)}) — falling through to chunk RAG`,
      );
    }

    return this.ragPipeline.query(request);
  }

  /**
   * W4 v2.0 rebuild (2026-05-12): slug-based wiki page read used by the
   * engine `wiki-page-read` tool to follow [[slug]] cross-links. Returns
   * null on missing page / disabled wiki / unauthorized user so the tool
   * can degrade gracefully (vs throwing a NotFoundException up into the
   * ReAct loop). Implements `IKbQueryAugmentor.getWikiPage`.
   */
  async getWikiPage(
    userId: string,
    knowledgeBaseId: string,
    slug: string,
    _locale: "zh" | "en" = "zh",
  ): Promise<WikiPageRead | null> {
    try {
      const { page, outboundLinks, backlinks } =
        await this.wikiPageService.getPage(userId, knowledgeBaseId, slug);
      // 2026-05-14: wikiPageService 现在返 {slug,title,locale,exists}[];
      // WikiPageRead (LLM tool contract) 仍只需要 slug[] —— LLM 拿到 slug 后
      // 可调 wiki-page-read 自行解析 title。dewrap 一层保持 LLM 接口稳定。
      return {
        knowledgeBaseId: page.knowledgeBaseId,
        slug: page.slug,
        locale: page.locale,
        title: page.title,
        category: page.category,
        body: page.body,
        oneLiner: page.oneLiner,
        outboundLinks: outboundLinks.map((l) => l.slug),
        backlinks: backlinks.map((l) => l.slug),
        updatedAt: page.updatedAt.toISOString(),
      };
    } catch (error) {
      this.logger.debug(
        `[kb-query.getWikiPage] kb=${knowledgeBaseId} slug=${slug} miss: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  // ─── Internals ───

  private async filterWikiEnabledKbs(
    knowledgeBaseIds: string[],
  ): Promise<string[]> {
    if (knowledgeBaseIds.length === 0) return [];
    const rows = await this.prisma.knowledgeBase.findMany({
      where: { id: { in: knowledgeBaseIds }, wikiEnabled: true },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private async searchWikiAcrossKbs(
    kbIds: string[],
    question: string,
    topK: number,
  ): Promise<WikiSourceHit[]> {
    // Fan-out per KB; merge + re-sort by score so the cap is over all
    // wiki-enabled KBs combined (callers usually pass 1 KB but ai-ask
    // accepts up to 10).
    const perKbTopK = Math.max(2, Math.ceil(topK * 1.2));
    const allHits: WikiSourceHit[] = [];
    for (const kbId of kbIds) {
      try {
        const hits = await this.wikiSourceProvider.search(kbId, question, {
          topK: perKbTopK,
        });
        allHits.push(...hits);
      } catch (error) {
        this.logger.warn(
          `[kb-query] wiki search failed for kb=${kbId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return allHits.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  private buildResponseFromWiki(
    hits: WikiSourceHit[],
    elapsedMs: number,
  ): RAGResponse {
    const sources: ContextSource[] = hits.map((h) => {
      const excerpt =
        h.body.length > 1500 ? h.body.slice(0, 1500) + "…" : h.body;
      return {
        // ContextSource shape was designed for chunk RAG. Map wiki to it
        // so consumers (which already know how to render `documentTitle +
        // excerpt + score`) need zero changes.
        documentId: h.sources[0]?.documentId ?? `wiki-page:${h.pageId}`,
        documentTitle: h.title,
        chunkId: `wiki-page:${h.pageId}`,
        excerpt,
        score: h.score,
        metadata: {
          source: "wiki",
          // kbId + slug let consumers deep-link back to the wiki page
          // (e.g. `/library?tab=wiki&kb={kbId}&page={slug}`).
          kbId: h.knowledgeBaseId,
          slug: h.slug,
          oneLiner: h.oneLiner,
          category: h.category,
          // Pass through the underlying citations so a query → wiki page →
          // raw doc trace stays intact.
          wikiSourceCount: h.sources.length,
        },
      };
    });

    const text = hits
      .map(
        (h, i) =>
          `[Wiki ${i + 1}] ${h.title}${h.oneLiner ? ` — ${h.oneLiner}` : ""}\n${h.body}`,
      )
      .join("\n\n---\n\n");

    const context: RAGContext = {
      text,
      sources,
      // Cheap token estimate so consumers that report tokensUsed don't
      // see 0 (chinese chars ~ 2 tokens, others ~ 0.25 tokens).
      totalTokens: KbQueryService.estimateTokens(text),
    };

    const searchResults: SearchResult[] = hits.map((h) => ({
      childChunkId: `wiki-page:${h.pageId}`,
      parentChunkId: `wiki-page:${h.pageId}`,
      documentId: h.sources[0]?.documentId ?? `wiki-page:${h.pageId}`,
      content: h.body,
      parentContent: h.body,
      score: h.score,
      metadata: {
        source: "wiki",
        kbId: h.knowledgeBaseId,
        slug: h.slug,
        category: h.category,
      },
    }));

    return {
      context,
      searchResults,
      processingTime: { search: elapsedMs, total: elapsedMs },
      quality: "full",
    };
  }

  private static estimateTokens(text: string): number {
    const chinese = (text.match(/[一-龥]/g) || []).length;
    const other = text.length - chinese;
    return Math.ceil(chinese * 2 + other / 4);
  }
}
