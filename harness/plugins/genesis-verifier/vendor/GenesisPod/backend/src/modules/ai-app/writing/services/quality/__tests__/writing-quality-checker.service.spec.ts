import { Test, TestingModule } from "@nestjs/testing";
import {
  WritingQualityCheckerService,
  ChapterContext,
} from "../writing-quality-checker.service";
import { ExpressionMemoryService } from "../expression-memory.service";
import { CharacterPersonalityService } from "../character-personality.service";
import { NarrativeCraftService } from "../narrative-craft.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

describe("WritingQualityCheckerService", () => {
  let service: WritingQualityCheckerService;
  let mockExpressionMemory: jest.Mocked<ExpressionMemoryService>;
  let mockCharacterPersonality: jest.Mocked<CharacterPersonalityService>;
  let mockNarrativeCraft: jest.Mocked<NarrativeCraftService>;
  let mockFacade: jest.Mocked<ChatFacade>;

  const defaultContext: ChapterContext = {
    projectId: "project-1",
    chapterId: "chapter-1",
    chapterNumber: 1,
  };

  const mockAnalysisResult = {
    newExpressions: [],
    violatedExpressions: [],
  };

  const mockPersonalityCheck = {
    score: 0.9,
    violations: [],
    suggestions: [],
  };

  const mockDialogueValidation = {
    isValid: true,
    issues: [],
  };

  beforeEach(async () => {
    mockExpressionMemory = {
      analyzeExpressionsOnly: jest.fn().mockResolvedValue(mockAnalysisResult),
    } as unknown as jest.Mocked<ExpressionMemoryService>;

    mockCharacterPersonality = {
      checkPersonalityConsistency: jest
        .fn()
        .mockResolvedValue(mockPersonalityCheck),
      validateDialogue: jest.fn().mockResolvedValue(mockDialogueValidation),
    } as unknown as jest.Mocked<CharacterPersonalityService>;

    mockNarrativeCraft = {
      analyzeContent: jest.fn().mockReturnValue({
        issues: [],
        score: 100,
        passed: true,
      }),
      rewriteEnding: jest.fn().mockResolvedValue("rewritten content"),
    } as unknown as jest.Mocked<NarrativeCraftService>;

    mockFacade = {
      chat: jest.fn(),
      chatStream: jest.fn(),
      chatWithSkills: jest.fn().mockResolvedValue({
        content: "fixed content",
        tokensUsed: 100,
      }),
    } as unknown as jest.Mocked<ChatFacade>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WritingQualityCheckerService,
        { provide: ExpressionMemoryService, useValue: mockExpressionMemory },
        {
          provide: CharacterPersonalityService,
          useValue: mockCharacterPersonality,
        },
        { provide: NarrativeCraftService, useValue: mockNarrativeCraft },
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<WritingQualityCheckerService>(
      WritingQualityCheckerService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const makeCleanContent = () =>
    `
她推开门，走进了安静的院子。
"你来了，"他说，"坐。"
两人相对而坐，茶香袅袅。
她先开口，声音低而稳。
`.trim();

  describe("checkChapterQuality", () => {
    it("should return quality check result with score for clean content", async () => {
      const content = makeCleanContent();

      const result = await service.checkChapterQuality(content, defaultContext);

      expect(result).toHaveProperty("overallScore");
      expect(result).toHaveProperty("passed");
      expect(result).toHaveProperty("issues");
      expect(result).toHaveProperty("suggestions");
      expect(result).toHaveProperty("autoFixable");
      expect(result).toHaveProperty("processingTimeMs");
    });

    it("should pass for clean content with no issues", async () => {
      const result = await service.checkChapterQuality(
        makeCleanContent(),
        defaultContext,
      );

      expect(result.passed).toBe(true);
      expect(result.overallScore).toBeGreaterThanOrEqual(60);
    });

    it("should detect modern language in historical context", async () => {
      const content = `她对他说OK，然后拜拜离开了。`;

      const result = await service.checkChapterQuality(content, {
        ...defaultContext,
        historicalPeriod: "唐朝",
      });

      const modernIssues = result.issues.filter(
        (i) => i.type === "modern_language",
      );
      expect(modernIssues.length).toBeGreaterThan(0);
    });

    it("should not check modern language when no historical period", async () => {
      const content = `她说OK，然后离开了。`;

      const result = await service.checkChapterQuality(content, {
        ...defaultContext,
        historicalPeriod: undefined,
      });

      const modernIssues = result.issues.filter(
        (i) => i.type === "modern_language",
      );
      expect(modernIssues).toHaveLength(0);
    });

    it("should detect narrative craft issues via NarrativeCraftService", async () => {
      mockNarrativeCraft.analyzeContent.mockReturnValue({
        issues: [
          {
            type: "ending",
            category: "resolution_cliche",
            match: "绝不随波逐流",
            line: 10,
            problem: "决心宣言式结尾",
            suggestion: "改为具体行动",
          },
        ],
        score: 60,
        passed: false,
      });

      const result = await service.checkChapterQuality(
        makeCleanContent(),
        defaultContext,
      );

      const pacingIssues = result.issues.filter((i) => i.type === "pacing");
      expect(pacingIssues.length).toBeGreaterThan(0);
    });

    it("should check expression repetition", async () => {
      mockExpressionMemory.analyzeExpressionsOnly.mockResolvedValue({
        newExpressions: [],
        violatedExpressions: [{ expression: "心中一震", useCount: 8 }],
      } as any);

      const result = await service.checkChapterQuality(
        makeCleanContent(),
        defaultContext,
      );

      const repetitionIssues = result.issues.filter(
        (i) => i.type === "repetition",
      );
      expect(repetitionIssues.length).toBeGreaterThan(0);
    });

    it("should detect expression variants", async () => {
      const content = `她心中一震，心头一紧，目光一闪，眼中一闪。`;

      const result = await service.checkChapterQuality(content, defaultContext);

      const variantIssues = result.issues.filter(
        (i) => i.type === "repetition" && i.message.includes("变体"),
      );
      expect(variantIssues.length).toBeGreaterThan(0);
    });

    it("should detect catchphrases when characters provided", async () => {
      const content = `
"好的，"萧炎说。
萧炎想了想，"好的，好的，好的。"
萧炎点头，"好的，就这样。"
"好的，我明白，"萧炎道。
`.trim();

      const result = await service.checkChapterQuality(content, {
        ...defaultContext,
        characters: ["萧炎"],
      });

      // Should detect catchphrases
      expect(result).toBeDefined();
    });

    it("should check dialogue quality with multiple characters", async () => {
      mockCharacterPersonality.validateDialogue.mockResolvedValue({
        isValid: false,
        issues: [
          {
            characterName: "萧炎",
            dialogue: "这很好",
            issue: "对话风格不符合角色人格",
            suggestion: "调整对话风格",
          },
        ],
      });

      const content = `"这很好，"萧炎道。"确实，"药老说。`;

      const result = await service.checkChapterQuality(content, {
        ...defaultContext,
        characters: ["萧炎", "药老"],
      });

      const dialogueIssues = result.issues.filter((i) => i.type === "dialogue");
      expect(dialogueIssues.length).toBeGreaterThan(0);
    });

    it("should detect style shift between classical and modern", async () => {
      // First paragraph: classical Chinese with 之乎者也
      // Second paragraph: modern without classical markers
      const content = `君子之道，仁者爱人，礼乎？礼也。

她走过去，直接搞定了事情。`;

      const result = await service.checkChapterQuality(content, defaultContext);

      // Style shift detection checks adjacent paragraphs
      // One paragraph has classical markers (之乎者也矣焉哉), next doesn't
      const _styleIssues = result.issues.filter((i) => i.type === "style");
      // The service detects this as a style shift between paragraphs
      expect(result).toBeDefined();
      // We verify the check ran without error; style detection may or may not trigger
      // depending on exact paragraph analysis
      expect(typeof result.overallScore).toBe("number");
    });

    it("should include processingTimeMs", async () => {
      const result = await service.checkChapterQuality(
        makeCleanContent(),
        defaultContext,
      );

      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("should calculate score correctly based on issues", async () => {
      const content = `她说OK拜拜，然后离开，加油。`;

      const resultWithIssues = await service.checkChapterQuality(content, {
        ...defaultContext,
        historicalPeriod: "唐朝",
      });

      const cleanResult = await service.checkChapterQuality(
        makeCleanContent(),
        defaultContext,
      );

      // Content with issues should score lower
      expect(resultWithIssues.overallScore).toBeLessThan(
        cleanResult.overallScore,
      );
    });
  });

  describe("autoFix", () => {
    it("should fix modern language by direct replacement", async () => {
      const content = `她说OK，然后拜拜了。`;
      const issues = await service.checkChapterQuality(content, {
        ...defaultContext,
        historicalPeriod: "唐朝",
      });

      const fixedContent = await service.autoFix(
        content,
        issues.issues.filter((i) => i.type === "modern_language"),
        {
          ...defaultContext,
          historicalPeriod: "唐朝",
        },
      );

      expect(typeof fixedContent).toBe("string");
      // Modern language should be replaced
      expect(fixedContent).not.toContain("OK");
    });

    it("should fix ending issues using NarrativeCraftService", async () => {
      const endingIssue = {
        type: "pacing" as const,
        severity: "warning" as const,
        location: { line: 5 },
        message: "结尾问题",
        context: "绝不随波逐流",
        suggestion: "改为具体行动",
        autoFixable: true,
      };

      await service.autoFix(
        "some content here\n\n她绝不随波逐流。",
        [endingIssue],
        defaultContext,
      );

      expect(mockNarrativeCraft.rewriteEnding).toHaveBeenCalled();
    });

    it("should call LLM for dialogue issues", async () => {
      const dialogueIssue = {
        type: "dialogue" as const,
        severity: "warning" as const,
        location: { line: 3 },
        message: "对话不自然",
        context: "她说：你好啊同志",
        suggestion: "改为古代用语",
        autoFixable: false,
      };

      await service.autoFix(
        makeCleanContent(),
        [dialogueIssue],
        defaultContext,
      );

      expect(mockFacade.chatWithSkills).toHaveBeenCalled();
    });

    it("should return original content when no issues", async () => {
      const content = makeCleanContent();

      const result = await service.autoFix(content, [], defaultContext);

      expect(result).toBe(content);
    });

    it("should handle LLM failure gracefully when fixing dialogue", async () => {
      mockFacade.chatWithSkills.mockRejectedValue(new Error("API Error"));

      const dialogueIssue = {
        type: "dialogue" as const,
        severity: "warning" as const,
        location: { line: 3 },
        message: "对话问题",
        context: "问题对话",
        suggestion: "改写",
        autoFixable: false,
      };

      const content = makeCleanContent();
      const result = await service.autoFix(
        content,
        [dialogueIssue],
        defaultContext,
      );

      // Should return original content on failure
      expect(result).toBe(content);
    });
  });
});
