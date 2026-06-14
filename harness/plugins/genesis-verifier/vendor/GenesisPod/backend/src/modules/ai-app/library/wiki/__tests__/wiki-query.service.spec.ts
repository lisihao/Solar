/**
 * WikiQueryService spec — llm-wiki §8 P1 + §5.2 dual-branch routing
 *
 *  Branch A (inline) — default for KBs ≤ inlinePageCount + ≤ inlineTokenBudget:
 *   - Empty wiki returns guidance message (no chat call)
 *   - pageCount boundary (200 stays inline / 201 over-threshold falls back)
 *   - Term-frequency ranking surfaces relevant pages first
 *   - Slug-citation validation filters hallucinated slugs out
 *   - Empty question / wikiEnabled=false / no VIEWER access → ForbiddenException
 *   - SUMMARY-first fallback when question yields no terms
 *
 *  Branch B (RAG) — currently a controlled fallback per §5.2:
 *   - mode='rag' explicit → warns + falls back to A (result.branch='A_inline')
 *   - mode='auto' + over-threshold → same fallback path
 *   - usedPageIds + citations remain populated on the fallback Branch A path
 */

import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { WikiPageCategory } from "@prisma/client";
import { WikiQueryService } from "../wiki-query.service";

type AnyMock = jest.Mock;

interface MockPage {
  id: string;
  knowledgeBaseId: string;
  slug: string;
  title: string;
  category: WikiPageCategory;
  body: string;
  oneLiner: string;
  contentHash: string;
  lastEditedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

function buildPage(overrides: Partial<MockPage> = {}): MockPage {
  return {
    id: overrides.id ?? `page-${Math.random().toString(36).slice(2, 8)}`,
    knowledgeBaseId: "kb",
    slug: overrides.slug ?? "default-slug",
    title: overrides.title ?? "Default Title",
    category: overrides.category ?? WikiPageCategory.CONCEPT,
    body: overrides.body ?? "default body",
    oneLiner: overrides.oneLiner ?? "default oneliner",
    contentHash: "hash",
    lastEditedBy: "LLM",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePrisma() {
  const prisma: any = {
    knowledgeBase: {
      findUnique: jest.fn().mockResolvedValue({ wikiEnabled: true }),
    },
    wikiPage: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    wikiKnowledgeBaseConfig: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
  return prisma;
}

function makeKbService(allow = true) {
  return { hasAccess: jest.fn().mockResolvedValue(allow) } as any;
}

function makeChat(content: string) {
  return {
    chat: jest.fn().mockResolvedValue({
      content,
      model: "test-model",
    }),
  } as any;
}

describe("WikiQueryService", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let kbService: any;
  let chat: any;
  let service: WikiQueryService;

  beforeEach(() => {
    prisma = makePrisma();
    kbService = makeKbService();
    chat = makeChat(
      JSON.stringify({
        answer: "Default answer",
        citationSlugs: [],
      }),
    );
    service = new WikiQueryService(prisma, kbService, chat);
  });

  // ─── Access / pre-flight gates ───

  describe("pre-flight gates", () => {
    it("rejects empty question with ForbiddenException", async () => {
      await expect(
        service.query("u", "kb", { question: "   " }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("rejects when VIEWER access denied", async () => {
      kbService.hasAccess.mockResolvedValue(false);
      await expect(
        service.query("u", "kb", { question: "What is X?" }),
      ).rejects.toThrow(ForbiddenException);
      expect(kbService.hasAccess).toHaveBeenCalledWith("kb", "u", "VIEWER");
    });

    it("rejects when wikiEnabled=false with explicit message", async () => {
      prisma.knowledgeBase.findUnique.mockResolvedValue({
        wikiEnabled: false,
      });
      await expect(
        service.query("u", "kb", { question: "What is X?" }),
      ).rejects.toThrow(/Wiki is not enabled for this KB/);
    });

    it("404s when knowledge base does not exist", async () => {
      prisma.knowledgeBase.findUnique.mockResolvedValue(null);
      await expect(
        service.query("u", "kb", { question: "What is X?" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Branch A: inline ───

  describe("Branch A — empty wiki", () => {
    it("returns guidance message and does NOT call the LLM when 0 pages", async () => {
      prisma.wikiPage.findMany.mockResolvedValue([]);

      const result = await service.query("u", "kb", {
        question: "Anything?",
      });

      expect(result.branch).toBe("A_inline");
      expect(result.answer).toMatch(/This wiki has no pages yet/);
      expect(result.usedPageIds).toEqual([]);
      expect(result.citations).toEqual([]);
      expect((chat.chat as AnyMock).mock.calls.length).toBe(0);
    });
  });

  describe("Branch A — happy path & ranking", () => {
    it("ranks pages whose title/oneLiner/body contain question terms higher", async () => {
      const pages = [
        buildPage({
          id: "p-irrelevant",
          slug: "weather",
          title: "Weather",
          oneLiner: "About sunshine and rain",
          body: "talks about climate",
        }),
        buildPage({
          id: "p-target",
          slug: "transformer-arch",
          title: "Transformer Architecture",
          oneLiner: "Self-attention based model",
          body: "transformer transformer attention attention",
        }),
        buildPage({
          id: "p-mid",
          slug: "neural-nets",
          title: "Neural Networks",
          oneLiner: "Feed-forward basics",
          body: "Mentions transformer once briefly.",
        }),
      ];
      prisma.wikiPage.findMany.mockResolvedValue(pages);
      chat.chat.mockResolvedValue({
        content: JSON.stringify({
          answer: "See [[transformer-arch]]",
          citationSlugs: ["transformer-arch"],
        }),
        model: "test-model",
      });

      const result = await service.query("u", "kb", {
        question: "What is a transformer?",
      });

      expect(result.branch).toBe("A_inline");
      // Highest-ranked page is the first one packed into context.
      expect(result.usedPageIds[0]).toBe("p-target");
      expect(result.citations).toEqual([{ slug: "transformer-arch" }]);
    });

    it("filters citation slugs that don't exist in the wiki page set (LLM hallucination)", async () => {
      const pages = [
        buildPage({ id: "p1", slug: "real-page", title: "Real" }),
        buildPage({ id: "p2", slug: "another-real", title: "Another" }),
      ];
      prisma.wikiPage.findMany.mockResolvedValue(pages);
      chat.chat.mockResolvedValue({
        content: JSON.stringify({
          answer: "See [[real-page]] and [[fabricated]]",
          citationSlugs: ["real-page", "fabricated", "another-real"],
        }),
        model: "test-model",
      });

      const result = await service.query("u", "kb", { question: "anything" });

      expect(result.citations).toEqual([
        { slug: "real-page" },
        { slug: "another-real" },
      ]);
      // 'fabricated' is dropped — defends against LLM-invented slugs.
      expect(
        result.citations.find((c) => c.slug === "fabricated"),
      ).toBeUndefined();
    });

    it("populates usedPageIds + citations on the Branch A path", async () => {
      const pages = [
        buildPage({ id: "p1", slug: "alpha", title: "Alpha" }),
        buildPage({ id: "p2", slug: "beta", title: "Beta" }),
      ];
      prisma.wikiPage.findMany.mockResolvedValue(pages);
      chat.chat.mockResolvedValue({
        content: JSON.stringify({
          answer: "Both relevant",
          citationSlugs: ["alpha", "beta"],
        }),
        model: "test-model",
      });

      const result = await service.query("u", "kb", { question: "alpha beta" });

      expect(result.branch).toBe("A_inline");
      expect(result.usedPageIds.length).toBeGreaterThan(0);
      expect(result.citations.length).toBe(2);
    });

    it("SUMMARY pages rank ahead of others when question yields no usable terms", async () => {
      const summary = buildPage({
        id: "p-summary",
        slug: "kb-overview",
        title: "Overview",
        category: WikiPageCategory.SUMMARY,
        oneLiner: "High-level summary",
        body: "general overview",
      });
      const concept = buildPage({
        id: "p-concept",
        slug: "deep-detail",
        title: "Deep Detail",
        category: WikiPageCategory.CONCEPT,
      });
      prisma.wikiPage.findMany.mockResolvedValue([concept, summary]);
      chat.chat.mockResolvedValue({
        content: JSON.stringify({
          answer: "ok",
          citationSlugs: [],
        }),
        model: "test-model",
      });

      // Single-letter / punctuation only → all terms < 2 chars → no terms.
      const result = await service.query("u", "kb", { question: "?" });

      expect(result.branch).toBe("A_inline");
      // SUMMARY-first fallback ordering: summary page packs in before concept.
      expect(result.usedPageIds[0]).toBe("p-summary");
    });
  });

  // ─── Branch A boundary: pageCount threshold ───

  describe("pageCount boundary 200 / 201", () => {
    it("at 200 pages stays inline (not over-threshold)", async () => {
      const pages = Array.from({ length: 200 }, (_, i) =>
        buildPage({
          id: `p${i}`,
          slug: `page-${i}`,
          title: `T${i}`,
          oneLiner: "o",
          body: "b",
        }),
      );
      prisma.wikiPage.findMany.mockResolvedValue(pages);
      chat.chat.mockResolvedValue({
        content: JSON.stringify({ answer: "ok", citationSlugs: [] }),
        model: "test-model",
      });

      const result = await service.query("u", "kb", {
        question: "what",
        mode: "auto",
      });

      expect(result.branch).toBe("A_inline");
      expect((chat.chat as AnyMock).mock.calls.length).toBe(1);
    });

    it("at 201 pages in 'auto' mode triggers Branch B request, then falls back to A_inline", async () => {
      const pages = Array.from({ length: 201 }, (_, i) =>
        buildPage({
          id: `p${i}`,
          slug: `page-${i}`,
          title: `T${i}`,
          oneLiner: "o",
          body: "b",
        }),
      );
      prisma.wikiPage.findMany.mockResolvedValue(pages);
      const warnSpy = jest
        .spyOn((service as any).logger, "warn")
        .mockImplementation(() => undefined);
      chat.chat.mockResolvedValue({
        content: JSON.stringify({ answer: "ok", citationSlugs: [] }),
        model: "test-model",
      });

      const result = await service.query("u", "kb", {
        question: "what",
        mode: "auto",
      });

      // Branch B was selected internally then fell back to A — surface stays
      // honest: branch === 'A_inline'.
      expect(result.branch).toBe("A_inline");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Branch B \(RAG\) requested/),
      );
      warnSpy.mockRestore();
    });
  });

  // ─── Branch B fallback transparency ───

  describe("Branch B fallback transparency", () => {
    it("mode='rag' explicit → logs warning and falls back to A_inline", async () => {
      const pages = [buildPage({ id: "p1", slug: "alpha", title: "Alpha" })];
      prisma.wikiPage.findMany.mockResolvedValue(pages);
      const warnSpy = jest
        .spyOn((service as any).logger, "warn")
        .mockImplementation(() => undefined);
      chat.chat.mockResolvedValue({
        content: JSON.stringify({
          answer: "fallback answer",
          citationSlugs: ["alpha"],
        }),
        model: "test-model",
      });

      const result = await service.query("u", "kb", {
        question: "alpha?",
        mode: "rag",
      });

      expect(result.branch).toBe("A_inline");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Branch B \(RAG\) requested/),
      );
      // The fallback Branch A still runs — chat is called and citations + usedPageIds populate.
      expect((chat.chat as AnyMock).mock.calls.length).toBe(1);
      expect(result.usedPageIds).toEqual(["p1"]);
      expect(result.citations).toEqual([{ slug: "alpha" }]);
      warnSpy.mockRestore();
    });
  });

  // ─── answer follows user question language (3952c84e7) ───
  //
  // The fix added a LANGUAGE block to the Branch A systemPrompt so the LLM
  // answers in the language of the user's question (中文 question → 中文
  // answer; English question → English answer). Without these lines the
  // English system prompt would drag every answer to English regardless of
  // the question. The wiki-query.service builds the systemPrompt as a string
  // and passes it to chat.chat({ systemPrompt }) — we inspect the first
  // (and only) chat call's args to assert the prompt content.
  describe("answer follows user question language (3952c84e7)", () => {
    function inspectSystemPrompt(): string {
      // chat.chat is invoked once per Branch A query; the systemPrompt is
      // passed on the (single) call args object.
      expect((chat.chat as AnyMock).mock.calls.length).toBeGreaterThan(0);
      const callArg = (chat.chat as AnyMock).mock.calls[0][0];
      // Service signature is chat.chat({ systemPrompt, messages, ... })
      return callArg.systemPrompt as string;
    }

    beforeEach(() => {
      // Arrange — minimal one-page wiki so Branch A actually invokes the LLM.
      const pages = [buildPage({ id: "p1", slug: "alpha", title: "Alpha" })];
      prisma.wikiPage.findMany.mockResolvedValue(pages);
      chat.chat.mockResolvedValue({
        content: JSON.stringify({
          answer: "fine",
          citationSlugs: ["alpha"],
        }),
        model: "test-model",
      });
    });

    it("systemPrompt instructs to answer in the SAME language as the user's question", async () => {
      // Act
      await service.query("u", "kb", { question: "alpha?" });
      // Assert
      const prompt = inspectSystemPrompt();
      expect(prompt).toContain(
        "LANGUAGE: write the `answer` in the SAME language as the user's question.",
      );
    });

    it("systemPrompt covers both 中文 and English explicit cases", async () => {
      await service.query("u", "kb", { question: "alpha?" });
      const prompt = inspectSystemPrompt();
      // Both directions of the rule must be present (中文 → 中文,
      // English → English).
      expect(prompt).toContain("中文");
      expect(prompt).toContain("answer in 中文");
      expect(prompt).toContain("answer in English");
    });

    it("systemPrompt preserves the verbatim-quote escape hatch for titles / proper nouns / code", async () => {
      await service.query("u", "kb", { question: "alpha?" });
      const prompt = inspectSystemPrompt();
      // Page titles / proper nouns / code must be quoted verbatim regardless
      // of question language — otherwise the LLM would translate them.
      expect(prompt).toContain(
        "Quote page titles / proper nouns / code verbatim from the wiki regardless.",
      );
    });
  });
});
