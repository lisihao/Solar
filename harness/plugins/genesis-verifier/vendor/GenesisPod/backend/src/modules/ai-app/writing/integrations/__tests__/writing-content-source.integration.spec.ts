import { WritingContentSourceProvider } from "../writing-content-source.provider";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

const mockFindMany = jest.fn();
const mockPrisma = {
  writingChapter: { findMany: mockFindMany },
} as unknown as PrismaService;

const makeChapterListRow = (
  overrides: Partial<{
    id: string;
    title: string;
    content: string | null;
    wordCount: number;
    createdAt: Date;
  }> = {},
) => ({
  id: "ch-1",
  title: "Chapter One",
  content: "Some content here",
  wordCount: 3,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  ...overrides,
});

const makeChapterBundleRow = (
  overrides: Partial<{
    id: string;
    title: string;
    content: string | null;
    wordCount: number;
    createdAt: Date;
    chapterNumber: number;
    volume: { title: string; project: { name: string } };
  }> = {},
) => ({
  id: "ch-1",
  title: "Chapter One",
  content: "Body text",
  wordCount: 2,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  chapterNumber: 1,
  volume: { title: "Volume A", project: { name: "Project X" } },
  ...overrides,
});

describe("WritingContentSourceProvider — userId isolation (integration)", () => {
  let provider: WritingContentSourceProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new WritingContentSourceProvider(mockPrisma);
    mockFindMany.mockResolvedValue([]);
  });

  it("uses the real WritingContentSourceProvider class", () => {
    expect(provider).toBeInstanceOf(WritingContentSourceProvider);
    expect(provider.id).toBe("AI_WRITING");
  });

  describe("listItems", () => {
    it("passes userId into where.volume.project.ownerId", async () => {
      await provider.listItems("user-b", {});
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            volume: { project: { ownerId: "user-b" } },
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
      mockFindMany.mockResolvedValue([makeChapterListRow()]);
      const result = await provider.listItems("user-b", {});
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("ch-1");
      expect(result.items[0].createdAt).toBe("2024-01-01T00:00:00.000Z");
      expect(result.items[0].contentKind).toBe("article");
    });

    it("hasMore logic — slices result and sets nextCursor when extra row returned", async () => {
      const rows = Array.from({ length: 21 }, (_, i) =>
        makeChapterListRow({
          id: `ch-${i}`,
          createdAt: new Date(2024, 0, i + 1),
        }),
      );
      mockFindMany.mockResolvedValue(rows);
      const result = await provider.listItems("user-b", { limit: 20 });
      expect(result.items).toHaveLength(20);
      expect(result.nextCursor).toBe("ch-19");
    });
  });

  describe("fetchBundle", () => {
    it("passes userId and id filter in where", async () => {
      await provider.fetchBundle(["ch-1", "ch-2"], "user-b");
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ["ch-1", "ch-2"] },
            volume: { project: { ownerId: "user-b" } },
          }),
        }),
      );
    });

    it("does NOT leak user-a id when called with user-b", async () => {
      await provider.fetchBundle(["ch-1"], "user-b");
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
      mockFindMany.mockResolvedValue([makeChapterBundleRow()]);
      const bundles = await provider.fetchBundle(["ch-1"], "user-b");
      expect(bundles).toHaveLength(1);
      expect(bundles[0].sourceType).toBe("AI_WRITING");
      expect(bundles[0].sourceId).toBe("ch-1");
      expect(bundles[0].title).toBe("Chapter One");
      expect(bundles[0].bodyMime).toBe("text/plain");
      expect(bundles[0].sourceMetadata).toMatchObject({ chapterNumber: 1 });
    });
  });
});
