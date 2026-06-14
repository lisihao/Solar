import { Test, TestingModule } from "@nestjs/testing";
import { ContentFetcherService } from "../content-fetcher.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { RAGFacade } from "@/modules/ai-harness/facade";
import { SocialContentSourceType } from "@prisma/client";

// Mock sanitize utilities from the facade
jest.mock("@/modules/ai-harness/facade", () => ({
  RAGFacade: jest.fn(),
  sanitizeForDb: jest.fn((s: string) => s),
  sanitizeJson: jest.fn((obj: unknown) => obj),
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  RAGFacade: jest.fn(),
  sanitizeForDb: jest.fn((s: string) => s),
  sanitizeJson: jest.fn((obj: unknown) => obj),
}));

describe("ContentFetcherService", () => {
  let service: ContentFetcherService;
  let mockPrisma: {
    resource: {
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    researchTopic: {
      findFirst: jest.Mock;
    };
    officeDocument: {
      findFirst: jest.Mock;
    };
    writingChapter: {
      findFirst: jest.Mock;
    };
  };
  let mockAiFacade: {
    contentFetch: {
      fetchFromUrl: jest.Mock;
      fetchFromYoutubeUrl: jest.Mock;
      extractYoutubeVideoId: jest.Mock;
    };
  };

  beforeEach(async () => {
    mockPrisma = {
      resource: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      researchTopic: {
        findFirst: jest.fn(),
      },
      officeDocument: {
        findFirst: jest.fn(),
      },
      writingChapter: {
        findFirst: jest.fn(),
      },
    };

    mockAiFacade = {
      contentFetch: {
        fetchFromUrl: jest.fn(),
        fetchFromYoutubeUrl: jest.fn(),
        extractYoutubeVideoId: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentFetcherService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RAGFacade, useValue: mockAiFacade },
      ],
    }).compile();

    service = module.get<ContentFetcherService>(ContentFetcherService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== fetchFromUrl ====================

  it("should delegate URL fetching to aiFacade.contentFetch", async () => {
    mockAiFacade.contentFetch.fetchFromUrl.mockResolvedValue({
      title: "Fetched Title",
      content: "Fetched content body",
      url: "https://example.com",
      images: ["https://example.com/img.jpg"],
    });

    const result = await service.fetchFromUrl("https://example.com");

    expect(mockAiFacade.contentFetch.fetchFromUrl).toHaveBeenCalledWith(
      "https://example.com",
    );
    expect(result.title).toBe("Fetched Title");
    expect(result.content).toBe("Fetched content body");
  });

  it("should use Untitled when fetched title is empty", async () => {
    mockAiFacade.contentFetch.fetchFromUrl.mockResolvedValue({
      title: "",
      content: "Content without title",
    });

    const result = await service.fetchFromUrl("https://example.com");

    expect(result.title).toBe("Untitled");
  });

  it("should propagate bilingual flags from fetch result", async () => {
    mockAiFacade.contentFetch.fetchFromUrl.mockResolvedValue({
      title: "Title",
      content: "English content",
      originalContent: "Original English",
      translatedContent: "Chinese translation",
      isBilingual: true,
    });

    const result = await service.fetchFromUrl("https://example.com");

    expect(result.isBilingual).toBe(true);
    expect(result.originalContent).toBe("Original English");
    expect(result.translatedContent).toBe("Chinese translation");
  });

  it("should propagate cover image and metadata from fetch result", async () => {
    mockAiFacade.contentFetch.fetchFromUrl.mockResolvedValue({
      title: "Title",
      content: "Content",
      coverImage: "https://example.com/cover.jpg",
      metadata: { author: "Test Author" },
    });

    const result = await service.fetchFromUrl("https://example.com");

    expect(result.coverImage).toBe("https://example.com/cover.jpg");
    expect(result.metadata).toEqual({ author: "Test Author" });
  });

  // ==================== fetchFromSource - AI_EXPLORE ====================

  // ★ R5 P0 regression (2026-05-18): IDOR — Resource has no userId column;
  //   isolation must filter via collectionItems.some.collection.userId.
  it("ISOLATION: fetchFromExploreResource passes userId into collectionItems.some.collection.userId", async () => {
    mockPrisma.resource.findFirst.mockResolvedValue(null); // simulate user B's resource not in caller's collections
    await expect(
      service.fetchFromSource(
        SocialContentSourceType.AI_EXPLORE,
        "user-b-resource",
        "user-a",
      ),
    ).rejects.toThrow();

    const callArg = mockPrisma.resource.findFirst.mock.calls[0][0];
    expect(callArg.where).toMatchObject({
      id: "user-b-resource",
      collectionItems: { some: { collection: { userId: "user-a" } } },
    });
  });

  it("should fetch from explore resource by ID", async () => {
    mockPrisma.resource.findFirst.mockResolvedValue({
      id: "resource-1",
      title: "Resource Title",
      content: "This is a resource with enough content to pass the threshold.",
      aiSummary: null,
      abstract: null,
      type: "ARTICLE",
      sourceUrl: "https://example.com",
      thumbnailUrl: null,
      authors: ["Author 1"],
    });

    const result = await service.fetchFromSource(
      SocialContentSourceType.AI_EXPLORE,
      "resource-1",
      "user-1",
    );

    expect(result.title).toBe("Resource Title");
    expect(result.content).toBeDefined();
  });

  it("should throw when explore resource does not exist", async () => {
    mockPrisma.resource.findFirst.mockResolvedValue(null);

    await expect(
      service.fetchFromSource(
        SocialContentSourceType.AI_EXPLORE,
        "non-existent",
        "user-1",
      ),
    ).rejects.toThrow("资源不存在");
  });

  it("should throw when resource has insufficient content", async () => {
    mockPrisma.resource.findFirst.mockResolvedValue({
      id: "resource-1",
      title: "Resource Title",
      content: "Too short", // less than 10 chars
      aiSummary: null,
      abstract: null,
      type: "ARTICLE",
      sourceUrl: null,
      thumbnailUrl: null,
      authors: [],
    });

    await expect(
      service.fetchFromSource(
        SocialContentSourceType.AI_EXPLORE,
        "resource-1",
        "user-1",
      ),
    ).rejects.toThrow("该资源内容不足");
  });

  it("should fetch from URL when resource content is less than 100 chars", async () => {
    mockPrisma.resource.findFirst.mockResolvedValue({
      id: "resource-1",
      title: "Resource Title",
      content: "Short content", // < 100 chars, triggers URL fetch
      aiSummary: null,
      abstract: null,
      type: "ARTICLE",
      sourceUrl: "https://example.com/article",
      thumbnailUrl: null,
      authors: [],
    });
    mockAiFacade.contentFetch.fetchFromUrl.mockResolvedValue({
      content:
        "Full content fetched from URL, which is much longer and detailed.",
    });
    mockPrisma.resource.update.mockResolvedValue({});

    const result = await service.fetchFromSource(
      SocialContentSourceType.AI_EXPLORE,
      "resource-1",
      "user-1",
    );

    expect(mockAiFacade.contentFetch.fetchFromUrl).toHaveBeenCalled();
    expect(result.content).toContain("Full content fetched from URL");
  });

  it("should handle YouTube video resources by fetching subtitles", async () => {
    mockPrisma.resource.findFirst.mockResolvedValue({
      id: "resource-1",
      title: "YouTube Video Title",
      content: null,
      aiSummary: null,
      abstract: null,
      type: "YOUTUBE_VIDEO",
      sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      thumbnailUrl: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      authors: [],
    });

    mockAiFacade.contentFetch.extractYoutubeVideoId.mockReturnValue(
      "dQw4w9WgXcQ",
    );
    mockAiFacade.contentFetch.fetchFromYoutubeUrl.mockResolvedValue({
      title: "YouTube Title",
      content:
        "This is a YouTube video transcript that is long enough to pass the 100 character threshold required by the fetchFromExploreResource method.",
      originalContent: "Original transcript content",
      translatedContent: null,
      isBilingual: false,
      coverImage: null,
      metadata: {},
    });

    const result = await service.fetchFromSource(
      SocialContentSourceType.AI_EXPLORE,
      "resource-1",
      "user-1",
    );

    expect(mockAiFacade.contentFetch.fetchFromYoutubeUrl).toHaveBeenCalledWith(
      "dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(result.title).toBe("YouTube Video Title");
  });

  it("should fallback to resource content when YouTube subtitle fetch fails", async () => {
    mockPrisma.resource.findFirst.mockResolvedValue({
      id: "resource-1",
      title: "YouTube Resource",
      content:
        "Fallback content that is long enough to be used in the social media post.",
      aiSummary: null,
      abstract: null,
      type: "YOUTUBE_VIDEO",
      sourceUrl: "https://www.youtube.com/watch?v=abc",
      thumbnailUrl: null,
      authors: [],
    });

    mockAiFacade.contentFetch.extractYoutubeVideoId.mockReturnValue("abc");
    mockAiFacade.contentFetch.fetchFromYoutubeUrl.mockRejectedValue(
      new Error("Subtitle not available"),
    );

    const result = await service.fetchFromSource(
      SocialContentSourceType.AI_EXPLORE,
      "resource-1",
      "user-1",
    );

    expect(result.title).toBe("YouTube Resource");
    expect(result.content).toContain("Fallback content");
  });

  it("should use aiSummary when content is null but aiSummary exists", async () => {
    mockPrisma.resource.findFirst.mockResolvedValue({
      id: "resource-1",
      title: "Article",
      content: null,
      aiSummary:
        "This is an AI-generated summary that has enough content to pass.",
      abstract: null,
      type: "ARTICLE",
      sourceUrl: null,
      thumbnailUrl: null,
      authors: [],
    });

    const result = await service.fetchFromSource(
      SocialContentSourceType.AI_EXPLORE,
      "resource-1",
      "user-1",
    );

    expect(result.content).toContain("AI-generated summary");
  });

  // ==================== fetchFromSource - AI_RESEARCH ====================

  it("should fetch from research report", async () => {
    mockPrisma.researchTopic.findFirst.mockResolvedValue({
      id: "topic-1",
      name: "Research Topic",
      description: "Topic description",
      status: "COMPLETED",
      reports: [
        {
          version: 1,
          fullReport: "Full research report content that is comprehensive.",
        },
      ],
    });

    const result = await service.fetchFromSource(
      SocialContentSourceType.AI_RESEARCH,
      "topic-1",
      "user-1",
    );

    expect(result.title).toBe("Research Topic");
    expect(result.content).toBe(
      "Full research report content that is comprehensive.",
    );
    expect(result.metadata?.status).toBe("COMPLETED");
  });

  it("should use topic description when no report exists", async () => {
    mockPrisma.researchTopic.findFirst.mockResolvedValue({
      id: "topic-1",
      name: "Research Topic",
      description: "Topic description used as fallback content",
      status: "IN_PROGRESS",
      reports: [],
    });

    const result = await service.fetchFromSource(
      SocialContentSourceType.AI_RESEARCH,
      "topic-1",
      "user-1",
    );

    expect(result.content).toBe("Topic description used as fallback content");
  });

  it("should throw when research topic not found", async () => {
    mockPrisma.researchTopic.findFirst.mockResolvedValue(null);

    await expect(
      service.fetchFromSource(
        SocialContentSourceType.AI_RESEARCH,
        "non-existent",
        "user-1",
      ),
    ).rejects.toThrow("研究主题不存在");
  });

  // ==================== fetchFromSource - AI_OFFICE ====================

  it("should fetch from office document", async () => {
    mockPrisma.officeDocument.findFirst.mockResolvedValue({
      id: "doc-1",
      title: "Office Document Title",
      content: "Document content goes here",
      type: "DOCUMENT",
    });

    const result = await service.fetchFromSource(
      SocialContentSourceType.AI_OFFICE,
      "doc-1",
      "user-1",
    );

    expect(result.title).toBe("Office Document Title");
    expect(result.content).toBe("Document content goes here");
    expect(result.metadata?.documentType).toBe("DOCUMENT");
  });

  it("should handle office document with object content", async () => {
    mockPrisma.officeDocument.findFirst.mockResolvedValue({
      id: "doc-1",
      title: "Document",
      content: { blocks: [{ text: "Block content" }] },
      type: "DOCUMENT",
    });

    const result = await service.fetchFromSource(
      SocialContentSourceType.AI_OFFICE,
      "doc-1",
      "user-1",
    );

    expect(result.content).toBe(
      JSON.stringify({ blocks: [{ text: "Block content" }] }),
    );
  });

  it("should throw when office document not found", async () => {
    mockPrisma.officeDocument.findFirst.mockResolvedValue(null);

    await expect(
      service.fetchFromSource(
        SocialContentSourceType.AI_OFFICE,
        "non-existent",
        "user-1",
      ),
    ).rejects.toThrow("文档不存在");
  });

  // ==================== fetchFromSource - AI_WRITING ====================

  it("should fetch from writing chapter", async () => {
    mockPrisma.writingChapter.findFirst.mockResolvedValue({
      id: "chapter-1",
      title: "Chapter One",
      content: "Chapter content here",
      wordCount: 100,
      volume: {
        project: {
          ownerId: "user-1",
          name: "My Novel",
        },
      },
    });

    const result = await service.fetchFromSource(
      SocialContentSourceType.AI_WRITING,
      "chapter-1",
      "user-1",
    );

    expect(result.title).toBe("Chapter One");
    expect(result.content).toBe("Chapter content here");
    expect(result.metadata?.projectName).toBe("My Novel");
    expect(result.metadata?.wordCount).toBe(100);
  });

  it("should throw when chapter does not belong to user", async () => {
    mockPrisma.writingChapter.findFirst.mockResolvedValue({
      id: "chapter-1",
      title: "Chapter One",
      content: "Content",
      wordCount: 50,
      volume: {
        project: {
          ownerId: "different-user", // not matching userId
          name: "Other Novel",
        },
      },
    });

    await expect(
      service.fetchFromSource(
        SocialContentSourceType.AI_WRITING,
        "chapter-1",
        "user-1",
      ),
    ).rejects.toThrow("章节不存在");
  });

  it("should throw when chapter not found", async () => {
    mockPrisma.writingChapter.findFirst.mockResolvedValue(null);

    await expect(
      service.fetchFromSource(
        SocialContentSourceType.AI_WRITING,
        "non-existent",
        "user-1",
      ),
    ).rejects.toThrow("章节不存在");
  });

  // ==================== fetchFromSource - unsupported type ====================

  it("should throw for unsupported source type", async () => {
    await expect(
      service.fetchFromSource(
        "UNSUPPORTED_TYPE" as SocialContentSourceType,
        "id-1",
        "user-1",
      ),
    ).rejects.toThrow("不支持的来源类型");
  });
});
