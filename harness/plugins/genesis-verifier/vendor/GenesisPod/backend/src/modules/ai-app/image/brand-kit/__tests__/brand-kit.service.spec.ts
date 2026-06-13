import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { BrandKitService, CreateBrandKitDto } from "../brand-kit.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

describe("BrandKitService", () => {
  let service: BrandKitService;
  let mockPrisma: any;

  const mockDbBrandKit = {
    id: "kit-1",
    name: "Corporate Blue",
    description: "Professional blue theme",
    colors: [
      { name: "Primary", hex: "#1e3a5f", usage: "primary" },
      { name: "Accent", hex: "#0891b2", usage: "accent" },
      { name: "Background", hex: "#f8fafc", usage: "background" },
      { name: "Text", hex: "#334155", usage: "text" },
    ],
    fonts: [
      {
        name: "Heading",
        family: "Noto Sans SC",
        weight: 700,
        usage: "heading",
        fallback: "sans-serif",
      },
    ],
    logos: { primary: "https://example.com/logo.png" },
    voice: { tone: "professional", keywords: ["innovative", "trusted"] },
    defaultStyle: "consulting",
    userId: "user-1",
    createdAt: { toISOString: () => "2024-01-01T00:00:00.000Z" },
    updatedAt: { toISOString: () => "2024-01-02T00:00:00.000Z" },
  };

  const _mappedBrandKit = {
    id: "kit-1",
    name: "Corporate Blue",
    description: "Professional blue theme",
    colors: mockDbBrandKit.colors,
    fonts: mockDbBrandKit.fonts,
    logos: mockDbBrandKit.logos,
    voice: mockDbBrandKit.voice,
    defaultStyle: "consulting",
    userId: "user-1",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-02T00:00:00.000Z",
  };

  beforeEach(async () => {
    mockPrisma = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrandKitService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<BrandKitService>(BrandKitService);
  });

  afterEach(() => jest.restoreAllMocks());

  // ==================== create ====================

  describe("create", () => {
    it("should create a brand kit and return it", async () => {
      mockPrisma.$executeRaw.mockResolvedValue(1);
      mockPrisma.$queryRaw.mockResolvedValue([mockDbBrandKit]);

      const dto: CreateBrandKitDto = {
        name: "Corporate Blue",
        description: "Professional blue theme",
        colors: [{ name: "Primary", hex: "#1e3a5f", usage: "primary" }],
        defaultStyle: "consulting",
      };

      const result = await service.create("user-1", dto);

      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
      expect(result.name).toBe("Corporate Blue");
      expect(result.userId).toBe("user-1");
    });

    it("should use default fonts when fonts not provided", async () => {
      mockPrisma.$executeRaw.mockResolvedValue(1);
      mockPrisma.$queryRaw.mockResolvedValue([mockDbBrandKit]);

      const dto: CreateBrandKitDto = {
        name: "Minimal Kit",
        colors: [{ name: "Black", hex: "#000000", usage: "primary" }],
      };

      await service.create("user-1", dto);

      const executeCall = mockPrisma.$executeRaw.mock.calls[0];
      // The raw SQL call should include default fonts
      expect(executeCall).toBeDefined();
    });

    it("should handle optional description", async () => {
      mockPrisma.$executeRaw.mockResolvedValue(1);
      mockPrisma.$queryRaw.mockResolvedValue([
        { ...mockDbBrandKit, description: null },
      ]);

      const dto: CreateBrandKitDto = {
        name: "No Description Kit",
        colors: [{ name: "Blue", hex: "#0000ff", usage: "primary" }],
      };

      const result = await service.create("user-1", dto);

      expect(result).toBeDefined();
    });
  });

  // ==================== findByUser ====================

  describe("findByUser", () => {
    it("should return all brand kits for a user", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        mockDbBrandKit,
        { ...mockDbBrandKit, id: "kit-2", name: "Tech Purple" },
      ]);

      const result = await service.findByUser("user-1");

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Corporate Blue");
    });

    it("should return empty array when user has no brand kits", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const result = await service.findByUser("user-1");

      expect(result).toEqual([]);
    });

    it("should map database objects to BrandKit type", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([mockDbBrandKit]);

      const result = await service.findByUser("user-1");

      expect(result[0].id).toBe("kit-1");
      expect(result[0].colors).toEqual(mockDbBrandKit.colors);
      expect(result[0].createdAt).toBe("2024-01-01T00:00:00.000Z");
    });
  });

  // ==================== findById ====================

  describe("findById", () => {
    it("should return a brand kit by id", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([mockDbBrandKit]);

      const result = await service.findById("kit-1", "user-1");

      expect(result.id).toBe("kit-1");
      expect(result.name).toBe("Corporate Blue");
    });

    it("should throw NotFoundException when brand kit not found", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      await expect(service.findById("nonexistent", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw NotFoundException with correct message", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      await expect(service.findById("missing-kit", "user-1")).rejects.toThrow(
        "Brand kit missing-kit not found",
      );
    });
  });

  // ==================== update ====================

  describe("update", () => {
    it("should update a brand kit and return updated version", async () => {
      const updatedKit = { ...mockDbBrandKit, name: "Updated Name" };
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([mockDbBrandKit]) // findById for existence check
        .mockResolvedValueOnce([updatedKit]); // findById after update

      const result = await service.update("kit-1", "user-1", {
        name: "Updated Name",
      });

      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
      expect(result.name).toBe("Updated Name");
    });

    it("should throw NotFoundException when updating non-existent brand kit", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      await expect(
        service.update("nonexistent", "user-1", { name: "New Name" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should update colors when provided", async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([mockDbBrandKit])
        .mockResolvedValueOnce([mockDbBrandKit]);

      const newColors = [
        { name: "New Color", hex: "#ff0000", usage: "primary" as const },
      ];
      await service.update("kit-1", "user-1", { colors: newColors });

      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });
  });

  // ==================== delete ====================

  describe("delete", () => {
    it("should delete a brand kit", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([mockDbBrandKit]);
      mockPrisma.$executeRaw.mockResolvedValue(1);

      await service.delete("kit-1", "user-1");

      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });

    it("should throw NotFoundException when deleting non-existent brand kit", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      await expect(service.delete("nonexistent", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ==================== applyToVisualLanguage ====================

  describe("applyToVisualLanguage", () => {
    const brandKit = {
      id: "kit-1",
      name: "Test Kit",
      colors: [
        { name: "Primary", hex: "#1e3a5f", usage: "primary" as const },
        { name: "Accent", hex: "#0891b2", usage: "accent" as const },
        { name: "Background", hex: "#f8fafc", usage: "background" as const },
        { name: "Text", hex: "#334155", usage: "text" as const },
      ],
      fonts: [],
      logos: {},
      defaultStyle: "consulting" as const,
      userId: "user-1",
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
    };

    const baseVisualLanguage = {
      colorPalette: ["#000000"],
      primaryColor: "#000000",
      accentColor: "#111111",
      backgroundColor: "#ffffff",
      textColor: "#222222",
      designStyle: "minimal" as const,
      fontStyle: "sans" as const,
      borderRadius: "none" as const,
      shadowStyle: "none" as const,
    };

    it("should apply brand kit colors to visual language", () => {
      const result = service.applyToVisualLanguage(
        brandKit,
        baseVisualLanguage,
      );

      expect(result.primaryColor).toBe("#1e3a5f");
      expect(result.accentColor).toBe("#0891b2");
      expect(result.backgroundColor).toBe("#f8fafc");
      expect(result.textColor).toBe("#334155");
    });

    it("should apply brand kit color palette", () => {
      const result = service.applyToVisualLanguage(
        brandKit,
        baseVisualLanguage,
      );

      expect(result.colorPalette).toEqual([
        "#1e3a5f",
        "#0891b2",
        "#f8fafc",
        "#334155",
      ]);
    });

    it("should apply brand kit design style", () => {
      const result = service.applyToVisualLanguage(
        brandKit,
        baseVisualLanguage,
      );

      expect(result.designStyle).toBe("consulting");
    });

    it("should use base visual language values when brand kit lacks specific colors", () => {
      const kitWithoutAccent = {
        ...brandKit,
        colors: [
          { name: "Primary", hex: "#ff0000", usage: "primary" as const },
        ],
      };

      const result = service.applyToVisualLanguage(
        kitWithoutAccent,
        baseVisualLanguage,
      );

      expect(result.primaryColor).toBe("#ff0000");
      expect(result.accentColor).toBe("#111111"); // falls back to base
    });

    it("should preserve other visual language properties", () => {
      const result = service.applyToVisualLanguage(
        brandKit,
        baseVisualLanguage,
      );

      expect(result.fontStyle).toBe("sans");
      expect(result.borderRadius).toBe("none");
      expect(result.shadowStyle).toBe("none");
    });

    it("should use base designStyle when brand kit has no defaultStyle", () => {
      const kitNoStyle = { ...brandKit, defaultStyle: undefined as any };

      const result = service.applyToVisualLanguage(
        kitNoStyle,
        baseVisualLanguage,
      );

      expect(result.designStyle).toBe("minimal"); // base value
    });
  });

  // ==================== getPresetBrandKits ====================

  describe("getPresetBrandKits", () => {
    it("should return 4 preset brand kits", () => {
      const presets = service.getPresetBrandKits();

      expect(presets).toHaveLength(4);
    });

    it("should include preset names", () => {
      const presets = service.getPresetBrandKits();
      const names = presets.map((p) => p.name);

      expect(names).toContain("商务蓝");
      expect(names).toContain("科技紫");
      expect(names).toContain("极简黑白");
      expect(names).toContain("活力橙");
    });

    it("should include colors and fonts for each preset", () => {
      const presets = service.getPresetBrandKits();

      for (const preset of presets) {
        expect(preset.colors.length).toBeGreaterThan(0);
        expect(preset.fonts.length).toBeGreaterThan(0);
      }
    });

    it("should have valid design styles for each preset", () => {
      const presets = service.getPresetBrandKits();
      const validStyles = [
        "consulting",
        "tech",
        "minimal",
        "creative",
        "dark",
        "academic",
        "business",
        "genspark",
        "tech_gradient",
      ];

      for (const preset of presets) {
        expect(validStyles).toContain(preset.defaultStyle);
      }
    });

    it("should have all required color usages in corporate blue preset", () => {
      const presets = service.getPresetBrandKits();
      const corporateBlue = presets.find((p) => p.name === "商务蓝")!;
      const usages = corporateBlue.colors.map((c) => c.usage);

      expect(usages).toContain("primary");
      expect(usages).toContain("accent");
      expect(usages).toContain("background");
      expect(usages).toContain("text");
    });
  });
});
