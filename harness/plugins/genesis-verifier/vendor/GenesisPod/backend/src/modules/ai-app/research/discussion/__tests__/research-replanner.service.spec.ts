/**
 * ResearchReplannerService Tests
 *
 * Covers:
 * - evaluateAndReplan: no rounds (early return), needs replan, no replan needed,
 *   AI error (graceful fallback), max 3 additional steps cap
 * - callReplannerAI (via evaluateAndReplan):
 *   valid JSON from ```json``` block, raw JSON, invalid JSON, parse error
 * - buildSearchSummary: zh-CN format, en-US format
 * - ReplanRecord: correct fields (triggerStep, reason, addedQueries, timestamp)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { ResearchReplannerService } from "../research-replanner.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import type { SearchRound, SearchSource } from "../types";

// ============================================================
// Helpers
// ============================================================

const mockFacade = { chat: jest.fn() };

function buildSource(overrides: Partial<SearchSource> = {}): SearchSource {
  return {
    id: "src-1",
    title: "Test Source Title",
    url: "https://example.com/article",
    snippet:
      "A detailed snippet that provides context about the article content.",
    domain: "example.com",
    relevanceScore: 0.8,
    ...overrides,
  };
}

function buildRound(
  round: number,
  sourceCount = 3,
  query = `query ${round}`,
): SearchRound {
  return {
    round,
    stepId: `step-${round}`,
    query,
    resultsCount: sourceCount,
    sources: Array.from({ length: sourceCount }, (_, i) =>
      buildSource({
        id: `src-${round}-${i}`,
        url: `https://example${round}-${i}.com`,
      }),
    ),
    timestamp: new Date(),
  };
}

function makeReplanJson(
  needsReplan: boolean,
  additionalQueries: Array<{
    query: string;
    type: string;
    rationale: string;
  }> = [],
) {
  return JSON.stringify({
    needsReplan,
    reason: needsReplan
      ? "Missing critical information"
      : "Coverage is sufficient",
    additionalQueries,
  });
}

// ============================================================
// Tests
// ============================================================

describe("ResearchReplannerService", () => {
  let service: ResearchReplannerService;

  beforeEach(async () => {
    mockFacade.chat.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchReplannerService,
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<ResearchReplannerService>(ResearchReplannerService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ==================== evaluateAndReplan ====================

  describe("evaluateAndReplan", () => {
    it("should return needsReplan=false immediately when no rounds provided", async () => {
      const result = await service.evaluateAndReplan("test query", []);

      expect(result.needsReplan).toBe(false);
      expect(result.additionalSteps).toHaveLength(0);
      expect(mockFacade.chat).not.toHaveBeenCalled();
    });

    it("should return needsReplan=true with additional steps when AI says replan needed", async () => {
      const additionalQueries = [
        {
          query: "new search query 1",
          type: "deep_dive",
          rationale: "Fill gap A",
        },
        {
          query: "new search query 2",
          type: "academic",
          rationale: "Fill gap B",
        },
      ];
      const json = makeReplanJson(true, additionalQueries);
      mockFacade.chat.mockResolvedValue({
        content: `\`\`\`json\n${json}\n\`\`\``,
      });

      const rounds = [buildRound(1), buildRound(2)];
      const result = await service.evaluateAndReplan("original query", rounds);

      expect(result.needsReplan).toBe(true);
      expect(result.additionalSteps).toHaveLength(2);
      expect(result.additionalSteps[0].query).toBe("new search query 1");
      expect(result.additionalSteps[0].type).toBe("deep_dive");
      expect(result.additionalSteps[1].type).toBe("academic");
      expect(result.record).toBeDefined();
    });

    it("should return needsReplan=false when AI says no replan needed", async () => {
      const json = makeReplanJson(false);
      mockFacade.chat.mockResolvedValue({
        content: `\`\`\`json\n${json}\n\`\`\``,
      });

      const rounds = [buildRound(1)];
      const result = await service.evaluateAndReplan("test query", rounds);

      expect(result.needsReplan).toBe(false);
      expect(result.additionalSteps).toHaveLength(0);
      expect(result.record).toBeUndefined();
    });

    it("should return needsReplan=false when AI returns needsReplan=true but empty queries", async () => {
      const json = makeReplanJson(true, []);
      mockFacade.chat.mockResolvedValue({
        content: `\`\`\`json\n${json}\n\`\`\``,
      });

      const rounds = [buildRound(1)];
      const result = await service.evaluateAndReplan("test query", rounds);

      expect(result.needsReplan).toBe(false);
    });

    it("should cap additional steps at 3", async () => {
      const additionalQueries = Array.from({ length: 5 }, (_, i) => ({
        query: `extra query ${i + 1}`,
        type: "deep_dive",
        rationale: `Reason ${i + 1}`,
      }));
      const json = makeReplanJson(true, additionalQueries);
      mockFacade.chat.mockResolvedValue({
        content: `\`\`\`json\n${json}\n\`\`\``,
      });

      const rounds = [buildRound(1)];
      const result = await service.evaluateAndReplan("test query", rounds);

      expect(result.additionalSteps).toHaveLength(3);
    });

    it("should return needsReplan=false on AI error", async () => {
      mockFacade.chat.mockRejectedValue(new Error("Network error"));

      const rounds = [buildRound(1)];
      const result = await service.evaluateAndReplan("test query", rounds);

      expect(result.needsReplan).toBe(false);
      expect(result.additionalSteps).toHaveLength(0);
    });

    it("should set step IDs with replan_ prefix", async () => {
      const additionalQueries = [
        {
          query: "replan query",
          type: "verification",
          rationale: "Verify claims",
        },
      ];
      const json = makeReplanJson(true, additionalQueries);
      mockFacade.chat.mockResolvedValue({
        content: `\`\`\`json\n${json}\n\`\`\``,
      });

      const rounds = [buildRound(1)];
      const result = await service.evaluateAndReplan("test query", rounds);

      expect(result.additionalSteps[0].id).toMatch(/^replan_/);
    });

    it("should set estimatedSources=10 for each additional step", async () => {
      const additionalQueries = [
        { query: "step 1", type: "initial_search", rationale: "Reason" },
      ];
      const json = makeReplanJson(true, additionalQueries);
      mockFacade.chat.mockResolvedValue({
        content: `\`\`\`json\n${json}\n\`\`\``,
      });

      const rounds = [buildRound(1)];
      const result = await service.evaluateAndReplan("test query", rounds);

      expect(result.additionalSteps[0].estimatedSources).toBe(10);
    });

    it("should build replan record with correct fields", async () => {
      const additionalQueries = [
        { query: "recorded query", type: "deep_dive", rationale: "Gap found" },
      ];
      const json = makeReplanJson(true, additionalQueries);
      mockFacade.chat.mockResolvedValue({
        content: `\`\`\`json\n${json}\n\`\`\``,
      });

      const rounds = [buildRound(1), buildRound(2)];
      const result = await service.evaluateAndReplan("original", rounds);

      expect(result.record).toBeDefined();
      expect(result.record!.triggerStep).toBe(2);
      expect(result.record!.reason).toBe("Missing critical information");
      expect(result.record!.addedQueries).toContain("recorded query");
      expect(result.record!.timestamp).toBeInstanceOf(Date);
    });

    it("should call aiFacade with CHAT model and deterministic creativity", async () => {
      const json = makeReplanJson(false);
      mockFacade.chat.mockResolvedValue({
        content: `\`\`\`json\n${json}\n\`\`\``,
      });

      const rounds = [buildRound(1)];
      await service.evaluateAndReplan("test query", rounds);

      expect(mockFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          modelType: AIModelType.CHAT,
          taskProfile: expect.objectContaining({ creativity: "deterministic" }),
        }),
      );
    });

    it("should use en-US prompt when language=en-US", async () => {
      const json = makeReplanJson(false);
      mockFacade.chat.mockResolvedValue({
        content: `\`\`\`json\n${json}\n\`\`\``,
      });

      const rounds = [buildRound(1)];
      await service.evaluateAndReplan("test query", rounds, "en-US");

      const chatCall = mockFacade.chat.mock.calls[0][0];
      // English prompts should contain English keywords
      expect(chatCall.messages[0].content).toContain("research strategist");
    });

    it("should use zh-CN prompt by default", async () => {
      const json = makeReplanJson(false);
      mockFacade.chat.mockResolvedValue({
        content: `\`\`\`json\n${json}\n\`\`\``,
      });

      const rounds = [buildRound(1)];
      await service.evaluateAndReplan("test query", rounds);

      const chatCall = mockFacade.chat.mock.calls[0][0];
      // Chinese prompts should contain Chinese keywords
      expect(chatCall.messages[0].content).toContain("研究策略师");
    });

    it("should handle raw JSON response without code fence", async () => {
      const json = makeReplanJson(true, [
        { query: "raw json query", type: "deep_dive", rationale: "Gap" },
      ]);
      mockFacade.chat.mockResolvedValue({ content: json });

      const rounds = [buildRound(1)];
      const result = await service.evaluateAndReplan("test", rounds);

      expect(result.needsReplan).toBe(true);
    });

    it("should return needsReplan=false when AI returns non-boolean needsReplan", async () => {
      const badJson = JSON.stringify({
        needsReplan: "yes",
        reason: "Yep",
        additionalQueries: [],
      });
      mockFacade.chat.mockResolvedValue({
        content: `\`\`\`json\n${badJson}\n\`\`\``,
      });

      const rounds = [buildRound(1)];
      const result = await service.evaluateAndReplan("test", rounds);

      expect(result.needsReplan).toBe(false);
    });

    it("should handle missing additionalQueries field in AI response", async () => {
      const incompleteJson = JSON.stringify({
        needsReplan: true,
        reason: "Need more",
        // additionalQueries is missing
      });
      mockFacade.chat.mockResolvedValue({
        content: `\`\`\`json\n${incompleteJson}\n\`\`\``,
      });

      const rounds = [buildRound(1)];
      const result = await service.evaluateAndReplan("test", rounds);

      // additionalQueries missing means empty array -> not replan
      expect(result.needsReplan).toBe(false);
    });

    it("should build search summary with round info in zh-CN", async () => {
      const json = makeReplanJson(false);
      mockFacade.chat.mockResolvedValue({
        content: `\`\`\`json\n${json}\n\`\`\``,
      });

      const rounds = [
        buildRound(1, 5, "AI trends 2024"),
        buildRound(2, 3, "machine learning applications"),
      ];
      await service.evaluateAndReplan("AI research", rounds, "zh-CN");

      const chatCall = mockFacade.chat.mock.calls[0][0];
      const userPrompt = chatCall.messages[1].content;
      // Should contain round info in Chinese format
      expect(userPrompt).toContain("第1轮");
      expect(userPrompt).toContain("第2轮");
    });

    it("should build search summary with round info in en-US", async () => {
      const json = makeReplanJson(false);
      mockFacade.chat.mockResolvedValue({
        content: `\`\`\`json\n${json}\n\`\`\``,
      });

      const rounds = [
        buildRound(1, 3, "climate policy"),
        buildRound(2, 2, "carbon emissions"),
      ];
      await service.evaluateAndReplan("climate", rounds, "en-US");

      const chatCall = mockFacade.chat.mock.calls[0][0];
      const userPrompt = chatCall.messages[1].content;
      // Should use English round format
      expect(userPrompt).toContain("Round 1");
      expect(userPrompt).toContain("Round 2");
    });
  });
});
