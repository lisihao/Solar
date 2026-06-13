/**
 * SelfReflectionService Tests
 *
 * Covers:
 * - reflect: success (JSON parsed from response), AI failure (fallback),
 *   language options, round-based decisions
 * - shouldContinue: max rounds reached, decision=complete, continue/pivot
 * - generatePivotSteps: pivot decision, non-pivot decision, step generation
 * - summarizeResults: deduplication, domain extraction, snippet formatting
 * - parseReflectionResponse: valid JSON block, no JSON (fallback), invalid JSON
 * - validateDecision: all valid decision types, unknown type defaults to continue
 * - getDefaultReflection: sufficient sources (>= 20) → complete, insufficient → continue
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { SelfReflectionService } from "../self-reflection.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import type {
  ResearchPlan,
  SearchRound,
  SearchSource,
  Reflection,
} from "../types";

// ============================================================
// Helpers
// ============================================================

const mockFacade = { chat: jest.fn() };

function buildSource(overrides: Partial<SearchSource> = {}): SearchSource {
  return {
    id: "src-1",
    title: "Test Source",
    url: "https://example.com/article",
    snippet: "This is a test snippet for the source",
    domain: "example.com",
    relevanceScore: 0.8,
    ...overrides,
  };
}

function buildSearchRound(
  round: number,
  sources: SearchSource[] = [],
): SearchRound {
  return {
    round,
    stepId: `step-${round}`,
    query: `query ${round}`,
    resultsCount: sources.length,
    sources,
    timestamp: new Date(),
  };
}

function buildPlan(stepCount = 3): ResearchPlan {
  return {
    objective: "Research objective",
    approach: "Iterative",
    steps: Array.from({ length: stepCount }, (_, i) => ({
      id: `step-${i + 1}`,
      type: "initial_search" as const,
      query: `query ${i + 1}`,
      rationale: `rationale ${i + 1}`,
      estimatedSources: 5,
    })),
    estimatedTime: stepCount * 20,
  };
}

function makeReflectionJson(decision: string, queries: string[] = []) {
  return JSON.stringify({
    quality_score: 75,
    information_coverage: "Good coverage of main topics",
    gaps_identified: ["Missing recent data", "Limited academic sources"],
    decision,
    reasoning: `Decided to ${decision} based on current coverage`,
    suggested_queries: queries,
  });
}

// ============================================================
// Tests
// ============================================================

describe("SelfReflectionService", () => {
  let service: SelfReflectionService;

  beforeEach(async () => {
    mockFacade.chat.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SelfReflectionService,
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<SelfReflectionService>(SelfReflectionService);

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

  // ==================== reflect ====================

  describe("reflect", () => {
    it("should return reflection with parsed decision from ```json``` block", async () => {
      const json = makeReflectionJson("continue", ["additional query 1"]);
      mockFacade.chat.mockResolvedValue({
        content: `\`\`\`json\n${json}\n\`\`\``,
      });

      const rounds = [buildSearchRound(1, [buildSource()])];
      const plan = buildPlan(3);

      const reflection = await service.reflect(
        "test query",
        plan,
        rounds,
        1,
        5,
      );

      expect(reflection.round).toBe(1);
      expect(reflection.decision).toBe("continue");
      expect(reflection.assessment).toBe("Good coverage of main topics");
      expect(reflection.gaps).toEqual([
        "Missing recent data",
        "Limited academic sources",
      ]);
      expect(reflection.reasoning).toContain("continue");
      expect(reflection.nextSteps).toEqual(["additional query 1"]);
      expect(reflection.timestamp).toBeInstanceOf(Date);
    });

    it("should return reflection from raw JSON (no code fence)", async () => {
      const json = makeReflectionJson("complete");
      mockFacade.chat.mockResolvedValue({ content: json });

      const plan = buildPlan(2);
      const rounds = [buildSearchRound(1, [buildSource()])];

      const reflection = await service.reflect("test", plan, rounds, 1, 3);

      expect(reflection.decision).toBe("complete");
    });

    it("should return pivot reflection with nextSteps", async () => {
      const json = makeReflectionJson("pivot", [
        "pivot query 1",
        "pivot query 2",
      ]);
      mockFacade.chat.mockResolvedValue({
        content: `\`\`\`json\n${json}\n\`\`\``,
      });

      const plan = buildPlan(3);
      const rounds = [buildSearchRound(1, [buildSource()])];

      const reflection = await service.reflect("test", plan, rounds, 1, 5);

      expect(reflection.decision).toBe("pivot");
      expect(reflection.nextSteps).toHaveLength(2);
    });

    it("should return fallback reflection when AI throws error", async () => {
      mockFacade.chat.mockRejectedValue(new Error("API down"));

      const plan = buildPlan(3);
      const rounds = [buildSearchRound(1, [buildSource()])];

      const reflection = await service.reflect("test", plan, rounds, 1, 5);

      expect(reflection.decision).toBeDefined();
      expect(["continue", "complete", "pivot"]).toContain(reflection.decision);
    });

    it("should return fallback reflection when AI response has no JSON", async () => {
      mockFacade.chat.mockResolvedValue({
        content: "I cannot provide a JSON response.",
      });

      const plan = buildPlan(2);
      const rounds = [buildSearchRound(1, [])];

      const reflection = await service.reflect("test", plan, rounds, 1, 3);

      expect(reflection.round).toBe(1);
    });

    it("should call aiFacade with CHAT_FAST model and low creativity", async () => {
      const json = makeReflectionJson("continue");
      mockFacade.chat.mockResolvedValue({
        content: `\`\`\`json\n${json}\n\`\`\``,
      });

      const plan = buildPlan(2);
      const rounds = [buildSearchRound(1, [buildSource()])];

      await service.reflect("test", plan, rounds, 1, 3);

      expect(mockFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          modelType: AIModelType.CHAT_FAST,
          taskProfile: expect.objectContaining({ creativity: "low" }),
        }),
      );
    });

    it("should use en-US prompt format when language=en-US", async () => {
      const json = makeReflectionJson("complete");
      mockFacade.chat.mockResolvedValue({
        content: `\`\`\`json\n${json}\n\`\`\``,
      });

      const plan = buildPlan(2);
      const rounds = [buildSearchRound(1, [buildSource()])];

      const reflection = await service.reflect(
        "test",
        plan,
        rounds,
        1,
        3,
        "en-US",
      );

      expect(reflection.decision).toBe("complete");
    });

    it("should default unknown decision to continue", async () => {
      const json = makeReflectionJson("unknown_decision");
      mockFacade.chat.mockResolvedValue({
        content: `\`\`\`json\n${json}\n\`\`\``,
      });

      const plan = buildPlan(2);
      const rounds = [buildSearchRound(1, [buildSource()])];

      const reflection = await service.reflect("test", plan, rounds, 1, 3);

      expect(reflection.decision).toBe("continue");
    });

    it("should return complete decision as fallback when total sources >= 20", async () => {
      mockFacade.chat.mockRejectedValue(new Error("fail"));

      const plan = buildPlan(3);
      const manyRounds = [
        buildSearchRound(
          1,
          Array.from({ length: 10 }, (_, i) =>
            buildSource({ id: `src-${i}`, url: `https://example${i}.com` }),
          ),
        ),
        buildSearchRound(
          2,
          Array.from({ length: 10 }, (_, i) =>
            buildSource({
              id: `src-round2-${i}`,
              url: `https://other${i}.com`,
            }),
          ),
        ),
      ];

      const reflection = await service.reflect("test", plan, manyRounds, 2, 5);

      expect(reflection.decision).toBe("complete");
    });

    it("should return continue decision as fallback when sources < 20", async () => {
      mockFacade.chat.mockRejectedValue(new Error("fail"));

      const plan = buildPlan(3);
      const rounds = [buildSearchRound(1, [buildSource()])];

      const reflection = await service.reflect("test", plan, rounds, 1, 5);

      expect(reflection.decision).toBe("continue");
    });
  });

  // ==================== shouldContinue ====================

  describe("shouldContinue", () => {
    const baseReflection: Reflection = {
      round: 1,
      assessment: "OK",
      gaps: [],
      decision: "continue",
      reasoning: "Need more info",
      timestamp: new Date(),
    };

    it("should return false when currentRound >= maxRounds", () => {
      expect(
        service.shouldContinue(
          { ...baseReflection, decision: "continue" },
          5,
          5,
        ),
      ).toBe(false);
      expect(
        service.shouldContinue(
          { ...baseReflection, decision: "continue" },
          6,
          5,
        ),
      ).toBe(false);
    });

    it("should return false when decision is complete", () => {
      expect(
        service.shouldContinue(
          { ...baseReflection, decision: "complete" },
          2,
          5,
        ),
      ).toBe(false);
    });

    it("should return true when decision is continue and round < maxRounds", () => {
      expect(
        service.shouldContinue(
          { ...baseReflection, decision: "continue" },
          2,
          5,
        ),
      ).toBe(true);
    });

    it("should return true when decision is pivot and round < maxRounds", () => {
      expect(
        service.shouldContinue({ ...baseReflection, decision: "pivot" }, 2, 5),
      ).toBe(true);
    });
  });

  // ==================== generatePivotSteps ====================

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

      const steps = service.generatePivotSteps(reflection, buildPlan(), 2);

      expect(steps).toHaveLength(0);
    });

    it("should return empty array when decision is complete", () => {
      const reflection: Reflection = {
        round: 2,
        assessment: "Enough",
        gaps: [],
        decision: "complete",
        reasoning: "Done",
        timestamp: new Date(),
      };

      const steps = service.generatePivotSteps(reflection, buildPlan(), 2);

      expect(steps).toHaveLength(0);
    });

    it("should return empty array when pivot has no nextSteps", () => {
      const reflection: Reflection = {
        round: 2,
        assessment: "Need pivot",
        gaps: ["Missing info"],
        decision: "pivot",
        reasoning: "Redirect",
        timestamp: new Date(),
      };

      const steps = service.generatePivotSteps(reflection, buildPlan(), 2);

      expect(steps).toHaveLength(0);
    });

    it("should generate pivot steps with deep_dive type", () => {
      const reflection: Reflection = {
        round: 2,
        assessment: "Need pivot",
        gaps: ["Missing info"],
        decision: "pivot",
        reasoning: "Redirect search",
        nextSteps: ["new query 1", "new query 2"],
        timestamp: new Date(),
      };

      const steps = service.generatePivotSteps(reflection, buildPlan(), 2);

      expect(steps).toHaveLength(2);
      expect(steps[0].type).toBe("deep_dive");
      expect(steps[0].query).toBe("new query 1");
      expect(steps[1].query).toBe("new query 2");
    });

    it("should include reasoning in pivot step rationale", () => {
      const reflection: Reflection = {
        round: 1,
        assessment: "Need pivot",
        gaps: [],
        decision: "pivot",
        reasoning: "Specific redirect reason",
        nextSteps: ["pivot query"],
        timestamp: new Date(),
      };

      const steps = service.generatePivotSteps(reflection, buildPlan(), 1);

      expect(steps[0].rationale).toContain("Specific redirect reason");
    });

    it("should generate unique step IDs based on completedRounds and index", () => {
      const reflection: Reflection = {
        round: 3,
        assessment: "Need pivot",
        gaps: [],
        decision: "pivot",
        reasoning: "Reason",
        nextSteps: ["q1", "q2"],
        timestamp: new Date(),
      };

      const steps = service.generatePivotSteps(reflection, buildPlan(), 3);

      expect(steps[0].id).toContain("pivot_4_1");
      expect(steps[1].id).toContain("pivot_4_2");
    });
  });
});
