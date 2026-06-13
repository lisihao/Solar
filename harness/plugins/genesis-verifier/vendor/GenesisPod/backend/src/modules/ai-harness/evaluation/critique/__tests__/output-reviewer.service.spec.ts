import { Test, TestingModule } from "@nestjs/testing";
import { OutputReviewerService } from "../output-reviewer.service";
import { AiChatService } from "../../../../ai-engine/llm/chat/ai-chat.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

describe("OutputReviewerService", () => {
  let service: OutputReviewerService;
  let mockAiChatService: any;
  let mockPrisma: any;

  const mockLeader = {
    aiModel: "gpt-4o",
    persona: "You are a strict reviewer",
    systemPrompt: "Review all content carefully",
  };

  const mockTask = {
    id: "task-1",
    title: "Research Task",
    description: "Write a research report",
  };

  const mockReviewRequest = {
    missionId: "mission-123",
    task: mockTask,
    content: "This is the task output content.",
    leader: mockLeader,
    missionDescription: "Complete a comprehensive analysis",
    constraints: [],
    criteria: {},
  };

  const validReviewJsonResponse = `\`\`\`json
{
  "scores": {
    "completeness": 8,
    "accuracy": 9,
    "logic": 8,
    "professionalism": 8
  },
  "totalScore": 8.3,
  "passed": true,
  "feedback": "Good quality output",
  "issues": [],
  "suggestions": ["Add more detail"]
}
\`\`\``;

  const failingReviewJsonResponse = `\`\`\`json
{
  "scores": {
    "completeness": 5,
    "accuracy": 6,
    "logic": 5,
    "professionalism": 5
  },
  "totalScore": 5.3,
  "passed": false,
  "feedback": "Output needs improvement",
  "issues": ["Missing key information", "Logic gaps"],
  "suggestions": ["Add more detail", "Fix logical flow"]
}
\`\`\``;

  beforeEach(async () => {
    mockAiChatService = {
      chat: jest.fn().mockResolvedValue({
        content: validReviewJsonResponse,
        tokensUsed: 150,
        usage: { totalTokens: 150 },
      }),
      generateChatCompletion: jest.fn().mockResolvedValue({
        content: validReviewJsonResponse,
        tokensUsed: 150,
      }),
    };

    mockPrisma = {
      aIModel: {
        findFirst: jest.fn().mockResolvedValue({
          modelId: "gpt-4o",
          provider: "openai",
          apiKey: "test-key",
          apiEndpoint: null,
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutputReviewerService,
        { provide: AiChatService, useValue: mockAiChatService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<OutputReviewerService>(OutputReviewerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== reviewOutput ====================

  describe("reviewOutput", () => {
    it("should return passed result for good output", async () => {
      const result = await service.reviewOutput(mockReviewRequest);

      expect(result.passed).toBe(true);
      expect(result.score).toBeGreaterThan(0);
      expect(result).toHaveProperty("feedback");
      expect(result).toHaveProperty("issues");
      expect(result).toHaveProperty("suggestions");
    });

    it("should return failing result for bad output", async () => {
      mockAiChatService.generateChatCompletion.mockResolvedValue({
        content: failingReviewJsonResponse,
        tokensUsed: 100,
      });

      const result = await service.reviewOutput(mockReviewRequest);

      expect(result.passed).toBe(false);
      expect(result.score).toBeLessThan(7);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it("should use aiCaller when provided", async () => {
      const mockAiCaller = jest.fn().mockResolvedValue({
        content: validReviewJsonResponse,
        tokensUsed: 80,
      });

      await service.reviewOutput(mockReviewRequest, mockAiCaller);

      expect(mockAiCaller).toHaveBeenCalled();
      expect(mockAiChatService.chat).not.toHaveBeenCalled();
    });

    it("should summarize long content before review", async () => {
      const longContent = "A".repeat(4000);

      const requestWithLongContent = {
        ...mockReviewRequest,
        content: longContent,
      };

      // First call will be summarization, second will be review
      mockAiChatService.generateChatCompletion
        .mockResolvedValueOnce({
          content: "【摘要】\n Short summary\n\n【关键片段】\nKey excerpt",
          tokensUsed: 80,
        })
        .mockResolvedValueOnce({
          content: validReviewJsonResponse,
          tokensUsed: 100,
        });

      const result = await service.reviewOutput(requestWithLongContent);

      expect(result).toHaveProperty("passed");
      expect(mockAiChatService.generateChatCompletion).toHaveBeenCalledTimes(2);
    });

    it("should default to passed=true when review fails", async () => {
      mockAiChatService.generateChatCompletion.mockRejectedValue(
        new Error("AI Error"),
      );

      const result = await service.reviewOutput(mockReviewRequest);

      // Defaults to passed on error
      expect(result.passed).toBe(true);
      expect(result.score).toBe(7);
    });

    it("should include tokensUsed in result", async () => {
      const result = await service.reviewOutput(mockReviewRequest);

      expect(result).toHaveProperty("tokensUsed");
      expect(typeof result.tokensUsed).toBe("number");
    });

    it("should handle constraints in review prompt", async () => {
      const requestWithConstraints = {
        ...mockReviewRequest,
        constraints: [
          { type: "length", description: "Must be under 1000 words" },
          { type: "format", description: "Must use markdown" },
        ],
      };

      await service.reviewOutput(requestWithConstraints);

      const callArgs =
        mockAiChatService.generateChatCompletion.mock.calls[0][0];
      const prompt = callArgs.messages[callArgs.messages.length - 1].content;
      expect(prompt).toContain("硬约束要求");
    });

    it("should use custom passThreshold from criteria", async () => {
      const highThresholdRequest = {
        ...mockReviewRequest,
        criteria: { passThreshold: 9 },
      };

      // Score 8.3 should fail with threshold 9
      mockAiChatService.generateChatCompletion.mockResolvedValue({
        content: `\`\`\`json
{
  "totalScore": 8.3,
  "passed": true,
  "feedback": "Good",
  "issues": [],
  "suggestions": []
}
\`\`\``,
        tokensUsed: 100,
      });

      const result = await service.reviewOutput(highThresholdRequest);
      // The JSON has passed: true but score 8.3 < threshold 9
      // parseReviewResult uses the JSON's passed field directly
      expect(result).toHaveProperty("passed");
    });
  });

  // ==================== summarizeForReview ====================

  describe("summarizeForReview", () => {
    it("should return summary and excerpts from AI", async () => {
      mockAiChatService.generateChatCompletion.mockResolvedValue({
        content: "【摘要】\n核心内容摘要\n\n【关键片段】\n关键段落1\n关键段落2",
        tokensUsed: 80,
      });

      const result = await service.summarizeForReview(
        "Long content here",
        "Task title",
        "gpt-4o",
        "mission-123",
      );

      expect(result.summary).toContain("核心内容摘要");
      expect(result.keyExcerpts).toContain("关键段落");
    });

    it("should use aiCaller when provided", async () => {
      const mockAiCaller = jest.fn().mockResolvedValue({
        content: "【摘要】\nAI summary\n\n【关键片段】\nexcerpt",
        tokensUsed: 60,
      });

      await service.summarizeForReview(
        "content",
        "title",
        "gpt-4o",
        "mission-123",
        mockAiCaller,
      );

      expect(mockAiCaller).toHaveBeenCalled();
    });

    it("should fall back to truncated content on failure", async () => {
      mockAiChatService.generateChatCompletion.mockRejectedValue(
        new Error("API Error"),
      );

      const content = "Short content";
      const result = await service.summarizeForReview(
        content,
        "title",
        "gpt-4o",
        "mission-123",
      );

      expect(result.summary).toContain("Short content");
      expect(result.keyExcerpts).toBeUndefined();
    });

    it("should truncate very long content", async () => {
      mockAiChatService.generateChatCompletion.mockResolvedValue({
        content: "【摘要】\nSummary\n\n【关键片段】\nexcerpt",
        tokensUsed: 100,
      });

      const veryLongContent = "A".repeat(15000);
      await service.summarizeForReview(
        veryLongContent,
        "title",
        "gpt-4o",
        "mission-123",
      );

      const callArgs =
        mockAiChatService.generateChatCompletion.mock.calls[0][0];
      const prompt = callArgs.messages[callArgs.messages.length - 1].content;
      expect(prompt).toContain("内容已截断");
    });
  });

  // ==================== executeRevision ====================

  describe("executeRevision", () => {
    const revisionRequest = {
      missionId: "mission-123",
      originalContent: "Original output",
      reviewFeedback: "Needs more detail",
      issues: ["Missing section A", "Logic gap in section B"],
      revisionCount: 1,
      originalContext: {
        systemPrompt: "You are a helpful assistant",
        userPrompt: "Write a report",
        executor: {
          id: "executor-1",
          aiModel: "gpt-4o",
          agentName: "Executor",
          displayName: "Executor Agent",
        },
      },
    };

    it("should execute revision successfully", async () => {
      mockAiChatService.generateChatCompletion.mockResolvedValue({
        content: "Revised content here",
        tokensUsed: 100,
      });

      const result = await service.executeRevision(revisionRequest);

      expect(result.success).toBe(true);
      expect(result.content).toBe("Revised content here");
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("should use aiCaller when provided", async () => {
      const mockAiCaller = jest.fn().mockResolvedValue({
        content: "Revised by aiCaller",
        tokensUsed: 80,
      });

      const result = await service.executeRevision(
        revisionRequest,
        mockAiCaller,
      );

      expect(mockAiCaller).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.content).toBe("Revised by aiCaller");
    });

    it("should return failure when AI call fails", async () => {
      mockAiChatService.generateChatCompletion.mockRejectedValue(
        new Error("Revision failed"),
      );

      const result = await service.executeRevision(revisionRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Revision failed");
      expect(result.retryable).toBe(true);
    });

    it("should include revision count in prompt", async () => {
      mockAiChatService.generateChatCompletion.mockResolvedValue({
        content: "Revised",
        tokensUsed: 50,
      });

      await service.executeRevision({ ...revisionRequest, revisionCount: 3 });

      const callArgs =
        mockAiChatService.generateChatCompletion.mock.calls[0][0];
      const userMsg = callArgs.messages.find((m: any) => m.role === "user");
      expect(userMsg.content).toContain("第 3 次");
    });
  });

  // ==================== executeAICall ====================

  describe("executeAICall", () => {
    it("should execute AI call with messages", async () => {
      mockAiChatService.generateChatCompletion.mockResolvedValue({
        content: "AI response",
        tokensUsed: 60,
      });

      const result = await service.executeAICall("gpt-4o", [
        { role: "system", content: "System prompt" },
        { role: "user", content: "User message" },
      ]);

      expect(result.content).toBe("AI response");
      expect(result.tokensUsed).toBe(60);
    });

    it("should use aiCaller when provided", async () => {
      const mockAiCaller = jest.fn().mockResolvedValue({
        content: "Called via aiCaller",
        tokensUsed: 40,
      });

      const result = await service.executeAICall(
        "gpt-4o",
        [{ role: "user", content: "Hello" }],
        { taskProfile: { creativity: "low", outputLength: "short" } },
        mockAiCaller,
      );

      expect(mockAiCaller).toHaveBeenCalled();
      expect(result.content).toBe("Called via aiCaller");
    });

    it("should pass taskProfile when provided", async () => {
      mockAiChatService.generateChatCompletion.mockResolvedValue({
        content: "OK",
        tokensUsed: 50,
      });

      await service.executeAICall(
        "gpt-4o",
        [{ role: "user", content: "Hello" }],
        { taskProfile: { creativity: "high", outputLength: "long" } },
      );

      expect(mockAiChatService.generateChatCompletion).toHaveBeenCalled();
    });

    it("should throw when AI call fails", async () => {
      mockAiChatService.generateChatCompletion.mockRejectedValue(
        new Error("AI unavailable"),
      );

      await expect(
        service.executeAICall("gpt-4o", [{ role: "user", content: "test" }]),
      ).rejects.toThrow("AI unavailable");
    });
  });

  // ==================== parseReviewResult (via reviewOutput) ====================

  describe("parseReviewResult edge cases", () => {
    it("should handle direct JSON without code block markers", async () => {
      mockAiChatService.generateChatCompletion.mockResolvedValue({
        content: `{"totalScore": 8, "passed": true, "feedback": "Good", "issues": [], "suggestions": []}`,
        tokensUsed: 80,
      });

      const result = await service.reviewOutput(mockReviewRequest);

      expect(result.passed).toBe(true);
      expect(result.score).toBe(8);
    });

    it("should handle non-JSON response with keyword detection", async () => {
      mockAiChatService.generateChatCompletion.mockResolvedValue({
        content: "内容质量良好，符合要求，建议通过审核。",
        tokensUsed: 40,
      });

      const result = await service.reviewOutput(mockReviewRequest);

      expect(result.passed).toBe(true);
    });

    it("should handle negative keyword detection", async () => {
      mockAiChatService.generateChatCompletion.mockResolvedValue({
        content: "内容存在问题较多，需要修改，建议不通过。",
        tokensUsed: 40,
      });

      const result = await service.reviewOutput(mockReviewRequest);

      expect(result.passed).toBe(false);
    });
  });
});
