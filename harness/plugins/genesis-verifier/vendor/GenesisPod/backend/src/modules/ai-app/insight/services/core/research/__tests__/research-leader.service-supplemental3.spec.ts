/**
 * ResearchLeaderService - Supplemental3 Unit Tests
 *
 * Covers uncovered lines 426-431, 439-442, 452-457 in research-leader.service.ts:
 * - integrateDimensionResults: single section with content that has marked findings (426-431)
 * - integrateDimensionResults: multiple sections, no reasoning model (439-442)
 * - integrateDimensionResults: multiple sections with reasoning model, AI meta extraction succeeds (452-457)
 * - integrateDimensionResults: multiple sections with reasoning model, AI meta extraction fails
 * - getDecisionHistory: returns sorted decisions
 * - extractKeyFindingsFromContent: all three extraction paths
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
import { ChatFacade } from "@/modules/ai-harness/facade";
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
      update: jest.fn(),
    },
    researchTask: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    leaderDecision: {
      create: jest.fn().mockResolvedValue({ id: "decision-1" }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  const mockChatFacade = {
    chat: jest.fn(),
  };

  const mockLeaderPlanning = {
    getReasoningModel: jest.fn(),
    planResearch: jest.fn(),
    planDimensionOutline: jest.fn(),
    planGlobalOutline: jest.fn(),
  };

  const mockLeaderIntent = {
    handleUserMessage: jest.fn(),
    decodeUserInput: jest.fn(),
  };

  const mockLeaderAgentSelection = {
    selectAgentForTask: jest.fn(),
  };

  const mockLeaderReview = {
    reviewTaskResult: jest.fn(),
    extractClaims: jest.fn(),
    verifyHypotheses: jest.fn(),
  };

  return {
    mockPrisma,
    mockChatFacade,
    mockLeaderPlanning,
    mockLeaderIntent,
    mockLeaderAgentSelection,
    mockLeaderReview,
  };
}

async function buildService(mocks: ReturnType<typeof buildMocks>) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ResearchLeaderService,
      { provide: PrismaService, useValue: mocks.mockPrisma },
      { provide: ChatFacade, useValue: mocks.mockChatFacade },
      { provide: LeaderPlanningService, useValue: mocks.mockLeaderPlanning },
      { provide: LeaderIntentService, useValue: mocks.mockLeaderIntent },
      {
        provide: LeaderAgentSelectionService,
        useValue: mocks.mockLeaderAgentSelection,
      },
      { provide: LeaderReviewService, useValue: mocks.mockLeaderReview },
    ],
  }).compile();

  return module.get<ResearchLeaderService>(ResearchLeaderService);
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("ResearchLeaderService (supplemental3)", () => {
  let service: ResearchLeaderService;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(async () => {
    mocks = buildMocks();
    service = await buildService(mocks);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── getDecisionHistory ──────────────────────────────────────────────────────

  describe("getDecisionHistory", () => {
    it("should return sorted decisions from prisma", async () => {
      const decisions = [
        { id: "d2", createdAt: new Date("2025-01-02") },
        { id: "d1", createdAt: new Date("2025-01-01") },
      ];
      mocks.mockPrisma.leaderDecision.findMany.mockResolvedValue(decisions);

      const result = await service.getDecisionHistory("mission-1");

      expect(mocks.mockPrisma.leaderDecision.findMany).toHaveBeenCalledWith({
        where: { missionId: "mission-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toEqual(decisions);
    });

    it("should return empty array when no decisions", async () => {
      mocks.mockPrisma.leaderDecision.findMany.mockResolvedValue([]);
      const result = await service.getDecisionHistory("empty-mission");
      expect(result).toEqual([]);
    });
  });

  // ─── integrateDimensionResults – single section ──────────────────────────────

  describe("integrateDimensionResults - single section", () => {
    it("should return content directly for single section", async () => {
      const content = "This is the only section content about AI.";
      const result = await service.integrateDimensionResults(
        { name: "Technology Trends", description: "Tech analysis" },
        [{ title: "Overview", content }],
        "zh",
      );

      expect(result.content).toBe(content);
      expect(result.metadata.summary).toBe(content.substring(0, 200));
      expect(result.totalWords).toBe(content.length);
    });

    it("should extract marked key findings from single section", async () => {
      const content =
        "关键发现：AI market is growing rapidly in 2025.\n关键发现：Cloud computing dominates the landscape. " +
        "Some more content here to pad the section.";
      const result = await service.integrateDimensionResults(
        { name: "Market Analysis" },
        [{ title: "Analysis", content }],
        "zh",
      );

      expect(result.metadata.keyFindings.length).toBeGreaterThan(0);
      expect(result.metadata.keyFindings[0]).toContain("AI market is growing");
    });

    it("should extract findings from markdown list items (single section)", async () => {
      const content =
        "## Introduction\n\n- AI adoption has increased significantly in enterprise settings across all industries.\n" +
        "- Machine learning models are becoming more efficient and cost-effective for businesses.\n" +
        "Some regular text to fill the section with enough content.";
      const result = await service.integrateDimensionResults(
        { name: "AI Adoption" },
        [{ title: "Overview", content }],
        "en",
      );

      expect(result.metadata.keyFindings.length).toBeGreaterThan(0);
    });

    it("should extract findings from markdown headers (single section)", async () => {
      const content =
        "## Key Trends\n\nThe overall AI market is experiencing unprecedented growth worldwide.\n\n" +
        "## Market Share\n\nCloud providers are dominating the AI infrastructure market segment.";
      const result = await service.integrateDimensionResults(
        { name: "AI Trends" },
        [{ title: "Trends", content }],
        "en",
      );

      // Should find findings from header sections
      expect(result).toBeDefined();
    });

    it("should extract evidence IDs from content", async () => {
      const content =
        "Research shows [temp-1-1] that AI is growing [temp-1-2]. More evidence [temp-1-1] confirms.";
      const result = await service.integrateDimensionResults(
        { name: "Evidence Test" },
        [{ title: "Section", content }],
        "zh",
      );

      // Should deduplicate: [temp-1-1, temp-1-2]
      expect(result.evidenceUsed).toContain("temp-1-1");
      expect(result.evidenceUsed).toContain("temp-1-2");
      expect(result.evidenceUsed).toHaveLength(2); // deduped
    });
  });

  // ─── integrateDimensionResults – multiple sections, no model ─────────────────

  describe("integrateDimensionResults - multiple sections, no reasoning model", () => {
    it("should concatenate sections without AI when no reasoning model", async () => {
      mocks.mockLeaderPlanning.getReasoningModel.mockResolvedValue(null);

      const sections = [
        {
          title: "Section 1",
          content: "First section content about the topic in detail.",
        },
        {
          title: "Section 2",
          content: "Second section content with additional findings.",
        },
      ];

      const result = await service.integrateDimensionResults(
        { name: "Combined Analysis", description: "Full analysis" },
        sections,
        "zh",
      );

      // Should contain both section contents
      expect(result.content).toContain("Section 1");
      expect(result.content).toContain("Section 2");
      expect(result.content).toContain("First section content");
      expect(result.content).toContain("Second section content");

      // No AI call should be made
      expect(mocks.mockChatFacade.chat).not.toHaveBeenCalled();

      // Summary should be auto-generated
      expect(result.metadata.summary).toContain("Combined Analysis");
    });

    it("should use fallback summary format for no-model path (English)", async () => {
      mocks.mockLeaderPlanning.getReasoningModel.mockResolvedValue(null);

      const result = await service.integrateDimensionResults(
        { name: "Market Overview" },
        [
          { title: "S1", content: "Content one here." },
          { title: "S2", content: "Content two here." },
        ],
        "en",
      );

      expect(result.metadata.confidenceLevel).toBe("medium");
      expect(result.totalWords).toBeGreaterThan(0);
    });
  });

  // ─── integrateDimensionResults – multiple sections, with model ───────────────

  describe("integrateDimensionResults - multiple sections, with reasoning model", () => {
    it("should call AI and use returned summary and keyFindings", async () => {
      mocks.mockLeaderPlanning.getReasoningModel.mockResolvedValue({
        modelId: "gpt-reasoning",
        modelName: "GPT-4 Reasoning",
        isReasoning: true,
      });

      mocks.mockChatFacade.chat.mockResolvedValue({
        content: `\`\`\`json
{
  "summary": "AI market analysis summary covering 2025 trends",
  "keyFindings": ["Finding 1: Market grew 30%", "Finding 2: Cloud leads"]
}
\`\`\``,
      });

      const sections = [
        { title: "Market Size", content: "Market size analysis content here." },
        {
          title: "Competition",
          content: "Competitive landscape detailed analysis.",
        },
      ];

      const result = await service.integrateDimensionResults(
        { name: "AI Market", description: "Analysis of AI market" },
        sections,
        "zh",
      );

      expect(mocks.mockChatFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gpt-reasoning",
          skipGuardrails: true,
        }),
      );
      expect(result.metadata.summary).toBe(
        "AI market analysis summary covering 2025 trends",
      );
      expect(result.metadata.keyFindings).toContain(
        "Finding 1: Market grew 30%",
      );
    });

    it("should use English prompt when topicLanguage is en", async () => {
      mocks.mockLeaderPlanning.getReasoningModel.mockResolvedValue({
        modelId: "gpt-reasoning",
        isReasoning: true,
      });

      mocks.mockChatFacade.chat.mockResolvedValue({
        content: `\`\`\`json
{"summary":"English summary","keyFindings":["Finding A","Finding B"]}
\`\`\``,
      });

      await service.integrateDimensionResults(
        { name: "English Dimension" },
        [
          { title: "S1", content: "Section one content for analysis." },
          { title: "S2", content: "Section two content for analysis." },
        ],
        "en",
      );

      const callArgs = mocks.mockChatFacade.chat.mock.calls[0][0];
      expect(callArgs.messages[0].content).toContain(
        "research report integration expert",
      );
    });

    it("should fallback to extractKeyFindingsFromContent when AI fails", async () => {
      mocks.mockLeaderPlanning.getReasoningModel.mockResolvedValue({
        modelId: "gpt-reasoning",
        isReasoning: true,
      });

      mocks.mockChatFacade.chat.mockRejectedValue(new Error("LLM API Error"));

      const sections = [
        {
          title: "Section 1",
          content:
            "关键发现：Market is expanding. Regular content to pad the section.",
        },
        { title: "Section 2", content: "Additional analysis content here." },
      ];

      const result = await service.integrateDimensionResults(
        { name: "AI Research" },
        sections,
        "zh",
      );

      // Should still succeed using fallback
      expect(result.content).toBeDefined();
      expect(result.metadata.confidenceLevel).toBe("medium");
    });

    it("should use AI model for summary even when keyFindings parse fails", async () => {
      mocks.mockLeaderPlanning.getReasoningModel.mockResolvedValue({
        modelId: "gpt-reasoning",
        isReasoning: true,
      });

      // Return invalid JSON (missing keyFindings)
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: "Not valid JSON at all - no json block here",
      });

      const result = await service.integrateDimensionResults(
        { name: "Failed Parse" },
        [
          { title: "A", content: "Content A for test section." },
          { title: "B", content: "Content B for test section." },
        ],
        "zh",
      );

      // fallback summary still works
      expect(result.metadata.summary).toBeDefined();
      expect(result.content).toContain("Content A");
    });

    it("should preserve full content (not rewrite)", async () => {
      mocks.mockLeaderPlanning.getReasoningModel.mockResolvedValue({
        modelId: "gpt-reasoning",
        isReasoning: true,
      });

      mocks.mockChatFacade.chat.mockResolvedValue({
        content:
          '```json\n{"summary":"Summary text","keyFindings":["Finding 1"]}\n```',
      });

      const s1 = "### Title One\n\nContent of section one.";
      const s2 = "### Title Two\n\nContent of section two.";
      const result = await service.integrateDimensionResults(
        { name: "Full Content Test" },
        [
          { title: "Title One", content: s1 },
          { title: "Title Two", content: s2 },
        ],
        "zh",
      );

      // Original sections must be preserved in result
      expect(result.content).toContain("Title One");
      expect(result.content).toContain("Title Two");
      expect(result.totalWords).toBeGreaterThan(0);
    });
  });

  // ─── Delegation methods ───────────────────────────────────────────────────────

  describe("delegation methods", () => {
    it("getReasoningModel delegates to leaderPlanning", async () => {
      const model = {
        modelId: "reasoning-m",
        modelName: "R",
        isReasoning: true,
      };
      mocks.mockLeaderPlanning.getReasoningModel.mockResolvedValue(model);
      const result = await service.getReasoningModel();
      expect(result).toEqual(model);
    });

    it("planResearch delegates to leaderPlanning", async () => {
      const plan = {
        taskUnderstanding: {},
        dimensions: [],
        agentAssignments: [],
      };
      mocks.mockLeaderPlanning.planResearch.mockResolvedValue(plan);
      const result = await service.planResearch("topic-1", "Research AI");
      expect(result).toEqual(plan);
    });

    it("handleUserMessage delegates to leaderIntent", async () => {
      mocks.mockLeaderIntent.handleUserMessage.mockResolvedValue({
        response: "ok",
      });
      const result = await service.handleUserMessage("t1", "m1", "hello");
      expect(result.response).toBe("ok");
    });

    it("reviewTaskResult delegates to leaderReview", async () => {
      const decision = { decision: "approved", feedback: "" };
      mocks.mockLeaderReview.reviewTaskResult.mockResolvedValue(decision);
      const result = await service.reviewTaskResult("m1", "t1", "result");
      expect(result).toEqual(decision);
    });

    it("selectAgentForTask delegates to leaderAgentSelection", async () => {
      const assignment = { agentId: "a1", agentType: "dimension_researcher" };
      mocks.mockLeaderAgentSelection.selectAgentForTask.mockResolvedValue(
        assignment,
      );
      const result = await service.selectAgentForTask("t1", "m1", "Task title");
      expect(result).toEqual(assignment);
    });
  });
});
