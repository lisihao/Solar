import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { ResearchController } from "../research-template.controller";
import { ResearchTemplateService } from "@/modules/ai-app/research/services/research-template.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import {
  CreateResearchTemplateDto,
  UpdateResearchTemplateDto,
} from "../dto/research-template-admin.dto";

jest.mock("../../../../common/prisma/prisma.service");

describe("ResearchController", () => {
  let controller: ResearchController;
  let prisma: jest.Mocked<PrismaService>;

  const mockTemplate = {
    id: "tmpl-1",
    templateId: "competitive-analysis",
    name: "Competitive Analysis",
    description: "Analyze competitors",
    category: "competitive",
    dimensions: { depth: 3 },
    dataSources: ["web"],
    guidancePrompt: "Analyze...",
    reportStructure: { sections: [] },
    iterationCount: 3,
    enabled: true,
    isBuiltIn: false,
    usageCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPrisma = {
    researchTemplate: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ResearchController],
      providers: [
        ResearchTemplateService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(ResearchController);
    prisma = module.get(PrismaService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("findAll", () => {
    it("should return all templates with no filters", async () => {
      mockPrisma.researchTemplate.findMany.mockResolvedValue([mockTemplate]);

      const result = await controller.findAll();

      expect(prisma.researchTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          orderBy: [{ category: "asc" }, { name: "asc" }],
        }),
      );
      expect(result).toEqual([mockTemplate]);
    });

    it("should filter by category when provided", async () => {
      mockPrisma.researchTemplate.findMany.mockResolvedValue([mockTemplate]);

      await controller.findAll("competitive");

      const call = mockPrisma.researchTemplate.findMany.mock.calls[0][0];
      expect(call.where.category).toBe("competitive");
    });

    it('should filter by enabled=true when enabled="true"', async () => {
      mockPrisma.researchTemplate.findMany.mockResolvedValue([]);

      await controller.findAll(undefined, "true");

      const call = mockPrisma.researchTemplate.findMany.mock.calls[0][0];
      expect(call.where.enabled).toBe(true);
    });

    it('should filter by enabled=false when enabled="false"', async () => {
      mockPrisma.researchTemplate.findMany.mockResolvedValue([]);

      await controller.findAll(undefined, "false");

      const call = mockPrisma.researchTemplate.findMany.mock.calls[0][0];
      expect(call.where.enabled).toBe(false);
    });

    it("should apply both category and enabled filters simultaneously", async () => {
      mockPrisma.researchTemplate.findMany.mockResolvedValue([]);

      await controller.findAll("competitive", "true");

      const call = mockPrisma.researchTemplate.findMany.mock.calls[0][0];
      expect(call.where.category).toBe("competitive");
      expect(call.where.enabled).toBe(true);
    });

    it("should not set enabled filter when enabled param is undefined", async () => {
      mockPrisma.researchTemplate.findMany.mockResolvedValue([]);

      await controller.findAll(undefined, undefined);

      const call = mockPrisma.researchTemplate.findMany.mock.calls[0][0];
      expect(call.where.enabled).toBeUndefined();
    });
  });

  describe("findOne", () => {
    it("should return template when found", async () => {
      mockPrisma.researchTemplate.findUnique.mockResolvedValue(mockTemplate);

      const result = await controller.findOne("tmpl-1");

      expect(prisma.researchTemplate.findUnique).toHaveBeenCalledWith({
        where: { id: "tmpl-1" },
      });
      expect(result).toEqual(mockTemplate);
    });

    it("should throw NotFoundException when template not found", async () => {
      mockPrisma.researchTemplate.findUnique.mockResolvedValue(null);

      await expect(controller.findOne("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw NotFoundException with id in message", async () => {
      mockPrisma.researchTemplate.findUnique.mockResolvedValue(null);

      await expect(controller.findOne("missing-id")).rejects.toThrow(
        "missing-id",
      );
    });
  });

  describe("create", () => {
    it("should create and return a new research template", async () => {
      const dto: CreateResearchTemplateDto = {
        templateId: "new-tmpl",
        name: "New Template",
        category: "research",
        dimensions: { depth: 2 },
      };
      mockPrisma.researchTemplate.create.mockResolvedValue({
        ...mockTemplate,
        ...dto,
      });

      const result = await controller.create(dto);

      expect(prisma.researchTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            templateId: "new-tmpl",
            name: "New Template",
            category: "research",
            isBuiltIn: false,
            enabled: true,
            iterationCount: 3,
          }),
        }),
      );
      expect(result.templateId).toBe("new-tmpl");
    });

    it("should use provided iterationCount over default", async () => {
      const dto: CreateResearchTemplateDto = {
        templateId: "tmpl-iter",
        name: "Iter Template",
        category: "test",
        dimensions: {},
        iterationCount: 5,
      };
      mockPrisma.researchTemplate.create.mockResolvedValue(mockTemplate);

      await controller.create(dto);

      const call = mockPrisma.researchTemplate.create.mock.calls[0][0];
      expect(call.data.iterationCount).toBe(5);
    });

    it("should default enabled to true when not provided", async () => {
      const dto: CreateResearchTemplateDto = {
        templateId: "tmpl-enabled",
        name: "Enabled Template",
        category: "test",
        dimensions: {},
      };
      mockPrisma.researchTemplate.create.mockResolvedValue(mockTemplate);

      await controller.create(dto);

      const call = mockPrisma.researchTemplate.create.mock.calls[0][0];
      expect(call.data.enabled).toBe(true);
    });

    it("should use provided enabled=false", async () => {
      const dto: CreateResearchTemplateDto = {
        templateId: "tmpl-disabled",
        name: "Disabled Template",
        category: "test",
        dimensions: {},
        enabled: false,
      };
      mockPrisma.researchTemplate.create.mockResolvedValue(mockTemplate);

      await controller.create(dto);

      const call = mockPrisma.researchTemplate.create.mock.calls[0][0];
      expect(call.data.enabled).toBe(false);
    });
  });

  describe("update", () => {
    it("should update and return template when found", async () => {
      const dto: UpdateResearchTemplateDto = { name: "Updated Name" };
      const updated = { ...mockTemplate, name: "Updated Name" };
      mockPrisma.researchTemplate.findUnique.mockResolvedValue(mockTemplate);
      mockPrisma.researchTemplate.update.mockResolvedValue(updated);

      const result = await controller.update("tmpl-1", dto);

      expect(prisma.researchTemplate.update).toHaveBeenCalledWith({
        where: { id: "tmpl-1" },
        data: dto,
      });
      expect(result.name).toBe("Updated Name");
    });

    it("should throw NotFoundException when template not found for update", async () => {
      mockPrisma.researchTemplate.findUnique.mockResolvedValue(null);

      await expect(
        controller.update("nonexistent", { name: "x" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should not call update when template does not exist", async () => {
      mockPrisma.researchTemplate.findUnique.mockResolvedValue(null);

      await expect(controller.update("ghost", {})).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.researchTemplate.update).not.toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("should delete non-built-in template successfully", async () => {
      const nonBuiltIn = { ...mockTemplate, isBuiltIn: false };
      mockPrisma.researchTemplate.findUnique.mockResolvedValue(nonBuiltIn);
      mockPrisma.researchTemplate.delete.mockResolvedValue(nonBuiltIn);

      const result = await controller.delete("tmpl-1");

      expect(prisma.researchTemplate.delete).toHaveBeenCalledWith({
        where: { id: "tmpl-1" },
      });
      expect(result).toEqual(nonBuiltIn);
    });

    it("should throw NotFoundException when template not found for delete", async () => {
      mockPrisma.researchTemplate.findUnique.mockResolvedValue(null);

      await expect(controller.delete("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw BadRequestException when template is built-in", async () => {
      const builtIn = { ...mockTemplate, isBuiltIn: true };
      mockPrisma.researchTemplate.findUnique.mockResolvedValue(builtIn);

      await expect(controller.delete("tmpl-builtin")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should not call delete when template is built-in", async () => {
      const builtIn = { ...mockTemplate, isBuiltIn: true };
      mockPrisma.researchTemplate.findUnique.mockResolvedValue(builtIn);

      await expect(controller.delete("tmpl-builtin")).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.researchTemplate.delete).not.toHaveBeenCalled();
    });
  });

  describe("duplicate", () => {
    it("should create a copy of the template", async () => {
      const original = { ...mockTemplate, isBuiltIn: false };
      const copy = {
        ...mockTemplate,
        id: "tmpl-2",
        templateId: "competitive-analysis-copy-123",
      };
      mockPrisma.researchTemplate.findUnique.mockResolvedValue(original);
      mockPrisma.researchTemplate.create.mockResolvedValue(copy);

      const result = await controller.duplicate("tmpl-1");

      expect(prisma.researchTemplate.findUnique).toHaveBeenCalledWith({
        where: { id: "tmpl-1" },
      });
      expect(prisma.researchTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: expect.stringContaining("(Copy)"),
            isBuiltIn: false,
            usageCount: 0,
          }),
        }),
      );
      expect(result).toEqual(copy);
    });

    it("should throw NotFoundException when source template does not exist", async () => {
      mockPrisma.researchTemplate.findUnique.mockResolvedValue(null);

      await expect(controller.duplicate("ghost")).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should generate a new templateId with "-copy-" suffix', async () => {
      mockPrisma.researchTemplate.findUnique.mockResolvedValue(mockTemplate);
      mockPrisma.researchTemplate.create.mockResolvedValue(mockTemplate);

      await controller.duplicate("tmpl-1");

      const call = mockPrisma.researchTemplate.create.mock.calls[0][0];
      expect(call.data.templateId).toMatch(/competitive-analysis-copy-\d+/);
    });

    it('should copy the name with "(Copy)" appended', async () => {
      mockPrisma.researchTemplate.findUnique.mockResolvedValue(mockTemplate);
      mockPrisma.researchTemplate.create.mockResolvedValue(mockTemplate);

      await controller.duplicate("tmpl-1");

      const call = mockPrisma.researchTemplate.create.mock.calls[0][0];
      expect(call.data.name).toBe(`${mockTemplate.name} (Copy)`);
    });
  });
});
