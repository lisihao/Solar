import { Test, TestingModule } from "@nestjs/testing";
import { ResourceType } from "@prisma/client";
import { ExploreContentSourceProvider } from "../explore-content-source.provider";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { RAGFacade } from "@/modules/ai-harness/facade";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_A = "user-a";
const USER_B = "user-b";

const makeResource = (
  overrides: Partial<{
    id: string;
    type: ResourceType;
    title: string;
    abstract: string | null;
    content: string | null;
    sourceUrl: string;
    thumbnailUrl: string | null;
    tags: string[];
    createdAt: Date;
  }> = {},
) => ({
  id: "res-1",
  type: ResourceType.BLOG,
  title: "Test Article",
  abstract: "A brief abstract about the article.",
  content: "Full article body text.",
  sourceUrl: "https://example.com/article",
  thumbnailUrl: null,
  tags: ["ai", "research"],
  createdAt: new Date("2024-03-01T00:00:00Z"),
  ...overrides,
});

const makeVideoResource = (
  overrides: Partial<ReturnType<typeof makeResource>> = {},
) =>
  makeResource({
    id: "res-video",
    type: ResourceType.YOUTUBE_VIDEO,
    title: "AI Research Video",
    abstract: "A video about AI research.",
    sourceUrl: "https://youtube.com/watch?v=abc123",
    thumbnailUrl: "https://img.youtube.com/vi/abc123/hqdefault.jpg",
    ...overrides,
  });

// ---------------------------------------------------------------------------
// Mock PrismaService
// ---------------------------------------------------------------------------

let mockFindMany: jest.Mock;

const buildPrisma = () => {
  mockFindMany = jest.fn();
  return {
    resource: {
      findMany: mockFindMany,
    },
  };
};

let mockExtractVideoId: jest.Mock;
let mockFetchYoutube: jest.Mock;

const buildRagFacade = () => {
  mockExtractVideoId = jest.fn().mockReturnValue("abc123");
  mockFetchYoutube = jest.fn().mockResolvedValue({ content: "" });
  return {
    contentFetch: {
      extractYoutubeVideoId: mockExtractVideoId,
      fetchFromYoutubeUrl: mockFetchYoutube,
    },
  };
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("ExploreContentSourceProvider", () => {
  let provider: ExploreContentSourceProvider;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExploreContentSourceProvider,
        { provide: PrismaService, useValue: buildPrisma() },
        { provide: RAGFacade, useValue: buildRagFacade() },
      ],
    }).compile();

    provider = module.get(ExploreContentSourceProvider);
  });

  // -------------------------------------------------------------------------
  // Descriptor fields
  // -------------------------------------------------------------------------

  it("should expose correct descriptor fields", () => {
    expect(provider.id).toBe("AI_EXPLORE");
    expect(provider.displayName["zh-CN"]).toBe("AI 探索");
    expect(provider.displayName["en-US"]).toBe("AI Explore");
    expect(provider.icon).toBe("Compass");
    expect(provider.contentKinds).toContain("article");
    expect(provider.contentKinds).toContain("video");
    expect(provider.maxItemsPerTask).toBe(10);
  });

  // -------------------------------------------------------------------------
  // listItems — article mapping
  // -------------------------------------------------------------------------

  it('listItems: maps BLOG resource to contentKind "article"', async () => {
    mockFindMany.mockResolvedValueOnce([makeResource()]);

    const result = await provider.listItems(USER_A, {});

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.id).toBe("res-1");
    expect(item.title).toBe("Test Article");
    expect(item.contentKind).toBe("article");
    expect(item.preview).toBe("A brief abstract about the article.");
    expect(item.createdAt).toBe("2024-03-01T00:00:00.000Z");
  });

  // -------------------------------------------------------------------------
  // listItems — video mapping
  // -------------------------------------------------------------------------

  it('listItems: maps YOUTUBE_VIDEO resource to contentKind "video"', async () => {
    mockFindMany.mockResolvedValueOnce([makeVideoResource()]);

    const result = await provider.listItems(USER_A, {});

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.id).toBe("res-video");
    expect(item.contentKind).toBe("video");
    expect(item.thumbnailUrl).toBe(
      "https://img.youtube.com/vi/abc123/hqdefault.jpg",
    );
  });

  // -------------------------------------------------------------------------
  // listItems — mixed video + article
  // -------------------------------------------------------------------------

  it("listItems: returns mixed article and video items correctly", async () => {
    mockFindMany.mockResolvedValueOnce([
      makeResource({ id: "art-1" }),
      makeVideoResource({ id: "vid-1" }),
      makeResource({ id: "art-2", type: ResourceType.NEWS }),
    ]);

    const result = await provider.listItems(USER_A, {});

    expect(result.items).toHaveLength(3);
    expect(result.items[0].contentKind).toBe("article");
    expect(result.items[1].contentKind).toBe("video");
    expect(result.items[2].contentKind).toBe("article");
  });

  // -------------------------------------------------------------------------
  // listItems — search filter
  // -------------------------------------------------------------------------

  it("listItems: passes search filter as OR title/abstract contains", async () => {
    mockFindMany.mockResolvedValueOnce([]);

    await provider.listItems(USER_A, { search: "transformer" });

    const callArgs = mockFindMany.mock.calls[0][0];
    expect(callArgs.where.OR).toEqual([
      { title: { contains: "transformer", mode: "insensitive" } },
      { abstract: { contains: "transformer", mode: "insensitive" } },
    ]);
  });

  it("listItems: omits OR filter when search is not provided", async () => {
    mockFindMany.mockResolvedValueOnce([]);

    await provider.listItems(USER_A, {});

    const callArgs = mockFindMany.mock.calls[0][0];
    expect(callArgs.where.OR).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // listItems — cursor pagination
  // -------------------------------------------------------------------------

  it("listItems: returns nextCursor when more items exist", async () => {
    const resources = [
      makeResource({ id: "r-1" }),
      makeResource({ id: "r-2", title: "Item 2" }),
      makeResource({ id: "r-3", title: "Item 3" }),
    ];
    mockFindMany.mockResolvedValueOnce(resources);

    const result = await provider.listItems(USER_A, { limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBe("r-2");
  });

  it("listItems: nextCursor is undefined when no more items", async () => {
    mockFindMany.mockResolvedValueOnce([makeResource()]);

    const result = await provider.listItems(USER_A, { limit: 5 });

    expect(result.nextCursor).toBeUndefined();
  });

  it("listItems: passes cursor to where clause when provided", async () => {
    mockFindMany.mockResolvedValueOnce([]);

    await provider.listItems(USER_A, { cursor: "res-99" });

    const callArgs = mockFindMany.mock.calls[0][0];
    expect(callArgs.where.id).toEqual({ gt: "res-99" });
  });

  // -------------------------------------------------------------------------
  // Cross-user isolation
  // Resource has no direct userId, but every visible resource MUST live in
  // at least one collection owned by the requesting user
  // (collectionItems.some.collection.userId === callerUserId). This is the
  // single contract that prevents cross-user data leak via Explore.
  // -------------------------------------------------------------------------

  it("cross-user isolation: listItems applies caller userId to collectionItems.some.collection.userId", async () => {
    mockFindMany.mockResolvedValueOnce([]);

    await provider.listItems(USER_B, {});

    const callArgs = mockFindMany.mock.calls[0][0];
    expect(callArgs.where.collectionItems).toEqual({
      some: { collection: { userId: USER_B } },
    });
  });

  it("cross-user isolation: fetchBundle filters by caller userId via collection ownership", async () => {
    mockFindMany.mockResolvedValueOnce([]);

    const bundles = await provider.fetchBundle(["res-1"], USER_B);

    expect(bundles).toHaveLength(0);
    const callArgs = mockFindMany.mock.calls[0][0];
    expect(callArgs.where).toEqual({
      id: { in: ["res-1"] },
      collectionItems: { some: { collection: { userId: USER_B } } },
    });
  });

  // -------------------------------------------------------------------------
  // fetchBundle — field mapping
  // -------------------------------------------------------------------------

  it("fetchBundle: maps article resource to correct SourceContentBundle", async () => {
    mockFindMany.mockResolvedValueOnce([makeResource()]);

    const bundles = await provider.fetchBundle(["res-1"], USER_A);

    expect(bundles).toHaveLength(1);
    const b = bundles[0];
    expect(b.sourceType).toBe("AI_EXPLORE");
    expect(b.sourceId).toBe("res-1");
    expect(b.title).toBe("Test Article");
    expect(b.body).toBe("Full article body text.");
    expect(b.bodyMime).toBe("text/plain");
    expect(b.sourceMetadata).toMatchObject({
      contentKind: "article",
      resourceType: ResourceType.BLOG,
      sourceUrl: "https://example.com/article",
    });
    expect(b.displayMetadata).toMatchObject({ contentKind: "article" });
  });

  it('fetchBundle: maps YOUTUBE_VIDEO to contentKind "video" in bundle', async () => {
    mockFindMany.mockResolvedValueOnce([makeVideoResource()]);

    const bundles = await provider.fetchBundle(["res-video"], USER_A);

    expect(bundles).toHaveLength(1);
    const b = bundles[0];
    expect(b.sourceMetadata).toMatchObject({ contentKind: "video" });
    expect(b.displayMetadata).toMatchObject({
      contentKind: "video",
      thumbnailUrl: "https://img.youtube.com/vi/abc123/hqdefault.jpg",
    });
  });

  // -------------------------------------------------------------------------
  // fetchBundle — 视频走字幕能力（修 stub 根因）
  // -------------------------------------------------------------------------

  it("fetchBundle: 视频资源用抓取的字幕脚本作 body（>100 字）", async () => {
    const transcript = "x".repeat(150);
    mockFindMany.mockResolvedValueOnce([makeVideoResource()]);
    mockExtractVideoId.mockReturnValueOnce("abc123");
    mockFetchYoutube.mockResolvedValueOnce({ content: transcript });

    const bundles = await provider.fetchBundle(["res-video"], USER_A);

    expect(mockFetchYoutube).toHaveBeenCalledWith(
      "abc123",
      "https://youtube.com/watch?v=abc123",
    );
    expect(bundles[0].body).toBe(transcript);
  });

  it("fetchBundle: 字幕太短时回退到 content", async () => {
    mockFindMany.mockResolvedValueOnce([
      makeVideoResource({ content: "fallback body" }),
    ]);
    mockFetchYoutube.mockResolvedValueOnce({ content: "short" });

    const bundles = await provider.fetchBundle(["res-video"], USER_A);

    expect(bundles[0].body).toBe("fallback body");
  });

  it("fetchBundle: 文章资源不触发字幕抓取", async () => {
    mockFindMany.mockResolvedValueOnce([makeResource()]);

    await provider.fetchBundle(["res-1"], USER_A);

    expect(mockFetchYoutube).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // fetchBundle — null/empty content graceful handling
  // -------------------------------------------------------------------------

  it("fetchBundle: falls back to abstract when content is null", async () => {
    mockFindMany.mockResolvedValueOnce([makeResource({ content: null })]);

    const bundles = await provider.fetchBundle(["res-1"], USER_A);

    expect(bundles[0].body).toBe("A brief abstract about the article.");
  });

  it("fetchBundle: returns empty string body when both content and abstract are null", async () => {
    mockFindMany.mockResolvedValueOnce([
      makeResource({ content: null, abstract: null }),
    ]);

    const bundles = await provider.fetchBundle(["res-1"], USER_A);

    expect(bundles[0].body).toBe("");
  });

  it("fetchBundle: returns empty array immediately when itemIds is empty", async () => {
    const bundles = await provider.fetchBundle([], USER_A);

    expect(bundles).toHaveLength(0);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("fetchBundle: non-existent ids return empty array without error", async () => {
    mockFindMany.mockResolvedValueOnce([]);

    const bundles = await provider.fetchBundle(["does-not-exist"], USER_A);

    expect(bundles).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // fetchBundle — mixed video + article batch
  // -------------------------------------------------------------------------

  it("fetchBundle: batch with mixed types maps each to correct contentKind", async () => {
    mockFindMany.mockResolvedValueOnce([
      makeResource({ id: "art-1" }),
      makeVideoResource({ id: "vid-1" }),
    ]);

    const bundles = await provider.fetchBundle(["art-1", "vid-1"], USER_A);

    expect(bundles).toHaveLength(2);
    const articleBundle = bundles.find((b) => b.sourceId === "art-1");
    const videoBundle = bundles.find((b) => b.sourceId === "vid-1");

    expect(articleBundle?.sourceMetadata).toMatchObject({
      contentKind: "article",
    });
    expect(videoBundle?.sourceMetadata).toMatchObject({ contentKind: "video" });
  });
});
