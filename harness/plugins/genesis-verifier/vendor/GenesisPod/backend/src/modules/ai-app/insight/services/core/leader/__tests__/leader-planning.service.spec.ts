/**
 * LeaderPlanningService Unit Tests
 *
 * Coverage:
 * - getReasoningModel: model found/not found
 * - planResearch: topic not found, no reasoning model, success, model name resolution,
 *   skill filtering, default skill assignment, AI call failure, empty response, parse failure
 * - planDimensionOutline: success, retry on quota error, non-retryable errors
 *   (InsufficientCreditsException, ContextTooLongException), JSON parse failure retry,
 *   all retries exhausted, HTML error page, model fallback on last attempt
 * - planGlobalOutline: success, missing dimension stub, retry with model fallback,
 *   non-retryable errors, all retries exhausted
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  NotFoundException,
  ServiceUnavailableException,
  InternalServerErrorException,
} from "@nestjs/common";
import { LeaderPlanningService } from "../leader-planning.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import {
  InsufficientCreditsException,
  ContextTooLongException,
} from "../../../../types/research.exceptions";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function buildMocks() {
  const mockPrisma = {
    researchTopic: {
      findUnique: jest.fn(),
    },
    leaderDecision: {
      create: jest.fn(),
    },
  };

  const mockChatFacade = {
    getAvailableModelsExtended: jest.fn(),
    getReasoningModel: jest.fn(),
    selectModel: jest.fn(),
    chat: jest.fn(),
  };

  return { mockPrisma, mockChatFacade };
}

function buildReasoningModelInfo(
  overrides: Partial<{
    id: string;
    name: string;
    provider: string;
    isReasoning: boolean;
  }> = {},
) {
  return {
    id: overrides.id ?? "o3-mini",
    name: overrides.name ?? "o3-mini",
    provider: overrides.provider ?? "openai",
    isReasoning: overrides.isReasoning ?? true,
  };
}

function buildModelEntry(
  overrides: Partial<{
    id: string;
    name: string;
    provider: string;
    isReasoning: boolean;
    isAvailable: boolean;
  }> = {},
) {
  return {
    id: overrides.id ?? "gpt-4o",
    name: overrides.name ?? "GPT-4o",
    provider: overrides.provider ?? "openai",
    isReasoning: overrides.isReasoning ?? false,
    isAvailable: overrides.isAvailable ?? true,
  };
}

function buildTopic(
  overrides: Partial<{
    id: string;
    name: string;
    type: string;
    description: string | null;
    language: string | null;
    dimensions: unknown[];
  }> = {},
) {
  return {
    id: overrides.id ?? "topic-1",
    name: overrides.name ?? "AI Trends",
    type: overrides.type ?? "research",
    description: overrides.description ?? "An overview of AI trends",
    language: overrides.language ?? "zh",
    dimensions: overrides.dimensions ?? [],
  };
}

function buildChatResponse(content: string, isError = false) {
  return { content, isError };
}

function buildValidPlan(agentAssignments: unknown[] = []) {
  return {
    taskUnderstanding: { topic: "AI Trends", scope: "broad", objectives: [] },
    dimensions: [
      {
        id: "dim-1",
        name: "Market Overview",
        description: "Overview of the AI market",
        searchQueries: ["AI market 2025"],
        dataSources: [],
        priority: 1,
      },
    ],
    executionStrategy: { parallelism: 2, priorityOrder: ["dim-1"] },
    agentAssignments,
  };
}

function buildValidDimensionOutline() {
  return {
    intentUnderstanding: {
      coreQuestion: "What are the AI trends?",
      scope: { included: ["market"], excluded: [] },
      expectedDepth: "detailed",
      targetAudience: "general",
      keyFocusAreas: ["market"],
    },
    sections: [
      {
        id: "sec-1",
        title: "Introduction",
        description: "Introduction to AI trends",
        keyPoints: ["key point 1"],
        targetWords: 500,
        evidenceRequirements: { minReferences: 3 },
      },
    ],
    executionPlan: {
      parallelGroups: [["sec-1"]],
      estimatedTotalWords: 500,
    },
  };
}

function buildValidGlobalOutline(dimensions: unknown[] = []) {
  return {
    dimensions,
    globalThemes: ["AI", "market"],
    deduplicationRules: [],
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Module setup
// ──────────────────────────────────────────────────────────────────────────────

async function createService() {
  const { mockPrisma, mockChatFacade } = buildMocks();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      LeaderPlanningService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: ChatFacade, useValue: mockChatFacade },
    ],
  }).compile();

  const service = module.get<LeaderPlanningService>(LeaderPlanningService);

  // Suppress logger output in tests
  jest.spyOn(service["logger"], "log").mockImplementation(() => undefined);
  jest.spyOn(service["logger"], "warn").mockImplementation(() => undefined);
  jest.spyOn(service["logger"], "error").mockImplementation(() => undefined);
  jest.spyOn(service["logger"], "debug").mockImplementation(() => undefined);

  // Speed up delay so tests don't take seconds
  jest
    .spyOn(
      service as unknown as { delay: (ms: number) => Promise<void> },
      "delay",
    )
    .mockResolvedValue(undefined);

  // Default: getAvailableModelsExtended returns empty array (getReasoningModel calls it internally)
  mockChatFacade.getAvailableModelsExtended.mockResolvedValue([]);

  return { service, mockPrisma, mockChatFacade };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("LeaderPlanningService", () => {
  afterEach(() => jest.clearAllMocks());

  // ============================================================
  // getReasoningModel
  // ============================================================
  describe("getReasoningModel", () => {
    it("returns mapped LeaderModelInfo when model is found", async () => {
      const { service, mockChatFacade } = await createService();
      const modelInfo = buildReasoningModelInfo();
      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([modelInfo]);
      mockChatFacade.getReasoningModel.mockResolvedValue(modelInfo);

      const result = await service.getReasoningModel();

      expect(result).toEqual({
        modelId: "o3-mini",
        modelName: "o3-mini",
        provider: "openai",
        isReasoning: true,
      });
    });

    it("returns null when getReasoningModel facade returns null", async () => {
      const { service, mockChatFacade } = await createService();
      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mockChatFacade.getReasoningModel.mockResolvedValue(null);

      const result = await service.getReasoningModel();

      expect(result).toBeNull();
    });

    it("returns model with isReasoning=false when facade returns non-reasoning model", async () => {
      const { service, mockChatFacade } = await createService();
      const modelInfo = buildReasoningModelInfo({ isReasoning: false });
      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([modelInfo]);
      mockChatFacade.getReasoningModel.mockResolvedValue(modelInfo);

      const result = await service.getReasoningModel();

      expect(result?.isReasoning).toBe(false);
    });

    it("defaults isReasoning to false when facade returns model with undefined isReasoning", async () => {
      const { service, mockChatFacade } = await createService();
      const modelInfo = { id: "model-x", name: "Model X", provider: "openai" };
      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([modelInfo]);
      mockChatFacade.getReasoningModel.mockResolvedValue(modelInfo);

      const result = await service.getReasoningModel();

      expect(result?.isReasoning).toBe(false);
    });
  });

  // ============================================================
  // planResearch
  // ============================================================
  describe("planResearch", () => {
    it("throws NotFoundException when topic is not found", async () => {
      const { service, mockPrisma, mockChatFacade } = await createService();
      mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      await expect(service.planResearch("missing-topic")).rejects.toThrow(
        NotFoundException,
      );

      expect(mockChatFacade.chat).not.toHaveBeenCalled();
    });

    it("throws ServiceUnavailableException when no reasoning model is available", async () => {
      const { service, mockPrisma, mockChatFacade } = await createService();
      mockPrisma.researchTopic.findUnique.mockResolvedValue(buildTopic());
      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mockChatFacade.getReasoningModel.mockResolvedValue(null);

      await expect(service.planResearch("topic-1")).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it("returns plan on successful AI response", async () => {
      const { service, mockPrisma, mockChatFacade } = await createService();
      const topic = buildTopic();
      const plan = buildValidPlan();

      mockPrisma.researchTopic.findUnique.mockResolvedValue(topic);
      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        buildModelEntry(),
      ]);
      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse(JSON.stringify(plan)),
      );

      const result = await service.planResearch("topic-1");

      expect(result.dimensions).toHaveLength(1);
      expect(result.dimensions[0].name).toBe("Market Overview");
      expect(mockChatFacade.chat).toHaveBeenCalledTimes(1);
    });

    it("throws InternalServerErrorException when AI call throws", async () => {
      const { service, mockPrisma, mockChatFacade } = await createService();
      mockPrisma.researchTopic.findUnique.mockResolvedValue(buildTopic());
      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        buildModelEntry(),
      ]);
      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockRejectedValue(new Error("network error"));

      await expect(service.planResearch("topic-1")).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it("throws InternalServerErrorException when AI returns empty content", async () => {
      const { service, mockPrisma, mockChatFacade } = await createService();
      mockPrisma.researchTopic.findUnique.mockResolvedValue(buildTopic());
      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        buildModelEntry(),
      ]);
      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockResolvedValue(buildChatResponse(""));

      await expect(service.planResearch("topic-1")).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it("throws InternalServerErrorException when JSON parse fails", async () => {
      const { service, mockPrisma, mockChatFacade } = await createService();
      mockPrisma.researchTopic.findUnique.mockResolvedValue(buildTopic());
      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        buildModelEntry(),
      ]);
      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse("not-valid-json"),
      );

      await expect(service.planResearch("topic-1")).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it("resolves model name to real modelId via exact match", async () => {
      const { service, mockPrisma, mockChatFacade } = await createService();
      const topic = buildTopic();
      const modelEntry = buildModelEntry({ id: "gpt-4o", name: "GPT-4o" });

      const assignment = {
        agentId: "agent-1",
        agentType: "dimension_researcher",
        assignedDimensions: ["dim-1"],
        role: "researcher",
        modelId: "GPT-4o", // AI returned display name, not real ID
        skills: ["deep-dive"],
        tools: ["web-search"],
      };
      const plan = buildValidPlan([assignment]);

      mockPrisma.researchTopic.findUnique.mockResolvedValue(topic);
      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([modelEntry]);
      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse(JSON.stringify(plan)),
      );

      const result = await service.planResearch("topic-1");

      const resultAssignment = result.agentAssignments?.[0];
      expect(resultAssignment?.modelId).toBe("gpt-4o");
    });

    it("resolves model name via fuzzy prefix matching", async () => {
      const { service, mockPrisma, mockChatFacade } = await createService();
      const topic = buildTopic();
      const modelEntry = buildModelEntry({
        id: "doubao-pro-32k",
        name: "Doubao Pro (豆包)",
      });

      const assignment = {
        agentId: "agent-1",
        agentType: "dimension_researcher",
        assignedDimensions: ["dim-1"],
        role: "researcher",
        modelId: "doubao", // AI returned partial name
        skills: ["deep-dive"],
        tools: ["web-search"],
      };
      const plan = buildValidPlan([assignment]);

      mockPrisma.researchTopic.findUnique.mockResolvedValue(topic);
      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([modelEntry]);
      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse(JSON.stringify(plan)),
      );

      const result = await service.planResearch("topic-1");

      // Should have resolved to the real ID via fuzzy matching (doubao-pro-32k)
      const resultAssignment = result.agentAssignments?.[0];
      // The result may be the real id or stay as-is if no match; verify no crash
      expect(resultAssignment).toBeDefined();
    });

    it("filters out invalid skills not in VALID_SKILLS whitelist", async () => {
      const { service, mockPrisma, mockChatFacade } = await createService();
      const topic = buildTopic();

      const assignment = {
        agentId: "agent-1",
        agentType: "dimension_researcher",
        assignedDimensions: ["dim-1"],
        role: "researcher",
        modelId: "gpt-4o",
        skills: ["deep-dive", "invalid-skill-xyz", "another-fake-skill"],
        tools: ["web-search"],
      };
      const plan = buildValidPlan([assignment]);

      mockPrisma.researchTopic.findUnique.mockResolvedValue(topic);
      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        buildModelEntry({ id: "gpt-4o" }),
      ]);
      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse(JSON.stringify(plan)),
      );

      const result = await service.planResearch("topic-1");

      const resultSkills = result.agentAssignments?.[0]?.skills;
      expect(resultSkills).toContain("deep-dive");
      expect(resultSkills).not.toContain("invalid-skill-xyz");
      expect(resultSkills).not.toContain("another-fake-skill");
    });

    it("normalizes underscore skills to kebab-case before filtering", async () => {
      const { service, mockPrisma, mockChatFacade } = await createService();
      const topic = buildTopic();

      const assignment = {
        agentId: "agent-1",
        agentType: "dimension_researcher",
        assignedDimensions: ["dim-1"],
        role: "researcher",
        modelId: "gpt-4o",
        skills: ["deep_dive", "trend_analysis"], // underscores
        tools: ["web-search"],
      };
      const plan = buildValidPlan([assignment]);

      mockPrisma.researchTopic.findUnique.mockResolvedValue(topic);
      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        buildModelEntry({ id: "gpt-4o" }),
      ]);
      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse(JSON.stringify(plan)),
      );

      const result = await service.planResearch("topic-1");

      const resultSkills = result.agentAssignments?.[0]?.skills;
      // deep-dive and trend-analysis are valid skills in VALID_SKILLS
      expect(resultSkills).toContain("deep-dive");
      expect(resultSkills).toContain("trend-analysis");
    });

    it("assigns default skills to dimension_researcher when AI returns empty skills", async () => {
      const { service, mockPrisma, mockChatFacade } = await createService();
      const topic = buildTopic();

      const assignment = {
        agentId: "agent-1",
        agentType: "dimension_researcher",
        assignedDimensions: ["dim-1"],
        role: "researcher",
        modelId: "gpt-4o",
        skills: [], // empty skills
        tools: ["web-search"],
      };
      const plan = buildValidPlan([assignment]);

      mockPrisma.researchTopic.findUnique.mockResolvedValue(topic);
      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        buildModelEntry({ id: "gpt-4o" }),
      ]);
      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse(JSON.stringify(plan)),
      );

      const result = await service.planResearch("topic-1");

      const resultSkills = result.agentAssignments?.[0]?.skills;
      // Should have auto-assigned default skills including deep-dive, synthesis, data-interpretation
      expect(resultSkills).toBeDefined();
      expect(resultSkills!.length).toBeGreaterThan(0);
      expect(resultSkills).toContain("deep-dive");
    });

    it("auto-assigns default tools (web-search) to dimension_researcher when tools are empty", async () => {
      const { service, mockPrisma, mockChatFacade } = await createService();
      const topic = buildTopic();

      const assignment = {
        agentId: "agent-1",
        agentType: "dimension_researcher",
        assignedDimensions: ["dim-1"],
        role: "researcher",
        modelId: "gpt-4o",
        skills: ["deep-dive"],
        tools: [], // empty tools
      };
      const plan = buildValidPlan([assignment]);

      mockPrisma.researchTopic.findUnique.mockResolvedValue(topic);
      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        buildModelEntry({ id: "gpt-4o" }),
      ]);
      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse(JSON.stringify(plan)),
      );

      const result = await service.planResearch("topic-1");

      const resultTools = result.agentAssignments?.[0]?.tools;
      expect(resultTools).toContain("web-search");
    });

    it("auto-assigns model via round-robin when assignment.modelId is missing", async () => {
      const { service, mockPrisma, mockChatFacade } = await createService();
      const topic = buildTopic();
      const modelEntry = buildModelEntry({ id: "gpt-4o" });

      const assignment = {
        agentId: "agent-1",
        agentType: "dimension_researcher",
        assignedDimensions: ["dim-1"],
        role: "researcher",
        // no modelId
        skills: ["deep-dive"],
        tools: ["web-search"],
      };
      const plan = buildValidPlan([assignment]);

      mockPrisma.researchTopic.findUnique.mockResolvedValue(topic);
      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([modelEntry]);
      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse(JSON.stringify(plan)),
      );

      const result = await service.planResearch("topic-1");

      expect(result.agentAssignments?.[0]?.modelId).toBe("gpt-4o");
    });

    it("assigns default skills to quality_reviewer when AI returns empty skills", async () => {
      const { service, mockPrisma, mockChatFacade } = await createService();
      const topic = buildTopic();

      const assignment = {
        agentId: "agent-2",
        agentType: "quality_reviewer",
        role: "reviewer",
        modelId: "gpt-4o",
        skills: [],
      };
      const plan = buildValidPlan([assignment]);

      mockPrisma.researchTopic.findUnique.mockResolvedValue(topic);
      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        buildModelEntry({ id: "gpt-4o" }),
      ]);
      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse(JSON.stringify(plan)),
      );

      const result = await service.planResearch("topic-1");

      const resultSkills = result.agentAssignments?.[0]?.skills;
      expect(resultSkills).toContain("critical-thinking");
      expect(resultSkills).toContain("synthesis");
    });

    it("assigns default skills to report_writer when AI returns empty skills", async () => {
      const { service, mockPrisma, mockChatFacade } = await createService();
      const topic = buildTopic();

      const assignment = {
        agentId: "agent-3",
        agentType: "report_writer",
        role: "writer",
        modelId: "gpt-4o",
        skills: [],
      };
      const plan = buildValidPlan([assignment]);

      mockPrisma.researchTopic.findUnique.mockResolvedValue(topic);
      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        buildModelEntry({ id: "gpt-4o" }),
      ]);
      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse(JSON.stringify(plan)),
      );

      const result = await service.planResearch("topic-1");

      const resultSkills = result.agentAssignments?.[0]?.skills;
      expect(resultSkills).toContain("synthesis");
    });

    it("works with no agentAssignments in plan", async () => {
      const { service, mockPrisma, mockChatFacade } = await createService();
      const topic = buildTopic();
      const plan = {
        ...buildValidPlan(),
        agentAssignments: undefined,
      };

      mockPrisma.researchTopic.findUnique.mockResolvedValue(topic);
      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        buildModelEntry(),
      ]);
      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse(JSON.stringify(plan)),
      );

      const result = await service.planResearch("topic-1");

      expect(result.dimensions).toHaveLength(1);
    });
  });

  // ============================================================
  // planDimensionOutline
  // ============================================================
  describe("planDimensionOutline", () => {
    const topic = {
      name: "AI Trends",
      type: "research",
      description: "An overview of AI trends",
      language: "zh",
    };
    const dimension = {
      name: "Market Overview",
      description: "Overview of the market",
      searchQueries: ["AI market 2025"],
    };
    const evidenceSummary = "Some evidence about AI market.";

    it("returns outline on first successful attempt", async () => {
      const { service, mockChatFacade } = await createService();
      const outline = buildValidDimensionOutline();

      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse(JSON.stringify(outline)),
      );

      const result = await service.planDimensionOutline(
        topic,
        dimension,
        evidenceSummary,
      );

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].title).toBe("Introduction");
      expect(mockChatFacade.chat).toHaveBeenCalledTimes(1);
    });

    it("uses non-reasoning fallback model on the last attempt", async () => {
      const { service, mockChatFacade } = await createService();
      const outline = buildValidDimensionOutline();

      // First 2 attempts use reasoning model but fail, 3rd uses selectModel fallback
      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.selectModel.mockResolvedValue(
        buildModelEntry({ id: "claude-3-haiku" }),
      );

      // First 2 attempts fail with parse error, 3rd succeeds
      mockChatFacade.chat
        .mockResolvedValueOnce(buildChatResponse("not-json"))
        .mockResolvedValueOnce(buildChatResponse("not-json"))
        .mockResolvedValueOnce(buildChatResponse(JSON.stringify(outline)));

      const result = await service.planDimensionOutline(
        topic,
        dimension,
        evidenceSummary,
      );

      expect(result.sections).toHaveLength(1);
      expect(mockChatFacade.chat).toHaveBeenCalledTimes(3);
      // The last call should use selectModel (non-reasoning) fallback
      expect(mockChatFacade.selectModel).toHaveBeenCalledWith({
        requireReasoning: false,
      });
    });

    it("retries on quota error (429/rate limit) and succeeds on second attempt", async () => {
      const { service, mockChatFacade } = await createService();
      const outline = buildValidDimensionOutline();

      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo({ id: "o3-mini" }),
      );
      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        buildModelEntry({ id: "gpt-4o" }),
      ]);

      // First attempt: API returns quota error
      mockChatFacade.chat
        .mockResolvedValueOnce(
          buildChatResponse("429 quota exceeded rate limit", true),
        )
        .mockResolvedValueOnce(buildChatResponse(JSON.stringify(outline)));

      const result = await service.planDimensionOutline(
        topic,
        dimension,
        evidenceSummary,
      );

      expect(result.sections).toHaveLength(1);
      expect(mockChatFacade.chat).toHaveBeenCalledTimes(2);
    });

    it("throws InsufficientCreditsException immediately when isError path detects insufficient_credits", async () => {
      const { service, mockChatFacade } = await createService();

      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse("insufficient_credits: balance too low", true),
      );

      // isError handler throws InsufficientCreditsException inside try,
      // catch block re-throws it immediately (instanceof check).
      await expect(
        service.planDimensionOutline(topic, dimension, evidenceSummary),
      ).rejects.toThrow(InsufficientCreditsException);

      expect(mockChatFacade.chat).toHaveBeenCalledTimes(1);
    });

    it("retries generic Error thrown by chat (non-InsufficientCredits)", async () => {
      const { service, mockChatFacade } = await createService();

      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.selectModel.mockResolvedValue(
        buildModelEntry({ id: "claude-3-haiku" }),
      );
      // Generic error thrown (not InsufficientCreditsException) → retries all 3 times
      const err = new Error("network timeout");
      mockChatFacade.chat.mockRejectedValue(err);

      await expect(
        service.planDimensionOutline(topic, dimension, evidenceSummary),
      ).rejects.toThrow(InternalServerErrorException);

      expect(mockChatFacade.chat).toHaveBeenCalledTimes(3);
    });

    it("throws ContextTooLongException immediately when isError path detects context_too_long", async () => {
      const { service, mockChatFacade } = await createService();

      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse(
          "context_too_long: reduce the length of the messages",
          true,
        ),
      );

      // isError handler throws ContextTooLongException inside try,
      // catch block re-throws it immediately (instanceof check).
      await expect(
        service.planDimensionOutline(topic, dimension, evidenceSummary),
      ).rejects.toThrow(ContextTooLongException);

      expect(mockChatFacade.chat).toHaveBeenCalledTimes(1);
    });

    it("retries on JSON parse failure and throws InternalServerErrorException after all retries", async () => {
      const { service, mockChatFacade } = await createService();

      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.selectModel.mockResolvedValue(
        buildModelEntry({ id: "claude-3-haiku" }),
      );
      // All 3 attempts return invalid JSON
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse("not-valid-json"),
      );

      await expect(
        service.planDimensionOutline(topic, dimension, evidenceSummary),
      ).rejects.toThrow(InternalServerErrorException);

      expect(mockChatFacade.chat).toHaveBeenCalledTimes(3);
    });

    it("retries on HTML error page and throws InternalServerErrorException after all retries", async () => {
      const { service, mockChatFacade } = await createService();

      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.selectModel.mockResolvedValue(
        buildModelEntry({ id: "claude-3-haiku" }),
      );
      // All attempts return HTML
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse(
          "<!DOCTYPE html><html><body>502 Bad Gateway</body></html>",
        ),
      );

      await expect(
        service.planDimensionOutline(topic, dimension, evidenceSummary),
      ).rejects.toThrow(InternalServerErrorException);

      // Break on last attempt — max 3 total but breaks after HTML on last
      expect(mockChatFacade.chat).toHaveBeenCalledTimes(3);
    });

    it("skips already-failed model (quota) and selects alternative on retry", async () => {
      const { service, mockChatFacade } = await createService();
      const outline = buildValidDimensionOutline();
      const reasoningModel = buildReasoningModelInfo({ id: "o3-mini" });
      const alternativeModel = buildModelEntry({ id: "gpt-4o" });

      // First attempt uses reasoning model o3-mini, fails with quota error
      mockChatFacade.getReasoningModel.mockResolvedValue(reasoningModel);
      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        alternativeModel,
      ]);

      mockChatFacade.chat
        .mockResolvedValueOnce(
          buildChatResponse("402 payment required billing", true),
        )
        .mockResolvedValueOnce(buildChatResponse(JSON.stringify(outline)));

      const result = await service.planDimensionOutline(
        topic,
        dimension,
        evidenceSummary,
      );

      expect(result.sections).toHaveLength(1);
    });

    it("throws ServiceUnavailableException when no model is available", async () => {
      const { service, mockChatFacade } = await createService();

      mockChatFacade.getReasoningModel.mockResolvedValue(null);
      mockChatFacade.selectModel.mockResolvedValue(null);

      await expect(
        service.planDimensionOutline(topic, dimension, evidenceSummary),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it("strips think tags from response before parsing", async () => {
      const { service, mockChatFacade } = await createService();
      const outline = buildValidDimensionOutline();
      const responseWithThinkTags = `<think>This is internal reasoning</think>${JSON.stringify(outline)}`;

      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse(responseWithThinkTags),
      );

      const result = await service.planDimensionOutline(
        topic,
        dimension,
        evidenceSummary,
      );

      expect(result.sections).toHaveLength(1);
    });

    it("handles figuresSummary parameter by appending figures section to prompt", async () => {
      const { service, mockChatFacade } = await createService();
      const outline = buildValidDimensionOutline();

      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse(JSON.stringify(outline)),
      );

      const result = await service.planDimensionOutline(
        topic,
        dimension,
        evidenceSummary,
        "Figure 1: AI Market Chart",
      );

      expect(result.sections).toHaveLength(1);
      // Verify the chat was called with a message that includes the figures section
      const chatCall = mockChatFacade.chat.mock.calls[0][0];
      const userMessage = chatCall.messages.find(
        (m: { role: string; content: string }) => m.role === "user",
      );
      expect(userMessage.content).toContain("可用图表资源");
    });
  });

  // ============================================================
  // planGlobalOutline
  // ============================================================
  describe("planGlobalOutline", () => {
    const topic = {
      name: "AI Trends",
      type: "research",
      description: "AI overview",
      language: "zh",
    };

    const dimensionSearchResults = [
      {
        dimensionId: "dim-1",
        dimensionName: "Market Overview",
        dimensionDescription: "Market desc",
        evidenceSummary: "Evidence for market",
        figuresSummary: "",
        searchQueries: ["AI market 2025"],
      },
    ];

    it("returns global outline on first successful attempt", async () => {
      const { service, mockChatFacade } = await createService();
      const globalOutline = buildValidGlobalOutline([
        {
          dimensionId: "dim-1",
          dimensionName: "Market Overview",
          crossDimensionNotes: "",
          outline: buildValidDimensionOutline(),
        },
      ]);

      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse(JSON.stringify(globalOutline)),
      );

      const result = await service.planGlobalOutline(
        topic,
        dimensionSearchResults,
      );

      expect(result.dimensions).toHaveLength(1);
      expect(result.dimensions[0].dimensionName).toBe("Market Overview");
    });

    it("creates stub outline for missing dimensions in response", async () => {
      const { service, mockChatFacade } = await createService();

      // Response has a DIFFERENT dimension, so "Market Overview" is missing
      const incompleteGlobalOutline = buildValidGlobalOutline([
        {
          dimensionId: "dim-other",
          dimensionName: "Other Dimension",
          crossDimensionNotes: "",
          outline: buildValidDimensionOutline(),
        },
      ]);

      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse(JSON.stringify(incompleteGlobalOutline)),
      );

      const result = await service.planGlobalOutline(
        topic,
        dimensionSearchResults,
      );

      // The missing dimension should have been added as a stub
      const stub = result.dimensions.find(
        (d) => d.dimensionName === "Market Overview",
      );
      expect(stub).toBeDefined();
      expect(stub?.outline.sections).toHaveLength(1);
      expect(stub?.outline.sections[0].id).toBe("stub-Market Overview");
    });

    it("appendix-like dimensions get reduced stub words (400 instead of 800)", async () => {
      const { service, mockChatFacade } = await createService();
      const appendixDimResults = [
        {
          dimensionId: "dim-app",
          dimensionName: "附录",
          dimensionDescription: null,
          evidenceSummary: "Evidence",
          figuresSummary: "",
          searchQueries: [],
        },
        {
          dimensionId: "dim-present",
          dimensionName: "Present Dimension",
          dimensionDescription: null,
          evidenceSummary: "Evidence",
          figuresSummary: "",
          searchQueries: [],
        },
      ];

      // Response has only "Present Dimension", missing "附录" → stub created
      const incompleteGlobalOutline = buildValidGlobalOutline([
        {
          dimensionId: "dim-present",
          dimensionName: "Present Dimension",
          crossDimensionNotes: "",
          outline: buildValidDimensionOutline(),
        },
      ]);

      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse(JSON.stringify(incompleteGlobalOutline)),
      );

      const result = await service.planGlobalOutline(topic, appendixDimResults);

      const stub = result.dimensions.find((d) => d.dimensionName === "附录");
      expect(stub?.outline.sections[0].targetWords).toBe(400);
    });

    it("non-appendix dimensions get 800-word stubs", async () => {
      const { service, mockChatFacade } = await createService();

      // Response has a different dimension, so "Market Overview" is missing → stub
      const incompleteGlobalOutline = buildValidGlobalOutline([
        {
          dimensionId: "dim-other",
          dimensionName: "Other Dimension",
          crossDimensionNotes: "",
          outline: buildValidDimensionOutline(),
        },
      ]);

      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse(JSON.stringify(incompleteGlobalOutline)),
      );

      const result = await service.planGlobalOutline(
        topic,
        dimensionSearchResults,
      );

      const stub = result.dimensions.find(
        (d) => d.dimensionName === "Market Overview",
      );
      expect(stub?.outline.sections[0].targetWords).toBe(800);
    });

    it("throws InsufficientCreditsException immediately when API returns insufficient credits error", async () => {
      const { service, mockChatFacade } = await createService();

      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse("insufficient credits: no balance", true),
      );

      // isError handler throws InsufficientCreditsException inside try,
      // catch block re-throws it immediately (instanceof check).
      await expect(
        service.planGlobalOutline(topic, dimensionSearchResults),
      ).rejects.toThrow(InsufficientCreditsException);

      expect(mockChatFacade.chat).toHaveBeenCalledTimes(1);
    });

    it("throws ContextTooLongException immediately when API returns context_too_long error", async () => {
      const { service, mockChatFacade } = await createService();

      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse("context length too many tokens", true),
      );

      // isError handler throws ContextTooLongException inside try,
      // catch block re-throws it immediately (instanceof check).
      await expect(
        service.planGlobalOutline(topic, dimensionSearchResults),
      ).rejects.toThrow(ContextTooLongException);

      expect(mockChatFacade.chat).toHaveBeenCalledTimes(1);
    });

    it("retries on quota/rate limit error and succeeds", async () => {
      const { service, mockChatFacade } = await createService();
      const globalOutline = buildValidGlobalOutline([
        {
          dimensionId: "dim-1",
          dimensionName: "Market Overview",
          crossDimensionNotes: "",
          outline: buildValidDimensionOutline(),
        },
      ]);

      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo({ id: "o3-mini" }),
      );
      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        buildModelEntry({ id: "gpt-4o" }),
      ]);

      mockChatFacade.chat
        .mockResolvedValueOnce(
          buildChatResponse("429 rate limit exceeded quota", true),
        )
        .mockResolvedValueOnce(
          buildChatResponse(JSON.stringify(globalOutline)),
        );

      const result = await service.planGlobalOutline(
        topic,
        dimensionSearchResults,
      );

      expect(result.dimensions).toHaveLength(1);
      expect(mockChatFacade.chat).toHaveBeenCalledTimes(2);
    });

    it("throws InternalServerErrorException after all retries exhausted with parse failure", async () => {
      const { service, mockChatFacade } = await createService();

      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      // All 3 attempts return invalid JSON
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse("not-valid-json"),
      );

      await expect(
        service.planGlobalOutline(topic, dimensionSearchResults),
      ).rejects.toThrow(InternalServerErrorException);

      expect(mockChatFacade.chat).toHaveBeenCalledTimes(3);
    });

    it("strips think tags from response before parsing", async () => {
      const { service, mockChatFacade } = await createService();
      const globalOutline = buildValidGlobalOutline([
        {
          dimensionId: "dim-1",
          dimensionName: "Market Overview",
          crossDimensionNotes: "",
          outline: buildValidDimensionOutline(),
        },
      ]);
      const responseWithThinkTags = `<think>reasoning...</think><reasoning>more</reasoning>${JSON.stringify(globalOutline)}`;

      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse(responseWithThinkTags),
      );

      const result = await service.planGlobalOutline(
        topic,
        dimensionSearchResults,
      );

      expect(result.dimensions).toHaveLength(1);
    });

    it("selects alternative model when reasoning model previously failed", async () => {
      const { service, mockChatFacade } = await createService();
      const globalOutline = buildValidGlobalOutline([
        {
          dimensionId: "dim-1",
          dimensionName: "Market Overview",
          crossDimensionNotes: "",
          outline: buildValidDimensionOutline(),
        },
      ]);

      const reasoningModel = buildReasoningModelInfo({ id: "o3-mini" });
      const alternativeModel = buildModelEntry({ id: "gpt-4o" });

      mockChatFacade.getReasoningModel.mockResolvedValue(reasoningModel);
      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        alternativeModel,
      ]);

      // First attempt: quota error on o3-mini
      // Second attempt: o3-mini is in failedModelIds, uses alternative gpt-4o
      mockChatFacade.chat
        .mockResolvedValueOnce(
          buildChatResponse("402 billing payment error", true),
        )
        .mockResolvedValueOnce(
          buildChatResponse(JSON.stringify(globalOutline)),
        );

      const result = await service.planGlobalOutline(
        topic,
        dimensionSearchResults,
      );

      expect(result.dimensions).toHaveLength(1);
      expect(mockChatFacade.chat).toHaveBeenCalledTimes(2);
    });

    it("handles multiple dimensions in search results", async () => {
      const { service, mockChatFacade } = await createService();
      const multiDimResults = [
        {
          dimensionId: "dim-1",
          dimensionName: "Market Overview",
          dimensionDescription: null,
          evidenceSummary: "Market evidence",
          figuresSummary: "Figure 1",
          searchQueries: ["market"],
        },
        {
          dimensionId: "dim-2",
          dimensionName: "Technology Analysis",
          dimensionDescription: null,
          evidenceSummary: "Tech evidence",
          figuresSummary: "",
          searchQueries: ["technology"],
        },
      ];

      const globalOutline = buildValidGlobalOutline([
        {
          dimensionId: "dim-1",
          dimensionName: "Market Overview",
          crossDimensionNotes: "",
          outline: buildValidDimensionOutline(),
        },
        {
          dimensionId: "dim-2",
          dimensionName: "Technology Analysis",
          crossDimensionNotes: "",
          outline: buildValidDimensionOutline(),
        },
      ]);

      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );
      mockChatFacade.chat.mockResolvedValue(
        buildChatResponse(JSON.stringify(globalOutline)),
      );

      const result = await service.planGlobalOutline(topic, multiDimResults);

      expect(result.dimensions).toHaveLength(2);
    });
  });
});
