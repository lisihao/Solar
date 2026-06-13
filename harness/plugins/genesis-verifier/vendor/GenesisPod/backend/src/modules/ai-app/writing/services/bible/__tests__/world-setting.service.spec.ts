import { Test, TestingModule } from "@nestjs/testing";
import { WorldSettingService } from "../world-setting.service";
import { PrismaService } from "@/common/prisma/prisma.service";

describe("WorldSettingService", () => {
  let service: WorldSettingService;
  let mockPrisma: jest.Mocked<PrismaService>;

  const mockSetting = {
    id: "ws-1",
    bibleId: "bible-1",
    category: "geography",
    name: "皇宫",
    description: "金碧辉煌的皇宫",
    rules: ["禁止外人擅自进入", "宫女不得随意走动"],
    references: "位于城中心",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockPrisma = {
      worldSetting: {
        create: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorldSettingService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<WorldSettingService>(WorldSettingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("create", () => {
    it("should create a world setting with all fields", async () => {
      (mockPrisma.worldSetting.create as jest.Mock).mockResolvedValue(
        mockSetting,
      );

      const result = await service.create("bible-1", {
        category: "geography",
        name: "皇宫",
        description: "金碧辉煌的皇宫",
        rules: ["禁止外人擅自进入"],
        references: "位于城中心",
      });

      expect(mockPrisma.worldSetting.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          bibleId: "bible-1",
          category: "geography",
          name: "皇宫",
          description: "金碧辉煌的皇宫",
          rules: ["禁止外人擅自进入"],
          references: "位于城中心",
        }),
      });
      expect(result.id).toBe("ws-1");
    });

    it("should use empty array for rules when not provided", async () => {
      (mockPrisma.worldSetting.create as jest.Mock).mockResolvedValue({
        ...mockSetting,
        rules: [],
      });

      await service.create("bible-1", {
        category: "geography",
        name: "普通地点",
        description: "描述",
      });

      expect(mockPrisma.worldSetting.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ rules: [] }),
      });
    });

    it("should accept null references", async () => {
      (mockPrisma.worldSetting.create as jest.Mock).mockResolvedValue({
        ...mockSetting,
        references: null,
      });

      await service.create("bible-1", {
        category: "magic",
        name: "魔法体系",
        description: "描述",
      });

      expect(mockPrisma.worldSetting.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ references: undefined }),
      });
    });
  });

  describe("findAll", () => {
    it("should return all world settings ordered by createdAt", async () => {
      const settings = [
        { ...mockSetting, name: "皇宫" },
        { ...mockSetting, id: "ws-2", name: "御花园" },
      ];
      (mockPrisma.worldSetting.findMany as jest.Mock).mockResolvedValue(
        settings,
      );

      const result = await service.findAll("bible-1");

      expect(mockPrisma.worldSetting.findMany).toHaveBeenCalledWith({
        where: { bibleId: "bible-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toHaveLength(2);
    });

    it("should return empty array when no settings exist", async () => {
      (mockPrisma.worldSetting.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.findAll("bible-1");

      expect(result).toHaveLength(0);
    });
  });

  describe("findByCategory", () => {
    it("should return settings filtered by category", async () => {
      (mockPrisma.worldSetting.findMany as jest.Mock).mockResolvedValue([
        mockSetting,
      ]);

      const result = await service.findByCategory("bible-1", "geography");

      expect(mockPrisma.worldSetting.findMany).toHaveBeenCalledWith({
        where: { bibleId: "bible-1", category: "geography" },
      });
      expect(result).toHaveLength(1);
    });

    it("should return empty array when category has no settings", async () => {
      (mockPrisma.worldSetting.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.findByCategory("bible-1", "nonexistent");

      expect(result).toHaveLength(0);
    });
  });

  describe("update", () => {
    it("should update world setting", async () => {
      const updatedSetting = { ...mockSetting, description: "更新后的描述" };
      (mockPrisma.worldSetting.update as jest.Mock).mockResolvedValue(
        updatedSetting,
      );

      const result = await service.update("ws-1", {
        description: "更新后的描述",
      });

      expect(mockPrisma.worldSetting.update).toHaveBeenCalledWith({
        where: { id: "ws-1" },
        data: { description: "更新后的描述" },
      });
      expect(result.description).toBe("更新后的描述");
    });

    it("should update rules array", async () => {
      const newRules = ["规则1", "规则2", "规则3"];
      (mockPrisma.worldSetting.update as jest.Mock).mockResolvedValue({
        ...mockSetting,
        rules: newRules,
      });

      await service.update("ws-1", { rules: newRules });

      expect(mockPrisma.worldSetting.update).toHaveBeenCalledWith({
        where: { id: "ws-1" },
        data: { rules: newRules },
      });
    });

    it("should update category", async () => {
      (mockPrisma.worldSetting.update as jest.Mock).mockResolvedValue({
        ...mockSetting,
        category: "culture",
      });

      await service.update("ws-1", { category: "culture" });

      expect(mockPrisma.worldSetting.update).toHaveBeenCalledWith({
        where: { id: "ws-1" },
        data: { category: "culture" },
      });
    });
  });

  describe("delete", () => {
    it("should delete world setting by id", async () => {
      (mockPrisma.worldSetting.delete as jest.Mock).mockResolvedValue(
        mockSetting,
      );

      await service.delete("ws-1");

      expect(mockPrisma.worldSetting.delete).toHaveBeenCalledWith({
        where: { id: "ws-1" },
      });
    });

    it("should return the deleted setting", async () => {
      (mockPrisma.worldSetting.delete as jest.Mock).mockResolvedValue(
        mockSetting,
      );

      const result = await service.delete("ws-1");

      expect(result).toEqual(mockSetting);
    });

    it("should propagate errors from prisma", async () => {
      (mockPrisma.worldSetting.delete as jest.Mock).mockRejectedValue(
        new Error("Record not found"),
      );

      await expect(service.delete("nonexistent")).rejects.toThrow(
        "Record not found",
      );
    });
  });
});
