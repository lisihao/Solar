import { Test, TestingModule } from "@nestjs/testing";
import { WritingQualityGateService } from "../quality-gate.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ExpressionMemoryService } from "../expression-memory.service";
import { CharacterPersonalityService } from "../character-personality.service";
import { SemanticConsistencyService } from "../semantic-consistency.service";
import { NarrativeCraftService } from "../narrative-craft.service";

describe("WritingQualityGateService", () => {
  let service: WritingQualityGateService;
  let mockPrisma: jest.Mocked<PrismaService>;
  let mockExpressionMemory: jest.Mocked<ExpressionMemoryService>;
  let mockCharacterPersonality: jest.Mocked<CharacterPersonalityService>;
  let mockSemanticConsistency: jest.Mocked<SemanticConsistencyService>;
  let mockNarrativeCraft: jest.Mocked<NarrativeCraftService>;

  const mockPersonalityResult = {
    score: 0.9,
    violations: [],
    suggestions: [],
  };

  const mockAnalysisResult = {
    newExpressions: [{ expression: "月光如水", type: "DESCRIPTION" }],
    violatedExpressions: [],
  };

  beforeEach(async () => {
    mockPrisma = {
      writingPlotPattern: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      writingQualityScore: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      writingQualityIssuePattern: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
    } as unknown as jest.Mocked<PrismaService>;

    mockExpressionMemory = {
      analyzeExpressionsOnly: jest.fn().mockResolvedValue(mockAnalysisResult),
    } as unknown as jest.Mocked<ExpressionMemoryService>;

    mockCharacterPersonality = {
      checkPersonalityConsistency: jest
        .fn()
        .mockResolvedValue(mockPersonalityResult),
    } as unknown as jest.Mocked<CharacterPersonalityService>;

    mockSemanticConsistency = {
      checkSemanticConsistency: jest.fn().mockResolvedValue({
        passed: true,
        conflicts: [],
        extractedFacts: [],
        processingTimeMs: 10,
      }),
    } as unknown as jest.Mocked<SemanticConsistencyService>;

    mockNarrativeCraft = {
      analyzeContent: jest.fn().mockReturnValue({
        issues: [],
        score: 100,
        passed: true,
      }),
    } as unknown as jest.Mocked<NarrativeCraftService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WritingQualityGateService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ExpressionMemoryService, useValue: mockExpressionMemory },
        {
          provide: CharacterPersonalityService,
          useValue: mockCharacterPersonality,
        },
        {
          provide: SemanticConsistencyService,
          useValue: mockSemanticConsistency,
        },
        { provide: NarrativeCraftService, useValue: mockNarrativeCraft },
      ],
    }).compile();

    service = module.get<WritingQualityGateService>(WritingQualityGateService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const makeGoodContent = () =>
    `
她推开窗户，清晨的空气扑面而来。
"阿翠，"她没有回头，"今天谁值班验粉？"
丫鬟站在门边，犹豫了一下。
她等待着，手指轻轻叩击窗棂。
`.trim();

  describe("checkQualityGate", () => {
    it("should pass quality gate for clean content", async () => {
      const content = makeGoodContent();

      const result = await service.checkQualityGate(
        "project-1",
        "chapter-1",
        1,
        content,
      );

      expect(result.passed).toBe(true);
      expect(result.requiresRewrite).toBe(false);
      expect(result.scores).toBeDefined();
    });

    it("should fail quality gate when character consistency is low", async () => {
      mockCharacterPersonality.checkPersonalityConsistency.mockResolvedValue({
        score: 0.3, // below 0.7 threshold
        violations: [
          {
            characterName: "萧炎",
            description: "性格冲突",
            location: "第5行",
            suggestion: "修改行为",
          },
        ],
        suggestions: [],
      } as any);

      const content = makeGoodContent();

      const result = await service.checkQualityGate(
        "project-1",
        "chapter-1",
        1,
        content,
      );

      expect(result.passed).toBe(false);
    });

    it("should detect and fail on ending issues from narrative craft", async () => {
      mockNarrativeCraft.analyzeContent.mockReturnValue({
        issues: [
          {
            type: "ending",
            category: "resolution_cliche",
            match: "绝不随波逐流",
            line: 10,
            problem: "结尾陋习",
            suggestion: "改为具体行动",
          },
        ],
        score: 60,
        passed: false,
      });

      const content = makeGoodContent();

      const result = await service.checkQualityGate(
        "project-1",
        "chapter-1",
        1,
        content,
      );

      expect(result.passed).toBe(false);
    });

    it("should require rewrite when fails and rewrite count is under limit", async () => {
      mockCharacterPersonality.checkPersonalityConsistency.mockResolvedValue({
        score: 0.3,
        violations: [],
        suggestions: [],
      } as any);

      const result = await service.checkQualityGate(
        "project-1",
        "chapter-1",
        1,
        makeGoodContent(),
        0, // first attempt
      );

      expect(result.requiresRewrite).toBe(true);
    });

    it("should not require rewrite when max attempts reached", async () => {
      mockCharacterPersonality.checkPersonalityConsistency.mockResolvedValue({
        score: 0.3,
        violations: [],
        suggestions: [],
      } as any);

      const result = await service.checkQualityGate(
        "project-1",
        "chapter-1",
        1,
        makeGoodContent(),
        3, // at max
      );

      expect(result.requiresRewrite).toBe(false);
    });

    it("should save quality score to database", async () => {
      await service.checkQualityGate(
        "project-1",
        "chapter-1",
        1,
        makeGoodContent(),
      );

      expect(mockPrisma.writingQualityScore.create).toHaveBeenCalled();
    });

    it("should update existing quality score if already exists", async () => {
      (mockPrisma.writingQualityScore.findFirst as jest.Mock).mockResolvedValue(
        { id: "score-1" },
      );

      await service.checkQualityGate(
        "project-1",
        "chapter-1",
        1,
        makeGoodContent(),
      );

      expect(mockPrisma.writingQualityScore.update).toHaveBeenCalled();
    });

    it("should include rewrite suggestions when rewrite is required", async () => {
      mockCharacterPersonality.checkPersonalityConsistency.mockResolvedValue({
        score: 0.3,
        violations: [],
        suggestions: [],
      } as any);

      const result = await service.checkQualityGate(
        "project-1",
        "chapter-1",
        1,
        makeGoodContent(),
        0,
      );

      if (result.requiresRewrite) {
        expect(result.rewriteSuggestions).toBeDefined();
      }
    });
  });

  describe("calculateQualityScores", () => {
    it("should return scores object with all required fields", async () => {
      const content = makeGoodContent();

      const scores = await service.calculateQualityScores(
        "project-1",
        1,
        content,
      );

      expect(scores).toHaveProperty("diversityScore");
      expect(scores).toHaveProperty("vocabularyRichness");
      expect(scores).toHaveProperty("sentenceVariety");
      expect(scores).toHaveProperty("expressionNovelty");
      expect(scores).toHaveProperty("characterConsistency");
      expect(scores).toHaveProperty("dialogueAuthenticity");
      expect(scores).toHaveProperty("plotNovelty");
      expect(scores).toHaveProperty("narrativeFlow");
      expect(scores).toHaveProperty("overallScore");
    });

    it("should have scores in valid range 0-1", async () => {
      const scores = await service.calculateQualityScores(
        "project-1",
        1,
        makeGoodContent(),
      );

      expect(scores.diversityScore).toBeGreaterThanOrEqual(0);
      expect(scores.diversityScore).toBeLessThanOrEqual(1);
      expect(scores.overallScore).toBeGreaterThanOrEqual(0);
      expect(scores.overallScore).toBeLessThanOrEqual(1);
    });

    it("should give lower expression novelty for content with violations", async () => {
      mockExpressionMemory.analyzeExpressionsOnly.mockResolvedValue({
        newExpressions: [],
        violatedExpressions: [
          { expression: "月光如水", useCount: 5 },
          { expression: "心中一震", useCount: 3 },
        ],
      } as any);

      const scores = await service.calculateQualityScores(
        "project-1",
        1,
        makeGoodContent(),
      );

      // Expression novelty should be low with many violations
      expect(scores.expressionNovelty).toBeLessThan(0.5);
    });
  });

  describe("checkSemanticConsistency", () => {
    it("should delegate to semantic consistency service", async () => {
      const content = "萧炎走过花园。";

      await service.checkSemanticConsistency(content, [], []);

      expect(
        mockSemanticConsistency.checkSemanticConsistency,
      ).toHaveBeenCalledWith(content, [], []);
    });
  });

  describe("recordIssuePattern", () => {
    it("should create new issue pattern when not existing", async () => {
      await service.recordIssuePattern(
        "project-1",
        "repetition",
        "过度使用心中一震",
        ["心中一震", "心头一震"],
      );

      expect(mockPrisma.writingQualityIssuePattern.create).toHaveBeenCalled();
    });

    it("should update existing pattern when found", async () => {
      (
        mockPrisma.writingQualityIssuePattern.findFirst as jest.Mock
      ).mockResolvedValue({
        id: "pattern-1",
        occurrenceCount: 3,
        examples: ["example1"],
      });

      await service.recordIssuePattern("project-1", "repetition", "pattern", [
        "example2",
      ]);

      expect(mockPrisma.writingQualityIssuePattern.update).toHaveBeenCalled();
    });

    it("should handle null projectId", async () => {
      await service.recordIssuePattern(null, "style", "generic pattern", []);

      expect(mockPrisma.writingQualityIssuePattern.create).toHaveBeenCalled();
    });
  });

  describe("updateConfig and getConfig", () => {
    it("should update hard gate config", () => {
      service.updateConfig({
        hard: { minDiversityScore: 0.6 },
      });

      const config = service.getConfig();
      expect(config.hard.minDiversityScore).toBe(0.6);
    });

    it("should update soft gate config", () => {
      service.updateConfig({
        soft: { minPlotNovelty: 0.7 },
      });

      const config = service.getConfig();
      expect(config.soft.minPlotNovelty).toBe(0.7);
    });

    it("should return current config", () => {
      const config = service.getConfig();

      expect(config).toHaveProperty("hard");
      expect(config).toHaveProperty("soft");
      expect(config.hard.minDiversityScore).toBeGreaterThan(0);
    });
  });
});
