/**
 * LeaderReviewService Unit Tests
 *
 * Coverage:
 * - reviewTaskResult: success, AI call failure, JSON parse failure, no reasoning model
 * - extractClaims: success, parse failure (no data), error thrown
 * - verifyHypotheses: empty hypotheses, success, error thrown
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ServiceUnavailableException } from "@nestjs/common";
import { LeaderReviewService } from "../leader-review.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function buildMocks() {
  const mockPrisma = {
    leaderDecision: {
      create: jest.fn().mockResolvedValue({}),
    },
  };

  const mockChatFacade = {
    chat: jest.fn(),
    chatStructured: jest.fn(),
    getReasoningModel: jest.fn(),
  };

  return { mockPrisma, mockChatFacade };
}

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

const mockReasoningModel = {
  id: "gpt-o1",
  name: "GPT o1",
  provider: "openai",
  isReasoning: true,
  isAvailable: true,
};

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("LeaderReviewService", () => {
  let service: LeaderReviewService;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(async () => {
    mocks = buildMocks();
    const { mockPrisma, mockChatFacade } = mocks;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderReviewService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatFacade, useValue: mockChatFacade },
      ],
    }).compile();

    service = module.get<LeaderReviewService>(LeaderReviewService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ==================== reviewTaskResult ====================

  describe("reviewTaskResult", () => {
    it("should return approved review decision on successful AI call", async () => {
      mocks.mockChatFacade.getReasoningModel.mockResolvedValue(
        mockReasoningModel,
      );
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          status: "approved",
          feedback: "研究质量良好",
          suggestions: ["可以增加更多数据来源"],
        }),
      });

      const result = await service.reviewTaskResult(
        "mission-001",
        "task-001",
        { summary: "AI chip analysis complete" },
        "技术分析",
      );

      expect(result.taskId).toBe("task-001");
      expect(result.status).toBe("approved");
      expect(result.feedback).toBe("研究质量良好");
      expect(result.suggestions).toEqual(["可以增加更多数据来源"]);
      expect(mocks.mockChatFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gpt-o1",
          skipGuardrails: true,
        }),
      );
    });

    it("should return needs_revision decision when AI detects issues", async () => {
      mocks.mockChatFacade.getReasoningModel.mockResolvedValue(
        mockReasoningModel,
      );
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          status: "needs_revision",
          feedback: "数据来源不足",
          revisionInstructions: "请补充至少3个权威来源",
        }),
      });

      const result = await service.reviewTaskResult(
        "mission-001",
        "task-002",
        "partial research result",
      );

      expect(result.taskId).toBe("task-002");
      expect(result.status).toBe("needs_revision");
      expect(result.revisionInstructions).toBe("请补充至少3个权威来源");
      expect(mocks.mockPrisma.leaderDecision.create).toHaveBeenCalled();
    });

    it("should return default approved decision when AI call fails", async () => {
      mocks.mockChatFacade.getReasoningModel.mockResolvedValue(
        mockReasoningModel,
      );
      mocks.mockChatFacade.chat.mockRejectedValue(new Error("Network timeout"));

      const result = await service.reviewTaskResult(
        "mission-001",
        "task-003",
        "some result",
      );

      expect(result.taskId).toBe("task-003");
      expect(result.status).toBe("approved");
      expect(result.feedback).toContain("AI 调用异常");
      expect(mocks.mockPrisma.leaderDecision.create).not.toHaveBeenCalled();
    });

    it("should return default approved decision when JSON parse fails", async () => {
      mocks.mockChatFacade.getReasoningModel.mockResolvedValue(
        mockReasoningModel,
      );
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: "This is not valid JSON at all, just plain text response",
      });

      const result = await service.reviewTaskResult(
        "mission-001",
        "task-004",
        "some result",
      );

      expect(result.taskId).toBe("task-004");
      expect(result.status).toBe("approved");
      expect(result.feedback).toContain("解析失败");
      expect(mocks.mockPrisma.leaderDecision.create).not.toHaveBeenCalled();
    });

    it("should throw ServiceUnavailableException when no reasoning model is available", async () => {
      mocks.mockChatFacade.getReasoningModel.mockResolvedValue(null);

      await expect(
        service.reviewTaskResult("mission-001", "task-005", "result"),
      ).rejects.toThrow(ServiceUnavailableException);

      expect(mocks.mockChatFacade.chat).not.toHaveBeenCalled();
    });

    it("should record decision to DB after successful review", async () => {
      mocks.mockChatFacade.getReasoningModel.mockResolvedValue(
        mockReasoningModel,
      );
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          status: "rejected",
          feedback: "质量不达标",
        }),
      });

      await service.reviewTaskResult(
        "mission-001",
        "task-006",
        "poor result",
        "市场分析",
      );

      expect(mocks.mockPrisma.leaderDecision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            missionId: "mission-001",
            modelUsed: "gpt-o1",
          }),
        }),
      );
    });
  });

  // ==================== extractClaims ====================

  describe("extractClaims", () => {
    it("should return extracted claims on successful structured call", async () => {
      const mockClaims = [
        {
          id: "claim-1",
          statement: "AI chip market grew 40% in 2024",
          sectionId: "section-001",
          sourceEvidenceIndices: [0, 1],
          importance: "high" as const,
        },
        {
          id: "claim-2",
          statement: "NVIDIA holds 80% market share",
          sectionId: "section-001",
          sourceEvidenceIndices: [2],
          importance: "medium" as const,
        },
      ];

      mocks.mockChatFacade.chatStructured.mockResolvedValue({
        data: { claims: mockClaims },
        rawContent: JSON.stringify({ claims: mockClaims }),
      });

      const result = await service.extractClaims(
        "section-001",
        "AI chip market analysis content...",
      );

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("claim-1");
      expect(result[0].importance).toBe("high");
      expect(mocks.mockChatFacade.chatStructured).toHaveBeenCalledWith(
        expect.objectContaining({
          skipGuardrails: true,
          throwOnParseError: false,
        }),
      );
    });

    it("should return empty array when structured response has no data", async () => {
      mocks.mockChatFacade.chatStructured.mockResolvedValue({
        data: null,
        rawContent: "failed to parse",
      });

      const result = await service.extractClaims("section-002", "some content");

      expect(result).toEqual([]);
    });

    it("should return empty array when structured response has no claims field", async () => {
      mocks.mockChatFacade.chatStructured.mockResolvedValue({
        data: {},
        rawContent: "{}",
      });

      const result = await service.extractClaims("section-003", "some content");

      expect(result).toEqual([]);
    });

    it("should return empty array when chatStructured throws an error", async () => {
      mocks.mockChatFacade.chatStructured.mockRejectedValue(
        new Error("LLM service unavailable"),
      );

      const result = await service.extractClaims("section-004", "some content");

      expect(result).toEqual([]);
    });

    it("should truncate section content to 4000 characters", async () => {
      const longContent = "A".repeat(5000);
      mocks.mockChatFacade.chatStructured.mockResolvedValue({
        data: { claims: [] },
        rawContent: "[]",
      });

      await service.extractClaims("section-005", longContent);

      // Verify that the full 5000-char content was NOT passed verbatim
      const callArg = mocks.mockChatFacade.chatStructured.mock.calls[0][0];
      const messageContent = callArg.messages[0].content as string;
      // The truncated content (4000 A's) should appear, but not the full 5000
      expect(messageContent).toContain("A".repeat(4000));
      expect(messageContent).not.toContain("A".repeat(4001));
    });
  });

  // ==================== verifyHypotheses ====================

  describe("verifyHypotheses", () => {
    const mockHypotheses = [
      {
        id: "hyp-1",
        statement: "AI regulation will slow chip innovation",
        type: "causal" as const,
        evidenceNeeded: "Policy impact studies",
      },
      {
        id: "hyp-2",
        statement: "Open-source models correlate with reduced chip demand",
        type: "correlational" as const,
        evidenceNeeded: "Market data 2023-2024",
      },
    ];

    it("should return empty array when hypotheses list is empty", async () => {
      const result = await service.verifyHypotheses([], "evidence summary");

      expect(result).toEqual([]);
      expect(mocks.mockChatFacade.chatStructured).not.toHaveBeenCalled();
    });

    it("should return verification results on successful AI call", async () => {
      const mockResults = [
        {
          hypothesisId: "hyp-1",
          status: "partially_supported" as const,
          supportingEvidence: "Some regulations did slow development",
          contradictingEvidence: "Innovation continued in unregulated regions",
          confidence: 60,
          refinedStatement: "Regulation has mixed effects on innovation",
        },
        {
          hypothesisId: "hyp-2",
          status: "inconclusive" as const,
          supportingEvidence: "Limited data available",
          contradictingEvidence: "Chip sales remained high",
          confidence: 30,
        },
      ];

      mocks.mockChatFacade.chatStructured.mockResolvedValue({
        data: { results: mockResults },
        rawContent: JSON.stringify({ results: mockResults }),
      });

      const result = await service.verifyHypotheses(
        mockHypotheses,
        "Comprehensive evidence from multiple sources...",
      );

      expect(result).toHaveLength(2);
      expect(result[0].hypothesisId).toBe("hyp-1");
      expect(result[0].status).toBe("partially_supported");
      expect(result[1].confidence).toBe(30);
      expect(mocks.mockChatFacade.chatStructured).toHaveBeenCalledWith(
        expect.objectContaining({
          skipGuardrails: true,
          throwOnParseError: false,
        }),
      );
    });

    it("should return empty array when structured response has no results", async () => {
      mocks.mockChatFacade.chatStructured.mockResolvedValue({
        data: null,
        rawContent: "null",
      });

      const result = await service.verifyHypotheses(
        mockHypotheses,
        "evidence summary",
      );

      expect(result).toEqual([]);
    });

    it("should return empty array when chatStructured throws an error", async () => {
      mocks.mockChatFacade.chatStructured.mockRejectedValue(
        new Error("Timeout"),
      );

      const result = await service.verifyHypotheses(
        mockHypotheses,
        "evidence summary",
      );

      expect(result).toEqual([]);
    });

    it("should truncate evidence summary to 6000 characters", async () => {
      const longEvidence = "B".repeat(8000);
      mocks.mockChatFacade.chatStructured.mockResolvedValue({
        data: { results: [] },
        rawContent: "[]",
      });

      await service.verifyHypotheses(mockHypotheses, longEvidence);

      const callArg = mocks.mockChatFacade.chatStructured.mock.calls[0][0];
      const messageContent = callArg.messages[0].content as string;
      // The evidence should be truncated so the content is not excessively long
      expect(messageContent).not.toContain("B".repeat(6001));
    });
  });
});
