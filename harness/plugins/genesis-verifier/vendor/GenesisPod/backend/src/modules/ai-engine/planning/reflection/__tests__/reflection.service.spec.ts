import { Test, TestingModule } from "@nestjs/testing";
import { AIModelType } from "@prisma/client";
import {
  CHAT_PROVIDER_PORT,
  ReflectionInput,
  ReflectionResult,
  ReflectionConfig,
} from "../../../facade";
import { ReflectionService } from "../reflection.service";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<ReflectionInput> = {}): ReflectionInput {
  return {
    objective: "Research AI trends",
    progressSummary: "Found 15 sources so far",
    currentRound: 1,
    maxRounds: 5,
    ...overrides,
  };
}

function makeJsonResponse(
  decision: string,
  score: number,
  assessment = "Good progress",
  gaps: string[] = [],
  suggestions: string[] = [],
): string {
  return `\`\`\`json
{
  "quality_score": ${score},
  "assessment": "${assessment}",
  "gaps_identified": ${JSON.stringify(gaps)},
  "decision": "${decision}",
  "reasoning": "Based on current data",
  "suggested_actions": ${JSON.stringify(suggestions)}
}
\`\`\``;
}

// ─── Provide token ────────────────────────────────────────────────────────────
//
// ReflectionService injects CHAT_PROVIDER_PORT, so tests can bind a plain
// chat mock without importing ai-harness internals.

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ReflectionService", () => {
  let service: ReflectionService;
  let mockFacade: { chat: jest.Mock };

  beforeEach(async () => {
    mockFacade = {
      chat: jest.fn().mockResolvedValue({
        content: makeJsonResponse("continue", 65),
        tokensUsed: 120,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReflectionService,
        {
          provide: CHAT_PROVIDER_PORT,
          useValue: mockFacade,
        },
      ],
    }).compile();

    service = module.get(ReflectionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── reflect() – happy path ───────────────────────────────────────────────────

  describe("reflect()", () => {
    it("calls aiFacade.chat with system and user messages", async () => {
      await service.reflect(makeInput());

      expect(mockFacade.chat).toHaveBeenCalledTimes(1);
      const callArgs = mockFacade.chat.mock.calls[0][0];
      expect(callArgs.messages).toHaveLength(2);
      expect(callArgs.messages[0].role).toBe("system");
      expect(callArgs.messages[1].role).toBe("user");
    });

    it("uses CHAT_FAST model type by default", async () => {
      await service.reflect(makeInput());

      const callArgs = mockFacade.chat.mock.calls[0][0];
      expect(callArgs.modelType).toBe(AIModelType.CHAT_FAST);
    });

    it("uses custom modelType when provided in config", async () => {
      await service.reflect(makeInput(), { modelType: AIModelType.CHAT });

      const callArgs = mockFacade.chat.mock.calls[0][0];
      expect(callArgs.modelType).toBe(AIModelType.CHAT);
    });

    it("returns ReflectionResult with correct fields", async () => {
      mockFacade.chat.mockResolvedValueOnce({
        content: makeJsonResponse("continue", 70, "Good progress", ["gap1"]),
        tokensUsed: 150,
      });

      const result = await service.reflect(makeInput({ currentRound: 2 }));

      expect(result.round).toBe(2);
      expect(result.qualityScore).toBe(70);
      expect(result.assessment).toBe("Good progress");
      expect(result.gaps).toEqual(["gap1"]);
      expect(result.decision).toBe("continue");
      expect(result.reasoning).toBe("Based on current data");
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it("parses 'complete' decision correctly", async () => {
      mockFacade.chat.mockResolvedValueOnce({
        content: makeJsonResponse("complete", 85),
        tokensUsed: 100,
      });

      const result = await service.reflect(makeInput());
      expect(result.decision).toBe("complete");
    });

    it("parses 'pivot' decision with suggestions", async () => {
      mockFacade.chat.mockResolvedValueOnce({
        content: makeJsonResponse(
          "pivot",
          40,
          "Needs adjustment",
          ["missing data"],
          ["search more", "refine query"],
        ),
        tokensUsed: 100,
      });

      const result = await service.reflect(makeInput());
      expect(result.decision).toBe("pivot");
      expect(result.suggestions).toEqual(["search more", "refine query"]);
    });

    it("parses 'retry' decision", async () => {
      mockFacade.chat.mockResolvedValueOnce({
        content: makeJsonResponse("retry", 30),
        tokensUsed: 80,
      });

      const result = await service.reflect(makeInput());
      expect(result.decision).toBe("retry");
    });

    it("parses 'escalate' decision", async () => {
      mockFacade.chat.mockResolvedValueOnce({
        content: makeJsonResponse("escalate", 20),
        tokensUsed: 80,
      });

      const result = await service.reflect(makeInput());
      expect(result.decision).toBe("escalate");
    });

    it("includes objective and round info in user prompt", async () => {
      const input = makeInput({
        objective: "Investigate climate change",
        currentRound: 3,
        maxRounds: 10,
      });

      await service.reflect(input);

      const callArgs = mockFacade.chat.mock.calls[0][0];
      const userPrompt = callArgs.messages[1].content;
      expect(userPrompt).toContain("Investigate climate change");
      expect(userPrompt).toContain("3");
      expect(userPrompt).toContain("10");
    });

    it("includes completedWork in user prompt when provided", async () => {
      const input = makeInput({ completedWork: "Section 1 done" });

      await service.reflect(input);

      const callArgs = mockFacade.chat.mock.calls[0][0];
      const userPrompt = callArgs.messages[1].content;
      expect(userPrompt).toContain("Section 1 done");
    });

    it("includes remainingPlan in user prompt when provided", async () => {
      const input = makeInput({ remainingPlan: "Still need section 2" });

      await service.reflect(input);

      const callArgs = mockFacade.chat.mock.calls[0][0];
      const userPrompt = callArgs.messages[1].content;
      expect(userPrompt).toContain("Still need section 2");
    });

    it("uses customSystemPrompt when provided", async () => {
      await service.reflect(makeInput(), {
        customSystemPrompt: "My custom system prompt",
      });

      const callArgs = mockFacade.chat.mock.calls[0][0];
      expect(callArgs.messages[0].content).toBe("My custom system prompt");
    });

    it("includes default evaluation dimensions in system prompt", async () => {
      await service.reflect(makeInput());

      const callArgs = mockFacade.chat.mock.calls[0][0];
      const systemPrompt = callArgs.messages[0].content;
      expect(systemPrompt).toContain("信息覆盖度");
    });

    it("uses custom evaluationDimensions when provided", async () => {
      await service.reflect(makeInput(), {
        evaluationDimensions: ["Custom dim 1", "Custom dim 2"],
      });

      const callArgs = mockFacade.chat.mock.calls[0][0];
      const systemPrompt = callArgs.messages[0].content;
      expect(systemPrompt).toContain("Custom dim 1");
      expect(systemPrompt).toContain("Custom dim 2");
    });

    it("uses low creativity for objective evaluation", async () => {
      await service.reflect(makeInput());

      const callArgs = mockFacade.chat.mock.calls[0][0];
      expect(callArgs.taskProfile.creativity).toBe("low");
    });
  });

  // ─── reflect() – error handling ───────────────────────────────────────────────

  describe("reflect() – error handling", () => {
    it("returns default reflection when AI call fails", async () => {
      mockFacade.chat.mockRejectedValueOnce(new Error("API timeout"));

      const result = await service.reflect(makeInput({ currentRound: 1 }));

      expect(result).toBeDefined();
      expect(result.decision).toBeDefined();
      expect(result.round).toBe(1);
    });

    it("returns 'complete' decision near max rounds on AI failure", async () => {
      mockFacade.chat.mockRejectedValueOnce(new Error("API error"));

      // currentRound >= maxRounds - 1
      const result = await service.reflect(
        makeInput({ currentRound: 4, maxRounds: 5 }),
      );

      expect(result.decision).toBe("complete");
    });

    it("returns 'continue' decision far from max rounds on AI failure", async () => {
      mockFacade.chat.mockRejectedValueOnce(new Error("API error"));

      const result = await service.reflect(
        makeInput({ currentRound: 1, maxRounds: 10 }),
      );

      expect(result.decision).toBe("continue");
    });

    it("handles malformed JSON response gracefully", async () => {
      mockFacade.chat.mockResolvedValueOnce({
        content: "This is not valid JSON at all",
        tokensUsed: 50,
      });

      const result = await service.reflect(makeInput());

      // Falls back to default parse result
      expect(result.decision).toBe("continue");
      expect(result.qualityScore).toBe(50);
    });

    it("handles AI response with invalid decision value", async () => {
      mockFacade.chat.mockResolvedValueOnce({
        content: `\`\`\`json
{
  "quality_score": 60,
  "assessment": "Test",
  "gaps_identified": [],
  "decision": "invalid_decision_xyz",
  "reasoning": "Test"
}
\`\`\``,
        tokensUsed: 80,
      });

      const result = await service.reflect(makeInput());
      // Invalid decision should be normalized to 'continue'
      expect(result.decision).toBe("continue");
    });

    it("clamps quality score above 100 to 100", async () => {
      mockFacade.chat.mockResolvedValueOnce({
        content: makeJsonResponse("continue", 150),
        tokensUsed: 80,
      });

      const result = await service.reflect(makeInput());
      expect(result.qualityScore).toBe(100);
    });

    it("clamps quality score below 0 to 0", async () => {
      mockFacade.chat.mockResolvedValueOnce({
        content: makeJsonResponse("continue", -20),
        tokensUsed: 80,
      });

      const result = await service.reflect(makeInput());
      expect(result.qualityScore).toBe(0);
    });

    it("handles NaN quality score by defaulting to 50", async () => {
      mockFacade.chat.mockResolvedValueOnce({
        content: `\`\`\`json
{
  "quality_score": "not-a-number",
  "assessment": "Test",
  "gaps_identified": [],
  "decision": "continue",
  "reasoning": "Test"
}
\`\`\``,
        tokensUsed: 80,
      });

      const result = await service.reflect(makeInput());
      expect(result.qualityScore).toBe(50);
    });

    it("handles response with raw JSON object (no code fences)", async () => {
      mockFacade.chat.mockResolvedValueOnce({
        content: `{"quality_score": 72, "assessment": "Good", "gaps_identified": [], "decision": "continue", "reasoning": "ok"}`,
        tokensUsed: 80,
      });

      const result = await service.reflect(makeInput());
      expect(result.qualityScore).toBe(72);
      expect(result.decision).toBe("continue");
    });
  });

  // ─── shouldContinue() ────────────────────────────────────────────────────────

  describe("shouldContinue()", () => {
    function makeReflection(
      decision: ReflectionResult["decision"],
    ): ReflectionResult {
      return {
        round: 1,
        qualityScore: 60,
        assessment: "ok",
        gaps: [],
        decision,
        reasoning: "test",
        timestamp: new Date(),
      };
    }

    it("returns false when currentRound >= maxRounds", () => {
      const reflection = makeReflection("continue");
      expect(service.shouldContinue(reflection, 5, 5)).toBe(false);
      expect(service.shouldContinue(reflection, 6, 5)).toBe(false);
    });

    it("returns false when decision is 'complete'", () => {
      const reflection = makeReflection("complete");
      expect(service.shouldContinue(reflection, 1, 5)).toBe(false);
    });

    it("returns true when decision is 'continue' and rounds remain", () => {
      const reflection = makeReflection("continue");
      expect(service.shouldContinue(reflection, 1, 5)).toBe(true);
    });

    it("returns true when decision is 'pivot' and rounds remain", () => {
      const reflection = makeReflection("pivot");
      expect(service.shouldContinue(reflection, 2, 5)).toBe(true);
    });

    it("returns true when decision is 'retry' and rounds remain", () => {
      const reflection = makeReflection("retry");
      expect(service.shouldContinue(reflection, 1, 5)).toBe(true);
    });

    it("returns true when decision is 'escalate' and rounds remain", () => {
      const reflection = makeReflection("escalate");
      expect(service.shouldContinue(reflection, 1, 5)).toBe(true);
    });
  });

  // ─── batchReflect() ──────────────────────────────────────────────────────────

  describe("batchReflect()", () => {
    it("returns a Map with results for each item", async () => {
      const items = [
        { id: "item-1", content: "Content for item 1" },
        { id: "item-2", content: "Content for item 2" },
        { id: "item-3", content: "Content for item 3" },
      ];

      mockFacade.chat.mockResolvedValue({
        content: makeJsonResponse("complete", 80),
        tokensUsed: 100,
      });

      const results = await service.batchReflect(
        items,
        "Evaluate all items",
        {},
      );

      expect(results).toBeInstanceOf(Map);
      expect(results.size).toBe(3);
      expect(results.has("item-1")).toBe(true);
      expect(results.has("item-2")).toBe(true);
      expect(results.has("item-3")).toBe(true);
    });

    it("processes all items including batches of more than 3", async () => {
      const items = Array.from({ length: 5 }, (_, i) => ({
        id: `item-${i}`,
        content: `Content ${i}`,
      }));

      mockFacade.chat.mockResolvedValue({
        content: makeJsonResponse("continue", 60),
        tokensUsed: 80,
      });

      const results = await service.batchReflect(items, "Batch test");

      expect(results.size).toBe(5);
      expect(mockFacade.chat).toHaveBeenCalledTimes(5);
    });

    it("returns empty Map for empty items array", async () => {
      const results = await service.batchReflect([], "No items");
      expect(results.size).toBe(0);
      expect(mockFacade.chat).not.toHaveBeenCalled();
    });

    it("each item is reflected with round=1 and maxRounds=1", async () => {
      const items = [{ id: "item-1", content: "Test content" }];

      mockFacade.chat.mockResolvedValue({
        content: makeJsonResponse("complete", 75),
        tokensUsed: 100,
      });

      const results = await service.batchReflect(items, "Test objective");
      const result = results.get("item-1")!;

      expect(result.round).toBe(1);
    });
  });

  // ─── quickCheck() ────────────────────────────────────────────────────────────

  describe("quickCheck()", () => {
    it("returns 'complete' when itemCount >= minItems * 2", () => {
      // default minItems = 10, so >= 20 → complete
      expect(service.quickCheck(20)).toBe("complete");
      expect(service.quickCheck(25)).toBe("complete");
    });

    it("returns 'continue' when itemCount >= minItems but < minItems * 2", () => {
      // default minItems = 10, so 10-19 → continue
      expect(service.quickCheck(10)).toBe("continue");
      expect(service.quickCheck(15)).toBe("continue");
      expect(service.quickCheck(19)).toBe("continue");
    });

    it("returns 'pivot' when itemCount < minItems", () => {
      // default minItems = 10, so < 10 → pivot
      expect(service.quickCheck(0)).toBe("pivot");
      expect(service.quickCheck(5)).toBe("pivot");
      expect(service.quickCheck(9)).toBe("pivot");
    });

    it("respects custom minItems from config", () => {
      const config: ReflectionConfig = { minItems: 5 };

      expect(service.quickCheck(10, config)).toBe("complete"); // >= 5*2
      expect(service.quickCheck(5, config)).toBe("continue"); // >= 5 but < 10
      expect(service.quickCheck(4, config)).toBe("pivot"); // < 5
    });

    it("does not call AI facade", () => {
      service.quickCheck(10);
      expect(mockFacade.chat).not.toHaveBeenCalled();
    });
  });

  // ─── completionThreshold in default reflection ────────────────────────────────

  describe("reflect() – completionThreshold", () => {
    it("default reflection near max rounds uses completionThreshold as qualityScore", async () => {
      mockFacade.chat.mockRejectedValueOnce(new Error("error"));

      const result = await service.reflect(
        makeInput({ currentRound: 4, maxRounds: 5 }),
        { completionThreshold: 80 },
      );

      expect(result.qualityScore).toBe(80);
    });
  });
});
