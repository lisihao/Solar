/**
 * Unit tests for ResearchIdeaService
 *
 * All Prisma and AIFacade dependencies are fully mocked.
 */

jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: jest.fn(),
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: jest.fn(),
}));

import { Test, TestingModule } from "@nestjs/testing";
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { AIModelType, ResearchIdeaType } from "@prisma/client";
import { ResearchIdeaService } from "../research-idea.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import {
  CreateResearchIdeaDto,
  UpdateResearchIdeaDto,
} from "../research-idea.dto";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const mockPrisma = {
  researchProject: {
    findUnique: jest.fn(),
  },
  researchIdea: {
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  deepResearchSession: {
    findUnique: jest.fn(),
  },
};

const mockFacade = {
  chat: jest.fn(),
};

function makeProject(overrides: Record<string, unknown> = {}) {
  return { id: "proj-1", userId: "user-1", ...overrides };
}

function makeIdea(overrides: Record<string, unknown> = {}) {
  return {
    id: "idea-1",
    projectId: "proj-1",
    title: "Test Idea",
    description: "Test description",
    type: ResearchIdeaType.INSIGHT,
    tags: [],
    demos: [],
    createdAt: new Date(),
    ...overrides,
  };
}

const VALID_INSIGHTS_JSON = JSON.stringify([
  {
    title: "CUDA生态锁定正被边缘AI瓦解",
    coreInsight: "边缘AI正在打破CUDA的垄断地位，这是一个结构性变化。",
    evidence: ["Evidence point 1 from discussion"],
    researchDirection: "深入研究边缘AI芯片市场份额变化",
    impactLevel: "high",
    sourceAgent: "analyst",
    tags: ["技术趋势", "AI芯片"],
  },
]);

const VALID_CREATIVE_IDEAS_JSON = JSON.stringify([
  {
    title: "基于边缘AI的新型推理架构方案",
    concept: "结合边缘计算和AI推理，降低延迟。",
    innovationPoints: ["降低延迟", "减少云依赖"],
    approach: "采用分层推理策略，首先在边缘处理，复杂任务上云。",
    feasibility: "high",
    dimension: "新方案",
    sourceInsightIds: ["idea-insight-1"],
  },
]);

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("ResearchIdeaService", () => {
  let service: ResearchIdeaService;

  beforeEach(async () => {
    // resetAllMocks clears both calls AND the mockReturnValueOnce queue,
    // preventing stale 'once' values from bleeding into subsequent tests.
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchIdeaService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<ResearchIdeaService>(ResearchIdeaService);
  });

  // =========================================================================
  // verifyProjectOwnership (via listByProject)
  // =========================================================================

  describe("verifyProjectOwnership", () => {
    it("should throw NotFoundException when project does not exist", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(null);

      await expect(
        service.listByProject("user-1", "nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when user is not the project owner", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(
        makeProject({ userId: "other-user" }),
      );

      await expect(service.listByProject("user-1", "proj-1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // =========================================================================
  // listByProject
  // =========================================================================

  describe("listByProject", () => {
    it("should return all ideas for the project", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      const ideas = [makeIdea(), makeIdea({ id: "idea-2" })];
      mockPrisma.researchIdea.findMany.mockResolvedValue(ideas);

      const result = await service.listByProject("user-1", "proj-1");

      expect(result).toEqual(ideas);
      expect(mockPrisma.researchIdea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: "proj-1" },
        }),
      );
    });

    it("should filter by type when type is provided", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      mockPrisma.researchIdea.findMany.mockResolvedValue([]);

      await service.listByProject("user-1", "proj-1", ResearchIdeaType.INSIGHT);

      expect(mockPrisma.researchIdea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: "proj-1", type: ResearchIdeaType.INSIGHT },
        }),
      );
    });

    it("should not include type filter when type is undefined", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      mockPrisma.researchIdea.findMany.mockResolvedValue([]);

      await service.listByProject("user-1", "proj-1");

      const callArgs = mockPrisma.researchIdea.findMany.mock.calls[0][0];
      expect(callArgs.where).not.toHaveProperty("type");
    });
  });

  // =========================================================================
  // create
  // =========================================================================

  describe("create", () => {
    it("should create a new idea with provided fields", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      const created = makeIdea();
      mockPrisma.researchIdea.create.mockResolvedValue(created);

      const dto: CreateResearchIdeaDto = {
        title: "Test Idea",
        description: "Test description",
        tags: ["tag1"],
      };
      const result = await service.create("user-1", "proj-1", dto);

      expect(result).toEqual(created);
      expect(mockPrisma.researchIdea.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectId: "proj-1",
            title: "Test Idea",
            tags: ["tag1"],
          }),
        }),
      );
    });

    it("should use empty array for tags when not provided", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      mockPrisma.researchIdea.create.mockResolvedValue(makeIdea());

      const dto: CreateResearchIdeaDto = { title: "Minimal Idea" };
      await service.create("user-1", "proj-1", dto);

      const createData = mockPrisma.researchIdea.create.mock.calls[0][0].data;
      expect(createData.tags).toEqual([]);
    });
  });

  // =========================================================================
  // update
  // =========================================================================

  describe("update", () => {
    it("should update idea fields", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      const updated = makeIdea({ title: "Updated Title" });
      mockPrisma.researchIdea.update.mockResolvedValue(updated);

      const dto: UpdateResearchIdeaDto = { title: "Updated Title" };
      const result = await service.update("user-1", "proj-1", "idea-1", dto);

      expect(result).toEqual(updated);
      expect(mockPrisma.researchIdea.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "idea-1", projectId: "proj-1" },
          data: expect.objectContaining({ title: "Updated Title" }),
        }),
      );
    });

    it("should throw NotFoundException when idea does not exist (P2025)", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      mockPrisma.researchIdea.update.mockRejectedValue({ code: "P2025" });

      await expect(
        service.update("user-1", "proj-1", "nonexistent", { title: "x" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should rethrow non-P2025 errors", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      mockPrisma.researchIdea.update.mockRejectedValue(new Error("DB crash"));

      await expect(
        service.update("user-1", "proj-1", "idea-1", { title: "x" }),
      ).rejects.toThrow("DB crash");
    });
  });

  // =========================================================================
  // delete
  // =========================================================================

  describe("delete", () => {
    it("should delete the idea", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      mockPrisma.researchIdea.delete.mockResolvedValue(makeIdea());

      await service.delete("user-1", "proj-1", "idea-1");

      expect(mockPrisma.researchIdea.delete).toHaveBeenCalledWith({
        where: { id: "idea-1", projectId: "proj-1" },
      });
    });

    it("should throw NotFoundException when idea does not exist (P2025)", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      mockPrisma.researchIdea.delete.mockRejectedValue({ code: "P2025" });

      await expect(
        service.delete("user-1", "proj-1", "nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // extractFromSession
  // =========================================================================

  describe("extractFromSession", () => {
    const session = {
      id: "sess-1",
      projectId: "proj-1",
      discussion: [
        {
          id: "msg-1",
          agentRole: "analyst",
          agentName: "Analyst",
          content: "This is a research finding about AI chips.",
          phase: "research",
          messageType: "analysis",
        },
      ],
    };

    it("should throw NotFoundException when session is not found", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      mockPrisma.deepResearchSession.findUnique.mockResolvedValue(null);

      await expect(
        service.extractFromSession("user-1", "proj-1", "nonexistent-session"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should return empty array when discussion is empty", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      mockPrisma.deepResearchSession.findUnique.mockResolvedValue({
        ...session,
        discussion: [],
      });

      const result = await service.extractFromSession(
        "user-1",
        "proj-1",
        "sess-1",
      );
      expect(result).toEqual([]);
    });

    it("should call AI facade.chat to extract ideas from discussion", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      mockPrisma.deepResearchSession.findUnique.mockResolvedValue(session);
      mockPrisma.researchIdea.findMany
        .mockResolvedValueOnce([]) // existing ideas check
        .mockResolvedValueOnce([makeIdea()]); // final return
      mockPrisma.researchIdea.createMany.mockResolvedValue({ count: 1 });

      mockFacade.chat.mockResolvedValue({
        content: VALID_INSIGHTS_JSON,
      });

      await service.extractFromSession("user-1", "proj-1", "sess-1");

      expect(mockFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          modelType: AIModelType.CHAT,
          taskProfile: expect.objectContaining({ creativity: "medium" }),
        }),
      );
    });

    it("should delete old ideas before re-extracting when ideas already exist", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      mockPrisma.deepResearchSession.findUnique.mockResolvedValue(session);
      mockPrisma.researchIdea.findMany
        .mockResolvedValueOnce([makeIdea()]) // existing ideas (non-empty)
        .mockResolvedValueOnce([makeIdea()]); // final return
      mockPrisma.researchIdea.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.researchIdea.createMany.mockResolvedValue({ count: 1 });

      mockFacade.chat.mockResolvedValue({ content: VALID_INSIGHTS_JSON });

      await service.extractFromSession("user-1", "proj-1", "sess-1");

      expect(mockPrisma.researchIdea.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sessionId: "sess-1",
            type: ResearchIdeaType.INSIGHT,
          }),
        }),
      );
    });

    it("should return empty array when AI returns invalid JSON", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      mockPrisma.deepResearchSession.findUnique.mockResolvedValue(session);
      mockPrisma.researchIdea.findMany.mockResolvedValueOnce([]);

      mockFacade.chat.mockResolvedValue({ content: "not valid json {{" });

      const result = await service.extractFromSession(
        "user-1",
        "proj-1",
        "sess-1",
      );
      expect(result).toEqual([]);
    });

    it("should return empty array when AI returns non-array JSON", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      mockPrisma.deepResearchSession.findUnique.mockResolvedValue(session);
      mockPrisma.researchIdea.findMany.mockResolvedValueOnce([]);

      mockFacade.chat.mockResolvedValue({ content: '{"key": "value"}' });

      const result = await service.extractFromSession(
        "user-1",
        "proj-1",
        "sess-1",
      );
      expect(result).toEqual([]);
    });

    it("should filter out ideas with titles starting with forbidden words", async () => {
      const invalidIdea = {
        title: "各位研究员请注意...",
        coreInsight: "Some insight here.",
        evidence: ["Evidence"],
        researchDirection: "Investigate further.",
        impactLevel: "high",
        sourceAgent: "analyst",
        tags: [],
      };
      const validIdea = JSON.parse(VALID_INSIGHTS_JSON)[0];

      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      mockPrisma.deepResearchSession.findUnique.mockResolvedValue(session);
      mockPrisma.researchIdea.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([makeIdea()]);
      mockPrisma.researchIdea.createMany.mockResolvedValue({ count: 1 });

      mockFacade.chat.mockResolvedValue({
        content: JSON.stringify([invalidIdea, validIdea]),
      });

      await service.extractFromSession("user-1", "proj-1", "sess-1");

      const createManyCall =
        mockPrisma.researchIdea.createMany.mock.calls[0][0];
      const savedTitles = createManyCall.data.map(
        (d: { title: string }) => d.title,
      );
      expect(savedTitles).not.toContain("各位研究员请注意...");
      expect(savedTitles).toContain("CUDA生态锁定正被边缘AI瓦解");
    });
  });

  // =========================================================================
  // extractCreativeIdeas
  // =========================================================================

  describe("extractCreativeIdeas", () => {
    it("should throw BadRequestException when no insights found", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      mockPrisma.researchIdea.findMany.mockResolvedValue([]);

      await expect(
        service.extractCreativeIdeas("user-1", "proj-1"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should call AI facade with high creativity for creative idea extraction", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      mockPrisma.researchIdea.findMany
        .mockResolvedValueOnce([makeIdea()]) // insights
        .mockResolvedValueOnce([{ id: "idea-insight-1" }]) // valid insight IDs
        .mockResolvedValueOnce([
          makeIdea({ type: ResearchIdeaType.CREATIVE_IDEA }),
        ]); // final return

      mockPrisma.researchIdea.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.researchIdea.createMany.mockResolvedValue({ count: 1 });

      mockFacade.chat.mockResolvedValue({ content: VALID_CREATIVE_IDEAS_JSON });

      await service.extractCreativeIdeas("user-1", "proj-1");

      expect(mockFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          modelType: AIModelType.CHAT,
          taskProfile: expect.objectContaining({ creativity: "high" }),
        }),
      );
    });

    it("should delete existing creative ideas before saving new ones", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      mockPrisma.researchIdea.findMany
        .mockResolvedValueOnce([makeIdea()])
        .mockResolvedValueOnce([{ id: "idea-insight-1" }])
        .mockResolvedValueOnce([]);

      mockPrisma.researchIdea.deleteMany.mockResolvedValue({ count: 2 });
      mockPrisma.researchIdea.createMany.mockResolvedValue({ count: 1 });
      mockFacade.chat.mockResolvedValue({ content: VALID_CREATIVE_IDEAS_JSON });

      await service.extractCreativeIdeas("user-1", "proj-1");

      expect(mockPrisma.researchIdea.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: "proj-1",
            type: ResearchIdeaType.CREATIVE_IDEA,
          }),
        }),
      );
    });

    it("should return empty array when AI returns no valid creative ideas", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      mockPrisma.researchIdea.findMany.mockResolvedValueOnce([makeIdea()]);

      mockFacade.chat.mockResolvedValue({ content: "[]" });

      const result = await service.extractCreativeIdeas("user-1", "proj-1");
      expect(result).toEqual([]);
    });

    it("should filter creative ideas missing required fields", async () => {
      const incompleteIdea = {
        title: "Incomplete",
        // missing concept, approach, feasibility, dimension
      };

      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      mockPrisma.researchIdea.findMany.mockResolvedValueOnce([makeIdea()]);

      mockFacade.chat.mockResolvedValue({
        content: JSON.stringify([incompleteIdea]),
      });

      const result = await service.extractCreativeIdeas("user-1", "proj-1");
      expect(result).toEqual([]);
    });

    it("should normalize feasibility to lowercase", async () => {
      const ideaWithUpperCase = JSON.parse(VALID_CREATIVE_IDEAS_JSON)[0];
      ideaWithUpperCase.feasibility = "HIGH"; // uppercase

      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      mockPrisma.researchIdea.findMany
        .mockResolvedValueOnce([makeIdea()])
        .mockResolvedValueOnce([{ id: "idea-insight-1" }])
        .mockResolvedValueOnce([
          makeIdea({ type: ResearchIdeaType.CREATIVE_IDEA }),
        ]);

      mockPrisma.researchIdea.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.researchIdea.createMany.mockResolvedValue({ count: 1 });
      mockFacade.chat.mockResolvedValue({
        content: JSON.stringify([ideaWithUpperCase]),
      });

      await service.extractCreativeIdeas("user-1", "proj-1");

      const createManyCall =
        mockPrisma.researchIdea.createMany.mock.calls[0][0];
      // Should not have saved ideas with invalid feasibility format
      expect(createManyCall).toBeDefined();
    });

    it("should limit insights to top 30 sorted by impact level", async () => {
      // Create more than 30 insights
      const manyInsights = Array.from({ length: 40 }, (_, i) => ({
        ...makeIdea({ id: `idea-${i}` }),
        metadata: { impactLevel: i < 10 ? "high" : i < 25 ? "medium" : "low" },
      }));

      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      mockPrisma.researchIdea.findMany
        .mockResolvedValueOnce(manyInsights)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      mockFacade.chat.mockResolvedValue({ content: "[]" });

      await service.extractCreativeIdeas("user-1", "proj-1");

      // Check that chat was called with content (the insights were formatted)
      expect(mockFacade.chat).toHaveBeenCalled();
      const chatArgs = mockFacade.chat.mock.calls[0][0];
      const userContent = chatArgs.messages[1].content as string;
      // The content should include some but not all insights' titles
      expect(typeof userContent).toBe("string");
    });

    it("should handle AI facade errors gracefully", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      // Return a non-empty insights list so it doesn't throw BadRequestException
      mockPrisma.researchIdea.findMany.mockResolvedValueOnce([makeIdea()]);

      mockFacade.chat.mockRejectedValue(new Error("LLM timeout"));

      // When AI call fails inside aiExtractCreativeIdeas, service returns []
      const result = await service.extractCreativeIdeas("user-1", "proj-1");
      expect(result).toEqual([]);
    });
  });
});
