/**
 * WikiIngestService spec — v1.5.3 §8 P1 critical paths
 *
 * Mocks PrismaService + KnowledgeBaseService + WikiDiffService + AiChatService;
 * focuses on the 8 contractual gates of the ingest pipeline:
 *
 *  1. wrapExternalContent is invoked with explicit maxLength derived from
 *     ingestMaxTokens × 4 / docCount / 2 (security R2 P2 — must NOT default to 2000)
 *  2. LLM output failing WikiDiffItemsSchema → BadRequestException (retry msg)
 *  3. baselineHash deterministic across two ingests on same KB state
 *  4. Documents not belonging to kbId → NotFoundException
 *  5. PENDING WikiDiff persisted with affectedKeys (slug:locale composites)
 *     computed from validated items (NOT echoed from LLM output) — P3
 *     BLOCKER C2 (2026-05-12 multi-pass-and-locale consensus)
 *  6. Empty documentIds → BadRequestException
 *  7. wikiEnabled=false → ForbiddenException
 *  8. EDITOR access required — hasAccess=false → ForbiddenException
 */

import * as fs from "fs";
import * as path from "path";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { WikiDiffStatus } from "@prisma/client";

// ★ Mock the engine facade so we can spy on wrapExternalContent
jest.mock("../../../../ai-engine/facade", () => {
  const actual = jest.requireActual("../../../../ai-engine/facade");
  return {
    ...actual,
    wrapExternalContent: jest.fn((content: string, opts: any) => {
      return `<external_source title="${opts?.title ?? ""}" maxLength="${opts?.maxLength ?? "default"}">${content}</external_source>`;
    }),
  };
});

import { wrapExternalContent } from "../../../../ai-engine/facade";
import { WikiIngestService } from "../wiki-ingest.service";

const wrapExternalContentMock = wrapExternalContent as unknown as jest.Mock;

function makePrismaMock() {
  const prisma: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    knowledgeBaseDocument: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    wikiKnowledgeBaseConfig: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    wikiPage: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    wikiDiff: {
      create: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: "diff-new",
        ...data,
      })),
    },
    knowledgeBase: {
      findUnique: jest.fn().mockResolvedValue({ wikiEnabled: true }),
    },
  };
  return prisma;
}

function makeKbService(allow = true) {
  return { hasAccess: jest.fn().mockResolvedValue(allow) } as any;
}

function makeDiffService(baselineHash = "baseline-h-1") {
  return {
    computeKbBaselineHash: jest.fn().mockResolvedValue(baselineHash),
  } as any;
}

function makeChat(content: string) {
  return {
    chat: jest.fn().mockResolvedValue({
      content,
      model: "test-model",
      usage: { totalTokens: 100 },
    }),
  } as any;
}

function makeSkillLoader(content = "wiki-ingest mock system prompt") {
  return {
    getSkillById: jest.fn().mockResolvedValue({ content }),
  } as any;
}

const VALID_LLM_OUTPUT = JSON.stringify({
  creates: [
    {
      slug: "alpha-page",
      title: "Alpha",
      category: "ENTITY",
      body: "Alpha body content",
      oneLiner: "Alpha one liner",
      sources: [],
    },
  ],
  updates: [
    {
      slug: "beta-page",
      newBody: "Updated beta body",
    },
  ],
  deletes: ["gamma-page"],
});

describe("WikiIngestService", () => {
  let prisma: any;
  let kbService: any;
  let diffService: any;
  let chat: any;
  let skillLoader: any;
  let service: WikiIngestService;

  beforeEach(() => {
    wrapExternalContentMock.mockClear();
    prisma = makePrismaMock();
    kbService = makeKbService();
    diffService = makeDiffService();
    chat = makeChat(VALID_LLM_OUTPUT);
    skillLoader = makeSkillLoader();
    service = new WikiIngestService(
      prisma,
      kbService,
      diffService,
      chat,
      skillLoader,
    );
  });

  // ─── Gate 6: empty documentIds ─────────────────────────────────────────────
  describe("input validation", () => {
    it("rejects empty documentIds with BadRequestException", async () => {
      await expect(service.ingest("u-1", "kb-1", [])).rejects.toThrow(
        BadRequestException,
      );
      // Must short-circuit BEFORE access checks / DB reads.
      expect(kbService.hasAccess).not.toHaveBeenCalled();
      expect(prisma.knowledgeBaseDocument.findMany).not.toHaveBeenCalled();
    });
  });

  // ─── Gate 8: EDITOR access ─────────────────────────────────────────────────
  describe("EDITOR access guard", () => {
    it("throws ForbiddenException when hasAccess returns false", async () => {
      kbService.hasAccess.mockResolvedValue(false);
      await expect(service.ingest("u-1", "kb-1", ["doc-1"])).rejects.toThrow(
        ForbiddenException,
      );
      expect(kbService.hasAccess).toHaveBeenCalledWith("kb-1", "u-1", "EDITOR");
      // No documents loaded if access denied.
      expect(prisma.knowledgeBaseDocument.findMany).not.toHaveBeenCalled();
    });
  });

  // ─── Gate 7: wikiEnabled=false ─────────────────────────────────────────────
  describe("wikiEnabled gate", () => {
    it("throws ForbiddenException when KB has wikiEnabled=false", async () => {
      prisma.knowledgeBase.findUnique.mockResolvedValue({
        wikiEnabled: false,
      });
      await expect(service.ingest("u-1", "kb-1", ["doc-1"])).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("throws NotFoundException when KB does not exist", async () => {
      prisma.knowledgeBase.findUnique.mockResolvedValue(null);
      await expect(service.ingest("u-1", "kb-1", ["doc-1"])).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── Gate 4: cross-KB document IDOR ────────────────────────────────────────
  describe("document ownership validation", () => {
    it("throws NotFoundException when some docs do not belong to KB", async () => {
      // Caller asks for 2, prisma returns 1 (one belongs to a different KB or
      // does not exist). The where clause already filters by knowledgeBaseId,
      // so a length mismatch IS the IDOR signal.
      prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        { id: "doc-1", title: "T1", rawContent: "content-1" },
      ]);
      await expect(
        service.ingest("u-1", "kb-1", ["doc-1", "doc-2"]),
      ).rejects.toThrow(NotFoundException);

      // Confirm we DID query with knowledgeBaseId filter (defense-in-depth).
      expect(prisma.knowledgeBaseDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            knowledgeBaseId: "kb-1",
            id: { in: ["doc-1", "doc-2"] },
          }),
        }),
      );
    });
  });

  // ─── Gate 1: wrapExternalContent explicit maxLength ────────────────────────
  describe("wrapExternalContent budget (security R2 P2)", () => {
    it("invokes wrapExternalContent with explicit maxLength derived from ingestMaxTokens × 4 / docCount", async () => {
      // Provide explicit ingestMaxTokens=10_000 and 2 docs.
      // Expected: totalCharBudget = 10_000 × 4 = 40_000
      //           perDocMaxLength = floor(40_000 / 2) = 20_000
      // 2026-05-12 MULTI pass rebuild: dropped the historical `/ 2` halving
      // (originally a conservative reserve for the LLM's own response budget);
      // SINGLE pass already overflows on 10K+ docs, MULTI fans out into a
      // separate section-fill phase where each call has its own per-call
      // token budget. So we hand each doc the full per-doc slice.
      prisma.wikiKnowledgeBaseConfig.findUnique.mockResolvedValue({
        ingestMaxTokens: 10_000,
      });
      prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        { id: "doc-1", title: "Doc One", rawContent: "raw-1" },
        { id: "doc-2", title: "Doc Two", rawContent: "raw-2" },
      ]);

      await service.ingest("u-1", "kb-1", ["doc-1", "doc-2"]);

      expect(wrapExternalContentMock).toHaveBeenCalledTimes(2);
      // Both calls MUST pass an explicit maxLength (NOT default 2000).
      const [, opts1] = wrapExternalContentMock.mock.calls[0];
      const [, opts2] = wrapExternalContentMock.mock.calls[1];
      expect(opts1.maxLength).toBe(20_000);
      expect(opts2.maxLength).toBe(20_000);
      // Source / title forwarded for downstream tag-rendering.
      expect(opts1.source).toBe("kb_document");
      expect(opts1.title).toBe("Doc One");
      expect(opts2.title).toBe("Doc Two");
    });

    it("falls back to ingestMaxTokens=80_000 when no config row exists", async () => {
      // No config → default 80_000. With 1 doc:
      //   totalCharBudget = 80_000 × 4 = 320_000
      //   perDoc          = floor(320_000 / 1) = 320_000
      prisma.wikiKnowledgeBaseConfig.findUnique.mockResolvedValue(null);
      prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        { id: "doc-1", title: "Solo", rawContent: "raw-solo" },
      ]);

      await service.ingest("u-1", "kb-1", ["doc-1"]);

      expect(wrapExternalContentMock).toHaveBeenCalledTimes(1);
      const [, opts] = wrapExternalContentMock.mock.calls[0];
      expect(opts.maxLength).toBe(320_000);
      // Sanity: must NOT be the global default of 2000.
      expect(opts.maxLength).not.toBe(2000);
    });

    it("enforces a minimum maxLength of 500 chars per doc", async () => {
      // Tiny ingestMaxTokens with many docs would otherwise compute < 500.
      // Service clamps to Math.max(500, ...).
      prisma.wikiKnowledgeBaseConfig.findUnique.mockResolvedValue({
        ingestMaxTokens: 100, // 100 × 4 = 400 total chars / 1 / 2 = 200 → clamped to 500
      });
      prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        { id: "doc-1", title: "Doc", rawContent: "raw" },
      ]);

      await service.ingest("u-1", "kb-1", ["doc-1"]);

      const [, opts] = wrapExternalContentMock.mock.calls[0];
      expect(opts.maxLength).toBe(500);
    });
  });

  // ─── Gate 2: LLM schema-validation failure ─────────────────────────────────
  describe("LLM output schema validation", () => {
    it("throws BadRequestException when LLM returns malformed JSON shape", async () => {
      prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        { id: "doc-1", title: "T", rawContent: "raw" },
      ]);
      // Malformed: creates is missing required fields (title/category/body/oneLiner/sources).
      chat = makeChat(
        JSON.stringify({
          creates: [{ slug: "ok-slug" }],
          updates: [],
          deletes: [],
        }),
      );
      service = new WikiIngestService(
        prisma,
        kbService,
        diffService,
        chat,
        skillLoader,
      );

      await expect(service.ingest("u-1", "kb-1", ["doc-1"])).rejects.toThrow(
        BadRequestException,
      );
      // No diff written when schema fails.
      expect(prisma.wikiDiff.create).not.toHaveBeenCalled();
    });

    it("throws BadRequestException with retry message when LLM call itself errors", async () => {
      prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        { id: "doc-1", title: "T", rawContent: "raw" },
      ]);
      chat = {
        chat: jest.fn().mockRejectedValue(new Error("upstream LLM 500")),
      } as any;
      service = new WikiIngestService(
        prisma,
        kbService,
        diffService,
        chat,
        skillLoader,
      );

      await expect(service.ingest("u-1", "kb-1", ["doc-1"])).rejects.toThrow(
        /Wiki ingest LLM call failed; please retry/,
      );
    });

    it("throws BadRequestException when LLM output is not even valid JSON", async () => {
      prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        { id: "doc-1", title: "T", rawContent: "raw" },
      ]);
      // extractJson yields {} on parse failure → schema parse fails.
      chat = makeChat("not json at all, just prose");
      service = new WikiIngestService(
        prisma,
        kbService,
        diffService,
        chat,
        skillLoader,
      );

      await expect(service.ingest("u-1", "kb-1", ["doc-1"])).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── Source soft-drop (one bad cite ≠ 400 whole diff) ─────────────────────
  describe("source field soft-drop", () => {
    function llmOutputWithSources(sources: unknown[]): string {
      return JSON.stringify({
        creates: [
          {
            slug: "alpha-page",
            title: "Alpha",
            category: "ENTITY",
            body: "Alpha body",
            oneLiner: "Alpha one liner",
            sources,
          },
        ],
        updates: [],
        deletes: [],
      });
    }

    beforeEach(() => {
      prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        { id: "doc-1", title: "T", rawContent: "raw" },
      ]);
    });

    it("drops sources missing spanStart but keeps the diff if any valid cite remains", async () => {
      chat = makeChat(
        llmOutputWithSources([
          // bad: missing spanStart
          { documentId: "doc-1", spanEnd: 100, quote: "q" },
          // valid
          { documentId: "doc-1", spanStart: 0, spanEnd: 50, quote: "ok" },
        ]),
      );
      service = new WikiIngestService(
        prisma,
        kbService,
        diffService,
        chat,
        skillLoader,
      );

      const result = await service.ingest("u-1", "kb-1", ["doc-1"]);

      expect(prisma.wikiDiff.create).toHaveBeenCalledTimes(1);
      const [createArgs] = prisma.wikiDiff.create.mock.calls[0];
      const persistedSources = createArgs.data.items.creates[0].sources;
      // Only the valid cite survived.
      expect(persistedSources).toHaveLength(1);
      expect(persistedSources[0].spanStart).toBe(0);
      expect((result as any).id).toBe("diff-new");
    });

    it("drops sources with spanEnd < spanStart", async () => {
      chat = makeChat(
        llmOutputWithSources([
          { documentId: "doc-1", spanStart: 50, spanEnd: 10, quote: "bad" },
          { documentId: "doc-1", spanStart: 0, spanEnd: 50, quote: "ok" },
        ]),
      );
      service = new WikiIngestService(
        prisma,
        kbService,
        diffService,
        chat,
        skillLoader,
      );

      await service.ingest("u-1", "kb-1", ["doc-1"]);
      const [createArgs] = prisma.wikiDiff.create.mock.calls[0];
      const persistedSources = createArgs.data.items.creates[0].sources;
      expect(persistedSources).toHaveLength(1);
      expect(persistedSources[0].quote).toBe("ok");
    });

    it("drops sources with non-integer / negative span values", async () => {
      chat = makeChat(
        llmOutputWithSources([
          { documentId: "doc-1", spanStart: -5, spanEnd: 10, quote: "neg" },
          { documentId: "doc-1", spanStart: 1.5, spanEnd: 10, quote: "float" },
          { documentId: "doc-1", spanStart: 0, spanEnd: 50, quote: "ok" },
        ]),
      );
      service = new WikiIngestService(
        prisma,
        kbService,
        diffService,
        chat,
        skillLoader,
      );

      await service.ingest("u-1", "kb-1", ["doc-1"]);
      const [createArgs] = prisma.wikiDiff.create.mock.calls[0];
      const persistedSources = createArgs.data.items.creates[0].sources;
      expect(persistedSources).toHaveLength(1);
      expect(persistedSources[0].quote).toBe("ok");
    });

    it("drops sources with missing / empty / oversized quote", async () => {
      chat = makeChat(
        llmOutputWithSources([
          { documentId: "doc-1", spanStart: 0, spanEnd: 10 }, // missing quote
          { documentId: "doc-1", spanStart: 0, spanEnd: 10, quote: "" }, // empty
          {
            documentId: "doc-1",
            spanStart: 0,
            spanEnd: 10,
            quote: "x".repeat(2001),
          }, // oversize
          { documentId: "doc-1", spanStart: 0, spanEnd: 10, quote: "ok" },
        ]),
      );
      service = new WikiIngestService(
        prisma,
        kbService,
        diffService,
        chat,
        skillLoader,
      );

      await service.ingest("u-1", "kb-1", ["doc-1"]);
      const [createArgs] = prisma.wikiDiff.create.mock.calls[0];
      const persistedSources = createArgs.data.items.creates[0].sources;
      expect(persistedSources).toHaveLength(1);
      expect(persistedSources[0].quote).toBe("ok");
    });

    it("rejects whole diff when 100% of cites are invalid (zero provenance)", async () => {
      chat = makeChat(
        llmOutputWithSources([
          { documentId: "unknown-doc", spanStart: 0, spanEnd: 10, quote: "x" },
          { documentId: "doc-1", spanEnd: 10, quote: "x" }, // missing spanStart
        ]),
      );
      service = new WikiIngestService(
        prisma,
        kbService,
        diffService,
        chat,
        skillLoader,
      );

      await expect(service.ingest("u-1", "kb-1", ["doc-1"])).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.wikiDiff.create).not.toHaveBeenCalled();
    });
  });

  // ─── Gate 3: baselineHash deterministic ────────────────────────────────────
  describe("baselineHash determinism", () => {
    it("produces the same baselineHash on two ingests over identical KB state", async () => {
      prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        { id: "doc-1", title: "T", rawContent: "raw" },
      ]);

      const diff1 = await service.ingest("u-1", "kb-1", ["doc-1"]);
      const diff2 = await service.ingest("u-1", "kb-1", ["doc-1"]);

      // diffService.computeKbBaselineHash returns the same value for identical
      // KB state (same wikiPage rows). We assert determinism by checking that
      // both calls observed the same hash.
      expect(diffService.computeKbBaselineHash).toHaveBeenCalledTimes(2);
      expect((diff1 as any).baselineHash).toBe("baseline-h-1");
      expect((diff2 as any).baselineHash).toBe("baseline-h-1");
      expect((diff1 as any).baselineHash).toBe((diff2 as any).baselineHash);
    });
  });

  // ─── Gate 5: PENDING diff with affectedKeys from validated items ──────────
  describe("PENDING WikiDiff persistence", () => {
    it("persists PENDING diff with affectedKeys (slug:locale) deduped from creates+updates+deletes", async () => {
      prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        { id: "doc-1", title: "T", rawContent: "raw" },
      ]);
      // LLM returns overlapping slugs to assert dedup behavior.
      chat = makeChat(
        JSON.stringify({
          creates: [
            {
              slug: "alpha-page",
              title: "Alpha",
              category: "ENTITY",
              body: "body",
              oneLiner: "one",
              sources: [],
            },
          ],
          updates: [
            { slug: "beta-page", newBody: "new beta body" },
            // Overlap with creates — must dedupe.
            { slug: "alpha-page", newBody: "should-dedupe" },
          ],
          deletes: ["gamma-page", "beta-page"], // beta overlaps with updates
        }),
      );
      service = new WikiIngestService(
        prisma,
        kbService,
        diffService,
        chat,
        skillLoader,
      );

      const result = await service.ingest("u-1", "kb-1", ["doc-1"]);

      expect(prisma.wikiDiff.create).toHaveBeenCalledTimes(1);
      const [createArgs] = prisma.wikiDiff.create.mock.calls[0];
      expect(createArgs.data.status).toBe(WikiDiffStatus.PENDING);
      expect(createArgs.data.knowledgeBaseId).toBe("kb-1");
      expect(createArgs.data.createdByUserId).toBe("u-1");
      expect(createArgs.data.baselineHash).toBe("baseline-h-1");
      // Deduped union: alpha + beta + gamma (3 unique slugs). zod schema
      // `.default('zh')` fills locale on creates/updates; deletes are
      // string[] without locale and map to ':zh' per DEFAULT_WIKI_LOCALE.
      expect(new Set(createArgs.data.affectedKeys)).toEqual(
        new Set(["alpha-page:zh", "beta-page:zh", "gamma-page:zh"]),
      );
      expect(createArgs.data.affectedKeys).toHaveLength(3);
      // Returned object carries the diff id.
      expect((result as any).id).toBe("diff-new");
    });

    it("strips fenced ```json blocks before schema-parsing LLM output", async () => {
      prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        { id: "doc-1", title: "T", rawContent: "raw" },
      ]);
      chat = makeChat(
        "```json\n" +
          JSON.stringify({
            creates: [
              {
                slug: "fenced-slug",
                title: "F",
                category: "CONCEPT",
                body: "b",
                oneLiner: "o",
                sources: [],
              },
            ],
            updates: [],
            deletes: [],
          }) +
          "\n```",
      );
      service = new WikiIngestService(
        prisma,
        kbService,
        diffService,
        chat,
        skillLoader,
      );

      await service.ingest("u-1", "kb-1", ["doc-1"]);

      const [createArgs] = prisma.wikiDiff.create.mock.calls[0];
      expect(createArgs.data.affectedKeys).toEqual(["fenced-slug:zh"]);
    });
  });

  // ─── WikiIngestMetrics expose (P1 commit 3) ─────────────────────────────
  //
  // Reviewer D 建议 expose 可观测 metric channel 给 spec / 后续 E2E 直接
  // 断言退场条件 (pageCount / avgBodyLength / h2CoverageRate),不必每次
  // 再从 LLM response 复算。lastIngestMetrics 字段在 ingestInternal() 末尾
  // (diff 落盘成功后、return 前) 赋值;失败路径不写。
  describe("WikiIngestMetrics expose (P1 commit 3)", () => {
    it("sets lastIngestMetrics after successful ingest with pageCount and avgBodyLength", async () => {
      prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        { id: "doc-1", title: "T", rawContent: "raw" },
      ]);
      // VALID_LLM_OUTPUT 有 1 个 create (slug=alpha-page, body="Alpha body content")
      // → pageCount=1, avgBodyLength = body.length = 19 (> 0)
      // → body 无 "## " H2 → h2CoverageRate=0
      expect(service.lastIngestMetrics).toBeNull();

      await service.ingest("u-1", "kb-1", ["doc-1"]);

      expect(service.lastIngestMetrics).not.toBeNull();
      const m = service.lastIngestMetrics!;
      expect(m.pageCount).toBe(1);
      expect(m.avgBodyLength).toBeGreaterThan(0);
      // VALID_LLM_OUTPUT 的 body 是 "Alpha body content" (19 chars)
      expect(m.avgBodyLength).toBe("Alpha body content".length);
      // 没截过 oneLiner / 没 drop source / 没看到 source
      expect(m.truncatedOneLiners).toBe(0);
      expect(m.droppedSources).toBe(0);
      expect(m.totalSourcesSeen).toBe(0);
    });

    it("computes h2CoverageRate from body content", async () => {
      // case A: body 含 "## 章节\n内容" → h2CoverageRate === 1.0
      prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        { id: "doc-1", title: "T", rawContent: "raw" },
      ]);
      const withH2 = JSON.stringify({
        creates: [
          {
            slug: "with-h2",
            title: "W",
            category: "ENTITY",
            body: "## 章节\n内容",
            oneLiner: "o",
            sources: [],
          },
        ],
        updates: [],
        deletes: [],
      });
      chat = makeChat(withH2);
      service = new WikiIngestService(
        prisma,
        kbService,
        diffService,
        chat,
        skillLoader,
      );

      await service.ingest("u-1", "kb-1", ["doc-1"]);
      expect(service.lastIngestMetrics!.h2CoverageRate).toBe(1);

      // case B: body 无 "## " → h2CoverageRate === 0
      const withoutH2 = JSON.stringify({
        creates: [
          {
            slug: "no-h2",
            title: "N",
            category: "ENTITY",
            body: "just prose no headings here",
            oneLiner: "o",
            sources: [],
          },
        ],
        updates: [],
        deletes: [],
      });
      chat = makeChat(withoutH2);
      service = new WikiIngestService(
        prisma,
        kbService,
        diffService,
        chat,
        skillLoader,
      );

      await service.ingest("u-1", "kb-1", ["doc-1"]);
      expect(service.lastIngestMetrics!.h2CoverageRate).toBe(0);
    });
  });

  // ─── BLOCKED gate: now content-based, NOT chunking-based ─────────────────
  //
  // Wiki ingest only consumes rawContent — it never reads chunks or
  // embeddings. So a doc that has rawContent but is still PENDING (because
  // the user hasn't clicked the KB-level "向量化" button) must be ingestable.
  // The gate is: ERROR → BLOCKED, pendingFetch placeholder → BLOCKED, else
  // READY_NEW / STALE / COVERED based on wiki page reference history.
  describe("listIngestCandidates — content-availability gate", () => {
    function mockKbReady() {
      prisma.knowledgeBase.findUnique.mockResolvedValue({ wikiEnabled: true });
    }

    it("PENDING doc with real rawContent is READY_NEW (was BLOCKED before)", async () => {
      mockKbReady();
      prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        {
          id: "doc-pending",
          title: "Real upload",
          sourceType: "MANUAL",
          mimeType: "text/plain",
          status: "PENDING", // user has NOT clicked 向量化
          createdAt: new Date(),
          updatedAt: new Date(),
          processedAt: null,
          chunkCount: 0,
          lastError: null,
          metadata: {},
          rawContentUri: null,
        },
      ]);

      const result = await service.listIngestCandidates("u-1", "kb-1");

      expect(result).toHaveLength(1);
      expect(result[0].ingestState).toBe("READY_NEW");
      expect(result[0].recommended).toBe(true);
    });

    it("placeholder doc (metadata.pendingFetch=true) stays BLOCKED", async () => {
      mockKbReady();
      prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        {
          id: "doc-pending-fetch",
          title: "Awaiting Notion sync",
          sourceType: "NOTION",
          mimeType: null,
          status: "PENDING",
          createdAt: new Date(),
          updatedAt: new Date(),
          processedAt: null,
          chunkCount: 0,
          lastError: null,
          metadata: { pendingFetch: true, externalSource: "NOTION" },
          rawContentUri: null,
        },
      ]);

      const result = await service.listIngestCandidates("u-1", "kb-1");

      expect(result[0].ingestState).toBe("BLOCKED");
      expect(result[0].reason).toContain("not been fetched yet");
    });

    it("ERROR doc stays BLOCKED with the existing reason", async () => {
      mockKbReady();
      prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        {
          id: "doc-broken",
          title: "Broken parser",
          sourceType: "MANUAL",
          mimeType: "application/pdf",
          status: "ERROR",
          createdAt: new Date(),
          updatedAt: new Date(),
          processedAt: null,
          chunkCount: 0,
          lastError: "PDF parser crashed",
          metadata: {},
          rawContentUri: null,
        },
      ]);

      const result = await service.listIngestCandidates("u-1", "kb-1");

      expect(result[0].ingestState).toBe("BLOCKED");
      expect(result[0].reason).toContain("processing failed");
    });

    it("off-loaded doc (rawContentUri set) is treated as ready even if metadata is missing", async () => {
      mockKbReady();
      prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        {
          id: "doc-offloaded",
          title: "Big PDF in R2",
          sourceType: "MANUAL",
          mimeType: "application/pdf",
          status: "PENDING",
          createdAt: new Date(),
          updatedAt: new Date(),
          processedAt: null,
          chunkCount: 0,
          lastError: null,
          metadata: null,
          rawContentUri: "s3://bucket/kb-1/doc-offloaded.txt",
        },
      ]);

      const result = await service.listIngestCandidates("u-1", "kb-1");

      expect(result[0].ingestState).toBe("READY_NEW");
    });
  });

  // ─── oneLiner soft-truncate (74383da33) ───────────────────────────────────
  // 守护 wiki-ingest.service.ts:342-363 trimOneLiner 软兜底。
  // LLM 偶发产 oneLiner > 280 chars 时,service 必须 trim 而不是让 zod
  // schema(WikiDiffCreateItemSchema.oneLiner max(280))拒绝整个 diff。
  // 与已有 sources 软剔除对称(同一段 pre-clean 块)。
  describe("oneLiner soft-truncate (74383da33)", () => {
    function llmOutputWithOneLiner(
      oneLiner: string,
      updates: Array<Record<string, unknown>> = [],
    ): string {
      return JSON.stringify({
        creates: [
          {
            slug: "alpha-page",
            title: "Alpha",
            category: "ENTITY",
            body: "Alpha body",
            oneLiner,
            sources: [],
          },
        ],
        updates,
        deletes: [],
      });
    }

    beforeEach(() => {
      prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        { id: "doc-1", title: "T", rawContent: "raw" },
      ]);
    });

    function reinstantiate(content: string) {
      chat = makeChat(content);
      service = new WikiIngestService(
        prisma,
        kbService,
        diffService,
        chat,
        skillLoader,
      );
    }

    it("keeps oneLiner of exactly 280 chars (boundary, no trim)", async () => {
      const exact = "A".repeat(280);
      reinstantiate(llmOutputWithOneLiner(exact));

      await service.ingest("u-1", "kb-1", ["doc-1"]);

      const persisted =
        prisma.wikiDiff.create.mock.calls[0][0].data.items.creates[0].oneLiner;
      expect(persisted).toBe(exact);
      expect(persisted.length).toBe(280);
      expect(persisted.endsWith("...")).toBe(false);
    });

    it("truncates oneLiner of 281 chars to <= 280 with ellipsis suffix", async () => {
      const overflow = "B".repeat(281);
      reinstantiate(llmOutputWithOneLiner(overflow));

      await service.ingest("u-1", "kb-1", ["doc-1"]);

      const persisted =
        prisma.wikiDiff.create.mock.calls[0][0].data.items.creates[0].oneLiner;
      // slice(0, 277).trimEnd() + "..." → total length <= 280
      expect(persisted.length).toBeLessThanOrEqual(280);
      expect(persisted.endsWith("...")).toBe(true);
      // First 277 chars preserved (no whitespace at boundary so trimEnd is noop)
      expect(persisted.startsWith("B".repeat(277))).toBe(true);
    });

    it("truncates oneLiner of 500 chars to <= 280 with ellipsis", async () => {
      const long = "C".repeat(500);
      reinstantiate(llmOutputWithOneLiner(long));

      await service.ingest("u-1", "kb-1", ["doc-1"]);

      const persisted =
        prisma.wikiDiff.create.mock.calls[0][0].data.items.creates[0].oneLiner;
      expect(persisted.length).toBeLessThanOrEqual(280);
      expect(persisted.endsWith("...")).toBe(true);
    });

    it("trims trailing whitespace before appending ellipsis (avoid trailing space before dots)", async () => {
      // 270 chars + 7 spaces + 20 chars = 297 total
      // slice(0, 277) = "D"x270 + "       " (7 spaces) → trimEnd → "D"x270
      // + "..." → final length 273
      const trailing = "D".repeat(270) + "       " + "E".repeat(20);
      reinstantiate(llmOutputWithOneLiner(trailing));

      await service.ingest("u-1", "kb-1", ["doc-1"]);

      const persisted =
        prisma.wikiDiff.create.mock.calls[0][0].data.items.creates[0].oneLiner;
      expect(persisted).toBe("D".repeat(270) + "...");
      expect(persisted.endsWith("...")).toBe(true);
      // No whitespace right before the ellipsis
      expect(/\s\.\.\.$/.test(persisted)).toBe(false);
    });

    it("trims newOneLiner in updates the same way (symmetry with creates)", async () => {
      const overflow = "F".repeat(400);
      reinstantiate(
        llmOutputWithOneLiner("short ok", [
          { slug: "beta-page", newBody: "B body", newOneLiner: overflow },
        ]),
      );

      await service.ingest("u-1", "kb-1", ["doc-1"]);

      const persistedUpdate =
        prisma.wikiDiff.create.mock.calls[0][0].data.items.updates[0]
          .newOneLiner;
      expect(persistedUpdate.length).toBeLessThanOrEqual(280);
      expect(persistedUpdate.endsWith("...")).toBe(true);
    });

    it("leaves updates with no newOneLiner field untouched (no error)", async () => {
      // newOneLiner is optional in WikiDiffUpdateItemSchema — service must not
      // crash trying to trim a missing string.
      reinstantiate(
        llmOutputWithOneLiner("short ok", [
          { slug: "gamma-page", newBody: "G body" },
        ]),
      );

      await expect(
        service.ingest("u-1", "kb-1", ["doc-1"]),
      ).resolves.toBeDefined();
      const persisted =
        prisma.wikiDiff.create.mock.calls[0][0].data.items.updates[0];
      expect(persisted.newOneLiner).toBeUndefined();
    });
  });

  // ─── LANGUAGE RULE in wiki-ingest skill (3952c84e7) ────────────────────────
  //
  // The fix added a "LANGUAGE RULE (CRITICAL)" section to
  // skills/wiki-ingest.skill.md so the LLM produces wiki pages in the source
  // documents' language (Chinese source → 中文 page, English source → English
  // page) instead of defaulting to English. The skill md is a static asset
  // shipped with the module; assert its key phrases are present so a refactor
  // can't silently drop them without spec failure.
  describe("LANGUAGE RULE in wiki-ingest skill (3952c84e7)", () => {
    // Arrange (shared) — read the skill md once.
    const skillMd = fs.readFileSync(
      path.join(__dirname, "../skills/wiki-ingest.skill.md"),
      "utf-8",
    );

    it("skill md contains a LANGUAGE RULE section", () => {
      // Act + Assert — both the literal section header and CRITICAL marker.
      expect(skillMd).toContain("LANGUAGE RULE");
      expect(skillMd).toContain("CRITICAL");
    });

    it("Chinese-source rule appears in skill md", () => {
      // Arrange / Act: locate the Chinese-source bullet.
      // Assert: covers both the source-language phrase and the output 中文.
      expect(skillMd).toContain("Chinese source");
      expect(skillMd).toContain("中文");
    });

    it("English-source rule appears in skill md", () => {
      expect(skillMd).toContain("English source");
      expect(skillMd).toContain("in English");
    });

    it("DOMINANT-language tie-breaker is spelled out for mixed-language pages", () => {
      // Mixed-language sources must pick a single language by char-count —
      // assert the DOMINANT keyword is preserved.
      expect(skillMd).toContain("DOMINANT");
    });

    it("UPDATE branch locks page to its existing language (no mid-page switch)", () => {
      // The crucial property: an UPDATE must NOT translate an existing page.
      // We assert on the unambiguous phrase from the rule.
      expect(skillMd).toContain("MATCH that page's existing language");
      expect(skillMd).toContain("do NOT switch languages");
    });

    it("slug stays ASCII kebab-case regardless of page language", () => {
      // Counter-rule: page narrative follows source language, BUT slugs stay
      // ASCII so cross-page references and URLs never break.
      expect(skillMd).toContain("kebab-case");
      // The literal "ASCII" keyword must appear in the slug rule.
      expect(skillMd.toLowerCase()).toContain("ascii");
    });
  });

  /**
   * W2 v2.0 rebuild — Category fan-out + image embedding regression.
   *
   * Screenshot_64 痛点：v1.5.3 LLM creativity=deterministic 几乎只产 SOURCE 类
   * page；用户反馈"为什么 WIKI 提取只有 SOURCE"。v2.0 修法：
   *   1. skill md 新增 CATEGORY FAN-OUT RULE
   *   2. skill md 新增 IMAGE EMBEDDING RULE + CROSS-LINK RULE
   *   3. service taskProfile 由 deterministic 改 low
   */
  describe("W2 v2.0 rebuild — fan-out / image / cross-link prompt", () => {
    let skillMd: string;
    beforeAll(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("fs") as typeof import("fs");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require("path") as typeof import("path");
      const p = path.join(__dirname, "..", "skills", "wiki-ingest.skill.md");
      skillMd = fs.readFileSync(p, "utf8");
    });

    it("CATEGORY FAN-OUT RULE present with ≥2 ENTITY + ≥1 CONCEPT + ≥1 SUMMARY", () => {
      expect(skillMd).toContain("CATEGORY FAN-OUT RULE");
      expect(skillMd).toContain("≥ 2 ENTITY pages");
      expect(skillMd).toContain("≥ 1 CONCEPT page");
      expect(skillMd).toContain("≥ 1 SUMMARY page");
    });

    it("SOURCE-only output explicitly rejected by the rule", () => {
      expect(skillMd).toContain("ONLY SOURCE-category pages is REJECTED");
    });

    it("IMAGE EMBEDDING RULE present and references MEDIA_URLS block", () => {
      expect(skillMd).toContain("IMAGE EMBEDDING RULE");
      expect(skillMd).toContain("MEDIA_URLS");
      expect(skillMd).toContain("ONLY use URLs from the MEDIA_URLS block");
    });

    it("CROSS-LINK RULE requires ≥2 [[slug]] refs per ENTITY/CONCEPT page", () => {
      expect(skillMd).toContain("CROSS-LINK RULE");
      expect(skillMd).toContain("at least 2 `[[other-slug]]`");
    });
  });
});
