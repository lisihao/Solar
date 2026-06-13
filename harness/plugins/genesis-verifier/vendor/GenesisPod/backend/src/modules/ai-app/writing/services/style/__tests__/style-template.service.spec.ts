import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import {
  StyleTemplateService,
  StyleTemplateData,
} from "../style-template.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";

describe("StyleTemplateService", () => {
  let service: StyleTemplateService;
  let mockPrisma: jest.Mocked<PrismaService>;

  const mockTemplate = {
    id: "template-1",
    name: "甄嬛传式宫斗",
    baseStyle: "web_gongdou",
    description: "宫斗风格",
    category: "宫斗权谋",
    isSystem: true,
    ownerId: null,
    useCount: 100,
    dialogueRules: {
      techniques: [],
      voiceByRole: {},
      examples: [],
      avoidPatterns: [],
    },
    descriptionRules: {
      microExpressions: [],
      atmosphereElements: [],
      examples: [],
      avoidPatterns: [],
    },
    pacingRules: {
      protagonistAction: { required: true, minPerChapter: 1 },
      maxConsecutivePassive: 2,
      foreshadowing: { required: true },
      chapterOpeningVariety: { cooldownChapters: 5 },
    },
    avoidPatterns: [],
    referenceWorks: [],
    systemPromptFragment: null,
    styleTemplateId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockProject = {
    id: "proj-1",
    writingStyle: "jin_yong",
    styleTemplateId: null,
    styleTemplate: null,
    styleOverrides: null,
  };

  beforeEach(async () => {
    mockPrisma = {
      writingStyleTemplate: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      writingProject: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StyleTemplateService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<StyleTemplateService>(StyleTemplateService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("initializeSystemTemplates", () => {
    it("should create system templates that do not yet exist", async () => {
      (
        mockPrisma.writingStyleTemplate.findFirst as jest.Mock
      ).mockResolvedValue(null);
      (mockPrisma.writingStyleTemplate.create as jest.Mock).mockResolvedValue(
        mockTemplate,
      );

      await service.initializeSystemTemplates();

      expect(mockPrisma.writingStyleTemplate.create).toHaveBeenCalled();
    });

    it("should NOT create template when it already exists", async () => {
      (
        mockPrisma.writingStyleTemplate.findFirst as jest.Mock
      ).mockResolvedValue(mockTemplate);

      await service.initializeSystemTemplates();

      expect(mockPrisma.writingStyleTemplate.create).not.toHaveBeenCalled();
    });
  });

  describe("getAvailableTemplates", () => {
    it("should return formatted list of templates", async () => {
      (mockPrisma.writingStyleTemplate.findMany as jest.Mock).mockResolvedValue(
        [mockTemplate],
      );

      const result = await service.getAvailableTemplates("user-1");

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty("id");
      expect(result[0]).toHaveProperty("name");
      expect(result[0]).toHaveProperty("baseStyle");
      expect(result[0]).toHaveProperty("isSystem");
      expect(result[0]).toHaveProperty("useCount");
    });

    it("should include user templates in the query", async () => {
      (mockPrisma.writingStyleTemplate.findMany as jest.Mock).mockResolvedValue(
        [],
      );

      await service.getAvailableTemplates("user-1");

      expect(mockPrisma.writingStyleTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { isSystem: true },
              { ownerId: "user-1" },
            ]),
          }),
        }),
      );
    });

    it("should only include system templates when no userId provided", async () => {
      (mockPrisma.writingStyleTemplate.findMany as jest.Mock).mockResolvedValue(
        [],
      );

      await service.getAvailableTemplates();

      expect(mockPrisma.writingStyleTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([{ isSystem: true }]),
          }),
        }),
      );
    });
  });

  describe("getTemplate", () => {
    it("should return template when found", async () => {
      (
        mockPrisma.writingStyleTemplate.findUnique as jest.Mock
      ).mockResolvedValue(mockTemplate);

      const result = await service.getTemplate("template-1");

      expect(result).toEqual(mockTemplate);
    });

    it("should throw NotFoundException when template not found", async () => {
      (
        mockPrisma.writingStyleTemplate.findUnique as jest.Mock
      ).mockResolvedValue(null);

      await expect(service.getTemplate("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("getRecommendedTemplates", () => {
    it("should query templates by category containing the search term", async () => {
      (mockPrisma.writingStyleTemplate.findMany as jest.Mock).mockResolvedValue(
        [mockTemplate],
      );

      await service.getRecommendedTemplates("宫斗");

      expect(mockPrisma.writingStyleTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            category: { contains: "宫斗" },
            isSystem: true,
          }),
          take: 5,
        }),
      );
    });
  });

  describe("getMergedStyleConfig", () => {
    it("should return null when project not found", async () => {
      (mockPrisma.writingProject.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await service.getMergedStyleConfig("nonexistent");

      expect(result).toBeNull();
    });

    it("should return merged config for project with base style", async () => {
      (mockPrisma.writingProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );

      const result = await service.getMergedStyleConfig("proj-1");

      expect(result).not.toBeNull();
      expect(result!.baseStyle).toBeDefined();
      expect(result!.baseStyle.id).toBe("jin_yong");
      expect(result!.fullPrompt).toBeDefined();
      expect(typeof result!.fullPrompt).toBe("string");
    });

    it("should use modern_realistic as fallback style when style is unknown", async () => {
      (mockPrisma.writingProject.findUnique as jest.Mock).mockResolvedValue({
        ...mockProject,
        writingStyle: "unknown_style",
      });

      const result = await service.getMergedStyleConfig("proj-1");

      expect(result).not.toBeNull();
    });

    it("should merge template rules when project has a style template", async () => {
      (mockPrisma.writingProject.findUnique as jest.Mock).mockResolvedValue({
        ...mockProject,
        styleTemplate: mockTemplate,
      });

      const result = await service.getMergedStyleConfig("proj-1");

      expect(result).not.toBeNull();
      expect(result!.avoidPatterns).toBeDefined();
    });
  });

  describe("createTemplate", () => {
    it("should create a user template with provided data", async () => {
      const newTemplate = {
        ...mockTemplate,
        isSystem: false,
        ownerId: "user-1",
      };
      (mockPrisma.writingStyleTemplate.create as jest.Mock).mockResolvedValue(
        newTemplate,
      );

      const data: Partial<StyleTemplateData> = {
        name: "My Custom Template",
        baseStyle: "jin_yong",
        category: "武侠",
      };

      await service.createTemplate("user-1", data);

      expect(mockPrisma.writingStyleTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "My Custom Template",
            isSystem: false,
            ownerId: "user-1",
          }),
        }),
      );
    });
  });

  describe("updateTemplate", () => {
    it("should throw NotFoundException when template not found", async () => {
      (
        mockPrisma.writingStyleTemplate.findUnique as jest.Mock
      ).mockResolvedValue(null);

      await expect(
        service.updateTemplate("nonexistent", "user-1", { name: "New Name" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw Error when template is a system template", async () => {
      (
        mockPrisma.writingStyleTemplate.findUnique as jest.Mock
      ).mockResolvedValue({
        ...mockTemplate,
        isSystem: true,
        ownerId: "user-1",
      });

      await expect(
        service.updateTemplate("template-1", "user-1", { name: "New Name" }),
      ).rejects.toThrow("Cannot update this template");
    });

    it("should throw Error when user does not own the template", async () => {
      (
        mockPrisma.writingStyleTemplate.findUnique as jest.Mock
      ).mockResolvedValue({
        ...mockTemplate,
        isSystem: false,
        ownerId: "other-user",
      });

      await expect(
        service.updateTemplate("template-1", "user-1", { name: "New Name" }),
      ).rejects.toThrow("Cannot update this template");
    });

    it("should update template when user is owner and template is not system", async () => {
      (
        mockPrisma.writingStyleTemplate.findUnique as jest.Mock
      ).mockResolvedValue({
        ...mockTemplate,
        isSystem: false,
        ownerId: "user-1",
      });
      (mockPrisma.writingStyleTemplate.update as jest.Mock).mockResolvedValue(
        {},
      );

      await service.updateTemplate("template-1", "user-1", {
        name: "Updated Name",
      });

      expect(mockPrisma.writingStyleTemplate.update).toHaveBeenCalled();
    });
  });

  describe("setProjectTemplate", () => {
    it("should increment template use count and update project", async () => {
      (mockPrisma.writingStyleTemplate.update as jest.Mock).mockResolvedValue(
        {},
      );
      (mockPrisma.writingProject.update as jest.Mock).mockResolvedValue({});

      await service.setProjectTemplate("proj-1", "template-1");

      expect(mockPrisma.writingStyleTemplate.update).toHaveBeenCalledWith({
        where: { id: "template-1" },
        data: { useCount: { increment: 1 } },
      });
      expect(mockPrisma.writingProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "proj-1" },
          data: expect.objectContaining({ styleTemplateId: "template-1" }),
        }),
      );
    });

    it("should NOT increment use count when templateId is null", async () => {
      (mockPrisma.writingProject.update as jest.Mock).mockResolvedValue({});

      await service.setProjectTemplate("proj-1", null);

      expect(mockPrisma.writingStyleTemplate.update).not.toHaveBeenCalled();
    });
  });
});
