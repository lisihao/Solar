import { Test, TestingModule } from "@nestjs/testing";
import { PromptTemplateService } from "../prompt-template.service";
import { PrismaService } from "@/common/prisma/prisma.service";

describe("PromptTemplateService", () => {
  let service: PromptTemplateService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromptTemplateService,
        {
          provide: PrismaService,
          useValue: {
            promptTemplate: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
              delete: jest.fn(),
              count: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PromptTemplateService>(PromptTemplateService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("renderTemplate", () => {
    it("should render template with double curly braces", () => {
      const template = "Hello, {{name}}! Today is {{date}}.";
      const variables = { name: "World", date: "2025-01-24" };
      const result = service.renderTemplate(template, variables);
      expect(result).toBe("Hello, World! Today is 2025-01-24.");
    });

    it("should render template with dollar sign format", () => {
      const template = "Hello, ${name}! Today is ${date}.";
      const variables = { name: "World", date: "2025-01-24" };
      const result = service.renderTemplate(template, variables);
      expect(result).toBe("Hello, World! Today is 2025-01-24.");
    });

    it("should handle missing variables gracefully", () => {
      const template = "Hello, {{name}}!";
      const variables = {};
      const result = service.renderTemplate(template, variables);
      // Missing variables remain unchanged
      expect(result).toBe("Hello, {{name}}!");
    });

    it("should handle null values", () => {
      const template = "Value: {{value}}";
      const variables = { value: null };
      const result = service.renderTemplate(template, variables);
      expect(result).toBe("Value: ");
    });

    it("should handle undefined values", () => {
      const template = "Value: {{value}}";
      const variables = { value: undefined };
      const result = service.renderTemplate(template, variables);
      expect(result).toBe("Value: ");
    });

    it("should handle multiple occurrences of same variable", () => {
      const template = '{{name}} said: "{{name}} is here!"';
      const variables = { name: "Alice" };
      const result = service.renderTemplate(template, variables);
      expect(result).toBe('Alice said: "Alice is here!"');
    });

    it("should handle whitespace in variable names", () => {
      const template = "Value: {{ name }} and {{  date  }}";
      const variables = { name: "Test", date: "2025" };
      const result = service.renderTemplate(template, variables);
      expect(result).toBe("Value: Test and 2025");
    });
  });

  describe("getPrompt", () => {
    it("should return active template from cache", async () => {
      const mockTemplate = {
        id: "test-id",
        taskType: "TEST",
        name: "Test Template",
        version: 1,
        template: "Test {{input}}",
        variables: ["input"],
        isActive: true,
        description: null,
        createdBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest
        .spyOn(prisma.promptTemplate, "findMany")
        .mockResolvedValue([mockTemplate]);

      const result = await service.getPrompt("TEST");

      expect(result).toBeDefined();
      expect(result?.taskType).toBe("TEST");
      expect(result?.version).toBe(1);
    });

    it("should return specific version when version is provided", async () => {
      const mockTemplate = {
        id: "test-id",
        taskType: "TEST",
        name: "Test Template",
        version: 2,
        template: "Test {{input}}",
        variables: ["input"],
        isActive: false,
        description: null,
        createdBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest
        .spyOn(prisma.promptTemplate, "findUnique")
        .mockResolvedValue(mockTemplate);

      const result = await service.getPrompt("TEST", 2);

      expect(result).toBeDefined();
      expect(result?.version).toBe(2);
      expect(prisma.promptTemplate.findUnique).toHaveBeenCalledWith({
        where: {
          taskType_version: {
            taskType: "TEST",
            version: 2,
          },
        },
      });
    });
  });

  describe("createVersion", () => {
    it("should create first version", async () => {
      jest.spyOn(prisma.promptTemplate, "findFirst").mockResolvedValue(null);

      const mockCreated = {
        id: "test-id",
        taskType: "NEW",
        name: "New Template",
        version: 1,
        template: "Template {{var}}",
        variables: ["var"],
        isActive: false,
        description: "Test description",
        createdBy: "admin",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest
        .spyOn(prisma.promptTemplate, "create")
        .mockResolvedValue(mockCreated);

      const result = await service.createVersion({
        taskType: "NEW",
        name: "New Template",
        template: "Template {{var}}",
        variables: ["var"],
        description: "Test description",
        createdBy: "admin",
      });

      expect(result.version).toBe(1);
      expect(prisma.promptTemplate.create).toHaveBeenCalled();
    });

    it("should increment version number", async () => {
      jest.spyOn(prisma.promptTemplate, "findFirst").mockResolvedValue({
        version: 3,
      } as any);

      const mockCreated = {
        id: "test-id",
        taskType: "EXISTING",
        name: "Existing Template",
        version: 4,
        template: "Template {{var}}",
        variables: ["var"],
        isActive: false,
        description: null,
        createdBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest
        .spyOn(prisma.promptTemplate, "create")
        .mockResolvedValue(mockCreated);

      const result = await service.createVersion({
        taskType: "EXISTING",
        name: "Existing Template",
        template: "Template {{var}}",
      });

      expect(result.version).toBe(4);
    });

    it("should throw when create fails", async () => {
      jest.spyOn(prisma.promptTemplate, "findFirst").mockResolvedValue(null);
      jest
        .spyOn(prisma.promptTemplate, "create")
        .mockRejectedValue(new Error("DB error"));

      await expect(
        service.createVersion({ taskType: "X", name: "X", template: "X" }),
      ).rejects.toThrow("DB error");
    });

    it("should append changeLog to description when both provided", async () => {
      jest.spyOn(prisma.promptTemplate, "findFirst").mockResolvedValue(null);
      const mockCreated = {
        id: "id",
        taskType: "T",
        name: "N",
        version: 1,
        template: "T",
        variables: null,
        isActive: false,
        description: "My desc\n\n变更说明: changelog text",
        createdBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      jest
        .spyOn(prisma.promptTemplate, "create")
        .mockResolvedValue(mockCreated);

      await service.createVersion(
        { taskType: "T", name: "N", template: "T", description: "My desc" },
        "changelog text",
      );

      expect(prisma.promptTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: expect.stringContaining("changelog text"),
          }),
        }),
      );
    });

    it("should use changeLog as description when dto has no description", async () => {
      jest.spyOn(prisma.promptTemplate, "findFirst").mockResolvedValue(null);
      const mockCreated = {
        id: "id",
        taskType: "T",
        name: "N",
        version: 1,
        template: "T",
        variables: null,
        isActive: false,
        description: "only-changelog",
        createdBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      jest
        .spyOn(prisma.promptTemplate, "create")
        .mockResolvedValue(mockCreated);

      await service.createVersion(
        { taskType: "T", name: "N", template: "T" },
        "only-changelog",
      );

      expect(prisma.promptTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ description: "only-changelog" }),
        }),
      );
    });
  });

  // =========================================================================
  // activateVersion
  // =========================================================================

  describe("activateVersion", () => {
    const makeTemplate = (overrides: Record<string, unknown> = {}) => ({
      id: "tpl-1",
      taskType: "PRD",
      name: "PRD",
      version: 1,
      template: "Hello",
      variables: null,
      isActive: true,
      description: null,
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });

    it("should activate a version and deactivate others", async () => {
      const tpl = makeTemplate({ version: 2 });
      jest
        .spyOn(prisma.promptTemplate, "findUnique")
        .mockResolvedValue(tpl as any);
      jest
        .spyOn(prisma, "$transaction")
        .mockResolvedValue([{ count: 1 }, tpl] as any);
      jest
        .spyOn(prisma.promptTemplate, "findMany")
        .mockResolvedValue([tpl] as any);

      const result = await service.activateVersion("PRD", 2);
      expect(result.version).toBe(2);
    });

    it("should throw NotFoundException when version not found", async () => {
      jest.spyOn(prisma.promptTemplate, "findUnique").mockResolvedValue(null);

      await expect(service.activateVersion("PRD", 99)).rejects.toThrow(
        "Template not found: PRD v99",
      );
    });

    it("should rethrow when transaction fails", async () => {
      jest
        .spyOn(prisma.promptTemplate, "findUnique")
        .mockResolvedValue(makeTemplate() as any);
      jest
        .spyOn(prisma, "$transaction")
        .mockRejectedValue(new Error("tx failed"));

      await expect(service.activateVersion("PRD", 1)).rejects.toThrow(
        "tx failed",
      );
    });
  });

  // =========================================================================
  // rollback
  // =========================================================================

  describe("rollback", () => {
    it("should call activateVersion with the target version", async () => {
      const spy = jest
        .spyOn(service, "activateVersion")
        .mockResolvedValue({} as any);

      await service.rollback("PRD", 2);

      expect(spy).toHaveBeenCalledWith("PRD", 2);
    });
  });

  // =========================================================================
  // getAllVersions
  // =========================================================================

  describe("getAllVersions", () => {
    it("should return all versions ordered by version desc", async () => {
      const templates = [
        {
          id: "3",
          taskType: "PRD",
          name: "v3",
          version: 3,
          template: "t",
          variables: null,
          isActive: false,
          description: null,
          createdBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "2",
          taskType: "PRD",
          name: "v2",
          version: 2,
          template: "t",
          variables: null,
          isActive: true,
          description: null,
          createdBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "1",
          taskType: "PRD",
          name: "v1",
          version: 1,
          template: "t",
          variables: null,
          isActive: false,
          description: null,
          createdBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      jest
        .spyOn(prisma.promptTemplate, "findMany")
        .mockResolvedValue(templates as any);

      const result = await service.getAllVersions("PRD");
      expect(result).toHaveLength(3);
      expect(result[0].version).toBe(3);
    });

    it("should return empty array on DB error", async () => {
      jest
        .spyOn(prisma.promptTemplate, "findMany")
        .mockRejectedValue(new Error("fail"));
      const result = await service.getAllVersions("PRD");
      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // getAllTaskTypes
  // =========================================================================

  describe("getAllTaskTypes", () => {
    it("should return distinct task type strings", async () => {
      jest
        .spyOn(prisma.promptTemplate, "findMany")
        .mockResolvedValue([{ taskType: "A" }, { taskType: "B" }] as any);
      const result = await service.getAllTaskTypes();
      expect(result).toEqual(["A", "B"]);
    });

    it("should return empty array on DB error", async () => {
      jest
        .spyOn(prisma.promptTemplate, "findMany")
        .mockRejectedValue(new Error("fail"));
      const result = await service.getAllTaskTypes();
      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // deleteVersion
  // =========================================================================

  describe("deleteVersion", () => {
    const makeTemplate = (overrides: Record<string, unknown> = {}) => ({
      id: "tpl-1",
      taskType: "PRD",
      name: "PRD",
      version: 1,
      template: "Hello",
      variables: null,
      isActive: false,
      description: null,
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });

    it("should delete an inactive version", async () => {
      const tpl = makeTemplate({ isActive: false });
      jest
        .spyOn(prisma.promptTemplate, "findUnique")
        .mockResolvedValue(tpl as any);
      jest.spyOn(prisma.promptTemplate, "delete").mockResolvedValue(tpl as any);

      await expect(service.deleteVersion("PRD", 1)).resolves.not.toThrow();
    });

    it("should throw NotFoundException when not found", async () => {
      jest.spyOn(prisma.promptTemplate, "findUnique").mockResolvedValue(null);
      await expect(service.deleteVersion("PRD", 1)).rejects.toThrow(
        "Template not found",
      );
    });

    it("should throw when trying to delete active version", async () => {
      jest
        .spyOn(prisma.promptTemplate, "findUnique")
        .mockResolvedValue(makeTemplate({ isActive: true }) as any);
      await expect(service.deleteVersion("PRD", 1)).rejects.toThrow(
        "Cannot delete active version",
      );
    });

    it("should rethrow DB error during delete", async () => {
      jest
        .spyOn(prisma.promptTemplate, "findUnique")
        .mockResolvedValue(makeTemplate({ isActive: false }) as any);
      jest
        .spyOn(prisma.promptTemplate, "delete")
        .mockRejectedValue(new Error("constraint"));
      await expect(service.deleteVersion("PRD", 1)).rejects.toThrow(
        "constraint",
      );
    });
  });

  // =========================================================================
  // getActiveTemplateStats
  // =========================================================================

  describe("getActiveTemplateStats", () => {
    it("should return total, active counts, and taskTypes count", async () => {
      jest
        .spyOn(prisma.promptTemplate, "count")
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(4);
      jest
        .spyOn(prisma.promptTemplate, "findMany")
        .mockResolvedValue([
          { taskType: "A" },
          { taskType: "B" },
          { taskType: "C" },
        ] as any);

      const result = await service.getActiveTemplateStats();
      expect(result).toEqual({
        totalTemplates: 10,
        activeTemplates: 4,
        taskTypes: 3,
      });
    });

    it("should return zeros on error", async () => {
      jest
        .spyOn(prisma.promptTemplate, "count")
        .mockRejectedValue(new Error("fail"));
      const result = await service.getActiveTemplateStats();
      expect(result).toEqual({
        totalTemplates: 0,
        activeTemplates: 0,
        taskTypes: 0,
      });
    });
  });

  // =========================================================================
  // getPrompt — additional edge cases
  // =========================================================================

  describe("getPrompt — additional edge cases", () => {
    it("should query DB when version specified and template is found", async () => {
      const tpl = {
        id: "1",
        taskType: "PRD",
        name: "v2",
        version: 2,
        template: "t",
        variables: ["x"],
        isActive: false,
        description: null,
        createdBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      jest
        .spyOn(prisma.promptTemplate, "findUnique")
        .mockResolvedValue(tpl as any);

      const result = await service.getPrompt("PRD", 2);
      expect(result?.version).toBe(2);
    });

    it("should return null on findUnique error (versioned query)", async () => {
      jest
        .spyOn(prisma.promptTemplate, "findUnique")
        .mockRejectedValue(new Error("DB err"));
      const result = await service.getPrompt("PRD", 2);
      expect(result).toBeNull();
    });

    it("should fallback to DB when cache miss (no version)", async () => {
      jest.spyOn(prisma.promptTemplate, "findFirst").mockResolvedValue({
        id: "1",
        taskType: "MISS",
        name: "N",
        version: 1,
        template: "t",
        variables: null,
        isActive: true,
        description: null,
        createdBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await service.getPrompt("MISS");
      expect(result?.taskType).toBe("MISS");
    });

    it("should return null when findFirst returns null (no active template)", async () => {
      jest.spyOn(prisma.promptTemplate, "findFirst").mockResolvedValue(null);
      const result = await service.getPrompt("NO_TEMPLATE");
      expect(result).toBeNull();
    });

    it("should return null when findFirst throws (no version)", async () => {
      jest
        .spyOn(prisma.promptTemplate, "findFirst")
        .mockRejectedValue(new Error("fail"));
      const result = await service.getPrompt("ERR_TYPE");
      expect(result).toBeNull();
    });
  });
});
