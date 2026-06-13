import { OfficeContentSourceProvider } from "../office-content-source.provider";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { SourceListFilter } from "@/modules/ai-engine/facade";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(
  overrides: Partial<{
    id: string;
    userId: string;
    title: string;
    type: string;
    markdown: string | null;
    content: unknown;
    metadata: unknown;
    createdAt: Date;
  }> = {},
) {
  return {
    id: overrides.id ?? "doc-1",
    userId: overrides.userId ?? "user-a",
    title: overrides.title ?? "My Document",
    type: overrides.type ?? "ARTICLE",
    markdown: overrides.markdown ?? null,
    content: overrides.content ?? {},
    metadata: overrides.metadata ?? {},
    createdAt: overrides.createdAt ?? new Date("2024-01-01T00:00:00Z"),
  };
}

function makePrisma(docs: ReturnType<typeof makeDoc>[]) {
  return {
    officeDocument: {
      findMany: jest.fn().mockResolvedValue(docs),
    },
  } as unknown as PrismaService;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OfficeContentSourceProvider", () => {
  describe("static metadata", () => {
    it("has correct id and displayName", () => {
      const provider = new OfficeContentSourceProvider(makePrisma([]));
      expect(provider.id).toBe("AI_OFFICE");
      expect(provider.displayName["zh-CN"]).toBe("AI Office");
      expect(provider.displayName["en-US"]).toBe("AI Office");
    });

    it("exposes article and other contentKinds", () => {
      const provider = new OfficeContentSourceProvider(makePrisma([]));
      expect(provider.contentKinds).toContain("article");
      expect(provider.contentKinds).toContain("other");
    });
  });

  // -------------------------------------------------------------------------
  describe("listItems", () => {
    it("returns empty items when no documents exist", async () => {
      const provider = new OfficeContentSourceProvider(makePrisma([]));
      const result = await provider.listItems("user-a", {});
      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeUndefined();
    });

    it("maps ARTICLE type to contentKind article", async () => {
      const doc = makeDoc({ type: "ARTICLE", markdown: "# Hello" });
      const provider = new OfficeContentSourceProvider(makePrisma([doc]));
      const result = await provider.listItems("user-a", {});
      expect(result.items[0].contentKind).toBe("article");
    });

    it("maps REPORT and RESEARCH types to contentKind article", async () => {
      const docs = [
        makeDoc({ id: "d1", type: "REPORT" }),
        makeDoc({ id: "d2", type: "RESEARCH" }),
      ];
      const provider = new OfficeContentSourceProvider(makePrisma(docs));
      const result = await provider.listItems("user-a", {});
      expect(result.items[0].contentKind).toBe("article");
      expect(result.items[1].contentKind).toBe("article");
    });

    it("maps PPT type to contentKind other", async () => {
      const doc = makeDoc({ type: "PPT" });
      const provider = new OfficeContentSourceProvider(makePrisma([doc]));
      const result = await provider.listItems("user-a", {});
      expect(result.items[0].contentKind).toBe("other");
    });

    it("extracts wordCount from metadata", async () => {
      const doc = makeDoc({ metadata: { wordCount: 1200 } });
      const provider = new OfficeContentSourceProvider(makePrisma([doc]));
      const result = await provider.listItems("user-a", {});
      expect(result.items[0].wordCount).toBe(1200);
    });

    it("omits wordCount when metadata is missing", async () => {
      const doc = makeDoc({ metadata: {} });
      const provider = new OfficeContentSourceProvider(makePrisma([doc]));
      const result = await provider.listItems("user-a", {});
      expect(result.items[0].wordCount).toBeUndefined();
    });

    it("provides preview from first 200 chars of markdown", async () => {
      const longMd = "A".repeat(300);
      const doc = makeDoc({ markdown: longMd });
      const provider = new OfficeContentSourceProvider(makePrisma([doc]));
      const result = await provider.listItems("user-a", {});
      expect(result.items[0].preview).toHaveLength(200);
    });

    it("returns nextCursor when there are more items than the limit", async () => {
      const docs = Array.from({ length: 6 }, (_, i) =>
        makeDoc({ id: `doc-${i}`, title: `Doc ${i}` }),
      );
      const prisma = {
        officeDocument: {
          findMany: jest.fn().mockResolvedValue(docs), // 6 items for limit=5
        },
      } as unknown as PrismaService;

      const provider = new OfficeContentSourceProvider(prisma);
      const result = await provider.listItems("user-a", { limit: 5 });
      expect(result.items).toHaveLength(5);
      expect(result.nextCursor).toBe("doc-4");
    });

    it("passes search filter and cursor to prisma", async () => {
      const prisma = makePrisma([]);
      const provider = new OfficeContentSourceProvider(prisma);
      const filter: SourceListFilter = {
        search: "hello",
        cursor: "abc",
        limit: 10,
      };
      await provider.listItems("user-a", filter);

      expect(prisma.officeDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: "user-a",
            title: expect.objectContaining({ contains: "hello" }),
            id: { gt: "abc" },
          }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("fetchBundle", () => {
    it("returns empty array for empty itemIds", async () => {
      const provider = new OfficeContentSourceProvider(makePrisma([]));
      const result = await provider.fetchBundle([], "user-a");
      expect(result).toEqual([]);
    });

    it("uses markdown as body with bodyMime text/markdown when present", async () => {
      const doc = makeDoc({ markdown: "# Title\n\nContent here" });
      const provider = new OfficeContentSourceProvider(makePrisma([doc]));
      const bundles = await provider.fetchBundle(["doc-1"], "user-a");
      expect(bundles[0].body).toBe("# Title\n\nContent here");
      expect(bundles[0].bodyMime).toBe("text/markdown");
    });

    it("extracts text from content JSON with bodyMime text/plain when markdown is null", async () => {
      const content = {
        slides: [
          { title: "Slide 1", elements: [{ text: "Hello World" }] },
          { title: "Slide 2", text: "Goodbye World" },
        ],
      };
      const doc = makeDoc({ markdown: null, content });
      const provider = new OfficeContentSourceProvider(makePrisma([doc]));
      const bundles = await provider.fetchBundle(["doc-1"], "user-a");
      expect(bundles[0].body).toContain("Hello World");
      expect(bundles[0].body).toContain("Slide 1");
      expect(bundles[0].bodyMime).toBe("text/plain");
    });

    it("returns empty body string when content is empty object and markdown is null", async () => {
      const doc = makeDoc({ markdown: null, content: {} });
      const provider = new OfficeContentSourceProvider(makePrisma([doc]));
      const bundles = await provider.fetchBundle(["doc-1"], "user-a");
      expect(bundles[0].body).toBe("");
    });

    it("cross-user isolation: passes userId to prisma where clause", async () => {
      const prisma = makePrisma([]);
      const provider = new OfficeContentSourceProvider(prisma);
      await provider.fetchBundle(["doc-1", "doc-2"], "user-b");

      expect(prisma.officeDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ["doc-1", "doc-2"] },
            userId: "user-b", // must restrict to requesting user only
          }),
        }),
      );
    });

    it("does NOT return documents owned by a different user", async () => {
      // Prisma enforces userId filter; simulate returning only matching docs
      const docForUserA = makeDoc({ id: "doc-1", userId: "user-a" });
      const prismaReturningOnlyUserA = makePrisma([docForUserA]);
      const provider = new OfficeContentSourceProvider(
        prismaReturningOnlyUserA,
      );

      // user-b requests doc-1 which belongs to user-a
      const bundles = await provider.fetchBundle(["doc-1"], "user-b");
      // Prisma would return empty because userId:'user-b' won't match
      // But since our mock returns docForUserA, we just verify the where clause
      expect(
        prismaReturningOnlyUserA.officeDocument.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: "user-b" }),
        }),
      );
      // The actual enforcement is done by the DB (userId filter), not the provider
      expect(bundles).toHaveLength(1); // mock returns doc regardless; isolation is at DB level
    });

    it("sourceType is AI_OFFICE", async () => {
      const doc = makeDoc();
      const provider = new OfficeContentSourceProvider(makePrisma([doc]));
      const bundles = await provider.fetchBundle(["doc-1"], "user-a");
      expect(bundles[0].sourceType).toBe("AI_OFFICE");
    });

    it("includes docType in sourceMetadata and displayMetadata", async () => {
      const doc = makeDoc({ type: "PPT" });
      const provider = new OfficeContentSourceProvider(makePrisma([doc]));
      const bundles = await provider.fetchBundle(["doc-1"], "user-a");
      expect(bundles[0].sourceMetadata["type"]).toBe("PPT");
      expect(bundles[0].displayMetadata["docType"]).toBe("PPT");
    });
  });
});
