import { Test, TestingModule } from "@nestjs/testing";
import { ResearchReviewerService } from "../research-reviewer.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import {
  ReviewQualityLevel,
  type DimensionReviewResult,
} from "../../../types/collaboration.types";
import type { DimensionAnalysisResult } from "../../../types/research.types";

const mockFacade = {
  chat: jest.fn(),
  chatWithSkills: jest.fn(),
};

const mockTopic = {
  id: "topic-1",
  name: "AI Market Research",
  type: "TECHNOLOGY",
  userId: "user-1",
};

const mockDimension = {
  id: "dim-1",
  name: "Market Size",
  description: "Size of the AI market",
  sortOrder: 1,
};

const mockAnalysis: DimensionAnalysisResult = {
  summary: "AI market is growing rapidly",
  keyFindings: [
    {
      finding: "Market will reach $500B by 2025",
      significance: "high",
      evidenceIds: ["ev-1", "ev-2"],
      implication: "Major opportunity",
    },
  ],
  trends: [
    {
      trend: "Generative AI adoption",
      direction: "up",
      timeframe: "2024-2025",
      evidenceIds: ["ev-1"],
    },
  ],
  challenges: [
    {
      challenge: "Regulatory uncertainty",
      impact: "Slows adoption",
      evidenceIds: ["ev-2"],
    },
  ],
  opportunities: [
    {
      opportunity: "Enterprise AI integration",
      potential: "High",
      evidenceIds: ["ev-1"],
    },
  ],
  confidenceLevel: "high",
  evidenceUsed: 5,
  detailedContent:
    "Detailed analysis of the AI market showing strong growth. ".repeat(20),
};

const goodAiResponse = {
  qualityLevel: "good",
  overallScore: 80,
  scores: {
    breadth: 80,
    depth: 75,
    evidence: 85,
    coherence: 80,
    currency: 75,
  },
  issues: [],
  suggestions: ["Include more recent data"],
  needsReresearch: false,
};

describe("ResearchReviewerService", () => {
  let service: ResearchReviewerService;
  let facade: jest.Mocked<typeof mockFacade>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchReviewerService,
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<ResearchReviewerService>(ResearchReviewerService);
    facade = mockFacade as unknown as jest.Mocked<typeof mockFacade>;
    jest.clearAllMocks();
  });

  describe("reviewDimension", () => {
    it("should return GOOD quality level for score 80", async () => {
      facade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify(goodAiResponse),
        tokensUsed: 200,
        model: "gpt-4",
      });

      const result = await service.reviewDimension(
        mockTopic as never,
        mockDimension as never,
        mockAnalysis,
        10,
      );

      expect(result.qualityLevel).toBe(ReviewQualityLevel.GOOD);
      expect(result.overallScore).toBe(80);
      expect(result.needsReresearch).toBe(false);
      expect(result.dimensionId).toBe("dim-1");
    });

    it("should return EXCELLENT quality level for score >= 90", async () => {
      facade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          ...goodAiResponse,
          overallScore: 95,
          qualityLevel: "excellent",
        }),
        tokensUsed: 200,
        model: "gpt-4",
      });

      const result = await service.reviewDimension(
        mockTopic as never,
        mockDimension as never,
        mockAnalysis,
        10,
      );

      expect(result.qualityLevel).toBe(ReviewQualityLevel.EXCELLENT);
    });

    it("should force needsReresearch when overallScore < 60", async () => {
      facade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          ...goodAiResponse,
          overallScore: 50,
          qualityLevel: "needs_revision",
          needsReresearch: false,
        }),
        tokensUsed: 200,
        model: "gpt-4",
      });

      const result = await service.reviewDimension(
        mockTopic as never,
        mockDimension as never,
        mockAnalysis,
        10,
      );

      expect(result.needsReresearch).toBe(true);
    });

    it("should detect refusal keywords and flag as NEEDS_REVISION", async () => {
      facade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          ...goodAiResponse,
          overallScore: 80,
          needsReresearch: false,
        }),
        tokensUsed: 100,
        model: "gpt-4",
      });

      const refusedAnalysis = {
        ...mockAnalysis,
        detailedContent: "I cannot provide this analysis.",
      };

      const result = await service.reviewDimension(
        mockTopic as never,
        mockDimension as never,
        refusedAnalysis,
        10,
      );

      expect(result.needsReresearch).toBe(true);
      expect(result.qualityLevel).toBe(ReviewQualityLevel.NEEDS_REVISION);
    });

    it("should return failed review result when AI throws error", async () => {
      facade.chatWithSkills.mockRejectedValue(new Error("Network error"));

      const result = await service.reviewDimension(
        mockTopic as never,
        mockDimension as never,
        mockAnalysis,
        10,
      );

      expect(result.needsReresearch).toBe(true);
      expect(result.qualityLevel).toBe(ReviewQualityLevel.NEEDS_REVISION);
      expect(result.overallScore).toBe(0);
      expect(result.issues[0].description).toContain("Network error");
    });

    it("should handle AI response wrapped in markdown code blocks", async () => {
      facade.chatWithSkills.mockResolvedValue({
        content: `\`\`\`json\n${JSON.stringify(goodAiResponse)}\n\`\`\``,
        tokensUsed: 200,
        model: "gpt-4",
      });

      const result = await service.reviewDimension(
        mockTopic as never,
        mockDimension as never,
        mockAnalysis,
        10,
      );

      expect(result.overallScore).toBe(80);
    });
  });

  describe("reviewOverall", () => {
    const makeDimensionReview = (
      overrides: Partial<DimensionReviewResult> = {},
    ): DimensionReviewResult => ({
      dimensionId: "dim-1",
      dimensionName: "Market Size",
      qualityLevel: ReviewQualityLevel.GOOD,
      overallScore: 80,
      scores: {
        breadth: 80,
        depth: 75,
        evidence: 85,
        coherence: 80,
        currency: 75,
      },
      issues: [],
      suggestions: [],
      needsReresearch: false,
      ...overrides,
    });

    it("should calculate correct overall score as average of dimension scores", async () => {
      const reviews = [
        makeDimensionReview({ overallScore: 80 }),
        makeDimensionReview({
          dimensionId: "dim-2",
          dimensionName: "Competitors",
          overallScore: 60,
        }),
      ];

      const result = await service.reviewOverall(
        mockTopic as never,
        [
          mockDimension,
          { ...mockDimension, id: "dim-2", name: "Competitors" },
        ] as never,
        reviews,
      );

      expect(result.overallScore).toBe(70);
      expect(result.topicId).toBe("topic-1");
    });

    it("should flag needsReresearch when any dimension needs it", async () => {
      const reviews = [
        makeDimensionReview({ needsReresearch: false }),
        makeDimensionReview({
          dimensionId: "dim-2",
          dimensionName: "Bad",
          needsReresearch: true,
          overallScore: 40,
        }),
      ];

      const result = await service.reviewOverall(
        mockTopic as never,
        [mockDimension] as never,
        reviews,
      );

      expect(result.needsReresearch).toBe(true);
      expect(result.dimensionsToReresearch).toContain("dim-2");
    });

    it("should return ACCEPTABLE quality level for average score 65", async () => {
      const reviews = [makeDimensionReview({ overallScore: 65 })];

      const result = await service.reviewOverall(
        mockTopic as never,
        [mockDimension] as never,
        reviews,
      );

      expect(result.qualityLevel).toBe(ReviewQualityLevel.ACCEPTABLE);
    });

    it("should return score 0 and no reresearch for empty dimension reviews", async () => {
      const result = await service.reviewOverall(mockTopic as never, [], []);

      expect(result.overallScore).toBe(0);
      expect(result.needsReresearch).toBe(false);
    });

    it("should generate recommendations for missing coverage", async () => {
      const reviews = [
        makeDimensionReview({
          overallScore: 65,
          scores: {
            breadth: 50,
            depth: 50,
            evidence: 50,
            coherence: 50,
            currency: 50,
          },
        }),
      ];
      const dimensions = [{ ...mockDimension, name: "现状分析" }];

      const result = await service.reviewOverall(
        mockTopic as never,
        dimensions as never,
        reviews,
      );

      expect(result.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe("validateClaims", () => {
    it("should return empty stats when no claims provided", async () => {
      const result = await service.validateClaims([], "evidence summary");

      expect(result.results).toHaveLength(0);
      expect(result.stats.total).toBe(0);
      expect(result.stats.verified).toBe(0);
    });

    it("should process claims in batches of 5", async () => {
      facade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          results: [
            {
              claimId: "c1",
              status: "verified",
              supportingSourceIndices: [0],
              contradictingSourceIndices: [],
              explanation: "OK",
            },
            {
              claimId: "c2",
              status: "verified",
              supportingSourceIndices: [1],
              contradictingSourceIndices: [],
              explanation: "OK",
            },
          ],
        }),
        tokensUsed: 100,
        model: "gpt-4",
      });

      const claims = [
        { id: "c1", claim: "Claim 1", source: "ev-1", confidence: 0.9 },
        { id: "c2", claim: "Claim 2", source: "ev-2", confidence: 0.8 },
      ] as never;

      const result = await service.validateClaims(claims, "evidence");

      expect(facade.chatWithSkills).toHaveBeenCalledTimes(1);
      expect(result.stats.total).toBe(2);
    });

    it("should mark claims as unverified when batch fails", async () => {
      facade.chatWithSkills.mockRejectedValue(new Error("API error"));

      const claims = [
        { id: "c1", claim: "Claim 1", source: "ev-1", confidence: 0.9 },
      ] as never;

      const result = await service.validateClaims(claims, "evidence");

      expect(result.results[0].status).toBe("unverified");
      expect(result.stats.unverified).toBe(1);
    });
  });

  describe("factCheckReport", () => {
    it("should return 100 accuracy when no citations found", async () => {
      const result = await service.factCheckReport("No citations here.", []);

      expect(result.accuracyScore).toBe(100);
      expect(result.citations).toHaveLength(0);
    });

    it("should call AI and return fact check results when citations exist", async () => {
      facade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          citations: [
            { mark: "[1]", status: "accurate", explanation: "Verified" },
          ],
          accuracyScore: 95,
          issues: [],
        }),
        tokensUsed: 150,
        model: "gpt-4",
      });

      const reportContent = "The market grew by 50% [1] according to analysts.";
      const evidence = [
        { id: "ev-1", title: "Market Report", snippet: "Market grew 50%" },
      ];

      const result = await service.factCheckReport(reportContent, evidence);

      expect(result.accuracyScore).toBe(95);
      expect(facade.chatWithSkills).toHaveBeenCalledTimes(1);
    });

    it("should return error result when AI throws", async () => {
      facade.chatWithSkills.mockRejectedValue(new Error("Timeout"));

      const result = await service.factCheckReport("Growth was 50% [1].", []);

      expect(result.accuracyScore).toBe(0);
      expect(result.issues).toContain("事实核查过程出错");
    });
  });
});
