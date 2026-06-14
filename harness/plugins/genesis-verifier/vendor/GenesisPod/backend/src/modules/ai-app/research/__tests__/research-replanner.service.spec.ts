/**
 * Tests for ResearchReplannerService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ResearchReplannerService } from "../discussion/research-replanner.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import type { SearchRound } from "../discussion/types";

jest.mock("@prisma/client", () => ({
  PrismaClient: class PrismaClient { $connect = jest.fn(); $disconnect = jest.fn(); $on = jest.fn(); }, AIModelType: {
    CHAT: "CHAT",
    CHAT_FAST: "CHAT_FAST",
  },
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

describe("ResearchReplannerService", () => {
  let service: ResearchReplannerService;
  let aiFacade: jest.Mocked<ChatFacade>;

  const mockSearchRound: SearchRound = {
    round: 1,
    stepId: "step_1",
    query: "AI trends",
    resultsCount: 5,
    sources: [
      {
        id: "s1",
        title: "Source 1",
        url: "https://example.com",
        snippet: "AI is growing rapidly...",
        domain: "example.com",
        relevanceScore: 0.9,
      },
    ],
    timestamp: new Date(),
  };

  beforeEach(async () => {
    const mockFacadeInstance = {
      chat: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchReplannerService,
        {
          provide: ChatFacade,
          useValue: mockFacadeInstance,
        },
      ],
    }).compile();

    service = module.get<ResearchReplannerService>(ResearchReplannerService);
    aiFacade = module.get(ChatFacade);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("evaluateAndReplan", () => {
    it("should return needsReplan false for empty rounds", async () => {
      const result = await service.evaluateAndReplan("AI research", []);

      expect(result.needsReplan).toBe(false);
      expect(result.additionalSteps).toEqual([]);
    });

    it("should return needsReplan true with additional steps when AI suggests replan", async () => {
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify({
          needsReplan: true,
          reason: "Missing market data",
          additionalQueries: [
            {
              query: "AI market size 2025",
              type: "deep_dive",
              rationale: "Need market data",
            },
            {
              query: "AI investment trends",
              type: "comparison",
              rationale: "Need investment info",
            },
          ],
        }),
        tokensUsed: 300,
      });

      const result = await service.evaluateAndReplan("AI research", [
        mockSearchRound,
      ]);

      expect(result.needsReplan).toBe(true);
      expect(result.additionalSteps.length).toBe(2);
      expect(result.additionalSteps[0].query).toBe("AI market size 2025");
      expect(result.record).toBeDefined();
      expect(result.record!.reason).toBe("Missing market data");
    });

    it("should return needsReplan false when AI says no replan needed", async () => {
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify({
          needsReplan: false,
          reason: "Coverage is adequate",
          additionalQueries: [],
        }),
        tokensUsed: 200,
      });

      const result = await service.evaluateAndReplan("AI research", [
        mockSearchRound,
      ]);

      expect(result.needsReplan).toBe(false);
      expect(result.additionalSteps).toEqual([]);
    });

    it("should limit additional steps to 3", async () => {
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify({
          needsReplan: true,
          reason: "Many gaps",
          additionalQueries: [
            { query: "Query 1", type: "deep_dive", rationale: "Reason 1" },
            { query: "Query 2", type: "deep_dive", rationale: "Reason 2" },
            { query: "Query 3", type: "deep_dive", rationale: "Reason 3" },
            { query: "Query 4", type: "deep_dive", rationale: "Reason 4" },
            { query: "Query 5", type: "deep_dive", rationale: "Reason 5" },
          ],
        }),
        tokensUsed: 300,
      });

      const result = await service.evaluateAndReplan("AI research", [
        mockSearchRound,
      ]);

      expect(result.additionalSteps.length).toBe(3);
    });

    it("should handle AI parse errors gracefully", async () => {
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content: "Not valid JSON at all",
        tokensUsed: 100,
      });

      const result = await service.evaluateAndReplan("AI research", [
        mockSearchRound,
      ]);

      expect(result.needsReplan).toBe(false);
      expect(result.additionalSteps).toEqual([]);
    });

    it("should handle AI call errors gracefully", async () => {
      (aiFacade.chat as jest.Mock).mockRejectedValue(
        new Error("Service unavailable"),
      );

      const result = await service.evaluateAndReplan("AI research", [
        mockSearchRound,
      ]);

      expect(result.needsReplan).toBe(false);
      expect(result.additionalSteps).toEqual([]);
    });

    it("should handle response with invalid needsReplan type", async () => {
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify({
          needsReplan: "yes",
          reason: "Some reason",
          additionalQueries: [],
        }),
        tokensUsed: 100,
      });

      const result = await service.evaluateAndReplan("AI research", [
        mockSearchRound,
      ]);

      expect(result.needsReplan).toBe(false);
      expect(result.additionalSteps).toEqual([]);
    });

    it("should work with en-US language", async () => {
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify({
          needsReplan: false,
          reason: "Coverage is adequate",
          additionalQueries: [],
        }),
        tokensUsed: 200,
      });

      const result = await service.evaluateAndReplan(
        "AI research",
        [mockSearchRound],
        "en-US",
      );

      expect(result.needsReplan).toBe(false);
      // Verify AI was called (with English prompts)
      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining("research strategist"),
            }),
          ]),
        }),
      );
    });

    it("should handle response wrapped in JSON code blocks", async () => {
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content:
          "```json\n" +
          JSON.stringify({
            needsReplan: true,
            reason: "Gap found",
            additionalQueries: [
              {
                query: "Extra query",
                type: "deep_dive",
                rationale: "Fill gap",
              },
            ],
          }) +
          "\n```",
        tokensUsed: 200,
      });

      const result = await service.evaluateAndReplan("AI research", [
        mockSearchRound,
      ]);

      expect(result.needsReplan).toBe(true);
      expect(result.additionalSteps.length).toBe(1);
    });

    it("should include record with triggerStep and addedQueries", async () => {
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify({
          needsReplan: true,
          reason: "Missing data",
          additionalQueries: [
            { query: "New query", type: "deep_dive", rationale: "Need more" },
          ],
        }),
        tokensUsed: 200,
      });

      const result = await service.evaluateAndReplan("AI research", [
        mockSearchRound,
        { ...mockSearchRound, round: 2 },
      ]);

      expect(result.record).toBeDefined();
      expect(result.record!.triggerStep).toBe(2);
      expect(result.record!.addedQueries).toContain("New query");
    });
  });
});
