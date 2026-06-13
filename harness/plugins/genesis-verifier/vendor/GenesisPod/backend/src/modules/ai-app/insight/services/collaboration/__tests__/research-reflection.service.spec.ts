import { Test, TestingModule } from "@nestjs/testing";
import { ResearchReflectionService } from "../research-reflection.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import type { ReflectionContext } from "../../../types/collaboration.types";
import type { EnrichedEvidenceData } from "../../../types/research.types";

const mockFacade = {
  chat: jest.fn(),
};

const makeEvidence = (
  overrides: Partial<EnrichedEvidenceData> = {},
): EnrichedEvidenceData =>
  ({
    id: "ev-1",
    title: "Test Evidence",
    url: "https://example.com",
    snippet: "A reasonably long snippet that provides useful information.",
    contentSource: "fetched",
    fullContent: "Full content here ".repeat(20),
    sourceType: "web",
    ...overrides,
  }) as EnrichedEvidenceData;

const makeContext = (
  overrides: Partial<ReflectionContext> = {},
): ReflectionContext => ({
  dimensionName: "Market Analysis",
  dimensionDescription: "Analysis of the current market",
  researchGoals: ["Understand market size", "Identify key players"],
  evidence: [
    makeEvidence(),
    makeEvidence({ id: "ev-2" }),
    makeEvidence({ id: "ev-3" }),
  ],
  freshnessRequirement: "Last 12 months",
  ...overrides,
});

describe("ResearchReflectionService", () => {
  let service: ResearchReflectionService;
  let facade: jest.Mocked<typeof mockFacade>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchReflectionService,
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<ResearchReflectionService>(ResearchReflectionService);
    facade = mockFacade as unknown as jest.Mocked<typeof mockFacade>;
    jest.clearAllMocks();
  });

  describe("evaluateEvidence", () => {
    it("should return sufficient when AI says so", async () => {
      facade.chat.mockResolvedValue({
        content: JSON.stringify({
          decision: "sufficient",
          score: 85,
          gaps: [],
          reasoning: "Evidence is comprehensive",
        }),
        tokensUsed: 100,
        model: "gemini-pro",
      });

      const result = await service.evaluateEvidence(makeContext());

      expect(result.decision).toBe("sufficient");
      expect(result.score).toBe(85);
      expect(result.gaps).toHaveLength(0);
      expect(facade.chat).toHaveBeenCalledTimes(1);
    });

    it("should return need_more when AI identifies gaps", async () => {
      facade.chat.mockResolvedValue({
        content: JSON.stringify({
          decision: "need_more",
          score: 50,
          gaps: ["Missing competitor data", "No regulatory analysis"],
          reasoning: "Insufficient coverage",
          suggestedQueries: ["market competitors 2025", "regulatory framework"],
        }),
        tokensUsed: 120,
        model: "gemini-pro",
      });

      const result = await service.evaluateEvidence(makeContext());

      expect(result.decision).toBe("need_more");
      expect(result.gaps).toHaveLength(2);
      expect(result.suggestedQueries).toHaveLength(2);
    });

    it("should return default sufficient result when AI throws an error", async () => {
      facade.chat.mockRejectedValue(new Error("API error"));

      const result = await service.evaluateEvidence(makeContext());

      expect(result.decision).toBe("sufficient");
      expect(result.score).toBe(70);
      expect(result.gaps).toHaveLength(0);
    });

    it("should handle malformed AI JSON with default values", async () => {
      facade.chat.mockResolvedValue({
        content: "not json at all",
        tokensUsed: 50,
        model: "gemini-pro",
      });

      const result = await service.evaluateEvidence(makeContext());

      expect(result.decision).toBe("sufficient");
      expect(result.score).toBe(70);
    });

    it("should pass context with no research goals gracefully", async () => {
      facade.chat.mockResolvedValue({
        content: JSON.stringify({
          decision: "sufficient",
          score: 75,
          gaps: [],
          reasoning: "OK",
        }),
        tokensUsed: 80,
        model: "gemini-pro",
      });

      const ctx = makeContext({ researchGoals: undefined });
      const result = await service.evaluateEvidence(ctx);

      expect(result.decision).toBe("sufficient");
      expect(facade.chat).toHaveBeenCalledTimes(1);
    });

    it("should truncate evidence list in prompt when over 10 items", async () => {
      const manyEvidence = Array.from({ length: 15 }, (_, i) =>
        makeEvidence({ id: `ev-${i}` }),
      );
      facade.chat.mockResolvedValue({
        content: JSON.stringify({
          decision: "sufficient",
          score: 80,
          gaps: [],
          reasoning: "OK",
        }),
        tokensUsed: 100,
        model: "gemini-pro",
      });

      const ctx = makeContext({ evidence: manyEvidence });
      const result = await service.evaluateEvidence(ctx);

      expect(result.decision).toBe("sufficient");
      expect(facade.chat).toHaveBeenCalledTimes(1);
    });
  });

  describe("quickCheck", () => {
    it("should flag insufficient evidence when fewer than 3 items", () => {
      const evidence = [makeEvidence()];
      const result = service.quickCheck(evidence);

      expect(result.needsFullEvaluation).toBe(true);
      expect(result.reason).toContain("证据数量不足");
    });

    it("should flag when valid content ratio is below 50%", () => {
      const evidence = [
        makeEvidence({ contentSource: "fetched", snippet: undefined }),
        makeEvidence({ contentSource: "snippet", snippet: undefined }),
        makeEvidence({ contentSource: "snippet", snippet: undefined }),
        makeEvidence({ contentSource: "snippet", snippet: undefined }),
      ];
      const result = service.quickCheck(evidence);

      expect(result.needsFullEvaluation).toBe(true);
    });

    it("should flag when average content length is too short", () => {
      const evidence = Array.from({ length: 5 }, (_, i) =>
        makeEvidence({
          id: `ev-${i}`,
          contentSource: "fetched",
          snippet: "short",
          fullContent: "short",
        }),
      );
      const result = service.quickCheck(evidence);

      expect(result.needsFullEvaluation).toBe(true);
    });

    it("should pass check when evidence meets all criteria", () => {
      const evidence = Array.from({ length: 5 }, (_, i) =>
        makeEvidence({
          id: `ev-${i}`,
          contentSource: "fetched",
          fullContent: "This is a longer content string. ".repeat(10),
        }),
      );
      const result = service.quickCheck(evidence);

      expect(result.needsFullEvaluation).toBe(false);
      expect(result.reason).toBe("基础检查通过");
    });
  });

  describe("suggestAdditionalQueries", () => {
    it("should return empty array when no gaps", async () => {
      const queries = await service.suggestAdditionalQueries(
        "Market Analysis",
        [],
      );
      expect(queries).toHaveLength(0);
    });

    it("should return up to 3 queries based on gaps", async () => {
      const gaps = ["gap1", "gap2", "gap3", "gap4"];
      const queries = await service.suggestAdditionalQueries(
        "Market Analysis",
        gaps,
      );

      expect(queries).toHaveLength(3);
      expect(queries[0]).toContain("Market Analysis");
      expect(queries[0]).toContain("gap1");
    });

    it("should include current year in each query", async () => {
      const currentYear = new Date().getFullYear();
      const queries = await service.suggestAdditionalQueries("Tech", [
        "missing aspect",
      ]);

      expect(queries[0]).toContain(String(currentYear));
    });
  });
});
