/**
 * TopicDimensionService Unit Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { TopicDimensionService } from "../topic-dimension.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { NotFoundException, ForbiddenException } from "@nestjs/common";
import { DimensionStatus, ResearchTopicType } from "@prisma/client";

// ─── Mocks ───────────────────────────────────────────────────────────────────

function buildMocks() {
  const mockPrisma = {
    researchTopic: {
      findUnique: jest.fn(),
    },
    topicDimension: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(async (ops: unknown[]) => {
      if (Array.isArray(ops)) {
        return Promise.all(ops);
      }
      return (ops as (tx: unknown) => Promise<unknown>)(mockPrisma);
    }),
    $queryRaw: jest
      .fn()
      .mockResolvedValue([{ visibility: "PRIVATE", is_collaborator: false }]),
  };

  return { mockPrisma };
}

const mockTopic = {
  id: "topic-1",
  userId: "user-1",
  visibility: "PRIVATE",
};

const mockDimension = {
  id: "dim-1",
  topicId: "topic-1",
  name: "Market Analysis",
  description: "Market research",
  sortOrder: 1,
  isEnabled: true,
  status: DimensionStatus.PENDING,
  searchQueries: [],
  searchSources: [],
  minSources: 5,
  analyses: [],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TopicDimensionService", () => {
  let service: TopicDimensionService;
  let prisma: ReturnType<typeof buildMocks>["mockPrisma"];

  beforeEach(async () => {
    const mocks = buildMocks();
    prisma = mocks.mockPrisma;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicDimensionService,
        { provide: PrismaService, useValue: mocks.mockPrisma },
      ],
    }).compile();

    service = module.get<TopicDimensionService>(TopicDimensionService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── listDimensions ─────────────────────────────────────────────────────────

  describe("listDimensions", () => {
    it("should throw NotFoundException when topic not found", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(null);

      await expect(
        service.listDimensions("user-1", "nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should return dimensions with flattened analysis data", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      prisma.topicDimension.findMany.mockResolvedValue([
        {
          ...mockDimension,
          analyses: [
            {
              id: "analysis-1",
              summary: "Market growing",
              keyFindings: ["Finding 1"],
              dataPoints: {
                dimensionAnalysis: "detailed",
                detailedContent: "content",
              },
            },
          ],
        },
      ]);

      const result = await service.listDimensions("user-1", "topic-1");
      expect(result).toHaveLength(1);
      expect(result[0].dataPoints).not.toBeNull();
      expect(result[0].analyses).toBeUndefined();
    });

    it("should return dimensions with null dataPoints when no analysis", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      prisma.topicDimension.findMany.mockResolvedValue([
        { ...mockDimension, analyses: [] },
      ]);

      const result = await service.listDimensions("user-1", "topic-1");
      expect(result[0].dataPoints).toBeNull();
    });
  });

  // ─── addDimension ───────────────────────────────────────────────────────────

  describe("addDimension", () => {
    it("should throw NotFoundException when topic not found for ownership check", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(null);

      await expect(
        service.addDimension("user-1", "nonexistent", {
          name: "New Dim",
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException for non-owner", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({
        userId: "other-user",
      });

      await expect(
        service.addDimension("user-1", "topic-1", { name: "New Dim" } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should create dimension with auto-calculated sortOrder", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      prisma.topicDimension.findFirst.mockResolvedValue({ sortOrder: 3 });
      prisma.topicDimension.create.mockResolvedValue({
        ...mockDimension,
        id: "dim-new",
        sortOrder: 4,
      });

      const result = await service.addDimension("user-1", "topic-1", {
        name: "New Dimension",
        description: "New analysis",
      } as any);

      expect(result.id).toBe("dim-new");
      expect(prisma.topicDimension.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sortOrder: 4,
            name: "New Dimension",
          }),
        }),
      );
    });

    it("should use sortOrder=1 when no existing dimensions", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      prisma.topicDimension.findFirst.mockResolvedValue(null);
      prisma.topicDimension.create.mockResolvedValue({
        ...mockDimension,
        sortOrder: 1,
      });

      await service.addDimension("user-1", "topic-1", {
        name: "First Dim",
      } as any);

      expect(prisma.topicDimension.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sortOrder: 1 }),
        }),
      );
    });
  });

  // ─── updateDimension ────────────────────────────────────────────────────────

  describe("updateDimension", () => {
    it("should throw NotFoundException when dimension not found in topic", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      prisma.topicDimension.findFirst.mockResolvedValue(null);

      await expect(
        service.updateDimension("user-1", "topic-1", "dim-nonexistent", {
          name: "Updated",
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it("should update dimension successfully", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      prisma.topicDimension.findFirst.mockResolvedValue(mockDimension);
      prisma.topicDimension.update.mockResolvedValue({
        ...mockDimension,
        name: "Updated Name",
      });

      const result = await service.updateDimension(
        "user-1",
        "topic-1",
        "dim-1",
        { name: "Updated Name" } as any,
      );
      expect(result.name).toBe("Updated Name");
    });
  });

  // ─── deleteDimension ────────────────────────────────────────────────────────

  describe("deleteDimension", () => {
    it("should throw NotFoundException when dimension not found", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      prisma.topicDimension.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteDimension("user-1", "topic-1", "dim-nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should delete dimension successfully", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      prisma.topicDimension.findFirst.mockResolvedValue(mockDimension);
      prisma.topicDimension.delete.mockResolvedValue({});

      const result = await service.deleteDimension(
        "user-1",
        "topic-1",
        "dim-1",
      );
      expect(result.success).toBe(true);
      expect(prisma.topicDimension.delete).toHaveBeenCalledWith({
        where: { id: "dim-1" },
      });
    });
  });

  // ─── reorderDimensions ──────────────────────────────────────────────────────

  describe("reorderDimensions", () => {
    it("should throw NotFoundException when some dimensions not found", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      prisma.topicDimension.findMany.mockResolvedValue([]); // no dims found

      await expect(
        service.reorderDimensions("user-1", "topic-1", {
          dimensionIds: ["dim-1", "dim-2"],
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it("should reorder dimensions in transaction", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      prisma.topicDimension.findMany.mockResolvedValue([
        { id: "dim-1" },
        { id: "dim-2" },
      ]);
      prisma.topicDimension.update.mockResolvedValue({});

      const result = await service.reorderDimensions("user-1", "topic-1", {
        dimensionIds: ["dim-1", "dim-2"],
      } as any);
      expect(result.success).toBe(true);
    });
  });

  // ─── getTemplates ───────────────────────────────────────────────────────────

  describe("getTemplates", () => {
    it("should return MACRO templates", async () => {
      const result = await service.getTemplates({
        type: ResearchTopicType.MACRO,
      } as any);
      expect(result.type).toBe(ResearchTopicType.MACRO);
      expect(Array.isArray(result.dimensions)).toBe(true);
    });

    it("should return TECHNOLOGY templates", async () => {
      const result = await service.getTemplates({
        type: ResearchTopicType.TECHNOLOGY,
      } as any);
      expect(result.type).toBe(ResearchTopicType.TECHNOLOGY);
    });

    it("should return COMPANY templates", async () => {
      const result = await service.getTemplates({
        type: ResearchTopicType.COMPANY,
      } as any);
      expect(result.type).toBe(ResearchTopicType.COMPANY);
    });

    it("should throw for unknown topic type", async () => {
      await expect(
        service.getTemplates({
          type: "UNKNOWN_TYPE" as ResearchTopicType,
        } as any),
      ).rejects.toThrow("Unknown topic type");
    });
  });

  // ─── refreshDimension / createFromTemplate ──────────────────────────────────

  describe("refreshDimension", () => {
    it("should throw Not implemented error", async () => {
      await expect(
        service.refreshDimension("user-1", "topic-1", "dim-1", {} as any),
      ).rejects.toThrow("is not yet implemented");
    });
  });

  describe("createFromTemplate", () => {
    it("should throw Not implemented error", async () => {
      await expect(
        service.createFromTemplate("user-1", {} as any),
      ).rejects.toThrow("is not yet implemented");
    });
  });
});
