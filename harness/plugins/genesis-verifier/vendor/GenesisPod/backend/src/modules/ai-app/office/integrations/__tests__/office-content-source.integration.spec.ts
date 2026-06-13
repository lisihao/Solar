import { OfficeContentSourceProvider } from "../office-content-source.provider";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

const mockFindMany = jest.fn();
const mockPrisma = {
  officeDocument: { findMany: mockFindMany },
} as unknown as PrismaService;

const makeDocListRow = (
  overrides: Partial<{
    id: string;
    title: string;
    type: string;
    markdown: string | null;
    metadata: unknown;
    createdAt: Date;
  }> = {},
) => ({
  id: "doc-1",
  title: "My Report",
  type: "REPORT",
  markdown: "# Report",
  metadata: { wordCount: 100 },
  createdAt: new Date("2024-04-01T00:00:00Z"),
  ...overrides,
});

const makeDocBundleRow = (
  overrides: Partial<{
    id: string;
    title: string;
    type: string;
    markdown: string | null;
    content: unknown;
    metadata: unknown;
    createdAt: Date;
  }> = {},
) => ({
  id: "doc-1",
  title: "My Report",
  type: "REPORT",
  markdown: "# Report content",
  content: null,
  metadata: { wordCount: 100 },
  createdAt: new Date("2024-04-01T00:00:00Z"),
  ...overrides,
});

describe("OfficeContentSourceProvider — userId isolation (integration)", () => {
  let provider: OfficeContentSourceProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new OfficeContentSourceProvider(mockPrisma);
    mockFindMany.mockResolvedValue([]);
  });

  it("uses the real OfficeContentSourceProvider class", () => {
    expect(provider).toBeInstanceOf(OfficeContentSourceProvider);
    expect(provider.id).toBe("AI_OFFICE");
  });

  describe("listItems", () => {
    it("passes userId into where.userId", async () => {
      await provider.listItems("user-b", {});
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: "user-b" }),
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
      mockFindMany.mockResolvedValue([makeDocListRow()]);
      const result = await provider.listItems("user-b", {});
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("doc-1");
      expect(result.items[0].createdAt).toBe("2024-04-01T00:00:00.000Z");
      expect(result.items[0].contentKind).toBe("article");
    });

    it("hasMore logic — slices result and sets nextCursor when extra row returned", async () => {
      const rows = Array.from({ length: 21 }, (_, i) =>
        makeDocListRow({ id: `doc-${i}`, createdAt: new Date(2024, 0, i + 1) }),
      );
      mockFindMany.mockResolvedValue(rows);
      const result = await provider.listItems("user-b", { limit: 20 });
      expect(result.items).toHaveLength(20);
      expect(result.nextCursor).toBe("doc-19");
    });
  });

  describe("fetchBundle", () => {
    it("passes userId and id filter in where", async () => {
      await provider.fetchBundle(["doc-1", "doc-2"], "user-b");
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ["doc-1", "doc-2"] },
            userId: "user-b",
          }),
        }),
      );
    });

    it("does NOT leak user-a id when called with user-b", async () => {
      await provider.fetchBundle(["doc-1"], "user-b");
      const callArg = mockFindMany.mock.calls[0][0] as { where: unknown };
      expect(JSON.stringify(callArg.where)).toContain("user-b");
      expect(JSON.stringify(callArg.where)).not.toContain("user-a");
    });

    it("short-circuits without DB call for empty itemIds", async () => {
      const bundles = await provider.fetchBundle([], "user-b");
      expect(bundles).toEqual([]);
      expect(mockFindMany).not.toHaveBeenCalled();
    });

    it("maps rows to SourceContentBundle using markdown as body", async () => {
      mockFindMany.mockResolvedValue([makeDocBundleRow()]);
      const bundles = await provider.fetchBundle(["doc-1"], "user-b");
      expect(bundles).toHaveLength(1);
      expect(bundles[0].sourceType).toBe("AI_OFFICE");
      expect(bundles[0].sourceId).toBe("doc-1");
      expect(bundles[0].body).toBe("# Report content");
      expect(bundles[0].bodyMime).toBe("text/markdown");
    });
  });
});
