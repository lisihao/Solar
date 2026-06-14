/**
 * Tests for SelfReflectionService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { SelfReflectionService } from "../discussion/self-reflection.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import type {
  SearchRound,
  ResearchPlan,
  Reflection,
} from "../discussion/types";

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

describe("SelfReflectionService", () => {
  let service: SelfReflectionService;
  let aiFacade: jest.Mocked<ChatFacade>;

  const mockPlan: ResearchPlan = {
    objective: "Research AI trends",
    approach: "Multi-step",
    steps: [
      {
        id: "step_1",
        type: "initial_search",
        query: "AI 2025",
        rationale: "Start here",
        estimatedSources: 10,
      },
      {
        id: "step_2",
        type: "deep_dive",
        query: "Deep AI",
        rationale: "Go deeper",
        estimatedSources: 8,
      },
    ],
    estimatedTime: 40,
  };

  const createMockRound = (sourceCount: number): SearchRound => ({
    round: 1,
    stepId: "step_1",
    query: "AI trends",
    resultsCount: sourceCount,
    sources: Array.from({ length: sourceCount }, (_, i) => ({
      id: `s${i}`,
      title: `Source ${i}`,
      url: `https://example${i}.com`,
      snippet: `Snippet ${i}`,
      domain: `example${i}.com`,
      relevanceScore: 0.8,
    })),
    timestamp: new Date(),
  });

  beforeEach(async () => {
    const mockFacadeInstance = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          quality_score: 75,
          information_coverage: "Good coverage of the topic",
          gaps_identified: ["Missing market data", "No case studies"],
          decision: "continue",
          reasoning: "Need more information",
          suggested_queries: ["AI market 2025", "AI case studies"],
        }),
        tokensUsed: 300,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SelfReflectionService,
        {
          provide: ChatFacade,
          useValue: mockFacadeInstance,
        },
      ],
    }).compile();

    service = module.get<SelfReflectionService>(SelfReflectionService);
    aiFacade = module.get(ChatFacade);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("reflect", () => {
    it("should return a reflection with decision from AI", async () => {
      const reflection = await service.reflect(
        "AI trends",
        mockPlan,
        [createMockRound(5)],
        1,
        5,
      );

      expect(reflection).toBeDefined();
      expect(reflection.decision).toBe("continue");
      expect(reflection.gaps.length).toBe(2);
      expect(reflection.assessment).toBe("Good coverage of the topic");
    });

    it("should call aiFacade.chat with CHAT_FAST model", async () => {
      await service.reflect("AI trends", mockPlan, [createMockRound(5)], 1, 5);

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: expect.objectContaining({
            creativity: "low",
            outputLength: "minimal",
          }),
        }),
      );
    });

    it("should return default reflection when AI call fails", async () => {
      (aiFacade.chat as jest.Mock).mockRejectedValue(new Error("API Error"));

      const reflection = await service.reflect(
        "AI trends",
        mockPlan,
        [createMockRound(5)],
        1,
        5,
      );

      expect(reflection).toBeDefined();
      expect(reflection.decision).toBeDefined();
    });

    it("should return default reflection when AI returns no JSON", async () => {
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content: "No JSON here, just text",
        tokensUsed: 100,
      });

      const reflection = await service.reflect(
        "AI trends",
        mockPlan,
        [createMockRound(5)],
        1,
        5,
      );

      expect(reflection).toBeDefined();
      expect(reflection.decision).toBeDefined();
    });

    it("should return complete decision when many sources found", async () => {
      (aiFacade.chat as jest.Mock).mockRejectedValue(new Error("fail"));

      // 25 sources across rounds
      const rounds = [createMockRound(25)];
      const reflection = await service.reflect(
        "AI trends",
        mockPlan,
        rounds,
        1,
        5,
      );

      // With 25 sources, default reflection should say complete
      expect(reflection.decision).toBe("complete");
    });

    it("should return continue decision when few sources found", async () => {
      (aiFacade.chat as jest.Mock).mockRejectedValue(new Error("fail"));

      const rounds = [createMockRound(5)]; // Only 5 sources
      const reflection = await service.reflect(
        "AI trends",
        mockPlan,
        rounds,
        1,
        5,
      );

      expect(reflection.decision).toBe("continue");
    });

    it("should handle pivot decision from AI", async () => {
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify({
          quality_score: 40,
          information_coverage: "Insufficient coverage",
          gaps_identified: ["Major gaps"],
          decision: "pivot",
          reasoning: "Need different approach",
          suggested_queries: ["Try different angle"],
        }),
        tokensUsed: 200,
      });

      const reflection = await service.reflect(
        "AI trends",
        mockPlan,
        [createMockRound(3)],
        1,
        5,
      );

      expect(reflection.decision).toBe("pivot");
      expect(reflection.nextSteps).toBeDefined();
    });

    it("should normalize invalid decision types", async () => {
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify({
          quality_score: 50,
          information_coverage: "Some coverage",
          gaps_identified: [],
          decision: "invalid_decision",
          reasoning: "Unknown",
        }),
        tokensUsed: 200,
      });

      const reflection = await service.reflect(
        "AI trends",
        mockPlan,
        [createMockRound(5)],
        1,
        5,
      );

      // Invalid decision should be normalized to 'continue'
      expect(reflection.decision).toBe("continue");
    });

    it("should work with en-US language", async () => {
      const reflection = await service.reflect(
        "AI trends",
        mockPlan,
        [createMockRound(5)],
        1,
        5,
        "en-US",
      );

      expect(reflection).toBeDefined();
      expect(aiFacade.chat).toHaveBeenCalled();
    });
  });

  describe("shouldContinue", () => {
    const createReflection = (
      decision: "continue" | "pivot" | "complete",
    ): Reflection => ({
      round: 1,
      assessment: "Test",
      gaps: [],
      decision,
      reasoning: "Test",
      timestamp: new Date(),
    });

    it("should return false when at max rounds", () => {
      const reflection = createReflection("continue");
      expect(service.shouldContinue(reflection, 5, 5)).toBe(false);
    });

    it("should return false when decision is complete", () => {
      const reflection = createReflection("complete");
      expect(service.shouldContinue(reflection, 3, 5)).toBe(false);
    });

    it("should return true when decision is continue and not at max", () => {
      const reflection = createReflection("continue");
      expect(service.shouldContinue(reflection, 2, 5)).toBe(true);
    });

    it("should return true when decision is pivot and not at max", () => {
      const reflection = createReflection("pivot");
      expect(service.shouldContinue(reflection, 2, 5)).toBe(true);
    });

    it("should return false when past max rounds", () => {
      const reflection = createReflection("continue");
      expect(service.shouldContinue(reflection, 6, 5)).toBe(false);
    });
  });

  describe("generatePivotSteps", () => {
    it("should return empty array when decision is not pivot", () => {
      const reflection: Reflection = {
        round: 2,
        assessment: "Good",
        gaps: [],
        decision: "continue",
        reasoning: "Continue",
        timestamp: new Date(),
      };

      const steps = service.generatePivotSteps(reflection, mockPlan, 2);
      expect(steps).toEqual([]);
    });

    it("should return empty array when no nextSteps", () => {
      const reflection: Reflection = {
        round: 2,
        assessment: "Insufficient",
        gaps: ["Gap 1"],
        decision: "pivot",
        reasoning: "Need pivot",
        timestamp: new Date(),
      };

      const steps = service.generatePivotSteps(reflection, mockPlan, 2);
      expect(steps).toEqual([]);
    });

    it("should generate pivot steps from nextSteps", () => {
      const reflection: Reflection = {
        round: 2,
        assessment: "Insufficient",
        gaps: ["Gap 1"],
        decision: "pivot",
        reasoning: "Need pivot",
        nextSteps: ["New query 1", "New query 2"],
        timestamp: new Date(),
      };

      const steps = service.generatePivotSteps(reflection, mockPlan, 2);

      expect(steps.length).toBe(2);
      expect(steps[0].type).toBe("deep_dive");
      expect(steps[0].query).toBe("New query 1");
      expect(steps[0].id).toContain("pivot_3_1");
    });
  });
});
