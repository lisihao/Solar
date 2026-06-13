import { Test, TestingModule } from "@nestjs/testing";
import { TerminologyService } from "../terminology.service";
import { PrismaService } from "@/common/prisma/prisma.service";

describe("TerminologyService", () => {
  let service: TerminologyService;
  let mockPrisma: jest.Mocked<PrismaService>;

  const mockTerm = {
    id: "term-1",
    bibleId: "bible-1",
    term: "内功",
    definition: "一种修炼体内气息的功法",
    category: "武学",
    variants: ["内力", "真气"],
    usage: "修炼内功需要数年苦练",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockPrisma = {
      terminology: {
        create: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TerminologyService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TerminologyService>(TerminologyService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("create", () => {
    it("should create a terminology entry with all fields", async () => {
      (mockPrisma.terminology.create as jest.Mock).mockResolvedValue(mockTerm);

      const result = await service.create("bible-1", {
        term: "内功",
        definition: "一种修炼体内气息的功法",
        category: "武学",
        variants: ["内力", "真气"],
        usage: "修炼内功需要数年苦练",
      });

      expect(mockPrisma.terminology.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          bibleId: "bible-1",
          term: "内功",
          definition: "一种修炼体内气息的功法",
          category: "武学",
          variants: ["内力", "真气"],
        }),
      });
      expect(result.id).toBe("term-1");
    });

    it("should use empty array for variants when not provided", async () => {
      (mockPrisma.terminology.create as jest.Mock).mockResolvedValue({
        ...mockTerm,
        variants: [],
      });

      await service.create("bible-1", {
        term: "新词",
        definition: "定义",
        category: "分类",
      });

      expect(mockPrisma.terminology.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ variants: [] }),
      });
    });
  });

  describe("findAll", () => {
    it("should return all terminology ordered by term alphabetically", async () => {
      const terms = [
        { ...mockTerm, term: "内功" },
        { ...mockTerm, id: "term-2", term: "真气" },
      ];
      (mockPrisma.terminology.findMany as jest.Mock).mockResolvedValue(terms);

      const result = await service.findAll("bible-1");

      expect(mockPrisma.terminology.findMany).toHaveBeenCalledWith({
        where: { bibleId: "bible-1" },
        orderBy: { term: "asc" },
      });
      expect(result).toHaveLength(2);
    });

    it("should return empty array when no terms exist", async () => {
      (mockPrisma.terminology.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.findAll("bible-1");

      expect(result).toHaveLength(0);
    });
  });

  describe("findByCategory", () => {
    it("should return terms filtered by category", async () => {
      (mockPrisma.terminology.findMany as jest.Mock).mockResolvedValue([
        mockTerm,
      ]);

      const result = await service.findByCategory("bible-1", "武学");

      expect(mockPrisma.terminology.findMany).toHaveBeenCalledWith({
        where: { bibleId: "bible-1", category: "武学" },
      });
      expect(result).toHaveLength(1);
    });

    it("should return empty when category has no terms", async () => {
      (mockPrisma.terminology.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.findByCategory("bible-1", "不存在的分类");

      expect(result).toHaveLength(0);
    });
  });

  describe("search", () => {
    it("should search by term name (case-insensitive)", async () => {
      (mockPrisma.terminology.findMany as jest.Mock).mockResolvedValue([
        mockTerm,
      ]);

      const result = await service.search("bible-1", "内功");

      expect(mockPrisma.terminology.findMany).toHaveBeenCalledWith({
        where: {
          bibleId: "bible-1",
          OR: [
            { term: { contains: "内功", mode: "insensitive" } },
            { variants: { has: "内功" } },
          ],
        },
      });
      expect(result).toHaveLength(1);
    });

    it("should search by variant name", async () => {
      (mockPrisma.terminology.findMany as jest.Mock).mockResolvedValue([
        mockTerm,
      ]);

      await service.search("bible-1", "真气");

      expect(mockPrisma.terminology.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([{ variants: { has: "真气" } }]),
          }),
        }),
      );
    });

    it("should return empty array for non-matching query", async () => {
      (mockPrisma.terminology.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.search("bible-1", "不存在的词");

      expect(result).toHaveLength(0);
    });
  });

  describe("update", () => {
    it("should update terminology entry", async () => {
      const updatedTerm = { ...mockTerm, definition: "新的定义" };
      (mockPrisma.terminology.update as jest.Mock).mockResolvedValue(
        updatedTerm,
      );

      const result = await service.update("term-1", { definition: "新的定义" });

      expect(mockPrisma.terminology.update).toHaveBeenCalledWith({
        where: { id: "term-1" },
        data: { definition: "新的定义" },
      });
      expect(result.definition).toBe("新的定义");
    });

    it("should update variants", async () => {
      (mockPrisma.terminology.update as jest.Mock).mockResolvedValue({
        ...mockTerm,
        variants: ["内力", "真气", "元气"],
      });

      await service.update("term-1", { variants: ["内力", "真气", "元气"] });

      expect(mockPrisma.terminology.update).toHaveBeenCalledWith({
        where: { id: "term-1" },
        data: { variants: ["内力", "真气", "元气"] },
      });
    });
  });

  describe("delete", () => {
    it("should delete terminology entry by id", async () => {
      (mockPrisma.terminology.delete as jest.Mock).mockResolvedValue(mockTerm);

      await service.delete("term-1");

      expect(mockPrisma.terminology.delete).toHaveBeenCalledWith({
        where: { id: "term-1" },
      });
    });

    it("should return the deleted term", async () => {
      (mockPrisma.terminology.delete as jest.Mock).mockResolvedValue(mockTerm);

      const result = await service.delete("term-1");

      expect(result).toEqual(mockTerm);
    });
  });
});
