import { Test, TestingModule } from "@nestjs/testing";
import { WritingContentSourceProvider } from "../writing-content-source.provider";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const USER_A = "user-a";
const USER_B = "user-b";

const makeChapter = (
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
  content: "Once upon a time in a land far away",
  wordCount: 8,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  chapterNumber: 1,
  volume: { title: "Volume I", project: { name: "My Novel" } },
  ...overrides,
});

// ---------------------------------------------------------------------------
// Mock PrismaService
// ---------------------------------------------------------------------------

let mockFindMany: jest.Mock;

const buildPrisma = () => {
  mockFindMany = jest.fn();
  return {
    writingChapter: {
      findMany: mockFindMany,
    },
  };
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("WritingContentSourceProvider", () => {
  let provider: WritingContentSourceProvider;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WritingContentSourceProvider,
        { provide: PrismaService, useValue: buildPrisma() },
      ],
    }).compile();

    provider = module.get(WritingContentSourceProvider);
  });

  // -------------------------------------------------------------------------
  // Descriptor fields
  // -------------------------------------------------------------------------

  it("should expose correct descriptor fields", () => {
    expect(provider.id).toBe("AI_WRITING");
    expect(provider.displayName["zh-CN"]).toBe("AI 写作");
    expect(provider.displayName["en-US"]).toBe("AI Writing");
    expect(provider.icon).toBe("PenLine");
    expect(provider.contentKinds).toContain("article");
    expect(provider.maxItemsPerTask).toBe(10);
  });

  // -------------------------------------------------------------------------
  // listItems — basic field mapping
  // -------------------------------------------------------------------------

  it("listItems: returns correctly mapped SourceItem fields", async () => {
    mockFindMany.mockResolvedValueOnce([makeChapter()]);

    const result = await provider.listItems(USER_A, {});

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.id).toBe("ch-1");
    expect(item.title).toBe("Chapter One");
    expect(item.contentKind).toBe("article");
    expect(item.wordCount).toBe(8);
    expect(item.createdAt).toBe("2024-01-01T00:00:00.000Z");
    expect(item.preview).toBe("Once upon a time in a land far away");
  });

  // -------------------------------------------------------------------------
  // listItems — userId isolation
  // -------------------------------------------------------------------------

  it("listItems: passes ownerId filter so user B sees no data from user A", async () => {
    // User A has data; user B query returns empty (prisma enforces userId filter)
    mockFindMany.mockResolvedValueOnce([]);

    const result = await provider.listItems(USER_B, {});

    expect(result.items).toHaveLength(0);

    // Verify the where clause contains userId isolation
    const callArgs = mockFindMany.mock.calls[0][0];
    expect(callArgs.where.volume.project.ownerId).toBe(USER_B);
  });

  // -------------------------------------------------------------------------
  // listItems — search by title
  // -------------------------------------------------------------------------

  it("listItems: applies title contains filter when search is provided", async () => {
    mockFindMany.mockResolvedValueOnce([
      makeChapter({ title: "The Dragon Chapter" }),
    ]);

    await provider.listItems(USER_A, { search: "Dragon" });

    const callArgs = mockFindMany.mock.calls[0][0];
    expect(callArgs.where.title).toEqual({
      contains: "Dragon",
      mode: "insensitive",
    });
  });

  it("listItems: omits title filter when search is not provided", async () => {
    mockFindMany.mockResolvedValueOnce([]);

    await provider.listItems(USER_A, {});

    const callArgs = mockFindMany.mock.calls[0][0];
    expect(callArgs.where.title).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // listItems — cursor pagination
  // -------------------------------------------------------------------------

  it("listItems: returns nextCursor when more items exist", async () => {
    // limit=2, return 3 items → hasMore
    const chapters = [
      makeChapter({ id: "ch-1" }),
      makeChapter({ id: "ch-2", title: "Chapter Two" }),
      makeChapter({ id: "ch-3", title: "Chapter Three" }),
    ];
    mockFindMany.mockResolvedValueOnce(chapters);

    const result = await provider.listItems(USER_A, { limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBe("ch-2");
  });

  it("listItems: nextCursor is undefined when no more items", async () => {
    mockFindMany.mockResolvedValueOnce([makeChapter()]);

    const result = await provider.listItems(USER_A, { limit: 5 });

    expect(result.nextCursor).toBeUndefined();
  });

  it("listItems: passes cursor to where clause when provided", async () => {
    mockFindMany.mockResolvedValueOnce([]);

    await provider.listItems(USER_A, { cursor: "ch-99" });

    const callArgs = mockFindMany.mock.calls[0][0];
    expect(callArgs.where.id).toEqual({ gt: "ch-99" });
  });

  // -------------------------------------------------------------------------
  // fetchBundle — field mapping
  // -------------------------------------------------------------------------

  it("fetchBundle: returns correctly mapped SourceContentBundle", async () => {
    mockFindMany.mockResolvedValueOnce([makeChapter()]);

    const bundles = await provider.fetchBundle(["ch-1"], USER_A);

    expect(bundles).toHaveLength(1);
    const b = bundles[0];
    expect(b.sourceType).toBe("AI_WRITING");
    expect(b.sourceId).toBe("ch-1");
    expect(b.title).toBe("Chapter One");
    expect(b.body).toBe("Once upon a time in a land far away");
    expect(b.bodyMime).toBe("text/plain");
    expect(b.sourceMetadata).toMatchObject({
      wordCount: 8,
      chapterNumber: 1,
      volumeTitle: "Volume I",
      projectName: "My Novel",
    });
    expect(b.displayMetadata).toMatchObject({
      projectName: "My Novel",
      volumeTitle: "Volume I",
      chapterNumber: 1,
    });
  });

  // -------------------------------------------------------------------------
  // fetchBundle — cross-user isolation (P1-2 hard requirement)
  // -------------------------------------------------------------------------

  it("fetchBundle: cross-user isolation — user B gets empty array for user A items", async () => {
    // Prisma returns empty because ownerId filter excludes user A's data
    mockFindMany.mockResolvedValueOnce([]);

    const bundles = await provider.fetchBundle(["ch-1"], USER_B);

    expect(bundles).toHaveLength(0);

    // Verify userId isolation in the where clause
    const callArgs = mockFindMany.mock.calls[0][0];
    expect(callArgs.where.volume.project.ownerId).toBe(USER_B);
    expect(callArgs.where.id).toEqual({ in: ["ch-1"] });
  });

  // -------------------------------------------------------------------------
  // fetchBundle — non-existent ids are silently skipped
  // -------------------------------------------------------------------------

  it("fetchBundle: non-existent ids are skipped without error", async () => {
    mockFindMany.mockResolvedValueOnce([]);

    const bundles = await provider.fetchBundle(["does-not-exist"], USER_A);

    expect(bundles).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // fetchBundle — empty itemIds short-circuits
  // -------------------------------------------------------------------------

  it("fetchBundle: returns empty array immediately when itemIds is empty", async () => {
    const bundles = await provider.fetchBundle([], USER_A);

    expect(bundles).toHaveLength(0);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // fetchBundle — null content handled gracefully
  // -------------------------------------------------------------------------

  it("fetchBundle: null content maps to empty string body", async () => {
    mockFindMany.mockResolvedValueOnce([makeChapter({ content: null })]);

    const bundles = await provider.fetchBundle(["ch-1"], USER_A);

    expect(bundles[0].body).toBe("");
  });
});
