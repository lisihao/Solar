/**
 * ResearchLeaderService - Supplemental Unit Tests
 *
 * Covers uncovered branches in:
 * - planDimensionOutline: success, retry on error, all retries fail, isError, HTML response
 * - planGlobalOutline: success, missing dimension stubs, all retries fail
 * - integrateDimensionResults: single section, no model fallback, AI meta extraction, error in meta
 * - decodeUserInput: topic not found, with missionId, project config question bypass
 */

jest.mock("@prisma/client", () => ({
  PrismaClient: class PrismaClient { $connect = jest.fn(); $disconnect = jest.fn(); $on = jest.fn(); }, ...jest.requireActual("@prisma/client"),
  AIModelType: {
    CHAT: "CHAT",
    CHAT_FAST: "CHAT_FAST",
    IMAGE_GENERATION: "IMAGE_GENERATION",
    IMAGE_EDITING: "IMAGE_EDITING",
    MULTIMODAL: "MULTIMODAL",
    EMBEDDING: "EMBEDDING",
    RERANK: "RERANK",
  },
}));

import { Test, TestingModule } from "@nestjs/testing";
import { ResearchLeaderService } from "../research-leader.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ChatFacade, AgentFacade, ToolFacade } from "@/modules/ai-harness/facade";
import { ResearchEventEmitterService } from "../research-event-emitter.service";
import { LeaderToolService } from "../../../data/leader-tool.service";
import { LeaderPlanningService } from "../../leader/leader-planning.service";
import { LeaderIntentService } from "../../leader/leader-intent.service";
import { LeaderAgentSelectionService } from "../../leader/leader-agent-selection.service";
import { LeaderReviewService } from "../../leader/leader-review.service";

// ──────────────────────────────────────────────────────────────────────────────
// Mock factory
// ──────────────────────────────────────────────────────────────────────────────

function buildMocks() {
  const mockPrisma = {
    researchTopic: {
      findUnique: jest.fn(),
    },
    researchMission: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    researchTask: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    leaderDecision: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const mockFacade = {
    getAvailableModelsExtended: jest.fn().mockResolvedValue([]),
    getReasoningModel: jest.fn(),
    selectModel: jest.fn(),
    chat: jest.fn(),
    chatWithSkills: jest.fn(),
    intentDetector: {
      detectIntent: jest
        .fn()
        .mockReturnValue({ intent: "UNKNOWN", confidence: 0.1 }),
    },
  };

  const mockEventEmitter = {
    saveUserMessage: jest.fn().mockResolvedValue(undefined),
    emitLeaderResponse: jest.fn().mockResolvedValue(undefined),
    emitResumeMissionExecution: jest.fn().mockResolvedValue(undefined),
    getLeaderConversationHistory: jest.fn().mockResolvedValue([]),
  };

  const mockLeaderToolService = {
    createDimension: jest.fn(),
    deleteDimension: jest.fn(),
    cancelTask: jest.fn(),
    updateDimension: jest.fn(),
    mergeDimensions: jest.fn(),
  };

  return { mockPrisma, mockFacade, mockEventEmitter, mockLeaderToolService };
}

// ──────────────────────────────────────────────────────────────────────────────
// Common fixtures
// ──────────────────────────────────────────────────────────────────────────────

const mockTopic = {
  id: "topic-001",
  name: "AI 前沿技术",
  type: "technology",
  description: "人工智能前沿技术趋势",
  language: "zh",
  dimensions: [
    {
      id: "dim-001",
      name: "技术现状",
      description: "技术分析",
      status: "PENDING",
      searchQueries: [],
    },
  ],
};

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("ResearchLeaderService (supplemental)", () => {
  let service: ResearchLeaderService;
  let mocks: ReturnType<typeof buildMocks>;

  beforeAll(async () => {
    mocks = buildMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchLeaderService,
        LeaderPlanningService,
        LeaderIntentService,
        LeaderAgentSelectionService,
        LeaderReviewService,
        { provide: PrismaService, useValue: mocks.mockPrisma },
        { provide: ChatFacade, useValue: mocks.mockFacade },
        { provide: AgentFacade, useValue: mocks.mockFacade },
        { provide: ToolFacade, useValue: mocks.mockFacade },
        {
          provide: ResearchEventEmitterService,
          useValue: mocks.mockEventEmitter,
        },
        { provide: LeaderToolService, useValue: mocks.mockLeaderToolService },
      ],
    }).compile();

    service = module.get<ResearchLeaderService>(ResearchLeaderService);
  });

  afterEach(() => jest.clearAllMocks());

  // ============================================================
  // planDimensionOutline
  // ============================================================

  describe("planDimensionOutline", () => {
    const topic = {
      name: "AI 前沿技术",
      type: "technology",
      description: "人工智能前沿",
      language: "zh",
    };
    const dimension = {
      name: "技术现状",
      description: "技术描述",
      searchQueries: ["AI trends 2024"],
    };
    const evidenceSummary = "搜索到大量 AI 技术文献";

    it("should return outline on successful first attempt", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue({
        id: "o3-mini",
        name: "o3-mini",
        provider: "openai",
        isReasoning: true,
      });
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          sections: [
            {
              id: "s1",
              title: "技术现状分析",
              description: "分析",
              keyPoints: ["趋势"],
              targetWords: 1500,
              evidenceRequirements: { minReferences: 3 },
            },
          ],
          intentUnderstanding: {
            coreQuestion: "技术现状",
            scope: { included: [], excluded: [] },
          },
          executionPlan: {
            parallelGroups: [["s1"]],
            estimatedTotalWords: 1500,
          },
        }),
        isError: false,
      });

      const result = await service.planDimensionOutline(
        topic,
        dimension,
        evidenceSummary,
      );

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].title).toBe("技术现状分析");
    });

    it("should include figuresSummary in prompt when provided", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue({
        id: "o3-mini",
        name: "o3-mini",
        provider: "openai",
        isReasoning: true,
      });
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          sections: [
            {
              id: "s1",
              title: "分析",
              description: "desc",
              keyPoints: [],
              targetWords: 500,
              evidenceRequirements: { minReferences: 1 },
            },
          ],
        }),
        isError: false,
      });

      await service.planDimensionOutline(
        topic,
        dimension,
        evidenceSummary,
        "图表1: 趋势图",
      );

      expect(mocks.mockFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining("图表"),
            }),
          ]),
        }),
      );
    });

    it("should throw when no model available on all attempts", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(null);
      mocks.mockFacade.selectModel.mockResolvedValue(null);

      await expect(
        service.planDimensionOutline(topic, dimension, evidenceSummary),
      ).rejects.toThrow("No model available for Leader");
    }, 15000);

    it("should retry and succeed on second attempt when first returns isError", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue({
        id: "o3-mini",
        name: "o3-mini",
        provider: "openai",
        isReasoning: true,
      });

      // First attempt: isError
      // Second attempt: success
      mocks.mockFacade.chat
        .mockResolvedValueOnce({
          content: "Rate limit exceeded 429",
          isError: true,
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            sections: [
              {
                id: "s1",
                title: "技术现状",
                description: "desc",
                keyPoints: [],
                targetWords: 800,
                evidenceRequirements: { minReferences: 2 },
              },
            ],
          }),
          isError: false,
        });

      const result = await service.planDimensionOutline(
        topic,
        dimension,
        evidenceSummary,
      );
      expect(result.sections).toHaveLength(1);
    }, 15000);

    it("should throw after all MAX_RETRIES fail with parse error", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue({
        id: "o3-mini",
        name: "o3-mini",
        provider: "openai",
        isReasoning: true,
      });
      // All responses unparseable
      mocks.mockFacade.chat.mockResolvedValue({
        content: "This is not valid JSON",
        isError: false,
      });

      await expect(
        service.planDimensionOutline(topic, dimension, evidenceSummary),
      ).rejects.toThrow("Failed to parse dimension outline after");
    }, 30000);

    it("should retry and throw when API returns HTML error page on all attempts", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue({
        id: "o3-mini",
        name: "o3-mini",
        provider: "openai",
        isReasoning: true,
      });
      mocks.mockFacade.chat.mockResolvedValue({
        content: "<!DOCTYPE html><html>Error</html>",
        isError: false,
      });

      await expect(
        service.planDimensionOutline(topic, dimension, evidenceSummary),
      ).rejects.toThrow("Failed to parse dimension outline after");
    }, 30000);

    it("should handle non-array searchQueries gracefully", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue({
        id: "o3-mini",
        name: "o3-mini",
        provider: "openai",
        isReasoning: true,
      });
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          sections: [
            {
              id: "s1",
              title: "分析",
              description: "desc",
              keyPoints: [],
              targetWords: 500,
              evidenceRequirements: { minReferences: 1 },
            },
          ],
        }),
        isError: false,
      });

      // searchQueries is a string (non-array)
      const dimWithStringQueries = { ...dimension, searchQueries: "AI trends" };
      const result = await service.planDimensionOutline(
        topic,
        dimWithStringQueries,
        evidenceSummary,
      );
      expect(result.sections).toHaveLength(1);
    });
  });

  // ============================================================
  // planGlobalOutline
  // ============================================================

  describe("planGlobalOutline", () => {
    const topic = {
      name: "AI 前沿技术",
      type: "technology",
      description: "人工智能",
      language: "zh",
    };
    const dimensionSearchResults = [
      {
        dimensionId: "dim-001",
        dimensionName: "技术现状",
        dimensionDescription: "技术描述",
        evidenceSummary: "AI 技术文献摘要",
        figuresSummary: "图1: 趋势图",
        searchQueries: ["AI trends"],
      },
      {
        dimensionId: "dim-002",
        dimensionName: "市场格局",
        dimensionDescription: "市场描述",
        evidenceSummary: "市场分析",
        figuresSummary: "",
        searchQueries: ["market share"],
      },
    ];

    it("should return global outline on successful first attempt", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue({
        id: "o3-mini",
        name: "o3-mini",
        provider: "openai",
        isReasoning: true,
      });
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          dimensions: [
            {
              dimensionId: "dim-001",
              dimensionName: "技术现状",
              crossDimensionNotes: "",
              outline: {
                sections: [],
                intentUnderstanding: {},
                executionPlan: {},
              },
            },
            {
              dimensionId: "dim-002",
              dimensionName: "市场格局",
              crossDimensionNotes: "",
              outline: {
                sections: [],
                intentUnderstanding: {},
                executionPlan: {},
              },
            },
          ],
        }),
        isError: false,
      });

      const result = await service.planGlobalOutline(
        topic,
        dimensionSearchResults,
      );

      expect(result.dimensions).toHaveLength(2);
    });

    it("should add stub dimensions when AI omits some from the outline", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue({
        id: "o3-mini",
        name: "o3-mini",
        provider: "openai",
        isReasoning: true,
      });
      // AI only returns one dimension, missing "市场格局"
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          dimensions: [
            {
              dimensionId: "dim-001",
              dimensionName: "技术现状",
              crossDimensionNotes: "",
              outline: {
                sections: [],
                intentUnderstanding: {},
                executionPlan: {},
              },
            },
          ],
        }),
        isError: false,
      });

      const result = await service.planGlobalOutline(
        topic,
        dimensionSearchResults,
      );

      // Should have 2 dimensions (one original + one stub for 市场格局)
      expect(result.dimensions).toHaveLength(2);
      const stub = result.dimensions.find(
        (d) => d.dimensionName === "市场格局",
      );
      expect(stub).toBeDefined();
      expect(stub!.outline.sections[0].title).toBe("市场格局");
    });

    it("should add appendix-like stub with reduced word count", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue({
        id: "o3-mini",
        name: "o3-mini",
        provider: "openai",
        isReasoning: true,
      });
      const appendixDimResults = [
        ...dimensionSearchResults,
        {
          dimensionId: "dim-003",
          dimensionName: "附录",
          dimensionDescription: "参考资料",
          evidenceSummary: "附录内容",
          figuresSummary: "",
          searchQueries: [],
        },
      ];
      // AI only returns two out of three (missing appendix)
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          dimensions: [
            {
              dimensionId: "dim-001",
              dimensionName: "技术现状",
              crossDimensionNotes: "",
              outline: { sections: [] },
            },
            {
              dimensionId: "dim-002",
              dimensionName: "市场格局",
              crossDimensionNotes: "",
              outline: { sections: [] },
            },
          ],
        }),
        isError: false,
      });

      const result = await service.planGlobalOutline(topic, appendixDimResults);

      const appendixStub = result.dimensions.find(
        (d) => d.dimensionName === "附录",
      );
      expect(appendixStub).toBeDefined();
      // Appendix stub should have 400 words (half of normal 800)
      expect(appendixStub!.outline.sections[0].targetWords).toBe(400);
    });

    it("should throw after all retries fail with parse error", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue({
        id: "o3-mini",
        name: "o3-mini",
        provider: "openai",
        isReasoning: true,
      });
      mocks.mockFacade.chat.mockResolvedValue({
        content: "not json",
        isError: false,
      });

      await expect(
        service.planGlobalOutline(topic, dimensionSearchResults),
      ).rejects.toThrow("Failed to parse global outline after");
    }, 30000);

    it("should throw when no reasoning model available", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(null);

      await expect(
        service.planGlobalOutline(topic, dimensionSearchResults),
      ).rejects.toThrow("No reasoning model available for Leader");
    }, 15000);

    it("should handle non-array searchQueries in dimensionSearchResults", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue({
        id: "o3-mini",
        name: "o3-mini",
        provider: "openai",
        isReasoning: true,
      });
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          dimensions: [
            {
              dimensionId: "dim-001",
              dimensionName: "技术现状",
              crossDimensionNotes: "",
              outline: { sections: [{ id: "s1", title: "分析" }] },
            },
            {
              dimensionId: "dim-002",
              dimensionName: "市场格局",
              crossDimensionNotes: "",
              outline: { sections: [] },
            },
          ],
        }),
        isError: false,
      });

      const dimWithNonArrayQueries = [
        { ...dimensionSearchResults[0], searchQueries: "string query" },
        { ...dimensionSearchResults[1], searchQueries: null },
      ];

      // Should not throw, just use "无" as focus areas
      const result = await service.planGlobalOutline(
        topic,
        dimWithNonArrayQueries as never,
      );
      expect(result.dimensions).toHaveLength(2);
    });
  });

  // ============================================================
  // integrateDimensionResults
  // ============================================================

  describe("integrateDimensionResults", () => {
    const dimension = { name: "技术现状", description: "技术描述" };

    it("should return single section content directly without AI call", async () => {
      const singleSection = [
        { title: "技术分析", content: "技术内容分析文字" },
      ];

      const result = await service.integrateDimensionResults(
        dimension,
        singleSection,
      );

      // Content no longer includes dimension name (added by assembleFullReport)
      expect(result.content).toContain("技术内容分析文字");
      // No AI call for single section
      expect(mocks.mockFacade.chat).not.toHaveBeenCalled();
    });

    it("should use simple concatenation when no reasoning model available", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(null);

      const sections = [
        { title: "部分一", content: "部分一内容" },
        { title: "部分二", content: "部分二内容" },
      ];

      const result = await service.integrateDimensionResults(
        dimension,
        sections,
      );

      // Content no longer includes dimension name (added by assembleFullReport)
      expect(result.content).toContain("部分一内容");
      expect(result.content).toContain("部分二内容");
      expect(result.metadata.confidenceLevel).toBe("medium");
    });

    it("should call AI for meta extraction when model is available", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue({
        id: "o3-mini",
        name: "o3-mini",
        provider: "openai",
        isReasoning: true,
      });
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          summary: "AI 生成的摘要文字",
          keyFindings: ["关键发现1", "关键发现2"],
        }),
        isError: false,
      });

      const sections = [
        { title: "部分一", content: "技术内容一" },
        { title: "部分二", content: "技术内容二" },
      ];

      const result = await service.integrateDimensionResults(
        dimension,
        sections,
      );

      expect(result.metadata.summary).toBe("AI 生成的摘要文字");
      expect(result.metadata.keyFindings).toEqual(["关键发现1", "关键发现2"]);
    });

    it("should use fallback summary when AI meta extraction fails", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue({
        id: "o3-mini",
        name: "o3-mini",
        provider: "openai",
        isReasoning: true,
      });
      mocks.mockFacade.chat.mockRejectedValue(new Error("AI API error"));

      const sections = [
        { title: "部分一", content: "技术内容一" },
        { title: "部分二", content: "技术内容二" },
      ];

      // Should not throw; uses fallback
      const result = await service.integrateDimensionResults(
        dimension,
        sections,
      );

      // Content no longer includes dimension name (added by assembleFullReport)
      expect(result.content).toContain("技术内容一");
      expect(result.metadata.confidenceLevel).toBe("medium");
    });

    it("should use English meta prompt for English topic language", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue({
        id: "o3-mini",
        name: "o3-mini",
        provider: "openai",
        isReasoning: true,
      });
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          summary: "English summary here",
          keyFindings: ["Finding 1", "Finding 2"],
        }),
        isError: false,
      });

      const sections = [
        { title: "Section 1", content: "Content of section 1" },
        { title: "Section 2", content: "Content of section 2" },
      ];

      await service.integrateDimensionResults(dimension, sections, "en");

      expect(mocks.mockFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining("You are a research report"),
            }),
          ]),
          responseFormat: "json",
        }),
      );
    });

    it("should extract evidence IDs from content", async () => {
      const singleSection = [
        {
          title: "技术分析",
          content: "内容 [temp-1234-001] 更多内容 [temp-1234-002]",
        },
      ];

      const result = await service.integrateDimensionResults(
        dimension,
        singleSection,
      );

      expect(result.evidenceUsed).toContain("temp-1234-001");
      expect(result.evidenceUsed).toContain("temp-1234-002");
    });
  });

  // ============================================================
  // decodeUserInput
  // ============================================================

  describe("decodeUserInput", () => {
    it("should throw when topic not found", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      await expect(
        service.decodeUserInput("nonexistent-topic", "用户消息"),
      ).rejects.toThrow("Topic nonexistent-topic not found");
    });

    it("should call AI and return result for complex message", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue({
        id: "o3-mini",
        name: "o3-mini",
        provider: "openai",
        isReasoning: true,
      });
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          decisionType: "DIRECT_ANSWER",
          understanding: "用户想了解技术趋势",
          response: "目前 AI 技术快速发展",
        }),
        isError: false,
      });

      const result = await service.decodeUserInput(
        "topic-001",
        "AI 技术现在怎么样？",
      );

      expect(result.decisionType).toBe("DIRECT_ANSWER");
      expect(result.response).toBe("目前 AI 技术快速发展");
    });

    it("should query mission tasks when missionId is provided", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        id: "mission-001",
        tasks: [
          {
            id: "t1",
            status: "EXECUTING",
            title: "研究技术",
            dimensionName: "技术现状",
          },
          {
            id: "t2",
            status: "PENDING",
            title: "研究市场",
            dimensionName: null,
          },
        ],
      });
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue({
        id: "o3-mini",
        name: "o3-mini",
        provider: "openai",
        isReasoning: true,
      });
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          decisionType: "ACKNOWLEDGE",
          understanding: "用户查询进度",
          response: "研究进行中",
        }),
        isError: false,
      });

      const result = await service.decodeUserInput(
        "topic-001",
        "研究进行到哪了？",
        "mission-001",
      );

      expect(mocks.mockPrisma.researchMission.findUnique).toHaveBeenCalledWith({
        where: { id: "mission-001" },
        include: { tasks: true },
      });
      expect(result.decisionType).toBe("ACKNOWLEDGE");
    });

    it("should skip quick detect for project config questions about tools", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue({
        id: "o3-mini",
        name: "o3-mini",
        provider: "openai",
        isReasoning: true,
      });
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          decisionType: "DIRECT_ANSWER",
          understanding: "用户询问工具能力",
          response: "我有多种工具可以使用",
        }),
        isError: false,
      });

      // Message contains "工具" - should bypass quick decode and call AI directly
      const result = await service.decodeUserInput(
        "topic-001",
        "你有什么工具可以使用？",
      );

      // AI should have been called since it's a project config question
      expect(mocks.mockFacade.chat).toHaveBeenCalled();
      expect(result.response).toBe("我有多种工具可以使用");
    });

    it("should return fallback when AI response cannot be parsed", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue({
        id: "o3-mini",
        name: "o3-mini",
        provider: "openai",
        isReasoning: true,
      });
      mocks.mockFacade.chat.mockResolvedValue({
        content: "not valid json",
        isError: false,
      });

      const result = await service.decodeUserInput("topic-001", "你能做什么？");

      // Should return a fallback response
      expect(result).toBeDefined();
      expect(result.decisionType).toBeDefined();
    });
  });
});
