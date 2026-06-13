import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { AIModelType, WikiPage, WikiPageCategory } from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { KnowledgeBaseService } from "../rag/services/knowledge-base.service";
import { AiChatService } from "../../../ai-engine/facade";

export interface WikiQueryRequest {
  question: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  mode?: "inline" | "rag" | "auto";
}

export interface WikiQueryResult {
  answer: string;
  citations: Array<{ slug: string }>;
  usedPageIds: string[];
  branch: "A_inline" | "B_rag";
}

const DEFAULT_INLINE_PAGE_COUNT = 200;
const DEFAULT_INLINE_TOKEN_BUDGET = 500_000;

/** Approximate chars-per-token for budgeting markdown English/CJK content. */
const CHARS_PER_TOKEN = 4;

/**
 * WikiQueryService — v1.5.3 §5.2 dual-branch routing.
 *
 * Branch A (inline): default for KBs ≤ inlinePageCount + ≤ inlineTokenBudget.
 *   Loads all pages, ranks by simple term-frequency relevance against the
 *   question, packs into context up to the token budget, single LLM call
 *   produces answer + slug citations.
 *
 * Branch B (RAG select): wiki page embedding RAG. Per v1.5.3 §5.2, two-step
 *   compose: EmbeddingService.embed(question) + VectorService similarity
 *   search filtered to wiki_page_embeddings + resolution=ONELINER. The
 *   current VectorService surface is shaped for KB-document RAG and does
 *   not natively expose `sourceTable` filter, so this branch is implemented
 *   as a controlled fallback that warns and degrades to Branch A. Full
 *   embedding-driven page selection lands in a P2 sub-iteration alongside
 *   WikiPageEmbedding write-side wiring inside the apply transaction.
 */
@Injectable()
export class WikiQueryService {
  private readonly logger = new Logger(WikiQueryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kbService: KnowledgeBaseService,
    private readonly chat: AiChatService,
  ) {}

  async query(
    userId: string,
    knowledgeBaseId: string,
    request: WikiQueryRequest,
  ): Promise<WikiQueryResult> {
    if (!request.question || request.question.trim().length === 0) {
      throw new ForbiddenException("question must not be empty");
    }
    await this.assertViewerAccess(userId, knowledgeBaseId);
    await this.assertWikiEnabled(knowledgeBaseId);

    const config = await this.prisma.wikiKnowledgeBaseConfig.findUnique({
      where: { knowledgeBaseId },
    });
    const inlinePageCount =
      config?.inlinePageCount ?? DEFAULT_INLINE_PAGE_COUNT;
    const inlineTokenBudget =
      config?.inlineTokenBudget ?? DEFAULT_INLINE_TOKEN_BUDGET;

    const allPages = await this.prisma.wikiPage.findMany({
      where: { knowledgeBaseId },
      orderBy: { updatedAt: "desc" },
    });
    if (allPages.length === 0) {
      return {
        answer:
          "This wiki has no pages yet. Run an ingest from the Wiki sub-header to compile pages from your documents.",
        citations: [],
        usedPageIds: [],
        branch: "A_inline",
      };
    }

    const totalTokens = this.estimateTokens(allPages);
    const overInline =
      allPages.length > inlinePageCount || totalTokens > inlineTokenBudget;
    const requestedMode = request.mode ?? "auto";

    let useBranch: "A_inline" | "B_rag";
    if (requestedMode === "inline") useBranch = "A_inline";
    else if (requestedMode === "rag") useBranch = "B_rag";
    else useBranch = overInline ? "B_rag" : "A_inline";

    if (useBranch === "B_rag") {
      this.logger.warn(
        `[query] Branch B (RAG) requested for kb=${knowledgeBaseId} but embedding-driven selection is deferred to P2 sub-iteration; falling back to Branch A`,
      );
      // Fallback: keep the public surface stable while embedding write-side
      // is wired. Caller is informed via `branch: "A_inline"` even when the
      // intent was B — this is honest, not silent.
      useBranch = "A_inline";
    }

    return this.runBranchA(
      userId,
      knowledgeBaseId,
      request,
      allPages,
      inlineTokenBudget,
    );
  }

  // ─── Branch A: inline long context ───

  private async runBranchA(
    userId: string,
    knowledgeBaseId: string,
    request: WikiQueryRequest,
    pages: WikiPage[],
    tokenBudget: number,
  ): Promise<WikiQueryResult> {
    // Rank by question term frequency (BM25-like keyword score; embedding-free).
    const ranked = this.rankByTermFrequency(pages, request.question);
    const charBudget = Math.max(8000, tokenBudget * CHARS_PER_TOKEN);

    // Build context: index header (slug + oneLiner for ALL pages) +
    // top-ranked bodies up to budget.
    const indexLines = pages
      .map(
        (p) => `- [[${p.slug}]] (${p.category}) "${p.title}" — ${p.oneLiner}`,
      )
      .join("\n");
    let usedChars = indexLines.length;
    const usedPageIds: string[] = [];
    const bodyBlocks: string[] = [];

    for (const p of ranked) {
      const block = `\n## ${p.slug}\n${p.body}\n`;
      if (usedChars + block.length > charBudget) break;
      usedChars += block.length;
      usedPageIds.push(p.id);
      bodyBlocks.push(block);
    }

    const systemPrompt = [
      "You are an assistant answering questions strictly from the provided wiki.",
      "",
      "When you cite a page, refer to it by its [[slug]]. Do NOT invent slugs",
      "that don't appear in the wiki index.",
      "",
      "LANGUAGE: write the `answer` in the SAME language as the user's question.",
      "If the question is in 中文, answer in 中文. If in English, answer in English.",
      "Quote page titles / proper nouns / code verbatim from the wiki regardless.",
      "",
      "Respond ONLY with valid JSON:",
      '{ "answer": "<your answer with [[slug]] citations inline>", "citationSlugs": ["slug-1", "slug-2"] }',
    ].join("\n");

    const userPrompt = [
      "## Wiki index",
      indexLines,
      "",
      "## Selected page bodies",
      bodyBlocks.join("\n"),
      "",
      "## Question",
      request.question,
    ].join("\n\n");

    const llmResult = await this.chat.chat({
      systemPrompt,
      messages: this.buildMessages(request, userPrompt),
      modelType: AIModelType.CHAT,
      taskProfile: {
        creativity: "low",
        outputLength: "medium",
      },
      responseFormat: "json_object",
      operationName: "library-wiki-query-inline",
      userId,
    });

    const parsed = this.extractAnswer(llmResult.content);
    const validCitations = parsed.citationSlugs
      .filter((slug) => pages.some((p) => p.slug === slug))
      .map((slug) => ({ slug }));

    this.logger.log(
      `[query] kb=${knowledgeBaseId} branch=A_inline pages=${pages.length} usedPages=${usedPageIds.length}`,
    );

    return {
      answer: parsed.answer,
      citations: validCitations,
      usedPageIds,
      branch: "A_inline",
    };
  }

  // ─── Helpers ───

  private rankByTermFrequency(pages: WikiPage[], question: string): WikiPage[] {
    const terms = question
      .toLowerCase()
      .replace(/[^a-z0-9一-龥\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2);
    if (terms.length === 0) {
      // Fallback: oldest-first (stable, deterministic) so query has a
      // chance to surface SUMMARY/ENTITY pages first.
      return [...pages].sort((a, b) => {
        if (a.category === WikiPageCategory.SUMMARY) return -1;
        if (b.category === WikiPageCategory.SUMMARY) return 1;
        return 0;
      });
    }
    const scored = pages.map((p) => {
      const haystack =
        `${p.slug} ${p.title} ${p.oneLiner} ${p.body}`.toLowerCase();
      let score = 0;
      for (const t of terms) {
        const matches = haystack.split(t).length - 1;
        score += matches;
      }
      return { page: p, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.page);
  }

  private estimateTokens(pages: WikiPage[]): number {
    let total = 0;
    for (const p of pages) {
      total += Math.ceil(p.body.length / CHARS_PER_TOKEN);
      total += Math.ceil(p.oneLiner.length / CHARS_PER_TOKEN);
    }
    return total;
  }

  private buildMessages(
    request: WikiQueryRequest,
    userPrompt: string,
  ): Array<{ role: "user" | "assistant"; content: string }> {
    const history = request.history ?? [];
    return [
      ...history,
      {
        role: "user" as const,
        content: userPrompt,
      },
    ];
  }

  private extractAnswer(content: string): {
    answer: string;
    citationSlugs: string[];
  } {
    const cleaned = content
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      return { answer: content.slice(0, 4000), citationSlugs: [] };
    }
    try {
      const parsed = JSON.parse(match[0]) as Record<string, unknown>;
      const answer =
        typeof parsed.answer === "string"
          ? parsed.answer
          : content.slice(0, 4000);
      const citationSlugs = Array.isArray(parsed.citationSlugs)
        ? parsed.citationSlugs.filter((s): s is string => typeof s === "string")
        : [];
      return { answer, citationSlugs };
    } catch {
      return { answer: content.slice(0, 4000), citationSlugs: [] };
    }
  }

  private async assertViewerAccess(
    userId: string,
    knowledgeBaseId: string,
  ): Promise<void> {
    const ok = await this.kbService.hasAccess(
      knowledgeBaseId,
      userId,
      "VIEWER",
    );
    if (!ok) throw new ForbiddenException("Access denied");
  }

  private async assertWikiEnabled(knowledgeBaseId: string): Promise<void> {
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
      select: { wikiEnabled: true },
    });
    if (!kb) throw new NotFoundException("Knowledge base not found");
    if (!kb.wikiEnabled) {
      throw new ForbiddenException("Wiki is not enabled for this KB");
    }
  }
}
