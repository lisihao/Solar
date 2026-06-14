/**
 * Tests for ResearchIdeaService
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { ResearchIdeaService } from "../idea/research-idea.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

jest.mock("@prisma/client", () => ({
  AIModelType: {
    CHAT: "CHAT",
    CHAT_FAST: "CHAT_FAST",
  },
  ResearchIdeaType: {
    INSIGHT: "INSIGHT",
    CREATIVE_IDEA: "CREATIVE_IDEA",
  },
  PrismaClient: class MockPrismaClient {},
}));

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

jest.mock("../../../../common/prisma/prisma.service", () => ({
  PrismaService: jest.fn().mockImplementation(() => ({
    researchProject: { findUnique: jest.fn() },
    researchIdea: {
      findMany: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    deepResearchSession: { findUnique: jest.fn() },
  })),
}));

describe("ResearchIdeaService", () => {
  let service: ResearchIdeaService;
  let prisma: jest.Mocked<PrismaService>;
  let aiFacade: jest.Mocked<ChatFacade>;

  const userId = "user-123";
  const projectId = "project-456";
  const ideaId = "idea-789";

  const mockProject = {
    id: projectId,
    userId,
    name: "Test Project",
  };

  const mockIdea = {
    id: ideaId,
    projectId,
    title: "Test Idea",
    description: "Test Description",
    type: "INSIGHT",
    tags: [],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockPrismaService = {
      researchProject: {
        findUnique: jest.fn(),
      },
      researchIdea: {
        findMany: jest.fn(),
        create: jest.fn(),
        createMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
        findUnique: jest.fn(),
      },
      deepResearchSession: {
        findUnique: jest.fn(),
      },
    };

    const mockFacadeInstance = {
      chat: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchIdeaService,
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

    service = module.get<ResearchIdeaService>(ResearchIdeaService);
    prisma = module.get(PrismaService);
    aiFacade = module.get(ChatFacade);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("listByProject", () => {
    it("should list ideas for a project", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchIdea.findMany as jest.Mock).mockResolvedValue([mockIdea]);

      const result = await service.listByProject(userId, projectId);

      expect(result).toHaveLength(1);
      expect(prisma.researchIdea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId },
        }),
      );
    });

    it("should throw NotFoundException when project not found", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.listByProject(userId, projectId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw ForbiddenException when user is not owner", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue({
        ...mockProject,
        userId: "other-user",
      });

      await expect(service.listByProject(userId, projectId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("should filter by type when provided", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchIdea.findMany as jest.Mock).mockResolvedValue([]);

      await service.listByProject(userId, projectId, "INSIGHT" as any);

      expect(prisma.researchIdea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId, type: "INSIGHT" },
        }),
      );
    });
  });

  describe("create", () => {
    it("should create an idea", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchIdea.create as jest.Mock).mockResolvedValue(mockIdea);

      const dto = {
        title: "New Idea",
        description: "Description",
        tags: ["tag1"],
      };

      const result = await service.create(userId, projectId, dto);

      expect(result).toBe(mockIdea);
      expect(prisma.researchIdea.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectId,
            title: "New Idea",
            tags: ["tag1"],
          }),
        }),
      );
    });

    it("should use empty tags array when not provided", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchIdea.create as jest.Mock).mockResolvedValue(mockIdea);

      await service.create(userId, projectId, { title: "No Tags" });

      expect(prisma.researchIdea.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tags: [],
          }),
        }),
      );
    });
  });

  describe("update", () => {
    it("should update an idea", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchIdea.update as jest.Mock).mockResolvedValue({
        ...mockIdea,
        title: "Updated",
      });

      const result = await service.update(userId, projectId, ideaId, {
        title: "Updated",
      });

      expect(result.title).toBe("Updated");
    });

    it("should throw NotFoundException when idea not found (P2025)", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      const prismaError = { code: "P2025", message: "Not found" };
      (prisma.researchIdea.update as jest.Mock).mockRejectedValue(prismaError);

      await expect(
        service.update(userId, projectId, "nonexistent", {}),
      ).rejects.toThrow(NotFoundException);
    });

    it("should rethrow non-P2025 errors", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchIdea.update as jest.Mock).mockRejectedValue(
        new Error("DB Error"),
      );

      await expect(
        service.update(userId, projectId, ideaId, {}),
      ).rejects.toThrow("DB Error");
    });
  });

  describe("delete", () => {
    it("should delete an idea", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchIdea.delete as jest.Mock).mockResolvedValue(mockIdea);

      const _result = await service.delete(userId, projectId, ideaId);

      expect(prisma.researchIdea.delete).toHaveBeenCalledWith({
        where: { id: ideaId, projectId },
      });
    });

    it("should throw NotFoundException when idea not found (P2025)", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      const prismaError = { code: "P2025" };
      (prisma.researchIdea.delete as jest.Mock).mockRejectedValue(prismaError);

      await expect(
        service.delete(userId, projectId, "nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("extractFromSession", () => {
    const sessionId = "session-abc";
    const mockSession = {
      id: sessionId,
      projectId,
      discussion: [
        {
          id: "msg1",
          agentRole: "researcher-a",
          agentName: "Researcher A",
          content: "AI is transforming industries...",
          phase: "ideation",
          messageType: "idea",
        },
      ],
    };

    it("should return empty array when discussion is empty", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.deepResearchSession.findUnique as jest.Mock).mockResolvedValue({
        ...mockSession,
        discussion: [],
      });

      const result = await service.extractFromSession(
        userId,
        projectId,
        sessionId,
      );

      expect(result).toEqual([]);
    });

    it("should throw NotFoundException when session not found", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.deepResearchSession.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.extractFromSession(userId, projectId, sessionId),
      ).rejects.toThrow(NotFoundException);
    });

    it("should extract ideas from session discussion", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.deepResearchSession.findUnique as jest.Mock).mockResolvedValue(
        mockSession,
      );
      (prisma.researchIdea.findMany as jest.Mock)
        .mockResolvedValueOnce([]) // existingIdeas check
        .mockResolvedValue([mockIdea]); // final return
      (prisma.researchIdea.createMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content:
          "```json\n" +
          JSON.stringify([
            {
              title: "AI Market Disruption",
              coreInsight: "AI is fundamentally disrupting traditional markets",
              evidence: ["Evidence 1", "Evidence 2"],
              researchDirection: "Study market disruption patterns",
              impactLevel: "high",
              sourceAgent: "Researcher A",
              tags: ["AI", "market"],
            },
          ]) +
          "\n```",
        tokensUsed: 500,
      });

      const _result = await service.extractFromSession(
        userId,
        projectId,
        sessionId,
      );

      expect(prisma.researchIdea.createMany).toHaveBeenCalled();
    });

    it("should handle AI extraction failure gracefully", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.deepResearchSession.findUnique as jest.Mock).mockResolvedValue(
        mockSession,
      );
      (prisma.researchIdea.findMany as jest.Mock).mockResolvedValue([]);
      (aiFacade.chat as jest.Mock).mockRejectedValue(new Error("AI Error"));

      const result = await service.extractFromSession(
        userId,
        projectId,
        sessionId,
      );

      expect(result).toEqual([]);
    });

    it("should re-extract by clearing old ideas first", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.deepResearchSession.findUnique as jest.Mock).mockResolvedValue(
        mockSession,
      );
      // First findMany returns existing ideas
      (prisma.researchIdea.findMany as jest.Mock)
        .mockResolvedValueOnce([mockIdea]) // existingIdeas
        .mockResolvedValue([]); // final return
      (prisma.researchIdea.deleteMany as jest.Mock).mockResolvedValue({
        count: 1,
      });
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content: "[]",
        tokensUsed: 100,
      });

      await service.extractFromSession(userId, projectId, sessionId);

      expect(prisma.researchIdea.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ sessionId }),
        }),
      );
    });

    it("should filter out ideas with invalid quality", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.deepResearchSession.findUnique as jest.Mock).mockResolvedValue(
        mockSession,
      );
      (prisma.researchIdea.findMany as jest.Mock).mockResolvedValue([]);

      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify([
          // Valid idea
          {
            title: "Valid Title",
            coreInsight: "Valid core insight that is long enough",
            evidence: ["Evidence 1"],
            researchDirection: "Valid direction",
            impactLevel: "high",
          },
          // Too short title
          {
            title: "Hi",
            coreInsight: "Some insight",
            evidence: ["Evidence"],
            researchDirection: "Direction",
            impactLevel: "high",
          },
          // Invalid impact level
          {
            title: "Valid Title 2",
            coreInsight: "Valid core insight",
            evidence: ["Evidence"],
            researchDirection: "Direction",
            impactLevel: "critical", // invalid
          },
          // Starts with 各位
          {
            title: "各位同事请注意",
            coreInsight: "Some insight",
            evidence: ["Evidence"],
            researchDirection: "Direction",
            impactLevel: "medium",
          },
        ]),
        tokensUsed: 500,
      });

      (prisma.researchIdea.createMany as jest.Mock).mockResolvedValue({
        count: 1,
      });
      (prisma.researchIdea.findMany as jest.Mock)
        .mockResolvedValueOnce([]) // existingIdeas
        .mockResolvedValue([mockIdea]);

      await service.extractFromSession(userId, projectId, sessionId);

      // Only the valid idea should be saved
      expect(prisma.researchIdea.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ title: "Valid Title" }),
          ]),
        }),
      );
    });
  });

  describe("extractCreativeIdeas", () => {
    it("should throw BadRequestException when no insights exist", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchIdea.findMany as jest.Mock).mockResolvedValue([]);

      await expect(
        service.extractCreativeIdeas(userId, projectId),
      ).rejects.toThrow(BadRequestException);
    });

    it("should extract creative ideas from insights", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchIdea.findMany as jest.Mock)
        .mockResolvedValueOnce([
          // insights
          {
            id: "insight-1",
            projectId,
            title: "AI Insight",
            description: "AI insight desc",
            type: "INSIGHT",
            metadata: {
              coreInsight: "Core AI insight",
              evidence: ["Evidence 1"],
              impactLevel: "high",
            },
            createdAt: new Date(),
          },
        ])
        .mockResolvedValueOnce([{ id: "insight-1" }]) // valid insight IDs
        .mockResolvedValue([mockIdea]); // final return

      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify([
          {
            title: "Creative Idea 1",
            concept: "A creative concept for AI",
            innovationPoints: ["Point 1", "Point 2"],
            approach: "Use AI in new ways",
            feasibility: "high",
            dimension: "新方案",
            sourceInsightIds: ["insight-1"],
          },
        ]),
        tokensUsed: 500,
      });

      (prisma.researchIdea.deleteMany as jest.Mock).mockResolvedValue({
        count: 0,
      });
      (prisma.researchIdea.createMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      const _result = await service.extractCreativeIdeas(userId, projectId);

      expect(prisma.researchIdea.createMany).toHaveBeenCalled();
    });

    it("should return empty array when AI produces no ideas", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchIdea.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: "insight-1",
          projectId,
          title: "AI Insight",
          type: "INSIGHT",
          metadata: { impactLevel: "high" },
          createdAt: new Date(),
        },
      ]);

      (aiFacade.chat as jest.Mock).mockRejectedValue(new Error("AI failure"));

      const result = await service.extractCreativeIdeas(userId, projectId);

      expect(result).toEqual([]);
    });
  });
});
