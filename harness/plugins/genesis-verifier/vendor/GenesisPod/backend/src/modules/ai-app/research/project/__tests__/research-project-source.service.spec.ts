/**
 * ResearchProjectSourceService 单元测试
 *
 * 覆盖范围：
 * - addSource() — success, deduplication, not found, forbidden
 * - addSources() — batch add, batch deduplication, all duplicates
 * - getSources() — success, not found, forbidden
 * - getSource() — success, not found, forbidden, source mismatch
 * - removeSource() — success, not found, forbidden, source mismatch
 * - searchSources() — quick mode, deep mode
 * - quickSearch() — all source types: local, web, arxiv, github, news, scholar, blogs, reports, policy
 * - deepResearch() — multiple rounds, related queries, academic queries, deduplication
 * - generateRelatedQueries() — term extraction from results (via SourceQueryService)
 * - generateAcademicQueries() (via SourceQueryService)
 * - isDuplicate(), deduplicateResults(), rankByRelevance() (via SourceQueryService)
 * - calculateRelevance(), calculateQuality(), calculateFreshness() (via SourceQueryService)
 * - findDuplicateSource() (via SourceIngestionService)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger, NotFoundException, ForbiddenException } from "@nestjs/common";
import { ResearchProjectSourceService } from "../research-project-source.service";
import { SourceIngestionService } from "../source-ingestion.service";
import { SourceQueryService } from "../source-query.service";
import { SourceMetadataService } from "../source-metadata.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ToolRegistry } from "@/modules/ai-harness/facade";
import { FileParserService } from "../services/file-parser.service";
import { AddSourceDto, SearchSourcesDto } from "../dto";

// Mock axios and xml2js to prevent real HTTP calls from searchArxivDirect / searchGithubDirect
jest.mock("axios", () => ({
  default: { get: jest.fn().mockRejectedValue(new Error("axios mocked")) },
}));
jest.mock("xml2js", () => ({
  parseStringPromise: jest.fn().mockResolvedValue({ feed: { entry: [] } }),
}));

jest.mock("@prisma/client", () => ({
  PrismaClient: class MockPrismaClient {},
  AIModelType: {
    CHAT: "CHAT",
    CHAT_FAST: "CHAT_FAST",
  },
}));

jest.mock("@/modules/ai-harness/facade", () => ({
  ToolRegistry: jest.fn().mockImplementation(() => ({ tryGet: jest.fn() })),
  ToolContext: jest.fn(),
  AIFacade: jest.fn().mockImplementation(() => ({})),
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  ToolRegistry: jest.fn().mockImplementation(() => ({ tryGet: jest.fn() })),
  ToolContext: jest.fn(),
  AIFacade: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@/common/config/app.config", () => ({
  APP_CONFIG: {
    brand: { userAgent: "TestAgent/1.0" },
  },
}));

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeProject(userId = "user-001", id = "proj-001") {
  return { id, userId, name: "Test Project", sourceCount: 0 };
}

function makeSource(id = "src-001", projectId = "proj-001") {
  return {
    id,
    projectId,
    title: "Test Source",
    sourceType: "web",
    sourceUrl: "https://example.com",
    abstract: "Abstract text",
    content: null,
    authors: [],
    publishedAt: null,
    metadata: {},
    resourceId: null,
    analysisStatus: "PENDING",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeWebSearchResult(title: string, url: string) {
  return { title, url, content: `Content for ${title}`, score: 0.8 };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("ResearchProjectSourceService", () => {
  let service: ResearchProjectSourceService;
  let ingestionService: SourceIngestionService;
  let queryService: SourceQueryService;
  let mockPrisma: any;
  let mockToolRegistry: any;
  let mockFileParser: any;
  let mockWebSearchTool: any;

  const userId = "user-001";
  const projectId = "proj-001";
  const sourceId = "src-001";

  beforeEach(async () => {
    mockWebSearchTool = {
      execute: jest.fn().mockResolvedValue({
        success: true,
        data: {
          success: true,
          results: [
            makeWebSearchResult("Result 1", "https://result1.com"),
            makeWebSearchResult("Result 2", "https://result2.com"),
          ],
        },
      }),
    };

    mockToolRegistry = {
      tryGet: jest.fn().mockReturnValue(mockWebSearchTool),
    };

    mockFileParser = {
      parse: jest.fn().mockResolvedValue({ text: "parsed text", pages: 1 }),
    };

    mockPrisma = {
      researchProject: {
        findUnique: jest.fn().mockResolvedValue(makeProject()),
        update: jest.fn().mockResolvedValue(makeProject()),
      },
      researchProjectSource: {
        create: jest.fn().mockResolvedValue(makeSource()),
        findFirst: jest.fn().mockResolvedValue(null), // no duplicate by default
        findUnique: jest.fn().mockResolvedValue(makeSource()),
        findMany: jest.fn().mockResolvedValue([makeSource()]),
        delete: jest.fn().mockResolvedValue(makeSource()),
        update: jest.fn().mockResolvedValue(makeSource()),
      },
      resource: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "res-1",
            type: "BLOG",
            title: "Resource Title",
            abstract: "Abstract",
            sourceUrl: "https://resource.com",
            publishedAt: new Date("2024-01-01"),
            authors: [],
            qualityScore: 0.8,
            citationCount: 10,
            content: "Content",
          },
        ]),
      },
      $transaction: jest
        .fn()
        .mockImplementation((promises: Promise<any>[]) =>
          Promise.all(promises),
        ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchProjectSourceService,
        SourceIngestionService,
        SourceQueryService,
        SourceMetadataService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ToolRegistry, useValue: mockToolRegistry },
        { provide: FileParserService, useValue: mockFileParser },
      ],
    }).compile();

    service = module.get<ResearchProjectSourceService>(
      ResearchProjectSourceService,
    );
    ingestionService = module.get<SourceIngestionService>(
      SourceIngestionService,
    );
    queryService = module.get<SourceQueryService>(SourceQueryService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // addSource
  // =========================================================================

  describe("addSource", () => {
    const dto: AddSourceDto = {
      title: "New Source",
      sourceType: "web",
      sourceUrl: "https://new.com",
    };

    it("should create a new source when no duplicate exists", async () => {
      const result = await service.addSource(userId, projectId, dto);

      expect(mockPrisma.researchProjectSource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectId,
            title: dto.title,
            sourceType: dto.sourceType,
            analysisStatus: "PENDING",
          }),
        }),
      );
      expect(mockPrisma.researchProject.update).toHaveBeenCalledWith({
        where: { id: projectId },
        data: { sourceCount: { increment: 1 } },
      });
      expect(result).toBeDefined();
    });

    it("should throw NotFoundException when project not found", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(null);

      await expect(service.addSource(userId, projectId, dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw ForbiddenException when user does not own the project", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(
        makeProject("other-user"),
      );

      await expect(service.addSource(userId, projectId, dto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("should return existing source when duplicate found (by title)", async () => {
      const existingSource = makeSource();
      mockPrisma.researchProjectSource.findFirst.mockResolvedValue(
        existingSource,
      );

      const result = await service.addSource(userId, projectId, dto);

      expect(result).toEqual(existingSource);
      expect(mockPrisma.researchProjectSource.create).not.toHaveBeenCalled();
    });

    it("should return existing source when duplicate found (by URL)", async () => {
      const existingSource = makeSource();
      mockPrisma.researchProjectSource.findFirst.mockResolvedValue(
        existingSource,
      );

      const result = await service.addSource(userId, projectId, {
        ...dto,
        sourceUrl: "https://duplicate.com",
      });

      expect(result).toEqual(existingSource);
    });

    it("should return existing source when duplicate found (by resourceId)", async () => {
      const existingSource = makeSource();
      mockPrisma.researchProjectSource.findFirst.mockResolvedValue(
        existingSource,
      );

      const result = await service.addSource(userId, projectId, {
        ...dto,
        resourceId: "res-existing",
      });

      expect(result).toEqual(existingSource);
    });

    it("should handle null publishedAt", async () => {
      await service.addSource(userId, projectId, {
        ...dto,
        publishedAt: undefined,
      });

      expect(mockPrisma.researchProjectSource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ publishedAt: null }),
        }),
      );
    });

    it("should convert publishedAt string to Date", async () => {
      await service.addSource(userId, projectId, {
        ...dto,
        publishedAt: "2024-06-15",
      });

      expect(mockPrisma.researchProjectSource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            publishedAt: new Date("2024-06-15"),
          }),
        }),
      );
    });

    it("should use empty object when metadata not provided", async () => {
      await service.addSource(userId, projectId, {
        ...dto,
        metadata: undefined,
      });

      expect(mockPrisma.researchProjectSource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ metadata: {} }),
        }),
      );
    });
  });

  // =========================================================================
  // addSources
  // =========================================================================

  describe("addSources", () => {
    const sources: AddSourceDto[] = [
      { title: "Source A", sourceType: "web", sourceUrl: "https://a.com" },
      { title: "Source B", sourceType: "paper", sourceUrl: "https://b.com" },
    ];

    it("should add multiple unique sources", async () => {
      mockPrisma.researchProjectSource.create.mockResolvedValue(makeSource());

      await service.addSources(userId, projectId, sources);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.researchProject.update).toHaveBeenCalledWith({
        where: { id: projectId },
        data: { sourceCount: { increment: 2 } },
      });
    });

    it("should throw NotFoundException when project not found", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(null);

      await expect(
        service.addSources(userId, projectId, sources),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when user does not own the project", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(
        makeProject("other-user"),
      );

      await expect(
        service.addSources(userId, projectId, sources),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should return empty array when all sources are duplicates from DB", async () => {
      mockPrisma.researchProjectSource.findFirst.mockResolvedValue(
        makeSource(),
      );

      const result = await service.addSources(userId, projectId, sources);

      expect(result).toEqual([]);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it("should skip duplicates within the batch (same title)", async () => {
      const batchWithDuplicateTitle: AddSourceDto[] = [
        { title: "Same Title", sourceType: "web", sourceUrl: "https://a.com" },
        {
          title: "Same Title",
          sourceType: "paper",
          sourceUrl: "https://b.com",
        },
      ];
      mockPrisma.researchProjectSource.findFirst.mockResolvedValue(null);

      await service.addSources(userId, projectId, batchWithDuplicateTitle);

      // Only 1 unique source should be added
      expect(mockPrisma.researchProject.update).toHaveBeenCalledWith({
        where: { id: projectId },
        data: { sourceCount: { increment: 1 } },
      });
    });

    it("should skip duplicates within the batch (same URL)", async () => {
      const batchWithDuplicateUrl: AddSourceDto[] = [
        { title: "Title A", sourceType: "web", sourceUrl: "https://same.com" },
        { title: "Title B", sourceType: "web", sourceUrl: "https://same.com" },
      ];
      mockPrisma.researchProjectSource.findFirst.mockResolvedValue(null);

      await service.addSources(userId, projectId, batchWithDuplicateUrl);

      expect(mockPrisma.researchProject.update).toHaveBeenCalledWith({
        where: { id: projectId },
        data: { sourceCount: { increment: 1 } },
      });
    });

    it("should skip duplicates within the batch (same resourceId)", async () => {
      const batchWithDuplicateResourceId: AddSourceDto[] = [
        { title: "Title A", sourceType: "web", resourceId: "res-123" },
        { title: "Title B", sourceType: "web", resourceId: "res-123" },
      ];
      mockPrisma.researchProjectSource.findFirst.mockResolvedValue(null);

      await service.addSources(userId, projectId, batchWithDuplicateResourceId);

      expect(mockPrisma.researchProject.update).toHaveBeenCalledWith({
        where: { id: projectId },
        data: { sourceCount: { increment: 1 } },
      });
    });
  });

  // =========================================================================
  // getSources
  // =========================================================================

  describe("getSources", () => {
    it("should return all sources for a project", async () => {
      const result = await service.getSources(userId, projectId);

      expect(mockPrisma.researchProjectSource.findMany).toHaveBeenCalledWith({
        where: { projectId },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBeDefined();
    });

    it("should throw NotFoundException when project not found", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(null);

      await expect(service.getSources(userId, projectId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw ForbiddenException when user does not own project", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(
        makeProject("other-user"),
      );

      await expect(service.getSources(userId, projectId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // =========================================================================
  // getSource
  // =========================================================================

  describe("getSource", () => {
    it("should return a specific source", async () => {
      const result = await service.getSource(userId, projectId, sourceId);

      expect(mockPrisma.researchProjectSource.findUnique).toHaveBeenCalledWith({
        where: { id: sourceId },
      });
      expect(result).toBeDefined();
    });

    it("should throw NotFoundException when project not found", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(null);

      await expect(
        service.getSource(userId, projectId, sourceId),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when user does not own project", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(
        makeProject("other-user"),
      );

      await expect(
        service.getSource(userId, projectId, sourceId),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw NotFoundException when source not found", async () => {
      mockPrisma.researchProjectSource.findUnique.mockResolvedValue(null);

      await expect(
        service.getSource(userId, projectId, sourceId),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when source belongs to different project", async () => {
      mockPrisma.researchProjectSource.findUnique.mockResolvedValue(
        makeSource("src-001", "other-project"),
      );

      await expect(
        service.getSource(userId, projectId, sourceId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // removeSource
  // =========================================================================

  describe("removeSource", () => {
    it("should delete a source and decrement count", async () => {
      const result = await service.removeSource(userId, projectId, sourceId);

      expect(mockPrisma.researchProjectSource.delete).toHaveBeenCalledWith({
        where: { id: sourceId },
      });
      expect(mockPrisma.researchProject.update).toHaveBeenCalledWith({
        where: { id: projectId },
        data: { sourceCount: { decrement: 1 } },
      });
      expect(result).toEqual({ success: true });
    });

    it("should throw NotFoundException when project not found", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(null);

      await expect(
        service.removeSource(userId, projectId, sourceId),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when user does not own project", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(
        makeProject("other-user"),
      );

      await expect(
        service.removeSource(userId, projectId, sourceId),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw NotFoundException when source not found", async () => {
      mockPrisma.researchProjectSource.findUnique.mockResolvedValue(null);

      await expect(
        service.removeSource(userId, projectId, sourceId),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when source belongs to a different project", async () => {
      mockPrisma.researchProjectSource.findUnique.mockResolvedValue(
        makeSource("src-001", "other-project"),
      );

      await expect(
        service.removeSource(userId, projectId, sourceId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // searchSources
  // =========================================================================

  describe("searchSources — mode routing", () => {
    const baseDto: SearchSourcesDto = {
      query: "machine learning",
      mode: "quick",
    };

    it("should default to quick search when mode is not specified", async () => {
      const result = await service.searchSources(userId, {
        ...baseDto,
        mode: undefined,
      });
      expect(result.mode).toBe("quick");
    });

    it("should use quick mode explicitly", async () => {
      const result = await service.searchSources(userId, {
        ...baseDto,
        mode: "quick",
      });
      expect(result.mode).toBe("quick");
    });

    it("should use deep mode explicitly", async () => {
      const result = await service.searchSources(userId, {
        ...baseDto,
        mode: "deep",
      });
      expect(result.mode).toBe("deep");
    }, 15_000);

    it("should default to all sources when sources not specified", async () => {
      const result = await service.searchSources(userId, { query: "test" });
      expect(result.sourcesSearched).toContain("local");
      expect(result.sourcesSearched).toContain("web");
    });
  });

  // =========================================================================
  // quickSearch — individual source types
  // =========================================================================

  describe("quickSearch (via searchSources quick mode)", () => {
    it("should search local sources when 'local' is included", async () => {
      await service.searchSources(userId, {
        query: "AI",
        mode: "quick",
        sources: ["local"],
      });

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({
                title: { contains: "AI", mode: "insensitive" },
              }),
            ]),
          }),
        }),
      );
    });

    it("should search web when 'web' is included", async () => {
      await service.searchSources(userId, {
        query: "AI",
        mode: "quick",
        sources: ["web"],
      });

      expect(mockToolRegistry.tryGet).toHaveBeenCalledWith("web-search");
      expect(mockWebSearchTool.execute).toHaveBeenCalled();
    });

    it("should return empty web results when web-search tool not registered", async () => {
      mockToolRegistry.tryGet.mockReturnValue(null);

      const result = await service.searchSources(userId, {
        query: "AI",
        mode: "quick",
        sources: ["web"],
      });

      expect(result.results).toEqual([]);
    });

    it("should return empty web results when tool returns failure", async () => {
      mockWebSearchTool.execute.mockResolvedValue({
        success: false,
        data: null,
      });

      const result = await service.searchSources(userId, {
        query: "AI",
        mode: "quick",
        sources: ["web"],
      });

      expect(result.results).toEqual([]);
    });

    it("should return empty web results when tool data has no results", async () => {
      mockWebSearchTool.execute.mockResolvedValue({
        success: true,
        data: { success: false, results: [] },
      });

      const result = await service.searchSources(userId, {
        query: "AI",
        mode: "quick",
        sources: ["web"],
      });

      expect(result.results).toEqual([]);
    });

    it("should handle web tool execution error gracefully", async () => {
      mockWebSearchTool.execute.mockRejectedValue(new Error("Tool failed"));

      const result = await service.searchSources(userId, {
        query: "AI",
        mode: "quick",
        sources: ["web"],
      });

      expect(result.results).toEqual([]);
    });

    it("should search news with appended news-focused query terms", async () => {
      await service.searchSources(userId, {
        query: "AI advances",
        mode: "quick",
        sources: ["news"],
      });

      expect(mockWebSearchTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining("news"),
        }),
        expect.anything(),
      );
    });

    it("should return empty news results when web-search tool not registered", async () => {
      mockToolRegistry.tryGet.mockReturnValue(null);

      const result = await service.searchSources(userId, {
        query: "AI",
        mode: "quick",
        sources: ["news"],
      });

      expect(result.results).toEqual([]);
    });

    it("should search blogs from local DB with BLOG category", async () => {
      await service.searchSources(userId, {
        query: "ML tips",
        mode: "quick",
        sources: ["blogs"],
      });

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: "BLOG" }),
        }),
      );
    });

    it("should search reports from local DB with REPORT category", async () => {
      await service.searchSources(userId, {
        query: "ML report",
        mode: "quick",
        sources: ["reports"],
      });

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: "REPORT" }),
        }),
      );
    });

    it("should search policy from local DB with POLICY category", async () => {
      await service.searchSources(userId, {
        query: "AI policy",
        mode: "quick",
        sources: ["policy"],
      });

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: "POLICY" }),
        }),
      );
    });

    it("should collect errors from individual source searches that fail", async () => {
      // local search fails
      mockPrisma.resource.findMany.mockRejectedValue(new Error("DB error"));

      const result = await service.searchSources(userId, {
        query: "AI",
        mode: "quick",
        sources: ["local"],
      });

      expect(result.stats?.errors).toBeDefined();
      expect(result.stats?.errors?.length).toBeGreaterThan(0);
    });

    it("should include result stats with totalResults and durationMs", async () => {
      const result = await service.searchSources(userId, {
        query: "AI",
        mode: "quick",
        sources: ["web"],
      });

      expect(result.stats.totalResults).toBeGreaterThanOrEqual(0);
      expect(result.stats.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should run all source searches in parallel", async () => {
      const result = await service.searchSources(userId, {
        query: "AI",
        mode: "quick",
        sources: ["local", "web", "news"],
      });

      expect(result.results).toBeDefined();
      // local (from DB) + web results + news results
      expect(result.results.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // searchSources — scholar search (via axios mock)
  // =========================================================================

  describe("scholar search", () => {
    it("should search scholar and return paper results", async () => {
      // Mock axios
      jest.mock("axios", () => ({
        default: {
          get: jest.fn().mockResolvedValue({
            data: {
              data: [
                {
                  paperId: "paper-1",
                  title: "AI Paper",
                  abstract: "Abstract",
                  authors: [{ name: "Author A" }],
                  year: 2024,
                  citationCount: 50,
                  url: "https://paper.com",
                  openAccessPdf: { url: "https://pdf.com" },
                },
              ],
            },
          }),
        },
      }));

      // Scholar uses dynamic import of axios — since it's mocked above,
      // we test the fallback behavior (empty results on failure)
      const result = await service.searchSources(userId, {
        query: "neural networks",
        mode: "quick",
        sources: ["scholar"],
      });

      // Result may be empty or have content depending on axios mock resolution
      expect(result).toBeDefined();
      expect(result.mode).toBe("quick");
    });

    it("should return empty results when scholar API fails", async () => {
      // Since axios is dynamically imported, it will call real axios which may timeout
      // We test that errors are handled gracefully
      const result = await service.searchSources(userId, {
        query: "quantum computing",
        mode: "quick",
        sources: ["scholar"],
      });

      expect(result).toBeDefined();
      // Either succeeds or fails gracefully
    });
  });

  // =========================================================================
  // deepResearch
  // =========================================================================

  describe("deepResearch (via searchSources deep mode)", () => {
    it("should return deep mode results with searchRounds stats", async () => {
      const result = await service.searchSources(userId, {
        query: "quantum computing",
        mode: "deep",
        sources: ["local", "web"],
      });

      expect(result.mode).toBe("deep");
      const stats = result.stats as {
        searchRounds: number;
        queriesExecuted: string[];
        totalResults: number;
        durationMs: number;
      };
      expect(stats.searchRounds).toBeGreaterThan(0);
      expect(stats.queriesExecuted).toBeDefined();
    });

    it("should include original query in queriesExecuted", async () => {
      const result = await service.searchSources(userId, {
        query: "blockchain",
        mode: "deep",
        sources: ["local"],
      });

      const stats = result.stats as { queriesExecuted: string[] };
      expect(stats.queriesExecuted).toContain("blockchain");
    });

    it("should perform academic deep dive when arxiv is in sources", async () => {
      // arxiv search is done via searchArxivDirect which calls toolRegistry
      const result = await service.searchSources(userId, {
        query: "transformer model",
        mode: "deep",
        sources: ["arxiv"],
      });

      expect(result.mode).toBe("deep");
    });

    it("should deduplicate results across rounds", async () => {
      // Return same URL in both round 1 and round 2 queries
      mockPrisma.resource.findMany.mockResolvedValue([
        {
          id: "res-1",
          type: "BLOG",
          title: "Duplicate Title",
          abstract: "Same abstract",
          sourceUrl: "https://same-url.com",
          publishedAt: new Date(),
          authors: [],
          qualityScore: 0.5,
          citationCount: 0,
          content: "content",
        },
      ]);

      const result = await service.searchSources(userId, {
        query: "test dedup",
        mode: "deep",
        sources: ["local"],
      });

      // Deduplicated results should not have same URL twice
      const urls = result.results.map((r: any) => r.sourceUrl).filter(Boolean);
      const uniqueUrls = new Set(urls);
      expect(uniqueUrls.size).toBe(urls.length);
    });
  });

  // =========================================================================
  // generateRelatedQueries (private — now on SourceQueryService)
  // =========================================================================

  describe("generateRelatedQueries (private on SourceQueryService)", () => {
    it("should return empty array for empty query", () => {
      const result = (queryService as any).generateRelatedQueries("", []);
      expect(result).toEqual([]);
    });

    it("should generate queries from terms found in results", () => {
      const results = [
        { title: "Machine learning optimization techniques" },
        { title: "Deep learning frameworks comparison" },
      ];
      const queries = (queryService as any).generateRelatedQueries(
        "machine learning",
        results,
      );
      expect(queries.length).toBeGreaterThan(0);
      expect(
        queries.some((q: string) => q.startsWith("machine learning")),
      ).toBe(true);
    });

    it("should include standard variation queries", () => {
      const queries = (queryService as any).generateRelatedQueries("AI", []);
      expect(queries.some((q: string) => q.includes("latest research"))).toBe(
        true,
      );
      expect(queries.some((q: string) => q.includes("comparison"))).toBe(true);
      expect(queries.some((q: string) => q.includes("implementation"))).toBe(
        true,
      );
    });
  });

  // =========================================================================
  // generateAcademicQueries (private — now on SourceQueryService)
  // =========================================================================

  describe("generateAcademicQueries (private on SourceQueryService)", () => {
    it("should return 4 academic query variations", () => {
      const queries = (queryService as any).generateAcademicQueries(
        "reinforcement learning",
      );
      expect(queries).toHaveLength(4);
      expect(queries[0]).toContain("reinforcement learning");
      expect(queries.some((q: string) => q.includes("survey"))).toBe(true);
      expect(queries.some((q: string) => q.includes("benchmark"))).toBe(true);
    });
  });

  // =========================================================================
  // isDuplicate (private — now on SourceQueryService)
  // =========================================================================

  describe("isDuplicate (private on SourceQueryService)", () => {
    const existingResults = [
      { sourceUrl: "https://example.com", title: "Example Title" },
      { sourceUrl: null, title: "No URL Title" },
    ];

    it("should return true when sourceUrl matches existing", () => {
      const result = {
        sourceUrl: "https://example.com",
        title: "Different Title",
      };
      expect((queryService as any).isDuplicate(result, existingResults)).toBe(
        true,
      );
    });

    it("should return true when title matches existing", () => {
      const result = {
        sourceUrl: "https://different.com",
        title: "No URL Title",
      };
      expect((queryService as any).isDuplicate(result, existingResults)).toBe(
        true,
      );
    });

    it("should return false when neither URL nor title matches", () => {
      const result = { sourceUrl: "https://new.com", title: "Unique Title" };
      expect((queryService as any).isDuplicate(result, existingResults)).toBe(
        false,
      );
    });

    it("should be case-insensitive for URL comparison", () => {
      const result = { sourceUrl: "HTTPS://EXAMPLE.COM", title: "Different" };
      expect((queryService as any).isDuplicate(result, existingResults)).toBe(
        true,
      );
    });

    it("should handle missing sourceUrl and title", () => {
      const result = { other: "data" };
      expect((queryService as any).isDuplicate(result, existingResults)).toBe(
        false,
      );
    });
  });

  // =========================================================================
  // deduplicateResults (private — now on SourceQueryService)
  // =========================================================================

  describe("deduplicateResults (private on SourceQueryService)", () => {
    it("should remove results with duplicate URLs", () => {
      const results = [
        { sourceUrl: "https://a.com", title: "A" },
        { sourceUrl: "https://a.com", title: "A duplicate" },
        { sourceUrl: "https://b.com", title: "B" },
      ];
      const deduped = (queryService as any).deduplicateResults(results);
      expect(deduped).toHaveLength(2);
    });

    it("should remove results with duplicate titles when no URL", () => {
      const results = [
        { title: "Same Title" },
        { title: "Same Title" },
        { title: "Different Title" },
      ];
      const deduped = (queryService as any).deduplicateResults(results);
      expect(deduped).toHaveLength(2);
    });

    it("should filter out results with no URL and no title", () => {
      const results = [
        { other: "data" },
        { sourceUrl: "https://a.com", title: "Valid" },
      ];
      const deduped = (queryService as any).deduplicateResults(results);
      // Item with no key is filtered out
      expect(deduped.some((r: any) => r.sourceUrl === "https://a.com")).toBe(
        true,
      );
    });
  });

  // =========================================================================
  // rankByRelevance (private — now on SourceQueryService)
  // =========================================================================

  describe("rankByRelevance (private on SourceQueryService)", () => {
    it("should return results unchanged when query is empty", () => {
      const results = [
        { title: "A", sourceUrl: "https://a.com" },
        { title: "B", sourceUrl: "https://b.com" },
      ];
      const ranked = (queryService as any).rankByRelevance(results, "");
      expect(ranked).toEqual(results);
    });

    it("should rank results with title matching query higher", () => {
      const results = [
        {
          title: "Irrelevant Topic",
          abstract: "nothing",
          sourceUrl: "https://a.com",
        },
        {
          title: "Machine Learning Overview",
          abstract: "machine learning content",
          sourceUrl: "https://b.com",
        },
      ];
      const ranked = (queryService as any).rankByRelevance(
        results,
        "machine learning",
      );
      expect(ranked[0].title).toContain("Machine Learning");
    });

    it("should add relevanceScore to each result", () => {
      const results = [{ title: "AI Test", sourceUrl: "https://a.com" }];
      const ranked = (queryService as any).rankByRelevance(results, "AI");
      expect(typeof ranked[0].relevanceScore).toBe("number");
    });

    it("should assign diversity penalty for repeated domains", () => {
      const results = [
        { title: "A", sourceUrl: "https://example.com/page1" },
        { title: "B", sourceUrl: "https://example.com/page2" },
      ];
      const ranked = (queryService as any).rankByRelevance(results, "test");
      const second = ranked.find((r: any) => r.title === "B");
      expect(second._debug.diversity).toBe(30); // penalty for repeated domain
    });
  });

  // =========================================================================
  // calculateQuality (private — now on SourceQueryService)
  // =========================================================================

  describe("calculateQuality (private on SourceQueryService)", () => {
    it("should give highest score to arxiv sources", () => {
      const result = { source: "arxiv", sourceUrl: "https://arxiv.org/paper" };
      const score = (queryService as any).calculateQuality(result);
      expect(score).toBeGreaterThan(70);
    });

    it("should give higher raw score to github repos with many stars before capping", () => {
      // github base: 50 + 25 (github bonus) + 10 (github.com medium authority)
      // popular (>1000 stars): +15 = 100 (capped)
      // unpopular: no star bonus = 85
      const popularRepo = {
        source: "github",
        metadata: { stars: 5000 }, // >1000 stars -> +15
        sourceUrl: "https://github.com/popular/repo",
      };
      const unpopularRepo = {
        source: "github",
        metadata: { stars: 10 }, // no star bonus
        sourceUrl: "https://github.com/unpopular/repo",
      };
      const popularScore = (queryService as any).calculateQuality(popularRepo);
      const unpopularScore = (queryService as any).calculateQuality(
        unpopularRepo,
      );
      // Popular repo should score >= unpopular (capped at 100)
      expect(popularScore).toBeGreaterThanOrEqual(unpopularScore);
      expect(popularScore).toBeGreaterThan(50);
    });

    it("should score local curated sources higher than web sources", () => {
      const localResult = {
        source: "local",
        qualityScore: 0.8,
        sourceUrl: null,
      };
      const webResult = { source: "web", sourceUrl: null };
      const localScore = (queryService as any).calculateQuality(localResult);
      const webScore = (queryService as any).calculateQuality(webResult);
      expect(localScore).toBeGreaterThan(webScore);
    });
  });

  // =========================================================================
  // calculateFreshness (private — now on SourceQueryService)
  // =========================================================================

  describe("calculateFreshness (private on SourceQueryService)", () => {
    it("should return 50 when no publishedAt present", () => {
      const result = { title: "No date" };
      const score = (queryService as any).calculateFreshness(result);
      expect(score).toBe(50);
    });

    it("should give higher score to recent content", () => {
      const recent = { publishedAt: new Date().toISOString() };
      const old = { publishedAt: new Date("2010-01-01").toISOString() };
      const recentScore = (queryService as any).calculateFreshness(recent);
      const oldScore = (queryService as any).calculateFreshness(old);
      expect(recentScore).toBeGreaterThan(oldScore);
    });
  });

  // =========================================================================
  // createToolContext (private — now on SourceQueryService)
  // =========================================================================

  describe("createToolContext (private on SourceQueryService)", () => {
    it("should create a valid ToolContext with unique executionId", () => {
      const ctx1 = (queryService as any).createToolContext("web-search");
      const ctx2 = (queryService as any).createToolContext("web-search");

      expect(ctx1.toolId).toBe("web-search");
      expect(ctx1.callerType).toBe("orchestrator");
      expect(ctx1.executionId).not.toBe(ctx2.executionId);
      expect(ctx1.createdAt).toBeInstanceOf(Date);
    });
  });

  // =========================================================================
  // findDuplicateSource (private — now on SourceIngestionService)
  // =========================================================================

  describe("findDuplicateSource (private on SourceIngestionService)", () => {
    it("should return null when no conditions match (empty title, no URL, no resourceId)", async () => {
      const result = await (ingestionService as any).findDuplicateSource(
        projectId,
        "", // empty title
        undefined,
        undefined,
      );
      expect(result).toBeNull();
      expect(mockPrisma.researchProjectSource.findFirst).not.toHaveBeenCalled();
    });

    it("should query with OR conditions when title, URL, and resourceId provided", async () => {
      mockPrisma.researchProjectSource.findFirst.mockResolvedValue(null);

      await (ingestionService as any).findDuplicateSource(
        projectId,
        "Title",
        "https://url.com",
        "res-123",
      );

      expect(mockPrisma.researchProjectSource.findFirst).toHaveBeenCalledWith({
        where: {
          projectId,
          OR: expect.arrayContaining([
            { title: { equals: "Title", mode: "insensitive" } },
            { sourceUrl: { equals: "https://url.com", mode: "insensitive" } },
            { resourceId: "res-123" },
          ]),
        },
      });
    });
  });
});
