/**
 * WikiLintService spec — llm-wiki §8 P1 + §5.3
 *
 * Covers the 5 lint types and access/budget controls:
 *  A. listFindings + patchFinding access + IDOR + filter combinations
 *  B. runInvariantLint (pure SQL, no LLM) — orphan + missing-xref creation
 *  C. runFullLint — 5 types: ORPHAN/MISSING_XREF (SQL) + STALE/CONTRADICTION/DATA_GAP
 *     (delegated to ai-engine primitives), with per-KB LLM budget enforcement.
 *
 * Mocks: PrismaService, KnowledgeBaseService, AiChatService,
 * CrossCuttingSynthesisService, StaleDetectorService.
 */

import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { WikiLintType } from "@prisma/client";
import { WikiLintService } from "../wiki-lint.service";

function makePrisma() {
  const prisma: any = {
    wikiLintFinding: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest
        .fn()
        .mockImplementation(async ({ data }: any) => ({ id: "f-1", ...data })),
    },
    wikiKnowledgeBaseConfig: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    wikiPage: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    knowledgeBase: {
      findUnique: jest.fn().mockResolvedValue({ wikiEnabled: true }),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  return prisma;
}

function makeKbService(allow = true) {
  return { hasAccess: jest.fn().mockResolvedValue(allow) } as any;
}

function makeChat() {
  return {
    chat: jest.fn().mockResolvedValue({
      content: "{}",
      usage: { totalTokens: 10 },
    }),
  } as any;
}

function makeSynthesis() {
  return {
    detectContradictions: jest.fn().mockResolvedValue([]),
    detectDataGaps: jest.fn().mockResolvedValue([]),
  } as any;
}

function makeStaleDetector() {
  return {
    detect: jest.fn().mockResolvedValue([]),
  } as any;
}

function makePage(overrides: Record<string, unknown> = {}) {
  return {
    id: "page-1",
    slug: "page-one",
    title: "Page One",
    body: "body content",
    category: "CONCEPT",
    sources: [
      {
        quote: "reference quote",
        spanStart: 0,
        spanEnd: 10,
        document: { rawContent: "raw current text content" },
      },
    ],
    ...overrides,
  };
}

describe("WikiLintService", () => {
  let prisma: any;
  let kbService: any;
  let chat: any;
  let synthesis: any;
  let staleDetector: any;
  let service: WikiLintService;

  beforeEach(() => {
    prisma = makePrisma();
    kbService = makeKbService();
    chat = makeChat();
    synthesis = makeSynthesis();
    staleDetector = makeStaleDetector();
    service = new WikiLintService(
      prisma,
      kbService,
      chat,
      synthesis,
      staleDetector,
    );
  });

  // ─── A. listFindings + patchFinding ───

  describe("listFindings", () => {
    it("requires VIEWER access — throws Forbidden when denied", async () => {
      kbService.hasAccess.mockResolvedValue(false);
      await expect(service.listFindings("u", "kb-1")).rejects.toThrow(
        ForbiddenException,
      );
      expect(kbService.hasAccess).toHaveBeenCalledWith("kb-1", "u", "VIEWER");
      // No DB read should happen if access check fails
      expect(prisma.wikiLintFinding.findMany).not.toHaveBeenCalled();
    });

    it("filters by type + resolved=true (resolvedAt: { not: null })", async () => {
      await service.listFindings("u", "kb-1", {
        type: WikiLintType.STALE,
        resolved: true,
      });
      expect(prisma.wikiLintFinding.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            knowledgeBaseId: "kb-1",
            type: WikiLintType.STALE,
            resolvedAt: { not: null },
          }),
        }),
      );
    });

    it("filters by type + resolved=false (resolvedAt: null)", async () => {
      await service.listFindings("u", "kb-1", {
        type: WikiLintType.ORPHAN,
        resolved: false,
      });
      expect(prisma.wikiLintFinding.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            knowledgeBaseId: "kb-1",
            type: WikiLintType.ORPHAN,
            resolvedAt: null,
          }),
        }),
      );
    });
  });

  describe("patchFinding", () => {
    it("returns 404 NotFoundException (NOT 403) on cross-KB IDOR per §6", async () => {
      prisma.wikiLintFinding.findUnique.mockResolvedValue({
        id: "f-x",
        knowledgeBaseId: "kb-OTHER",
      });
      // user has EDITOR access to kb-1 (mock returns true) and wiki is enabled
      await expect(
        service.patchFinding("u", "kb-1", "f-x", "resolve"),
      ).rejects.toThrow(NotFoundException);
      // Importantly NOT a Forbidden — IDOR returns 404
      await expect(
        service.patchFinding("u", "kb-1", "f-x", "resolve"),
      ).rejects.not.toThrow(ForbiddenException);
    });

    it("returns 404 when finding does not exist", async () => {
      prisma.wikiLintFinding.findUnique.mockResolvedValue(null);
      await expect(
        service.patchFinding("u", "kb-1", "missing", "resolve"),
      ).rejects.toThrow(NotFoundException);
    });

    it("action='resolve' sets resolvedAt to a Date", async () => {
      prisma.wikiLintFinding.findUnique.mockResolvedValue({
        id: "f-1",
        knowledgeBaseId: "kb-1",
      });
      prisma.wikiLintFinding.update.mockResolvedValue({
        id: "f-1",
        knowledgeBaseId: "kb-1",
        resolvedAt: new Date(),
      });
      await service.patchFinding("u", "kb-1", "f-1", "resolve");
      const call = prisma.wikiLintFinding.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: "f-1" });
      expect(call.data.resolvedAt).toBeInstanceOf(Date);
    });

    it("action='dismiss' also sets resolvedAt (dismiss = resolved with dismiss semantic)", async () => {
      prisma.wikiLintFinding.findUnique.mockResolvedValue({
        id: "f-1",
        knowledgeBaseId: "kb-1",
      });
      prisma.wikiLintFinding.update.mockResolvedValue({
        id: "f-1",
        knowledgeBaseId: "kb-1",
        resolvedAt: new Date(),
      });
      await service.patchFinding("u", "kb-1", "f-1", "dismiss");
      const call = prisma.wikiLintFinding.update.mock.calls[0][0];
      expect(call.data.resolvedAt).toBeInstanceOf(Date);
    });

    it("requires EDITOR access — throws Forbidden when denied", async () => {
      kbService.hasAccess.mockResolvedValue(false);
      await expect(
        service.patchFinding("u", "kb-1", "f-1", "resolve"),
      ).rejects.toThrow(ForbiddenException);
      expect(kbService.hasAccess).toHaveBeenCalledWith("kb-1", "u", "EDITOR");
    });

    it("rejects when wikiEnabled=false (Forbidden)", async () => {
      prisma.knowledgeBase.findUnique.mockResolvedValue({ wikiEnabled: false });
      await expect(
        service.patchFinding("u", "kb-1", "f-1", "resolve"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── B. runInvariantLint (pure SQL, no LLM) ───

  describe("runInvariantLint", () => {
    it("calls $queryRaw twice — one for orphans, one for missing-xrefs", async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      await service.runInvariantLint("kb-1");
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it("does NOT invoke chat.chat (pure SQL path)", async () => {
      await service.runInvariantLint("kb-1");
      expect(chat.chat).not.toHaveBeenCalled();
      expect(staleDetector.detect).not.toHaveBeenCalled();
      expect(synthesis.detectContradictions).not.toHaveBeenCalled();
      expect(synthesis.detectDataGaps).not.toHaveBeenCalled();
    });

    it("creates one WikiLintFinding per orphan and per missing-xref", async () => {
      prisma.$queryRaw
        // 1st call: orphans → 2 rows
        .mockResolvedValueOnce([
          { id: "p1", slug: "page-1" },
          { id: "p2", slug: "page-2" },
        ])
        // 2nd call: missing-xrefs → 1 row
        .mockResolvedValueOnce([{ from_page_id: "p3", to_slug: "ghost-slug" }]);

      const created = await service.runInvariantLint("kb-1");

      expect(prisma.wikiLintFinding.create).toHaveBeenCalledTimes(3);
      // 2 ORPHAN creates
      const orphanCalls = prisma.wikiLintFinding.create.mock.calls.filter(
        (c: any[]) => c[0].data.type === WikiLintType.ORPHAN,
      );
      expect(orphanCalls).toHaveLength(2);
      // 1 MISSING_XREF create
      const xrefCalls = prisma.wikiLintFinding.create.mock.calls.filter(
        (c: any[]) => c[0].data.type === WikiLintType.MISSING_XREF,
      );
      expect(xrefCalls).toHaveLength(1);
      expect(created).toHaveLength(3);
    });
  });

  // ─── C. runFullLint (5 types, budget) ───

  describe("runFullLint", () => {
    it("requires EDITOR access — throws Forbidden when denied", async () => {
      kbService.hasAccess.mockResolvedValue(false);
      await expect(service.runFullLint("u", "kb-1")).rejects.toThrow(
        ForbiddenException,
      );
      expect(kbService.hasAccess).toHaveBeenCalledWith("kb-1", "u", "EDITOR");
    });

    it("throws Forbidden when wikiEnabled=false", async () => {
      prisma.knowledgeBase.findUnique.mockResolvedValue({ wikiEnabled: false });
      await expect(service.runFullLint("u", "kb-1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("ORPHAN/MISSING_XREF run first via SQL with no chat call", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: "p1", slug: "page-1" }]) // orphans
        .mockResolvedValueOnce([{ from_page_id: "p2", to_slug: "ghost" }]); // xrefs
      // No pages → STALE/CONTRADICTION/DATA_GAP all skipped
      prisma.wikiPage.findMany.mockResolvedValue([]);

      const result = await service.runFullLint("u", "kb-1");

      // SQL invoked exactly twice (orphans + xrefs)
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
      // No LLM-driven calls
      expect(chat.chat).not.toHaveBeenCalled();
      expect(staleDetector.detect).not.toHaveBeenCalled();
      expect(synthesis.detectContradictions).not.toHaveBeenCalled();
      expect(synthesis.detectDataGaps).not.toHaveBeenCalled();
      // Counts reflect only SQL types
      expect(result.counts.ORPHAN).toBe(1);
      expect(result.counts.MISSING_XREF).toBe(1);
      expect(result.counts.STALE).toBe(0);
      expect(result.counts.CONTRADICTION).toBe(0);
      expect(result.counts.DATA_GAP).toBe(0);
    });

    it("STALE delegates to staleDetector.detect with chatFn", async () => {
      prisma.wikiPage.findMany.mockResolvedValue([makePage()]);
      staleDetector.detect.mockResolvedValue([
        { id: "page-1", isStale: true, driftScore: 0.7, reason: "drift" },
      ]);

      const result = await service.runFullLint("u", "kb-1");

      expect(staleDetector.detect).toHaveBeenCalledTimes(1);
      const [entries, chatFn] = staleDetector.detect.mock.calls[0];
      expect(Array.isArray(entries)).toBe(true);
      expect(typeof chatFn).toBe("function");
      // STALE finding created with driftScore detail
      const staleCalls = prisma.wikiLintFinding.create.mock.calls.filter(
        (c: any[]) => c[0].data.type === WikiLintType.STALE,
      );
      expect(staleCalls).toHaveLength(1);
      expect(staleCalls[0][0].data.detail).toEqual(
        expect.objectContaining({ driftScore: 0.7 }),
      );
      expect(result.counts.STALE).toBe(1);
    });

    it("CONTRADICTION delegates to synthesis.detectContradictions with samplingLimit=min(20, pages.length)", async () => {
      // 5 pages → samplingLimit should be 5 (min of 20, 5)
      const pages = Array.from({ length: 5 }, (_, i) =>
        makePage({ id: `p-${i}`, slug: `slug-${i}` }),
      );
      prisma.wikiPage.findMany.mockResolvedValue(pages);
      synthesis.detectContradictions.mockResolvedValue([
        { area: "x", description: "conflict" },
      ]);

      await service.runFullLint("u", "kb-1");

      expect(synthesis.detectContradictions).toHaveBeenCalledTimes(1);
      const [docs, chatFn, options] =
        synthesis.detectContradictions.mock.calls[0];
      expect(docs).toHaveLength(5);
      expect(typeof chatFn).toBe("function");
      expect(options).toEqual({ samplingLimit: 5 });
    });

    it("CONTRADICTION samplingLimit caps at 20 when pages.length > 20", async () => {
      const pages = Array.from({ length: 30 }, (_, i) =>
        makePage({ id: `p-${i}`, slug: `slug-${i}` }),
      );
      prisma.wikiPage.findMany.mockResolvedValue(pages);

      await service.runFullLint("u", "kb-1");

      const [, , options] = synthesis.detectContradictions.mock.calls[0];
      expect(options).toEqual({ samplingLimit: 20 });
    });

    it("DATA_GAP delegates to synthesis.detectDataGaps with existingEntityIds from ENTITY-category pages", async () => {
      prisma.wikiPage.findMany.mockResolvedValue([
        makePage({ id: "e1", slug: "ent-a", category: "ENTITY" }),
        makePage({ id: "e2", slug: "ent-b", category: "ENTITY" }),
        makePage({ id: "c1", slug: "cpt-a", category: "CONCEPT" }),
      ]);
      synthesis.detectDataGaps.mockResolvedValue([
        { area: "Missing area", description: "gap" },
      ]);

      await service.runFullLint("u", "kb-1");

      expect(synthesis.detectDataGaps).toHaveBeenCalledTimes(1);
      const [, , options] = synthesis.detectDataGaps.mock.calls[0];
      // Only ENTITY slugs should be passed as existingEntityIds
      expect(options.existingEntityIds).toEqual(["ent-a", "ent-b"]);
    });

    // ─── 4b0a50d9: lint LLM 三调用补 modelType=AIModelType.CHAT 透传 ───
    // 守护 wiki-lint.service.ts:247 / :297 / :345 三处 chat 调用都显式
    // 传 modelType=CHAT。漏传会落到 ai-chat.service:1689 读 DEFAULT_AI_MODEL
    // env,未配则 throw "未指定 modelType/modelId" → 三个 lint 类别全部沉默
    // 失败为 0 findings。

    it("STALE chatFn passes modelType=CHAT and operationName=library-wiki-lint-stale (4b0a50d9)", async () => {
      const { AIModelType } = await import("@prisma/client");
      prisma.wikiPage.findMany.mockResolvedValue([makePage()]);
      staleDetector.detect.mockImplementation(
        async (
          _entries: unknown,
          chatFn: (s: string, u: string) => unknown,
        ) => {
          await chatFn("sys-prompt", "user-prompt");
          return [];
        },
      );

      await service.runFullLint("u", "kb-1");

      expect(chat.chat).toHaveBeenCalledTimes(1);
      const args = chat.chat.mock.calls[0][0];
      expect(args.modelType).toBe(AIModelType.CHAT);
      expect(args.operationName).toBe("library-wiki-lint-stale");
      expect(args.userId).toBe("u");
      expect(args.responseFormat).toBe("json_object");
    });

    it("CONTRADICTION chatFn passes modelType=CHAT and operationName=library-wiki-lint-contradiction (4b0a50d9)", async () => {
      const { AIModelType } = await import("@prisma/client");
      // Need >= 2 pages so CONTRADICTION pass runs.
      prisma.wikiPage.findMany.mockResolvedValue([
        makePage({ id: "p1", slug: "s1" }),
        makePage({ id: "p2", slug: "s2" }),
      ]);
      synthesis.detectContradictions.mockImplementation(
        async (_docs: unknown, chatFn: (s: string, u: string) => unknown) => {
          await chatFn("sys", "user");
          return [];
        },
      );

      await service.runFullLint("u", "kb-1");

      // chat.chat invoked at least once with CONTRADICTION op (STALE pass
      // skipped because staleDetector.detect default mock returns [] without
      // calling chatFn).
      const contradictionCalls = chat.chat.mock.calls.filter(
        (c: unknown[]) =>
          (c[0] as { operationName: string }).operationName ===
          "library-wiki-lint-contradiction",
      );
      expect(contradictionCalls).toHaveLength(1);
      const args = contradictionCalls[0][0];
      expect(args.modelType).toBe(AIModelType.CHAT);
      expect(args.userId).toBe("u");
      expect(args.responseFormat).toBe("json_object");
    });

    it("DATA_GAP chatFn passes modelType=CHAT and operationName=library-wiki-lint-data-gap (4b0a50d9)", async () => {
      const { AIModelType } = await import("@prisma/client");
      // Need >= 3 pages so DATA_GAP pass runs.
      prisma.wikiPage.findMany.mockResolvedValue([
        makePage({ id: "p1", slug: "s1" }),
        makePage({ id: "p2", slug: "s2" }),
        makePage({ id: "p3", slug: "s3" }),
      ]);
      synthesis.detectDataGaps.mockImplementation(
        async (_docs: unknown, chatFn: (s: string, u: string) => unknown) => {
          await chatFn("sys", "user");
          return [];
        },
      );

      await service.runFullLint("u", "kb-1");

      const dataGapCalls = chat.chat.mock.calls.filter(
        (c: unknown[]) =>
          (c[0] as { operationName: string }).operationName ===
          "library-wiki-lint-data-gap",
      );
      expect(dataGapCalls).toHaveLength(1);
      const args = dataGapCalls[0][0];
      expect(args.modelType).toBe(AIModelType.CHAT);
      expect(args.userId).toBe("u");
      expect(args.responseFormat).toBe("json_object");
    });

    it("budget enforcement — llmBudget=2 only runs first 2 LLM-driven types and returns budgetExceeded=true", async () => {
      prisma.wikiKnowledgeBaseConfig.findUnique.mockResolvedValue({
        cronLintDailyBudgetCalls: 2,
      });
      // Need >=3 pages so DATA_GAP would otherwise run; STALE + CONTRADICTION run, DATA_GAP must NOT
      prisma.wikiPage.findMany.mockResolvedValue([
        makePage({ id: "p1", slug: "s1" }),
        makePage({ id: "p2", slug: "s2" }),
        makePage({ id: "p3", slug: "s3" }),
      ]);

      const result = await service.runFullLint("u", "kb-1");

      // First two LLM-driven types should have been called (budget allowed)
      expect(staleDetector.detect).toHaveBeenCalledTimes(1);
      expect(synthesis.detectContradictions).toHaveBeenCalledTimes(1);
      // Third type was budget-blocked
      expect(synthesis.detectDataGaps).not.toHaveBeenCalled();
      expect(result.budgetExceeded).toBe(true);
    });
  });

  // ─── batchPatchFindings (6e0457e81) ────────────────────────────────────────
  //
  // The feat added bulk resolve / dismiss so the UI can act on either
  // user-selected findings (checkbox set) or the entire current tab (all
  // unresolved of a given type). Three branches plus EDITOR access guard:
  //   - selector.ids → updateMany WHERE id IN ids
  //   - selector.filterAll (no ids) → updateMany WHERE no id filter
  //   - neither ids nor filterAll → safe no-op (returns { updated: 0 })
  //   - selector.type narrows either branch
  //   - EDITOR access required
  describe("batchPatchFindings", () => {
    beforeEach(() => {
      prisma.wikiLintFinding.updateMany = jest
        .fn()
        .mockResolvedValue({ count: 0 });
    });

    it("ids branch — updates only the specified finding ids and narrows by knowledgeBaseId + resolvedAt: null", async () => {
      // Arrange
      prisma.wikiLintFinding.updateMany.mockResolvedValue({ count: 2 });
      // Act
      const result = await service.batchPatchFindings("u", "kb-1", "resolve", {
        ids: ["f-1", "f-2"],
      });
      // Assert — where clause carries id IN selector.ids and kb/IDOR guard
      const args = prisma.wikiLintFinding.updateMany.mock.calls[0][0];
      expect(args.where).toEqual(
        expect.objectContaining({
          knowledgeBaseId: "kb-1",
          resolvedAt: null,
          id: { in: ["f-1", "f-2"] },
        }),
      );
      // resolvedAt is stamped to a Date (both resolve + dismiss share semantics)
      expect(args.data.resolvedAt).toBeInstanceOf(Date);
      expect(result.updated).toBe(2);
    });

    it("filterAll branch — without ids, updateMany runs across the whole KB (no id filter) and may narrow by type", async () => {
      // Arrange
      prisma.wikiLintFinding.updateMany.mockResolvedValue({ count: 7 });
      // Act
      const result = await service.batchPatchFindings("u", "kb-1", "dismiss", {
        filterAll: true,
        type: WikiLintType.STALE,
      });
      // Assert
      const args = prisma.wikiLintFinding.updateMany.mock.calls[0][0];
      // No id filter — bulk applies to KB-wide unresolved STALE findings.
      expect(args.where.id).toBeUndefined();
      expect(args.where).toEqual(
        expect.objectContaining({
          knowledgeBaseId: "kb-1",
          resolvedAt: null,
          type: WikiLintType.STALE,
        }),
      );
      expect(result.updated).toBe(7);
    });

    it("safety branch — neither ids nor filterAll returns updated=0 and does NOT call updateMany (avoids wiping the KB on stray empty payload)", async () => {
      // Arrange — empty selector (defensive case caller might trip into).
      // Act
      const result = await service.batchPatchFindings(
        "u",
        "kb-1",
        "resolve",
        {},
      );
      // Assert — no DB write happens; "全部解决"必须显式 filterAll=true 才生效。
      expect(prisma.wikiLintFinding.updateMany).not.toHaveBeenCalled();
      expect(result.updated).toBe(0);
    });

    it("safety branch — empty ids array also short-circuits (length-0 ids is treated as 'no ids supplied')", async () => {
      // Arrange
      // Act — explicit empty array must be just as safe as omitting ids.
      const result = await service.batchPatchFindings("u", "kb-1", "resolve", {
        ids: [],
      });
      // Assert
      expect(prisma.wikiLintFinding.updateMany).not.toHaveBeenCalled();
      expect(result.updated).toBe(0);
    });

    it("requires EDITOR access — throws Forbidden when denied", async () => {
      // Arrange
      kbService.hasAccess.mockResolvedValue(false);
      // Act + Assert
      await expect(
        service.batchPatchFindings("u", "kb-1", "resolve", {
          ids: ["f-1"],
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(kbService.hasAccess).toHaveBeenCalledWith("kb-1", "u", "EDITOR");
      // Access guard runs before the DB write.
      expect(prisma.wikiLintFinding.updateMany).not.toHaveBeenCalled();
    });
  });
});
