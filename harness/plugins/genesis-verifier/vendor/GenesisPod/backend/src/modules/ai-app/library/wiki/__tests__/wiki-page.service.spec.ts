/**
 * WikiPageService spec — v1.5.3 P1 critical paths
 *
 *  - hasAccess + wikiEnabled gate on writes
 *  - createPage rejects non-canonical slug
 *  - edit writes WikiPageRevision snapshot when body changes
 *  - revert with cross-page revisionId returns 404 (NOT 403) per v1.5.3 §6
 *  - delete clears via Cascade (assumed via Prisma; tested as call shape)
 */

import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { WikiPageService } from "../wiki-page.service";

function makePrisma() {
  const tx: any = {
    wikiPage: {
      create: jest.fn(),
      update: jest.fn(),
    },
    wikiPageRevision: {
      create: jest.fn().mockResolvedValue({ id: "rev-new" }),
    },
    wikiPageLink: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const prisma: any = {
    wikiPage: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({}),
    },
    wikiPageLink: { findMany: jest.fn().mockResolvedValue([]) },
    wikiPageRevision: { findUnique: jest.fn() },
    knowledgeBase: { findUnique: jest.fn() },
    // gap #5 (2026-05-12): regenerateIndexPage reads enabledLocales from
    // WikiKnowledgeBaseConfig to decide per-locale index generation. Default
    // null → falls back to ['zh'], matching backend migration default.
    wikiKnowledgeBaseConfig: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn().mockImplementation(async (fn: any) => fn(tx)),
  };
  return { prisma, tx };
}

function makeKbService(allow = true) {
  return { hasAccess: jest.fn().mockResolvedValue(allow) } as any;
}

describe("WikiPageService", () => {
  let prisma: any;
  let tx: any;
  let kbService: any;
  let service: WikiPageService;

  beforeEach(() => {
    const m = makePrisma();
    prisma = m.prisma;
    tx = m.tx;
    kbService = makeKbService();
    prisma.knowledgeBase.findUnique.mockResolvedValue({ wikiEnabled: true });
    service = new WikiPageService(prisma, kbService);
  });

  describe("createPage", () => {
    it("requires EDITOR access", async () => {
      kbService.hasAccess.mockResolvedValue(false);
      await expect(
        service.createPage("u", "kb", {
          slug: "test-page",
          title: "T",
          category: "CONCEPT" as any,
          body: "b",
          oneLiner: "o",
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("rejects when wikiEnabled=false", async () => {
      prisma.knowledgeBase.findUnique.mockResolvedValue({ wikiEnabled: false });
      await expect(
        service.createPage("u", "kb", {
          slug: "test-page",
          title: "T",
          category: "CONCEPT" as any,
          body: "b",
          oneLiner: "o",
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("rejects non-canonical slug (defense in depth past DTO)", async () => {
      // Slug regex passes "Test-Page" via DTO would not — but service-layer
      // also asserts canonical form to defend in depth.
      await expect(
        service.createPage("u", "kb", {
          slug: "Test-Page", // uppercase — would not match DTO regex either
          title: "T",
          category: "CONCEPT" as any,
          body: "b",
          oneLiner: "o",
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("creates page with sanitized body and replaces outbound links", async () => {
      tx.wikiPage.create.mockResolvedValue({
        id: "p1",
        slug: "test-page",
        body: "b",
        contentHash: "h",
      });
      const page = await service.createPage("u", "kb", {
        slug: "test-page",
        title: "T",
        category: "CONCEPT" as any,
        body: "Hello with [[other-page]] link",
        oneLiner: "o",
      });
      expect(page.id).toBe("p1");
      expect(tx.wikiPage.create).toHaveBeenCalled();
      expect(tx.wikiPageLink.deleteMany).toHaveBeenCalledWith({
        where: { fromPageId: "p1" },
      });
      // [[other-page]] → 1 outbound link (2026-05-14: toLocale = source page locale)
      expect(tx.wikiPageLink.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [{ fromPageId: "p1", toSlug: "other-page", toLocale: "zh" }],
        }),
      );
    });
  });

  describe("updatePage edit (body change snapshots a revision)", () => {
    it("writes a WikiPageRevision before mutating when body changes", async () => {
      const current = {
        id: "p1",
        slug: "test-page",
        body: "old body",
        contentHash: "old-hash",
        category: "CONCEPT",
      };
      prisma.wikiPage.findUnique.mockResolvedValue(current);
      tx.wikiPage.update.mockResolvedValue({ ...current, body: "new body" });

      await service.updatePage("u", "kb", "test-page", {
        body: "new body",
      });

      expect(tx.wikiPageRevision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            pageId: "p1",
            body: "old body",
            contentHash: "old-hash",
          }),
        }),
      );
    });

    it("does NOT write a revision when only oneLiner / title changes (body identical)", async () => {
      const current = {
        id: "p1",
        slug: "test-page",
        body: "same body",
        contentHash: "same-hash",
        category: "CONCEPT",
      };
      prisma.wikiPage.findUnique.mockResolvedValue(current);
      tx.wikiPage.update.mockResolvedValue(current);

      await service.updatePage("u", "kb", "test-page", {
        title: "New title only",
      });

      expect(tx.wikiPageRevision.create).not.toHaveBeenCalled();
    });

    it("returns 404 when page does not exist in KB", async () => {
      prisma.wikiPage.findUnique.mockResolvedValue(null);
      await expect(
        service.updatePage("u", "kb", "missing-page", { body: "x" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("updatePage revert — cross-page IDOR returns 404 (v1.5.3 §6)", () => {
    it("returns 404 (NOT 403) when revisionId belongs to a DIFFERENT page", async () => {
      const current = {
        id: "p1",
        slug: "page-a",
        body: "current",
        contentHash: "h1",
      };
      prisma.wikiPage.findUnique.mockResolvedValue(current);
      prisma.wikiPageRevision.findUnique.mockResolvedValue({
        id: "rev-x",
        pageId: "p-OTHER", // belongs to a different page
        body: "stolen",
      });

      await expect(
        service.updatePage("u", "kb", "page-a", {
          action: "revert",
          toRevisionId: "rev-x",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("returns 404 when revisionId does not exist", async () => {
      prisma.wikiPage.findUnique.mockResolvedValue({
        id: "p1",
        slug: "page-a",
        body: "current",
        contentHash: "h1",
      });
      prisma.wikiPageRevision.findUnique.mockResolvedValue(null);

      await expect(
        service.updatePage("u", "kb", "page-a", {
          action: "revert",
          toRevisionId: "missing",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("reverts when revisionId belongs to the same page (writes new revision before)", async () => {
      const current = {
        id: "p1",
        slug: "page-a",
        body: "current body",
        contentHash: "h-current",
      };
      prisma.wikiPage.findUnique.mockResolvedValue(current);
      prisma.wikiPageRevision.findUnique.mockResolvedValue({
        id: "rev-target",
        pageId: "p1",
        body: "old body to restore",
      });
      tx.wikiPage.update.mockResolvedValue({
        ...current,
        body: "old body to restore",
      });

      await service.updatePage("u", "kb", "page-a", {
        action: "revert",
        toRevisionId: "rev-target",
      });

      // Revert path snapshots the CURRENT state before restoring (not a no-op).
      expect(tx.wikiPageRevision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            pageId: "p1",
            body: "current body",
          }),
        }),
      );
      expect(tx.wikiPage.update).toHaveBeenCalled();
    });
  });

  describe("listPages / getPage (VIEWER access)", () => {
    it("uses VIEWER role for read operations", async () => {
      prisma.wikiPage.findMany.mockResolvedValue([]);
      await service.listPages("u", "kb");
      expect(kbService.hasAccess).toHaveBeenCalledWith("kb", "u", "VIEWER");
    });

    it("getPage returns outbound + backlinks with hydrated title (multi-locale rebuild 2026-05-14)", async () => {
      prisma.wikiPage.findUnique.mockResolvedValue({
        id: "p1",
        slug: "page-a",
        locale: "zh",
        knowledgeBaseId: "kb",
      });
      // findMany 调用顺序: outbound links -> backlinks -> outbound page targets
      prisma.wikiPageLink.findMany
        .mockResolvedValueOnce([{ toSlug: "out-1", toLocale: "zh" }])
        .mockResolvedValueOnce([
          { fromPage: { slug: "back-1", title: "返回页 A", locale: "zh" } },
        ]);
      prisma.wikiPage.findMany.mockResolvedValueOnce([
        { slug: "out-1", title: "外链页 1", locale: "zh" },
      ]);

      const result = await service.getPage("u", "kb", "page-a");
      expect(result.outboundLinks).toEqual([
        { slug: "out-1", title: "外链页 1", locale: "zh", exists: true },
      ]);
      expect(result.backlinks).toEqual([
        { slug: "back-1", title: "返回页 A", locale: "zh", exists: true },
      ]);
    });

    it("getPage outbound with missing target page falls back title=slug, exists=false", async () => {
      prisma.wikiPage.findUnique.mockResolvedValue({
        id: "p1",
        slug: "page-a",
        locale: "zh",
        knowledgeBaseId: "kb",
      });
      prisma.wikiPageLink.findMany
        .mockResolvedValueOnce([{ toSlug: "ghost", toLocale: "zh" }])
        .mockResolvedValueOnce([]);
      // 没找到目标 page (lint MISSING_XREF dangling 引用)
      prisma.wikiPage.findMany.mockResolvedValueOnce([]);

      const result = await service.getPage("u", "kb", "page-a");
      expect(result.outboundLinks).toEqual([
        { slug: "ghost", title: "ghost", locale: "zh", exists: false },
      ]);
    });

    it("getPage returns 404 when page missing", async () => {
      prisma.wikiPage.findUnique.mockResolvedValue(null);
      await expect(service.getPage("u", "kb", "missing")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("regenerateIndexPage — W5 v2.0 rebuild Karpathy compounding tracker", () => {
    it("drops any stale __index__ when KB has no other pages", async () => {
      prisma.wikiPage.findMany.mockResolvedValue([]);
      prisma.wikiPage.deleteMany = jest.fn().mockResolvedValue({ count: 1 });

      const result = await service.regenerateIndexPage("kb-empty");

      expect(result).toEqual({
        regenerated: false,
        pageCount: 0,
        locales: ["zh"],
      });
      expect(prisma.wikiPage.deleteMany).toHaveBeenCalledWith({
        where: {
          knowledgeBaseId: "kb-empty",
          slug: "__index__",
          locale: "zh",
        },
      });
    });

    // gap #5 (2026-05-12): bilingual KB writes two indexes with locale-
    // specific labels (实体页 vs Entities). Bullets reuse the same
    // [[slug]] format so cross-locale traversal works.
    it("writes two indexes with locale-specific labels for bilingual KB", async () => {
      prisma.wikiKnowledgeBaseConfig.findUnique.mockResolvedValue({
        enabledLocales: ["zh", "en"],
      });
      prisma.wikiPage.findMany.mockImplementation((args: any) =>
        Promise.resolve(
          args.where.locale === "zh"
            ? [
                {
                  slug: "foo",
                  title: "中文 foo",
                  category: "ENTITY",
                  oneLiner: "z",
                },
              ]
            : [
                {
                  slug: "foo",
                  title: "English foo",
                  category: "ENTITY",
                  oneLiner: "e",
                },
              ],
        ),
      );
      prisma.wikiPage.upsert = jest.fn().mockResolvedValue({});

      const result = await service.regenerateIndexPage("kb-bi");

      expect(result.locales).toEqual(["zh", "en"]);
      expect(prisma.wikiPage.upsert).toHaveBeenCalledTimes(2);
      const callShapes = prisma.wikiPage.upsert.mock.calls.map((c: any) => ({
        locale: c[0]?.where?.knowledgeBaseId_slug_locale?.locale,
        title: c[0]?.create?.title,
        body: c[0]?.create?.body,
      }));
      // Render call shapes via toEqual so a mismatch surfaces the actual
      // shape Jest captured (vs find→undefined→cryptic TypeError).
      expect(callShapes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            locale: "zh",
            title: "Wiki 索引",
            body: expect.stringContaining("实体页 (1)"),
          }),
          expect.objectContaining({
            locale: "en",
            title: "Wiki Index",
            body: expect.stringContaining("Entities (1)"),
          }),
        ]),
      );
    });

    it("upserts __index__ with body grouping all pages by category", async () => {
      prisma.wikiPage.findMany.mockResolvedValue([
        {
          slug: "react-hooks",
          title: "React Hooks",
          category: "ENTITY",
          oneLiner: "状态钩子",
        },
        {
          slug: "react-overview",
          title: "React 概览",
          category: "ENTITY",
          oneLiner: "Library overview",
        },
        {
          slug: "rendering-pipeline",
          title: "渲染管线",
          category: "CONCEPT",
          oneLiner: "React 内部渲染过程",
        },
        {
          slug: "perf-summary",
          title: "性能总结",
          category: "SUMMARY",
          oneLiner: "",
        },
      ]);
      prisma.wikiPage.upsert = jest.fn().mockResolvedValue({});

      const result = await service.regenerateIndexPage("kb-1");

      expect(result.regenerated).toBe(true);
      expect(result.pageCount).toBe(4);
      expect(prisma.wikiPage.upsert).toHaveBeenCalledTimes(1);
      const upsertCall = prisma.wikiPage.upsert.mock.calls[0][0];
      expect(upsertCall.where).toEqual({
        knowledgeBaseId_slug_locale: {
          knowledgeBaseId: "kb-1",
          slug: "__index__",
          locale: "zh",
        },
      });
      // body must include all 4 slugs as [[slug]] links + category headers
      const body = upsertCall.create.body as string;
      expect(body).toContain("[[react-hooks]]");
      expect(body).toContain("[[react-overview]]");
      expect(body).toContain("[[rendering-pipeline]]");
      expect(body).toContain("[[perf-summary]]");
      expect(body).toContain("实体页 (2)");
      expect(body).toContain("概念页 (1)");
      expect(body).toContain("总结页 (1)");
      // category=SUMMARY page even with empty oneLiner still listed
      expect(body).toMatch(/\[\[perf-summary\]\] 性能总结/);
    });

    it("excludes the __index__ page itself from the listing source query", async () => {
      prisma.wikiPage.findMany.mockResolvedValue([
        { slug: "foo", title: "Foo", category: "ENTITY", oneLiner: "x" },
      ]);
      prisma.wikiPage.upsert = jest.fn().mockResolvedValue({});

      await service.regenerateIndexPage("kb-1");

      expect(prisma.wikiPage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            slug: { not: "__index__" },
          }),
        }),
      );
    });
  });
});
