/**
 * WikiDiffService spec — v1.5.3 P1 critical security paths
 *
 * Mocks PrismaService + KnowledgeBaseService; focuses on:
 *  - cross-KB diff IDOR returns 404 (not 403) per v1.5.3 §6
 *  - dismiss requires PENDING status; double-dismiss → 409
 *  - apply zod parse failure → 403 ForbiddenException
 *  - apply with no items → no-op APPLIED (not transaction failure)
 *  - apply collision against other PENDING diff → 409
 *  - apply baseline mismatch → CONFLICTED + 409
 *  - access checks (VIEWER for getDiff, EDITOR + wikiEnabled for write)
 */

import * as crypto from "crypto";
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { WikiDiffService } from "../wiki-diff.service";
import { WikiDiffStatus } from "@prisma/client";

function makePrismaMock() {
  const tx: any = {
    wikiPage: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(),
    },
    wikiPageRevision: {
      create: jest.fn().mockResolvedValue({ id: "rev-1" }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    wikiPageLink: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    wikiPageSource: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    wikiOperationLog: {
      create: jest.fn().mockResolvedValue({ id: "op-1" }),
    },
    wikiOperationLogPage: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    wikiDiff: {
      update: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: "diff-1",
        knowledgeBaseId: "kb-1",
        status: data.status ?? "PENDING",
        ...data,
      })),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(1),
  };

  const prisma: any = {
    wikiDiff: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: "diff-1",
        knowledgeBaseId: "kb-1",
        status: data.status ?? "PENDING",
      })),
      create: jest.fn(),
    },
    wikiPage: { findMany: jest.fn().mockResolvedValue([]) },
    knowledgeBase: { findUnique: jest.fn() },
    $transaction: jest.fn().mockImplementation(async (fn: any) => fn(tx)),
  };

  return { prisma, tx };
}

function makeKbService() {
  return {
    hasAccess: jest.fn().mockResolvedValue(true),
  } as any;
}

function makePageService() {
  return {
    hashBody: (b: string) => `hash-${b.length}`,
    replaceOutboundLinks: jest.fn().mockResolvedValue(undefined),
    // W5 v2.0 rebuild (2026-05-12): applyDiff fires regenerateIndexPage
    // post-commit. Spec mocks it as a no-op so the existing apply tests
    // don't have to care about the index page.
    regenerateIndexPage: jest
      .fn()
      .mockResolvedValue({ regenerated: true, pageCount: 0 }),
  } as any;
}

describe("WikiDiffService", () => {
  let service: WikiDiffService;
  let prisma: any;
  let kbService: any;
  let tx: any;

  beforeEach(() => {
    const m = makePrismaMock();
    prisma = m.prisma;
    tx = m.tx;
    kbService = makeKbService();
    service = new WikiDiffService(prisma, kbService, makePageService());
  });

  describe("getDiff IDOR (v1.5.3 §6)", () => {
    it("returns 404 when diff does not exist", async () => {
      prisma.wikiDiff.findUnique.mockResolvedValue(null);
      await expect(
        service.getDiff("user-1", "kb-1", "missing"),
      ).rejects.toThrow(NotFoundException);
    });

    it("returns 404 (NOT 403) when diff belongs to a DIFFERENT KB", async () => {
      prisma.wikiDiff.findUnique.mockResolvedValue({
        id: "diff-1",
        knowledgeBaseId: "kb-OTHER",
        status: WikiDiffStatus.PENDING,
      });
      // user has access to kb-1 (mock returns true)
      await expect(service.getDiff("user-1", "kb-1", "diff-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("returns the diff when KB matches and user has VIEWER access", async () => {
      prisma.wikiDiff.findUnique.mockResolvedValue({
        id: "diff-1",
        knowledgeBaseId: "kb-1",
        status: WikiDiffStatus.PENDING,
      });
      const result = await service.getDiff("user-1", "kb-1", "diff-1");
      expect(result.id).toBe("diff-1");
    });

    it("throws Forbidden when VIEWER access is denied", async () => {
      kbService.hasAccess.mockResolvedValue(false);
      await expect(service.getDiff("user-1", "kb-1", "diff-1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("dismissDiff", () => {
    beforeEach(() => {
      prisma.knowledgeBase.findUnique.mockResolvedValue({ wikiEnabled: true });
    });

    it("404 on cross-KB diff", async () => {
      prisma.wikiDiff.findUnique.mockResolvedValue({
        id: "d1",
        knowledgeBaseId: "kb-OTHER",
        status: WikiDiffStatus.PENDING,
      });
      await expect(service.dismissDiff("user-1", "kb-1", "d1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("409 on already-applied diff", async () => {
      prisma.wikiDiff.findUnique.mockResolvedValue({
        id: "d1",
        knowledgeBaseId: "kb-1",
        status: WikiDiffStatus.APPLIED,
      });
      await expect(service.dismissDiff("user-1", "kb-1", "d1")).rejects.toThrow(
        ConflictException,
      );
    });

    it("requires wikiEnabled=true for write access", async () => {
      prisma.knowledgeBase.findUnique.mockResolvedValue({ wikiEnabled: false });
      prisma.wikiDiff.findUnique.mockResolvedValue({
        id: "d1",
        knowledgeBaseId: "kb-1",
        status: WikiDiffStatus.PENDING,
      });
      await expect(service.dismissDiff("user-1", "kb-1", "d1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("dismisses a PENDING diff", async () => {
      prisma.wikiDiff.findUnique.mockResolvedValue({
        id: "d1",
        knowledgeBaseId: "kb-1",
        status: WikiDiffStatus.PENDING,
      });
      await service.dismissDiff("user-1", "kb-1", "d1");
      expect(prisma.wikiDiff.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "d1" },
          data: expect.objectContaining({ status: WikiDiffStatus.DISMISSED }),
        }),
      );
    });
  });

  describe("applyDiff zod / collision / no-op paths", () => {
    beforeEach(() => {
      prisma.knowledgeBase.findUnique.mockResolvedValue({ wikiEnabled: true });
    });

    it("rejects with 403 when items fail schema validation (illegal slug)", async () => {
      prisma.wikiDiff.findUnique.mockResolvedValue({
        id: "d1",
        knowledgeBaseId: "kb-1",
        status: WikiDiffStatus.PENDING,
        baselineHash: "h",
        items: {
          creates: [
            {
              slug: "INVALID UPPERCASE",
              locale: "zh",
              title: "x",
              category: "ENTITY",
              body: "x",
              oneLiner: "y",
              sources: [],
            },
          ],
          updates: [],
          deletes: [],
        },
      });
      await expect(service.applyDiff("user-1", "kb-1", "d1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("returns APPLIED no-op when no items match selection", async () => {
      prisma.wikiDiff.findUnique.mockResolvedValue({
        id: "d1",
        knowledgeBaseId: "kb-1",
        status: WikiDiffStatus.PENDING,
        baselineHash: "h",
        items: {
          creates: [
            {
              slug: "page-a",
              locale: "zh",
              title: "A",
              category: "ENTITY",
              body: "x",
              oneLiner: "y",
              sources: [],
            },
          ],
          updates: [],
          deletes: [],
        },
      });
      const result = await service.applyDiff("user-1", "kb-1", "d1", [
        "nonexistent-slug",
      ]);
      expect(result.status).toBe(WikiDiffStatus.APPLIED);
      // Did NOT enter the transaction (no $transaction call needed for no-op)
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("409 on slug collision with another PENDING diff (live recompute, NOT DB column)", async () => {
      prisma.wikiDiff.findUnique.mockResolvedValue({
        id: "d1",
        knowledgeBaseId: "kb-1",
        status: WikiDiffStatus.PENDING,
        baselineHash: "h",
        items: {
          creates: [
            {
              slug: "shared-slug",
              locale: "zh",
              title: "T",
              category: "CONCEPT",
              body: "x",
              oneLiner: "y",
              sources: [],
            },
          ],
          updates: [],
          deletes: [],
        },
      });
      prisma.wikiDiff.findMany.mockResolvedValue([
        {
          id: "d2",
          // affectedKeys DB column is intentionally empty → must be ignored
          // and recomputed from items
          items: {
            creates: [],
            updates: [
              {
                slug: "shared-slug",
                locale: "zh",
                newBody: "z",
              },
            ],
            deletes: [],
          },
        },
      ]);
      await expect(service.applyDiff("user-1", "kb-1", "d1")).rejects.toThrow(
        ConflictException,
      );
    });

    // ─── P3 BLOCKER C2 (2026-05-12 multi-pass-and-locale consensus) ───
    //
    // Three regression locks for the affectedSlugs → affectedKeys
    // (slug:locale) rename. Without these, a future refactor could
    // re-introduce the pure-slug collision set or the slug-only FOR UPDATE
    // and reopen the cross-locale false-collide / false-lock bug.

    it("BLOCKER C2: zh and en diff on SAME slug do NOT collide (affectedKeys disjoint)", async () => {
      // Two PENDING diffs both touching `auth` but at different locales —
      // their (slug, locale) keys are disjoint sets so the collision check
      // must NOT throw, and the apply transaction must enter.
      const baselineHash = crypto
        .createHash("sha256")
        .update(JSON.stringify([]), "utf8")
        .digest("hex");
      prisma.wikiDiff.findUnique.mockResolvedValue({
        id: "d-zh",
        knowledgeBaseId: "kb-1",
        status: WikiDiffStatus.PENDING,
        baselineHash,
        items: {
          creates: [
            {
              slug: "auth",
              locale: "zh",
              title: "Auth (zh)",
              category: "CONCEPT",
              body: "中文内容",
              oneLiner: "认证",
              sources: [],
            },
          ],
          updates: [],
          deletes: [],
        },
      });
      prisma.wikiDiff.findMany.mockResolvedValue([
        {
          id: "d-en",
          items: {
            creates: [
              {
                slug: "auth",
                locale: "en",
                title: "Auth (en)",
                category: "CONCEPT",
                body: "English body",
                oneLiner: "Authentication",
                sources: [],
              },
            ],
            updates: [],
            deletes: [],
          },
        },
      ]);
      tx.wikiPage.upsert.mockResolvedValue({
        id: "page-auth-zh",
        slug: "auth",
        locale: "zh",
      });
      tx.$queryRaw.mockResolvedValue([]);

      await service.applyDiff("user-1", "kb-1", "d-zh");

      // Apply transaction MUST enter — no collision.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("BLOCKER C2: FOR UPDATE row-value targets (slug, locale) pairs, not slug alone", async () => {
      // Capture the FOR UPDATE query and assert the row-value clause names
      // both `slug` AND `locale` — the older code locked by slug alone and
      // would over-block other locales of the same slug under the
      // locale-aware unique constraint.
      const baselineHash = crypto
        .createHash("sha256")
        .update(JSON.stringify([]), "utf8")
        .digest("hex");
      prisma.wikiDiff.findUnique.mockResolvedValue({
        id: "d1",
        knowledgeBaseId: "kb-1",
        status: WikiDiffStatus.PENDING,
        baselineHash,
        items: {
          creates: [
            {
              slug: "auth",
              locale: "en",
              title: "Auth",
              category: "CONCEPT",
              body: "x",
              oneLiner: "y",
              sources: [],
            },
          ],
          updates: [],
          deletes: ["legacy-page"],
        },
      });
      prisma.wikiDiff.findMany.mockResolvedValue([]);
      tx.wikiPage.upsert.mockResolvedValue({
        id: "page-auth-en",
        slug: "auth",
        locale: "en",
      });
      tx.wikiPage.findMany.mockResolvedValue([]);
      tx.$queryRaw.mockResolvedValue([]);

      await service.applyDiff("user-1", "kb-1", "d1");

      // First $queryRaw call inside tx is the FOR UPDATE acquisition.
      expect(tx.$queryRaw).toHaveBeenCalled();
      const queryText = tx.$queryRaw.mock.calls[0][0].join("");
      expect(queryText).toContain("FOR UPDATE");
      // The query must use a `(slug, locale)` row-value, not a slug-only
      // ANY array predicate.
      expect(queryText).toContain(`"slug"`);
      expect(queryText).toContain(`"locale"`);
      expect(queryText).not.toContain(`AND "slug" = ANY(`);
    });

    it("BLOCKER C2: legacy PENDING diff with no locale fields persists as `slug:zh` keys (zod default fallback)", async () => {
      // Simulates a pre-P3 PENDING diff whose items.creates/items.updates
      // lack `locale`. zod schema `.default('zh')` fills the field at
      // parse time so the diff still applies, and the FOR UPDATE locks
      // resolve to (slug, 'zh') pairs — matching the migration backfill
      // that maps every legacy `affected_slugs` entry to `<slug>:zh`.
      const baselineHash = crypto
        .createHash("sha256")
        .update(JSON.stringify([]), "utf8")
        .digest("hex");
      prisma.wikiDiff.findUnique.mockResolvedValue({
        id: "legacy",
        knowledgeBaseId: "kb-1",
        status: WikiDiffStatus.PENDING,
        baselineHash,
        items: {
          creates: [
            {
              slug: "legacy-create",
              // NO `locale` field — pre-P3 shape
              title: "Legacy",
              category: "CONCEPT",
              body: "Legacy body",
              oneLiner: "Legacy oneLiner",
              sources: [],
            },
          ],
          updates: [],
          deletes: ["legacy-delete"],
        },
      });
      prisma.wikiDiff.findMany.mockResolvedValue([]);
      tx.wikiPage.upsert.mockResolvedValue({
        id: "page-legacy-create",
        slug: "legacy-create",
        locale: "zh",
      });
      tx.wikiPage.findMany.mockResolvedValue([]);
      tx.$queryRaw.mockResolvedValue([]);

      await service.applyDiff("user-1", "kb-1", "legacy");

      // FOR UPDATE query should contain ('legacy-create', 'zh') and
      // ('legacy-delete', 'zh') row values (deletes default to zh per
      // DEFAULT_WIKI_LOCALE in wiki-diff.service.ts makeAffectedKey).
      // Prisma.join wraps the (slug, locale) row-values in a nested
      // Prisma.sql object — flatten the values array so we can search
      // for the literals regardless of the join-output structure.
      const queryArgs = tx.$queryRaw.mock.calls[0];
      const allValues: unknown[] = [];
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) {
          v.forEach(walk);
          return;
        }
        if (
          v &&
          typeof v === "object" &&
          "values" in (v as Record<string, unknown>)
        ) {
          walk((v as { values: unknown }).values);
          return;
        }
        allValues.push(v);
      };
      walk(queryArgs);
      expect(allValues).toEqual(expect.arrayContaining(["legacy-create"]));
      expect(allValues).toEqual(expect.arrayContaining(["legacy-delete"]));
      // Both the create-side and delete-side keys default to 'zh' through
      // the zod default ('creates') and the DEFAULT_WIKI_LOCALE fallback
      // for slug-only deletes.
      expect(allValues.filter((v) => v === "zh").length).toBeGreaterThanOrEqual(
        2,
      );
    });

    it("404 when diff is in a different KB (IDOR)", async () => {
      prisma.wikiDiff.findUnique.mockResolvedValue({
        id: "d1",
        knowledgeBaseId: "kb-OTHER",
        status: WikiDiffStatus.PENDING,
        baselineHash: "h",
        items: { creates: [], updates: [], deletes: [] },
      });
      await expect(service.applyDiff("user-1", "kb-1", "d1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("refreshes document coverage from current wiki sources after apply", async () => {
      const baselineHash = crypto
        .createHash("sha256")
        .update(JSON.stringify([]), "utf8")
        .digest("hex");

      prisma.wikiDiff.findUnique.mockResolvedValue({
        id: "d1",
        knowledgeBaseId: "kb-1",
        status: WikiDiffStatus.PENDING,
        baselineHash,
        items: {
          creates: [
            {
              slug: "page-a",
              locale: "zh",
              title: "A",
              category: "ENTITY",
              body: "Body text",
              oneLiner: "Line",
              sources: [
                {
                  documentId: "doc-1",
                  spanStart: 0,
                  spanEnd: 8,
                  quote: "Body",
                },
              ],
            },
          ],
          updates: [],
          deletes: [],
        },
      });
      tx.wikiPage.upsert.mockResolvedValue({
        id: "page-1",
        slug: "page-a",
        locale: "zh",
        body: "Body text",
      });
      tx.$queryRaw
        .mockResolvedValueOnce([]) // FOR UPDATE
        .mockResolvedValueOnce([
          {
            documentId: "doc-1",
            lastCoveredDocumentUpdatedAt: new Date("2026-05-10T10:00:00.000Z"),
          },
        ]); // coverage refresh query
      tx.wikiDiff.update.mockResolvedValueOnce({
        id: "diff-applied-xyz",
        knowledgeBaseId: "kb-1",
        status: WikiDiffStatus.APPLIED,
        appliedAt: new Date("2026-05-10T10:05:00.000Z"),
      });

      await service.applyDiff("user-1", "kb-1", "d1");

      expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
      expect(tx.$executeRaw.mock.calls[0][0].join("")).toContain(
        "INSERT INTO wiki_document_coverages",
      );
      expect(tx.$executeRaw.mock.calls[0]).toEqual(
        expect.arrayContaining(["diff-applied-xyz"]),
      );
      expect(tx.$executeRaw.mock.calls[1][0].join("")).toContain(
        "DELETE FROM wiki_document_coverages",
      );
    });

    it("P3 BLOCKER C6: legacy PENDING items without locale field upsert at locale='zh' via zod default", async () => {
      // A diff persisted before P3 has items.creates[].locale absent.
      // applyDiff MUST NOT reject — zod schema .default('zh') fills the
      // missing field at parse time, then the upsert uses the
      // (kb, slug, locale='zh') composite key. This guards in-flight
      // upgrades from bricking pre-existing PENDING rows.
      const baselineHash = crypto
        .createHash("sha256")
        .update(JSON.stringify([]), "utf8")
        .digest("hex");

      prisma.wikiDiff.findUnique.mockResolvedValue({
        id: "legacy-pending",
        knowledgeBaseId: "kb-1",
        status: WikiDiffStatus.PENDING,
        baselineHash,
        items: {
          creates: [
            {
              slug: "legacy-page",
              // NO `locale` field — pre-P3 PENDING shape
              title: "Legacy",
              category: "CONCEPT",
              body: "Legacy body",
              oneLiner: "Legacy oneLiner",
              sources: [],
            },
          ],
          updates: [],
          deletes: [],
        },
      });
      tx.wikiPage.upsert.mockResolvedValue({
        id: "page-legacy",
        slug: "legacy-page",
        locale: "zh",
        body: "Legacy body",
      });

      await service.applyDiff("user-1", "kb-1", "legacy-pending");

      // Both the where clause and the create payload must specify 'zh'
      // — confirming zod default flowed through to the Prisma call.
      expect(tx.wikiPage.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            knowledgeBaseId_slug_locale: expect.objectContaining({
              locale: "zh",
            }),
          }),
          create: expect.objectContaining({ locale: "zh" }),
        }),
      );
    });
  });

  // ─── supersedeConflictingDiffs newer-wins (6e0457e81) ───
  //
  // The feat added an opt-in newer-wins escape hatch for the 409 collision
  // path: when the caller (frontend confirm) sets supersedeConflictingDiffs=
  // true, conflicting PENDING diffs are DISMISSED inside the apply
  // transaction instead of blocking with a 409. Without the option, the
  // existing 409 behavior is preserved (already covered above).
  describe("supersedeConflictingDiffs newer-wins (6e0457e81)", () => {
    function pendingDiffWithSharedSlug(diffId: string) {
      const baselineHash = crypto
        .createHash("sha256")
        .update(JSON.stringify([]), "utf8")
        .digest("hex");
      return {
        id: diffId,
        knowledgeBaseId: "kb-1",
        status: WikiDiffStatus.PENDING,
        baselineHash,
        items: {
          creates: [
            {
              slug: "shared-slug",
              locale: "zh",
              title: "T",
              category: "CONCEPT",
              body: "x",
              oneLiner: "y",
              sources: [],
            },
          ],
          updates: [],
          deletes: [],
        },
      };
    }

    function conflictingPending(otherId: string) {
      return {
        id: otherId,
        items: {
          creates: [],
          updates: [{ slug: "shared-slug", locale: "zh", newBody: "z" }],
          deletes: [],
        },
        itemsUri: null,
      };
    }

    beforeEach(() => {
      prisma.knowledgeBase.findUnique.mockResolvedValue({ wikiEnabled: true });
      // Apply flow needs tx.wikiDiff.updateMany available — the supersede path
      // calls it inside the transaction.
      tx.wikiDiff.updateMany = jest.fn().mockResolvedValue({ count: 0 });
      // Default-empty FOR UPDATE → empty pages → baselineHash matches the
      // empty-state hash baked into the diff fixture.
      tx.$queryRaw.mockResolvedValue([]);
      tx.wikiPage.upsert.mockResolvedValue({
        id: "page-1",
        slug: "shared-slug",
        body: "x",
      });
    });

    it("default (no supersede option) + conflicting PENDING → still throws 409 (regression guard for unchanged behavior)", async () => {
      // Arrange
      prisma.wikiDiff.findUnique.mockResolvedValue(
        pendingDiffWithSharedSlug("d1"),
      );
      prisma.wikiDiff.findMany.mockResolvedValue([conflictingPending("d2")]);
      // Act + Assert — without options.supersedeConflictingDiffs=true the
      // collision branch still throws.
      await expect(service.applyDiff("user-1", "kb-1", "d1")).rejects.toThrow(
        ConflictException,
      );
      // Apply transaction is NOT entered when collision throws.
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.wikiDiff.updateMany).not.toHaveBeenCalled();
    });

    it("supersedeConflictingDiffs=true + conflicting PENDING → DISMISSes the conflict inside the apply transaction (no 409)", async () => {
      // Arrange
      prisma.wikiDiff.findUnique.mockResolvedValue(
        pendingDiffWithSharedSlug("d1"),
      );
      prisma.wikiDiff.findMany.mockResolvedValue([conflictingPending("d2")]);
      // Act — newer-wins escape hatch flips conflict from blocker to override.
      await service.applyDiff("user-1", "kb-1", "d1", undefined, {
        supersedeConflictingDiffs: true,
      });
      // Assert — supersede ran inside the transaction:
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(tx.wikiDiff.updateMany).toHaveBeenCalledTimes(1);
      const args = tx.wikiDiff.updateMany.mock.calls[0][0];
      // Targets ONLY the conflicting PENDING diff id(s):
      expect(args.where).toEqual(
        expect.objectContaining({
          id: { in: ["d2"] },
          status: WikiDiffStatus.PENDING,
        }),
      );
      // Marks them DISMISSED + stamps dismissedAt:
      expect(args.data.status).toBe(WikiDiffStatus.DISMISSED);
      expect(args.data.dismissedAt).toBeInstanceOf(Date);
    });

    it("supersedeConflictingDiffs=true + NO conflicting PENDING → does NOT call wikiDiff.updateMany inside tx (supersedeIds collection is empty)", async () => {
      // Arrange — no other pending diffs at all.
      prisma.wikiDiff.findUnique.mockResolvedValue(
        pendingDiffWithSharedSlug("d1"),
      );
      prisma.wikiDiff.findMany.mockResolvedValue([]);
      // Act
      await service.applyDiff("user-1", "kb-1", "d1", undefined, {
        supersedeConflictingDiffs: true,
      });
      // Assert — option set but nothing to supersede → no updateMany call.
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(tx.wikiDiff.updateMany).not.toHaveBeenCalled();
    });

    it("supersedeConflictingDiffs=true + MULTIPLE conflicting PENDING → all conflicting ids are DISMISSED in one updateMany", async () => {
      // Arrange — two other pending diffs both touch shared-slug.
      prisma.wikiDiff.findUnique.mockResolvedValue(
        pendingDiffWithSharedSlug("d1"),
      );
      prisma.wikiDiff.findMany.mockResolvedValue([
        conflictingPending("d2"),
        conflictingPending("d3"),
      ]);
      // Act
      await service.applyDiff("user-1", "kb-1", "d1", undefined, {
        supersedeConflictingDiffs: true,
      });
      // Assert — single updateMany, both ids in the IN list.
      expect(tx.wikiDiff.updateMany).toHaveBeenCalledTimes(1);
      const args = tx.wikiDiff.updateMany.mock.calls[0][0];
      expect(args.where.id.in).toEqual(expect.arrayContaining(["d2", "d3"]));
      expect(args.where.id.in).toHaveLength(2);
      expect(args.data.status).toBe(WikiDiffStatus.DISMISSED);
    });
  });
});
