// Prevent transitive module resolution issues from NestJS deep imports
jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: jest.fn(),
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: jest.fn(),
}));

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, ForbiddenException } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { ResearchDemoService } from "../research-demo.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

describe("ResearchDemoService", () => {
  let service: ResearchDemoService;

  const mockPrisma = {
    researchProject: {
      findUnique: jest.fn(),
    },
    researchDemo: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    researchIdea: {
      findUnique: jest.fn(),
    },
  };

  const mockFacade = {
    chat: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchDemoService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<ResearchDemoService>(ResearchDemoService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== verifyProjectOwnership (via public methods) ====================

  describe("ownership verification", () => {
    it("should throw NotFoundException when project does not exist", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(null);

      await expect(
        service.listByProject("user-1", "project-x"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when project belongs to different user", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue({
        userId: "other-user",
      });

      await expect(
        service.listByProject("user-1", "project-x"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ==================== listByProject ====================

  describe("listByProject", () => {
    const userId = "user-1";
    const projectId = "project-1";

    beforeEach(() => {
      mockPrisma.researchProject.findUnique.mockResolvedValue({ userId });
    });

    it("should call prisma.researchDemo.findMany with correct projectId", async () => {
      mockPrisma.researchDemo.findMany.mockResolvedValue([]);

      await service.listByProject(userId, projectId);

      expect(mockPrisma.researchDemo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId } }),
      );
    });

    it("should return the list returned by findMany", async () => {
      const demos = [{ id: "demo-1" }, { id: "demo-2" }];
      mockPrisma.researchDemo.findMany.mockResolvedValue(demos);

      const result = await service.listByProject(userId, projectId);

      expect(result).toEqual(demos);
    });

    it("should order by createdAt desc", async () => {
      mockPrisma.researchDemo.findMany.mockResolvedValue([]);

      await service.listByProject(userId, projectId);

      const callArgs = mockPrisma.researchDemo.findMany.mock.calls[0][0];
      expect(callArgs.orderBy).toEqual({ createdAt: "desc" });
    });
  });

  // ==================== getById ====================

  describe("getById", () => {
    const userId = "user-1";
    const projectId = "project-1";
    const demoId = "demo-1";

    beforeEach(() => {
      mockPrisma.researchProject.findUnique.mockResolvedValue({ userId });
    });

    it("should return the demo when found", async () => {
      const demo = { id: demoId, projectId, title: "My Demo" };
      mockPrisma.researchDemo.findUnique.mockResolvedValue(demo);

      const result = await service.getById(userId, projectId, demoId);

      expect(result).toEqual(demo);
    });

    it("should throw NotFoundException when demo does not exist", async () => {
      mockPrisma.researchDemo.findUnique.mockResolvedValue(null);

      await expect(service.getById(userId, projectId, demoId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should query with both demoId and projectId to scope the lookup", async () => {
      const demo = { id: demoId };
      mockPrisma.researchDemo.findUnique.mockResolvedValue(demo);

      await service.getById(userId, projectId, demoId);

      expect(mockPrisma.researchDemo.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: demoId, projectId },
        }),
      );
    });
  });

  // ==================== createForIdea ====================

  describe("createForIdea", () => {
    const userId = "user-1";
    const projectId = "project-1";
    const ideaId = "idea-1";

    const mockIdea = {
      id: ideaId,
      title: "AI Platform",
      description: "A great idea",
      metadata: {},
      projectId,
    };

    beforeEach(() => {
      mockPrisma.researchProject.findUnique.mockResolvedValue({ userId });
    });

    it("should throw NotFoundException when idea does not exist", async () => {
      mockPrisma.researchIdea.findUnique.mockResolvedValue(null);

      await expect(
        service.createForIdea(userId, projectId, ideaId),
      ).rejects.toThrow(NotFoundException);
    });

    it("should create a demo record with PENDING status", async () => {
      mockPrisma.researchIdea.findUnique.mockResolvedValue(mockIdea);
      const createdDemo = { id: "demo-new", status: "PENDING" };
      mockPrisma.researchDemo.create.mockResolvedValue(createdDemo);
      // prevent the fire-and-forget from causing unresolved promises in test
      mockPrisma.researchDemo.update.mockResolvedValue({});
      mockFacade.chat.mockResolvedValue({ content: "<html></html>" });

      const result = await service.createForIdea(userId, projectId, ideaId);

      expect(result).toEqual(createdDemo);
      expect(mockPrisma.researchDemo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "PENDING",
            ideaId,
            projectId,
          }),
        }),
      );
    });

    it("should use provided title when given", async () => {
      mockPrisma.researchIdea.findUnique.mockResolvedValue(mockIdea);
      mockPrisma.researchDemo.create.mockResolvedValue({ id: "demo-new" });
      mockPrisma.researchDemo.update.mockResolvedValue({});
      mockFacade.chat.mockResolvedValue({ content: "<html></html>" });

      await service.createForIdea(userId, projectId, ideaId, "Custom Title");

      expect(mockPrisma.researchDemo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: "Custom Title" }),
        }),
      );
    });

    it("should default title to Demo: <idea title> when title not provided", async () => {
      mockPrisma.researchIdea.findUnique.mockResolvedValue(mockIdea);
      mockPrisma.researchDemo.create.mockResolvedValue({ id: "demo-new" });
      mockPrisma.researchDemo.update.mockResolvedValue({});
      mockFacade.chat.mockResolvedValue({ content: "<html></html>" });

      await service.createForIdea(userId, projectId, ideaId);

      expect(mockPrisma.researchDemo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: "Demo: AI Platform" }),
        }),
      );
    });
  });

  // ==================== generateDemoHtml (indirectly via createForIdea) ====================

  describe("generateDemoHtml (via createForIdea)", () => {
    const userId = "user-1";
    const projectId = "project-1";
    const ideaId = "idea-1";
    const demoId = "demo-gen";

    const mockIdea = {
      id: ideaId,
      title: "Smart Health Monitor",
      description: "Wearable AI health tracking",
      metadata: {
        concept: "AI-driven",
        innovationPoints: ["real-time", "predictive"],
      },
      projectId,
    };

    beforeEach(() => {
      mockPrisma.researchProject.findUnique.mockResolvedValue({ userId });
      mockPrisma.researchIdea.findUnique.mockResolvedValue(mockIdea);
      mockPrisma.researchDemo.create.mockResolvedValue({
        id: demoId,
        status: "PENDING",
      });
    });

    it("should call aiFacade.chat with CHAT modelType and high creativity", async () => {
      mockPrisma.researchDemo.update.mockResolvedValue({});
      mockFacade.chat.mockResolvedValue({
        content: "<!DOCTYPE html><html></html>",
      });

      await service.createForIdea(userId, projectId, ideaId);

      // Wait for fire-and-forget to complete
      await new Promise((r) => setTimeout(r, 10));

      expect(mockFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          modelType: AIModelType.CHAT,
          taskProfile: { creativity: "high", outputLength: "long" },
        }),
      );
    });

    it("should set demo status to COMPLETED when AI generation succeeds", async () => {
      mockPrisma.researchDemo.update.mockResolvedValue({});
      mockFacade.chat.mockResolvedValue({
        content: "<!DOCTYPE html><html></html>",
      });

      await service.createForIdea(userId, projectId, ideaId);
      await new Promise((r) => setTimeout(r, 10));

      const updateCalls = mockPrisma.researchDemo.update.mock.calls;
      const completedCall = updateCalls.find(
        (c: [{ data: { status?: string } }]) =>
          c[0].data?.status === "COMPLETED",
      );
      expect(completedCall).toBeDefined();
    });

    it("should strip markdown code fences from AI html output", async () => {
      mockPrisma.researchDemo.update.mockResolvedValue({});
      mockFacade.chat.mockResolvedValue({
        content: "```html\n<!DOCTYPE html><html></html>\n```",
      });

      await service.createForIdea(userId, projectId, ideaId);
      await new Promise((r) => setTimeout(r, 10));

      const updateCalls = mockPrisma.researchDemo.update.mock.calls;
      const completedCall = updateCalls.find(
        (c: [{ data: { status?: string; htmlContent?: string } }]) =>
          c[0].data?.status === "COMPLETED",
      );
      expect(completedCall).toBeDefined();
      expect(completedCall[0].data.htmlContent).not.toContain("```");
    });

    it("should set demo status to FAILED when AI generation throws", async () => {
      mockPrisma.researchDemo.update.mockResolvedValue({});
      mockFacade.chat.mockRejectedValue(new Error("AI unavailable"));

      await service.createForIdea(userId, projectId, ideaId);
      await new Promise((r) => setTimeout(r, 10));

      const updateCalls = mockPrisma.researchDemo.update.mock.calls;
      const failedCall = updateCalls.find(
        (c: [{ data: { status?: string } }]) => c[0].data?.status === "FAILED",
      );
      expect(failedCall).toBeDefined();
      expect(failedCall[0].data.error).toBe("AI unavailable");
    });
  });

  // ==================== delete ====================

  describe("delete", () => {
    const userId = "user-1";
    const projectId = "project-1";
    const demoId = "demo-1";

    beforeEach(() => {
      mockPrisma.researchProject.findUnique.mockResolvedValue({ userId });
    });

    it("should call prisma.researchDemo.delete with correct where clause", async () => {
      mockPrisma.researchDemo.delete.mockResolvedValue({ id: demoId });

      await service.delete(userId, projectId, demoId);

      expect(mockPrisma.researchDemo.delete).toHaveBeenCalledWith({
        where: { id: demoId, projectId },
      });
    });

    it("should return the deleted demo", async () => {
      const deleted = { id: demoId };
      mockPrisma.researchDemo.delete.mockResolvedValue(deleted);

      const result = await service.delete(userId, projectId, demoId);

      expect(result).toEqual(deleted);
    });

    it("should throw NotFoundException when prisma throws P2025 (record not found)", async () => {
      mockPrisma.researchDemo.delete.mockRejectedValue({ code: "P2025" });

      await expect(service.delete(userId, projectId, demoId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should re-throw non-P2025 errors without wrapping", async () => {
      const dbError = new Error("Connection lost");
      mockPrisma.researchDemo.delete.mockRejectedValue(dbError);

      await expect(service.delete(userId, projectId, demoId)).rejects.toThrow(
        "Connection lost",
      );
    });
  });
});
