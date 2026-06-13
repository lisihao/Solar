/**
 * TemplateManagerService unit tests
 *
 * Covers:
 * - getTemplates – filter by category, format, sourceType, includePublic
 * - getTemplate – found, not found, access denied
 * - getDefaultTemplate – default found, fallback to builtIn, null
 * - createTemplate – success
 * - updateTemplate – not found, built-in blocked, wrong owner, success
 * - deleteTemplate – not found, built-in blocked, wrong owner, success
 * - duplicateTemplate – not found, success with/without custom name
 * - getThemeAndLayout – with templateId, without templateId, with customTheme/customLayout
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger, NotFoundException, ForbiddenException } from "@nestjs/common";
import { ExportFormat, ExportTemplateCategory } from "@prisma/client";
import { TemplateManagerService } from "../template-manager.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { DEFAULT_THEME, DEFAULT_LAYOUT } from "../../types/theme-config";
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  TemplateQueryDto,
} from "../../types/export-options";

// ─── helpers ─────────────────────────────────────────────────────────────────

const makeTemplate = (overrides: Record<string, unknown> = {}) => ({
  id: "tpl-1",
  name: "Default Template",
  description: "A template",
  category: ExportTemplateCategory.RESEARCH,
  themeConfig: DEFAULT_THEME,
  layoutConfig: DEFAULT_LAYOUT,
  styleConfig: {},
  supportedFormats: [ExportFormat.PDF],
  supportedSources: ["RESEARCH"],
  isBuiltIn: false,
  isDefault: false,
  isPublic: false,
  previewImage: undefined,
  version: 1,
  userId: "user-1",
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

// ─── tests ───────────────────────────────────────────────────────────────────

describe("TemplateManagerService", () => {
  let service: TemplateManagerService;
  let mockPrisma: {
    exportTemplate: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(async () => {
    mockPrisma = {
      exportTemplate: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(makeTemplate()),
        update: jest.fn().mockResolvedValue(makeTemplate()),
        delete: jest.fn().mockResolvedValue(makeTemplate()),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplateManagerService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TemplateManagerService>(TemplateManagerService);
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getTemplates
  // ──────────────────────────────────────────────────────────────────────────

  describe("getTemplates", () => {
    it("returns formatted templates for user", async () => {
      mockPrisma.exportTemplate.findMany.mockResolvedValue([
        makeTemplate({ id: "tpl-1" }),
        makeTemplate({ id: "tpl-2", isBuiltIn: true }),
      ]);

      const result = await service.getTemplates("user-1", {});

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("tpl-1");
    });

    it("builds where clause with category filter", async () => {
      await service.getTemplates("user-1", {
        category: ExportTemplateCategory.RESEARCH,
      });

      const callArgs = mockPrisma.exportTemplate.findMany.mock.calls[0][0];
      expect(callArgs.where.category).toBe(ExportTemplateCategory.RESEARCH);
    });

    it("builds where clause with format filter", async () => {
      await service.getTemplates("user-1", { format: ExportFormat.PDF });

      const callArgs = mockPrisma.exportTemplate.findMany.mock.calls[0][0];
      expect(callArgs.where.supportedFormats).toEqual({
        has: ExportFormat.PDF,
      });
    });

    it("builds where clause with sourceType filter", async () => {
      const query: TemplateQueryDto = { sourceType: "RESEARCH" as never };
      await service.getTemplates("user-1", query);

      const callArgs = mockPrisma.exportTemplate.findMany.mock.calls[0][0];
      expect(callArgs.where.supportedSources).toBeDefined();
    });

    it("includes public templates when includePublic is true", async () => {
      await service.getTemplates("user-1", { includePublic: true });

      const callArgs = mockPrisma.exportTemplate.findMany.mock.calls[0][0];
      const orClause = callArgs.where.OR;
      expect(orClause).toContainEqual({ isPublic: true });
    });

    it("returns empty array when no templates exist", async () => {
      mockPrisma.exportTemplate.findMany.mockResolvedValue([]);

      const result = await service.getTemplates("user-1", {});
      expect(result).toEqual([]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getTemplate
  // ──────────────────────────────────────────────────────────────────────────

  describe("getTemplate", () => {
    it("throws NotFoundException when template not found", async () => {
      mockPrisma.exportTemplate.findUnique.mockResolvedValue(null);

      await expect(
        service.getTemplate("nonexistent", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("returns template when user is owner", async () => {
      mockPrisma.exportTemplate.findUnique.mockResolvedValue(
        makeTemplate({ userId: "user-1" }),
      );

      const result = await service.getTemplate("tpl-1", "user-1");
      expect(result.id).toBe("tpl-1");
    });

    it("returns template when it is built-in regardless of owner", async () => {
      mockPrisma.exportTemplate.findUnique.mockResolvedValue(
        makeTemplate({ isBuiltIn: true, userId: "other-user" }),
      );

      const result = await service.getTemplate("tpl-1", "user-1");
      expect(result).toBeDefined();
    });

    it("returns template when it is public", async () => {
      mockPrisma.exportTemplate.findUnique.mockResolvedValue(
        makeTemplate({ isPublic: true, userId: "other-user" }),
      );

      const result = await service.getTemplate("tpl-1", "user-1");
      expect(result).toBeDefined();
    });

    it("throws ForbiddenException when template is private and user is not owner", async () => {
      mockPrisma.exportTemplate.findUnique.mockResolvedValue(
        makeTemplate({ isBuiltIn: false, isPublic: false, userId: "owner-id" }),
      );

      await expect(service.getTemplate("tpl-1", "user-1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getDefaultTemplate
  // ──────────────────────────────────────────────────────────────────────────

  describe("getDefaultTemplate", () => {
    it("returns default template when found", async () => {
      const tpl = makeTemplate({ isDefault: true });
      mockPrisma.exportTemplate.findFirst.mockResolvedValue(tpl);

      const result = await service.getDefaultTemplate(
        ExportTemplateCategory.RESEARCH,
      );
      expect(result).not.toBeNull();
      expect(result!.id).toBe("tpl-1");
    });

    it("falls back to built-in template when no default exists", async () => {
      mockPrisma.exportTemplate.findFirst
        .mockResolvedValueOnce(null) // no default
        .mockResolvedValueOnce(makeTemplate({ isBuiltIn: true })); // built-in fallback

      const result = await service.getDefaultTemplate(
        ExportTemplateCategory.RESEARCH,
      );
      expect(result).not.toBeNull();
    });

    it("returns null when neither default nor built-in template exists", async () => {
      mockPrisma.exportTemplate.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await service.getDefaultTemplate(
        ExportTemplateCategory.RESEARCH,
      );
      expect(result).toBeNull();
    });

    it("passes format filter to query when format is provided", async () => {
      mockPrisma.exportTemplate.findFirst.mockResolvedValue(
        makeTemplate({ isDefault: true }),
      );

      await service.getDefaultTemplate(
        ExportTemplateCategory.RESEARCH,
        ExportFormat.PDF,
      );

      const callArgs = mockPrisma.exportTemplate.findFirst.mock.calls[0][0];
      expect(callArgs.where.supportedFormats).toEqual({
        has: ExportFormat.PDF,
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // createTemplate
  // ──────────────────────────────────────────────────────────────────────────

  describe("createTemplate", () => {
    it("creates template and returns formatted response", async () => {
      const created = makeTemplate({ name: "My Template" });
      mockPrisma.exportTemplate.create.mockResolvedValue(created);

      const dto: CreateTemplateDto = {
        name: "My Template",
        category: ExportTemplateCategory.RESEARCH,
        themeConfig: DEFAULT_THEME,
        layoutConfig: DEFAULT_LAYOUT,
        supportedFormats: [ExportFormat.PDF],
        supportedSources: ["RESEARCH" as never],
        isPublic: false,
      };

      const result = await service.createTemplate("user-1", dto);

      expect(result.name).toBe("My Template");
      expect(mockPrisma.exportTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "user-1",
            name: "My Template",
          }),
        }),
      );
    });

    it("defaults isPublic to false when not provided", async () => {
      mockPrisma.exportTemplate.create.mockResolvedValue(makeTemplate());

      const dto: CreateTemplateDto = {
        name: "T",
        category: ExportTemplateCategory.RESEARCH,
        themeConfig: DEFAULT_THEME,
        layoutConfig: DEFAULT_LAYOUT,
        supportedFormats: [],
        supportedSources: [],
      };

      await service.createTemplate("user-1", dto);

      const callData = mockPrisma.exportTemplate.create.mock.calls[0][0].data;
      expect(callData.isPublic).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // updateTemplate
  // ──────────────────────────────────────────────────────────────────────────

  describe("updateTemplate", () => {
    it("throws NotFoundException when template not found", async () => {
      mockPrisma.exportTemplate.findUnique.mockResolvedValue(null);

      await expect(
        service.updateTemplate("nonexistent", "user-1", {}),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException when template is built-in", async () => {
      mockPrisma.exportTemplate.findUnique.mockResolvedValue(
        makeTemplate({ isBuiltIn: true }),
      );

      await expect(
        service.updateTemplate("tpl-1", "user-1", {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws ForbiddenException when user is not owner", async () => {
      mockPrisma.exportTemplate.findUnique.mockResolvedValue(
        makeTemplate({ userId: "other-user" }),
      );

      await expect(
        service.updateTemplate("tpl-1", "user-1", {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it("updates and returns formatted template when user is owner", async () => {
      const existing = makeTemplate({ userId: "user-1" });
      mockPrisma.exportTemplate.findUnique.mockResolvedValue(existing);
      mockPrisma.exportTemplate.update.mockResolvedValue({
        ...existing,
        name: "Updated Name",
      });

      const dto: UpdateTemplateDto = { name: "Updated Name" };
      const result = await service.updateTemplate("tpl-1", "user-1", dto);

      expect(result.name).toBe("Updated Name");
      expect(mockPrisma.exportTemplate.update).toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // deleteTemplate
  // ──────────────────────────────────────────────────────────────────────────

  describe("deleteTemplate", () => {
    it("throws NotFoundException when template not found", async () => {
      mockPrisma.exportTemplate.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteTemplate("nonexistent", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException when template is built-in", async () => {
      mockPrisma.exportTemplate.findUnique.mockResolvedValue(
        makeTemplate({ isBuiltIn: true }),
      );

      await expect(service.deleteTemplate("tpl-1", "user-1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("throws ForbiddenException when user does not own the template", async () => {
      mockPrisma.exportTemplate.findUnique.mockResolvedValue(
        makeTemplate({ userId: "other-user" }),
      );

      await expect(service.deleteTemplate("tpl-1", "user-1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("deletes template when user is owner", async () => {
      const existing = makeTemplate({ userId: "user-1" });
      mockPrisma.exportTemplate.findUnique.mockResolvedValue(existing);
      mockPrisma.exportTemplate.delete.mockResolvedValue(existing);

      await service.deleteTemplate("tpl-1", "user-1");

      expect(mockPrisma.exportTemplate.delete).toHaveBeenCalledWith({
        where: { id: "tpl-1" },
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // duplicateTemplate
  // ──────────────────────────────────────────────────────────────────────────

  describe("duplicateTemplate", () => {
    it("throws NotFoundException when source template not found", async () => {
      mockPrisma.exportTemplate.findUnique.mockResolvedValue(null);

      await expect(
        service.duplicateTemplate("nonexistent", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("creates a copy with (副本) suffix when no name provided", async () => {
      const source = makeTemplate({ name: "Original" });
      mockPrisma.exportTemplate.findUnique.mockResolvedValue(source);
      mockPrisma.exportTemplate.create.mockResolvedValue({
        ...source,
        id: "tpl-copy",
        name: "Original (副本)",
      });

      const result = await service.duplicateTemplate("tpl-1", "user-1");

      expect(result.name).toBe("Original (副本)");
      const createData = mockPrisma.exportTemplate.create.mock.calls[0][0].data;
      expect(createData.name).toBe("Original (副本)");
    });

    it("uses custom name when provided", async () => {
      const source = makeTemplate({ name: "Original" });
      mockPrisma.exportTemplate.findUnique.mockResolvedValue(source);
      mockPrisma.exportTemplate.create.mockResolvedValue({
        ...source,
        id: "tpl-copy",
        name: "My Copy",
      });

      const result = await service.duplicateTemplate(
        "tpl-1",
        "user-1",
        "My Copy",
      );

      expect(result.name).toBe("My Copy");
      const createData = mockPrisma.exportTemplate.create.mock.calls[0][0].data;
      expect(createData.name).toBe("My Copy");
    });

    it("creates copy with isBuiltIn=false and isDefault=false", async () => {
      const source = makeTemplate({ isBuiltIn: true, isDefault: true });
      mockPrisma.exportTemplate.findUnique.mockResolvedValue(source);
      mockPrisma.exportTemplate.create.mockResolvedValue({
        ...source,
        isBuiltIn: false,
        isDefault: false,
      });

      await service.duplicateTemplate("tpl-1", "user-1");

      const createData = mockPrisma.exportTemplate.create.mock.calls[0][0].data;
      expect(createData.isBuiltIn).toBe(false);
      expect(createData.isDefault).toBe(false);
      expect(createData.isPublic).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getThemeAndLayout
  // ──────────────────────────────────────────────────────────────────────────

  describe("getThemeAndLayout", () => {
    it("returns defaults when no templateId provided", async () => {
      const result = await service.getThemeAndLayout();

      expect(result.theme).toEqual(DEFAULT_THEME);
      expect(result.layout).toEqual(DEFAULT_LAYOUT);
    });

    it("uses template config when templateId is provided", async () => {
      const customTheme = {
        ...DEFAULT_THEME,
        colors: { ...DEFAULT_THEME.colors, primary: "#ff0000" },
      };
      mockPrisma.exportTemplate.findUnique.mockResolvedValue(
        makeTemplate({
          themeConfig: customTheme,
          layoutConfig: DEFAULT_LAYOUT,
        }),
      );

      const result = await service.getThemeAndLayout("tpl-1");

      expect(result.theme.colors.primary).toBe("#ff0000");
    });

    it("falls back to defaults when template not found by templateId", async () => {
      mockPrisma.exportTemplate.findUnique.mockResolvedValue(null);

      const result = await service.getThemeAndLayout("nonexistent-tpl");

      expect(result.theme).toEqual(DEFAULT_THEME);
      expect(result.layout).toEqual(DEFAULT_LAYOUT);
    });

    it("merges customTheme over base theme", async () => {
      const result = await service.getThemeAndLayout(undefined, {
        colors: { ...DEFAULT_THEME.colors, primary: "#custom" },
      });

      expect(result.theme.colors.primary).toBe("#custom");
    });

    it("merges customLayout over base layout", async () => {
      const result = await service.getThemeAndLayout(undefined, undefined, {
        pageSize: "Letter",
      });

      expect(result.layout.pageSize).toBe("Letter");
    });

    it("merges customTheme deep with nested objects", async () => {
      const result = await service.getThemeAndLayout(undefined, {
        fonts: {
          ...DEFAULT_THEME.fonts,
          heading: { ...DEFAULT_THEME.fonts.heading, size: 32 },
        },
      });

      expect(result.theme.fonts.heading.size).toBe(32);
      // Other font settings preserved
      expect(result.theme.fonts.body).toEqual(DEFAULT_THEME.fonts.body);
    });
  });
});
