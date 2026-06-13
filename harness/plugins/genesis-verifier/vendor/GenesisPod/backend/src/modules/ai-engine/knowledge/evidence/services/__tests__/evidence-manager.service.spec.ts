/**
 * Evidence Manager Service Tests
 * 证据管理服务测试
 */

import { Test, TestingModule } from "@nestjs/testing";
import { EvidenceManagerService } from "../evidence-manager.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { CitationFormatterService } from "../citation-formatter.service";
import {
  SaveEvidenceRequest,
  RetrieveEvidenceRequest,
  Evidence,
  EvidenceType,
} from "../../abstractions/evidence.interface";
import { Evidence as PrismaEvidence } from "@prisma/client";

describe("EvidenceManagerService", () => {
  let service: EvidenceManagerService;
  let prisma: jest.Mocked<PrismaService>;
  let citationFormatter: jest.Mocked<CitationFormatterService>;

  // Mock 数据
  const mockDate = new Date("2025-01-01T00:00:00Z");

  const mockPrismaEvidence: PrismaEvidence = {
    id: "evidence-123",
    type: "CITATION",
    sourceUrl: "https://example.com/article",
    sourceTitle: "Test Article",
    sourceAuthor: "John Doe",
    sourcePublishedAt: mockDate,
    sourceDomain: "example.com",
    sourcePublisher: "Example Publisher",
    contentOriginal: "This is the original content",
    contentSnippet: "This is a snippet",
    contentUsedPortion: "This is used portion",
    entityType: "report",
    entityId: "report-123",
    location: "section-1",
    context: "Introduction",
    relevanceScore: 0.8,
    credibilityScore: 0.9,
    citationCount: 5,
    createdBy: "user-123",
    createdAt: mockDate,
    updatedAt: mockDate,
  };

  const mockSaveRequest: SaveEvidenceRequest = {
    type: "CITATION" as EvidenceType,
    source: {
      url: "https://example.com/article",
      title: "Test Article",
      author: "John Doe",
      publishedAt: mockDate,
      domain: "example.com",
      publisher: "Example Publisher",
    },
    content: {
      original: "This is the original content",
      snippet: "This is a snippet",
      usedPortion: "This is used portion",
    },
    associations: {
      entityType: "report",
      entityId: "report-123",
      location: "section-1",
      context: "Introduction",
    },
    relevanceScore: 0.8,
    credibilityScore: 0.9,
    createdBy: "user-123",
  };

  beforeEach(async () => {
    const mockPrismaService = {
      evidence: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const mockCitationFormatterService = {
      format: jest.fn(),
      formatBibliography: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvidenceManagerService,
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: CitationFormatterService,
          useValue: mockCitationFormatterService,
        },
      ],
    }).compile();

    service = module.get<EvidenceManagerService>(EvidenceManagerService);
    prisma = module.get(PrismaService);
    citationFormatter = module.get(CitationFormatterService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("save", () => {
    it("should create and return a single evidence record", async () => {
      // Arrange
      (prisma.evidence.create as jest.Mock).mockResolvedValue(
        mockPrismaEvidence,
      );

      // Act
      const result = await service.save(mockSaveRequest);

      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBe("evidence-123");
      expect(result.type).toBe("CITATION");
      expect(result.source.title).toBe("Test Article");
      expect(result.metadata.relevanceScore).toBe(0.8);
      expect(prisma.evidence.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: "CITATION",
          sourceUrl: "https://example.com/article",
          sourceTitle: "Test Article",
          entityType: "report",
          entityId: "report-123",
          relevanceScore: 0.8,
          citationCount: 0,
        }),
      });
    });

    it("should use default relevanceScore of 0.5 when not provided", async () => {
      // Arrange
      const requestWithoutScore: SaveEvidenceRequest = {
        ...mockSaveRequest,
        relevanceScore: undefined,
      };
      (prisma.evidence.create as jest.Mock).mockResolvedValue(
        mockPrismaEvidence,
      );

      // Act
      await service.save(requestWithoutScore);

      // Assert
      expect(prisma.evidence.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          relevanceScore: 0.5,
        }),
      });
    });

    it("should handle evidence without optional fields", async () => {
      // Arrange
      const minimalRequest: SaveEvidenceRequest = {
        type: "FACT" as EvidenceType,
        source: {
          title: "Minimal Source",
        },
        content: {
          original: "Minimal content",
        },
        associations: {
          entityType: "report",
          entityId: "report-456",
        },
      };

      const minimalPrismaEvidence: PrismaEvidence = {
        ...mockPrismaEvidence,
        id: "evidence-456",
        type: "FACT",
        sourceTitle: "Minimal Source",
        sourceUrl: null,
        sourceAuthor: null,
        sourcePublishedAt: null,
        sourceDomain: null,
        sourcePublisher: null,
        contentSnippet: null,
        contentUsedPortion: null,
        location: null,
        context: null,
        credibilityScore: null,
        createdBy: null,
        relevanceScore: 0.5,
      };

      (prisma.evidence.create as jest.Mock).mockResolvedValue(
        minimalPrismaEvidence,
      );

      // Act
      const result = await service.save(minimalRequest);

      // Assert
      expect(result).toBeDefined();
      expect(result.source.url).toBeUndefined();
      expect(result.source.author).toBeUndefined();
      expect(result.content.snippet).toBeUndefined();
    });

    it("should throw error when database operation fails", async () => {
      // Arrange
      (prisma.evidence.create as jest.Mock).mockRejectedValue(
        new Error("Database error"),
      );

      // Act & Assert
      await expect(service.save(mockSaveRequest)).rejects.toThrow(
        "Database error",
      );
    });
  });

  describe("saveBatch", () => {
    it("should save multiple evidence records in a single batch", async () => {
      // Arrange
      const requests: SaveEvidenceRequest[] = [
        mockSaveRequest,
        { ...mockSaveRequest, type: "REFERENCE" as EvidenceType },
        { ...mockSaveRequest, type: "QUOTE" as EvidenceType },
      ];

      const mockResults = [
        mockPrismaEvidence,
        { ...mockPrismaEvidence, id: "evidence-124", type: "REFERENCE" },
        { ...mockPrismaEvidence, id: "evidence-125", type: "QUOTE" },
      ];

      (prisma.$transaction as jest.Mock).mockImplementation(
        async (callback) => {
          return await callback({
            evidence: {
              create: jest.fn().mockImplementation((args) => {
                const index = mockResults.findIndex(
                  (r) => r.type === args.data.type,
                );
                return Promise.resolve(mockResults[index]);
              }),
            },
          });
        },
      );

      // Act
      const results = await service.saveBatch(requests);

      // Assert
      expect(results).toHaveLength(3);
      expect(results[0].type).toBe("CITATION");
      expect(results[1].type).toBe("REFERENCE");
      expect(results[2].type).toBe("QUOTE");
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        timeout: 30000,
      });
    });

    it("should handle batch size of exactly 100 items", async () => {
      // Arrange
      const requests: SaveEvidenceRequest[] = Array(100).fill(mockSaveRequest);
      const mockResults = Array(100)
        .fill(null)
        .map((_, i) => ({
          ...mockPrismaEvidence,
          id: `evidence-${i}`,
        }));

      (prisma.$transaction as jest.Mock).mockImplementation(
        async (callback) => {
          return await callback({
            evidence: {
              create: jest.fn().mockImplementation((_, index) => {
                return Promise.resolve(mockResults[index] || mockResults[0]);
              }),
            },
          });
        },
      );

      // Act
      const results = await service.saveBatch(requests);

      // Assert
      expect(results).toHaveLength(100);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("should split into multiple batches for more than 100 items", async () => {
      // Arrange
      const requests: SaveEvidenceRequest[] = Array(250).fill(mockSaveRequest);

      (prisma.$transaction as jest.Mock).mockImplementation(
        async (callback) => {
          return await callback({
            evidence: {
              create: jest.fn().mockResolvedValue(mockPrismaEvidence),
            },
          });
        },
      );

      // Act
      await service.saveBatch(requests);

      // Assert
      expect(prisma.$transaction).toHaveBeenCalledTimes(3); // 100 + 100 + 50
    });

    it("should handle empty batch gracefully", async () => {
      // Arrange
      const requests: SaveEvidenceRequest[] = [];

      // Act
      const results = await service.saveBatch(requests);

      // Assert
      expect(results).toEqual([]);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("should throw error and stop when a batch fails", async () => {
      // Arrange
      const requests: SaveEvidenceRequest[] = Array(150).fill(mockSaveRequest);

      (prisma.$transaction as jest.Mock)
        .mockResolvedValueOnce(
          Array(100)
            .fill(null)
            .map((_, i) => ({ ...mockPrismaEvidence, id: `evidence-${i}` })),
        )
        .mockRejectedValueOnce(new Error("Batch 2 failed"));

      // Act & Assert
      await expect(service.saveBatch(requests)).rejects.toThrow(
        "Batch 2 failed",
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it("should apply 30 second timeout to transaction", async () => {
      // Arrange
      const requests: SaveEvidenceRequest[] = [mockSaveRequest];

      (prisma.$transaction as jest.Mock).mockImplementation(
        async (callback) => {
          return await callback({
            evidence: {
              create: jest.fn().mockResolvedValue(mockPrismaEvidence),
            },
          });
        },
      );

      // Act
      await service.saveBatch(requests);

      // Assert
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        timeout: 30000,
      });
    });
  });

  describe("retrieve", () => {
    it("should retrieve evidence with all filters applied", async () => {
      // Arrange
      const request: RetrieveEvidenceRequest = {
        entityType: "report",
        entityId: "report-123",
        types: ["CITATION" as EvidenceType, "REFERENCE" as EvidenceType],
        minRelevanceScore: 0.7,
        minCredibilityScore: 0.8,
        limit: 10,
        offset: 0,
        sortBy: "relevance",
        sortOrder: "desc",
      };

      (prisma.evidence.findMany as jest.Mock).mockResolvedValue([
        mockPrismaEvidence,
      ]);

      // Act
      const results = await service.retrieve(request);

      // Assert
      expect(results).toHaveLength(1);
      expect(prisma.evidence.findMany).toHaveBeenCalledWith({
        where: {
          entityType: "report",
          entityId: "report-123",
          type: { in: ["CITATION", "REFERENCE"] },
          relevanceScore: { gte: 0.7 },
          credibilityScore: { gte: 0.8 },
        },
        orderBy: {
          relevanceScore: "desc",
        },
        take: 10,
        skip: 0,
      });
    });

    it("should use default values when optional parameters not provided", async () => {
      // Arrange
      const request: RetrieveEvidenceRequest = {};
      (prisma.evidence.findMany as jest.Mock).mockResolvedValue([]);

      // Act
      await service.retrieve(request);

      // Assert
      expect(prisma.evidence.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: "desc" },
        take: 50,
        skip: 0,
      });
    });

    it("should handle sortBy credibility", async () => {
      // Arrange
      const request: RetrieveEvidenceRequest = {
        sortBy: "credibility",
        sortOrder: "asc",
      };
      (prisma.evidence.findMany as jest.Mock).mockResolvedValue([]);

      // Act
      await service.retrieve(request);

      // Assert
      expect(prisma.evidence.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { credibilityScore: "asc" },
        take: 50,
        skip: 0,
      });
    });

    it("should handle sortBy createdAt", async () => {
      // Arrange
      const request: RetrieveEvidenceRequest = {
        sortBy: "createdAt",
      };
      (prisma.evidence.findMany as jest.Mock).mockResolvedValue([]);

      // Act
      await service.retrieve(request);

      // Assert
      expect(prisma.evidence.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: "desc" },
        take: 50,
        skip: 0,
      });
    });

    it("should return empty array when no results found", async () => {
      // Arrange
      (prisma.evidence.findMany as jest.Mock).mockResolvedValue([]);

      // Act
      const results = await service.retrieve({ entityId: "nonexistent" });

      // Assert
      expect(results).toEqual([]);
    });

    it("should handle pagination correctly", async () => {
      // Arrange
      const request: RetrieveEvidenceRequest = {
        limit: 25,
        offset: 50,
      };
      (prisma.evidence.findMany as jest.Mock).mockResolvedValue([]);

      // Act
      await service.retrieve(request);

      // Assert
      expect(prisma.evidence.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: "desc" },
        take: 25,
        skip: 50,
      });
    });
  });

  describe("getStats", () => {
    it("should calculate statistics correctly", async () => {
      // Arrange
      const mockEvidences = [
        {
          type: "CITATION",
          relevanceScore: 0.8,
          credibilityScore: 0.9,
        },
        {
          type: "CITATION",
          relevanceScore: 0.6,
          credibilityScore: 0.7,
        },
        {
          type: "REFERENCE",
          relevanceScore: 0.9,
          credibilityScore: 0.8,
        },
        {
          type: "FACT",
          relevanceScore: 0.7,
          credibilityScore: null,
        },
      ];

      (prisma.evidence.findMany as jest.Mock).mockResolvedValue(mockEvidences);

      // Act
      const stats = await service.getStats("report", "report-123");

      // Assert
      expect(stats.totalCount).toBe(4);
      expect(stats.byType.CITATION).toBe(2);
      expect(stats.byType.REFERENCE).toBe(1);
      expect(stats.byType.FACT).toBe(1);
      expect(stats.byType.QUOTE).toBe(0);
      expect(stats.byType.INSPIRATION).toBe(0);
      expect(stats.avgRelevanceScore).toBeCloseTo(0.75); // (0.8 + 0.6 + 0.9 + 0.7) / 4
      expect(stats.avgCredibilityScore).toBeCloseTo(0.8); // (0.9 + 0.7 + 0.8) / 3
    });

    it("should handle empty evidence list", async () => {
      // Arrange
      (prisma.evidence.findMany as jest.Mock).mockResolvedValue([]);

      // Act
      const stats = await service.getStats("report", "report-456");

      // Assert
      expect(stats.totalCount).toBe(0);
      expect(stats.byType.CITATION).toBe(0);
      expect(stats.byType.REFERENCE).toBe(0);
      expect(stats.avgRelevanceScore).toBe(0);
      expect(stats.avgCredibilityScore).toBe(0);
    });

    it("should handle evidence with no credibilityScore", async () => {
      // Arrange
      const mockEvidences = [
        {
          type: "CITATION",
          relevanceScore: 0.8,
          credibilityScore: null,
        },
        {
          type: "REFERENCE",
          relevanceScore: 0.9,
          credibilityScore: null,
        },
      ];

      (prisma.evidence.findMany as jest.Mock).mockResolvedValue(mockEvidences);

      // Act
      const stats = await service.getStats("report", "report-123");

      // Assert
      expect(stats.totalCount).toBe(2);
      expect(stats.avgRelevanceScore).toBeCloseTo(0.85);
      expect(stats.avgCredibilityScore).toBe(0);
    });

    it("should handle mixed credibilityScore values", async () => {
      // Arrange
      const mockEvidences = [
        {
          type: "CITATION",
          relevanceScore: 0.8,
          credibilityScore: 0.9,
        },
        {
          type: "REFERENCE",
          relevanceScore: 0.9,
          credibilityScore: null,
        },
        {
          type: "FACT",
          relevanceScore: 0.7,
          credibilityScore: 0.7,
        },
      ];

      (prisma.evidence.findMany as jest.Mock).mockResolvedValue(mockEvidences);

      // Act
      const stats = await service.getStats("report", "report-123");

      // Assert
      expect(stats.totalCount).toBe(3);
      expect(stats.avgRelevanceScore).toBeCloseTo(0.8);
      expect(stats.avgCredibilityScore).toBeCloseTo(0.8); // (0.9 + 0.7) / 2
    });

    it("should query with correct entityType and entityId", async () => {
      // Arrange
      (prisma.evidence.findMany as jest.Mock).mockResolvedValue([]);

      // Act
      await service.getStats("chapter", "chapter-789");

      // Assert
      expect(prisma.evidence.findMany).toHaveBeenCalledWith({
        where: { entityType: "chapter", entityId: "chapter-789" },
        select: {
          type: true,
          relevanceScore: true,
          credibilityScore: true,
        },
      });
    });
  });

  describe("mapToEvidence", () => {
    it("should correctly map PrismaEvidence to Evidence interface", async () => {
      // Arrange
      (prisma.evidence.create as jest.Mock).mockResolvedValue(
        mockPrismaEvidence,
      );

      // Act
      const result = await service.save(mockSaveRequest);

      // Assert
      expect(result).toMatchObject({
        id: "evidence-123",
        type: "CITATION",
        source: {
          url: "https://example.com/article",
          title: "Test Article",
          author: "John Doe",
          publishedAt: mockDate,
          domain: "example.com",
          publisher: "Example Publisher",
        },
        content: {
          original: "This is the original content",
          snippet: "This is a snippet",
          usedPortion: "This is used portion",
        },
        associations: {
          entityType: "report",
          entityId: "report-123",
          location: "section-1",
          context: "Introduction",
        },
        metadata: {
          relevanceScore: 0.8,
          credibilityScore: 0.9,
          citationCount: 5,
          createdAt: mockDate,
          updatedAt: mockDate,
          createdBy: "user-123",
        },
      });
    });

    it("should convert null values to undefined for optional fields", async () => {
      // Arrange
      const prismaEvidenceWithNulls: PrismaEvidence = {
        ...mockPrismaEvidence,
        sourceUrl: null,
        sourceAuthor: null,
        sourcePublishedAt: null,
        sourceDomain: null,
        sourcePublisher: null,
        contentSnippet: null,
        contentUsedPortion: null,
        location: null,
        context: null,
        credibilityScore: null,
        createdBy: null,
      };

      (prisma.evidence.create as jest.Mock).mockResolvedValue(
        prismaEvidenceWithNulls,
      );

      // Act
      const result = await service.save(mockSaveRequest);

      // Assert
      expect(result.source.url).toBeUndefined();
      expect(result.source.author).toBeUndefined();
      expect(result.source.publishedAt).toBeUndefined();
      expect(result.source.domain).toBeUndefined();
      expect(result.source.publisher).toBeUndefined();
      expect(result.content.snippet).toBeUndefined();
      expect(result.content.usedPortion).toBeUndefined();
      expect(result.associations.location).toBeUndefined();
      expect(result.associations.context).toBeUndefined();
      expect(result.metadata.credibilityScore).toBeUndefined();
      expect(result.metadata.createdBy).toBeUndefined();
    });
  });

  describe("getById", () => {
    it("should return evidence when found", async () => {
      // Arrange
      (prisma.evidence.findUnique as jest.Mock).mockResolvedValue(
        mockPrismaEvidence,
      );

      // Act
      const result = await service.getById("evidence-123");

      // Assert
      expect(result).toBeDefined();
      expect(result?.id).toBe("evidence-123");
      expect(prisma.evidence.findUnique).toHaveBeenCalledWith({
        where: { id: "evidence-123" },
      });
    });

    it("should return null when evidence not found", async () => {
      // Arrange
      (prisma.evidence.findUnique as jest.Mock).mockResolvedValue(null);

      // Act
      const result = await service.getById("nonexistent");

      // Assert
      expect(result).toBeNull();
    });
  });

  describe("update", () => {
    it("should update evidence source fields", async () => {
      // Arrange
      const updates: Partial<Evidence> = {
        source: {
          url: "https://newurl.com",
          title: "Updated Title",
          author: "Jane Smith",
        },
      };

      const updatedPrismaEvidence: PrismaEvidence = {
        ...mockPrismaEvidence,
        sourceUrl: "https://newurl.com",
        sourceTitle: "Updated Title",
        sourceAuthor: "Jane Smith",
      };

      (prisma.evidence.update as jest.Mock).mockResolvedValue(
        updatedPrismaEvidence,
      );

      // Act
      const result = await service.update("evidence-123", updates);

      // Assert
      expect(result.source.url).toBe("https://newurl.com");
      expect(result.source.title).toBe("Updated Title");
      expect(prisma.evidence.update).toHaveBeenCalledWith({
        where: { id: "evidence-123" },
        data: {
          sourceUrl: "https://newurl.com",
          sourceTitle: "Updated Title",
          sourceAuthor: "Jane Smith",
        },
      });
    });

    it("should update metadata scores", async () => {
      // Arrange
      const updates: Partial<Evidence> = {
        metadata: {
          relevanceScore: 0.95,
          credibilityScore: 0.85,
        } as Evidence["metadata"],
      };

      const updatedPrismaEvidence: PrismaEvidence = {
        ...mockPrismaEvidence,
        relevanceScore: 0.95,
        credibilityScore: 0.85,
      };

      (prisma.evidence.update as jest.Mock).mockResolvedValue(
        updatedPrismaEvidence,
      );

      // Act
      const result = await service.update("evidence-123", updates);

      // Assert
      expect(result.metadata.relevanceScore).toBe(0.95);
      expect(result.metadata.credibilityScore).toBe(0.85);
      expect(prisma.evidence.update).toHaveBeenCalledWith({
        where: { id: "evidence-123" },
        data: {
          relevanceScore: 0.95,
          credibilityScore: 0.85,
        },
      });
    });
  });

  describe("delete", () => {
    it("should delete evidence by id", async () => {
      // Arrange
      (prisma.evidence.delete as jest.Mock).mockResolvedValue(
        mockPrismaEvidence,
      );

      // Act
      await service.delete("evidence-123");

      // Assert
      expect(prisma.evidence.delete).toHaveBeenCalledWith({
        where: { id: "evidence-123" },
      });
    });
  });

  describe("incrementCitationCount", () => {
    it("should increment citation count", async () => {
      // Arrange
      (prisma.evidence.update as jest.Mock).mockResolvedValue({
        ...mockPrismaEvidence,
        citationCount: 6,
      });

      // Act
      await service.incrementCitationCount("evidence-123");

      // Assert
      expect(prisma.evidence.update).toHaveBeenCalledWith({
        where: { id: "evidence-123" },
        data: {
          citationCount: { increment: 1 },
        },
      });
    });
  });

  describe("formatCitation", () => {
    it("should delegate to CitationFormatterService", () => {
      // Arrange
      const mockEvidence: Evidence = {
        id: "evidence-123",
        type: "CITATION" as EvidenceType,
        source: {
          title: "Test",
          url: "https://example.com",
        },
        content: { original: "content" },
        associations: {
          entityType: "report",
          entityId: "report-123",
        },
        metadata: {
          relevanceScore: 0.8,
          citationCount: 0,
          createdAt: mockDate,
          updatedAt: mockDate,
        },
      };

      citationFormatter.format.mockReturnValue("Formatted citation");

      // Act
      const result = service.formatCitation(mockEvidence, "apa");

      // Assert
      expect(result).toBe("Formatted citation");
      expect(citationFormatter.format).toHaveBeenCalledWith(
        mockEvidence,
        "apa",
      );
    });
  });

  describe("generateBibliography", () => {
    it("should generate bibliography from citations and references", async () => {
      // Arrange
      (prisma.evidence.findMany as jest.Mock).mockResolvedValue([
        mockPrismaEvidence,
        { ...mockPrismaEvidence, id: "evidence-2", type: "REFERENCE" },
      ]);

      citationFormatter.format.mockImplementation(
        (evidence) => `Citation for ${evidence.id}`,
      );
      citationFormatter.formatBibliography.mockReturnValue(
        "References\n\nCitation for evidence-1\n\nCitation for evidence-2",
      );

      // Act
      const result = await service.generateBibliography(
        "report",
        "report-123",
        "apa",
      );

      // Assert
      expect(result).toContain("References");
      expect(citationFormatter.formatBibliography).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.stringContaining("Citation for"),
          expect.stringContaining("Citation for"),
        ]),
        "apa",
      );
    });

    it("should return empty string when no evidence found", async () => {
      // Arrange
      (prisma.evidence.findMany as jest.Mock).mockResolvedValue([]);

      // Act
      const result = await service.generateBibliography(
        "report",
        "report-999",
        "apa",
      );

      // Assert
      expect(result).toBe("");
      expect(citationFormatter.formatBibliography).not.toHaveBeenCalled();
    });

    it("should filter only CITATION and REFERENCE types", async () => {
      // Arrange
      (prisma.evidence.findMany as jest.Mock).mockResolvedValue([]);

      // Act
      await service.generateBibliography("report", "report-123", "mla");

      // Assert - The service calls retrieve() which builds the query internally
      expect(prisma.evidence.findMany).toHaveBeenCalledWith({
        where: {
          entityType: "report",
          entityId: "report-123",
          type: { in: ["CITATION", "REFERENCE"] },
        },
        orderBy: { createdAt: "asc" },
        take: 50,
        skip: 0,
      });
    });
  });
});


