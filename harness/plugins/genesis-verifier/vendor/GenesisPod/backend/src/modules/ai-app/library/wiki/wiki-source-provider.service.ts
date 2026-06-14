import { Injectable } from "@nestjs/common";
import { WikiPage, WikiPageSource } from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";

export interface WikiSourceHit {
  /** WikiPage id */
  pageId: string;
  /** Owning KB id — needed by callers to deep-link back to /library?kb=… */
  knowledgeBaseId: string;
  /** Wiki page slug — stable cross-page identifier */
  slug: string;
  /** Human-readable page title */
  title: string;
  /** ≤ 280-char one-liner that summarizes the page */
  oneLiner: string;
  /** Full markdown body of the page */
  body: string;
  /** WikiPage.category — ENTITY / CONCEPT / SUMMARY / SOURCE */
  category: string;
  /** Normalized BM25 score, ≥ 0; higher = more relevant */
  score: number;
  /** First N source citations on the page (for downstream documentTitle / chunkId mapping) */
  sources: Array<
    Pick<WikiPageSource, "documentId" | "spanStart" | "spanEnd" | "quote">
  >;
}

export interface WikiSourceSearchOptions {
  /** Top K pages to return; default 5 */
  topK?: number;
  /** Minimum BM25 score to keep; default 0 (return everything ranked) */
  minScore?: number;
}

/**
 * BM25 in-memory ranker over WikiPage.body + oneLiner. Designed for the
 * KB-query bridge (PR-2) — the unified `KbQueryService` calls
 * `WikiSourceProvider.search` first and only falls through to the chunk
 * RAG pipeline when wiki returns no confident hits.
 *
 * Why BM25 in-memory and not embedding RAG?
 *   - wiki pages are bounded (≤ 200 per KB by design — see `inlinePageCount`
 *     config default) so loading them all and scoring is cheap
 *   - no new write path: WikiPageEmbedding wiring stays a P3 concern
 *   - keyword precision is high for entity / concept lookups (the typical
 *     wiki query pattern) — embedding RAG would also win on paraphrase but
 *     that's a future PR if we observe miss rate
 *
 * Implementation notes:
 *   - tokenizer: lowercase + split on /\s+/ + strip punctuation; supports
 *     mixed CJK + ASCII (CJK chars become single-char tokens which is the
 *     accepted BM25-CJK shortcut)
 *   - BM25 parameters k1=1.5, b=0.75 (Lucene defaults)
 *   - score is normalized to [0, ∞) — caller decides threshold
 */
@Injectable()
export class WikiSourceProvider {
  private static readonly K1 = 1.5;
  private static readonly B = 0.75;
  private static readonly STOP_WORDS = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "of",
    "in",
    "on",
    "at",
    "to",
    "and",
    "or",
    "but",
    "for",
    "with",
    "as",
    "by",
    "from",
    "what",
    "how",
    "why",
    "when",
    "where",
    "which",
    "who",
  ]);

  constructor(private readonly prisma: PrismaService) {}

  async search(
    knowledgeBaseId: string,
    question: string,
    options: WikiSourceSearchOptions = {},
  ): Promise<WikiSourceHit[]> {
    const topK = options.topK ?? 5;
    const minScore = options.minScore ?? 0;

    const queryTerms = WikiSourceProvider.tokenize(question);
    if (queryTerms.length === 0) return [];

    // Wiki pages are bounded (≤ 200 / KB). Loading all + ranking in memory
    // is cheaper than crafting an SQL TF-IDF.
    const pages = await this.prisma.wikiPage.findMany({
      where: { knowledgeBaseId },
      include: {
        sources: {
          select: {
            documentId: true,
            spanStart: true,
            spanEnd: true,
            quote: true,
          },
          take: 5,
        },
      },
      take: 500,
    });

    if (pages.length === 0) return [];

    const ranked = WikiSourceProvider.rankBM25(pages, queryTerms);
    return ranked.filter((hit) => hit.score > minScore).slice(0, topK);
  }

  // ─── BM25 internals (static for testability) ───

  static tokenize(text: string): string[] {
    if (!text) return [];
    // Strip markdown punctuation that would inflate token counts but
    // keep CJK / ASCII letters / digits intact.
    const cleaned = text
      .toLowerCase()
      .replace(/[`*_~\[\]()<>|#{}!?,.;:"'\-—/\\=+]/g, " ");

    const tokens: string[] = [];
    for (const word of cleaned.split(/\s+/)) {
      if (!word) continue;
      // Split CJK-mixed words: each CJK char is its own token, ASCII runs
      // stay whole.
      let asciiBuf = "";
      for (const ch of word) {
        if (/[一-鿿぀-ヿ가-힯]/.test(ch)) {
          if (asciiBuf) {
            tokens.push(asciiBuf);
            asciiBuf = "";
          }
          tokens.push(ch);
        } else {
          asciiBuf += ch;
        }
      }
      if (asciiBuf) tokens.push(asciiBuf);
    }

    return tokens.filter(
      (t) => t.length > 0 && !WikiSourceProvider.STOP_WORDS.has(t),
    );
  }

  /**
   * Standard Okapi BM25 over (oneLiner + body). Returns hits sorted by
   * score descending. Pages with score=0 are still in the result set so
   * the caller can apply its own threshold.
   */
  static rankBM25(
    pages: Array<
      WikiPage & {
        sources: Array<
          Pick<WikiPageSource, "documentId" | "spanStart" | "spanEnd" | "quote">
        >;
      }
    >,
    queryTerms: string[],
  ): WikiSourceHit[] {
    const N = pages.length;
    if (N === 0) return [];

    // Tokenize each page once; keep token counts.
    const docTokens = pages.map((p) => {
      // Boost oneLiner by repeating it 3x (cheap term-frequency boost).
      const blob =
        (p.oneLiner ? p.oneLiner + " " : "").repeat(3) +
        " " +
        (p.title ? p.title + " " : "") +
        (p.body ?? "");
      return WikiSourceProvider.tokenize(blob);
    });

    const docLengths = docTokens.map((t) => t.length);
    const avgDocLength = docLengths.reduce((s, l) => s + l, 0) / Math.max(N, 1);

    // Document frequency for each query term.
    const df = new Map<string, number>();
    for (const term of queryTerms) {
      let count = 0;
      for (const tokens of docTokens) {
        if (tokens.includes(term)) count += 1;
      }
      df.set(term, count);
    }

    const hits: WikiSourceHit[] = [];
    for (let i = 0; i < pages.length; i++) {
      const tokens = docTokens[i];
      const len = docLengths[i];
      let score = 0;

      // Term-frequency cache for this doc.
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

      for (const term of queryTerms) {
        const termTf = tf.get(term) ?? 0;
        if (termTf === 0) continue;
        const termDf = df.get(term) ?? 0;
        // BM25 IDF: log((N - df + 0.5) / (df + 0.5) + 1)
        const idf = Math.log((N - termDf + 0.5) / (termDf + 0.5) + 1);
        const denom =
          termTf +
          WikiSourceProvider.K1 *
            (1 -
              WikiSourceProvider.B +
              WikiSourceProvider.B * (len / Math.max(avgDocLength, 1)));
        score += idf * ((termTf * (WikiSourceProvider.K1 + 1)) / denom);
      }

      const page = pages[i];
      hits.push({
        pageId: page.id,
        knowledgeBaseId: page.knowledgeBaseId,
        slug: page.slug,
        title: page.title,
        oneLiner: page.oneLiner,
        body: page.body,
        category: page.category,
        score,
        sources: page.sources,
      });
    }

    return hits.sort((a, b) => b.score - a.score);
  }
}
