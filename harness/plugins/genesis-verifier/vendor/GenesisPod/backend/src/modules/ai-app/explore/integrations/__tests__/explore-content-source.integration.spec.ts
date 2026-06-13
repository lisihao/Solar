import { ExploreContentSourceProvider } from "../explore-content-source.provider";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

const mockFindMany = jest.fn();
const mockPrisma = {
  resource: { findMany: mockFindMany },
} as unknown as PrismaService;

const makeResourceListRow = (
  overrides: Partial<{
    id: string;
    type: string;
    title: string;
    abstract: string | null;
    thumbnailUrl: string | null;
    tags: unknown;
    createdAt: Date;
  }> = {},
) => ({
  id: "res-1",
  type: "ARTICLE",
  title: "Great Article",
  abstract: "A short preview",
  thumbnailUrl: null,
  tags: [],
  createdAt: new Date("2024-03-01T00:00:00Z"),
  ...overrides,
});

const makeResourceBundleRow = (
  overrides: Partial<{
    id: string;
    type: string;
    title: string;
    abstract: string | null;
    content: string | null;
    sourceUrl: string | null;
    thumbnailUrl: string | null;
    tags: unknown;
    createdAt: Date;
  }> = {},
) => ({
  id: "res-1",
  type: "ARTICLE",
  title: "Great Article",
  abstract: "A short preview",
  content: "Full article body",
  sourceUrl: "https://example.com",
  thumbnailUrl: null,
  tags: [],
  createdAt: new Date("2024-03-01T00:00:00Z"),
  ...overrides,
});

describe("ExploreContentSourceProvider — userId isolation (integration)", () => {
  let provider: ExploreContentSourceProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new ExploreContentSourceProvider(mockPrisma);
    mockFindMany.mockResolvedValue([]);
  });

  it("uses the real ExploreContentSourceProvider class", () => {
    expect(provider).toBeInstanceOf(ExploreContentSourceProvider);
    expect(provider.id).toBe("AI_EXPLORE");
  });

  describe("listItems", () => {
    it("passes userId into collectionItems.some.collection.userId", async () => {
      await provider.listItems("user-b", {});
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            collectionItems: { some: { collection: { userId: "user-b" } } },
          }),
        }),
      );
    });

    it("does NOT contain user-a id when called with user-b", async () => {
      await provider.listItems("user-b", {});
      const callArg = mockFindMany.mock.calls[0][0] as { where: unknown };
      expect(JSON.stringify(callArg.where)).toContain("user-b");
      expect(JSON.stringify(callArg.where)).not.toContain("user-a");
    });

    it("maps rows to SourceItem with toISOString()", async () => {
      mockFindMany.mockResolvedValue([makeResourceListRow()]);
      const result = await provider.listItems("user-b", {});
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("res-1");
      expect(result.items[0].createdAt).toBe("2024-03-01T00:00:00.000Z");
      expect(result.items[0].contentKind).toBe("article");
    });

    it("hasMore logic — slices result and sets nextCursor when extra row returned", async () => {
      const rows = Array.from({ length: 21 }, (_, i) =>
        makeResourceListRow({
          id: `res-${i}`,
          createdAt: new Date(2024, 0, i + 1),
        }),
      );
      mockFindMany.mockResolvedValue(rows);
      const result = await provider.listItems("user-b", { limit: 20 });
      expect(result.items).toHaveLength(20);
      expect(result.nextCursor).toBe("res-19");
    });
  });

  describe("fetchBundle", () => {
    it("passes userId via collectionItems.some.collection.userId and id filter", async () => {
      await provider.fetchBundle(["res-1", "res-2"], "user-b");
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ["res-1", "res-2"] },
            collectionItems: { some: { collection: { userId: "user-b" } } },
          }),
        }),
      );
    });

    it("does NOT leak user-a id when called with user-b", async () => {
      await provider.fetchBundle(["res-1"], "user-b");
      const callArg = mockFindMany.mock.calls[0][0] as { where: unknown };
      expect(JSON.stringify(callArg.where)).toContain("user-b");
      expect(JSON.stringify(callArg.where)).not.toContain("user-a");
    });

    it("short-circuits without DB call for empty itemIds", async () => {
      const bundles = await provider.fetchBundle([], "user-b");
      expect(bundles).toEqual([]);
      expect(mockFindMany).not.toHaveBeenCalled();
    });

    it("maps rows to SourceContentBundle correctly", async () => {
      mockFindMany.mockResolvedValue([makeResourceBundleRow()]);
      const bundles = await provider.fetchBundle(["res-1"], "user-b");
      expect(bundles).toHaveLength(1);
      expect(bundles[0].sourceType).toBe("AI_EXPLORE");
      expect(bundles[0].sourceId).toBe("res-1");
      expect(bundles[0].body).toBe("Full article body");
      expect(bundles[0].bodyMime).toBe("text/plain");
    });
  });
});
