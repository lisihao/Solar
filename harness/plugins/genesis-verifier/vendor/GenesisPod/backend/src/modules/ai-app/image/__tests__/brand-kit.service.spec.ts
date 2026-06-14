/**
 * BrandKitService Unit Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { BrandKitService } from "../brand-kit/brand-kit.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";

describe("BrandKitService", () => {
  let service: BrandKitService;

  const mockPrisma = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
  };

  const mockBrandKitRow = {
    id: "kit-001",
    name: "Business Blue",
    description: "Professional blue theme",
    colors: [
      { name: "Primary", hex: "#1e3a5f", usage: "primary" },
      { name: "Accent", hex: "#0891b2", usage: "accent" },
    ],
    fonts: [],
    logos: {},
    voice: null,
    defaultStyle: "consulting",
    userId: "user-001",
    createdAt: { toISOString: () => "2026-01-01T00:00:00Z" },
    updatedAt: { toISOString: () => "2026-01-01T00:00:00Z" },
  };

  const mockBrandKit = {
    id: "kit-001",
    name: "Business Blue",
    description: "Professional blue theme",
    colors: [
      { name: "Primary", hex: "#1e3a5f", usage: "primary" },
      { name: "Accent", hex: "#0891b2", usage: "accent" },
    ],
    fonts: [],
    logos: {},
    voice: undefined,
    defaultStyle: "consulting" as const,
    userId: "user-001",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrandKitService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<BrandKitService>(BrandKitService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ============ create ============

  describe("create", () => {
    it("should create a brand kit and return it", async () => {
      mockPrisma.$executeRaw.mockResolvedValue(1);
      mockPrisma.$queryRaw.mockResolvedValue([mockBrandKitRow]);

      const dto = {
        name: "Business Blue",
        description: "Professional blue theme",
        colors: [
          { name: "Primary", hex: "#1e3a5f", usage: "primary" as const },
        ],
      };

      const result = await service.create("user-001", dto);

      expect(result).toBeDefined();
      expect(result.name).toBe("Business Blue");
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it("should use default fonts when none provided", async () => {
      mockPrisma.$executeRaw.mockResolvedValue(1);
      mockPrisma.$queryRaw.mockResolvedValue([mockBrandKitRow]);

      await service.create("user-001", {
        name: "Test Kit",
        colors: [{ name: "Blue", hex: "#0000ff", usage: "primary" as const }],
      });

      // Verify $executeRaw was called (with default fonts in the query)
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });
  });

  // ============ findByUser ============

  describe("findByUser", () => {
    it("should return all brand kits for a user", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([mockBrandKitRow]);

      const result = await service.findByUser("user-001");

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Business Blue");
    });

    it("should return empty array when no brand kits found", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const result = await service.findByUser("user-empty");

      expect(result).toEqual([]);
    });
  });

  // ============ findById ============

  describe("findById", () => {
    it("should return brand kit by id", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([mockBrandKitRow]);

      const result = await service.findById("kit-001", "user-001");

      expect(result).toBeDefined();
      expect(result.id).toBe("kit-001");
    });

    it("should throw NotFoundException when brand kit not found", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      await expect(service.findById("not-found", "user-001")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ============ update ============

  describe("update", () => {
    it("should update a brand kit", async () => {
      // First call for findById validation, second for findById after update
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([mockBrandKitRow])
        .mockResolvedValueOnce([{ ...mockBrandKitRow, name: "Updated Name" }]);
      mockPrisma.$executeRaw.mockResolvedValue(1);

      const result = await service.update("kit-001", "user-001", {
        name: "Updated Name",
      });

      expect(result.name).toBe("Updated Name");
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it("should throw when brand kit not found for update", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      await expect(
        service.update("not-found", "user-001", { name: "New Name" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============ delete ============

  describe("delete", () => {
    it("should delete a brand kit", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([mockBrandKitRow]);
      mockPrisma.$executeRaw.mockResolvedValue(1);

      await service.delete("kit-001", "user-001");

      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it("should throw when brand kit not found for deletion", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      await expect(service.delete("not-found", "user-001")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ============ applyToVisualLanguage ============

  describe("applyToVisualLanguage", () => {
    it("should apply brand kit colors to visual language", () => {
      const brandKit = {
        ...mockBrandKit,
        colors: [
          { name: "Primary", hex: "#ff0000", usage: "primary" as const },
          { name: "Accent", hex: "#00ff00", usage: "accent" as const },
          { name: "Background", hex: "#ffffff", usage: "background" as const },
          { name: "Text", hex: "#000000", usage: "text" as const },
        ],
      };

      const baseVisualLanguage = {
        colorPalette: [],
        primaryColor: "#1e3a5f",
        accentColor: "#0891b2",
        backgroundColor: "#f7f9fc",
        textColor: "#1a202c",
      };

      const result = service.applyToVisualLanguage(
        brandKit,
        baseVisualLanguage,
      );

      expect(result.primaryColor).toBe("#ff0000");
      expect(result.accentColor).toBe("#00ff00");
      expect(result.backgroundColor).toBe("#ffffff");
      expect(result.textColor).toBe("#000000");
      expect(result.colorPalette).toEqual([
        "#ff0000",
        "#00ff00",
        "#ffffff",
        "#000000",
      ]);
    });

    it("should fall back to base colors when usage not found in brand kit", () => {
      const brandKit = {
        ...mockBrandKit,
        colors: [
          // No primary/accent/background/text usage colors
          {
            name: "Decorative",
            hex: "#ffaa00",
            usage: "custom" as unknown as "primary",
          },
        ],
      };

      const baseVisualLanguage = {
        colorPalette: [],
        primaryColor: "#1e3a5f",
        accentColor: "#0891b2",
        backgroundColor: "#f7f9fc",
        textColor: "#1a202c",
      };

      const result = service.applyToVisualLanguage(
        brandKit,
        baseVisualLanguage,
      );

      expect(result.primaryColor).toBe("#1e3a5f"); // fell back to base
      expect(result.accentColor).toBe("#0891b2"); // fell back to base
    });

    it("should override designStyle with brand kit defaultStyle", () => {
      const brandKit = { ...mockBrandKit, defaultStyle: "tech" as const };

      const baseVisualLanguage = {
        colorPalette: [],
        designStyle: "consulting",
      };

      const result = service.applyToVisualLanguage(
        brandKit,
        baseVisualLanguage as Parameters<
          typeof service.applyToVisualLanguage
        >[1],
      );

      expect(result.designStyle).toBe("tech");
    });
  });

  // ============ getPresetBrandKits ============

  describe("getPresetBrandKits", () => {
    it("should return 4 preset brand kits", () => {
      const presets = service.getPresetBrandKits();

      expect(presets).toHaveLength(4);
    });

    it("should return preset kits with required fields", () => {
      const presets = service.getPresetBrandKits();

      for (const preset of presets) {
        expect(preset.name).toBeDefined();
        expect(preset.colors).toBeDefined();
        expect(preset.colors.length).toBeGreaterThan(0);
        expect(preset.fonts).toBeDefined();
        expect(preset.defaultStyle).toBeDefined();
      }
    });

    it("should return business blue preset as first item", () => {
      const presets = service.getPresetBrandKits();

      expect(presets[0].name).toBe("商务蓝");
      expect(presets[0].defaultStyle).toBe("consulting");
    });

    it("should have colors with valid usage values", () => {
      const presets = service.getPresetBrandKits();
      const validUsages = ["primary", "accent", "background", "text"];

      for (const preset of presets) {
        for (const color of preset.colors) {
          expect(validUsages).toContain(color.usage);
          expect(color.hex).toMatch(/^#[0-9a-fA-F]{6}$/);
        }
      }
    });
  });
});
