/**
 * Tests for ResearchProjectOutputService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, ForbiddenException } from "@nestjs/common";
import { ResearchProjectOutputService } from "../project/research-project-output.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: jest.fn().mockImplementation(() => ({
    chat: jest.fn(),
  })),
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: jest.fn().mockImplementation(() => ({
    chat: jest.fn(),
  })),
}));

jest.mock("../../../../common/prisma/prisma.service");

describe("ResearchProjectOutputService", () => {
  let service: ResearchProjectOutputService;
  let prisma: jest.Mocked<PrismaService>;
  let _aiFacade: jest.Mocked<ChatFacade>;

  const userId = "user-123";
  const projectId = "project-456";
  const outputId = "output-789";

  const mockProject = {
    id: projectId,
    userId,
    name: "Test Project",
    sources: [
      {
        id: "source-1",
        title: "Source 1",
        sourceType: "WEB",
        content: "Content 1",
        abstract: "Abstract 1",
        aiSummary: null,
      },
    ],
  };

  const mockOutput = {
    id: outputId,
    projectId,
    type: "FAQ",
    title: "FAQ",
    status: "COMPLETED",
    content: '{"title": "FAQ", "categories": []}',
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {},
    modelUsed: "gemini",
  };

  beforeEach(async () => {
    const mockPrismaService = {
      researchProject: {
        findUnique: jest.fn(),
      },
      researchProjectOutput: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const mockFacadeInstance = {
      chat: jest.fn().mockResolvedValue({
        content: '{"title": "FAQ", "categories": []}',
        tokensUsed: 500,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchProjectOutputService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: ChatFacade,
          useValue: mockFacadeInstance,
        },
      ],
    }).compile();

    service = module.get<ResearchProjectOutputService>(
      ResearchProjectOutputService,
    );
    prisma = module.get(PrismaService);
    _aiFacade = module.get(ChatFacade);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getOutputTypes", () => {
    it("should return all output types", () => {
      const types = service.getOutputTypes();

      expect(Array.isArray(types)).toBe(true);
      expect(types.length).toBeGreaterThan(5);
      const typeIds = types.map((t) => t.type);
      expect(typeIds).toContain("FAQ");
      expect(typeIds).toContain("STUDY_GUIDE");
      expect(typeIds).toContain("BRIEFING_DOC");
    });

    it("should include title and icon for each type", () => {
      const types = service.getOutputTypes();

      for (const type of types) {
        expect(type.title).toBeDefined();
        expect(type.icon).toBeDefined();
      }
    });
  });

  describe("generateOutput", () => {
    it("should throw NotFoundException when project not found", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.generateOutput(userId, projectId, { type: "FAQ" as any }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when non-owner requests", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue({
        ...mockProject,
        userId: "other-user",
      });

      await expect(
        service.generateOutput("non-owner", projectId, { type: "FAQ" as any }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw NotFoundException when no sources available", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue({
        ...mockProject,
        sources: [],
      });

      await expect(
        service.generateOutput(userId, projectId, { type: "FAQ" as any }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should create output record and start async generation", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProjectOutput.create as jest.Mock).mockResolvedValue(
        mockOutput,
      );
      (prisma.researchProjectOutput.update as jest.Mock).mockResolvedValue(
        mockOutput,
      );

      const result = await service.generateOutput(userId, projectId, {
        type: "FAQ" as any,
      });

      expect(result.output).toBeDefined();
      expect(result.output.id).toBe(outputId);
      expect(result.sourceCount).toBe(1);
      expect(prisma.researchProjectOutput.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectId,
            type: "FAQ",
            status: "PENDING",
          }),
        }),
      );
    });

    it("should filter sources by selectedSourceIds when provided", async () => {
      const projectWithMultipleSources = {
        ...mockProject,
        sources: [
          { id: "source-1", title: "Source 1", sourceType: "WEB" },
          { id: "source-2", title: "Source 2", sourceType: "WEB" },
        ],
      };
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        projectWithMultipleSources,
      );
      (prisma.researchProjectOutput.create as jest.Mock).mockResolvedValue(
        mockOutput,
      );
      (prisma.researchProjectOutput.update as jest.Mock).mockResolvedValue(
        mockOutput,
      );

      const result = await service.generateOutput(userId, projectId, {
        type: "FAQ" as any,
        selectedSourceIds: ["source-1"],
      });

      expect(result.sourceCount).toBe(1);
    });
  });

  describe("getOutputs", () => {
    it("should return all outputs for a project", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProjectOutput.findMany as jest.Mock).mockResolvedValue([
        mockOutput,
      ]);

      const result = await service.getOutputs(userId, projectId);

      expect(result).toHaveLength(1);
    });

    it("should throw NotFoundException when project not found", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getOutputs(userId, projectId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw ForbiddenException when non-owner requests", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue({
        ...mockProject,
        userId: "other-user",
      });

      await expect(service.getOutputs("non-owner", projectId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("getOutput", () => {
    it("should return a specific output", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProjectOutput.findUnique as jest.Mock).mockResolvedValue(
        mockOutput,
      );

      const result = await service.getOutput(userId, projectId, outputId);

      expect(result).toBe(mockOutput);
    });

    it("should throw NotFoundException when output not found", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProjectOutput.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.getOutput(userId, projectId, "nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when output belongs to different project", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProjectOutput.findUnique as jest.Mock).mockResolvedValue({
        ...mockOutput,
        projectId: "other-project",
      });

      await expect(
        service.getOutput(userId, projectId, outputId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("updateOutput", () => {
    it("should update output status", async () => {
      (prisma.researchProjectOutput.update as jest.Mock).mockResolvedValue(
        mockOutput,
      );

      await service.updateOutput(outputId, "COMPLETED");

      expect(prisma.researchProjectOutput.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: outputId },
          data: expect.objectContaining({
            status: "COMPLETED",
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it("should update content when provided", async () => {
      (prisma.researchProjectOutput.update as jest.Mock).mockResolvedValue(
        mockOutput,
      );

      await service.updateOutput(outputId, "COMPLETED", '{"data": "content"}');

      expect(prisma.researchProjectOutput.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: '{"data": "content"}',
          }),
        }),
      );
    });

    it("should not set completedAt for non-COMPLETED status", async () => {
      (prisma.researchProjectOutput.update as jest.Mock).mockResolvedValue(
        mockOutput,
      );

      await service.updateOutput(outputId, "GENERATING");

      const callData = (prisma.researchProjectOutput.update as jest.Mock).mock
        .calls[0][0].data;
      expect(callData.completedAt).toBeUndefined();
    });
  });

  describe("deleteOutput", () => {
    it("should delete an output", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProjectOutput.findUnique as jest.Mock).mockResolvedValue(
        mockOutput,
      );
      (prisma.researchProjectOutput.delete as jest.Mock).mockResolvedValue(
        mockOutput,
      );

      const result = await service.deleteOutput(userId, projectId, outputId);

      expect(result).toEqual({ success: true });
    });

    it("should throw NotFoundException when output not found", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProjectOutput.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.deleteOutput(userId, projectId, "nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("updateOutputProperties", () => {
    it("should update output title", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProjectOutput.findUnique as jest.Mock).mockResolvedValue(
        mockOutput,
      );
      (prisma.researchProjectOutput.update as jest.Mock).mockResolvedValue({
        ...mockOutput,
        title: "New Title",
      });

      const _result = await service.updateOutputProperties(
        userId,
        projectId,
        outputId,
        { title: "New Title" },
      );

      expect(prisma.researchProjectOutput.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { title: "New Title" },
        }),
      );
    });
  });

  describe("regenerateOutput", () => {
    it("should reset output to pending state", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProjectOutput.findUnique as jest.Mock).mockResolvedValue(
        mockOutput,
      );
      (prisma.researchProjectOutput.update as jest.Mock).mockResolvedValue({
        ...mockOutput,
        status: "PENDING",
      });

      await service.regenerateOutput(userId, projectId, outputId);

      expect(prisma.researchProjectOutput.update).toHaveBeenCalledWith({
        where: { id: outputId },
        data: {
          status: "PENDING",
          content: null,
          error: null,
          completedAt: null,
        },
      });
    });
  });
});
