import { Test, TestingModule } from "@nestjs/testing";
import { HistoricalKnowledgeService } from "../historical-knowledge.service";
import { PrismaService } from "@/common/prisma/prisma.service";

describe("HistoricalKnowledgeService", () => {
  let service: HistoricalKnowledgeService;
  let mockPrisma: jest.Mocked<PrismaService>;

  const mockEntry = {
    id: "entry-1",
    dynasty: "秦朝",
    category: "称谓",
    term: "皇帝",
    definition: "秦始皇创立的最高统治者称号",
    correctUsage: "统治者称号",
    wrongUsage: null,
    examples: ["始皇帝"],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockPrisma = {
      writingHistoricalKnowledge: {
        count: jest.fn().mockResolvedValue(10), // prevent onModuleInit seeding
        upsert: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    } as unknown as jest.Mocked<PrismaService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HistoricalKnowledgeService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    // Run onModuleInit manually - count mock returns 10 so it won't seed
    service = module.get<HistoricalKnowledgeService>(
      HistoricalKnowledgeService,
    );
    await service.onModuleInit();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("onModuleInit", () => {
    it("should not seed data when count > 0", async () => {
      (
        mockPrisma.writingHistoricalKnowledge.count as jest.Mock
      ).mockResolvedValue(10);

      await service.onModuleInit();

      expect(
        mockPrisma.writingHistoricalKnowledge.upsert,
      ).not.toHaveBeenCalled();
    });

    it("should seed data when count is 0", async () => {
      (
        mockPrisma.writingHistoricalKnowledge.count as jest.Mock
      ).mockResolvedValue(0);

      await service.onModuleInit();

      expect(mockPrisma.writingHistoricalKnowledge.upsert).toHaveBeenCalled();
    });
  });

  describe("getKnowledgeByDynasty", () => {
    it("should return knowledge entries for a dynasty", async () => {
      (
        mockPrisma.writingHistoricalKnowledge.findMany as jest.Mock
      ).mockResolvedValue([mockEntry]);

      const result = await service.getKnowledgeByDynasty("秦朝");

      expect(
        mockPrisma.writingHistoricalKnowledge.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ dynasty: "秦朝" }),
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].term).toBe("皇帝");
    });

    it("should return empty array when no entries found", async () => {
      (
        mockPrisma.writingHistoricalKnowledge.findMany as jest.Mock
      ).mockResolvedValue([]);

      const result = await service.getKnowledgeByDynasty("不存在的朝代");

      expect(result).toHaveLength(0);
    });
  });

  describe("getKnowledgeByCategory", () => {
    it("should filter entries by dynasty and category", async () => {
      (
        mockPrisma.writingHistoricalKnowledge.findMany as jest.Mock
      ).mockResolvedValue([mockEntry]);

      const result = await service.getKnowledgeByCategory("秦朝", "称谓");

      expect(
        mockPrisma.writingHistoricalKnowledge.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ dynasty: "秦朝", category: "称谓" }),
        }),
      );
      expect(result).toHaveLength(1);
    });
  });

  describe("searchTerm", () => {
    it("should search knowledge by term", async () => {
      (
        mockPrisma.writingHistoricalKnowledge.findFirst as jest.Mock
      ).mockResolvedValue(mockEntry);

      const result = await service.searchTerm("皇帝");

      expect(result).toBeDefined();
      expect(result?.term).toBe("皇帝");
    });

    it("should return null when term not found", async () => {
      (
        mockPrisma.writingHistoricalKnowledge.findFirst as jest.Mock
      ).mockResolvedValue(null);

      const result = await service.searchTerm("不存在的词");

      expect(result).toBeNull();
    });
  });

  describe("detectHistoricalErrors", () => {
    it("should return error result with hasErrors property", async () => {
      (
        mockPrisma.writingHistoricalKnowledge.findMany as jest.Mock
      ).mockResolvedValue([]);

      const result = await service.detectHistoricalErrors(
        "皇上亲临，众人跪拜",
        "清朝",
      );

      expect(result).toHaveProperty("hasErrors");
      expect(result).toHaveProperty("errors");
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it("should detect no errors in content without anachronisms", async () => {
      (
        mockPrisma.writingHistoricalKnowledge.findMany as jest.Mock
      ).mockResolvedValue([]);

      const result = await service.detectHistoricalErrors(
        "皇上龙颜大悦",
        "清朝",
      );

      expect(result.hasErrors).toBe(false);
    });
  });

  describe("generateHistoricalConstraintPrompt", () => {
    it("should generate a prompt for a known dynasty", async () => {
      (
        mockPrisma.writingHistoricalKnowledge.findMany as jest.Mock
      ).mockResolvedValue([mockEntry]);

      const result = await service.generateHistoricalConstraintPrompt("秦朝");

      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("should return non-empty prompt even with empty knowledge entries", async () => {
      (
        mockPrisma.writingHistoricalKnowledge.findMany as jest.Mock
      ).mockResolvedValue([]);

      const result = await service.generateHistoricalConstraintPrompt("汉朝");

      expect(typeof result).toBe("string");
    });
  });

  describe("addKnowledgeEntry", () => {
    it("should create a new knowledge entry", async () => {
      const newEntry = {
        dynasty: "唐朝",
        category: "称谓",
        term: "圣人",
        definition: "唐代对皇帝的尊称",
        examples: ["圣人龙颜大悦"],
      };
      (
        mockPrisma.writingHistoricalKnowledge.create as jest.Mock
      ).mockResolvedValue({
        id: "new-entry",
        ...newEntry,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.addKnowledgeEntry(newEntry);

      expect(mockPrisma.writingHistoricalKnowledge.create).toHaveBeenCalled();
    });
  });

  describe("getKnowledgeStats", () => {
    it("should return statistics about knowledge base", async () => {
      (
        mockPrisma.writingHistoricalKnowledge.count as jest.Mock
      ).mockResolvedValue(50);
      (mockPrisma.writingHistoricalKnowledge.groupBy as jest.Mock)
        .mockResolvedValueOnce([
          { dynasty: "秦朝", _count: { dynasty: 10 } },
          { dynasty: "汉朝", _count: { dynasty: 20 } },
        ])
        .mockResolvedValueOnce([
          { category: "称谓", _count: { category: 15 } },
        ]);

      const result = await service.getKnowledgeStats();

      expect(result).toHaveProperty("totalEntries");
      expect(result).toHaveProperty("byDynasty");
      expect(result).toHaveProperty("byCategory");
    });
  });

  describe("detectDynastyFromWorldType", () => {
    it("should detect dynasty from world type keywords", () => {
      const result = service.detectDynastyFromWorldType("清朝宫廷故事");

      expect(result).toBeDefined();
    });

    it("should return null for unknown world type", () => {
      const result = service.detectDynastyFromWorldType("科幻世界");

      expect(result).toBeNull();
    });

    it("should return null for empty string", () => {
      const result = service.detectDynastyFromWorldType("");

      expect(result).toBeNull();
    });
  });

  describe("getSupportedDynasties", () => {
    it("should return an array of supported dynasty names", () => {
      const result = service.getSupportedDynasties();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
