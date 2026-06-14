/**
 * Tests for ResearchProjectSourceService (thin facade)
 *
 * Since ResearchProjectSourceService is a thin facade that delegates to
 * SourceIngestionService, SourceQueryService, and SourceMetadataService,
 * we mock the sub-services directly.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, ForbiddenException } from "@nestjs/common";
import { ResearchProjectSourceService } from "../project/research-project-source.service";
import { SourceIngestionService } from "../project/source-ingestion.service";
import { SourceQueryService } from "../project/source-query.service";
import { SourceMetadataService } from "../project/source-metadata.service";

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
    brand: {
      userAgent: "TestAgent/1.0",
    },
  },
}));

jest.mock("axios", () => ({
  default: { get: jest.fn() },
}));

jest.mock("xml2js", () => ({
  parseStringPromise: jest.fn().mockResolvedValue({ feed: { entry: [] } }),
}));

describe("ResearchProjectSourceService", () => {
  let service: ResearchProjectSourceService;
  let ingestion: jest.Mocked<SourceIngestionService>;
  let query: jest.Mocked<SourceQueryService>;
  let metadata: jest.Mocked<SourceMetadataService>;

  const userId = "user-123";
  const projectId = "project-456";
  const sourceId = "source-789";

  const _mockProject = {
    id: projectId,
    userId,
    name: "Test Project",
    sourceCount: 5,
  };

  const mockSource = {
    id: sourceId,
    projectId,
    title: "Test Source",
    sourceType: "WEB",
    sourceUrl: "https://example.com/article",
    abstract: "Test abstract",
    content: "Test content",
    authors: ["Author 1"],
    publishedAt: new Date("2024-01-01"),
    metadata: {},
    resourceId: null,
    analysisStatus: "COMPLETED",
    aiSummary: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockIngestion = {
      addSource: jest.fn(),
      addSources: jest.fn(),
      uploadFiles: jest.fn(),
    };

    const mockQuery = {
      getSources: jest.fn(),
      getSource: jest.fn(),
      removeSource: jest.fn(),
      searchSources: jest.fn(),
    };

    const mockMetadata = {
      updateSourceAnalysis: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchProjectSourceService,
        { provide: SourceIngestionService, useValue: mockIngestion },
        { provide: SourceQueryService, useValue: mockQuery },
        { provide: SourceMetadataService, useValue: mockMetadata },
      ],
    }).compile();

    service = module.get<ResearchProjectSourceService>(
      ResearchProjectSourceService,
    );
    ingestion = module.get(SourceIngestionService);
    query = module.get(SourceQueryService);
    metadata = module.get(SourceMetadataService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("addSource", () => {
    it("should delegate to SourceIngestionService.addSource", async () => {
      (ingestion.addSource as jest.Mock).mockResolvedValue(mockSource);

      const result = await service.addSource(userId, projectId, {
        title: "Test Source",
        sourceType: "WEB",
        sourceUrl: "https://example.com/article",
        abstract: "Test abstract",
        content: "Test content",
      });

      expect(result).toBe(mockSource);
      expect(ingestion.addSource).toHaveBeenCalledWith(
        userId,
        projectId,
        expect.objectContaining({
          title: "Test Source",
          sourceType: "WEB",
        }),
      );
    });

    it("should propagate NotFoundException from sub-service", async () => {
      (ingestion.addSource as jest.Mock).mockRejectedValue(
        new NotFoundException("Project not found"),
      );

      await expect(
        service.addSource(userId, projectId, {
          title: "Test",
          sourceType: "WEB",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should propagate ForbiddenException from sub-service", async () => {
      (ingestion.addSource as jest.Mock).mockRejectedValue(
        new ForbiddenException("Access denied"),
      );

      await expect(
        service.addSource("non-owner", projectId, {
          title: "Test",
          sourceType: "WEB",
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should return existing source when sub-service returns duplicate", async () => {
      (ingestion.addSource as jest.Mock).mockResolvedValue(mockSource);

      const result = await service.addSource(userId, projectId, {
        title: "Test Source",
        sourceType: "WEB",
        sourceUrl: "https://example.com/article",
      });

      expect(result).toBe(mockSource);
    });

    it("should pass resourceId to sub-service", async () => {
      (ingestion.addSource as jest.Mock).mockResolvedValue(mockSource);

      await service.addSource(userId, projectId, {
        title: "Test Source",
        sourceType: "WEB",
        resourceId: "resource-123",
      });

      expect(ingestion.addSource).toHaveBeenCalledWith(
        userId,
        projectId,
        expect.objectContaining({ resourceId: "resource-123" }),
      );
    });
  });

  describe("addSources", () => {
    it("should delegate to SourceIngestionService.addSources", async () => {
      (ingestion.addSources as jest.Mock).mockResolvedValue([mockSource]);

      const result = await service.addSources(userId, projectId, [
        { title: "Source 1", sourceType: "WEB" },
        {
          title: "Test Source",
          sourceType: "WEB",
          sourceUrl: "https://example.com/article",
        },
      ]);

      expect(result).toHaveLength(1);
      expect(ingestion.addSources).toHaveBeenCalledWith(
        userId,
        projectId,
        expect.any(Array),
      );
    });

    it("should return empty array when sub-service returns empty", async () => {
      (ingestion.addSources as jest.Mock).mockResolvedValue([]);

      const result = await service.addSources(userId, projectId, [
        { title: "Test Source", sourceType: "WEB" },
      ]);

      expect(result).toEqual([]);
    });

    it("should propagate NotFoundException from sub-service", async () => {
      (ingestion.addSources as jest.Mock).mockRejectedValue(
        new NotFoundException("Project not found"),
      );

      await expect(service.addSources(userId, projectId, [])).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should propagate ForbiddenException from sub-service", async () => {
      (ingestion.addSources as jest.Mock).mockRejectedValue(
        new ForbiddenException("Access denied"),
      );

      await expect(
        service.addSources("non-owner", projectId, []),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should pass batch to sub-service", async () => {
      (ingestion.addSources as jest.Mock).mockResolvedValue([mockSource]);

      await service.addSources(userId, projectId, [
        { title: "Duplicate Title", sourceType: "WEB" },
        { title: "Duplicate Title", sourceType: "WEB" },
      ]);

      expect(ingestion.addSources).toHaveBeenCalledWith(
        userId,
        projectId,
        expect.any(Array),
      );
    });
  });

  describe("getSources", () => {
    it("should delegate to SourceQueryService.getSources", async () => {
      (query.getSources as jest.Mock).mockResolvedValue([mockSource]);

      const result = await service.getSources(userId, projectId);

      expect(result).toHaveLength(1);
      expect(query.getSources).toHaveBeenCalledWith(userId, projectId);
    });

    it("should propagate NotFoundException from sub-service", async () => {
      (query.getSources as jest.Mock).mockRejectedValue(
        new NotFoundException("Project not found"),
      );

      await expect(service.getSources(userId, projectId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should propagate ForbiddenException from sub-service", async () => {
      (query.getSources as jest.Mock).mockRejectedValue(
        new ForbiddenException("Access denied"),
      );

      await expect(service.getSources("non-owner", projectId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("getSource", () => {
    it("should delegate to SourceQueryService.getSource", async () => {
      (query.getSource as jest.Mock).mockResolvedValue(mockSource);

      const result = await service.getSource(userId, projectId, sourceId);

      expect(result).toBe(mockSource);
      expect(query.getSource).toHaveBeenCalledWith(userId, projectId, sourceId);
    });

    it("should propagate NotFoundException when source not found", async () => {
      (query.getSource as jest.Mock).mockRejectedValue(
        new NotFoundException("Source not found"),
      );

      await expect(
        service.getSource(userId, projectId, "nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should propagate NotFoundException when source belongs to different project", async () => {
      (query.getSource as jest.Mock).mockRejectedValue(
        new NotFoundException("Source not found"),
      );

      await expect(
        service.getSource(userId, projectId, sourceId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("removeSource", () => {
    it("should delegate to SourceQueryService.removeSource", async () => {
      (query.removeSource as jest.Mock).mockResolvedValue({ success: true });

      const result = await service.removeSource(userId, projectId, sourceId);

      expect(result).toEqual({ success: true });
      expect(query.removeSource).toHaveBeenCalledWith(
        userId,
        projectId,
        sourceId,
      );
    });

    it("should propagate NotFoundException when source not found", async () => {
      (query.removeSource as jest.Mock).mockRejectedValue(
        new NotFoundException("Source not found"),
      );

      await expect(
        service.removeSource(userId, projectId, "nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should propagate NotFoundException when project not found", async () => {
      (query.removeSource as jest.Mock).mockRejectedValue(
        new NotFoundException("Project not found"),
      );

      await expect(
        service.removeSource(userId, projectId, sourceId),
      ).rejects.toThrow(NotFoundException);
    });

    it("should propagate ForbiddenException from sub-service", async () => {
      (query.removeSource as jest.Mock).mockRejectedValue(
        new ForbiddenException("Access denied"),
      );

      await expect(
        service.removeSource("non-owner", projectId, sourceId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("searchSources", () => {
    it("should delegate to SourceQueryService.searchSources with quick mode", async () => {
      const mockResult = {
        mode: "quick",
        query: "AI technology",
        results: [],
        stats: { totalResults: 0, durationMs: 100 },
        sourcesSearched: ["web"],
      };
      (query.searchSources as jest.Mock).mockResolvedValue(mockResult);

      const result = await service.searchSources(userId, {
        query: "AI technology",
      });

      expect(result.mode).toBe("quick");
      expect(result.query).toBe("AI technology");
      expect(query.searchSources).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ query: "AI technology" }),
      );
    });

    it("should delegate deep mode to SourceQueryService.searchSources", async () => {
      const mockResult = {
        mode: "deep",
        query: "AI technology",
        results: [],
        stats: {
          totalResults: 0,
          durationMs: 200,
          searchRounds: 2,
          queriesExecuted: [],
        },
        sourcesSearched: ["local", "web"],
      };
      (query.searchSources as jest.Mock).mockResolvedValue(mockResult);

      const result = await service.searchSources(userId, {
        query: "AI technology",
        mode: "deep",
        sources: ["local", "web"],
      });

      expect(result.mode).toBe("deep");
      expect(result.stats).toHaveProperty("searchRounds");
    });

    it("should include stats in search results", async () => {
      const mockResult = {
        mode: "quick",
        query: "AI",
        results: [],
        stats: { totalResults: 0, durationMs: 50 },
        sourcesSearched: [],
      };
      (query.searchSources as jest.Mock).mockResolvedValue(mockResult);

      const result = await service.searchSources(userId, { query: "AI" });

      expect(result.stats).toBeDefined();
      expect(result.stats.totalResults).toBeDefined();
      expect(result.stats.durationMs).toBeDefined();
    });
  });

  describe("uploadFiles", () => {
    it("should delegate to SourceIngestionService.uploadFiles", async () => {
      const mockFile = {
        originalname: "test.pdf",
        buffer: Buffer.from("test"),
        mimetype: "application/pdf",
      } as Express.Multer.File;

      (ingestion.uploadFiles as jest.Mock).mockResolvedValue({
        sources: [{ ...mockSource, sourceType: "file" }],
        errors: [],
      });

      const result = await service.uploadFiles(userId, projectId, [mockFile]);

      expect(result.sources).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
      expect(ingestion.uploadFiles).toHaveBeenCalledWith(userId, projectId, [
        mockFile,
      ]);
    });

    it("should propagate errors from sub-service", async () => {
      (ingestion.uploadFiles as jest.Mock).mockResolvedValue({
        sources: [],
        errors: [{ fileName: "broken.pdf", error: "File parsing failed" }],
      });

      const result = await service.uploadFiles(userId, projectId, [
        {
          originalname: "broken.pdf",
          buffer: Buffer.from("test"),
        } as Express.Multer.File,
      ]);

      expect(result.sources).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].fileName).toBe("broken.pdf");
      expect(result.errors[0].error).toBe("File parsing failed");
    });

    it("should propagate NotFoundException from sub-service", async () => {
      (ingestion.uploadFiles as jest.Mock).mockRejectedValue(
        new NotFoundException("Project not found"),
      );

      await expect(service.uploadFiles(userId, projectId, [])).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should propagate ForbiddenException from sub-service", async () => {
      (ingestion.uploadFiles as jest.Mock).mockRejectedValue(
        new ForbiddenException("Access denied"),
      );

      await expect(
        service.uploadFiles("non-owner", projectId, []),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("updateSourceAnalysis", () => {
    it("should delegate to SourceMetadataService.updateSourceAnalysis", async () => {
      (metadata.updateSourceAnalysis as jest.Mock).mockResolvedValue({
        ...mockSource,
        analysisStatus: "ANALYZING",
      });

      await service.updateSourceAnalysis(sourceId, "ANALYZING");

      expect(metadata.updateSourceAnalysis).toHaveBeenCalledWith(
        sourceId,
        "ANALYZING",
        undefined,
        undefined,
      );
    });

    it("should pass AI summary to sub-service", async () => {
      (metadata.updateSourceAnalysis as jest.Mock).mockResolvedValue({
        ...mockSource,
        analysisStatus: "COMPLETED",
        aiSummary: "This is a summary",
      });

      await service.updateSourceAnalysis(
        sourceId,
        "COMPLETED",
        "This is a summary",
      );

      expect(metadata.updateSourceAnalysis).toHaveBeenCalledWith(
        sourceId,
        "COMPLETED",
        "This is a summary",
        undefined,
      );
    });

    it("should pass key insights to sub-service", async () => {
      const keyInsights = { points: ["Point 1", "Point 2"] };
      (metadata.updateSourceAnalysis as jest.Mock).mockResolvedValue({
        ...mockSource,
        analysisStatus: "COMPLETED",
      });

      await service.updateSourceAnalysis(
        sourceId,
        "COMPLETED",
        undefined,
        keyInsights as any,
      );

      expect(metadata.updateSourceAnalysis).toHaveBeenCalledWith(
        sourceId,
        "COMPLETED",
        undefined,
        keyInsights,
      );
    });
  });
});
