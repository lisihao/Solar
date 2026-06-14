import { Test, TestingModule } from "@nestjs/testing";
import { PreparseService } from "../preparse.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ContentFetchService } from "@/modules/ai-engine/facade";

describe("PreparseService", () => {
  let service: PreparseService;
  let prisma: {
    knowledgeBaseDocument: { findUnique: jest.Mock };
    $executeRaw: jest.Mock;
  };
  let contentFetch: { fetchFromUrl: jest.Mock };

  beforeEach(async () => {
    prisma = {
      knowledgeBaseDocument: { findUnique: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    contentFetch = { fetchFromUrl: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PreparseService,
        { provide: PrismaService, useValue: prisma },
        { provide: ContentFetchService, useValue: contentFetch },
      ],
    }).compile();
    service = module.get(PreparseService);
  });

  it("skips already-ready doc (idempotent)", async () => {
    prisma.knowledgeBaseDocument.findUnique.mockResolvedValue({
      id: "d1",
      sourceUrl: "https://x.com",
      rawContent: "",
      title: "",
      metadata: { preparse: { status: "ready", mediaUrls: [] } },
    });
    await service.preparseDocument("d1");
    expect(contentFetch.fetchFromUrl).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("YouTube URL → fetches via ContentFetchService + writes preparse with thumbnail", async () => {
    prisma.knowledgeBaseDocument.findUnique.mockResolvedValue({
      id: "d2",
      sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      rawContent: null,
      title: "Test Video",
      metadata: {},
    });
    contentFetch.fetchFromUrl.mockResolvedValue({
      title: "Test Video",
      content:
        "## Intro\n这是中文视频字幕内容，介绍 AI 技术。\n## Conclusion\n总结。",
      coverImage: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      metadata: {},
    });

    await service.preparseDocument("d2");

    // status=parsing 写一次 + status=ready 写一次
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    // 第二次写包含 mediaUrls + structuredContent + sourceLocale
    const finalCallArgs = prisma.$executeRaw.mock.calls[1];
    const sqlValues = finalCallArgs.flat();
    const preparseJson = sqlValues.find(
      (v: unknown) => typeof v === "string" && v.includes('"status":"ready"'),
    );
    expect(preparseJson).toBeDefined();
    expect(preparseJson).toContain("sourceLocale");
    expect(preparseJson).toContain("structuredContent");
    expect(preparseJson).toContain("i.ytimg.com");
  });

  it("Web URL → extracts <img> + cover into mediaUrls", async () => {
    prisma.knowledgeBaseDocument.findUnique.mockResolvedValue({
      id: "d3",
      sourceUrl: "https://example.com/article",
      rawContent: null,
      title: "Article",
      metadata: {},
    });
    contentFetch.fetchFromUrl.mockResolvedValue({
      title: "Article",
      content:
        "Article body ![chart](https://example.com/chart.png) more text.",
      coverImage: "https://example.com/hero.jpg",
      url: "https://example.com/article",
      metadata: {},
    });

    await service.preparseDocument("d3");

    expect(contentFetch.fetchFromUrl).toHaveBeenCalledWith(
      "https://example.com/article",
    );
    const finalCallArgs = prisma.$executeRaw.mock.calls[1];
    const preparseJson = finalCallArgs
      .flat()
      .find(
        (v: unknown) => typeof v === "string" && v.includes('"status":"ready"'),
      );
    expect(preparseJson).toContain("https://example.com/hero.jpg");
    expect(preparseJson).toContain("https://example.com/chart.png");
  });

  it("fetch failure → writes status=failed with errorCode, increments retryCount", async () => {
    prisma.knowledgeBaseDocument.findUnique.mockResolvedValue({
      id: "d4",
      sourceUrl: "https://broken.example.com",
      rawContent: null,
      title: "",
      metadata: { preparse: { status: "failed", retryCount: 1 } },
    });
    contentFetch.fetchFromUrl.mockRejectedValue(new Error("network timeout"));

    await service.preparseDocument("d4");

    // parsing 写一次 + failed 写一次
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    const finalCallArgs = prisma.$executeRaw.mock.calls[1];
    const preparseJson = finalCallArgs
      .flat()
      .find(
        (v: unknown) =>
          typeof v === "string" && v.includes('"status":"failed"'),
      );
    expect(preparseJson).toContain("PREPARSE_FAILED");
    expect(preparseJson).toContain("network timeout");
    expect(preparseJson).toContain('"retryCount":2');
  });

  it("retry budget exhausted (retryCount > MAX_RETRIES=3) → skip without fetch", async () => {
    prisma.knowledgeBaseDocument.findUnique.mockResolvedValue({
      id: "d5",
      sourceUrl: "https://broken.example.com",
      rawContent: null,
      title: "",
      metadata: { preparse: { status: "failed", retryCount: 3 } },
    });

    await service.preparseDocument("d5");
    expect(contentFetch.fetchFromUrl).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("non-URL doc (manual paste) → uses rawContent, no fetch", async () => {
    prisma.knowledgeBaseDocument.findUnique.mockResolvedValue({
      id: "d6",
      sourceUrl: null,
      rawContent: "## Heading\nUser-pasted markdown content.",
      title: "Manual",
      metadata: {},
    });

    await service.preparseDocument("d6");
    expect(contentFetch.fetchFromUrl).not.toHaveBeenCalled();
    // Still writes preparse status=ready with parsed sections
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    const finalCallArgs = prisma.$executeRaw.mock.calls[1];
    const preparseJson = finalCallArgs
      .flat()
      .find(
        (v: unknown) => typeof v === "string" && v.includes('"status":"ready"'),
      );
    expect(preparseJson).toContain("Heading");
  });

  it("doc not found → log warn, no throw", async () => {
    prisma.knowledgeBaseDocument.findUnique.mockResolvedValue(null);
    await expect(service.preparseDocument("ghost")).resolves.toBeUndefined();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});
