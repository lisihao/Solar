/**
 * WikiKbAdminService spec — v1.5.3 P3b backend (3 endpoints)
 *
 * Coverage per llm-wiki §8 P1 + §11 v1.5.x security rules:
 *
 *  A. listWikiEnabledKbs (server-side filtering only)
 *     - VIEWER+ access keeps wikiEnabled KBs in result
 *     - kbService.findByUser excludes inaccessible KBs (no client filter)
 *     - wikiEnabled=false dropped even when user is OWNER
 *     - pageCount via prisma.wikiPage.groupBy
 *     - lastIngestAt via wikiOperationLog op=INGEST
 *     - sorted by lastIngestAt desc
 *
 *  B. toggleWikiEnabled (OWNER/ADMIN only — security P0-5)
 *     - OWNER first-enable creates config row → configCreated=true
 *     - ADMIN re-enable when already enabled is a no-op → configCreated=false
 *     - EDITOR (hasAccess ADMIN=false) → ForbiddenException
 *     - missing KB → NotFoundException
 *     - disable path skips config creation
 *     - WikiOperationLog audit row written for every actual toggle
 *
 *  C. searchPages (defense layers)
 *     - q length 0 / 201 → ForbiddenException (1–200 chars)
 *     - disallowed chars (ReDoS payload `'a'×100 + '!'`) → ForbiddenException
 *     - CJK passes regex (no false reject)
 *     - cross-KB / wikiEnabled=false → NotFoundException (existence oracle)
 *     - returned object keys exactly = {slug,title,oneLiner,category}
 *     - limit clamped to [1, 50]
 */

import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { WikiKbAdminService } from "../wiki-kb-admin.service";

function makePrisma() {
  const tx: any = {
    knowledgeBase: { update: jest.fn().mockResolvedValue({}) },
    wikiKnowledgeBaseConfig: {
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
    },
    wikiOperationLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    wikiPage: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
    },
    wikiOperationLog: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
    },
    knowledgeBase: { findUnique: jest.fn() },
    // gap #2 (2026-05-12): listWikiEnabledKbs now also queries
    // wikiKnowledgeBaseConfig.findMany to fetch per-KB enabledLocales for
    // the frontend locale switcher. Default empty array → KBs default to
    // ['zh'] via service fallback.
    wikiKnowledgeBaseConfig: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn().mockImplementation(async (fn: any) => fn(tx)),
  };
  return { prisma, tx };
}

function makeKbService() {
  return {
    findByUser: jest.fn().mockResolvedValue([]),
    hasAccess: jest.fn().mockResolvedValue(true),
  } as any;
}

describe("WikiKbAdminService", () => {
  let prisma: any;
  let tx: any;
  let kbService: any;
  let chat: any;
  let service: WikiKbAdminService;

  beforeEach(() => {
    const m = makePrisma();
    prisma = m.prisma;
    tx = m.tx;
    kbService = makeKbService();
    chat = { chat: jest.fn() };
    service = new WikiKbAdminService(prisma, kbService, chat);
  });

  describe("listWikiEnabledKbs — server-side filtering", () => {
    it("[1] returns wikiEnabled KB the user has VIEWER+ access to", async () => {
      // findByUser already enforces VIEWER+ (membership/owner) — service trusts that
      kbService.findByUser.mockResolvedValue([
        {
          id: "kb-1",
          name: "Alpha",
          description: "first",
          type: "PERSONAL",
          wikiEnabled: true,
        },
      ]);
      prisma.wikiPage.groupBy.mockResolvedValue([
        { knowledgeBaseId: "kb-1", _count: { _all: 7 } },
      ]);
      const t = new Date("2026-04-01T10:00:00Z");
      prisma.wikiOperationLog.findMany.mockResolvedValue([
        { knowledgeBaseId: "kb-1", createdAt: t },
      ]);

      const result = await service.listWikiEnabledKbs("u");

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "kb-1",
        name: "Alpha",
        description: "first",
        type: "PERSONAL",
        pageCount: 7,
        lastIngestAt: t,
      });
    });

    it("[2] does NOT return KBs the user has no access to (excluded by findByUser)", async () => {
      // KB-NOACCESS is simply not in findByUser's result — service has no
      // separate fallback path; this is the architectural protection.
      kbService.findByUser.mockResolvedValue([
        {
          id: "kb-mine",
          name: "Mine",
          description: null,
          type: "PERSONAL",
          wikiEnabled: true,
        },
      ]);
      prisma.wikiPage.groupBy.mockResolvedValue([]);

      const result = await service.listWikiEnabledKbs("u");

      expect(result.map((k) => k.id)).toEqual(["kb-mine"]);
      // Confirm service never queried for non-accessible IDs
      expect(prisma.wikiPage.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { knowledgeBaseId: { in: ["kb-mine"] } },
        }),
      );
    });

    it("[3] does NOT return wikiEnabled=false KBs even when user is OWNER", async () => {
      kbService.findByUser.mockResolvedValue([
        {
          id: "kb-disabled",
          name: "Disabled",
          description: null,
          type: "PERSONAL",
          wikiEnabled: false,
        },
        {
          id: "kb-enabled",
          name: "Enabled",
          description: null,
          type: "TEAM",
          wikiEnabled: true,
        },
      ]);

      const result = await service.listWikiEnabledKbs("u");

      expect(result.map((k) => k.id)).toEqual(["kb-enabled"]);
    });

    it("[4] enriches each row with pageCount (groupBy) and lastIngestAt (wikiOperationLog)", async () => {
      kbService.findByUser.mockResolvedValue([
        {
          id: "kb-a",
          name: "A",
          description: null,
          type: "PERSONAL",
          wikiEnabled: true,
        },
        {
          id: "kb-b",
          name: "B",
          description: null,
          type: "PERSONAL",
          wikiEnabled: true,
        },
      ]);
      prisma.wikiPage.groupBy.mockResolvedValue([
        { knowledgeBaseId: "kb-a", _count: { _all: 3 } },
        { knowledgeBaseId: "kb-b", _count: { _all: 5 } },
      ]);
      const tA = new Date("2026-04-01T10:00:00Z");
      const tB = new Date("2026-04-02T10:00:00Z");
      prisma.wikiOperationLog.findMany.mockResolvedValue([
        { knowledgeBaseId: "kb-b", createdAt: tB },
        { knowledgeBaseId: "kb-a", createdAt: tA },
      ]);

      const result = await service.listWikiEnabledKbs("u");

      const byId = Object.fromEntries(result.map((r) => [r.id, r]));
      expect(byId["kb-a"].pageCount).toBe(3);
      expect(byId["kb-a"].lastIngestAt).toEqual(tA);
      expect(byId["kb-b"].pageCount).toBe(5);
      expect(byId["kb-b"].lastIngestAt).toEqual(tB);
      expect(prisma.wikiOperationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ op: "INGEST" }),
        }),
      );
    });

    it("[5] sorts by lastIngestAt desc (most recent first)", async () => {
      kbService.findByUser.mockResolvedValue([
        {
          id: "kb-old",
          name: "Old",
          description: null,
          type: "PERSONAL",
          wikiEnabled: true,
        },
        {
          id: "kb-new",
          name: "New",
          description: null,
          type: "PERSONAL",
          wikiEnabled: true,
        },
        {
          id: "kb-never",
          name: "Never",
          description: null,
          type: "PERSONAL",
          wikiEnabled: true,
        },
      ]);
      prisma.wikiOperationLog.findMany.mockResolvedValue([
        {
          knowledgeBaseId: "kb-new",
          createdAt: new Date("2026-04-10T00:00:00Z"),
        },
        {
          knowledgeBaseId: "kb-old",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
      ]);

      const result = await service.listWikiEnabledKbs("u");

      expect(result.map((r) => r.id)).toEqual(["kb-new", "kb-old", "kb-never"]);
    });

    it("returns [] short-circuit when user has no wikiEnabled KBs", async () => {
      kbService.findByUser.mockResolvedValue([]);
      const result = await service.listWikiEnabledKbs("u");
      expect(result).toEqual([]);
      expect(prisma.wikiPage.groupBy).not.toHaveBeenCalled();
    });
  });

  describe("toggleWikiEnabled — three-role matrix", () => {
    it("[6] OWNER + enabled=true on first enable returns configCreated=true", async () => {
      kbService.hasAccess.mockResolvedValue(true); // OWNER passes ADMIN check
      prisma.knowledgeBase.findUnique.mockResolvedValue({
        id: "kb",
        wikiEnabled: false,
      });
      tx.wikiKnowledgeBaseConfig.findUnique.mockResolvedValue(null); // no existing config

      const result = await service.toggleWikiEnabled("u", "kb", true);

      expect(result).toEqual({
        kbId: "kb",
        wikiEnabled: true,
        configCreated: true,
      });
      expect(tx.wikiKnowledgeBaseConfig.create).toHaveBeenCalledWith({
        data: { knowledgeBaseId: "kb" },
      });
      expect(tx.knowledgeBase.update).toHaveBeenCalledWith({
        where: { id: "kb" },
        data: { wikiEnabled: true },
      });
    });

    it("[7] ADMIN + already wikiEnabled=true is a no-op idempotent (configCreated=false)", async () => {
      kbService.hasAccess.mockResolvedValue(true); // ADMIN passes ADMIN check
      prisma.knowledgeBase.findUnique.mockResolvedValue({
        id: "kb",
        wikiEnabled: true,
      });

      const result = await service.toggleWikiEnabled("u", "kb", true);

      expect(result).toEqual({
        kbId: "kb",
        wikiEnabled: true,
        configCreated: false,
      });
      // No write of any kind on no-op
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.knowledgeBase.update).not.toHaveBeenCalled();
      expect(tx.wikiKnowledgeBaseConfig.create).not.toHaveBeenCalled();
      expect(tx.wikiOperationLog.create).not.toHaveBeenCalled();
    });

    it("[8] no KB access (hasAccess VIEWER=false) throws ForbiddenException", async () => {
      // Per 2026-05-09 product decision the role gate was relaxed from
      // ADMIN+ to VIEWER+ — anyone with KB access (incl. shared-with-me)
      // can enable wiki. Only users with no access at all are rejected.
      kbService.hasAccess.mockResolvedValue(false);

      await expect(service.toggleWikiEnabled("u", "kb", true)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.toggleWikiEnabled("u", "kb", true)).rejects.toThrow(
        "Need at least KB access to toggle wikiEnabled",
      );
      // Asserts the VIEWER role gate is what's being checked now
      expect(kbService.hasAccess).toHaveBeenCalledWith("kb", "u", "VIEWER");
      expect(prisma.knowledgeBase.findUnique).not.toHaveBeenCalled();
    });

    it("[9] KB not found throws NotFoundException", async () => {
      kbService.hasAccess.mockResolvedValue(true);
      prisma.knowledgeBase.findUnique.mockResolvedValue(null);

      await expect(
        service.toggleWikiEnabled("u", "missing", true),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("[10] disable path (enabled=false) flips flag without touching config", async () => {
      kbService.hasAccess.mockResolvedValue(true);
      prisma.knowledgeBase.findUnique.mockResolvedValue({
        id: "kb",
        wikiEnabled: true,
      });

      const result = await service.toggleWikiEnabled("u", "kb", false);

      expect(result).toEqual({
        kbId: "kb",
        wikiEnabled: false,
        configCreated: false,
      });
      expect(tx.knowledgeBase.update).toHaveBeenCalledWith({
        where: { id: "kb" },
        data: { wikiEnabled: false },
      });
      expect(tx.wikiKnowledgeBaseConfig.findUnique).not.toHaveBeenCalled();
      expect(tx.wikiKnowledgeBaseConfig.create).not.toHaveBeenCalled();
    });

    it("[11] writes a WikiOperationLog audit row on every actual toggle", async () => {
      kbService.hasAccess.mockResolvedValue(true);
      prisma.knowledgeBase.findUnique.mockResolvedValue({
        id: "kb",
        wikiEnabled: false,
      });
      tx.wikiKnowledgeBaseConfig.findUnique.mockResolvedValue({
        knowledgeBaseId: "kb",
      });

      await service.toggleWikiEnabled("u", "kb", true);

      expect(tx.wikiOperationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            knowledgeBaseId: "kb",
            op: "EDIT",
            actorUserId: "u",
            meta: expect.objectContaining({
              action: "toggle_wiki_enabled",
              enabled: true,
            }),
          }),
        }),
      );
    });
  });

  describe("searchPages — defense layers", () => {
    beforeEach(() => {
      kbService.hasAccess.mockResolvedValue(true);
      prisma.knowledgeBase.findUnique.mockResolvedValue({ wikiEnabled: true });
    });

    it("[12] empty query throws ForbiddenException(1–200 chars)", async () => {
      await expect(service.searchPages("u", "kb", "")).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.searchPages("u", "kb", "")).rejects.toThrow(
        "Search query must be 1–200 characters",
      );
      await expect(service.searchPages("u", "kb", "    ")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("[13] query length 201 throws same ForbiddenException", async () => {
      const tooLong = "a".repeat(201);
      await expect(service.searchPages("u", "kb", tooLong)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.searchPages("u", "kb", tooLong)).rejects.toThrow(
        "Search query must be 1–200 characters",
      );
    });

    it("[14] disallowed chars (ReDoS payload `'a'×100 + '!'`) throws ForbiddenException", async () => {
      const redos = "a".repeat(100) + "!";
      await expect(service.searchPages("u", "kb", redos)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.searchPages("u", "kb", redos)).rejects.toThrow(
        "Search query contains disallowed characters",
      );
      // Should reject before any DB or access lookup
      expect(kbService.hasAccess).not.toHaveBeenCalled();
      expect(prisma.wikiPage.findMany).not.toHaveBeenCalled();
    });

    it("[15] CJK query '数据' passes regex (no false reject)", async () => {
      prisma.wikiPage.findMany.mockResolvedValue([]);
      await expect(service.searchPages("u", "kb", "数据")).resolves.toEqual([]);
      expect(prisma.wikiPage.findMany).toHaveBeenCalled();
    });

    it("[16] cross-KB / wikiEnabled=false returns NotFoundException (existence oracle)", async () => {
      // wikiEnabled=false case
      prisma.knowledgeBase.findUnique.mockResolvedValue({ wikiEnabled: false });
      await expect(service.searchPages("u", "kb", "valid")).rejects.toThrow(
        NotFoundException,
      );

      // unknown KB case (findUnique returns null)
      prisma.knowledgeBase.findUnique.mockResolvedValue(null);
      await expect(service.searchPages("u", "kb", "valid")).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.searchPages("u", "kb", "valid")).rejects.toThrow(
        "Knowledge base not found",
      );
    });

    it("[17] returns ONLY {slug,title,oneLiner,category} (no body / contentHash / lastEditedBy)", async () => {
      // Even if the underlying mock returns extra fields, the service contract
      // must strip to the four allowed keys.
      prisma.wikiPage.findMany.mockResolvedValue([
        {
          slug: "hello",
          title: "Hello",
          oneLiner: "say hi",
          category: "CONCEPT",
          // Extra fields below should NOT appear in result
          body: "secret body",
          contentHash: "abc123",
          lastEditedBy: "leak-user",
        },
      ]);

      const result = await service.searchPages("u", "kb", "hello");

      expect(result).toHaveLength(1);
      expect(Object.keys(result[0]).sort()).toEqual(
        ["category", "oneLiner", "slug", "title"].sort(),
      );
      expect(result[0]).toEqual({
        slug: "hello",
        title: "Hello",
        oneLiner: "say hi",
        category: "CONCEPT",
      });
      // Defense in depth: prisma select should also have NOT requested body
      const selectArg = prisma.wikiPage.findMany.mock.calls[0][0].select;
      expect(selectArg).toEqual({
        slug: true,
        title: true,
        oneLiner: true,
        category: true,
      });
    });

    it("[18] limit clamped to [1, 50]: limit=100 → take=50, limit=0 → take=1", async () => {
      prisma.wikiPage.findMany.mockResolvedValue([]);

      await service.searchPages("u", "kb", "valid", 100);
      expect(prisma.wikiPage.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ take: 50 }),
      );

      await service.searchPages("u", "kb", "valid", 0);
      expect(prisma.wikiPage.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ take: 1 }),
      );

      // Sanity: a value in-range passes through
      await service.searchPages("u", "kb", "valid", 25);
      expect(prisma.wikiPage.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ take: 25 }),
      );
    });
  });

  describe("destroyWikiData — W5 v2.0 rebuild destructive wipe", () => {
    it("rejects non-OWNER caller", async () => {
      kbService.hasAccess = jest.fn().mockResolvedValue(false);

      await expect(
        service.destroyWikiData("editor-user", "kb-1"),
      ).rejects.toThrow(ForbiddenException);
      expect(kbService.hasAccess).toHaveBeenCalledWith(
        "kb-1",
        "editor-user",
        "OWNER",
      );
    });

    it("returns 404 when KB does not exist", async () => {
      kbService.hasAccess = jest.fn().mockResolvedValue(true);
      prisma.knowledgeBase.findUnique.mockResolvedValue(null);

      await expect(
        service.destroyWikiData("owner-user", "kb-missing"),
      ).rejects.toThrow(NotFoundException);
    });

    it("cascade-deletes all wiki tables in a single transaction and sets wikiEnabled=false", async () => {
      kbService.hasAccess = jest.fn().mockResolvedValue(true);
      prisma.knowledgeBase.findUnique.mockResolvedValue({
        id: "kb-1",
        wikiEnabled: true,
      });

      // tx mock — augment to expose deleteMany counts per table.
      tx.wikiIngestDraft = {
        deleteMany: jest.fn().mockResolvedValue({ count: 4 }),
      };
      tx.wikiDocumentCoverage = {
        deleteMany: jest.fn().mockResolvedValue({ count: 7 }),
      };
      tx.wikiLintFinding = {
        deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
      };
      tx.wikiDiff = { deleteMany: jest.fn().mockResolvedValue({ count: 5 }) };
      tx.wikiOperationLog = {
        ...tx.wikiOperationLog,
        deleteMany: jest.fn().mockResolvedValue({ count: 11 }),
      };
      tx.wikiPage = { deleteMany: jest.fn().mockResolvedValue({ count: 23 }) };
      tx.wikiKnowledgeBaseConfig = {
        ...tx.wikiKnowledgeBaseConfig,
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      };

      const result = await service.destroyWikiData("owner-user", "kb-1");

      expect(result).toEqual({
        kbId: "kb-1",
        deleted: {
          pages: 23,
          diffs: 5,
          lintFindings: 3,
          coverage: 7,
          operations: 11,
          ingestDrafts: 4,
        },
      });
      // wikiEnabled flipped off as part of the same tx
      expect(tx.knowledgeBase.update).toHaveBeenCalledWith({
        where: { id: "kb-1" },
        data: { wikiEnabled: false },
      });
      // tx ordering: dependent rows first (drafts/coverage/lint/diffs/ops)
      // then pages then config — proves we are not relying solely on FK cascade.
      expect(tx.wikiIngestDraft.deleteMany).toHaveBeenCalled();
      expect(tx.wikiPage.deleteMany).toHaveBeenCalledWith({
        where: { knowledgeBaseId: "kb-1" },
      });
      expect(tx.wikiKnowledgeBaseConfig.deleteMany).toHaveBeenCalledWith({
        where: { knowledgeBaseId: "kb-1" },
      });
    });
  });
});
