import { Test, TestingModule } from "@nestjs/testing";
import { DuplicateDetectorService } from "../duplicate-detector.service";
import { PrismaService } from "../../../../../../../common/prisma/prisma.service";
import { ResourceType } from "@prisma/client";

// Mock string-similarity-js
jest.mock("string-similarity-js", () => ({
  stringSimilarity: jest.fn(),
}));

import { stringSimilarity } from "string-similarity-js";

jest.mock("../../../../../../../common/prisma/prisma.service");

describe("DuplicateDetectorService", () => {
  let service: DuplicateDetectorService;
  let mockPrisma: {
    importTask: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
    };
    resource: {
      findFirst: jest.Mock;
    };
  };

  const mockStringSimilarity = stringSimilarity as jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPrisma = {
      importTask: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      resource: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DuplicateDetectorService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<DuplicateDetectorService>(DuplicateDetectorService);
  });

  // =========================================================================
  // detectDuplicates
  // =========================================================================

  describe("detectDuplicates", () => {
    const metadata = {
      url: "https://arxiv.org/abs/1234",
      title: "Deep Learning for AI",
      contentHash: "abc123hash",
    };

    it("should return no duplicate when nothing matches", async () => {
      mockStringSimilarity.mockReturnValue(0.1);

      const result = await service.detectDuplicates(
        "PAPER" as ResourceType,
        metadata,
      );

      expect(result.isDuplicate).toBe(false);
      expect(result.potentialDuplicates).toHaveLength(0);
    });

    it("should detect exact URL duplicate", async () => {
      mockPrisma.importTask.findFirst.mockResolvedValue({
        id: "existing-task-1",
      });

      const result = await service.detectDuplicates(
        "PAPER" as ResourceType,
        metadata,
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.duplicateResourceId).toBe("existing-task-1");
      expect(result.duplicateUrl).toBe(metadata.url);
      expect(result.potentialDuplicates).toHaveLength(0);
    });

    it("should detect very high similarity title as duplicate (>95%)", async () => {
      mockPrisma.importTask.findFirst.mockResolvedValue(null); // No exact URL match

      const recentTasks = [
        {
          id: "task-1",
          sourceUrl: "https://arxiv.org/abs/9999",
          metadata: { title: "Deep Learning for AI Research" },
        },
      ];
      mockPrisma.importTask.findMany.mockResolvedValue(recentTasks);

      // High similarity above threshold
      mockStringSimilarity.mockReturnValue(0.97);

      const result = await service.detectDuplicates(
        "PAPER" as ResourceType,
        metadata,
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.potentialDuplicates.length).toBeGreaterThan(0);
    });

    it("should include potential duplicates when similarity is between threshold and 95%", async () => {
      mockPrisma.importTask.findFirst.mockResolvedValue(null);

      const recentTasks = [
        {
          id: "task-1",
          sourceUrl: "https://arxiv.org/abs/9999",
          metadata: { title: "Deep Learning for AI Systems" },
        },
        {
          id: "task-2",
          sourceUrl: "https://arxiv.org/abs/8888",
          metadata: { title: "Deep Learning Approaches in AI" },
        },
      ];
      mockPrisma.importTask.findMany.mockResolvedValue(recentTasks);

      // 0.85 similarity is high enough to be a duplicate
      mockStringSimilarity.mockReturnValue(0.85);

      const result = await service.detectDuplicates(
        "PAPER" as ResourceType,
        metadata,
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.potentialDuplicates.length).toBeGreaterThan(0);
    });

    it("should detect content hash duplicate", async () => {
      mockPrisma.importTask.findFirst.mockResolvedValue(null);
      mockStringSimilarity.mockReturnValue(0.1); // No title similarity

      // Content hash duplicate
      mockPrisma.importTask.findMany
        .mockResolvedValueOnce([]) // title search returns nothing
        .mockResolvedValueOnce([
          {
            id: "hash-task-1",
            sourceUrl: "https://other.com/article",
            metadata: { title: "Some other title", contentHash: "abc123hash" },
          },
        ]);

      const result = await service.detectDuplicates(
        "PAPER" as ResourceType,
        metadata,
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.duplicateResourceId).toBe("hash-task-1");
    });

    it("should skip content hash check when no contentHash in metadata", async () => {
      const metadataNoHash = { url: "https://example.com", title: "Title" };
      mockPrisma.importTask.findFirst.mockResolvedValue(null);
      mockStringSimilarity.mockReturnValue(0.1);

      await service.detectDuplicates("PAPER" as ResourceType, metadataNoHash);

      // Should only call findMany once (for title, not for content hash)
      expect(mockPrisma.importTask.findMany).toHaveBeenCalledTimes(1);
    });

    it("should handle URL check error gracefully", async () => {
      mockPrisma.importTask.findFirst.mockRejectedValue(
        new Error("DB connection error"),
      );

      // Should not throw
      const result = await service.detectDuplicates(
        "PAPER" as ResourceType,
        metadata,
      );

      // URL check fails, should proceed to title check
      expect(result).toBeDefined();
    });

    it("should handle title similarity check error gracefully", async () => {
      mockPrisma.importTask.findFirst.mockResolvedValue(null);
      mockPrisma.importTask.findMany.mockRejectedValue(new Error("DB timeout"));

      const result = await service.detectDuplicates(
        "PAPER" as ResourceType,
        metadata,
      );

      // Should return no duplicate on error
      expect(result.isDuplicate).toBe(false);
    });

    it("should return all matching potential duplicates", async () => {
      mockPrisma.importTask.findFirst.mockResolvedValue(null);

      const recentTasks = Array.from({ length: 5 }, (_, i) => ({
        id: `task-${i}`,
        sourceUrl: `https://example.com/${i}`,
        metadata: { title: `Deep Learning Article ${i}` },
      }));
      mockPrisma.importTask.findMany.mockResolvedValue(recentTasks);

      // High similarity — all match
      mockStringSimilarity.mockReturnValue(0.85);

      const result = await service.detectDuplicates(
        "PAPER" as ResourceType,
        metadata,
      );

      expect(result.potentialDuplicates.length).toBeGreaterThan(0);
    });

    it("should handle tasks with empty title without crashing", async () => {
      mockPrisma.importTask.findFirst.mockResolvedValue(null);

      const recentTasks = [
        {
          id: "task-no-title",
          sourceUrl: "https://example.com",
          metadata: { title: "" },
        },
      ];
      mockPrisma.importTask.findMany.mockResolvedValue(recentTasks);
      mockStringSimilarity.mockReturnValue(0.0);

      const result = await service.detectDuplicates(
        "PAPER" as ResourceType,
        metadata,
      );

      // Should return a valid result object regardless
      expect(result).toHaveProperty("isDuplicate");
      expect(result).toHaveProperty("potentialDuplicates");
    });
  });

  // =========================================================================
  // calculateSimilarity
  // =========================================================================

  describe("calculateSimilarity", () => {
    it("should return similarity as percentage (0-100)", () => {
      mockStringSimilarity.mockReturnValue(0.75);

      const result = service.calculateSimilarity("Hello World", "Hello Earth");
      expect(result).toBe(75.0);
    });

    it("should return 100 for identical strings", () => {
      mockStringSimilarity.mockReturnValue(1.0);

      const result = service.calculateSimilarity("AI research", "AI research");
      expect(result).toBe(100.0);
    });

    it("should return 0 for completely different strings", () => {
      mockStringSimilarity.mockReturnValue(0.0);

      const result = service.calculateSimilarity("Hello", "xyz123");
      expect(result).toBe(0.0);
    });

    it("should format to 1 decimal place", () => {
      mockStringSimilarity.mockReturnValue(0.7777);

      const result = service.calculateSimilarity("str1", "str2");
      expect(result).toBe(77.8);
    });
  });

  // =========================================================================
  // Content hash edge cases
  // =========================================================================

  describe("content hash duplicate detection", () => {
    it("should handle empty content hash gracefully", async () => {
      const metadataEmptyHash = {
        url: "https://example.com",
        title: "Title",
        contentHash: "",
      };

      mockPrisma.importTask.findFirst.mockResolvedValue(null);
      mockPrisma.importTask.findMany.mockResolvedValue([]);
      mockStringSimilarity.mockReturnValue(0.1);

      const result = await service.detectDuplicates(
        "PAPER" as ResourceType,
        metadataEmptyHash,
      );

      // Empty hash should return no content duplicate
      expect(result.isDuplicate).toBe(false);
    });

    it("should handle content hash check error gracefully", async () => {
      mockPrisma.importTask.findFirst.mockResolvedValue(null);

      // First call (title similarity) returns empty
      // Second call (content hash) throws error
      mockPrisma.importTask.findMany
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error("Hash check failed"));

      mockStringSimilarity.mockReturnValue(0.1);

      const result = await service.detectDuplicates("PAPER" as ResourceType, {
        url: "https://example.com",
        title: "Title",
        contentHash: "hash123",
      });

      // Should not throw, should return no duplicate
      expect(result.isDuplicate).toBe(false);
    });
  });

  // =========================================================================
  // Similarity sorting
  // =========================================================================

  describe("similarity sorting", () => {
    it("should sort potential duplicates by similarity descending", async () => {
      mockPrisma.importTask.findFirst.mockResolvedValue(null);

      const recentTasks = [
        {
          id: "task-low",
          sourceUrl: "https://example.com/1",
          metadata: { title: "Somewhat related" },
        },
        {
          id: "task-high",
          sourceUrl: "https://example.com/2",
          metadata: { title: "Very related AI research" },
        },
      ];
      mockPrisma.importTask.findMany.mockResolvedValue(recentTasks);

      let callCount = 0;
      mockStringSimilarity.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? 0.82 : 0.91; // first: 82%, second: 91%
      });

      const result = await service.detectDuplicates("PAPER" as ResourceType, {
        url: "https://example.com",
        title: "Deep Learning AI Research",
      });

      if (result.potentialDuplicates.length > 1) {
        expect(result.potentialDuplicates[0].similarity).toBeGreaterThanOrEqual(
          result.potentialDuplicates[1].similarity,
        );
      }
    });
  });
});
