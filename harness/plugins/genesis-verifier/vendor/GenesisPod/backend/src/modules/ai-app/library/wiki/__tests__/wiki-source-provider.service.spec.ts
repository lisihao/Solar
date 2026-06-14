/**
 * WikiSourceProvider spec — BM25 ranking over WikiPage.body + oneLiner.
 * Covers tokenizer, IDF effect, oneLiner boost, and topK cap.
 */

import { WikiPage, WikiPageSource } from "@prisma/client";
import { WikiSourceProvider } from "../wiki-source-provider.service";

type PageInput = WikiPage & {
  sources: Array<
    Pick<WikiPageSource, "documentId" | "spanStart" | "spanEnd" | "quote">
  >;
};

function makePage(partial: Partial<PageInput>): PageInput {
  return {
    id: "p-1",
    knowledgeBaseId: "kb-1",
    slug: "alpha",
    title: "Alpha",
    category: "ENTITY" as any,
    body: "alpha body",
    oneLiner: "alpha one-liner",
    contentHash: "h",
    lastEditedBy: "LLM" as any,
    createdAt: new Date(),
    updatedAt: new Date(),
    sources: [],
    ...partial,
  };
}

describe("WikiSourceProvider — pure BM25 internals", () => {
  describe("tokenize", () => {
    it("lowercases ASCII and strips markdown punctuation", () => {
      const tokens = WikiSourceProvider.tokenize("Hello, **World**!");
      expect(tokens).toEqual(["hello", "world"]);
    });

    it("filters stop words", () => {
      const tokens = WikiSourceProvider.tokenize("the quick brown fox is lazy");
      expect(tokens).toContain("quick");
      expect(tokens).toContain("brown");
      expect(tokens).toContain("fox");
      expect(tokens).toContain("lazy");
      expect(tokens).not.toContain("the");
      expect(tokens).not.toContain("is");
    });

    it("splits CJK chars into single-char tokens while keeping ASCII intact", () => {
      const tokens = WikiSourceProvider.tokenize("Trump 政策 2025");
      expect(tokens).toContain("trump");
      expect(tokens).toContain("政");
      expect(tokens).toContain("策");
      expect(tokens).toContain("2025");
    });

    it("returns empty array on empty / null input", () => {
      expect(WikiSourceProvider.tokenize("")).toEqual([]);
      expect(WikiSourceProvider.tokenize(null as any)).toEqual([]);
    });
  });

  describe("rankBM25", () => {
    it("ranks term-matching pages above unrelated pages", () => {
      const pages: PageInput[] = [
        makePage({
          id: "p-stargate",
          slug: "project-stargate",
          title: "Project Stargate",
          oneLiner: "OpenAI's $500B AI infra mega-project",
          body: "Project Stargate is OpenAI's flagship infrastructure initiative.",
        }),
        makePage({
          id: "p-unrelated",
          slug: "unrelated",
          title: "Unrelated note",
          oneLiner: "discusses cooking",
          body: "Some recipes about pasta and tomato sauce.",
        }),
      ];

      const queryTerms = WikiSourceProvider.tokenize("Project Stargate");
      const ranked = WikiSourceProvider.rankBM25(pages, queryTerms);

      expect(ranked).toHaveLength(2);
      expect(ranked[0].slug).toBe("project-stargate");
      expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    });

    it("oneLiner is boosted (3x) so a tight oneLiner outranks a long but vague body", () => {
      const pages: PageInput[] = [
        makePage({
          id: "p-tight",
          slug: "tight",
          title: "Tight",
          oneLiner: "OpenAI Stargate",
          body: "A short note.",
        }),
        makePage({
          id: "p-vague",
          slug: "vague",
          title: "Vague",
          oneLiner: "miscellaneous notes",
          body:
            "Among many topics this page mentions OpenAI Stargate exactly once " +
            "and then meanders through unrelated ideas like pasta sauce, " +
            "cycling, weather forecasts, and gardening tips. ".repeat(20),
        }),
      ];

      const queryTerms = WikiSourceProvider.tokenize("OpenAI Stargate");
      const ranked = WikiSourceProvider.rankBM25(pages, queryTerms);

      expect(ranked[0].slug).toBe("tight");
    });

    it("returns hits even with score=0 so caller can apply its own threshold", () => {
      const pages: PageInput[] = [
        makePage({
          id: "p-1",
          slug: "p1",
          title: "Page One",
          oneLiner: "first",
          body: "no match here",
        }),
      ];
      const queryTerms = WikiSourceProvider.tokenize("nonexistent term");
      const ranked = WikiSourceProvider.rankBM25(pages, queryTerms);
      expect(ranked).toHaveLength(1);
      expect(ranked[0].score).toBe(0);
    });

    it("preserves source citations on the hit", () => {
      const pages: PageInput[] = [
        makePage({
          id: "p-cited",
          slug: "cited",
          title: "Cited",
          oneLiner: "stargate",
          body: "stargate stargate stargate",
          sources: [
            {
              documentId: "doc-A",
              spanStart: 0,
              spanEnd: 9,
              quote: "stargate",
            },
          ],
        }),
      ];
      const ranked = WikiSourceProvider.rankBM25(
        pages,
        WikiSourceProvider.tokenize("stargate"),
      );
      expect(ranked[0].sources).toHaveLength(1);
      expect(ranked[0].sources[0].documentId).toBe("doc-A");
    });
  });
});

describe("WikiSourceProvider.search — Prisma-integrated", () => {
  it("returns empty array when KB has no wiki pages (no LLM, no error)", async () => {
    const prisma: any = {
      wikiPage: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const provider = new WikiSourceProvider(prisma);

    const hits = await provider.search("kb-empty", "anything");
    expect(hits).toEqual([]);
  });

  it("respects topK option (cap to N highest scoring)", async () => {
    const pages = [
      makePage({
        id: "p-a",
        slug: "a",
        title: "AA",
        oneLiner: "stargate",
        body: "stargate",
      }),
      makePage({
        id: "p-b",
        slug: "b",
        title: "BB",
        oneLiner: "stargate",
        body: "stargate",
      }),
      makePage({
        id: "p-c",
        slug: "c",
        title: "CC",
        oneLiner: "different",
        body: "noise",
      }),
    ];
    const prisma: any = {
      wikiPage: { findMany: jest.fn().mockResolvedValue(pages) },
    };
    const provider = new WikiSourceProvider(prisma);

    const hits = await provider.search("kb-1", "stargate", { topK: 2 });
    expect(hits).toHaveLength(2);
    // Both kept hits have a meaningful score; the noise page is dropped.
    expect(hits.every((h) => h.score > 0)).toBe(true);
  });

  it("respects minScore option (drops low-score hits)", async () => {
    const pages = [
      makePage({
        id: "p-good",
        slug: "good",
        title: "Good",
        oneLiner: "stargate",
        body: "stargate stargate",
      }),
      makePage({
        id: "p-noise",
        slug: "noise",
        title: "Noise",
        oneLiner: "n/a",
        body: "noise",
      }),
    ];
    const prisma: any = {
      wikiPage: { findMany: jest.fn().mockResolvedValue(pages) },
    };
    const provider = new WikiSourceProvider(prisma);

    const hits = await provider.search("kb-1", "stargate", {
      minScore: 0.0001,
    });
    expect(hits.map((h) => h.slug)).toEqual(["good"]);
  });

  it("returns empty array when query is whitespace / stop-words only", async () => {
    const prisma: any = {
      wikiPage: { findMany: jest.fn() },
    };
    const provider = new WikiSourceProvider(prisma);

    const hits = await provider.search("kb-1", "the and is");
    expect(hits).toEqual([]);
    // Should not even hit DB.
    expect(prisma.wikiPage.findMany).not.toHaveBeenCalled();
  });
});
